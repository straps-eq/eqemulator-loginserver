// Server directory client filter and sort. Run with `npm test`.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseClientFilter,
  parseSort,
  filterByClient,
  isUnchecked,
  clientChips,
  directoryHref,
  byName,
  byPlayers,
  type FilterableServer,
} from "../server-filters";

const servers: FilterableServer[] = [
  { server_long_name: "Bristlebane", players_online: 12, client_support: { supported: ["rof2", "tob"], unreachable: false } },
  { server_long_name: "akanon", players_online: 40, client_support: { supported: ["titanium", "rof2"], unreachable: false } },
  { server_long_name: "Cazic", players_online: 3, client_support: null },
  { server_long_name: "Druzzil", players_online: 0, client_support: { supported: [], unreachable: true } },
  { server_long_name: "Erollisi", client_support: { supported: ["uf"], unreachable: false } },
];

test("parseClientFilter accepts known ids only", () => {
  assert.equal(parseClientFilter("tob"), "tob");
  assert.equal(parseClientFilter("ToB"), "tob");
  assert.equal(parseClientFilter("live"), null);
  assert.equal(parseClientFilter(undefined), null);
  assert.equal(parseClientFilter(["tob"]), null);
});

test("parseSort defaults to players", () => {
  assert.equal(parseSort("name"), "name");
  assert.equal(parseSort("players"), "players");
  assert.equal(parseSort("zones"), "players");
  assert.equal(parseSort(undefined), "players");
});

test("filterByClient keeps everything under All and drops unchecked worlds otherwise", () => {
  assert.equal(filterByClient(servers, null).length, 5);
  assert.deepEqual(filterByClient(servers, "tob").map((s) => s.server_long_name), ["Bristlebane"]);
  assert.deepEqual(filterByClient(servers, "rof2").map((s) => s.server_long_name), ["Bristlebane", "akanon"]);
});

test("isUnchecked covers no result and unreachable-with-nothing", () => {
  assert.deepEqual(servers.filter(isUnchecked).map((s) => s.server_long_name), ["Cazic", "Druzzil"]);
});

test("clientChips shows the primary clients plus others that some world supports", () => {
  assert.deepEqual(clientChips(servers, null), [
    { id: "titanium", count: 1 },
    { id: "uf", count: 1 },
    { id: "rof2", count: 2 },
    { id: "tob", count: 1 },
  ]);
  assert.ok(clientChips(servers, "sof").some((c) => c.id === "sof"));
});

test("directoryHref leaves defaults out", () => {
  assert.equal(directoryHref(null, "players"), "/servers");
  assert.equal(directoryHref("tob", "players"), "/servers?client=tob");
  assert.equal(directoryHref("tob", "name"), "/servers?client=tob&sort=name");
  assert.equal(directoryHref(null, "name"), "/servers?sort=name");
});

test("sorts", () => {
  assert.deepEqual([...servers].sort(byName).map((s) => s.server_long_name), ["akanon", "Bristlebane", "Cazic", "Druzzil", "Erollisi"]);
  assert.equal([...servers].sort(byPlayers)[0].server_long_name, "akanon");
});
