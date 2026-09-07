import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPOSURE_VERIFICATION_STATUSES,
  INFRASTRUCTURE_FAILURES,
  aggregateCycle,
  createCycle,
  exposureVerification,
  mayRerun,
  median,
  medianAbsoluteDeviation,
  recordRun,
  repeatEvidence,
  runValidity,
  stabilityOf
} from "../../lib/cycle.mjs";
import { ADMINISTRATION_CLASSIFICATION_SCHEMA_ID } from "../../lib/form-class.mjs";

// #585 item 2. `exposureVerification` now requires a classification to name the run, administration
// and form it sits on, checked against the run record itself -- see "a classification naming a
// different run..." below. `runIdFor`/`formDigestFor` are the one derivation both `runOf` and
// `classification` use, so a fixture built from the same seed on both sides genuinely binds, the
// way `assess` binds them in production by naming the same `runId` on the run record and on the
// classification it attaches (`lib/cli.mjs`'s `boundClassification`).
const runIdFor = (seed) => `run-${seed}`;
const formDigestFor = (seed) => `form-digest-${seed}`;

// A minimal but genuinely tagged classification, the shape `classifyAdministration` actually
// returns. `exposureVerification` refuses to authorize VERIFIED from an untagged object -- see
// "a stored classification must be tagged..." below -- so every fixture that means to be a real,
// ledger-checked classification uses this rather than a bare `{official_scoring_permitted}`, and
// binds to the seed's own run_id/form_contract_digest rather than leaving them absent.
const classification = (seed, permitted, overrides = {}) => ({
  schema_id: ADMINISTRATION_CLASSIFICATION_SCHEMA_ID,
  official_scoring_permitted: permitted,
  run_id: runIdFor(seed),
  administration_id: runIdFor(seed),
  form_contract_digest: formDigestFor(seed),
  ...overrides
});

const cycleOf = (seeds = ["1", "2", "3"]) =>
  createCycle({ profileDigest: "sha256:profile", suiteMajor: 1, scorerMajor: 1, seeds });

const runOf = (seed, over = {}) => ({
  seed,
  run_id: runIdFor(seed),
  form_contract_digest: formDigestFor(seed),
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
    assert.deepEqual(check.exposure, { decision: null, status: "UNVERIFIED" }, `${field}: every runValidity refusal carries an exposure state`);
  }
});

