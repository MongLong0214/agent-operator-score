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
 * The fields a standard-setting record cannot be evaluated without. A field may hold an honest
 * null -- classification consistency nobody has estimated yet -- but it has to be there: a key
 * that is absent was never considered, and a study that never considered its consequence review
 * is not a study this gate can weigh.
 */
export const STANDARD_SETTING_FIELDS = Object.freeze([
  "intended_decision", "method", "panel_or_dataset_digest", "cut_scores",
  "classification_consistency", "classification_accuracy",
  "fairness_invariance_evidence_ids", "uncertainty_near_cut",
  "consequence_review", "version"
]);

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** The required keys the record does not carry. Null values are present; absent keys are not. */
export const missingStandardSettingFields = (record) =>
  STANDARD_SETTING_FIELDS.filter((field) => !isPlainObject(record) || !Object.hasOwn(record, field));

/**
 * Whether the contract's validation registry permits category emission.
 *
 * `true` only from positive evidence: the contract carries a standard-setting slot somebody
 * filled and a registry entry for standard setting whose status is ESTABLISHED. Anything less is
 * `null` -- absence never opens a gate -- and every v0.2.0 contract that passes its own checks
 * is in that state, because `checkEcdContract` refuses a non-null standard_setting slot outright.
 */
export function registryPermitsCategory(contract) {
  const use = contract?.interpretation_use;
  if (!isPlainObject(use)) return null;
  if (use.standard_setting === null || use.standard_setting === undefined) return null;
  const entries = Array.isArray(use.validation_registry) ? use.validation_registry : [];
  const entry = entries.find((one) => one?.category === "standard-setting");
  if (entry === undefined) return null;
  return entry.status === "ESTABLISHED" ? true : null;
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
