/**
 * EQ reliable UDP ("daybreak") protocol, client side, as far as the client
 * probe needs it. Mirrors common/net/reliable_stream_connection.cpp of the
 * EQEmu server:
 *
 *  - session request / response (connect code, encode key, CRC length,
 *    encode passes, max packet size; all multi-byte fields big-endian)
 *  - per-packet CRC seeded with the session encode key (low 16 bits for a
 *    2-byte CRC, appended big-endian)
 *  - optional compression (0x5a zlib / 0xa5 raw flag) and XOR encode passes
 *  - combined (0x03) and app-combined (0x19) packets
 *  - sequenced reliable packets on four streams, cumulative and out-of-order
 *    acks, fragments (first fragment carries the total size)
 *  - session disconnect
 *
 * Everything in this file is pure (no sockets) so it can be unit tested.
 */
import zlib from "zlib";
import { crc32Keyed } from "./crc";

export const OP = {
  Padding: 0x00,
  SessionRequest: 0x01,
  SessionResponse: 0x02,
  Combined: 0x03,
  SessionDisconnect: 0x05,
  KeepAlive: 0x06,
  SessionStatRequest: 0x07,
  SessionStatResponse: 0x08,
  Packet: 0x09,
  Fragment: 0x0d,
  OutOfOrderAck: 0x11,
  Ack: 0x15,
  AppCombined: 0x19,
  OutboundPing: 0x1c,
  OutOfSession: 0x1d,
} as const;

export const ENCODE_NONE = 0;
export const ENCODE_COMPRESSION = 1;
export const ENCODE_XOR = 4;

/** Protocol version the server's client code sends (SendConnect). */
export const PROTOCOL_VERSION = 3;
export const DEFAULT_MAX_PACKET_SIZE = 512;

export interface SessionParams {
  connectCode: number;
  encodeKey: number;
  crcBytes: number;
  encodePasses: [number, number];
  maxPacketSize: number;
}

// ── Session handshake ──

export function buildSessionRequest(connectCode: number, maxPacketSize = DEFAULT_MAX_PACKET_SIZE): Buffer {
  const b = Buffer.alloc(14);
  b[0] = 0;
  b[1] = OP.SessionRequest;
  b.writeUInt32BE(PROTOCOL_VERSION, 2);
  b.writeUInt32BE(connectCode >>> 0, 6);
  b.writeUInt32BE(maxPacketSize >>> 0, 10);
  return b;
}

export function parseSessionResponse(b: Buffer): SessionParams | null {
  if (b.length < 17 || b[0] !== 0 || b[1] !== OP.SessionResponse) return null;
  return {
    connectCode: b.readUInt32BE(2),
    encodeKey: b.readUInt32BE(6),
    crcBytes: b[10],
    encodePasses: [b[11], b[12]],
    maxPacketSize: b.readUInt32BE(13),
  };
}

/** Build the server side of the handshake (used by tests). */
export function buildSessionResponse(p: SessionParams): Buffer {
  const b = Buffer.alloc(17);
  b[0] = 0;
  b[1] = OP.SessionResponse;
  b.writeUInt32BE(p.connectCode >>> 0, 2);
  b.writeUInt32BE(p.encodeKey >>> 0, 6);
  b[10] = p.crcBytes;
  b[11] = p.encodePasses[0];
  b[12] = p.encodePasses[1];
  b.writeUInt32BE(p.maxPacketSize >>> 0, 13);
  return b;
}

// ── Encoding (CRC, XOR, compression) ──

/** Session request/response and out-of-session packets are never encoded. */
export function packetCanBeEncoded(b: Buffer): boolean {
  if (b.length < 2) return false;
  if (b[0] !== 0) return true;
  const op = b[1];
  return !(op === OP.SessionRequest || op === OP.SessionResponse || op === OP.OutOfSession);
}

/** Header length that encode passes skip: 2 for protocol packets, 1 otherwise. */
function payloadOffset(b: Buffer): number {
  return b[0] === 0 ? 2 : 1;
}

export function xorEncode(b: Buffer, offset: number, key: number): void {
  let k = key | 0;
  const length = b.length - offset;
  let i = 0;
  for (; i + 4 <= length; i += 4) {
    const pt = (b.readInt32LE(offset + i) ^ k) | 0;
    k = pt;
    b.writeInt32LE(pt, offset + i);
  }
  const kc = k & 0xff;
  for (; i < length; i++) b[offset + i] ^= kc;
}

