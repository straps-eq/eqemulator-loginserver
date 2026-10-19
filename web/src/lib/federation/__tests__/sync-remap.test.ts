// Peer-side id translation in applyFullDataSync. Run with `npm test`.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildAdminIdMap, remapAdminId, pickServerWinners, isForeignOwner } from "../sync-remap";
import { computeStableCollectionHashes } from "../sync-hash";

test("admin ids are translated through the rows applied in the same sync", () => {
  const map = buildAdminIdMap([
    { sourceId: 40, localId: 3 },
    { sourceId: "41", localId: 7 },
    { sourceId: undefined, localId: 9 }, // old exporter without ids: no mapping
    { sourceId: 0, localId: 11 },
  ]);
  assert.equal(map.size, 2);
  assert.equal(remapAdminId(map, 40), 3);
  assert.equal(remapAdminId(map, "41"), 7);
});

test("no admin stays 0, an unknown admin is null (leave the column alone)", () => {
  const map = buildAdminIdMap([{ sourceId: 40, localId: 3 }]);
  assert.equal(remapAdminId(map, 0), 0);
  assert.equal(remapAdminId(map, null), 0);
  assert.equal(remapAdminId(map, undefined), 0);
  assert.equal(remapAdminId(map, 99), null);
  // The source's id is never passed through, even if it happens to exist locally
  assert.equal(remapAdminId(map, 3), null);
});

test("duplicate servers on the source: the lowest id wins regardless of order", () => {
  const rows = [
    { id: 12, short_name: "ascendanttest" },
    { id: 4, short_name: "tharron" },
    { id: 3, short_name: "ascendanttest" },
    { id: 9, short_name: "solo" },
    { id: 2, short_name: "tharron" },
    { id: 30, short_name: "ascendanttest" },
    { short_name: "" },
  ];
  const { winners, skipped } = pickServerWinners(rows);
  assert.deepEqual(winners.map((r) => r.id), [3, 9, 2, undefined]);
  assert.deepEqual(skipped.map((r) => r.id).sort((a, b) => a! - b!), [4, 12, 30]);
  const reversed = pickServerWinners([...rows].reverse());
  assert.deepEqual(reversed.winners.map((r) => r.id).filter(Boolean).sort(), [2, 3, 9]);
});

test("a local row is foreign only when it belongs to another owner", () => {
  assert.equal(isForeignOwner(100000, 5), true);
  assert.equal(isForeignOwner(5, 5), false);
  assert.equal(isForeignOwner("5", 5), false);
});

test("per-collection hashes point at the collection that changed", () => {
  const a = computeStableCollectionHashes({ servers: [{ id: 1, short_name: "x" }], accounts: [{ id: 1, last_login_date: "a" }] });
  const b = computeStableCollectionHashes({ servers: [{ id: 2, short_name: "x" }], accounts: [{ id: 1, last_login_date: "b" }] });
  const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
  assert.deepEqual(changed, ["servers"]);
});
