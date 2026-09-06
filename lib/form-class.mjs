// #585. Form classes, exposure, practice, transfer and invariance.
//
// The four sentences this module exists to make structural rather than aspirational:
//
//   different seed        ≠ equivalent form
//   repeated improvement  ≠ skill improvement
//   collaborative success ≠ independent transfer
//   translation           ≠ invariance
//
// Decisions here are `lib/decision.mjs` tri-states: true established, false contradicted, null
// not established by the available evidence. Domain words (UNESTABLISHED, WITHHELD, LINKED, and
// so on) stand beside those values and explain them; they are never a second decision vocabulary.

import { allRequired, isEstablished } from "./decision.mjs";

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export const FORM_BANK_RECORD_SCHEMA_ID = "aos-form-bank-record.v1";

const DIGEST_SHAPE = /^sha256:[0-9a-f]{64}$/u;
const nonEmpty = (value) => typeof value === "string" && value.length > 0;

// ---------------------------------------------------------------------------------------------
// Form classes

export const FORM_CLASSES = Object.freeze(["WARMUP", "PRACTICE", "OPERATIONAL", "TRANSFER"]);
export const EXPOSURE_POLICIES = Object.freeze(["unscored-repeatable", "scored-once", "research-only"]);
export const EQUIVALENCE_STATUSES = Object.freeze(["UNESTABLISHED", "LINKED", "DRIFTED", "FAILED"]);

/**
 * The machine-readable registry. A consumer asks the field, not a comment: whether a class is
 * scored, whether it may reach an official cycle aggregate, whether it may be repeated, and what
 * its exposure policy is. The registry owns these answers -- a stored form record that contradicts
 * its own class is refused where the record is built, because an artifact that authorizes itself
 * is how a warmup ends up in an official aggregate.
 */
export const FORM_CLASS_REGISTRY = deepFreeze({
  WARMUP: {
    class_id: "WARMUP",
    scored: false,
    official_cycle_eligible: false,
    repeatable: true,
    exposure_policy: "unscored-repeatable",
    lane: "protocol-learning",
    definition: "Administered to settle the operator into the interface. Never scored, never linked."
  },
  PRACTICE: {
    class_id: "PRACTICE",
    scored: false,
    official_cycle_eligible: false,
    repeatable: true,
    exposure_policy: "unscored-repeatable",
    lane: "practice",
    definition: "Administered to expose the form. Never scored into an operational estimate."
  },
  OPERATIONAL: {
    class_id: "OPERATIONAL",
    scored: true,
    official_cycle_eligible: true,
    repeatable: false,
    exposure_policy: "scored-once",
    lane: "official",
    definition: "Scored once per operator, form and version, and tracked in the exposure ledger."
  },
  TRANSFER: {
    class_id: "TRANSFER",
    scored: false,
    official_cycle_eligible: false,
    repeatable: false,
    exposure_policy: "research-only",
    lane: "longitudinal",
    definition: "Administered without the agent and without the transcript. Reported in the longitudinal lane only."
  }
});

const registryEntry = (formClass) => {
  const entry = FORM_CLASS_REGISTRY[formClass];
  if (entry === undefined) throw new Error(`AOS_FORM_CLASS_UNKNOWN ${String(formClass)} is not one of ${FORM_CLASSES.join(", ")}`);
  return entry;
};

/**
 * One form bank record.
 *
 * `exposure_policy` is derived from the class and a contradicting declaration is refused;
 * `equivalence_status` is derived from linking evidence and a caller's own claim about it is
 * ignored. Both rules exist because the alternative is a stored artifact that authorizes itself.
 */
export function formBankRecord({
  form_id: formId,
  form_class: formClass,
  construct_opportunity_ids: constructOpportunityIds,
  difficulty_features: difficultyFeatures = null,
  anchor_ids: anchorIds = [],
  language = null,
  interface: interfaceName = null,
  model_profile_class: modelProfileClass = null,
  oracle_digest: oracleDigest,
  exposure_policy: declaredPolicy = null,
  linking = null
} = {}) {
  if (!nonEmpty(formId)) throw new Error("AOS_FORM_ID_REQUIRED a form bank record names the form it describes");
  const entry = registryEntry(formClass);
  if (declaredPolicy !== null && declaredPolicy !== entry.exposure_policy) {
    throw new Error(`AOS_FORM_POLICY_CONTRADICTION a ${formClass} form's exposure policy is ${entry.exposure_policy}; the registry owns that answer, not the record`);
  }
  if (!nonEmpty(oracleDigest) || !DIGEST_SHAPE.test(oracleDigest)) {
    throw new Error("AOS_FORM_ORACLE_DIGEST a form bank record carries the digest of its oracle, never the oracle itself");
  }
  if (!Array.isArray(constructOpportunityIds)) throw new Error("AOS_FORM_OPPORTUNITIES construct_opportunity_ids must be an array");
  if (!Array.isArray(anchorIds)) throw new Error("AOS_FORM_ANCHORS anchor_ids must be an array");
  return deepFreeze({
    schema_id: FORM_BANK_RECORD_SCHEMA_ID,
    form_id: formId,
    form_class: formClass,
    construct_opportunity_ids: [...constructOpportunityIds],
    difficulty_features: difficultyFeatures,
    anchor_ids: [...anchorIds],
    language,
    interface: interfaceName,
    model_profile_class: modelProfileClass,
    oracle_digest: oracleDigest,
    exposure_policy: entry.exposure_policy,
    // Derived: UNESTABLISHED until a linking scaffold with empirical evidence says otherwise, and
    // then exactly what the scaffold said. A caller-supplied status is not an input on purpose.
    equivalence_status: linking !== null && EQUIVALENCE_STATUSES.includes(linking.equivalence_status)
      ? linking.equivalence_status
      : "UNESTABLISHED"
  });
}
