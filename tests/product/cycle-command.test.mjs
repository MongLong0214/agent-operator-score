import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addAgent, makePlan, run, verifiedRunner } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const SEEDS = ["0000000000000011", "0000000000000012", "0000000000000013"];
const FIXTURE_MODEL = "openai/gpt-4o-2024-08-06";

const opened = () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-cycle-"));
  run(cwd, ["init"]);
  // Registered with an exact model, and the fixture runtime announces the same one in its own
  // transcript below: a cycle over a model nobody named, or one no runtime corroborated, withholds
  // its aggregate (#561), and these tests are about the aggregate. The name is a real snapshot of
  // a real family because that is what "exact" means -- a family this product has naming rules for
  // and a date the provider promised not to move. The unknown and mutable paths have their own
  // fixtures in tests/product/model-identity.test.mjs.
  // Under the Codex adapter, because only the runtime that was configured can corroborate its own
  // binding: an adapter that declares no transcript shape is never corroborated (#561 round 3).
  addAgent(cwd, "solo", undefined, ["--model-id", FIXTURE_MODEL, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
  const plan = makePlan(cwd, { default: "solo" });
  run(cwd, ["cycle", "start", ...SEEDS.flatMap((seed) => ["--seed", seed])]);
  return { cwd, plan, home: join(cwd, ".aos") };
};

// Answers enough checkpoints for one run: every stage of the needs-instruction profile blocks until
// the operator says something different, which is the only way a run fills D4 and can be scored.
// Four questions per checkpoint: no, no, no, yes — then the sentence. Enter is no.
const UNBLOCK = Array.from({ length: 12 }, () => "\n\n\ny\nAOS-TEST-UNBLOCK proceed\n").join("");

const cycleRun = (cwd, plan, { profile = "needs-instruction", answers = UNBLOCK } = {}) =>
  spawnSync(process.execPath, [cli, "cycle", "run", "--plan", plan, "--checkpoints"], {
    cwd,
    encoding: "utf8",
    input: answers,
    timeout: 300000,
    env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: profile, FAKE_AGENT_MODEL: FIXTURE_MODEL }
  });

const cycleOf = (home) => JSON.parse(readFileSync(join(home, "cycle.json"), "utf8"));

