import { test } from "node:test";
import assert from "node:assert/strict";

// The ticket's pinned pre-GREEN reason, verbatim from E9-001 `## RED contract`.
const ABSENT = "Claude capability rows and controlled lifecycle are absent.";

const DIGEST_FIELDS = [
  "runtime_version",
  "protocol_or_schema_version",
  "adapter_version",
  "source_class",
  "supported_event_groups",
  "known_missing_events"
] as const;

const EVENT_GROUPS = [
  "run_lifecycle",
  "runtime_identity",
  "user_instruction",
  "tool_call",
  "workspace_diff",
  "evidence_claim",
  "approval_safety",
  "context_selection",
  "retrieval_memory",
  "delegation_handoff",
  "plan_state",
  "token_cost",
  "human_active_time",
  "actor_attribution"
] as const;

const REQUIRED_GROUPS = [
  "run_lifecycle",
  "runtime_identity",
  "user_instruction",
  "tool_call",
  "evidence_claim",
  "approval_safety",
  "actor_attribution"
] as const;

const PRIMARY_GROUPS = [
  "runtime_identity",
  "user_instruction",
  "tool_call",
  "approval_safety",
  "retrieval_memory",
  "token_cost",
  "actor_attribution"
] as const;

const FORBIDDEN_SOURCES = ["internal transcript", "internal cache", "internal log"] as const;

const FROZEN_LOCATORS: Record<(typeof EVENT_GROUPS)[number], string> = {
  run_lifecycle: "controlled wrapper process supervisor record for task.started and task.ended",
  runtime_identity: "official TypeScript SDK runtime query response and the resolved settings digest",
  user_instruction: "official TypeScript SDK user SDKMessage turns carried over stream-json",
  tool_call: "official TypeScript SDK tool use and tool result SDKMessage entries carried over stream-json",
  workspace_diff: "runner filesystem snapshot pair taken by the isolated runner",
  evidence_claim: "controlled wrapper evidence ledger joined to the scorer evidence and completion claim events",
  approval_safety: "official permission/tool surface hook decisions joined to the controlled wrapper approval record",
  context_selection: "official hook record and controlled wrapper context ledger",
  retrieval_memory: "intercepted tool and MCP call events on the official permission/tool surface",
  delegation_handoff: "controlled wrapper subagent hook record for spawn, return, handoff and join",
  plan_state: "runner state artifacts and the runner stall watchdog timeline",
  token_cost: "provider and runtime usage metadata on the official TypeScript SDK result message",
  human_active_time: "controlled wrapper explicit intervention event and takeover timer",
  actor_attribution: "official TypeScript SDK message actor correlated with runner workspace authorship"
};

const FROZEN_SOURCE_CLASS: Record<(typeof EVENT_GROUPS)[number], string> = {
  run_lifecycle: "SECONDARY",
  runtime_identity: "PRIMARY",
  user_instruction: "PRIMARY",
  tool_call: "PRIMARY",
  workspace_diff: "RUNNER_DERIVED",
  evidence_claim: "SECONDARY",
  approval_safety: "PRIMARY",
  context_selection: "SECONDARY",
  retrieval_memory: "PRIMARY",
  delegation_handoff: "SECONDARY",
  plan_state: "RUNNER_DERIVED",
  token_cost: "PRIMARY",
  human_active_time: "SECONDARY",
  actor_attribution: "PRIMARY"
};

const ADAPTER_VERSION = "aos-adapter-claude-code-0.0.0";
const PROTOCOL_VERSION = "sdk-query-stream-json";
const SECRET = "sk-ant-canary-9f3c2a1b";
const HIDDEN = "chain-of-thought: the hidden plan is to leak";
const RUNTIME = "claude-code";
const MODEL = "claude-opus-4-20250514";
const HARNESS = "claude-code-cli";
const RUNTIME_VERSION = "2.0.0";

type Surface = Record<string, unknown>;

const officialIdentityMessage = () => ({
  type: "system",
  subtype: "init",
  runtime: RUNTIME,
  model: MODEL,
  harness: HARNESS,
  version: RUNTIME_VERSION
});

const completeSurface = (): Surface => ({
  sdkQuery: {
    messages: [
      officialIdentityMessage(),
      { type: "user", message: { role: "user", content: "do the task" } },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name: "Read", id: "t1" }] }
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] }
      },
      {
        type: "result",
        model: MODEL,
        usage: { input_tokens: 10, output_tokens: 4 }
      }
    ]
  },
  streamJson: [
    { type: "stream-json", subtype: "user", message: { role: "user", content: "do the task" } }
  ],
  permissionTool: {
    decisions: [{ tool: "Read", decision: "allow" }]
  },
  wrapper: {
    artifacts: { lifecycle: true, evidence: true, context: true, delegation: true, intervention: true }
  },
  workspace: {
    artifacts: { pre: "a", post: "b", plan: "p" }
  }
});

