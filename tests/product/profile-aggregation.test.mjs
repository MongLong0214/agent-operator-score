import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson, writeJson } from "../../lib/core.mjs";
import { LOOPBACK, startDashboard } from "../../lib/dashboard.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { loadSchema, validateAgainstSchema } from "../../lib/execution-plan.mjs";
import {
  AGGREGATION_VECTORS_URL,
  COMPOSITE_FORMULA,
  LABELS,
  LEGACY_RESULT_SCHEMA_ID,
  OUTCOME_DOMAINS,
  RELIANCE_METRIC_IDS,
  RESULT_SCHEMA_ID,
  RESULT_SCHEMA_URL,
  RESULT_SCHEMA_VERSION,
  assertUniformResultSchema,
  buildResult,
  compositeOf,
  equalWeightIndex,
  isLegacyResult,
  outcomeDomains,
  resultSchemaDigest,
  resultSchemaOf
} from "../../lib/result-schema.mjs";
import { scoreRun } from "../../lib/scorer-v1.mjs";
import { initHome } from "../../lib/store.mjs";
import { complete, contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";
import { run as runCli } from "./helpers.mjs";

// verify:profile-aggregation
//
// The four surfaces, built from what the #582 contract issued and nothing else. What these tests
// hold is the fail-closed arithmetic: a withheld construct or domain withholds its index rather
// than averaging over what is left, a withheld index withholds the composite, missing is never a
// zero, and the weights are equal because the contract says so, not because a renderer decided.

const populated = contractWithAPopulatedIndex();
const fullRun = () => evaluate(observationsWith(), identified, populated);

const constructRow = (result, id) => result.operator_process_profile.constructs[id];
const domainRow = (result, id) => result.system_outcome_profile.domains[id];

test("buildResult emits the four surfaces under the bumped schema id and version", () => {
  const result = buildResult({ contract: populated, evaluation: fullRun() });
  assert.equal(result.schema_id, RESULT_SCHEMA_ID);
  assert.equal(result.schema_version, RESULT_SCHEMA_VERSION);
  assert.notEqual(RESULT_SCHEMA_ID, LEGACY_RESULT_SCHEMA_ID);
  for (const surface of ["operator_process_profile", "reliance_calibration_profile", "system_outcome_profile", "aos_composite"]) {
    assert.equal(typeof result[surface], "object", surface);
  }
  assert.equal(result.claim_stage, "PROFILE_BOUND");
  assert.equal(buildResult({ contract: populated, evaluation: evaluate(observationsWith(), complete, populated) }).claim_stage, "RUN_DIAGNOSTIC");
  assert.equal(result.generalizability_status, "UNESTABLISHED");
  // The uncertainty statement is the contract's own until #584 supplies a computed one.
  assert.deepEqual(result.uncertainty, { status: "INSUFFICIENT_DATA", method: null });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.aos_composite));
});

test("the three labels are exactly the issue's text, en dash included", () => {
  const result = buildResult({ contract: populated, evaluation: fullRun() });
  assert.equal(result.operator_process_profile.label, "PROFILE-BOUND OPERATOR PROCESS INDEX");
  assert.equal(result.system_outcome_profile.label, "PROFILE-BOUND SYSTEM OUTCOME INDEX");
  assert.equal(result.aos_composite.label, "PROFILE-BOUND OPERATOR–AGENT SYSTEM PERFORMANCE");
  assert.deepEqual(LABELS, {
    operator_process: "PROFILE-BOUND OPERATOR PROCESS INDEX",
    system_outcome: "PROFILE-BOUND SYSTEM OUTCOME INDEX",
    aos_composite: "PROFILE-BOUND OPERATOR–AGENT SYSTEM PERFORMANCE"
  });
});

