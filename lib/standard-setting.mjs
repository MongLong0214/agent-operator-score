import { allRequired, isEstablished } from "./decision.mjs";

// #568's standard-setting gate.
//
// A category, cut score, band, percentile or rank is a verdict about a person, and this product
// may only ever issue one behind a registered standard-setting study: an aos-standard-setting.v1
// record complete in every required field, under a contract whose validation registry permits
// category emission. v0.2.0's registry permits none and the aos-result.v4 schema types every one
// of these fields null, so today the gate can only refuse -- but it refuses by name, at the
// issuing boundary, instead of silently dropping what the caller handed in. A silent drop reads
// as "issued and stored null" when the truth is "refused", and the difference is exactly what an
// operator debugging a missing category needs.

export const STANDARD_SETTING_SCHEMA_ID = "aos-standard-setting.v1";

/**
 * The fields a standard-setting record cannot be evaluated without. A key that is absent was
 * never considered, and a study that never considered its consequence review is not a study this
 * gate can weigh.
 */
export const STANDARD_SETTING_FIELDS = Object.freeze([
  "intended_decision", "method", "panel_or_dataset_digest", "cut_scores",
  "classification_consistency", "classification_accuracy",
  "fairness_invariance_evidence_ids", "uncertainty_near_cut",
  "consequence_review", "version"
]);

// Three fields may hold an honest null: an estimate a study chose not to compute -- classification
// consistency or accuracy nobody has run yet, or an uncertainty-near-cut analysis the panel judged
// unnecessary -- is still a field the study considered, recorded as "not estimated" rather than
// left out. Every other field would be indistinguishable from a study that never happened if null
// meant the same thing there: a decision statement, a method, a panel, cut scores, a fairness
// evidence list, a consequence review and a version are the study's own account of itself, and
// `null` in any one of them is not a considered absence, it is the absence of the study.
const FIELDS_WHERE_NULL_IS_HONEST = new Set(["classification_consistency", "classification_accuracy", "uncertainty_near_cut"]);

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * An empty string, array or object: present in the sense `Object.hasOwn` checks, but saying
 * nothing.
 *
 * #568 round 3 NIT. A whitespace-only string passed the old `value === ""` check -- `"   "` is not
 * `===` to `""` -- so `intended_decision: "   "` read as a considered field, the same hole `""`
 * itself was closed for one round earlier. `.trim()` closes it the same way for every string
 * field this gate checks. An array whose only member is itself empty (`[null]`, or `[""]`) had the
 * same hole one level down: `.length === 0` is true only for the empty array itself, so a cut-score
 * or evidence-id list carrying one `null` and nothing else was not empty by that count, though it
 * names nothing any more than `[]` does. `.every` over a recursive call closes it for an array
 * nested arbitrarily deep, not only for the one shape named in the issue.
 */
const isEmptyValue = (value) => {
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.every((item) => item === null || item === undefined || isEmptyValue(item));
  return isPlainObject(value) && Object.keys(value).length === 0;
};

/**
 * The required keys the record does not carry, or does carry with no real value.
 *
 * `Object.hasOwn` alone answers key presence, not whether the record says anything: a record
 * with all ten fields present and every one of them `null` reported zero missing fields and
 * passed completeness, which is this repository's recurring defect -- absence scored as a value
 * -- sitting inside the one gate written to refuse a category with no study behind it. This path
 * is unreachable today (`checkEcdContract` refuses a non-null `standard_setting` slot and the v4
 * schema types every category field null-only), but the defect class is cheap to close and this
 * repository tracks it everywhere else, so it is closed here too rather than left for whichever
 * future issue opens the path.
 *
 * The same defect survives a value that is present and not null: cut scores, a fairness evidence
 * list or a consequence review recorded as `[]` -- or a decision statement or panel digest
 * recorded as `""` -- is a key with nothing behind it, indistinguishable from a study that never
 * produced one once only `null` is checked for. Closing that does not touch the one honest use of
 * `null` this gate already has: an estimate a study chose not to compute is still recorded as
 * `null`, never as an empty string or an empty collection, so the `FIELDS_WHERE_NULL_IS_HONEST`
 * check runs first and only a genuinely present, non-empty value can close the other fields.
 */
export const missingStandardSettingFields = (record) =>
  STANDARD_SETTING_FIELDS.filter((field) => {
    if (!isPlainObject(record) || !Object.hasOwn(record, field)) return true;
    const value = record[field];
    if (value === null || value === undefined) return !FIELDS_WHERE_NULL_IS_HONEST.has(field);
    return isEmptyValue(value);
  });

