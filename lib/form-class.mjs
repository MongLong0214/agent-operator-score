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
//
// #585 (this round). `linkForms`, `formBankRecord`, `scoreChangeClaim`, `comparisonGate` and
// `assessTransfer` are closed by construction: none of them can ever issue the authorized verdict
// their gate exists to withhold -- LINKED, PERMITTED, OBSERVED, OBSERVED_ON_LINKED_FORMS -- from a
// caller-supplied artifact, no matter how complete or well-formed that artifact is.
//
// Five review rounds hardened these gates by adding one more required field to the predicate that
// checks a linking scaffold or a DIF report, and each next round produced a forgery satisfying the
// new field too. `completeForgedLinking()`, this repository's own regression fixture, was fifteen
// hand-typed literals -- a registered method name, a matching interface, an anchor set clearing its
// floor, a drift record consistent with LINKED, even the evidence digests -- and it reached LINKED,
// because every one of those fifteen fields is exactly as caller-supplied as the single field the
// first round checked. A predicate is a function of its inputs; when every input is under the
// caller's own pen, no predicate over them -- present or future, five fields or five hundred --
// can certify that what it describes actually happened rather than being typed to look as though
// it did. That is not a gap this module failed to close; it is what "caller-supplied" means, and
// closing it would need evidence this module cannot get: a signed study from an accredited body, an
// attested producer this repository can name and verify, or data AOS itself recorded from its own
// administration -- none of which this issue has, and none of which is invented here to manufacture
// one.
//
// So these five functions stop trying to certify a caller's artifact and stop trying harder with
// each round. Shape validation is kept exactly where it already earns its keep -- a malformed
// artifact is still refused by name, and the reasons an operator reads still say which field was
// wrong -- because that refusal does not depend on trusting the artifact's truth, only on whether
// it is even self-consistent. What changes is the branch a well-formed artifact used to unlock: it
// no longer moves the decision at all. What the caller supplied is instead carried on the result as
// an explicit `unauthenticated_claim`, never folded into `decision`, `status`, `comparison` or
// `interpretation` -- a caller can see their own numbers echoed back, and an operator reading the
// result sees plainly that AOS is reporting a claim, not vouching for it.

import { allRequired, isEstablished } from "./decision.mjs";
import { sha256Value } from "./core.mjs";
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

// #585 (this round). Five review rounds hardened this exact spot: a predicate over a caller-typed
// `linking` object, growing one more required field each round, with a fixed forgery satisfying it
// again the next round -- `isRealLinkingScaffold`, this predicate's own retired name, is the fossil
// record of that arms race (a schema tag; then a boolean decision and an empty `inputs_missing`;
// then a registered method/version; then a matching interface, an anchor floor and drift evidence
// consistent with the decision; then the evidence digests). `completeForgedLinking()` in this
// file's test satisfied the final version -- fifteen fields, all caller-supplied -- and still
// reached LINKED, because a predicate cannot certify what it has no way to observe: whether the
// study behind those fifteen fields actually happened. No sixteenth field closes that, so none is
// added. `formBankRecord` and `scoreChangeClaim` no longer ask a `linking` object anything at all
// before deciding whether to trust it; they report what it claims, named unauthenticated, and never
// let it move their own decision. See the module docstring for the trust-root reasoning in full.
const unauthenticatedLinkingClaim = (linking) => {
  if (linking === null || typeof linking !== "object") return null;
  return deepFreeze({
    claimed_schema_id: nonEmpty(linking.schema_id) ? linking.schema_id : null,
    claimed_equivalence_status: nonEmpty(linking.equivalence_status) ? linking.equivalence_status : null,
    reason: "AOS_LINKING_UNAUTHENTICATED AOS has no trust root for externally-produced linking evidence -- no signed study, no attested producer, no data AOS itself recorded -- so a caller-supplied linking claim is recorded here and never converted into an authorized equivalence verdict"
  });
};

