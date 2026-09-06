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

// ---------------------------------------------------------------------------------------------
// Alternate-form linking
//
// Meaningful variation is a property of one form; equivalence is a claim about two, and nothing
// about generating them differently establishes it. The scaffold below carries every input the
// eventual calibration needs and refuses to decide without them: no empirical linking data leaves
// the decision null and the status UNESTABLISHED, which this release ships and permits.

export const FORM_LINKING_SCHEMA_ID = "aos-form-linking-scaffold.v1";
export const FORM_LIFECYCLE_SCHEMA_ID = "aos-form-lifecycle.v1";

/** The versioned linking method interface: what a real calibration must supply, and its floors. */
export const LINKING_METHOD_INTERFACE = deepFreeze({
  schema_id: "aos-form-linking-method.v1",
  version: "1.0.0",
  minimum_anchor_count: 3,
  minimum_sample_per_form: 20,
  drift_thresholds: { maximum_anchor_delta: 0.1 }
});

const sortedUnique = (values) => [...new Set(values)].sort();

const linkingForm = (form, side) => {
  if (form === null || typeof form !== "object" || !nonEmpty(form.form_contract_digest) || !DIGEST_SHAPE.test(form.form_contract_digest) || !Array.isArray(form.construct_opportunity_ids)) {
    throw new Error(`AOS_LINKING_FORM the ${side} form needs a form_contract_digest and construct_opportunity_ids`);
  }
  return form;
};

/**
 * The linking scaffold for two alternate forms.
 *
 * The decision is a `lib/decision.mjs` tri-state over the empirical evidence: null until a
 * registered method with adequate samples has answered, true only when every anchor's delta sits
 * inside the drift thresholds, false when the anchors drifted beyond them or are not shared at
 * all. A sample below the floor is not a smaller yes -- it stays null with the floor named.
 */
