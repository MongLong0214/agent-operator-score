import assert from "node:assert/strict";
import test from "node:test";

import { checkEcdContract, comparability, evaluate, loadEcdContract } from "../../lib/ecd-contract.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";

// verify:interpretation-use-argument
//
// The chain is scoring, generalization within the cycle, extrapolation, use. What matters is not
// that the four exist but that the ones with no evidence say so: an argument whose every link reads
// SUPPORTED is an argument nobody wrote down honestly.

const clone = () => JSON.parse(JSON.stringify(loadEcdContract()));
const checks = (report) => report.failures.map((one) => one.check);
const allPass = () => METRIC_IDS.map((id) => observationOf({
  metric_id: id,
  verifier_id: "test.v1",
  subchecks: METRICS[id].subchecks.map((one) => ({ id: one, pass: true })),
  reason: "test"
}));
const complete = { forms_completed: ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"] };

test("the four inferences are present, ordered, and each carries assumptions, evidence and rebuttals", () => {
  const { inferences } = loadEcdContract().interpretation_use;
  assert.deepEqual(inferences.map((one) => one.inference_id), ["scoring", "within_cycle_generalization", "extrapolation", "use"]);
  assert.deepEqual(inferences.map((one) => one.order), [1, 2, 3, 4]);
  for (const inference of inferences) {
    assert.ok(inference.assumptions.length > 0, inference.inference_id);
    assert.ok(inference.evidence.length > 0, inference.inference_id);
    assert.ok(inference.rebuttals.length > 0, inference.inference_id);
  }
});

test("extrapolation is unsupported and every piece of its evidence is unestablished", () => {
  const extrapolation = loadEcdContract().interpretation_use.inferences.find((one) => one.inference_id === "extrapolation");
  assert.equal(extrapolation.status, "UNSUPPORTED");
  for (const evidence of extrapolation.evidence) assert.equal(evidence.status, "UNESTABLISHED", evidence.evidence_id);
});

test("no validation category is claimed as passing", () => {
  // Green CI is implementation evidence. Nothing in this repository has produced a validation study,
  // and the registry is the place that would quietly say otherwise.
  for (const entry of loadEcdContract().interpretation_use.validation_registry) {
    assert.equal(entry.status, "UNESTABLISHED", entry.category);
  }
});

test("the claim ceiling is PROFILE_BOUND and generalizability is unestablished", () => {
  const use = loadEcdContract().interpretation_use;
  assert.equal(use.default_claim_stage, "PROFILE_BOUND");
  assert.equal(use.maximum_claim_stage, "PROFILE_BOUND");
  assert.equal(use.generalizability_status, "UNESTABLISHED");
  assert.equal(use.standard_setting, null);
  assert.equal(use.categories, null);
  assert.equal(use.cut_scores, null);
});

test("hiring, certification and ranking are named as forbidden uses on the result itself", () => {
  const result = evaluate(allPass(), complete);
  for (const forbidden of ["hiring", "promotion", "certification", "population ranking"]) {
    assert.ok(result.forbidden_uses.includes(forbidden), forbidden);
  }
  assert.equal(result.generalizability_status, "UNESTABLISHED");
  assert.equal(result.uncertainty.status, "INSUFFICIENT_DATA");
  assert.equal(result.uncertainty.method, null);
  assert.equal(result.standard_setting, null);
});

test("a complete cycle claims PROFILE_BOUND and an incomplete one drops to RUN_DIAGNOSTIC", () => {
  assert.equal(evaluate(allPass(), complete).claim_stage, "PROFILE_BOUND");
  const partial = evaluate(allPass(), { forms_completed: ["FAM-1", "FAM-2"] });
  assert.equal(partial.claim_stage, "RUN_DIAGNOSTIC");
  assert.deepEqual(partial.incomplete_forms, ["FAM-3", "FAM-4", "FAM-5", "FAM-6"]);
});

test("nothing this contract issues is ever GENERALIZABILITY_SUPPORTED", () => {
  for (const context of [complete, {}, { forms_completed: [] }]) {
    assert.notEqual(evaluate(allPass(), context).claim_stage, "GENERALIZABILITY_SUPPORTED");
  }
});

test("two results differing only in language or interface may not be compared", () => {
  const base = { language: "en", interface: "cli", model: "m", runtime: "r", harness: "h" };
  assert.equal(comparability(base, { ...base }).comparable, true);

  const language = comparability(base, { ...base, language: "ko" });
  assert.equal(language.comparable, false);
  assert.equal(language.reason, "INVARIANCE_UNESTABLISHED");
  assert.deepEqual(language.facets, ["language"]);

  const surface = comparability(base, { ...base, interface: "ide" });
  assert.equal(surface.comparable, false);
  assert.deepEqual(surface.facets, ["interface"]);

  const model = comparability(base, { ...base, model: "other" });
  assert.equal(model.comparable, false);
  assert.deepEqual(model.facets, ["model"]);
});

// --- negative --------------------------------------------------------------------------------

test("raising the claim ceiling above PROFILE_BOUND fails", () => {
  const doc = clone();
  doc.interpretation_use.maximum_claim_stage = "GENERALIZABILITY_SUPPORTED";
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("claim-stage-ceiling"));
});

test("declaring generalizability supported without calibration evidence fails", () => {
  const doc = clone();
  doc.interpretation_use.generalizability_status = "SUPPORTED";
  const report = checkEcdContract(doc);
  assert.equal(report.ok, false);
  assert.ok(checks(report).includes("generalizability-claimed"));
});

test("a cut score or a category without a standard-setting record fails", () => {
  for (const field of ["categories", "cut_scores", "standard_setting"]) {
    const doc = clone();
    doc.interpretation_use[field] = { added: "by hand" };
    const report = checkEcdContract(doc);
    assert.equal(report.ok, false, field);
    // The schema types these null, so the shape check catches it before the semantic one does.
    assert.ok(checks(report).includes("schema-invalid") || checks(report).includes("standard-setting-present"), field);
  }
});
