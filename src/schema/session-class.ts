/**
 * Frozen controlled/imported session classifier for SSOT §9.2.
 *
 * The contract is data (`specs/session-class.v0.json`); this module is the executable
 * rule that refuses to call a session Verified without a start-to-end proof. SSOT §9.2
 * line 970 admits only a session "AOS controlled wrapper가 시작부터 종료까지 감싼" to
 * official AOS-Coding P0; line 971 sends every post-hoc Codex or Claude Code record to
 * DIAGNOSTIC ONLY. There are exactly two classes and nothing between them, so a partial
 * capture falls to IMPORTED_DIAGNOSTIC rather than degrading toward Verified.
 *
 * Nothing a record declares about itself is trusted where the contract can compute it.
 * A session carries no class, no label and no eligibility flag: the classification is the
 * conjunction of the four conditions the ticket's Minimum GREEN names, each derived from
 * the trace. An event's SSOT §9.2 event group is derived from its §9.5 event type through
 * a frozen vocabulary, so relabelling an event cannot manufacture a REQUIRED group. The
 * identity id is derived from the declared runtime/model/harness triple, so it cannot be
 * declared into agreement with the events. And the frozen document's own canonical
 * verdicts are recomputed before this module will classify anything at all, so a contract
 * that calls a partial trace verified is rejected instead of believed.
 *
 * ---------------------------------------------------------------------------------------
 * What this contract is, and what it is not
 * ---------------------------------------------------------------------------------------
 * This is a claim schema over trace content. It is not a proof of observation, and the
 * difference is the most important thing to know before reading a verdict.
 *
 * A reconstruction of a finished Codex or Claude Code session is a JSON document, and so
 * is a live controlled capture. Every field either can carry is a value its author chose,
 * `actor: "wrapper"` included. Nothing inside a trace distinguishes an event the AOS
 * controlled wrapper emitted from an event a script wrote afterwards and labelled that
 * way. So a party able to author a trace can author a record this module classifies
 * CONTROLLED_VERIFIED: take the frozen imported fixture, add the events a controlled run
 * would have carried, give it an identity triple and a capability snapshot, and it passes.
 * That is a demonstrated fact about this contract, not a hypothesis someone still has to
 * check — `controlled-verified-is-a-claim-not-a-proof` in session-class.test.ts performs
 * exactly that promotion and asserts that it succeeds.
 *
 * What the contract does establish is that a record makes the complete set of claims SSOT
 * §9.2 requires of a controlled session, in a form that is internally consistent and
 * cannot be shortened. Each of the following is an absence or a disagreement the schema
 * detects, and each is a real way a partial capture is kept out of official issuance:
 *   - a bracket missing a half, duplicated, inverted, of zero duration, uncorrelated, or
 *     that does not contain in time the activity it claims to wrap;
 *   - a capability snapshot absent, duplicated, unstored, taken at or after the first
 *     observed event, or missing one of the six §9.2 line 939 digest fields;
 *   - an identity absent, incomplete, ambiguous, unknown to the adapter contract, or that
 *     some event disagrees with;
 *   - any of the seven unconditionally REQUIRED §9.2 event groups absent, or any action
 *     left unattributed.
 * None of that is read from a declared verdict. A session carries no class, no label and
 * no eligibility flag; event groups are derived from §9.5 event types through a frozen
 * vocabulary; the identity id is derived from the declared triple; and the frozen
 * document's own canonical verdicts are recomputed before this module classifies anything.
 * Those derivations stop a record from *declaring* itself complete. They cannot stop one
 * from *being written* complete, and they were never able to.
 *
 * What the contract does not establish is that any of it happened. Telling observation
 * apart from reconstruction needs evidence a trace cannot carry: an attestation from a
 * party the verifier trusts, bound to the record and checked against key material held
 * outside it. That is a trust root — a named signer, key custody, rotation, a defined
 * signed payload — and SSOT v1.0 requires none of it: §9.2 and §9.5 contain no signature,
 * attestation or key-management clause at all. Inventing one inside a contract-freezing
 * ticket would weld a cryptographic dependency into a frozen artifact with nobody
 * appointed to hold the key, so the gap is escalated to its owning ADR/PRD rather than
 * approximated here. Until that design exists, CONTROLLED_VERIFIED means "claims a
 * controlled session, completely and consistently", and no issuer may read it as more.
 * Passing here is in any case necessary and not sufficient: SSOT §6.1's ten gates remain
 * issuance-contract.ts's job, and the capability snapshot's *values* remain capability.ts's.
 *
 * Two further properties carry weight. "시작부터 종료까지" is containment, not the presence
 * of two markers: assessment.started and assessment.ended must share one run and one
 * correlation id and contain every other event in time, so a record whose activity
 * continues past the wrapper close is imported. And the canonical fixture set must keep
 * proving each gate separately — the contract refuses to classify against a document where
 * any gate is no longer the sole unmet gate of some fixture, which is what stops a fixture
 * from decaying into one that passes vacuously.
 */

type SessionVerdict = {
  classification: string;
  official_score_eligible: boolean;
  diagnostic_label: string | null;
  identity_id: string | null;
  blockers: string[];
  satisfied_gates: string[];
  imported_incompleteness: string[];
};

type ParsedEvent = {
  event_id: string;
  event_type: string;
  event_group: string | undefined;
  actor: unknown;
  at: number;
  timestamp: unknown;
  run_id: unknown;
  correlation_id: unknown;
  identity: unknown;
};

const CONTRACT_ID = "session-class.v0";
const CONTRACT_VERSION = "session-class-contract-v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#9.2";

const CONTRACT_FIELDS = [
  "contract_id", "contract_version", "source_authority", "imported_incompleteness_clause",
  "capability_digest_fields", "attribution_classes", "unknown_attribution_marker", "wrapper_actor",
  "event_common_fields", "redaction_states", "bounded_payload_max_chars",
  "minimum_observation_ms", "required_event_groups", "imported_incompleteness_items", "classes",
  "requirements", "blocker_gates", "event_vocabulary", "canonical_sessions"
];
const BLOCKER_GATE_FIELDS = ["blocker", "gate_id"];
const CLASS_FIELDS = ["class_id", "ordinal", "source_clause", "statement", "official_score_eligible", "diagnostic_label"];
const GATE_FIELDS = ["gate_id", "ordinal", "source_clause", "statement", "predicate", "failure_mode"];
const VOCABULARY_FIELDS = ["event_type", "event_group"];
const INCOMPLETENESS_ITEM_FIELDS = ["item_id", "event_types"];
const CANONICAL_FIELDS = ["session", "expected"];
const EXPECTED_FIELDS = [
  "classification", "official_score_eligible", "diagnostic_label", "identity_id",
  "blockers", "satisfied_gates", "imported_incompleteness"
];
const SESSION_FIELDS = [
  "session_id", "run_id", "runtime_id", "identity", "capability_snapshot", "events"
];
const IDENTITY_FIELDS = ["runtime", "model", "harness"];

