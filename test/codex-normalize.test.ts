import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const FAILURE = "native/wrapper inputs can leak canaries or omit required correlation.";
const BOUND = 2048;
const SECRET_CANARY = "AOS_SECRET_CANARY";
const RUN_ID = "codex-run-1";
const TASK_ID = "task-1";
const CORRELATION_ID = "corr-1";
const IDENTITY = "codex|gpt-5-codex|app-server-v1";
const STAMP = "2026-08-22T00:00:00.000Z";
const DIGEST = "a".repeat(64);

const EVENT_GROUP_OF: Record<string, string> = {
  "assessment.started": "run_lifecycle",
  "assessment.ended": "run_lifecycle",
  "adapter.capability_declared": "runtime_identity",
  "task.started": "run_lifecycle",
  "task.ended": "run_lifecycle",
  "user.instruction": "user_instruction",
  "user.clarification": "user_instruction",
  "tool.call": "tool_call",
  "tool.result": "tool_call",
  "tool.error": "tool_call",
  "evidence.created": "evidence_claim",
  "evidence.invalidated": "evidence_claim",
  "completion.claimed": "evidence_claim",
  "approval.requested": "approval_safety",
  "approval.granted": "approval_safety",
  "approval.denied": "approval_safety",
  "intervention.occurred": "human_active_time",
  "workspace.external_mutation": "workspace_diff",
  "human.manual_edit_declared": "human_active_time",
  "actor.attribution_changed": "actor_attribution",
  "actor.attribution_unknown": "actor_attribution"
};

type Normalizer = (input: unknown) => Record<string, unknown>;
type Redactor = (input: unknown) => Record<string, unknown>;
type Wrapper = (input: unknown) => Record<string, unknown>;
type TraceParser = (event: unknown, schema: unknown, registry: unknown) => { ok: boolean; errors: string[] };
type NormalizeModule = { normalizeCodexEvent?: Normalizer };
type RedactModule = { redactCodexPayload?: Redactor };
type WrapperModule = { runCodexControlled?: Wrapper };
type TraceModule = { parseTraceEvent?: TraceParser };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const loadNormalize = async (): Promise<NormalizeModule> => {
  try {
    const loaded = await import("../src/adapters/codex/normalize.ts");
    return { normalizeCodexEvent: loaded.normalizeCodexEvent };
  } catch {
    return {};
  }
};

const loadRedact = async (): Promise<RedactModule> => {
  try {
    const loaded = await import("../src/adapters/codex/redact.ts");
    return { redactCodexPayload: loaded.redactCodexPayload };
  } catch {
    return {};
  }
};

const loadWrapper = async (): Promise<WrapperModule> => {
  try {
    const loaded = await import("../src/adapters/codex/wrapper.ts");
    return { runCodexControlled: loaded.runCodexControlled };
  } catch {
    return {};
  }
};

const loadTrace = async (): Promise<TraceModule> => {
  try {
    const loaded = await import("../src/schema/trace.ts");
    return { parseTraceEvent: loaded.parseTraceEvent };
  } catch {
    return {};
  }
};

const requireNormalize = async (): Promise<Normalizer> => {
  const loaded = await loadNormalize();
  assert.equal(typeof loaded.normalizeCodexEvent, "function", FAILURE);
  if (typeof loaded.normalizeCodexEvent !== "function") throw new Error(FAILURE);
  return loaded.normalizeCodexEvent;
};

const requireRedact = async (): Promise<Redactor> => {
  const loaded = await loadRedact();
  assert.equal(typeof loaded.redactCodexPayload, "function", FAILURE);
  if (typeof loaded.redactCodexPayload !== "function") throw new Error(FAILURE);
  return loaded.redactCodexPayload;
};

const requireWrapper = async (): Promise<Wrapper> => {
  const loaded = await loadWrapper();
  assert.equal(typeof loaded.runCodexControlled, "function", FAILURE);
  if (typeof loaded.runCodexControlled !== "function") throw new Error(FAILURE);
  return loaded.runCodexControlled;
};

const requireTrace = async (): Promise<TraceParser> => {
  const loaded = await loadTrace();
  assert.equal(typeof loaded.parseTraceEvent, "function", FAILURE);
  if (typeof loaded.parseTraceEvent !== "function") throw new Error(FAILURE);
  return loaded.parseTraceEvent;
};

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../specs/aos-trace.schema.json");
const registryPath = resolve(here, "../specs/events.v0.json");
const frozenSchema = (): unknown => JSON.parse(readFileSync(schemaPath, "utf8"));
const frozenRegistry = (): unknown => JSON.parse(readFileSync(registryPath, "utf8"));

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

