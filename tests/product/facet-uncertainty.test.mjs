import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalJson, sha256Value } from "../../lib/core.mjs";
import { describeO4Shortcuts, bindFacetRecords, deriveMeasurementClaims } from "../../lib/facet-calibration.mjs";
import { comparability, contractDigests, evaluate, subcheckMapping } from "../../lib/ecd-contract.mjs";
import { observeRun } from "../../lib/observe.mjs";
import { buildResult, projectResult } from "../../lib/result-schema.mjs";
import { FAMILIES } from "../../lib/suite.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";

// VERIFIER_ACCEPTANCE A7/A8/A9 and R10-R17.  These use the same evidence-to-issuance path as the
// CLI: bind at observe time, derive during evaluate, then project the persisted result.
const digest = (value) => `sha256:${sha256Value(value)}`;
const contract = contractWithAPopulatedIndex();
const mapping = subcheckMapping(contract);
const cellsByMetric = Object.fromEntries(observationsWith().map((row) => [row.metric_id,
  [...new Set(mapping.filter((entry) => entry.metric_id === row.metric_id).map((entry) => entry.cell_id))]
]));
const familyByMetric = Object.fromEntries(observationsWith().map((row) => [row.metric_id,
  mapping.find((entry) => entry.metric_id === row.metric_id)?.form_id ?? "FAM-1"
]));

const bound = ({ facets = identified.facets, records = {}, source = observationsWith() } = {}) => bindFacetRecords(source, {
  contract_digest: records.contract_digest ?? contractDigests(contract).combined,
  cells_by_metric: cellsByMetric,
  family_by_metric: familyByMetric,
  difficulty_version: records.difficulty_version ?? digest("operational-form.v1"),
  model_profile_digest: records.model_profile_digest ?? identified.profile_digest,
  runtime_harness_digest: records.runtime_harness_digest ?? digest({ harness: facets.harness, runtime: facets.runtime }),
  occasion_id: records.occasion_id ?? "occasion-1",
  sequence_position: records.sequence_position ?? 1,
  language: records.language ?? facets.language,
  interface: records.interface ?? facets.interface,
  domain_familiarity: records.domain_familiarity ?? "unknown"
});

const evaluated = ({ facets = identified.facets, records, source, context = {} } = {}) => {
  const observations = bound({ facets, records, source });
  const evaluation = evaluate(observations, {
    ...identified,
    facets,
    require_facet_records: true,
    ...context
  }, contract);
  return { observations, evaluation, result: buildResult({ contract, evaluation, observations }) };
};

test("same operator plus an easier task remains a separately identified task record", () => {
  // RED counterfactual: same operator + easier task.
  const hard = evaluated({ records: { difficulty_version: digest("hard") } });
  const easy = evaluated({ records: { difficulty_version: digest("easy") } });
  assert.notEqual(hard.observations[0].facet_record.difficulty_version, easy.observations[0].facet_record.difficulty_version);
  assert.equal(easy.result.generalizability_status, "UNESTABLISHED");
  assert.notEqual(easy.result.claim_stage, "GENERALIZABILITY_SUPPORTED");
});

test("issued observations bind facet records at the production boundary", () => {
  // The mutation target is observeRun itself, not a helper only these tests call.
  const observations = observeRun({
    facet_evidence: {
      contract_digest: contractDigests(contract).combined,
      cells_by_metric: cellsByMetric,
      family_by_metric: familyByMetric,
      difficulty_version: digest("operational-form.v1"),
      model_profile_digest: identified.profile_digest,
      runtime_harness_digest: digest({ harness: "h1", runtime: "r1" }),
      occasion_id: "occasion-1",
      language: "en",
      interface: "cli"
    }
  });
  assert.ok(observations.every((observation) => observation.facet_records.length > 0));
  assert.ok(observations.every((observation) => observation.facet_record.facet_contract_digest === contractDigests(contract).combined));
});

test("a stronger model remains a separate model facet", () => {
  // RED counterfactual: same operator + stronger model.
  const first = evaluated({ records: { model_profile_digest: digest("model-a") } });
  const stronger = evaluated({ records: { model_profile_digest: digest("model-b") } });
  assert.notEqual(first.observations[0].facet_record.model_profile_digest, stronger.observations[0].facet_record.model_profile_digest);
  assert.equal(stronger.result.generalizability_status, "UNESTABLISHED");
});

test("second occasion records practice rather than becoming a second independent person score", () => {
  // RED counterfactual: second occasion/practice.
  const first = evaluated({ records: { occasion_id: "occasion-1", sequence_position: 1 } });
  const practice = evaluated({ records: { occasion_id: "occasion-2", sequence_position: 2 } });
  assert.equal(practice.observations[0].facet_record.occasion_id, "occasion-2");
  assert.equal(practice.observations[0].facet_record.sequence_position, 2);
  assert.equal(practice.result.generalizability_status, "UNESTABLISHED");
  assert.notEqual(first.observations[0].facet_record.occasion_id, practice.observations[0].facet_record.occasion_id);
});

test("the same response under a stricter verifier exposes verifier drift", () => {
  // RED counterfactual: same response + stricter verifier.
  const source = observationsWith().map((observation) => ({ ...observation, verifier_id: "strict-verifier.v2" }));
  const normal = evaluated();
  const strict = evaluated({ source });
  assert.notEqual(normal.observations[0].facet_record.verifier_id, strict.observations[0].facet_record.verifier_id);
  assert.notEqual(normal.observations[0].facet_record.verifier_contract_digest, strict.observations[0].facet_record.verifier_contract_digest);
});