/**
 * SSOT §9.5 "공통 필드", in document order, one field per bullet:
 * event ID / run ID / task ID; timestamp; actor와 event type; parent/correlation ID;
 * model·runtime·harness identity; artifact/evidence digest; redaction state; bounded payload.
 *
 * `event_group` is the one addition, and it is not new information: §9.2 groups the §9.5
 * event types, the group is derived from the type through the frozen vocabulary below, and
 * a declared group that disagrees with the derived one is a blocker. Everything else here
 * is mandated by §9.5, so a conformant controlled trace is not rejected as malformed —
 * which it was while this list held eight fields and refused the other five.
 */
const EVENT_FIELDS = [
  "event_id", "run_id", "task_id", "timestamp", "actor", "event_type", "event_group",
  "parent_id", "correlation_id", "identity", "evidence_digest", "redaction_state", "payload"
];
/** The §9.5 fields that name something outside the event and may legitimately be absent. */
const NULLABLE_EVENT_FIELDS = ["task_id", "parent_id", "evidence_digest"];

/**
 * §9.5 mandates a "redaction state" and a "bounded payload" but enumerates neither, and
 * §9.6 supplies only the principle: secret values are never stored and an artifact digest
 * plus a minimal bounded excerpt is preferred. So the two states below and the character
 * bound are this contract's reading, frozen here and in the document rather than left to
 * each adapter. The contract checks that an event declares one of the two states and that
 * its payload is within the bound; it does not and cannot check that a `none` claim is
 * honest, or that the excerpt was redacted correctly.
 */
const REDACTION_STATES = ["none", "redacted"];
const BOUNDED_PAYLOAD_MAX_CHARS = 2048;

/** SSOT §9.2 lines 970-971. Two classes, no third state, no ordering between them. */
const CONTROLLED = "CONTROLLED_VERIFIED";
const IMPORTED = "IMPORTED_DIAGNOSTIC";
const CLASS_IDS = [CONTROLLED, IMPORTED];
const FROZEN_CLASS_CLAUSES: Record<string, string> = {
  [CONTROLLED]: "Verified Assessment: AOS controlled wrapper가 시작부터 종료까지 감싼 세션만 공식 AOS-Coding P0 발급 가능",
  [IMPORTED]: "Imported Session: 기존 Codex·Claude Code 기록의 사후 분석은 DIAGNOSTIC ONLY"
};
/** SSOT §9.2 line 971 and §2.1: the label an imported session carries. */
const DIAGNOSTIC_LABEL = "DIAGNOSTIC ONLY";

/** SSOT §9.2 line 973: why an imported session is never issued an official score. */
const IMPORTED_INCOMPLETENESS_CLAUSE =
  "Imported Session에는 clarification, human active time, approval, evidence invalidation, completion claim이 완전하지 않을 수 있으므로 공식 점수를 발급하지 않는다.";

/**
 * The four conditions of the Minimum GREEN, each with the SSOT clause it comes from and
 * the predicate the code below applies. The document must reproduce both verbatim: a
 * predicate that says something the code does not do would make the artifact decorative.
 * `statement` and `failure_mode` are prose the derivation never reads and are checked for
 * presence only — that proves the field exists, not that it says anything true.
 */
const FROZEN_GATES: [string, string, string][] = [
  ["WRAPPER_START_END_CORRELATION",
    "Verified Assessment: AOS controlled wrapper가 시작부터 종료까지 감싼 세션만 공식 AOS-Coding P0 발급 가능",
    "exactly one assessment.started and assessment.ended declare the wrapper actor, share the session run id and one correlation id, span at least one millisecond, and contain every other event in time"],
  ["CAPABILITY_SNAPSHOT",
    "run 시작 시 capability snapshot과 adapter digest를 저장한다.",
    "one adapter.capability_declared event declaring the wrapper actor strictly precedes every non-bracket event and the stored snapshot carries exactly the six capability digest fields"],
  ["RUNTIME_IDENTITY",
    "model·runtime·harness identity",
    "the session declares a known runtime with a model and harness, no component containing the identity delimiter, and every event reports the identity id derived from that triple"],
  ["REQUIRED_EVENT_COMPLETENESS",
    "adapter core events: REQUIRED event set 완전",
    "every one of the 7 unconditionally REQUIRED SSOT 9.2 event groups is observed and no event records an unknown actor attribution"]
];
const GATE_IDS = FROZEN_GATES.map(([gateId]) => gateId);

/** SSOT §9.2 lines 937-938. */
const RUNTIME_IDS = ["codex", "claude-code"];

/** SSOT §9.2 line 939. */
const DIGEST_FIELDS = [
  "runtime_version", "protocol_or_schema_version", "adapter_version",
  "source_class", "supported_event_groups", "known_missing_events"
];

/**
 * SSOT §6.7 line 720 classifies an attributed action as `agent`, `human/takeover` or
 * `external_mutation`; line 721 records `actor.attribution_unknown` and withholds the
 * score, which is also what the §9.2 matrix says of the actor attribution row.
 *
 * SSOT §9.5 puts an `actor` on every event but enumerates no vocabulary for the events
 * the harness itself emits, so `wrapper` is added here for exactly the three events the
 * AOS controlled wrapper emits. It is load bearing in both directions: only those three
 * may declare it, and they may declare nothing else.
 *
 * It is a naming convention and it is not evidence of anything. A record that declares
 * `wrapper` on its bracket has said the wrapper emitted those events; it has not shown it,
 * and this module cannot tell the difference. The rule is enforced so that a trace stays
 * unambiguous to read, never so that a reader may infer authorship from it.
 */
const ATTRIBUTION_CLASSES = ["agent", "human/takeover", "external_mutation"];
const UNKNOWN_ATTRIBUTION = "actor.attribution_unknown";
const WRAPPER_ACTOR = "wrapper";
const ACTORS = [...ATTRIBUTION_CLASSES, UNKNOWN_ATTRIBUTION, WRAPPER_ACTOR];

const START_EVENT = "assessment.started";
const END_EVENT = "assessment.ended";
const SNAPSHOT_EVENT = "adapter.capability_declared";
const WRAPPER_EVENT_TYPES = [START_EVENT, END_EVENT, SNAPSHOT_EVENT];

/**
 * The smallest bracket this contract will call an observation. §9.5 timestamps are
 * millisecond instants, so one millisecond is the finest interval the trace can express;
 * a bracket of zero means the record asserts that a whole run started and finished inside
 * a single unobservable instant, which is the signature of a reconstruction that stamped
 * every event with one clock reading rather than of a wrapper that watched a run.
 */
const MINIMUM_OBSERVATION_MS = 1;

