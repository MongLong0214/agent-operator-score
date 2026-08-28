import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { makePlan, run } from "./helpers.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
// Run it without asserting an exit code, because which non-zero code a scored-but-capped run gets
// is a different question from the one this file is about.
const spawnAssess = (cwd, plan) =>
  spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--seed", "3"], {
    cwd, encoding: "utf8", timeout: 120000, env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
  });
import { neverStarted } from "../../lib/cli.mjs";

// A wrong flag is the ordinary way to misconfigure an agent, and the CLI it wraps rejects it before
// doing any work. Scored as an ordinary failure it produces a number that describes the operator's
// typo rather than their agent, which is the one thing this product must never do.
test("an agent that never started is told apart from one that did badly", () => {
  // Measured against a real misconfiguration: `codex exec --full-auto`, which that build does not
  // accept, is exit 2 with zero bytes of stdout in 0.2 seconds.
  assert.equal(neverStarted({ ok: false, exit_code: 2, stdout_bytes: 0, duration_ms: 200, timed_out: false }), true);

  // An agent that read its task and decided against it takes longer and says so, which is what
  // every real one does.
  assert.equal(neverStarted({ ok: false, exit_code: 1, stdout_bytes: 64, duration_ms: 200, timed_out: false }), false);
  assert.equal(neverStarted({ ok: false, exit_code: 1, stdout_bytes: 0, duration_ms: 30000, timed_out: false }), false);
  // A timeout is a different failure with its own name, and it is not this one.
  assert.equal(neverStarted({ ok: false, exit_code: null, stdout_bytes: 0, duration_ms: 100, timed_out: true }), false);
  assert.equal(neverStarted({ ok: true, exit_code: 0, stdout_bytes: 0, duration_ms: 100, timed_out: false }), false);
});

test("a misconfigured agent stops the run instead of scoring it", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-never-started-"));
  try {
    run(cwd, ["init"]);
    // The shape of the real failure: an argument the wrapped CLI does not accept.
    run(cwd, ["agent", "add", "broken", "--command", process.execPath, "--arg", "--not-a-real-flag"]);
    const plan = makePlan(cwd, { default: "broken" });
    const refused = run(cwd, ["assess", "--plan", plan, "--seed", "3"], 2);

    assert.match(refused.stderr, /AOS_AGENT_DID_NOT_RUN broken/);
    assert.match(refused.stderr, /with no output/);
    // The command it actually ran, so the operator can see the flag they got wrong.
    assert.match(refused.stderr, /--not-a-real-flag/);
    // And what the agent itself said about it.
    assert.match(refused.stderr, /not-a-real-flag/);
    assert.match(refused.stderr, /measures the configuration, not the agent/);

    // Nothing was scored.
    assert.equal(/Score:/.test(refused.stdout), false, refused.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an agent that runs and refuses is still assessed", () => {
  // The narrow test must not swallow the ordinary case: an agent that explains itself and exits
  // non-zero is a blocked agent, and blocked agents are what one whole family is about.
  const cwd = mkdtempSync(join(tmpdir(), "aos-blocked-agent-"));
  try {
    run(cwd, ["init"]);
    // A real refusal names what it was asked. An agent that emits byte-identical output for six
    // different tasks did not read any of them, and that is the case the run stops on.
    run(cwd, ["agent", "add", "refuses", "--command", process.execPath, "--arg", "-e",
      "--arg", 'process.stdout.write(`I will not do ${process.env.AOS_FAMILY}\\n`); process.exit(1);']);
    const plan = makePlan(cwd, { default: "refuses" });
    // 3 or 4 -- a withheld score or a capped one. Either is a run that happened and was assessed,
    // which is the distinction under test; 2 would be AOS refusing to run it at all.
    const assessed = spawnAssess(cwd, plan);
    assert.equal([3, 4].includes(assessed.status), true, `exit ${assessed.status}: ${assessed.stderr}`);
    assert.equal(/AOS_AGENT_DID_NOT_RUN/.test(assessed.stderr), false, assessed.stderr);
    assert.match(assessed.stdout, /metrics observed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
