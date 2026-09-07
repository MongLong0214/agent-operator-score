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
import { isRealInstant } from "./execution-plan.mjs";

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
    // The schema_id tag alone is forgeable by any caller who writes it into a plain object --
    // `{schema_id: FORM_LINKING_SCHEMA_ID, equivalence_status: "LINKED"}` has no decision, no
    // empirical inputs and no relation to this form, and used to be accepted anyway. So a scaffold
    // is quoted only when it actually reached a decision (`equivalence_decision` is `true` or
    // `false`, never the absent/`null` a caller can leave unset), carries no missing input
    // (`inputs_missing` empty -- the same fact the decision not being null already implies for a
    // real `linkForms` scaffold, checked directly rather than trusted), and names this exact form
    // as one of the two sides it compared.
    equivalence_status: linking !== null &&
      linking.schema_id === FORM_LINKING_SCHEMA_ID &&
      typeof linking.equivalence_decision === "boolean" &&
      Array.isArray(linking.inputs_missing) && linking.inputs_missing.length === 0 &&
      EQUIVALENCE_STATUSES.includes(linking.equivalence_status) &&
      (linking.left_form_id === formId || linking.right_form_id === formId)
      ? linking.equivalence_status
      : "UNESTABLISHED"
  });
}

// ---------------------------------------------------------------------------------------------
// Exposure ledger

export const EXPOSURE_LEDGER_SCHEMA_ID = "aos-exposure-ledger.v1";
export const EXPOSURE_ENTRY_SCHEMA_ID = "aos-exposure-entry.v1";
// #585 round 2 (reservation-before-reveal). A second entry schema rather than a v1 revision in
// place, because the RESERVED -> REVEALED -> TERMINAL state machine adds three REQUIRED fields
// (`state`, `content_revealed`, `administration_id`) that no entry ever written before this round
// carries. Requiring them on every stored entry would make every historical ledger
// AOS_EXPOSURE_ENTRY_CORRUPT on its first read after an upgrade -- refusing a shape change that
// broke nothing about what those old entries actually recorded, which is the exact overclaim this
// file's own refusal exists to avoid for genuine corruption. `openExposureLedger` accepts both tags;
// a v1 entry is what round-2 directive item 5 calls a completed historical administration and is
// never read as an active reservation, whatever it lacks.
export const EXPOSURE_ENTRY_SCHEMA_ID_V2 = "aos-exposure-entry.v2";
export const EXPOSURE_STATES = Object.freeze(["RESERVED", "REVEALED", "TERMINAL"]);
export const ADMINISTRATION_CLASSIFICATION_SCHEMA_ID = "aos-administration-classification.v1";

export const createExposureLedger = () => deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries: [] });

/**
 * A stored ledger, or a fresh one when none has ever been written.
 *
 * A ledger that exists but cannot be recognised refuses: reading a corrupt exposure history as an
 * empty one would grant an already-exposed form a second official scoring, which is the exact gate
 * the ledger exists to hold. Absence is different -- a home that never administered anything has
 * no exposure to report, and an empty ledger is that fact, not a guess.
 *
 * `undefined` is that absence -- no ledger file exists. `null` is not: a file that exists and holds
 * the JSON literal `null` is a stored ledger this release cannot recognise, the same as any other
 * shape below, and reading it as fresh would score 0 prior exposures for a home that may have
 * administered plenty before something wrote `null` over the record of it.
 */
export function openExposureLedger(raw) {
  if (raw === undefined) return createExposureLedger();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || raw.schema_id !== EXPOSURE_LEDGER_SCHEMA_ID || !Array.isArray(raw.entries)) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT the stored exposure ledger is not one this release recognises; refusing to read exposure history as empty");
  }
  // `priorEntries` decides the scored-once policy by filtering on `form_contract_digest`; a row
  // that lost or malformed that field would silently fall out of every such filter and read as a
  // form that was never administered -- the exact gap `classifyAdministration` and
  // `formLifecycleState` exist to close. An unreadable exposure is not the absence of one, so a
  // row that does not carry a recognised entry schema tag and a well-formed digest refuses the
  // whole ledger rather than being dropped and silently counted as zero exposure.
  for (const entry of raw.entries) {
    if (entry === null || typeof entry !== "object" || !isRecognisedExposureEntry(entry) ||
        !nonEmpty(entry.form_contract_digest) || !DIGEST_SHAPE.test(entry.form_contract_digest)) {
      throw new Error("AOS_EXPOSURE_ENTRY_CORRUPT a stored exposure entry is not one this release recognises; refusing to read it as no exposure");
    }
  }
  return deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries: raw.entries.map((entry) => ({ ...entry })) });
}