/**
 * The SSOT §9.5 "최소 event" list (lines 1062-1082), in document order, each mapped onto
 * the SSOT §9.2 event group that owns it.
 *
 * Three of these mappings are readings rather than quotations and are recorded as such:
 * `adapter.capability_declared` is placed under runtime_identity because §9.2 captures
 * that row with a "runtime query + config digest" and line 978 stores the adapter digest
 * with the capability snapshot; `run.stalled` is placed under plan_state because that row
 * literally names "stall" while `run.resumed`/`run.cancelled` are run lifecycle
 * transitions; `budget.updated` is placed under token_cost, the only §9.2 row that
 * measures consumption, although FR-06 budgets also cover tool and permission use.
 */
const FROZEN_EVENT_VOCABULARY: [string, string][] = [
  [START_EVENT, "run_lifecycle"],
  [END_EVENT, "run_lifecycle"],
  [SNAPSHOT_EVENT, "runtime_identity"],
  ["task.started", "run_lifecycle"],
  ["task.ended", "run_lifecycle"],
  ["user.instruction", "user_instruction"],
  ["user.clarification", "user_instruction"],
  ["context.selected", "context_selection"],
  ["context.injected", "context_selection"],
  ["context.compacted", "context_selection"],
  ["retrieval.query", "retrieval_memory"],
  ["retrieval.result", "retrieval_memory"],
  ["memory.read", "retrieval_memory"],
  ["memory.written", "retrieval_memory"],
  ["memory.invalidated", "retrieval_memory"],
  ["tool.call", "tool_call"],
  ["tool.result", "tool_call"],
  ["tool.error", "tool_call"],
  ["agent.delegated", "delegation_handoff"],
  ["agent.returned", "delegation_handoff"],
  ["handoff.created", "delegation_handoff"],
  ["handoff.consumed", "delegation_handoff"],
  ["plan.created", "plan_state"],
  ["plan.revised", "plan_state"],
  ["state.transition", "plan_state"],
  ["state.checkpoint", "plan_state"],
  ["intervention.occurred", "human_active_time"],
  ["approval.requested", "approval_safety"],
  ["approval.granted", "approval_safety"],
  ["approval.denied", "approval_safety"],
  ["evidence.created", "evidence_claim"],
  ["evidence.invalidated", "evidence_claim"],
  ["completion.claimed", "evidence_claim"],
  ["safety.event", "approval_safety"],
  ["budget.updated", "token_cost"],
  ["run.stalled", "plan_state"],
  ["run.resumed", "run_lifecycle"],
  ["run.cancelled", "run_lifecycle"]
];
const EVENT_GROUP_OF: Record<string, string> = Object.fromEntries(FROZEN_EVENT_VOCABULARY);

/**
 * The seven unconditionally REQUIRED event groups of SSOT §9.2, in table order. This is
 * the same set capability.ts derives from the 계약 column and issuance-contract.ts gates
 * on; session-class.test.ts asserts the equality across files so the three cannot drift.
 * `actor_attribution` has no §9.5 event type of its own — §9.2 captures it by "wrapper +
 * workspace correlation" — so it is observed through the per-event actor instead.
 */
const ATTRIBUTION_GROUP = "actor_attribution";
const REQUIRED_EVENT_GROUPS = [
  "run_lifecycle", "runtime_identity", "user_instruction", "tool_call",
  "evidence_claim", "approval_safety", ATTRIBUTION_GROUP
];

/** SSOT §9.2 line 973, in the order the sentence lists them. */
const INCOMPLETENESS_ITEMS: [string, string[]][] = [
  ["clarification", ["user.clarification"]],
  ["human_active_time", ["intervention.occurred"]],
  ["approval", ["approval.requested", "approval.granted", "approval.denied"]],
  ["evidence_invalidation", ["evidence.invalidated"]],
  ["completion_claim", ["completion.claimed"]]
];

/**
 * Which gate each blocker answers to. A code absent here is a shape defect, not a gate.
 *
 * This table decides `satisfied_gates`, which is a public verdict field, so none of it is
 * decorative and none of it is trusted to be right by inspection. It is pinned twice:
 * `specs/session-class.v0.json` reproduces it row for row and a document that disagrees
 * classifies nothing, and session-class.test.ts derives every one of these codes from a
 * real session and asserts the exact gates the verdict then reports unmet. Re-pointing any
 * single row moves an observable answer in both places.
 */
const GATE_OF: Record<string, string> = {
  WRAPPER_START_MISSING: GATE_IDS[0],
  WRAPPER_END_MISSING: GATE_IDS[0],
  WRAPPER_BRACKET_DUPLICATE: GATE_IDS[0],
  WRAPPER_BRACKET_ACTOR_MISMATCH: GATE_IDS[0],
  WRAPPER_ACTOR_MISUSED: GATE_IDS[0],
  WRAPPER_BRACKET_INVERTED: GATE_IDS[0],
  WRAPPER_BRACKET_ZERO_DURATION: GATE_IDS[0],
  WRAPPER_BRACKET_UNCORRELATED: GATE_IDS[0],
  RUN_ID_MISMATCH: GATE_IDS[0],
  CORRELATION_GAP: GATE_IDS[0],
  WRAPPER_BRACKET_NOT_CONTAINING: GATE_IDS[0],
  CAPABILITY_SNAPSHOT_MISSING: GATE_IDS[1],
  CAPABILITY_SNAPSHOT_DUPLICATE: GATE_IDS[1],
  CAPABILITY_SNAPSHOT_ACTOR_MISMATCH: GATE_IDS[1],
  CAPABILITY_SNAPSHOT_LATE: GATE_IDS[1],
  CAPABILITY_SNAPSHOT_NOT_STORED: GATE_IDS[1],
  CAPABILITY_DIGEST_FIELDS_MISMATCH: GATE_IDS[1],
  IDENTITY_NOT_DECLARED: GATE_IDS[2],
  IDENTITY_INCOMPLETE: GATE_IDS[2],
  IDENTITY_COMPONENT_DELIMITER: GATE_IDS[2],
  IDENTITY_DEAD_FIELD: GATE_IDS[2],
  UNKNOWN_RUNTIME: GATE_IDS[2],
  IDENTITY_RUNTIME_MISMATCH: GATE_IDS[2],
  IDENTITY_MISMATCH: GATE_IDS[2],
  REQUIRED_EVENT_GROUP_GAP: GATE_IDS[3],
  ATTRIBUTION_UNKNOWN: GATE_IDS[3]
};

/** The canonical fixture set, exhaustive and ordered, so a fixture cannot vanish quietly. */
const CANONICAL_SESSION_IDS = [
  "controlled-complete", "missing-start", "missing-end", "imported", "identity-gap",
  "snapshot-late", "required-event-gap", "attribution-unknown", "trailing-event"
];

