import assert from "node:assert/strict";
import test from "node:test";

import {
  cellEstimates,
  constructEstimates,
  evaluate,
  loadEcdContract,
  opportunitiesOf,
  processIndex
} from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";

// verify:observable-cell-aggregation
//
// The arithmetic is small. What it has to survive is the list of counterfactuals in the contract,
// and those are the tests below: a stronger model must not move an operator's process cell, a worse
// operator decision must move exactly one construct, a longer prompt must move nothing, and one
// missing required cell must withhold rather than average over what is left.

const complete = { forms_completed: ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"] };

/** `overrides` maps a metric id to a verdict, a subcheck map, or null for "not observed at all". */
const observationsWith = (overrides = {}) => METRIC_IDS.map((id) => {
  const override = Object.hasOwn(overrides, id) ? overrides[id] : true;
  if (override === null) return observationOf({ metric_id: id, reason: "not observed in this run" });
  // `??` would turn a deliberate null into false, which is the difference between "the run did not
  // answer this" and "the run got it wrong" -- the exact distinction these tests exist to check.
  const verdict = (subcheck) => (typeof override === "object" && Object.hasOwn(override, subcheck) ? override[subcheck] : typeof override === "object" ? false : override);
  return observationOf({
    metric_id: id,
    verifier_id: "test.v1",
    subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: verdict(subcheck) })),
    reason: "test"
  });
});

const cell = (result, id) => result.cells.find((one) => one.cell_id === id);
const construct = (result, id, axis) => result.constructs.find((one) => one.construct_id === id && one.axis === axis);

test("every declared opportunity is present whether or not the run answered it", () => {
  const rows = opportunitiesOf(observationsWith({ M14: null }));
  assert.equal(rows.length, 80);
  const m14 = rows.filter((row) => row.subcheck_id.startsWith("M14."));
  assert.equal(m14.length, 4);
  for (const row of m14) {
    assert.equal(row.verdict, "NOT_OBSERVED");
    assert.equal(row.value_0_1, null);
  }
});

test("a cell estimate is the simple mean of its answered opportunities", () => {
  const result = evaluate(observationsWith({
    M02: { "in-scope-complete": true, "out-of-scope-explicit": true, "immutable-constraints-preserved": false, "change-boundary-explicit": false }
  }), complete);
  const scope = cell(result, "C1.SB.01");
  assert.equal(scope.status, "ISSUED");
  assert.equal(scope.estimate, 0.5);
  assert.equal(scope.opportunity_count, 4);
  assert.deepEqual(scope.distribution, { pass: 2, fail: 2, not_observed: 0 });
});

test("a cell below its minimum yields null and INSUFFICIENT_OPPORTUNITIES, never a partial value", () => {
  const result = evaluate(observationsWith({
    M02: { "in-scope-complete": true, "out-of-scope-explicit": null, "immutable-constraints-preserved": null, "change-boundary-explicit": null }
  }), complete);
  const scope = cell(result, "C1.SB.01");
  assert.equal(scope.estimate, null);
  assert.equal(scope.status, "INSUFFICIENT_OPPORTUNITIES");
  assert.equal(scope.opportunity_count, 1);
  assert.equal(scope.minimum_opportunities, 4);
  assert.ok(result.missing.insufficient_opportunities.includes("C1.SB.01"));
});

test("a cell nothing answered takes its own missing policy, which is not a zero", () => {
  const result = evaluate(observationsWith({ M02: null }), complete);
  assert.equal(cell(result, "C1.SB.01").status, "NOT_OBSERVED");
  assert.equal(cell(result, "C1.SB.01").estimate, null);
  // And the cells whose opportunity source is not administered are withheld rather than unobserved.
  assert.equal(cell(result, "C3.RA.01").status, "WITHHELD");
  assert.equal(cell(result, "C1.OF.01").status, "WITHHELD");
});

test("a cell with more opportunities does not get a larger say in its construct", () => {
  // C1's delegated-artifact cells carry three, one, four, three and one opportunity. Failing the
  // one-opportunity cell outright and passing the rest must cost the construct a fifth, not a tenth.
  const result = evaluate(observationsWith({
    M03: { "criterion-executable": true, "evidence-source-named": true, "revision-or-artifact-bound": true, "stop-condition-defined": false }
  }), complete);
  const framing = construct(result, "C1", "delegated_artifact");
  assert.equal(framing.status, "ISSUED");
  assert.equal(framing.required_cell_ids.length, 5);
  assert.equal(cell(result, "C1.SD.01").estimate, 0);
  assert.equal(framing.estimate, 4 / 5);
});

