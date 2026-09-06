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

// ---------------------------------------------------------------------------------------------
// Exposure ledger

export const EXPOSURE_LEDGER_SCHEMA_ID = "aos-exposure-ledger.v1";
export const EXPOSURE_ENTRY_SCHEMA_ID = "aos-exposure-entry.v1";
export const ADMINISTRATION_CLASSIFICATION_SCHEMA_ID = "aos-administration-classification.v1";

export const createExposureLedger = () => deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries: [] });

/**
 * A stored ledger, or a fresh one when none has ever been written.
 *
 * A ledger that exists but cannot be recognised refuses: reading a corrupt exposure history as an
 * empty one would grant an already-exposed form a second official scoring, which is the exact gate
 * the ledger exists to hold. Absence is different -- a home that never administered anything has
 * no exposure to report, and an empty ledger is that fact, not a guess.
 */
export function openExposureLedger(raw) {
  if (raw === null || raw === undefined) return createExposureLedger();
  if (typeof raw !== "object" || Array.isArray(raw) || raw.schema_id !== EXPOSURE_LEDGER_SCHEMA_ID || !Array.isArray(raw.entries)) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT the stored exposure ledger is not one this release recognises; refusing to read exposure history as empty");
  }
  return deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries: raw.entries.map((entry) => ({ ...entry })) });
}

const priorEntries = (ledger, formContractDigest) => ledger.entries.filter((entry) => entry.form_contract_digest === formContractDigest);

const epochOf = (value) => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Appends one administration to the ledger. Pure: the given ledger is untouched and the new one is
 * returned beside the entry it grew by, so exposure history cannot be edited in place.
 *
 * Every administration is recorded, whatever its class -- a warmup is repeatable, not invisible.
 * The sequence position, the interval since the previous administration and the prior exposure of
 * the same exact form travel on the entry because they are the practice-effect evidence #585
 * requires: without them, repeated improvement and skill improvement are indistinguishable later.
 */
export function recordExposure(ledger, {
  form_id: formId,
  form_contract_digest: formContractDigest,
  declared_class: declaredClass,
  administered_class: administeredClass = null,
  occasion_id: occasionId = null,
  occurred_at: occurredAt,
  run_id: runId = null,
  cycle_id: cycleId = null,
  scored = false,
  score = null,
  duration_ms: durationMs = null
} = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(formId)) throw new Error("AOS_EXPOSURE_FORM_ID an exposure entry names the form that was administered");
  if (!nonEmpty(formContractDigest) || !DIGEST_SHAPE.test(formContractDigest)) {
    throw new Error("AOS_EXPOSURE_FORM_DIGEST an exposure entry pins the exact form contract digest that was administered");
  }
  registryEntry(declaredClass);
  if (administeredClass !== null) registryEntry(administeredClass);
  const occurred = epochOf(occurredAt);
  if (occurred === null) throw new Error("AOS_EXPOSURE_OCCURRED_AT an exposure entry carries the moment it happened as an ISO timestamp");
  const previous = opened.entries.at(-1) ?? null;
  const previousEpoch = previous === null ? null : epochOf(previous.occurred_at);
  const prior = priorEntries(opened, formContractDigest);
  const entry = deepFreeze({
    schema_id: EXPOSURE_ENTRY_SCHEMA_ID,
    form_id: formId,
    form_contract_digest: formContractDigest,
    declared_class: declaredClass,
    administered_class: administeredClass ?? declaredClass,
    occasion_id: occasionId,
    occurred_at: new Date(occurred).toISOString(),
    run_id: runId,
    cycle_id: cycleId,
    scored: scored === true,
    score: typeof score === "number" && Number.isFinite(score) ? score : null,
    duration_ms: typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : null,
    sequence_position: opened.entries.length + 1,
    interval_ms: previousEpoch === null ? null : occurred - previousEpoch,
    prior_exposure_count: prior.length,
    prior_scored_count: prior.filter((row) => row.scored === true).length,
    prior_same_form_id_count: opened.entries.filter((row) => row.form_id === formId).length
  });
  return { ledger: deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries: [...opened.entries, entry] }), entry };
}

/**
 * What this administration is, given the exposure the ledger holds.
 *
 * The scored-once policy lives here: an OPERATIONAL administration of a form the ledger has
 * already seen -- scored or not -- is a PRACTICE administration, whatever the caller intended,
 * because the operator has met the task and the oracle. Warmup, practice and transfer
 * administrations never reach official scoring regardless of exposure.
 *
 * The decision's scope is the ledger's evidence: administrations that predate the ledger are
 * outside what it can testify about, which is a limitation the consumer of a historical record
 * carries, not a licence to refuse history.
 */
export function classifyAdministration(ledger, { form_id: formId, form_contract_digest: formContractDigest, declared_class: declaredClass } = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(formContractDigest) || !DIGEST_SHAPE.test(formContractDigest)) {
    throw new Error("AOS_EXPOSURE_FORM_DIGEST classification is of one exact form contract digest");
  }
  const entry = registryEntry(declaredClass);
  const prior = priorEntries(opened, formContractDigest);
  const priorScored = prior.filter((row) => row.scored === true).length;
  const base = {
    schema_id: ADMINISTRATION_CLASSIFICATION_SCHEMA_ID,
    form_id: formId ?? null,
    form_contract_digest: formContractDigest,
    declared_class: declaredClass,
    prior_exposure_count: prior.length,
    prior_scored_count: priorScored
  };
  if (declaredClass === "WARMUP" || declaredClass === "PRACTICE") {
    return deepFreeze({
      ...base,
      administered_class: declaredClass,
      official_scoring_permitted: false,
      refusal_code: "AOS_FORM_CLASS_UNSCORED",
      reasons: [`AOS_FORM_CLASS_UNSCORED a ${declaredClass} administration is ${entry.exposure_policy} and never official cycle evidence`]
    });
  }
  if (declaredClass === "TRANSFER") {
    return deepFreeze({
      ...base,
      administered_class: declaredClass,
      official_scoring_permitted: false,
      refusal_code: "AOS_FORM_CLASS_LONGITUDINAL",
      reasons: ["AOS_FORM_CLASS_LONGITUDINAL a TRANSFER administration is reported in the longitudinal lane and never enters the core aggregate"]
    });
  }
  if (prior.length > 0) {
    return deepFreeze({
      ...base,
      administered_class: "PRACTICE",
      official_scoring_permitted: false,
      refusal_code: "AOS_FORM_ALREADY_EXPOSED",
      reasons: [`AOS_FORM_ALREADY_EXPOSED this exact form was administered ${prior.length} time(s) before (${priorScored} scored); the scored-once policy makes this run a practice administration, and improvement on it may be memorisation rather than skill`]
    });
  }
  return deepFreeze({ ...base, administered_class: "OPERATIONAL", official_scoring_permitted: true, refusal_code: null, reasons: [] });
}