test("the process index is the equal-weight mean of the six construct estimates the contract issued", () => {
  // M12 carries C4's operator-process cell; two of its four subchecks failing gives C4 exactly 0.5,
  // and with the other five constructs at 1 the index is (5 + 0.5) / 6.
  const result = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith({
      M12: { "retry-input-meaningfully-changed": false, "reroute-reason-matches-failure": false, "unnecessary-switch-avoided": true, "instruction-actionable-and-scoped": true }
    }), identified, populated)
  });
  const profile = result.operator_process_profile;
  assert.equal(profile.issued, true);
  assert.deepEqual(Object.keys(profile.constructs), ["C1", "C2", "C3", "C4", "C5", "C6"]);
  assert.equal(constructRow(result, "C4").estimate, 0.5);
  assert.equal(constructRow(result, "C4").value, 50);
  assert.equal(profile.index, (100 * (5 + 0.5)) / 6);
  assert.equal(profile.weights.C4, 1 / 6);
  assert.equal(new Set(Object.values(profile.weights)).size, 1);
});

test("a construct estimate is used verbatim from the contract, never recomputed from opportunity counts", () => {
  const evaluation = fullRun();
  const result = buildResult({ contract: populated, evaluation });
  for (const id of ["C1", "C2", "C3", "C4", "C5", "C6"]) {
    const issued = evaluation.constructs.find((row) => row.construct_id === id && row.axis === "operator_process");
    assert.equal(constructRow(result, id).estimate, issued.estimate, id);
    assert.equal(constructRow(result, id).status, issued.status, id);
  }
  assert.equal(result.operator_process_profile.index, evaluation.process_index.value * 100);
});

test("outcome domains O1-O4 partition the contract's required credit-bearing system-outcome cells and exclude the longitudinal lane", () => {
  const domains = outcomeDomains(shippedEcdContract());
  assert.deepEqual(domains.map((domain) => domain.domain_id), ["O1", "O2", "O3", "O4"]);
  assert.deepEqual(domains.map((domain) => domain.title), [
    "Functional & Artifact Outcome",
    "Verification & Exact Revision",
    "Safety, Scope & Completion Integrity",
    "Efficiency & Resource Outcome"
  ]);
  const claimed = domains.flatMap((domain) => domain.cell_ids);
  assert.equal(new Set(claimed).size, claimed.length);
  const contract = shippedEcdContract();
  const longitudinal = new Set(contract.construct_map.longitudinal_lane.construct_ids);
  const expected = contract.cells.cells
    .filter((cell) => cell.axis === "system_outcome" && cell.required_for_construct && cell.credit_bearing && !longitudinal.has(cell.construct_id))
    .map((cell) => cell.cell_id)
    .sort();
  assert.deepEqual([...claimed].sort(), expected);
  assert.equal(claimed.includes("C7.TR.01"), false);
  assert.deepEqual(OUTCOME_DOMAINS.map((domain) => domain.domain_id), ["O1", "O2", "O3", "O4"]);
});

test("outcomeDomains refuses a contract whose system-outcome cells the declared grouping does not cover", () => {
  const forged = JSON.parse(JSON.stringify(shippedEcdContract()));
  forged.cells.cells.push({ ...forged.cells.cells.find((cell) => cell.cell_id === "C5.FO.01"), cell_id: "C5.XX.01" });
  assert.throws(() => outcomeDomains(forged), /AOS_OUTCOME_DOMAIN_DRIFT/);
});

test("a domain is the equal-weight mean of its required outcome cells", () => {
  // O2 is C5.IV.01 and C5.RB.01. M15 (independent verification) half failing gives C5.IV.01 = 0.5
  // and the domain (0.5 + 1) / 2, whatever the opportunity counts of the two cells are.
  const result = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith({
      M15: { "verifier-process-separate": false, "verifier-code-immutable": false, "verifier-exits-success": true, "verifier-evidence-complete": true }
    }), identified, populated)
  });
  const o2 = domainRow(result, "O2");
  assert.equal(o2.status, "ISSUED");
  assert.deepEqual(o2.required_cells, ["C5.IV.01", "C5.RB.01"]);
  assert.equal(o2.estimate, 0.75);
  assert.equal(o2.value, 75);
  assert.equal(result.system_outcome_profile.weights.O2, 1 / 4);
  assert.equal(result.system_outcome_profile.index, (100 * (3 + 0.75)) / 4);
});

