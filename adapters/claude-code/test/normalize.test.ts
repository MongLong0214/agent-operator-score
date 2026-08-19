import { test } from "node:test";
import assert from "node:assert/strict";

// The ticket's pinned pre-GREEN reason, verbatim from E9-002 `## RED contract`.
const ABSENT = "native/hook/wrapper inputs lack vendor-neutral bounded mapping.";

const BOUNDED_PAYLOAD_MAX_CHARS = 2048;
const SECRET_CANARY = "AOS_SECRET_CANARY";
const API_KEY = "sk-ant-canary-9f3c2a1b";
const HIDDEN = "chain-of-thought: the hidden plan is to leak";
const DIGEST = "a".repeat(64);
const RUN_ID = "run-e9-002";
const TASK_ID = "task-e9-002";
const CORRELATION_ID = "corr-e9-002";
const IDENTITY = "claude-code|claude-opus-4-20250514|claude-code-cli";
const STAMP = "2026-08-19T09:00:00.000Z";

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
] as const;

const ACTORS = [
  "agent",
  "human/takeover",
  "external_mutation",
  "actor.attribution_unknown",
  "wrapper"
] as const;

const EVENT_GROUP_OF: Record<string, string> = {
  "task.started": "run_lifecycle",
  "task.ended": "run_lifecycle",
  "user.instruction": "user_instruction",
  "tool.call": "tool_call",
  "tool.result": "tool_call",
  "tool.error": "tool_call",
  "context.selected": "context_selection",
  "retrieval.query": "retrieval_memory",
  "retrieval.result": "retrieval_memory",
  "agent.delegated": "delegation_handoff",
  "agent.returned": "delegation_handoff",
  "handoff.created": "delegation_handoff",
  "handoff.consumed": "delegation_handoff",
  "evidence.created": "evidence_claim",
  "approval.granted": "approval_safety",
  "intervention.occurred": "human_active_time",
  "workspace.external_mutation": "workspace_diff",
  "human.manual_edit_declared": "human_active_time",
  "actor.attribution_changed": "actor_attribution",
  "actor.attribution_unknown": "actor_attribution"
};

const ATTRIBUTION_EVENT_TYPES = [
  "workspace.external_mutation",
  "human.manual_edit_declared",
  "actor.attribution_changed",
  "actor.attribution_unknown"
] as const;

const FORBIDDEN_SOURCES = [
  "internal-transcript",
  "internal-cache",
  "internal-log"
] as const;

