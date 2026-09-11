import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPOSURE_VERIFICATION_STATUSES,
  INFRASTRUCTURE_FAILURES,
  aggregateCycle,
  createCycle,
  exposureVerification,
  formStateOf,
  mayRerun,
  median,
  medianAbsoluteDeviation,
  recordRun,
  repeatEvidence,
  requiredCoverageOf,
  runValidity,
  stabilityOf
} from "../../lib/cycle.mjs";
import { sha256Value } from "../../lib/core.mjs";
import {
  BLOCKED_CONTRACT_CHANGE,
  CONTRACT_DIGEST_FIELDS,
  CONTRACT_MISMATCH_REASONS,
  activeCycleDrift,
  contractLines,
  contractRecordOf,
  digestPrefix,
  forgetMeasurementContract,
  isLegacyCycle,
  measurementContract
} from "../../lib/contract-freeze.mjs";
import { LEGACY_RESULT_SCHEMA_ID, RESULT_SCHEMA_ID } from "../../lib/result-schema.mjs";
import { EXPOSURE_LEDGER_GENESIS_DIGEST, ADMINISTRATION_CLASSIFICATION_SCHEMA_ID, markRevealed, openExposureLedger, recordExposure, reserveExposure } from "../../lib/form-class.mjs";

// #585 item 1 (this round). `runIdFor`/`formDigestFor` are the one derivation every fixture below
// uses, so a run and the ledger entry meant to back it genuinely share an identity the way `assess`
// does in production -- naming the same `runId` on the run record, on the ledger entry
// `reserveExposure`/`recordExposure` commit under `administration_id`, and (when one is attached at
// all) on the cached `form_classification`.
const runIdFor = (seed) => `run-${seed}`;
const formDigestFor = (seed) => `sha256:${sha256Value(seed)}`;

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

// Fixture inputs go through the same reservation, reveal, terminal and reader boundaries as assess.
const ledgerEntry = (seed, { administeredClass = "OPERATIONAL", administrationId = runIdFor(seed), formContractDigest = formDigestFor(seed), state = "TERMINAL" } = {}) => ({
  administration_id: administrationId,
  form_contract_digest: formContractDigest,
  state,
  declared_class: "OPERATIONAL",
  prior_exposure_count: 0,
  prior_scored_count: 0,
  administered_class: administeredClass
});
const ledgerOf = (entries) => {
  let ledger = openExposureLedger(undefined);
  for (const row of entries) {
    const input = { ...row, form_id: "fixture-form", run_id: row.administration_id, occurred_at: "2026-01-01T00:00:00.000Z" };
    ledger = reserveExposure(ledger, input).ledger;
    if (row.state !== "RESERVED") ledger = markRevealed(ledger, input).ledger;
    if (row.state === "TERMINAL") ledger = recordExposure(ledger, { ...input, scored: row.administered_class === "OPERATIONAL" }).ledger;
  }
  return openExposureLedger(ledger);
};

// #562. A cycle freezes the per-form contract of each seed it locks, and in production that is
// `formManifest(seed).form_contract_digest`. These fixtures have always used a synthetic
// `formDigestFor` so a run and its ledger entry share an identity without generating six real
// forms; the cycle is pointed at the same synthetic digests so the per-form comparison is exercised
// on the fixtures' own forms rather than skipped.
const cycleOf = (seeds = ["1", "2", "3"], { runs = seeds.length, resultSchema = LEGACY_RESULT_SCHEMA_ID } = {}) => {
  const cycle = createCycle({ profileDigest: "sha256:profile", suiteMajor: 1, scorerMajor: 1, seeds, runs, resultSchema });
  return { ...cycle, form_contracts: Object.fromEntries(cycle.seeds.map((seed) => [seed, formDigestFor(seed)])) };
};