/**
 * One form bank record.
 *
 * `exposure_policy` is derived from the class and a contradicting declaration is refused.
 * `equivalence_status` is closed by construction (module docstring): it is always UNESTABLISHED,
 * whatever `linking` names, because AOS has no trust root for externally-produced linking evidence
 * and a stored artifact must never authorize itself. What the caller supplied is recorded in
 * `unauthenticated_claim`, not folded into the derived field.
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
    // Closed by construction. Not derived from `linking` at all any more: no object a caller can
    // pass here -- a real `linkForms` return value included, since `linkForms` itself can no longer
    // produce a LINKED-shaped result -- ever moves this off UNESTABLISHED.
    equivalence_status: "UNESTABLISHED",
    unauthenticated_claim: unauthenticatedLinkingClaim(linking)
  });
}

// ---------------------------------------------------------------------------------------------
// Exposure ledger

// #585 (this round). `EXPOSURE_LEDGER_SCHEMA_ID` used to be the tag both the pre-chain ledger (no
// `revision`, no `head_digest`, the shape `AOS_EXPOSURE_LEDGER_MIGRATION_REQUIRED` below exists for)
// and the round-3 revision/chain/head-digest-bound ledger stamped, so the id alone could not say
// which of two incompatible stored shapes a file held -- the same defect class `ECD_CONTRACT.md`'s
// 1.9.0 entry names for the task-model schema (`$id` and the `schema` discriminator both surviving
// a required-field change untouched). It happened not to be exploitable here only because
// `openExposureLedger` never actually branches on the id past recognising it; it branches on
// `revision`/`head_digest` presence instead -- but that means a raw object tagged with the OLD id
// and carrying a fabricated `revision`/`head_digest`/chain was read as a fully verified round-3
// ledger, exactly the promotion `AOS_EXPOSURE_LEDGER_MIGRATION_REQUIRED` exists to refuse for
// anything actually written before the chain existed. The chained shape now owns its own id;
// `EXPOSURE_LEDGER_SCHEMA_ID` (v1) names only the pre-chain shape from here on, and a ledger
// claiming it is refused as migration-required unconditionally, never merely when it also happens
// to lack `revision`/`head_digest`.
export const EXPOSURE_LEDGER_SCHEMA_ID = "aos-exposure-ledger.v1";
export const EXPOSURE_LEDGER_SCHEMA_ID_V2 = "aos-exposure-ledger.v2";
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

// #585 round 3, governing directive 19 and the detectable half of 13. `openExposureLedger` used to
// validate each entry's own shape and nothing about the ledger's shape as a sequence: a reordered
// entry, a deleted middle row, an inserted row, or a field altered inside an already-committed
// entry all pass every check above unless something binds an entry to its neighbours and to the
// ledger's own declared length. Three bindings close that gap, and all three are recomputed on
// every read rather than trusted from the file:
//   - `revision` (ledger-level) and each entry's own `revision`: exactly one ledger revision is
//     consumed per committed transition (an append or an in-place RESERVED/REVEALED/TERMINAL
//     update), stamped on the one entry that transition touched.
//   - `chain_digest` (entry-level): a digest over the entry's own committed content plus the
//     previous entry's `chain_digest`, so entries are bound to their neighbours and their order.
//   - `head_digest` (ledger-level): the last entry's `chain_digest`, so the ledger is bound to
//     where its own history currently ends.
// A sentinel rather than a real digest of anything: there is no entry before the first one, and
// "no prior entry" has to be a fixed, recognisable value the first entry's own digest can fold in,
// the same reason a hash chain's genesis block chains to an all-zero parent instead of nothing.
export const EXPOSURE_LEDGER_GENESIS_DIGEST = `sha256:${"0".repeat(64)}`;

const chainedDigest = (value) => `sha256:${sha256Value(value)}`;

/**
 * Recomputes the transition digest chain over an entries array from the genesis digest.
 *
 * Every entry's digest folds in the one before it, so moving, removing, inserting, or editing any
 * entry changes the digest of everything chained after it -- this is what makes reordering,
 * mid-sequence deletion, insertion, and a post-hoc field edit all detectable the same way, by the
 * same recomputation, rather than needing one bespoke check per tamper shape. Called both when a
 * new transition is committed (over the whole updated array, because an in-place update to an
 * earlier entry moves the previous-digest input to every entry chained after it) and when a stored
 * ledger is opened (to check what is recomputed against what was stored, never trusting the file).
 *
 * This binds entries to each other and to their position; it does not stop a forger who edits a
 * field and also correctly recomputes that entry's own `chain_digest` and every digest chained
 * after it, including the ledger's `head_digest` -- no un-keyed hash chain over otherwise-plain
 * JSON can. What it closes is the shape every accidental corruption and every partial edit actually
 * takes: touch the data, leave the chain stale.
 */
const chainEntries = (entries) => {
  let previousDigest = EXPOSURE_LEDGER_GENESIS_DIGEST;
  const chained = entries.map((entry) => {
    const { chain_digest: _priorDigest, ...content } = entry;
    const digest = chainedDigest({ previous_digest: previousDigest, entry: content });
    previousDigest = digest;
    return { ...content, chain_digest: digest };
  });
  return { entries: chained, headDigest: previousDigest };
};

/**
 * One committed ledger transition: stamps the next revision onto exactly the entry this transition
 * touched (`touchedIndex`; the array's own last index for an append), recomputes the whole
 * transition digest chain over the result, and binds the new head digest. `opened` is a ledger
 * `openExposureLedger` already accepted, so its `revision` is trusted as the count of transitions
 * committed so far.
 */
const commitExposureLedger = (opened, entries, touchedIndex) => {
  const revision = opened.revision + 1;
  const withRevision = entries.map((entry, index) => (index === touchedIndex ? { ...entry, revision } : entry));
  const { entries: chained, headDigest } = chainEntries(withRevision);
  return deepFreeze({ schema_id: EXPOSURE_LEDGER_SCHEMA_ID_V2, revision, head_digest: headDigest, entries: chained });
};

