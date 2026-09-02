import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ACCOUNTED_GUARDS, GUARDS, REQUIRED_GUARDS } from "../mutation/manifest.mjs";

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
  // A floor, not an equality: the manifest may hold guards the specification never named, and it
  // should. What is forbidden is one of the named eleven quietly leaving it.
  for (const required of REQUIRED_GUARDS) {
    assert.equal(named.includes(required), true, `${required} is no longer covered`);
  }
  assert.equal(new Set(named).size, named.length, "a guard is listed twice");
  for (const entry of GUARDS) assert.equal(entry.reason.length > 20, true, `${entry.guard} has no stated reason`);
});

test("every guard in the manifest is accounted for, not only the eleven the specification names", () => {
  // The floor above protects eleven guards and nothing else, so every guard added since could have
  // been deleted from GUARDS with the whole suite still green -- the manifest failing at the one
  // job it has. This is the same question asked about the whole list, and asked in both directions:
  // a guard that is not accounted for fails, and an accounting entry whose guard has left fails.
  const named = GUARDS.map((entry) => entry.guard).sort();
  const accounted = [...ACCOUNTED_GUARDS].sort();
  const unaccounted = named.filter((name) => !accounted.includes(name));
  const departed = accounted.filter((name) => !named.includes(name));
  assert.deepEqual(unaccounted, [], `add these to ACCOUNTED_GUARDS in tests/mutation/manifest.mjs: ${JSON.stringify(unaccounted)}`);
  assert.deepEqual(departed, [], `these guards left GUARDS; remove them from ACCOUNTED_GUARDS only if that was deliberate: ${JSON.stringify(departed)}`);
  assert.equal(new Set(accounted).size, accounted.length, "a guard is accounted for twice");
  // The specification's own list is a subset of the accounting, so the two cannot disagree.
  for (const required of REQUIRED_GUARDS) assert.equal(accounted.includes(required), true, `${required} is not accounted for`);
});