const loadNormalize = async () => {
  try {
    return await import("../src/normalize.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const loadRedact = async () => {
  try {
    return await import("../src/redact.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const requireNormalize = async () => {
  const mod = await loadNormalize();
  assert.equal(typeof mod.normalizeClaudeEvent, "function", ABSENT);
  return mod.normalizeClaudeEvent as (input: unknown) => Record<string, unknown>;
};

const requireRedact = async () => {
  const mod = await loadRedact();
  assert.equal(typeof mod.redactClaudePayload, "function", ABSENT);
  return mod.redactClaudePayload as (payload: unknown) => Record<string, unknown>;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true, label);
  return value as Record<string, unknown>;
};

const serialize = (value: unknown): string => JSON.stringify(value);

const payloadChars = (payload: unknown): number => {
  if (payload === null || payload === undefined) return 0;
  if (typeof payload === "string") return payload.length;
  return serialize(payload).length;
};

const envelope = (
  source: string,
  native: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  source,
  native,
  run_id: RUN_ID,
  task_id: TASK_ID,
  correlation_id: CORRELATION_ID,
  identity: IDENTITY,
  timestamp: STAMP,
  parent_id: null,
  ...extra
});

const assertMapped = (
  value: unknown,
  eventType: string
): Record<string, unknown> => {
  const event = asRecord(value, `${eventType} must be an object`);
  assert.equal(event.status, "MAPPED", `${eventType} must map from a permitted source`);
  assert.equal(event.event_type, eventType, `${eventType} event_type`);
  assert.equal(event.event_group, EVENT_GROUP_OF[eventType], `${eventType} event_group`);
  for (const field of COMMON_FIELDS) {
    assert.equal(Object.hasOwn(event, field), true, `${eventType} missing ${field}`);
  }
  assert.equal(event.run_id, RUN_ID);
  assert.equal(event.task_id, TASK_ID);
  assert.equal(event.correlation_id, CORRELATION_ID);
  assert.equal(event.identity, IDENTITY);
  assert.equal(typeof event.event_id, "string", `${eventType} event_id`);
  assert.ok(String(event.event_id).length > 0, `${eventType} event_id must be non-empty`);
  assert.match(String(event.timestamp), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(
    (ACTORS as readonly string[]).includes(String(event.actor)),
    true,
    `${eventType} actor ${String(event.actor)} is outside the frozen actor set`
  );
  assert.equal(
    event.redaction_state === "none" || event.redaction_state === "redacted",
    true,
    `${eventType} redaction_state`
  );
  assert.ok(
    payloadChars(event.payload) <= BOUNDED_PAYLOAD_MAX_CHARS,
    `${eventType} payload exceeds the frozen 2048-character bound`
  );
  assert.equal(event.event_type === "tool_use", false, "vendor tool_use must not leak as event_type");
  assert.equal(event.event_type === "SDKMessage", false, "vendor SDKMessage must not leak as event_type");
  assert.equal(event.event_type === "stream-json", false, "vendor stream-json must not leak as event_type");
  return event;
};

const assertUnavailable = (value: unknown, label: string): Record<string, unknown> => {
  const event = asRecord(value, `${label} must be an object`);
  assert.equal(event.status, "UNAVAILABLE", `${label} must emit UNAVAILABLE rather than invent a mapping`);
  assert.notEqual(event.status, "MAPPED", `${label} must not be silently synthesized`);
  return event;
};

const dumpedIncludes = (value: unknown, needle: string): boolean =>
  serialize(value).includes(needle);

test("semantic-events", async () => {
  const normalizeClaudeEvent = await requireNormalize();

  const started = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", { type: "task.started" })),
    "task.started"
  );
  assert.equal(started.actor, "wrapper");
  assert.equal(started.parent_id, null);

  assertMapped(
    normalizeClaudeEvent(envelope("wrapper", { type: "task.ended" })),
    "task.ended"
  );

  const instruction = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: { role: "user", content: "do the task" }
    })),
    "user.instruction"
  );
  assert.equal(dumpedIncludes(instruction.payload, "do the task"), true);

  const streamed = assertMapped(
    normalizeClaudeEvent(envelope("stream-json", {
      type: "stream-json",
      subtype: "user",
      message: { role: "user", content: "clarify the bound" }
    })),
    "user.instruction"
  );
  assert.equal(dumpedIncludes(streamed.payload, "clarify the bound"), true);

  const toolCall = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "src/a.ts" } }]
      }
    }, { parent_id: instruction.event_id, known_event_ids: [instruction.event_id] })),
    "tool.call"
  );
  assert.equal(toolCall.parent_id, instruction.event_id);
  assert.equal(dumpedIncludes(toolCall.payload, "Read"), true);

  assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false }]
      }
    }, { parent_id: toolCall.event_id, known_event_ids: [instruction.event_id, toolCall.event_id] })),
    "tool.result"
  );

  assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "context.selected",
      selected: ["src/a.ts"]
    })),
    "context.selected"
  );

  assertMapped(
    normalizeClaudeEvent(envelope("permission-tool", {
      type: "mcp",
      name: "search",
      query: "bounded redaction"
    })),
    "retrieval.query"
  );

  assertMapped(
    normalizeClaudeEvent(envelope("permission-tool", {
      type: "mcp_result",
      name: "search",
      result: "redact secrets"
    })),
    "retrieval.result"
  );

  const delegated = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "agent.delegated",
      child_id: "sub-1"
    })),
    "agent.delegated"
  );
  assert.equal(dumpedIncludes(delegated.payload, "sub-1"), true);

  assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "handoff.created",
      handoff_id: "h1"
    })),
    "handoff.created"
  );

  const evidence = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "evidence.created",
      digest: DIGEST
    })),
    "evidence.created"
  );
  assert.equal(evidence.evidence_digest, DIGEST);

  assertMapped(
    normalizeClaudeEvent(envelope("permission-tool", {
      type: "permission",
      tool: "Bash",
      decision: "allow"
    })),
    "approval.granted"
  );

  const intervention = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", { type: "intervention.occurred" })),
    "intervention.occurred"
  );
  assert.equal(intervention.actor, "human/takeover");
});

