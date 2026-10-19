/**
 * A minimal EQ reliable UDP client session over node:dgram, and the probe
 * that logs one client version into a world with it.
 */
import dgram from "dgram";
import dns from "dns";
import crypto from "crypto";
import {
  OP,
  ReliableReceiver,
  SessionParams,
  buildAppPacket,
  buildDisconnect,
  buildReliableOrFragments,
  buildSessionRequest,
  compareSequence,
  decodeIncoming,
  encodeOutgoing,
  parseSessionResponse,
  wrapAppForStream,
  DEFAULT_MAX_PACKET_SIZE,
} from "./protocol";
import { ClientDef, encodeLoginInfo } from "./clients";
import { ProbeClassification, ProbeObservation, classifyProbe } from "./classify";

interface PendingReliable {
  sequence: number;
  packet: Buffer;
  sentAt: number;
  delay: number;
}

export class EqUdpSession {
  private socket: dgram.Socket | null = null;
  private params: SessionParams | null = null;
  private connectCode = crypto.randomBytes(4).readUInt32BE(0);
  private receiver: ReliableReceiver;
  private sequenceOut = 0;
  private pending: PendingReliable[] = [];
  private resendTimer: NodeJS.Timeout | null = null;
  private closed = false;

  onApp: (packet: Buffer) => void = () => {};
  onAcked: (sequence: number) => void = () => {};
  onDisconnect: () => void = () => {};

  constructor(private readonly host: string, private readonly port: number) {
    this.receiver = new ReliableReceiver({
      onApp: (p) => this.onApp(p),
      onSend: (p) => this.sendProtocol(p),
      onAck: (stream, seq, outOfOrder) => {
        if (stream !== 0) return;
        if (outOfOrder) {
          this.pending = this.pending.filter((e) => e.sequence !== seq);
          this.onAcked(seq);
          return;
        }
        // cumulative: everything at or before seq
        const acked = this.pending.filter((e) => compareSequence(seq, e.sequence) !== "future");
        this.pending = this.pending.filter((e) => compareSequence(seq, e.sequence) === "future");
        for (const e of acked) this.onAcked(e.sequence);
      },
      onDisconnect: () => {
        this.shutdown(false);
        this.onDisconnect();
      },
    });
  }

  get established(): boolean {
    return this.params !== null;
  }

  /** Resolve, open the socket and complete the session handshake. */
  async connect(timeoutMs: number): Promise<boolean> {
    const address = await resolveIPv4(this.host);
    const socket = dgram.createSocket("udp4");
    this.socket = socket;

    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearInterval(retry);
        clearTimeout(timer);
        resolve(ok);
      };

      socket.on("error", () => finish(false));
      socket.on("message", (msg, rinfo) => {
        if (rinfo.address !== address || rinfo.port !== this.port) return;
        this.handleDatagram(msg);
        if (this.params) finish(true);
      });

      // A connected socket only receives datagrams from the world's address.
      const request = buildSessionRequest(this.connectCode, DEFAULT_MAX_PACKET_SIZE);
      let connected = false;
      const sendRequest = () => {
        if (connected && !this.closed) socket.send(request);
      };
      socket.connect(this.port, address, () => {
        connected = true;
        sendRequest();
      });
      const retry = setInterval(sendRequest, 500);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  /** Queue an app packet on reliable stream 0 (fragmented when needed). */
  sendApp(app: Buffer): number[] {
    if (!this.params) throw new Error("session not established");
    const packets = buildReliableOrFragments(
      0,
      this.sequenceOut,
      wrapAppForStream(app),
      this.params.maxPacketSize,
      this.params.crcBytes
    );
    const sequences: number[] = [];
    for (const p of packets) {
      const sequence = this.sequenceOut;
      this.sequenceOut = (this.sequenceOut + 1) & 0xffff;
      this.pending.push({ sequence, packet: p, sentAt: Date.now(), delay: 300 });
      this.sendProtocol(p);
      sequences.push(sequence);
    }
    if (!this.resendTimer) {
      this.resendTimer = setInterval(() => this.resend(), 100);
    }
    return sequences;
  }

  /** Send a session disconnect (twice, it is unreliable) and close. */
  close(): void {
    this.shutdown(true);
  }

  private shutdown(sendDisconnect: boolean): void {
    if (this.closed) return;
    if (sendDisconnect && this.params && this.socket) {
      const d = buildDisconnect(this.connectCode);
      this.sendProtocol(d);
      this.sendProtocol(d);
    }
    this.closed = true;
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = null;
    const s = this.socket;
    this.socket = null;
    // let the disconnect datagrams leave before closing
    if (s) setTimeout(() => { try { s.close(); } catch {} }, 50);
  }

