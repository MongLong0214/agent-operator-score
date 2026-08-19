/**
 * aos-trace parser and canonical serializer for SSOT §9.5 / E1-001.
 *
 * The registry is data (`specs/events.v0.json`); the JSON Schema is
 * `specs/aos-trace.schema.json`. This module is the executable contract:
 * it refuses unknown events, missing identity/correlation, dangling parents,
 * unbounded payloads, stored secret canaries, undeclared fields, and an
 * `actor.attribution_unknown` event that does not drop confidence.
 *
 * Canonical bytes are a key-sorted JSON encoding with no whitespace. Repeated
 * serialization of the same accepted trace is byte-identical.
 */

export type ParseTraceEventResult = {
  ok: boolean;
  errors: string[];
  event?: Record<string, unknown>;
};

export type CanonicalizeTraceResult = {
  ok: boolean;
  errors: string[];
  bytes: string | null;
  score_withheld: boolean;
  confidence_dropped: boolean;
};

const SCHEMA_ID = "aos-trace";
const SCHEMA_VERSION = "aos-trace.schema.v0";
const CONTRACT_ID = "events.v0";
const BOUNDED_PAYLOAD_MAX_CHARS = 2048;
const SECRET_CANARY = "AOS_SECRET_CANARY";
const CONFIDENCE_DROP_THRESHOLD = 0.7;

const COMMON_FIELDS = [
  "event_id", "run_id", "task_id", "timestamp", "actor", "event_type", "event_group",
  "parent_id", "correlation_id", "identity", "evidence_digest", "redaction_state", "payload"
] as const;

const ATTRIBUTION_EVENT_TYPES = [
  "workspace.external_mutation",
  "human.manual_edit_declared",
  "actor.attribution_changed",
  "actor.attribution_unknown"
] as const;

const ATTRIBUTION_ONLY_FIELDS = ["provenance", "confidence", "from_actor", "to_actor"] as const;
const ALLOWED_EVENT_FIELDS = [...COMMON_FIELDS, ...ATTRIBUTION_ONLY_FIELDS];
const TRACE_FIELDS = ["schema_id", "schema_version", "run_id", "events"] as const;

const FROZEN_EVENT_VOCABULARY: [string, string][] = [
  ["assessment.started", "run_lifecycle"],
  ["assessment.ended", "run_lifecycle"],
  ["adapter.capability_declared", "runtime_identity"],
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
  ["run.cancelled", "run_lifecycle"],
  ["workspace.external_mutation", "workspace_diff"],
  ["human.manual_edit_declared", "human_active_time"],
  ["actor.attribution_changed", "actor_attribution"],
  ["actor.attribution_unknown", "actor_attribution"]
];

const EVENT_GROUP_OF: Record<string, string> = Object.fromEntries(FROZEN_EVENT_VOCABULARY);
const ACTORS = ["agent", "human/takeover", "external_mutation", "actor.attribution_unknown", "wrapper"];
const REDACTION_STATES = ["none", "redacted"];
const NULLABLE_FIELDS = ["task_id", "parent_id", "evidence_digest", "payload"];
const IDENTITY_FIELDS = ["event_id", "run_id", "correlation_id", "identity"];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DIGEST = /^[a-f0-9]{64}$/;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const sameList = (left: unknown, right: readonly string[]): boolean =>
  Array.isArray(left) && left.length === right.length && right.every((entry, index) => left[index] === entry);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const failEvent = (errors: string[]): ParseTraceEventResult => ({ ok: false, errors });
const failTrace = (errors: string[]): CanonicalizeTraceResult => ({
  ok: false,
  errors,
  bytes: null,
  score_withheld: false,
  confidence_dropped: false
});

const validateSchemaDocument = (schema: unknown, errors: string[]): void => {
  if (!isPlainRecord(schema)) {
    errors.push("SCHEMA_INVALID aos-trace schema must be a JSON object");
    return;
  }
  if (schema.title !== SCHEMA_ID && schema.$id !== undefined &&
      typeof schema.$id === "string" && !schema.$id.includes(SCHEMA_ID)) {
    errors.push(`SCHEMA_ID expected ${SCHEMA_ID}`);
  }
  const defs = isPlainRecord(schema.$defs) ? schema.$defs : null;
  const eventSchema = defs && isPlainRecord(defs.traceEvent) ? defs.traceEvent : null;
  if (eventSchema && eventSchema.additionalProperties !== false) {
    errors.push("SCHEMA_UNKNOWN_FIELD_POLICY event additionalProperties must be false");
  }
};

