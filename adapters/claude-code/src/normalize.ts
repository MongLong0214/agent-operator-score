/**
 * Normalize one Claude Code native, hook, or wrapper record into a vendor-neutral
 * aos-trace event. Permitted sources only. Missing proof is UNAVAILABLE. Attribution
 * is never synthesized. Payloads are redacted and bounded.
 */

import { createHash } from "node:crypto";
import { redactClaudePayload } from "./redact.ts";

const PERMITTED_SOURCES = new Set([
  "sdkQuery",
  "stream-json",
  "permission-tool",
  "wrapper",
  "workspace"
]);

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
  "approval.denied": "approval_safety",
  "approval.requested": "approval_safety",
  "intervention.occurred": "human_active_time",
  "workspace.external_mutation": "workspace_diff",
  "human.manual_edit_declared": "human_active_time",
  "actor.attribution_changed": "actor_attribution",
  "actor.attribution_unknown": "actor_attribution"
};

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DIGEST = /^[a-f0-9]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const filledString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const knownIds = (input: Record<string, unknown>): string[] =>
  Array.isArray(input.known_event_ids)
    ? input.known_event_ids.filter((entry): entry is string => typeof entry === "string")
    : [];

const contentBlocks = (native: Record<string, unknown>): Record<string, unknown>[] => {
  const message = isRecord(native.message) ? native.message : native;
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
};

const messageText = (native: Record<string, unknown>): string | null => {
  const message = isRecord(native.message) ? native.message : native;
  return filledString(message.content);
};

const unavailable = (
  input: Record<string, unknown>,
  eventType: string | null
): Record<string, unknown> => ({
  status: "UNAVAILABLE",
  event_id: null,
  run_id: input.run_id ?? null,
  task_id: input.task_id ?? null,
  timestamp: TIMESTAMP.test(String(input.timestamp)) ? String(input.timestamp) : null,
  actor: null,
  event_type: eventType,
  event_group: eventType ? EVENT_GROUP_OF[eventType] ?? null : null,
  parent_id: input.parent_id ?? null,
  correlation_id: input.correlation_id ?? null,
  identity: input.identity ?? null,
  evidence_digest: null,
  redaction_state: "none",
  payload: null
});

const eventId = (runId: string, eventType: string, native: Record<string, unknown>): string => {
  const digest = createHash("sha256")
    .update(JSON.stringify({ runId, eventType, native }))
    .digest("hex")
    .slice(0, 16);
  return `${runId}:${eventType}:${digest}`;
};

const actorFor = (eventType: string, native: Record<string, unknown>): string => {
  if (eventType === "task.started" || eventType === "task.ended") return "wrapper";
  if (eventType === "intervention.occurred" || eventType === "human.manual_edit_declared") {
    return "human/takeover";
  }
  if (eventType === "workspace.external_mutation") return "external_mutation";
  if (eventType === "actor.attribution_unknown") return "actor.attribution_unknown";
  if (eventType === "actor.attribution_changed") {
    return filledString(native.to_actor) ?? "agent";
  }
  return "agent";
};

