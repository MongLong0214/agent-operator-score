import { sha256Value } from "../core/digest.ts";
import { isIdentifier, isTransport, type Transport } from "../core/identity.ts";
import type { JsonValue } from "../core/canonical-json.ts";

/**
 * Agent Pool Opportunity Profile v1 — what the operator could have used, snapshotted before the
 * session starts.
 *
 * "Could have used", not "did use". An unused profile stays in the pool because the score is
 * conditional on the environment the operator was working in, and dropping what they ignored would
 * flatter every operator who reached for the wrong tool or none at all. That is the whole reason
 * this document exists separately from the trace.
 *
 * Nothing here is a score input by itself. Agent count, provider count, context window, price and
 * token budget are recorded because they describe the opportunity, and PRD 6 lists them among the
 * values that must never earn points. More agents is not more skill.
 */

export const SCHEMA_ID = "agent-pool-profile";
export const SCHEMA_VERSION = "agent-pool-profile.v1";

export type CapabilityState =
  | { readonly state: "NATIVE"; readonly source: string }
  | { readonly state: "WRAPPED"; readonly source: string }
  | { readonly state: "SIGNED"; readonly source: string }
  | { readonly state: "DERIVED"; readonly source: string }
  | { readonly state: "BEST_EFFORT"; readonly source: string }
  /** Not an operator failure. A runtime that cannot report something is an environment fact. */
  | { readonly state: "UNAVAILABLE"; readonly reason: string };

export const CAPABILITY_STATES = Object.freeze([
  "NATIVE",
  "WRAPPED",
  "SIGNED",
  "DERIVED",
  "BEST_EFFORT",
  "UNAVAILABLE"
] as const);

export interface AgentProfile {
  readonly agent_profile_id: string;
  readonly display_name: string;
  /** Free-form, and nullable: an operator may know the runtime without knowing who ships it. */
  readonly vendor: string | null;
  readonly runtime_name: string;
  readonly runtime_version: string | null;
  readonly model_id: string | null;
  readonly model_revision: string | null;
  readonly harness_name: string | null;
  readonly harness_version: string | null;
  readonly transport: Transport;
  readonly adapter_id: string;
  readonly adapter_version: string;
  readonly capabilities: Readonly<Record<string, CapabilityState>>;
  readonly available: boolean;
}

export interface CollaborationSurfaceProfile {
  readonly surface_id: string;
  readonly kind: "buzz" | "generic-event-log" | "other";
  readonly display_name: string;
  readonly transport: "signed-events" | "ndjson" | "import";
  readonly identity_digest: string | null;
  readonly capabilities: Readonly<Record<string, CapabilityState>>;
}

export interface AgentPoolOpportunityProfile {
  readonly schema_id: typeof SCHEMA_ID;
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly profile_id: string;
  readonly instrument: "AOS-Coding P0";
  readonly suite_id: string;
  readonly suite_version: string;
  readonly form: string;
  readonly language: string;
  readonly operator_policy: {
    readonly intervention_policy: string;
    readonly allowed_manual_actions: readonly string[];
  };
  readonly global_budget: {
    readonly wall_time_ms: number;
    readonly token_budget: number | null;
    readonly tool_call_budget: number | null;
    readonly cost_budget: number | null;
  };
  readonly agents: readonly AgentProfile[];
  readonly collaboration_surfaces: readonly CollaborationSurfaceProfile[];
  readonly profile_digest: string;
}

export interface ProfileProblem {
  readonly field: string;
  readonly reason: string;
}

const isCapabilityState = (value: unknown): value is CapabilityState => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { state?: unknown; source?: unknown; reason?: unknown };
  if (typeof record.state !== "string") return false;
  if (!(CAPABILITY_STATES as readonly string[]).includes(record.state)) return false;
  // UNAVAILABLE says why; every other state says where the evidence came from. A state with
  // neither is a capability claim with nothing behind it.
  return record.state === "UNAVAILABLE"
    ? typeof record.reason === "string" && record.reason.length > 0
    : typeof record.source === "string" && record.source.length > 0;
};

/**
 * The digest covers the profile without its own digest field. Including it would make the value
 * depend on itself; omitting the exclusion silently would let two profiles with different digests
 * hash identically, which is the failure a digest exists to prevent.
 */
export const profileDigestOf = (profile: AgentPoolOpportunityProfile): string => {
  const { profile_digest: _ignored, ...rest } = profile;
  return sha256Value(rest as unknown as JsonValue);
};