/**
 * Whether the contract's validation registry permits category emission.
 *
 * `true` only from positive evidence: the contract carries a standard-setting slot somebody
 * filled and a registry entry for standard setting whose status is ESTABLISHED. Anything less is
 * `null` -- absence never opens a gate -- and every v0.2.0 contract that passes its own checks
 * is in that state, because `checkEcdContract` refuses a non-null standard_setting slot outright.
 *
 * #568 round 3 NIT. `null` used to answer for two different facts: no registry entry for
 * standard-setting exists at all, and a registry entry exists and explicitly says `FAIL` -- the
 * panel considered the category and refused it. Those are not the same evidence. A missing entry
 * is silence; a `FAIL` entry is this repository's own three-state vocabulary for a contradicted
 * decision (see `lib/decision.mjs`), and collapsing it into the same `null` an absent entry gets
 * is this repository's recurring defect, sitting inside the one gate written to catch exactly
 * that class of mistake for the field it guards. `false` now says what a `FAIL` entry says; `null`
 * stays for an absent entry or a status that is genuinely still open (`UNESTABLISHED`).
 */
export function registryPermitsCategory(contract) {
  const use = contract?.interpretation_use;
  if (!isPlainObject(use)) return null;
  if (use.standard_setting === null || use.standard_setting === undefined) return null;
  const entries = Array.isArray(use.validation_registry) ? use.validation_registry : [];
  const entry = entries.find((one) => one?.category === "standard-setting");
  if (entry === undefined) return null;
  if (entry.status === "ESTABLISHED") return true;
  if (entry.status === "FAIL") return false;
  return null;
}

/**
 * The tri-state decision (lib/decision.mjs): `null` when no record was offered -- the ordinary
 * result, nothing claimed and nothing refused; `false` when a record was offered and contradicts
 * the shape a standard-setting study must have; otherwise the conjunction of the record's
 * completeness with the registry's allowance, which under every current contract is `null`.
 */
export function standardSettingDecision(record, contract) {
  if (record === null || record === undefined) return null;
  if (!isPlainObject(record) || record.schema_id !== STANDARD_SETTING_SCHEMA_ID) return false;
  if (missingStandardSettingFields(record).length > 0) return false;
  return allRequired([true, registryPermitsCategory(contract)]);
}

/**
 * The gate itself, called by `buildResult` before anything is published.
 *
 * Refuses, by name, every attempted category emission the decision above does not establish, and
 * returns the decision so the caller can carry it. The field list is checked before the registry
 * because "which field is missing" is the answer an operator can act on; "the registry does not
 * permit this" is the answer when the record itself was whole.
 */
export function assertStandardSettingGate({ standard_setting: record = null, category = null, cut_score: cutScore = null, percentile = null, rank = null, band = null } = {}, contract) {
  if (record !== null && record !== undefined) {
    if (!isPlainObject(record)) {
      throw new Error("AOS_STANDARD_SETTING_INVALID a standard-setting record is an object, and nothing else stands in for one");
    }
    if (record.schema_id !== STANDARD_SETTING_SCHEMA_ID) {
      throw new Error(`AOS_STANDARD_SETTING_SCHEMA ${JSON.stringify(record.schema_id ?? null)} is not ${STANDARD_SETTING_SCHEMA_ID}; a record of another instrument cannot authorise a category`);
    }
    const missing = missingStandardSettingFields(record);
    if (missing.length > 0) {
      throw new Error(`AOS_STANDARD_SETTING_INCOMPLETE the record does not carry ${missing.join(", ")}; category emission is contract invalid without every required field`);
    }
    if (!isEstablished(standardSettingDecision(record, contract))) {
      throw new Error("AOS_STANDARD_SETTING_UNREGISTERED the validation registry permits no category emission, so a complete record still cannot issue one; category emission is contract invalid until a registered standard-setting study establishes it");
    }
  }
  const decision = standardSettingDecision(record, contract);
  const claimed = Object.entries({ category, cut_score: cutScore, percentile, rank, band })
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([field]) => field);
  if (claimed.length > 0 && !isEstablished(decision)) {
    throw new Error(`AOS_CATEGORY_WITHOUT_STANDARD_SETTING ${claimed.join(", ")} cannot be emitted: no established standard-setting decision covers this result`);
  }
  return decision;
}