test("withholds the process index and the composite when any construct is withheld, and never averages the rest", () => {
  const result = buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M12: null }), identified, populated) });
  const profile = result.operator_process_profile;
  assert.equal(constructRow(result, "C4").status, "WITHHELD");
  assert.equal(constructRow(result, "C4").estimate, null);
  assert.equal(profile.issued, false);
  assert.equal(profile.index, null);
  assert.deepEqual(profile.withheld_for, ["C4"]);
  assert.equal(result.system_outcome_profile.issued, true);
  assert.equal(result.aos_composite.issued, false);
  assert.equal(result.aos_composite.value, null);
  assert.deepEqual(result.aos_composite.withheld_for, ["operator_process"]);
});

test("withholds the outcome index and the composite when any domain is withheld", () => {
  const result = buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M16: null }), identified, populated) });
  assert.equal(domainRow(result, "O2").status, "WITHHELD");
  assert.deepEqual(domainRow(result, "O2").withheld_for, [{ cell_id: "C5.RB.01", status: "NOT_OBSERVED" }]);
  assert.equal(result.system_outcome_profile.issued, false);
  assert.equal(result.system_outcome_profile.index, null);
  assert.deepEqual(result.system_outcome_profile.withheld_for, ["O2"]);
  assert.equal(result.operator_process_profile.issued, true);
  assert.equal(result.aos_composite.value, null);
  assert.deepEqual(result.aos_composite.withheld_for, ["system_outcome"]);
});

test("a missing cell is carried as its named reason and never as a zero in any mean", () => {
  const withheld = buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M16: null }), identified, populated) });
  assert.deepEqual(withheld.system_outcome_profile.missing.not_observed, ["C5.RB.01"]);
  assert.equal(withheld.system_outcome_profile.index, null);
  // If the missing cell had been averaged as 0, O2 would read 0.5 and the index 87.5. Neither number
  // may appear anywhere in the outcome surface.
  const flat = canonicalJson(withheld.system_outcome_profile);
  assert.equal(/"estimate":0[,}]/u.test(flat), false);
  assert.equal(/"index":87\.5/u.test(flat), false);
});

test("the composite is the 50:50 arithmetic mean of the two indices under aos-composite.v1 and marked secondary", () => {
  const result = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith({
      M12: { "retry-input-meaningfully-changed": false, "reroute-reason-matches-failure": false, "unnecessary-switch-avoided": true, "instruction-actionable-and-scoped": true },
      M15: { "verifier-process-separate": false, "verifier-code-immutable": false, "verifier-exits-success": true, "verifier-evidence-complete": true }
    }), identified, populated)
  });
  const process = result.operator_process_profile.index;
  const outcome = result.system_outcome_profile.index;
  assert.equal(result.aos_composite.issued, true);
  assert.equal(result.aos_composite.value, (process + outcome) / 2);
  assert.equal(result.aos_composite.formula, COMPOSITE_FORMULA);
  assert.equal(COMPOSITE_FORMULA, "aos-composite.v1");
  assert.deepEqual(result.aos_composite.weights, { operator_process: 0.5, system_outcome: 0.5 });
  assert.equal(result.aos_composite.secondary, true);
  assert.deepEqual(compositeOf(80, 60), { value: 70, issued: true, withheld_for: [] });
  assert.deepEqual(compositeOf(null, 60), { value: null, issued: false, withheld_for: ["operator_process"] });
  assert.deepEqual(compositeOf(80, null), { value: null, issued: false, withheld_for: ["system_outcome"] });
});

test("the delegated-artifact axis is carried on the composite surface descriptively and never enters its value", () => {
  // The evidence model files the delegated_artifact axis under "Operator-Agent System Performance",
  // and SSOT section 20 fixes that surface's number as the mean of the two indices. Both hold: the
  // estimates are shown there, verbatim, and a failing artifact cell moves nothing numeric.
  const baseline = buildResult({ contract: populated, evaluation: fullRun() });
  // M01 administers both axes: unrelated-objective-absent is C1's operator-process cell and the other
  // two subchecks are artifact cells, so only the artifact ones fail here.
  const artifactFails = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith({ M01: { "required-outcome-preserved": false, "forbidden-outcome-absent": false, "unrelated-objective-absent": true } }), identified, populated)
  });
  const block = baseline.aos_composite.delegated_artifact;
  assert.equal(block.axis, "delegated_artifact");
  assert.equal(block.in_composite, false);
  assert.deepEqual(Object.keys(block.constructs), ["C1", "C2", "C4", "C5", "C6"]);
  assert.equal(block.constructs.C1.estimate, 1);
  assert.equal(block.constructs.C5.status, "WITHHELD");
  assert.notEqual(artifactFails.aos_composite.delegated_artifact.constructs.C1.estimate, 1);
  assert.equal(artifactFails.aos_composite.value, baseline.aos_composite.value);
  assert.equal(artifactFails.operator_process_profile.index, baseline.operator_process_profile.index);
  assert.equal(artifactFails.system_outcome_profile.index, baseline.system_outcome_profile.index);
});

