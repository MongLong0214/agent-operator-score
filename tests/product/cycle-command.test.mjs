import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addAgent, makePlan, run } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const SEEDS = ["0000000000000011", "0000000000000012", "0000000000000013"];

const opened = () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-cycle-"));
  run(cwd, ["init"]);
  addAgent(cwd, "solo");
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
    env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: profile }
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

test("three attended runs are three distinct runs, and the cycle says why none of them counted", () => {
  // Every run of the locked cycle is recorded under its own id and its own seed. What the cycle
  // may then say about them is the confinement gate's to decide: #556 stopped a run on a lane that
  // is not official from carrying an issued number, and a cycle whose runs carry none has no
  // median to take. Excluding them silently would make that indistinguishable from a cycle that
  // never ran. The median arithmetic itself is exercised in tests/product/cycle.test.mjs, where
  // issued runs can be constructed without a boundary this host cannot provide.
  const { cwd, plan, home } = opened();
  try {
    for (let index = 0; index < 3; index += 1) {
      const output = cycleRun(cwd, plan).stdout;
      assert.match(output, /RUN_DIAGNOSTIC: not an official profile-bound result — AOS_ISOLATION_/);
    }
    const report = spawnSync(process.execPath, [cli, "cycle", "--json"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home }
    });
    const summary = JSON.parse(report.stdout);
    assert.equal(summary.seeds.length, 3);
    assert.equal(summary.valid_runs, 0, JSON.stringify(summary.excluded));
    assert.equal(summary.complete, false);
    assert.equal(summary.operator_score, null);
    assert.equal(summary.excluded.length, 3);

    // Read from the ledger, which is where a run id being recorded twice would show: three runs,
    // three ids, three seeds, none of them scored.
    assert.equal(new Set(cycleOf(home).runs.map((entry) => entry.run_id)).size, 3, "a run id was recorded twice");
    assert.deepEqual(cycleOf(home).runs.map((entry) => entry.final_score), [null, null, null]);
    assert.deepEqual(cycleOf(home).runs.map((entry) => entry.invalid_reason), ["NOT_ISSUED", "NOT_ISSUED", "NOT_ISSUED"]);
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
  // nothing about how it would move anywhere else. The word is forbidden on both of the cycle's
  // pages -- the one with a score on it and the one that says why there is none -- and on this
  // host it is the second, because the runs were not issued on a lane that could be official.
  const { cwd, plan, home } = opened();
  try {
    for (let index = 0; index < 3; index += 1) cycleRun(cwd, plan);
    const report = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: home } });
    assert.match(report.stdout, /Operator Score withheld/);
    assert.match(report.stdout, /not counted: .* — NOT_ISSUED/);
    assert.equal(/confidence/i.test(report.stdout), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
