import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "./core.mjs";
import { fileByteDigest, sha256Bytes } from "./digest.mjs";
import { validateAgainstSchema } from "./json-schema.mjs";
import { NOT_OBSERVED } from "./metrics.mjs";
import { validateOperatorEvent } from "./operator-events.mjs";
import { routeOracleDigest } from "./routing-oracle.mjs";

// Reliance is a behavioural transition, not an AI-use counter.  In particular, the operator's
// initial judgment is evidence only while the assessor can establish that it was committed before
// advice became available.  `createRelianceTrace` therefore writes an authenticated, append-only
// sequence, and `deriveRelianceProfile` only accepts its replay.  A stored profile is never input
// to this module: the entries beside it are.
//
// Authority is intentionally split below.  The two keys are distinct capabilities: an operator
// event is checked with the operator-event key, while this instrument alone authenticates the
// event sequence and its head with the instrument key.  Neither key is persisted by this module.
//
// - `initial`, `inspection`, and `final` contain authenticated operator events.  These are
//   declarations of a decision, attested with the operator-event authority key.
// - `advice_reveal`, `oracle`, and `outcome` are observations by the instrument/verifier process.
//   Their HMAC uses the instrument key; they are not fields an operator event can author.
//
// The HMAC chain does not identify a person.  It gives the verifier something much narrower and
// necessary: an edited, inserted, or reordered trace cannot recreate the instrument's observation.

// A field that changes the event's evidence meaning gets a new identity.  v4 named a source, but
// a source alone did not show a reader whether a turn was directly observed HIGH evidence or a
// relay-attested MEDIUM turn.  v5 projects the authenticated authority triple rather than changing
// the incomplete v4 contract underneath records that already name it.
export const RELIANCE_EVENT_SCHEMA_ID = "aos-reliance-event.v5";
export const RELIANCE_EVENT_SCHEMA_URL = new URL("../reliance-events/aos-reliance-event.v5.schema.json", import.meta.url);
export const RELIANCE_OPPORTUNITY_FLOOR_URL = new URL("../reliance-events/opportunity-floor.v1.json", import.meta.url);
export const RELIANCE_TRACE_SCHEMA_ID = "aos-reliance-trace.v1";
export const RELIANCE_VERIFIER_ID = RELIANCE_EVENT_SCHEMA_ID;

export const RELIANCE_KINDS = Object.freeze(["initial", "advice_reveal", "oracle", "inspection", "final", "outcome"]);
export const RELIANCE_METRIC_IDS = Object.freeze([
  "cair", "csr", "overreliance", "underreliance", "switch_gain", "switch_harm",
  "delegation_regret", "adoption_quality", "choice_independence", "confidence_calibration"
]);
export const DELEGATION_EXPECTATIONS = Object.freeze(["BENEFICIAL", "HARMFUL", "NEUTRAL", "UNCERTAIN"]);
export const ADVICE_ERROR_TYPES = Object.freeze(["none", "systematic", "rare-large", "continuous-small", "omission"]);
export const FINAL_ACTIONS = Object.freeze(["adopt", "reject", "modify"]);
export const PROACTIVE_DELEGATION_VALUES = Object.freeze(["DELEGATE", "DECIDE_ALONE"]);
export const SKIP_OR_REFUSAL_VALUES = Object.freeze(["NONE", "SKIP", "REFUSAL"]);

// Keep recognized predecessor identities readable as their own historical records.  A record from
// a known predecessor is not a forged current record; it is named with the binding this verifier
// cannot reconstruct.  An unfamiliar identity remains unknown rather than accused.
export const RELIANCE_EVENT_GENERATIONS = Object.freeze([
  "aos-reliance-event.v2",
  "aos-reliance-event.v3",
  "aos-reliance-event.v4",
  RELIANCE_EVENT_SCHEMA_ID
]);
export const RELIANCE_EVENT_PREDATES = Object.freeze({
  "aos-reliance-event.v2": "it was written before initial and final commitment digests, so this build cannot bind its projected correctness to the ordered operator values",
  "aos-reliance-event.v3": "it was written before the projected source distinguished a relay observation from a direct local turn",
  "aos-reliance-event.v4": "it named the projected source but not the authenticated authority, provenance, and confidence that distinguish relay MEDIUM evidence from direct HIGH evidence"
});

export function relianceEventGeneration(event) {
  const schemaId = event?.schema_id ?? null;
  if (schemaId === RELIANCE_EVENT_SCHEMA_ID) return Object.freeze({ schema_id: schemaId, generation: "CURRENT", predates: null });
  if (typeof schemaId === "string" && RELIANCE_EVENT_GENERATIONS.includes(schemaId)) {
    return Object.freeze({ schema_id: schemaId, generation: "SUPERSEDED", predates: RELIANCE_EVENT_PREDATES[schemaId] ?? null });
  }
  return Object.freeze({ schema_id: schemaId, generation: "UNKNOWN", predates: null });
}

export const loadRelianceEventSchema = () => JSON.parse(readFileSync(RELIANCE_EVENT_SCHEMA_URL, "utf8"));
export const loadRelianceOpportunityFloor = () => JSON.parse(readFileSync(RELIANCE_OPPORTUNITY_FLOOR_URL, "utf8"));
export const relianceEventSchemaDigest = () => fileByteDigest(RELIANCE_EVENT_SCHEMA_URL);
export const relianceOpportunityFloorDigest = () => fileByteDigest(RELIANCE_OPPORTUNITY_FLOOR_URL);

const floor = () => loadRelianceOpportunityFloor();
export const RELIANCE_OPPORTUNITY_FLOOR = floor().metric_eligible_opportunities;
export const RELIANCE_CONFIDENCE_OBSERVATION_FLOOR = floor().confidence_observations;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RELIANCE_ID = /^rel-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const OPERATOR_EVENT_ID = /^operator-[A-Za-z0-9._-]+$/u;
const CONSTRUCT_CELL_ID = /^C3\.[A-Z]{2}\.[0-9]{2}$/u;
const PAIR_ID = /^pair-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const isConfidence = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const sameDigest = (left, right) => typeof left === "string" && typeof right === "string" && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const failure = (code, detail) => { throw new Error(`${code} ${detail}`); };

const assertJournal = (journal) => {
  if (!journal || typeof journal.record !== "function" || typeof journal.read !== "function" || typeof journal.readHead !== "function") {
    failure("AOS_RELIANCE_JOURNAL_REQUIRED", "a reliance trace needs durable record(entry, head), read(), and readHead() methods; an append-only tail without its committed head cannot establish what was retained");
  }
  return journal;
};

