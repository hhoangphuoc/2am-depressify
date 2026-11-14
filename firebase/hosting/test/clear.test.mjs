import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearDialogReducer,
  clearErrorMessage,
  clearFlags,
  initialClearDialog,
  levelAfterClearing,
  reviewChanged,
  reviewOf,
} from "../js/lib/clear.js";

const flag = (id, level, raisedAtMillis, extra = {}) => ({
  id,
  level,
  kind: id,
  reason: `${id} reason.`,
  raisedAtMillis,
  clearedAtMillis: null,
  ...extra,
});

// ---- levelAfterClearing ------------------------------------------------------------------------

test("clearing the only flag resets the Patient to green with no reasons", () => {
  assert.deepEqual(levelAfterClearing([flag("crisis", "red", 1)], ["crisis"]), { flagLevel: "green", flagReasons: [] });
});

test("the level becomes the highest remaining uncleared flag, with the remaining reasons highest first, newest first", () => {
  const flags = [
    flag("crisis", "red", 5),
    flag("drift", "amber", 2),
    flag("low_mood", "amber", 4),
    flag("old", "red", 1, { clearedAtMillis: 3 }),
  ];
  assert.deepEqual(levelAfterClearing(flags, ["crisis"]), {
    flagLevel: "amber",
    flagReasons: ["low_mood reason.", "drift reason."],
  });
});

test("clearing an amber flag leaves an open red flag in charge", () => {
  const flags = [flag("silent", "red", 1), flag("drift", "amber", 2)];
  assert.deepEqual(levelAfterClearing(flags, ["drift"]), { flagLevel: "red", flagReasons: ["silent reason."] });
});

test("an already cleared flag never comes back, and the same reason is listed once", () => {
  const flags = [
    flag("a", "amber", 1, { reason: "Same." }),
    flag("b", "amber", 2, { reason: "Same." }),
    flag("c", "red", 3, { clearedAtMillis: 4 }),
  ];
  assert.deepEqual(levelAfterClearing(flags, []), { flagLevel: "amber", flagReasons: ["Same."] });
});

test("a flag with an unknown level never raises the level above what it can be", () => {
  assert.deepEqual(levelAfterClearing([flag("x", "purple", 1)], []), { flagLevel: "green", flagReasons: ["x reason."] });
});

// ---- review ------------------------------------------------------------------------------------

const patient = { displayName: "Aino", flagLevel: "red", flagReasons: ["crisis reason.", "drift reason."] };
const flags = [flag("crisis", "red", 5), flag("drift", "amber", 2), flag("old", "amber", 1, { clearedAtMillis: 3 })];

test("a review records the level, reasons and open flags the Clinician saw", () => {
  assert.deepEqual(reviewOf(patient, flags), {
    flagLevel: "red",
    flagReasons: ["crisis reason.", "drift reason."],
    openFlagIds: ["crisis", "drift"],
  });
});

test("nothing new since the review is not a change, whatever the order", () => {
  const reviewed = reviewOf(patient, flags);
  assert.equal(reviewChanged(reviewed, reviewOf({ ...patient, flagReasons: ["drift reason.", "crisis reason."] }, [...flags].reverse())), false);
});

test("a new reason, a new open flag or a new level is a change", () => {
  const reviewed = reviewOf(patient, flags);
  assert.equal(reviewChanged(reviewed, reviewOf({ ...patient, flagReasons: [...patient.flagReasons, "New."] }, flags)), true);
  assert.equal(reviewChanged(reviewed, reviewOf(patient, [...flags, flag("silent", "red", 9)])), true);
  assert.equal(reviewChanged(reviewed, reviewOf({ ...patient, flagLevel: "amber" }, flags)), true);
});

// ---- clearFlags against a fake Firestore -------------------------------------------------------

