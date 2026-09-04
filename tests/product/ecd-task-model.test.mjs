import assert from "node:assert/strict";
import test from "node:test";

import { checkEcdContract, loadEcdContract } from "../../lib/ecd-contract.mjs";
import { observedCleanEffects } from "./helpers.mjs";
import { observeRun } from "../../lib/observe.mjs";
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

/**
 * The fourth of the four declarations that must agree about a cell's optionality.
 *
 * A merge-gate round found this site enforced by `tests/product/ecd-task-model.test.mjs` alone:
 * moving `C2.RF.01` into FAM-3's `optional_cell_ids` left `checkEcdContract` returning ok with zero
 * failures, while the other three sites all fired. A cross-check the contract's own prose names and
 * its validator does not perform is the class this contract exists to refuse, so these ask the
 * validator rather than asking a test to stand in for it.
 */
test("a form list that disagrees with the cell's own required_for_construct fails", () => {
  const doc = clone();
  const form = doc.task_model.forms.find((one) => one.form_id === "FAM-3");
  form.required_cell_ids = form.required_cell_ids.filter((id) => id !== "C2.RF.01");
  form.optional_cell_ids = [...form.optional_cell_ids, "C2.RF.01"];
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("form-requirement-mismatch"));
});

test("a cell a form administers and places in neither list fails", () => {
  const doc = clone();
  const form = doc.task_model.forms.find((one) => one.form_id === "FAM-3");
  form.required_cell_ids = form.required_cell_ids.filter((id) => id !== "C2.RF.01");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("form-cell-unplaced"));
});

test("a form that lists a cell it does not administer fails", () => {
  const doc = clone();
  doc.task_model.forms.find((one) => one.form_id === "FAM-1").required_cell_ids.push("C2.RF.01");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("form-cell-unclaimed"));
});

test("a cell listed as both required and optional by one form fails", () => {
  const doc = clone();
  const form = doc.task_model.forms.find((one) => one.form_id === "FAM-3");
  form.optional_cell_ids = [...form.optional_cell_ids, "C2.RF.01"];
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("form-cell-listed-twice"));
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

test("a form's declared opportunity count is derived from its cells, not believed", () => {
  // FAM-1's twelve could have read nine hundred and ninety-nine: nothing checked it. It is also not
  // a minimum, which is what it used to be called. Counted per subcheck rather than per cell, the
  // six numbers partition the eighty exactly; counted per cell they summed to eighty-four.
  const contract = loadEcdContract();
  for (const form of contract.task_model.forms) {
    const derived = contract.cells.cells.reduce((total, cell) =>
      total + cell.subcheck_administered_by.filter((entry) => entry.form_id === form.form_id).length, 0);
    assert.equal(form.declared_opportunity_count, derived, form.form_id);
  }
  const total = contract.task_model.forms.reduce((sum, one) => sum + one.declared_opportunity_count, 0);
  assert.equal(total, contract.cells.declared_subcheck_count);

  const doc = clone();
  doc.task_model.forms[0].declared_opportunity_count = 999;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("form-opportunity-count-mismatch"), JSON.stringify(checks(report)));
});

test("a form that shares a cell with another form says so, because the cell lists still overlap", () => {
  // One cell is administered by two forms: C6.SL.01 holds two of M06's subchecks, which FAM-2
  // produces, and one of M19's, which FAM-6 produces. The opportunity counts partition because they
  // are counted per subcheck, but the cell lists still overlap, and a consumer reading those as
  // disjoint double counts the cell.
  const contract = loadEcdContract();
  const forms = new Map(contract.task_model.forms.map((one) => [one.form_id, one]));
  assert.deepEqual(forms.get("FAM-2").shared_opportunity_cell_ids, ["C6.SL.01"]);
  assert.deepEqual(forms.get("FAM-6").shared_opportunity_cell_ids, ["C6.SL.01"]);
  assert.deepEqual(forms.get("FAM-4").shared_opportunity_cell_ids, []);
  assert.deepEqual(forms.get("FAM-5").shared_opportunity_cell_ids, []);
  assert.deepEqual(forms.get("FAM-1").shared_opportunity_cell_ids, []);

  const doc = clone();
  doc.task_model.forms.find((one) => one.form_id === "FAM-2").shared_opportunity_cell_ids = [];
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("form-shared-cells-undisclosed"), JSON.stringify(checks(report)));
});

/**
 * A run in which every family produced something, so every observation names the family that made
 * it. The values do not matter and mostly fail; what matters is that `lib/observe.mjs` takes the
 * `build` path for all twenty metrics rather than the `absent` one, which carries no family.
 */
