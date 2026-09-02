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
  // The other half of the same rule the dashboard is tested for. Both surfaces read the decision
  // that was made when the cycle was written; a sentinel in the stored lines is how that is
  // checked, because a derived line cannot contain one.
  const { cwd, home } = opened();
  const stored = cycleOf(home);
  const decision = stored.decision;
  writeFileSync(join(home, "cycle.json"), `${JSON.stringify({
    ...stored,
    decision: { ...decision, model_identity: { ...decision.model_identity, lines: ["SENTINEL_FROM_THE_STORED_CYCLE"] } }
  }, null, 2)}\n`);
  const printed = spawnSync(process.execPath, [cli, "cycle"], {
    cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home }
  });
  assert.match(printed.stdout, /SENTINEL_FROM_THE_STORED_CYCLE/u);
  assert.equal(/Model \(solo\)/u.test(printed.stdout), false, "the command derived its own lines");
  rmSync(cwd, { recursive: true, force: true });
});

test("three attended runs produce an operator score, and it is the median of all of them", () => {
  // The whole point of the locked cycle: every valid run counts, including a low one.
  const { cwd, plan, home } = opened();
  try {
    const printedScores = [];
    for (let index = 0; index < 3; index += 1) {
      const output = cycleRun(cwd, plan).stdout;
      const score = /^Score: (\d+) \//m.exec(output);
      if (score) printedScores.push(Number(score[1]));
    }
    const report = spawnSync(process.execPath, [cli, "cycle", "--json"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home }
    });
    const summary = JSON.parse(report.stdout);
    assert.equal(summary.valid_runs, 3, JSON.stringify(summary.excluded));
    assert.equal(summary.complete, true);
    // The reason travels with the failure: a withheld aggregate is a named state, and a bare
    // "object !== number" on another machine says nothing about which half of the profile failed.
    assert.equal(typeof summary.operator_score, "number", JSON.stringify(summary.profile_bound_aggregation));
    assert.equal(summary.seeds.length, 3);

    // Against what the runs printed, not against what the ledger stored. Reading the expectation
    // out of the ledger made this pass while every seed was recorded with the first run's score --
    // three copies of one number, and a median assertion that could not see it.
    assert.equal(new Set(cycleOf(home).runs.map((entry) => entry.run_id)).size, 3, "a run id was recorded twice");
    const printed = [...printedScores].sort((a, b) => a - b);
    assert.equal(printed.length, 3, `saw ${printed.length} scores in the output`);
    assert.deepEqual(cycleOf(home).runs.map((entry) => entry.final_score).sort((a, b) => a - b), printed);
    assert.equal(summary.operator_score, printed[1], "the middle of three, not the best of them");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an unattended run is not a run in this cycle, and says why", () => {
  // D4 stays empty without an operator turn, so the score is withheld and the run cannot count.
  // Excluding it silently would make a cycle that dropped one indistinguishable from one that
  // never ran it.
  const { cwd, plan, home } = opened();
  try {
    cycleRun(cwd, plan, { answers: "" });
    const stored = cycleOf(home);
    assert.equal(stored.runs.length, 1);
    assert.equal(stored.runs[0].valid, false);
    assert.equal(stored.runs[0].invalid_reason, "NOT_ISSUED");

    const report = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home } });
    assert.match(report.stdout, /not counted: 0000000000000011 — NOT_ISSUED/);
    assert.match(report.stdout, /Operator Score withheld/);
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

test("the report never calls repetition confidence", () => {
  // Three runs on one machine say how much this measurement moved when it was repeated, and
  // nothing about how it would move anywhere else.
  const { cwd, plan, home } = opened();
  try {
    for (let index = 0; index < 3; index += 1) cycleRun(cwd, plan);
    const report = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home } });
    assert.match(report.stdout, /local repeat evidence/);
    assert.match(report.stdout, /PROFILE-BOUND/);
    assert.equal(/confidence/i.test(report.stdout), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