const asRecord = (value: unknown): Record<string, unknown> => {
  assert.equal(isRecord(value), true, FAILURE);
  if (!isRecord(value)) throw new Error(FAILURE);
  return value;
};

const mapped = (normalizer: Normalizer, input: unknown, expectedType: string): Record<string, unknown> => {
  const result = asRecord(normalizer(input));
  assert.equal(result.ok, true, FAILURE);
  if (result.ok !== true) throw new Error(FAILURE);
  const event = asRecord(result.event);
  assert.equal(event.event_type, expectedType, FAILURE);
  assert.equal(event.event_group, EVENT_GROUP_OF[expectedType], FAILURE);
  for (const field of [
    "event_id", "run_id", "task_id", "timestamp", "actor", "event_type", "event_group",
    "parent_id", "correlation_id", "identity", "evidence_digest", "redaction_state", "payload"
  ]) {
    assert.equal(Object.hasOwn(event, field), true, FAILURE);
  }
  assert.equal(event.run_id, RUN_ID, FAILURE);
  assert.equal(event.task_id, TASK_ID, FAILURE);
  assert.equal(event.correlation_id, CORRELATION_ID, FAILURE);
  assert.equal(event.identity, IDENTITY, FAILURE);
  assert.equal(typeof event.payload === "string" || event.payload === null, true, FAILURE);
  assert.equal(typeof event.payload !== "string" || event.payload.length <= BOUND, true, FAILURE);
  return event;
};

const refused = (normalizer: Normalizer, input: unknown): Record<string, unknown> => {
  const result = asRecord(normalizer(input));
  assert.equal(result.ok, false, FAILURE);
  assert.equal(typeof result.reason, "string", FAILURE);
  return result;
};

const serialized = (value: unknown): string => String(JSON.stringify(value));

