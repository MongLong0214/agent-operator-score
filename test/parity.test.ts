import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FAILURE = "equivalent native inputs are not proven to yield equivalent normalized semantics.";
const DIGEST = "a".repeat(64);
const DIFFERENT_DIGEST = "b".repeat(64);
const RUN_ID = "run-e9-003";
const TASK_ID = "task-e9-003";
const CORRELATION_ID = "corr-e9-003";
const STAMP = "2026-08-22T09:00:00.000Z";
const CODEX_IDENTITY = "codex|gpt-5-codex|codex-cli";
const CLAUDE_IDENTITY = "claude-code|claude-opus|claude-code-cli";

type RecordValue = Record<string, unknown>;
type SharedField =
  | "run_id"
  | "task_id"
  | "timestamp"
  | "actor"
  | "event_type"
  | "correlation_id"
  | "evidence_digest"
  | "parent_id"
  | "redaction_state"
  | "payload"
  | "target_path";
type CodexNormalizer = (input: unknown) => unknown;
type ClaudeNormalizer = (input: unknown) => unknown;
type CapabilityDiscovery = (surface: unknown) => unknown;
type TraceParser = (event: unknown, schema: unknown, registry: unknown) => { ok: boolean; errors: string[] };
type Comparator = (left: unknown, right: unknown) => unknown;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): RecordValue => {
  if (!isRecord(value)) throw new Error(FAILURE);
  return value;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(FAILURE);
  }
  return value.slice();
};

const requireCodexNormalizer = async (): Promise<CodexNormalizer> => {
  const loaded = await import("../src/adapters/codex/normalize.ts");
  assert.equal(typeof loaded.normalizeCodexEvent, "function", FAILURE);
  if (typeof loaded.normalizeCodexEvent !== "function") throw new Error(FAILURE);
  return loaded.normalizeCodexEvent;
};

const requireClaudeNormalizer = async (): Promise<ClaudeNormalizer> => {
  const loaded = await import("../src/adapters/claude-code/experimental/normalize.ts");
  assert.equal(typeof loaded.normalizeClaudeEvent, "function", FAILURE);
  if (typeof loaded.normalizeClaudeEvent !== "function") throw new Error(FAILURE);
  return loaded.normalizeClaudeEvent;
};

const requireTraceParser = async (): Promise<TraceParser> => {
  const loaded = await import("../src/schema/trace.ts");
  assert.equal(typeof loaded.parseTraceEvent, "function", FAILURE);
  if (typeof loaded.parseTraceEvent !== "function") throw new Error(FAILURE);
  return loaded.parseTraceEvent;
};

const requireComparator = async (): Promise<Comparator> => {
  try {
    const loaded = await import("../src/_deferred/semantic-parity.ts");
    assert.equal(typeof loaded.compareSemanticTrace, "function", FAILURE);
    if (typeof loaded.compareSemanticTrace !== "function") throw new Error(FAILURE);
    return loaded.compareSemanticTrace;
  } catch {
    throw new Error(FAILURE);
  }
};

const requireCodexCapabilities = async (): Promise<CapabilityDiscovery> => {
  const loaded = await import("../src/adapters/codex/capabilities.ts");
  assert.equal(typeof loaded.discoverCodexCapabilities, "function", FAILURE);
  if (typeof loaded.discoverCodexCapabilities !== "function") throw new Error(FAILURE);
  return loaded.discoverCodexCapabilities;
};

const requireClaudeCapabilities = async (): Promise<CapabilityDiscovery> => {
  const loaded = await import("../src/adapters/claude-code/experimental/capabilities.ts");
  assert.equal(typeof loaded.discoverClaudeCapabilities, "function", FAILURE);
  if (typeof loaded.discoverClaudeCapabilities !== "function") throw new Error(FAILURE);
  return loaded.discoverClaudeCapabilities;
};

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../specs/aos-trace.schema.json");
const registryPath = resolve(here, "../specs/events.v0.json");
const frozenSchema = (): unknown => JSON.parse(readFileSync(schemaPath, "utf8"));
const frozenRegistry = (): unknown => JSON.parse(readFileSync(registryPath, "utf8"));

const codexEnvelope = (source: string, native: RecordValue): RecordValue => ({
  source,
  native,
  run_id: RUN_ID,
  task_id: TASK_ID,
  correlation_id: CORRELATION_ID,
  identity: CODEX_IDENTITY,
  timestamp: STAMP,
  parent_id: null
});