// #585 round 2. A v1 entry (or a v2 entry carrying none of the reservation fields, which
// `recordExposure`'s direct-append path still writes for a one-shot administration outside the
// state machine) is the pre-reservation shape: a completed historical administration, never an
// active reservation, whatever it lacks -- round-2 directive item 5, by name. A v2 entry that does
// declare the state machine has to carry all three of its required fields well-formed, or it is
// exactly as unreadable as a row with no digest: a `state` outside the three real words, a
// non-boolean `content_revealed`, or a missing `administration_id` would silently defeat the
// RESERVED/REVEALED lookups `markRevealed` and `recordExposure` key on.
const isRecognisedExposureEntry = (entry) => {
  if (entry.schema_id === EXPOSURE_ENTRY_SCHEMA_ID) return true;
  if (entry.schema_id !== EXPOSURE_ENTRY_SCHEMA_ID_V2) return false;
  return EXPOSURE_STATES.includes(entry.state) && typeof entry.content_revealed === "boolean" && nonEmpty(entry.administration_id);
};

const priorEntries = (ledger, formContractDigest) => ledger.entries.filter((entry) => entry.form_contract_digest === formContractDigest);

// Shape and calendar, not Date.parse: "0" parses and 2026-02-30 rolls into March, and a ledger
// whose intervals rest on rolled-over instants is practice-effect evidence about nothing.
const epochOf = (value) => (isRealInstant(value) ? new Date(value).getTime() : null);

/**
 * Reserves ledger space for one administration before anything about it is shown to the agent.
 *
 * #585 round 2, governing directive I2: a reservation must be durable BEFORE content reveal. Every
 * fact that fixes this administration's place in the ledger's own history -- `sequence_position`,
 * `interval_ms`, the three `prior_*` counts -- is computed here, against the ledger as it stood the
 * instant the reservation was made, and carried unchanged through `markRevealed` and
 * `recordExposure`'s later in-place update. Recomputing any of them at finalize time would answer a
 * different question ("where does this administration sit now" instead of "where did it sit when it
 * began"), one that can move under it if anything else writes the ledger in between.
 */
export function reserveExposure(ledger, {
  form_id: formId,
  form_contract_digest: formContractDigest,
  declared_class: declaredClass,
  administration_id: administrationId,
  run_id: runId = null,
  occurred_at: occurredAt
} = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(formId)) throw new Error("AOS_EXPOSURE_FORM_ID an exposure entry names the form that was administered");
  if (!nonEmpty(formContractDigest) || !DIGEST_SHAPE.test(formContractDigest)) {
    throw new Error("AOS_EXPOSURE_FORM_DIGEST an exposure entry pins the exact form contract digest that was administered");
  }
  registryEntry(declaredClass);
  if (!nonEmpty(administrationId)) throw new Error("AOS_EXPOSURE_ADMINISTRATION_ID a reservation names the administration it is reserved for");
  // A reused id would let `markRevealed` and `recordExposure`'s update path silently transition the
  // wrong row -- whichever one `findIndex` meets first -- so a second reservation under an id that
  // already has a ledger row is refused rather than accepted as a second write to the same one.
  if (opened.entries.some((row) => row.administration_id === administrationId)) {
    throw new Error(`AOS_EXPOSURE_ADMINISTRATION_ID_REUSED administration ${administrationId} already has a ledger entry; an administration id is reserved exactly once`);
  }
  const occurred = epochOf(occurredAt);
  if (occurred === null) throw new Error("AOS_EXPOSURE_OCCURRED_AT an exposure entry carries the moment it happened as an ISO timestamp");
  const previous = opened.entries.at(-1) ?? null;
  const previousEpoch = previous === null ? null : epochOf(previous.occurred_at);
  const prior = priorEntries(opened, formContractDigest);
  const entry = deepFreeze({
    schema_id: EXPOSURE_ENTRY_SCHEMA_ID_V2,
    administration_id: administrationId,
    state: "RESERVED",
    content_revealed: false,
    form_id: formId,
    form_contract_digest: formContractDigest,
    declared_class: declaredClass,
    administered_class: null,
    occasion_id: null,
    occurred_at: new Date(occurred).toISOString(),
    revealed_at: null,
    terminal_at: null,
    run_id: runId,
    cycle_id: null,
    scored: false,
    score: null,
    duration_ms: null,
    sequence_position: opened.entries.length + 1,
    interval_ms: previousEpoch === null ? null : occurred - previousEpoch,
    prior_exposure_count: prior.length,
    prior_scored_count: prior.filter((row) => row.scored === true).length,
    prior_same_form_id_count: opened.entries.filter((row) => row.form_id === formId).length
  });
  return { ledger: deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries: [...opened.entries, entry] }), entry };
}

