import { test } from "node:test";
import assert from "node:assert/strict";
import { SOUND_KEY, readSoundPreference, shouldChime, writeSoundPreference } from "../js/lib/sound-pref.js";

const memory = () => {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), values };
};
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

test("sound is off until the Clinician turns it on", () => {
  assert.equal(readSoundPreference(memory()), false);
  assert.equal(readSoundPreference(undefined), false);
});

test("the choice is remembered", () => {
  const storage = memory();
  assert.equal(writeSoundPreference(storage, true), true);
  assert.equal(storage.values.get(SOUND_KEY), "on");
  assert.equal(readSoundPreference(storage), true);
  writeSoundPreference(storage, false);
  assert.equal(readSoundPreference(storage), false);
});

test("blocked storage reads as off and a failed write is reported, never thrown", () => {
  assert.equal(readSoundPreference(throwing), false);
  assert.equal(writeSoundPreference(throwing, true), false);
});

test("a chime needs sound on and at least one new red flag", () => {
  assert.equal(shouldChime({ enabled: false, newFlags: [{ id: "r" }] }), false);
  assert.equal(shouldChime({ enabled: true, newFlags: [] }), false);
  assert.equal(shouldChime({ enabled: true, newFlags: [{ id: "r" }] }), true);
});
