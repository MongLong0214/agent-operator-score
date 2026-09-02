import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson, writeJson } from "../../lib/core.mjs";
import { LOOPBACK, startDashboard } from "../../lib/dashboard.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { evaluate, loadEcdContract, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS } from "../../lib/metrics.mjs";
import { loadSchema, validateAgainstSchema } from "../../lib/execution-plan.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import {
  AGGREGATION_VECTORS_URL,
  COMPOSITE_FORMULA,
  LABELS,
  LEGACY_RESULT_SCHEMA_ID,
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
  projectResult,
  resultSchemaDigest,
  resultSchemaOf
} from "../../lib/result-schema.mjs";
import { scoreRun } from "../../lib/scorer-v1.mjs";
import { initHome } from "../../lib/store.mjs";
import { complete, contractWithAPopulatedIndex, contractWithSwappedDomains, contractWithoutDomains, identified, observationsWith } from "./ecd-fixtures.mjs";
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

test("the process index is exactly the index the contract issued, never a second average of the same rows", () => {
  // M12 carries C4's operator-process cell; two of its four subchecks failing gives C4 exactly 0.5,
  // and with the other five constructs at 1 the mean is five and a half sixths. This is the case
  // where a second implementation shows: the contract divides the sum by six and scales, and
  // scaling before the division gives 91.66666666666667 for the same six rows. Two numbers for one
  // measurement is one too many, whichever is prettier.
  const evaluation = evaluate(observationsWith({
    M12: { "retry-input-meaningfully-changed": false, "reroute-reason-matches-failure": false, "unnecessary-switch-avoided": true, "instruction-actionable-and-scoped": true }
  }), identified, populated);
  const result = buildResult({ contract: populated, evaluation });
  const profile = result.operator_process_profile;
  assert.equal(profile.issued, true);
  assert.deepEqual(Object.keys(profile.constructs), ["C1", "C2", "C3", "C4", "C5", "C6"]);
  assert.equal(constructRow(result, "C4").estimate, 0.5);
  assert.equal(constructRow(result, "C4").value, 50);
  assert.equal(profile.index, evaluation.process_index.value * 100);
  assert.notEqual(evaluation.process_index.value * 100, (100 * (5 + 0.5)) / 6);
  assert.deepEqual(profile.withheld_for, [...evaluation.process_index.withheld_for]);
  assert.equal(profile.weights.C4, 1 / 6);
  assert.equal(new Set(Object.values(profile.weights)).size, 1);
});