export function xorDecode(b: Buffer, offset: number, key: number): void {
  let k = key | 0;
  const length = b.length - offset;
  let i = 0;
  for (; i + 4 <= length; i += 4) {
    const ct = b.readInt32LE(offset + i);
    const pt = (ct ^ k) | 0;
    k = ct;
    b.writeInt32LE(pt, offset + i);
  }
  const kc = k & 0xff;
  for (; i < length; i++) b[offset + i] ^= kc;
}

/** Outgoing compression pass: the probe always sends the raw (0xa5) form. */
function compressPass(b: Buffer, offset: number): Buffer {
  return Buffer.concat([b.subarray(0, offset), Buffer.from([0xa5]), b.subarray(offset)]);
}

/** Incoming compression pass (Decompress): 0x5a = zlib, 0xa5 = stored. */
export function decompressPass(b: Buffer, offset: number): Buffer {
  if (b.length - offset < 2) return b;
  const flag = b[offset];
  if (flag === 0x5a) {
    const inflated = zlib.inflateSync(b.subarray(offset + 1));
    return Buffer.concat([b.subarray(0, offset), inflated]);
  }
  if (flag === 0xa5) {
    return Buffer.concat([b.subarray(0, offset), b.subarray(offset + 1)]);
  }
  return b;
}

export function appendCrc(b: Buffer, p: Pick<SessionParams, "crcBytes" | "encodeKey">): Buffer {
  if (p.crcBytes === 0) return b;
  const crc = crc32Keyed(b, p.encodeKey);
  if (p.crcBytes === 2) {
    const t = Buffer.alloc(2);
    t.writeUInt16BE(crc & 0xffff, 0);
    return Buffer.concat([b, t]);
  }
  if (p.crcBytes === 4) {
    const t = Buffer.alloc(4);
    t.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([b, t]);
  }
  return b;
}

export function validateCrc(b: Buffer, p: Pick<SessionParams, "crcBytes" | "encodeKey">): boolean {
  if (p.crcBytes === 0) return true;
  if (b.length < p.crcBytes) return false;
  const body = b.subarray(0, b.length - p.crcBytes);
  const crc = crc32Keyed(body, p.encodeKey);
  if (p.crcBytes === 2) return b.readUInt16BE(b.length - 2) === (crc & 0xffff);
  if (p.crcBytes === 4) return b.readUInt32BE(b.length - 4) === crc >>> 0;
  return false;
}

/** Apply encode passes and CRC to an outgoing protocol packet (InternalSend). */
export function encodeOutgoing(packet: Buffer, p: SessionParams): Buffer {
  if (!packetCanBeEncoded(packet)) return packet;
  let out: Buffer = Buffer.from(packet);
  for (const pass of p.encodePasses) {
    if (pass === ENCODE_COMPRESSION) out = compressPass(out, payloadOffset(out));
    else if (pass === ENCODE_XOR) xorEncode(out, payloadOffset(out), p.encodeKey);
  }
  return appendCrc(out, p);
}

/**
 * Validate CRC and undo encode passes on an incoming datagram
 * (ReliableStreamConnection::ProcessPacket). Returns null when the CRC fails.
 */
export function decodeIncoming(raw: Buffer, p: SessionParams): Buffer | null {
  if (!packetCanBeEncoded(raw)) return raw;
  if (!validateCrc(raw, p)) return null;
  let b: Buffer = Buffer.from(raw.subarray(0, raw.length - p.crcBytes));
  for (let i = 1; i >= 0; i--) {
    const pass = p.encodePasses[i];
    if (pass === ENCODE_COMPRESSION) b = decompressPass(b, payloadOffset(b));
    else if (pass === ENCODE_XOR) xorDecode(b, payloadOffset(b), p.encodeKey);
  }
  return b;
}

// ── Packet builders ──

/** An application packet: 2-byte little-endian opcode followed by the payload. */
export function buildAppPacket(opcode: number, payload: Buffer): Buffer {
  const b = Buffer.alloc(2 + payload.length);
  b.writeUInt16LE(opcode & 0xffff, 0);
  payload.copy(b, 2);
  return b;
}

/**
 * The bytes carried inside a reliable packet for an app packet. An app packet
 * whose first byte is zero would read as a protocol opcode, so it is sent
 * behind a 0x00 (OP_Padding) prefix, as ReliableStreamConnection::QueuePacket.
 */
export function wrapAppForStream(app: Buffer): Buffer {
  return app[0] === 0 ? Buffer.concat([Buffer.from([0]), app]) : app;
}

