import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_KEYS,
  ECD_CONTRACT_VERSION,
  checkEcdContract,
  contractDigests,
  declaredSubcheckIds,
  loadEcdContract,
  loadEcdSchema,
  subcheckMapping
} from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS } from "../../lib/metrics.mjs";
import { validateAgainstSchema } from "../../lib/execution-plan.mjs";

// verify:construct-map
//
// The mapping is the part of this contract that other issues read, so it is the part that has to
// fail loudly. Every negative below is a shape a drifting contract actually takes: a subcheck
// renamed and never remapped, a cell that grew a second owner, a construct that lost the only cell
// the index could be computed from.

const clone = () => JSON.parse(JSON.stringify(loadEcdContract()));
const checks = (report) => report.failures.map((one) => one.check);
const cellIn = (doc, id) => doc.cells.cells.find((one) => one.cell_id === id);

test("every shipped artifact validates against its own schema", () => {
  const contract = loadEcdContract();
  for (const key of ARTIFACT_KEYS) {
    const report = validateAgainstSchema(contract[key], loadEcdSchema(key));
    assert.deepEqual(report.errors, [], `${key} schema errors`);
  }
});

test("the shipped contract passes every check", () => {
  const report = checkEcdContract();
  assert.deepEqual(report.failures, []);
  assert.equal(report.ok, true);
});

test("every M01-M20 subcheck maps to exactly one cell and one axis", () => {
  const rows = subcheckMapping();
  const declared = declaredSubcheckIds();
  assert.equal(declared.length, METRIC_IDS.length * 4);
  assert.equal(rows.length, declared.length);

  const seen = new Map();
  for (const row of rows) {
    assert.equal(seen.has(row.subcheck_id), false, `${row.subcheck_id} mapped twice`);
    seen.set(row.subcheck_id, row);
    assert.ok(row.cell_id, `${row.subcheck_id} has no cell`);
    assert.ok(row.axis, `${row.subcheck_id} has no axis`);
    assert.ok(row.authority, `${row.subcheck_id} has no authority`);
  }
  for (const id of declared) assert.equal(seen.has(id), true, `${id} maps nowhere`);
});

test("a subcheck's identity is the metric and the subcheck, because two metrics share a subcheck name", () => {
  // `failure-class-correct` is in M11 and M18; `invocation-budget-respected` is in M09 and M20. A
  // mapping keyed on the bare name would merge four different questions into two.
  const shared = ["failure-class-correct", "invocation-budget-respected"];
  for (const name of shared) {
    const owners = METRIC_IDS.filter((id) => METRICS[id].subchecks.includes(name));
    assert.equal(owners.length, 2, name);
    const cells = owners.map((id) => subcheckMapping().find((row) => row.subcheck_id === `${id}.${name}`).cell_id);
    assert.notEqual(cells[0], cells[1], `${name} landed in one cell for two metrics`);
  }
});

test("every cell is claimed by exactly one construct on its own axis", () => {
  const contract = loadEcdContract();
  const listed = new Map();
  for (const construct of contract.construct_map.constructs) {
    for (const [axis, group] of Object.entries(construct.axes)) {
      for (const id of [...group.required_cell_ids, ...group.optional_cell_ids]) {
        assert.equal(listed.has(id), false, `${id} listed twice`);
        listed.set(id, { construct: construct.construct_id, axis });
      }
    }
  }
  for (const cell of contract.cells.cells) {
    const entry = listed.get(cell.cell_id);
    assert.ok(entry, `${cell.cell_id} is unlisted`);
    assert.equal(entry.construct, cell.construct_id);
    assert.equal(entry.axis, cell.axis);
  }
});

test("the seven constructs are declared and C7 is outside the index", () => {
  const contract = loadEcdContract();
  const ids = contract.construct_map.constructs.map((one) => one.construct_id);
  assert.deepEqual(ids, ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]);
  assert.deepEqual(contract.construct_map.process_index.construct_ids, ["C1", "C2", "C3", "C4", "C5", "C6"]);
  assert.deepEqual(contract.construct_map.longitudinal_lane.construct_ids, ["C7"]);
  assert.equal(contract.construct_map.constructs.find((one) => one.construct_id === "C7").in_process_index, false);
});

test("the digest moves when the contract changes and not when its keys are reordered", () => {
  const before = contractDigests();
  const reordered = loadEcdContract();
  reordered.cells.cells = reordered.cells.cells.map((cell) => Object.fromEntries(Object.entries(cell).reverse()));
  assert.equal(contractDigests(reordered).cells, before.cells);

  const changed = clone();
  cellIn(changed, "C3.ER.01").rival_explanations[0].status = "CONTROLLED";
  assert.notEqual(contractDigests(changed).cells, before.cells);
});

