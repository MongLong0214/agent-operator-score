import { createHash } from "node:crypto";
import { redactCodexPayload } from "./redact.ts";

export const CODEX_CONTROLLED_EVENT_REFUSAL =
  "Codex controlled events require permitted sources, bounded redaction, and complete correlation.";

type Failure = { ok: false; reason: typeof CODEX_CONTROLLED_EVENT_REFUSAL };
type Success = { ok: true; event: Record<string, unknown> };
type Classification = {
  event_type: string;
  payload: unknown;
  evidence_digest: string | null;
  provenance?: string;
  from_actor?: string;
  to_actor?: string;
  confidence?: number;
  target_path?: string;
};
type Envelope = {
  source: string;
  native: Record<string, unknown>;
  run_id: string;
  task_id: string | null;
  correlation_id: string;
  identity: string;
  timestamp: string;
  parent_id: string | null;
};

const PERMITTED_SOURCES = new Set([
  "app-server-stdio-json-rpc",
  "wrapper",
  "workspace"
]);

const EVENT_GROUP_OF: Record<string, string> = {
  "assessment.started": "run_lifecycle",
  "assessment.ended": "run_lifecycle",
  "run.resumed": "run_lifecycle",
  "run.cancelled": "run_lifecycle",
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

const WRAPPER_EVENTS = new Set([
  "assessment.started",
  "assessment.ended",
  "run.resumed",
  "run.cancelled",
  "adapter.capability_declared",
  "task.started",
  "task.ended",
  "evidence.created",
  "evidence.invalidated",
  "completion.claimed",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "intervention.occurred",
  "human.manual_edit_declared",
  "actor.attribution_changed",
  "actor.attribution_unknown"
]);

const APP_SERVER_EVENTS = new Set([
  "user.instruction",
  "user.clarification",
  "tool.call",
  "tool.result",
  "tool.error"
]);

const ACTORS = new Set([
  "agent",
  "human/takeover",
  "external_mutation",
  "actor.attribution_unknown",
  "wrapper"
]);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SENSITIVE_VALUE = /AOS_SECRET_CANARY|\bsk-[A-Za-z0-9_-]+|(?:chain-of-thought|hidden-reasoning):/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const filledString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const safeHeader = (value: unknown): string | null => {
  const string = filledString(value);
  return string !== null && !SENSITIVE_VALUE.test(string) ? string : null;
};

const validTargetPath = (value: unknown): value is string => {
  if (!safeHeader(value) || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const knownEventIds = (input: Record<string, unknown>): string[] | null => {
  if (input.known_event_ids === undefined) return [];
  if (!Array.isArray(input.known_event_ids)) return null;
  const ids: string[] = [];
  for (const value of input.known_event_ids) {
    const id = safeHeader(value);
    if (id === null || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
};

const eventPayload = (native: Record<string, unknown>): unknown =>
  Object.hasOwn(native, "payload") ? native.payload : { type: native.type };

const eventId = (envelope: Envelope, eventType: string): string | null => {
  try {
    const encoded = JSON.stringify({
      source: envelope.source,
      native: envelope.native,
      run_id: envelope.run_id,
      correlation_id: envelope.correlation_id,
      parent_id: envelope.parent_id,
      event_type: eventType
    });
    if (encoded === undefined) return null;
    const digest = createHash("sha256").update(encoded).digest("hex").slice(0, 16);
    return `${envelope.run_id}:${eventType}:${digest}`;
  } catch {
    return null;
  }
};

const envelopeOf = (input: unknown): Envelope | null => {
  if (!isRecord(input) || !isRecord(input.native)) return null;
  const source = safeHeader(input.source);
  const runId = safeHeader(input.run_id);
  const correlationId = safeHeader(input.correlation_id);
  const identity = safeHeader(input.identity);
  const timestamp = safeHeader(input.timestamp);
  const taskId = input.task_id;
  if (
    source === null || !PERMITTED_SOURCES.has(source) || runId === null || correlationId === null ||
    identity === null || timestamp === null || !TIMESTAMP.test(timestamp) ||
    !(taskId === undefined || taskId === null || safeHeader(taskId) !== null)
  ) {
    return null;
  }

  const known = knownEventIds(input);
  const parent = input.parent_id;
  if (known === null || !(parent === undefined || parent === null || (safeHeader(parent) !== null && known.includes(safeHeader(parent) ?? "")))) {
    return null;
  }
  return {
    source,
    native: input.native,
    run_id: runId,
    task_id: taskId === undefined || taskId === null ? null : safeHeader(taskId),
    correlation_id: correlationId,
    identity,
    timestamp,
    parent_id: parent === undefined || parent === null ? null : safeHeader(parent)
  };
};

const classify = (envelope: Envelope): Classification | null => {
  const type = filledString(envelope.native.type);
  if (type === null || !Object.hasOwn(EVENT_GROUP_OF, type)) return null;
  if (
    (envelope.source === "wrapper" && !WRAPPER_EVENTS.has(type)) ||
    (envelope.source === "app-server-stdio-json-rpc" && !APP_SERVER_EVENTS.has(type)) ||
    (envelope.source === "workspace" && type !== "workspace.external_mutation")
  ) {
    return null;
  }

  const evidence = filledString(envelope.native.digest);
  const targetCandidate = envelope.native.target_path ?? envelope.native.path;
  if (targetCandidate !== undefined && targetCandidate !== null && !validTargetPath(targetCandidate)) return null;
  const target_path = validTargetPath(targetCandidate) ? targetCandidate : undefined;

  if (type === "tool.result" && filledString(envelope.native.error) !== null) {
    return {
      event_type: "tool.error",
      payload: { payload: envelope.native.payload ?? null, error: envelope.native.error },
      evidence_digest: null,
      ...(target_path === undefined ? {} : { target_path })
    };
  }
  if (type === "tool.error") {
    return {
      event_type: type,
      payload: { payload: envelope.native.payload ?? null, error: envelope.native.error ?? null },
      evidence_digest: null,
      ...(target_path === undefined ? {} : { target_path })
    };
  }
  if (type === "workspace.external_mutation" || type === "human.manual_edit_declared") {
    const provenance = safeHeader(envelope.native.provenance);
    if (provenance === null) return null;
    return {
      event_type: type,
      payload: eventPayload(envelope.native),
      evidence_digest: null,
      provenance,
      ...(target_path === undefined ? {} : { target_path })
    };
  }
  if (type === "actor.attribution_changed") {
    const provenance = safeHeader(envelope.native.provenance);
    const fromActor = safeHeader(envelope.native.from_actor);
    const toActor = safeHeader(envelope.native.to_actor);
    if (provenance === null || fromActor === null || toActor === null || !ACTORS.has(toActor)) return null;
    return {
      event_type: type,
      payload: { from_actor: fromActor, to_actor: toActor },
      evidence_digest: null,
      provenance,
      from_actor: fromActor,
      to_actor: toActor,
      ...(target_path === undefined ? {} : { target_path })
    };
  }
  if (type === "actor.attribution_unknown") {
    const provenance = safeHeader(envelope.native.provenance);
    const confidence = envelope.native.confidence;
    if (provenance === null || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence >= 0.7) {
      return null;
    }
    return {
      event_type: type,
      payload: { confidence },
      evidence_digest: null,
      provenance,
      confidence,
      ...(target_path === undefined ? {} : { target_path })
    };
  }
  return {
    event_type: type,
    payload: eventPayload(envelope.native),
    evidence_digest: evidence !== null && DIGEST.test(evidence) ? evidence : null,
    ...(target_path === undefined ? {} : { target_path })
  };
};

const actorFor = (eventType: string, classification: Classification): string | null => {
  if (eventType === "assessment.started" || eventType === "assessment.ended" || eventType === "run.resumed" ||
      eventType === "run.cancelled" || eventType === "adapter.capability_declared" ||
      eventType === "task.started" || eventType === "task.ended") return "wrapper";
  if (eventType === "intervention.occurred" || eventType === "human.manual_edit_declared") return "human/takeover";
  if (eventType === "workspace.external_mutation") return "external_mutation";
  if (eventType === "actor.attribution_unknown") return "actor.attribution_unknown";
  if (eventType === "actor.attribution_changed") return classification.to_actor ?? null;
  return "agent";
};

const refuse = (): Failure => ({ ok: false, reason: CODEX_CONTROLLED_EVENT_REFUSAL });

export const normalizeCodexEvent = (input: unknown): Success | Failure => {
  const envelope = envelopeOf(input);
  if (envelope === null) return refuse();
  const classification = classify(envelope);
  if (classification === null) return refuse();
  const actor = actorFor(classification.event_type, classification);
  const id = eventId(envelope, classification.event_type);
  if (actor === null || id === null) return refuse();
  const redacted = redactCodexPayload(classification.payload);
  return {
    ok: true,
    event: {
      event_id: id,
      run_id: envelope.run_id,
      task_id: envelope.task_id,
      timestamp: envelope.timestamp,
      actor,
      event_type: classification.event_type,
      event_group: EVENT_GROUP_OF[classification.event_type],
      parent_id: envelope.parent_id,
      correlation_id: envelope.correlation_id,
      identity: envelope.identity,
      evidence_digest: classification.evidence_digest,
      redaction_state: redacted.redaction_state,
      payload: redacted.payload,
      ...(classification.target_path === undefined ? {} : { target_path: classification.target_path }),
      ...(classification.provenance === undefined ? {} : { provenance: classification.provenance }),
      ...(classification.from_actor === undefined ? {} : { from_actor: classification.from_actor }),
      ...(classification.to_actor === undefined ? {} : { to_actor: classification.to_actor }),
      ...(classification.confidence === undefined ? {} : { confidence: classification.confidence })
    }
  };
};
