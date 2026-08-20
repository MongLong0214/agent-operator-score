import { test } from "node:test";
import assert from "node:assert/strict";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadParity = async () => {
  try {
    return await import("../../../packages/schema/src/semantic-parity.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

// The ticket's pinned pre-GREEN reason, verbatim from E9-003 `## RED contract`.
const PINNED =
  "equivalent native inputs are not proven to yield equivalent normalized semantics.";

const RUN_ID = "run-e9-003";
const TASK_ID = "task-e9-003";
const CORR = "corr-e9-003";
const STAMP = "2026-08-21T12:00:00.000Z";
const DIGEST = "a".repeat(64);

const CODEX_IDENTITY = "codex|gpt-5.4|codex-cli";
const CLAUDE_IDENTITY = "claude-code|claude-opus-4-20250514|claude-code-cli";

const EVENT_GROUP_OF: Record<string, string> = {
  "task.started": "run_lifecycle",
  "task.ended": "run_lifecycle",
  "tool.error": "tool_call",
  "approval.granted": "approval_safety",
  "evidence.created": "evidence_claim",
  "intervention.occurred": "human_active_time"
};

const DIGEST_FIELDS = [
  "runtime_version",
  "protocol_or_schema_version",
  "adapter_version",
  "source_class",
  "supported_event_groups",
  "known_missing_events"
] as const;

const CODEX_CAPABILITY = {
  runtime_version: "codex-0.0.0",
  protocol_or_schema_version: "app-server-jsonrpc",
  adapter_version: "aos-adapter-codex-0.0.0",
  source_class: "PRIMARY",
  supported_event_groups: ["run_lifecycle", "tool_call", "approval_safety", "evidence_claim", "human_active_time"],
  known_missing_events: ["delegation.inferred_join"]
};

const CLAUDE_CAPABILITY = {
  runtime_version: "claude-code-unknown",
  protocol_or_schema_version: "sdk-query-stream-json",
  adapter_version: "aos-adapter-claude-code-0.0.0",
  source_class: "PRIMARY",
  supported_event_groups: ["run_lifecycle", "tool_call", "approval_safety", "evidence_claim", "human_active_time"],
  known_missing_events: ["delegation.inferred_join"]
};

type CapabilityDigest = typeof CODEX_CAPABILITY;

type CompareSemanticTrace = (
  left: unknown,
  right: unknown
) => {
  equivalent: boolean;
  left: Record<string, unknown>[];
  right: Record<string, unknown>[];
  required_field_mismatches: Array<{ index: number; field: string; left: unknown; right: unknown }>;
  unavailable_differences: Array<{
    index: number;
    event_type: string;
    left_status: string;
    right_status: string;
  }>;
  profile_differences: Array<{ field: string; left: unknown; right: unknown }>;
  errors: string[];
};

const requireCompare = async (): Promise<CompareSemanticTrace> => {
  const mod = await loadParity();
  assert.equal(typeof mod.compareSemanticTrace, "function", PINNED);
  return mod.compareSemanticTrace as CompareSemanticTrace;
};

const actorFor = (eventType: string): string => {
  if (eventType === "task.started" || eventType === "task.ended") return "wrapper";
  if (eventType === "intervention.occurred") return "human/takeover";
  return "agent";
};

const semanticEvent = (
  runtime: "codex" | "claude-code",
  eventType: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  event_id: extra.event_id ?? `${runtime}:${eventType}`,
  run_id: RUN_ID,
  task_id: TASK_ID,
  timestamp: STAMP,
  actor: extra.actor ?? actorFor(eventType),
  event_type: eventType,
  event_group: EVENT_GROUP_OF[eventType],
  parent_id: extra.parent_id ?? null,
  correlation_id: CORR,
  identity: runtime === "codex" ? CODEX_IDENTITY : CLAUDE_IDENTITY,
  evidence_digest: extra.evidence_digest ?? null,
  redaction_state: extra.redaction_state ?? "none",
  payload: extra.payload ?? null,
  status: extra.status ?? "MAPPED"
});

const trace = (
  runtime: "codex" | "claude-code",
  events: Record<string, unknown>[],
  native: unknown,
  capability: CapabilityDigest = runtime === "codex" ? CODEX_CAPABILITY : CLAUDE_CAPABILITY
) => ({
  runtime,
  identity: runtime === "codex" ? CODEX_IDENTITY : CLAUDE_IDENTITY,
  capability,
  native,
  events
});

const typesOf = (projections: Record<string, unknown>[]): string[] =>
  projections.map((event) => String(event.event_type));

const fieldOf = (
  differences: Array<{ field: string; left: unknown; right: unknown }>,
  field: string
) => differences.find((entry) => entry.field === field);

test("lifecycle", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    trace("codex", [
      semanticEvent("codex", "task.started", { payload: "task-open" }),
      semanticEvent("codex", "task.ended", { payload: "task-close", parent_id: "codex:task.started" })
    ], [
      { source: "wrapper", type: "task.started" },
      { source: "wrapper", type: "task.ended" }
    ]),
    trace("claude-code", [
      semanticEvent("claude-code", "task.started", { payload: "task-open" }),
      semanticEvent("claude-code", "task.ended", { payload: "task-close", parent_id: "claude-code:task.started" })
    ], [
      { source: "wrapper", native: { type: "task.started" } },
      { source: "wrapper", native: { type: "task.ended" } }
    ])
  );

  assert.equal(result.equivalent, true, "shared lifecycle events must canonicalize equivalently");
  assert.deepEqual(typesOf(result.left), ["task.started", "task.ended"]);
  assert.deepEqual(typesOf(result.right), ["task.started", "task.ended"]);
  assert.equal(result.left[0]?.event_group, "run_lifecycle");
  assert.equal(result.right[0]?.event_group, "run_lifecycle");
  assert.equal(result.required_field_mismatches.length, 0);
  assert.equal(result.unavailable_differences.length, 0);
});

