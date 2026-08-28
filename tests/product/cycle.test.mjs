import assert from "node:assert/strict";
import test from "node:test";

import {
  INFRASTRUCTURE_FAILURES,
  aggregateCycle,
  createCycle,
  mayRerun,
  median,
  medianAbsoluteDeviation,
  recordRun,
  repeatEvidence,
  runValidity,
  stabilityOf
} from "../../lib/cycle.mjs";

const cycleOf = (seeds = ["1", "2", "3"]) =>
  createCycle({ profileDigest: "sha256:profile", suiteMajor: 1, scorerMajor: 1, seeds });

const runOf = (seed, over = {}) => ({
  seed,
  profile_digest: "sha256:profile",
  suite_major: 1,
  scorer_major: 1,
  terminal_committed: true,
  issued: true,
  failure: null,
  final_score: 70,
  dimensions: { D1: 80, D2: 70, D3: 60, D4: 70, D5: 75, D6: 65 },
  ...over
});

const withRuns = (runs, seeds = ["1", "2", "3"]) => runs.reduce((cycle, run) => recordRun(cycle, run), cycleOf(seeds));

test("the seeds are fixed when the cycle is created", () => {
  // A cycle that could draw a fresh seed later is one whose owner can retry until the scenario
  // suits them.
  const cycle = cycleOf();
  assert.deepEqual(cycle.seeds, ["0000000000000001", "0000000000000002", "0000000000000003"]);
  assert.throws(() => recordRun(cycle, runOf("00000000000000ff")), /AOS_CYCLE_UNKNOWN_SEED/);
});

test("a cycle needs at least three runs and distinct seeds", () => {
  assert.throws(() => createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, runs: 2 }), /AOS_CYCLE_TOO_SHORT/);
  // #485: one error stood for three different problems and named none of them. Each now says which
  // condition failed and which seed caused it, because the operator has to be able to fix it.
  const cycle = (seeds, runs) => () => createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, seeds, runs });
  // Named in its normalised form, which is how the seed is written everywhere else.
  assert.throws(cycle(["1", "1", "2"]), /AOS_CYCLE_DUPLICATE_SEEDS 0000000000000001;/);
  assert.throws(cycle(["1", "2", "zz"]), /AOS_CYCLE_SEED_SHAPE zz; a seed is 1 to 16 hex characters/);
  // Every seed valid, but there are two of them and three runs were asked for. This was the case
  // that made the single error most misleading: nothing about any seed was wrong.
  assert.throws(cycle(["aaaa", "bbbb"], 3), /AOS_CYCLE_SEED_COUNT 2 seed\(s\) given for --runs 3/);
  // A sha256 is the shape an operator reaches for, because it is what the rest of this tool prints.
  assert.throws(cycle(["a".repeat(64), "b".repeat(64), "c".repeat(64)]), /not a sha256/);
  assert.throws(() => createCycle({ suiteMajor: 1, scorerMajor: 1 }), /AOS_CYCLE_NO_PROFILE/);
});

test("a seed that produced a result cannot be run again", () => {
  // This refusal is the whole mechanism. Without it, "run twenty and keep the best three" is one
  // loop away.
  const once = withRuns([runOf("0000000000000001", { final_score: 40 })]);
  assert.equal(mayRerun(once, "0000000000000001"), false);
  assert.throws(() => recordRun(once, runOf("0000000000000001", { final_score: 95 })), /AOS_CYCLE_SEED_ALREADY_RUN/);
});

test("a low score is not an invalid run", () => {
  // The one thing an operator would most want to call invalid, and the one thing that never is.
  const low = runOf("0000000000000001", { final_score: 12 });
  assert.equal(runValidity(cycleOf(), low).valid, true);
  assert.equal(mayRerun(withRuns([low]), "0000000000000001"), false);
});

test("only a failure of the instrument allows the same seed again", () => {
  for (const failure of INFRASTRUCTURE_FAILURES) {
    const crashed = withRuns([runOf("0000000000000001", { failure, issued: false, terminal_committed: false })]);
    assert.equal(mayRerun(crashed, "0000000000000001"), true, failure);
    assert.doesNotThrow(() => recordRun(crashed, runOf("0000000000000001")), failure);
  }
  // A run that finished and simply was not issued is not an instrument failure, and its seed closes.
  const unissued = withRuns([runOf("0000000000000001", { issued: false })]);
  assert.equal(mayRerun(unissued, "0000000000000001"), false);
});

test("a run from another profile, suite or scorer is not this cycle's run", () => {
  // Aggregating it would average two different measurements into one number.
  const cycle = cycleOf();
  for (const [field, value, reason] of [
    ["profile_digest", "sha256:other", "PROFILE_CHANGED"],
    ["suite_major", 2, "SUITE_MAJOR_CHANGED"],
    ["scorer_major", 2, "SCORER_MAJOR_CHANGED"],
    ["terminal_committed", false, "NO_TERMINAL"]
  ]) {
    const check = runValidity(cycle, runOf("0000000000000001", { [field]: value }));
    assert.equal(check.valid, false, field);
    assert.equal(check.reason, reason, field);
  }
});