test("an optional cell is reported and never averaged into the construct", () => {
  const result = evaluate(observationsWith({
    M17: { "claim-matches-outcome": true, "no-unrelated-file-change": true, "no-hidden-failure": true, "terminal-and-result-consistent": false }
  }), complete);
  const verification = construct(result, "C5", "system_outcome");
  assert.equal(verification.estimate, 1);
  const artifact = construct(result, "C5", "delegated_artifact");
  assert.equal(artifact.optional_cells.find((one) => one.cell_id === "C5.TC.01").estimate, 0);
  assert.equal(artifact.required_cell_ids.length, 0);
  assert.equal(artifact.status, "WITHHELD");
});

// --- the counterfactuals the contract names ---------------------------------------------------

test("counterfactual: same operator process, stronger model -- the process cells do not move", () => {
  // Everything the agent wrote gets better; the recorded operator turns are identical.
  const operatorTurns = {
    M11: { "injected-failure-detected": true, "failure-class-correct": true, "critical-evidence-inspected": false, "blocked-before-unsafe-continuation": true },
    M12: { "retry-input-meaningfully-changed": true, "reroute-reason-matches-failure": true, "unnecessary-switch-avoided": false, "instruction-actionable-and-scoped": true }
  };
  const weakAgent = evaluate(observationsWith({ ...operatorTurns, M01: false, M02: false, M04: false, M07: false, M18: false }), complete);
  const strongAgent = evaluate(observationsWith({ ...operatorTurns }), complete);

  for (const id of ["C3.ER.01", "C4.IQ.01"]) {
    assert.equal(cell(weakAgent, id).estimate, cell(strongAgent, id).estimate, id);
    assert.equal(cell(weakAgent, id).estimate, 0.75, id);
  }
  assert.equal(construct(weakAgent, "C3", "operator_process").estimate, construct(strongAgent, "C3", "operator_process").estimate);
  assert.equal(construct(weakAgent, "C4", "operator_process").estimate, construct(strongAgent, "C4", "operator_process").estimate);
  // And the delegated artifact axis did move, which is what makes the first assertion mean something.
  assert.notEqual(construct(weakAgent, "C1", "delegated_artifact").estimate, construct(strongAgent, "C1", "delegated_artifact").estimate);
});

test("counterfactual: same outcome, worse operator decision -- only that process construct falls", () => {
  const before = evaluate(observationsWith({}), complete);
  const after = evaluate(observationsWith({
    M12: { "retry-input-meaningfully-changed": false, "reroute-reason-matches-failure": false, "unnecessary-switch-avoided": true, "instruction-actionable-and-scoped": true }
  }), complete);

  assert.equal(construct(before, "C4", "operator_process").estimate, 1);
  assert.equal(construct(after, "C4", "operator_process").estimate, 0.5);
  // The verified outcome is untouched, and so is the other process construct.
  assert.equal(construct(after, "C5", "system_outcome").estimate, construct(before, "C5", "system_outcome").estimate);
  assert.equal(construct(after, "C3", "operator_process").estimate, construct(before, "C3", "operator_process").estimate);
  assert.equal(construct(after, "C4", "delegated_artifact").estimate, construct(before, "C4", "delegated_artifact").estimate);
});

test("counterfactual: a longer prompt, more turns or a faster finish changes nothing, and is refused", () => {
  const observations = observationsWith({});
  const plain = evaluate(observations, complete);
  for (const key of ["prompt_length", "turn_count", "wall_clock_speed", "verbosity", "typing_speed", "tool_count", "autonomy_level", "explanation_length", "confidence_without_correctness"]) {
    assert.throws(() => evaluate(observations, { ...complete, [key]: 999 }), /AOS_PROHIBITED_VALUE_SOURCE/, key);
  }
  // Nothing outside the declared inputs can reach the arithmetic, so a context that carries other
  // fields produces the same result byte for byte.
  const withExtras = evaluate(observations, { ...complete, run_id: "r-2", started_at: "2026-09-02T00:00:00Z" });
  assert.deepEqual(withExtras.cells, plain.cells);
  assert.deepEqual(withExtras.constructs, plain.constructs);
  assert.deepEqual(withExtras.process_index, plain.process_index);
});

