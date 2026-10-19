import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "zlib";
import { crc32, crc32Keyed } from "../crc";
import {
  OP,
  ENCODE_COMPRESSION,
  ENCODE_NONE,
  ENCODE_XOR,
  ReliableReceiver,
  SessionParams,
  buildAck,
  buildAppPacket,
  buildCombined,
  buildDisconnect,
  buildReliable,
  buildReliableOrFragments,
  buildSessionRequest,
  buildSessionResponse,
  compareSequence,
  decodeIncoming,
  decompressPass,
  encodeOutgoing,
  parseSessionResponse,
  wrapAppForStream,
  xorDecode,
  xorEncode,
} from "../protocol";
import { CLIENTS, LOGIN_INFO_SIZE, encodeLoginInfo, getClient } from "../clients";
import { classifyProbe, ProbeObservation } from "../classify";

const session = (over: Partial<SessionParams> = {}): SessionParams => ({
  connectCode: 0x01020304,
  encodeKey: 0xdeadbeef,
  crcBytes: 2,
  encodePasses: [ENCODE_NONE, ENCODE_NONE],
  maxPacketSize: 512,
  ...over,
});

function collect() {
  const app: Buffer[] = [];
  const sent: Buffer[] = [];
  const acks: Array<[number, number, boolean]> = [];
  let disconnected = false;
  const r = new ReliableReceiver({
    onApp: (p) => app.push(Buffer.from(p)),
    onSend: (p) => sent.push(Buffer.from(p)),
    onAck: (s, q, o) => acks.push([s, q, o]),
    onDisconnect: () => { disconnected = true; },
  });
  return { r, app, sent, acks, isDisconnected: () => disconnected };
}

// Reference values computed with the server's own common/net/crc32.cpp and
// ReliableStreamConnection::Encode.
test("crc32 matches the server implementation", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const d = Buffer.from([0x00, 0x09, 0x00, 0x00, 0xd0, 0x4d, 0x31, 0x32, 0x33]);
  assert.equal(crc32Keyed(d, 0x12345678), 0x0fe0219e);
  assert.equal(crc32Keyed(d, 0xdeadbeef), 0xe8bef0e3);
});