function fakeFirestore(initial) {
  const docs = new Map(Object.entries(initial));
  const hooks = { beforeTransaction: () => {} };
  const snap = (path) => ({ id: path.split("/").at(-1), exists: () => docs.has(path), data: () => docs.get(path) });
  const fs = {
    doc: (_db, ...segments) => ({ path: segments.join("/"), id: segments.at(-1) }),
    collection: (_db, ...segments) => ({ path: segments.join("/") }),
    getDocs: async (col) => ({
      docs: [...docs.keys()]
        .filter((p) => p.startsWith(`${col.path}/`) && !p.slice(col.path.length + 1).includes("/"))
        .map(snap),
    }),
    runTransaction: async (_db, run) => {
      hooks.beforeTransaction();
      const writes = [];
      const result = await run({ get: async (ref) => snap(ref.path), update: (ref, data) => writes.push([ref.path, data]) });
      for (const [path, data] of writes) docs.set(path, { ...docs.get(path), ...data });
      return result;
    },
  };
  return { fs, db: {}, docs, hooks };
}

function seeded() {
  return fakeFirestore({
    "patients/p1": { displayName: "Aino", flagLevel: "red", flagReasons: ["crisis reason.", "drift reason."] },
    "patients/p1/flags/crisis": flag("crisis", "red", 5),
    "patients/p1/flags/drift": flag("drift", "amber", 2),
    "patients/p1/flags/old": flag("old", "amber", 1, { clearedAtMillis: 3 }),
  });
}

test("clearing sets the cleared time on the flag and resets the Patient's level in one transaction", async () => {
  const { fs, db, docs } = seeded();
  const reviewed = reviewOf(docs.get("patients/p1"), [...docs.values()].filter((d) => d.kind));
  const result = await clearFlags(fs, db, { patientId: "p1", flagIds: ["crisis"], reviewed, nowMillis: 99 });
  assert.deepEqual(result, { flagLevel: "amber", flagReasons: ["drift reason."] });
  assert.equal(docs.get("patients/p1/flags/crisis").clearedAtMillis, 99);
  assert.equal(docs.get("patients/p1/flags/drift").clearedAtMillis, null);
  assert.equal(docs.get("patients/p1").flagLevel, "amber");
  assert.deepEqual(docs.get("patients/p1").flagReasons, ["drift reason."]);
  // History stays: nothing is deleted.
  assert.equal(docs.size, 4);
});

test("a flag raised after the review asks for a new review and clears nothing", async () => {
  const { fs, db, docs } = seeded();
  const reviewed = reviewOf(docs.get("patients/p1"), [...docs.values()].filter((d) => d.kind));
  docs.set("patients/p1/flags/silent", flag("silent", "red", 7));
  await assert.rejects(
    clearFlags(fs, db, { patientId: "p1", flagIds: ["crisis"], reviewed, nowMillis: 99 }),
    (error) => error.code === "flag/changed",
  );
  assert.equal(docs.get("patients/p1/flags/crisis").clearedAtMillis, null);
  assert.equal(docs.get("patients/p1").flagLevel, "red");
});

test("a reason raised while the transaction starts is caught by the Patient read inside it", async () => {
  const { fs, db, docs, hooks } = seeded();
  const reviewed = reviewOf(docs.get("patients/p1"), [...docs.values()].filter((d) => d.kind));
  hooks.beforeTransaction = () => {
    const p = docs.get("patients/p1");
    docs.set("patients/p1", { ...p, flagReasons: [...p.flagReasons, "Phone quiet for a day."] });
  };
  await assert.rejects(
    clearFlags(fs, db, { patientId: "p1", flagIds: ["crisis"], reviewed, nowMillis: 99 }),
    (error) => error.code === "flag/changed",
  );
  assert.equal(docs.get("patients/p1/flags/crisis").clearedAtMillis, null);
});

test("a flag cleared elsewhere since the review also asks for a new review", async () => {
  const { fs, db, docs } = seeded();
  const reviewed = reviewOf(docs.get("patients/p1"), [...docs.values()].filter((d) => d.kind));
  docs.set("patients/p1/flags/crisis", { ...docs.get("patients/p1/flags/crisis"), clearedAtMillis: 50 });
  await assert.rejects(
    clearFlags(fs, db, { patientId: "p1", flagIds: ["crisis"], reviewed, nowMillis: 99 }),
    (error) => error.code === "flag/changed",
  );
  assert.equal(docs.get("patients/p1/flags/crisis").clearedAtMillis, 50);
});

