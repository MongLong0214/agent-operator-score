import assert from "node:assert/strict";
import { describe, test } from "node:test";

const FAILURE =
  "unknown/missing identity, missing installed generated-schema digest, or a forbidden-source capability row appears complete.";

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

const SCHEMA_DIGEST = "a".repeat(64);
const OTHER_SCHEMA_DIGEST = "b".repeat(64);
const PROFILE_DIGEST = "89d5bd9b25cacd1cb288a3f15d4de919e8f06edac1a2af3e6ab733cc5fc74b6f";
const CAPABILITY_DIGEST = "c5cc182e3f19f3e0fcc56491661a9a6ee7adb2bf0aa3b40e648ade8da10673d9";
const SECRET = "sk-codex-canary-3d8a";
const HIDDEN = "hidden-reasoning: never persist this";

type Surface = Record<string, unknown>;
type Identity = (surface: unknown) => Record<string, unknown>;
type Capabilities = (surface: unknown) => Record<string, unknown>;

const completeSurface = (): Surface => ({
  appServer: {
    transport: "app-server-stdio-json-rpc",
    schemaDigest: SCHEMA_DIGEST,
    response: {
      runtime: "codex",
      model: "gpt-5-codex",
      harness: "codex-app-server",
      runtimeVersion: "1.0.0",
      protocolVersion: "app-server-v1",
      tools: ["read", "exec"],
      supportedEventGroups: EVENT_GROUPS.slice()
    }
  },
  installedGeneratedSchema: {
    digest: SCHEMA_DIGEST,
    protocolVersion: "app-server-v1",
    eventGroups: EVENT_GROUPS.slice()
  }
});

const incompleteIdentitySurface = (): Surface => ({
  appServer: {
    transport: "app-server-stdio-json-rpc",
    schemaDigest: SCHEMA_DIGEST,
    response: {
      runtime: "codex",
      model: "gpt-5-codex",
      runtimeVersion: "1.0.0",
      protocolVersion: "app-server-v1",
      tools: ["read", "exec"],
      supportedEventGroups: EVENT_GROUPS.slice()
    }
  },
  installedGeneratedSchema: {
    digest: SCHEMA_DIGEST,
    protocolVersion: "app-server-v1",
    eventGroups: EVENT_GROUPS.slice()
  }
});

const appServerOf = (surface: Surface): Record<string, unknown> => {
  const appServer = surface.appServer;
  assert.equal(appServer !== null && typeof appServer === "object" && !Array.isArray(appServer), true, FAILURE);
  return appServer as Record<string, unknown>;
};

const responseOf = (surface: Surface): Record<string, unknown> => {
  const response = appServerOf(surface).response;
  assert.equal(response !== null && typeof response === "object" && !Array.isArray(response), true, FAILURE);
  return response as Record<string, unknown>;
};

const schemaOf = (surface: Surface): Record<string, unknown> => {
  const schema = surface.installedGeneratedSchema;
  assert.equal(schema !== null && typeof schema === "object" && !Array.isArray(schema), true, FAILURE);
  return schema as Record<string, unknown>;
};

const changedRuntimeSurface = (): Surface => {
  const surface = completeSurface();
  responseOf(surface).runtimeVersion = "1.0.1";
  return surface;
};

const changedProtocolSurface = (): Surface => {
  const surface = completeSurface();
  responseOf(surface).protocolVersion = "app-server-v2";
  schemaOf(surface).protocolVersion = "app-server-v2";
  return surface;
};

const changedToolsSurface = (): Surface => {
  const surface = completeSurface();
  responseOf(surface).tools = ["exec", "read", "apply_patch"];
  return surface;
};

const changedSupportedSurface = (): Surface => {
  const surface = completeSurface();
  responseOf(surface).supportedEventGroups = EVENT_GROUPS.filter((group) => group !== "token_cost");
  return surface;
};

const changedSchemaSurface = (): Surface => {
  const surface = completeSurface();
  appServerOf(surface).schemaDigest = OTHER_SCHEMA_DIGEST;
  schemaOf(surface).digest = OTHER_SCHEMA_DIGEST;
  return surface;
};

const missingSchemaSurface = (): Surface => {
  const surface = completeSurface();
  delete schemaOf(surface).digest;
  return surface;
};