test("equalWeightIndex issues only when every row is issued, and weights every row the same", () => {
  assert.deepEqual(equalWeightIndex([{ id: "A", estimate: 1, status: "ISSUED" }, { id: "B", estimate: 0.5, status: "ISSUED" }]), { value: 75, issued: true, withheld_for: [] });
  assert.deepEqual(equalWeightIndex([{ id: "A", estimate: 1, status: "ISSUED" }, { id: "B", estimate: null, status: "WITHHELD" }]), { value: null, issued: false, withheld_for: ["B"] });
  assert.deepEqual(equalWeightIndex([]), { value: null, issued: false, withheld_for: [] });
  // A row that claims ISSUED with no number is a contradiction, not a zero.
  assert.throws(() => equalWeightIndex([{ id: "A", estimate: null, status: "ISSUED" }]), /AOS_ISSUED_WITHOUT_ESTIMATE/);
});

test("the aggregation vector fixture is reproduced by the aggregation functions", () => {
  const fixture = JSON.parse(readFileSync(AGGREGATION_VECTORS_URL, "utf8"));
  assert.equal(fixture.fixture_id, "aos-profile-aggregation-vectors.v1");
  assert.ok(fixture.vectors.length >= 6);
  for (const vector of fixture.vectors) {
    const process = equalWeightIndex(vector.constructs);
    const outcome = equalWeightIndex(vector.domains);
    const composite = compositeOf(process.value, outcome.value);
    assert.equal(process.value, vector.expected.process_index, `${vector.vector_id}: process`);
    assert.equal(outcome.value, vector.expected.outcome_index, `${vector.vector_id}: outcome`);
    assert.equal(composite.value, vector.expected.composite, `${vector.vector_id}: composite`);
    assert.deepEqual(process.withheld_for, vector.expected.process_withheld_for, `${vector.vector_id}: process withheld`);
    assert.deepEqual(outcome.withheld_for, vector.expected.outcome_withheld_for, `${vector.vector_id}: outcome withheld`);
  }
});

test("every profile carries its coverage and issuance fields", () => {
  const result = buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M16: null }), identified, populated) });
  for (const key of ["operator_process_profile", "system_outcome_profile"]) {
    const profile = result[key];
    for (const field of ["issued", "index", "required_cells", "issued_cells", "optional_cells", "opportunity_count", "coverage", "missing", "facet_identity", "uncertainty", "claim_stage", "generalizability_status"]) {
      assert.ok(Object.hasOwn(profile, field), `${key}.${field}`);
    }
    assert.equal(profile.claim_stage, result.claim_stage);
    assert.equal(profile.generalizability_status, result.generalizability_status);
    assert.deepEqual(profile.uncertainty, result.uncertainty);
    assert.equal(profile.coverage.required, profile.required_cells.length);
    assert.equal(profile.coverage.issued, profile.issued_cells.length);
  }
  const outcome = result.system_outcome_profile;
  assert.equal(outcome.required_cells.includes("C5.RB.01"), true);
  assert.equal(outcome.issued_cells.includes("C5.RB.01"), false);
  assert.equal(outcome.coverage.issued, outcome.coverage.required - 1);
  assert.ok(outcome.opportunity_count > 0);
});