const runOf = (seed, over = {}) => ({
  seed,
  run_id: runIdFor(seed),
  form_contract_digest: formDigestFor(seed),
  profile_digest: "sha256:profile",
  // #562. The exact contract this build measures under, which is what a real run terminal carries.
  // A fixture testing a mismatch overrides one field of it; a fixture that left it out entirely
  // would be testing the absent-field refusal instead of whatever it meant to test.
  ...measurementContract(),
  // These fixtures are the legacy scorer's runs -- they carry `final_score` and `dimensions`.
  result_schema: LEGACY_RESULT_SCHEMA_ID,
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

test("exposure verification requires an opened ledger even when a raw copy is internally coherent", () => {
  const seed = "1";
  const entry = { form_id: "form", form_contract_digest: `sha256:${"8".repeat(64)}`, declared_class: "OPERATIONAL",
    administration_id: runIdFor(seed), run_id: runIdFor(seed), occurred_at: "2026-01-01T00:00:00.000Z" };
  const reserved = reserveExposure(undefined, entry).ledger;
  const revealed = markRevealed(reserved, entry).ledger;
  const ledger = openExposureLedger(recordExposure(revealed, { ...entry, administered_class: "OPERATIONAL", scored: true }).ledger);
  const run = { ...runOf(seed), form_contract_digest: entry.form_contract_digest };
  assert.deepEqual(exposureVerification(run, { ledger }), { decision: true, status: "VERIFIED" });
  for (const raw of [JSON.parse(JSON.stringify(ledger)), { ...ledger }, Object.freeze({ entries: ledger.entries })]) {
    assert.deepEqual(exposureVerification(run, { ledger: raw }), { decision: null, status: "UNVERIFIED" });
  }
});

test("a cycle is complete when every locked form has one valid terminal, never when three of them do", () => {
  // #563. `valid.length >= 3` said complete with five forms locked and three finished, and the
  // aggregate then closed over whichever three had got there -- partial-success selection spelled
  // as arithmetic. The number three was never the contract.
  const five = ["1", "2", "3", "4", "5"];
  const cycle = cycleOf(five, { runs: 5 });
  const three = five.slice(0, 3).reduce((acc, _seed, index) => recordRun(acc, runOf(acc.seeds[index])), cycle);
  const partial = aggregateCycle(three);
  assert.equal(partial.complete, false, "three of five locked forms read as a complete cycle");
  assert.equal(partial.operator_score, null, "a partial cycle issued an operator score");
  assert.equal(partial.completed_forms, 3);
  assert.equal(partial.configured_forms, 5);
  assert.match(partial.completion_line, /completed 3 of 5 operational forms/u);
  assert.match(partial.completion_line, /AOS_FORMS_NOT_ADMINISTERED/u, "the unfinished forms are not named");

  const all = five.reduce((acc, _seed, index) => recordRun(acc, runOf(acc.seeds[index])), cycle);
  const full = aggregateCycle(all);
  assert.equal(full.complete, true);
  assert.equal(full.completed_forms, 5);
  assert.deepEqual(full.forms.map((form) => form.state), Array(5).fill("VALID_TERMINAL"));
});

test("an instrument failure may be retried; a low, capped or unsafe result may not", () => {
  // #563's retry allowlist. The four infrastructure failures measured nothing, so the seed is still
  // open. A low score measured exactly what it says, and rerunning on it is the cherry-pick the
  // locked seeds exist to prevent.
  const cycle = cycleOf();
  const seed = cycle.seeds[0];
  for (const failure of INFRASTRUCTURE_FAILURES) {
    const attempted = recordRun(cycle, runOf(seed, { failure, final_score: null }));
    assert.equal(formStateOf(attempted, seed), "INFRA_FAILED_RETRYABLE", failure);
    assert.equal(mayRerun(attempted, seed), true, failure);
    // And the retry closes the form, with the failed attempt preserved beside it.
    const retried = recordRun(attempted, runOf(seed, { final_score: 12 }));
    assert.equal(formStateOf(retried, seed), "VALID_TERMINAL", failure);
    assert.equal(retried.runs.length, 2, "the failed attempt was dropped rather than preserved");
  }
  // A low result is a valid terminal. It closes the form and cannot be run again.
  const low = recordRun(cycle, runOf(seed, { final_score: 3 }));
  assert.equal(formStateOf(low, seed), "VALID_TERMINAL");
  assert.equal(mayRerun(low, seed), false, "a low result reopened its own seed");
  assert.throws(() => recordRun(low, runOf(seed, { final_score: 99 })), /AOS_CYCLE_SEED_ALREADY_RUN/u);
});

test("a form the contract blocked is blocked, not retryable and not pending", () => {
  // #563 forbids disguising a contract mismatch as pending. Retrying it under the same build
  // produces the same refusal, so calling it retryable invites the loop; calling it pending says
  // the form was never administered, which is false and hides the reason.
  const cycle = cycleOf();
  const seed = cycle.seeds[0];
  const blocked = recordRun(cycle, runOf(seed, { task_model_digest: `sha256:${"c".repeat(64)}` }));
  assert.equal(blocked.runs[0].invalid_reason, "TASK_MODEL_CHANGED");
  assert.equal(formStateOf(blocked, seed), "BLOCKED_CONTRACT_CHANGE");
  const summary = aggregateCycle(blocked);
  assert.deepEqual(summary.blocked_contract_change, [seed]);
  assert.equal(summary.complete, false);
  assert.match(summary.completion_line, /BLOCKED_CONTRACT_CHANGE/u);
});

test("a v0.2 run missing required cells withholds the cycle by name, and is never scored as zero", () => {
  // #563's claim-specific coverage. A required cell that was not issued is a hole in the evidence.
  // Recording it as a zero would be this file inventing an observation, and a reader could not tell
  // the two apart afterwards.
  const cycle = cycleOf(["1", "2", "3"], { resultSchema: RESULT_SCHEMA_ID });
  const covered = {
    operator_process: { required: 6, issued: 6 },
    system_outcome: { required: 4, issued: 4 },
    reliance: { opportunities: 4, floor: 4 },
    claim_stage: "PROFILE_BOUND",
    uncertainty_status: "WITHHELD",
    generalizability_status: "WITHHELD"
  };
  const profileRun = (seed, over = {}) => runOf(seed, {
    result_schema: RESULT_SCHEMA_ID,
    form_classification: classification(seed, true),
    required_coverage: covered,
    ...over
  });
  const ledger = ledgerOf(cycle.seeds.map((seed) => ledgerEntry(seed, { administeredClass: "OPERATIONAL" })));

  const short = cycle.seeds.reduce((acc, seed, index) => recordRun(acc, profileRun(seed,
    index === 0 ? { required_coverage: { ...covered, operator_process: { required: 6, issued: 5 } } } : {}), { ledger }), cycle);
  const withheld = aggregateCycle(short, { ledger });
  assert.equal(withheld.complete, false, "a cycle short a required cell called itself complete");
  assert.equal(withheld.operator_score, null);
  assert.deepEqual(withheld.withheld_required_evidence, [cycle.seeds[0]]);
  assert.equal(withheld.forms[0].state, "WITHHELD_REQUIRED_EVIDENCE");
  assert.deepEqual(withheld.forms[0].missing, ["AOS_REQUIRED_CELLS_NOT_ISSUED C1-C6 5/6"]);
  // The run itself is preserved and still valid: its terminal happened, and the withholding is
  // about what may be claimed from it.
  assert.equal(short.runs[0].valid, true, "a form short a required cell lost its terminal");

  // The reliance floor is the same kind of fact and is named the same way.
  const belowFloor = cycle.seeds.reduce((acc, seed, index) => recordRun(acc, profileRun(seed,
    index === 1 ? { required_coverage: { ...covered, reliance: { opportunities: 2, floor: 4 } } } : {}), { ledger }), cycle);
  assert.deepEqual(aggregateCycle(belowFloor, { ledger }).forms[1].missing, ["AOS_RELIANCE_OPPORTUNITIES_BELOW_FLOOR 2/4"]);

  // A validation field nobody filled in reads as absent rather than as a value.
  const noStage = cycle.seeds.reduce((acc, seed, index) => recordRun(acc, profileRun(seed,
    index === 2 ? { required_coverage: { ...covered, claim_stage: "" } } : {}), { ledger }), cycle);
  assert.deepEqual(aggregateCycle(noStage, { ledger }).forms[2].missing, ["AOS_REQUIRED_FIELD_ABSENT claim_stage"]);

  // And the whole set present is complete.
  const full = cycle.seeds.reduce((acc, seed) => recordRun(acc, profileRun(seed), { ledger }), cycle);
  assert.equal(aggregateCycle(full, { ledger }).complete, true, "a fully covered cycle was withheld");
});

test("an optional cell nobody observed does not block the cycle", () => {
  // #563 forbids requiring every optional cell, which would block every cycle forever. Optional
  // coverage is reported and is not a gate; only the required set decides completion.
  const cycle = cycleOf(["1", "2", "3"], { resultSchema: RESULT_SCHEMA_ID });
  const ledger = ledgerOf(cycle.seeds.map((seed) => ledgerEntry(seed, { administeredClass: "OPERATIONAL" })));
  const withOptionalMissing = cycle.seeds.reduce((acc, seed) => recordRun(acc, runOf(seed, {
    result_schema: RESULT_SCHEMA_ID,
    form_classification: classification(seed, true),
    required_coverage: {
      operator_process: { required: 6, issued: 6 },
      system_outcome: { required: 4, issued: 4 },
      reliance: { opportunities: 4, floor: 4 },
      claim_stage: "PROFILE_BOUND",
      uncertainty_status: "WITHHELD",
      generalizability_status: "WITHHELD",
      optional_not_observed: ["C7.XX.01", "O5.YY.02"]
    }
  }), { ledger }), cycle);
  assert.equal(aggregateCycle(withOptionalMissing, { ledger }).complete, true, "an unobserved optional cell blocked the cycle");
});

test("a v0.2 run that states no coverage at all is withheld, not waved through", () => {
  // The absent-field direction, which is the one a build that never computed coverage produces. A
  // run that says nothing about its required cells has not shown they were issued.
  const cycle = cycleOf(["1", "2", "3"], { resultSchema: RESULT_SCHEMA_ID });
  const ledger = ledgerOf(cycle.seeds.map((seed) => ledgerEntry(seed, { administeredClass: "OPERATIONAL" })));
  const silent = cycle.seeds.reduce((acc, seed) => recordRun(acc, runOf(seed, {
    result_schema: RESULT_SCHEMA_ID, form_classification: classification(seed, true)
  }), { ledger }), cycle);
  const summary = aggregateCycle(silent, { ledger });
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.forms[0].missing, ["AOS_REQUIRED_COVERAGE_ABSENT"]);
  // A legacy run is not asked: the claim-specific coverage contract is what a v0.2 result asserts,
  // and a legacy cycle cannot reach PROFILE_BOUND by any path.
  assert.equal(requiredCoverageOf({ result_schema: "aos-mvp-result.v1" }).applicable, false);
  assert.equal(requiredCoverageOf({ result_schema: "aos-mvp-result.v1" }).satisfied, true);
});

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
    ["terminal_committed", false, "NO_TERMINAL"]
  ]) {
    const check = runValidity(cycle, runOf("0000000000000001", { [field]: value }));
    assert.equal(check.valid, false, field);
    assert.equal(check.reason, reason, field);
    assert.deepEqual(check.exposure, { decision: null, status: "UNVERIFIED" }, `${field}: every runValidity refusal carries an exposure state`);
  }
});

