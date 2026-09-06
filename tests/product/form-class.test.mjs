import assert from "node:assert/strict";
import test from "node:test";

import {
  EQUIVALENCE_STATUSES,
  EXPOSURE_POLICIES,
  FORM_BANK_RECORD_SCHEMA_ID,
  FORM_CLASS_REGISTRY,
  FORM_CLASSES,
  formBankRecord
} from "../../lib/form-class.mjs";
import { formManifest } from "../../lib/suite.mjs";

// ---------------------------------------------------------------------------------------------
// Form classes and the machine-readable registry (#585)
//
// The four classes are the specification's, by name. The registry is what makes them
// machine-readable: a consumer that wants to know whether a WARMUP administration may reach an
// official cycle reads the registry field, not a comment.

test("form class registry declares the four classes with their scoring and exposure policy", () => {
  assert.deepEqual([...FORM_CLASSES], ["WARMUP", "PRACTICE", "OPERATIONAL", "TRANSFER"]);
  assert.deepEqual(Object.keys(FORM_CLASS_REGISTRY).sort(), [...FORM_CLASSES].sort());
  for (const classId of FORM_CLASSES) {
    const entry = FORM_CLASS_REGISTRY[classId];
    assert.equal(entry.class_id, classId);
    assert.equal(typeof entry.scored, "boolean");
    assert.equal(typeof entry.official_cycle_eligible, "boolean");
    assert.equal(typeof entry.repeatable, "boolean");
    assert.equal(EXPOSURE_POLICIES.includes(entry.exposure_policy), true, `${classId} names an unknown exposure policy`);
  }
  // The specification's own table: warmup and practice are never scored, an operational form is
  // scored once, transfer is research-lane only.
  assert.equal(FORM_CLASS_REGISTRY.WARMUP.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.PRACTICE.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.official_cycle_eligible, true);
  assert.equal(FORM_CLASS_REGISTRY.TRANSFER.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.WARMUP.exposure_policy, "unscored-repeatable");
  assert.equal(FORM_CLASS_REGISTRY.PRACTICE.exposure_policy, "unscored-repeatable");
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.exposure_policy, "scored-once");
  assert.equal(FORM_CLASS_REGISTRY.TRANSFER.exposure_policy, "research-only");
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.repeatable, false);
  assert.equal(Object.isFrozen(FORM_CLASS_REGISTRY), true);
  assert.equal(Object.isFrozen(FORM_CLASS_REGISTRY.OPERATIONAL), true);
});

test("a form bank record derives its policy from its class and refuses a contradiction", () => {
  const record = formBankRecord({
    form_id: "FAM-3.form-2a",
    form_class: "OPERATIONAL",
    construct_opportunity_ids: ["C3.RD.01"],
    language: "ko",
    interface: "agent-relay",
    model_profile_class: "cli-agent",
    oracle_digest: `sha256:${"a".repeat(64)}`
  });
  assert.equal(record.schema_id, FORM_BANK_RECORD_SCHEMA_ID);
  assert.equal(record.exposure_policy, "scored-once");
  assert.equal(record.equivalence_status, "UNESTABLISHED");
  assert.equal(Object.isFrozen(record), true);
  // A record that declares a policy its class contradicts is refused rather than trusted: the
  // registry, not the stored artifact, owns the policy. A stored artifact that authorizes itself
  // is this repository's second-oldest defect class.
  assert.throws(() => formBankRecord({
    form_id: "FAM-3.form-2a",
    form_class: "WARMUP",
    construct_opportunity_ids: [],
    oracle_digest: `sha256:${"a".repeat(64)}`,
    exposure_policy: "scored-once"
  }), /AOS_FORM_POLICY_CONTRADICTION/);
  assert.throws(() => formBankRecord({ form_id: "x", form_class: "EXAM", construct_opportunity_ids: [], oracle_digest: `sha256:${"a".repeat(64)}` }), /AOS_FORM_CLASS_UNKNOWN/);
  assert.throws(() => formBankRecord({ form_id: "x", form_class: "OPERATIONAL", construct_opportunity_ids: [], oracle_digest: "not-a-digest" }), /AOS_FORM_ORACLE_DIGEST/);
});

test("a form bank record cannot declare itself linked; equivalence stays unestablished without linking evidence", () => {
  // `equivalence_status` is derived, never accepted from the caller: a bank record that could say
  // LINKED about itself would be a stored artifact authorizing its own strongest claim.
  const record = formBankRecord({
    form_id: "FAM-1.form-2b",
    form_class: "OPERATIONAL",
    construct_opportunity_ids: ["C1.GF.01"],
    oracle_digest: `sha256:${"b".repeat(64)}`,
    equivalence_status: "LINKED"
  });
  assert.equal(record.equivalence_status, "UNESTABLISHED");
  assert.equal(EQUIVALENCE_STATUSES.includes(record.equivalence_status), true);
});

test("a form bank record's equivalence status requires a real linking scaffold, not any object naming a status", () => {
  // `linking: { equivalence_status: "LINKED" }` is exactly the shape a caller can construct by
  // hand, with no `linkForms` scaffold and no empirical evidence behind it. Only an object tagged
  // with the linking scaffold's own schema_id -- the same check `scoreChangeClaim` performs before
  // it will quote a linking record -- may move this field off its UNESTABLISHED default.
  const record = formBankRecord({
    form_id: "FAM-1.form-2b",
    form_class: "OPERATIONAL",
    construct_opportunity_ids: ["C1.GF.01"],
    oracle_digest: `sha256:${"b".repeat(64)}`,
    linking: { equivalence_status: "LINKED" }
  });
  assert.equal(record.equivalence_status, "UNESTABLISHED");
});