/** SSOT §9.5 timestamps are instants; a local-time string has no defined ordering. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The identity id joins the declared triple, so the join character may not appear inside a
 * component: `{model: "gpt-5|turbo", harness: "wrap"}` and `{model: "gpt-5", harness:
 * "turbo|wrap"}` would otherwise produce one id, and two different harnesses would be
 * reported as one identity. The delimiter is refused in a component rather than escaped,
 * because an escape has its own inverse to get wrong.
 */
const IDENTITY_DELIMITER = "|";

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const sameList = (left: unknown, right: readonly string[]): boolean =>
  Array.isArray(left) && left.length === right.length && right.every((entry, index) => left[index] === entry);

const failClosed = (blockers: string[]): SessionVerdict => ({
  classification: IMPORTED,
  official_score_eligible: false,
  diagnostic_label: DIAGNOSTIC_LABEL,
  identity_id: null,
  blockers,
  satisfied_gates: [],
  imported_incompleteness: []
});

/**
 * Classifies one session record against the frozen contract.
 *
 * The pipeline is: shape, then the four gates in SSOT order. A record the contract could
 * not read short-circuits at the shape stage, because a gate verdict derived from a
 * half-parsed trace would be a guess. Blockers are reported in that fixed order and are
 * compared by deep equality, so an unordered push would silently break every fixture.
 */