test("a v1 cycle still compares the two majors, and is never rewritten into a v3 one", () => {
  // #562. The majors are how a v1 cycle decided comparability, and there is no honest way to derive
  // the twelve digests from two integers -- the bytes that produced them are whatever the checkout
  // held at the time. So a v1 cycle keeps the comparison it was written with. Upgrading it in place
  // would be this file inventing the evidence, which is the one thing the compatibility rule names.
  const legacy = { ...cycleOf(), schema_id: "aos-cycle.v1" };
  assert.equal(isLegacyCycle(legacy), true);
  for (const [field, value, reason] of [
    ["suite_major", 2, "SUITE_MAJOR_CHANGED"],
    ["scorer_major", 2, "SCORER_MAJOR_CHANGED"]
  ]) {
    const check = runValidity(legacy, runOf("0000000000000001", { [field]: value }));
    assert.equal(check.reason, reason, field);
  }
  // And the exact comparison does not run against it: a run carrying no contract at all is still
  // this cycle's run, because this cycle never froze one to compare against.
  const bare = runOf("0000000000000001");
  for (const { field } of CONTRACT_DIGEST_FIELDS) delete bare[field];
  bare.profile_digest = "sha256:profile";
  assert.equal(runValidity(legacy, bare).valid, true, "a v1 cycle demanded digests it never froze");

  // The same bare run against the v3 cycle it was not measured under: refused, not admitted on the
  // strength of having nothing to compare.
  assert.equal(runValidity(cycleOf(), bare).valid, false);
});