test("xor encode matches the server and decodes back", () => {
  const b = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  xorEncode(b, 0, 0xdeadbeef);
  assert.equal(b.toString("hex"), "eebcaedaebbaa9d2e2e1e0");
  xorDecode(b, 0, 0xdeadbeef);
  assert.deepEqual(Array.from(b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("session request and response layout", () => {
  const req = buildSessionRequest(0xa1b2c3d4, 512);
  assert.equal(req.toString("hex"), "0001" + "00000003" + "a1b2c3d4" + "00000200");
  const resp = buildSessionResponse(session({ connectCode: 0xa1b2c3d4, encodeKey: 0x11223344 }));
  assert.equal(resp.length, 17);
  assert.equal(resp.toString("hex"), "0002" + "a1b2c3d4" + "11223344" + "02" + "00" + "00" + "00000200");
  const parsed = parseSessionResponse(resp)!;
  assert.equal(parsed.connectCode, 0xa1b2c3d4);
  assert.equal(parsed.encodeKey, 0x11223344);
  assert.equal(parsed.crcBytes, 2);
  assert.equal(parsed.maxPacketSize, 512);
  assert.equal(parseSessionResponse(req), null);
});

test("outgoing packets carry a big-endian CRC over the encoded bytes", () => {
  const s = session();
  const p = buildReliable(0, 0, buildAppPacket(0x4dd0, Buffer.from("123")));
  const out = encodeOutgoing(p, s);
  assert.equal(out.length, p.length + 2);
  assert.equal(out.readUInt16BE(out.length - 2), crc32Keyed(p, s.encodeKey) & 0xffff);
  assert.deepEqual(decodeIncoming(out, s), p);
  const bad = Buffer.from(out);
  bad[4] ^= 0xff;
  assert.equal(decodeIncoming(bad, s), null);
  // handshake packets are never encoded
  const req = buildSessionRequest(1);
  assert.deepEqual(encodeOutgoing(req, s), req);
});

test("compression and xor passes round-trip", () => {
  const s = session({ encodePasses: [ENCODE_COMPRESSION, ENCODE_XOR] });
  const p = buildReliable(0, 7, Buffer.alloc(300, 0x41));
  assert.deepEqual(decodeIncoming(encodeOutgoing(p, s), s), p);
  const app = buildAppPacket(0x1234, Buffer.from("hello world"));
  assert.deepEqual(decodeIncoming(encodeOutgoing(app, s), s), app);
});

test("zlib-compressed (0x5a) packets are inflated", () => {
  const body = Buffer.concat([Buffer.from([0, OP.Packet, 0, 0]), Buffer.alloc(200, 7)]);
  const deflated = zlib.deflateSync(body.subarray(2));
  const wire = Buffer.concat([body.subarray(0, 2), Buffer.from([0x5a]), deflated]);
  assert.deepEqual(decompressPass(wire, 2), body);
});

test("sequence comparison wraps around", () => {
  assert.equal(compareSequence(5, 5), "current");
  assert.equal(compareSequence(5, 6), "future");
  assert.equal(compareSequence(5, 4), "past");
  assert.equal(compareSequence(65535, 0), "future");
  assert.equal(compareSequence(0, 65535), "past");
});

test("reliable packets are delivered in order and acked", () => {
  const c = collect();
  c.r.handle(buildReliable(0, 0, buildAppPacket(0x1111, Buffer.from("a"))));
  assert.equal(c.app.length, 1);
  assert.equal(c.app[0].readUInt16LE(0), 0x1111);
  assert.deepEqual(c.sent[0], buildAck(0, 0));

  // seq 2 arrives before seq 1
  c.r.handle(buildReliable(0, 2, buildAppPacket(0x3333, Buffer.from("c"))));
  assert.equal(c.app.length, 1);
  assert.deepEqual(c.sent[1], buildAck(0, 2, true));
  c.r.handle(buildReliable(0, 1, buildAppPacket(0x2222, Buffer.from("b"))));
  assert.deepEqual(c.app.map((p) => p.readUInt16LE(0)), [0x1111, 0x2222, 0x3333]);

  // a resent old packet is acked with the latest in-order sequence, not redelivered
  const before = c.app.length;
  c.r.handle(buildReliable(0, 0, buildAppPacket(0x1111, Buffer.from("a"))));
  assert.equal(c.app.length, before);
  assert.deepEqual(c.sent[c.sent.length - 1], buildAck(0, 2));
});

test("fragments reassemble, also out of order", () => {
  const payload = Buffer.alloc(2000);
  for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
  const app = buildAppPacket(0x00d2, payload); // first byte 0xd2
  const frags = buildReliableOrFragments(0, 0, wrapAppForStream(app), 512, 2);
  assert.ok(frags.length > 3);
  assert.equal(frags[0][1], OP.Fragment);
  assert.equal(frags[0].readUInt32BE(4), app.length);
  for (const f of frags) assert.ok(f.length + 2 + 1 <= 512);

  const c = collect();
  const order = [2, 0, 3, 1, ...frags.slice(4).map((_, i) => i + 4)];
  for (const i of order) c.r.handle(frags[i]);
  assert.equal(c.app.length, 1);
  assert.deepEqual(c.app[0], app);
});

test("app packets with a zero first byte travel behind OP_Padding", () => {
  const app = buildAppPacket(0x4200, Buffer.from("xyz")); // UF OP_SendCharInfo: low byte 0
  const wrapped = wrapAppForStream(app);
  assert.equal(wrapped[0], 0);
  assert.equal(wrapped.length, app.length + 1);
  const c = collect();
  c.r.handle(buildReliable(0, 0, wrapped));
  assert.deepEqual(c.app[0], app);
});

test("combined and app-combined packets are unpacked", () => {
  const c = collect();
  const a = buildReliable(0, 0, buildAppPacket(0x1111, Buffer.from("a")));
  const b = buildReliable(0, 1, buildAppPacket(0x2222, Buffer.from("b")));
  c.r.handle(buildCombined([a, b, buildAck(0, 9)]));
  assert.deepEqual(c.app.map((p) => p.readUInt16LE(0)), [0x1111, 0x2222]);
  assert.deepEqual(c.acks, [[0, 9, false]]);

  const big = buildAppPacket(0x3333, Buffer.alloc(300, 1));
  const small = buildAppPacket(0x4444, Buffer.from("s"));
  const len = Buffer.from([0xff, (big.length >> 8) & 0xff, big.length & 0xff]);
  const appCombined = Buffer.concat([Buffer.from([0, OP.AppCombined]), len, big, Buffer.from([small.length]), small]);
  c.r.handle(buildReliable(0, 2, appCombined));
  assert.deepEqual(c.app.slice(2).map((p) => p.readUInt16LE(0)), [0x3333, 0x4444]);
});

test("session disconnect is reported", () => {
  const c = collect();
  c.r.handle(buildDisconnect(1234));
  assert.equal(c.isDisconnected(), true);
});

test("LoginInfo encodes account id and key for every client", () => {
  for (const client of CLIENTS) {
    const b = encodeLoginInfo(client, 123456, "ABCDE12345");
    assert.equal(b.length, LOGIN_INFO_SIZE);
    assert.equal(b.toString("latin1", 0, 18), "123456\0ABCDE12345\0");
    assert.equal(b[188], 0);
    assert.ok(b.subarray(18).every((x) => x === 0));
  }
  assert.equal(encodeLoginInfo(CLIENTS[0], 1, "K", true)[188], 1);
  assert.throws(() => encodeLoginInfo(CLIENTS[0], 0, "ABC"));
  assert.throws(() => encodeLoginInfo(CLIENTS[0], 1, "bad key!"));
});

test("each client has a distinct login opcode", () => {
  const ops = CLIENTS.map((c) => c.opcodes.sendLoginInfo);
  assert.equal(new Set(ops).size, ops.length);
  assert.equal(getClient("rof2")!.opcodes.sendLoginInfo, 0x7a09);
  assert.equal(getClient("tob")!.opcodes.sendLoginInfo, 0x722a);
});

test("classification", () => {
  const rof2 = getClient("rof2")!;
  const op = rof2.opcodes;
  const base: ProbeObservation = { sessionEstablished: true, loginAcked: true, appOpcodes: [], disconnectedByServer: false };

  assert.equal(classifyProbe(rof2, { ...base, sessionEstablished: false }).status, "unreachable");
  assert.equal(classifyProbe(rof2, base).status, "unsupported");
  assert.equal(classifyProbe(rof2, { ...base, loginAcked: false }).status, "error");
  assert.equal(classifyProbe(rof2, { ...base, disconnectedByServer: true }).status, "error");

  const handshake = [op.guildsList, op.logServer, op.approveWorld, op.enterWorld, op.postEnterWorld];
  assert.equal(
    classifyProbe(rof2, { ...base, appOpcodes: [...handshake, op.expansionInfo, op.sendCharInfo], charInfoPayload: Buffer.from("x") }).status,
    "supported"
  );
  const blocked = classifyProbe(rof2, {
    ...base,
    appOpcodes: [...handshake, op.sendCharInfo],
    charInfoPayload: Buffer.from("\x01\0\0\0Client Not In Supported List [RoF2,TOB]\0"),
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.detail, /SupportedClients/);
  assert.equal(
    classifyProbe(rof2, { ...base, appOpcodes: [...handshake, op.sendCharInfo], charInfoPayload: Buffer.from("Missing Files [http://x]") }).status,
    "blocked"
  );
  assert.equal(classifyProbe(rof2, { ...base, appOpcodes: handshake }).status, "error");
});
