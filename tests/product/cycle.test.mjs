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
import { ADMINISTRATION_CLASSIFICATION_SCHEMA_ID, markRevealed, openExposureLedger, recordExposure, reserveExposure } from "../../lib/form-class.mjs";

// #585 item 1 (this round). `runIdFor`/`formDigestFor` are the one derivation every fixture below
// uses, so a run and the ledger entry meant to back it genuinely share an identity the way `assess`
// does in production -- naming the same `runId` on the run record, on the ledger entry
// `reserveExposure`/`recordExposure` commit under `administration_id`, and (when one is attached at
// all) on the cached `form_classification`.
const runIdFor = (seed) => `run-${seed}`;
const formDigestFor = (seed) => `form-digest-${seed}`;

// A minimal but genuinely tagged classification, the shape `classifyAdministration` actually
// returns. It no longer authorizes VERIFIED on its own -- see the tests below -- but `runValidity`
// still reads its `official_scoring_permitted`/`refusal_code` to decide whether a run counts at
// all, so fixtures that mean to exercise that path still carry one.
const classification = (seed, permitted, overrides = {}) => ({
  schema_id: ADMINISTRATION_CLASSIFICATION_SCHEMA_ID,
  official_scoring_permitted: permitted,
  run_id: runIdFor(seed),
  administration_id: runIdFor(seed),
  form_contract_digest: formDigestFor(seed),
  ...overrides
});

// #585 item 1 (this round). The ledger entry `exposureVerification` now looks up by
// `administration_id === run.run_id`. Only the four fields that function actually reads are given
// values here (`administration_id`, `form_contract_digest`, `state`, `administered_class`); a
// dedicated integration test further down builds a real one through `reserveExposure` and
// `recordExposure` (lib/form-class.mjs) instead of by hand, to prove those functions and this one
// actually agree on the shape.
const ledgerEntry = (seed, { administeredClass = "OPERATIONAL", administrationId = runIdFor(seed), formContractDigest = formDigestFor(seed), state = "TERMINAL" } = {}) => ({
  administration_id: administrationId,
  form_contract_digest: formContractDigest,
  state,
  declared_class: "OPERATIONAL",
  prior_exposure_count: 0,
  prior_scored_count: 0,
  administered_class: administeredClass
});
const ledgerOf = (entries) => ({ entries });

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

const withRuns = (runs, seeds = ["1", "2", "3"], options = {}) => runs.reduce((cycle, run) => recordRun(cycle, run, options), cycleOf(seeds));

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

// ---------------------------------------------------------------------------------------------
// #585 item 1 (this round). `exposureVerification` never read the exposure ledger at all: it
// compared `run.form_classification`'s fields against other fields on that same run record --
// `cycle.json`, a plain, operator-editable file. Three review rounds "fixed" the self-approval by
// adding one more field comparison, and each next round defeated the new comparison by filling in
// one more field on the same hand-written object. No amount of comparing `cycle.json` against
// itself closes that hole, because every field on both sides of the comparison is one the operator
// already controls. The tests below replace that whole scheme: `exposureVerification` now looks
// up the administration in the exposure ledger -- evidence a `cycle.json` editor cannot also forge,
// because `openExposureLedger` (lib/form-class.mjs) recomputes and checks the ledger's own
// transition-digest chain before anything here trusts an entry from it -- and answers from what
// the ledger's own committed entry says, never from the stored record alone.

test("exposureVerification names the third state a permitted run and a pre-ledger run used to share", () => {
  // #632's collapse, a sixth time: `runValidity` returned the identical {valid: true, reason: null}
  // for a run the exposure ledger checked and permitted and for a run it never saw at all. Three
  // decisions, three words -- the same shape `capabilityProbeGeneration` uses for a probe record's
  // generation -- and no run with a real ledger entry may read as the pre-ledger case or back.
  assert.deepEqual([...EXPOSURE_VERIFICATION_STATUSES], ["VERIFIED", "REFUSED", "UNVERIFIED"]);
  // No ledger at all: a caller with no AOS home available. UNVERIFIED, never a promotion earned by
  // what the run's own record claims about itself.
  assert.deepEqual(exposureVerification({ form_classification: null }), { decision: null, status: "UNVERIFIED" });
  assert.deepEqual(exposureVerification({}), { decision: null, status: "UNVERIFIED" });

  const seed = "0000000000000001";
  const permittedLedger = ledgerOf([ledgerEntry(seed, { administeredClass: "OPERATIONAL" })]);
  assert.deepEqual(
    exposureVerification({ ...runOf(seed), form_classification: classification(seed, true) }, { ledger: permittedLedger }),
    { decision: true, status: "VERIFIED" }
  );
  const refusedLedger = ledgerOf([ledgerEntry(seed, { administeredClass: "PRACTICE" })]);
  assert.deepEqual(
    exposureVerification({ ...runOf(seed), form_classification: classification(seed, false, { refusal_code: "AOS_FORM_ALREADY_EXPOSED" }) }, { ledger: refusedLedger }),
    { decision: false, status: "REFUSED" }
  );
  // The ledger's own administered_class is what decides REFUSED here, on its own -- no stored
  // classification is present on this run at all, so nothing but the entry's own
  // `administered_class` could be answering this.
  assert.deepEqual(exposureVerification(runOf(seed), { ledger: refusedLedger }), { decision: false, status: "REFUSED" });
});