const claudeEnvelope = (source: string, native: RecordValue): RecordValue => ({
  source,
  native,
  run_id: RUN_ID,
  task_id: TASK_ID,
  correlation_id: CORRELATION_ID,
  identity: CLAUDE_IDENTITY,
  timestamp: STAMP,
  parent_id: null
});

const normalizedCodexEvent = (normalize: CodexNormalizer, input: unknown): RecordValue => {
  const result = asRecord(normalize(input));
  if (result.ok !== true || !isRecord(result.event)) throw new Error(FAILURE);
  return result.event;
};

const normalizedClaudeEvent = (normalize: ClaudeNormalizer, input: unknown): RecordValue => {
  const event = asRecord(normalize(input));
  if (event.event_id === null) throw new Error(FAILURE);
  return event;
};

const assertValid = (parseTraceEvent: TraceParser, event: RecordValue): void => {
  const parsed = parseTraceEvent(event, frozenSchema(), frozenRegistry());
  assert.equal(parsed.ok, true, FAILURE);
  assert.deepEqual(parsed.errors, [], FAILURE);
};

const trace = (event: RecordValue, identity: string, capability: RecordValue): RecordValue => ({
  events: [event],
  profile: { identity, capability }
});

const assertAccepted = (compare: Comparator, left: RecordValue, right: RecordValue): void => {
  const result = asRecord(compare(left, right));
  assert.equal(result.ok, true, FAILURE);
};

const assertRefused = (compare: Comparator, left: RecordValue, right: RecordValue): void => {
  const result = asRecord(compare(left, right));
  assert.equal(result.ok, false, FAILURE);
};

const assertSharedFieldPair = (
  parseTraceEvent: TraceParser,
  compare: Comparator,
  codex: RecordValue,
  claude: RecordValue,
  codexProfile: RecordValue,
  claudeProfile: RecordValue,
  field: SharedField,
  different: unknown
): void => {
  assertValid(parseTraceEvent, codex);
  assertValid(parseTraceEvent, claude);
  assertAccepted(
    compare,
    trace(codex, CODEX_IDENTITY, codexProfile),
    trace(claude, CLAUDE_IDENTITY, claudeProfile)
  );

  const mismatched = { ...claude, [field]: different };
  assertValid(parseTraceEvent, mismatched);
  assertRefused(
    compare,
    trace(codex, CODEX_IDENTITY, codexProfile),
    trace(mismatched, CLAUDE_IDENTITY, claudeProfile)
  );
};

const registryEventGroups = (): string[] => {
  const registry = asRecord(frozenRegistry());
  if (!Array.isArray(registry.events)) throw new Error(FAILURE);
  const groups = registry.events.map((entry) => asRecord(entry).event_group);
  const strings = asStringArray(groups);
  return [...new Set(strings)];
};

const codexCapability = (discover: CapabilityDiscovery): RecordValue => {
  const groups = registryEventGroups();
  const surface = {
    appServer: {
      transport: "app-server-stdio-json-rpc",
      schemaDigest: DIGEST,
      response: {
        protocolVersion: "parity-v0",
        runtimeVersion: "codex-parity",
        supportedEventGroups: groups
      }
    },
    installedGeneratedSchema: {
      digest: DIGEST,
      protocolVersion: "parity-v0",
      eventGroups: groups
    }
  };
  const result = asRecord(discover(surface));
  if (result.ok !== true || !isRecord(result.digest)) throw new Error(FAILURE);
  return result.digest;
};

const claudeCapability = (discover: CapabilityDiscovery): RecordValue => {
  const result = asRecord(discover({
    sdkQuery: {
      messages: [{
        type: "user",
        runtime: "claude-code",
        model: "claude-opus",
        harness: "claude-code-cli"
      }, {
        type: "assistant",
        content: [{ type: "tool_use", id: "parity-tool", name: "Bash", input: {} }]
      }]
    },
    permissionTool: {},
    wrapper: {}
  }));
  if (!isRecord(result.digest)) throw new Error(FAILURE);
  return result.digest;
};