const traceMaterial = (entry) => ({
  schema_id: entry.schema_id,
  event_id: entry.event_id,
  run_id: entry.run_id,
  sequence: entry.sequence,
  kind: entry.kind,
  opportunity_id: entry.opportunity_id,
  previous_event_digest: entry.previous_event_digest,
  payload: entry.payload
});

const canonicalTraceMaterial = (material) => {
  try {
    return canonicalJson(material);
  } catch {
    failure("AOS_RELIANCE_CANONICAL_INPUT", "a trace observation must be canonical JSON before the instrument can authenticate it");
  }
};

/** The binding an independent verifier re-derives before reading any claimed metric. */
export function relianceTraceEventDigest(entry, secret) {
  if (!isNonEmptyString(secret)) failure("AOS_RELIANCE_KEY_MISSING", "the verifier has no reliance trace key");
  return `sha256:${createHmac("sha256", secret).update(Buffer.from(canonicalTraceMaterial(traceMaterial(entry)), "utf8")).digest("hex")}`;
}

const traceHeadMaterial = (head) => ({
  schema_id: head.schema_id,
  run_id: head.run_id,
  entry_count: head.entry_count,
  final_event_digest: head.final_event_digest
});

export function relianceTraceHeadDigest(head, secret) {
  if (!isNonEmptyString(secret)) failure("AOS_RELIANCE_INSTRUMENT_KEY_MISSING", "the verifier has no instrument-held trace key");
  return `sha256:${createHmac("sha256", secret).update(Buffer.from(canonicalTraceMaterial(traceHeadMaterial(head)), "utf8")).digest("hex")}`;
}

const requireEvidenceIds = (value, name) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => !isNonEmptyString(id))) {
    failure("AOS_RELIANCE_EVIDENCE_REQUIRED", `${name} must name one or more evidence ids; absence is not an empty neutral observation`);
  }
  if (new Set(value).size !== value.length) failure("AOS_RELIANCE_EVIDENCE_DUPLICATE", `${name} repeats an evidence id`);
  return [...value];
};

const requireDigest = (value, name) => {
  if (!isNonEmptyString(value) || !DIGEST.test(value)) failure("AOS_RELIANCE_DIGEST_REQUIRED", `${name} must be sha256:<64 lowercase hex>`);
  return value;
};

const assertPayloadKeys = (payload, allowed, role) => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    failure("AOS_RELIANCE_PAYLOAD_SHAPE", `${role} must be one event payload`);
  }
  const unexpected = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    failure("AOS_RELIANCE_PAYLOAD_BUNDLED", `${role} carries fields for another phase (${unexpected.sort().join(", ")}); a pre-advice commitment cannot contain a post-advice response`);
  }
};

const assertOperatorEvent = (event, role, expectedType, runId, operatorSecret, operatorOpportunityId, seenOperatorEventIds, observedSource = null) => {
  // `source` inside the operator event is a declaration.  A relay event is admitted only when the
  // producer gives this trace the separately observed call-site source; feeding `event.source`
  // back here would merely compare an agent-controlled record to itself.  Direct/local producers
  // predate this relay boundary and retain their existing validator path.
  if (event?.source === "agent-relay" && observedSource !== "agent-relay") {
    failure("AOS_RELIANCE_OPERATOR_EVENT_SOURCE_BOUNDARY", `${role} is an agent-relay event without the relay's observed call-site source; a declaration in the event is not an observation`);
  }
  const verdict = validateOperatorEvent(event, {
    run_id: runId,
    secret: operatorSecret,
    ...(event?.source === "agent-relay" ? { source: observedSource } : {})
  });
  if (verdict?.accepted !== true) failure("AOS_RELIANCE_OPERATOR_EVENT_UNVERIFIED", `${role} was not established by the trusted operator-event authority`);
  if (event?.run_id !== runId) failure("AOS_RELIANCE_RUN_MISMATCH", `${role} belongs to another run`);
  if (event?.decision_type !== expectedType) failure("AOS_RELIANCE_OPERATOR_EVENT_TYPE", `${role} must be ${expectedType}`);
  if (!isNonEmptyString(event?.event_id) || !isNonEmptyString(event?.opportunity_id) || !isNonEmptyString(event?.construct_cell_id)) {
    failure("AOS_RELIANCE_OPERATOR_EVENT_SHAPE", `${role} lacks its event, opportunity, or construct reference`);
  }
  if (!OPERATOR_EVENT_ID.test(event.event_id)) failure("AOS_RELIANCE_OPERATOR_EVENT_ID", `${role} needs an operator event id`);
  if (!CONSTRUCT_CELL_ID.test(event.construct_cell_id)) failure("AOS_RELIANCE_CONSTRUCT_CELL_ID", `${role} needs a C3 construct cell id`);
  if (event.opportunity_id !== operatorOpportunityId) failure("AOS_RELIANCE_OPERATOR_EVENT_OPPORTUNITY", `${role} operator event belongs to ${event.opportunity_id}, not ${operatorOpportunityId}`);
  requireDigest(event.value_digest, `${role} committed value`);
  if (seenOperatorEventIds?.has(event.event_id)) failure("AOS_RELIANCE_OPERATOR_EVENT_REUSED", `${role} reuses ${event.event_id}; an operator event can commit one reliance slot once`);
  seenOperatorEventIds?.add(event.event_id);
  return event;
};

const assertChoiceIndependence = (choice) => {
  if (choice === undefined) return;
  assertPayloadKeys(choice, ["pair_id", "current_evidence_digest", "unrelated_prior_ai_error"], "choice-independence sentinel");
  if (!PAIR_ID.test(choice?.pair_id ?? "") || typeof choice.unrelated_prior_ai_error !== "boolean") {
    failure("AOS_RELIANCE_CHOICE_SHAPE", "choice independence needs a pair id and its unrelated-prior-error condition");
  }
  requireDigest(choice.current_evidence_digest, "choice-independence current evidence");
};