const deriveVerdict = (session: unknown): SessionVerdict => {
  if (!isPlainRecord(session)) {
    return failClosed(["SESSION_NOT_AN_OBJECT a session record must be a JSON object"]);
  }

  const shape: string[] = [];
  const addShape = (message: string) => { shape.push(message); };

  for (const field of SESSION_FIELDS) {
    if (!Object.hasOwn(session, field)) addShape(`SESSION_MISSING_FIELD ${field} is required by the session contract`);
  }
  for (const field of Object.keys(session)) {
    if (!SESSION_FIELDS.includes(field)) addShape(`SESSION_DEAD_FIELD ${field} is not part of the session contract`);
  }
  if (Object.hasOwn(session, "session_id") && !isFilledString(session.session_id)) {
    addShape(`SESSION_ID_INVALID ${String(session.session_id)} is not a session id`);
  }
  if (Object.hasOwn(session, "run_id") && !isFilledString(session.run_id)) {
    addShape(`RUN_ID_INVALID ${String(session.run_id)} is not a run id`);
  }
  if (Object.hasOwn(session, "identity") && session.identity !== null && !isPlainRecord(session.identity)) {
    addShape("IDENTITY_NOT_AN_OBJECT the session identity must be an object or null");
  }
  if (Object.hasOwn(session, "capability_snapshot") && session.capability_snapshot !== null &&
      !isPlainRecord(session.capability_snapshot)) {
    addShape("CAPABILITY_SNAPSHOT_NOT_AN_OBJECT the stored capability snapshot must be an object or null");
  }
  if (!Array.isArray(session.events)) {
    if (Object.hasOwn(session, "events")) addShape("SESSION_EVENTS_INVALID events must be an array of trace events");
    return failClosed(shape);
  }
  if (session.events.length === 0) addShape("SESSION_EVENTS_EMPTY a session records at least one trace event");

  const parsed: ParsedEvent[] = [];
  const seenIds = new Set<string>();
  for (const [index, event] of session.events.entries()) {
    if (!isPlainRecord(event)) { addShape(`EVENT_NOT_AN_OBJECT ${index} is not a trace event`); continue; }
    const eventId = isFilledString(event.event_id) ? event.event_id : `#${index}`;
    for (const field of EVENT_FIELDS) {
      if (!Object.hasOwn(event, field)) addShape(`EVENT_MISSING_FIELD ${eventId} ${field} is required by the trace event contract`);
    }
    for (const field of Object.keys(event)) {
      if (!EVENT_FIELDS.includes(field)) addShape(`EVENT_DEAD_FIELD ${eventId} ${field} is not part of the trace event contract`);
    }
    if (seenIds.has(eventId)) addShape(`DUPLICATE_EVENT_ID ${eventId} appears more than once`);
    seenIds.add(eventId);

    for (const field of NULLABLE_EVENT_FIELDS) {
      if (Object.hasOwn(event, field) && event[field] !== null && !isFilledString(event[field])) {
        addShape(`EVENT_FIELD_INVALID ${eventId} ${field} must be a non-empty string or null`);
      }
    }
    if (Object.hasOwn(event, "redaction_state") && !REDACTION_STATES.includes(event.redaction_state as string)) {
      addShape(`EVENT_REDACTION_STATE_INVALID ${eventId} ${String(event.redaction_state)} is outside the frozen redaction states`);
    }
    if (Object.hasOwn(event, "payload") && event.payload !== null) {
      if (typeof event.payload !== "string") {
        addShape(`EVENT_PAYLOAD_INVALID ${eventId} a bounded payload is a string or null`);
      } else if (event.payload.length > BOUNDED_PAYLOAD_MAX_CHARS) {
        addShape(`EVENT_PAYLOAD_UNBOUNDED ${eventId} carries ${event.payload.length} characters and the bound is ${BOUNDED_PAYLOAD_MAX_CHARS}`);
      }
    }

    const eventGroup = typeof event.event_type === "string" ? EVENT_GROUP_OF[event.event_type] : undefined;
    if (eventGroup === undefined) {
      addShape(`UNKNOWN_EVENT_TYPE ${eventId} ${String(event.event_type)} is outside the frozen SSOT 9.5 event vocabulary`);
    } else if (Object.hasOwn(event, "event_group") && event.event_group !== eventGroup) {
      addShape(`EVENT_GROUP_MISMATCH ${eventId} derives ${eventGroup}`);
    }
    if (typeof event.actor !== "string" || !ACTORS.includes(event.actor)) {
      addShape(`UNKNOWN_ACTOR ${eventId} ${String(event.actor)} is outside the frozen actor set`);
    }
    const at = typeof event.timestamp === "string" && TIMESTAMP.test(event.timestamp)
      ? Date.parse(event.timestamp)
      : Number.NaN;
    if (!Number.isFinite(at)) {
      addShape(`EVENT_TIMESTAMP_INVALID ${eventId} ${String(event.timestamp)} is not an ISO-8601 UTC instant`);
    }
    parsed.push({
      event_id: eventId,
      event_type: typeof event.event_type === "string" ? event.event_type : "",
      event_group: eventGroup,
      actor: event.actor,
      at,
      timestamp: event.timestamp,
      run_id: event.run_id,
      correlation_id: event.correlation_id,
      identity: event.identity
    });
  }
  if (shape.length > 0) return failClosed(shape);

  const blockers: string[] = [];
  const add = (message: string) => { blockers.push(message); };

  // --- gate 1: the wrapper wrapped this session from start to end ------------------------
  const starts = parsed.filter((event) => event.event_type === START_EVENT);
  const ends = parsed.filter((event) => event.event_type === END_EVENT);
  if (starts.length === 0) add(`WRAPPER_START_MISSING the trace records no wrapper ${START_EVENT}`);
  if (ends.length === 0) add(`WRAPPER_END_MISSING the trace records no wrapper ${END_EVENT}`);
  if (starts.length > 1) add(`WRAPPER_BRACKET_DUPLICATE ${START_EVENT} appears ${starts.length} times`);
  if (ends.length > 1) add(`WRAPPER_BRACKET_DUPLICATE ${END_EVENT} appears ${ends.length} times`);
  for (const event of [...starts, ...ends]) {
    if (event.actor !== WRAPPER_ACTOR) add(`WRAPPER_BRACKET_ACTOR_MISMATCH ${event.event_id} does not declare the ${WRAPPER_ACTOR} actor`);
  }
  for (const event of parsed) {
    if (event.actor === WRAPPER_ACTOR && !WRAPPER_EVENT_TYPES.includes(event.event_type)) {
      add(`WRAPPER_ACTOR_MISUSED ${event.event_id} declares the ${WRAPPER_ACTOR} actor`);
    }
  }
  const start = starts.length === 1 ? starts[0] : null;
  const end = ends.length === 1 ? ends[0] : null;
  const inverted = start !== null && end !== null && end.at < start.at;
  if (inverted) add(`WRAPPER_BRACKET_INVERTED ${END_EVENT} precedes ${START_EVENT}`);
  if (start !== null && end !== null && !inverted && end.at - start.at < MINIMUM_OBSERVATION_MS) {
    add(`WRAPPER_BRACKET_ZERO_DURATION the bracket opens and closes at ${String(start.timestamp)}`);
  }
  const correlated = start !== null && end !== null && start.correlation_id === end.correlation_id;
  if (start !== null && end !== null && !correlated) {
    add("WRAPPER_BRACKET_UNCORRELATED the bracket events do not share one correlation id");
  }
  for (const event of parsed) {
    if (event.run_id !== session.run_id) add(`RUN_ID_MISMATCH ${event.event_id} reports ${String(event.run_id)}`);
  }
  if (correlated) {
    for (const event of parsed) {
      if (event.correlation_id !== start!.correlation_id) {
        add(`CORRELATION_GAP ${event.event_id} is outside the wrapper run correlation`);
      }
    }
  }
  if (correlated && !inverted) {
    for (const event of parsed) {
      if (event.at < start!.at || event.at > end!.at) {
        add(`WRAPPER_BRACKET_NOT_CONTAINING ${event.event_id} lies outside the wrapper assessment bracket`);
      }
    }
  }

  // --- gate 2: a capability snapshot was stored at run start -----------------------------
  const snapshots = parsed.filter((event) => event.event_type === SNAPSHOT_EVENT);
  if (snapshots.length === 0) add(`CAPABILITY_SNAPSHOT_MISSING the trace records no ${SNAPSHOT_EVENT} event`);
  if (snapshots.length > 1) add(`CAPABILITY_SNAPSHOT_DUPLICATE ${SNAPSHOT_EVENT} appears ${snapshots.length} times`);
  for (const event of snapshots) {
    if (event.actor !== WRAPPER_ACTOR) add(`CAPABILITY_SNAPSHOT_ACTOR_MISMATCH ${event.event_id} does not declare the ${WRAPPER_ACTOR} actor`);
  }
  if (snapshots.length === 1) {
    for (const event of parsed) {
      if (WRAPPER_EVENT_TYPES.includes(event.event_type)) continue;
      // Strict precedence, as the frozen predicate says: an event sharing the snapshot's
      // instant was not preceded by it, and the snapshot then describes an adapter that
      // was already doing the work it claims to describe.
      if (event.at <= snapshots[0].at) add(`CAPABILITY_SNAPSHOT_LATE ${event.event_id} precedes the capability snapshot`);
    }
  }
  if (session.capability_snapshot === null) {
    add("CAPABILITY_SNAPSHOT_NOT_STORED the run stored no capability snapshot");
  } else if (!sameList(Object.keys(session.capability_snapshot as Record<string, unknown>), DIGEST_FIELDS)) {
    add(`CAPABILITY_DIGEST_FIELDS_MISMATCH the stored snapshot must carry exactly ${DIGEST_FIELDS.join(",")}`);
  }

  // --- gate 3: runtime, model and harness identity ---------------------------------------
  const identity = session.identity;
  if (identity === null) {
    add("IDENTITY_NOT_DECLARED the session records no runtime, model and harness identity");
  } else {
    const record = identity as Record<string, unknown>;
    for (const field of IDENTITY_FIELDS) {
      if (!isFilledString(record[field])) add(`IDENTITY_INCOMPLETE ${field} is missing from the session identity`);
      else if (record[field].includes(IDENTITY_DELIMITER)) {
        add(`IDENTITY_COMPONENT_DELIMITER ${field} contains the ${IDENTITY_DELIMITER} the identity id joins on`);
      }
    }
    for (const field of Object.keys(record)) {
      if (!IDENTITY_FIELDS.includes(field)) add(`IDENTITY_DEAD_FIELD ${field} is not part of the session identity`);
    }
  }
  if (typeof session.runtime_id !== "string" || !RUNTIME_IDS.includes(session.runtime_id)) {
    add(`UNKNOWN_RUNTIME ${String(session.runtime_id)} is outside the frozen SSOT 9.2 runtime set`);
  } else if (isPlainRecord(identity) && identity.runtime !== session.runtime_id) {
    add(`IDENTITY_RUNTIME_MISMATCH the session declares ${session.runtime_id} and its identity reports ${String(identity.runtime)}`);
  }
  const identityId = isPlainRecord(identity) && IDENTITY_FIELDS.every(
    (field) => isFilledString(identity[field]) && !identity[field].includes(IDENTITY_DELIMITER)
  )
    ? IDENTITY_FIELDS.map((field) => identity[field]).join(IDENTITY_DELIMITER)
    : null;
  if (identityId !== null) {
    for (const event of parsed) {
      if (event.identity !== identityId) add(`IDENTITY_MISMATCH ${event.event_id} reports ${String(event.identity)}`);
    }
  }

  // --- gate 4: the REQUIRED event set is complete and every actor is attributed ----------
  const observed = new Set<string>();
  for (const event of parsed) {
    // The shape stage refuses an event whose type is outside the frozen §9.5 vocabulary,
    // so every event that reaches here derives a group.
    observed.add(event.event_group!);
    if (ATTRIBUTION_CLASSES.includes(event.actor as string)) observed.add(ATTRIBUTION_GROUP);
  }
  for (const group of REQUIRED_EVENT_GROUPS) {
    if (!observed.has(group)) add(`REQUIRED_EVENT_GROUP_GAP ${group} is absent from the trace`);
  }
  for (const event of parsed) {
    if (event.actor === UNKNOWN_ATTRIBUTION) add(`ATTRIBUTION_UNKNOWN ${event.event_id} records ${UNKNOWN_ATTRIBUTION}`);
  }

  const implicated = new Set(blockers.map((blocker) => GATE_OF[blocker.split(" ")[0]]));
  const classification = blockers.length === 0 ? CONTROLLED : IMPORTED;
  return {
    classification,
    official_score_eligible: classification === CONTROLLED,
    diagnostic_label: classification === CONTROLLED ? null : DIAGNOSTIC_LABEL,
    identity_id: identityId,
    blockers,
    satisfied_gates: GATE_IDS.filter((gateId) => !implicated.has(gateId)),
    imported_incompleteness: INCOMPLETENESS_ITEMS
      .filter(([, types]) => !parsed.some((event) => types.includes(event.event_type)))
      .map(([itemId]) => itemId)
  };
};