export function linkForms({
  left_form: leftForm,
  right_form: rightForm,
  anchor_ids: anchorIds = [],
  exposure_history: exposureHistory = null,
  task_model_digest: taskModelDigest = null,
  response_patterns: responsePatterns = null,
  drift_thresholds: driftThresholds = LINKING_METHOD_INTERFACE.drift_thresholds
} = {}) {
  const left = linkingForm(leftForm, "left");
  const right = linkingForm(rightForm, "right");
  if (left.form_contract_digest === right.form_contract_digest) {
    throw new Error("AOS_LINKING_SAME_FORM one form is not two; equivalence is a claim about distinct forms");
  }
  const leftCells = new Set(left.construct_opportunity_ids);
  const rightCells = new Set(right.construct_opportunity_ids);
  const coverage = deepFreeze({
    shared: sortedUnique([...leftCells].filter((cell) => rightCells.has(cell))),
    left_only: sortedUnique([...leftCells].filter((cell) => !rightCells.has(cell))),
    right_only: sortedUnique([...rightCells].filter((cell) => !leftCells.has(cell)))
  });

  const missing = [];
  if (!Array.isArray(anchorIds) || anchorIds.length === 0) missing.push("anchor_opportunity_ids");
  if (exposureHistory === null || typeof exposureHistory !== "object") missing.push("exposure_history");
  if (!nonEmpty(taskModelDigest) || !DIGEST_SHAPE.test(taskModelDigest)) missing.push("task_model_digest");
  const method = responsePatterns !== null && typeof responsePatterns === "object" ? responsePatterns : null;
  if (method === null) missing.push("cross_form_response_patterns");
  if (method !== null && (!nonEmpty(method.method) || !nonEmpty(method.method_version))) missing.push("linking_method");

  const reasons = [];
  let decision = null;
  let status = "UNESTABLISHED";
  let driftStatus = "NOT_MONITORED";
  let maximumDelta = null;
  if (missing.length === 0) {
    const anchorsShared = anchorIds.every((anchor) => leftCells.has(anchor) && rightCells.has(anchor));
    const samples = [method.sample_per_form?.left, method.sample_per_form?.right];
    const samplesAdequate = samples.every((count) => Number.isInteger(count) && count >= LINKING_METHOD_INTERFACE.minimum_sample_per_form);
    const deltas = anchorIds.map((anchor) => method.anchor_deltas?.[anchor]);
    const deltasComplete = deltas.every((delta) => typeof delta === "number" && Number.isFinite(delta));
    if (!anchorsShared) {
      // Anchors that do not exist in both forms are not a weak study; they are the linking design
      // failing, and the answer is a contradiction rather than an absence.
      decision = false;
      status = "FAILED";
      reasons.push("AOS_LINKING_ANCHORS_NOT_SHARED an anchor opportunity must be administered by both forms");
    } else if (!samplesAdequate) {
      decision = null;
      reasons.push(`AOS_LINKING_SAMPLE_BELOW_MINIMUM linking needs at least ${LINKING_METHOD_INTERFACE.minimum_sample_per_form} responses per form; a small sample is not a smaller yes`);
    } else if (!deltasComplete) {
      decision = null;
      missing.push("anchor_response_patterns");
    } else {
      maximumDelta = Math.max(...deltas.map((delta) => Math.abs(delta)));
      const threshold = typeof driftThresholds?.maximum_anchor_delta === "number" ? driftThresholds.maximum_anchor_delta : LINKING_METHOD_INTERFACE.drift_thresholds.maximum_anchor_delta;
      if (maximumDelta <= threshold) {
        decision = true;
        status = "LINKED";
        driftStatus = "WITHIN_THRESHOLDS";
      } else {
        decision = false;
        status = "DRIFTED";
        driftStatus = "EXCEEDED";
        reasons.push(`AOS_LINKING_DRIFT anchor delta ${maximumDelta} exceeds the ${threshold} threshold`);
      }
    }
  }
  return deepFreeze({
    schema_id: FORM_LINKING_SCHEMA_ID,
    version: "1.0.0",
    method_interface: LINKING_METHOD_INTERFACE,
    left_form_id: left.form_id ?? null,
    right_form_id: right.form_id ?? null,
    left_form_contract_digest: left.form_contract_digest,
    right_form_contract_digest: right.form_contract_digest,
    anchor_ids: sortedUnique(anchorIds),
    coverage,
    exposure_history: exposureHistory,
    task_model_digest: nonEmpty(taskModelDigest) && DIGEST_SHAPE.test(taskModelDigest) ? taskModelDigest : null,
    linking_method: method === null ? null : { method: method.method ?? null, method_version: method.method_version ?? null },
    equivalence_decision: decision,
    equivalence_status: status,
    // Before calibration says LINKED, nothing built on these two forms may claim past
    // PROFILE_BOUND. Established equivalence imposes no ceiling of its own.
    claim_stage_ceiling: isEstablished(decision) ? null : "PROFILE_BOUND",
    drift: deepFreeze({ thresholds: { ...driftThresholds }, status: driftStatus, maximum_observed_delta: maximumDelta }),
    inputs_missing: sortedUnique(missing),
    reasons
  });
}

/**
 * What the exposure ledger says about one form's remaining life.
 *
 * Under scored-once, any exposure at all retires the form from official use: the operator has met
 * the task and the oracle, and whether that meeting was scored does not un-expose it. Drift and
 * equivalence are quoted from the linking scaffold when one exists and stay at their honest
 * defaults when none does.
 */
export function formLifecycleState(ledger, { form_contract_digest: formContractDigest, linking = null } = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(formContractDigest) || !DIGEST_SHAPE.test(formContractDigest)) {
    throw new Error("AOS_EXPOSURE_FORM_DIGEST lifecycle is of one exact form contract digest");
  }
  const prior = priorEntries(opened, formContractDigest);
  return deepFreeze({
    schema_id: FORM_LIFECYCLE_SCHEMA_ID,
    form_contract_digest: formContractDigest,
    exposure_count: prior.length,
    scored_count: prior.filter((entry) => entry.scored === true).length,
    retirement_status: prior.length === 0 ? "ACTIVE" : "RETIRED_FROM_OFFICIAL_USE",
    drift_status: linking?.drift?.status ?? "NOT_MONITORED",
    equivalence_status: EQUIVALENCE_STATUSES.includes(linking?.equivalence_status) ? linking.equivalence_status : "UNESTABLISHED"
  });
}