/**
 * Transitions a reservation to REVEALED, durably, the instant the scenario it reserved is actually
 * materialized into the agent-visible workspace.
 *
 * #585 round 2, governing directive I3: once the task is visible, `content_revealed=true` must be
 * durable -- not summarised later, and not held in memory across the agent invocation that follows.
 * The caller takes the exposure-ledger lock, calls this, writes the result and releases the lock,
 * all before the agent runs; nothing here holds anything open past its own return.
 */
export function markRevealed(ledger, { administration_id: administrationId, occurred_at: occurredAt = new Date().toISOString() } = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(administrationId)) throw new Error("AOS_EXPOSURE_ADMINISTRATION_ID a reveal names the administration it reveals");
  const index = opened.entries.findIndex((row) => row.administration_id === administrationId);
  if (index === -1) {
    throw new Error(`AOS_EXPOSURE_RESERVATION_NOT_FOUND no reserved exposure entry exists for administration ${administrationId}; content cannot be marked revealed without a durable reservation first`);
  }
  const reserved = opened.entries[index];
  if (reserved.state !== "RESERVED") {
    throw new Error(`AOS_EXPOSURE_RESERVATION_STATE administration ${administrationId} is ${reserved.state}, not RESERVED; it cannot be revealed twice`);
  }
  const occurred = epochOf(occurredAt);
  if (occurred === null) throw new Error("AOS_EXPOSURE_OCCURRED_AT a reveal carries the moment it happened as an ISO timestamp");
  const entry = deepFreeze({ ...reserved, state: "REVEALED", content_revealed: true, revealed_at: new Date(occurred).toISOString() });
  const entries = [...opened.entries];
  entries[index] = entry;
  return { ledger: deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries }), entry };
}

/**
 * Appends one administration to the ledger, or -- when `administration_id` names a reservation this
 * ledger already holds -- transitions that exact reservation to TERMINAL in place. Pure either way:
 * the given ledger is untouched and the new one is returned beside the entry it grew or changed, so
 * exposure history cannot be edited in place from underneath a caller still holding the old one.
 *
 * Every administration is recorded, whatever its class -- a warmup is repeatable, not invisible.
 * The sequence position, the interval since the previous administration and the prior exposure of
 * the same exact form travel on the entry because they are the practice-effect evidence #585
 * requires: without them, repeated improvement and skill improvement are indistinguishable later.
 *
 * #585 round 2: a run that reserved before revealing must finalize onto that same row, or RESERVE
 * plus TERMINAL would leave two entries on the ledger for one administration -- exactly the
 * double-counting the reservation exists to prevent, reproduced by the mechanism meant to close it.
 * `administration_id` is that key; a caller with no reservation (a direct, one-shot record of a
 * historical or test-built administration) omits it and gets the original bare-append behaviour.
 */