test("delegation-gap", async () => {
  const normalizeClaudeEvent = await requireNormalize();

  const inferredReturn = assertUnavailable(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "agent.returned",
      inferred: true
    })),
    "inferred subagent return"
  );
  assert.notEqual(inferredReturn.status, "MAPPED");

  const inferredJoin = assertUnavailable(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "handoff.consumed",
      inferred: true
    })),
    "inferred handoff join"
  );
  assert.notEqual(inferredJoin.status, "MAPPED");

  const returnWithoutSpawn = assertUnavailable(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "agent.returned",
      child_id: "sub-missing"
    }, { known_event_ids: [] })),
    "return without a spawn proof"
  );
  assert.notEqual(returnWithoutSpawn.status, "MAPPED");

  const forbiddenJoin = assertUnavailable(
    normalizeClaudeEvent(envelope("internal-transcript", {
      type: "agent.returned",
      child_id: "sub-1"
    })),
    "internal transcript join"
  );
  assert.notEqual(forbiddenJoin.status, "MAPPED");

  const spawn = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "agent.delegated",
      child_id: "sub-1"
    })),
    "agent.delegated"
  );
  const provenReturn = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "agent.returned",
      child_id: "sub-1",
      spawn_id: spawn.event_id
    }, { parent_id: spawn.event_id, known_event_ids: [spawn.event_id] })),
    "agent.returned"
  );
  assert.equal(provenReturn.parent_id, spawn.event_id);

  const created = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "handoff.created",
      handoff_id: "h1"
    })),
    "handoff.created"
  );
  const consumed = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "handoff.consumed",
      handoff_id: "h1",
      created_id: created.event_id
    }, { parent_id: created.event_id, known_event_ids: [created.event_id] })),
    "handoff.consumed"
  );
  assert.equal(consumed.parent_id, created.event_id);
});

test("secret-canary", async () => {
  const normalizeClaudeEvent = await requireNormalize();
  const redactClaudePayload = await requireRedact();

  const redacted = asRecord(
    redactClaudePayload({
      text: `excerpt ${SECRET_CANARY} ${API_KEY} ${HIDDEN} excerpt`
    }),
    "redactClaudePayload result"
  );
  assert.equal(Object.hasOwn(redacted, "payload"), true, "redactClaudePayload must return payload");
  assert.equal(redacted.redaction_state, "redacted");
  const redactedDump = serialize(redacted);
  assert.equal(redactedDump.includes(SECRET_CANARY), false, "raw secret canary must not be stored");
  assert.equal(redactedDump.includes(API_KEY), false, "raw API key must not be stored");
  assert.equal(redactedDump.includes(HIDDEN), false, "hidden reasoning must not be stored");

  const clean = asRecord(redactClaudePayload({ text: "safe excerpt" }), "clean redact");
  assert.equal(clean.redaction_state, "none");
  assert.equal(dumpedIncludes(clean.payload, "safe excerpt"), true);
  assert.equal(serialize(clean).includes(SECRET_CANARY), false);

  const mapped = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: {
        role: "user",
        content: `prompt ${SECRET_CANARY} ${API_KEY} ${HIDDEN}`
      }
    })),
    "user.instruction"
  );
  assert.equal(mapped.redaction_state, "redacted");
  const mappedDump = serialize(mapped);
  assert.equal(mappedDump.includes(SECRET_CANARY), false, "normalized event leaked the secret canary");
  assert.equal(mappedDump.includes(API_KEY), false, "normalized event leaked the API key");
  assert.equal(mappedDump.includes(HIDDEN), false, "normalized event leaked hidden reasoning");
});

test("oversized", async () => {
  const normalizeClaudeEvent = await requireNormalize();
  const redactClaudePayload = await requireRedact();

  const bounded = asRecord(
    redactClaudePayload({ text: "x".repeat(BOUNDED_PAYLOAD_MAX_CHARS) }),
    "exact-bound redact"
  );
  assert.ok(payloadChars(bounded.payload) <= BOUNDED_PAYLOAD_MAX_CHARS);

  const oversized = asRecord(
    redactClaudePayload({ text: "x".repeat(BOUNDED_PAYLOAD_MAX_CHARS + 1) }),
    "oversized redact"
  );
  assert.equal(oversized.redaction_state, "redacted");
  assert.ok(
    payloadChars(oversized.payload) <= BOUNDED_PAYLOAD_MAX_CHARS,
    "redactClaudePayload must bound excerpts to 2048 characters"
  );

  const mapped = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: { role: "user", content: "y".repeat(BOUNDED_PAYLOAD_MAX_CHARS + 1) }
    })),
    "user.instruction"
  );
  assert.equal(mapped.redaction_state, "redacted");
  assert.ok(
    payloadChars(mapped.payload) <= BOUNDED_PAYLOAD_MAX_CHARS,
    "normalizeClaudeEvent must not emit an unbounded payload"
  );
});