const assertInitial = (payload, runId, operatorSecret, seenOperatorEventIds) => {
  assertPayloadKeys(payload, ["opportunity_id", "operator_opportunity_id", "task_form_id", "operator_event", "operator_event_source", "delegation", "forcing", "choice_independence"], "initial judgment");
  if (!RELIANCE_ID.test(payload?.opportunity_id ?? "")) failure("AOS_RELIANCE_OPPORTUNITY_ID", "an opportunity id starts with rel-");
  if (!isNonEmptyString(payload?.operator_opportunity_id)) failure("AOS_RELIANCE_OPERATOR_OPPORTUNITY_REQUIRED", "an opportunity must name the operator-event opportunity it binds");
  if (!isNonEmptyString(payload?.task_form_id)) failure("AOS_RELIANCE_TASK_FORM_REQUIRED", "an opportunity must name the form that administered it");
  const forcing = payload.forcing;
  if (!forcing || typeof forcing !== "object" || Array.isArray(forcing) || !isNonEmptyString(forcing.forcing_protocol_id) || !Number.isInteger(forcing.burden_interaction_count) || forcing.burden_interaction_count < 0 || !SKIP_OR_REFUSAL_VALUES.includes(forcing.skip_or_refusal) || typeof forcing.timeout !== "boolean" || !isNonEmptyString(forcing.interface)) {
    failure("AOS_RELIANCE_FORCING_PROVENANCE", "the intervention must record its protocol, burden, skip/refusal, timeout, and interface; absence is not a default");
  }
  const event = assertOperatorEvent(payload.operator_event, "initial judgment", "initial.judgment", runId, operatorSecret, payload.operator_opportunity_id, seenOperatorEventIds, payload.operator_event_source);
  if (!isConfidence(event.reported_confidence)) failure("AOS_RELIANCE_INITIAL_CONFIDENCE", "the initial judgment has no stated confidence");
  requireEvidenceIds(event.named_evidence_ids, "the initial judgment");
  if (!PROACTIVE_DELEGATION_VALUES.includes(event.proactive_delegation)) {
    failure("AOS_RELIANCE_DELEGATION_REQUIRED", "the initial operator event does not state a proactive delegation decision");
  }
  const delegation = payload.delegation;
  if (!delegation || typeof delegation.chosen !== "boolean" || !DELEGATION_EXPECTATIONS.includes(delegation.oracle_expected_value)) {
    failure("AOS_RELIANCE_DELEGATION_SHAPE", "the delegation reference must state chosen and the oracle's expected value");
  }
  const expectedChosen = event.proactive_delegation === PROACTIVE_DELEGATION_VALUES[0];
  if (delegation.chosen !== expectedChosen) failure("AOS_RELIANCE_DELEGATION_MISMATCH", "the stored delegation claim disagrees with the pre-advice operator event");
  const oracle = delegation.route_oracle;
  if (oracle === null || typeof oracle !== "object" || Array.isArray(oracle)) failure("AOS_RELIANCE_ROUTE_ORACLE_REQUIRED", "delegation needs the raw route-oracle record, not a digest it claims for itself");
  const recomputedOracleDigest = routeOracleDigest(oracle);
  if (!sameDigest(recomputedOracleDigest, oracle.route_oracle_digest)) {
    failure("AOS_RELIANCE_ROUTE_ORACLE_BINDING", "the route-oracle digest does not follow from the route-oracle record");
  }
  assertChoiceIndependence(payload.choice_independence);
};

const assertAdviceReveal = (payload) => {
  assertPayloadKeys(payload, ["opportunity_id", "proposal_evidence_digest"], "advice reveal");
  requireDigest(payload?.proposal_evidence_digest, "the revealed proposal");
};

const assertOracle = (payload, revealed) => {
  assertPayloadKeys(payload, ["opportunity_id", "advice"], "hidden oracle");
  const advice = payload?.advice;
  if (!advice || typeof advice.correct !== "boolean" || !ADVICE_ERROR_TYPES.includes(advice.error_type) || !isNonEmptyString(advice.domain)) {
    failure("AOS_RELIANCE_ADVICE_SHAPE", "the hidden oracle must state advice correctness, error type, and domain");
  }
  requireDigest(advice.evidence_digest, "the hidden oracle evidence");
  if (!revealed || !sameDigest(advice.evidence_digest, revealed.proposal_evidence_digest)) {
    failure("AOS_RELIANCE_ADVICE_REVEAL_BINDING", "the hidden oracle must grade the proposal digest that the advice reveal committed");
  }
  if ((advice.correct === true && advice.error_type !== "none") || (advice.correct === false && advice.error_type === "none")) {
    failure("AOS_RELIANCE_ADVICE_INCONSISTENT", "correct advice has error type none and incorrect advice names its error type");
  }
};

const assertInspection = (payload, runId, operatorSecret, operatorOpportunityId, seenOperatorEventIds) => {
  assertPayloadKeys(payload, ["opportunity_id", "observed", "operator_event", "operator_event_source"], "inspection");
  if (typeof payload?.observed !== "boolean") failure("AOS_RELIANCE_INSPECTION_REQUIRED", "the trace must say whether advice was inspected");
  if (payload.observed === false) {
    if (payload.operator_event !== undefined) failure("AOS_RELIANCE_INSPECTION_INCONSISTENT", "an unobserved inspection has no operator inspection event");
    return;
  }
  const event = assertOperatorEvent(payload?.operator_event, "inspection", "checkpoint.observe", runId, operatorSecret, operatorOpportunityId, seenOperatorEventIds, payload.operator_event_source);
  requireEvidenceIds(event.named_evidence_ids, "the inspection event");
};

const assertFinal = (payload, runId, operatorSecret, operatorOpportunityId, seenOperatorEventIds) => {
  assertPayloadKeys(payload, ["opportunity_id", "action", "operator_event", "operator_event_source"], "final response");
  if (!FINAL_ACTIONS.includes(payload?.action)) failure("AOS_RELIANCE_FINAL_ACTION", "the final response must be adopt, reject, or modify");
  const event = assertOperatorEvent(payload.operator_event, "final response", "advice.response", runId, operatorSecret, operatorOpportunityId, seenOperatorEventIds, payload.operator_event_source);
  if (!isConfidence(event.reported_confidence)) failure("AOS_RELIANCE_FINAL_CONFIDENCE", "the final response has no stated confidence");
  requireEvidenceIds(event.named_evidence_ids, "the final response");
};

