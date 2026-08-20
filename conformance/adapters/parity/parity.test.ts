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

const loadClaudeNormalize = async () => {
  try {
    return await import("../../../adapters/claude-code/src/normalize.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const loadCodexNormalize = async () => {
  try {
    return await import("../../../adapters/codex/src/normalize.ts");
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

type NormalizeEvent = (input: unknown) => Record<string, unknown>;

type SemanticParityAdapters = {
  normalizeClaudeEvent?: NormalizeEvent;
  normalizeCodexEvent?: NormalizeEvent;
};

type CompareSemanticTrace = (
  left: unknown,
  right: unknown,
  adapters?: SemanticParityAdapters
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

const requireAdapters = async (): Promise<SemanticParityAdapters> => {
  const claude = await loadClaudeNormalize();
  const codex = await loadCodexNormalize();
  assert.equal(
    typeof claude.normalizeClaudeEvent,
    "function",
    "normalizeClaudeEvent is a verified E9-002 dependency and must be the real adapter export"
  );
  assert.equal(
    typeof codex.normalizeCodexEvent,
    "undefined",
    "normalizeCodexEvent is not in this tree; a stub would manufacture parity"
  );
  return {
    normalizeClaudeEvent: claude.normalizeClaudeEvent as NormalizeEvent,
    normalizeCodexEvent: typeof codex.normalizeCodexEvent === "function"
      ? (codex.normalizeCodexEvent as NormalizeEvent)
      : undefined
  };
};

const claudeEnvelope = (
  source: string,
  native: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  source,
  native,
  run_id: RUN_ID,
  task_id: TASK_ID,
  correlation_id: CORR,
  identity: CLAUDE_IDENTITY,
  timestamp: STAMP,
  parent_id: null,
  ...extra
});

const nativeTrace = (
  runtime: "codex" | "claude-code",
  native: unknown,
  capability: CapabilityDigest = runtime === "codex" ? CODEX_CAPABILITY : CLAUDE_CAPABILITY
) => ({
  runtime,
  identity: runtime === "codex" ? CODEX_IDENTITY : CLAUDE_IDENTITY,
  capability,
  native
});

const eventsTrace = (
  runtime: "codex" | "claude-code",
  events: unknown[],
  capability: CapabilityDigest = runtime === "codex" ? CODEX_CAPABILITY : CLAUDE_CAPABILITY
) => ({
  runtime,
  identity: runtime === "codex" ? CODEX_IDENTITY : CLAUDE_IDENTITY,
  capability,
  events
});

const fieldOf = (
  differences: Array<{ field: string; left: unknown; right: unknown }>,
  field: string
) => differences.find((entry) => entry.field === field);

const hasError = (errors: string[], pattern: RegExp): boolean =>
  errors.some((entry) => pattern.test(entry));

const mismatchField = (
  mismatches: Array<{ field: string }>,
  field: string
): boolean => mismatches.some((entry) => entry.field === field);

const assertCodexUnavailable = (result: {
  equivalent: boolean;
  left: unknown[];
  errors: string[];
}): void => {
  assert.equal(
    result.equivalent,
    false,
    "Codex-Claude parity must not be claimed without a real Codex normalizer"
  );
  assert.equal(result.left.length, 0, "Codex side must not be filled with hand-built events");
  assert.equal(
    hasError(result.errors, /codex.+normalizer is unavailable/i),
    true,
    "missing normalizeCodexEvent must fail closed rather than substitute a fixture event"
  );
};

const assertClaudeMatchesNormalizer = (
  projected: Record<string, unknown> | undefined,
  expected: Record<string, unknown>
): void => {
  assert.ok(projected, PINNED);
  assert.equal(projected?.event_type, expected.event_type, PINNED);
  assert.equal(projected?.event_group, expected.event_group, PINNED);
  assert.equal(projected?.status, expected.status, PINNED);
  assert.equal(projected?.actor, expected.actor, PINNED);
  assert.equal(projected?.evidence_digest, expected.evidence_digest, PINNED);
  assert.deepEqual(projected?.payload, expected.payload, PINNED);
};

const isolationEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  event_id: "evt-isolation",
  run_id: RUN_ID,
  task_id: TASK_ID,
  timestamp: STAMP,
  actor: "agent",
  event_type: "tool.error",
  event_group: "tool_call",
  parent_id: null,
  correlation_id: CORR,
  identity: CODEX_IDENTITY,
  evidence_digest: null,
  redaction_state: "none",
  payload: "ENOENT src/missing.ts",
  status: "MAPPED",
  ...overrides
});

const assertIsolatedField = async (field: string, leftValue: unknown, rightValue: unknown) => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    eventsTrace("codex", [isolationEvent({ [field]: leftValue })]),
    eventsTrace("claude-code", [isolationEvent({ [field]: rightValue })])
  );
  assert.equal(result.equivalent, false, `a sole ${field} mismatch must not be equivalent`);
  assert.equal(
    mismatchField(result.required_field_mismatches, field),
    true,
    `dropping ${field} comparison must kill this case`
  );
  assert.equal(
    result.required_field_mismatches.every((entry) => entry.field === field || entry.field === "length"),
    true,
    `${field} isolation must not be carried by a second required-field mismatch`
  );
};