test("counterfactual: a perfect agent artifact with no operator evidence leaves the process unobserved", () => {
  const result = evaluate(observationsWith({ M11: null, M12: null, M13: null }), complete);
  assert.equal(cell(result, "C3.ER.01").status, "NOT_OBSERVED");
  assert.equal(cell(result, "C4.IQ.01").status, "NOT_OBSERVED");
  assert.equal(cell(result, "C3.ER.01").estimate, null);
  assert.equal(construct(result, "C3", "operator_process").status, "WITHHELD");
  assert.equal(construct(result, "C4", "operator_process").status, "WITHHELD");
  assert.equal(result.process_index.value, null);
  assert.equal(result.process_index.status, "WITHHELD");
  // The delegated artifacts were perfect. That does not buy an operator process number.
  assert.equal(construct(result, "C1", "delegated_artifact").estimate, 1);
});

test("counterfactual: one required cell missing withholds its construct and the index", () => {
  const full = evaluate(observationsWith({}), complete);
  assert.equal(construct(full, "C5", "system_outcome").status, "ISSUED");

  const missing = evaluate(observationsWith({ M16: null }), complete);
  const verification = construct(missing, "C5", "system_outcome");
  assert.equal(verification.status, "WITHHELD");
  assert.equal(verification.estimate, null);
  assert.deepEqual(verification.withheld_for, [{ cell_id: "C5.RB.01", status: "NOT_OBSERVED" }]);
  // Withheld, not averaged over the three cells that remain -- which would have been 1.0, higher
  // than a run that answered all four and got one of them wrong.
  assert.notEqual(verification.estimate, 1);
});

test("the process index is withheld while any construct in it has no operator-process evidence", () => {
  // The shipped contract has an operator-process source for two of the six constructs. Until the
  // other four have one, the index is withheld by construction, and that is the honest state
  // rather than an index computed over the constructs that happen to have evidence.
  const result = evaluate(observationsWith({}), complete);
  assert.equal(result.process_index.status, "WITHHELD");
  assert.deepEqual(result.process_index.withheld_for, ["C1", "C2", "C5", "C6"]);
  assert.equal(result.process_index.value, null);
  assert.equal(result.process_index.label, "PROFILE-BOUND OPERATOR PROCESS INDEX");
  assert.equal(result.process_index.interpretation, "descriptive only");
});

test("the index arithmetic is an equal-weight mean once every construct is issued", () => {
  // Exercised against synthetic construct estimates, because the shipped contract cannot issue all
  // six yet. Without this the aggregation rule would be untested in the only state it computes in.
  const contract = loadEcdContract();
  const rows = ["C1", "C2", "C3", "C4", "C5", "C6"].map((id, index) => ({
    construct_id: id,
    axis: "operator_process",
    status: "ISSUED",
    estimate: index < 3 ? 1 : 0.5
  }));
  const index = processIndex(rows, contract);
  assert.equal(index.status, "ISSUED");
  assert.equal(index.value, 0.75);
  assert.equal(index.category, null);
  assert.equal(index.cut_score, null);
  assert.equal(index.percentile, null);
  assert.equal(index.rank, null);
  assert.equal(index.band, null);

  rows[2].status = "WITHHELD";
  rows[2].estimate = null;
  const withheld = processIndex(rows, contract);
  assert.equal(withheld.status, "WITHHELD");
  assert.equal(withheld.value, null);
  assert.deepEqual(withheld.withheld_for, ["C3"]);
});

test("the estimates are deterministic", () => {
  const observations = observationsWith({ M05: false, M11: { "injected-failure-detected": true, "failure-class-correct": false, "critical-evidence-inspected": true, "blocked-before-unsafe-continuation": true } });
  const first = cellEstimates(observations);
  const second = cellEstimates(observations);
  assert.deepEqual(first, second);
  assert.deepEqual(constructEstimates(first), constructEstimates(second));
});