export function buildReliable(stream: number, sequence: number, data: Buffer): Buffer {
  const b = Buffer.alloc(4 + data.length);
  b[0] = 0;
  b[1] = OP.Packet + stream;
  b.writeUInt16BE(sequence & 0xffff, 2);
  data.copy(b, 4);
  return b;
}

/**
 * Split `data` into fragments the way InternalQueuePacket does. Returns the
 * unencoded protocol packets; sequences start at `startSequence`.
 * Returns a single OP_Packet when it fits.
 */
export function buildReliableOrFragments(
  stream: number,
  startSequence: number,
  data: Buffer,
  maxPacketSize: number,
  crcBytes: number
): Buffer[] {
  const maxRaw = maxPacketSize - crcBytes - 4 - 1; // -1 for a compress flag
  if (data.length <= maxRaw) return [buildReliable(stream, startSequence, data)];

  const out: Buffer[] = [];
  let seq = startSequence & 0xffff;
  const firstLen = maxPacketSize - crcBytes - 8 - 1;
  const first = Buffer.alloc(8 + firstLen);
  first[0] = 0;
  first[1] = OP.Fragment + stream;
  first.writeUInt16BE(seq, 2);
  first.writeUInt32BE(data.length, 4);
  data.copy(first, 8, 0, firstLen);
  out.push(first);
  seq = (seq + 1) & 0xffff;
  let used = firstLen;
  while (used < data.length) {
    const chunk = Math.min(maxRaw, data.length - used);
    const f = Buffer.alloc(4 + chunk);
    f[0] = 0;
    f[1] = OP.Fragment + stream;
    f.writeUInt16BE(seq, 2);
    data.copy(f, 4, used, used + chunk);
    out.push(f);
    used += chunk;
    seq = (seq + 1) & 0xffff;
  }
  return out;
}

export function buildAck(stream: number, sequence: number, outOfOrder = false): Buffer {
  const b = Buffer.alloc(4);
  b[0] = 0;
  b[1] = (outOfOrder ? OP.OutOfOrderAck : OP.Ack) + stream;
  b.writeUInt16BE(sequence & 0xffff, 2);
  return b;
}

export function buildDisconnect(connectCode: number): Buffer {
  const b = Buffer.alloc(6);
  b[0] = 0;
  b[1] = OP.SessionDisconnect;
  b.writeUInt32BE(connectCode >>> 0, 2);
  return b;
}

/** OP_Combined: subpackets prefixed with a one-byte length. */
export function buildCombined(packets: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0, OP.Combined])];
  for (const p of packets) {
    if (p.length > 0xff) throw new Error("subpacket too large for OP_Combined");
    parts.push(Buffer.from([p.length]), p);
  }
  return Buffer.concat(parts);
}

// ── Sequencing ──

export type SequenceOrder = "current" | "future" | "past";

export function compareSequence(expected: number, actual: number): SequenceOrder {
  const diff = (actual & 0xffff) - (expected & 0xffff);
  if (diff === 0) return "current";
  if (diff > 0) return diff > 10000 ? "past" : "future";
  return diff < -10000 ? "future" : "past";
}

interface StreamState {
  sequenceIn: number;
  queue: Map<number, Buffer>;
  fragmentTotal: number;
  fragmentParts: Buffer[];
  fragmentCurrent: number;
}

export interface ReceiverEvents {
  /** A complete application packet (opcode + payload). */
  onApp(packet: Buffer): void;
  /** An unencoded protocol packet to send back (acks). */
  onSend(packet: Buffer): void;
  /** The peer acknowledged `sequence` (cumulative unless outOfOrder). */
  onAck?(stream: number, sequence: number, outOfOrder: boolean): void;
  onDisconnect?(): void;
}

/**
 * Receive side of a session: walks decoded packets
 * (ReliableStreamConnection::ProcessDecodedPacket), keeps per-stream sequence
 * state, reorders, reassembles fragments and emits acks.
 */
export class ReliableReceiver {
  private streams: StreamState[] = [0, 1, 2, 3].map(() => ({
    sequenceIn: 0,
    queue: new Map<number, Buffer>(),
    fragmentTotal: 0,
    fragmentParts: [],
    fragmentCurrent: 0,
  }));

  constructor(private readonly ev: ReceiverEvents) {}

  /** Process one decoded datagram, then drain any packets that are now in order. */
  handle(decoded: Buffer): void {
    this.process(decoded);
    this.drainQueues();
  }