test("the reliance profile is a separate surface that defaults to WITHHELD with every metric NOT_COMPUTED", () => {
  const result = buildResult({ contract: populated, evaluation: fullRun() });
  const reliance = result.reliance_calibration_profile;
  assert.equal(reliance.status, "WITHHELD");
  assert.equal(reliance.explains_construct, "C3");
  assert.equal(typeof reliance.opportunities, "number");
  assert.deepEqual(Object.keys(reliance.metrics), [...RELIANCE_METRIC_IDS]);
  assert.deepEqual(RELIANCE_METRIC_IDS, [
    "cair", "csr", "overreliance", "underreliance", "switch_gain", "switch_harm",
    "delegation_regret", "adoption_quality", "choice_independence", "confidence_calibration"
  ]);
  for (const metric of Object.values(reliance.metrics)) {
    assert.equal(metric.value, null);
    assert.equal(metric.status, "NOT_COMPUTED");
  }
  assert.equal(Object.hasOwn(reliance, "index"), false);
  assert.equal(Object.hasOwn(reliance, "net_score"), false);
});

test("a reliance metric supplied below the operational floor is refused rather than issued", () => {
  const evaluation = fullRun();
  const ok = buildResult({
    contract: populated,
    evaluation,
    reliance: { status: "PARTIAL", metrics: { cair: { value: 0.75, status: "ISSUED", numerator: 3, denominator: 4 } } }
  });
  assert.equal(ok.reliance_calibration_profile.status, "PARTIAL");
  assert.equal(ok.reliance_calibration_profile.metrics.cair.value, 0.75);
  assert.equal(ok.reliance_calibration_profile.metrics.csr.status, "NOT_COMPUTED");
  assert.throws(() => buildResult({
    contract: populated,
    evaluation,
    reliance: { status: "PARTIAL", metrics: { cair: { value: 1, status: "ISSUED", numerator: 3, denominator: 3 } } }
  }), /AOS_RELIANCE_FLOOR/);
  assert.throws(() => buildResult({ contract: populated, evaluation, reliance: { status: "ISSUED", metrics: {} } }), /AOS_RELIANCE_STATUS/);
  assert.throws(() => buildResult({ contract: populated, evaluation, reliance: { status: "PARTIAL", metrics: { net: { value: 1, status: "ISSUED", numerator: 4, denominator: 4 } } } }), /AOS_RELIANCE_METRIC/);
});

test("the composite is unchanged by anything on the reliance surface", () => {
  const evaluation = fullRun();
  const without = buildResult({ contract: populated, evaluation });
  const withReliance = buildResult({
    contract: populated,
    evaluation,
    reliance: { status: "PARTIAL", metrics: { cair: { value: 0.1, status: "ISSUED", numerator: 1, denominator: 10 }, overreliance: { value: 0.9, status: "ISSUED", numerator: 9, denominator: 10 } } }
  });
  assert.deepEqual(withReliance.aos_composite, without.aos_composite);
  assert.deepEqual(withReliance.operator_process_profile, without.operator_process_profile);
  assert.deepEqual(withReliance.system_outcome_profile, without.system_outcome_profile);
});

test("a generalizability status above UNESTABLISHED is refused unless the evaluation supports it", () => {
  const evaluation = fullRun();
  assert.equal(evaluation.claim_stage, "PROFILE_BOUND");
  assert.throws(() => buildResult({ contract: populated, evaluation, generalizability_status: "ESTABLISHED" }), /AOS_GENERALIZABILITY_UNSUPPORTED/);
  assert.throws(() => buildResult({ contract: populated, evaluation, generalizability_status: "WHATEVER" }), /AOS_GENERALIZABILITY_STATUS/);
  assert.throws(() => buildResult({ contract: populated, evaluation, uncertainty: { status: "COMPUTED", method: null } }), /AOS_UNCERTAINTY_METHOD/);
  assert.throws(() => buildResult({ contract: populated, evaluation, uncertainty: { status: "PRECISE" } }), /AOS_UNCERTAINTY_STATUS/);
  assert.deepEqual(buildResult({ contract: populated, evaluation, uncertainty: { status: "NOT_COMPUTED", method: null } }).uncertainty, { status: "NOT_COMPUTED", method: null });
});