const sameVerdict = (declared: Record<string, unknown>, derived: SessionVerdict): boolean =>
  declared.classification === derived.classification &&
  declared.official_score_eligible === derived.official_score_eligible &&
  declared.diagnostic_label === derived.diagnostic_label &&
  declared.identity_id === derived.identity_id &&
  sameList(declared.blockers, derived.blockers) &&
  sameList(declared.satisfied_gates, derived.satisfied_gates) &&
  sameList(declared.imported_incompleteness, derived.imported_incompleteness);

const validateClasses = (declared: unknown, push: (message: string) => void): void => {
  if (!Array.isArray(declared)) {
    push("CONTRACT_CLASS_COUNT_NOT_2 the contract must declare the two SSOT 9.2 session classes");
    return;
  }
  if (declared.length !== CLASS_IDS.length) push(`CONTRACT_CLASS_COUNT_NOT_2 found ${declared.length}`);
  const seen = new Set<string>();
  for (const [index, entry] of declared.entries()) {
    if (!isPlainRecord(entry)) { push("CONTRACT_CLASS_NOT_AN_OBJECT a class row is not an object"); continue; }
    const classId = entry.class_id;
    if (typeof classId !== "string" || !CLASS_IDS.includes(classId)) {
      push(`CONTRACT_UNKNOWN_CLASS ${String(classId)} is outside the frozen SSOT 9.2 class set`);
      continue;
    }
    if (seen.has(classId)) push(`CONTRACT_DUPLICATE_CLASS ${classId} appears more than once`);
    seen.add(classId);
    for (const field of CLASS_FIELDS) {
      if (!Object.hasOwn(entry, field)) push(`CONTRACT_MISSING_CLASS_FIELD ${classId} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!CLASS_FIELDS.includes(field)) push(`CONTRACT_CLASS_DEAD_FIELD ${classId} ${field} is not part of the class contract`);
    }
    const canonicalIndex = CLASS_IDS.indexOf(classId);
    if (canonicalIndex !== index) push(`CONTRACT_CLASS_ORDER_BROKEN ${classId} sits at position ${index + 1} and not ${canonicalIndex + 1}`);
    if (Object.hasOwn(entry, "ordinal") && entry.ordinal !== canonicalIndex + 1) {
      push(`CONTRACT_CLASS_ORDINAL_MISMATCH ${classId} declares ${String(entry.ordinal)}`);
    }
    if (Object.hasOwn(entry, "source_clause") && entry.source_clause !== FROZEN_CLASS_CLAUSES[classId]) {
      push(`CONTRACT_CLASS_CLAUSE_MISMATCH ${classId} must quote the SSOT 9.2 clause verbatim`);
    }
    // Both consequences are derived from the class, never declared freely: only the
    // controlled class may issue an official score, only the imported class is labelled.
    if (Object.hasOwn(entry, "official_score_eligible") && entry.official_score_eligible !== (classId === CONTROLLED)) {
      push(`CONTRACT_CLASS_ELIGIBILITY_MISMATCH ${classId} derives ${classId === CONTROLLED}`);
    }
    const label = classId === CONTROLLED ? null : DIAGNOSTIC_LABEL;
    if (Object.hasOwn(entry, "diagnostic_label") && entry.diagnostic_label !== label) {
      push(`CONTRACT_CLASS_LABEL_MISMATCH ${classId} derives ${String(label)}`);
    }
    if (Object.hasOwn(entry, "statement") && !isFilledString(entry.statement)) {
      push(`CONTRACT_EMPTY_TEXT ${classId} statement`);
    }
  }
  for (const classId of CLASS_IDS) {
    if (!seen.has(classId)) push(`CONTRACT_CLASS_GAP ${classId} is absent from the contract`);
  }
};

const validateGates = (declared: unknown, push: (message: string) => void): void => {
  if (!Array.isArray(declared)) {
    push("CONTRACT_GATE_COUNT_NOT_4 the contract must declare the four verified-session conditions");
    return;
  }
  if (declared.length !== GATE_IDS.length) push(`CONTRACT_GATE_COUNT_NOT_4 found ${declared.length}`);
  const seen = new Set<string>();
  for (const [index, entry] of declared.entries()) {
    if (!isPlainRecord(entry)) { push("CONTRACT_GATE_NOT_AN_OBJECT a requirement row is not an object"); continue; }
    const gateId = entry.gate_id;
    if (typeof gateId !== "string" || !GATE_IDS.includes(gateId)) {
      push(`CONTRACT_UNKNOWN_GATE ${String(gateId)} is outside the frozen condition set`);
      continue;
    }
    if (seen.has(gateId)) push(`CONTRACT_DUPLICATE_GATE ${gateId} appears more than once`);
    seen.add(gateId);
    for (const field of GATE_FIELDS) {
      if (!Object.hasOwn(entry, field)) push(`CONTRACT_MISSING_GATE_FIELD ${gateId} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!GATE_FIELDS.includes(field)) push(`CONTRACT_GATE_DEAD_FIELD ${gateId} ${field} is not part of the condition contract`);
    }
    const canonicalIndex = GATE_IDS.indexOf(gateId);
    if (canonicalIndex !== index) push(`CONTRACT_GATE_ORDER_BROKEN ${gateId} sits at position ${index + 1} and not ${canonicalIndex + 1}`);
    if (Object.hasOwn(entry, "ordinal") && entry.ordinal !== canonicalIndex + 1) {
      push(`CONTRACT_GATE_ORDINAL_MISMATCH ${gateId} declares ${String(entry.ordinal)}`);
    }
    const [, sourceClause, predicate] = FROZEN_GATES[canonicalIndex];
    if (Object.hasOwn(entry, "source_clause") && entry.source_clause !== sourceClause) {
      push(`CONTRACT_GATE_CLAUSE_MISMATCH ${gateId} must quote its SSOT clause verbatim`);
    }
    if (Object.hasOwn(entry, "predicate") && entry.predicate !== predicate) {
      push(`CONTRACT_GATE_PREDICATE_MISMATCH ${gateId} must read ${predicate}`);
    }
    for (const field of ["statement", "failure_mode"]) {
      if (Object.hasOwn(entry, field) && !isFilledString(entry[field])) push(`CONTRACT_EMPTY_TEXT ${gateId} ${field}`);
    }
  }
  for (const gateId of GATE_IDS) {
    if (!seen.has(gateId)) push(`CONTRACT_GATE_GAP ${gateId} is absent from the contract`);
  }
};