test("lifecycle", async () => {
  const compareSemanticTrace = await requireCompare();
  const adapters = await requireAdapters();
  const startedNative = claudeEnvelope("wrapper", { type: "task.started" });
  const started = adapters.normalizeClaudeEvent!(startedNative);
  const endedNative = claudeEnvelope("wrapper", { type: "task.ended" }, {
    parent_id: started.event_id,
    known_event_ids: [started.event_id]
  });
  const ended = adapters.normalizeClaudeEvent!(endedNative);
  const result = compareSemanticTrace(
    nativeTrace("codex", [
      { source: "wrapper", type: "task.started" },
      { source: "wrapper", type: "task.ended" }
    ]),
    nativeTrace("claude-code", [startedNative, endedNative]),
    adapters
  );

  assertClaudeMatchesNormalizer(result.right[0], started);
  assertClaudeMatchesNormalizer(result.right[1], ended);
  assertCodexUnavailable(result);
  assert.equal(result.right[1]?.parent_id, 0, "shared lifecycle parent_id must canonicalize to a local index");
  assert.deepEqual(
    result.right.map((event) => event.event_type),
    ["task.started", "task.ended"]
  );
  assert.equal(result.right[0]?.event_group, "run_lifecycle");
});

test("tool-error", async () => {
  const compareSemanticTrace = await requireCompare();
  const adapters = await requireAdapters();
  const claudeNative = claudeEnvelope("sdkQuery", {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "ENOENT src/missing.ts" }]
    }
  });
  const expected = adapters.normalizeClaudeEvent!(claudeNative);
  const result = compareSemanticTrace(
    nativeTrace("codex", {
      source: "app-server",
      method: "item/tool/call",
      error: "ENOENT src/missing.ts"
    }),
    nativeTrace("claude-code", claudeNative),
    adapters
  );

  assertClaudeMatchesNormalizer(result.right[0], expected);
  assertCodexUnavailable(result);
  assert.equal(expected.payload, "ENOENT src/missing.ts");
  assert.equal(result.right[0]?.event_group, "tool_call");
});

test("approval", async () => {
  const compareSemanticTrace = await requireCompare();
  const adapters = await requireAdapters();
  const claudeNative = claudeEnvelope("permission-tool", {
    type: "permission",
    tool: "Bash",
    decision: "allow"
  });
  const expected = adapters.normalizeClaudeEvent!(claudeNative);
  const result = compareSemanticTrace(
    nativeTrace("codex", {
      source: "sandbox-approval-wrapper",
      decision: "allow",
      tool: "Bash"
    }),
    nativeTrace("claude-code", claudeNative),
    adapters
  );

  assertClaudeMatchesNormalizer(result.right[0], expected);
  assertCodexUnavailable(result);
  assert.deepEqual(expected.payload, { tool: "Bash", decision: "allow" });
  assert.notEqual(expected.payload, "Bash");
  assert.equal(result.right[0]?.event_group, "approval_safety");
});

test("evidence", async () => {
  const compareSemanticTrace = await requireCompare();
  const adapters = await requireAdapters();
  const claudeNative = claudeEnvelope("wrapper", { type: "evidence.created", digest: DIGEST });
  const expected = adapters.normalizeClaudeEvent!(claudeNative);
  const result = compareSemanticTrace(
    nativeTrace("codex", {
      source: "wrapper",
      type: "evidence.created",
      digest: DIGEST
    }),
    nativeTrace("claude-code", claudeNative),
    adapters
  );

  assertClaudeMatchesNormalizer(result.right[0], expected);
  assertCodexUnavailable(result);
  assert.deepEqual(expected.payload, { digest: DIGEST });
  assert.notEqual(expected.payload, DIGEST);
  assert.equal(result.right[0]?.evidence_digest, DIGEST);
  assert.equal(result.right[0]?.event_group, "evidence_claim");
});

