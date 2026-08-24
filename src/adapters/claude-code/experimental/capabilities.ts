/**
 * Claude Code capability discovery. Rows always quote the frozen SSOT §9.2 locators,
 * source classes, and missing effects. Observation is fail-closed: only official
 * TypeScript SDK query()/SDKMessage, stream-json, official permission/tool, bounded
 * wrapper, and workspace artifacts can make a group supported.
 */

import {
  ADAPTER_VERSION,
  CLAUDE_LIMITS,
  PROTOCOL_VERSION,
  hasBoundedWrapper,
  hasOfficialPermissionTool,
  hasWorkspaceArtifact,
  officialMessages,
  officialRuntimeVersion
} from "./identity.ts";

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

const SOURCE_CLASS: Record<EventGroup, string> = {
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

const OBSERVED_STATUS: Record<EventGroup, string> = {
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

const LOCATOR: Record<EventGroup, string> = {
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

const MISSING: Record<EventGroup, { missing_effect: string; missing_effects: string[] }> = {
  run_lifecycle: { missing_effect: "run invalid", missing_effects: ["RUN_INVALID"] },
  runtime_identity: { missing_effect: "score blocked", missing_effects: ["SCORE_BLOCKED"] },
  user_instruction: { missing_effect: "M01–M04 blocked", missing_effects: ["METRICS_BLOCKED"] },
  tool_call: { missing_effect: "affected metrics blocked", missing_effects: ["METRICS_BLOCKED"] },
  workspace_diff: { missing_effect: "run invalid if derivation fails", missing_effects: ["RUN_INVALID"] },
  evidence_claim: { missing_effect: "M15–M17 blocked", missing_effects: ["METRICS_BLOCKED"] },
  approval_safety: { missing_effect: "M19 blocked; score may be withheld", missing_effects: ["METRICS_BLOCKED", "SCORE_WITHHELD"] },
  context_selection: { missing_effect: "M05/M07 NOT OBSERVED", missing_effects: ["NOT_OBSERVED"] },
  retrieval_memory: { missing_effect: "M06/M07 NOT OBSERVED", missing_effects: ["NOT_OBSERVED"] },
  delegation_handoff: { missing_effect: "M10/M11 NOT OBSERVED", missing_effects: ["NOT_OBSERVED"] },
  plan_state: { missing_effect: "M12–M14 blocked or NOT OBSERVED", missing_effects: ["METRICS_BLOCKED", "NOT_OBSERVED"] },
  token_cost: { missing_effect: "M20 uses calls·wall·human time only or NOT OBSERVED", missing_effects: ["DEGRADED_SUBSTITUTE", "NOT_OBSERVED"] },
  human_active_time: { missing_effect: "M18/M20 NOT OBSERVED", missing_effects: ["NOT_OBSERVED"] },
  actor_attribution: { missing_effect: "unknown withholds score", missing_effects: ["SCORE_WITHHELD"] }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const contentBlocks = (message: Record<string, unknown>): Record<string, unknown>[] => {
  const payload = isRecord(message.message) ? message.message.content : message.content;
  if (!Array.isArray(payload)) return [];
  return payload.filter(isRecord);
};

const hasUserTurn = (messages: Record<string, unknown>[]): boolean =>
  messages.some((message) => message.type === "user" || message.subtype === "user");

const hasToolCall = (messages: Record<string, unknown>[]): boolean =>
  messages.some((message) =>
    contentBlocks(message).some((block) => block.type === "tool_use" || block.type === "tool_result")
  );

const hasTokenCost = (messages: Record<string, unknown>[]): boolean =>
  messages.some((message) => message.type === "result" && isRecord(message.usage));

const observed = (group: EventGroup, surface: unknown): boolean => {
  const messages = officialMessages(surface);
  switch (group) {
    case "runtime_identity":
    case "actor_attribution":
      return messages.length > 0;
    case "user_instruction":
      return hasUserTurn(messages);
    case "tool_call":
      return hasToolCall(messages);
    case "token_cost":
      return hasTokenCost(messages);
    case "approval_safety":
    case "retrieval_memory":
      return hasOfficialPermissionTool(surface);
    case "run_lifecycle":
    case "evidence_claim":
    case "context_selection":
    case "delegation_handoff":
    case "human_active_time":
      return hasBoundedWrapper(surface);
    case "workspace_diff":
    case "plan_state":
      return hasWorkspaceArtifact(surface);
    default:
      return false;
  }
};

export const discoverClaudeCapabilities = (surface: unknown): Record<string, unknown> => {
  const rows = EVENT_GROUPS.map((event_group) => {
    const present = observed(event_group, surface);
    return {
      event_group,
      status: present ? OBSERVED_STATUS[event_group] : "UNAVAILABLE",
      source_class: SOURCE_CLASS[event_group],
      evidence_locator: LOCATOR[event_group],
      missing_effect: MISSING[event_group].missing_effect,
      missing_effects: MISSING[event_group].missing_effects.slice()
    };
  });
  const supported_event_groups = rows
    .filter((row) => row.status !== "UNAVAILABLE")
    .map((row) => row.event_group);
  const known_missing_events = rows
    .filter((row) => row.status === "UNAVAILABLE")
    .map((row) => row.event_group);
  return {
    digest: {
      runtime_version: officialRuntimeVersion(surface),
      protocol_or_schema_version: PROTOCOL_VERSION,
      adapter_version: ADAPTER_VERSION,
      source_class: ["PRIMARY", "SECONDARY", "RUNNER_DERIVED"],
      supported_event_groups,
      known_missing_events
    },
    rows,
    limits: CLAUDE_LIMITS.slice()
  };
};
