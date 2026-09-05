import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "./core.mjs";
import { fileByteDigest } from "./digest.mjs";
import { validateAgainstSchema } from "./json-schema.mjs";
import { NOT_OBSERVED } from "./metrics.mjs";
import { routeOracleDigest } from "./routing-oracle.mjs";

// Reliance is a behavioural transition, not an AI-use counter.  In particular, the operator's
// initial judgment is evidence only while the assessor can establish that it was committed before
// advice became available.  `createRelianceTrace` therefore writes an authenticated, append-only
// sequence, and `deriveRelianceProfile` only accepts its replay.  A stored profile is never input
// to this module: the entries beside it are.
//
// Authority is intentionally split below.
//
// - `initial`, `inspection`, and `final` contain authenticated operator events.  These are
//   declarations of a decision, attested by the operator-event authority that the caller supplies.
// - `advice_reveal`, `oracle`, and `outcome` are observations by the instrument/verifier process.
//   Their HMAC is held by that process; they are not fields an operator event can author.
//
// The HMAC chain does not identify a person.  It gives the verifier something much narrower and
// necessary: an edited, inserted, or reordered trace cannot recreate the instrument's observation.

export const RELIANCE_EVENT_SCHEMA_ID = "aos-reliance-event.v2";
export const RELIANCE_EVENT_SCHEMA_URL = new URL("../reliance-events/aos-reliance-event.v2.schema.json", import.meta.url);
export const RELIANCE_OPPORTUNITY_FLOOR_URL = new URL("../reliance-events/opportunity-floor.v1.json", import.meta.url);
export const RELIANCE_TRACE_SCHEMA_ID = "aos-reliance-trace.v1";
export const RELIANCE_VERIFIER_ID = "aos-reliance-event.v2";

export const RELIANCE_KINDS = Object.freeze(["initial", "advice_reveal", "oracle", "inspection", "final", "outcome"]);
export const RELIANCE_METRIC_IDS = Object.freeze([
  "cair", "csr", "overreliance", "underreliance", "switch_gain", "switch_harm",
  "delegation_regret", "adoption_quality", "choice_independence", "confidence_calibration"
]);
export const DELEGATION_EXPECTATIONS = Object.freeze(["BENEFICIAL", "HARMFUL", "NEUTRAL", "UNCERTAIN"]);
export const ADVICE_ERROR_TYPES = Object.freeze(["none", "systematic", "rare-large", "continuous-small", "omission"]);
export const FINAL_ACTIONS = Object.freeze(["adopt", "reject", "modify"]);

export const loadRelianceEventSchema = () => JSON.parse(readFileSync(RELIANCE_EVENT_SCHEMA_URL, "utf8"));
export const loadRelianceOpportunityFloor = () => JSON.parse(readFileSync(RELIANCE_OPPORTUNITY_FLOOR_URL, "utf8"));
export const relianceEventSchemaDigest = () => fileByteDigest(RELIANCE_EVENT_SCHEMA_URL);
export const relianceOpportunityFloorDigest = () => fileByteDigest(RELIANCE_OPPORTUNITY_FLOOR_URL);

const floor = () => loadRelianceOpportunityFloor();
export const RELIANCE_OPPORTUNITY_FLOOR = floor().metric_eligible_opportunities;
export const RELIANCE_CONFIDENCE_OBSERVATION_FLOOR = floor().confidence_observations;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const isConfidence = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const sameDigest = (left, right) => typeof left === "string" && typeof right === "string" && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const failure = (code, detail) => { throw new Error(`${code} ${detail}`); };