test("missing-parent", async () => {
  const normalizeClaudeEvent = await requireNormalize();

  const parent = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: { role: "user", content: "parent turn" }
    })),
    "user.instruction"
  );

  const child = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t-parent", name: "Read", input: { path: "src/a.ts" } }]
      }
    }, { parent_id: parent.event_id, known_event_ids: [parent.event_id] })),
    "tool.call"
  );
  assert.equal(child.parent_id, parent.event_id);

  const dangling = assertUnavailable(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t-orphan", name: "Read", input: { path: "src/b.ts" } }]
      }
    }, { parent_id: "no-such-event", known_event_ids: [parent.event_id] })),
    "dangling parent_id"
  );
  assert.notEqual(dangling.status, "MAPPED");
  assert.notEqual(dangling.parent_id, parent.event_id);

  const omittedKnown = assertUnavailable(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t-empty", name: "Read", input: { path: "src/c.ts" } }]
      }
    }, { parent_id: parent.event_id, known_event_ids: [] })),
    "parent_id with empty known_event_ids"
  );
  assert.notEqual(omittedKnown.status, "MAPPED");
});

test("tool-error", async () => {
  const normalizeClaudeEvent = await requireNormalize();

  const call = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t-err", name: "Bash", input: { command: "false" } }]
      }
    })),
    "tool.call"
  );

  const failed = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "t-err",
          content: "exit 1: permission denied",
          is_error: true
        }]
      }
    }, { parent_id: call.event_id, known_event_ids: [call.event_id] })),
    "tool.error"
  );
  assert.notEqual(failed.event_type, "tool.result");
  assert.equal(failed.event_group, "tool_call");
  assert.equal(dumpedIncludes(failed.payload, "permission denied"), true);

  const namedError = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "t-err",
          content: "boom",
          error: "ToolError"
        }]
      }
    }, { parent_id: call.event_id, known_event_ids: [call.event_id] })),
    "tool.error"
  );
  assert.notEqual(namedError.event_type, "tool.result");
  assert.equal(dumpedIncludes(namedError.payload, "boom"), true);

  const success = assertMapped(
    normalizeClaudeEvent(envelope("sdkQuery", {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t-err", content: "ok", is_error: false }]
      }
    }, { parent_id: call.event_id, known_event_ids: [call.event_id] })),
    "tool.result"
  );
  assert.notEqual(success.event_type, "tool.error");
});

test("actor-attribution-events", async () => {
  const normalizeClaudeEvent = await requireNormalize();

  const external = assertMapped(
    normalizeClaudeEvent(envelope("workspace", {
      type: "workspace.external_mutation",
      path: "src/a.ts"
    })),
    "workspace.external_mutation"
  );
  assert.equal(external.actor, "external_mutation");
  assert.equal(typeof external.provenance, "string");
  assert.ok(String(external.provenance).length > 0);

  const declared = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "human.manual_edit_declared",
      path: "src/a.ts"
    })),
    "human.manual_edit_declared"
  );
  assert.equal(declared.actor, "human/takeover");
  assert.equal(typeof declared.provenance, "string");
  assert.ok(String(declared.provenance).length > 0);

  const changed = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "actor.attribution_changed",
      from_actor: "agent",
      to_actor: "human/takeover",
      provenance: "wrapper-workspace-correlation"
    })),
    "actor.attribution_changed"
  );
  assert.equal(changed.from_actor, "agent");
  assert.equal(changed.to_actor, "human/takeover");
  assert.equal(changed.provenance, "wrapper-workspace-correlation");

  const unknown = assertMapped(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "actor.attribution_unknown"
    })),
    "actor.attribution_unknown"
  );
  assert.equal(unknown.actor, "actor.attribution_unknown");
  assert.equal(typeof unknown.confidence, "number");
  assert.ok(
    Number(unknown.confidence) < 0.7,
    "actor.attribution_unknown must drop confidence below the frozen 0.7 threshold"
  );
  assert.equal(typeof unknown.provenance, "string");
  assert.ok(String(unknown.provenance).length > 0);

  for (const eventType of ATTRIBUTION_EVENT_TYPES) {
    const forbidden = assertUnavailable(
      normalizeClaudeEvent(envelope("internal-transcript", {
        type: eventType,
        from_actor: "agent",
        to_actor: "human/takeover",
        path: "src/forged.ts",
        provenance: "internal transcript"
      })),
      `forbidden source ${eventType}`
    );
    assert.notEqual(forbidden.status, "MAPPED");
    assert.notEqual(
      forbidden.status === "MAPPED" && forbidden.event_type === "actor.attribution_changed",
      true,
      "unsupported sources must never synthesize actor.attribution_changed"
    );
  }

  const guessedChange = assertUnavailable(
    normalizeClaudeEvent(envelope("wrapper", {
      type: "actor.attribution_changed",
      from_actor: "agent",
      to_actor: "human/takeover"
    })),
    "attribution change without provenance proof"
  );
  assert.notEqual(guessedChange.status, "MAPPED");
});
