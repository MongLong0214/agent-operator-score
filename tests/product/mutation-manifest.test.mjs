import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { GUARDS, REQUIRED_GUARDS } from "../mutation/manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// The mutation run is too slow to sit in `npm test` -- it rebuilds a worktree and runs a test file
// per guard. What runs here is the part that rots: a `from` string that no longer matches after a
// refactor makes the mutation a no-op, and a runner that reports "no match" alongside eleven kills
// reads as a pass. These checks fail the ordinary suite the moment the manifest stops describing
// the code, which is the only moment anyone would still remember why.

test("every mutation still has something to break", () => {
  for (const entry of GUARDS) {
    assert.equal(existsSync(join(root, entry.file)), true, `${entry.guard}: ${entry.file} is gone`);
    const source = read(entry.file);
    const occurrences = source.split(entry.from).length - 1;
    assert.equal(occurrences, 1, `${entry.guard}: matched ${occurrences} times in ${entry.file}, need exactly one`);
  }
});

test("a mutation actually changes the file it names", () => {
  // A `to` equal to its `from` would run the whole suite against unmodified code and call every
  // guard load-bearing.
  for (const entry of GUARDS) {
    assert.notEqual(entry.to, entry.from, entry.guard);
    // Applying it is the check. Asking whether the file already contains `to` would be answered yes
    // by any short replacement -- "false" appears throughout the scorer -- and would reject a
    // perfectly good mutation.
    const source = read(entry.file);
    assert.notEqual(source.replace(entry.from, entry.to), source, `${entry.guard}: the replacement leaves the file unchanged`);
  }
});

test("every mutation names a test that exists", () => {
  // "some test somewhere failed" would be satisfied by a typo in an unrelated file.
  for (const entry of GUARDS) {
    assert.equal(existsSync(join(root, entry.test)), true, `${entry.guard}: ${entry.test} is gone`);
    assert.equal(read(entry.test).includes(`test("${entry.name}"`), true, `${entry.guard}: no test named "${entry.name}" in ${entry.test}`);
  }
});

test("the manifest covers the named guards and invents none", () => {
  const named = GUARDS.map((entry) => entry.guard);
  assert.deepEqual([...named].sort(), [...REQUIRED_GUARDS].sort());
  assert.equal(new Set(named).size, named.length, "a guard is listed twice");
  for (const entry of GUARDS) assert.equal(entry.reason.length > 20, true, `${entry.guard} has no stated reason`);
});
