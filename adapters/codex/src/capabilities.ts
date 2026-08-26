import { createHash } from "node:crypto";
import { CODEX_ADAPTER_VERSION, CODEX_DISCOVERY_REFUSAL } from "./identity.ts";

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

type EventGroup = (typeof EVENT_GROUPS)[number];
type DiscoveryFailure = { ok: false; reason: typeof CODEX_DISCOVERY_REFUSAL };
type CapabilityDigest = {
  runtime_version: string;
  protocol_or_schema_version: string;
  adapter_version: string;
  source_class: "PRIMARY";
  supported_event_groups: string[];
  known_missing_events: string[];
};
type CapabilityRow = {
  event_group: EventGroup;
  status: string;
  source_class: "PRIMARY";
  evidence_locator: string;
  missing_effect: string;
};
type DiscoverySuccess = {
  ok: true;
  digest: CapabilityDigest;
  capability_digest: string;
  rows: CapabilityRow[];
  limits: string[];
};
type AppServerProbe = {
  response: Record<string, unknown>;
  schemaDigest: string;
  protocolVersion: string;
  schemaGroups: string[];
};

const STATUS: Record<EventGroup, string> = {
  run_lifecycle: "REQUIRED",
  runtime_identity: "REQUIRED",
  user_instruction: "REQUIRED",
  tool_call: "REQUIRED",
  workspace_diff: "DERIVED",
  evidence_claim: "REQUIRED",
  approval_safety: "REQUIRED",
  context_selection: "CONDITIONAL",
  retrieval_memory: "CONDITIONAL",
  delegation_handoff: "CONDITIONAL",
  plan_state: "DERIVED",
  token_cost: "BEST_EFFORT",
  human_active_time: "REQUIRED",
  actor_attribution: "REQUIRED"
};

const MISSING_EFFECT: Record<EventGroup, string> = {
  run_lifecycle: "run invalid",
  runtime_identity: "score blocked",
  user_instruction: "M01–M04 blocked",
  tool_call: "affected metrics blocked",
  workspace_diff: "run invalid if derivation fails",
  evidence_claim: "M15–M17 blocked",
  approval_safety: "M19 blocked; score may be withheld",
  context_selection: "M05/M07 NOT OBSERVED",
  retrieval_memory: "M06/M07 NOT OBSERVED",
  delegation_handoff: "M10/M11 NOT OBSERVED",
  plan_state: "M12–M14 blocked or NOT OBSERVED",
  token_cost: "M20 uses calls·wall·human time only or NOT OBSERVED",
  human_active_time: "M18/M20 NOT OBSERVED",
  actor_attribution: "unknown withholds score"
};

const LIMITS = [
  CODEX_DISCOVERY_REFUSAL,
  "raw secret is never stored",
  "hidden reasoning is never stored",
  "native gaps are emitted as unavailable and never guessed"
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dataValue = (record: Record<string, unknown>, key: string): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

const filledString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

const eventGroups = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const groups: string[] = [];
  for (const candidate of value) {
    const group = filledString(candidate);
    if (group === null || !EVENT_GROUPS.includes(group as EventGroup) || groups.includes(group)) return null;
    groups.push(group);
  }
  return groups;
};

const probeFrom = (surface: unknown): AppServerProbe | null => {
  if (!isRecord(surface)) return null;
  const appServer = dataValue(surface, "appServer");
  const schema = dataValue(surface, "installedGeneratedSchema");
  if (!isRecord(appServer) || !isRecord(schema)) return null;
  if (dataValue(appServer, "transport") !== "app-server-stdio-json-rpc") return null;

  const response = dataValue(appServer, "response");
  const schemaDigest = dataValue(appServer, "schemaDigest");
  const installedDigest = dataValue(schema, "digest");
  const protocolVersion = isRecord(response) ? filledString(dataValue(response, "protocolVersion")) : null;
  const schemaProtocol = filledString(dataValue(schema, "protocolVersion"));
  const schemaGroups = eventGroups(dataValue(schema, "eventGroups"));
  if (
    !isRecord(response) ||
    !isDigest(schemaDigest) ||
    schemaDigest !== installedDigest ||
    protocolVersion === null ||
    protocolVersion !== schemaProtocol ||
    schemaGroups === null
  ) {
    return null;
  }
  return { response, schemaDigest, protocolVersion, schemaGroups };
};

const capabilityDigest = (digest: CapabilityDigest): string =>
  createHash("sha256").update(JSON.stringify(digest)).digest("hex");

const unavailable = (protocol: string, runtime: string, reason: string): DiscoverySuccess => {
  const known_missing_events = EVENT_GROUPS.slice();
  const digest: CapabilityDigest = {
    runtime_version: runtime,
    protocol_or_schema_version: protocol,
    adapter_version: CODEX_ADAPTER_VERSION,
    source_class: "PRIMARY",
    supported_event_groups: [],
    known_missing_events
  };
  return {
    ok: true,
    digest,
    capability_digest: capabilityDigest(digest),
    rows: EVENT_GROUPS.map((event_group) => ({
      event_group,
      status: "UNAVAILABLE",
      source_class: "PRIMARY",
      evidence_locator: "app-server stdio JSON-RPC response bound to the exact installed generated schema",
      missing_effect: MISSING_EFFECT[event_group]
    })),
    limits: [...LIMITS, reason]
  };
};

export const discoverCodexCapabilities = (surface: unknown): DiscoverySuccess | DiscoveryFailure => {
  const probe = probeFrom(surface);
  if (probe === null) return unavailable("unknown", "unknown", "app-server schema proof is missing or not exact");

  const declared = eventGroups(dataValue(probe.response, "supportedEventGroups"));
  if (declared === null) {
    return unavailable(
      `${probe.protocolVersion}@${probe.schemaDigest}`,
      filledString(dataValue(probe.response, "runtimeVersion")) ?? "unknown",
      "app-server capability declaration is missing"
    );
  }

  const observed = new Set(declared.filter((group) => probe.schemaGroups.includes(group)));
  const supported_event_groups = EVENT_GROUPS.filter((event_group) => observed.has(event_group));
  const known_missing_events = EVENT_GROUPS.filter((event_group) => !observed.has(event_group));
  const digest: CapabilityDigest = {
    runtime_version: filledString(dataValue(probe.response, "runtimeVersion")) ?? "unknown",
    protocol_or_schema_version: `${probe.protocolVersion}@${probe.schemaDigest}`,
    adapter_version: CODEX_ADAPTER_VERSION,
    source_class: "PRIMARY",
    supported_event_groups,
    known_missing_events
  };
  return {
    ok: true,
    digest,
    capability_digest: capabilityDigest(digest),
    rows: EVENT_GROUPS.map((event_group) => ({
      event_group,
      status: observed.has(event_group) ? STATUS[event_group] : "UNAVAILABLE",
      source_class: "PRIMARY",
      evidence_locator: "app-server stdio JSON-RPC response bound to the exact installed generated schema",
      missing_effect: MISSING_EFFECT[event_group]
    })),
    limits: LIMITS.slice()
  };
};