  private resend(): void {
    const now = Date.now();
    for (const e of this.pending) {
      if (now - e.sentAt >= e.delay) {
        this.sendProtocol(e.packet);
        e.sentAt = now;
        e.delay = Math.min(e.delay * 2, 2000);
      }
    }
  }

  private sendProtocol(p: Buffer): void {
    if (this.closed || !this.socket) return;
    const out = this.params ? encodeOutgoing(p, this.params) : p;
    try {
      this.socket.send(out);
    } catch {
      // socket already closed
    }
  }

  private handleDatagram(raw: Buffer): void {
    if (raw.length < 2 || this.closed) return;
    if (raw[0] === 0) {
      const op = raw[1];
      if (op === OP.SessionResponse) {
        if (this.params) return;
        const r = parseSessionResponse(raw);
        if (r && r.connectCode === this.connectCode) {
          r.maxPacketSize = Math.max(64, Math.min(r.maxPacketSize || DEFAULT_MAX_PACKET_SIZE, DEFAULT_MAX_PACKET_SIZE));
          this.params = r;
        }
        return;
      }
      if (op === OP.OutOfSession) {
        if (this.params) {
          this.shutdown(false);
          this.onDisconnect();
        }
        return;
      }
      if (op === OP.KeepAlive || op === OP.OutboundPing) return;
    }
    if (!this.params) return;
    let decoded: Buffer | null = null;
    try {
      decoded = decodeIncoming(raw, this.params);
    } catch {
      return; // bad compression data
    }
    if (!decoded) return; // CRC mismatch
    try {
      this.receiver.handle(decoded);
    } catch {
      // malformed packet; ignore like the server does
    }
  }
}

async function resolveIPv4(host: string): Promise<string> {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const r = await dns.promises.lookup(host, { family: 4 });
  return r.address;
}

export interface ProbeOptions {
  host: string;
  port: number;
  client: ClientDef;
  loginserverAccountId: number;
  key: string;
  /** Handshake timeout. */
  connectTimeoutMs?: number;
  /** How long to wait for the world's answer after the login packet. */
  replyTimeoutMs?: number;
}

export interface ProbeResult extends ProbeClassification {
  durationMs: number;
  observation: ProbeObservation;
}

/**
 * Log one client version into a world and classify the answer. Disconnects as
 * soon as the result is known (character list or rejection received).
 */
export async function probeWorldClient(opts: ProbeOptions): Promise<ProbeResult> {
  const started = Date.now();
  const obs: ProbeObservation = {
    sessionEstablished: false,
    loginAcked: false,
    appOpcodes: [],
    charInfoPayload: null,
    disconnectedByServer: false,
    error: null,
  };
  const finishResult = (): ProbeResult => ({
    ...classifyProbe(opts.client, obs),
    durationMs: Date.now() - started,
    observation: obs,
  });

  const session = new EqUdpSession(opts.host, opts.port);
  try {
    obs.sessionEstablished = await session.connect(opts.connectTimeoutMs ?? 5000);
  } catch (err) {
    obs.error = `connect failed: ${err instanceof Error ? err.message : String(err)}`;
    session.close();
    return finishResult();
  }
  if (!obs.sessionEstablished) {
    session.close();
    return finishResult();
  }

  const charInfoOp = opts.client.opcodes.sendCharInfo;
  await new Promise<void>((resolve) => {
    let done = false;
    let loginSequences: number[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    session.onApp = (p) => {
      if (p.length < 2) return;
      const opcode = p.readUInt16LE(0);
      obs.appOpcodes.push(opcode);
      if (opcode === charInfoOp && !obs.charInfoPayload) {
        obs.charInfoPayload = Buffer.from(p.subarray(2));
        finish();
      }
    };
    session.onAcked = (seq) => {
      if (loginSequences.indexOf(seq) !== -1) obs.loginAcked = true;
    };
    session.onDisconnect = () => {
      obs.disconnectedByServer = true;
      finish();
    };
    const timer = setTimeout(finish, opts.replyTimeoutMs ?? 10_000);
    try {
      const payload = encodeLoginInfo(opts.client, opts.loginserverAccountId, opts.key);
      loginSequences = session.sendApp(buildAppPacket(opts.client.opcodes.sendLoginInfo, payload));
    } catch (err) {
      obs.error = `send failed: ${err instanceof Error ? err.message : String(err)}`;
      finish();
    }
  });

  session.close();
  return finishResult();
}