const validateRegistryDocument = (registry: unknown, errors: string[]): Record<string, string> => {
  const eventGroupOf: Record<string, string> = {};
  if (!isPlainRecord(registry)) {
    errors.push("REGISTRY_NOT_AN_OBJECT the event registry must be a JSON object");
    return eventGroupOf;
  }
  if (registry.contract_id !== CONTRACT_ID) errors.push(`REGISTRY_CONTRACT_ID expected ${CONTRACT_ID}`);
  if (registry.schema_id !== SCHEMA_ID) errors.push(`REGISTRY_SCHEMA_ID expected ${SCHEMA_ID}`);
  if (registry.schema_version !== SCHEMA_VERSION) {
    errors.push(`REGISTRY_SCHEMA_VERSION expected ${SCHEMA_VERSION}`);
  }
  if (registry.bounded_payload_max_chars !== BOUNDED_PAYLOAD_MAX_CHARS) {
    errors.push(`REGISTRY_PAYLOAD_BOUND_MISMATCH expected ${BOUNDED_PAYLOAD_MAX_CHARS}`);
  }
  if (registry.secret_canary !== SECRET_CANARY) {
    errors.push(`REGISTRY_SECRET_CANARY_MISMATCH expected ${SECRET_CANARY}`);
  }
  if (registry.confidence_drop_threshold !== CONFIDENCE_DROP_THRESHOLD) {
    errors.push(`REGISTRY_CONFIDENCE_THRESHOLD_MISMATCH expected ${CONFIDENCE_DROP_THRESHOLD}`);
  }
  if (!sameList(registry.event_common_fields, COMMON_FIELDS)) {
    errors.push(`REGISTRY_COMMON_FIELDS_MISMATCH expected ${COMMON_FIELDS.join(",")}`);
  }
  if (!sameList(registry.attribution_event_types, ATTRIBUTION_EVENT_TYPES)) {
    errors.push(`REGISTRY_ATTRIBUTION_TYPES_MISMATCH expected ${ATTRIBUTION_EVENT_TYPES.join(",")}`);
  }
  if (!Array.isArray(registry.events)) {
    errors.push("REGISTRY_EVENTS_MISSING the registry must declare an events array");
    return eventGroupOf;
  }
  if (registry.events.length !== FROZEN_EVENT_VOCABULARY.length) {
    errors.push(`REGISTRY_EVENT_COUNT expected ${FROZEN_EVENT_VOCABULARY.length}`);
  }
  for (const [index, row] of registry.events.entries()) {
    if (!isPlainRecord(row)) {
      errors.push(`REGISTRY_EVENT_NOT_AN_OBJECT row ${index + 1} is not an object`);
      continue;
    }
    const frozen = FROZEN_EVENT_VOCABULARY[index];
    if (frozen === undefined) {
      errors.push(`UNKNOWN_EVENT ${String(row.event_type)} is outside the frozen event registry`);
      continue;
    }
    if (row.event_type !== frozen[0] || row.event_group !== frozen[1]) {
      errors.push(`REGISTRY_EVENT_MISMATCH position ${index + 1} must read ${frozen[0]}`);
      continue;
    }
    eventGroupOf[frozen[0]] = frozen[1];
  }
  return Object.keys(eventGroupOf).length === FROZEN_EVENT_VOCABULARY.length ? EVENT_GROUP_OF : eventGroupOf;
};

