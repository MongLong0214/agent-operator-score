import { randomUUID } from "node:crypto";

import { canonicalJson, rejectSecretLike } from "./core.mjs";
import { sha256Bytes } from "./digest.mjs";
import { isRealInstant } from "./execution-plan.mjs";
import { mintOperatorEvent } from "./operator-events.mjs";
import { RELAY_CHECKPOINT_SCHEMA_ID, RELAY_CHECKPOINT_STATES } from "./checkpoint.mjs";

// This protocol records an attested relay turn, not a cryptographic proof of a person.  A portable
// CLI cannot inspect a coding-agent conversation.  Its narrow, checkable claim is instead that the
// relay received these exact safe bytes for the challenge it issued, did not fill an answer by
// default, and committed the pre-advice event before it made the advice bytes available.  That is
// why every accepted relay event remains LOCAL_OWNER_RELAY / RELAY_ATTESTED / MEDIUM.
export const AGENT_RELAY_SCHEMA_ID = "aos-agent-relay.v2";
export const AGENT_RELAY_RESPONSE_SCHEMA_ID = "aos-agent-relay-response.v2";
export const RELAY_PHASES = Object.freeze(["INITIAL_JUDGMENT", "POST_ADVICE_DECISION", "OTHER_OPERATOR_DECISION"]);
export const RELAY_STATUSES = Object.freeze(["ACTION_REQUIRED", "RUNNING", "COMPLETE", "BLOCKED"]);
export const RELAY_ATTESTATION = "relay-declared-user-response";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RELIANCE_ID = /^rel-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const OPPORTUNITY_ID = /^opp-[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const CHALLENGE_ID = /^challenge-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RELAY_ID = /^relay-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CELL_ID = /^C3\.[A-Z]{2}\.[0-9]{2}$/u;
const ISO_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/u;
const FINAL_ACTIONS = new Set(["adopt", "reject", "modify"]);
const MAX_RESPONSE_BYTES = 16 * 1024;

const fail = (code, detail) => { throw new Error(`${code} ${detail}`); };
const clone = (value) => structuredClone(value);
const digestBytes = (bytes) => sha256Bytes(Buffer.from(bytes));
const digestValue = (value) => digestBytes(Buffer.from(canonicalJson(value), "utf8"));
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isDigest = (value) => typeof value === "string" && DIGEST.test(value);

const PROTOCOL_BINDING = Object.freeze({
  schema_id: AGENT_RELAY_SCHEMA_ID,
  challenge_states: RELAY_CHECKPOINT_STATES,
  phases: RELAY_PHASES,
  response_schema_id: AGENT_RELAY_RESPONSE_SCHEMA_ID,
  relay_attestation: RELAY_ATTESTATION,
  status_values: RELAY_STATUSES
});

/** Exact identity for the protocol whose records are being interpreted. */
export const relayProtocolDigest = () => digestValue(PROTOCOL_BINDING);

const challengeMaterial = (challenge) => ({
  schema_id: challenge.schema_id,
  session_id: challenge.session_id,
  status: challenge.status,
  challenge_id: challenge.challenge_id,
  opportunity_id: challenge.opportunity_id,
  construct_cell_id: challenge.construct_cell_id,
  phase: challenge.phase,
  state_revision: challenge.state_revision,
  expires_at: challenge.expires_at,
  action: challenge.action,
  ...(challenge.advice === undefined ? {} : { advice: challenge.advice })
});

/** A challenge digest is always recomputed from what the operator was shown. */
export const relayChallengeDigest = (challenge) => digestValue(challengeMaterial(challenge));

const assertCheckpoint = (checkpoint, sessionId) => {
  if (!checkpoint || typeof checkpoint.read !== "function" || typeof checkpoint.write !== "function" || checkpoint.session_id !== sessionId) {
    fail("AOS_RELAY_CHECKPOINT_REQUIRED", "the relay needs the durable checkpoint for this session");
  }
  return checkpoint;
};

const assertTrace = (trace) => {
  const methods = ["commitInitial", "revealAdvice", "recordOracle", "recordInspection", "recordFinal", "recordOutcome", "entries"];
  if (!trace || methods.some((method) => typeof trace[method] !== "function")) {
    fail("AOS_RELAY_TRACE_REQUIRED", "the relay needs the production reliance trace; an isolated relay state cannot become reliance evidence");
  }
  return trace;
};

const assertion = (condition, code, detail) => {
  if (!condition) fail(code, detail);
};

const nonSecretStrings = (value, code) => {
  const strings = [];
  const visit = (one) => {
    if (typeof one === "string") strings.push(one);
    else if (Array.isArray(one)) one.forEach(visit);
    else if (one && typeof one === "object") Object.values(one).forEach(visit);
  };
  visit(value);
  try { rejectSecretLike(strings); } catch { fail(code, "secret-like input is refused before the relay saves or digests it"); }
};

const requireArrayOfIds = (value, name, { nonempty = false } = {}) => {
  assertion(Array.isArray(value), "AOS_RELAY_RESPONSE_SHAPE", `${name} must be an array`);
  assertion(value.every((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id)), "AOS_RELAY_RESPONSE_SHAPE", `${name} contains an invalid identifier`);
  assertion(new Set(value).size === value.length, "AOS_RELAY_RESPONSE_SHAPE", `${name} repeats an identifier`);
  assertion(!nonempty || value.length > 0, "AOS_RELAY_RESPONSE_REQUIRED", `${name} is required; absence is not an empty observation`);
  return [...value].sort();
};

const requireResponse = (bytes) => {
  assertion(Buffer.isBuffer(bytes), "AOS_RELAY_RESPONSE_BYTES", "a relay response must be exact file bytes");
  assertion(bytes.length > 0 && bytes.length <= MAX_RESPONSE_BYTES, "AOS_RELAY_RESPONSE_SIZE", `a relay response must be 1-${MAX_RESPONSE_BYTES} bytes`);
  let response;
  try { response = JSON.parse(bytes.toString("utf8")); } catch { fail("AOS_RELAY_RESPONSE_JSON", "the response file is not valid UTF-8 JSON"); }
  assertion(response && typeof response === "object" && !Array.isArray(response), "AOS_RELAY_RESPONSE_SHAPE", "the response file must hold one object");
  const allowed = new Set([
    "schema_id", "challenge_id", "selected_option_ids", "operator_text", "reported_confidence", "named_evidence_ids", "inspected", "final_action", "relay"
  ]);
  const unexpected = Object.keys(response).filter((key) => !allowed.has(key));
  assertion(unexpected.length === 0, "AOS_RELAY_RESPONSE_BUNDLED", `the response carries fields outside its one phase (${unexpected.sort().join(", ")})`);
  assertion(response.schema_id === AGENT_RELAY_RESPONSE_SCHEMA_ID, "AOS_RELAY_RESPONSE_SCHEMA", `expected ${AGENT_RELAY_RESPONSE_SCHEMA_ID}`);
  assertion(CHALLENGE_ID.test(response.challenge_id ?? ""), "AOS_RELAY_RESPONSE_SHAPE", "the response needs its challenge id");
  assertion(Array.isArray(response.selected_option_ids), "AOS_RELAY_RESPONSE_SHAPE", "selected_option_ids must be an array");
  assertion(typeof response.operator_text === "string", "AOS_RELAY_RESPONSE_SHAPE", "operator_text must preserve the submitted user text exactly");
  assertion(response.reported_confidence === null || (typeof response.reported_confidence === "number" && Number.isFinite(response.reported_confidence) && response.reported_confidence >= 0 && response.reported_confidence <= 1), "AOS_RELAY_RESPONSE_SHAPE", "reported_confidence must be a number from 0 to 1 or null");
  const relay = response.relay;
  assertion(relay && typeof relay === "object" && !Array.isArray(relay), "AOS_RELAY_RELAY_REQUIRED", "a relay response needs the relay observation envelope");
  const relayKeys = Object.keys(relay).sort();
  const expectedRelayKeys = ["agent_runtime_digest", "attestation", "autonomous", "conversation_turn_id", "source", "submitted_at"];
  assertion(relayKeys.length === expectedRelayKeys.length && relayKeys.every((key, index) => key === expectedRelayKeys[index]), "AOS_RELAY_RELAY_SHAPE", "the relay envelope has missing or unexpected fields");
  assertion(relay.source === "agent-relay", "AOS_RELAY_SOURCE", "the response was not observed at the agent-relay boundary");
  assertion(relay.attestation === RELAY_ATTESTATION, "AOS_RELAY_ATTESTATION", "the relay did not attest this as a user-response submission");
  assertion(relay.autonomous === false, "AOS_RELAY_AUTONOMOUS_REFUSED", "an autonomous agent response is not operator evidence");
  assertion(isDigest(relay.agent_runtime_digest), "AOS_RELAY_RELAY_SHAPE", "the relay runtime identity must be a sha256 digest");
  assertion(relay.conversation_turn_id === null || (typeof relay.conversation_turn_id === "string" && relay.conversation_turn_id.length > 0 && relay.conversation_turn_id.length <= 128), "AOS_RELAY_RELAY_SHAPE", "conversation_turn_id must be a local identifier or null");
  assertion(typeof relay.submitted_at === "string" && ISO_TIME.test(relay.submitted_at), "AOS_RELAY_RELAY_SHAPE", "the relay must state when it observed the submission");
  nonSecretStrings(response, "AOS_RELAY_SECRET_REFUSED");
  return Object.freeze({
    response: clone(response),
    response_digest: digestBytes(bytes),
    value_digest: digestValue({
      selected_option_ids: [...response.selected_option_ids].sort(),
      operator_text: response.operator_text,
      ...(response.inspected === undefined ? {} : { inspected: response.inspected }),
      ...(response.final_action === undefined ? {} : { final_action: response.final_action })
    })
  });
};

const receiptOf = (parsed) => Object.freeze({
  response_digest: parsed.response_digest,
  value_digest: parsed.value_digest,
  selected_option_ids: [...parsed.response.selected_option_ids].sort(),
  reported_confidence: parsed.response.reported_confidence,
  named_evidence_ids: requireArrayOfIds(parsed.response.named_evidence_ids, "named_evidence_ids"),
  ...(parsed.response.inspected === undefined ? {} : { inspected: parsed.response.inspected }),
  ...(parsed.response.final_action === undefined ? {} : { final_action: parsed.response.final_action }),
  relay: clone(parsed.response.relay)
});

const responseValue = (receipt) => ({
  selected_option_ids: receipt.selected_option_ids,
  value_digest: receipt.value_digest
});

const actionOf = (state, phase) => {
  const action = state.opportunity.action;
  if (phase === "INITIAL_JUDGMENT") {
    return {
      decision_type: "initial.judgment",
      prompt: action.initial_prompt,
      context_summary: action.context_summary,
      options: clone(action.initial_options),
      free_text_allowed: action.free_text_allowed,
      confidence_required: true,
      named_evidence_allowed: true,
      sensitive_input_allowed: false
    };
  }
  return {
    decision_type: "advice.response",
    prompt: action.final_prompt,
    context_summary: action.context_summary,
    options: clone(action.final_options),
    free_text_allowed: action.free_text_allowed,
    confidence_required: true,
    named_evidence_allowed: true,
    sensitive_input_allowed: false
  };
};

const challengeFor = (state) => {
  const phase = state.phase;
  const challenge = {
    schema_id: AGENT_RELAY_SCHEMA_ID,
    session_id: state.session_id,
    status: "ACTION_REQUIRED",
    challenge_id: state.challenge_id,
    opportunity_id: state.opportunity.operator_opportunity_id,
    construct_cell_id: state.opportunity.construct_cell_id,
    phase,
    state_revision: state.state_revision,
    expires_at: state.expires_at,
    action: actionOf(state, phase)
  };
  // Advice is deliberately absent from the initial challenge.  Keeping the summary in a separate
  // field makes a test able to distinguish hidden advice from a prompt that merely used the word.
  if (phase === "POST_ADVICE_DECISION") {
    challenge.advice = {
      summary: state.opportunity.advice.summary,
      proposal_evidence_digest: state.opportunity.advice.proposal_evidence_digest
    };
  }
  return Object.freeze({ ...challenge, challenge_digest: relayChallengeDigest(challenge) });
};

const assertOpportunity = (opportunity) => {
  assertion(opportunity && typeof opportunity === "object" && !Array.isArray(opportunity), "AOS_RELAY_OPPORTUNITY_SHAPE", "the relay needs one prepared reliance opportunity");
  assertion(RELIANCE_ID.test(opportunity.reliance_opportunity_id ?? ""), "AOS_RELAY_OPPORTUNITY_SHAPE", "reliance_opportunity_id must start rel-");
  assertion(OPPORTUNITY_ID.test(opportunity.operator_opportunity_id ?? ""), "AOS_RELAY_OPPORTUNITY_SHAPE", "operator_opportunity_id must start opp-");
  assertion(CELL_ID.test(opportunity.construct_cell_id ?? ""), "AOS_RELAY_OPPORTUNITY_SHAPE", "the relay only prepares a C3 reliance cell");
  assertion(isNonEmptyString(opportunity.task_form_id), "AOS_RELAY_OPPORTUNITY_SHAPE", "the opportunity needs its task form binding");
  assertion(opportunity.forcing && typeof opportunity.forcing === "object" && !Array.isArray(opportunity.forcing), "AOS_RELAY_FORCING_REQUIRED", "the pre-advice forcing provenance is required");
  assertion(isNonEmptyString(opportunity.forcing.forcing_protocol_id) && Number.isInteger(opportunity.forcing.burden_interaction_count) && opportunity.forcing.burden_interaction_count >= 0 && ["NONE", "SKIP", "REFUSAL"].includes(opportunity.forcing.skip_or_refusal) && typeof opportunity.forcing.timeout === "boolean" && isNonEmptyString(opportunity.forcing.interface), "AOS_RELAY_FORCING_REQUIRED", "forcing provenance must state protocol, burden, skip/refusal, timeout, and interface");
  assertion(["DELEGATE", "DECIDE_ALONE"].includes(opportunity.proactive_delegation), "AOS_RELAY_DELEGATION_REQUIRED", "the pre-advice delegation decision is required");
  assertion(opportunity.delegation && typeof opportunity.delegation === "object" && !Array.isArray(opportunity.delegation), "AOS_RELAY_DELEGATION_REQUIRED", "the pre-advice delegation observation is required");
  assertion(typeof opportunity.delegation.chosen === "boolean" && opportunity.delegation.chosen === (opportunity.proactive_delegation === "DELEGATE") && ["BENEFICIAL", "HARMFUL", "NEUTRAL", "UNCERTAIN"].includes(opportunity.delegation.oracle_expected_value) && opportunity.delegation.route_oracle && typeof opportunity.delegation.route_oracle === "object", "AOS_RELAY_DELEGATION_REQUIRED", "delegation observation must agree with the initial decision and name its route oracle record");
  assertion(opportunity.advice && typeof opportunity.advice === "object" && !Array.isArray(opportunity.advice), "AOS_RELAY_ADVICE_REQUIRED", "the relay needs the advice observation it will reveal");
  assertion(isNonEmptyString(opportunity.advice.summary) && isDigest(opportunity.advice.proposal_evidence_digest) && opportunity.advice.oracle && typeof opportunity.advice.oracle === "object", "AOS_RELAY_ADVICE_REQUIRED", "the advice needs a safe summary, proposal digest, and independent oracle observation");
  assertion(typeof opportunity.advice.oracle.correct === "boolean" && ["none", "systematic", "rare-large", "continuous-small", "omission"].includes(opportunity.advice.oracle.error_type) && isNonEmptyString(opportunity.advice.oracle.domain) && isDigest(opportunity.advice.oracle.evidence_digest), "AOS_RELAY_ADVICE_REQUIRED", "the independent advice observation needs correctness, error type, domain, and evidence digest");
  const action = opportunity.action;
  assertion(action && typeof action === "object" && !Array.isArray(action), "AOS_RELAY_ACTION_REQUIRED", "the relay needs a prepared measurement question");
  for (const name of ["initial_prompt", "final_prompt", "context_summary"]) assertion(isNonEmptyString(action[name]), "AOS_RELAY_ACTION_REQUIRED", `${name} is required`);
  for (const name of ["initial_options", "final_options"]) assertion(Array.isArray(action[name]), "AOS_RELAY_ACTION_REQUIRED", `${name} must be an array`);
  assertion(typeof action.free_text_allowed === "boolean", "AOS_RELAY_ACTION_REQUIRED", "free_text_allowed must be explicit");
  assertion(typeof opportunity.expires_at === "string" && ISO_TIME.test(opportunity.expires_at), "AOS_RELAY_EXPIRY_REQUIRED", "an opportunity needs an explicit expiry; absence is never a default");
  nonSecretStrings(opportunity, "AOS_RELAY_SECRET_REFUSED");
  return clone(opportunity);
};

const assertState = (state, sessionId) => {
  assertion(state && typeof state === "object" && !Array.isArray(state), "AOS_RELAY_CHECKPOINT_SHAPE", "the relay checkpoint has no state");
  assertion(state.schema_id === RELAY_CHECKPOINT_SCHEMA_ID && state.session_id === sessionId, "AOS_RELAY_CHECKPOINT_SHAPE", "the relay checkpoint belongs to another protocol or session");
  assertion(RELAY_CHECKPOINT_STATES.includes(state.status), "AOS_RELAY_CHECKPOINT_SHAPE", "the relay checkpoint has an unknown lifecycle state");
  assertion(["INITIAL_JUDGMENT", "POST_ADVICE_DECISION"].includes(state.phase), "AOS_RELAY_CHECKPOINT_SHAPE", "the relay checkpoint has an unknown phase");
  assertion(CHALLENGE_ID.test(state.challenge_id ?? "") && RELAY_ID.test(state.relay_id ?? ""), "AOS_RELAY_CHECKPOINT_SHAPE", "the relay checkpoint has invalid challenge or relay ids");
  assertion(Number.isInteger(state.state_revision) && state.state_revision > 0, "AOS_RELAY_CHECKPOINT_SHAPE", "the relay checkpoint needs an explicit positive state revision");
  assertion(state.response_digests && typeof state.response_digests === "object" && !Array.isArray(state.response_digests) && Object.entries(state.response_digests).every(([challengeId, digest]) => CHALLENGE_ID.test(challengeId) && isDigest(digest)), "AOS_RELAY_CHECKPOINT_SHAPE", "the relay checkpoint response digest ledger is malformed");
  assertOpportunity(state.opportunity);
  return clone(state);
};

const relayAttestation = (state, challenge, receipt) => ({
  relay_id: state.relay_id,
  owner_challenge_digest: challenge.challenge_digest,
  attested_at: receipt.relay.submitted_at
});

const eventFor = ({ state, challenge, receipt, decision_type: decisionType, proactive_delegation: delegation = undefined, state_revision: stateRevision }) => {
  const event = mintOperatorEvent({
    run_id: state.session_id,
    source: "agent-relay",
    decision_type: decisionType,
    construct_cell_id: state.opportunity.construct_cell_id,
    opportunity_id: state.opportunity.operator_opportunity_id,
    challenge_digest: challenge.challenge_digest,
    value_digest: receipt.value_digest,
    named_evidence_ids: receipt.named_evidence_ids,
    reported_confidence: receipt.reported_confidence,
    state_revision: stateRevision,
    ...(delegation === undefined ? {} : { proactive_delegation: delegation }),
    relay_attestation: relayAttestation(state, challenge, receipt)
  }, { secret: state.operator_secret });
  return event;
};

const traceKindsFor = (trace, relianceOpportunityId) => trace.entries()
  .filter((entry) => entry.opportunity_id === relianceOpportunityId)
  .map((entry) => entry.kind);

/**
 * Durable two-phase relay for an already-prepared measurement opportunity.
 *
 * Preparation is intentionally separate from this module's response handling: task forms and
 * outcome grading remain their owners' work.  This module owns the user-turn boundary and the
 * initial -> reveal -> final order that those later surfaces consume.
 */
export function createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace = null, operator_secret: operatorSecret = null, now = () => new Date() } = {}) {
  assertion(isNonEmptyString(sessionId), "AOS_RELAY_SESSION_REQUIRED", "a relay protocol belongs to one session");
  assertCheckpoint(checkpoint, sessionId);
  assertion(typeof now === "function", "AOS_RELAY_CLOCK_REQUIRED", "the relay needs a clock to enforce expiry");

  const persist = (state) => checkpoint.write(clone(state));
  const current = () => {
    const state = checkpoint.read();
    return state === null ? null : assertState(state, sessionId);
  };
  const assertLive = (state) => {
    // `isRealInstant` validates the calendar before the constructor reads its epoch.  The relay
    // never treats a permissive parser's acceptance of an operator-controlled string as proof
    // that an expiry exists.
    assertion(isRealInstant(state.expires_at), "AOS_RELAY_EXPIRY_REQUIRED", "the relay challenge expiry is malformed");
    const expiry = new Date(state.expires_at).getTime();
    if (now().getTime() > expiry) {
      persist({ ...state, status: "EXPIRED" });
      fail("AOS_RELAY_CHALLENGE_EXPIRED", "the challenge expired before a user response was observed");
    }
  };
  const protocolTrace = () => assertTrace(trace);
  const secret = () => {
    assertion(isNonEmptyString(operatorSecret), "AOS_RELAY_OPERATOR_KEY_REQUIRED", "the relay process needs the run's in-memory operator authority key to mint an attested event");
    return operatorSecret;
  };
  const stateWithSecret = (state) => ({ ...state, operator_secret: secret() });
  const receiptEvidence = (state) => {
    assertion(state.receipt && typeof state.receipt === "object", "AOS_RELAY_RECEIPT_REQUIRED", "a RESPONDED relay state needs its durable response receipt");
    assertion(typeof checkpoint.readResponse === "function" && checkpoint.readResponse !== null, "AOS_RELAY_RESPONSE_STORE_REQUIRED", "the relay needs exact restricted response bytes to re-derive its receipt");
    const bytes = checkpoint.readResponse(state.challenge_id);
    assertion(bytes !== null, "AOS_RELAY_RESPONSE_EVIDENCE_MISSING", "the response receipt names no restricted evidence bytes");
    const parsed = requireResponse(bytes);
    assertion(parsed.response_digest === state.receipt.response_digest && parsed.value_digest === state.receipt.value_digest, "AOS_RELAY_RESPONSE_EVIDENCE_CHANGED", "the stored response bytes no longer match the durable receipt");
    return { ...parsed, receipt: receiptOf(parsed) };
  };
  const commitInitial = (state) => {
    const traceValue = protocolTrace();
    const parsed = receiptEvidence(state);
    const challenge = challengeFor(state);
    const kinds = traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id);
    if (kinds.length === 0) {
      assertion(state.phase === "INITIAL_JUDGMENT", "AOS_RELAY_STATE_ORDER", "only the initial phase can write the initial reliance event");
      assertion(parsed.response.challenge_id === challenge.challenge_id, "AOS_RELAY_CHALLENGE_MISMATCH", "the response belongs to a different challenge");
      assertion(parsed.receipt.reported_confidence !== null, "AOS_RELAY_INITIAL_CONFIDENCE", "the independent initial judgment requires reported confidence");
      requireArrayOfIds(parsed.receipt.named_evidence_ids, "named_evidence_ids", { nonempty: true });
      const event = eventFor({
        state: stateWithSecret(state), challenge, receipt: parsed.receipt,
        decision_type: "initial.judgment", proactive_delegation: state.opportunity.proactive_delegation,
        state_revision: state.state_revision
      });
      // `operator_event_source` is the observed relay call site, not a field copied from the
      // subject's response.  `lib/reliance.mjs` uses it to distinguish a relay observation from an
      // agent event that merely says it was relayed.
      traceValue.commitInitial({
        opportunity_id: state.opportunity.reliance_opportunity_id,
        operator_opportunity_id: state.opportunity.operator_opportunity_id,
        task_form_id: state.opportunity.task_form_id,
        operator_event: event,
        operator_event_source: "agent-relay",
        delegation: clone(state.opportunity.delegation),
        forcing: clone(state.opportunity.forcing)
      });
    }
    const afterInitial = traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id);
    if (afterInitial.length === 1) traceValue.revealAdvice({
      opportunity_id: state.opportunity.reliance_opportunity_id,
      proposal_evidence_digest: state.opportunity.advice.proposal_evidence_digest
    });
    const afterReveal = traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id);
    if (afterReveal.length === 2) traceValue.recordOracle({
      opportunity_id: state.opportunity.reliance_opportunity_id,
      advice: clone(state.opportunity.advice.oracle)
    });
    const complete = traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id);
    assertion(complete.join(",") === "initial,advice_reveal,oracle", "AOS_RELAY_TRACE_ORDER", "the relay could not durably commit initial judgment before advice reveal");
    const next = {
      ...state,
      // Returning the Phase B challenge is its delivery.  Mark it before returning so a crash after
      // the advice reached the relay cannot accept another initial response on resume.
      status: "DELIVERED",
      phase: "POST_ADVICE_DECISION",
      challenge_id: `challenge-${randomUUID()}`,
      state_revision: state.state_revision + 1,
      receipt: null
    };
    persist(next);
    return challengeFor(next);
  };
  const commitFinal = (state) => {
    const traceValue = protocolTrace();
    const parsed = receiptEvidence(state);
    const challenge = challengeFor(state);
    const kinds = traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id);
    assertion(kinds.join(",") === "initial,advice_reveal,oracle" || kinds.join(",") === "initial,advice_reveal,oracle,inspection" || kinds.join(",") === "initial,advice_reveal,oracle,inspection,final", "AOS_RELAY_TRACE_ORDER", "post-advice response has no committed initial/reveal/oracle prefix");
    assertion(parsed.response.challenge_id === challenge.challenge_id, "AOS_RELAY_CHALLENGE_MISMATCH", "the response belongs to a different challenge");
    assertion(typeof parsed.receipt.inspected === "boolean", "AOS_RELAY_INSPECTION_REQUIRED", "the post-advice response must explicitly state whether advice was inspected");
    assertion(FINAL_ACTIONS.has(parsed.receipt.final_action), "AOS_RELAY_FINAL_ACTION", "the post-advice response must adopt, reject, or modify");
    assertion(parsed.receipt.reported_confidence !== null, "AOS_RELAY_FINAL_CONFIDENCE", "the final response requires reported confidence");
    requireArrayOfIds(parsed.receipt.named_evidence_ids, "named_evidence_ids", { nonempty: true });
    if (kinds.length === 3) {
      if (parsed.receipt.inspected) {
        const inspectionEvent = eventFor({ state: stateWithSecret(state), challenge, receipt: parsed.receipt, decision_type: "checkpoint.observe", state_revision: state.state_revision });
        traceValue.recordInspection({
          opportunity_id: state.opportunity.reliance_opportunity_id,
          observed: true,
          operator_event: inspectionEvent,
          operator_event_source: "agent-relay"
        });
      } else {
        traceValue.recordInspection({ opportunity_id: state.opportunity.reliance_opportunity_id, observed: false });
      }
    }
    if (traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id).length === 4) {
      const finalEvent = eventFor({ state: stateWithSecret(state), challenge, receipt: parsed.receipt, decision_type: "advice.response", state_revision: state.state_revision });
      traceValue.recordFinal({
        opportunity_id: state.opportunity.reliance_opportunity_id,
        action: parsed.receipt.final_action,
        operator_event: finalEvent,
        operator_event_source: "agent-relay"
      });
    }
    assertion(traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id).join(",") === "initial,advice_reveal,oracle,inspection,final", "AOS_RELAY_TRACE_ORDER", "the relay could not durably commit the post-advice decision");
    const next = { ...state, status: "COMMITTED", receipt: null };
    persist(next);
    return next;
  };
  const resume = (state) => {
    if (state.status !== "RESPONDED") return state;
    return state.phase === "INITIAL_JUDGMENT" ? { ...state, next_challenge: commitInitial(state) } : commitFinal(state);
  };

  return Object.freeze({
    protocol_digest: relayProtocolDigest(),
    prepare(opportunity) {
      assertion(current() === null, "AOS_RELAY_ACTIVE_CHALLENGE", "a session already has a relay checkpoint; it must finish, expire, supersede, or cancel before another is prepared");
      const prepared = assertOpportunity(opportunity);
      const state = {
        schema_id: RELAY_CHECKPOINT_SCHEMA_ID,
        session_id: sessionId,
        relay_id: `relay-${randomUUID()}`,
        status: "PREPARED",
        phase: "INITIAL_JUDGMENT",
        challenge_id: `challenge-${randomUUID()}`,
        state_revision: 1,
        expires_at: prepared.expires_at,
      opportunity: prepared,
        receipt: null,
        response_digests: {}
      };
      persist(state);
      return challengeFor(state);
    },
    next() {
      let state = current();
      if (state === null) return Object.freeze({ schema_id: AGENT_RELAY_SCHEMA_ID, session_id: sessionId, status: "BLOCKED", reason: "NO_RELAY_CHALLENGE" });
      // Expiry closes an unanswered challenge.  It cannot erase a response whose receipt was
      // already committed: after a crash that receipt is the durable fact to finish, not an excuse
      // to ask the user again under a new challenge.
      if (state.status !== "RESPONDED") assertLive(state);
      state = resume(state);
      if (state?.next_challenge) return state.next_challenge;
      if (state.status === "COMMITTED") return Object.freeze({ schema_id: AGENT_RELAY_SCHEMA_ID, session_id: sessionId, status: "RUNNING", reason: "OUTCOME_NOT_OBSERVED" });
      if (["EXPIRED", "SUPERSEDED", "CANCELLED"].includes(state.status)) return Object.freeze({ schema_id: AGENT_RELAY_SCHEMA_ID, session_id: sessionId, status: "BLOCKED", reason: state.status });
      const challenge = challengeFor(state);
      if (state.status === "PREPARED") persist({ ...state, status: "DELIVERED" });
      return challenge;
    },
    respond(bytes) {
      let state = current();
      assertion(state !== null, "AOS_RELAY_NO_CHALLENGE", "there is no relay challenge for this session");
      assertLive(state);
      state = resume(state);
      if (state?.next_challenge) return state.next_challenge;
      assertion(state.status === "DELIVERED", "AOS_RELAY_RESPONSE_STATE", "a response is accepted only for the currently delivered challenge");
      const parsed = requireResponse(bytes);
      const challenge = challengeFor(state);
      assertion(parsed.response.challenge_id === challenge.challenge_id, "AOS_RELAY_CHALLENGE_MISMATCH", "the response is stale, replayed, or belongs to another session");
      if (state.phase === "INITIAL_JUDGMENT") {
        assertion(parsed.response.inspected === undefined && parsed.response.final_action === undefined, "AOS_RELAY_RESPONSE_BUNDLED", "an initial response cannot carry post-advice inspection or final action");
      } else {
        assertion(parsed.response.inspected !== undefined && parsed.response.final_action !== undefined, "AOS_RELAY_RESPONSE_REQUIRED", "a post-advice response must not omit its inspection or final decision");
      }
      const receipt = receiptOf(parsed);
      assertion(typeof checkpoint.writeResponse === "function" && checkpoint.writeResponse !== null, "AOS_RELAY_RESPONSE_STORE_REQUIRED", "the relay needs restricted response storage to verify this evidence later");
      // The receipt goes durable before trace mutation.  If this process crashes afterwards, `next`
      // re-reads exact response bytes, finishes only the missing trace suffix, and never asks the
      // user to answer a second time.
      checkpoint.writeResponse(state.challenge_id, bytes);
      const pending = persist({
        ...state,
        status: "RESPONDED",
        receipt,
        response_digests: { ...state.response_digests, [state.challenge_id]: receipt.response_digest }
      });
      const committed = pending.phase === "INITIAL_JUDGMENT" ? commitInitial(pending) : commitFinal(pending);
      if (committed?.status === "COMMITTED") {
        return Object.freeze({ schema_id: AGENT_RELAY_SCHEMA_ID, session_id: sessionId, status: "RUNNING", reason: "OUTCOME_NOT_OBSERVED" });
      }
      return committed;
    },
    recordOutcome(outcome) {
      const state = current();
      assertion(state !== null && state.status === "COMMITTED", "AOS_RELAY_OUTCOME_STATE", "an outcome can be observed only after the relay committed the final decision");
      const traceValue = protocolTrace();
      assertion(outcome && typeof outcome === "object" && !Array.isArray(outcome), "AOS_RELAY_OUTCOME_REQUIRED", "the independent verifier must supply one outcome observation");
      const payload = { opportunity_id: state.opportunity.reliance_opportunity_id, ...clone(outcome) };
      traceValue.recordOutcome(payload);
      const kinds = traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id);
      assertion(kinds.join(",") === "initial,advice_reveal,oracle,inspection,final,outcome", "AOS_RELAY_OUTCOME_ORDER", "the outcome did not complete the relay's ordered reliance evidence");
      const complete = persist({ ...state, status: "COMMITTED", outcome_digest: digestValue(payload) });
      return Object.freeze({ schema_id: AGENT_RELAY_SCHEMA_ID, session_id: sessionId, status: "COMPLETE", outcome_digest: complete.outcome_digest });
    },
    verify() {
      const state = current();
      if (state === null) return Object.freeze({ relay_protocol_digest: relayProtocolDigest(), initial_before_advice_proof: null, status: "NOT_OBSERVED" });
      try {
        const traceValue = protocolTrace();
        const kinds = traceKindsFor(traceValue, state.opportunity.reliance_opportunity_id);
        if (kinds.length === 0) return Object.freeze({ relay_protocol_digest: relayProtocolDigest(), initial_before_advice_proof: null, status: "NOT_OBSERVED" });
        const responseEvidenceIntact = Object.entries(state.response_digests).every(([challengeId, expectedDigest]) => {
          if (typeof checkpoint.readResponse !== "function" || checkpoint.readResponse === null) return false;
          const bytes = checkpoint.readResponse(challengeId);
          if (bytes === null || digestBytes(bytes) !== expectedDigest) return false;
          try { return requireResponse(bytes).response.challenge_id === challengeId; } catch { return false; }
        });
        const proof = kinds[0] === "initial" && kinds[1] === "advice_reveal" && responseEvidenceIntact;
        return Object.freeze({
          relay_protocol_digest: relayProtocolDigest(),
          initial_before_advice_proof: proof,
          status: proof ? "OBSERVED" : "CONTRADICTED",
          trace_kinds: kinds
        });
      } catch (error) {
        return Object.freeze({ relay_protocol_digest: relayProtocolDigest(), initial_before_advice_proof: false, status: "CONTRADICTED", reason: error instanceof Error ? error.message : String(error) });
      }
    }
  });
}