test("a hand-written cycle.json -- internally consistent, no ledger entry behind it -- does not reach VERIFIED", () => {
  // This is the point of this task. Every field below agrees with every other field on the same
  // object: the schema tag `classifyAdministration` actually stamps, a genuine boolean, and a
  // run_id/administration_id/form_contract_digest binding that all name this exact run -- exactly
  // what three prior review rounds each added and each had defeated by the next hand-written
  // object that also carried it. What that object cannot also produce is a ledger entry: `ledger`
  // below is a REAL exposure ledger, opened with `openExposureLedger` (lib/form-class.mjs) the same
  // way `lib/cli.mjs` opens the one on disk, carrying one genuine administration for a different
  // form and nothing at all under this run's own id.
  const seed = "0000000000000001";
  const run = {
    ...runOf(seed),
    form_classification: {
      schema_id: ADMINISTRATION_CLASSIFICATION_SCHEMA_ID,
      official_scoring_permitted: true,
      run_id: runIdFor(seed),
      administration_id: runIdFor(seed),
      form_contract_digest: formDigestFor(seed),
      administered_class: "OPERATIONAL",
      refusal_code: null,
      reasons: []
    }
  };
  const empty = openExposureLedger(undefined);
  const unrelatedLedger = reserveExposure(empty, {
    form_id: "some-other-form",
    form_contract_digest: `sha256:${"a".repeat(64)}`,
    declared_class: "OPERATIONAL",
    administration_id: "a-completely-different-administration",
    occurred_at: "2026-01-01T00:00:00.000Z"
  }).ledger;

  const withNoLedgerAtAll = exposureVerification(run);
  assert.deepEqual(withNoLedgerAtAll, { decision: null, status: "UNVERIFIED" }, "no ledger available must not promote the stored record");

  const withARealButUnrelatedLedger = exposureVerification(run, { ledger: unrelatedLedger });
  assert.deepEqual(withARealButUnrelatedLedger, { decision: null, status: "UNVERIFIED" }, "a hand-written classification with no backing ledger entry reached VERIFIED");
  assert.notEqual(withARealButUnrelatedLedger.status, "VERIFIED");

  // And `runValidity`/`recordRun` -- the only two callers that ever stamp `exposure_verification`
  // onto a stored run -- inherit the same refusal rather than deriving their own opinion of it.
  const cycle = cycleOf([seed, "0000000000000002", "0000000000000003"]);
  const validity = runValidity(cycle, run, { ledger: unrelatedLedger });
  assert.equal(validity.exposure.status, "UNVERIFIED");
  const recorded = recordRun(cycle, run, { ledger: unrelatedLedger });
  assert.equal(recorded.runs[0].exposure_verification, "UNVERIFIED");
});