export const validateProfile = (profile: AgentPoolOpportunityProfile): readonly ProfileProblem[] => {
  const problems: ProfileProblem[] = [];
  const push = (field: string, reason: string): void => {
    problems.push({ field, reason });
  };

  if (profile.schema_id !== SCHEMA_ID) push("schema_id", `must be ${SCHEMA_ID}`);
  if (profile.schema_version !== SCHEMA_VERSION) push("schema_version", `must be ${SCHEMA_VERSION}`);
  if (profile.instrument !== "AOS-Coding P0") push("instrument", "must be AOS-Coding P0");
  if (!isIdentifier(profile.profile_id)) push("profile_id", "is not a usable identifier");

  if (!Number.isFinite(profile.global_budget.wall_time_ms) || profile.global_budget.wall_time_ms <= 0) {
    push("global_budget.wall_time_ms", "must be a positive number of milliseconds");
  }
  for (const key of ["token_budget", "tool_call_budget", "cost_budget"] as const) {
    const value = profile.global_budget[key];
    // Null is "not bounded", which is different from zero. Collapsing them would turn an unbounded
    // budget into one that forbids the first token.
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      push(`global_budget.${key}`, "must be null or a non-negative number");
    }
  }

  if (profile.agents.length === 0) push("agents", "a pool with no agent profile describes no opportunity");

  const agentIds = new Set<string>();
  for (const agent of profile.agents) {
    const where = `agents.${agent.agent_profile_id}`;
    if (!isIdentifier(agent.agent_profile_id)) {
      push("agents", `agent profile id ${String(agent.agent_profile_id)} is not a usable identifier`);
      continue;
    }
    if (agentIds.has(agent.agent_profile_id)) {
      push("agents", `${agent.agent_profile_id} is declared more than once`);
      continue;
    }
    agentIds.add(agent.agent_profile_id);
    if (typeof agent.runtime_name !== "string" || agent.runtime_name.length === 0) {
      push(where, "declares no runtime_name");
    }
    if (!isTransport(agent.transport)) push(where, `declares unknown transport ${String(agent.transport)}`);
    if (typeof agent.adapter_id !== "string" || agent.adapter_id.length === 0) {
      push(where, "declares no adapter_id");
    }
    for (const [name, state] of Object.entries(agent.capabilities)) {
      if (!isCapabilityState(state)) push(`${where}.capabilities.${name}`, "is not a usable capability state");
    }
  }

  const surfaceIds = new Set<string>();
  for (const surface of profile.collaboration_surfaces) {
    if (!isIdentifier(surface.surface_id)) {
      push("collaboration_surfaces", `surface id ${String(surface.surface_id)} is not a usable identifier`);
      continue;
    }
    if (surfaceIds.has(surface.surface_id)) {
      push("collaboration_surfaces", `${surface.surface_id} is declared more than once`);
      continue;
    }
    surfaceIds.add(surface.surface_id);
    for (const [name, state] of Object.entries(surface.capabilities)) {
      if (!isCapabilityState(state)) {
        push(`collaboration_surfaces.${surface.surface_id}.capabilities.${name}`, "is not a usable capability state");
      }
    }
  }

  // A validator that throws on malformed input cannot validate malformed input. Canonical JSON
  // refuses values with no JSON representation, and a profile carrying one reaches here; that is a
  // finding to report, not an exception to raise at the caller.
  try {
    if (profile.profile_digest !== profileDigestOf(profile)) {
      push("profile_digest", "does not match the profile it is attached to");
    }
  } catch (error: unknown) {
    push("profile_digest", `cannot be computed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return Object.freeze(problems);
};

/**
 * Values that describe the opportunity and must never become score inputs (PRD 6). Exported so the
 * scorer can assert it reads none of them, rather than leaving that to a reviewer noticing.
 */
export const NON_SCORING_OBSERVATIONS: readonly string[] = Object.freeze([
  "agent_count",
  "provider_count",
  "model_price",
  "context_window",
  "prompt_length",
  "token_usage",
  "wall_time",
  "graph_nodes",
  "subagent_count",
  "reviewer_count",
  "mcp_count",
  "skill_count",
  "memory_size",
  "rag_document_count",
  "generated_code_volume",
  "message_count",
  "collaboration_channel_count",
  "parallel_process_count",
  "automation_step_count"
]);