test("the same translated form withholds direct comparison pending invariance", () => {
  // RED counterfactual: same translated form.
  const english = evaluated({ facets: { ...identified.facets, language: "en" } });
  const korean = evaluated({ facets: { ...identified.facets, language: "ko" }, records: { language: "ko" } });
  assert.equal(korean.observations[0].facet_record.language, "ko");
  assert.equal(comparability(english.evaluation, korean.evaluation).comparable, false);
  assert.deepEqual(comparability(english.evaluation, korean.evaluation).facets, ["language"]);
});

test("three perfect uncalibrated forms cannot issue a generalizability claim", () => {
  // RED counterfactual: three perfect uncalibrated forms.
  const source = observationsWith().map((observation, index) => ({ ...observation, metric_id: observation.metric_id }));
  const observations = bound({ source }).map((observation, index) => ({
    ...observation,
    facet_record: { ...observation.facet_record, task_form_id: `FAM-${(index % 3) + 1}` },
    facet_records: observation.facet_records.map((record) => ({ ...record, task_form_id: `FAM-${(index % 3) + 1}` }))
  }));
  const claims = deriveMeasurementClaims({ observations, contract_digest: contractDigests(contract).combined, require_facet_records: true });
  assert.equal(claims.facet_coverage.forms.count, 3);
  assert.equal(claims.generalizability.status, "UNESTABLISHED");
  assert.equal(claims.uncertainty.interval, null);
});

test("no population data permits PROFILE_BOUND but leaves uncertainty and generalizability withheld", () => {
  // RED counterfactual: no population data.
  const { result } = evaluated();
  assert.equal(result.claim_stage, "PROFILE_BOUND");
  assert.equal(result.generalizability_status, "UNESTABLISHED");
  assert.equal(result.uncertainty.status, "INSUFFICIENT_DATA");
  assert.equal(result.uncertainty.interval, null);
  assert.equal(result.calibration.g_study.variance_components, null);
  assert.equal(projectResult(result).claim.calibration_default, "operational default form count; not a psychometric minimum");
});

test("missing or contract-mismatched facet evidence refuses PROFILE_BOUND on the issuance path", () => {
  // VERIFIER_ACCEPTANCE R10.  This is deliberately evidence-derived, not a stored verdict test.
  const missing = evaluate(observationsWith(), { ...identified, require_facet_records: true }, contract);
  assert.equal(missing.claim_stage, "RUN_DIAGNOSTIC");
  const mismatch = evaluated({ records: { contract_digest: digest("another-contract") } });
  assert.equal(mismatch.evaluation.claim_stage, "RUN_DIAGNOSTIC");
  assert.ok(mismatch.evaluation.facet_coverage.problems.includes("facet-contract-mismatch"));
});

test("LLM rater self-report alone cannot carry an uncertainty or generalizability claim", () => {
  // VERIFIER_ACCEPTANCE R15.
  const source = observationsWith().map((observation) => ({ ...observation, verifier_id: "llm-grader" }));
  const { result } = evaluated({ source });
  assert.equal(result.calibration.mfrm_rater.status, "INSUFFICIENT_DATA");
  assert.equal(result.uncertainty.interval, null);
  assert.equal(result.generalizability_status, "UNESTABLISHED");
});

for (const [field, evaluationField] of [
  ["prompt_length", "prompt_length"],
  ["token_length", "verbosity"],
  ["turn_count", "turn_count"],
  ["wall_clock", "wall_clock_speed"],
  ["tool_count", "tool_count"],
  ["agent_autonomy", "autonomy_level"]
]) {
  test(`${field} is O4 descriptive outcome, never operator Process credit`, () => {
    const descriptor = describeO4Shortcuts({ [field]: 7 });
    assert.equal(descriptor.axis, "O4_DESCRIPTIVE_OUTCOME");
    assert.equal(descriptor.descriptors[field], 7);
    assert.throws(() => evaluate(observationsWith(), { ...identified, [evaluationField]: 7 }, contract), /AOS_PROHIBITED_VALUE_SOURCE/);
  });
}

test("the operational default label is never described as a psychometric minimum", () => {
  // VERIFIER_ACCEPTANCE A9/R17: assert the emitted label, not the internal number.
  const { result } = evaluated();
  const label = projectResult(result).claim.calibration_default;
  assert.match(label, /operational default/u);
  assert.match(label, /not a psychometric minimum/u);
  assert.equal(label.startsWith("psychometric minimum"), false);
  assert.equal(result.calibration.d_study.operational_default_form_count, FAMILIES.length);
  assert.equal(canonicalJson(result.calibration.d_study.recommendation), "null\n");
});

test("facet verification scripts are shipped and invoked by CI", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const name of [
    "verify:facet-records",
    "verify:uncertainty-contract",
    "verify:generalizability-withholding",
    "verify:calibration-scaffold",
    "verify:no-fake-population-statistics"
  ]) {
    assert.equal(typeof packageJson.scripts[name], "string", `package.json is missing ${name}`);
    assert.match(workflow, new RegExp(`npm run ${name}`, "u"), `CI does not run ${name}`);
  }
});