test("exposureVerification builds VERIFIED from a real ledger entry, made through reserveExposure and recordExposure, not by hand", () => {
  // Everything above uses a hand-rolled ledger entry naming only the four fields
  // `exposureVerification` reads. This proves the real functions that ever write such an entry --
  // `reserveExposure` then `recordExposure` (lib/form-class.mjs), exactly as `lib/cli.mjs`'s
  // `assess` calls them -- produce something this function actually accepts as VERIFIED, and that a
  // seed the ledger never saw stays UNVERIFIED even sitting right beside one it did.
  const runId = "run-real-ledger";
  const formContractDigest = `sha256:${"7".repeat(64)}`;
  const reserved = reserveExposure(openExposureLedger(undefined), {
    form_id: "FAM-1",
    form_contract_digest: formContractDigest,
    declared_class: "OPERATIONAL",
    administration_id: runId,
    occurred_at: "2026-01-01T00:00:00.000Z"
  });
  const revealed = markRevealed(reserved.ledger, { administration_id: runId, occurred_at: "2026-01-01T00:00:01.000Z" });
  const finalized = recordExposure(revealed.ledger, {
    form_id: "FAM-1",
    form_contract_digest: formContractDigest,
    declared_class: "OPERATIONAL",
    administered_class: "OPERATIONAL",
    administration_id: runId,
    occurred_at: "2026-01-01T00:05:00.000Z",
    run_id: runId,
    scored: true
  });

  const run = { run_id: runId, form_contract_digest: formContractDigest };
  assert.deepEqual(exposureVerification(run, { ledger: finalized.ledger }), { decision: true, status: "VERIFIED" });

  // A different run, one the ledger never reserved or finalized anything for, stays UNVERIFIED
  // even though it is checked against the very same ledger object.
  const neverAdministered = { run_id: "run-never-administered", form_contract_digest: formContractDigest };
  assert.deepEqual(exposureVerification(neverAdministered, { ledger: finalized.ledger }), { decision: null, status: "UNVERIFIED" });

  // And a run naming a different form contract digest than the one the ledger actually recorded
  // under this exact administration id is refused, not silently trusted.
  const wrongDigest = { run_id: runId, form_contract_digest: `sha256:${"9".repeat(64)}` };
  assert.deepEqual(exposureVerification(wrongDigest, { ledger: finalized.ledger }), { decision: false, status: "REFUSED" });
});

test("exposure verification rederives scored-once eligibility despite an OPERATIONAL verdict on a replay", () => {
  const form = { form_id: "scored-once", form_contract_digest: `sha256:${"6".repeat(64)}`, declared_class: "OPERATIONAL" };
  let ledger = openExposureLedger(undefined);
  for (const id of ["first", "second"]) {
    ledger = reserveExposure(ledger, { ...form, administration_id: id, occurred_at: "2026-01-01T00:00:00.000Z" }).ledger;
    ledger = markRevealed(ledger, { administration_id: id, occurred_at: "2026-01-01T00:00:01.000Z" }).ledger;
    ledger = recordExposure(ledger, { ...form, administration_id: id, administered_class: "OPERATIONAL", scored: true, occurred_at: "2026-01-01T00:00:02.000Z" }).ledger;
  }
  const opened = openExposureLedger(ledger);
  assert.equal(opened.entries[1].prior_exposure_count, 1);
  assert.equal(opened.entries[1].administered_class, "OPERATIONAL");
  assert.deepEqual(exposureVerification({ run_id: "second", form_contract_digest: form.form_contract_digest }, { ledger: opened }),
    { decision: false, status: "REFUSED" }, "a repeated exposure cannot verify through its stored OPERATIONAL verdict");
  assert.deepEqual(exposureVerification({ run_id: "first", form_contract_digest: form.form_contract_digest }, { ledger: opened }),
    { decision: true, status: "VERIFIED" }, "later exposure must not retroactively disqualify the first administration");
  for (const declared of ["WARMUP", "PRACTICE", "TRANSFER"]) {
    const row = { ...ledgerEntry("1"), declared_class: declared };
    assert.equal(exposureVerification(runOf("1"), { ledger: ledgerOf([row]) }).decision, false);
  }
  for (const field of ["prior_exposure_count", "prior_scored_count"]) {
    for (const value of [undefined, null, -1, "0", 1]) {
      const row = { ...ledgerEntry("1"), [field]: value };
      assert.equal(exposureVerification(runOf("1"), { ledger: ledgerOf([row]) }).decision, value === 1 ? false : null,
        "missing or malformed prior exposure is unknown, not an observed refusal");
    }
  }
});

