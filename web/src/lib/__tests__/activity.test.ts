// Activity bands. Run with `npm test`.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { activityFor, activityFromLevel, activityLevel, parseThresholds, publicStatus, DEFAULT_THRESHOLDS } from "../activity";

test("default bands: idle 0, low 1-74, medium 75-250, high 251+", () => {
  assert.equal(activityFor(0), "idle");
  assert.equal(activityFor(undefined), "idle");
  assert.equal(activityFor(-3), "idle");
  assert.equal(activityFor(1), "low");
  assert.equal(activityFor(74), "low");
  assert.equal(activityFor(75), "medium");
  assert.equal(activityFor(250), "medium");
  assert.equal(activityFor(251), "high");
});

test("levels round-trip and clamp", () => {
  assert.equal(activityLevel("idle"), 0);
  assert.equal(activityLevel("high"), 3);
  assert.equal(activityFromLevel(2), "medium");
  assert.equal(activityFromLevel(9), "high");
  assert.equal(activityFromLevel(-1), "idle");
});

test("parseThresholds falls back on bad config", () => {
  assert.deepEqual(parseThresholds("50", "300"), { mediumMin: 50, highMin: 300 });
  assert.deepEqual(parseThresholds(undefined, undefined), DEFAULT_THRESHOLDS);
  assert.deepEqual(parseThresholds("abc", "0"), DEFAULT_THRESHOLDS);
  // high must be above medium
  assert.deepEqual(parseThresholds("300", "100"), { mediumMin: 300, highMin: 301 });
});

test("publicStatus hides the player count a world reports as its status", () => {
  assert.equal(publicStatus(447), 0);
  assert.equal(publicStatus(0), 0);
  assert.equal(publicStatus(-1), -1);
  assert.equal(publicStatus(-2), -2);
  assert.equal(publicStatus(-7), -1);
  assert.equal(publicStatus(undefined), -1);
});
