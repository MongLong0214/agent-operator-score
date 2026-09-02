// What running the whole product end to end from a fresh clone turned up, rather than running its
// parts. Each of these needed a real machine to appear.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fake-agent.mjs");
const temporary = (name) => mkdtempSync(join(tmpdir(), name));

const aos = (cwd, home, args, input = "") =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd, input, encoding: "utf8", timeout: 180000, env: { ...process.env, AOS_HOME: home, HOME: home }
  });

// A `claude` whose credential was invisible exited 1 in a second with the same 35 bytes on all six
// families, every one of them behind a checkpoint, and the operator was scored 6 of 20 for it. The
// guard for this already existed and was waived whenever a checkpoint had been raised -- which is
// exactly the mode that produces a score.
test("a harness that fails every family the same way is not scored, checkpoints or not", () => {
  const home = temporary("aos-dead-home-");
  const cwd = temporary("aos-dead-cwd-");
  try {
    const dead = join(cwd, "dead.mjs");
    writeFileSync(dead, 'process.stdout.write("Invalid API key\\n");\nprocess.exit(1);\n');
    aos(cwd, home, ["agent", "add", "dead", "--command", process.execPath, "--arg", dead]);

    // Somebody sat there and pressed Enter through every question. The run is eligible for a score,
    // and the thing being scored never read a task.
    const attended = aos(cwd, home, ["assess", "--checkpoints"], "\n".repeat(200));
    assert.match(attended.stderr + attended.stdout, /AOS_AGENT_FAILS_IDENTICALLY/);
    assert.match(attended.stderr + attended.stdout, /Nothing was scored/);

    // Nobody answered. That is an unattended run, withheld on coverage anyway, and it is reported as
    // what it is rather than as a crash.
    const silent = aos(cwd, home, ["assess", "--checkpoints"], "");
    assert.doesNotMatch(silent.stderr + silent.stdout, /AOS_AGENT_FAILS_IDENTICALLY/);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

test("an agent that does the work is still scored when the operator changes nothing", () => {
  // The guard must not have been bought at the price of the ordinary case: press Enter through the
  // questions against a working agent and a number still comes out.
  const home = temporary("aos-live-home-");
  const cwd = temporary("aos-live-cwd-");
  try {
    aos(cwd, home, ["agent", "add", "solo", "--command", process.execPath, "--arg", fixture]);
    const run = aos(cwd, home, ["assess", "--checkpoints"], "\n".repeat(300));
    assert.doesNotMatch(run.stderr + run.stdout, /AOS_AGENT_FAILS_IDENTICALLY/);
    assert.match(run.stdout, /Score: \d+ \/ 100/);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

// A ledger that has judged nothing printed `FAIL high-severity precision`, which reads as the
// reviewer falling short of its target. Nothing had been measured at all.
//
// The word this asserts changed from "undecided" to "withheld" when the report stopped being
// generated from the unfloored acceptance object: there is no longer a gate line with a value in
// it, so there is no longer a place for a value to be missing from. What is asserted is the same
// property and one more of it -- the state is named, it is not named as a failure, and there is no
// rate anywhere on the page.
test("a gate with nothing to measure is not reported as a failure", () => {
  const home = temporary("aos-undecided-");
  try {
    const shown = aos(home, home, ["holdout"]);
    assert.match(shown.stdout, /high-severity precision: withheld/);
    assert.doesNotMatch(shown.stdout, /FAIL {2}high-severity precision/);
    assert.doesNotMatch(shown.stdout, /\b\d\.\d{3}\b/);
    // Undecided is still not accepted: the word changed, the bar did not.
    assert.notEqual(shown.status, 0);
    assert.match(shown.stdout, /not accepted/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// `dashboard` is the only command that never returns, so a flag it does not understand becomes a hang
// instead of an error. Measured with `--print-token`, which does not exist: it started a server and
// blocked for over an hour.
test("the one command that never exits refuses a flag it does not know", () => {
  const home = temporary("aos-flag-");
  try {
    const refused = aos(home, home, ["dashboard", "--print-token"]);
    assert.match(refused.stderr, /AOS_UNKNOWN_OPTION --print-token/);
    assert.match(refused.stderr, /--port/);
    assert.notEqual(refused.status, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
