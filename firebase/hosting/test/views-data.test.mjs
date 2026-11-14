// The dashboard's views read and write only through the design data layer (js/data/design-data.js
// over js/lib/design-live.js): one write path, one error-copy mapping, and one subscription per
// Patient page that feeds every block. Checked on the sources, since the views need a DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const views = fileURLToPath(new URL("../js/views/", import.meta.url));
const sources = Object.fromEntries(readdirSync(views).filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(join(views, f), "utf8")]));
const list = readFileSync(fileURLToPath(new URL("../js/list.js", import.meta.url)), "utf8");

test("no view opens its own Firestore listener", () => {
  for (const [file, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /\bonSnapshot\b/, file);
    assert.doesNotMatch(source, /\bpatientQuery\b/, file);
  }
  assert.doesNotMatch(list, /\bonSnapshot\b/);
});

test("no view writes to Firestore itself: Visits, the TMS end date and clearing go through the data layer", () => {
  for (const [file, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /\b(addDoc|setDoc|updateDoc|runTransaction|clearFlags)\b/, file);
  }
  assert.match(sources["flags.js"], /data\.clearAttention\(/);
  assert.match(sources["visits.js"], /data\.recordVisit\(/);
  assert.match(sources["tms-end.js"], /data\.setTmsEndDate\(/);
});

test("the Patient page subscribes once and feeds every block", () => {
  const page = sources["patient.js"];
  assert.equal(page.match(/data\.subscribePatient\(/g)?.length, 1);
  for (const [file, source] of Object.entries(sources)) {
    if (file === "patient.js") continue;
    assert.doesNotMatch(source, /data\.subscribe\w+\(/, `${file} gets its data from the page`);
  }
});

test("the Patient page's status is a live region", () => {
  assert.match(sources["patient.js"], /class: "patient-status", role: "status", "aria-live": "polite"/);
});
