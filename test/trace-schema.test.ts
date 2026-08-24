import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadTrace = async () => {
  try {
    return await import("../src/schema/trace.ts");
  } catch {
    return {};
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../specs/aos-trace.schema.json");
const registryPath = resolve(here, "../specs/events.v0.json");

const ALL_EVENTS_MESSAGE = "trace schema assertion failed: every registered event type must parse";
const MISSING_ID_MESSAGE = "trace schema rejected: missing identity";
const BAD_PARENT_MESSAGE = "trace schema rejected: bad parent";
const OVERSIZED_MESSAGE = "trace schema rejected: oversized payload";
const SECRET_CANARY_MESSAGE = "trace schema rejected: secret canary";
const UNKNOWN_EVENT_MESSAGE = "trace schema rejected: unknown event";
const STABLE_BYTES_MESSAGE = "trace schema assertion failed: canonical bytes must be stable";
const ATTRIBUTION_EVENTS_MESSAGE =
  "trace schema assertion failed: actor attribution events must parse";
const CONFIDENCE_DROP_MESSAGE =
  "trace schema rejected: unknown attribution without confidence drop";
const TARGET_PATH_MESSAGE =
  "trace schema rejected: target_path outside the workspace-relative contract";

const SECRET_CANARY = "AOS_SECRET_CANARY";
const BOUNDED_PAYLOAD_MAX_CHARS = 2048;
const CONFIDENCE_DROP_THRESHOLD = 0.7;
const IDENTITY = "codex|gpt-5.6-sol|aos-controlled-wrapper-v0";
const RUN_ID = "run-e1-001";
const CORRELATION_ID = "corr-e1-001";
const DIGEST = "a".repeat(64);

const SSOT_EVENT_VOCABULARY: [string, string][] = [
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
  ["run.cancelled", "run_lifecycle"]
];

const ATTRIBUTION_EVENT_VOCABULARY: [string, string][] = [
  ["workspace.external_mutation", "workspace_diff"],
  ["human.manual_edit_declared", "human_active_time"],
  ["actor.attribution_changed", "actor_attribution"],
  ["actor.attribution_unknown", "actor_attribution"]
];

const REGISTERED_EVENT_VOCABULARY = [...SSOT_EVENT_VOCABULARY, ...ATTRIBUTION_EVENT_VOCABULARY];
const COMMON_FIELDS = [
  "event_id",
  "run_id",
  "task_id",
  "timestamp",
  "actor",
  "event_type",
  "event_group",
  "parent_id",
  "correlation_id",
  "identity",
  "evidence_digest",
  "redaction_state",
  "payload"
];

// Allowed on any event but not required, so it is not a common field. See the target-path case.
const OPTIONAL_FIELDS = ["target_path"];

const assertExported = (value: unknown, message: string) =>
  assert.equal(typeof value, "function", message);

const has = (result: { errors?: string[] } | undefined, needle: string) =>
  Boolean(result?.errors?.some((entry) => entry.includes(needle)));

const frozenSchema = () => JSON.parse(readFileSync(schemaPath, "utf8"));
const frozenRegistry = () => JSON.parse(readFileSync(registryPath, "utf8"));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const stamp = (offsetSeconds: number) => {
  const millis = Date.parse("2026-08-08T09:00:00.000Z") + offsetSeconds * 1000;
  return new Date(millis).toISOString();
};

const actorFor = (eventType: string): string => {
  if (eventType === "assessment.started" || eventType === "assessment.ended" ||
      eventType === "adapter.capability_declared") {
    return "wrapper";
  }
  if (eventType === "workspace.external_mutation") return "external_mutation";
  if (eventType === "human.manual_edit_declared") return "human/takeover";
  if (eventType === "actor.attribution_unknown") return "actor.attribution_unknown";
  return "agent";
};

const validEvent = (
  eventType: string,
  eventGroup: string,
  index: number,
  extra: Record<string, unknown> = {}
) => {
  const event: Record<string, unknown> = {
    event_id: `e${String(index + 1).padStart(2, "0")}`,
    run_id: RUN_ID,
    task_id: "task-e1-001",
    timestamp: stamp(index),
    actor: actorFor(eventType),
    event_type: eventType,
    event_group: eventGroup,
    parent_id: index === 0 ? null : `e${String(index).padStart(2, "0")}`,
    correlation_id: CORRELATION_ID,
    identity: IDENTITY,
    evidence_digest: eventType === "evidence.created" ? DIGEST : null,
    redaction_state: "none",
    payload: null,
    target_path: null
  };
  if (eventType === "workspace.external_mutation" || eventType === "human.manual_edit_declared") {
    event.provenance = "runner-workspace-correlation";
  }
  if (eventType === "actor.attribution_changed") {
    event.provenance = "wrapper-workspace-correlation";
    event.from_actor = "agent";
    event.to_actor = "human/takeover";
  }
  if (eventType === "actor.attribution_unknown") {
    event.provenance = "wrapper-workspace-correlation";
    event.confidence = 0.69;
  }
  return { ...event, ...extra };
};

const validTrace = () => ({
  schema_id: "aos-trace",
  schema_version: "aos-trace.schema.v0",
  run_id: RUN_ID,
  events: REGISTERED_EVENT_VOCABULARY.map(([eventType, eventGroup], index) =>
    validEvent(eventType, eventGroup, index)
  )
});

describe("trace-schema", () => {
test("all-events", async () => {
  const { parseTraceEvent, canonicalizeTrace } = await loadTrace();
  assertExported(parseTraceEvent, ALL_EVENTS_MESSAGE);
  assertExported(canonicalizeTrace, ALL_EVENTS_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  assert.deepEqual(
    registry.events.map((row: { event_type: string; event_group: string }) => [
      row.event_type,
      row.event_group
    ]),
    REGISTERED_EVENT_VOCABULARY,
    ALL_EVENTS_MESSAGE
  );
  assert.equal(registry.events.length, 42, ALL_EVENTS_MESSAGE);
  assert.deepEqual(registry.event_common_fields, COMMON_FIELDS, ALL_EVENTS_MESSAGE);
  assert.equal(registry.bounded_payload_max_chars, BOUNDED_PAYLOAD_MAX_CHARS, ALL_EVENTS_MESSAGE);
  assert.equal(registry.secret_canary, SECRET_CANARY, ALL_EVENTS_MESSAGE);
  for (const [eventType, eventGroup] of REGISTERED_EVENT_VOCABULARY) {
    const result = parseTraceEvent(validEvent(eventType, eventGroup, 0), schema, registry);
    assert.equal(result.ok, true, `${ALL_EVENTS_MESSAGE}: ${eventType}`);
    assert.deepEqual(result.errors, [], `${ALL_EVENTS_MESSAGE}: ${eventType}`);
  }
  const canonical = canonicalizeTrace(validTrace(), schema, registry);
  assert.equal(canonical.ok, true, ALL_EVENTS_MESSAGE);
  assert.deepEqual(canonical.errors, [], ALL_EVENTS_MESSAGE);
});

test("missing-id", async () => {
  const { parseTraceEvent } = await loadTrace();
  assertExported(parseTraceEvent, MISSING_ID_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  const fields = ["event_id", "run_id", "correlation_id", "identity"] as const;
  for (const field of fields) {
    const omitted = validEvent("user.instruction", "user_instruction", 0);
    delete omitted[field];
    const dropped = parseTraceEvent(omitted, schema, registry);
    assert.equal(dropped.ok, false, MISSING_ID_MESSAGE);
    assert.ok(has(dropped, "MISSING_IDENTITY"), `${MISSING_ID_MESSAGE}: ${field} omitted`);

    const blank = validEvent("user.instruction", "user_instruction", 0, { [field]: "" });
    const blanked = parseTraceEvent(blank, schema, registry);
    assert.equal(blanked.ok, false, MISSING_ID_MESSAGE);
    assert.ok(has(blanked, "MISSING_IDENTITY"), `${MISSING_ID_MESSAGE}: ${field} blank`);
  }
});

test("bad-parent", async () => {
  const { canonicalizeTrace } = await loadTrace();
  assertExported(canonicalizeTrace, BAD_PARENT_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  const parent = validEvent("user.instruction", "user_instruction", 0);
  const child = validEvent("tool.call", "tool_call", 1, { parent_id: "no-such-event" });
  const result = canonicalizeTrace(
    { schema_id: "aos-trace", schema_version: "aos-trace.schema.v0", run_id: RUN_ID, events: [parent, child] },
    schema,
    registry
  );
  assert.equal(result.ok, false, BAD_PARENT_MESSAGE);
  assert.ok(has(result, "BAD_PARENT"), BAD_PARENT_MESSAGE);

  const selfParent = validEvent("tool.call", "tool_call", 0, { parent_id: "e01" });
  const self = canonicalizeTrace(
    { schema_id: "aos-trace", schema_version: "aos-trace.schema.v0", run_id: RUN_ID, events: [selfParent] },
    schema,
    registry
  );
  assert.equal(self.ok, false, BAD_PARENT_MESSAGE);
  assert.ok(has(self, "BAD_PARENT"), BAD_PARENT_MESSAGE);
});

test("oversized", async () => {
  const { parseTraceEvent } = await loadTrace();
  assertExported(parseTraceEvent, OVERSIZED_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  const bounded = parseTraceEvent(
    validEvent("user.instruction", "user_instruction", 0, {
      payload: "x".repeat(BOUNDED_PAYLOAD_MAX_CHARS)
    }),
    schema,
    registry
  );
  assert.equal(bounded.ok, true, OVERSIZED_MESSAGE);
  const oversized = parseTraceEvent(
    validEvent("user.instruction", "user_instruction", 0, {
      payload: "x".repeat(BOUNDED_PAYLOAD_MAX_CHARS + 1)
    }),
    schema,
    registry
  );
  assert.equal(oversized.ok, false, OVERSIZED_MESSAGE);
  assert.ok(has(oversized, "PAYLOAD_UNBOUNDED"), OVERSIZED_MESSAGE);
});

test("target-path", async () => {
  const { parseTraceEvent } = await loadTrace();
  assertExported(parseTraceEvent, TARGET_PATH_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();

  const accepted = parseTraceEvent(
    validEvent("tool.call", "tool_call", 0, { target_path: "src/app.ts" }),
    schema,
    registry
  );
  assert.equal(accepted.ok, true, TARGET_PATH_MESSAGE);
  assert.deepEqual(accepted.errors, [], TARGET_PATH_MESSAGE);

  for (const target_path of ["/tmp/app.ts", "../outside.ts", "src/../outside.ts", "src//app.ts", "src\\app.ts", "C:/app.ts"]) {
    const rejected = parseTraceEvent(
      validEvent("tool.call", "tool_call", 0, { target_path }),
      schema,
      registry
    );
    assert.equal(rejected.ok, false, `${TARGET_PATH_MESSAGE}: ${target_path}`);
    assert.ok(has(rejected, "EVENT_TARGET_PATH_INVALID"), `${TARGET_PATH_MESSAGE}: ${target_path}`);
  }

  // Omission is allowed. Requiring the field would fail the twenty frozen canonical vectors, which
  // are digest-pinned, so requiring it would have meant reissuing frozen evidence to admit a new
  // field. An event with no target is the case attribution already handles: unknown, withheld.
  const missing = validEvent("tool.call", "tool_call", 0);
  delete missing.target_path;
  const omitted = parseTraceEvent(missing, schema, registry);
  assert.equal(omitted.ok, true, TARGET_PATH_MESSAGE);
  assert.deepEqual(omitted.errors, [], TARGET_PATH_MESSAGE);

  // Explicit null is a stated absence and is equally allowed; only a present, unusable value is
  // refused. Without this pair the refusals above are satisfied by a build that rejects every
  // target.
  const nulled = parseTraceEvent(
    validEvent("tool.call", "tool_call", 0, { target_path: null }),
    schema,
    registry
  );
  assert.equal(nulled.ok, true, TARGET_PATH_MESSAGE);
});

test("secret-canary", async () => {
  const { parseTraceEvent } = await loadTrace();
  assertExported(parseTraceEvent, SECRET_CANARY_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  for (const redaction of ["none", "redacted"]) {
    const result = parseTraceEvent(
      validEvent("user.instruction", "user_instruction", 0, {
        redaction_state: redaction,
        payload: `excerpt ${SECRET_CANARY} excerpt`
      }),
      schema,
      registry
    );
    assert.equal(result.ok, false, SECRET_CANARY_MESSAGE);
    assert.ok(has(result, "SECRET_CANARY"), `${SECRET_CANARY_MESSAGE}: ${redaction}`);
  }
});

test("unknown-event", async () => {
  const { parseTraceEvent } = await loadTrace();
  assertExported(parseTraceEvent, UNKNOWN_EVENT_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  const result = parseTraceEvent(
    validEvent("hidden.reasoning", "run_lifecycle", 0),
    schema,
    registry
  );
  assert.equal(result.ok, false, UNKNOWN_EVENT_MESSAGE);
  assert.ok(has(result, "UNKNOWN_EVENT"), UNKNOWN_EVENT_MESSAGE);
});

test("stable-bytes", async () => {
  const { canonicalizeTrace } = await loadTrace();
  assertExported(canonicalizeTrace, STABLE_BYTES_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  const trace = validTrace();
  const first = canonicalizeTrace(trace, schema, registry);
  assert.equal(first.ok, true, STABLE_BYTES_MESSAGE);
  assert.equal(typeof first.bytes, "string", STABLE_BYTES_MESSAGE);
  assert.ok(first.bytes && first.bytes.length > 0, STABLE_BYTES_MESSAGE);
  const second = canonicalizeTrace(JSON.parse(first.bytes as string), schema, registry);
  assert.equal(second.ok, true, STABLE_BYTES_MESSAGE);
  assert.equal(first.bytes, second.bytes, STABLE_BYTES_MESSAGE);
  const shuffled = {
    events: trace.events,
    run_id: trace.run_id,
    schema_version: trace.schema_version,
    schema_id: trace.schema_id
  };
  const reordered = canonicalizeTrace(shuffled, schema, registry);
  assert.equal(reordered.ok, true, STABLE_BYTES_MESSAGE);
  assert.equal(reordered.bytes, first.bytes, STABLE_BYTES_MESSAGE);
});

test("actor-attribution-events", async () => {
  const { parseTraceEvent } = await loadTrace();
  assertExported(parseTraceEvent, ATTRIBUTION_EVENTS_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  assert.deepEqual(
    registry.attribution_event_types,
    ATTRIBUTION_EVENT_VOCABULARY.map(([eventType]) => eventType),
    ATTRIBUTION_EVENTS_MESSAGE
  );
  for (const [eventType, eventGroup] of ATTRIBUTION_EVENT_VOCABULARY) {
    const result = parseTraceEvent(validEvent(eventType, eventGroup, 0), schema, registry);
    assert.equal(result.ok, true, `${ATTRIBUTION_EVENTS_MESSAGE}: ${eventType}`);
    assert.deepEqual(result.errors, [], `${ATTRIBUTION_EVENTS_MESSAGE}: ${eventType}`);
    const missingProvenance = validEvent(eventType, eventGroup, 0);
    delete missingProvenance.provenance;
    const rejected = parseTraceEvent(missingProvenance, schema, registry);
    assert.equal(rejected.ok, false, `${ATTRIBUTION_EVENTS_MESSAGE}: ${eventType} provenance`);
    assert.ok(has(rejected, "MISSING_PROVENANCE"), `${ATTRIBUTION_EVENTS_MESSAGE}: ${eventType} provenance`);
  }
});

test("unknown-attribution-requires-confidence-drop", async () => {
  const { parseTraceEvent, canonicalizeTrace } = await loadTrace();
  assertExported(parseTraceEvent, CONFIDENCE_DROP_MESSAGE);
  assertExported(canonicalizeTrace, CONFIDENCE_DROP_MESSAGE);
  const schema = frozenSchema();
  const registry = frozenRegistry();
  assert.equal(registry.confidence_drop_threshold, CONFIDENCE_DROP_THRESHOLD, CONFIDENCE_DROP_MESSAGE);

  const omitted = validEvent("actor.attribution_unknown", "actor_attribution", 0);
  delete omitted.confidence;
  const missing = parseTraceEvent(omitted, schema, registry);
  assert.equal(missing.ok, false, CONFIDENCE_DROP_MESSAGE);
  assert.ok(has(missing, "CONFIDENCE_DROP_REQUIRED"), CONFIDENCE_DROP_MESSAGE);

  const kept = parseTraceEvent(
    validEvent("actor.attribution_unknown", "actor_attribution", 0, { confidence: CONFIDENCE_DROP_THRESHOLD }),
    schema,
    registry
  );
  assert.equal(kept.ok, false, CONFIDENCE_DROP_MESSAGE);
  assert.ok(has(kept, "CONFIDENCE_DROP_REQUIRED"), CONFIDENCE_DROP_MESSAGE);

  const dropped = validEvent("actor.attribution_unknown", "actor_attribution", 0, { confidence: 0.69 });
  const accepted = parseTraceEvent(dropped, schema, registry);
  assert.equal(accepted.ok, true, CONFIDENCE_DROP_MESSAGE);
  const start = validEvent("assessment.started", "run_lifecycle", 0);
  const unknown = validEvent("actor.attribution_unknown", "actor_attribution", 1, { confidence: 0.69 });
  const canonical = canonicalizeTrace(
    { schema_id: "aos-trace", schema_version: "aos-trace.schema.v0", run_id: RUN_ID, events: [start, unknown] },
    schema,
    registry
  );
  assert.equal(canonical.ok, true, CONFIDENCE_DROP_MESSAGE);
  assert.equal(canonical.confidence_dropped, true, CONFIDENCE_DROP_MESSAGE);
  assert.equal(canonical.score_withheld, true, CONFIDENCE_DROP_MESSAGE);
});
});