const assertOutcome = (payload, initialEvent, finalEvent) => {
  assertPayloadKeys(payload, ["opportunity_id", "initial_correct", "initial_value_digest", "final_correct", "final_value_digest", "verified_outcome_evidence_ids", "relay_provenance"], "verified outcome");
  if (typeof payload?.initial_correct !== "boolean" || typeof payload?.final_correct !== "boolean") {
    failure("AOS_RELIANCE_OUTCOME_REQUIRED", "the independent outcome verifier must state both initial and final correctness");
  }
  requireDigest(payload.initial_value_digest, "the outcome's initial commitment");
  requireDigest(payload.final_value_digest, "the outcome's final commitment");
  if (!initialEvent || !finalEvent || !sameDigest(payload.initial_value_digest, initialEvent.value_digest) || !sameDigest(payload.final_value_digest, finalEvent.value_digest)) {
    failure("AOS_RELIANCE_OUTCOME_COMMITMENT_BINDING", "the outcome must grade the initial and final values their ordered operator events committed");
  }
  requireEvidenceIds(payload.verified_outcome_evidence_ids, "the verified outcome");
  const relay = payload.relay_provenance;
  if (initialEvent?.source === "agent-relay") {
    if (!relay || relay.initial_before_advice_proof !== true || !DIGEST.test(relay.relay_protocol_digest ?? "")) {
      failure("AOS_RELIANCE_RELAY_PROVENANCE_REQUIRED", "an agent-relay outcome needs the relay's established initial-before-advice proof and protocol digest");
    }
  } else if (relay !== undefined) {
    failure("AOS_RELIANCE_RELAY_PROVENANCE_UNEXPECTED", "only an agent-relay outcome can project relay provenance");
  }
};

const assertPayloadOpportunity = (payload, opportunityId, role) => {
  if (payload?.opportunity_id !== opportunityId) failure("AOS_RELIANCE_PAYLOAD_OPPORTUNITY", `${role} payload belongs to ${String(payload?.opportunity_id)}, not ${opportunityId}`);
};

const assertionFor = (kind, payload, runId, operatorSecret, { opportunityId, previous = new Map(), seenOperatorEventIds } = {}) => {
  assertPayloadOpportunity(payload, opportunityId, kind);
  if (kind === "initial") return assertInitial(payload, runId, operatorSecret, seenOperatorEventIds);
  if (kind === "advice_reveal") return assertAdviceReveal(payload);
  if (kind === "oracle") return assertOracle(payload, previous.get("advice_reveal")?.payload);
  if (kind === "inspection") return assertInspection(payload, runId, operatorSecret, previous.get("initial")?.payload.operator_opportunity_id, seenOperatorEventIds);
  if (kind === "final") return assertFinal(payload, runId, operatorSecret, previous.get("initial")?.payload.operator_opportunity_id, seenOperatorEventIds);
  if (kind === "outcome") return assertOutcome(payload, previous.get("initial")?.payload.operator_event, previous.get("final")?.payload.operator_event);
  failure("AOS_RELIANCE_TRACE_KIND", `${String(kind)} is not a reliance trace event`);
};

const expectedKind = (entries, opportunityId) => {
  const count = entries.filter((entry) => entry.opportunity_id === opportunityId).length;
  return RELIANCE_KINDS[count] ?? null;
};

const headFor = (entryCount, finalEventDigest, runId, instrumentSecret) => {
  const head = {
    schema_id: RELIANCE_TRACE_SCHEMA_ID,
    run_id: runId,
    entry_count: entryCount,
    final_event_digest: finalEventDigest
  };
  return { ...head, head_digest: relianceTraceHeadDigest(head, instrumentSecret) };
};

const assertHeadForState = (head, entryCount, finalEventDigest, runId, instrumentSecret) => {
  if (!head || head.schema_id !== RELIANCE_TRACE_SCHEMA_ID || head.run_id !== runId || !Number.isInteger(head.entry_count) || head.entry_count < 0 || (head.final_event_digest !== null && !DIGEST.test(head.final_event_digest))) {
    failure("AOS_RELIANCE_TRACE_HEAD_SHAPE", "the trace needs a signed head naming its run, entry count, and final event digest");
  }
  const expected = relianceTraceHeadDigest(head, instrumentSecret);
  if (!sameDigest(expected, head.head_digest)) failure("AOS_RELIANCE_TRACE_HEAD_BINDING", "the trace head was not authenticated by the instrument");
  if (head.entry_count !== entryCount || head.final_event_digest !== finalEventDigest) {
    failure("AOS_RELIANCE_TRACE_TRUNCATED", "the journal entries do not match the signed trace head; an append-only trace cannot omit its tail");
  }
};

const assertHead = (head, entries, runId, instrumentSecret) =>
  assertHeadForState(head, entries.length, entries.at(-1)?.event_digest ?? null, runId, instrumentSecret);

const priorEventsFor = (entries, opportunityId) => new Map(entries
  .filter((entry) => entry.opportunity_id === opportunityId)
  .map((entry) => [entry.kind, entry]));

const readVerifiedEntries = ({ run_id: runId, operator_secret: operatorSecret, instrument_secret: instrumentSecret, journal }) => {
  assertJournal(journal);
  const entries = journal.read();
  if (!Array.isArray(entries)) failure("AOS_RELIANCE_JOURNAL_SHAPE", "the reliance journal did not return an event array");
  let previous = null;
  const seenOperatorEventIds = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.schema_id !== RELIANCE_TRACE_SCHEMA_ID || entry.run_id !== runId || entry.sequence !== index + 1 || !RELIANCE_KINDS.includes(entry.kind)) {
      failure("AOS_RELIANCE_TRACE_SHAPE", `trace entry ${index + 1} has no valid schema, run, sequence, or kind`);
    }
    if (entry.previous_event_digest !== previous) failure("AOS_RELIANCE_TRACE_ORDER", `trace entry ${index + 1} is not bound to the preceding observed event`);
    const expected = expectedKind(entries.slice(0, index), entry.opportunity_id);
    if (entry.kind !== expected) failure("AOS_RELIANCE_TRACE_ORDER", `${entry.opportunity_id} recorded ${entry.kind} where ${expected ?? "no further event"} was required`);
    const rebound = relianceTraceEventDigest(entry, instrumentSecret);
    if (!sameDigest(rebound, entry.event_digest)) failure("AOS_RELIANCE_TRACE_BINDING", `trace entry ${index + 1} was edited, inserted, or reordered after observation`);
    assertionFor(entry.kind, entry.payload, runId, operatorSecret, {
      opportunityId: entry.opportunity_id,
      previous: priorEventsFor(entries.slice(0, index), entry.opportunity_id),
      seenOperatorEventIds
    });
    previous = entry.event_digest;
  }
  assertHead(journal.readHead(), entries, runId, instrumentSecret);
  return entries;
};