export const createExposureLedger = () => deepFreeze({
  schema_id: EXPOSURE_LEDGER_SCHEMA_ID_V2,
  revision: 0,
  head_digest: EXPOSURE_LEDGER_GENESIS_DIGEST,
  entries: []
});

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
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) ||
      (raw.schema_id !== EXPOSURE_LEDGER_SCHEMA_ID && raw.schema_id !== EXPOSURE_LEDGER_SCHEMA_ID_V2) ||
      !Array.isArray(raw.entries)) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT the stored exposure ledger is not one this release recognises; refusing to read exposure history as empty");
  }

  // #585 round 3, governing directive 20. A ledger written before this release carries neither
  // `revision` nor `head_digest` -- it was never bound into a transition chain, so there is nothing
  // honest to recompute and compare it against. Reading it as though its entries had passed a check
  // they never went through would promote pre-chain history to VERIFIED on the strength of a chain
  // it never had, which is exactly the promotion directive 20 forbids. This release fails closed
  // instead of inventing a migration that manufactures a chain over history nothing digested at the
  // time it was written: bootstrapping trust for bytes this release cannot verify is the same
  // invented trust root this repository has refused elsewhere, just aimed at old data instead of a
  // new key. The remedy is the same shape as corruption (directive 18.5: stop issuance, do not
  // reset the ledger) even though this is a distinct, named condition -- an operator on a pre-chain
  // ledger has a real history to preserve, not a damaged file, and an explicit migration path (one
  // that carries the pre-migration bytes forward as provenance rather than silently discarding them)
  // is future work this release does not ship.
  //
  // #585 (this round). Decided by the schema id alone now, not by whether `revision`/`head_digest`
  // happen to be present: the two shapes own two different ids (see the comment above
  // `EXPOSURE_LEDGER_SCHEMA_ID`'s declaration), so a ledger tagged with the pre-chain id is
  // unconditionally pre-chain, whatever fields it also happens to carry. A raw object that names the
  // OLD id but has been extended with a fabricated `revision`, `head_digest` and a self-consistent
  // chain no longer slips past this check into the chain-validated branch below -- the id it claims
  // decides which shape it must be, and only the shape's own id passes here.
  if (raw.schema_id === EXPOSURE_LEDGER_SCHEMA_ID) {
    throw new Error("AOS_EXPOSURE_LEDGER_MIGRATION_REQUIRED the stored exposure ledger predates revision/chain/head integrity binding; it cannot be read as verified without an explicit migration, and none is silently performed");
  }
  if (!Number.isInteger(raw.revision) || raw.revision < 0) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT the stored exposure ledger's revision is not a well-formed non-negative integer");
  }
  if (!nonEmpty(raw.head_digest) || !DIGEST_SHAPE.test(raw.head_digest)) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT the stored exposure ledger's head digest is not a well-formed digest");
  }

  // `priorEntries` decides the scored-once policy by filtering on `form_contract_digest`; a row
  // that lost or malformed that field would silently fall out of every such filter and read as a
  // form that was never administered -- the exact gap `classifyAdministration` and
  // `formLifecycleState` exist to close. An unreadable exposure is not the absence of one, so a
  // row that does not carry a recognised entry schema tag and a well-formed digest refuses the
  // whole ledger rather than being dropped and silently counted as zero exposure. `revision` and
  // `chain_digest` are checked here too, for the same reason: a ledger this release ever wrote
  // stamps both on every entry, so an entry missing either is exactly as unrecognised as one missing
  // its form contract digest.
  for (const entry of raw.entries) {
    if (entry === null || typeof entry !== "object" || !isRecognisedExposureEntry(entry) ||
        !nonEmpty(entry.form_contract_digest) || !DIGEST_SHAPE.test(entry.form_contract_digest) ||
        !Number.isInteger(entry.revision) || entry.revision < 1 ||
        !nonEmpty(entry.chain_digest) || !DIGEST_SHAPE.test(entry.chain_digest)) {
      throw new Error("AOS_EXPOSURE_ENTRY_CORRUPT a stored exposure entry is not one this release recognises; refusing to read it as no exposure");
    }
  }

  // Uniqueness (governing directive 19 item 4). Two entries sharing one administration_id would let
  // `markRevealed` and `recordExposure`'s update path silently transition whichever `findIndex`
  // meets first -- the exact ambiguity `reserveExposure` already refuses at write time. A stored
  // file can still reach this shape by hand-editing or by a corrupted write, so it is checked again
  // on every read, not only when a fresh reservation is made.
  const administrationIds = raw.entries.map((entry) => entry.administration_id).filter(nonEmpty);
  if (new Set(administrationIds).size !== administrationIds.length) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT two stored exposure entries share one administration_id; an administration id is reserved exactly once");
  }

  // Monotonic revision (governing directive 19 item 1). Every committed transition -- an append or
  // an in-place RESERVED/REVEALED/TERMINAL update -- consumes exactly one ledger revision and stamps
  // it on the one entry that transition touched; an entry no later transition ever revisits keeps
  // whichever revision it was first stamped with. That is why a legitimate ledger's per-entry
  // revisions are not required to run 1..N in array order: an earlier row can carry a *later*
  // revision than a row appended after it, if the earlier row was revealed or finalized afterward.
  // What a legitimate history DOES guarantee -- and what a gap, a repeat, or a decrease breaks -- is
  // checked directly instead: no two entries ever share a revision, there can never be more entries
  // than revisions ever consumed, and the highest revision any entry carries is exactly the ledger's
  // own, because the most recent transition stamped both with the same new number.
  const revisions = raw.entries.map((entry) => entry.revision);
  if (new Set(revisions).size !== revisions.length) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT two stored exposure entries share one revision; each committed transition consumes a revision exactly once");
  }
  if (raw.entries.length > raw.revision) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT more exposure entries are stored than the ledger's own revision counter allows; every entry consumed a revision no other entry can also claim");
  }
  const maxEntryRevision = revisions.length === 0 ? 0 : Math.max(...revisions);
  if (raw.entries.length === 0 ? raw.revision !== 0 : maxEntryRevision !== raw.revision) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT the ledger's revision does not match its most recently committed entry; a gap or a decrease in revision is corruption");
  }

  // Transition digest chain and head binding (governing directive 19 items 2 and 3). Recomputed
  // from the raw stored entries, never trusted from the file: reordering, deleting a middle entry,
  // inserting one, or altering a field inside an already-committed entry all change what this
  // recomputation produces, because every entry's digest folds in the one before it and the
  // ledger's head digest is the last entry's -- see `chainEntries` for what this recomputation does
  // and does not defend against.
  const { entries: recomputed, headDigest } = chainEntries(raw.entries);
  for (let index = 0; index < recomputed.length; index += 1) {
    if (recomputed[index].chain_digest !== raw.entries[index].chain_digest) {
      throw new Error(`AOS_EXPOSURE_LEDGER_CORRUPT the transition digest chain is broken at entry ${index} (administration ${raw.entries[index].administration_id ?? "unknown"}); the ledger was reordered, an entry was inserted or deleted, or a committed field was altered afterward`);
    }
  }
  if (headDigest !== raw.head_digest) {
    throw new Error("AOS_EXPOSURE_LEDGER_CORRUPT the ledger's head digest does not match its last entry; the tail was truncated or replaced");
  }

  return deepFreeze({
    schema_id: EXPOSURE_LEDGER_SCHEMA_ID_V2,
    revision: raw.revision,
    head_digest: raw.head_digest,
    entries: raw.entries.map((entry) => ({ ...entry }))
  });
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