const forbiddenSurface = (): Surface => ({
  websocket: {
    transport: "websocket",
    schemaDigest: SCHEMA_DIGEST,
    response: {
      runtime: "codex",
      model: "gpt-5-codex",
      harness: "codex-app-server",
      runtimeVersion: "1.0.0",
      protocolVersion: "app-server-v1",
      tools: ["read", "exec"],
      supportedEventGroups: EVENT_GROUPS.slice()
    },
  },
  installedGeneratedSchema: {
    digest: SCHEMA_DIGEST,
    protocolVersion: "app-server-v1",
    eventGroups: EVENT_GROUPS.slice()
  }
});

const loadIdentity = async () => {
  try {
    return await import("../src/identity.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const loadCapabilities = async () => {
  try {
    return await import("../src/capabilities.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
};

const requireIdentity = async (): Promise<Identity> => {
  const mod = await loadIdentity();
  assert.equal(typeof mod.discoverCodexIdentity, "function", FAILURE);
  return mod.discoverCodexIdentity as Identity;
};

const requireCapabilities = async (): Promise<Capabilities> => {
  const mod = await loadCapabilities();
  assert.equal(typeof mod.discoverCodexCapabilities, "function", FAILURE);
  return mod.discoverCodexCapabilities as Capabilities;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true, FAILURE);
  return value as Record<string, unknown>;
};

const accepted = (value: unknown): Record<string, unknown> => {
  const result = asRecord(value);
  assert.equal(result.ok, true, FAILURE);
  return result;
};

const asStrings = (value: unknown): string[] => {
  assert.equal(Array.isArray(value), true, FAILURE);
  assert.equal(value.every((entry) => typeof entry === "string"), true, FAILURE);
  return value as string[];
};

const digestOf = (discovery: Record<string, unknown>): Record<string, unknown> => asRecord(discovery.digest);

const rowsOf = (discovery: Record<string, unknown>): Record<string, unknown>[] => {
  const rows = discovery.rows;
  assert.equal(Array.isArray(rows), true, FAILURE);
  return rows.map(asRecord);
};

const rowOf = (discovery: Record<string, unknown>, group: string): Record<string, unknown> => {
  const row = rowsOf(discovery).find((candidate) => candidate.event_group === group);
  assert.equal(row !== undefined, true, FAILURE);
  if (row === undefined) throw new Error(FAILURE);
  return row;
};

const assertDigest = (discovery: Record<string, unknown>): Record<string, unknown> => {
  const digest = digestOf(discovery);
  assert.deepEqual(Object.keys(digest), DIGEST_FIELDS.slice(), FAILURE);
  assert.equal(typeof digest.runtime_version, "string", FAILURE);
  assert.equal(typeof digest.protocol_or_schema_version, "string", FAILURE);
  assert.equal(typeof digest.adapter_version, "string", FAILURE);
  assert.equal(digest.source_class, "PRIMARY", FAILURE);
  asStrings(digest.supported_event_groups);
  asStrings(digest.known_missing_events);
  assert.equal(typeof discovery.capability_digest, "string", FAILURE);
  assert.equal(/^[a-f0-9]{64}$/u.test(String(discovery.capability_digest)), true, FAILURE);
  return digest;
};

const assertComplete = (discovery: Record<string, unknown>): void => {
  const digest = assertDigest(discovery);
  assert.deepEqual(digest.supported_event_groups, EVENT_GROUPS.slice(), FAILURE);
  assert.deepEqual(digest.known_missing_events, [], FAILURE);
  assert.deepEqual(rowsOf(discovery).map((row) => row.event_group), EVENT_GROUPS.slice(), FAILURE);
  for (const group of EVENT_GROUPS) {
    const row = rowOf(discovery, group);
    assert.equal(row.status === "UNAVAILABLE", false, FAILURE);
    assert.equal(row.source_class, "PRIMARY", FAILURE);
    assert.equal(typeof row.evidence_locator, "string", FAILURE);
    assert.equal(String(row.evidence_locator).length > 0, true, FAILURE);
    assert.equal(typeof row.missing_effect, "string", FAILURE);
    assert.equal(String(row.missing_effect).length > 0, true, FAILURE);
  }
};

const textOf = (value: unknown): string => JSON.stringify(value);

describe("capabilities", () => {
test("complete", async () => {
  const discoverCodexIdentity = await requireIdentity();
  const discoverCodexCapabilities = await requireCapabilities();
  const surface = completeSurface();
  const identity = accepted(discoverCodexIdentity(surface));
  assert.equal(identity.status, "exact", FAILURE);
  assert.equal(identity.runtime, "codex", FAILURE);
  assert.equal(identity.model, "gpt-5-codex", FAILURE);
  assert.equal(identity.harness, "codex-app-server", FAILURE);
  assert.equal(identity.identity_id, "codex|gpt-5-codex|codex-app-server", FAILURE);
  assert.equal(identity.profile_digest, PROFILE_DIGEST, FAILURE);
  assert.equal(identity.source_class, "PRIMARY", FAILURE);
  assert.equal(asStrings(identity.limits).length > 0, true, FAILURE);

  const discovery = accepted(discoverCodexCapabilities(surface));
  assertComplete(discovery);
  const digest = assertDigest(discovery);
  assert.equal(digest.runtime_version, "1.0.0", FAILURE);
  assert.equal(digest.protocol_or_schema_version, `app-server-v1@${SCHEMA_DIGEST}`, FAILURE);
  assert.equal(digest.adapter_version, "aos-adapter-codex-0.0.0", FAILURE);
  assert.equal(discovery.capability_digest, CAPABILITY_DIGEST, FAILURE);
});

test("limited", async () => {
  const discoverCodexIdentity = await requireIdentity();
  const discoverCodexCapabilities = await requireCapabilities();
  assert.equal(accepted(discoverCodexIdentity(completeSurface())).status, "exact", FAILURE);
  assertComplete(accepted(discoverCodexCapabilities(completeSurface())));

  const identity = accepted(discoverCodexIdentity(incompleteIdentitySurface()));
  assert.equal(identity.status, "limited", FAILURE);
  assert.equal(identity.runtime, "codex", FAILURE);
  assert.equal(identity.model, "gpt-5-codex", FAILURE);
  assert.equal(identity.harness, null, FAILURE);
  assert.equal(identity.identity_id, null, FAILURE);
  assert.equal(identity.profile_digest, null, FAILURE);
  assert.equal(asStrings(identity.limits).some((limit) => limit.includes("harness")), true, FAILURE);
});

test("unknown", async () => {
  const discoverCodexIdentity = await requireIdentity();
  const discoverCodexCapabilities = await requireCapabilities();
  assert.equal(accepted(discoverCodexIdentity(completeSurface())).status, "exact", FAILURE);
  assertComplete(accepted(discoverCodexCapabilities(completeSurface())));

  const identity = accepted(discoverCodexIdentity({}));
  assert.equal(identity.status, "unknown", FAILURE);
  assert.equal(identity.runtime, null, FAILURE);
  assert.equal(identity.model, null, FAILURE);
  assert.equal(identity.harness, null, FAILURE);
  assert.equal(identity.identity_id, null, FAILURE);
  assert.equal(identity.profile_digest, null, FAILURE);
  assert.equal(asStrings(identity.limits).some((limit) => limit.includes("app-server")), true, FAILURE);
});

test("missing-required", async () => {
  const discoverCodexCapabilities = await requireCapabilities();
  assertComplete(accepted(discoverCodexCapabilities(completeSurface())));

  const discovery = accepted(discoverCodexCapabilities(missingSchemaSurface()));
  const digest = assertDigest(discovery);
  assert.deepEqual(digest.supported_event_groups, [], FAILURE);
  assert.deepEqual(digest.known_missing_events, EVENT_GROUPS.slice(), FAILURE);
  for (const group of EVENT_GROUPS) {
    const row = rowOf(discovery, group);
    assert.equal(row.status, "UNAVAILABLE", FAILURE);
    assert.equal((digest.known_missing_events as string[]).includes(group), true, FAILURE);
    assert.equal((digest.supported_event_groups as string[]).includes(group), false, FAILURE);
    assert.equal(typeof row.missing_effect, "string", FAILURE);
  }
});

test("config-redaction", async () => {
  const discoverCodexIdentity = await requireIdentity();
  const discoverCodexCapabilities = await requireCapabilities();
  const surface = completeSurface();
  surface.config = { OPENAI_API_KEY: SECRET, hidden_reasoning: HIDDEN };
  const identity = accepted(discoverCodexIdentity(surface));
  const discovery = accepted(discoverCodexCapabilities(surface));
  assert.equal(identity.status, "exact", FAILURE);
  assertComplete(discovery);
  const emitted = textOf({ identity, discovery });
  assert.equal(emitted.includes(SECRET), false, FAILURE);
  assert.equal(emitted.includes(HIDDEN), false, FAILURE);
});

test("stable-digest", async () => {
  const discoverCodexIdentity = await requireIdentity();
  const discoverCodexCapabilities = await requireCapabilities();
  const exactIdentity = accepted(discoverCodexIdentity(completeSurface()));
  const reorderedTools = completeSurface();
  responseOf(reorderedTools).tools = ["exec", "read"];
  const reorderedIdentity = accepted(discoverCodexIdentity(reorderedTools));
  const changedTools = accepted(discoverCodexIdentity(changedToolsSurface()));
  assert.equal(exactIdentity.profile_digest, PROFILE_DIGEST, FAILURE);
  assert.equal(reorderedIdentity.profile_digest, PROFILE_DIGEST, FAILURE);
  assert.equal(changedTools.profile_digest === PROFILE_DIGEST, false, FAILURE);

  const baseline = accepted(discoverCodexCapabilities(completeSurface()));
  const changedRuntime = accepted(discoverCodexCapabilities(changedRuntimeSurface()));
  const changedProtocol = accepted(discoverCodexCapabilities(changedProtocolSurface()));
  const changedSupported = accepted(discoverCodexCapabilities(changedSupportedSurface()));
  assertComplete(baseline);
  assert.equal(baseline.capability_digest, CAPABILITY_DIGEST, FAILURE);
  assert.equal(baseline.capability_digest === changedRuntime.capability_digest, false, FAILURE);
  assert.equal(baseline.capability_digest === changedProtocol.capability_digest, false, FAILURE);
  assert.equal(baseline.capability_digest === changedSupported.capability_digest, false, FAILURE);
  assert.equal(baseline.capability_digest === accepted(discoverCodexCapabilities(forbiddenSurface())).capability_digest, false, FAILURE);
});

test("installed-schema-digest", async () => {
  const discoverCodexCapabilities = await requireCapabilities();
  const installed = accepted(discoverCodexCapabilities(completeSurface()));
  const changed = accepted(discoverCodexCapabilities(changedSchemaSurface()));
  assertComplete(installed);
  assertComplete(changed);
  const installedDigest = assertDigest(installed);
  const changedDigest = assertDigest(changed);
  assert.equal(installedDigest.protocol_or_schema_version, `app-server-v1@${SCHEMA_DIGEST}`, FAILURE);
  assert.equal(changedDigest.protocol_or_schema_version, `app-server-v1@${OTHER_SCHEMA_DIGEST}`, FAILURE);
  assert.equal(installed.capability_digest === changed.capability_digest, false, FAILURE);
});

test("forbidden-source", async () => {
  const discoverCodexIdentity = await requireIdentity();
  const discoverCodexCapabilities = await requireCapabilities();
  const permittedIdentity = accepted(discoverCodexIdentity(completeSurface()));
  const permitted = accepted(discoverCodexCapabilities(completeSurface()));
  assert.equal(permittedIdentity.status, "exact", FAILURE);
  assertComplete(permitted);

  const forbiddenIdentity = accepted(discoverCodexIdentity(forbiddenSurface()));
  const forbidden = accepted(discoverCodexCapabilities(forbiddenSurface()));
  assert.equal(forbiddenIdentity.status, "unknown", FAILURE);
  const digest = assertDigest(forbidden);
  assert.deepEqual(digest.supported_event_groups, [], FAILURE);
  for (const group of EVENT_GROUPS) {
    assert.equal(rowOf(forbidden, group).status, "UNAVAILABLE", FAILURE);
  }
  assert.equal(textOf({ forbiddenIdentity, forbidden }).toLowerCase().includes("websocket"), false, FAILURE);
});
});