test("the operator score is the median of every valid run, not the best of them", () => {
  const cycle = withRuns([
    runOf("0000000000000001", { final_score: 30 }),
    runOf("0000000000000002", { final_score: 60 }),
    runOf("0000000000000003", { final_score: 90 })
  ]);
  const aggregate = aggregateCycle(cycle);
  assert.equal(aggregate.operator_score, 60);
  assert.equal(aggregate.valid_runs, 3);
  assert.equal(aggregate.spread, 60);
});

test("every valid run is counted, not the best of them", () => {
  // The defect this whole file exists to prevent: run several, keep the good ones, take the median.
  // With three runs "all of them" and "the best three" are the same set, so the fixture has five --
  // all runs median 30, best three median 90.
  const seeds = ["1", "2", "3", "4", "5"];
  const cycle = seeds.reduce(
    (acc, seed, index) => recordRun(acc, runOf(acc.seeds[index], { final_score: [10, 20, 30, 90, 95][index] })),
    createCycle({ profileDigest: "sha256:profile", suiteMajor: 1, scorerMajor: 1, runs: 5, seeds })
  );
  const aggregate = aggregateCycle(cycle);
  assert.equal(aggregate.valid_runs, 5);
  assert.equal(aggregate.operator_score, 30, "the worst runs were dropped from the median");
  assert.notEqual(aggregate.operator_score, 90);
  assert.equal(aggregate.spread, 85);
});

test("a dimension is the median of that dimension, not of the totals", () => {
  const cycle = withRuns([
    runOf("0000000000000001", { dimensions: { D1: 10, D5: 90 } }),
    runOf("0000000000000002", { dimensions: { D1: 50, D5: 50 } }),
    runOf("0000000000000003", { dimensions: { D1: 90, D5: 10 } })
  ]);
  const aggregate = aggregateCycle(cycle);
  assert.equal(aggregate.dimensions.D1, 50);
  assert.equal(aggregate.dimensions.D5, 50);
  assert.equal(aggregate.dimensions.D3, null, "a dimension nobody reported is not a zero");
});

test("an excluded run is named with its reason", () => {
  // A cycle that quietly dropped one would be indistinguishable from a cycle that never ran it.
  const cycle = withRuns([
    runOf("0000000000000001", { failure: "AOS_INTERNAL_ERROR", issued: false, terminal_committed: false }),
    runOf("0000000000000002", { final_score: 70 })
  ]);
  const aggregate = aggregateCycle(cycle);
  assert.deepEqual(aggregate.excluded, [{ seed: "0000000000000001", reason: "AOS_INTERNAL_ERROR" }]);
  assert.equal(aggregate.valid_runs, 1);
});

test("fewer than three valid runs is no operator score", () => {
  const cycle = withRuns([runOf("0000000000000001"), runOf("0000000000000002")]);
  const aggregate = aggregateCycle(cycle);
  assert.equal(aggregate.operator_score, null);
  assert.equal(aggregate.complete, false);
});

test("median and deviation are what they say they are", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5, "an even count takes the mean of the middle two");
  assert.equal(medianAbsoluteDeviation([10, 10, 10]), 0);
  assert.equal(medianAbsoluteDeviation([0, 10, 20]), 10);
  assert.equal(medianAbsoluteDeviation([]), null);
});

test("stability is read off the deviation, not the spread", () => {
  // One outlier moves the spread a long way and the median deviation hardly at all, which is the
  // point of using it.
  assert.equal(stabilityOf(0), "STABLE");
  assert.equal(stabilityOf(5), "STABLE");
  assert.equal(stabilityOf(6), "VARIABLE");
  assert.equal(stabilityOf(10), "VARIABLE");
  assert.equal(stabilityOf(11), "UNSTABLE");
  assert.equal(stabilityOf(null), "UNKNOWN");
});

test("repeat evidence is about repetition, and is never called confidence", () => {
  // One operator on one machine repeating a local suite. The word confidence would import a
  // statistical claim nothing here supports.
  assert.equal(repeatEvidence(2, 0), "NONE");
  assert.equal(repeatEvidence(3, 20), "LOW");
  assert.equal(repeatEvidence(5, 10), "MEDIUM");
  assert.equal(repeatEvidence(5, 11), "LOW", "a variable set of five is not medium evidence");
  assert.equal(repeatEvidence(7, 5), "HIGH");
  assert.equal(repeatEvidence(7, 6), "MEDIUM");

  const aggregate = aggregateCycle(withRuns([runOf("0000000000000001"), runOf("0000000000000002"), runOf("0000000000000003")]));
  assert.equal(Object.hasOwn(aggregate, "local_repeat_evidence"), true);
  assert.equal(JSON.stringify(aggregate).toLowerCase().includes("confidence"), false);
});