test("the seeds are fixed when the cycle opens, and a second open is refused", () => {
  const { cwd, home } = opened();
  try {
    assert.deepEqual(cycleOf(home).seeds, SEEDS);
    // Without this a cycle is "run twenty and keep the best three" one loop away.
    const again = spawnSync(process.execPath, [cli, "cycle", "start", "--seed", "00000000000000ff", "--seed", "00000000000000fe", "--seed", "00000000000000fd"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home }
    });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already open/);
    assert.deepEqual(cycleOf(home).seeds, SEEDS, "the seeds changed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a cycle needs three seeds and they have to be different", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-cycle-short-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const short = spawnSync(process.execPath, [cli, "cycle", "start", "--runs", "2"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.notEqual(short.status, 0);
    assert.match(short.stderr, /AOS_CYCLE_TOO_SHORT/);

    const duplicated = spawnSync(process.execPath, [cli, "cycle", "start", "--seed", "1", "--seed", "1", "--seed", "2"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.notEqual(duplicated.status, 0);
    assert.match(duplicated.stderr, /AOS_CYCLE_DUPLICATE_SEEDS/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("each run takes the next locked seed, and a seed that produced a result is closed", () => {
  const { cwd, plan, home } = opened();
  try {
    const first = cycleRun(cwd, plan);
    assert.match(first.stdout, new RegExp(`seed ${SEEDS[0]}`));
    assert.equal(cycleOf(home).runs.length, 1);
    assert.equal(cycleOf(home).runs[0].seed, SEEDS[0]);

    const second = cycleRun(cwd, plan);
    assert.match(second.stdout, new RegExp(`seed ${SEEDS[1]}`), "it should move on, not repeat");
    assert.deepEqual(cycleOf(home).runs.map((entry) => entry.seed), SEEDS.slice(0, 2));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the cycle command quotes the stored decision rather than deriving its own", () => {
  // The other half of the rule the dashboard is tested for: both surfaces read the decision made
  // when the cycle was written, and a sentinel in the stored lines is how that is checked, because
  // a derived line cannot contain one.
  //
  // Over a legacy cycle, because that is the surface this decision still serves after #559: a
  // cycle of profile results has no aggregate to decide (#563 owns defining one) and the command
  // returns before reading it. A legacy cycle is what an operator's store already holds.
  const { cwd, home } = opened();
  const stored = cycleOf(home);
  const legacy = {
    ...stored,
    runs: [{
      seed: stored.seeds[0], run_id: "run-legacy", result_schema: "aos-mvp-result.v1",
      profile_digest: stored.profile_digest, suite_major: stored.suite_major, scorer_major: stored.scorer_major,
      failure: null, terminal_committed: true, issued: true, final_score: 74, dimensions: { D1: 80 },
      valid: true, invalid_reason: null, model_identity: null
    }],
    decision: {
      ...stored.decision,
      model_identity: { ...stored.decision.model_identity, lines: ["SENTINEL_FROM_THE_STORED_CYCLE"] }
    }
  };
  writeFileSync(join(home, "cycle.json"), `${JSON.stringify(legacy, null, 2)}\n`);
  const printed = spawnSync(process.execPath, [cli, "cycle"], {
    cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home }
  });
  assert.match(printed.stdout, /SENTINEL_FROM_THE_STORED_CYCLE/u);
  assert.equal(/Model \(solo\)/u.test(printed.stdout), false, "the command derived its own lines");
  rmSync(cwd, { recursive: true, force: true });
});

test("three attended runs of the new instrument are recorded, and the cycle withholds an aggregate rather than borrowing the old one", () => {
  // The locked cycle still runs three seeds and records three distinct runs. What it does not do
  // is produce a number: re-deriving the legacy scorer's score from a profile run's observations
  // would be a number about the new run under an instrument that never measured it, and averaging
  // three of those would put the old model beside the new one. #563 owns saying what a cycle of
  // profiles aggregates to, and until it does the command says whose question it is.
  //
  // What #561 still owns here is admission: every run has to land on the cohort key the cycle
  // locked, or it is not one of the three.
  const { cwd, plan, home } = opened();
  try {
    for (let index = 0; index < 3; index += 1) {
      const output = cycleRun(cwd, plan).stdout;
      assert.match(output, /#563/u, "the run said nothing about why there is no cycle number");
      assert.equal(/^recorded: \d+$/m.test(output), false, "a legacy score was recomputed for a profile run");
    }
    const stored = cycleOf(home);
    assert.equal(stored.runs.length, 3);
    assert.equal(new Set(stored.runs.map((entry) => entry.run_id)).size, 3, "a run id was recorded twice");
    assert.deepEqual(stored.runs.map((entry) => entry.result_schema), ["aos-result.v2", "aos-result.v2", "aos-result.v2"]);
    // Nothing in the ledger carries a number for these runs, which is what stops one being averaged.
    assert.deepEqual(stored.runs.map((entry) => entry.final_score), [null, null, null]);
    for (const entry of stored.runs) assert.deepEqual(entry.dimensions, {});

    const report = spawnSync(process.execPath, [cli, "cycle", "--json"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home }
    });
    assert.equal(report.status, 1);
    const summary = JSON.parse(report.stdout);
    assert.equal(summary.aggregate, null);
    assert.equal(summary.complete, false);
    assert.equal(summary.result_schema, "aos-result.v2");
    assert.match(summary.withheld_reason, /AOS_CYCLE_AGGREGATION_UNDEFINED/u);
    assert.match(summary.withheld_reason, /#563/u);
    // Admission, which is #561's half: every run landed on the cohort key the cycle locked, so
    // nothing was excluded as PROFILE_CHANGED. What each run *is* under the legacy validity rule is
    // #563's question -- a profile result issues no legacy score, so that rule calls it NOT_ISSUED
    // and no aggregate follows from it either way.
    for (const entry of stored.runs) {
      assert.equal(entry.profile_digest.replace(/^sha256:/u, ""), stored.profile_digest.replace(/^sha256:/u, ""));
      assert.notEqual(entry.invalid_reason, "PROFILE_CHANGED");
    }
    assert.equal(summary.seeds.length, 3);
    assert.equal(Object.hasOwn(summary, "operator_score"), false);

    const printed = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home } });
    assert.equal(printed.stdout.includes("Operator Score"), false);
    assert.equal(/\b\d+ \/ 100\b/u.test(printed.stdout), false);
    assert.match(printed.stdout, /#563/u);
    // Each run's own report still says everything the run found; the cycle is what has no number.
    for (const entry of stored.runs) assert.match(printed.stdout, new RegExp(entry.run_id, "u"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an unattended run is recorded as the run it was, and the cycle still has no number to withhold it from", () => {
  // The monitoring metrics stay empty without an operator turn, so the run's own profiles say so.
  // The cycle records it either way: the ledger's job is to say which runs happened under which
  // seeds, and since #559 it has no score of its own to exclude a run from.
  const { cwd, plan, home } = opened();
  try {
    cycleRun(cwd, plan, { answers: "" });
    const stored = cycleOf(home);
    assert.equal(stored.runs.length, 1);
    assert.equal(stored.runs[0].result_schema, "aos-result.v2");
    assert.equal(stored.runs[0].final_score, null);

    const report = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home } });
    assert.match(report.stdout, /0000000000000011/u);
    assert.match(report.stdout, /AOS_CYCLE_AGGREGATION_UNDEFINED/u);
    assert.equal(report.stdout.includes("Operator Score"), false);
    assert.notEqual(report.status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("running when every seed is spent says so instead of inventing a fourth", () => {
  const { cwd, plan, home } = opened();
  try {
    for (let index = 0; index < 3; index += 1) cycleRun(cwd, plan);
    const extra = cycleRun(cwd, plan);
    assert.match(extra.stdout, /nothing left to run/);
    assert.equal(cycleOf(home).runs.length, 3, "a fourth run was recorded");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the report never calls repetition confidence, and never calls a withheld aggregate anything else", () => {
  // Three runs on one machine would say how much a measurement moved when it was repeated, and
  // nothing about how it would move anywhere else -- so the word was never "confidence". There is
  // no repeat number at all now, and the page says that in those words rather than in softer ones.
  const { cwd, plan, home } = opened();
  try {
    for (let index = 0; index < 3; index += 1) cycleRun(cwd, plan);
    const report = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home } });
    assert.match(report.stdout, /PROFILE-BOUND/u);
    assert.equal(/confidence/i.test(report.stdout), false);
    assert.equal(/stability|spread|deviation|local repeat evidence/i.test(report.stdout), false, "a repeat statistic was printed over runs nothing aggregated");
    assert.match(report.stdout, /#563/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
