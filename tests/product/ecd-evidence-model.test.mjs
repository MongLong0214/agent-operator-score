import assert from "node:assert/strict";
import test from "node:test";

import { checkEcdContract, loadEcdContract, subcheckMapping } from "../../lib/ecd-contract.mjs";

// verify:evidence-model
//
// Authority and rival explanations are the two fields a rubric skips, and skipping them is what
// makes a rubric a rubric. These tests are here so that a cell cannot quietly acquire a number
// without saying who is entitled to report it, or what else would have produced the same reading.

const clone = () => JSON.parse(JSON.stringify(loadEcdContract()));
const checks = (report) => report.failures.map((one) => one.check);
const cellIn = (doc, id) => doc.cells.cells.find((one) => one.cell_id === id);

test("every cell names an authority the evidence model defines, admissible for its axis", () => {
  const contract = loadEcdContract();
  const authorities = new Map(contract.evidence_model.authorities.map((one) => [one.authority_id, one]));
  const axes = new Map(contract.evidence_model.axes.map((one) => [one.axis_id, one]));
  for (const cell of contract.cells.cells) {
    const authority = authorities.get(cell.authority);
    assert.ok(authority, `${cell.cell_id} names an undefined authority`);
    assert.ok(authority.admissible_axes.includes(cell.axis), `${cell.cell_id}: ${cell.authority} on ${cell.axis}`);
    assert.ok(axes.get(cell.axis).admissible_authorities.includes(cell.authority), `${cell.axis} does not admit ${cell.authority}`);
  }
});

test("every cell carries rival explanations, each with a status and a mitigation", () => {
  for (const cell of loadEcdContract().cells.cells) {
    assert.ok(cell.rival_explanations.length >= 1, `${cell.cell_id} has no rival explanation`);
    for (const rival of cell.rival_explanations) {
      assert.ok(rival.statement.length >= 20, `${cell.cell_id}/${rival.id} statement`);
      assert.ok(["OPEN", "PARTIALLY_MITIGATED", "CONTROLLED"].includes(rival.status));
      assert.ok(rival.mitigation.length >= 4, `${cell.cell_id}/${rival.id} mitigation`);
    }
  }
});

test("an operator-process cell rests on evidence the assessed agent cannot write", () => {
  const contract = loadEcdContract();
  const authorities = new Map(contract.evidence_model.authorities.map((one) => [one.authority_id, one]));
  const process = contract.cells.cells.filter((one) => one.axis === "operator_process");
  assert.ok(process.length > 0);
  for (const cell of process) {
    assert.equal(authorities.get(cell.authority).agent_forgeable, false, `${cell.cell_id} is forgeable by the agent`);
  }
});

test("a cell resting on self-report alone earns no credit and is required by nothing", () => {
  const contract = loadEcdContract();
  const selfReport = new Set(contract.evidence_model.authorities.filter((one) => one.self_report_only === true).map((one) => one.authority_id));
  assert.ok(selfReport.size > 0, "the model declares no self-report authority, so the rule guards nothing");
  const affected = contract.cells.cells.filter((one) => selfReport.has(one.authority));
  assert.ok(affected.length > 0, "no cell exercises the self-report rule");
  for (const cell of affected) {
    assert.equal(cell.credit_bearing, false, `${cell.cell_id} claims credit from a self-report`);
    assert.equal(cell.required_for_construct, false, `${cell.cell_id} is required and rests on a self-report`);
  }
});