export function recordExposure(ledger, {
  form_id: formId,
  form_contract_digest: formContractDigest,
  declared_class: declaredClass,
  administered_class: administeredClass = null,
  administration_id: administrationId = null,
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
  if (administrationId !== null) {
    const index = opened.entries.findIndex((row) => row.administration_id === administrationId);
    if (index === -1) {
      throw new Error(`AOS_EXPOSURE_RESERVATION_NOT_FOUND no reserved exposure entry exists for administration ${administrationId}; a terminal transition updates a reservation and cannot invent one`);
    }
    const reserved = opened.entries[index];
    if (reserved.form_contract_digest !== formContractDigest) {
      throw new Error(`AOS_EXPOSURE_DIGEST_MISMATCH administration ${administrationId} was reserved for a different form_contract_digest; a terminal transition cannot change which form it administered`);
    }
    if (reserved.state === "TERMINAL") {
      throw new Error(`AOS_EXPOSURE_ALREADY_TERMINAL administration ${administrationId} already reached a terminal exposure entry; recordExposure updates a reservation exactly once`);
    }
    const entry = deepFreeze({
      ...reserved,
      state: "TERMINAL",
      content_revealed: true,
      administered_class: administeredClass ?? declaredClass,
      occasion_id: occasionId,
      run_id: runId ?? reserved.run_id,
      cycle_id: cycleId,
      scored: scored === true,
      score: typeof score === "number" && Number.isFinite(score) ? score : null,
      duration_ms: typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : null,
      terminal_at: new Date(occurred).toISOString()
    });
    const entries = [...opened.entries];
    entries[index] = entry;
    return { ledger: deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID, entries }), entry };
  }
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
export function classifyAdministration(ledger, { form_id: formId, form_contract_digest: formContractDigest, declared_class: declaredClass, administration_id: administrationId = null } = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(formContractDigest) || !DIGEST_SHAPE.test(formContractDigest)) {
    throw new Error("AOS_EXPOSURE_FORM_DIGEST classification is of one exact form contract digest");
  }
  const entry = registryEntry(declaredClass);
  // #585 round 2. Excludes this exact administration's own row: `assess` now reserves before it
  // classifies, so by the time its own finalize step asks this question the ledger already holds a
  // RESERVED or REVEALED entry for the administration being classified. Without this exclusion every
  // administration would read its own reservation back as prior exposure of itself.
  const prior = priorEntries(opened, formContractDigest).filter((row) => administrationId === null || row.administration_id !== administrationId);
  const priorScored = prior.filter((row) => row.scored === true).length;
  // #585 round 2, governing directive I4: an administration that reached RESERVED or REVEALED and
  // never TERMINAL is exposure a crash cannot erase -- the agent may already have seen the form. A
  // `state` absent entirely is round-2 directive item 5's pre-reservation shape, a completed
  // historical administration rather than an active one, so only a row actually mid-transition
  // counts here.
  const unresolved = prior.filter((row) => row.state === "RESERVED" || row.state === "REVEALED");
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
  if (unresolved.length > 0) {
    return deepFreeze({
      ...base,
      administered_class: "PRACTICE",
      official_scoring_permitted: false,
      refusal_code: "AOS_FORM_EXPOSED_WITHOUT_TERMINAL",
      reasons: [`AOS_FORM_EXPOSED_WITHOUT_TERMINAL this exact form was revealed by administration ${unresolved.at(-1).administration_id} and never reached a terminal exposure entry; a form already shown to the agent cannot be treated as fresh, whatever became of the administration that revealed it`]
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
  // The method declares its own floor (`minimum_anchor_count`); checking only for `=== 0` let one
  // anchor -- fewer than the method itself requires -- read as a complete anchor set and reach
  // LINKED, removing the claim-stage ceiling on evidence the declared method never certified as
  // enough. Reading the floor from the declaration rather than repeating it as a second literal is
  // what keeps the two from drifting apart the way this guard just did.
  if (!Array.isArray(anchorIds) || anchorIds.length < LINKING_METHOD_INTERFACE.minimum_anchor_count) missing.push("anchor_opportunity_ids");
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

// ---------------------------------------------------------------------------------------------
// Practice and occasion effects

export const PRACTICE_ANALYSIS_SCHEMA_ID = "aos-practice-analysis.v1";
export const SCORE_CHANGE_CLAIM_SCHEMA_ID = "aos-score-change-claim.v1";

/**
 * What the exposure ledger can say about practice effects on one exact form.
 *
 * Everything here is derived from recorded administrations. The three indicators are tri-states:
 * a form never administered has nothing to analyse (null throughout), and an indicator whose
 * inputs were not recorded -- no scores, no durations -- is unobserved rather than absent.
 * Contamination excludes the form from generalizability evidence with each reason named, because
 * an unexplained exclusion is the kind a consumer works around.
 */
export function practiceAnalysis(ledger, { form_contract_digest: formContractDigest } = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(formContractDigest) || !DIGEST_SHAPE.test(formContractDigest)) {
    throw new Error("AOS_EXPOSURE_FORM_DIGEST practice analysis is of one exact form contract digest");
  }
  const rows = priorEntries(opened, formContractDigest);
  const administrations = rows.map((entry) => ({
    sequence_position: entry.sequence_position,
    interval_ms: entry.interval_ms,
    administered_class: entry.administered_class,
    scored: entry.scored,
    score: entry.score,
    duration_ms: entry.duration_ms
  }));
  const scoredRows = rows.filter((entry) => typeof entry.score === "number");
  const timedRows = rows.filter((entry) => typeof entry.score === "number" && typeof entry.duration_ms === "number");
  const memorization = scoredRows.length < 2 ? null : scoredRows.at(-1).score > scoredRows[0].score;
  const speedOnly = timedRows.length < 2
    ? null
    : timedRows.at(-1).duration_ms < timedRows[0].duration_ms && timedRows.at(-1).score <= timedRows[0].score;
  const contaminated = rows.length === 0 ? null : rows.some((entry) => entry.prior_exposure_count > 0);
  const reasons = [];
  if (contaminated === true) {
    reasons.push(`AOS_PRACTICE_SAME_FORM_REEXPOSURE this exact form was administered ${rows.length} times; every administration after the first measures familiarity as well as skill`);
    if (memorization === true) reasons.push("AOS_PRACTICE_MEMORIZATION_SUSPECTED the score rose across administrations of one form; repeated improvement is not skill improvement");
    if (speedOnly === true) reasons.push("AOS_PRACTICE_SPEED_ONLY the later administration was faster without scoring higher; speed on a familiar form is familiarity");
  }
  return deepFreeze({
    schema_id: PRACTICE_ANALYSIS_SCHEMA_ID,
    form_contract_digest: formContractDigest,
    administrations,
    same_form_exposure_count: rows.length,
    similar_form_exposure_count: rows.length === 0 ? 0 : opened.entries.filter((entry) => entry.form_id === rows[0].form_id && entry.form_contract_digest !== formContractDigest).length,
    // How many times the operator had already met this exact oracle when the last administration
    // began: the prior-exposure count of the final entry, not the total.
    oracle_familiarity_count: rows.length === 0 ? 0 : rows.at(-1).prior_exposure_count,
    speed_only_improvement: speedOnly,
    memorization_indicator: memorization,
    practice_contaminated: contaminated,
    generalizability_evidence_eligible: contaminated === null ? null : !contaminated,
    exclusion_reasons: reasons
  });
}

/**
 * The only interpretation a raw score change is entitled to.
 *
 * A rise on the same form is not interpretable as measurement at all -- the second administration
 * measured recall of the first, so the change is contradicted as evidence and marked for what it
 * suggests. A rise across two forms whose equivalence nobody established is withheld, not made
 * with a caveat: an easier form explains it exactly as well as skill does. Only a linking record
 * for these two exact forms puts the scores on one scale, and even then what is claimed is an
 * observed change, never an automatic learning claim.
 */
export function scoreChangeClaim({ earlier, later, linking = null } = {}) {
  for (const [name, side] of [["earlier", earlier], ["later", later]]) {
    if (side === null || typeof side !== "object" || !nonEmpty(side.form_contract_digest) || !DIGEST_SHAPE.test(side.form_contract_digest) || typeof side.score !== "number") {
      throw new Error(`AOS_SCORE_CHANGE_INPUT the ${name} administration needs a form contract digest and a score`);
    }
  }
  const delta = later.score - earlier.score;
  if (earlier.form_contract_digest === later.form_contract_digest) {
    return deepFreeze({
      schema_id: SCORE_CHANGE_CLAIM_SCHEMA_ID,
      delta,
      interpretable_change: false,
      interpretation: "MEMORIZATION_SUSPECTED",
      reasons: ["AOS_SCORE_CHANGE_REPLAY the same form cannot measure the same operator twice; improvement on it may be memorisation"]
    });
  }
  const pair = new Set([earlier.form_contract_digest, later.form_contract_digest]);
  const covers = linking !== null &&
    linking.schema_id === FORM_LINKING_SCHEMA_ID &&
    pair.has(linking.left_form_contract_digest) &&
    pair.has(linking.right_form_contract_digest) &&
    linking.left_form_contract_digest !== linking.right_form_contract_digest;
  if (covers && isEstablished(linking.equivalence_decision) && linking.equivalence_status === "LINKED") {
    return deepFreeze({
      schema_id: SCORE_CHANGE_CLAIM_SCHEMA_ID,
      delta,
      interpretable_change: true,
      interpretation: "OBSERVED_ON_LINKED_FORMS",
      reasons: []
    });
  }
  return deepFreeze({
    schema_id: SCORE_CHANGE_CLAIM_SCHEMA_ID,
    delta,
    interpretable_change: null,
    interpretation: "WITHHELD_EQUIVALENCE_UNESTABLISHED",
    reasons: ["AOS_SCORE_CHANGE_UNLINKED_FORMS no linking evidence covers these two exact forms; an easier form explains the change as well as skill does, so the comparison is withheld"]
  });
}

// ---------------------------------------------------------------------------------------------
// C7 learning and transfer
//
// Collaborative success is not independent transfer. Phase A -- the operator with the agent -- is
// recorded and contributes nothing to any transfer decision; only Phase B, administered with no
// agent and no transcript, can answer whether anything moved. The whole construct is versioned
// apart from the core composite: nothing here can be summed into it, by shape rather than by
// promise. The longitudinal population study is post-v0.2 evidence; until it exists these outputs
// are single-occasion observations and say so.

export const TRANSFER_PROTOCOL_SCHEMA_ID = "aos-transfer-protocol.v1";
export const TRANSFER_REPORT_SCHEMA_ID = "aos-transfer-report.v1";

export const TRANSFER_PROTOCOL = deepFreeze({
  schema_id: TRANSFER_PROTOCOL_SCHEMA_ID,
  version: "1.0.0",
  construct: "C7_LEARNING_TRANSFER",
  separate_from_core_composite: true,
  phases: [
    { phase_id: "A", name: "collaborative", agent_available: true, transcript_available: true, contributes_to_transfer_decision: false },
    { phase_id: "B", name: "held-out-independent", agent_available: false, transcript_available: false, contributes_to_transfer_decision: true }
  ],
  outputs: ["near_transfer", "far_transfer", "retention_transfer", "independent_verification_behavior"]
});

const transferDecision = (tasks, filter, answer) => {
  const relevant = tasks.filter(filter);
  return allRequired(relevant.map((task) => (typeof answer(task) === "boolean" ? answer(task) : null)));
};

/**
 * The C7 transfer report for one operator's protocol run.
 *
 * Derived from Phase B and nothing else. A phase B that still had the agent or the transcript is
 * refused rather than discounted: grading it would launder collaboration into transfer. With no
 * phase B at all every output is null and the status is UNESTABLISHED -- the honest,
 * release-permitted answer until the held-out administration has actually happened.
 */
export function assessTransfer({ phase_a: phaseA = null, phase_b: phaseB = null } = {}) {
  if (phaseB !== null) {
    if (typeof phaseB !== "object" || phaseB.agent_available !== false || phaseB.transcript_available !== false) {
      throw new Error("AOS_TRANSFER_PHASE_B_NOT_HELD_OUT phase B is administered without the agent and without the transcript; anything else is phase A wearing its name");
    }
    if (!Array.isArray(phaseB.tasks)) throw new Error("AOS_TRANSFER_PHASE_B_TASKS phase B carries its administered tasks as an array");
  }
  const tasks = phaseB === null ? [] : phaseB.tasks;
  const near = transferDecision(tasks, (task) => task.relatedness === "near", (task) => task.passed);
  const far = transferDecision(tasks, (task) => task.relatedness === "far", (task) => task.passed);
  const retention = transferDecision(tasks, (task) => task.delayed === true, (task) => task.passed);
  const verification = transferDecision(tasks, () => true, (task) => task.independent_verification_observed);
  return deepFreeze({
    schema_id: TRANSFER_REPORT_SCHEMA_ID,
    protocol: TRANSFER_PROTOCOL,
    phase_a: phaseA === null ? null : { collaborative_success: phaseA.collaborative_success === true, contributes_to_transfer_decision: false },
    near_transfer: near,
    far_transfer: far,
    retention_transfer: retention,
    independent_verification_behavior: verification,
    status: phaseB === null ? "UNESTABLISHED" : "OBSERVED",
    uncertainty: {
      status: phaseB === null ? "NOT_ADMINISTERED" : "SINGLE_OCCASION",
      note: "No longitudinal population study exists; a held-out occasion is an observation about this operator on this day, not a calibrated transfer estimate."
    },
    // Structural, not policy: there is no field here a core composite could consume, and the two
    // that name the relationship say null and false permanently.
    included_in_core_composite: false,
    core_composite_contribution: null
  });
}

// ---------------------------------------------------------------------------------------------
// DIF / invariance gate
//
// Translation is not invariance, and neither is a shared harness, a newer model or a different
// platform. A comparison across any of these facets is WITHHELD -- not made with a caveat --
// until a DIF study through the versioned runner interface, with adequate samples per group, has
// failed to detect differential functioning. Detected DIF refuses the comparison outright, which
// is a different answer from having no study, and both are different answers from PERMITTED.

export const INVARIANCE_FACETS = Object.freeze(["language", "interface", "model_runtime", "platform", "experience", "administration_version"]);
export const COMPARISON_GATE_SCHEMA_ID = "aos-comparison-gate.v1";
export const DIF_RUNNER_REPORT_SCHEMA_ID = "aos-dif-runner-report.v1";

/** The versioned DIF runner interface: what an empirical invariance study must supply. */
export const DIF_RUNNER_INTERFACE = deepFreeze({
  schema_id: "aos-dif-runner-interface.v1",
  version: "1.0.0",
  method: "anchored-two-group-dif",
  minimum_sample_per_group: 30,
  inputs: ["facet", "group_levels", "anchor_opportunity_ids", "responses_per_group"],
  outputs: ["dif_detected", "per_anchor_statistics", "sample_per_group"]
});

const gateAnswer = (facet, leftLevel, rightLevel, decision, comparison, reasons) => deepFreeze({
  schema_id: COMPARISON_GATE_SCHEMA_ID,
  runner_interface: DIF_RUNNER_INTERFACE,
  facet,
  left_level: leftLevel,
  right_level: rightLevel,
  decision,
  comparison,
  reasons
});

/**
 * Whether two results may be compared across one facet, as a `lib/decision.mjs` tri-state and the
 * comparison word it projects to: null/WITHHELD without establishing evidence, false/REFUSED when
 * DIF was detected, true/PERMITTED only when a conforming study with adequate samples found none.
 * An undeclared level on either side withholds -- absence is not equality.
 */
export function comparisonGate({ facet, left_level: leftLevel = null, right_level: rightLevel = null, invariance_evidence: evidence = null } = {}) {
  if (!INVARIANCE_FACETS.includes(facet)) {
    throw new Error(`AOS_COMPARISON_FACET_UNKNOWN ${String(facet)} is not one of ${INVARIANCE_FACETS.join(", ")}`);
  }
  if (!nonEmpty(leftLevel) || !nonEmpty(rightLevel)) {
    return gateAnswer(facet, leftLevel ?? null, rightLevel ?? null, null, "WITHHELD",
      ["AOS_COMPARISON_FACET_UNDECLARED a side that declares no level has not been shown equal to anything; absence is not equality"]);
  }
  if (leftLevel === rightLevel) {
    return gateAnswer(facet, leftLevel, rightLevel, true, "PERMITTED", []);
  }
  if (evidence === null || typeof evidence !== "object") {
    return gateAnswer(facet, leftLevel, rightLevel, null, "WITHHELD",
      [`INVARIANCE_UNESTABLISHED no empirical invariance evidence exists for ${facet}; the comparison is withheld, not made with a caveat`]);
  }
  if (evidence.schema_id !== DIF_RUNNER_REPORT_SCHEMA_ID || evidence.interface_version !== DIF_RUNNER_INTERFACE.version) {
    return gateAnswer(facet, leftLevel, rightLevel, null, "WITHHELD",
      ["AOS_COMPARISON_RUNNER_MISMATCH the evidence does not speak the versioned DIF runner interface, so it establishes nothing here"]);
  }
  const levels = Array.isArray(evidence.levels) ? evidence.levels : [];
  if (evidence.facet !== facet || !levels.includes(leftLevel) || !levels.includes(rightLevel)) {
    return gateAnswer(facet, leftLevel, rightLevel, null, "WITHHELD",
      ["AOS_COMPARISON_EVIDENCE_SCOPE evidence about another facet or other levels is not evidence about this comparison"]);
  }
  const samples = [evidence.sample_per_group?.[leftLevel], evidence.sample_per_group?.[rightLevel]];
  if (!samples.every((count) => Number.isInteger(count) && count >= DIF_RUNNER_INTERFACE.minimum_sample_per_group)) {
    return gateAnswer(facet, leftLevel, rightLevel, null, "WITHHELD",
      [`AOS_COMPARISON_SAMPLE_BELOW_MINIMUM invariance needs at least ${DIF_RUNNER_INTERFACE.minimum_sample_per_group} responses per group; a small sample is not a smaller yes`]);
  }
  // `DIF_RUNNER_INTERFACE` declares its own inputs (`anchor_opportunity_ids`, `responses_per_group`)
  // and outputs (`per_anchor_statistics`), and none of them were checked: a report naming only its
  // schema, a sample count per group and a bare `dif_detected: false` used to permit the strongest
  // comparison this gate can make. That is the report approving itself -- the declared study
  // material, not merely its verdict, has to be present before the verdict is trusted.
  const anchors = Array.isArray(evidence.anchor_opportunity_ids) ? evidence.anchor_opportunity_ids : [];
  const responses = evidence.responses_per_group;
  const statistics = evidence.per_anchor_statistics;
  const evidenceComplete = anchors.length > 0 &&
    responses !== null && typeof responses === "object" &&
    [leftLevel, rightLevel].every((level) => Array.isArray(responses[level]) && responses[level].length >= DIF_RUNNER_INTERFACE.minimum_sample_per_group) &&
    statistics !== null && typeof statistics === "object" &&
    anchors.every((anchor) => Object.prototype.hasOwnProperty.call(statistics, anchor));
  if (!evidenceComplete) {
    return gateAnswer(facet, leftLevel, rightLevel, null, "WITHHELD",
      ["AOS_COMPARISON_EVIDENCE_INCOMPLETE the report names no anchor opportunities, no per-group response data, or no per-anchor statistics; a sample count and a verdict are not the study its own interface requires"]);
  }
  if (evidence.dif_detected === true) {
    return gateAnswer(facet, leftLevel, rightLevel, false, "REFUSED",
      ["AOS_COMPARISON_DIF_DETECTED the study found differential functioning across these levels; the comparison is contradicted, not merely unestablished"]);
  }
  if (evidence.dif_detected !== false) {
    return gateAnswer(facet, leftLevel, rightLevel, null, "WITHHELD",
      ["AOS_COMPARISON_RUNNER_INCOMPLETE the study reports no dif_detected answer, so it establishes nothing"]);
  }
  return gateAnswer(facet, leftLevel, rightLevel, true, "PERMITTED", []);
}