const assertJournal = (journal) => {
  if (!journal || typeof journal.record !== "function" || typeof journal.read !== "function") {
    failure("AOS_RELIANCE_JOURNAL_REQUIRED", "a reliance trace needs durable record(entry) and read() methods; an in-memory conclusion cannot establish ordering after reconstruction");
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

/** The binding an independent verifier re-derives before reading any claimed metric. */
export function relianceTraceEventDigest(entry, secret) {
  if (!isNonEmptyString(secret)) failure("AOS_RELIANCE_KEY_MISSING", "the verifier has no reliance trace key");
  return `sha256:${createHmac("sha256", secret).update(Buffer.from(canonicalJson(traceMaterial(entry)), "utf8")).digest("hex")}`;
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

const eventVerifier = (verifyOperatorEvent, event, role) => {
  if (typeof verifyOperatorEvent !== "function") {
    failure("AOS_RELIANCE_OPERATOR_VERIFIER_REQUIRED", `${role} needs the trusted operator-event verifier; a subject's own event is a declaration, not evidence`);
  }
  const verdict = verifyOperatorEvent(event);
  // Three states are intentional.  `null` means the verifier did not establish this event and
  // must not be treated as a convenient false, success, or default.
  const accepted = verdict === true ? true : verdict?.accepted === true ? true : verdict === false ? false : null;
  if (accepted !== true) failure("AOS_RELIANCE_OPERATOR_EVENT_UNVERIFIED", `${role} was not established by the trusted operator-event verifier`);
};

const assertOperatorEvent = (event, role, expectedType, runId, verifyOperatorEvent) => {
  eventVerifier(verifyOperatorEvent, event, role);
  if (event?.run_id !== runId) failure("AOS_RELIANCE_RUN_MISMATCH", `${role} belongs to another run`);
  if (event?.decision_type !== expectedType) failure("AOS_RELIANCE_OPERATOR_EVENT_TYPE", `${role} must be ${expectedType}`);
  if (!isNonEmptyString(event?.event_id) || !isNonEmptyString(event?.opportunity_id) || !isNonEmptyString(event?.construct_cell_id)) {
    failure("AOS_RELIANCE_OPERATOR_EVENT_SHAPE", `${role} lacks its event, opportunity, or construct reference`);
  }
  return event;
};

const assertInitial = (payload, runId, verifyOperatorEvent) => {
  assertPayloadKeys(payload, ["opportunity_id", "task_form_id", "operator_event", "delegation", "forcing", "choice_independence"], "initial judgment");
  if (!isNonEmptyString(payload?.opportunity_id) || !payload.opportunity_id.startsWith("rel-")) failure("AOS_RELIANCE_OPPORTUNITY_ID", "an opportunity id starts with rel-");
  if (!isNonEmptyString(payload?.task_form_id)) failure("AOS_RELIANCE_TASK_FORM_REQUIRED", "an opportunity must name the form that administered it");
  const forcing = payload.forcing;
  if (!forcing || typeof forcing !== "object" || Array.isArray(forcing) || !isNonEmptyString(forcing.forcing_protocol_id) || !Number.isInteger(forcing.burden_interaction_count) || forcing.burden_interaction_count < 0 || !["NONE", "SKIP", "REFUSAL"].includes(forcing.skip_or_refusal) || typeof forcing.timeout !== "boolean" || !isNonEmptyString(forcing.interface)) {
    failure("AOS_RELIANCE_FORCING_PROVENANCE", "the intervention must record its protocol, burden, skip/refusal, timeout, and interface; absence is not a default");
  }
  const event = assertOperatorEvent(payload.operator_event, "initial judgment", "initial.judgment", runId, verifyOperatorEvent);
  if (!isConfidence(event.reported_confidence)) failure("AOS_RELIANCE_INITIAL_CONFIDENCE", "the initial judgment has no stated confidence");
  requireEvidenceIds(event.named_evidence_ids, "the initial judgment");
  if (event.proactive_delegation !== "DELEGATE" && event.proactive_delegation !== "DECIDE_ALONE") {
    failure("AOS_RELIANCE_DELEGATION_REQUIRED", "the initial operator event does not state a proactive delegation decision");
  }
  const delegation = payload.delegation;
  if (!delegation || typeof delegation.chosen !== "boolean" || !DELEGATION_EXPECTATIONS.includes(delegation.oracle_expected_value)) {
    failure("AOS_RELIANCE_DELEGATION_SHAPE", "the delegation reference must state chosen and the oracle's expected value");
  }
  const expectedChosen = event.proactive_delegation === "DELEGATE";
  if (delegation.chosen !== expectedChosen) failure("AOS_RELIANCE_DELEGATION_MISMATCH", "the stored delegation claim disagrees with the pre-advice operator event");
  const oracle = delegation.route_oracle;
  if (oracle === null || typeof oracle !== "object" || Array.isArray(oracle)) failure("AOS_RELIANCE_ROUTE_ORACLE_REQUIRED", "delegation needs the raw route-oracle record, not a digest it claims for itself");
  const recomputedOracleDigest = routeOracleDigest(oracle);
  if (!sameDigest(recomputedOracleDigest, oracle.route_oracle_digest)) {
    failure("AOS_RELIANCE_ROUTE_ORACLE_BINDING", "the route-oracle digest does not follow from the route-oracle record");
  }
};

const assertAdviceReveal = (payload) => {
  assertPayloadKeys(payload, ["opportunity_id", "proposal_evidence_digest"], "advice reveal");
  requireDigest(payload?.proposal_evidence_digest, "the revealed proposal");
};

const assertOracle = (payload) => {
  assertPayloadKeys(payload, ["opportunity_id", "advice"], "hidden oracle");
  const advice = payload?.advice;
  if (!advice || typeof advice.correct !== "boolean" || !ADVICE_ERROR_TYPES.includes(advice.error_type) || !isNonEmptyString(advice.domain)) {
    failure("AOS_RELIANCE_ADVICE_SHAPE", "the hidden oracle must state advice correctness, error type, and domain");
  }
  requireDigest(advice.evidence_digest, "the hidden oracle evidence");
  if ((advice.correct === true && advice.error_type !== "none") || (advice.correct === false && advice.error_type === "none")) {
    failure("AOS_RELIANCE_ADVICE_INCONSISTENT", "correct advice has error type none and incorrect advice names its error type");
  }
};

const assertInspection = (payload, runId, verifyOperatorEvent) => {
  assertPayloadKeys(payload, ["opportunity_id", "operator_event"], "inspection");
  const event = assertOperatorEvent(payload?.operator_event, "inspection", "checkpoint.observe", runId, verifyOperatorEvent);
  requireEvidenceIds(event.named_evidence_ids, "the inspection event");
};

const assertFinal = (payload, runId, verifyOperatorEvent) => {
  assertPayloadKeys(payload, ["opportunity_id", "action", "operator_event"], "final response");
  if (!FINAL_ACTIONS.includes(payload?.action)) failure("AOS_RELIANCE_FINAL_ACTION", "the final response must be adopt, reject, or modify");
  const event = assertOperatorEvent(payload.operator_event, "final response", "advice.response", runId, verifyOperatorEvent);
  if (!isConfidence(event.reported_confidence)) failure("AOS_RELIANCE_FINAL_CONFIDENCE", "the final response has no stated confidence");
  requireEvidenceIds(event.named_evidence_ids, "the final response");
};

const assertOutcome = (payload) => {
  assertPayloadKeys(payload, ["opportunity_id", "initial_correct", "final_correct", "verified_outcome_evidence_ids"], "verified outcome");
  if (typeof payload?.initial_correct !== "boolean" || typeof payload?.final_correct !== "boolean") {
    failure("AOS_RELIANCE_OUTCOME_REQUIRED", "the independent outcome verifier must state both initial and final correctness");
  }
  requireEvidenceIds(payload.verified_outcome_evidence_ids, "the verified outcome");
};

const assertionFor = (kind, payload, runId, verifyOperatorEvent) => {
  if (kind === "initial") return assertInitial(payload, runId, verifyOperatorEvent);
  if (kind === "advice_reveal") return assertAdviceReveal(payload);
  if (kind === "oracle") return assertOracle(payload);
  if (kind === "inspection") return assertInspection(payload, runId, verifyOperatorEvent);
  if (kind === "final") return assertFinal(payload, runId, verifyOperatorEvent);
  if (kind === "outcome") return assertOutcome(payload);
  failure("AOS_RELIANCE_TRACE_KIND", `${String(kind)} is not a reliance trace event`);
};

const expectedKind = (entries, opportunityId) => {
  const count = entries.filter((entry) => entry.opportunity_id === opportunityId).length;
  return RELIANCE_KINDS[count] ?? null;
};

const readVerifiedEntries = ({ run_id: runId, secret, journal, verifyOperatorEvent }) => {
  assertJournal(journal);
  const entries = journal.read();
  if (!Array.isArray(entries)) failure("AOS_RELIANCE_JOURNAL_SHAPE", "the reliance journal did not return an event array");
  let previous = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.schema_id !== RELIANCE_TRACE_SCHEMA_ID || entry.run_id !== runId || entry.sequence !== index + 1 || !RELIANCE_KINDS.includes(entry.kind)) {
      failure("AOS_RELIANCE_TRACE_SHAPE", `trace entry ${index + 1} has no valid schema, run, sequence, or kind`);
    }
    if (entry.previous_event_digest !== previous) failure("AOS_RELIANCE_TRACE_ORDER", `trace entry ${index + 1} is not bound to the preceding observed event`);
    const expected = expectedKind(entries.slice(0, index), entry.opportunity_id);
    if (entry.kind !== expected) failure("AOS_RELIANCE_TRACE_ORDER", `${entry.opportunity_id} recorded ${entry.kind} where ${expected ?? "no further event"} was required`);
    const rebound = relianceTraceEventDigest(entry, secret);
    if (!sameDigest(rebound, entry.event_digest)) failure("AOS_RELIANCE_TRACE_BINDING", `trace entry ${index + 1} was edited, inserted, or reordered after observation`);
    assertionFor(entry.kind, entry.payload, runId, verifyOperatorEvent);
    previous = entry.event_digest;
  }
  return entries;
};

/**
 * Writes the six evidence-bearing events that implement the nine conceptual sequence.  Initial
 * confidence/evidence/delegation are deliberately one atomic operator event; final action and
 * final confidence/evidence are likewise one observed response.  Splitting either would let a
 * payload be assembled after advice was visible.
 */
export function createRelianceTrace({ run_id: runId, secret, journal, verifyOperatorEvent } = {}) {
  assertJournal(journal);
  if (!isNonEmptyString(runId)) failure("AOS_RELIANCE_RUN_REQUIRED", "a reliance trace belongs to one run");
  if (!isNonEmptyString(secret)) failure("AOS_RELIANCE_KEY_MISSING", "a reliance trace requires the verifier-held trace key");

  const append = (kind, payload) => {
    const entries = readVerifiedEntries({ run_id: runId, secret, journal, verifyOperatorEvent });
    const opportunityId = payload?.opportunity_id;
    const expected = expectedKind(entries, opportunityId);
    if (kind !== expected) failure("AOS_RELIANCE_TRACE_ORDER", `${String(opportunityId)} cannot record ${kind} before ${expected ?? "a new opportunity"}`);
    assertionFor(kind, payload, runId, verifyOperatorEvent);
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
    entry.event_digest = relianceTraceEventDigest(entry, secret);
    journal.record(entry);
    return structuredClone(entry);
  };

  return Object.freeze({
    commitInitial: (payload) => append("initial", payload),
    revealAdvice: (payload) => append("advice_reveal", payload),
    recordOracle: (payload) => append("oracle", payload),
    recordInspection: (payload) => append("inspection", payload),
    recordFinal: (payload) => append("final", payload),
    recordOutcome: (payload) => append("outcome", payload),
    entries: () => readVerifiedEntries({ run_id: runId, secret, journal, verifyOperatorEvent }).map((entry) => structuredClone(entry))
  });
}

const opportunitiesFrom = (entries) => {
  const byOpportunity = new Map();
  for (const entry of entries) {
    const bucket = byOpportunity.get(entry.opportunity_id) ?? new Map();
    bucket.set(entry.kind, entry);
    byOpportunity.set(entry.opportunity_id, bucket);
  }
  const complete = [];
  const incomplete = [];
  for (const [opportunityId, events] of [...byOpportunity.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const missing = RELIANCE_KINDS.filter((kind) => !events.has(kind));
    if (missing.length > 0) {
      incomplete.push(Object.freeze({ opportunity_id: opportunityId, reason: "INCOMPLETE_RELIANCE_SEQUENCE", missing }));
      continue;
    }
    const initial = events.get("initial").payload;
    const revealed = events.get("advice_reveal").payload;
    const oracle = events.get("oracle").payload.advice;
    const inspection = events.get("inspection").payload.operator_event;
    const final = events.get("final").payload;
    const outcome = events.get("outcome").payload;
    const routeDigest = routeOracleDigest(initial.delegation.route_oracle);
    const event = {
      schema_id: RELIANCE_EVENT_SCHEMA_ID,
      opportunity_id: opportunityId,
      construct_cell_id: initial.operator_event.construct_cell_id,
      task_form_id: initial.task_form_id,
      initial_operator_event_id: initial.operator_event.event_id,
      forcing: structuredClone(initial.forcing),
      initial: {
        correct: outcome.initial_correct,
        confidence: initial.operator_event.reported_confidence,
        evidence_ids: [...initial.operator_event.named_evidence_ids]
      },
      delegation: {
        chosen: initial.delegation.chosen,
        oracle_expected_value: initial.delegation.oracle_expected_value,
        route_oracle_digest: routeDigest
      },
      advice: { ...oracle },
      inspection: { observed: true, evidence_ids: [...inspection.named_evidence_ids] },
      final: {
        action: final.action,
        correct: outcome.final_correct,
        confidence: final.operator_event.reported_confidence,
        evidence_ids: [...final.operator_event.named_evidence_ids]
      },
      verified_outcome_evidence_ids: [...outcome.verified_outcome_evidence_ids],
      trace_event_ids: Object.fromEntries(RELIANCE_KINDS.map((kind) => [kind, events.get(kind).event_id]))
    };
    if (initial.choice_independence !== undefined) event.choice_independence = structuredClone(initial.choice_independence);
    // The reveal digest is deliberately used before this projection is made.  It binds the moment
    // advice was shown even though the public event schema publishes the oracle's evidence digest.
    requireDigest(revealed.proposal_evidence_digest, "the revealed proposal");
    const checked = validateAgainstSchema(event, loadRelianceEventSchema());
    if (!checked.ok) failure("AOS_RELIANCE_EVENT_SCHEMA_INVALID", checked.errors.map((error) => `${error.path} ${error.message}`).join("; "));
    complete.push(Object.freeze(event));
  }
  return { complete: Object.freeze(complete), incomplete: Object.freeze(incomplete) };
};

const rate = (cases, predicate, label) => {
  const eligible = cases.map((one) => one.opportunity_ids).flat().sort();
  const passed = cases.filter(predicate);
  const passing = passed.map((one) => one.opportunity_ids).flat().sort();
  const numerator = passed.length;
  const denominator = cases.length;
  const status = denominator === 0 ? NOT_OBSERVED : denominator >= RELIANCE_OPPORTUNITY_FLOOR ? "ISSUED" : "WITHHELD";
  return Object.freeze({
    status,
    value: status === "ISSUED" ? numerator / denominator : null,
    numerator,
    denominator,
    eligible_opportunity_ids: eligible,
    opportunity_ids: passing,
    reason: status === "ISSUED" ? "OBSERVED" : status === NOT_OBSERVED ? NOT_OBSERVED : "INSUFFICIENT_OPPORTUNITIES",
    label
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

const confidenceMetric = (opportunities) => {
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
  const observed = denominator >= RELIANCE_CONFIDENCE_OBSERVATION_FLOOR && discrimination !== null;
  const status = denominator === 0 ? NOT_OBSERVED : observed ? "ISSUED" : "WITHHELD";
  return Object.freeze({
    status,
    // This is calibration quality, not confidence credit: lower Brier loss is better.  The raw
    // Brier score remains beside this inversion so reports never mistake a high confidence for a
    // high score.
    value: observed ? 1 - brierScore : null,
    numerator: loss,
    denominator,
    eligible_opportunity_ids: opportunities.map((one) => one.opportunity_id).sort(),
    opportunity_ids: ids,
    reason: status === NOT_OBSERVED ? NOT_OBSERVED : denominator < RELIANCE_CONFIDENCE_OBSERVATION_FLOOR ? "INSUFFICIENT_CONFIDENCE_OBSERVATIONS" : discrimination === null ? "DISCRIMINATION_NOT_OBSERVED" : "OBSERVED",
    brier_score: brierScore,
    calibration_in_the_large: calibrationInTheLarge,
    confidence_accuracy_gap: calibrationInTheLarge === null ? null : Math.abs(calibrationInTheLarge),
    discrimination,
    observation_count: denominator
  });
};

/**
 * Replays authenticated entries.  It cannot be handed pre-computed metric values, so an artifact
 * is never accepted as the authority for the score it carries.
 */
export function deriveRelianceProfile({ run_id: runId, secret, journal, verifyOperatorEvent } = {}) {
  const entries = readVerifiedEntries({ run_id: runId, secret, journal, verifyOperatorEvent });
  const { complete: opportunities, incomplete } = opportunitiesFrom(entries);
  const cairCases = oneOpportunity(opportunities, (one) => one.initial.correct === false && one.advice.correct === true);
  const csrCases = oneOpportunity(opportunities, (one) => one.initial.correct === true && one.advice.correct === false);
  const allCases = oneOpportunity(opportunities, () => true);
  // Only an oracle expectation with a direction makes delegation regrettable.  NEUTRAL and
  // UNCERTAIN are not successful non-regrets and do not enlarge the denominator.
  const delegationCases = oneOpportunity(opportunities, (one) => ["BENEFICIAL", "HARMFUL"].includes(one.delegation.oracle_expected_value));
  const choices = choiceCases(opportunities);

  const metrics = Object.freeze({
    cair: rate(cairCases, (one) => id(one).final.correct === true, "initial wrong + AI correct + final correct"),
    csr: rate(csrCases, (one) => id(one).final.correct === true, "initial correct + AI wrong + final correct"),
    overreliance: rate(csrCases, (one) => id(one).final.action === "adopt" && id(one).final.correct === false, "initial correct + AI wrong + harmful adoption + final wrong"),
    underreliance: rate(cairCases, (one) => id(one).final.action === "reject" && id(one).final.correct === false, "initial wrong + AI correct + beneficial advice rejection + final wrong"),
    switch_gain: rate(allCases, (one) => id(one).initial.correct === false && id(one).final.correct === true, "wrong initial to correct final after advice"),
    switch_harm: rate(allCases, (one) => id(one).initial.correct === true && id(one).final.correct === false, "correct initial to wrong final after advice"),
    delegation_regret: rate(delegationCases, (one) => {
      const opportunity = id(one);
      return (opportunity.delegation.chosen === true && opportunity.delegation.oracle_expected_value === "HARMFUL") || (opportunity.delegation.chosen === false && opportunity.delegation.oracle_expected_value === "BENEFICIAL");
    }, "harmful delegation or beneficial delegation omitted"),
    adoption_quality: rate(allCases, (one) => adoptionAppropriate(id(one)), "adopt/reject/modify quality conditional on advice correctness"),
    choice_independence: rate(choices.cases, (one) => {
      const [left, right] = one.pair;
      return left.delegation.chosen === right.delegation.chosen && left.final.action === right.final.action;
    }, "same current evidence plus unrelated prior error only leaves delegation and adoption invariant"),
    confidence_calibration: confidenceMetric(opportunities)
  });
  const issued = Object.values(metrics).filter((metric) => metric.status === "ISSUED").length;
  const status = issued === RELIANCE_METRIC_IDS.length ? "ISSUED" : issued === 0 && Object.values(metrics).every((metric) => metric.status === NOT_OBSERVED) ? NOT_OBSERVED : issued === 0 ? "WITHHELD" : "PARTIAL";
  return Object.freeze({
    schema_id: "aos-reliance-profile.v1",
    verifier_id: RELIANCE_VERIFIER_ID,
    reliance_event_schema_digest: relianceEventSchemaDigest(),
    opportunity_floor: loadRelianceOpportunityFloor(),
    opportunity_floor_digest: relianceOpportunityFloorDigest(),
    status,
    opportunities,
    incomplete_opportunities: incomplete,
    incomplete_choice_pairs: Object.freeze(choices.incompletePairs),
    profile: Object.freeze({
      status,
      metrics,
      opportunity_ids: opportunities.map((one) => one.opportunity_id).sort()
    })
  });
}

// A short alias for consumers that call this a metric operation rather than a profile operation.
export const deriveRelianceMetrics = deriveRelianceProfile;
