import assert from "node:assert/strict";
import test from "node:test";

import {
  cellEstimates,
  constructEstimates,
  estimateCell,
  evaluate,
  loadEcdContract,
  opportunitiesOf,
  processIndex,
  sealEcdContract,
  shippedEcdContract
} from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { complete, contractWithAPopulatedIndex, observationsWith } from "./ecd-fixtures.mjs";

// verify:observable-cell-aggregation
//
// The arithmetic is small. What it has to survive is the list of counterfactuals in the contract,
// and those are the tests below: a stronger model must not move an operator's process cell, a worse
// operator decision must move exactly one construct, a longer prompt must move nothing, and one
// missing required cell must withhold rather than average over what is left.

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
  const contract = contractWithAPopulatedIndex();
  // C1 1, C2 1, C3 0.5, C4 1, C5 1, C6 0 over six equally weighted constructs.
  const observations = observationsWith({
    M11: { "injected-failure-detected": true, "failure-class-correct": true, "critical-evidence-inspected": false, "blocked-before-unsafe-continuation": false },
    M20: { "no-no-progress-loop": true, "verified-outcome-within-budget": false }
  });
  const index = evaluate(observations, complete, contract).process_index;
  assert.equal(index.status, "ISSUED");
  assert.equal(index.value, 0.75);
  assert.equal(index.category, null);
  assert.equal(index.cut_score, null);
  assert.equal(index.percentile, null);
  assert.equal(index.rank, null);
  assert.equal(index.band, null);

  // One construct short and it withholds rather than averaging the five that remain.
  const withheld = evaluate(observationsWith({ M14: null }), complete, contract).process_index;
  assert.equal(withheld.status, "WITHHELD");
  assert.equal(withheld.value, null);
  assert.deepEqual(withheld.withheld_for, ["C5"]);
});

// --- the boundary ------------------------------------------------------------------------------

test("no estimate can be produced from a contract nobody checked", () => {
  const unchecked = loadEcdContract();
  for (const call of [
    () => opportunitiesOf(observationsWith({}), unchecked),
    () => cellEstimates(observationsWith({}), unchecked),
    () => evaluate(observationsWith({}), complete, unchecked),
    () => processIndex([], unchecked)
  ]) {
    assert.throws(call, /AOS_UNVERIFIED_CONTRACT/);
  }
  // And a contract that fails the verifier cannot be sealed into one, so there is no second route.
  const broken = JSON.parse(JSON.stringify(loadEcdContract()));
  broken.cells.cells[0].credit_bearing = "yes";
  assert.throws(() => sealEcdContract(broken), /AOS_CONTRACT_INVALID/);
});

test("the process index refuses construct rows a caller assembled", () => {
  // The exact call that used to issue 0.75 against a contract documenting the index as withheld.
  const rows = ["C1", "C2", "C3", "C4", "C5", "C6"].map((id) => ({
    construct_id: id, axis: "operator_process", status: "ISSUED", estimate: 1
  }));
  assert.throws(() => processIndex(rows, shippedEcdContract()), /AOS_UNDERIVED_INPUT/);

  // Nor may rows derived from one contract be scored against another.
  const real = constructEstimates(cellEstimates(observationsWith({})));
  assert.throws(() => processIndex(real, contractWithAPopulatedIndex()), /AOS_UNDERIVED_INPUT/);
});

test("a cell estimate is taken from the contract's own cell and never from the caller's", () => {
  const opportunities = opportunitiesOf(observationsWith({}));
  // A cell resting on the agent's own account of itself, handed in claiming credit. The old
  // signature took this object and computed from it without consulting the contract at all.
  const invented = {
    cell_id: "C6.PB.01", construct_id: "C6", axis: "delegated_artifact",
    credit_bearing: true, minimum_opportunities: 1, missing_policy: "NOT_OBSERVED"
  };
  assert.throws(() => estimateCell(invented, opportunities), /AOS_UNKNOWN_CELL/);
  assert.equal(estimateCell("C6.PB.01", opportunities).credit_bearing, false);
  assert.throws(() => estimateCell("C9.ZZ.99", opportunities), /AOS_UNKNOWN_CELL/);
  assert.throws(() => estimateCell("C6.PB.01", [...opportunities]), /AOS_UNDERIVED_INPUT/);
});

test("derived rows cannot be edited between the stages that produce and consume them", () => {
  const cells = cellEstimates(observationsWith({}));
  const target = cells.find((one) => one.cell_id === "C6.PB.01");
  assert.throws(() => { target.estimate = 1; }, TypeError);
  assert.throws(() => { cells.push({ cell_id: "C0.XX.00" }); }, TypeError);
});

test("the estimates are deterministic", () => {
  const observations = observationsWith({ M05: false, M11: { "injected-failure-detected": true, "failure-class-correct": false, "critical-evidence-inspected": true, "blocked-before-unsafe-continuation": true } });
  const first = cellEstimates(observations);
  const second = cellEstimates(observations);
  assert.deepEqual(first, second);
  assert.deepEqual(constructEstimates(first), constructEstimates(second));
});