const mapped = (
  input: Record<string, unknown>,
  eventType: string,
  native: Record<string, unknown>,
  excerpt: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => {
  const redacted = redactClaudePayload(excerpt);
  const runId = filledString(input.run_id) ?? "run-unknown";
  const provenance = filledString(extra.provenance) ?? filledString(native.provenance);
  const evidence = filledString(extra.evidence_digest) ?? filledString(native.digest);
  return {
    status: "MAPPED",
    event_id: eventId(runId, eventType, native),
    run_id: runId,
    task_id: filledString(input.task_id),
    timestamp: TIMESTAMP.test(String(input.timestamp))
      ? String(input.timestamp)
      : "1970-01-01T00:00:00.000Z",
    actor: actorFor(eventType, native),
    event_type: eventType,
    event_group: EVENT_GROUP_OF[eventType],
    parent_id: input.parent_id ?? null,
    correlation_id: filledString(input.correlation_id) ?? `corr-${runId}`,
    identity: filledString(input.identity) ?? "claude-code|unknown|unknown",
    evidence_digest: evidence && DIGEST.test(evidence) ? evidence : null,
    redaction_state: redacted.redaction_state,
    payload: redacted.payload,
    ...("provenance" in extra || provenance
      ? { provenance: extra.provenance ?? provenance }
      : {}),
    ...("from_actor" in extra ? { from_actor: extra.from_actor } : {}),
    ...("to_actor" in extra ? { to_actor: extra.to_actor } : {}),
    ...("confidence" in extra ? { confidence: extra.confidence } : {})
  };
};

const classifyToolResult = (block: Record<string, unknown>): "tool.error" | "tool.result" => {
  if (block.is_error === true) return "tool.error";
  if (filledString(block.error)) return "tool.error";
  return "tool.result";
};

const classify = (
  source: string,
  native: Record<string, unknown>,
  known: string[]
): { eventType: string; excerpt: unknown; extra?: Record<string, unknown> } | { eventType: string | null } => {
  const type = filledString(native.type);
  if (native.inferred === true) return { eventType: type };

  if (source === "sdkQuery" || source === "stream-json") {
    if (type === "stream-json" && native.subtype === "user") {
      return { eventType: "user.instruction", excerpt: messageText(native) ?? native };
    }
    if (type === "user") {
      const blocks = contentBlocks(native);
      const toolResult = blocks.find((block) => block.type === "tool_result");
      if (toolResult) {
        const eventType = classifyToolResult(toolResult);
        return {
          eventType,
          excerpt: toolResult.content ?? toolResult.error ?? toolResult
        };
      }
      return { eventType: "user.instruction", excerpt: messageText(native) ?? native };
    }
    if (type === "assistant") {
      const toolUse = contentBlocks(native).find((block) => block.type === "tool_use");
      if (toolUse) {
        return {
          eventType: "tool.call",
          excerpt: { name: toolUse.name, id: toolUse.id, input: toolUse.input }
        };
      }
    }
    return { eventType: type };
  }

  if (source === "permission-tool") {
    if (type === "permission") {
      const decision = filledString(native.decision);
      const eventType = decision === "allow"
        ? "approval.granted"
        : decision === "deny"
          ? "approval.denied"
          : "approval.requested";
      return { eventType, excerpt: { tool: native.tool, decision } };
    }
    if (type === "mcp") {
      return { eventType: "retrieval.query", excerpt: { name: native.name, query: native.query } };
    }
    if (type === "mcp_result") {
      return { eventType: "retrieval.result", excerpt: { name: native.name, result: native.result } };
    }
    return { eventType: type };
  }

  if (source === "wrapper") {
    if (type === "task.started" || type === "task.ended") {
      return { eventType: type, excerpt: { type } };
    }
    if (type === "context.selected") {
      return { eventType: type, excerpt: { selected: native.selected } };
    }
    if (type === "agent.delegated") {
      const childId = filledString(native.child_id);
      if (!childId) return { eventType: type };
      return { eventType: type, excerpt: { child_id: childId } };
    }
    if (type === "agent.returned") {
      const childId = filledString(native.child_id);
      const spawnId = filledString(native.spawn_id);
      if (!childId || !spawnId || !known.includes(spawnId)) return { eventType: type };
      return { eventType: type, excerpt: { child_id: childId, spawn_id: spawnId } };
    }
    if (type === "handoff.created") {
      const handoffId = filledString(native.handoff_id);
      if (!handoffId) return { eventType: type };
      return { eventType: type, excerpt: { handoff_id: handoffId } };
    }
    if (type === "handoff.consumed") {
      const handoffId = filledString(native.handoff_id);
      const createdId = filledString(native.created_id);
      if (!handoffId || !createdId || !known.includes(createdId)) return { eventType: type };
      return { eventType: type, excerpt: { handoff_id: handoffId, created_id: createdId } };
    }
    if (type === "evidence.created") {
      const digest = filledString(native.digest);
      if (!digest || !DIGEST.test(digest)) return { eventType: type };
      return { eventType: type, excerpt: { digest }, extra: { evidence_digest: digest } };
    }
    if (type === "intervention.occurred") {
      return { eventType: type, excerpt: { type } };
    }
    if (type === "human.manual_edit_declared") {
      return {
        eventType: type,
        excerpt: { path: native.path },
        extra: { provenance: "wrapper-workspace-correlation" }
      };
    }
    if (type === "actor.attribution_changed") {
      const provenance = filledString(native.provenance);
      const fromActor = filledString(native.from_actor);
      const toActor = filledString(native.to_actor);
      if (!provenance || !fromActor || !toActor) return { eventType: type };
      return {
        eventType: type,
        excerpt: { from_actor: fromActor, to_actor: toActor },
        extra: { provenance, from_actor: fromActor, to_actor: toActor }
      };
    }
    if (type === "actor.attribution_unknown") {
      return {
        eventType: type,
        excerpt: { type },
        extra: { provenance: "wrapper-workspace-correlation", confidence: 0.69 }
      };
    }
    return { eventType: type };
  }

  if (source === "workspace") {
    if (type === "workspace.external_mutation") {
      return {
        eventType: type,
        excerpt: { path: native.path },
        extra: { provenance: "runner-workspace-correlation" }
      };
    }
    return { eventType: type };
  }

  return { eventType: type };
};

export const normalizeClaudeEvent = (input: unknown): Record<string, unknown> => {
  const record = isRecord(input) ? input : {};
  const source = filledString(record.source);
  const native = isRecord(record.native) ? record.native : {};
  if (!source || !PERMITTED_SOURCES.has(source)) {
    return unavailable(record, filledString(native.type));
  }
  const known = knownIds(record);
  const parentId = record.parent_id;
  if (parentId !== null && parentId !== undefined && parentId !== "") {
    if (typeof parentId !== "string" || !known.includes(parentId)) {
      return unavailable(record, filledString(native.type));
    }
  }
  const classified = classify(source, native, known);
  if (!("excerpt" in classified) || !classified.eventType || !(classified.eventType in EVENT_GROUP_OF)) {
    return unavailable(record, classified.eventType ?? filledString(native.type));
  }
  return mapped(
    record,
    classified.eventType,
    native,
    classified.excerpt,
    classified.extra ?? {}
  );
};
