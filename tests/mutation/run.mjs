import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { GUARDS } from "./manifest.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";

// Breaks each named guard in turn and reports whether the test that claims to hold it notices.
//
// Not part of `npm test`: it builds a worktree and runs a test file per guard, which is minutes
// rather than seconds. `npm run test:mutation`.
//
// It works in a detached worktree at HEAD and never touches the checkout. Editing the real tree
// would leave a half-mutated source behind if this were interrupted, and a source that is broken in
// a way nobody typed is the worst kind of failure to debug -- every test result after it is a lie
// about code that no longer exists anywhere on purpose.

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", ...options });

const dirty = run("git", ["status", "--porcelain", "--", "lib", "tests"]).stdout.trim();
if (dirty && process.env.AOS_MUTATION_ALLOW_DIRTY !== "1") {
  console.error("lib/ or tests/ has uncommitted changes.\n");
  console.error("This runs against HEAD in a worktree, so those changes would not be measured and\nthe report would describe code that is not the code you are looking at. Commit first,\nor set AOS_MUTATION_ALLOW_DIRTY=1 if you meant to measure HEAD anyway.\n");
  console.error(dirty);
  process.exit(2);
}

// `--test-name-pattern` is a regular expression, and a test name is prose: parentheses, dots and
// question marks in it would otherwise match something else or nothing at all.
const escapeForPattern = (name) => `^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`;

const LEDGER_SCHEMA = "aos-mutation-measurement-ledger.v1";

const worktree = mkdtempSync(join(tmpdir(), "aos-mutation-"));
rmSync(worktree, { recursive: true, force: true });
const added = run("git", ["worktree", "add", "--detach", worktree, "HEAD"]);
if (added.status !== 0) {
  console.error(added.stderr);
  process.exit(2);
}

const results = [];
const deferred = [];
try {
  // One guard at a time when asked, so a lane that exists only to measure a platform-specific
  // guard -- a Linux container run from a macOS machine, say -- can measure exactly that one and
  // leave the rest of the ledger alone.
  const only = process.env.AOS_MUTATION_ONLY ?? null;
  for (const entry of GUARDS) {
    if (only !== null && entry.guard !== only) continue;
    // A guard for behaviour only one platform has. The ACL walk is macOS-only, and running its
    // mutant on Ubuntu would report SURVIVED for a guard that is load-bearing everywhere it
    // applies -- so the honest answer is that this lane did not ask, and a lane that runs there
    // has to. Reported by name at the end rather than dropped, because a silently skipped guard is
    // the thing this whole file exists to notice.
    if (entry.platform && entry.platform !== process.platform) {
      deferred.push(entry);
      console.log(`deferred  ${entry.guard}  <- needs ${entry.platform}, this is ${process.platform}`);
      continue;
    }
    const path = join(worktree, entry.file);
    const original = readFileSync(path, "utf8");
    if (!original.includes(entry.from)) {
      // Should be impossible: mutation-manifest.test.mjs fails the ordinary suite for this. It is
      // still reported as its own outcome, because counting it as a kill would be the one bug that
      // makes this whole file lie in the reassuring direction.
      results.push({ ...entry, outcome: "NO-MATCH", failing: [] });
      continue;
    }
    writeFileSync(path, original.replace(entry.from, entry.to));
    // The reporter is named, not inherited. This file reads TAP, and Node's default reporter for a
    // non-terminal changed between the version this is developed on and the one CI runs, so every
    // mutation came back with no `not ok` lines at all and was reported as a crash. Fifteen guards
    // read as not load-bearing when all fifteen were.
    // The named test first, on its own. A guard's question is "does this test notice?", and asking
    // it of one test answers it in a second where running its whole file takes a minute -- with
    // 288 guards that is the difference between a job that finishes and one that is still going.
    // The whole file is run only when the named test passed, because that is the case where the
    // two answers differ: SURVIVED (nothing noticed) and WRONG-TEST (something else noticed) are
    // told apart by what the rest of the file does.
    const named = run("node", ["--test", "--test-reporter=tap", "--test-name-pattern", escapeForPattern(entry.name), entry.test], { cwd: worktree, timeout: 900000 });
    const namedFailed = /^TAP version/m.test(named.stdout)
      && [...named.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1].trim()).includes(entry.name);
    const test = namedFailed ? named : run("node", ["--test", "--test-reporter=tap", entry.test], { cwd: worktree, timeout: 900000 });
    writeFileSync(path, original);

    // If the output is not TAP at all, nothing below can be trusted: "no test failed" and "the
    // format changed" look identical, and only one of them is safe to report.
    if (!/^TAP version/m.test(test.stdout)) {
      results.push({ ...entry, outcome: "NO-TAP", failing: [], noise: `${test.stderr ?? ""}`.split("\n").slice(-8).join("\n") });
      console.log(`NO-TAP    ${entry.guard}  <- the runner could not read this output as TAP`);
      continue;
    }
    const failing = [...test.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1].trim());
    const outcome = failing.includes(entry.name) ? "killed" : test.status !== 0 ? "WRONG-TEST" : "SURVIVED";
    // Kept for the same reason the product keeps an agent's: "died on a crash" with nothing else
    // is a report nobody can act on, and this runner is the thing that says whether the guards
    // hold. It is the last few lines, because a stack ends with the reason.
    const noise = `${test.stderr ?? ""}${test.error ? `\n${test.error.message}` : ""}`.trim();
    results.push({ ...entry, outcome, failing, noise: noise.split("\n").slice(-8).join("\n") });

    const detail = outcome === "WRONG-TEST" ? `  <- died on: ${failing.join(", ") || "a crash, not an assertion"}` : "";
    console.log(`${outcome.padEnd(9)} ${entry.guard}${detail}`);
  }
} finally {
  run("git", ["worktree", "remove", "--force", worktree]);
}