test("tool-error", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    trace("codex", [
      semanticEvent("codex", "tool.error", { payload: "ENOENT src/missing.ts" })
    ], {
      source: "app-server",
      method: "item/tool/call",
      error: "ENOENT src/missing.ts"
    }),
    trace("claude-code", [
      semanticEvent("claude-code", "tool.error", { payload: "ENOENT src/missing.ts" })
    ], {
      source: "sdkQuery",
      native: {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "ENOENT src/missing.ts" }]
        }
      }
    })
  );

  assert.equal(result.equivalent, true, "shared tool-error events must canonicalize equivalently");
  assert.deepEqual(typesOf(result.left), ["tool.error"]);
  assert.deepEqual(typesOf(result.right), ["tool.error"]);
  assert.equal(result.left[0]?.event_group, "tool_call");
  assert.equal(result.left[0]?.payload, "ENOENT src/missing.ts");
  assert.equal(result.right[0]?.payload, "ENOENT src/missing.ts");
  assert.equal(result.required_field_mismatches.length, 0);
});

test("approval", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    trace("codex", [
      semanticEvent("codex", "approval.granted", { payload: "Bash" })
    ], {
      source: "sandbox-approval-wrapper",
      decision: "allow",
      tool: "Bash"
    }),
    trace("claude-code", [
      semanticEvent("claude-code", "approval.granted", { payload: "Bash" })
    ], {
      source: "permission-tool",
      native: { type: "permission", tool: "Bash", decision: "allow" }
    })
  );

  assert.equal(result.equivalent, true, "shared approval events must canonicalize equivalently");
  assert.deepEqual(typesOf(result.left), ["approval.granted"]);
  assert.deepEqual(typesOf(result.right), ["approval.granted"]);
  assert.equal(result.left[0]?.event_group, "approval_safety");
  assert.equal(result.required_field_mismatches.length, 0);
});

test("evidence", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    trace("codex", [
      semanticEvent("codex", "evidence.created", { payload: DIGEST, evidence_digest: DIGEST })
    ], {
      source: "wrapper",
      type: "evidence.created",
      digest: DIGEST
    }),
    trace("claude-code", [
      semanticEvent("claude-code", "evidence.created", { payload: DIGEST, evidence_digest: DIGEST })
    ], {
      source: "wrapper",
      native: { type: "evidence.created", digest: DIGEST }
    })
  );

  assert.equal(result.equivalent, true, "shared evidence events must canonicalize equivalently");
  assert.deepEqual(typesOf(result.left), ["evidence.created"]);
  assert.deepEqual(typesOf(result.right), ["evidence.created"]);
  assert.equal(result.left[0]?.event_group, "evidence_claim");
  assert.equal(result.left[0]?.evidence_digest, DIGEST);
  assert.equal(result.right[0]?.evidence_digest, DIGEST);
  assert.equal(result.required_field_mismatches.length, 0);
});