test("buildResult takes only a result evaluate emitted under the contract it is given", () => {
  const evaluation = fullRun();
  assert.throws(() => buildResult({ evaluation }), /AOS_CONTRACT_MISMATCH/);
  assert.throws(() => buildResult({ contract: shippedEcdContract(), evaluation }), /AOS_CONTRACT_MISMATCH/);
  assert.throws(() => buildResult({ contract: populated, evaluation: { ...evaluation } }), /AOS_UNEMITTED_EVALUATION/);
  assert.throws(() => buildResult({ contract: populated, evaluation: JSON.parse(JSON.stringify(evaluation)) }), /AOS_UNEMITTED_EVALUATION/);
  assert.throws(() => buildResult({}), /AOS_UNEMITTED_EVALUATION/);
});

test("the canonical result validates against schemas/aos-result.v2.schema.json and the schema bounds every array", () => {
  const schema = loadSchema(RESULT_SCHEMA_URL);
  const result = buildResult({ contract: populated, evaluation: fullRun(), run: { run_id: "run-1", seed: "seed-1", suite_digest: "sha256:abc" } });
  assert.deepEqual(validateAgainstSchema(JSON.parse(canonicalJson(result)), schema).errors, []);
  const withheld = buildResult({ contract: populated, evaluation: evaluate(observationsWith({ M12: null, M16: null }), identified, populated) });
  assert.deepEqual(validateAgainstSchema(JSON.parse(canonicalJson(withheld)), schema).errors, []);
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "array") assert.equal(typeof node.maxItems, "number", `${path} has no maxItems`);
    for (const [key, child] of Object.entries(node)) walk(child, `${path}/${key}`);
  };
  walk(schema, "#");
  assert.equal(schema.properties.schema_id.const, RESULT_SCHEMA_ID);
  assert.equal(schema.properties.aos_composite.properties.formula.const, COMPOSITE_FORMULA);
  assert.equal(schema.properties.aos_composite.properties.secondary.const, true);
});

test("the schema rejects a result carrying a band, a percentile or a legacy score", () => {
  const schema = loadSchema(RESULT_SCHEMA_URL);
  const result = JSON.parse(canonicalJson(buildResult({ contract: populated, evaluation: fullRun() })));
  assert.equal(validateAgainstSchema({ ...result, band: "HIGH RELIABILITY" }, schema).ok, false);
  assert.equal(validateAgainstSchema({ ...result, score: { final: 100 } }, schema).ok, false);
  assert.equal(validateAgainstSchema({ ...result, aos_composite: { ...result.aos_composite, secondary: false } }, schema).ok, false);
  assert.equal(validateAgainstSchema({ ...result, percentile: 90 }, schema).ok, false);
  assert.equal(validateAgainstSchema({ ...result, operator_process_profile: { ...result.operator_process_profile, index: 0 } }, schema).ok, true);
});

test("resultSchemaDigest is a sha256 over the schema file's bytes", () => {
  const bytes = readFileSync(RESULT_SCHEMA_URL);
  assert.equal(resultSchemaDigest(), sha256Bytes(bytes));
  assert.match(resultSchemaDigest(), /^sha256:[0-9a-f]{64}$/u);
});

test("a legacy record is recognised by its old schema and is never migrated into the new one", () => {
  const legacy = { schema_id: LEGACY_RESULT_SCHEMA_ID, ...scoreRun(observationsWith()), run_id: "run-legacy" };
  assert.equal(isLegacyResult(legacy), true);
  assert.equal(resultSchemaOf(legacy), LEGACY_RESULT_SCHEMA_ID);
  // A result written before the field existed is a legacy result too; only a record that says it
  // is the new schema is the new schema.
  assert.equal(isLegacyResult({ status: "SCORED", score: { final: 88 } }), true);
  assert.equal(resultSchemaOf({ status: "SCORED" }), LEGACY_RESULT_SCHEMA_ID);
  const current = buildResult({ contract: populated, evaluation: fullRun() });
  assert.equal(isLegacyResult(current), false);
  assert.equal(resultSchemaOf(current), RESULT_SCHEMA_ID);
  assert.throws(() => buildResult({ contract: populated, evaluation: legacy }), /AOS_UNEMITTED_EVALUATION/);
  assert.throws(() => buildResult({ legacy }), /AOS_LEGACY_RESULT_NOT_MIGRATED/);
  assert.throws(() => buildResult({ contract: populated, evaluation: fullRun(), legacy }), /AOS_LEGACY_RESULT_NOT_MIGRATED/);
});