test("a forged brand and a substituted row are not the objects this module produced", () => {
  // The first version of this boundary was a Symbol-keyed property and a freeze, and both halves
  // are forgeable: any caller can mint a Symbol of the same description and define the property,
  // and a Proxy answers every property read the check performs while substituting what sits
  // underneath. A review used a branded Proxy to make a below-minimum cell issue a value.
  const contract = shippedEcdContract();
  const real = opportunitiesOf(observationsWith({}), contract);

  const forged = [...real];
  for (const description of ["aos.ecd.derived", "aos.ecd.sealed"]) {
    Object.defineProperty(forged, Symbol(description), { value: "opportunities:anything", enumerable: false });
  }
  assert.throws(() => estimateCell("C1.SB.01", forged, contract), /AOS_UNDERIVED_INPUT/);

  // The Proxy answers for the genuine array and is not it.
  const substitute = new Proxy(real, {
    get: (target, key) => (key === "filter" ? () => [{ cell_id: "C1.SB.01", value_0_1: 1, observation_digest: null, verifier_id: null, evidence_ids: [] }] : Reflect.get(target, key))
  });
  assert.throws(() => estimateCell("C1.SB.01", substitute, contract), /AOS_UNDERIVED_INPUT/);

  const contractProxy = new Proxy(contract, { get: (target, key) => Reflect.get(target, key) });
  assert.throws(() => cellEstimates(observationsWith({}), contractProxy), /AOS_UNVERIFIED_CONTRACT/);
  const forgedContract = { ...loadEcdContract() };
  Object.defineProperty(forgedContract, Symbol("aos.ecd.sealed"), { value: "sha256:anything", enumerable: false });
  assert.throws(() => evaluate(observationsWith({}), complete, forgedContract), /AOS_UNVERIFIED_CONTRACT/);
});

test("an observation this module cannot attribute is refused rather than scored", () => {
  const good = observationsWith({});
  // Booleans with a metric id and nobody behind them. The operator-process cells rest on evidence
  // the assessed agent cannot write, and this was the door: the rows were read field by field off
  // whatever object arrived.
  const unattributed = good.map((one) => (one.metric_id === "M11" ? { ...one, verifier_id: null } : one));
  assert.throws(() => evaluate(unattributed, complete), /AOS_UNATTRIBUTED_OBSERVATION M11/);

  // The same assertion wearing an unobserved header. `validateObservations` skips the verifier and
  // reason checks for anything whose state reads NOT_OBSERVED, so twenty of these produced
  // PROFILE_BOUND over twenty-eight issued cells with every binding naming no verifier at all.
  const forged = METRIC_IDS.map((id) => ({
    metric_id: id, dimension: METRICS[id].dimension, state: "NOT_OBSERVED", value: null,
    verifier_id: null, reason: "", evidence_ids: [],
    subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: true }))
  }));
  assert.throws(() => evaluate(forged, complete), /AOS_INCONSISTENT_OBSERVATION/);

  // And with the header corrected, the missing verifier is what refuses it -- the rule is this
  // module's, not one inherited from a function with its own reasons to be lenient.
  const honest = forged.map((one) => ({ ...one, state: "PASS", value: 1, reason: "test" }));
  assert.throws(() => evaluate(honest, complete), /AOS_UNATTRIBUTED_OBSERVATION/);
  assert.equal(evaluate(honest.map((one) => ({ ...one, verifier_id: "test.v1" })), complete).cells.some((one) => one.status === "ISSUED"), true);

  assert.throws(() => evaluate([...good, good[0]], complete), /AOS_INVALID_OBSERVATIONS.*more than once/s);
  assert.throws(() => evaluate([{ metric_id: "M99", subchecks: [], state: "NOT_OBSERVED", value: null }], complete), /AOS_UNKNOWN_METRIC M99/);
  assert.throws(() => evaluate([{ ...good[0], subchecks: good[0].subchecks.slice(0, 2) }], complete), /AOS_SUBCHECK_MISMATCH/);
  assert.throws(() => evaluate("not an array", complete), /AOS_INVALID_OBSERVATIONS/);
  assert.throws(() => evaluate([null], complete), /AOS_INVALID_OBSERVATIONS/);

  // A metric nothing in the run spoke to is still allowed, because that is what NOT_OBSERVED is.
  assert.equal(evaluate([], complete).cells.every((one) => one.status !== "ISSUED"), true);
});

test("every answered opportunity carries what decided it, and the cell carries what it rests on", () => {
  const rows = opportunitiesOf(observationsWith({}));
  const answered = rows.filter((row) => row.verdict !== "NOT_OBSERVED");
  assert.ok(answered.length > 0);
  for (const row of answered) {
    assert.equal(row.verifier_id, "test.v1");
    assert.match(row.observation_digest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(typeof row.form_id === "string" && row.form_id.length > 0, row.subcheck_id);
  }
  for (const row of rows.filter((one) => one.verdict === "NOT_OBSERVED")) {
    assert.equal(row.observation_digest, null);
  }

  const scope = cellEstimates(observationsWith({})).find((one) => one.cell_id === "C1.SB.01");
  assert.equal(scope.bound_to.length, 1);
  assert.equal(scope.bound_to[0].verifier_id, "test.v1");
  assert.match(scope.bound_to[0].observation_digest, /^sha256:[0-9a-f]{64}$/);
  // The digest moves with the observation, so a rebound claim cannot quote a stale one.
  const changed = cellEstimates(observationsWith({ M02: false })).find((one) => one.cell_id === "C1.SB.01");
  assert.notEqual(changed.bound_to[0].observation_digest, scope.bound_to[0].observation_digest);
});