test("one semantic byte of any frozen contract blocks the run from the cycle, by name", () => {
  // #562's whole point, and the twelve reasons in one table. `suite_major`/`scorer_major` used to
  // be the entire defence: two integers somebody had to remember to bump. Every row below moves a
  // digest instead, and each one has to be refused under the reason that names which contract
  // moved -- a run refused under the wrong reason sends its operator to the wrong file.
  const cycle = cycleOf();
  const elsewhere = (n) => `sha256:${String(n).repeat(64)}`;
  const matrix = [
    ["profile_digest", elsewhere(0), "PROFILE_CHANGED"],
    ["construct_contract_digest", elsewhere(1), "CONSTRUCT_CONTRACT_CHANGED"],
    ["evidence_model_digest", elsewhere(2), "EVIDENCE_MODEL_CHANGED"],
    ["task_model_digest", elsewhere(3), "TASK_MODEL_CHANGED"],
    ["interpretation_use_digest", elsewhere(4), "USE_ARGUMENT_CHANGED"],
    ["suite_contract_digest", elsewhere(5), "SUITE_CONTRACT_CHANGED"],
    ["form_bank_contract_digest", elsewhere(6), "FORM_CONTRACT_CHANGED"],
    ["observable_cell_contract_digest", elsewhere(7), "SCORER_CHANGED"],
    ["profile_aggregation_digest", elsewhere(8), "SCORER_CHANGED"],
    ["reliance_contract_digest", elsewhere(9), "RELIANCE_CONTRACT_CHANGED"],
    ["facet_uncertainty_digest", elsewhere(1), "FACET_UNCERTAINTY_CHANGED"],
    ["validation_claim_digest", elsewhere(2), "VALIDATION_CLAIM_CHANGED"],
    ["standard_setting_status_digest", elsewhere(3), "VALIDATION_CLAIM_CHANGED"],
    ["result_schema", "aos-result.v2", "RESULT_SCHEMA_CHANGED"],
    ["form_contract_digest", elsewhere(4), "FORM_CONTRACT_CHANGED"]
  ];
  for (const [field, value, reason] of matrix) {
    const check = runValidity(cycle, runOf("0000000000000001", { [field]: value }));
    assert.equal(check.valid, false, `${field}: a moved contract was admitted to the cycle`);
    assert.equal(check.reason, reason, field);
  }
  // Every one of the twelve is reachable from that table. A reason nothing can produce is a reason
  // nobody will ever read, and it would sit in the vocabulary looking like coverage.
  const produced = new Set(matrix.map(([, , reason]) => reason));
  assert.deepEqual([...produced].sort(), [...CONTRACT_MISMATCH_REASONS].sort());
});