describe("normalize", () => {
  test("event-parity", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const runCodexControlled = await requireWrapper();
  const parseTraceEvent = await requireTrace();

  const fixtures: Array<{ source: string; native: Record<string, unknown>; eventType: string; actor: string }> = [
    { source: "wrapper", native: { type: "assessment.started" }, eventType: "assessment.started", actor: "wrapper" },
    { source: "wrapper", native: { type: "task.started" }, eventType: "task.started", actor: "wrapper" },
    { source: "app-server-stdio-json-rpc", native: { type: "user.instruction", payload: "implement the task" }, eventType: "user.instruction", actor: "agent" },
    { source: "app-server-stdio-json-rpc", native: { type: "user.clarification", payload: "which path is owned?" }, eventType: "user.clarification", actor: "agent" },
    { source: "app-server-stdio-json-rpc", native: { type: "tool.call", payload: "read src/app.ts" }, eventType: "tool.call", actor: "agent" },
    { source: "app-server-stdio-json-rpc", native: { type: "tool.result", payload: "read complete" }, eventType: "tool.result", actor: "agent" },
    { source: "app-server-stdio-json-rpc", native: { type: "tool.error", error: "permission denied" }, eventType: "tool.error", actor: "agent" },
    { source: "wrapper", native: { type: "evidence.created", digest: DIGEST }, eventType: "evidence.created", actor: "agent" },
    { source: "wrapper", native: { type: "evidence.invalidated", digest: DIGEST }, eventType: "evidence.invalidated", actor: "agent" },
    { source: "wrapper", native: { type: "completion.claimed", payload: "tests passed" }, eventType: "completion.claimed", actor: "agent" },
    { source: "wrapper", native: { type: "approval.requested", payload: "write src/app.ts" }, eventType: "approval.requested", actor: "agent" },
    { source: "wrapper", native: { type: "approval.granted", payload: "approved" }, eventType: "approval.granted", actor: "agent" },
    { source: "wrapper", native: { type: "approval.denied", payload: "denied" }, eventType: "approval.denied", actor: "agent" },
    { source: "wrapper", native: { type: "intervention.occurred", payload: "operator stopped run" }, eventType: "intervention.occurred", actor: "human/takeover" },
    { source: "workspace", native: { type: "workspace.external_mutation", path: "src/external.ts", provenance: "runner-workspace-correlation" }, eventType: "workspace.external_mutation", actor: "external_mutation" },
    { source: "wrapper", native: { type: "human.manual_edit_declared", path: "src/manual.ts", provenance: "wrapper-workspace-correlation" }, eventType: "human.manual_edit_declared", actor: "human/takeover" },
    { source: "wrapper", native: { type: "actor.attribution_changed", from_actor: "agent", to_actor: "human/takeover", provenance: "wrapper-workspace-correlation" }, eventType: "actor.attribution_changed", actor: "human/takeover" },
    { source: "wrapper", native: { type: "actor.attribution_unknown", confidence: 0.69, provenance: "wrapper-workspace-correlation" }, eventType: "actor.attribution_unknown", actor: "actor.attribution_unknown" },
    { source: "wrapper", native: { type: "task.ended" }, eventType: "task.ended", actor: "wrapper" },
    { source: "wrapper", native: { type: "assessment.ended" }, eventType: "assessment.ended", actor: "wrapper" }
  ];

  for (const fixture of fixtures) {
    const event = mapped(normalizeCodexEvent, envelope(fixture.source, fixture.native), fixture.eventType);
    assert.equal(event.actor, fixture.actor, FAILURE);
  }

  const target = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", {
      type: "tool.call",
      target_path: "src/generated.ts",
      payload: "write source"
    }),
    "tool.call"
  );
  const parsed = parseTraceEvent(target, frozenSchema(), frozenRegistry());
  assert.equal(parsed.ok, true, FAILURE);
  assert.deepEqual(parsed.errors, [], FAILURE);

  const controlled = asRecord(runCodexControlled({
    run_id: RUN_ID,
    task_id: TASK_ID,
    correlation_id: CORRELATION_ID,
    identity: IDENTITY,
    timestamp: STAMP,
    capability_snapshot: { runtime: "codex", source_class: "PRIMARY" }
  }));
  assert.equal(controlled.ok, true, FAILURE);
  assert.equal(Array.isArray(controlled.events), true, FAILURE);
  if (!Array.isArray(controlled.events)) throw new Error(FAILURE);
  assert.equal(controlled.events.length, 3, FAILURE);
  assert.equal(
    controlled.events.every((event) => isRecord(event) && typeof event.event_type === "string"),
    true,
    FAILURE
  );
  });

  test("secret-canary", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const redactCodexPayload = await requireRedact();
  const boundaryFragment = "AOS_SECRET_";
  const apiKey = "sk-live_codex_redaction_test";
  const hiddenReasoning = "chain-of-thought: private implementation detail";
  const redactionPrefix = `${SECRET_CANARY} key=${apiKey}\n${hiddenReasoning}\n`;
  const sourcePayload = `${redactionPrefix}${"x".repeat(BOUND - redactionPrefix.length - boundaryFragment.length)}${SECRET_CANARY}${"y".repeat(128)}`;

  const redacted = asRecord(redactCodexPayload({ payload: sourcePayload }));
  assert.equal(redacted.redaction_state, "redacted", FAILURE);
  assert.equal(typeof redacted.payload, "string", FAILURE);
  if (typeof redacted.payload !== "string") throw new Error(FAILURE);
  assert.equal(redacted.payload.length <= BOUND, true, FAILURE);
  assert.equal(serialized(redacted).includes(SECRET_CANARY), false, FAILURE);
  assert.equal(serialized(redacted).includes(boundaryFragment), false, FAILURE);

  const normalized = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", { type: "user.instruction", payload: sourcePayload }),
    "user.instruction"
  );
  assert.equal(normalized.redaction_state, "redacted", FAILURE);
  assert.equal(typeof normalized.payload, "string", FAILURE);
  if (typeof normalized.payload !== "string") throw new Error(FAILURE);
  assert.equal(normalized.payload.includes(SECRET_CANARY), false, FAILURE);
  assert.equal(normalized.payload.includes(apiKey), false, FAILURE);
  assert.equal(normalized.payload.includes(hiddenReasoning), false, FAILURE);
  assert.equal(serialized(normalized).includes(boundaryFragment), false, FAILURE);

  const benignPayload = "ordinary payload";
  const accepted = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", { type: "user.instruction", payload: benignPayload }),
    "user.instruction"
  );
  assert.equal(accepted.redaction_state, "none", FAILURE);
  assert.equal(accepted.payload, benignPayload, FAILURE);
  });

  test("target-path-traversal", async () => {
  const normalizeCodexEvent = await requireNormalize();
  for (const targetPath of ["../outside.ts", "/outside.ts", "a\\b", "C:/x", "src/./index.ts"]) {
    const rejected = refused(
      normalizeCodexEvent,
      envelope("app-server-stdio-json-rpc", {
        type: "tool.call",
        target_path: targetPath,
        payload: "write source"
      })
    );
    assert.equal(Object.hasOwn(rejected, "event"), false, FAILURE);
  }

  const accepted = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", {
      type: "tool.call",
      target_path: "src/index.ts",
      payload: "write source"
    }),
    "tool.call"
  );
  assert.equal(accepted.target_path, "src/index.ts", FAILURE);
  });

  test("source-allowlist", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const native = { type: "user.instruction", payload: "source boundary" };
  const unpermitted = envelope("unpermitted-source", native);
  const permitted = { ...unpermitted, source: "app-server-stdio-json-rpc" };

  const rejected = refused(normalizeCodexEvent, unpermitted);
  assert.equal(Object.hasOwn(rejected, "event"), false, FAILURE);

  const accepted = mapped(normalizeCodexEvent, permitted, "user.instruction");
  assert.equal(accepted.payload, "source boundary", FAILURE);
  });

  test("oversized", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const parseTraceEvent = await requireTrace();
  const event = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", {
      type: "tool.call",
      target_path: "src/generated.ts",
      payload: "z".repeat(BOUND + 1)
    }),
    "tool.call"
  );
  assert.equal(event.redaction_state, "redacted", FAILURE);
  assert.equal(typeof event.payload, "string", FAILURE);
  if (typeof event.payload !== "string") throw new Error(FAILURE);
  assert.equal(event.payload.length, BOUND, FAILURE);
  assert.equal(event.target_path, "src/generated.ts", FAILURE);
  const parsed = parseTraceEvent(event, frozenSchema(), frozenRegistry());
  assert.equal(parsed.ok, true, FAILURE);
  assert.deepEqual(parsed.errors, [], FAILURE);
  });

  test("unknown-native", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const unknown = refused(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", { type: "codex/private/inferred-event", payload: "forged" })
  );
  assert.equal(Object.hasOwn(unknown, "event"), false, FAILURE);

  const accepted = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", { type: "user.instruction", payload: "supported event" }),
    "user.instruction"
  );
  assert.equal(accepted.event_type, "user.instruction", FAILURE);
  });

  test("missing-parent", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const parent = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", { type: "user.instruction", payload: "parent" }),
    "user.instruction"
  );
  assert.equal(typeof parent.event_id, "string", FAILURE);
  if (typeof parent.event_id !== "string") throw new Error(FAILURE);

  const child = mapped(
    normalizeCodexEvent,
    envelope(
      "app-server-stdio-json-rpc",
      { type: "tool.call", payload: "read src/app.ts" },
      { parent_id: parent.event_id, known_event_ids: [parent.event_id] }
    ),
    "tool.call"
  );
  assert.equal(child.parent_id, parent.event_id, FAILURE);

  const orphan = refused(
    normalizeCodexEvent,
    envelope(
      "app-server-stdio-json-rpc",
      { type: "tool.call", payload: "read src/orphan.ts" },
      { parent_id: "no-such-event", known_event_ids: [parent.event_id] }
    )
  );
  assert.equal(Object.hasOwn(orphan, "event"), false, FAILURE);
  });

  test("tool-error", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const failed = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", {
      type: "tool.result",
      error: "exit 1: permission denied",
      payload: "command failed"
    }),
    "tool.error"
  );
  assert.equal(typeof failed.payload === "string" && failed.payload.includes("permission denied"), true, FAILURE);

  const succeeded = mapped(
    normalizeCodexEvent,
    envelope("app-server-stdio-json-rpc", { type: "tool.result", payload: "exit 0: complete" }),
    "tool.result"
  );
  assert.equal(typeof succeeded.payload === "string" && succeeded.payload.includes("exit 0: complete"), true, FAILURE);
  });

  test("actor-attribution-events", async () => {
  const normalizeCodexEvent = await requireNormalize();
  const parseTraceEvent = await requireTrace();
  const registry = asRecord(frozenRegistry());
  const attributionTypes = registry.attribution_event_types;
  assert.equal(Array.isArray(attributionTypes), true, FAILURE);
  if (!Array.isArray(attributionTypes)) throw new Error(FAILURE);
  assert.deepEqual(attributionTypes, [
    "workspace.external_mutation",
    "human.manual_edit_declared",
    "actor.attribution_changed",
    "actor.attribution_unknown"
  ], FAILURE);

  const registryGroups = new Map<string, string>();
  assert.equal(Array.isArray(registry.events), true, FAILURE);
  if (!Array.isArray(registry.events)) throw new Error(FAILURE);
  for (const entry of registry.events) {
    if (!isRecord(entry) || typeof entry.event_type !== "string" || typeof entry.event_group !== "string") {
      throw new Error(FAILURE);
    }
    registryGroups.set(entry.event_type, entry.event_group);
  }

  const fixtures: Array<{ source: string; native: Record<string, unknown>; eventType: string; actor: string }> = [
    {
      source: "workspace",
      native: {
        type: "workspace.external_mutation",
        path: "src/external.ts",
        provenance: "runner-workspace-correlation"
      },
      eventType: "workspace.external_mutation",
      actor: "external_mutation"
    },
    {
      source: "wrapper",
      native: {
        type: "human.manual_edit_declared",
        path: "src/manual.ts",
        provenance: "wrapper-workspace-correlation"
      },
      eventType: "human.manual_edit_declared",
      actor: "human/takeover"
    },
    {
      source: "wrapper",
      native: {
        type: "actor.attribution_changed",
        from_actor: "agent",
        to_actor: "human/takeover",
        provenance: "wrapper-workspace-correlation"
      },
      eventType: "actor.attribution_changed",
      actor: "human/takeover"
    },
    {
      source: "wrapper",
      native: {
        type: "actor.attribution_unknown",
        confidence: 0.69,
        provenance: "wrapper-workspace-correlation"
      },
      eventType: "actor.attribution_unknown",
      actor: "actor.attribution_unknown"
    }
  ];

  for (const fixture of fixtures) {
    const event = mapped(normalizeCodexEvent, envelope(fixture.source, fixture.native), fixture.eventType);
    assert.equal(event.actor, fixture.actor, FAILURE);
    assert.equal(event.event_group, registryGroups.get(fixture.eventType), FAILURE);
    const parsed = parseTraceEvent(event, frozenSchema(), frozenRegistry());
    assert.equal(parsed.ok, true, FAILURE);
    assert.deepEqual(parsed.errors, [], FAILURE);
  }

  const attributionChange = {
    type: "actor.attribution_changed",
    from_actor: "agent",
    to_actor: "human/takeover",
    provenance: "wrapper-workspace-correlation"
  };
  const supportedSource = "wrapper";
  const missingToActor = { ...attributionChange };
  delete (missingToActor as { to_actor?: string }).to_actor;
  const refusedMissingToActor = refused(
    normalizeCodexEvent,
    envelope(supportedSource, missingToActor)
  );
  assert.equal(Object.hasOwn(refusedMissingToActor, "event"), false, FAILURE);

  const emptyToActor = { ...attributionChange, to_actor: "" };
  const refusedEmptyToActor = refused(
    normalizeCodexEvent,
    envelope(supportedSource, emptyToActor)
  );
  assert.equal(Object.hasOwn(refusedEmptyToActor, "event"), false, FAILURE);

  const nonStringToActor = { ...attributionChange, to_actor: 1 };
  const refusedNonStringToActor = refused(
    normalizeCodexEvent,
    envelope(supportedSource, nonStringToActor)
  );
  assert.equal(Object.hasOwn(refusedNonStringToActor, "event"), false, FAILURE);

  const missingFromActor = { ...attributionChange };
  delete (missingFromActor as { from_actor?: string }).from_actor;
  const refusedMissingFromActor = refused(
    normalizeCodexEvent,
    envelope(supportedSource, missingFromActor)
  );
  assert.equal(Object.hasOwn(refusedMissingFromActor, "event"), false, FAILURE);

  const emptyFromActor = { ...attributionChange, from_actor: "" };
  const refusedEmptyFromActor = refused(
    normalizeCodexEvent,
    envelope(supportedSource, emptyFromActor)
  );
  assert.equal(Object.hasOwn(refusedEmptyFromActor, "event"), false, FAILURE);

  const nonStringFromActor = { ...attributionChange, from_actor: 1 };
  const refusedNonStringFromActor = refused(
    normalizeCodexEvent,
    envelope(supportedSource, nonStringFromActor)
  );
  assert.equal(Object.hasOwn(refusedNonStringFromActor, "event"), false, FAILURE);

  const missingProvenance = { ...attributionChange };
  delete (missingProvenance as { provenance?: string }).provenance;
  const refusedMissingProvenance = refused(
    normalizeCodexEvent,
    envelope(supportedSource, missingProvenance)
  );
  assert.equal(Object.hasOwn(refusedMissingProvenance, "event"), false, FAILURE);

  const emptyProvenance = { ...attributionChange, provenance: "" };
  const refusedEmptyProvenance = refused(
    normalizeCodexEvent,
    envelope(supportedSource, emptyProvenance)
  );
  assert.equal(Object.hasOwn(refusedEmptyProvenance, "event"), false, FAILURE);

  const nonStringProvenance = { ...attributionChange, provenance: 1 };
  const refusedNonStringProvenance = refused(
    normalizeCodexEvent,
    envelope(supportedSource, nonStringProvenance)
  );
  assert.equal(Object.hasOwn(refusedNonStringProvenance, "event"), false, FAILURE);

  const refusedUnknownActor = refused(
    normalizeCodexEvent,
    envelope(supportedSource, { ...attributionChange, to_actor: "unregistered-actor" })
  );
  assert.equal(Object.hasOwn(refusedUnknownActor, "event"), false, FAILURE);

  const supported = mapped(
    normalizeCodexEvent,
    envelope(supportedSource, attributionChange),
    "actor.attribution_changed"
  );
  assert.equal(supported.actor, "human/takeover", FAILURE);
  const parsedSupported = parseTraceEvent(supported, frozenSchema(), frozenRegistry());
  assert.equal(parsedSupported.ok, true, FAILURE);
  assert.deepEqual(parsedSupported.errors, [], FAILURE);

  const confidenceAtLowerBound = mapped(
    normalizeCodexEvent,
    envelope(supportedSource, {
      type: "actor.attribution_unknown",
      confidence: 0,
      provenance: "wrapper-workspace-correlation"
    }),
    "actor.attribution_unknown"
  );
  assert.equal(confidenceAtLowerBound.actor, "actor.attribution_unknown", FAILURE);
  const parsedConfidenceAtLowerBound = parseTraceEvent(
    confidenceAtLowerBound,
    frozenSchema(),
    frozenRegistry()
  );
  assert.equal(parsedConfidenceAtLowerBound.ok, true, FAILURE);
  assert.deepEqual(parsedConfidenceAtLowerBound.errors, [], FAILURE);

  const confidenceBelowThreshold = mapped(
    normalizeCodexEvent,
    envelope(supportedSource, {
      type: "actor.attribution_unknown",
      confidence: 0.699999,
      provenance: "wrapper-workspace-correlation"
    }),
    "actor.attribution_unknown"
  );
  assert.equal(confidenceBelowThreshold.actor, "actor.attribution_unknown", FAILURE);
  const parsedConfidenceBelowThreshold = parseTraceEvent(
    confidenceBelowThreshold,
    frozenSchema(),
    frozenRegistry()
  );
  assert.equal(parsedConfidenceBelowThreshold.ok, true, FAILURE);
  assert.deepEqual(parsedConfidenceBelowThreshold.errors, [], FAILURE);

  const refusedAtConfidenceThreshold = refused(
    normalizeCodexEvent,
    envelope(supportedSource, {
      type: "actor.attribution_unknown",
      confidence: 0.7,
      provenance: "wrapper-workspace-correlation"
    })
  );
  assert.equal(Object.hasOwn(refusedAtConfidenceThreshold, "event"), false, FAILURE);

  const refusedBelowConfidenceRange = refused(
    normalizeCodexEvent,
    envelope(supportedSource, {
      type: "actor.attribution_unknown",
      confidence: -0.000001,
      provenance: "wrapper-workspace-correlation"
    })
  );
  assert.equal(Object.hasOwn(refusedBelowConfidenceRange, "event"), false, FAILURE);
  });
});