test("clearing a flag that is not open is refused", async () => {
  const { fs, db, docs } = seeded();
  const reviewed = reviewOf(docs.get("patients/p1"), [...docs.values()].filter((d) => d.kind));
  await assert.rejects(
    clearFlags(fs, db, { patientId: "p1", flagIds: ["old"], reviewed, nowMillis: 99 }),
    (error) => error.code === "flag/not-open",
  );
});

// ---- error copy --------------------------------------------------------------------------------

test("errors map to vetted copy, never the raw text", () => {
  assert.match(clearErrorMessage({ code: "permission-denied", message: "Missing or insufficient permissions." }), /no longer/);
  assert.equal(clearErrorMessage({ code: "unavailable", message: "raw" }), "Could not clear the flag. Check your connection and try again.");
  assert.equal(clearErrorMessage(new Error("boom")), "Could not clear the flag. Check your connection and try again.");
});

// ---- the dialog --------------------------------------------------------------------------------

const reviewed = { flagLevel: "red", flagReasons: ["A."], openFlagIds: ["a"] };
const newer = { flagLevel: "red", flagReasons: ["A.", "B."], openFlagIds: ["a", "b"] };

test("the dialog opens on one flag with what the Clinician is reviewing", () => {
  const state = clearDialogReducer(initialClearDialog(), { type: "open", flagId: "a", reviewed });
  assert.deepEqual(state, { mode: "review", flagId: "a", reviewed, error: null, changed: false });
});

test("cancel closes it, except while saving", () => {
  let state = clearDialogReducer(initialClearDialog(), { type: "open", flagId: "a", reviewed });
  assert.equal(clearDialogReducer(state, { type: "cancel" }).mode, "closed");
  state = clearDialogReducer(state, { type: "save" });
  assert.equal(state.mode, "saving");
  assert.equal(clearDialogReducer(state, { type: "cancel" }), state);
});

test("saving then success closes the dialog", () => {
  let state = clearDialogReducer(initialClearDialog(), { type: "open", flagId: "a", reviewed });
  state = clearDialogReducer(state, { type: "save" });
  assert.equal(clearDialogReducer(state, { type: "saved" }).mode, "closed");
});

test("an error keeps the dialog open with the message, ready to try again", () => {
  let state = clearDialogReducer(initialClearDialog(), { type: "open", flagId: "a", reviewed });
  state = clearDialogReducer(state, { type: "save" });
  state = clearDialogReducer(state, { type: "failed", message: "Could not clear the flag." });
  assert.equal(state.mode, "review");
  assert.equal(state.error, "Could not clear the flag.");
  assert.equal(clearDialogReducer(state, { type: "save" }).error, null);
});

test("a new reason while the dialog is open asks for a new review against what is open now", () => {
  let state = clearDialogReducer(initialClearDialog(), { type: "open", flagId: "a", reviewed });
  state = clearDialogReducer(state, { type: "current", current: reviewed });
  assert.equal(state.changed, false, "the same state is not a change");
  state = clearDialogReducer(state, { type: "current", current: newer });
  assert.equal(state.mode, "review");
  assert.equal(state.changed, true);
  assert.deepEqual(state.reviewed, newer);
});

test("a change found while saving comes back as a new review, not an error", () => {
  let state = clearDialogReducer(initialClearDialog(), { type: "open", flagId: "a", reviewed });
  state = clearDialogReducer(state, { type: "save" });
  assert.equal(clearDialogReducer(state, { type: "current", current: newer }), state, "saving ignores live updates");
  state = clearDialogReducer(state, { type: "changed", current: newer });
  assert.deepEqual([state.mode, state.changed, state.error], ["review", true, null]);
  assert.deepEqual(state.reviewed, newer);
});

test("if the flag being cleared is no longer open, the dialog closes", () => {
  const state = clearDialogReducer(initialClearDialog(), { type: "open", flagId: "a", reviewed });
  const gone = { flagLevel: "green", flagReasons: [], openFlagIds: [] };
  assert.equal(clearDialogReducer(state, { type: "current", current: gone }).mode, "closed");
});