test("no credit-bearing cell is required while its authority is self-report", () => {
  // The one that is left in the shipped contract: what the run declared about rejecting the
  // injected document. Safety credit comes from effects instead.
  const contract = loadEcdContract();
  assert.equal(cellIn(contract, "C6.IJ.02").credit_bearing, false);
  assert.equal(cellIn(contract, "C6.IJ.02").authority, "agent-declaration");
  assert.equal(cellIn(contract, "C6.SL.01").credit_bearing, true);
  assert.equal(cellIn(contract, "C6.SL.01").authority, "artifact-byte-effect");
  // #557. C6.PB.01 used to be the other self-report cell, and its three subchecks are answered by
  // the kernel: the boundary canary's record of what was refused, the descendant scan and the
  // environment policy the child was built with. `credit_bearing: false` answered a question about
  // credit and not about provenance, and the declared authority was the false statement.
  assert.equal(cellIn(contract, "C6.PB.01").authority, "boundary-kernel-effect");
  assert.equal(cellIn(contract, "C6.PB.01").axis, "system_outcome");
  assert.equal(cellIn(contract, "C6.PB.01").credit_bearing, true);
});

test("every cell declares the facets its observations must carry", () => {
  const contract = loadEcdContract();
  const known = new Set(contract.evidence_model.facets.map((one) => one.facet_id));
  for (const cell of contract.cells.cells) {
    assert.ok(cell.facet_identity.length > 0, `${cell.cell_id} declares no facet identity`);
    for (const facet of cell.facet_identity) assert.ok(known.has(facet), `${cell.cell_id}: ${facet}`);
  }
});

test("no facet claims an estimated variance component and no minimum claims a precision basis", () => {
  const contract = loadEcdContract();
  for (const facet of contract.evidence_model.facets) {
    assert.equal(facet.variance_component, "UNESTABLISHED", facet.facet_id);
  }
  assert.equal(contract.evidence_model.precision_basis.status, "UNESTABLISHED");
  for (const cell of contract.cells.cells) {
    if (cell.minimum_opportunities_basis === "UNESTABLISHED") {
      assert.equal(cell.minimum_opportunities, null, `${cell.cell_id} invented a minimum without a basis`);
    }
    if (cell.minimum_opportunities_basis === "DECLARED_COVERAGE") {
      assert.equal(cell.minimum_opportunities, cell.subcheck_ids.length, cell.cell_id);
    }
  }
});

test("a scored cell names an implemented scoring rule", () => {
  const contract = loadEcdContract();
  const rules = new Map(contract.evidence_model.scoring_rules.map((one) => [one.scoring_rule_id, one]));
  for (const cell of contract.cells.cells) {
    const rule = rules.get(cell.scoring_rule_id);
    assert.ok(rule, `${cell.cell_id}: ${cell.scoring_rule_id}`);
    if (cell.population_status === "SUBCHECK_BACKED") assert.equal(rule.implemented, true, cell.cell_id);
  }
});

test("the mapping records the authority for every subcheck", () => {
  for (const row of subcheckMapping()) {
    assert.ok(typeof row.authority === "string" && row.authority.length > 0, row.subcheck_id);
  }
});

// --- negative --------------------------------------------------------------------------------

test("a cell with an authority nobody defined fails", () => {
  const doc = clone();
  cellIn(doc, "C5.FO.01").authority = "somebody-said-so";
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("cell-authority-unknown"));
});

test("a cell whose authority is inadmissible for its axis fails", () => {
  const doc = clone();
  // An agent's own declaration cannot become system-outcome evidence by being filed under it.
  cellIn(doc, "C6.IJ.02").axis = "system_outcome";
  const c6 = doc.construct_map.constructs.find((one) => one.construct_id === "C6");
  c6.axes.delegated_artifact.optional_cell_ids = c6.axes.delegated_artifact.optional_cell_ids.filter((id) => id !== "C6.IJ.02");
  c6.axes.system_outcome.optional_cell_ids.push("C6.IJ.02");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("axis-authority-inadmissible"));
});

test("giving a self-report cell credit fails", () => {
  const doc = clone();
  cellIn(doc, "C6.IJ.02").credit_bearing = true;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("self-report-credit"));
});