test("a contract the run does not carry at all is a mismatch, never a pass", () => {
  // The hole every version-comparison has: absence reads as agreement. A run from a build that
  // never computed a digest has nothing to compare, and admitting it would make the missing half of
  // the comparison the way through it.
  const cycle = cycleOf();
  for (const { field, reason } of CONTRACT_DIGEST_FIELDS) {
    const run = runOf("0000000000000001");
    delete run[field];
    const check = runValidity(cycle, run);
    assert.equal(check.valid, false, `${field}: an absent contract was read as a matching one`);
    assert.equal(check.reason, reason, field);
  }
  // The per-form contract too, which is stored per seed rather than beside the twelve.
  const noForm = runOf("0000000000000001");
  delete noForm.form_contract_digest;
  assert.equal(runValidity(cycle, noForm).reason, "FORM_CONTRACT_CHANGED");
});

test("a path, a time and a key order do not move a digest; a byte does", () => {
  // The comparison is only worth having if it survives being run somewhere else. `canonicalJson`
  // sorts keys, every file digest is over raw bytes, and nothing in the contract reads a timestamp,
  // an absolute path or an mtime -- so the same source answers the same on another machine.
  const once = measurementContract();
  forgetMeasurementContract();
  const twice = measurementContract();
  assert.deepEqual(once, twice, "the contract is not stable within one build");

  // Key order, made explicit: a cycle re-serialised through a reordering round-trip is the same
  // cycle, and its runs still belong to it.
  const cycle = cycleOf();
  const reordered = Object.fromEntries(Object.entries(cycle).reverse());
  assert.equal(runValidity(reordered, runOf(cycle.seeds[0])).valid, true, "reordering a cycle's keys unseated its runs");

  // And both spellings of one digest are one digest. A published result normalises to
  // `sha256:<hex>` and a cycle's own key is bare hex; comparing the strings made every run of a new
  // result PROFILE_CHANGED against its own cohort.
  const bare = runOf(cycle.seeds[0], { task_model_digest: once.task_model_digest.replace(/^sha256:/u, "") });
  assert.equal(runValidity(cycle, bare).valid, true, "the same digest in two spellings read as two digests");
});

