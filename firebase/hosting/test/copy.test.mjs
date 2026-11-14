// The product is a wellbeing companion (ADR 0001): no dashboard copy, and nothing in the dashboard's
// code, may use the words the spec rules out. Scans index.html and every file under js/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const FORBIDDEN = /diagnos|treatment|risk score/i;

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const files = [join(root, "index.html"), ...filesUnder(join(root, "js"))];

test("there are files to scan", () => {
  assert.ok(files.length > 10);
});

for (const file of files) {
  test(`no forbidden words in ${relative(root, file)}`, () => {
    const hits = readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(({ text }) => FORBIDDEN.test(text));
    assert.deepEqual(hits, [], `"diagnosis", "treatment" or "risk score" in ${relative(root, file)}`);
  });
}