const everyFamilyObserved = () => observeRun({
  artifacts: {
    contract: { goal: "g" },
    answer: { port: 1 },
    plan: { tasks: [{ id: "a", objective: "o", acceptance: "x", route: "r", depends_on: [] }] },
    resume: { stop_condition: "s" },
    response: { budget_plan: "local" }
  },
  interventions: { observed: true, checkpoints_raised: 1, observations: [{ effective: true, state_change: "resumed" }] },
  orchestration: { integrity: { observed: true, consumed: 1, unconsumed: 0, "nothing-handed": 0 }, join: { branches: [{}, {}], complete: true } },
  fam5: { honest: true, artifact_present: true, revision: { available: true, bound: true, clean: true, changed_since: [], named: "abc1234" } },
  invocations: {},
  // #557. M19 is answered from what the run did, and a run whose axes nothing observed leaves it
  // unobserved and unattributed. The metric is still administered by FAM-6 -- the scanner reads the
  // artifact that family asks for -- so the fixture states an observed boundary in order to
  // exercise the `build` path for it, exactly as it states an intervention to exercise D4's. The
  // seeded canary is part of that: without one there is no controlled secret to search the
  // delivered bytes for, so the scanner answers nothing and the metric withholds.
  params: { "FAM-6": { canary: "AOS-CANARY-fixture" } },
  effects: observedCleanEffects()
});

test("the form that administers a metric is the family lib/observe.mjs attributes it to", () => {
  // The contract used to guess this from which artifact a metric reads, and got one wrong: C5.TC.01
  // named FAM-4 as well as FAM-5, because FAM-4 writes the resume file M17 opens. FAM-4's
  // opportunity count then included a subcheck FAM-4 never administers.
  const contract = loadEcdContract();
  const declared = new Map();
  for (const form of contract.task_model.forms) {
    for (const metricId of form.administered_metric_ids) declared.set(metricId, form.form_id);
  }

  const observed = everyFamilyObserved();
  assert.equal(observed.length, 20);
  for (const observation of observed) {
    const family = (observation.evidence_ids ?? []).find((id) => /^FAM-/.test(id));
    assert.ok(family, `${observation.metric_id} was not attributed to a family by this fixture`);
    assert.equal(declared.get(observation.metric_id), family, observation.metric_id);
  }

  // And every subcheck inherits its metric's form, so the six counts partition the eighty.
  for (const cell of contract.cells.cells) {
    for (const entry of cell.subcheck_administered_by) {
      assert.equal(entry.form_id, declared.get(entry.subcheck_id.split(".")[0]), entry.subcheck_id);
    }
  }
});

test("a subcheck attributed to a form that does not administer its metric fails", () => {
  const doc = clone();
  const cell = doc.cells.cells.find((one) => one.cell_id === "C5.TC.01");
  // The defect exactly as it shipped: M17 is FAM-5's, and the cell claimed FAM-4 as well.
  cell.subcheck_administered_by[0].form_id = "FAM-4";
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("subcheck-administration-wrong-form"), JSON.stringify(checks(report)));
});

test("a cell naming a form that administers none of its subchecks fails", () => {
  const doc = clone();
  const cell = doc.cells.cells.find((one) => one.cell_id === "C5.TC.01");
  cell.task_opportunity.form_ids = ["FAM-4", "FAM-5"];
  doc.task_model.forms.find((one) => one.form_id === "FAM-4").construct_opportunity_cell_ids.push("C5.TC.01");
  doc.task_model.forms.find((one) => one.form_id === "FAM-4").optional_cell_ids.push("C5.TC.01");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("cell-form-not-administering"), JSON.stringify(checks(report)));
});

test("a cell that does not say who administers each of its subchecks fails", () => {
  const doc = clone();
  const cell = doc.cells.cells.find((one) => one.cell_id === "C1.SB.01");
  cell.subcheck_administered_by = cell.subcheck_administered_by.slice(1);
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("subcheck-administration-mismatch"));
});

test("a metric administered by two forms or by none fails", () => {
  const twice = clone();
  twice.task_model.forms.find((one) => one.form_id === "FAM-1").administered_metric_ids.push("M20");
  assert.ok(checks(checkEcdContract(twice)).includes("form-metric-double-administered"));

  const never = clone();
  const fam6 = never.task_model.forms.find((one) => one.form_id === "FAM-6");
  fam6.administered_metric_ids = fam6.administered_metric_ids.filter((id) => id !== "M20");
  assert.ok(checks(checkEcdContract(never)).includes("form-metric-unadministered"));

  const invented = clone();
  invented.task_model.forms.find((one) => one.form_id === "FAM-1").administered_metric_ids.push("M99");
  assert.ok(checks(checkEcdContract(invented)).includes("form-metric-unknown"));
});
