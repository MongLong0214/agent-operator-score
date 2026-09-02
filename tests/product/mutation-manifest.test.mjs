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

test("every guard in the manifest is accounted for, and every accounted guard is still there", () => {
  // Equality, not a floor. `REQUIRED_GUARDS` is a floor over the eleven the specification named, so
  // it cannot see a guard that was never in it -- every guard added since could have been deleted
  // and this suite would have stayed green while reporting that the manifest was checked. A floor
  // falls behind by default and can be stale and green at the same time; under equality an
  // unaccounted guard fails and a departed one fails too.
  const named = [...GUARDS.map((entry) => entry.guard)].sort();
  const accounted = [...ACCOUNTED_GUARDS].sort();
  assert.deepEqual(named, accounted);
  assert.deepEqual(accounted, [...new Set(accounted)], "a name is accounted for twice");
  assert.deepEqual([...ACCOUNTED_GUARDS], accounted, "ACCOUNTED_GUARDS is not sorted, which is what makes a merge of two branches readable");
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

test("no guard's witness can skip in the environment that measures it", () => {
  // A guard whose named test skips is not load-bearing there: the mutation is applied, the test
  // reports `ok ... # SKIP`, and the runner reads a pass. Round 5 found one -- a guard witnessed by
  // the installed-Codex lane, which skips on every machine without an authenticated Codex, which is
  // every CI runner. Two shapes are refused: a test that decides to skip from inside its body, and
  // a test declared with a skip option that the guard does not confine to a platform where the
  // option is false.
  for (const guard of GUARDS) {
    const source = readFileSync(new URL(`../../${guard.test}`, import.meta.url), "utf8");
    const at = source.indexOf(`test("${guard.name}"`);
    assert.notEqual(at, -1, `${guard.guard}: no test named ${guard.name}`);
    const next = source.indexOf("\ntest(", at + 10);
    const body = source.slice(at, next === -1 ? source.length : next);
    assert.equal(/\bt\.skip\(/.test(body), false, `${guard.guard}: its witness decides to skip from inside its body, so the guard cannot fire`);
    // An early `return` is `t.skip` in a different spelling, and it is the one that hid a broken
    // guard for a week: the `raw filename bytes` witness catches EILSEQ on APFS and returns before
    // any assertion, so the mutation survived on darwin while the manifest said "linux only" in a
    // comment and the runner had no field to read. A witness that can decide not to assert has to
    // be confined to the platform where it does, or say why it always does.
    const earlyReturn = /^\s*(?:\}\s*)?return(?:\s+null)?;\s*$/mu.test(body) || /\breturn;\s*\n/u.test(body);
    const declaration = body.split("\n").slice(0, 3).join("\n");
    if (/\{\s*skip:/.test(declaration) || earlyReturn) {
      // Either the guard is confined to the platform where the option is false, or it says in one
      // line why the option is never true where this suite runs. What is refused is a guard whose
      // witness may quietly skip and nobody has said so.
      assert.ok(
        typeof guard.platform === "string" || typeof guard.witness_skip === "string",
        `${guard.guard}: its witness may decline to assert -- a skip option or an early return -- and the guard neither names the platform that runs it nor says why that never happens here`
      );
    }
  }
});

test("a guard deferred on this platform has been measured on the one that owns it", () => {
  // The runner defers a platform-specific guard and used to exit zero on the rest, so a guard could
  // be deferred on every lane the release gates on and counted as fine -- the "unsupported lane
  // produces a green result" rule, this time inside the runner. The lane that can measure a guard
  // writes what it measured into `tests/mutation/measured.json`, keyed by a fingerprint of the
  // guard and the bytes of the file it mutates; the lane that cannot requires that record to still
  // describe the code in front of it. This test holds the ledger to the manifest so a stale or
  // missing entry is visible in `npm test` rather than only in the mutation job.
  const ledger = JSON.parse(readFileSync(new URL("../mutation/measured.json", import.meta.url), "utf8"));
  assert.equal(ledger.schema, "aos-mutation-measurement-ledger.v1");
  const platformGuards = GUARDS.filter((guard) => typeof guard.platform === "string");
  assert.ok(platformGuards.length > 0, "no guard is platform-specific, so this rule has nothing to hold");
  for (const guard of platformGuards) {
    const record = ledger.measured[guard.guard] ?? null;
    assert.notEqual(record, null, `${guard.guard}: no lane has recorded measuring it`);
    assert.equal(record.platform, guard.platform, `${guard.guard}: measured on ${record.platform}, which is not the platform it needs`);
    assert.match(String(record.fingerprint), /^sha256:[0-9a-f]{64}$/u);
  }
  // Every name in the ledger is a guard the manifest still declares: a record for a guard nobody
  // runs any more is a measurement of nothing.
  const declared = new Set(GUARDS.map((guard) => guard.guard));
  for (const name of Object.keys(ledger.measured)) {
    assert.ok(declared.has(name), `${name} is in the ledger and not in the manifest`);
  }
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