test("requiring a self-report cell for its construct fails", () => {
  const doc = clone();
  cellIn(doc, "C6.IJ.02").required_for_construct = true;
  const c6 = doc.construct_map.constructs.find((one) => one.construct_id === "C6");
  c6.axes.delegated_artifact.optional_cell_ids = c6.axes.delegated_artifact.optional_cell_ids.filter((id) => id !== "C6.IJ.02");
  c6.axes.delegated_artifact.required_cell_ids.push("C6.IJ.02");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("self-report-required"));
});

test("a minimum invented without a basis fails", () => {
  const doc = clone();
  cellIn(doc, "C1.OF.01").minimum_opportunities = 4;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("minimum-basis-mismatch"));
});

test("a declared-coverage minimum that does not match the declared opportunities fails", () => {
  const doc = clone();
  cellIn(doc, "C1.SB.01").minimum_opportunities = 1;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("minimum-basis-mismatch"));
});

test("a facet no model declares fails", () => {
  const doc = clone();
  cellIn(doc, "C3.ER.01").facet_identity.push("mood");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("facet-unknown"));
});

test("scoring a cell with a rule declared unimplemented fails", () => {
  const doc = clone();
  doc.evidence_model.scoring_rules.find((one) => one.scoring_rule_id === "subcheck-mean.v1").implemented = false;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("scoring-rule-unimplemented"));
});

test("a contract-specified minimum names the clause that fixed it, and cannot drift from it", () => {
  // C3.RA.01's minimum of four is a design decision. The verifier used to ask only that it be an
  // integer, so it could have read ninety-nine and the contract would still have passed -- and a
  // decided number with nothing behind it is indistinguishable from a measured one once it is in
  // the file, which is what UNESTABLISHED exists one row down to prevent.
  const shipped = loadEcdContract();
  const cell = cellIn(shipped, "C3.RA.01");
  assert.equal(cell.minimum_opportunities_basis, "CONTRACT_SPECIFIED");
  const clause = shipped.evidence_model.minimum_opportunity_source_clauses
    .find((one) => one.clause_id === cell.minimum_opportunities_source);
  assert.ok(clause, "the shipped contract-specified minimum names no clause");
  assert.equal(clause.value, cell.minimum_opportunities);

  const drifted = clone();
  cellIn(drifted, "C3.RA.01").minimum_opportunities = 99;
  assert.ok(checks(checkEcdContract(drifted)).includes("minimum-source-mismatch"), "99 still passed");

  const unsourced = clone();
  cellIn(unsourced, "C3.RA.01").minimum_opportunities_source = null;
  assert.ok(checks(checkEcdContract(unsourced)).includes("minimum-source-unknown"));

  const invented = clone();
  cellIn(invented, "C1.SB.01").minimum_opportunities_source = "issue-582-reliance-cell";
  assert.ok(checks(checkEcdContract(invented)).includes("minimum-source-unexpected"));
});

test("a cell may not be scored while part of its claim is deferred to an authority it does not hold", () => {
  // C5.VD.01 rests on the operator's plan, digested before the run. A plan cannot witness the
  // operator later refusing an unsupported completion, and C6.OG.01's cannot witness a permission
  // widened mid-run. Both claimed it anyway; the unobservable half is now named in the file.
  const shipped = loadEcdContract();
  for (const id of ["C5.VD.01", "C6.OG.01"]) {
    const cell = cellIn(shipped, id);
    assert.ok(typeof cell.deferred_claim === "string" && cell.deferred_claim.length > 20, id);
    assert.equal(cell.population_status, "DECLARED_UNPOPULATED", id);
  }
  for (const cell of shipped.cells.cells) {
    if (cell.population_status === "SUBCHECK_BACKED") assert.equal(cell.deferred_claim, null, cell.cell_id);
  }

  const doc = clone();
  const cell = cellIn(doc, "C5.VD.01");
  cell.population_status = "SUBCHECK_BACKED";
  cell.subcheck_ids = ["M14.output-deterministic-where-required"];
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("deferred-claim-scored"), JSON.stringify(checks(report)));
});