test("intervention", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    trace("codex", [
      semanticEvent("codex", "intervention.occurred", { payload: "takeover" })
    ], {
      source: "wrapper",
      type: "intervention.occurred"
    }),
    trace("claude-code", [
      semanticEvent("claude-code", "intervention.occurred", { payload: "takeover" })
    ], {
      source: "wrapper",
      native: { type: "intervention.occurred" }
    })
  );

  assert.equal(result.equivalent, true, "shared intervention events must canonicalize equivalently");
  assert.deepEqual(typesOf(result.left), ["intervention.occurred"]);
  assert.deepEqual(typesOf(result.right), ["intervention.occurred"]);
  assert.equal(result.left[0]?.actor, "human/takeover");
  assert.equal(result.right[0]?.actor, "human/takeover");
  assert.equal(result.left[0]?.event_group, "human_active_time");
  assert.equal(result.required_field_mismatches.length, 0);
});

test("unavailable-difference", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    trace("codex", [
      semanticEvent("codex", "evidence.created", { payload: DIGEST, evidence_digest: DIGEST })
    ], {
      source: "wrapper",
      type: "evidence.created",
      digest: DIGEST
    }),
    trace("claude-code", [
      semanticEvent("claude-code", "evidence.created", { status: "UNAVAILABLE", payload: null, evidence_digest: null })
    ], {
      source: "wrapper",
      native: { type: "evidence.created" }
    })
  );

  assert.equal(result.equivalent, false, "an UNAVAILABLE gap must not be coerced into semantic equivalence");
  assert.ok(result.unavailable_differences.length >= 1, "declared UNAVAILABLE differences must stay visible");
  assert.equal(result.right[0]?.status, "UNAVAILABLE", "UNAVAILABLE state must not be erased from the projection");
  assert.notEqual(result.right[0]?.status, "MAPPED");
  assert.equal(result.unavailable_differences[0]?.event_type, "evidence.created");
  assert.equal(result.unavailable_differences[0]?.left_status, "MAPPED");
  assert.equal(result.unavailable_differences[0]?.right_status, "UNAVAILABLE");
});

test("profile-difference", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    trace("codex", [
      semanticEvent("codex", "task.started", { payload: "task-open" })
    ], { source: "wrapper", type: "task.started" }),
    trace("claude-code", [
      semanticEvent("claude-code", "task.started", { payload: "task-open" })
    ], { source: "wrapper", native: { type: "task.started" } })
  );

  assert.equal(result.equivalent, true, "identity and capability profile mismatch must not break shared semantics");
  assert.equal(result.required_field_mismatches.length, 0);
  assert.equal(result.unavailable_differences.length, 0);

  const identity = fieldOf(result.profile_differences, "identity");
  assert.ok(identity, "identity must be reported as an allowed profile difference");
  assert.equal(identity?.left, CODEX_IDENTITY);
  assert.equal(identity?.right, CLAUDE_IDENTITY);

  const runtime = fieldOf(result.profile_differences, "runtime");
  assert.ok(runtime, "runtime must be reported as an allowed profile difference");
  assert.equal(runtime?.left, "codex");
  assert.equal(runtime?.right, "claude-code");

  for (const field of DIGEST_FIELDS) {
    if (JSON.stringify(CODEX_CAPABILITY[field]) === JSON.stringify(CLAUDE_CAPABILITY[field])) continue;
    const difference = fieldOf(result.profile_differences, field);
    assert.ok(difference, `${field} must be reported as an allowed capability difference`);
    assert.deepEqual(difference?.left, CODEX_CAPABILITY[field]);
    assert.deepEqual(difference?.right, CLAUDE_CAPABILITY[field]);
  }

  assert.equal(
    fieldOf(result.profile_differences, "source_class") === undefined,
    true,
    "matching capability fields must not be reported as differences"
  );
});
