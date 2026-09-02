import assert from "node:assert/strict";
import test from "node:test";

import { checkEcdContract, loadEcdContract } from "../../lib/ecd-contract.mjs";
import { FAMILIES } from "../../lib/suite.mjs";

// verify:task-opportunities
//
// A form that does not create the opportunity a cell needs is a cell that will be reported as
// unobserved forever, and nobody will know which of the two is broken. So the form and the cell have
// to name each other, and a cell whose opportunity source nobody administers has to say so rather
// than sit there looking scoreable.

const clone = () => JSON.parse(JSON.stringify(loadEcdContract()));
const checks = (report) => report.failures.map((one) => one.check);

test("the administered forms are the families the suite actually runs", () => {
  const contract = loadEcdContract();
  const operational = contract.task_model.forms.filter((one) => one.class === "OPERATIONAL").map((one) => one.form_id);
  assert.deepEqual(operational, [...FAMILIES]);
});

test("every form declares its perturbation, its oracle and what it may not reward", () => {
  for (const form of loadEcdContract().task_model.forms) {
    assert.ok(form.required_perturbation.length >= 10, form.form_id);
    assert.ok(form.required_oracle.length >= 10, form.form_id);
    assert.ok(form.shortcut_prohibitions.length > 0, form.form_id);
    assert.ok(form.construct_opportunity_cell_ids.length > 0, form.form_id);
    assert.equal(form.scored_once_per_cycle, true, form.form_id);
  }
});

test("a form and a cell name each other or the contract fails", () => {
  const contract = loadEcdContract();
  const byForm = new Map(contract.task_model.forms.map((one) => [one.form_id, one]));
  for (const cell of contract.cells.cells) {
    for (const formId of cell.task_opportunity.form_ids) {
      assert.ok(byForm.get(formId).construct_opportunity_cell_ids.includes(cell.cell_id), `${cell.cell_id} <-> ${formId}`);
    }
  }
  for (const form of contract.task_model.forms) {
    for (const cellId of form.construct_opportunity_cell_ids) {
      const cell = contract.cells.cells.find((one) => one.cell_id === cellId);
      assert.ok(cell.task_opportunity.form_ids.includes(form.form_id), `${form.form_id} <-> ${cellId}`);
    }
  }
});

test("a form's required and optional cell coverage matches what the cells declare", () => {
  const contract = loadEcdContract();
  for (const form of contract.task_model.forms) {
    for (const cellId of form.required_cell_ids) {
      assert.equal(contract.cells.cells.find((one) => one.cell_id === cellId).required_for_construct, true, cellId);
    }
    for (const cellId of form.optional_cell_ids) {
      assert.equal(contract.cells.cells.find((one) => one.cell_id === cellId).required_for_construct, false, cellId);
    }
    assert.deepEqual(
      [...form.required_cell_ids, ...form.optional_cell_ids].sort(),
      [...form.construct_opportunity_cell_ids].sort()
    );
  }
});

test("no form claims a difficulty and no seed claims form equivalence", () => {
  const contract = loadEcdContract();
  for (const form of contract.task_model.forms) {
    assert.equal(form.facets.difficulty.value, null, `${form.form_id} claims a difficulty`);
    assert.equal(form.facets.difficulty.status, "UNESTABLISHED", form.form_id);
  }
  assert.equal(contract.task_model.equivalence.status, "UNESTABLISHED");
  assert.equal(contract.task_model.exposure_ledger.required, true);
});

test("a cell whose opportunity source is not administered is declared unpopulated", () => {
  const contract = loadEcdContract();
  const sources = contract.task_model.unadministered_opportunity_sources;
  assert.ok(sources.length > 0);
  for (const source of sources) {
    assert.equal(source.status, "NOT_ADMINISTERED");
    for (const cellId of source.required_for_cell_ids) {
      const cell = contract.cells.cells.find((one) => one.cell_id === cellId);
      assert.equal(cell.population_status, "DECLARED_UNPOPULATED", cellId);
      assert.deepEqual(cell.subcheck_ids, [], cellId);
      assert.deepEqual(cell.task_opportunity.form_ids, [], cellId);
    }
  }
});

test("no administered form creates a reliance opportunity, and the contract says so rather than pretending", () => {
  // The measurement foundations require an independent initial judgment before the advice for a
  // reliance opportunity to exist at all. No family administers one, so advice-acceptance frequency
  // could not stand in for it and the reliance cells are unpopulated by declaration, not by accident.
  const contract = loadEcdContract();
  const reliance = contract.cells.cells.filter((one) => one.axis === "reliance_calibration");
  assert.ok(reliance.length > 0);
  for (const cell of reliance) assert.equal(cell.population_status, "DECLARED_UNPOPULATED", cell.cell_id);
  const source = contract.task_model.unadministered_opportunity_sources.find((one) => one.source_id === "reliance-episode");
  assert.ok(source);
  assert.deepEqual(source.required_for_cell_ids.sort(), reliance.map((one) => one.cell_id).sort());
});

// --- negative --------------------------------------------------------------------------------

test("a form claiming a cell that does not name it fails", () => {
  const doc = clone();
  doc.task_model.forms.find((one) => one.form_id === "FAM-1").construct_opportunity_cell_ids.push("C5.FO.01");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("form-cell-not-reciprocal"));
});

test("a cell naming a form the task model does not declare fails", () => {
  const doc = clone();
  doc.cells.cells.find((one) => one.cell_id === "C1.GF.01").task_opportunity.form_ids.push("FAM-9");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("cell-form-unknown"));
});

test("scoring a cell whose opportunity source is not administered fails", () => {
  const doc = clone();
  const cell = doc.cells.cells.find((one) => one.cell_id === "C3.RA.01");
  cell.population_status = "SUBCHECK_BACKED";
  cell.subcheck_ids = ["M11.critical-evidence-inspected"];
  cell.task_opportunity.form_ids = ["FAM-4"];
  doc.task_model.forms.find((one) => one.form_id === "FAM-4").construct_opportunity_cell_ids.push("C3.RA.01");
  doc.task_model.forms.find((one) => one.form_id === "FAM-4").required_cell_ids.push("C3.RA.01");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("unadministered-but-populated"), JSON.stringify(checks(report)));
});

test("a cell that claims to be scored while declaring no form fails", () => {
  const doc = clone();
  doc.cells.cells.find((one) => one.cell_id === "C1.OF.01").population_status = "SUBCHECK_BACKED";
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("population-mismatch"));
});

test("a shortcut prohibition the evidence model does not declare fails", () => {
  const doc = clone();
  doc.cells.cells.find((one) => one.cell_id === "C1.GF.01").task_opportunity.shortcut_prohibitions.push("vibes");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("shortcut-unknown"));
});