test("the shipped operational form manifest speaks the form class contract's own words", () => {
  const manifest = formManifest("2a");
  assert.equal(manifest.form_class, "OPERATIONAL");
  assert.equal(manifest.exposure_policy, FORM_CLASS_REGISTRY.OPERATIONAL.exposure_policy);
  // #585's enum, not the pre-#585 word. "UNCALIBRATED" was a status no contract declared; two
  // vocabularies for one tri-state question is the representation collapse this repository has
  // produced five times.
  assert.equal(manifest.equivalence_status, "UNESTABLISHED");
  assert.equal(EQUIVALENCE_STATUSES.includes(manifest.equivalence_status), true);
  for (const family of Object.keys(manifest.family_manifests)) {
    const row = manifest.family_manifests[family];
    assert.equal(EQUIVALENCE_STATUSES.includes(row.equivalence_status), true, `${family} claims a form relation outside the #585 vocabulary`);
    assert.equal(row.equivalence_status, "UNESTABLISHED", `${family} claims a form relation this suite has no linking evidence for`);
  }
});

// ---------------------------------------------------------------------------------------------
// Exposure ledger and the scored-once policy (#585)

test("the exposure ledger records sequence position, administration interval and prior exposure", async () => {
  const { createExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const digestA = `sha256:${"1".repeat(64)}`;
  const digestB = `sha256:${"2".repeat(64)}`;
  const base = createExposureLedger();
  assert.equal(base.schema_id, "aos-exposure-ledger.v1");
  assert.deepEqual(base.entries, []);
  const first = recordExposure(base, { form_id: "aos-operational-002a", form_contract_digest: digestA, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T10:00:00.000Z", scored: true });
  const second = recordExposure(first.ledger, { form_id: "aos-operational-002b", form_contract_digest: digestB, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T11:00:00.000Z", scored: true });
  const third = recordExposure(second.ledger, { form_id: "aos-operational-002a", form_contract_digest: digestA, declared_class: "OPERATIONAL", administered_class: "PRACTICE", occurred_at: "2026-09-06T12:30:00.000Z", scored: false });
  assert.deepEqual(third.ledger.entries.map((entry) => entry.sequence_position), [1, 2, 3]);
  assert.equal(first.entry.interval_ms, null, "the first administration has no interval to report, and null says so");
  assert.equal(second.entry.interval_ms, 3600000);
  assert.equal(third.entry.interval_ms, 5400000);
  assert.deepEqual(third.ledger.entries.map((entry) => entry.prior_exposure_count), [0, 0, 1]);
  assert.equal(third.entry.administered_class, "PRACTICE");
  assert.equal(Object.isFrozen(third.ledger), true);
  // The ledger it grew from is untouched: exposure history cannot be edited in place.
  assert.equal(second.ledger.entries.length, 2);
});

test("an operational form is scored once; its replay is classified practice and refused official scoring", async () => {
  const { classifyAdministration, createExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"3".repeat(64)}`;
  const ledger = createExposureLedger();
  const fresh = classifyAdministration(ledger, { form_id: "aos-operational-0031", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  assert.equal(fresh.administered_class, "OPERATIONAL");
  assert.equal(fresh.official_scoring_permitted, true);
  assert.equal(fresh.refusal_code, null);
  const { ledger: exposed } = recordExposure(ledger, { form_id: "aos-operational-0031", form_contract_digest: digest, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T10:00:00.000Z", scored: true });
  const replay = classifyAdministration(exposed, { form_id: "aos-operational-0031", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  assert.equal(replay.administered_class, "PRACTICE", "a different seed makes a different form; the same digest makes the same form, and its second run is practice");
  assert.equal(replay.official_scoring_permitted, false);
  assert.equal(replay.refusal_code, "AOS_FORM_ALREADY_EXPOSED");
  assert.equal(replay.prior_exposure_count, 1);
  assert.equal(replay.prior_scored_count, 1);
  assert.ok(replay.reasons.length > 0 && replay.reasons[0].includes("scored-once"), "the refusal names the policy it enforces");
  // Warmup and practice administrations never reach official scoring, first run or not, and an
  // unscored prior exposure still makes an operational run a replay.
  const warmup = classifyAdministration(exposed, { form_id: "warmup-1", form_contract_digest: `sha256:${"4".repeat(64)}`, declared_class: "WARMUP" });
  assert.equal(warmup.official_scoring_permitted, false);
  assert.equal(warmup.refusal_code, "AOS_FORM_CLASS_UNSCORED");
  assert.equal(warmup.administered_class, "WARMUP");
  const transfer = classifyAdministration(exposed, { form_id: "t-1", form_contract_digest: `sha256:${"5".repeat(64)}`, declared_class: "TRANSFER" });
  assert.equal(transfer.official_scoring_permitted, false);
  assert.equal(transfer.refusal_code, "AOS_FORM_CLASS_LONGITUDINAL");
});

test("a corrupt exposure ledger refuses rather than reading as empty", async () => {
  const { openExposureLedger, createExposureLedger } = await import("../../lib/form-class.mjs");
  // `undefined` is the one true absence -- no ledger file exists yet.
  assert.deepEqual(openExposureLedger(undefined), createExposureLedger());
  // A ledger that cannot be read is not an empty one: reading it as empty would grant an exposed
  // form a second official scoring, which is exactly the gate this file exists to hold. A file
  // holding the JSON literal `null` is one of these shapes, not a second spelling of absence -- it
  // silently recorded 0 runs before this test existed, which is indistinguishable from a home that
  // never administered anything even though the two are not the same claim.
  assert.throws(() => openExposureLedger(null), /AOS_EXPOSURE_LEDGER_CORRUPT/);
  assert.throws(() => openExposureLedger({ schema_id: "something-else", entries: [] }), /AOS_EXPOSURE_LEDGER_CORRUPT/);
  assert.throws(() => openExposureLedger({ schema_id: "aos-exposure-ledger.v1", entries: "not-a-list" }), /AOS_EXPOSURE_LEDGER_CORRUPT/);
  // Calendar, not Date.parse: an instant that does not exist cannot anchor an interval.
  const { recordExposure } = await import("../../lib/form-class.mjs");
  assert.throws(() => recordExposure(createExposureLedger(), {
    form_id: "f", form_contract_digest: `sha256:${"0".repeat(64)}`, declared_class: "OPERATIONAL", occurred_at: "2026-02-30T10:00:00.000Z"
  }), /AOS_EXPOSURE_OCCURRED_AT/);
});

test("a cycle excludes a practice-classified administration from the official aggregate", async () => {
  const { createCycle, recordRun, aggregateCycle } = await import("../../lib/cycle.mjs");
  const { classifyAdministration, createExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const seeds = ["0000000000000001", "0000000000000002", "0000000000000003"];
  const digest = `sha256:${"6".repeat(64)}`;
  const runOn = (seed, classification) => ({
    seed, run_id: `r-${seed}`, profile_digest: "p", suite_major: 1, scorer_major: 1,
    failure: null, terminal_committed: true, issued: true, final_score: 70, dimensions: {},
    form_classification: classification
  });
  const { ledger } = recordExposure(createExposureLedger(), { form_id: "aos-operational-0000000000000001", form_contract_digest: digest, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T10:00:00.000Z", scored: true });
  const replay = classifyAdministration(ledger, { form_id: "aos-operational-0000000000000001", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  const cycle = recordRun(createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, seeds, cycleId: "cycle-B" }), runOn(seeds[0], replay));
  assert.equal(cycle.runs[0].valid, false, "a replayed operational form was counted as official aggregate evidence");
  assert.equal(cycle.runs[0].invalid_reason, "AOS_FORM_ALREADY_EXPOSED");
  const aggregate = aggregateCycle(cycle);
  assert.deepEqual(aggregate.excluded, [{ seed: seeds[0], reason: "AOS_FORM_ALREADY_EXPOSED" }]);
  assert.equal(aggregate.valid_runs, 0);
  // Counterfactual one way: a first-exposure operational administration still counts.
  const official = classifyAdministration(createExposureLedger(), { form_id: "aos-operational-0000000000000001", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  const counted = recordRun(createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, seeds, cycleId: "cycle-C" }), runOn(seeds[0], official));
  assert.equal(counted.runs[0].valid, true);
  // Counterfactual the other way: a run recorded before the ledger existed carries no
  // classification, and stays what it always was -- the ledger cannot testify about
  // administrations it never saw, and refusing history it has no evidence about would be an
  // absence scored as a value.
  const historical = recordRun(createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, seeds, cycleId: "cycle-D" }), runOn(seeds[0], undefined));
  assert.equal(historical.runs[0].valid, true);
});

// ---------------------------------------------------------------------------------------------
// The CLI entry point, end to end: the ledger lives in the home, `aos assess` records every graded
// administration into it, and `aos cycle run` refuses official aggregation for a replayed form.

test("a replayed operational form crosses runs as practice, never as official aggregate evidence", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { addAgent, makePlan, run, verifiedRunner } = await import("./helpers.mjs");
  const { runPaths } = await import("../../lib/store.mjs");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cli = join(root, "bin", "aos.mjs");
  const SEEDS = ["0000000000000031", "0000000000000032", "0000000000000033"];
  const FIXTURE_MODEL = "openai/gpt-4o-2024-08-06";
  const UNBLOCK = Array.from({ length: 12 }, () => "\n\n\ny\nAOS-TEST-UNBLOCK proceed\n").join("");
  const cwd = mkdtempSync(join(tmpdir(), "aos-form-exposure-"));
  const home = join(cwd, ".aos");
  const spawn = (args) => spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
    env: { ...process.env, AOS_HOME: home, FAKE_AGENT_PROFILE: "needs-instruction", FAKE_AGENT_MODEL: FIXTURE_MODEL }
  });
  const ledgerOf = () => JSON.parse(readFileSync(join(home, "exposure-ledger.json"), "utf8"));
  const cycleOf = () => JSON.parse(readFileSync(join(home, "cycle.json"), "utf8"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo", undefined, ["--model-id", FIXTURE_MODEL, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
    const plan = makePlan(cwd, { default: "solo" });

    // A bare preview of the first seed. It is an administration -- the operator has now met the
    // form -- so it lands in the ledger as practice, outside any cycle.
    spawn(["assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]]);
    const afterPreview = ledgerOf();
    assert.equal(afterPreview.entries.length, 1);
    assert.equal(afterPreview.entries[0].administered_class, "PRACTICE", "a bare assess of an operational form is a practice administration");
    assert.equal(afterPreview.entries[0].scored, false);
    assert.equal(afterPreview.entries[0].sequence_position, 1);
    assert.equal(afterPreview.entries[0].cycle_id, null);
    // #585. The wall clock the command itself measured, on every administration whether or not it
    // scores -- without it `speed_only_improvement` can never leave null from real use.
    assert.equal(typeof afterPreview.entries[0].duration_ms, "number");
    assert.equal(afterPreview.entries[0].duration_ms >= 0, true);

    // The previewed seed inside a cycle: the ledger has seen the exact form, so the run is
    // classified practice and excluded from the official aggregate, by name.
    run(cwd, ["cycle", "start", ...SEEDS.flatMap((seed) => ["--seed", seed])]);
    const replayed = spawn(["cycle", "run", "--plan", plan, "--checkpoints"]);
    assert.match(replayed.stdout, /practice lane: AOS_FORM_ALREADY_EXPOSED/u, "the refusal is printed where the operator can read it");
    const cycleAfterReplay = cycleOf();
    assert.equal(cycleAfterReplay.runs[0].seed, SEEDS[0]);
    assert.equal(cycleAfterReplay.runs[0].valid, false, "a previewed form was counted as official aggregate evidence");
    assert.equal(cycleAfterReplay.runs[0].invalid_reason, "AOS_FORM_ALREADY_EXPOSED");
    assert.equal(cycleAfterReplay.runs[0].form_classification.administered_class, "PRACTICE");
    // #585. The ledger classified and refused this one -- named on the run itself, not folded into
    // the same "not counted" shape a run the ledger never saw would also produce.
    assert.equal(cycleAfterReplay.runs[0].exposure_verification, "REFUSED");
    assert.equal(ledgerOf().entries.length, 2);
    assert.equal(ledgerOf().entries[1].prior_exposure_count, 1);

    // The next locked seed is a first exposure: an operational administration, scored once, and
    // its facet records carry the occasion and sequence position the ledger assigned.
    const official = spawn(["cycle", "run", "--plan", plan, "--checkpoints"]);
    assert.match(official.stdout, new RegExp(`seed ${SEEDS[1]}`, "u"));
    const cycleAfterOfficial = cycleOf();
    const officialRun = cycleAfterOfficial.runs[1];
    assert.equal(officialRun.form_classification.official_scoring_permitted, true);
    assert.equal(officialRun.form_classification.administered_class, "OPERATIONAL");
    assert.notEqual(officialRun.invalid_reason, "AOS_FORM_ALREADY_EXPOSED");
    // #585. Verified, not merely valid: the ledger itself checked this exact administration and
    // said so, which is the fact "valid: true" alone does not distinguish from a pre-ledger run.
    assert.equal(officialRun.exposure_verification, "VERIFIED");
    const finalLedger = ledgerOf();
    assert.equal(finalLedger.entries.length, 3);
    assert.equal(finalLedger.entries[2].administered_class, "OPERATIONAL");
    assert.equal(finalLedger.entries[2].scored, true);
    assert.equal(finalLedger.entries[2].cycle_id, cycleAfterOfficial.cycle_id);
    assert.equal(finalLedger.entries[2].sequence_position, 3);
    const result = JSON.parse(readFileSync(runPaths(home, officialRun.run_id).result, "utf8"));
    assert.deepEqual(result.facet_coverage.occasions.observed_levels, [finalLedger.entries[2].occasion_id], "the run's facet records do not carry the administration occasion the ledger assigned");
    // #585. `score` and `duration_ms` travel onto the ledger entry from this exact run, not as a
    // fabricated number: the ledger's score is the run's own issued composite value, whatever it
    // is (including null, if the composite withheld) -- never a number this administration did not
    // earn. Without this, `memorization_indicator` and `speed_only_improvement` could never leave
    // null from real use, whatever `practiceAnalysis` computes from a form with two administrations.
    assert.equal(finalLedger.entries[2].score, result.aos_composite.value, "the ledger's score must be the run's own issued composite, not left null while a real one exists");
    assert.equal(typeof finalLedger.entries[2].duration_ms, "number");
    assert.equal(finalLedger.entries[2].duration_ms >= 0, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a corrupt exposure ledger refuses the whole assessment rather than committing a run with no ledger row", async () => {
  const { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { addAgent, makePlan, run } = await import("./helpers.mjs");

  const cwd = mkdtempSync(join(tmpdir(), "aos-exposure-ledger-corrupt-"));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });

    // Valid JSON, an absurd ledger: `openExposureLedger` must refuse this the same as any other
    // shape it does not recognise, not read it as a home that never administered anything.
    const ledgerFile = join(home, "exposure-ledger.json");
    writeFileSync(ledgerFile, "null\n");
    assert.equal(readdirSync(join(home, "runs")).length, 0, "the fixture starts with no runs");

    // The corrupt ledger is caught before the run is created -- not after it is scored and
    // committed. A refusal here is the only shape that does not leave a committed run behind with
    // no ledger row to show it happened.
    const attempt = run(cwd, ["assess", "--plan", plan, "--seed", "0000000000000099"], 2);
    assert.match(attempt.stderr, /AOS_EXPOSURE_LEDGER_CORRUPT/);
    assert.equal(readdirSync(join(home, "runs")).length, 0, "a refused assessment must create no run directory at all");

    // And the ledger itself was not quietly rewritten as fresh; the corruption is still there for
    // the operator to see and fix.
    assert.equal(readFileSync(ledgerFile, "utf8").trim(), "null");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Alternate-form linking: equivalence, drift, retirement (#585)

const linkingFixtures = () => {
  const digestL = `sha256:${"7".repeat(64)}`;
  const digestR = `sha256:${"8".repeat(64)}`;
  const left = { form_id: "aos-operational-00aa", form_contract_digest: digestL, construct_opportunity_ids: ["C1.GF.01", "C2.SC.01", "C3.RD.01", "C4.IQ.01"] };
  const right = { form_id: "aos-operational-00ab", form_contract_digest: digestR, construct_opportunity_ids: ["C1.GF.01", "C2.SC.01", "C3.RD.01", "C5.VF.01"] };
  const anchors = ["C1.GF.01", "C2.SC.01", "C3.RD.01"];
  const empirical = {
    method: "anchored-delta.v1",
    method_version: "1.0.0",
    sample_per_form: { left: 25, right: 25 },
    anchor_deltas: { "C1.GF.01": 0.02, "C2.SC.01": -0.03, "C3.RD.01": 0.01 }
  };
  return { left, right, anchors, empirical };
};

test("different seeds alone never link two forms: equivalence stays unestablished with the missing evidence named", async () => {
  const { linkForms } = await import("../../lib/form-class.mjs");
  const { left, right } = linkingFixtures();
  const scaffold = linkForms({ left_form: left, right_form: right });
  assert.equal(scaffold.equivalence_decision, null, "no empirical linking data is a null, not a verdict either way");
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.claim_stage_ceiling, "PROFILE_BOUND");
  assert.equal(scaffold.drift.status, "NOT_MONITORED");
  for (const missing of ["anchor_opportunity_ids", "exposure_history", "task_model_digest", "cross_form_response_patterns"]) {
    assert.equal(scaffold.inputs_missing.includes(missing), true, `${missing} is absent and the scaffold does not say so`);
  }
  // The coverage comparison is computable without any empirical study, and is reported.
  assert.deepEqual(scaffold.coverage.shared, ["C1.GF.01", "C2.SC.01", "C3.RD.01"]);
  assert.deepEqual(scaffold.coverage.left_only, ["C4.IQ.01"]);
  assert.deepEqual(scaffold.coverage.right_only, ["C5.VF.01"]);
});

test("a small linking sample never passes: the decision stays null and names the floor", async () => {
  const { linkForms, LINKING_METHOD_INTERFACE } = await import("../../lib/form-class.mjs");
  const { left, right, anchors, empirical } = linkingFixtures();
  const scaffold = linkForms({
    left_form: left, right_form: right, anchor_ids: anchors,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`,
    response_patterns: { ...empirical, sample_per_form: { left: LINKING_METHOD_INTERFACE.minimum_sample_per_form - 1, right: 25 } }
  });
  assert.equal(scaffold.equivalence_decision, null);
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.reasons.some((reason) => reason.includes("AOS_LINKING_SAMPLE_BELOW_MINIMUM")), true);
});

test("adequate anchor evidence within thresholds links; beyond them it drifts; disjoint anchors fail", async () => {
  const { linkForms } = await import("../../lib/form-class.mjs");
  const { left, right, anchors, empirical } = linkingFixtures();
  const complete = {
    left_form: left, right_form: right, anchor_ids: anchors,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`
  };
  const linked = linkForms({ ...complete, response_patterns: empirical });
  assert.equal(linked.equivalence_decision, true);
  assert.equal(linked.equivalence_status, "LINKED");
  assert.equal(linked.claim_stage_ceiling, null);
  assert.equal(linked.drift.status, "WITHIN_THRESHOLDS");
  const drifted = linkForms({ ...complete, response_patterns: { ...empirical, anchor_deltas: { ...empirical.anchor_deltas, "C3.RD.01": 0.4 } } });
  assert.equal(drifted.equivalence_decision, false);
  assert.equal(drifted.equivalence_status, "DRIFTED");
  assert.equal(drifted.claim_stage_ceiling, "PROFILE_BOUND");
  assert.equal(drifted.drift.status, "EXCEEDED");
  const disjoint = linkForms({ ...complete, anchor_ids: ["C9.XX.01", "C1.GF.01", "C2.SC.01"], response_patterns: empirical });
  assert.equal(disjoint.equivalence_decision, false);
  assert.equal(disjoint.equivalence_status, "FAILED");
  assert.equal(disjoint.reasons.some((reason) => reason.includes("AOS_LINKING_ANCHORS_NOT_SHARED")), true);
  // Linking a form to itself is not a question this scaffold answers.
  assert.throws(() => linkForms({ ...complete, right_form: left, response_patterns: empirical }), /AOS_LINKING_SAME_FORM/);
  // And a linked scaffold is what lets a bank record say LINKED -- derived, not declared.
  const { formBankRecord: bank } = await import("../../lib/form-class.mjs");
  const record = bank({ form_id: left.form_id, form_class: "OPERATIONAL", construct_opportunity_ids: left.construct_opportunity_ids, oracle_digest: `sha256:${"c".repeat(64)}`, linking: linked });
  assert.equal(record.equivalence_status, "LINKED");
});

test("the exposure ledger drives form retirement: any exposure retires a form from official use", async () => {
  const { createExposureLedger, formLifecycleState, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"d".repeat(64)}`;
  const fresh = formLifecycleState(createExposureLedger(), { form_contract_digest: digest });
  assert.equal(fresh.retirement_status, "ACTIVE");
  assert.equal(fresh.exposure_count, 0);
  assert.equal(fresh.equivalence_status, "UNESTABLISHED");
  assert.equal(fresh.drift_status, "NOT_MONITORED");
  const { ledger } = recordExposure(createExposureLedger(), { form_id: "f", form_contract_digest: digest, declared_class: "OPERATIONAL", administered_class: "PRACTICE", occurred_at: "2026-09-06T10:00:00.000Z", scored: false });
  const exposed = formLifecycleState(ledger, { form_contract_digest: digest });
  assert.equal(exposed.retirement_status, "RETIRED_FROM_OFFICIAL_USE", "an unscored exposure still burns the form: the operator has met the oracle");
  assert.equal(exposed.exposure_count, 1);
  assert.equal(exposed.scored_count, 0);
});

// ---------------------------------------------------------------------------------------------
// Practice and occasion effects (#585)

test("practice contamination is recorded with its exact reason and excludes the form from generalizability evidence", async () => {
  const { createExposureLedger, practiceAnalysis, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"e".repeat(64)}`;
  const record = (ledger, at, score, duration) => recordExposure(ledger, {
    form_id: "aos-operational-00e1", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: at, scored: false, score, duration_ms: duration
  }).ledger;
  // Nothing administered: nothing to analyse, and null says so rather than a clean bill.
  const empty = practiceAnalysis(createExposureLedger(), { form_contract_digest: digest });
  assert.equal(empty.practice_contaminated, null);
  assert.equal(empty.generalizability_evidence_eligible, null);
  // One first exposure: uncontaminated, eligible.
  const once = practiceAnalysis(record(createExposureLedger(), "2026-09-06T10:00:00.000Z", 60, 900000), { form_contract_digest: digest });
  assert.equal(once.practice_contaminated, false);
  assert.equal(once.generalizability_evidence_eligible, true);
  assert.deepEqual(once.exclusion_reasons, []);
  // A replay with improvement: contaminated, excluded, with the exact reasons on the record.
  const twice = record(record(createExposureLedger(), "2026-09-06T10:00:00.000Z", 60, 900000), "2026-09-07T10:00:00.000Z", 85, 600000);
  const analysis = practiceAnalysis(twice, { form_contract_digest: digest });
  assert.equal(analysis.practice_contaminated, true);
  assert.equal(analysis.generalizability_evidence_eligible, false);
  assert.equal(analysis.exclusion_reasons.some((reason) => reason.includes("AOS_PRACTICE_SAME_FORM_REEXPOSURE")), true);
  assert.equal(analysis.memorization_indicator, true, "improvement on a replayed form is memorisation evidence, not skill evidence");
  assert.equal(analysis.exclusion_reasons.some((reason) => reason.includes("AOS_PRACTICE_MEMORIZATION_SUSPECTED")), true);
  assert.equal(analysis.same_form_exposure_count, 2);
  assert.equal(analysis.oracle_familiarity_count, 1, "the second administration met an oracle the operator had already seen once");
  assert.deepEqual(analysis.administrations.map((entry) => entry.sequence_position), [1, 2]);
  assert.equal(analysis.administrations[1].interval_ms, 86400000);
});

test("speed-only improvement is an indicator on the record, never a skill gain", async () => {
  const { createExposureLedger, practiceAnalysis, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"f".repeat(64)}`;
  const grow = (ledger, at, score, duration) => recordExposure(ledger, {
    form_id: "aos-operational-00f1", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: at, scored: false, score, duration_ms: duration
  }).ledger;
  const ledger = grow(grow(createExposureLedger(), "2026-09-06T10:00:00.000Z", 70, 900000), "2026-09-07T10:00:00.000Z", 70, 300000);
  const analysis = practiceAnalysis(ledger, { form_contract_digest: digest });
  assert.equal(analysis.speed_only_improvement, true);
  assert.equal(analysis.memorization_indicator, false, "a flat score is not score improvement");
  assert.equal(analysis.exclusion_reasons.some((reason) => reason.includes("AOS_PRACTICE_SPEED_ONLY")), true);
  // Without durations the indicator is unobserved, not false.
  const scoreless = grow(grow(createExposureLedger(), "2026-09-06T10:00:00.000Z", null, null), "2026-09-07T10:00:00.000Z", null, null);
  assert.equal(practiceAnalysis(scoreless, { form_contract_digest: digest }).speed_only_improvement, null);
});

test("raw improvement is never marked as skill gain: replay suggests memorisation, an unlinked form withholds, a linked form observes", async () => {
  const { scoreChangeClaim } = await import("../../lib/form-class.mjs");
  const digestA = `sha256:${"a1".repeat(32)}`;
  const digestB = `sha256:${"b2".repeat(32)}`;
  const earlier = { form_contract_digest: digestA, score: 55 };
  const later = { form_contract_digest: digestA, score: 90 };
  const replay = scoreChangeClaim({ earlier, later });
  assert.equal(replay.delta, 35);
  assert.equal(replay.interpretable_change, false, "the same form cannot measure the same operator twice");
  assert.equal(replay.interpretation, "MEMORIZATION_SUSPECTED");
  // Two different forms with no established equivalence: an easier form explains the delta as
  // well as skill does, so the claim is withheld -- not made with a caveat.
  const unlinked = scoreChangeClaim({ earlier, later: { form_contract_digest: digestB, score: 90 } });
  assert.equal(unlinked.interpretable_change, null);
  assert.equal(unlinked.interpretation, "WITHHELD_EQUIVALENCE_UNESTABLISHED");
  // Linked forms put the two scores on one scale; the observed change becomes interpretable,
  // and it is still only an observed change.
  const linking = { schema_id: "aos-form-linking-scaffold.v1", equivalence_status: "LINKED", equivalence_decision: true, left_form_contract_digest: digestA, right_form_contract_digest: digestB };
  const linked = scoreChangeClaim({ earlier, later: { form_contract_digest: digestB, score: 90 }, linking });
  assert.equal(linked.interpretable_change, true);
  assert.equal(linked.interpretation, "OBSERVED_ON_LINKED_FORMS");
  // A linking record about two other forms is not evidence about these two.
  const foreign = { ...linking, left_form_contract_digest: `sha256:${"c3".repeat(32)}`, right_form_contract_digest: `sha256:${"d4".repeat(32)}` };
  assert.equal(scoreChangeClaim({ earlier, later: { form_contract_digest: digestB, score: 90 }, linking: foreign }).interpretable_change, null);
});

// ---------------------------------------------------------------------------------------------
// C7 learning and transfer scaffold (#585)

test("the transfer protocol is versioned, phase B is held out, and C7 never enters the core composite", async () => {
  const { TRANSFER_PROTOCOL, assessTransfer } = await import("../../lib/form-class.mjs");
  assert.equal(TRANSFER_PROTOCOL.schema_id, "aos-transfer-protocol.v1");
  assert.equal(TRANSFER_PROTOCOL.version, "1.0.0");
  assert.equal(TRANSFER_PROTOCOL.separate_from_core_composite, true);
  const phaseB = TRANSFER_PROTOCOL.phases.find((phase) => phase.phase_id === "B");
  assert.equal(phaseB.agent_available, false);
  assert.equal(phaseB.transcript_available, false);
  assert.equal(TRANSFER_PROTOCOL.phases.find((phase) => phase.phase_id === "A").contributes_to_transfer_decision, false);
  assert.deepEqual([...TRANSFER_PROTOCOL.outputs], ["near_transfer", "far_transfer", "retention_transfer", "independent_verification_behavior"]);
  // No longitudinal study exists: every output is null and the status says UNESTABLISHED. That is
  // the release-permitted honest answer, not a placeholder for a number.
  const unmeasured = assessTransfer({});
  assert.equal(unmeasured.schema_id, "aos-transfer-report.v1");
  for (const output of TRANSFER_PROTOCOL.outputs) assert.equal(unmeasured[output], null, `${output} invented a value with no phase B evidence`);
  assert.equal(unmeasured.status, "UNESTABLISHED");
  assert.equal(unmeasured.included_in_core_composite, false);
  assert.equal(unmeasured.core_composite_contribution, null);
  // A phase B that still had the agent or the transcript is not a held-out phase B at all.
  assert.throws(() => assessTransfer({ phase_b: { agent_available: true, transcript_available: false, tasks: [] } }), /AOS_TRANSFER_PHASE_B_NOT_HELD_OUT/);
  assert.throws(() => assessTransfer({ phase_b: { agent_available: false, transcript_available: true, tasks: [] } }), /AOS_TRANSFER_PHASE_B_NOT_HELD_OUT/);
});

test("collaborative success with solo transfer failure stays a C7 fact and touches no core outcome", async () => {
  const { readFileSync } = await import("node:fs");
  const { assessTransfer } = await import("../../lib/form-class.mjs");
  const fixture = JSON.parse(readFileSync(new URL("../../fixtures/transfer/c7-collaborative-success-solo-fail.json", import.meta.url), "utf8"));
  const report = assessTransfer(fixture);
  assert.equal(report.phase_a.collaborative_success, true, "phase A is recorded");
  assert.equal(report.near_transfer, false, "the held-out related task failed and the report says so");
  assert.equal(report.far_transfer, null, "no far task was administered; null, not failure");
  assert.equal(report.retention_transfer, null);
  assert.equal(report.independent_verification_behavior, false);
  assert.equal(report.status, "OBSERVED");
  assert.equal(report.included_in_core_composite, false);
  assert.equal(report.core_composite_contribution, null);
  assert.equal(Object.isFrozen(report), true);
  // The counterfactual: phase A alone, however successful, moves nothing.
  const phaseAOnly = assessTransfer({ phase_a: fixture.phase_a });
  assert.equal(phaseAOnly.near_transfer, null, "collaborative success is not independent transfer");
  assert.equal(phaseAOnly.status, "UNESTABLISHED");
});

test("held-out passes establish transfer per relatedness, and delayed tasks answer retention", async () => {
  const { assessTransfer } = await import("../../lib/form-class.mjs");
  const report = assessTransfer({
    phase_b: {
      agent_available: false,
      transcript_available: false,
      tasks: [
        { task_id: "near-1", relatedness: "near", passed: true, independent_verification_observed: true, delayed: false },
        { task_id: "far-1", relatedness: "far", passed: true, independent_verification_observed: true, delayed: true }
      ]
    }
  });
  assert.equal(report.near_transfer, true);
  assert.equal(report.far_transfer, true);
  assert.equal(report.retention_transfer, true);
  assert.equal(report.independent_verification_behavior, true);
  assert.equal(report.uncertainty.status, "SINGLE_OCCASION", "one held-out occasion is not a longitudinal study and the report says so");
  assert.equal(report.included_in_core_composite, false);
});

// ---------------------------------------------------------------------------------------------
// DIF / invariance gate: comparison withholding (#585)

test("every cross-facet comparison is withheld until invariance evidence exists, for each declared facet", async () => {
  const { INVARIANCE_FACETS, comparisonGate } = await import("../../lib/form-class.mjs");
  const { modelIdentityProjection } = await import("../../lib/model-identity.mjs");
  assert.deepEqual([...INVARIANCE_FACETS], ["language", "interface", "model_runtime", "platform", "experience", "administration_version"]);
  for (const facet of INVARIANCE_FACETS) {
    const gate = comparisonGate({ facet, left_level: "a", right_level: "b" });
    assert.equal(gate.decision, null, `${facet}: no invariance evidence is a null, not a verdict`);
    assert.equal(gate.comparison, "WITHHELD", `${facet}: the comparison must be withheld, not made with a caveat`);
    assert.equal(gate.reasons.some((reason) => reason.includes("INVARIANCE_UNESTABLISHED")), true, facet);
  }
  assert.throws(() => comparisonGate({ facet: "hair_colour", left_level: "a", right_level: "b" }), /AOS_COMPARISON_FACET_UNKNOWN/);
  // Same operator, new model: the projection this product already publishes and this gate answer
  // the same question the same way, from the same contract state.
  const projection = modelIdentityProjection();
  assert.equal(projection.cross_model_comparison, "WITHHELD");
  assert.equal(comparisonGate({ facet: "model_runtime", left_level: "gpt-x", right_level: "gpt-y" }).comparison, "WITHHELD");
});

test("translation alone is not invariance: a re-expressed form's comparison is withheld outright", async () => {
  const { comparisonGate, DIF_RUNNER_REPORT_SCHEMA_ID, DIF_RUNNER_INTERFACE } = await import("../../lib/form-class.mjs");
  const translated = comparisonGate({ facet: "language", left_level: "ko", right_level: "en" });
  assert.equal(translated.comparison, "WITHHELD");
  assert.equal(translated.decision, null);
  // Evidence about another facet, or about other levels, is not evidence about this comparison.
  const foreignFacet = comparisonGate({
    facet: "language", left_level: "ko", right_level: "en",
    invariance_evidence: { schema_id: DIF_RUNNER_REPORT_SCHEMA_ID, interface_version: DIF_RUNNER_INTERFACE.version, facet: "interface", levels: ["cli", "web"], sample_per_group: { "cli": 40, "web": 40 }, dif_detected: false }
  });
  assert.equal(foreignFacet.comparison, "WITHHELD");
  assert.equal(foreignFacet.reasons.some((reason) => reason.includes("AOS_COMPARISON_EVIDENCE_SCOPE")), true);
  const foreignLevels = comparisonGate({
    facet: "language", left_level: "ko", right_level: "en",
    invariance_evidence: { schema_id: DIF_RUNNER_REPORT_SCHEMA_ID, interface_version: DIF_RUNNER_INTERFACE.version, facet: "language", levels: ["en", "ja"], sample_per_group: { en: 40, ja: 40 }, dif_detected: false }
  });
  assert.equal(foreignLevels.comparison, "WITHHELD");
});

test("a small DIF sample never turns a comparison on, and detected DIF refuses it", async () => {
  const { comparisonGate, DIF_RUNNER_INTERFACE, DIF_RUNNER_REPORT_SCHEMA_ID } = await import("../../lib/form-class.mjs");
  assert.equal(DIF_RUNNER_INTERFACE.schema_id, "aos-dif-runner-interface.v1");
  assert.equal(DIF_RUNNER_INTERFACE.version, "1.0.0");
  const evidence = (overrides = {}) => ({
    schema_id: DIF_RUNNER_REPORT_SCHEMA_ID,
    interface_version: DIF_RUNNER_INTERFACE.version,
    facet: "language",
    levels: ["ko", "en"],
    sample_per_group: { ko: DIF_RUNNER_INTERFACE.minimum_sample_per_group, en: DIF_RUNNER_INTERFACE.minimum_sample_per_group },
    dif_detected: false,
    ...overrides
  });
  const small = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ sample_per_group: { ko: 5, en: 200 } }) });
  assert.equal(small.decision, null, "a small sample is not a smaller yes");
  assert.equal(small.comparison, "WITHHELD");
  assert.equal(small.reasons.some((reason) => reason.includes("AOS_COMPARISON_SAMPLE_BELOW_MINIMUM")), true);
  const passed = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence() });
  assert.equal(passed.decision, true);
  assert.equal(passed.comparison, "PERMITTED");
  const detected = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ dif_detected: true }) });
  assert.equal(detected.decision, false, "detected DIF is a contradiction, not an absence");
  assert.equal(detected.comparison, "REFUSED");
  // An undeclared level is not an equal one: two silences do not compare.
  const undeclared = comparisonGate({ facet: "language", left_level: null, right_level: null });
  assert.equal(undeclared.comparison, "WITHHELD");
  assert.equal(undeclared.decision, null);
  assert.equal(undeclared.reasons.some((reason) => reason.includes("AOS_COMPARISON_FACET_UNDECLARED")), true);
  // The same declared level on both sides is not a cross-facet comparison at all.
  const same = comparisonGate({ facet: "language", left_level: "ko", right_level: "ko" });
  assert.equal(same.decision, true);
  assert.equal(same.comparison, "PERMITTED");
  // A runner that does not speak the versioned interface establishes nothing.
  const wrongRunner = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ schema_id: "somebody-elses-dif.v9" }) });
  assert.equal(wrongRunner.comparison, "WITHHELD");
  assert.equal(wrongRunner.reasons.some((reason) => reason.includes("AOS_COMPARISON_RUNNER_MISMATCH")), true);
});
