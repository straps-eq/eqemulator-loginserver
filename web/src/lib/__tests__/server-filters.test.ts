// Server directory client filter and order. Run with `npm test`.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseClientFilter,
  filterByClient,
  isUnchecked,
  clientChips,
  directoryHref,
  byName,
  byListing,
  isTestServer,
  type FilterableServer,
} from "../server-filters";

const servers: FilterableServer[] = [
  { server_long_name: "Bristlebane", client_support: { supported: ["rof2", "tob"], unreachable: false } },
  { server_long_name: "akanon", client_support: { supported: ["titanium", "rof2"], unreachable: false } },
  { server_long_name: "Cazic", client_support: null },
  { server_long_name: "Druzzil", client_support: { supported: [], unreachable: true } },
  { server_long_name: "Erollisi", client_support: { supported: ["uf"], unreachable: false } },
];

test("parseClientFilter accepts known ids only", () => {
  assert.equal(parseClientFilter("tob"), "tob");
  assert.equal(parseClientFilter("ToB"), "tob");
  assert.equal(parseClientFilter("live"), null);
  assert.equal(parseClientFilter(undefined), null);
  assert.equal(parseClientFilter(["tob"]), null);
});

test("filterByClient keeps everything under All and drops unchecked worlds otherwise", () => {
  assert.equal(filterByClient(servers, null).length, 5);
  assert.deepEqual(filterByClient(servers, "tob").map((s) => s.server_long_name), ["Bristlebane"]);
  assert.deepEqual(filterByClient(servers, "rof2").map((s) => s.server_long_name), ["Bristlebane", "akanon"]);
});

test("isUnchecked covers no result and unreachable-with-nothing", () => {
  assert.deepEqual(servers.filter(isUnchecked).map((s) => s.server_long_name), ["Cazic", "Druzzil"]);
});

test("clientChips shows only Titanium, RoF2, ToB and EQL", () => {
  assert.deepEqual(clientChips(servers, null), [
    { id: "titanium", count: 1 },
    { id: "rof2", count: 2 },
    { id: "tob", count: 1 },
    { id: "eql", count: 0 },
  ]);
});

test("EQL filter keeps only worlds the probe found EQL-capable", () => {
  const withEql: FilterableServer[] = [
    ...servers,
    { server_long_name: "Firiona", client_support: { supported: ["tob", "eql"], unreachable: false } },
  ];
  assert.equal(parseClientFilter("EQL"), "eql");
  assert.deepEqual(filterByClient(withEql, "eql").map((s) => s.server_long_name), ["Firiona"]);
});

test("directoryHref", () => {
  assert.equal(directoryHref(null), "/servers");
  assert.equal(directoryHref("tob"), "/servers?client=tob");
});

test("sorts", () => {
  assert.deepEqual([...servers].sort(byName).map((s) => s.server_long_name), ["akanon", "Bristlebane", "Cazic", "Druzzil", "Erollisi"]);
});

test("listing order: active A-Z, then idle/offline, then test/dev", () => {
  const w = (server_long_name: string, activity: string, server_status = 1, is_offline = false) =>
    ({ server_long_name, activity, server_status, is_offline, client_support: null });
  const list = [
    w("Zebra", "low"),
    w("Quiet Realm", "idle"),
    w("|T| Busy Test", "high"),
    w("Alpha", "medium"),
    w("Gone", "idle", -1, true),
    w("Locked Up", "low", -2),
    w("Beta", "idle"),
  ];
  assert.deepEqual(list.sort(byListing).map((s) => s.server_long_name), [
    "Alpha", "Zebra", "Beta", "Gone", "Locked Up", "Quiet Realm", "|T| Busy Test",
  ]);
});

test("name sort puts test and dev worlds last", () => {
  const named = ["|T| Ascendant Test", "Zebra", "Clumsy's World [Test]", "Alpha", "Just dev things", "Devious Realm"]
    .map((server_long_name) => ({ server_long_name, client_support: null }));
  assert.deepEqual(named.sort(byName).map((s) => s.server_long_name), [
    "Alpha", "Devious Realm", "Zebra", "|T| Ascendant Test", "Clumsy's World [Test]", "Just dev things",
  ]);
  assert.ok(isTestServer("[Dev] Somewhere"));
  assert.ok(!isTestServer("Project Lazarus"));
});