const killed = results.filter((entry) => entry.outcome === "killed");
console.log(`\n${killed.length}/${results.length} guards are load-bearing.`);

// What this lane measured, written down so the lane that cannot measure it can require it.
//
// A guard for behaviour only one platform has cannot be measured here, and the release gate runs
// on one platform: deferring it there and exiting zero let a guard be deferred everywhere and
// counted as fine, which is the "unsupported lane produces a green result" rule this project keeps
// finding. So the lane that *can* measure a guard records the measurement -- the guard, its
// mutation, and a digest of the file it mutates -- and the lane that cannot requires a record that
// still describes the code in front of it. Change the guard or that file and the record goes
// stale, and the gate fails until the platform that owns it has run again.
const ledgerPath = fileURLToPath(new URL("./measured.json", import.meta.url));
const fingerprint = (entry) => sha256Bytes(Buffer.from(JSON.stringify([
  entry.guard,
  entry.file,
  entry.from,
  entry.to,
  entry.test,
  entry.name,
  // Read from the checkout, not the worktree: the worktree is removed with the run, and the
  // runner refuses to start on a dirty tree, so the two hold the same bytes while it exists.
  sha256Bytes(readFileSync(new URL(`../../${entry.file}`, import.meta.url)))
]), "utf8"));
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { schema: LEDGER_SCHEMA, measured: {} };
for (const entry of results.filter((one) => one.outcome === "killed")) {
  ledger.measured[entry.guard] = { platform: process.platform, fingerprint: fingerprint(entry) };
}
const unmeasured = [];
for (const entry of only === null ? deferred : []) {
  const record = ledger.measured[entry.guard] ?? null;
  if (record === null) unmeasured.push(`${entry.guard}: never measured on ${entry.platform}`);
  else if (record.fingerprint !== fingerprint(entry)) unmeasured.push(`${entry.guard}: the ${record.platform} measurement describes different code`);
  else console.log(`measured  ${entry.guard}  <- on ${record.platform}, and that measurement still describes this code`);
}
writeFileSync(ledgerPath, `${JSON.stringify({ schema: LEDGER_SCHEMA, measured: Object.fromEntries(Object.entries(ledger.measured).sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 2)}\n`);
if (unmeasured.length > 0) {
  console.log(`\n${unmeasured.length} guard(s) have been measured on no lane this release gates on:`);
  for (const line of unmeasured) console.log(`  ${line}`);
}

for (const entry of results.filter((entry) => entry.outcome !== "killed")) {
  console.log(`\n${entry.outcome}: ${entry.guard}`);
  console.log(`  ${entry.reason}`);
  console.log(`  broke ${entry.file} and expected "${entry.name}" in ${entry.test} to die.`);
  if (entry.outcome === "SURVIVED") console.log("  Nothing failed. Either the guard does nothing, or no test checks it.");
  if (entry.outcome === "WRONG-TEST") console.log(`  Something else failed instead: ${entry.failing.join(", ") || "the file did not run"}`);
  if (entry.noise) console.log(entry.noise.split("\n").map((line) => `    ${line}`).join("\n"));
}

process.exit(killed.length === results.length && unmeasured.length === 0 ? 0 : 1);