const limitedClaudeCapability = (discover: CapabilityDiscovery): RecordValue => {
  const result = asRecord(discover({
    sdkQuery: {
      messages: [{
        type: "user",
        runtime: "claude-code",
        model: "claude-opus",
        harness: "claude-code-cli"
      }]
    },
    wrapper: {}
  }));
  if (!isRecord(result.digest)) throw new Error(FAILURE);
  return result.digest;
};

test("lifecycle", async () => {
  const compare = await requireComparator();
  const normalizeCodexEvent = await requireCodexNormalizer();
  const normalizeClaudeEvent = await requireClaudeNormalizer();
  const parseTraceEvent = await requireTraceParser();
  const discoverCodexCapabilities = await requireCodexCapabilities();
  const discoverClaudeCapabilities = await requireClaudeCapabilities();
  const codex = normalizedCodexEvent(
    normalizeCodexEvent,
    codexEnvelope("wrapper", { type: "task.started" })
  );
  const claude = normalizedClaudeEvent(
    normalizeClaudeEvent,
    claudeEnvelope("wrapper", { type: "task.started" })
  );
  const codexProfile = codexCapability(discoverCodexCapabilities);
  const claudeProfile = claudeCapability(discoverClaudeCapabilities);
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "run_id", "run-e9-003-other"
  );
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "task_id", "task-e9-003-other"
  );
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "timestamp", "2026-08-22T09:00:01.000Z"
  );
});

test("tool-error", async () => {
  const compare = await requireComparator();
  const normalizeCodexEvent = await requireCodexNormalizer();
  const normalizeClaudeEvent = await requireClaudeNormalizer();
  const parseTraceEvent = await requireTraceParser();
  const discoverCodexCapabilities = await requireCodexCapabilities();
  const discoverClaudeCapabilities = await requireClaudeCapabilities();
  const payload = { payload: { tool: "Bash" }, error: "permission denied" };
  const codex = normalizedCodexEvent(
    normalizeCodexEvent,
    codexEnvelope("app-server-stdio-json-rpc", { type: "tool.error", ...payload })
  );
  const claude = normalizedClaudeEvent(
    normalizeClaudeEvent,
    claudeEnvelope("sdkQuery", {
      type: "user",
      message: { content: [{ type: "tool_result", content: payload, is_error: true }] }
    })
  );
  const codexProfile = codexCapability(discoverCodexCapabilities);
  const claudeProfile = claudeCapability(discoverClaudeCapabilities);
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "event_type", "tool.result"
  );
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "payload", "{\"error\":\"different\"}"
  );
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "redaction_state", "redacted"
  );
});

test("approval", async () => {
  const compare = await requireComparator();
  const normalizeCodexEvent = await requireCodexNormalizer();
  const normalizeClaudeEvent = await requireClaudeNormalizer();
  const parseTraceEvent = await requireTraceParser();
  const discoverCodexCapabilities = await requireCodexCapabilities();
  const discoverClaudeCapabilities = await requireClaudeCapabilities();
  const codex = normalizedCodexEvent(
    normalizeCodexEvent,
    codexEnvelope("wrapper", { type: "approval.granted", payload: { tool: "Bash", decision: "allow" } })
  );
  const claude = normalizedClaudeEvent(
    normalizeClaudeEvent,
    claudeEnvelope("permission-tool", { type: "permission", tool: "Bash", decision: "allow" })
  );
  const codexProfile = codexCapability(discoverCodexCapabilities);
  const claudeProfile = claudeCapability(discoverClaudeCapabilities);
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "actor", "wrapper"
  );
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "correlation_id", "corr-e9-003-other"
  );
});

test("evidence", async () => {
  const compare = await requireComparator();
  const normalizeCodexEvent = await requireCodexNormalizer();
  const normalizeClaudeEvent = await requireClaudeNormalizer();
  const parseTraceEvent = await requireTraceParser();
  const discoverCodexCapabilities = await requireCodexCapabilities();
  const discoverClaudeCapabilities = await requireClaudeCapabilities();
  const codex = normalizedCodexEvent(
    normalizeCodexEvent,
    codexEnvelope("wrapper", { type: "evidence.created", digest: DIGEST, payload: { digest: DIGEST } })
  );
  const claude = normalizedClaudeEvent(
    normalizeClaudeEvent,
    claudeEnvelope("wrapper", { type: "evidence.created", digest: DIGEST })
  );
  const codexProfile = codexCapability(discoverCodexCapabilities);
  const claudeProfile = claudeCapability(discoverClaudeCapabilities);
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "evidence_digest", DIFFERENT_DIGEST
  );
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "parent_id", "run-e9-003:task.started:parent"
  );
});