// --- negative: the mapping fails closed ------------------------------------------------------

test("a subcheck mapped twice fails", () => {
  const doc = clone();
  cellIn(doc, "C1.AO.01").subcheck_ids.push("M01.required-outcome-preserved");
  cellIn(doc, "C1.AO.01").minimum_opportunities = 2;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("subcheck-double-owned"), JSON.stringify(checks(report)));
});

test("a subcheck mapped nowhere fails", () => {
  const doc = clone();
  const cell = cellIn(doc, "C1.SB.01");
  cell.subcheck_ids = cell.subcheck_ids.slice(1);
  cell.minimum_opportunities = cell.subcheck_ids.length;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("subcheck-unmapped"));
});

test("a cell claiming a subcheck that does not exist fails", () => {
  const doc = clone();
  const cell = cellIn(doc, "C1.SD.01");
  cell.subcheck_ids = ["M03.stop-condition-defined", "M99.invented-subcheck"];
  cell.minimum_opportunities = 2;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("subcheck-unknown"));
});

test("a cell no construct claims fails", () => {
  const doc = clone();
  const construct = doc.construct_map.constructs.find((one) => one.construct_id === "C1");
  construct.axes.delegated_artifact.required_cell_ids =
    construct.axes.delegated_artifact.required_cell_ids.filter((id) => id !== "C1.SD.01");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("cell-unlisted"));
});

test("a cell listed under the wrong construct or the wrong axis fails", () => {
  const wrongConstruct = clone();
  wrongConstruct.construct_map.constructs.find((one) => one.construct_id === "C1")
    .axes.delegated_artifact.required_cell_ids.push("C2.CS.01");
  assert.ok(checks(checkEcdContract(wrongConstruct)).includes("construct-cell-mismatch"));

  const wrongAxis = clone();
  const c5 = wrongAxis.construct_map.constructs.find((one) => one.construct_id === "C5");
  c5.axes.system_outcome.required_cell_ids = c5.axes.system_outcome.required_cell_ids.filter((id) => id !== "C5.FO.01");
  c5.axes.operator_process.required_cell_ids.push("C5.FO.01");
  assert.ok(checks(checkEcdContract(wrongAxis)).includes("construct-axis-mismatch"));
});

test("a construct in the index with no required operator-process cell fails", () => {
  const doc = clone();
  const c3 = doc.construct_map.constructs.find((one) => one.construct_id === "C3");
  c3.axes.operator_process.required_cell_ids = [];
  cellIn(doc, "C3.ER.01").required_for_construct = false;
  c3.axes.operator_process.optional_cell_ids.push("C3.ER.01");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("index-construct-empty"));
});

test("moving the longitudinal lane into the index fails", () => {
  const doc = clone();
  doc.construct_map.process_index.construct_ids.push("C7");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("longitudinal-in-index"));
});

test("a contract that pins a subcheck cardinality the product does not have fails", () => {
  // The eighty-row claim was unfalsifiable while the count was inferred. Duplicate a subcheck name
  // inside one metric and `declaredSubcheckIds()` stays eighty long and goes seventy-nine distinct,
  // and every mapping check is written over the distinct set -- the verifier passed a contract that
  // described seventy-nine questions and called it eighty. The count is now pinned in the artifact,
  // so a product that has stopped having eighty has to say so in the file to stay green.
  const doc = clone();
  doc.cells.declared_subcheck_count = 79;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("subcheck-cardinality"), JSON.stringify(checks(report)));

  const shipped = loadEcdContract();
  assert.equal(shipped.cells.declared_subcheck_count, 80);
  assert.equal(new Set(declaredSubcheckIds()).size, 80);
  assert.equal(subcheckMapping().length, 80);
});

test("an artifact at a version this module does not issue fails", () => {
  // The schemas ask for a semantic version, not for this one, so four artifacts at 1.0.0 and one at
  // 9.9.9 verified and sealed. Every result then quoted the module's hard-coded version and
  // described a mixed contract as a coherent one.
  for (const key of ARTIFACT_KEYS) {
    const doc = clone();
    doc[key].contract_version = "9.9.9";
    const report = checkEcdContract(doc);
    assert.equal(report.ok, false, key);
    assert.ok(checks(report).includes("artifact-version-mismatch"), key);
  }
  for (const key of ARTIFACT_KEYS) {
    assert.equal(loadEcdContract()[key].contract_version, ECD_CONTRACT_VERSION, key);
  }
});