test("a withheld construct withholds the index the contract withheld, with the contract's own reason", () => {
  const evaluation = evaluate(observationsWith({ M12: null }), identified, populated);
  const result = buildResult({ contract: populated, evaluation });
  assert.equal(evaluation.process_index.status, "WITHHELD");
  assert.equal(result.operator_process_profile.index, null);
  assert.equal(result.operator_process_profile.issued, false);
  assert.deepEqual(result.operator_process_profile.withheld_for, [...evaluation.process_index.withheld_for]);
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
  assert.deepEqual(outcomeDomains(populated).map((domain) => domain.domain_id), ["O1", "O2", "O3", "O4"]);
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
  for (const key of ["operator_process_profile", "reliance_calibration_profile", "system_outcome_profile"]) {
    const profile = result[key];
    // Reliance has no index of its own -- that is the point of it being a separate surface -- but
    // it says what it was asked and what it saw, like the other two. A profile that names no cells
    // and no coverage cannot be read as withheld rather than empty.
    const fields = ["required_cells", "issued_cells", "optional_cells", "coverage", "missing", "facet_identity", "uncertainty", "claim_stage", "generalizability_status"];
    for (const field of key === "reliance_calibration_profile" ? fields : [...fields, "issued", "index", "opportunity_count"]) {
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

test("a metric below the floor withholds its rate and keeps the counts that say why", () => {
  // SSOT section 21: below four opportunities the *rate* is withheld and the raw counts stay. The
  // builder was dropping both, so a metric with too few opportunities and one nobody computed
  // arrived at the reader as the same four nulls, and the evidence for the withholding was gone.
  const evaluation = fullRun();
  const built = buildResult({
    contract: populated,
    evaluation,
    reliance: { status: "WITHHELD", metrics: { cair: { value: null, status: "WITHHELD", numerator: 1, denominator: 3 } } }
  });
  const cair = built.reliance_calibration_profile.metrics.cair;
  assert.deepEqual(cair, { value: null, status: "WITHHELD", numerator: 1, denominator: 3 });
  assert.deepEqual(built.reliance_calibration_profile.metrics.csr, { value: null, status: "NOT_COMPUTED", numerator: null, denominator: null });
  // And what the reader is shown: the rate withheld by name, the opportunities it rested on beside
  // it. Formatting whatever finite number was in the field printed a withheld metric as `0.00`.
  const row = projectResult(built).reliance.rows.find((one) => one.id === "cair");
  assert.deepEqual(row, { id: "cair", value: "withheld", status: "WITHHELD", opportunities: "3" });

  // The state is one state here too, and the schema is where this build says so: a withheld metric
  // carrying a number is refused wherever a stored result is read, not printed as a zero.
  const forged = JSON.parse(canonicalJson(built));
  forged.reliance_calibration_profile.metrics.cair = { value: 0, status: "WITHHELD", numerator: null, denominator: null };
  for (const call of [() => projectResult(forged), () => renderMarkdown(forged), () => renderHtml(forged), () => renderCard(forged)]) {
    assert.throws(call, /AOS_RESULT_SCHEMA_INVALID/, "a withheld metric was rendered with a value");
  }
  assert.equal(validateAgainstSchema(forged, loadSchema(RESULT_SCHEMA_URL)).ok, false);
  const stripped = JSON.parse(canonicalJson(built));
  stripped.reliance_calibration_profile.metrics.csr = { value: 0.5, status: "NOT_COMPUTED", numerator: null, denominator: null };
  assert.equal(validateAgainstSchema(stripped, loadSchema(RESULT_SCHEMA_URL)).ok, false, "a metric nobody computed carried a value");
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

test("the outcome grouping is the contract's, so moving a cell between domains moves the outcome index and nothing here overrides it", () => {
  // The grouping is not this module's to hold. It is declared in #582's construct map beside the
  // cells it groups, and read from there: a list in lib/ would be a second mapping of the same
  // cells, and swapping two of them between domains would move the equal-weight outcome index with
  // nothing to check it against. The test for that is direct -- move the cells in the contract and
  // watch the result follow.
  const shipped = outcomeDomains(populated);
  assert.deepEqual(shipped.map((domain) => domain.domain_id), ["O1", "O2", "O3", "O4"]);
  assert.deepEqual(shipped.find((domain) => domain.domain_id === "O1").cell_ids, ["C5.FO.01", "C2.HJ.01"]);
  assert.deepEqual(shipped.find((domain) => domain.domain_id === "O3").cell_ids, ["C6.SL.01", "C6.IJ.01", "C5.CI.01"]);

  const swapped = contractWithSwappedDomains();
  const moved = outcomeDomains(swapped);
  assert.deepEqual(moved.find((domain) => domain.domain_id === "O1").cell_ids, ["C6.SL.01", "C2.HJ.01"]);
  assert.deepEqual(moved.find((domain) => domain.domain_id === "O3").cell_ids, ["C5.FO.01", "C6.IJ.01", "C5.CI.01"]);
  // And the numbers follow the contract's grouping, which is the whole reason the grouping matters:
  // one failing cell lands in a two-cell domain under one grouping and a three-cell domain under
  // the other, and the equal-weight outcome index differs.
  const failing = { M14: { "hidden-functional-checks-pass": false, "deterministic-output-verified": true, "public-checks-pass": true } };
  const asShipped = buildResult({ contract: populated, evaluation: evaluate(observationsWith(failing), identified, populated) });
  const asSwapped = buildResult({ contract: swapped, evaluation: evaluate(observationsWith(failing), identified, swapped) });
  assert.notEqual(asShipped.system_outcome_profile.index, asSwapped.system_outcome_profile.index);
  assert.equal(asShipped.system_outcome_profile.domains.O1.cells.some((cell) => cell.cell_id === "C5.FO.01"), true);
  assert.equal(asSwapped.system_outcome_profile.domains.O3.cells.some((cell) => cell.cell_id === "C5.FO.01"), true);

  // A contract that declares no grouping is refused rather than grouped by something this module
  // decided, and a grouping that does not cover the contract's own cells is drift.
  assert.throws(() => outcomeDomains(contractWithoutDomains()), /AOS_OUTCOME_DOMAINS_UNDECLARED/);
});

test("a result whose schema is neither the profile schema nor the legacy one is refused by name, not rendered as legacy", () => {
  // Fail-open dispatch reads "anything that is not v2 is v1", and a file claiming any other schema
  // was rendered as an Agent Operator Score with a band under it. An unrecognised instrument is
  // refused; only the legacy id, or a record that predates the id and carries the legacy scorer's
  // own fields, is the legacy record.
  const legacyBody = { ...scoreRun(observationsWith()), run_id: "run-legacy" };
  const forged = { schema_id: "attacker-result.v99", ...legacyBody };
  for (const call of [() => isLegacyResult(forged), () => resultSchemaOf(forged), () => renderMarkdown(forged), () => renderHtml(forged), () => renderCard(forged)]) {
    assert.throws(call, /AOS_UNKNOWN_RESULT_SCHEMA/);
  }
  assert.equal(isLegacyResult({ schema_id: LEGACY_RESULT_SCHEMA_ID, ...legacyBody }), true);
  assert.equal(isLegacyResult(legacyBody), true);
  assert.throws(() => isLegacyResult({ schema_id: null, hello: "world" }), /AOS_UNKNOWN_RESULT_SCHEMA/);
  assert.throws(() => isLegacyResult("not a result"), /AOS_UNKNOWN_RESULT_SCHEMA/);
  assert.equal(isLegacyResult(buildResult({ contract: populated, evaluation: fullRun() })), false);
});

test("a stored result cannot elevate the claim it makes, and a claim about an exact profile has to name one", () => {
  // The stage is what a reader is allowed to conclude, which makes it the field worth editing.
  // Changing the top-level claim alone left every profile at PROFILE_BOUND, validated, projected,
  // and printed the elevated claim; the contract permits PROFILE_BOUND and nothing above it.
  const result = buildResult({ contract: populated, evaluation: fullRun() });
  assert.equal(result.claim_stage, "PROFILE_BOUND");
  assert.equal(result.contract.maximum_claim_stage, "PROFILE_BOUND");
  const stored = JSON.parse(canonicalJson(result));

  const elevated = JSON.parse(JSON.stringify(stored));
  elevated.claim_stage = "GENERALIZABILITY_SUPPORTED";
  for (const call of [() => projectResult(elevated), () => renderMarkdown(elevated), () => renderHtml(elevated), () => renderCard(elevated)]) {
    assert.throws(call, /AOS_CLAIM_STAGE/);
  }
  // Elevated consistently -- every surface too -- and still refused, because the ceiling is the
  // contract's and the result says which contract set it.
  const elevatedEverywhere = JSON.parse(JSON.stringify(elevated));
  for (const key of ["operator_process_profile", "reliance_calibration_profile", "system_outcome_profile", "aos_composite"]) {
    elevatedEverywhere[key].claim_stage = "GENERALIZABILITY_SUPPORTED";
  }
  assert.throws(() => projectResult(elevatedEverywhere), /AOS_CLAIM_EXCEEDS_CONTRACT/);
  // And with the ceiling itself edited, the claim still needs the generalizability it rests on.
  const raisedCeiling = JSON.parse(JSON.stringify(elevatedEverywhere));
  raisedCeiling.contract.maximum_claim_stage = "GENERALIZABILITY_SUPPORTED";
  assert.throws(() => projectResult(raisedCeiling), /AOS_CLAIM_STAGE/);
  // A missing ceiling is not permission: a claim resting on nothing is refused. The schema requires
  // the ceiling, so this is now refused before the entitlement is read at all -- which is the point
  // of validating there rather than here: the reader never sees a result missing the field it would
  // have had to check. `buildResult` still refuses to issue one, by its own name.
  const noCeiling = JSON.parse(JSON.stringify(stored));
  delete noCeiling.contract.maximum_claim_stage;
  assert.throws(() => projectResult(noCeiling), /AOS_RESULT_SCHEMA_INVALID/);
  // A stage no build knows is a word in a file: the schema enumerates the three, so it never
  // reaches the ceiling comparison.
  const invented = JSON.parse(JSON.stringify(stored));
  invented.claim_stage = "ATTACKER_DEFINED";
  assert.throws(() => projectResult(invented), /AOS_RESULT_SCHEMA_INVALID/);

  // And the profile a bound claim is bound to has to be a digest over bytes: `sha256:a` is a
  // label, and one nibble cannot identify an exact profile.
  const unbound = JSON.parse(JSON.stringify(stored));
  unbound.profile_digest = "sha256:a";
  assert.throws(() => projectResult(unbound), /AOS_RESULT_SCHEMA_INVALID/);
  assert.throws(() => buildResult({ contract: populated, evaluation: evaluate(observationsWith(), { ...identified, profile_digest: "sha256:a" }, populated) }), /AOS_CLAIM_UNBOUND/);
  const schema = loadSchema(RESULT_SCHEMA_URL);
  assert.equal(validateAgainstSchema(unbound, schema).ok, false, "the schema accepted a one-nibble digest");
  assert.equal(validateAgainstSchema(stored, schema).ok, true);
  // Every digest in the schema is the same definition, and it is 64 lowercase hex.
  const patterns = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.pattern === "string" && node.pattern.includes("sha256")) patterns.add(node.pattern);
    for (const child of Object.values(node)) walk(child);
  };
  walk(schema);
  assert.deepEqual([...patterns], ["^sha256:[0-9a-f]{64}$"], "a digest has one spelling in this schema");
});

test("the sanitiser publishes the instrument's own vocabulary and digests only what must not be published", () => {
  // The gate every published value passes through is only safe if it is also accurate. A rule wide
  // enough to eat `authoritative-source-selected` -- a subcheck this product declares, digested
  // because "auth" starts it -- takes the words out of the report and nobody notices until one is
  // missing. So the whole declared vocabulary goes through it: every string the contract and the
  // metric set are written in has to come out unchanged.
  const contract = loadEcdContract();
  const words = new Set();
  const walk = (value) => {
    if (typeof value === "string") words.add(value);
    else if (Array.isArray(value)) for (const entry of value) walk(entry);
    else if (value !== null && typeof value === "object") for (const [key, entry] of Object.entries(value)) { words.add(key); walk(entry); }
  };
  walk(contract);
  for (const id of METRIC_IDS) { words.add(id); for (const subcheck of METRICS[id].subchecks) words.add(subcheck); }
  assert.ok(words.size > 500, `only ${words.size} declared strings were checked`);

  const result = buildResult({ contract: populated, evaluation: fullRun(), observations: observationsWith() });
  const flat = canonicalJson(result);
  // Every declared string that appears in a result appears as itself.
  for (const observation of result.observations) {
    assert.equal(observation.metric_id.startsWith("sha256:"), false, observation.metric_id);
    assert.equal(observation.verifier_id?.startsWith("sha256:") ?? false, false);
    for (const subcheck of observation.subchecks) {
      assert.equal(words.has(subcheck.id), true, `${subcheck.id} is not a declared subcheck`);
      assert.equal(subcheck.id.startsWith("sha256:"), false, `${subcheck.id} was digested`);
    }
  }
  for (const cell of result.cells) assert.equal(cell.cell_id.startsWith("sha256:"), false, cell.cell_id);
  assert.ok(flat.includes("authoritative-source-selected"), "a declared subcheck was digested out of the result");
  assert.ok(flat.includes("PROFILE-BOUND"), "the boundary statement was digested");
  // And the things that must not be published still are not, in the same run.
  const leaky = buildResult({ contract: populated, evaluation: fullRun(), run: { run_id: "AKIAIOSFODNN7EXAMPLE", suite: "aos-suite-v1" } });
  assert.match(leaky.run.run_id, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(leaky.run.suite, "aos-suite-v1");
});

test("a profile result that lost a surface, a row or a status it can read is refused rather than shown as what is left", () => {
  const stored = JSON.parse(canonicalJson(buildResult({ contract: populated, evaluation: fullRun() })));
  assert.equal(projectResult(stored).process.coverage, `${stored.operator_process_profile.coverage.issued} of ${stored.operator_process_profile.coverage.required} required cells issued`);
  // Which authority refuses is part of what is asserted. Shape -- a field that must be there, a
  // status that must be one of a list, an issued number beside a withheld reason -- is the schema's
  // and is checked against the schema itself, once, before anything is read off the result. What
  // the schema cannot say is what stays with the reader: the rows this result's contract declared,
  // and whether the numbers follow from the rows. Two authorities, each named where it fires.
  for (const key of ["operator_process_profile", "system_outcome_profile", "reliance_calibration_profile"]) {
    const damaged = JSON.parse(canonicalJson(stored));
    delete damaged[key].coverage;
    assert.throws(() => projectResult(damaged), /AOS_RESULT_SCHEMA_INVALID/, key);
    assert.throws(() => renderMarkdown(damaged), /AOS_RESULT_SCHEMA_INVALID/, key);
    assert.throws(() => renderHtml(damaged), /AOS_RESULT_SCHEMA_INVALID/, key);
    assert.throws(() => renderCard(damaged), /AOS_RESULT_SCHEMA_INVALID/, key);
  }
  const noComposite = JSON.parse(canonicalJson(stored));
  delete noComposite.aos_composite;
  assert.throws(() => projectResult(noComposite), /AOS_RESULT_SCHEMA_INVALID/);

  // A surface that keeps its shape and loses a row is the same loss by a quieter route: five
  // constructs read as a five-construct profile rather than as a profile missing one, and a
  // composite whose artifact surface is gone reads as one with nothing delegated. The rows a
  // surface says it averaged are the rows it must carry -- no more and no fewer.
  const damage = (mutate) => { const copy = JSON.parse(canonicalJson(stored)); mutate(copy); return copy; };
  const refusals = [
    // Rows against the contract that declared them: the reader's, because a schema cannot know how
    // many constructs this result's contract declared.
    ["a construct row is gone", /AOS_RESULT_INCOMPLETE/, (r) => delete r.operator_process_profile.constructs.C1],
    ["a domain row is gone", /AOS_RESULT_INCOMPLETE/, (r) => delete r.system_outcome_profile.domains.O2],
    ["a row nobody averaged was added", /AOS_RESULT_INCOMPLETE/, (r) => { r.operator_process_profile.constructs.C9 = { ...r.operator_process_profile.constructs.C1, construct_id: "C9" }; }],
    ["a delegated-artifact row is gone", /AOS_RESULT_INCOMPLETE/, (r) => delete r.aos_composite.delegated_artifact.constructs.C1],
    // The row and the evidence that it was expected, removed together: the stored object cannot be
    // its own authority on what it should contain, so the contract's declaration is what is checked.
    ["a construct row and its weight are gone together", /AOS_RESULT_INCOMPLETE/, (r) => { delete r.operator_process_profile.constructs.C1; delete r.operator_process_profile.weights.C1; }],
    ["a domain row and its weight are gone together", /AOS_RESULT_INCOMPLETE/, (r) => { delete r.system_outcome_profile.domains.O2; delete r.system_outcome_profile.weights.O2; }],
    // A weighting this instrument does not perform: every value is a legal weight and no row is
    // missing, so only the arithmetic says it is wrong.
    ["the weights claim an unequal share", /AOS_RESULT_INCONSISTENT/, (r) => { for (const id of Object.keys(r.operator_process_profile.weights)) r.operator_process_profile.weights[id] = 0.5; }],
    // Shape, all of it the schema's: a required field, a whole surface, a list that is not there.
    ["a reliance metric is gone", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.reliance_calibration_profile.metrics.csr],
    ["the delegated-artifact surface is gone", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.aos_composite.delegated_artifact],
    ["the weights that say what was averaged are gone", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.operator_process_profile.weights],
    ["a weight that is not a share of anything", /AOS_RESULT_SCHEMA_INVALID/, (r) => { r.operator_process_profile.weights.C1 = 0; r.operator_process_profile.weights.C2 = 0.5; }],
    ["the row set the contract declared is gone", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.contract.declared],
    ["a domain row lost the cells it was averaged over", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.system_outcome_profile.domains.O1.cells],
    ["a construct row lost its required cells", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.operator_process_profile.constructs.C1.required_cells],
    ["a construct row lost its optional cells", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.operator_process_profile.constructs.C1.optional_cells],
    ["a construct row lost its withheld list", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.operator_process_profile.constructs.C1.withheld_for],
    ["a construct row lost its title", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.operator_process_profile.constructs.C1.title],
    ["an artifact row lost its value", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.aos_composite.delegated_artifact.constructs.C1.value],
    // The fields no renderer may be left to default: uncertainty printed as `undefined`, an empty
    // limitation list, a formula naming an aggregation nothing here performs.
    ["the uncertainty is gone", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.uncertainty],
    ["the forbidden uses are gone", /AOS_RESULT_SCHEMA_INVALID/, (r) => delete r.forbidden_uses],
    ["the composite names another formula", /AOS_RESULT_SCHEMA_INVALID/, (r) => { r.aos_composite.formula = "aos-composite.attacker"; }],
    ["the generalizability is a word nobody declared", /AOS_RESULT_SCHEMA_INVALID/, (r) => { r.generalizability_status = "ATTACKER_DEFINED"; for (const key of ["operator_process_profile", "reliance_calibration_profile", "system_outcome_profile", "aos_composite"]) r[key].generalizability_status = "ATTACKER_DEFINED"; }]
  ];
  // Edited all the way through -- the row, its weight and the declaration that named it -- and
  // still refused, because the contract this build holds says which rows a result under it carries.
  // Under a contract this build does not hold there is nothing left to compare against, and that
  // case belongs to `verify --run`, which rebuilds the result from the observations; the test for
  // it lives in tests/product/verify-run.test.mjs.
  const shippedStored = JSON.parse(canonicalJson(buildResult({ contract: shippedEcdContract(), evaluation: evaluate(observationsWith(), identified, shippedEcdContract()) })));
  const consistentlyEdited = JSON.parse(JSON.stringify(shippedStored));
  consistentlyEdited.contract.declared.process_constructs = ["C2", "C3", "C4", "C5", "C6"];
  delete consistentlyEdited.operator_process_profile.constructs.C1;
  delete consistentlyEdited.operator_process_profile.weights.C1;
  assert.throws(() => projectResult(consistentlyEdited), /AOS_RESULT_INCOMPLETE/, "a result naming this build's own contract was read against the rows it says it has");
  assert.doesNotThrow(() => projectResult(shippedStored));

  for (const [why, refusal, mutate] of refusals) {
    const damaged = damage(mutate);
    for (const call of [() => projectResult(damaged), () => renderMarkdown(damaged), () => renderHtml(damaged), () => renderCard(damaged)]) {
      assert.throws(call, refusal, why);
    }
  }

  // And a status this build does not know is a word in a file, not a state: refused by name
  // wherever it appears, rather than printed because it was there.
  const unknownStatuses = [
    ["a construct row", (r) => { r.operator_process_profile.constructs.C1.status = "ATTACKER_DEFINED"; }],
    ["a domain row", (r) => { r.system_outcome_profile.domains.O1.status = "ATTACKER_DEFINED"; }],
    ["a cell inside a domain", (r) => { r.system_outcome_profile.domains.O1.cells[0].status = "ATTACKER_DEFINED"; }],
    ["a reliance metric", (r) => { r.reliance_calibration_profile.metrics.cair.status = "ATTACKER_DEFINED"; }],
    ["the reliance surface", (r) => { r.reliance_calibration_profile.status = "ATTACKER_DEFINED"; }],
    ["an artifact row", (r) => { r.aos_composite.delegated_artifact.constructs.C1.status = "ATTACKER_DEFINED"; }]
  ];
  for (const [where, mutate] of unknownStatuses) {
    const damaged = damage(mutate);
    assert.throws(() => projectResult(damaged), /AOS_RESULT_SCHEMA_INVALID/, where);
    assert.throws(() => renderMarkdown(damaged), /AOS_RESULT_SCHEMA_INVALID/, where);
  }
});

test("no credential shape and no absolute path reaches the canonical result through any door -- facets, run, caps, observations or cell bindings -- and safe values are untouched", () => {
  // The result is the artifact an operator publishes. Everything the caller hands it that is not a
  // declared field with a declared shape is carried as a digest of itself: accountable, and not a
  // token somebody can use.
  const canary = "sk-live-DO-NOT-PUBLISH-4d5f6a7b8c9d";
  const secretPath = "/Users/alice/private/customer.txt";
  // Every shape that has to be caught, each one in a facet of its own: the provider formats carry
  // their own prefix and no English word beside them, and a path can be one segment long.
  const shapes = {
    // A filesystem location of any kind -- the predicate is the class, so the cases are the class.
    posix_root: "/private",
    posix_double_slash: "//server/private/share",
    windows_unc: String.raw`\\server\private\share`,
    windows_drive: String.raw`C:\Users\alice\creds.txt`,
    windows_drive_forward: "C:/Users/alice/creds.txt",
    home_relative: "~/secrets/key.pem",
    home_bare: "~",
    file_url: "file:///Users/alice/notes.txt",
    // A named secret assigned a value is a secret at any length -- the length floor that keeps
    // "the token was observed" as prose let `password=hunter2` through.
    short_assignment: "database password=hunter2",
    colon_assignment: "password: s3cr3t",
    short_token: "token=abc",
    api_key_assignment: "api_key: k1",
    // A URL that carries who you are in it, whatever the scheme.
    postgres_url: "postgresql://alice:hunter2@db.example/prod",
    ssh_url: "ssh://root@10.0.0.1/etc/shadow",
    https_userinfo: "https://alice:hunter2@internal.example/dashboard",
    aws_key: "AKIAIOSFODNN7EXAMPLE",
    github_token: "ghp_16CharactersOrMoreOfTokenHere1234",
    slack_token: "xoxb-123456789012-abcdefghijkl",
    google_key: "AIzaSyA1234567890abcdefghijklmnopqrstuvw",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    bearer: "Authorization: Bearer 9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c",
    home_path: secretPath,
    private_key: "-----BEGIN RSA PRIVATE KEY-----",
    // The two halves the boundary lists missed, and the operator's note that carries both. A word
    // that names a secret hands one over with a space as readily as with an `=`, and a root that
    // starts after a colon is still a root -- neither is a new spelling of a credential, both are
    // the same credential written the way somebody types it into a note.
    spaced_secret: "database password hunter2",
    // No digit anywhere in it. The rule that asked for one was the length floor's heuristic borrowed
    // a layer up, and a passphrase is chosen by a person, not to suit a regular expression.
    spaced_passphrase: "database password correcthorsebatterystaple",
    // Sixty-four hex characters are not evidence of having been hashed. This one was published as
    // `sha256:` plus itself -- the marker of a digest in front of every character of the secret.
    bare_hex_secret: "a".repeat(64),
    path_after_colon: "workspace:/Users/alice/private/customer.txt",
    spaced_secret_and_path: "database password hunter2; workspace:/Users/alice/private/customer.txt"
  };
  // Injected at every door into the result, not only the ones a previous round happened to use:
  // the facets, the run record, a cap and its trigger -- and the observations, which the contract
  // copies into every cell binding it issues.
  const observations = observationsWith().map((observation, index) => (index === 0
    ? { ...observation, verifier_id: "sk-live-DO-NOT-PUBLISH-1234567890", evidence_ids: [secretPath], reason: `read ${secretPath}` }
    : observation));
  // A result declares a bounded number of facets and the schema says so, so the shapes go through
  // in two runs rather than in one run no operator could have. Every shape is still injected as a
  // facet, and the first run carries the other doors as well.
  const half = Math.ceil(Object.keys(shapes).length / 2);
  const [firstHalf, secondHalf] = [Object.fromEntries(Object.entries(shapes).slice(0, half)), Object.fromEntries(Object.entries(shapes).slice(half))];
  const evaluationOf = (batch) => evaluate(observations, { ...identified, facets: { ...identified.facets, workspace: secretPath, ...batch } }, populated);
  const evaluation = evaluationOf(firstHalf);
  const result = buildResult({
    contract: populated,
    evaluation,
    observations,
    run: {
      run_id: "run-1", suite: "aos-suite-v1", invocation_count: 3, operator_plan_authored: true,
      api_token: canary, workspace: secretPath
    },
    caps: [{
      code: "CRITICAL_SAFETY", max_value: 39, scope: ["system_outcome"], reason: `seeded canary at ${secretPath}; database password=hunter2`,
      triggers: [{ trigger_id: "t1", construct_or_domain_id: "O3", cell_id: "C6.SL.01", evidence_ids: ["evidence-1"], observed: true, note: canary }]
    }]
  });
  const second = buildResult({ contract: populated, evaluation: evaluationOf(secondHalf), observations });
  const renderingsOf = (one) => [canonicalJson(one), renderMarkdown(one), renderHtml(one), renderCard(one), canonicalJson(projectResult(one))];
  const rendered = [...renderingsOf(result), ...renderingsOf(second)].join("\n");
  // The bindings the contract itself carried: a cell says what it was answered by, and that is a
  // string the caller supplied. Every one of them is published or digested, never copied through.
  const bindings = result.cells.flatMap((cell) => cell.bound_to);
  assert.ok(bindings.length >= 3, "the fixture produced no cell bindings, so this checked nothing");
  for (const binding of bindings) {
    assert.doesNotMatch(binding.verifier_id, /sk-live/u);
    for (const id of binding.evidence_ids) assert.equal(id.includes("/Users/"), false);
  }
  assert.equal(result.observations[0].verifier_id.startsWith("sha256:"), true);
  assert.equal(result.observations[0].evidence_ids[0].startsWith("sha256:"), true);
  assert.equal(result.observations[0].reason.startsWith("sha256:"), true);
  assert.equal(rendered.includes(canary), false, "the credential survived");
  assert.equal(rendered.includes(secretPath), false, "the absolute path survived");
  assert.equal(rendered.includes("/Users/"), false);
  for (const [name, value] of Object.entries(shapes)) {
    assert.equal(rendered.includes(value), false, `${name} survived into the result or a rendering`);
    const carried = (Object.hasOwn(firstHalf, name) ? result : second).facet_identity[name];
    assert.match(carried, /^sha256:[0-9a-f]{64}$/u, `${name} was not carried as a digest`);
    // A digest of the value, not the value wearing a digest's clothes. `sha256:` + the same
    // sixty-four characters passed every check above and published the secret in full.
    assert.equal(carried.endsWith(value), false, `${name} was prefixed rather than hashed`);
  }
  // And the safe values a run legitimately carries are untouched, so redaction is not a way of
  // losing the record: an id with hyphens, a suite name, a digest, and ordinary prose.
  const safe = buildResult({
    contract: populated,
    evaluation,
    run: { run_id: "run-b804de78-ab88-42cb-b542-894f2e021495", suite: "aos-suite-v1", suite_digest: `sha256:${"a".repeat(64)}`, invocation_count: 3 }
  });
  assert.equal(safe.run.run_id, "run-b804de78-ab88-42cb-b542-894f2e021495");
  assert.equal(safe.run.suite, "aos-suite-v1");
  // A bare digest is the same digest; the result publishes one spelling of it rather than two.
  const bare = buildResult({ contract: populated, evaluation: fullRun(), run: { suite_digest: "b".repeat(64) } });
  assert.equal(bare.run.suite_digest, `sha256:${"b".repeat(64)}`);
  assert.deepEqual(bare.run.redacted, []);
  assert.deepEqual(safe.run.redacted, []);
  // A URL with no userinfo is a reference, not a credential, and a relative path names a file in
  // this repository. A predicate that ate those would take the words out of the report.
  const kept = buildResult({
    contract: populated,
    evaluation: evaluate(observationsWith(), { ...identified, facets: { ...identified.facets, docs: "https://example.com/docs", module: "lib/result-schema.mjs", windows_relative: String.raw`docs\readme.md`, ratio: "0-100", either: "and/or" } }, populated)
  });
  for (const [facet, value] of Object.entries({ docs: "https://example.com/docs", module: "lib/result-schema.mjs", windows_relative: String.raw`docs\readme.md`, ratio: "0-100", either: "and/or" })) {
    assert.equal(kept.facet_identity[facet], value, `${facet} was digested and is not a location or a credential`);
  }
  assert.equal(safe.observations.every((row) => row.reason === "test" || row.reason === "not observed in this run"), true, "ordinary prose was digested");
  // What is declared and safe is kept verbatim, so redaction is not a way of losing the record.
  assert.equal(result.run.run_id, "run-1");
  assert.equal(result.run.suite, "aos-suite-v1");
  assert.equal(result.run.invocation_count, 3);
  assert.equal(result.run.operator_plan_authored, true);
  assert.match(result.run.additional_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.run.redacted, ["api_token", "workspace"]);
  assert.match(result.facet_identity.workspace, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.system_outcome_profile.caps[0].reason, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.system_outcome_profile.caps[0].triggers[0].additional_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.system_outcome_profile.caps[0].triggers[0].cell_id, "C6.SL.01");
  // Idempotent: a digest is already safe, so a result built from a redacted one is unchanged.
  assert.equal(canonicalJson(buildResult({ contract: populated, evaluation, run: result.run })), canonicalJson(buildResult({ contract: populated, evaluation, run: JSON.parse(canonicalJson(result.run)) })));
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
  // A result written before the field existed is a legacy result too -- but it has to be one: the
  // legacy scorer's own fields, not merely the absence of the new schema's. A stub that says
  // neither is an instrument nobody recognises.
  const { schema_id: _id, ...beforeTheField } = legacy;
  assert.equal(isLegacyResult(beforeTheField), true);
  assert.equal(resultSchemaOf(beforeTheField), LEGACY_RESULT_SCHEMA_ID);
  assert.throws(() => isLegacyResult({ status: "SCORED", score: { final: 88 } }), /AOS_UNKNOWN_RESULT_SCHEMA/);
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

test("a cycle of profile results has no aggregate and names the issue that owns one, and a mixed cycle is refused outright", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-cycle-schema-"));
  const home = join(cwd, ".aos");
  initHome(home);
  try {
    writeJson(join(home, "cycle.json"), cycleWith([profileRecord("0000000000000001"), profileRecord("0000000000000002"), profileRecord("0000000000000003")]));
    // No aggregate, and no borrowed one: re-deriving the legacy scorer's number from a profile
    // run's observations would be a number about the new run under an instrument that never
    // measured it. #563 owns saying what a cycle of profiles aggregates to, and the command says
    // so rather than printing something in the meantime.
    const profiles = runCli(cwd, ["cycle"], 1);
    assert.equal(profiles.stdout.includes("Operator Score"), false);
    assert.equal(/\b\d+ \/ 100\b/u.test(profiles.stdout), false, "a number was printed for a cycle of profiles");
    assert.match(profiles.stdout, /AOS_CYCLE_AGGREGATION_UNDEFINED/u);
    assert.match(profiles.stdout, /#563/u);
    const asJson = JSON.parse(runCli(cwd, ["cycle", "--json"], 1).stdout);
    assert.equal(asJson.aggregate, null);
    assert.equal(asJson.complete, false);
    assert.match(asJson.withheld_reason, /#563/u);
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