test("cycle status shows every frozen contract as a machine digest and a safe prefix", () => {
  // #562's UI requirement, and the reason it is both: the prefix is what a person compares across
  // two terminals, and the full digest is what a script compares. A status that printed only the
  // prefix would be a status whose output cannot be used as evidence, and one that printed only the
  // full digests would be twelve unreadable lines nobody checks.
  const cycle = cycleOf();
  const lines = contractLines(cycle);
  for (const label of ["Profile", "Construct/Evidence/Task/Use", "Suite/Form", "Aggregation/Reliance",
    "Facet/Uncertainty", "Validation/Claim", "Result schema"]) {
    assert.ok(lines.some((line) => line.includes(`${label}:`)), `${label} is not shown`);
  }
  // Every locked form, by seed. A cycle that showed the suite contract and not its forms would hide
  // the half that moves when a task tree or an oracle does.
  for (const seed of cycle.seeds) assert.ok(lines.some((line) => line.includes(`Form ${seed}`)), seed);

  // The prefix is a prefix of the digest it stands for, in either spelling, and is not the digest.
  const shown = digestPrefix(cycle.suite_contract_digest);
  assert.ok(cycle.suite_contract_digest.includes(shown.replace("…", "")), "the prefix is not from this digest");
  assert.notEqual(shown, cycle.suite_contract_digest);
  assert.equal(digestPrefix(cycle.suite_contract_digest.replace(/^sha256:/u, "")), shown, "two spellings shortened to two prefixes");
  assert.equal(digestPrefix(null), "unrecorded", "an unrecorded digest printed as a blank");

  // The machine half carries the full digests, so `--json` is evidence rather than a summary of it.
  const record = contractRecordOf(cycle);
  for (const { field } of CONTRACT_DIGEST_FIELDS) assert.equal(record[field], cycle[field], field);

  // A run that was refused names every contract that moved, not only the first. A reader told the
  // construct map moved would rebuild the construct map and still not match.
  const refused = recordRun(cycle, runOf(cycle.seeds[0], {
    task_model_digest: `sha256:${"a".repeat(64)}`,
    reliance_contract_digest: `sha256:${"b".repeat(64)}`
  }));
  assert.deepEqual(refused.runs[0].contract_mismatches, ["TASK_MODEL_CHANGED", "RELIANCE_CONTRACT_CHANGED"]);
  assert.ok(contractLines(refused).some((line) => line.includes("TASK_MODEL_CHANGED, RELIANCE_CONTRACT_CHANGED")));

  // A legacy cycle says what it is instead of printing digests it never froze.
  const legacyLines = contractLines({ ...cycle, schema_id: "aos-cycle.v1" });
  assert.equal(legacyLines.length, 1);
  assert.match(legacyLines[0], /historical, and never upgraded/u);
});

