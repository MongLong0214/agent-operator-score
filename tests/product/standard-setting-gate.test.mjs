import assert from "node:assert/strict";
import test from "node:test";

import { evaluate } from "../../lib/ecd-contract.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import {
  STANDARD_SETTING_FIELDS, STANDARD_SETTING_SCHEMA_ID, missingStandardSettingFields,
  registryPermitsCategory, standardSettingDecision
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

/**
 * The record shape the issue's contract names, complete in every required field.
 *
 * `cut_scores`, `fairness_invariance_evidence_ids` and `consequence_review` are non-empty here on
 * purpose (#568 round 2): `missingStandardSettingFields` now treats an empty array the same as a
 * missing key for the fields the file's own rationale names as "the study's own account of
 * itself", so a fixture using `[]` for them would no longer be a complete record and every test
 * below that expects `completeRecord()` to pass completeness -- and only fail the registry check
 * that comes after it -- would be exercising the wrong refusal.
 */
const completeRecord = () => ({
  schema_id: STANDARD_SETTING_SCHEMA_ID,
  intended_decision: "local self-diagnosis threshold",
  method: "bookmark",
  panel_or_dataset_digest: `sha256:${"0".repeat(64)}`,
  cut_scores: [{ threshold: 75, band: "STRONG" }],
  classification_consistency: null,
  classification_accuracy: null,
  fairness_invariance_evidence_ids: ["ev-fairness-1"],
  uncertainty_near_cut: null,
  consequence_review: ["no adverse impact found in the sampled subgroups"],
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

test("standardSettingDecision refuses a record under a different schema id on its own, not only behind the gate that wraps it", () => {
  // assertStandardSettingGate already throws AOS_STANDARD_SETTING_SCHEMA before it ever calls
  // standardSettingDecision, so that call site can never exercise this function's own schema_id
  // check -- round 1 found the check survived being replaced with `if (false)` and this suite
  // stayed green. standardSettingDecision is exported and documented as returning false for a
  // record that "contradicts the shape a standard-setting study must have"; a wrong schema id is
  // exactly that, and a caller that reaches this function directly, as this test does, must not
  // read it as the tri-state null a registry-withheld record gets.
  assert.equal(standardSettingDecision({ ...completeRecord(), schema_id: "aos-standard-setting.v0" }, populated), false);
});

test("an explicit null record is the ordinary result, not an attempted emission", () => {
  const result = build({ standard_setting: null, category: null, cut_score: null, percentile: null, rank: null, band: null });
  assert.equal(result.category, null);
  assert.equal(result.standard_setting, null);
});

test("a record whose ten required fields are all present and null is refused, not read as complete", () => {
  // This exact path is unreachable from a real assessment today: `checkEcdContract` refuses a
  // contract whose interpretation_use.standard_setting is anything but null, and the v4 result
  // schema types category, cut_score, percentile, rank and band null-only, so nothing this
  // codebase builds can hand assertStandardSettingGate a contract that would let a record like
  // this one clear registryPermitsCategory. This is not a live witness -- it is here so that
  // `Object.hasOwn`-only completeness (present-but-null counted as filled) cannot come back
  // unnoticed once some future contract opens the path this gate exists to guard.
  const record = { schema_id: STANDARD_SETTING_SCHEMA_ID };
  for (const field of STANDARD_SETTING_FIELDS) record[field] = null;
  assert.throws(() => build({ standard_setting: record }), /AOS_STANDARD_SETTING_INCOMPLETE/u);
});

test("an empty string, array or object is not a considered field, for every field but the three honest ones", () => {
  // #568 round 2. `missingStandardSettingFields` used to check only `=== null || === undefined`,
  // so a record with `cut_scores: []`, `intended_decision: ""` or `consequence_review: {}` reported
  // zero missing fields -- a key with nothing behind it, read as complete. Each of these is a
  // non-honest field (`cut_scores`, `fairness_invariance_evidence_ids`, `consequence_review`, and
  // the four plain-value fields) and each empty value now closes it by itself.
  for (const [field, empty] of [
    ["intended_decision", ""],
    ["method", ""],
    ["panel_or_dataset_digest", ""],
    ["cut_scores", []],
    ["fairness_invariance_evidence_ids", []],
    ["consequence_review", {}],
    ["version", ""]
  ]) {
    const record = { ...completeRecord(), [field]: empty };
    assert.deepEqual(missingStandardSettingFields(record), [field], field);
    assert.throws(() => build({ standard_setting: record }), new RegExp(`AOS_STANDARD_SETTING_INCOMPLETE.*${field}`, "u"), field);
  }
});

test("an empty value is still honest for the three fields an unrun estimate may leave null", () => {
  // The distinction this gate already drew stays: these three fields may be an honest `null`
  // because a study can consider classification consistency, classification accuracy or an
  // uncertainty-near-cut analysis and choose not to compute one. Closing the empty-value gap for
  // every other field must not turn that considered null into a missing field.
  for (const field of ["classification_consistency", "classification_accuracy", "uncertainty_near_cut"]) {
    const record = { ...completeRecord(), [field]: null };
    assert.deepEqual(missingStandardSettingFields(record), []);
  }
});

test("a whitespace-only string and a container whose only member is empty are not a considered field", () => {
  // #568 round 3 NIT 3. `isEmptyValue` closed `""`, `[]` and `{}` one round ago but missed two
  // shapes that name nothing any more than those do: a string of only spaces, and an array whose
  // one element is itself empty (`[null]`) rather than the array being empty outright.
  for (const [field, empty] of [
    ["intended_decision", "   "],
    ["method", "\t\n"],
    ["cut_scores", [null]],
    ["fairness_invariance_evidence_ids", [null]],
    ["consequence_review", [""]]
  ]) {
    const record = { ...completeRecord(), [field]: empty };
    assert.deepEqual(missingStandardSettingFields(record), [field], field);
    assert.throws(() => build({ standard_setting: record }), new RegExp(`AOS_STANDARD_SETTING_INCOMPLETE.*${field}`, "u"), field);
  }
});

test("registryPermitsCategory distinguishes an explicit FAIL from an absent registry entry", () => {
  // #568 round 3 NIT 2. `null` used to answer both "no registry entry for standard-setting exists"
  // and "a registry entry exists and explicitly says FAIL" -- a contradicted decision and an
  // absent one reading alike, this repository's recurring defect. The contract below is
  // synthetic on purpose: v0.2.0's own schema never lets `standard_setting` be anything but
  // `null` (see the "ten required fields ... null" test above for the same reasoning), so this is
  // not a live witness, it is the guard against the day some future contract opens the path.
  const withEntry = (status) => ({
    interpretation_use: {
      standard_setting: { method: "bookmark" },
      validation_registry: [{ category: "standard-setting", status, detail: "a synthetic entry; this category is not in the shipped schema's enum" }]
    }
  });
  const absent = { interpretation_use: { standard_setting: { method: "bookmark" }, validation_registry: [] } };
  assert.equal(registryPermitsCategory(withEntry("ESTABLISHED")), true);
  assert.equal(registryPermitsCategory(withEntry("FAIL")), false);
  assert.equal(registryPermitsCategory(withEntry("UNESTABLISHED")), null);
  assert.equal(registryPermitsCategory(absent), null);
});

test("standardSettingDecision reads a false out of the registry as contradicted, not withheld", () => {
  // Confirms the tri-state composition in `allRequired` (lib/decision.mjs) still does the right
  // thing once `registryPermitsCategory` can itself return `false`: `allRequired([true, false])`
  // is `false` (contradicted), not `null` (withheld), and a caller that reaches this function
  // directly -- as this test does -- must see that distinction rather than the flattened `null`
  // every registry-withheld record already gets from the test above this one.
  const withEntry = (status) => ({
    interpretation_use: {
      standard_setting: { method: "bookmark" },
      validation_registry: [{ category: "standard-setting", status, detail: "a synthetic entry; this category is not in the shipped schema's enum" }]
    }
  });
  assert.equal(standardSettingDecision(completeRecord(), withEntry("ESTABLISHED")), true);
  assert.equal(standardSettingDecision(completeRecord(), withEntry("FAIL")), false);
  assert.equal(standardSettingDecision(completeRecord(), withEntry("UNESTABLISHED")), null);
});