test("refuses to aggregate legacy and new results in one cycle", () => {
  const legacyRun = { run_id: "a", result_schema: LEGACY_RESULT_SCHEMA_ID, final_score: 80 };
  const undeclaredRun = { run_id: "b", final_score: 70 };
  const currentRun = { run_id: "c", result_schema: RESULT_SCHEMA_ID, final_score: null };
  assert.deepEqual(assertUniformResultSchema([legacyRun, undeclaredRun], "cycle"), LEGACY_RESULT_SCHEMA_ID);
  assert.deepEqual(assertUniformResultSchema([currentRun], "cycle"), RESULT_SCHEMA_ID);
  assert.equal(assertUniformResultSchema([], "cycle"), null);
  assert.throws(() => assertUniformResultSchema([legacyRun, currentRun], "cycle"), /AOS_MIXED_RESULT_SCHEMAS/);
  assert.throws(() => assertUniformResultSchema([undeclaredRun, currentRun], "cycle"), /AOS_MIXED_RESULT_SCHEMAS/);
});

const cycleWith = (runs) => ({
  schema_id: "aos-cycle.v1",
  cycle_id: "cycle-mixed",
  profile_digest: "d".repeat(64),
  suite_major: 1,
  scorer_major: 1,
  seeds: ["0000000000000001", "0000000000000002", "0000000000000003"],
  runs
});
const legacyRecord = (seed, finalScore) => ({ seed, valid: true, invalid_reason: null, result_schema: LEGACY_RESULT_SCHEMA_ID, final_score: finalScore, dimensions: { D1: 80 } });
const profileRecord = (seed) => ({ seed, valid: true, invalid_reason: null, result_schema: RESULT_SCHEMA_ID, final_score: null, dimensions: {} });

test("the cycle command and the dashboard refuse the legacy median over profile results and over a mixed cycle", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-cycle-schema-"));
  const home = join(cwd, ".aos");
  initHome(home);
  try {
    writeJson(join(home, "cycle.json"), cycleWith([profileRecord("0000000000000001"), profileRecord("0000000000000002"), profileRecord("0000000000000003")]));
    const profiles = runCli(cwd, ["cycle"], 2);
    assert.match(profiles.stderr, /AOS_CYCLE_SCHEMA_UNAGGREGATED/u);
    assert.equal(profiles.stdout.includes("Operator Score"), false);
    writeJson(join(home, "cycle.json"), cycleWith([legacyRecord("0000000000000001", 71), legacyRecord("0000000000000002", 74), profileRecord("0000000000000003")]));
    const mixed = runCli(cwd, ["cycle"], 2);
    assert.match(mixed.stderr, /AOS_MIXED_RESULT_SCHEMAS/u);
    assert.equal(mixed.stdout.includes("Operator Score"), false);
    const dashboard = await startDashboard({ home });
    try {
      const index = await (await fetch(`http://${LOOPBACK}:${dashboard.port}/?t=${dashboard.token}`)).text();
      assert.match(index, /cycle aggregation withheld/u);
      assert.match(index, /AOS_MIXED_RESULT_SCHEMAS/u);
      assert.equal(/Operator Score/u.test(index), false);
      assert.equal(/>7[0-9]</u.test(index), false, "a median was printed over a mixed cycle");
    } finally {
      await dashboard.close();
    }
    // Two legacy records and one without the field: the field predates nothing here, the record
    // is legacy, and the legacy median still runs.
    const undeclared = { ...legacyRecord("0000000000000003", 77) };
    delete undeclared.result_schema;
    writeJson(join(home, "cycle.json"), cycleWith([legacyRecord("0000000000000001", 71), legacyRecord("0000000000000002", 74), undeclared]));
    const legacy = runCli(cwd, ["cycle"]);
    assert.match(legacy.stdout, /Operator Score: 74 \/ 100/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