test("a different package patch, a later timestamp and a different locked form all still belong", () => {
  // #562's allow-list, which matters as much as the reject-list: a comparison that refuses runs it
  // should accept gets switched off by whoever has to ship, and then it is refusing nothing.
  const cycle = cycleOf();
  const seed = cycle.seeds[0];

  // A patch release with identical normative digests. `package_version` is recorded as provenance
  // for a reader and is deliberately not compared -- two builds whose contracts are byte-identical
  // measured the same thing whatever their version strings say, and two whose contracts differ did
  // not, however equal the strings look.
  assert.ok("package_version" in cycle, "the cycle does not record the build that froze it");
  assert.ok(CONTRACT_DIGEST_FIELDS.every(({ field }) => field !== "package_version"),
    "package_version is compared, so a patch release splits a cohort whose contracts are identical");
  assert.equal(runValidity(cycle, runOf(seed, { package_version: "0.9.9" })).valid, true);

  // A later run of the same contract. Nothing in the contract reads a clock, so a field naming when
  // the record was produced cannot move a digest.
  assert.equal(runValidity(cycle, runOf(seed, { generated_at: "2031-01-01T00:00:00.000Z" })).valid, true);

  // Two different locked forms under one contract: each seed's own form digest is what its run is
  // compared against, so a run against seed two is not judged by seed one's form.
  const second = cycle.seeds[1];
  assert.notEqual(cycle.form_contracts[seed], cycle.form_contracts[second], "the fixture's forms are not distinct");
  assert.equal(runValidity(cycle, runOf(second)).valid, true, "a second locked form was refused by the first one's digest");
  // And they are not interchangeable: seed two's run carrying seed one's form is refused.
  assert.equal(runValidity(cycle, runOf(second, { form_contract_digest: cycle.form_contracts[seed] })).reason,
    "FORM_CONTRACT_CHANGED");
});