/**
 * Writes the six evidence-bearing events that implement the nine conceptual sequence.  Initial
 * confidence/evidence/delegation are deliberately one atomic operator event; final action and
 * final confidence/evidence are likewise one observed response.  Splitting either would let a
 * payload be assembled after advice was visible.
 */
export function createRelianceTrace({ run_id: runId, operator_secret: operatorSecret, instrument_secret: instrumentSecret, journal } = {}) {
  assertJournal(journal);
  if (!isNonEmptyString(runId)) failure("AOS_RELIANCE_RUN_REQUIRED", "a reliance trace belongs to one run");
  if (!isNonEmptyString(operatorSecret)) failure("AOS_RELIANCE_OPERATOR_KEY_MISSING", "a reliance trace requires the operator-event authority key");
  if (!isNonEmptyString(instrumentSecret)) failure("AOS_RELIANCE_INSTRUMENT_KEY_MISSING", "a reliance trace requires the instrument-held trace key");
  if (operatorSecret === instrumentSecret) failure("AOS_RELIANCE_KEY_SEPARATION", "operator-event and instrument trace keys must be distinct capabilities");
  const initialHead = journal.readHead();
  let verifiedEntries;
  if (initialHead === null || initialHead === undefined) {
    if (journal.read().length !== 0) failure("AOS_RELIANCE_TRACE_HEAD_REQUIRED", "a non-empty trace cannot be adopted without its signed head");
    journal.record(null, headFor(0, null, runId, instrumentSecret));
    verifiedEntries = [];
  } else {
    verifiedEntries = readVerifiedEntries({ run_id: runId, operator_secret: operatorSecret, instrument_secret: instrumentSecret, journal });
  }

  // The prefix is replayed exactly once when this writer opens it.  Later appends check its signed
  // head and validate only the candidate entry; rereading the entire prefix here turns a long trace
  // into quadratic work and repeats operator-event verification that already succeeded.
  const appendState = {
    entries: verifiedEntries.map((entry) => structuredClone(entry)),
    eventsByOpportunity: new Map(),
    seenOperatorEventIds: new Set()
  };
  for (const entry of appendState.entries) {
    const events = appendState.eventsByOpportunity.get(entry.opportunity_id) ?? new Map();
    events.set(entry.kind, entry);
    appendState.eventsByOpportunity.set(entry.opportunity_id, events);
    if (["initial", "inspection", "final"].includes(entry.kind) && entry.payload.operator_event !== undefined) {
      appendState.seenOperatorEventIds.add(entry.payload.operator_event.event_id);
    }
  }

  const append = (kind, payload) => {
    const entries = appendState.entries;
    assertHeadForState(journal.readHead(), entries.length, entries.at(-1)?.event_digest ?? null, runId, instrumentSecret);
    const opportunityId = payload?.opportunity_id;
    const prior = appendState.eventsByOpportunity.get(opportunityId) ?? new Map();
    const expected = RELIANCE_KINDS[prior.size] ?? null;
    if (kind !== expected) failure("AOS_RELIANCE_TRACE_ORDER", `${String(opportunityId)} cannot record ${kind} before ${expected ?? "a new opportunity"}`);
    const seenOperatorEventIds = new Set(appendState.seenOperatorEventIds);
    assertionFor(kind, payload, runId, operatorSecret, {
      opportunityId,
      previous: prior,
      seenOperatorEventIds
    });
    const previous = entries.at(-1)?.event_digest ?? null;
    const entry = {
      schema_id: RELIANCE_TRACE_SCHEMA_ID,
      event_id: `reliance-${randomUUID()}`,
      run_id: runId,
      sequence: entries.length + 1,
      kind,
      opportunity_id: opportunityId,
      previous_event_digest: previous,
      payload: structuredClone(payload)
    };
    entry.event_digest = relianceTraceEventDigest(entry, instrumentSecret);
    const completed = new Map(prior);
    completed.set(kind, entry);
    // A completed opportunity is projected with the same function and v4 schema used by
    // derivation.  An append-only journal must reject anything its reader would later reject.
    if (kind === "outcome") relianceEventFrom(opportunityId, completed, loadRelianceEventSchema());
    const nextHead = headFor(entries.length + 1, entry.event_digest, runId, instrumentSecret);
    journal.record(entry, nextHead);
    assertHeadForState(journal.readHead(), entries.length + 1, entry.event_digest, runId, instrumentSecret);
    entries.push(structuredClone(entry));
    appendState.eventsByOpportunity.set(opportunityId, completed);
    appendState.seenOperatorEventIds = seenOperatorEventIds;
    return structuredClone(entry);
  };

  return Object.freeze({
    commitInitial: (payload) => append("initial", payload),
    revealAdvice: (payload) => append("advice_reveal", payload),
    recordOracle: (payload) => append("oracle", payload),
    recordInspection: (payload) => append("inspection", payload),
    recordFinal: (payload) => append("final", payload),
    recordOutcome: (payload) => append("outcome", payload),
    entries: () => readVerifiedEntries({ run_id: runId, operator_secret: operatorSecret, instrument_secret: instrumentSecret, journal }).map((entry) => structuredClone(entry))
  });
}

