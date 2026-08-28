import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GUARDS } from "./manifest.mjs";

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

const worktree = mkdtempSync(join(tmpdir(), "aos-mutation-"));
rmSync(worktree, { recursive: true, force: true });
const added = run("git", ["worktree", "add", "--detach", worktree, "HEAD"]);
if (added.status !== 0) {
  console.error(added.stderr);
  process.exit(2);
}

const results = [];
try {
  for (const entry of GUARDS) {
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
    const test = run("node", ["--test", "--test-reporter=tap", entry.test], { cwd: worktree, timeout: 900000 });
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

for (const entry of results.filter((entry) => entry.outcome !== "killed")) {
  console.log(`\n${entry.outcome}: ${entry.guard}`);
  console.log(`  ${entry.reason}`);
  console.log(`  broke ${entry.file} and expected "${entry.name}" in ${entry.test} to die.`);
  if (entry.outcome === "SURVIVED") console.log("  Nothing failed. Either the guard does nothing, or no test checks it.");
  if (entry.outcome === "WRONG-TEST") console.log(`  Something else failed instead: ${entry.failing.join(", ") || "the file did not run"}`);
  if (entry.noise) console.log(entry.noise.split("\n").map((line) => `    ${line}`).join("\n"));
}

process.exit(killed.length === results.length ? 0 : 1);
