// Session identity check after a platform account relocation. Run with `npm test`.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createIdentityChecker } from "../session-identity";

test("a cookie whose id now names another account no longer matches", async () => {
  const users = new Map<number, string>([[5, "masteruser"], [100000, "localuser"]]);
  const check = createIdentityChecker(async (id) => users.get(id) ?? null);
  assert.equal(await check(5, "masteruser"), true);
  assert.equal(await check(5, "localuser"), false); // old cookie of the relocated account
  assert.equal(await check(100000, "localuser"), true);
});

test("missing row or DB error keeps the session", async () => {
  const missing = createIdentityChecker(async () => null);
  assert.equal(await missing(7, "anyone"), true);
  const broken = createIdentityChecker(async () => { throw new Error("db down"); });
  assert.equal(await broken(7, "anyone"), true);
});

test("lookups are cached for the TTL, errors are not", async () => {
  let t = 0;
  let calls = 0;
  let name = "alice";
  let fail = false;
  const check = createIdentityChecker(async () => {
    calls++;
    if (fail) throw new Error("x");
    return name;
  }, 30_000, () => t);
  assert.equal(await check(1, "alice"), true);
  name = "bob";
  t = 29_999;
  assert.equal(await check(1, "alice"), true);
  assert.equal(calls, 1);
  t = 30_000;
  assert.equal(await check(1, "alice"), false);
  assert.equal(calls, 2);
  fail = true;
  t = 60_000;
  assert.equal(await check(1, "alice"), true);
  assert.equal(await check(1, "alice"), true);
  assert.equal(calls, 4);
});
