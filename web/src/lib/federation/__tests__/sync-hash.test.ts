// Conditional sync_data: condition parsing, the unchanged decision, and the
// signed "unchanged" answer. Run with `npm test`.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  computeStableHash,
  computeVolatileHash,
  parseSyncCondition,
  isUnchanged,
  unchangedSignatureMessage,
  SyncCollections,
} from "../sync-hash";
import { generateKeyPair, signMessage, verifyMessage } from "../crypto";

const H1 = "0123456789abcdef0123456789abcdef";
const H2 = "fedcba9876543210fedcba9876543210";
const NONCE = "00112233445566778899aabbccddeeff";

test("no or malformed condition means full payload", () => {
  assert.equal(parseSyncCondition(new URLSearchParams("")), null);
  assert.equal(parseSyncCondition(new URLSearchParams({ if_stable: H1 })), null);
  assert.equal(parseSyncCondition(new URLSearchParams({ if_stable: "xyz", nonce: NONCE })), null);
  assert.equal(parseSyncCondition(new URLSearchParams({ if_stable: H1, nonce: NONCE, if_volatile: "bad" })), null);
  assert.equal(isUnchanged(null, H1, H2), false);
});

test("unchanged only when every sent hash matches", () => {
  const stableOnly = parseSyncCondition(new URLSearchParams({ if_stable: H1, nonce: NONCE }));
  assert.deepEqual(stableOnly, { stable: H1, volatile: null, nonce: NONCE });
  assert.equal(isUnchanged(stableOnly, H1, H2), true);
  assert.equal(isUnchanged(stableOnly, H2, H2), false);

  const both = parseSyncCondition(new URLSearchParams({ if_stable: H1, if_volatile: H2, nonce: NONCE }));
  assert.equal(isUnchanged(both, H1, H2), true);
  assert.equal(isUnchanged(both, H1, H1), false);
});

test("hashes react to credential changes, not just logins", () => {
  const base: any = { accounts: [{ id: 1, account_name: "a", account_password: "$7$x", last_login_date: "2026-01-01" }] };
  const login = { accounts: [{ ...base.accounts[0], last_login_date: "2026-02-01" }] };
  const pw = { accounts: [{ ...base.accounts[0], account_password: "$7$y" }] };
  assert.equal(computeStableHash(base as SyncCollections), computeStableHash(login as SyncCollections));
  assert.notEqual(computeVolatileHash(base as SyncCollections), computeVolatileHash(login as SyncCollections));
  assert.notEqual(computeStableHash(base as SyncCollections), computeStableHash(pw as SyncCollections));
});

test("signed unchanged answer verifies only for the same nonce, requester and body", async () => {
  const exporter = await generateKeyPair();
  const puller = await generateKeyPair();
  const other = await generateKeyPair();
  const payload = {
    node_id: 1, unchanged: true, stable_hash: H1, volatile_hash: H2,
    live_servers: [{ server_short_name: "x", players_online: 3 }], timestamp: 1,
  };
  const sig = await signMessage(exporter.privateKey, unchangedSignatureMessage(NONCE, puller.publicKey, JSON.stringify(payload)));

  // Puller side: what it sees after JSON round-trip, minus the signature.
  const { signature, ...rest } = JSON.parse(JSON.stringify({ ...payload, signature: sig }));
  const ok = (nonce: string, who: string, body: object, key: string = exporter.publicKey) =>
    verifyMessage(key, signature, unchangedSignatureMessage(nonce, who, JSON.stringify(body)));

  assert.equal(await ok(NONCE, puller.publicKey, rest), true);
  assert.equal(await ok(H1, puller.publicKey, rest), false);
  assert.equal(await ok(NONCE, other.publicKey, rest), false);
  assert.equal(await ok(NONCE, puller.publicKey, { ...rest, stable_hash: H2 }), false);
  assert.equal(await ok(NONCE, puller.publicKey, rest, other.publicKey), false);
  assert.equal(await verifyMessage(exporter.publicKey, "zz", "x"), false);
});