const parseOneEvent = (
  event: unknown,
  eventGroupOf: Record<string, string>,
  errors: string[]
): Record<string, unknown> | null => {
  if (!isPlainRecord(event)) {
    errors.push("EVENT_NOT_AN_OBJECT a trace event must be a JSON object");
    return null;
  }

  for (const field of COMMON_FIELDS) {
    if (!Object.hasOwn(event, field)) {
      if (IDENTITY_FIELDS.includes(field)) {
        errors.push(`MISSING_IDENTITY ${field} is missing from the trace event`);
      } else {
        errors.push(`EVENT_MISSING_FIELD ${field} is required by the trace event contract`);
      }
    }
  }
  for (const field of Object.keys(event)) {
    if (!ALLOWED_EVENT_FIELDS.includes(field as typeof ALLOWED_EVENT_FIELDS[number])) {
      errors.push(`EVENT_DEAD_FIELD ${field} is not part of the trace event contract`);
    }
  }

  for (const field of IDENTITY_FIELDS) {
    if (Object.hasOwn(event, field) && !isFilledString(event[field])) {
      errors.push(`MISSING_IDENTITY ${field} is missing from the trace event`);
    }
  }

  const eventType = event.event_type;
  const knownType = typeof eventType === "string" && Object.hasOwn(eventGroupOf, eventType);
  if (!knownType) {
    errors.push(`UNKNOWN_EVENT ${String(eventType)} is outside the frozen event registry`);
  } else if (Object.hasOwn(event, "event_group") && event.event_group !== eventGroupOf[eventType]) {
    errors.push(`EVENT_GROUP_MISMATCH ${eventType} derives ${eventGroupOf[eventType]}`);
  }

  const attributionEvent = knownType && (ATTRIBUTION_EVENT_TYPES as readonly string[]).includes(eventType);
  for (const field of ATTRIBUTION_ONLY_FIELDS) {
    if (Object.hasOwn(event, field) && !attributionEvent) {
      errors.push(`EVENT_DEAD_FIELD ${field} is not part of the trace event contract`);
    }
  }
  if (attributionEvent && !isFilledString(event.provenance)) {
    errors.push(`MISSING_PROVENANCE ${eventType} requires a provenance field`);
  }
  if (eventType === "actor.attribution_changed") {
    if (!isFilledString(event.from_actor) || !isFilledString(event.to_actor)) {
      errors.push("ATTRIBUTION_CHANGE_INCOMPLETE actor.attribution_changed requires from_actor and to_actor");
    }
  }
  if (eventType === "actor.attribution_unknown") {
    if (typeof event.confidence !== "number" ||
        !Number.isFinite(event.confidence) ||
        event.confidence >= CONFIDENCE_DROP_THRESHOLD) {
      errors.push("CONFIDENCE_DROP_REQUIRED actor.attribution_unknown must record confidence below 0.7");
    }
  }

  if (Object.hasOwn(event, "actor") && (typeof event.actor !== "string" || !ACTORS.includes(event.actor))) {
    errors.push(`UNKNOWN_ACTOR ${String(event.actor)} is outside the frozen actor set`);
  }
  if (Object.hasOwn(event, "timestamp") && (typeof event.timestamp !== "string" || !TIMESTAMP.test(event.timestamp))) {
    errors.push(`EVENT_TIMESTAMP_INVALID ${String(event.timestamp)} is not an ISO-8601 UTC instant`);
  }
  if (Object.hasOwn(event, "redaction_state") && !REDACTION_STATES.includes(event.redaction_state as string)) {
    errors.push(`EVENT_REDACTION_STATE_INVALID ${String(event.redaction_state)} is outside the frozen redaction states`);
  }

  for (const field of NULLABLE_FIELDS) {
    if (!Object.hasOwn(event, field)) continue;
    if (event[field] === null) continue;
    if (field === "payload") {
      if (typeof event.payload !== "string") {
        errors.push("EVENT_PAYLOAD_INVALID a bounded payload is a string or null");
      } else {
        if (event.payload.length > BOUNDED_PAYLOAD_MAX_CHARS) {
          errors.push(
            `PAYLOAD_UNBOUNDED event carries ${event.payload.length} characters and the bound is ${BOUNDED_PAYLOAD_MAX_CHARS}`
          );
        }
        if (event.payload.includes(SECRET_CANARY)) {
          errors.push("SECRET_CANARY payload contains the frozen secret canary");
        }
      }
      continue;
    }
    if (field === "evidence_digest") {
      if (typeof event.evidence_digest !== "string" || !DIGEST.test(event.evidence_digest)) {
        errors.push("EVENT_DIGEST_INVALID evidence_digest must be a 64-character lowercase hex SHA-256 or null");
      }
      continue;
    }
    if (!isFilledString(event[field])) {
      errors.push(`EVENT_FIELD_INVALID ${field} must be a non-empty string or null`);
    }
  }

  return errors.length === 0 ? event : null;
};