  private drainQueues(): void {
    for (const s of this.streams) {
      for (;;) {
        const next = s.queue.get(s.sequenceIn);
        if (!next) break;
        s.queue.delete(s.sequenceIn);
        this.process(next);
      }
    }
  }

  private process(p: Buffer): void {
    if (p.length === 0) return;
    if (p[0] !== 0) {
      this.ev.onApp(p);
      return;
    }
    if (p.length < 2) return;
    const op = p[1];

    switch (true) {
      case op === OP.Combined: {
        let cur = 2;
        while (cur < p.length) {
          const len = p[cur];
          cur += 1;
          if (cur + len > p.length) return;
          this.process(p.subarray(cur, cur + len));
          cur += len;
        }
        return;
      }
      case op === OP.AppCombined: {
        let cur = 2;
        while (cur < p.length) {
          let len: number;
          if (p[cur] === 0xff) {
            if (cur + 3 > p.length) return;
            if (p[cur + 1] === 0xff && p[cur + 2] === 0xff) {
              if (cur + 7 > p.length) return;
              len = p.readUInt32BE(cur + 3);
              cur += 7;
            } else {
              len = p.readUInt16BE(cur + 1);
              cur += 3;
            }
          } else {
            len = p[cur];
            cur += 1;
          }
          if (cur + len > p.length) return;
          this.process(p.subarray(cur, cur + len));
          cur += len;
        }
        return;
      }
      case op >= OP.Packet && op < OP.Packet + 4: {
        if (p.length < 4) return;
        const streamId = op - OP.Packet;
        const s = this.streams[streamId];
        const seq = p.readUInt16BE(2);
        const order = compareSequence(s.sequenceIn, seq);
        if (order === "future") {
          this.ev.onSend(buildAck(streamId, seq, true));
          if (!s.queue.has(seq)) s.queue.set(seq, Buffer.from(p));
        } else if (order === "past") {
          this.ev.onSend(buildAck(streamId, (s.sequenceIn - 1) & 0xffff));
        } else {
          s.queue.delete(seq);
          this.ev.onSend(buildAck(streamId, s.sequenceIn));
          s.sequenceIn = (s.sequenceIn + 1) & 0xffff;
          this.process(p.subarray(4));
        }
        return;
      }
      case op >= OP.Fragment && op < OP.Fragment + 4: {
        if (p.length < 4) return;
        const streamId = op - OP.Fragment;
        const s = this.streams[streamId];
        const seq = p.readUInt16BE(2);
        const order = compareSequence(s.sequenceIn, seq);
        if (order === "future") {
          this.ev.onSend(buildAck(streamId, seq, true));
          if (!s.queue.has(seq)) s.queue.set(seq, Buffer.from(p));
        } else if (order === "past") {
          this.ev.onSend(buildAck(streamId, (s.sequenceIn - 1) & 0xffff));
        } else {
          s.queue.delete(seq);
          this.ev.onSend(buildAck(streamId, s.sequenceIn));
          s.sequenceIn = (s.sequenceIn + 1) & 0xffff;
          if (s.fragmentTotal === 0) {
            if (p.length < 8) return;
            s.fragmentTotal = p.readUInt32BE(4);
            const part = Buffer.from(p.subarray(8));
            s.fragmentParts = [part];
            s.fragmentCurrent = part.length;
          } else {
            const part = Buffer.from(p.subarray(4));
            s.fragmentParts.push(part);
            s.fragmentCurrent += part.length;
          }
          if (s.fragmentTotal > 0 && s.fragmentCurrent >= s.fragmentTotal) {
            const whole = Buffer.concat(s.fragmentParts).subarray(0, s.fragmentTotal);
            s.fragmentTotal = 0;
            s.fragmentParts = [];
            s.fragmentCurrent = 0;
            this.process(whole);
          }
        }
        return;
      }
      case op >= OP.Ack && op < OP.Ack + 4: {
        if (p.length < 4) return;
        this.ev.onAck?.(op - OP.Ack, p.readUInt16BE(2), false);
        return;
      }
      case op >= OP.OutOfOrderAck && op < OP.OutOfOrderAck + 4: {
        if (p.length < 4) return;
        this.ev.onAck?.(op - OP.OutOfOrderAck, p.readUInt16BE(2), true);
        return;
      }
      case op === OP.SessionDisconnect:
        this.ev.onDisconnect?.();
        return;
      case op === OP.Padding:
        this.ev.onApp(p.subarray(1));
        return;
      default:
        // keepalive, session stats, pings: nothing to do for a short probe
        return;
    }
  }
}
