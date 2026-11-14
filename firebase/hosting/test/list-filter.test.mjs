import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRows, listMessage, listViewModel, nameMatches } from "../js/lib/list-filter.js";

const row = (id, displayName, flagLevel) => ({ id, displayName, flagLevel });
const rows = [row("r", "Aino Virtanen", "red"), row("a", "Sara Mäkelä", "amber"), row("g", "Élise Moreau", "green")];

test("search matches any part of the name, ignoring case, accents and outer spaces", () => {
  assert.equal(nameMatches("Sara Mäkelä", "makela"), true);
  assert.equal(nameMatches("Élise Moreau", "  elise "), true);
  assert.equal(nameMatches("Aino Virtanen", "VIRT"), true);
  assert.equal(nameMatches("Aino Virtanen", "sara"), false);
  assert.equal(nameMatches("Aino Virtanen", ""), true);
});

test("the level filter keeps one level; 'all' keeps every row", () => {
  assert.deepEqual(filterRows(rows, { search: "", level: "amber" }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterRows(rows, { search: "", level: "all" }).map((r) => r.id), ["r", "a", "g"]);
});

test("search and level combine, and the order is kept", () => {
  assert.deepEqual(filterRows(rows, { search: "i", level: "all" }).map((r) => r.id), ["r", "g"]);
  assert.deepEqual(filterRows(rows, { search: "i", level: "red" }).map((r) => r.id), ["r"]);
});

test("an unknown level value filters nothing out", () => {
  assert.deepEqual(filterRows(rows, { search: "", level: "purple" }).map((r) => r.id), ["r", "a", "g"]);
});

test("no Patients at all is the empty state, whatever the filter", () => {
  assert.equal(listMessage({ total: 0, shown: 0, search: "x", level: "red" }).kind, "empty");
});

test("no match for a search names the search", () => {
  const message = listMessage({ total: 3, shown: 0, search: " zed ", level: "all" });
  assert.equal(message.kind, "noMatch");
  assert.equal(message.text, "No Patient's name matches “zed”.");
});

test("no results for a level says nobody is at that level right now", () => {
  const message = listMessage({ total: 3, shown: 0, search: "", level: "red" });
  assert.equal(message.kind, "noMatch");
  assert.equal(message.text, "No Patients are at Red right now.");
});

test("no match for both says both", () => {
  const message = listMessage({ total: 3, shown: 0, search: "zed", level: "amber" });
  assert.equal(message.text, "No Amber Patient matches “zed”.");
});

test("a filtered list counts what is shown; an unfiltered list says nothing", () => {
  assert.deepEqual(listMessage({ total: 3, shown: 1, search: "a", level: "red" }), { kind: "filtered", text: "Showing 1 of 3 Patients." });
  assert.deepEqual(listMessage({ total: 3, shown: 3, search: "", level: "all" }), { kind: "ok", text: "" });
});

test("search and the level filter never hide the red banner", () => {
  const flagsByPatient = {
    r: [{ id: "f1", level: "red", reason: "Slept under 3 hours last night.", raisedAtMillis: 1_000, clearedAtMillis: null }],
  };
  const all = listViewModel({ rows, flagsByPatient, search: "", level: "all" });
  const hidden = listViewModel({ rows, flagsByPatient, search: "sara", level: "green" });
  assert.deepEqual(hidden.rows, []);
  assert.equal(hidden.message.kind, "noMatch");
  assert.ok(all.banner);
  assert.deepEqual(hidden.banner, all.banner);
  assert.equal(hidden.banner?.items[0].displayName, "Aino Virtanen");
});