export const parseTraceEvent = (
  event: unknown,
  schema: unknown,
  registry: unknown
): ParseTraceEventResult => {
  const errors: string[] = [];
  validateSchemaDocument(schema, errors);
  const eventGroupOf = validateRegistryDocument(registry, errors);
  if (errors.length > 0) return failEvent(errors);
  const parsed = parseOneEvent(event, eventGroupOf, errors);
  if (errors.length > 0 || parsed === null) return failEvent(errors);
  return { ok: true, errors: [], event: parsed };
};

export const canonicalizeTrace = (
  trace: unknown,
  schema: unknown,
  registry: unknown
): CanonicalizeTraceResult => {
  const errors: string[] = [];
  validateSchemaDocument(schema, errors);
  const eventGroupOf = validateRegistryDocument(registry, errors);
  if (errors.length > 0) return failTrace(errors);
  if (!isPlainRecord(trace)) return failTrace(["TRACE_NOT_AN_OBJECT a trace must be a JSON object"]);

  for (const field of TRACE_FIELDS) {
    if (!Object.hasOwn(trace, field)) errors.push(`TRACE_MISSING_FIELD ${field} is required by the aos-trace contract`);
  }
  for (const field of Object.keys(trace)) {
    if (!(TRACE_FIELDS as readonly string[]).includes(field)) {
      errors.push(`TRACE_DEAD_FIELD ${field} is not part of the aos-trace contract`);
    }
  }
  if (Object.hasOwn(trace, "schema_id") && trace.schema_id !== SCHEMA_ID) {
    errors.push(`TRACE_SCHEMA_ID expected ${SCHEMA_ID}`);
  }
  if (Object.hasOwn(trace, "schema_version") && trace.schema_version !== SCHEMA_VERSION) {
    errors.push(`TRACE_SCHEMA_VERSION expected ${SCHEMA_VERSION}`);
  }
  if (Object.hasOwn(trace, "run_id") && !isFilledString(trace.run_id)) {
    errors.push("MISSING_IDENTITY run_id is missing from the trace event");
  }
  if (!Array.isArray(trace.events)) {
    if (Object.hasOwn(trace, "events")) errors.push("TRACE_EVENTS_INVALID events must be an array of trace events");
    return failTrace(errors);
  }

  const parsedEvents: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  let previousAt = Number.NEGATIVE_INFINITY;
  for (const [index, event] of trace.events.entries()) {
    const eventErrors: string[] = [];
    const parsed = parseOneEvent(event, eventGroupOf, eventErrors);
    errors.push(...eventErrors);
    if (parsed === null) continue;
    const eventId = parsed.event_id as string;
    if (seenIds.has(eventId)) errors.push(`DUPLICATE_EVENT_ID ${eventId} appears more than once`);
    seenIds.add(eventId);
    if (isFilledString(trace.run_id) && parsed.run_id !== trace.run_id) {
      errors.push(`RUN_ID_MISMATCH ${eventId} reports ${String(parsed.run_id)}`);
    }
    const at = Date.parse(parsed.timestamp as string);
    if (Number.isFinite(at)) {
      if (at < previousAt) errors.push(`SEQUENCE_NOT_MONOTONIC ${eventId} precedes the previous event`);
      previousAt = at;
    }
    const parentId = parsed.parent_id;
    if (parentId !== null) {
      const earlier = parsedEvents.some((candidate) => candidate.event_id === parentId);
      if (!earlier) errors.push(`BAD_PARENT ${String(parentId)} does not name an earlier event in the trace`);
    }
    void index;
    parsedEvents.push(parsed);
  }

  if (errors.length > 0) return failTrace(errors);

  const unknownAttribution = parsedEvents.some((event) => event.event_type === "actor.attribution_unknown");
  const canonical = {
    schema_id: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    run_id: trace.run_id,
    events: parsedEvents
  };
  return {
    ok: true,
    errors: [],
    bytes: stableJson(canonical),
    score_withheld: unknownAttribution,
    confidence_dropped: unknownAttribution
  };
};
