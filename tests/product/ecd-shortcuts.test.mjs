import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { checkEcdContract, evaluate, loadEcdContract, opportunitiesOf } from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";

// verify:no-construct-shortcuts
//
// The forbidden implementations in the contract are all the same move: a number made of something
// that is easy to observe standing in for something that is hard to observe. Length, turns, speed,
// how many opportunities a cell happened to have, and an ability band nobody set a standard for.

const clone = () => JSON.parse(JSON.stringify(loadEcdContract()));
const checks = (report) => report.failures.map((one) => one.check);
const complete = { forms_completed: ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"] };
const allPass = () => METRIC_IDS.map((id) => observationOf({
  metric_id: id,
  verifier_id: "test.v1",
  subchecks: METRICS[id].subchecks.map((one) => ({ id: one, pass: true })),
  reason: "test"
}));

const PROHIBITED = [
  "prompt_length", "turn_count", "verbosity", "typing_speed", "wall_clock_speed",
  "tool_count", "autonomy_level", "confidence_without_correctness", "explanation_length"
];

test("every anti-shortcut the measurement foundations name is a declared prohibited value source", () => {
  const declared = loadEcdContract().evidence_model.prohibited_value_sources.map((one) => one.id);
  for (const id of PROHIBITED) assert.ok(declared.includes(id), id);
});

test("every scoring rule declares what it may not be made of", () => {
  const contract = loadEcdContract();
  const declared = new Set(contract.evidence_model.prohibited_value_sources.map((one) => one.id));
  for (const rule of contract.evidence_model.scoring_rules) {
    assert.ok(rule.prohibited_inputs.length > 0, rule.scoring_rule_id);
    for (const input of rule.prohibited_inputs) assert.ok(declared.has(input), `${rule.scoring_rule_id}: ${input}`);
  }
});

test("the implemented scoring rule reads a subcheck verdict and nothing else", () => {
  // A value is 1, 0 or absent. There is no third input for a length or a duration to enter through.
  const rows = opportunitiesOf(allPass());
  for (const row of rows) {
    assert.ok([1, 0, null].includes(row.value_0_1), row.subcheck_id);
    assert.deepEqual(Object.keys(row).sort(), ["axis", "cell_id", "construct_id", "subcheck_id", "value_0_1", "verdict"]);
  }
});

test("handing a prohibited value source to the scorer is refused rather than ignored", () => {
  const observations = allPass();
  for (const key of PROHIBITED) {
    assert.throws(() => evaluate(observations, { ...complete, [key]: 1 }), /AOS_PROHIBITED_VALUE_SOURCE/, key);
  }
});

test("an issued result carries no category, cut score, percentile, rank or band", () => {
  const result = evaluate(allPass(), complete);
  for (const field of ["category", "cut_score", "percentile", "rank", "band"]) {
    assert.equal(result[field], null, field);
    assert.equal(result.process_index[field], null, `process_index.${field}`);
  }
  const serialized = JSON.stringify(result);
  for (const word of ["HIGH RELIABILITY", "ADVANCED", "DEVELOPING", "FRAGILE", "ROBUST", "STRONG"]) {
    assert.equal(serialized.includes(word), false, word);
  }
});

test("the no-band claim is made about this contract and not about a product that still emits one", () => {
  // The interpretation argument used to assume "no category, band, cut score, percentile or rank is
  // emitted at any stage" and mark the evidence PASS. That is true of everything this contract
  // issues and false of the product: lib/scorer-v1.mjs assigns a category to a legacy result and
  // lib/cli.mjs prints it. A schema-complete argument that records a false statement as passing
  // evidence is worse than a gap, because it reads as having been checked.
  const use = loadEcdContract().interpretation_use;
  const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const stillEmitted = /\bband\b/.test(source("lib/scorer-v1.mjs"));

  assert.equal(use.legacy_band_surface.status, stillEmitted ? "PRESENT" : "REMOVED");
  assert.equal(use.legacy_band_surface.owner_issue, 568);
  assert.ok(use.legacy_band_surface.modules.length > 0);
  for (const path of use.legacy_band_surface.modules) {
    assert.ok(/\bband\b/.test(source(path)), `${path} is disclosed as carrying a band and does not`);
  }

  // No assumption anywhere in the argument may state the absence without saying whose absence it is.
  for (const inference of use.inferences) {
    for (const assumption of inference.assumptions) {
      if (/band/i.test(assumption)) assert.match(assumption, /this contract/);
    }
  }
  const evidence = use.inferences.flatMap((one) => one.evidence);
  const disclosed = evidence.find((one) => one.evidence_id === "legacy-band-surface-disclosed");
  assert.ok(disclosed, "the legacy band surface is not recorded as evidence at all");
  assert.equal(disclosed.status, stillEmitted ? "FAIL" : "PASS");
});

test("a legacy band surface declared present and naming nothing fails", () => {
  const doc = clone();
  doc.interpretation_use.legacy_band_surface.modules = [];
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(report.failures.map((one) => one.check).includes("legacy-band-undisclosed"));
});

test("no contract artifact carries an ability category", () => {
  const contract = loadEcdContract();
  const serialized = JSON.stringify(contract);
  for (const word of ["HIGH RELIABILITY", "ADVANCED", "DEVELOPING", "FRAGILE", "ROBUST", "STRONG"]) {
    assert.equal(serialized.includes(word), false, word);
  }
  assert.equal(contract.construct_map.process_index.category, null);
  assert.equal(contract.construct_map.process_index.cut_scores, null);
  assert.equal(contract.construct_map.process_index.percentile, null);
  assert.equal(contract.construct_map.process_index.rank, null);
});

test("the contract is not the old dimensions with new names", () => {
  // The forbidden implementation is renaming D1-D6 and declaring the work done. A construct here is
  // not one dimension: the six dimensions are split across the seven constructs and across four
  // evidence axes, and two constructs draw their cells from more than one family.
  const contract = loadEcdContract();
  const dimensionOf = new Map(METRIC_IDS.map((id) => [id, METRICS[id].dimension]));
  const perConstruct = new Map();
  for (const cell of contract.cells.cells) {
    for (const id of cell.subcheck_ids) {
      const dimension = dimensionOf.get(id.split(".")[0]);
      if (!perConstruct.has(cell.construct_id)) perConstruct.set(cell.construct_id, new Set());
      perConstruct.get(cell.construct_id).add(dimension);
    }
  }
  const split = [...perConstruct.values()].filter((set) => set.size > 1);
  assert.ok(split.length > 0, "every construct is exactly one old dimension, which is a rename");

  const multiAxis = contract.construct_map.constructs.filter((one) => Object.keys(one.axes).length > 1);
  assert.ok(multiAxis.length >= 4, "no construct spans more than one evidence axis");
});

test("no single latent ability is assumed: the axes are estimated separately and never summed", () => {
  const result = evaluate(allPass(), complete);
  const axes = new Set(result.constructs.map((one) => one.axis));
  assert.ok(axes.size >= 3, [...axes].join(","));
  // The one index this contract permits is computed over one axis, and its own spec says which.
  assert.equal(result.process_index.axis, "operator_process");
  assert.equal(result.process_index.construct_ids.length, 6);
  assert.equal(Object.hasOwn(result, "composite"), false);
  assert.equal(Object.hasOwn(result, "total"), false);
});

test("the module that scores this contract contains no clock, no length and no counter of turns", () => {
  // A structural check, because the runtime refusal only fires on a caller that names the field.
  // Comments are stripped first: the module has to be able to say in prose what it refuses to
  // compute, and a scan that cannot tell the two apart would forbid explaining the rule.
  const source = readFileSync(new URL("../../lib/ecd-contract.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const pattern of [/Date\.now/, /performance\.now/, /hrtime/, /\.length\s*\/\s*\d/, /elapsed/i, /duration/i, /timestamp/i]) {
    assert.equal(pattern.test(source), false, String(pattern));
  }
});

// --- negative --------------------------------------------------------------------------------

test("a scoring rule prohibiting something the model never declared fails", () => {
  const doc = clone();
  doc.evidence_model.scoring_rules[0].prohibited_inputs.push("moon_phase");
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("prohibited-input-unknown"));
});

test("putting an ability band into the contract fails", () => {
  const doc = clone();
  doc.construct_map.process_index.interpretation = "descriptive only";
  doc.construct_map.constructs[0].definition = `${doc.construct_map.constructs[0].definition} Reported as HIGH RELIABILITY when strong.`;
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("band-vocabulary"));
});