test("a stored classification that disagrees with the ledger's own verdict is refused, never trusted over it", () => {
  // The stored `form_classification` survives as a cached convenience, not a second authority. A
  // run whose own record claims `official_scoring_permitted: true` while the ledger's committed
  // entry for that exact administration says PRACTICE is a disagreement, and the disagreement is
  // resolved against the stored record, not in its favour.
  const seed = "0000000000000001";
  const ledgerSaysPractice = ledgerOf([ledgerEntry(seed, { administeredClass: "PRACTICE" })]);
  const runClaimsPermitted = { ...runOf(seed), form_classification: classification(seed, true) };
  assert.deepEqual(exposureVerification(runClaimsPermitted, { ledger: ledgerSaysPractice }), { decision: false, status: "REFUSED" });

  // And the reverse: the ledger says OPERATIONAL, the stored record claims it was refused. Still
  // never VERIFIED-by-disagreement in either caller's favour -- refused either way.
  const ledgerSaysOperational = ledgerOf([ledgerEntry(seed, { administeredClass: "OPERATIONAL" })]);
  const runClaimsRefused = { ...runOf(seed), form_classification: classification(seed, false, { refusal_code: "AOS_FORM_ALREADY_EXPOSED" }) };
  assert.deepEqual(exposureVerification(runClaimsRefused, { ledger: ledgerSaysOperational }), { decision: false, status: "REFUSED" });
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

  // And a v0.2 run the ledger did verify still counts -- now genuinely, from a real ledger entry.
  const ledger = ledgerOf([ledgerEntry(seed, { administeredClass: "OPERATIONAL" })]);
  const profileVerified = runOf(seed, { result_schema: "aos-result.v4", form_classification: classification(seed, true) });
  assert.equal(runValidity(cycleOf(), profileVerified, { ledger }).valid, true, "a verified v0.2 run was refused");
  assert.equal(runValidity(cycleOf(), profileVerified, { ledger }).exposure.status, "VERIFIED");
});

test("the shape of the stored classification no longer decides VERIFIED -- the ledger entry does", () => {
  // Before this round, an untagged object (`{official_scoring_permitted: true}`, no schema_id) or
  // one naming a different run/administration/form was refused down to UNVERIFIED by field checks
  // against the run record it sat on. Those checks are gone: the ledger is what decides now, so a
  // classification's own shape -- tagged or not, bound or not, even entirely absent -- no longer
  // matters to the answer. A genuinely matching ledger entry verifies a run with no
  // `form_classification` at all, and an untagged or wrongly-bound classification does not save a
  // run the ledger has no entry for.
  const seed = "0000000000000001";
  const permittedLedger = ledgerOf([ledgerEntry(seed, { administeredClass: "OPERATIONAL" })]);

  // No classification whatsoever: the ledger alone is enough.
  assert.deepEqual(exposureVerification(runOf(seed), { ledger: permittedLedger }), { decision: true, status: "VERIFIED" });

  // An untagged classification, or one copied from another run's identity, no longer refuses this
  // by itself -- but it also does not help a run with no matching ledger entry.
  const untagged = { official_scoring_permitted: true };
  const copiedFromAnotherRun = { ...classification(seed, true), run_id: runIdFor("0000000000000002"), administration_id: runIdFor("0000000000000002") };
  for (const forged of [untagged, copiedFromAnotherRun]) {
    assert.deepEqual(
      exposureVerification({ ...runOf(seed), form_classification: forged }, { ledger: permittedLedger }),
      { decision: true, status: "VERIFIED" },
      "a matching ledger entry verifies the run regardless of what its cached classification claims about itself"
    );
    assert.deepEqual(
      exposureVerification({ ...runOf(seed), form_classification: forged }),
      { decision: null, status: "UNVERIFIED" },
      "with no ledger to check, a forged classification's shape earns nothing"
    );
  }
});

test("a permitted run and a run the ledger has no entry for are both valid but not both verified, in the run record and the aggregate", () => {
  const ledger = ledgerOf([
    ledgerEntry("0000000000000001", { administeredClass: "OPERATIONAL" }),
    ledgerEntry("0000000000000003", { administeredClass: "OPERATIONAL" })
    // Seed 2's administration id is deliberately absent: this ledger has no entry for it, the same
    // fact a pre-ledger historical record represents, produced here by an administration this
    // ledger's home genuinely never saw rather than by the record predating the ledger's existence.
  ]);
  const verified = runOf("0000000000000001", { form_classification: classification("0000000000000001", true) });
  const unverified = runOf("0000000000000002"); // no ledger entry: this exact ledger never saw it
  const third = runOf("0000000000000003", { form_classification: classification("0000000000000003", true) });

  assert.equal(runValidity(cycleOf(), verified, { ledger }).exposure.status, "VERIFIED");
  assert.equal(runValidity(cycleOf(), unverified, { ledger }).exposure.status, "UNVERIFIED");

  const cycle = withRuns([verified, unverified, third], ["1", "2", "3"], { ledger });
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