// This is the only v5 projection.  Both the write path (before it appends a completed sequence)
// and the read path use it, so a completed record cannot be durable unless a later derivation can
// consume it.
const relianceEventFrom = (opportunityId, events, schema) => {
  const initial = events.get("initial").payload;
  const revealed = events.get("advice_reveal").payload;
  const oracle = events.get("oracle").payload.advice;
  const inspection = events.get("inspection").payload;
  const final = events.get("final").payload;
  const outcome = events.get("outcome").payload;
  const routeDigest = routeOracleDigest(initial.delegation.route_oracle);
  const event = {
    schema_id: RELIANCE_EVENT_SCHEMA_ID,
    opportunity_id: opportunityId,
    construct_cell_id: initial.operator_event.construct_cell_id,
    task_form_id: initial.task_form_id,
    initial_operator_event_id: initial.operator_event.event_id,
    // All four values are derived from the authenticated initial operator event, never from a
    // profile or checkpoint field.  `source` alone said where the turn arrived but left its
    // authority reading implicit.  Publishing the complete triple lets a reader distinguish an
    // agent-relay LOCAL_OWNER_RELAY / RELAY_ATTESTED / MEDIUM turn from direct HIGH evidence.
    source: initial.operator_event.source,
    authority: initial.operator_event.authority,
    provenance: initial.operator_event.provenance,
    confidence: initial.operator_event.confidence,
    forcing: structuredClone(initial.forcing),
    initial: {
      correct: outcome.initial_correct,
      commitment_digest: initial.operator_event.value_digest,
      confidence: initial.operator_event.reported_confidence,
      evidence_ids: [...initial.operator_event.named_evidence_ids]
    },
    delegation: {
      chosen: initial.delegation.chosen,
      oracle_expected_value: initial.delegation.oracle_expected_value,
      route_oracle_digest: routeDigest
    },
    advice: { ...oracle },
    inspection: inspection.observed === true
      ? { observed: true, evidence_ids: [...inspection.operator_event.named_evidence_ids] }
      : { observed: false, evidence_ids: [] },
    final: {
      action: final.action,
      correct: outcome.final_correct,
      commitment_digest: final.operator_event.value_digest,
      confidence: final.operator_event.reported_confidence,
      evidence_ids: [...final.operator_event.named_evidence_ids]
    },
    verified_outcome_evidence_ids: [...outcome.verified_outcome_evidence_ids],
    trace_event_ids: Object.fromEntries(RELIANCE_KINDS.map((kind) => [kind, events.get(kind).event_id]))
  };
  if (initial.choice_independence !== undefined) event.choice_independence = structuredClone(initial.choice_independence);
  if (outcome.relay_provenance !== undefined) event.relay_provenance = structuredClone(outcome.relay_provenance);
  if (!sameDigest(revealed.proposal_evidence_digest, oracle.evidence_digest)) {
    failure("AOS_RELIANCE_ADVICE_REVEAL_BINDING", "the projected advice must remain bound to the revealed proposal");
  }
  const checked = validateAgainstSchema(event, schema);
  if (!checked.ok) failure("AOS_RELIANCE_EVENT_SCHEMA_INVALID", checked.errors.map((error) => `${error.path} ${error.message}`).join("; "));
  return Object.freeze(event);
};

const opportunitiesFrom = (entries, schema) => {
  const byOpportunity = new Map();
  for (const entry of entries) {
    const bucket = byOpportunity.get(entry.opportunity_id) ?? new Map();
    bucket.set(entry.kind, entry);
    byOpportunity.set(entry.opportunity_id, bucket);
  }
  const complete = [];
  const incomplete = [];
  const unscorable = [];
  for (const [opportunityId, events] of [...byOpportunity.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const missing = RELIANCE_KINDS.filter((kind) => !events.has(kind));
    if (missing.length > 0) {
      incomplete.push(Object.freeze({ opportunity_id: opportunityId, reason: "INCOMPLETE_RELIANCE_SEQUENCE", missing }));
      continue;
    }
    const initial = events.get("initial").payload;
    if (initial.forcing.skip_or_refusal !== "NONE") {
      unscorable.push(Object.freeze({
        opportunity_id: opportunityId,
        reason: "INITIAL_JUDGMENT_SKIPPED_OR_REFUSED",
        skip_or_refusal: initial.forcing.skip_or_refusal
      }));
      continue;
    }
    complete.push(relianceEventFrom(opportunityId, events, schema));
  }
  return { complete: Object.freeze(complete), incomplete: Object.freeze(incomplete), unscorable: Object.freeze(unscorable) };
};

const rate = (cases, predicate, label, { metricFloor, operationalReasons }) => {
  const eligible = cases.map((one) => one.opportunity_ids).flat().sort();
  const passed = cases.filter(predicate);
  const passing = passed.map((one) => one.opportunity_ids).flat().sort();
  const numerator = passed.length;
  const denominator = cases.length;
  const status = denominator === 0 ? NOT_OBSERVED : denominator >= metricFloor && operationalReasons.length === 0 ? "ISSUED" : "WITHHELD";
  return Object.freeze({
    status,
    value: status === "ISSUED" ? numerator / denominator : null,
    numerator,
    denominator,
    eligible_opportunity_ids: eligible,
    opportunity_ids: passing,
    reason: status === "ISSUED"
      ? "OBSERVED"
      : status === NOT_OBSERVED
        ? NOT_OBSERVED
        : denominator < metricFloor
          ? "INSUFFICIENT_OPPORTUNITIES"
          : operationalReasons.join(","),
    label
  });
};

const adviceDistribution = (opportunities, categoryOf, { metricFloor }) => {
  const eligible = opportunities.map((one) => one.opportunity_id).sort();
  const denominator = eligible.length;
  const status = denominator === 0 ? NOT_OBSERVED : denominator >= metricFloor ? "ISSUED" : "WITHHELD";
  const counts = new Map();
  for (const opportunity of opportunities) {
    const category = categoryOf(opportunity);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Object.freeze({
    status,
    denominator,
    eligible_opportunity_ids: eligible,
    reason: status === "ISSUED" ? "OBSERVED" : status === NOT_OBSERVED ? NOT_OBSERVED : "INSUFFICIENT_OPPORTUNITIES",
    distribution: status === "ISSUED"
      ? Object.freeze(Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))))
      : null
  });
};

const oneOpportunity = (opportunities, predicate) => opportunities.filter(predicate).map((opportunity) => ({ opportunity_ids: [opportunity.opportunity_id], opportunity }));
const id = (caseRow) => caseRow.opportunity;

const adoptionAppropriate = (opportunity) => {
  if (opportunity.advice.correct === true) return opportunity.final.action === "adopt" || (opportunity.final.action === "modify" && opportunity.final.correct === true);
  return opportunity.final.action === "reject" || (opportunity.final.action === "modify" && opportunity.final.correct === true);
};