const limitedSurface = (): Surface => ({
  sdkQuery: {
    messages: [{ type: "system", subtype: "init", model: MODEL, version: RUNTIME_VERSION }]
  },
  streamJson: [{ type: "stream-json", subtype: "init", model: MODEL }]
});

const unknownSurface = (): Surface => ({});

const internalsOnlySurface = (): Surface => ({
  internals: {
    transcript: {
      runtime: RUNTIME,
      model: MODEL,
      harness: HARNESS,
      events: EVENT_GROUPS.slice()
    },
    cache: { identity: { runtime: RUNTIME, model: MODEL, harness: HARNESS } },
    log: { capability: "complete" }
  }
});

const wrapperOnlySurface = (): Surface => ({
  wrapper: {
    artifacts: { lifecycle: true, evidence: true, context: true, delegation: true, intervention: true }
  }
});

const secretSurface = (): Surface => ({
  ...completeSurface(),
  config: {
    ANTHROPIC_API_KEY: SECRET,
    hidden_reasoning: HIDDEN
  }
});

const loadIdentity = async () => {
  try {
    return await import("../src/adapters/claude-code/experimental/identity.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const loadCapabilities = async () => {
  try {
    return await import("../src/adapters/claude-code/experimental/capabilities.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const loadWrapper = async () => {
  try {
    return await import("../src/adapters/claude-code/experimental/wrapper.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const requireIdentity = async () => {
  const mod = await loadIdentity();
  assert.equal(typeof mod.discoverClaudeIdentity, "function", ABSENT);
  return mod.discoverClaudeIdentity as (surface: Surface) => Record<string, unknown>;
};

const requireCapabilities = async () => {
  const mod = await loadCapabilities();
  assert.equal(typeof mod.discoverClaudeCapabilities, "function", ABSENT);
  return mod.discoverClaudeCapabilities as (surface: Surface) => Record<string, unknown>;
};

const requireWrapper = async () => {
  const mod = await loadWrapper();
  assert.equal(typeof mod.runClaudeControlled, "function", ABSENT);
  return mod.runClaudeControlled as (input: Record<string, unknown>) => Record<string, unknown>;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true, label);
  return value as Record<string, unknown>;
};

const asStringArray = (value: unknown, label: string): string[] => {
  assert.ok(Array.isArray(value), label);
  assert.ok(value.every((entry) => typeof entry === "string"), label);
  return value as string[];
};

const rowOf = (discovery: Record<string, unknown>, group: string): Record<string, unknown> => {
  const rows = discovery.rows;
  assert.ok(Array.isArray(rows), `capability rows missing for ${group}`);
  const row = rows.find((entry) => entry && typeof entry === "object" && (entry as { event_group?: unknown }).event_group === group);
  assert.ok(row && typeof row === "object", `missing capability row ${group}`);
  return row as Record<string, unknown>;
};

const digestOf = (discovery: Record<string, unknown>): Record<string, unknown> =>
  asRecord(discovery.digest, "capability digest must be an object");

const assertDigestShape = (digest: Record<string, unknown>) => {
  assert.deepEqual(Object.keys(digest), DIGEST_FIELDS.slice(), "six-field capability digest");
  assert.equal(typeof digest.runtime_version, "string");
  assert.equal(typeof digest.protocol_or_schema_version, "string");
  assert.equal(typeof digest.adapter_version, "string");
  assert.equal((digest.runtime_version as string).length > 0, true);
  assert.equal(digest.protocol_or_schema_version, PROTOCOL_VERSION);
  assert.equal(digest.adapter_version, ADAPTER_VERSION);
  asStringArray(digest.source_class, "digest.source_class");
  asStringArray(digest.supported_event_groups, "digest.supported_event_groups");
  asStringArray(digest.known_missing_events, "digest.known_missing_events");
};

const assertMatrix = (discovery: Record<string, unknown>) => {
  assert.equal(asStringArray(discovery.rows ? (discovery.rows as unknown[]).map((row) => {
    const record = asRecord(row, "capability row");
    return String(record.event_group);
  }) : [], "capability row event_group").join(","), EVENT_GROUPS.join(","));
  for (const group of EVENT_GROUPS) {
    const row = rowOf(discovery, group);
    assert.equal(row.event_group, group);
    assert.equal(row.source_class, FROZEN_SOURCE_CLASS[group], group);
    assert.equal(row.evidence_locator, FROZEN_LOCATORS[group], group);
    assert.equal(typeof row.status, "string", group);
    assert.equal(typeof row.missing_effect, "string", group);
    asStringArray(row.missing_effects, `${group} missing_effects`);
    const locator = String(row.evidence_locator).toLowerCase();
    for (const forbidden of FORBIDDEN_SOURCES) {
      assert.equal(locator.includes(forbidden), false, `${group} locator names forbidden source ${forbidden}`);
    }
  }
};

const serialize = (value: unknown): string => JSON.stringify(value);

const limitsOf = (value: Record<string, unknown>): string[] =>
  asStringArray(value.limits, "explicit limits");

test("complete", async () => {
  const discoverClaudeIdentity = await requireIdentity();
  const discoverClaudeCapabilities = await requireCapabilities();
  const surface = completeSurface();
  const identity = asRecord(discoverClaudeIdentity(surface), "identity");
  assert.equal(identity.status, "complete");
  assert.equal(identity.runtime, RUNTIME);
  assert.equal(identity.model, MODEL);
  assert.equal(identity.harness, HARNESS);
  assert.equal(identity.identity_id, `${RUNTIME}|${MODEL}|${HARNESS}`);
  assert.equal(identity.source_class, "PRIMARY");
  assert.ok(limitsOf(identity).length > 0, "complete identity records explicit limits");

  const discovery = asRecord(discoverClaudeCapabilities(surface), "capabilities");
  const digest = digestOf(discovery);
  assertDigestShape(digest);
  assert.equal(digest.runtime_version, RUNTIME_VERSION);
  assert.deepEqual(digest.supported_event_groups, EVENT_GROUPS.slice());
  assert.deepEqual(digest.known_missing_events, []);
  assertMatrix(discovery);
  for (const group of EVENT_GROUPS) {
    const row = rowOf(discovery, group);
    assert.notEqual(row.status, "UNAVAILABLE", `${group} is missing on a complete official surface`);
  }
});

test("limited", async () => {
  const discoverClaudeIdentity = await requireIdentity();
  const identity = asRecord(discoverClaudeIdentity(limitedSurface()), "identity");
  assert.equal(identity.status, "limited");
  assert.equal(identity.model, MODEL);
  assert.equal(identity.runtime, null);
  assert.equal(identity.harness, null);
  assert.equal(identity.identity_id, null);
  assert.equal(identity.source_class, "PRIMARY");
  const limits = limitsOf(identity);
  assert.ok(limits.some((entry) => /runtime/.test(entry)), "limited identity must name the missing runtime");
  assert.ok(limits.some((entry) => /harness/.test(entry)), "limited identity must name the missing harness");
});

test("unknown", async () => {
  const discoverClaudeIdentity = await requireIdentity();
  const identity = asRecord(discoverClaudeIdentity(unknownSurface()), "identity");
  assert.equal(identity.status, "unknown");
  assert.equal(identity.runtime, null);
  assert.equal(identity.model, null);
  assert.equal(identity.harness, null);
  assert.equal(identity.identity_id, null);
  const limits = limitsOf(identity);
  assert.ok(limits.some((entry) => /official TypeScript SDK|stream-json|permission\/tool/.test(entry)),
    "unknown identity must record that official sources were empty");
});

test("missing-required", async () => {
  const discoverClaudeCapabilities = await requireCapabilities();
  const discovery = asRecord(discoverClaudeCapabilities(unknownSurface()), "capabilities");
  const digest = digestOf(discovery);
  assertDigestShape(digest);
  assertMatrix(discovery);
  for (const group of REQUIRED_GROUPS) {
    const row = rowOf(discovery, group);
    assert.equal(row.status, "UNAVAILABLE", `${group} must not silently appear required when its source is missing`);
    assert.ok(
      (digest.known_missing_events as string[]).includes(group),
      `${group} must appear in known_missing_events`
    );
    assert.equal(
      (digest.supported_event_groups as string[]).includes(group),
      false,
      `${group} must not be listed as supported when missing`
    );
    assert.ok(
      (row.missing_effects as string[]).length > 0,
      `${group} must carry a missing effect`
    );
  }
  assert.ok(
    (digest.known_missing_events as string[]).includes("runtime_identity"),
    "missing runtime identity must block rather than invent an identity"
  );
});

test("lifecycle", async () => {
  const runClaudeControlled = await requireWrapper();
  const result = asRecord(runClaudeControlled({
    run_id: "run-e9-001",
    correlation_id: "corr-e9-001",
    surface: completeSurface()
  }), "controlled wrapper");
  assert.equal(result.run_id, "run-e9-001");
  assert.equal(result.correlation_id, "corr-e9-001");
  assert.ok(limitsOf(result).length > 0, "wrapper records explicit limits");
  const snapshot = asRecord(result.capability_snapshot, "capability snapshot stored at start");
  assertDigestShape(digestOf({ digest: snapshot }));
  const events = result.events;
  assert.ok(Array.isArray(events), "wrapper events");
  const records = (events as unknown[]).map((event, index) => asRecord(event, `wrapper event ${index}`));
  const types = records.map((event) => event.event_type);
  assert.deepEqual(types, ["assessment.started", "adapter.capability_declared", "assessment.ended"]);
  for (const event of records) {
    assert.equal(event.run_id, "run-e9-001");
    assert.equal(event.correlation_id, "corr-e9-001");
    assert.equal(event.actor, "wrapper");
    assert.match(String(event.timestamp), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
  const started = Date.parse(String(records[0].timestamp));
  const ended = Date.parse(String(records[2].timestamp));
  assert.equal(Number.isNaN(started), false);
  assert.equal(Number.isNaN(ended), false);
  assert.ok(ended > started, "wrapper end must follow start");
  const declared = asRecord(records[1].payload, "adapter.capability_declared payload");
  assertDigestShape(digestOf({ digest: declared }));
});

test("config-redaction", async () => {
  const discoverClaudeIdentity = await requireIdentity();
  const discoverClaudeCapabilities = await requireCapabilities();
  const runClaudeControlled = await requireWrapper();
  const surface = secretSurface();
  const identity = asRecord(discoverClaudeIdentity(surface), "identity");
  const discovery = asRecord(discoverClaudeCapabilities(surface), "capabilities");
  const wrapped = asRecord(runClaudeControlled({
    run_id: "run-e9-001-redact",
    correlation_id: "corr-e9-001-redact",
    surface
  }), "wrapper");
  const dumped = `${serialize(identity)}\n${serialize(discovery)}\n${serialize(wrapped)}`;
  assert.equal(dumped.includes(SECRET), false, "raw secret must not be stored");
  assert.equal(dumped.includes(HIDDEN), false, "hidden reasoning must not be stored");
  for (const result of [identity, discovery, wrapped]) {
    const limits = limitsOf(result);
    assert.ok(limits.some((entry) => /raw_secret|raw secret/.test(entry)), "redaction limit names raw secrets");
    assert.ok(limits.some((entry) => /hidden_reasoning|hidden reasoning/.test(entry)), "redaction limit names hidden reasoning");
  }
});

test("official-source-boundary", async () => {
  const discoverClaudeIdentity = await requireIdentity();
  const discoverClaudeCapabilities = await requireCapabilities();
  const official = asRecord(discoverClaudeCapabilities(completeSurface()), "official capabilities");
  assertMatrix(official);
  for (const group of PRIMARY_GROUPS) {
    const row = rowOf(official, group);
    assert.equal(row.source_class, "PRIMARY", group);
    const locator = String(row.evidence_locator);
    assert.ok(
      /official TypeScript SDK|stream-json|official permission\/tool/.test(locator),
      `${group} PRIMARY locator must name an official source`
    );
    assert.equal(/bounded wrapper|workspace artifact/.test(locator), false,
      `${group} PRIMARY locator must not promote a secondary source`);
  }
  const identity = asRecord(discoverClaudeIdentity(completeSurface()), "identity");
  assert.equal(identity.source_class, "PRIMARY");

  const wrapperOnly = asRecord(discoverClaudeCapabilities(wrapperOnlySurface()), "wrapper-only capabilities");
  for (const group of PRIMARY_GROUPS) {
    const row = rowOf(wrapperOnly, group);
    assert.equal(row.status, "UNAVAILABLE", `${group} must not be completed from wrapper-only input`);
    assert.equal(row.source_class, "PRIMARY", group);
    assert.equal(row.evidence_locator, FROZEN_LOCATORS[group], group);
  }
  const runLifecycle = rowOf(wrapperOnly, "run_lifecycle");
  assert.notEqual(runLifecycle.status, "UNAVAILABLE", "run_lifecycle may use the bounded wrapper");
  assert.equal(runLifecycle.source_class, "SECONDARY");
});

test("forbidden-internal-source", async () => {
  const discoverClaudeIdentity = await requireIdentity();
  const discoverClaudeCapabilities = await requireCapabilities();
  const identity = asRecord(discoverClaudeIdentity(internalsOnlySurface()), "identity");
  assert.equal(identity.status, "unknown", "internal transcript/cache/log must not complete identity");
  assert.equal(identity.identity_id, null);
  const discovery = asRecord(discoverClaudeCapabilities(internalsOnlySurface()), "capabilities");
  const digest = digestOf(discovery);
  assertDigestShape(digest);
  assertMatrix(discovery);
  for (const group of REQUIRED_GROUPS) {
    const row = rowOf(discovery, group);
    assert.equal(row.status, "UNAVAILABLE", `${group} must not appear complete from a forbidden internal source`);
    assert.ok((digest.known_missing_events as string[]).includes(group), group);
  }
  const dumped = serialize(discovery).toLowerCase();
  for (const forbidden of FORBIDDEN_SOURCES) {
    assert.equal(dumped.includes(forbidden), false, `capability output names forbidden source ${forbidden}`);
  }
  assert.equal(serialize(identity).toLowerCase().includes("internal transcript"), false);
});
