import assert from "node:assert/strict";
import test from "node:test";

import { evaluate } from "../../lib/ecd-contract.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import {
  STANDARD_SETTING_FIELDS, STANDARD_SETTING_SCHEMA_ID, standardSettingDecision
} from "../../lib/standard-setting.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";

// verify:standard-setting-gate
//
// #568. A category, cut score, band, percentile or rank may reach a published result only behind
// an aos-standard-setting.v1 record the validation registry permits -- and in v0.2.0 the registry
// permits none, so every attempted emission is refused by name at the issuing boundary. The
// refusal is the point: before this gate, a caller handing buildResult a standard-setting record
// or a category had both silently dropped, which reads as "issued and stored null" when the truth
// is "refused". Absence stays honest the other way round too: no record and no category-shaped
// input is the ordinary result, and it carries null with no error.

const populated = contractWithAPopulatedIndex();
const build = (extra = {}) => buildResult({
  contract: populated,
  evaluation: evaluate(observationsWith(), identified, populated),
  ...extra
});

/** The record shape the issue's contract names, complete in every required field. */
const completeRecord = () => ({
  schema_id: STANDARD_SETTING_SCHEMA_ID,
  intended_decision: "local self-diagnosis threshold",
  method: "bookmark",
  panel_or_dataset_digest: `sha256:${"0".repeat(64)}`,
  cut_scores: [],
  classification_consistency: null,
  classification_accuracy: null,
  fairness_invariance_evidence_ids: [],
  uncertainty_near_cut: null,
  consequence_review: [],
  version: "1.0.0"
});

test("a new result without a standard-setting record carries every category field null", () => {
  const result = build();
  for (const field of ["standard_setting", "category", "cut_score", "percentile", "rank", "band"]) {
    assert.equal(result[field], null, field);
  }
});

test("a standard-setting record missing its consequence review is an emission refusal, not a stored null", () => {
  const record = completeRecord();
  delete record.consequence_review;
  assert.throws(() => build({ standard_setting: record }), /AOS_STANDARD_SETTING_INCOMPLETE.*consequence_review/u);
});

test("every required standard-setting field is load-bearing for the gate", () => {
  for (const field of STANDARD_SETTING_FIELDS) {
    const record = completeRecord();
    delete record[field];
    assert.throws(() => build({ standard_setting: record }), new RegExp(`AOS_STANDARD_SETTING_INCOMPLETE.*${field}`, "u"), field);
  }
});

test("a complete standard-setting record is still refused while the validation registry permits no category", () => {
  // Complete is not validated: v0.2.0's registry has no established standard-setting entry and
  // the contract's own standard_setting slot is null, so emission stays contract invalid.
  assert.throws(() => build({ standard_setting: completeRecord() }), /AOS_STANDARD_SETTING_UNREGISTERED/u);
});

test("a record under a different schema id is not a standard-setting record", () => {
  assert.throws(() => build({ standard_setting: { ...completeRecord(), schema_id: "aos-standard-setting.v0" } }), /AOS_STANDARD_SETTING_SCHEMA/u);
  assert.throws(() => build({ standard_setting: "bookmark study" }), /AOS_STANDARD_SETTING_INVALID/u);
});

test("a category handed to the builder without an established standard-setting decision is refused by name", () => {
  for (const [field, value] of [["category", "STRONG"], ["cut_score", 75], ["band", "ROBUST"], ["percentile", 90], ["rank", 1]]) {
    assert.throws(() => build({ [field]: value }), /AOS_CATEGORY_WITHOUT_STANDARD_SETTING/u, field);
  }
});

test("the gate's decision is tri-state: no record establishes nothing rather than refusing or permitting", () => {
  // lib/decision.mjs semantics: null is "the evidence did not establish either answer". No record
  // is null -- the ordinary result. An incomplete record is false -- contradicted. A complete
  // record under this contract stays unestablished, because the registry that could establish it
  // holds no standard-setting entry.
  assert.equal(standardSettingDecision(null, populated), null);
  const incomplete = completeRecord();
  delete incomplete.method;
  assert.equal(standardSettingDecision(incomplete, populated), false);
  assert.equal(standardSettingDecision(completeRecord(), populated), null);
});

test("an explicit null record is the ordinary result, not an attempted emission", () => {
  const result = build({ standard_setting: null, category: null, cut_score: null, percentile: null, rank: null, band: null });
  assert.equal(result.category, null);
  assert.equal(result.standard_setting, null);
});