// `classifyAdministration` already excluded a RESERVED row that never revealed anything -- nothing
// was administered, nothing was revealed -- but `practiceAnalysis` and `formLifecycleState` kept
// counting that same row as an administration, so one ledger could classify a form as fresh and
// officially permitted while also reporting it retired with a nonzero exposure count. The three now
// read this exclusion from one predicate so they cannot disagree about whether a form was ever
// administered.
const isAbandonedReservation = (entry) => entry.state === "RESERVED" && entry.content_revealed !== true;
const administeredEntries = (rows) => rows.filter((row) => !isAbandonedReservation(row));

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
  // #585 item 3, fourth site. A RESERVED row that never revealed anything is not exposure --
  // `classifyAdministration`, `practiceAnalysis` and `formLifecycleState` already exclude it through
  // this same `administeredEntries` predicate. This reservation's own `prior_exposure_count` used to
  // read `prior.length` unfiltered, so an abandoned reservation for this exact form durably inflated
  // every later administration's count by one, forever -- the one fact this field records is fixed
  // at reservation time and never recomputed.
  const priorAdministered = administeredEntries(prior);
  const entry = {
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
    prior_exposure_count: priorAdministered.length,
    prior_scored_count: prior.filter((row) => row.scored === true).length,
    prior_same_form_id_count: opened.entries.filter((row) => row.form_id === formId).length
  };
  const entries = [...opened.entries, entry];
  const committed = commitExposureLedger(opened, entries, entries.length - 1);
  return { ledger: committed, entry: committed.entries.at(-1) };
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
  const entry = { ...reserved, state: "REVEALED", content_revealed: true, revealed_at: new Date(occurred).toISOString() };
  const entries = [...opened.entries];
  entries[index] = entry;
  const committed = commitExposureLedger(opened, entries, index);
  return { ledger: committed, entry: committed.entries[index] };
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
    const entry = {
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
    };
    const entries = [...opened.entries];
    entries[index] = entry;
    const committed = commitExposureLedger(opened, entries, index);
    return { ledger: committed, entry: committed.entries[index] };
  }
  const previous = opened.entries.at(-1) ?? null;
  const previousEpoch = previous === null ? null : epochOf(previous.occurred_at);
  const prior = priorEntries(opened, formContractDigest);
  // #585 item 3, fifth site. The same unfiltered count `reserveExposure` carried: this bare-append
  // path (a direct, one-shot record with no reservation) is a second constructor for the same
  // `prior_exposure_count` field, so it inherits the same requirement to exclude an abandoned
  // reservation from prior exposure -- via the one shared predicate, not a second copy of the rule.
  const priorAdministered = administeredEntries(prior);
  const entry = {
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
    prior_exposure_count: priorAdministered.length,
    prior_scored_count: prior.filter((row) => row.scored === true).length,
    prior_same_form_id_count: opened.entries.filter((row) => row.form_id === formId).length
  };
  const entries = [...opened.entries, entry];
  const committed = commitExposureLedger(opened, entries, entries.length - 1);
  return { ledger: committed, entry: committed.entries.at(-1) };
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
  // Governing directive 18.1 and 18.2 separate two orphans this used to treat as one. A row that
  // reached REVEALED had its content put in front of the agent, and no crash un-shows a task: that
  // form is spent, and a later attempt is refused. A row still at RESERVED never revealed anything
  // -- `content_revealed` is false and the scenario was never materialised -- so nothing about the
  // form reached anybody, and retiring it would burn a form over a reservation that produced no
  // exposure at all. The cross-process suite reproduced that from ordinary scheduling contention
  // rather than a crash: one process losing a lock race permanently retired the form for everyone,
  // recoverable only by hand-editing the ledger. An unrevealed reservation is therefore abandoned
  // rather than honoured, and the fresh attempt proceeds; two official slots are still impossible
  // because the reservation is taken under the same lock that refuses a second one.
  const unresolved = prior.filter((row) => row.state === "REVEALED"
    || (row.state === "RESERVED" && row.content_revealed === true));
  const abandonedReservations = prior.filter(isAbandonedReservation);
  // An abandoned reservation is not an administration either. It has to leave `exposures` as well
  // as `unresolved`, or the count below refuses the form for having been "administered once"
  // when nothing was ever administered -- the same retirement by a different rule.
  // `administeredEntries` is the shared predicate, also read by `practiceAnalysis` and
  // `formLifecycleState`, so the three cannot drift apart on this exact question again.
  const exposures = administeredEntries(prior);
  const base = {
    schema_id: ADMINISTRATION_CLASSIFICATION_SCHEMA_ID,
    form_id: formId ?? null,
    form_contract_digest: formContractDigest,
    // #585 item 2. Named on the classification itself, not only used to filter the prior rows
    // above: `exposureVerification` in lib/cycle.mjs checks this against the run record it sits
    // on, and a classification with no administration_id at all is exactly the shape a copied or
    // hand-written object takes -- it cannot name what it is a classification of.
    administration_id: administrationId,
    declared_class: declaredClass,
    prior_exposure_count: exposures.length,
    prior_scored_count: priorScored,
    // Named rather than dropped. A reservation abandoned before it revealed anything does not
    // retire the form, but it is still a row somebody has to be able to account for -- a count
    // that silently ignored them would make an abandoned reservation and a form nobody ever
    // reserved read identically, which is the absence-as-value shape this repository keeps
    // finding. Directive 18.1 calls this state ABORTED_BEFORE_REVEAL.
    aborted_before_reveal: abandonedReservations.map((row) => row.administration_id)
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
  if (exposures.length > 0) {
    return deepFreeze({
      ...base,
      administered_class: "PRACTICE",
      official_scoring_permitted: false,
      refusal_code: "AOS_FORM_ALREADY_EXPOSED",
      reasons: [`AOS_FORM_ALREADY_EXPOSED this exact form was administered ${exposures.length} time(s) before (${priorScored} scored); the scored-once policy makes this run a practice administration, and improvement on it may be memorisation rather than skill`]
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

/**
 * Registered linking methods, keyed by method name then method version. Each entry is that
 * method's own contract -- minimum anchor count, minimum sample per form and drift thresholds --
 * and only a method/version pair listed here may ever reach LINKED (directive 22.4). The contract
 * belongs to the registered method, never to a caller: `linkForms` below does not read a
 * caller-supplied threshold from anywhere (directive 22.5), so the only way to loosen or tighten
 * one is to add a new registered version here.
 */
export const LINKING_METHOD_REGISTRY = deepFreeze({
  "anchored-delta.v1": {
    "1.0.0": {
      minimum_anchor_count: 3,
      minimum_sample_per_form: 20,
      drift_thresholds: { maximum_anchor_delta: 0.1 }
    }
  }
});

/**
 * The versioned linking method interface: what a real calibration must supply, and its floors.
 * Sourced from `LINKING_METHOD_REGISTRY`'s one entry rather than repeating its numbers as a second
 * literal, which is exactly the drift that let `minimum_anchor_count` fall out of step with the
 * method's own declaration before.
 */
export const LINKING_METHOD_INTERFACE = deepFreeze({
  schema_id: "aos-form-linking-method.v1",
  version: "1.0.0",
  ...LINKING_METHOD_REGISTRY["anchored-delta.v1"]["1.0.0"]
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
 * Closed by construction (module docstring): `equivalence_decision`/`equivalence_status` can never
 * reach `true`/`LINKED`, from any input a caller can supply, however complete. The negative,
 * non-authorizing answers stay reachable and mean what they always have -- null while evidence is
 * missing or below its registered floor, false (FAILED) when the two forms' own declared anchors do
 * not overlap, false (DRIFTED) when a caller's reported deltas exceed the registered threshold --
 * because none of those grants anything a forger would want. Only the one branch that would
 * otherwise have reached LINKED is closed: what the caller's numbers claimed there is carried on
 * `unauthenticated_claim` instead, named unauthenticated by a stated reason, never as evidence.
 */
export function linkForms({
  left_form: leftForm,
  right_form: rightForm,
  anchor_ids: anchorIds = [],
  exposure_history: exposureHistory = null,
  task_model_digest: taskModelDigest = null,
  response_patterns: responsePatterns = null,
  // Directive 22.5: accepted only so passing it never throws -- never read below. The drift
  // threshold belongs to the registered method's own contract; a caller field here (for example
  // `maximum_anchor_delta: 999`) used to override it and could turn a genuinely drifting
  // comparison into LINKED. A real loosening is a new registered method version in
  // LINKING_METHOD_REGISTRY, never a per-call argument.
  drift_thresholds: callerDriftThresholds = null
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
  // Resolved before the anchor floor below reads it (#585 NIT item 4): the registered method's own
  // contract is what declares every floor and threshold this function checks against, and reading
  // it once here -- rather than the anchor check reaching past it for the shipped interface while
  // the sample and drift checks further down correctly use this same resolution -- is what keeps a
  // future method with a different anchor floor from being checked against the wrong one.
  const method = responsePatterns !== null && typeof responsePatterns === "object" ? responsePatterns : null;
  if (method === null) missing.push("cross_form_response_patterns");
  if (method !== null && (!nonEmpty(method.method) || !nonEmpty(method.method_version))) missing.push("linking_method");
  // Directive 22.4: a named method is not a registered one. Only a method/version pair this
  // release actually built a contract for -- an entry in LINKING_METHOD_REGISTRY -- may ever reach
  // LINKED; any other non-empty string a caller cared to type used to be accepted as though it were
  // a real calibration, deciding equivalence for a method nobody certified. An unregistered pair is
  // reported the same way any other missing empirical input is: named here, and the
  // anchor/sample/drift evaluation below never runs for it, so the decision stays null.
  const methodContract = method !== null && nonEmpty(method.method) && nonEmpty(method.method_version)
    ? LINKING_METHOD_REGISTRY[method.method]?.[method.method_version] ?? null
    : null;
  if (method !== null && nonEmpty(method.method) && nonEmpty(method.method_version) && methodContract === null) {
    missing.push("linking_method_unregistered");
  }
  // The method declares its own floor (`minimum_anchor_count`); checking only for `=== 0` let one
  // anchor -- fewer than the method itself requires -- read as a complete anchor set and reach
  // LINKED, removing the claim-stage ceiling on evidence the declared method never certified as
  // enough. Reading the floor from the declaration rather than repeating it as a second literal is
  // what keeps the two from drifting apart the way this guard just did.
  // Distinct anchors, not raw array length: `anchor_ids: sortedUnique(anchorIds)` below is what this
  // scaffold actually reports and reasons about, so counting the raw array let a caller repeat one
  // shared anchor id up to the declared minimum, satisfy this floor on a single distinct anchor, and
  // reach LINKED on evidence the registered method never certified as enough.
  //
  // Read from the resolved contract when the method resolved one, and from the one shipped
  // interface only when it did not -- the same fallback the drift threshold below already uses --
  // so a floor this run is not actually being held to (a not-yet-resolved or unregistered method)
  // never governs it, and a registered method's own floor always does once it has resolved.
  const distinctAnchorCount = Array.isArray(anchorIds) ? new Set(anchorIds).size : 0;
  if (!Array.isArray(anchorIds) || distinctAnchorCount < (methodContract ?? LINKING_METHOD_INTERFACE).minimum_anchor_count) missing.push("anchor_opportunity_ids");
  if (exposureHistory === null || typeof exposureHistory !== "object") missing.push("exposure_history");
  if (!nonEmpty(taskModelDigest) || !DIGEST_SHAPE.test(taskModelDigest)) missing.push("task_model_digest");

  const reasons = [];
  let decision = null;
  let status = "UNESTABLISHED";
  let driftStatus = "NOT_MONITORED";
  let maximumDelta = null;
  // Closed by construction (module docstring): populated only in the one branch below where every
  // floor is met and the caller's own numbers would, if trusted, have reached LINKED. `null`
  // everywhere else -- there is nothing suppressed to report when the artifact is incomplete or
  // when the caller's own numbers already produced a negative, non-authorizing answer (FAILED,
  // DRIFTED, or still-missing evidence), because those are exactly what `equivalence_status` and
  // `reasons` already say.
  let unauthenticatedClaim = null;
  if (missing.length === 0) {
    const anchorsShared = anchorIds.every((anchor) => leftCells.has(anchor) && rightCells.has(anchor));
    const samples = [method.sample_per_form?.left, method.sample_per_form?.right];
    const samplesAdequate = samples.every((count) => Number.isInteger(count) && count >= methodContract.minimum_sample_per_form);
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
      reasons.push(`AOS_LINKING_SAMPLE_BELOW_MINIMUM linking needs at least ${methodContract.minimum_sample_per_form} responses per form; a small sample is not a smaller yes`);
    } else if (!deltasComplete) {
      decision = null;
      missing.push("anchor_response_patterns");
    } else {
      const observedMaximumDelta = Math.max(...deltas.map((delta) => Math.abs(delta)));
      // Directive 22.5: the registered method's own contract decides the drift threshold;
      // `callerDriftThresholds` above is never consulted here, so a caller cannot widen or narrow
      // it by passing its own value -- only a new registered method version can change what a
      // comparison is measured against.
      const threshold = methodContract.drift_thresholds.maximum_anchor_delta;
      if (observedMaximumDelta <= threshold) {
        // #585 (this round). This is the branch `wellFormedLinkingClaim()` in this file's own test
        // -- and every review round's forgery before it -- was built to reach: every floor met,
        // every digest present, drift within the registered threshold. It is also the one branch
        // closed by construction (module docstring): a complete, well-formed calibration is still
        // caller-supplied evidence AOS did not run and cannot authenticate, so `decision`/`status`
        // never move off their UNESTABLISHED default here, whatever the caller's numbers say. The
        // authoritative `drift` field (`driftStatus`/`maximumDelta`, both still their honest
        // NOT_MONITORED/null defaults below) is left untouched too, for the same reason -- it is
        // not merely a decision-adjacent detail, it is the same suppressed authorization restated
        // in a second field. What the caller's numbers claimed is recorded in
        // `unauthenticated_claim` instead, named unauthenticated by a stated reason.
        unauthenticatedClaim = deepFreeze({
          claimed_equivalence_status: "LINKED",
          claimed_method: { method: method.method, method_version: method.method_version },
          maximum_observed_delta: observedMaximumDelta,
          reason: "AOS_LINKING_UNAUTHENTICATED AOS has no trust root for externally-produced linking studies -- no signed study, no attested producer, no data AOS itself recorded -- so a complete, well-formed calibration is recorded as an unauthenticated claim and never converted into a LINKED verdict"
        });
      } else {
        decision = false;
        status = "DRIFTED";
        driftStatus = "EXCEEDED";
        maximumDelta = observedMaximumDelta;
        reasons.push(`AOS_LINKING_DRIFT anchor delta ${observedMaximumDelta} exceeds the ${threshold} threshold`);
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
    // PROFILE_BOUND. Established equivalence imposes no ceiling of its own. `decision` can no
    // longer ever be `true` (see the closed branch above), so this is `"PROFILE_BOUND"`
    // unconditionally now -- correctly, since equivalence is never established by this function.
    claim_stage_ceiling: isEstablished(decision) ? null : "PROFILE_BOUND",
    // Reports the threshold that actually governed this comparison -- the resolved method's own
    // contract, or the one registered interface's when no method has been resolved yet -- never
    // whatever a caller may have passed in `drift_thresholds`.
    drift: deepFreeze({
      thresholds: { maximum_anchor_delta: (methodContract ?? LINKING_METHOD_INTERFACE).drift_thresholds.maximum_anchor_delta },
      status: driftStatus,
      maximum_observed_delta: maximumDelta
    }),
    inputs_missing: sortedUnique(missing),
    reasons,
    unauthenticated_claim: unauthenticatedClaim
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
const unauthenticatedLifecycleClaim = (linking) => {
  if (linking === null || typeof linking !== "object") return null;
  return deepFreeze({
    claimed_equivalence_status: nonEmpty(linking.equivalence_status) ? linking.equivalence_status : null,
    claimed_drift_status: nonEmpty(linking?.drift?.status) ? linking.drift.status : null,
    reason: "AOS_LINKING_UNAUTHENTICATED AOS has no trust root for externally-produced linking or drift evidence, so a caller-supplied lifecycle claim is recorded here and never converted into an authorized equivalence or drift verdict"
  });
};

export function formLifecycleState(ledger, { form_contract_digest: formContractDigest, linking = null } = {}) {
  const opened = openExposureLedger(ledger);
  if (!nonEmpty(formContractDigest) || !DIGEST_SHAPE.test(formContractDigest)) {
    throw new Error("AOS_EXPOSURE_FORM_DIGEST lifecycle is of one exact form contract digest");
  }
  // An abandoned reservation (RESERVED, content never revealed) is not exposure: nothing was shown
  // to anybody, so it must not retire a form here either, or the exposure ledger disagrees with
  // itself about the exact same row -- `classifyAdministration` reads OPERATIONAL and permits
  // official scoring on it while this API reported the form RETIRED_FROM_OFFICIAL_USE.
  const prior = administeredEntries(priorEntries(opened, formContractDigest));
  return deepFreeze({
    schema_id: FORM_LIFECYCLE_SCHEMA_ID,
    form_contract_digest: formContractDigest,
    exposure_count: prior.length,
    scored_count: prior.filter((entry) => entry.scored === true).length,
    retirement_status: prior.length === 0 ? "ACTIVE" : "RETIRED_FROM_OFFICIAL_USE",
    // 여섯 번째 게이트. 다섯 개를 닫은 라운드가 이걸 빠뜨렸다 -- 그 라운드의 구현자가 목록에 없다고
    // 밝혔는데 받아서 처리하지 않았다. `linkForms` 가 더 이상 LINKED 를 못 내보내므로 여기서 그 값의
    // 유일한 생산자는 손으로 쓴 객체뿐이고, 즉 이 분기는 이 라운드가 거부하려는 위조로만 도달한다.
    // `drift_status` 는 더 나빴다: enum 검사조차 없어서 caller 문자열이 그대로 권위 있는 판정으로
    // 나갔다. 둘 다 닫고, caller 가 뭘 주장했는지는 다른 다섯 게이트와 같은 자리에 기록한다.
    drift_status: "NOT_MONITORED",
    equivalence_status: "UNESTABLISHED",
    unauthenticated_claim: unauthenticatedLifecycleClaim(linking)
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
  // An abandoned reservation (RESERVED, content never revealed) is not an administration: nothing
  // was administered and nothing was revealed, so counting it made a nonempty row set out of a form
  // that was never actually shown to anybody -- turning `practice_contaminated` false and
  // `generalizability_evidence_eligible` true for an administration that never occurred.
  const rows = administeredEntries(priorEntries(opened, formContractDigest));
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
 * suggests. A rise across two forms is otherwise closed by construction (module docstring):
 * `interpretation` can never reach `OBSERVED_ON_LINKED_FORMS` from a caller-supplied `linking`
 * object, however completely it names these two exact forms as LINKED, because AOS has no trust
 * root for externally-produced linking evidence. It stays `WITHHELD_EQUIVALENCE_UNESTABLISHED` --
 * an easier form explains a rise exactly as well as skill does -- and what the caller's `linking`
 * object claimed is recorded in `unauthenticated_claim`, never folded into `interpretation`.
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
      reasons: ["AOS_SCORE_CHANGE_REPLAY the same form cannot measure the same operator twice; improvement on it may be memorisation"],
      unauthenticated_claim: null
    });
  }
  return deepFreeze({
    schema_id: SCORE_CHANGE_CLAIM_SCHEMA_ID,
    delta,
    interpretable_change: null,
    interpretation: "WITHHELD_EQUIVALENCE_UNESTABLISHED",
    reasons: ["AOS_SCORE_CHANGE_UNLINKED_FORMS no linking evidence covers these two exact forms; an easier form explains the change as well as skill does, so the comparison is withheld"],
    // Closed by construction. `linkForms` can no longer produce a LINKED-shaped scaffold, and even
    // a hand-authored object naming `{schema_id, equivalence_status: "LINKED", ...both digests}` --
    // once this function's whole reason for existing to check -- is not asked anything about these
    // two exact forms any more: whatever `linking` claims is recorded here, unauthenticated, and
    // never promotes `interpretation` past this withheld default.
    unauthenticated_claim: unauthenticatedLinkingClaim(linking)
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
 * A phase B that still had the agent or the transcript is refused rather than discounted: grading
 * it would launder collaboration into transfer. That refusal is a shape check, not a trust
 * decision, though -- `agent_available: false` and `transcript_available: false` are booleans a
 * caller types exactly as easily as `true`, and this function has no way to confirm the agent was
 * genuinely absent from an administration it never witnessed. So `assessTransfer` is closed by
 * construction (module docstring): `status` is UNESTABLISHED and all four outputs stay null for
 * every caller-supplied `phase_b`, however completely it is shaped -- real per-task answers,
 * correctly held-out flags, all of it -- because none of that is evidence AOS can authenticate.
 * With no phase B at all this was always the honest answer; it is now the answer regardless, until
 * a genuine held-out administration this repository itself records exists to change it. What a
 * caller-supplied phase B claimed is recorded in `unauthenticated_claim`, never promoted to a real
 * transfer verdict.
 */
export function assessTransfer({ phase_a: phaseA = null, phase_b: phaseB = null } = {}) {
  if (phaseB !== null) {
    if (typeof phaseB !== "object" || phaseB.agent_available !== false || phaseB.transcript_available !== false) {
      throw new Error("AOS_TRANSFER_PHASE_B_NOT_HELD_OUT phase B is administered without the agent and without the transcript; anything else is phase A wearing its name");
    }
    if (!Array.isArray(phaseB.tasks)) throw new Error("AOS_TRANSFER_PHASE_B_TASKS phase B carries its administered tasks as an array");
  }
  const tasks = phaseB === null ? [] : phaseB.tasks;
  // Presence of the container is not an observation: an empty `tasks` array is a phase B object
  // with nothing actually administered in it. `transferDecision` already answers null for every
  // output on an empty array (`allRequired([])` is null, never true).
  //
  // A nonempty array is not an observation either, when every element in it is: `tasks: [{}]`
  // carries a slot with none of the fields any output reads -- `relatedness`, `delayed`, `passed`,
  // `independent_verification_observed` are all `undefined` on `{}`. A slot in the array is not an
  // administered task; only an element that actually answers one of this protocol's own boolean
  // questions is. `isObservedTask` checks the two fields every real held-out task in this file's
  // own fixtures carries (`passed` for near/far/retention, `independent_verification_observed` for
  // the fourth output, which is the only one `transferDecision` asks of every task regardless of
  // relatedness) -- a task with neither is not one this protocol observed anything about, whatever
  // else the caller filled the object with. `phaseBAdministered` and the four decisions below are
  // no longer this function's own answer (see the docstring): they exist only to populate
  // `unauthenticated_claim` with what the caller's own data would have implied, never to move
  // `status` or the four real outputs off their closed defaults.
  const isObservedTask = (task) => task !== null && typeof task === "object" &&
    (typeof task.passed === "boolean" || typeof task.independent_verification_observed === "boolean");
  const phaseBAdministered = phaseB !== null && tasks.some(isObservedTask);
  const near = transferDecision(tasks, (task) => task.relatedness === "near", (task) => task.passed);
  const far = transferDecision(tasks, (task) => task.relatedness === "far", (task) => task.passed);
  const retention = transferDecision(tasks, (task) => task.delayed === true, (task) => task.passed);
  const verification = transferDecision(tasks, () => true, (task) => task.independent_verification_observed);
  return deepFreeze({
    schema_id: TRANSFER_REPORT_SCHEMA_ID,
    protocol: TRANSFER_PROTOCOL,
    phase_a: phaseA === null ? null : { collaborative_success: phaseA.collaborative_success === true, contributes_to_transfer_decision: false },
    // 닫힌 채로 둔다. 라운드 6 이 "부정 답은 아무것도 승인하지 않으니 열어두라" 고 지적했고
    // 한 번 열었다가 되돌렸다 -- `near_transfer: false` 는 승인하지 않는 답이 아니라 held-out 시행이
    // 실제로 있었고 거기서 실패했다는 관측 주장이다. 시행 자체를 인증할 수 없으면 그 결과는 긍정이든
    // 부정이든 보고할 수 없고, 없는 관측을 값으로 내보내는 것은 이 레포가 추적하는 결함 1번이다.
    // caller 의 숫자는 `unauthenticated_claim` 에 그대로 남으므로 사실이 사라지지도 않는다.
    near_transfer: null,
    far_transfer: null,
    retention_transfer: null,
    independent_verification_behavior: null,
    status: "UNESTABLISHED",
    uncertainty: {
      status: "NOT_ADMINISTERED",
      note: "No longitudinal population study exists, and AOS has no trust root for a caller-claimed held-out administration -- see unauthenticated_claim. A held-out occasion this repository itself recorded would be an observation about this operator on this day, not a calibrated transfer estimate, but even that has not been implemented yet."
    },
    // Structural, not policy: there is no field here a core composite could consume, and the two
    // that name the relationship say null and false permanently.
    included_in_core_composite: false,
    core_composite_contribution: null,
    unauthenticated_claim: phaseBAdministered ? deepFreeze({
      claimed_status: "OBSERVED",
      claimed_near_transfer: near,
      claimed_far_transfer: far,
      claimed_retention_transfer: retention,
      claimed_independent_verification_behavior: verification,
      reason: "AOS_TRANSFER_UNAUTHENTICATED AOS has no trust root for an externally-claimed held-out phase B administration -- no attested runner, no data AOS itself recorded -- so the caller's reported task outcomes are recorded here and never converted into an OBSERVED transfer verdict"
    }) : null
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

const gateAnswer = (facet, leftLevel, rightLevel, decision, comparison, reasons, unauthenticatedClaim = null) => deepFreeze({
  schema_id: COMPARISON_GATE_SCHEMA_ID,
  runner_interface: DIF_RUNNER_INTERFACE,
  facet,
  left_level: leftLevel,
  right_level: rightLevel,
  decision,
  comparison,
  reasons,
  unauthenticated_claim: unauthenticatedClaim
});

/**
 * Whether two results may be compared across one facet, as a `lib/decision.mjs` tri-state and the
 * comparison word it projects to: null/WITHHELD without establishing evidence, false/REFUSED when
 * DIF was detected, true/PERMITTED only when a conforming study with adequate samples found none.
 * An undeclared level on either side withholds -- absence is not equality.
 *
 * Closed by construction (module docstring): PERMITTED is reachable only from `leftLevel ===
 * rightLevel` -- comparing a level to itself is not a claim about invariance, it needs no study at
 * all -- never from `invariance_evidence`, however complete a caller's DIF report is. A complete
 * report's own reported verdict is recorded on `unauthenticated_claim`, not converted into
 * PERMITTED, because AOS has no trust root for a study it did not run.
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
  // A slot is not an observation and a property is not a statistic: thirty `null` entries per group
  // satisfied the length check alone, and an empty `{}` per anchor satisfied `hasOwnProperty` alone,
  // so a report could name its declared inputs and outputs with no real response and no computed
  // statistic behind any of them and still reach the verdict below. Each response now has to be an
  // actual observation (not `null`/`undefined`), and each anchor's statistics an actual non-empty
  // computed record.
  const evidenceComplete = anchors.length > 0 &&
    responses !== null && typeof responses === "object" &&
    [leftLevel, rightLevel].every((level) => Array.isArray(responses[level]) &&
      responses[level].length >= DIF_RUNNER_INTERFACE.minimum_sample_per_group &&
      responses[level].every((response) => response !== null && response !== undefined)) &&
    statistics !== null && typeof statistics === "object" &&
    anchors.every((anchor) => {
      const perAnchor = statistics[anchor];
      return Object.prototype.hasOwnProperty.call(statistics, anchor) &&
        perAnchor !== null && typeof perAnchor === "object" && Object.keys(perAnchor).length > 0;
    });
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
  // #585 (this round). This is the branch a complete, well-formed DIF report reaches: every
  // declared input present, adequate samples per group, no detected differential functioning. It is
  // also the one branch closed by construction (module docstring) -- a study AOS did not run is
  // still unauthenticated however completely it is reported, so this never returns PERMITTED. What
  // the report claimed is recorded on `unauthenticated_claim` instead.
  return gateAnswer(facet, leftLevel, rightLevel, null, "WITHHELD",
    ["AOS_COMPARISON_UNAUTHENTICATED AOS has no trust root for externally-produced DIF studies -- no signed study, no attested producer, no data AOS itself recorded -- so a complete study reporting no detected differential functioning is recorded as an unauthenticated claim and never converted into a PERMITTED verdict"],
    deepFreeze({ claimed_comparison: "PERMITTED", reported_dif_detected: evidence.dif_detected }));
}