test("intervention", async () => {
  const compareSemanticTrace = await requireCompare();
  const adapters = await requireAdapters();
  const claudeNative = claudeEnvelope("wrapper", { type: "intervention.occurred" });
  const expected = adapters.normalizeClaudeEvent!(claudeNative);
  const result = compareSemanticTrace(
    nativeTrace("codex", {
      source: "wrapper",
      type: "intervention.occurred"
    }),
    nativeTrace("claude-code", claudeNative),
    adapters
  );

  assertClaudeMatchesNormalizer(result.right[0], expected);
  assertCodexUnavailable(result);
  assert.equal(result.right[0]?.actor, "human/takeover");
  assert.equal(result.right[0]?.event_group, "human_active_time");
});

test("unavailable-difference", async () => {
  const compareSemanticTrace = await requireCompare();
  const adapters = await requireAdapters();
  const claudeNative = claudeEnvelope("wrapper", { type: "evidence.created" });
  const expected = adapters.normalizeClaudeEvent!(claudeNative);
  const result = compareSemanticTrace(
    nativeTrace("codex", {
      source: "wrapper",
      type: "evidence.created",
      digest: DIGEST
    }),
    nativeTrace("claude-code", claudeNative),
    adapters
  );

  assertClaudeMatchesNormalizer(result.right[0], expected);
  assertCodexUnavailable(result);
  assert.equal(expected.status, "UNAVAILABLE");
  assert.equal(result.right[0]?.status, "UNAVAILABLE", "UNAVAILABLE state must not be erased from the projection");
  assert.notEqual(result.right[0]?.status, "MAPPED");
  assert.equal(result.right[0]?.event_type, "evidence.created");
});

test("profile-difference", async () => {
  const compareSemanticTrace = await requireCompare();
  const adapters = await requireAdapters();
  const claudeNative = claudeEnvelope("wrapper", { type: "task.started" });
  const expected = adapters.normalizeClaudeEvent!(claudeNative);
  const result = compareSemanticTrace(
    nativeTrace("codex", { source: "wrapper", type: "task.started" }),
    nativeTrace("claude-code", claudeNative),
    adapters
  );

  assertClaudeMatchesNormalizer(result.right[0], expected);
  assertCodexUnavailable(result);

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

test("absent-status", async () => {
  const compareSemanticTrace = await requireCompare();
  const mapped = isolationEvent({ status: "MAPPED" });
  const { status: _ignored, ...withoutStatus } = mapped;
  const result = compareSemanticTrace(
    eventsTrace("codex", [mapped]),
    eventsTrace("claude-code", [withoutStatus])
  );

  assert.equal(result.equivalent, false, "an absent status must fail closed, not default to MAPPED");
  assert.notEqual(result.right[0]?.status, "MAPPED", "missing status must not be rewritten to MAPPED");
  assert.equal(
    hasError(result.errors, /status is missing/i),
    true,
    "absent status must be recorded as a fail-closed error"
  );
});

test("malformed-events", async () => {
  const compareSemanticTrace = await requireCompare();
  const result = compareSemanticTrace(
    eventsTrace("codex", [isolationEvent(), "garbage", 42, null]),
    eventsTrace("claude-code", [isolationEvent()])
  );

  assert.equal(
    result.equivalent,
    false,
    "a malformed event array must fail closed rather than drop garbage into a match"
  );
  assert.equal(
    hasError(result.errors, /events\[\d+] is not an object/i),
    true,
    "non-object events must be reported rather than filtered away"
  );
});

test("field-isolation-payload", async () => {
  await assertIsolatedField("payload", "left-payload", "right-payload");
});

test("field-isolation-event_type", async () => {
  await assertIsolatedField("event_type", "tool.error", "tool.result");
});

test("field-isolation-event_group", async () => {
  await assertIsolatedField("event_group", "tool_call", "run_lifecycle");
});

test("field-isolation-actor", async () => {
  await assertIsolatedField("actor", "agent", "human/takeover");
});

test("field-isolation-status", async () => {
  await assertIsolatedField("status", "MAPPED", "UNAVAILABLE");
});

test("field-isolation-evidence_digest", async () => {
  await assertIsolatedField("evidence_digest", DIGEST, null);
});

test("field-isolation-task_id", async () => {
  await assertIsolatedField("task_id", "task-left", "task-right");
});

test("field-isolation-parent_id", async () => {
  await assertIsolatedField("parent_id", null, "parent-right");
});

test("field-isolation-redaction_state", async () => {
  await assertIsolatedField("redaction_state", "none", "redacted");
});