/** The blocker-to-gate table, published so a reader can audit what `satisfied_gates` means. */
const validateBlockerGates = (declared: unknown, push: (message: string) => void): void => {
  const frozenRows = Object.entries(GATE_OF);
  if (!Array.isArray(declared) || declared.length !== frozenRows.length) {
    push(`CONTRACT_BLOCKER_GATES_MISMATCH the contract must declare all ${frozenRows.length} blocker-to-gate rows`);
    return;
  }
  for (const [index, entry] of declared.entries()) {
    const [blocker, gateId] = frozenRows[index];
    if (!isPlainRecord(entry)) { push(`CONTRACT_BLOCKER_GATES_MISMATCH row ${index + 1} is not an object`); continue; }
    for (const field of Object.keys(entry)) {
      if (!BLOCKER_GATE_FIELDS.includes(field)) {
        push(`CONTRACT_BLOCKER_GATE_DEAD_FIELD ${String(entry.blocker)} ${field}`);
      }
    }
    if (entry.blocker !== blocker) {
      push(`CONTRACT_BLOCKER_GATES_MISMATCH position ${index + 1} must read ${blocker}`);
    } else if (entry.gate_id !== gateId) {
      push(`CONTRACT_BLOCKER_GATE_MISMATCH ${blocker} answers to ${gateId}`);
    }
  }
};

const validateVocabulary = (declared: unknown, push: (message: string) => void): void => {
  if (!Array.isArray(declared)) {
    push("CONTRACT_EVENT_VOCABULARY_COUNT_NOT_38 the contract must declare the SSOT 9.5 minimum event list");
    return;
  }
  if (declared.length !== FROZEN_EVENT_VOCABULARY.length) {
    push(`CONTRACT_EVENT_VOCABULARY_COUNT_NOT_38 found ${declared.length}`);
  }
  for (const [index, entry] of declared.entries()) {
    if (!isPlainRecord(entry)) { push(`CONTRACT_EVENT_VOCABULARY_MISMATCH row ${index + 1} is not an object`); continue; }
    for (const field of VOCABULARY_FIELDS) {
      if (!Object.hasOwn(entry, field)) push(`CONTRACT_VOCABULARY_MISSING_FIELD ${String(entry.event_type)} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!VOCABULARY_FIELDS.includes(field)) push(`CONTRACT_VOCABULARY_DEAD_FIELD ${String(entry.event_type)} ${field}`);
    }
    const frozenRow = FROZEN_EVENT_VOCABULARY[index];
    if (frozenRow === undefined) {
      push(`CONTRACT_EVENT_VOCABULARY_MISMATCH ${String(entry.event_type)} is outside the frozen SSOT 9.5 vocabulary`);
      continue;
    }
    if (entry.event_type !== frozenRow[0]) {
      push(`CONTRACT_EVENT_VOCABULARY_MISMATCH position ${index + 1} must read ${frozenRow[0]}`);
    } else if (entry.event_group !== frozenRow[1]) {
      push(`CONTRACT_EVENT_GROUP_MISMATCH ${frozenRow[0]} must read ${frozenRow[1]}`);
    }
  }
};

const validateIncompletenessItems = (declared: unknown, push: (message: string) => void): void => {
  if (!Array.isArray(declared) || declared.length !== INCOMPLETENESS_ITEMS.length) {
    push(`CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH the SSOT 9.2 sentence names ${INCOMPLETENESS_ITEMS.length} items`);
    return;
  }
  for (const [index, entry] of declared.entries()) {
    const [itemId, eventTypes] = INCOMPLETENESS_ITEMS[index];
    if (!isPlainRecord(entry)) { push(`CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH ${itemId} is not an object`); continue; }
    for (const field of INCOMPLETENESS_ITEM_FIELDS) {
      if (!Object.hasOwn(entry, field)) push(`CONTRACT_INCOMPLETENESS_ITEM_MISSING_FIELD ${itemId} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!INCOMPLETENESS_ITEM_FIELDS.includes(field)) {
        push(`CONTRACT_INCOMPLETENESS_ITEM_DEAD_FIELD ${String(entry.item_id)} ${field}`);
      }
    }
    if (entry.item_id !== itemId || !sameList(entry.event_types, eventTypes)) {
      push(`CONTRACT_INCOMPLETENESS_ITEMS_MISMATCH ${itemId} must read ${eventTypes.join(",")}`);
    }
  }
};

/**
 * Recomputes every canonical verdict and refuses a fixture set that has stopped proving
 * its gates. A fixture that no longer isolates one condition, or a missing verified
 * fixture, means the document can no longer demonstrate the rule it freezes.
 */
const validateCanonicalSessions = (declared: unknown, push: (message: string) => void): void => {
  if (!Array.isArray(declared)) {
    push("CONTRACT_CANONICAL_SESSION_GAP the contract must declare its canonical sessions");
    return;
  }
  const verdicts: SessionVerdict[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of declared.entries()) {
    if (!isPlainRecord(entry)) { push(`CONTRACT_CANONICAL_MALFORMED ${index + 1} is not an object`); continue; }
    const sessionId = isPlainRecord(entry.session) && isFilledString(entry.session.session_id)
      ? entry.session.session_id
      : `#${index + 1}`;
    seen.add(sessionId);
    for (const field of CANONICAL_FIELDS) {
      if (!Object.hasOwn(entry, field)) push(`CONTRACT_CANONICAL_MISSING_FIELD ${sessionId} ${field}`);
    }
    for (const field of Object.keys(entry)) {
      if (!CANONICAL_FIELDS.includes(field)) push(`CONTRACT_CANONICAL_DEAD_FIELD ${sessionId} ${field}`);
    }
    if (CANONICAL_SESSION_IDS[index] !== sessionId) {
      push(`CONTRACT_CANONICAL_SESSION_ORDER_BROKEN ${sessionId} sits at position ${index + 1}`);
    }
    const expected = entry.expected;
    if (!isPlainRecord(expected)) { push(`CONTRACT_CANONICAL_MALFORMED ${sessionId} has no expected verdict`); continue; }
    for (const field of EXPECTED_FIELDS) {
      if (!Object.hasOwn(expected, field)) push(`CONTRACT_EXPECTED_MISSING_FIELD ${sessionId} ${field}`);
    }
    for (const field of Object.keys(expected)) {
      if (!EXPECTED_FIELDS.includes(field)) push(`CONTRACT_EXPECTED_DEAD_FIELD ${sessionId} ${field}`);
    }
    const derived = deriveVerdict(entry.session);
    verdicts.push(derived);
    if (!sameVerdict(expected, derived)) {
      const reported = derived.blockers.map((blocker) => blocker.split(" ")[0]).join(",") || "no blocker";
      push(`CONTRACT_SESSION_VERDICT_MISMATCH ${sessionId} derives ${derived.classification} with ${reported}`);
    }
  }
  for (const sessionId of CANONICAL_SESSION_IDS) {
    if (!seen.has(sessionId)) push(`CONTRACT_CANONICAL_SESSION_GAP ${sessionId} is absent from the contract`);
  }
  if (!verdicts.some((verdict) => verdict.classification === CONTROLLED)) {
    push("CONTRACT_CANONICAL_SESSION_GAP no canonical session proves that a controlled session can be verified");
  }
  for (const gateId of GATE_IDS) {
    const isolated = verdicts.some(
      (verdict) => GATE_IDS.filter((candidate) => !verdict.satisfied_gates.includes(candidate)).join(",") === gateId
    );
    if (!isolated) push(`CONTRACT_GATE_UNEXERCISED ${gateId} is not the sole unmet gate of any canonical session`);
  }
};

