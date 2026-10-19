/**
 * End-to-end probe against a fake world on localhost that speaks the server
 * side of the protocol with the same packet code the server uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "dgram";
import {
  OP,
  ENCODE_NONE,
  ReliableReceiver,
  SessionParams,
  buildAppPacket,
  buildDisconnect,
  buildReliableOrFragments,
  buildSessionResponse,
  decodeIncoming,
  encodeOutgoing,
  wrapAppForStream,
} from "../protocol";
import { getClient, ClientDef } from "../clients";
import { probeWorldClient } from "../session";

type Behavior = "supported" | "blocked" | "unrecognized" | "badkey";

interface FakeWorld {
  port: number;
  loginPayloads: Buffer[];
  disconnects: number;
  close(): void;
}

function startFakeWorld(client: ClientDef, behavior: Behavior, expectedKey: string): Promise<FakeWorld> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const world: FakeWorld = { port: 0, loginPayloads: [], disconnects: 0, close: () => sock.close() };
    let params: SessionParams | null = null;
    let seqOut = 0;
    let peer: { address: string; port: number } | null = null;

    const send = (p: Buffer) => {
      if (!peer || !params) return;
      sock.send(encodeOutgoing(p, params), peer.port, peer.address);
    };
    const sendApp = (opcode: number, payload: Buffer) => {
      for (const p of buildReliableOrFragments(0, seqOut, wrapAppForStream(buildAppPacket(opcode, payload)), params!.maxPacketSize, params!.crcBytes)) {
        seqOut = (seqOut + 1) & 0xffff;
        send(p);
      }
    };

    const receiver = new ReliableReceiver({
      onSend: send,
      onDisconnect: () => { world.disconnects++; },
      onApp: (app) => {
        const opcode = app.readUInt16LE(0);
        const body = app.subarray(2);
        if (opcode !== client.opcodes.sendLoginInfo || body.length !== client.loginInfoSize) {
          return; // unidentified stream: released silently
        }
        world.loginPayloads.push(Buffer.from(body));
        if (behavior === "unrecognized") return;
        const text = body.toString("latin1", 0, 64);
        const key = text.split("\0")[1];
        if (behavior === "badkey" || key !== expectedKey) {
          send(buildDisconnect(params!.connectCode));
          return;
        }
        const op = client.opcodes;
        for (const o of [op.guildsList, op.logServer, op.approveWorld, op.enterWorld, op.postEnterWorld]) {
          if (o) sendApp(o, Buffer.alloc(8));
        }
        if (behavior === "blocked") {
          const entry = Buffer.alloc(600);
          entry.write("Client Not In Supported List [Titanium]", 8, "latin1");
          sendApp(op.sendCharInfo, entry);
          return;
        }
        sendApp(op.expansionInfo, Buffer.alloc(4));
        sendApp(op.sendCharInfo, Buffer.alloc(3000, 0x20)); // fragmented
      },
    });

    sock.on("message", (msg, rinfo) => {
      if (msg[0] === 0 && msg[1] === OP.SessionRequest) {
        peer = { address: rinfo.address, port: rinfo.port };
        params = {
          connectCode: msg.readUInt32BE(6),
          encodeKey: 0x5eed1234,
          crcBytes: 2,
          encodePasses: [ENCODE_NONE, ENCODE_NONE],
          maxPacketSize: Math.min(512, msg.readUInt32BE(10)),
        };
        sock.send(buildSessionResponse(params), rinfo.port, rinfo.address);
        return;
      }
      if (!params) return;
      const decoded = decodeIncoming(msg, params);
      if (decoded) receiver.handle(decoded);
    });
    sock.bind(0, "127.0.0.1", () => {
      world.port = (sock.address() as { port: number }).port;
      resolve(world);
    });
  });
}

const KEY = "ABCDEFGH12";

test("supported client reaches character select (fragmented char info)", async () => {
  const client = getClient("rof2")!;
  const world = await startFakeWorld(client, "supported", KEY);
  const r = await probeWorldClient({ host: "127.0.0.1", port: world.port, client, loginserverAccountId: 42, key: KEY, replyTimeoutMs: 3000 });
  await new Promise((res) => setTimeout(res, 100));
  world.close();
  assert.equal(r.status, "supported", r.detail);
  assert.equal(world.loginPayloads.length, 1);
  assert.equal(world.loginPayloads[0].toString("latin1", 0, 14), "42\0ABCDEFGH12\0");
  assert.ok(world.disconnects >= 1, "probe sends a session disconnect");
});

test("blocked client is reported as blocked", async () => {
  const client = getClient("titanium")!;
  const world = await startFakeWorld(client, "blocked", KEY);
  const r = await probeWorldClient({ host: "127.0.0.1", port: world.port, client, loginserverAccountId: 42, key: KEY, replyTimeoutMs: 3000 });
  world.close();
  assert.equal(r.status, "blocked", r.detail);
});

test("unrecognized client is reported as unsupported", async () => {
  const client = getClient("tob")!;
  const world = await startFakeWorld(client, "unrecognized", KEY);
  const r = await probeWorldClient({ host: "127.0.0.1", port: world.port, client, loginserverAccountId: 42, key: KEY, replyTimeoutMs: 1500 });
  world.close();
  assert.equal(r.status, "unsupported", r.detail);
  assert.equal(r.observation.loginAcked, true);
});

test("rejected session key is an error", async () => {
  const client = getClient("uf")!;
  const world = await startFakeWorld(client, "badkey", KEY);
  const r = await probeWorldClient({ host: "127.0.0.1", port: world.port, client, loginserverAccountId: 42, key: KEY, replyTimeoutMs: 3000 });
  world.close();
  assert.equal(r.status, "error");
  assert.equal(r.observation.disconnectedByServer, true);
});

test("silent host is unreachable", async () => {
  const sock = dgram.createSocket("udp4");
  await new Promise<void>((res) => sock.bind(0, "127.0.0.1", () => res()));
  const port = (sock.address() as { port: number }).port;
  const r = await probeWorldClient({ host: "127.0.0.1", port, client: getClient("sod")!, loginserverAccountId: 42, key: KEY, connectTimeoutMs: 1200 });
  sock.close();
  assert.equal(r.status, "unreachable");
});