test("an active cycle whose contract moved underneath it fails closed, and keeps what it has", () => {
  // #562's active-cycle policy. The forbidden shape is the quiet one: continue, mark the runs that
  // no longer fit as `excluded`, and let the median close over what is left -- that reads as a
  // complete cycle and is a cycle measured under two contracts.
  const cycle = cycleOf();
  assert.deepEqual(activeCycleDrift(cycle).blocked, false, "an unchanged contract blocked its own cycle");

  const drifted = { ...cycle, suite_contract_digest: `sha256:${"e".repeat(64)}`, validation_claim_digest: `sha256:${"f".repeat(64)}` };
  const drift = activeCycleDrift(drifted);
  assert.equal(drift.blocked, true);
  assert.equal(drift.code, BLOCKED_CONTRACT_CHANGE);
  assert.deepEqual([...drift.reasons], ["SUITE_CONTRACT_CHANGED", "VALIDATION_CLAIM_CHANGED"], "the operator is not told which contract moved");
  assert.match(drift.detail, /preserved/u, "the detail does not say the old runs are kept");
  assert.match(drift.detail, /aos cycle start --force/u, "the detail does not say what to do instead");

  // A legacy cycle is not blocked by a contract it never froze -- it is historical, and stays so.
  const legacy = { ...drifted, schema_id: "aos-cycle.v1" };
  assert.equal(activeCycleDrift(legacy).blocked, false);
  assert.equal(activeCycleDrift(legacy).legacy, true);
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
    cycleOf(seeds, { runs: 5 })
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
  const unrelatedLedger = openExposureLedger(reserveExposure(empty, {
    form_id: "some-other-form",
    form_contract_digest: `sha256:${"a".repeat(64)}`,
    declared_class: "OPERATIONAL",
    administration_id: "a-completely-different-administration",
    occurred_at: "2026-01-01T00:00:00.000Z"
  }).ledger);

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
  // The production transitions and the reader must agree on a completed administration.
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
  assert.deepEqual(exposureVerification(run, { ledger: openExposureLedger(finalized.ledger) }), { decision: true, status: "VERIFIED" });

  // A different run, one the ledger never reserved or finalized anything for, stays UNVERIFIED
  // even though it is checked against the very same ledger object.
  const neverAdministered = { run_id: "run-never-administered", form_contract_digest: formContractDigest };
  assert.deepEqual(exposureVerification(neverAdministered, { ledger: openExposureLedger(finalized.ledger) }), { decision: null, status: "UNVERIFIED" });

  // And a run naming a different form contract digest than the one the ledger actually recorded
  // under this exact administration id is refused, not silently trusted.
  const wrongDigest = { run_id: runId, form_contract_digest: `sha256:${"9".repeat(64)}` };
  assert.deepEqual(exposureVerification(wrongDigest, { ledger: openExposureLedger(finalized.ledger) }), { decision: false, status: "REFUSED" });
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
      // Deliberately rebuild a coherent chain over incomplete eligibility metadata. This keeps
      // the eligibility guard reachable after the reader seal, within the stated unkeyed-chain limit.
      const raw = structuredClone(ledgerOf([ledgerEntry("1")]));
      raw.entries[0][field] = value;
      if (value === undefined) delete raw.entries[0][field];
      const { chain_digest: _digest, ...content } = raw.entries[0];
      raw.head_digest = raw.entries[0].chain_digest = `sha256:${sha256Value({ previous_digest: EXPOSURE_LEDGER_GENESIS_DIGEST, entry: content })}`;
      assert.equal(exposureVerification(runOf("1"), { ledger: openExposureLedger(raw) }).decision, value === 1 ? false : null,
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

  // #562. A cycle freezes the result schema its runs are written under, so the v0.2 half of this
  // test needs a v0.2 cycle -- against a legacy cycle the run is refused as RESULT_SCHEMA_CHANGED
  // before the exposure gate is ever reached, which would have tested the wrong refusal.
  const profileCycle = () => cycleOf(["1", "2", "3"], { resultSchema: RESULT_SCHEMA_ID });
  const profileUnverified = runOf(seed, { result_schema: RESULT_SCHEMA_ID });
  const verdict = runValidity(profileCycle(), profileUnverified);
  assert.equal(verdict.exposure.status, "UNVERIFIED");
  assert.equal(verdict.valid, false, "a v0.2 run the ledger never verified counted toward the official aggregate");
  assert.equal(verdict.reason, "AOS_EXPOSURE_UNVERIFIED_FOR_PROFILE_BOUND");

  // And a v0.2 run the ledger did verify still counts -- now genuinely, from a real ledger entry.
  const ledger = ledgerOf([ledgerEntry(seed, { administeredClass: "OPERATIONAL" })]);
  const profileVerified = runOf(seed, { result_schema: RESULT_SCHEMA_ID, form_classification: classification(seed, true) });
  assert.equal(runValidity(profileCycle(), profileVerified, { ledger }).valid, true, "a verified v0.2 run was refused");
  assert.equal(runValidity(profileCycle(), profileVerified, { ledger }).exposure.status, "VERIFIED");
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
