import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerFlags, bannerModel, newRedFlags } from "../js/lib/banner.js";

const flag = (id, level, raisedAtMillis, extra = {}) => ({
  id,
  patientId: "p1",
  level,
  kind: level === "red" ? "sleep_collapse" : "drift",
  reason: `Reason ${id}.`,
  raisedAtMillis,
  clearedAtMillis: null,
  ...extra,
});

// ---- bannerFlags -------------------------------------------------------------------------------

test("bannerExcludesAmberAndCleared: only uncleared red flags reach the banner", () => {
  const flags = [
    flag("red-open", "red", 1_000),
    flag("amber-open", "amber", 2_000),
    flag("red-cleared", "red", 3_000, { clearedAtMillis: 4_000 }),
    flag("green", "green", 5_000),
  ];
  assert.deepEqual(bannerFlags(flags).map((f) => f.id), ["red-open"]);
});

test("banner flags are newest first", () => {
  const flags = [flag("old", "red", 1_000), flag("new", "red", 3_000), flag("mid", "red", 2_000)];
  assert.deepEqual(bannerFlags(flags).map((f) => f.id), ["new", "mid", "old"]);
});

test("a flag missing its cleared time counts as open", () => {
  const { clearedAtMillis, ...noCleared } = flag("r", "red", 1_000);
  assert.equal(clearedAtMillis, null);
  assert.deepEqual(bannerFlags([noCleared]).map((f) => f.id), ["r"]);
});

// ---- bannerModel -------------------------------------------------------------------------------

const names = { p1: "Aino", p2: "Sara" };

test("no open red flag gives no banner", () => {
  assert.equal(bannerModel([flag("a", "amber", 1_000)], names), null);
  assert.equal(bannerModel([], names), null);
});

test("one red flag: the Patient, one concise reason and a Review Patient link", () => {
  const model = bannerModel([flag("r", "red", 1_000, { reason: "Slept under 3 hours last night." })], names);
  assert.equal(model?.count, 1);
  assert.equal(model?.heading, "Red flag: Aino");
  assert.deepEqual(model?.items, [
    {
      patientId: "p1",
      displayName: "Aino",
      reason: "Slept under 3 hours last night.",
      more: 0,
      href: "#/patient/p1",
      raisedAtMillis: 1_000,
    },
  ]);
});

test("several reds show a count, one entry per Patient with that Patient's newest reason", () => {
  const model = bannerModel(
    [
      flag("a", "red", 1_000, { reason: "Older reason." }),
      flag("b", "red", 3_000, { reason: "Newest reason for Aino." }),
      flag("c", "red", 2_000, { patientId: "p2", reason: "Sara's reason." }),
    ],
    names,
  );
  assert.equal(model?.count, 3);
  assert.equal(model?.heading, "3 red flags across 2 Patients");
  assert.deepEqual(
    model?.items.map((i) => [i.patientId, i.reason, i.more]),
    [
      ["p1", "Newest reason for Aino.", 1],
      ["p2", "Sara's reason.", 0],
    ],
  );
});

test("two reds on one Patient say so", () => {
  const model = bannerModel([flag("a", "red", 1_000), flag("b", "red", 2_000)], names);
  assert.equal(model?.heading, "2 red flags: Aino");
});

test("flags of a Patient who is no longer listed (sharing withdrawn) never reach the banner", () => {
  assert.equal(bannerModel([flag("r", "red", 1_000, { patientId: "gone" })], names), null);
});

test("an unnamed Patient and an empty reason still read as words", () => {
  const model = bannerModel([flag("r", "red", 1_000, { reason: "  " })], { p1: "" });
  assert.equal(model?.items[0].displayName, "Unnamed patient");
  assert.equal(model?.items[0].reason, "No reason recorded.");
});

// ---- newRedFlags -------------------------------------------------------------------------------

const LOADED = 10_000;

test("initialLoadPlaysNoSound: a Patient's first snapshot is never new", () => {
  const flags = [flag("r", "red", 5_000)];
  assert.deepEqual(newRedFlags(null, flags, { loadedAtMillis: LOADED }), []);
});

test("newFlagDetected: a red flag that appears in a later snapshot is new", () => {
  const before = [flag("a", "amber", 5_000)];
  const after = [...before, flag("r", "red", 12_000)];
  assert.deepEqual(newRedFlags(before, after, { loadedAtMillis: LOADED }).map((f) => f.id), ["r"]);
});

test("an amber flag, or a red flag already seen, is not new", () => {
  const before = [flag("r", "red", 5_000)];
  const after = [...before, flag("a", "amber", 12_000)];
  assert.deepEqual(newRedFlags(before, after, { loadedAtMillis: LOADED }), []);
});

test("a red flag that arrives already cleared is not new", () => {
  const after = [flag("r", "red", 12_000, { clearedAtMillis: 13_000 })];
  assert.deepEqual(newRedFlags([], after, { loadedAtMillis: LOADED }), []);
});

test("clearing a flag is never new", () => {
  const before = [flag("r", "red", 5_000)];
  const after = [flag("r", "red", 5_000, { clearedAtMillis: 12_000 })];
  assert.deepEqual(newRedFlags(before, after, { loadedAtMillis: LOADED }), []);
});

test("a Patient who joins the list later: only reds raised after the dashboard loaded are new", () => {
  const flags = [flag("before-load", "red", 5_000), flag("after-load", "red", 12_000)];
  assert.deepEqual(newRedFlags(null, flags, { loadedAtMillis: LOADED, joinedLate: true }).map((f) => f.id), ["after-load"]);
});