test("intervention", async () => {
  const compare = await requireComparator();
  const normalizeCodexEvent = await requireCodexNormalizer();
  const normalizeClaudeEvent = await requireClaudeNormalizer();
  const parseTraceEvent = await requireTraceParser();
  const discoverCodexCapabilities = await requireCodexCapabilities();
  const discoverClaudeCapabilities = await requireClaudeCapabilities();
  const codex = normalizedCodexEvent(
    normalizeCodexEvent,
    codexEnvelope("wrapper", { type: "intervention.occurred" })
  );
  const claude = normalizedClaudeEvent(
    normalizeClaudeEvent,
    claudeEnvelope("wrapper", { type: "intervention.occurred" })
  );
  const codexProfile = codexCapability(discoverCodexCapabilities);
  const claudeProfile = claudeCapability(discoverClaudeCapabilities);
  assertSharedFieldPair(
    parseTraceEvent, compare, codex, claude, codexProfile, claudeProfile, "target_path", "src/intervention.ts"
  );
});

test("unavailable-difference", async () => {
  const compare = await requireComparator();
  const normalizeCodexEvent = await requireCodexNormalizer();
  const normalizeClaudeEvent = await requireClaudeNormalizer();
  const parseTraceEvent = await requireTraceParser();
  const discoverCodexCapabilities = await requireCodexCapabilities();
  const discoverClaudeCapabilities = await requireClaudeCapabilities();
  const codex = normalizedCodexEvent(
    normalizeCodexEvent,
    codexEnvelope("wrapper", { type: "task.started" })
  );
  const claude = normalizedClaudeEvent(
    normalizeClaudeEvent,
    claudeEnvelope("wrapper", { type: "task.started" })
  );
  assertValid(parseTraceEvent, codex);
  assertValid(parseTraceEvent, claude);
  const codexProfile = codexCapability(discoverCodexCapabilities);
  const claudeProfile = limitedClaudeCapability(discoverClaudeCapabilities);
  const missing = asStringArray(claudeProfile.known_missing_events);
  const supported = asStringArray(claudeProfile.supported_event_groups);
  if (!missing.includes("tool_call")) throw new Error(FAILURE);
  const contradictoryCapability = {
    ...claudeProfile,
    supported_event_groups: supported.filter((eventGroup) => eventGroup !== "run_lifecycle"),
    known_missing_events: missing.map((eventGroup) => eventGroup === "tool_call" ? "run_lifecycle" : eventGroup)
  };
  assertAccepted(compare, trace(codex, CODEX_IDENTITY, codexProfile), trace(claude, CLAUDE_IDENTITY, claudeProfile));
  assertRefused(
    compare,
    trace(codex, CODEX_IDENTITY, codexProfile),
    trace(claude, CLAUDE_IDENTITY, contradictoryCapability)
  );
});

test("profile-difference", async () => {
  const compare = await requireComparator();
  const normalizeCodexEvent = await requireCodexNormalizer();
  const normalizeClaudeEvent = await requireClaudeNormalizer();
  const parseTraceEvent = await requireTraceParser();
  const discoverCodexCapabilities = await requireCodexCapabilities();
  const discoverClaudeCapabilities = await requireClaudeCapabilities();
  const codex = normalizedCodexEvent(
    normalizeCodexEvent,
    codexEnvelope("wrapper", { type: "task.started" })
  );
  const claude = normalizedClaudeEvent(
    normalizeClaudeEvent,
    claudeEnvelope("wrapper", { type: "task.started" })
  );
  assertValid(parseTraceEvent, codex);
  assertValid(parseTraceEvent, claude);
  const codexProfile = codexCapability(discoverCodexCapabilities);
  const claudeProfile = claudeCapability(discoverClaudeCapabilities);
  assertAccepted(compare, trace(codex, CODEX_IDENTITY, codexProfile), trace(claude, CLAUDE_IDENTITY, claudeProfile));
  assertRefused(
    compare,
    trace(codex, CODEX_IDENTITY, codexProfile),
    trace(claude, "claude-code|misdeclared|profile", claudeProfile)
  );
});