const validateContract = (contract: unknown): string[] => {
  if (!isPlainRecord(contract)) return ["CONTRACT_NOT_AN_OBJECT the session-class contract must be a JSON object"];
  const missing = CONTRACT_FIELDS.filter((field) => !Object.hasOwn(contract, field));
  if (missing.length > 0) return [`CONTRACT_MISSING_FIELD ${missing.join(",")} required by the session-class contract`];

  const errors: string[] = [];
  const push = (message: string) => { errors.push(message); };

  for (const field of Object.keys(contract)) {
    if (!CONTRACT_FIELDS.includes(field)) push(`CONTRACT_DEAD_FIELD ${field} is not part of the session-class contract`);
  }
  if (contract.contract_id !== CONTRACT_ID) push(`CONTRACT_ID expected ${CONTRACT_ID}`);
  if (contract.contract_version !== CONTRACT_VERSION) push(`CONTRACT_VERSION expected ${CONTRACT_VERSION}`);
  if (contract.source_authority !== SOURCE_AUTHORITY) push(`CONTRACT_SOURCE_AUTHORITY expected ${SOURCE_AUTHORITY}`);
  if (contract.imported_incompleteness_clause !== IMPORTED_INCOMPLETENESS_CLAUSE) {
    push("CONTRACT_INCOMPLETENESS_CLAUSE_MISMATCH the SSOT 9.2 imported-session clause is frozen");
  }
  if (!sameList(contract.capability_digest_fields, DIGEST_FIELDS)) {
    push(`CONTRACT_DIGEST_FIELDS_MISMATCH the capability digest must carry exactly ${DIGEST_FIELDS.join(",")}`);
  }
  if (!sameList(contract.attribution_classes, ATTRIBUTION_CLASSES)) {
    push(`CONTRACT_ATTRIBUTION_CLASSES_MISMATCH the SSOT 6.7 attribution classes are ${ATTRIBUTION_CLASSES.join(",")}`);
  }
  if (contract.unknown_attribution_marker !== UNKNOWN_ATTRIBUTION) {
    push(`CONTRACT_UNKNOWN_ATTRIBUTION_MISMATCH expected ${UNKNOWN_ATTRIBUTION}`);
  }
  if (contract.wrapper_actor !== WRAPPER_ACTOR) push(`CONTRACT_WRAPPER_ACTOR_MISMATCH expected ${WRAPPER_ACTOR}`);
  if (!sameList(contract.event_common_fields, EVENT_FIELDS)) {
    push(`CONTRACT_EVENT_COMMON_FIELDS_MISMATCH the SSOT 9.5 common fields are ${EVENT_FIELDS.join(",")}`);
  }
  if (!sameList(contract.redaction_states, REDACTION_STATES)) {
    push(`CONTRACT_REDACTION_STATES_MISMATCH the frozen redaction states are ${REDACTION_STATES.join(",")}`);
  }
  if (contract.bounded_payload_max_chars !== BOUNDED_PAYLOAD_MAX_CHARS) {
    push(`CONTRACT_PAYLOAD_BOUND_MISMATCH expected ${BOUNDED_PAYLOAD_MAX_CHARS}`);
  }
  if (contract.minimum_observation_ms !== MINIMUM_OBSERVATION_MS) {
    push(`CONTRACT_MINIMUM_OBSERVATION_MISMATCH expected ${MINIMUM_OBSERVATION_MS}`);
  }
  if (!sameList(contract.required_event_groups, REQUIRED_EVENT_GROUPS)) {
    push(`CONTRACT_REQUIRED_GROUPS_MISMATCH the unconditionally REQUIRED groups are ${REQUIRED_EVENT_GROUPS.join(",")}`);
  }

  validateIncompletenessItems(contract.imported_incompleteness_items, push);
  validateClasses(contract.classes, push);
  validateGates(contract.requirements, push);
  validateBlockerGates(contract.blocker_gates, push);
  validateVocabulary(contract.event_vocabulary, push);
  validateCanonicalSessions(contract.canonical_sessions, push);
  return errors;
};

/**
 * Classifies a session as CONTROLLED_VERIFIED or IMPORTED_DIAGNOSTIC against the frozen
 * SSOT §9.2 contract. A contract that has drifted from the SSOT classifies nothing: the
 * verdict fails closed to IMPORTED_DIAGNOSTIC carrying the contract defects, because a
 * Verified answer derived from a broken rule is worse than no answer.
 */
export const classifySession = (session: unknown, contract: unknown): SessionVerdict => {
  const contractErrors = validateContract(contract);
  if (contractErrors.length > 0) return failClosed(contractErrors);
  return deriveVerdict(session);
};

/**
 * The fail-closed gate an issuer calls before an official AOS-Coding P0. Throws unless the
 * session is CONTROLLED_VERIFIED; the message carries the stable blocker codes. Passing is
 * necessary and not sufficient — SSOT §6.1's ten issuance gates still apply.
 */
export const assertVerifiedEligibility = (session: unknown, contract: unknown): SessionVerdict => {
  const verdict = classifySession(session, contract);
  if (verdict.classification !== CONTROLLED) {
    const label = isPlainRecord(session) && isFilledString(session.session_id) ? session.session_id : "<unnamed>";
    const reported = verdict.blockers.map((blocker) => blocker.split(" ")[0]).join(",");
    throw new Error(`VERIFIED_INELIGIBLE ${label} ${reported}`);
  }
  return verdict;
};