test("recordRun does not crash on a refusal decided before exposure classification runs", () => {
  // `runValidity` used to compute `exposure` only after the seed-membership and profile-digest
  // checks, so a PROFILE_CHANGED (or SEED_NOT_IN_CYCLE) refusal came back with no `exposure` key
  // at all. `recordRun` reads `validity.exposure.status` unconditionally to stamp the stored run,
  // so that refusal was a TypeError, not a recorded exclusion -- the seed then never made it onto
  // `cycle.runs` and stayed silently re-runnable. Every branch of `runValidity` must carry an
  // exposure state so `recordRun` can always read it.
  const cycle = cycleOf();
  const recorded = recordRun(cycle, runOf("0000000000000001", { profile_digest: "sha256:other" }));
  assert.equal(recorded.runs[0].valid, false);
  assert.equal(recorded.runs[0].invalid_reason, "PROFILE_CHANGED");
  assert.equal(recorded.runs[0].exposure_verification, "UNVERIFIED");
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

test("exposureVerification names the third state a permitted run and a pre-ledger run used to share", () => {
  // #632's collapse, a sixth time: `runValidity` returned the identical {valid: true, reason: null}
  // for a run the exposure ledger checked and permitted and for a run it never saw at all. Three
  // decisions, three words -- the same shape `capabilityProbeGeneration` uses for a probe record's
  // generation -- and no run with a real classification may read as the pre-ledger case or back.
  assert.deepEqual([...EXPOSURE_VERIFICATION_STATUSES], ["VERIFIED", "REFUSED", "UNVERIFIED"]);
  assert.deepEqual(exposureVerification({ form_classification: null }), { decision: null, status: "UNVERIFIED" });
  assert.deepEqual(exposureVerification({}), { decision: null, status: "UNVERIFIED" });
  const seed = "0000000000000001";
  assert.deepEqual(
    exposureVerification({ ...runOf(seed), form_classification: classification(seed, true) }),
    { decision: true, status: "VERIFIED" }
  );
  assert.deepEqual(
    exposureVerification({ ...runOf(seed), form_classification: classification(seed, false, { refusal_code: "AOS_FORM_ALREADY_EXPOSED" }) }),
    { decision: false, status: "REFUSED" }
  );
});

test("a v0.2 result whose exposure the ledger never verified is refused from the official aggregate", () => {
  // Governance directive 21. `valid_runs_exposure_unverified` NAMES the runs the ledger never saw,
  // but naming is not excluding: an UNVERIFIED run stayed valid and its score entered the median,
  // so a PROFILE_BOUND number could rest on administrations nothing verified were administered
  // once. The compatibility this preserves is for LEGACY records -- a run written before the
  // ledger existed keeps its historical validity, because the ledger cannot testify about
  // administrations it never saw and an absence is not a refusal. A v0.2 result is a different
  // claim: it was written by a build that has the ledger, so an exposure it cannot verify is a
  // gap in the evidence rather than a record from before the evidence existed.
  // The cycle normalises its seeds, so a run has to carry the stored form of one.
  const seed = cycleOf().seeds[0];
  const legacyPreLedger = runOf(seed, { result_schema: "aos-mvp-result.v1" });
  assert.equal(runValidity(cycleOf(), legacyPreLedger).exposure.status, "UNVERIFIED");
  assert.equal(runValidity(cycleOf(), legacyPreLedger).valid, true, "a pre-ledger legacy run lost its historical validity");

  const profileUnverified = runOf(seed, { result_schema: "aos-result.v4" });
  const verdict = runValidity(cycleOf(), profileUnverified);
  assert.equal(verdict.exposure.status, "UNVERIFIED");
  assert.equal(verdict.valid, false, "a v0.2 run the ledger never verified counted toward the official aggregate");
  assert.equal(verdict.reason, "AOS_EXPOSURE_UNVERIFIED_FOR_PROFILE_BOUND");

  // And a v0.2 run the ledger did verify still counts.
  const profileVerified = runOf(seed, { result_schema: "aos-result.v4", form_classification: classification(seed, true) });
  assert.equal(runValidity(cycleOf(), profileVerified).valid, true, "a verified v0.2 run was refused");
});

test("a stored classification must be tagged the way classifyAdministration actually tags one, or it is unverified", () => {
  // `form_classification` lives on `cycle.json`, a plain file. An untagged object carrying only
  // `official_scoring_permitted: true` used to authorize VERIFIED on its own say-so -- no
  // different from any other stored artifact approving itself. Absence and an untagged imitation
  // are different facts (one never saw the ledger, the other claims to but cannot prove it) and
  // this function answers both the same way: neither may authorize more than UNVERIFIED.
  assert.deepEqual(exposureVerification({ form_classification: { official_scoring_permitted: true } }), { decision: null, status: "UNVERIFIED" });
  // The right schema tag with the wrong type on the field it reads is just as untrustworthy.
  assert.deepEqual(exposureVerification({ form_classification: { schema_id: ADMINISTRATION_CLASSIFICATION_SCHEMA_ID, official_scoring_permitted: "true" } }), { decision: null, status: "UNVERIFIED" });
  // The genuine tag with a real boolean, bound to the run it sits on, is what actually authorizes
  // VERIFIED or REFUSED.
  const seed = "0000000000000001";
  assert.deepEqual(exposureVerification({ ...runOf(seed), form_classification: classification(seed, true) }), { decision: true, status: "VERIFIED" });
  assert.deepEqual(exposureVerification({ ...runOf(seed), form_classification: classification(seed, false) }), { decision: false, status: "REFUSED" });
});

test("a classification naming a different run, administration or form does not verify this one", () => {
  // #585 item 2. A schema tag and a real boolean are necessary but used to be treated as
  // SUFFICIENT to authorize VERIFIED -- exactly what a classification copied from another run's
  // `cycle.json` entry, or written by hand with only those two fields, also carries. None of the
  // three cases below is caught by the schema/type check above; each is refused only because the
  // identity it names does not match the run record it sits on.
  const seed = "0000000000000001";
  const run = runOf(seed);

  // The exact shape a copied classification takes: genuinely tagged, a real boolean, but naming
  // another administration's run entirely.
  const copiedFromAnotherRun = {
    ...classification(seed, true),
    run_id: runIdFor("0000000000000002"),
    administration_id: runIdFor("0000000000000002")
  };
  assert.deepEqual(exposureVerification({ ...run, form_classification: copiedFromAnotherRun }), { decision: null, status: "UNVERIFIED" });

  // Bound to the right run, but naming a different form -- a classification decided over a form
  // this run's own record never administered.
  const wrongForm = { ...classification(seed, true), form_contract_digest: formDigestFor("somewhere-else") };
  assert.deepEqual(exposureVerification({ ...run, form_classification: wrongForm }), { decision: null, status: "UNVERIFIED" });

  // The shape this repository actually shipped before this fix: a real schema tag and a real
  // boolean, and nothing at all naming which run it was ever a classification of. This is the
  // untagged-imitation test above's twin with the tag genuine -- the tag was never what was
  // missing.
  const noBindingAtAll = { schema_id: ADMINISTRATION_CLASSIFICATION_SCHEMA_ID, official_scoring_permitted: true };
  assert.deepEqual(exposureVerification({ ...run, form_classification: noBindingAtAll }), { decision: null, status: "UNVERIFIED" });

  // And the genuine, fully bound classification for this exact run still verifies.
  assert.deepEqual(exposureVerification({ ...run, form_classification: classification(seed, true) }), { decision: true, status: "VERIFIED" });
});

test("a permitted run and a pre-ledger run are both valid but not both verified, in the run record and the aggregate", () => {
  const verified = runOf("0000000000000001", { form_classification: classification("0000000000000001", true) });
  const unverified = runOf("0000000000000002"); // no form_classification: the historical, pre-ledger shape
  const third = runOf("0000000000000003", { form_classification: classification("0000000000000003", true) });

  assert.equal(runValidity(cycleOf(), verified).exposure.status, "VERIFIED");
  assert.equal(runValidity(cycleOf(), unverified).exposure.status, "UNVERIFIED");

  const cycle = withRuns([verified, unverified, third]);
  // Named on the stored run itself, not only derivable from it -- cycle.json now says which.
  assert.equal(cycle.runs.find((run) => run.seed === "0000000000000001").exposure_verification, "VERIFIED");
  assert.equal(cycle.runs.find((run) => run.seed === "0000000000000002").exposure_verification, "UNVERIFIED");
  assert.equal(cycle.runs.every((run) => run.valid), true, "all three still count toward the aggregate");

  // And the printed summary: three valid runs read identically as a count, so the one the ledger
  // never saw is named separately rather than folded into "3 valid run(s)".
  const aggregate = aggregateCycle(cycle);
  assert.equal(aggregate.valid_runs, 3);
  assert.deepEqual(aggregate.valid_runs_exposure_unverified, ["0000000000000002"]);
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