const choiceCases = (opportunities) => {
  const pairs = new Map();
  for (const opportunity of opportunities) {
    const choice = opportunity.choice_independence;
    if (!choice) continue;
    const pair = pairs.get(choice.pair_id) ?? [];
    pair.push(opportunity);
    pairs.set(choice.pair_id, pair);
  }
  const cases = [];
  const incompletePairs = [];
  for (const [pairId, pair] of [...pairs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const digests = new Set(pair.map((one) => one.choice_independence.current_evidence_digest));
    const conditions = new Set(pair.map((one) => one.choice_independence.unrelated_prior_ai_error));
    if (pair.length !== 2 || digests.size !== 1 || conditions.size !== 2 || !conditions.has(true) || !conditions.has(false)) {
      incompletePairs.push({ pair_id: pairId, opportunity_ids: pair.map((one) => one.opportunity_id).sort(), reason: "PAIR_NOT_SAME_CURRENT_EVIDENCE_PLUS_UNRELATED_ERROR_ONLY" });
      continue;
    }
    cases.push({ pair_id: pairId, opportunity_ids: pair.map((one) => one.opportunity_id).sort(), pair });
  }
  return { cases, incompletePairs };
};

const operationalCoverage = ({ opportunities, incomplete, unscorable, choices, floor: opportunityFloor, taskFormFamilyOf }) => {
  const correctAdvice = opportunities.filter((one) => one.advice.correct === true);
  const incorrectAdvice = opportunities.filter((one) => one.advice.correct === false);
  const errorTypes = new Set(incorrectAdvice.map((one) => one.advice.error_type));
  const families = new Set();
  const unknownTaskForms = new Set();
  for (const opportunity of opportunities) {
    const family = typeof taskFormFamilyOf === "function" ? taskFormFamilyOf(opportunity.task_form_id) : null;
    if (typeof family === "string" && /^FAM-[2-6]$/u.test(family)) families.add(family);
    else unknownTaskForms.add(opportunity.task_form_id);
  }
  const started = opportunities.length + incomplete.length + unscorable.length;
  const unmet = [];
  if (started < opportunityFloor.planned_opportunities_per_cycle) unmet.push("INSUFFICIENT_PLANNED_OPPORTUNITIES");
  if (incomplete.length > 0 || unscorable.length > 0) unmet.push("INCOMPLETE_RELIANCE_OPPORTUNITIES");
  if (correctAdvice.length < opportunityFloor.correct_advice_conditions) unmet.push("INSUFFICIENT_CORRECT_ADVICE_CONDITIONS");
  if (incorrectAdvice.length < opportunityFloor.incorrect_advice_conditions) unmet.push("INSUFFICIENT_INCORRECT_ADVICE_CONDITIONS");
  if (unknownTaskForms.size > 0) unmet.push("TASK_FORM_FAMILY_UNBOUND");
  if (families.size < opportunityFloor.families_represented) unmet.push("INSUFFICIENT_FAMILIES_REPRESENTED");
  if (errorTypes.size < opportunityFloor.incorrect_advice_error_types) unmet.push("INSUFFICIENT_INCORRECT_ADVICE_ERROR_TYPES");
  if (choices.cases.length < opportunityFloor.choice_independence_pairs) unmet.push("INSUFFICIENT_CHOICE_INDEPENDENCE_PAIRS");
  return Object.freeze({
    status: unmet.length === 0 ? "MET" : "WITHHELD",
    reasons: Object.freeze(unmet),
    planned_opportunities: { observed: started, required: opportunityFloor.planned_opportunities_per_cycle },
    complete_opportunities: opportunities.length,
    incomplete_opportunities: incomplete.length,
    unscorable_opportunities: unscorable.length,
    correct_advice_conditions: { observed: correctAdvice.length, required: opportunityFloor.correct_advice_conditions },
    incorrect_advice_conditions: { observed: incorrectAdvice.length, required: opportunityFloor.incorrect_advice_conditions },
    families_represented: { observed: [...families].sort(), required: opportunityFloor.families_represented, unbound_task_form_ids: [...unknownTaskForms].sort() },
    incorrect_advice_error_types: { observed: [...errorTypes].sort(), required: opportunityFloor.incorrect_advice_error_types },
    choice_independence_pairs: { observed: choices.cases.length, required: opportunityFloor.choice_independence_pairs }
  });
};

const confidenceMetric = (opportunities, { confidenceFloor, operationalReasons }) => {
  const observations = opportunities.flatMap((opportunity) => [
    { opportunity_id: opportunity.opportunity_id, phase: "initial", confidence: opportunity.initial.confidence, correct: opportunity.initial.correct },
    { opportunity_id: opportunity.opportunity_id, phase: "final", confidence: opportunity.final.confidence, correct: opportunity.final.correct }
  ]);
  const ids = observations.map((one) => `${one.opportunity_id}:${one.phase}`).sort();
  const denominator = observations.length;
  const correct = observations.filter((one) => one.correct === true);
  const incorrect = observations.filter((one) => one.correct === false);
  const loss = observations.reduce((sum, one) => sum + (one.confidence - (one.correct ? 1 : 0)) ** 2, 0);
  const brierScore = denominator === 0 ? null : loss / denominator;
  const calibrationInTheLarge = denominator === 0 ? null : observations.reduce((sum, one) => sum + one.confidence, 0) / denominator - correct.length / denominator;
  const discrimination = correct.length === 0 || incorrect.length === 0
    ? null
    : correct.reduce((sum, one) => sum + one.confidence, 0) / correct.length - incorrect.reduce((sum, one) => sum + one.confidence, 0) / incorrect.length;
  const observed = denominator >= confidenceFloor && discrimination !== null && operationalReasons.length === 0;
  const status = denominator === 0 ? NOT_OBSERVED : observed ? "ISSUED" : "WITHHELD";
  return Object.freeze({
    status,
    // This is calibration quality, not confidence credit: lower Brier loss is better.  The raw
    // Brier score remains beside this inversion so reports never mistake a high confidence for a
    // high score.
    value: observed ? 1 - brierScore : null,
    loss: status === "ISSUED" ? loss : null,
    denominator,
    eligible_opportunity_ids: opportunities.map((one) => one.opportunity_id).sort(),
    opportunity_ids: ids,
    reason: status === NOT_OBSERVED
      ? NOT_OBSERVED
      : denominator < confidenceFloor
        ? "INSUFFICIENT_CONFIDENCE_OBSERVATIONS"
        : discrimination === null
          ? "DISCRIMINATION_NOT_OBSERVED"
          : operationalReasons.length > 0
            ? operationalReasons.join(",")
            : "OBSERVED",
    brier_score: status === "ISSUED" ? brierScore : null,
    calibration_in_the_large: status === "ISSUED" ? calibrationInTheLarge : null,
    confidence_accuracy_gap: status === "ISSUED" && calibrationInTheLarge !== null ? Math.abs(calibrationInTheLarge) : null,
    discrimination: status === "ISSUED" ? discrimination : null,
    observation_count: denominator
  });
};

/**
 * Replays authenticated entries.  It cannot be handed pre-computed metric values, so an artifact
 * is never accepted as the authority for the score it carries.
 */
const contractSnapshot = () => {
  const schemaBytes = readFileSync(RELIANCE_EVENT_SCHEMA_URL);
  const floorBytes = readFileSync(RELIANCE_OPPORTUNITY_FLOOR_URL);
  return Object.freeze({
    schema: JSON.parse(schemaBytes.toString("utf8")),
    schema_digest: sha256Bytes(schemaBytes),
    floor: JSON.parse(floorBytes.toString("utf8")),
    floor_digest: sha256Bytes(floorBytes)
  });
};

const aggregateStatus = (metrics) => {
  const states = Object.values(metrics).map((metric) => metric.status);
  const counts = Object.freeze(Object.fromEntries(["ISSUED", "WITHHELD", NOT_OBSERVED].map((state) => [state, states.filter((value) => value === state).length])));
  let status;
  if (counts.ISSUED === states.length) status = "ISSUED";
  else if (counts[NOT_OBSERVED] === states.length) status = NOT_OBSERVED;
  else if (counts[NOT_OBSERVED] > 0 && (counts.ISSUED > 0 || counts.WITHHELD > 0)) status = "PARTIALLY_NOT_OBSERVED";
  else if (counts.ISSUED > 0) status = "PARTIAL";
  else status = "WITHHELD";
  return Object.freeze({ status, metric_status_counts: counts });
};

export function deriveRelianceProfile({ run_id: runId, operator_secret: operatorSecret, instrument_secret: instrumentSecret, journal, taskFormFamilyOf } = {}) {
  const entries = readVerifiedEntries({ run_id: runId, operator_secret: operatorSecret, instrument_secret: instrumentSecret, journal });
  const snapshot = contractSnapshot();
  const { complete: opportunities, incomplete, unscorable } = opportunitiesFrom(entries, snapshot.schema);
  const cairCases = oneOpportunity(opportunities, (one) => one.initial.correct === false && one.advice.correct === true);
  const csrCases = oneOpportunity(opportunities, (one) => one.initial.correct === true && one.advice.correct === false);
  const allCases = oneOpportunity(opportunities, () => true);
  // Only an oracle expectation with a direction makes delegation regrettable.  NEUTRAL and
  // UNCERTAIN are not successful non-regrets and do not enlarge the denominator.
  const delegationCases = oneOpportunity(opportunities, (one) => ["BENEFICIAL", "HARMFUL"].includes(one.delegation.oracle_expected_value));
  const choices = choiceCases(opportunities);
  const operational = operationalCoverage({
    opportunities,
    incomplete,
    unscorable,
    choices,
    floor: snapshot.floor,
    taskFormFamilyOf
  });
  const rateOptions = { metricFloor: snapshot.floor.metric_eligible_opportunities, operationalReasons: operational.reasons };
  const distributionOptions = { metricFloor: snapshot.floor.metric_eligible_opportunities };
  const adviceDistributions = Object.freeze({
    correctness: adviceDistribution(opportunities, (one) => one.advice.correct ? "correct" : "incorrect", distributionOptions),
    error_type: adviceDistribution(opportunities, (one) => one.advice.error_type, distributionOptions),
    domain: adviceDistribution(opportunities, (one) => one.advice.domain, distributionOptions)
  });

  const metrics = Object.freeze({
    cair: rate(cairCases, (one) => id(one).final.correct === true, "initial wrong + AI correct + final correct", rateOptions),
    csr: rate(csrCases, (one) => id(one).final.correct === true, "initial correct + AI wrong + final correct", rateOptions),
    overreliance: rate(csrCases, (one) => id(one).final.action === "adopt" && id(one).final.correct === false, "initial correct + AI wrong + harmful adoption + final wrong", rateOptions),
    underreliance: rate(cairCases, (one) => id(one).final.action === "reject" && id(one).final.correct === false, "initial wrong + AI correct + beneficial advice rejection + final wrong", rateOptions),
    switch_gain: rate(allCases, (one) => id(one).initial.correct === false && id(one).final.correct === true, "wrong initial to correct final after advice", rateOptions),
    switch_harm: rate(allCases, (one) => id(one).initial.correct === true && id(one).final.correct === false, "correct initial to wrong final after advice", rateOptions),
    delegation_regret: rate(delegationCases, (one) => {
      const opportunity = id(one);
      return (opportunity.delegation.chosen === true && opportunity.delegation.oracle_expected_value === "HARMFUL") || (opportunity.delegation.chosen === false && opportunity.delegation.oracle_expected_value === "BENEFICIAL");
    }, "harmful delegation or beneficial delegation omitted", rateOptions),
    adoption_quality: rate(allCases, (one) => adoptionAppropriate(id(one)), "adopt/reject/modify quality conditional on advice correctness", rateOptions),
    choice_independence: rate(choices.cases, (one) => {
      const [left, right] = one.pair;
      return left.delegation.chosen === right.delegation.chosen && left.final.action === right.final.action;
    }, "same current evidence plus unrelated prior error only leaves delegation and adoption invariant", rateOptions),
    confidence_calibration: confidenceMetric(opportunities, { confidenceFloor: snapshot.floor.confidence_observations, operationalReasons: operational.reasons })
  });
  if (canonicalJson(Object.keys(metrics).sort()) !== canonicalJson([...RELIANCE_METRIC_IDS].sort())) {
    failure("AOS_RELIANCE_METRIC_SET_DRIFT", "the profile metric object no longer matches its declared metric ids");
  }
  const aggregate = aggregateStatus(metrics);
  return Object.freeze({
    schema_id: "aos-reliance-profile.v1",
    verifier_id: RELIANCE_VERIFIER_ID,
    reliance_event_schema_digest: snapshot.schema_digest,
    opportunity_floor: snapshot.floor,
    opportunity_floor_digest: snapshot.floor_digest,
    status: aggregate.status,
    opportunities,
    incomplete_opportunities: incomplete,
    unscorable_opportunities: unscorable,
    incomplete_choice_pairs: Object.freeze(choices.incompletePairs),
    operational_coverage: operational,
    profile: Object.freeze({
      metric_status_counts: aggregate.metric_status_counts,
      metrics,
      advice_distributions: adviceDistributions,
      opportunity_ids: opportunities.map((one) => one.opportunity_id).sort()
    })
  });
}

// A short alias for consumers that call this a metric operation rather than a profile operation.
export const deriveRelianceMetrics = deriveRelianceProfile;
