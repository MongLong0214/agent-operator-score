/**
 * Codex/Claude semantic-parity comparator for SSOT §9.2 / E9-003.
 *
 * Parity is semantic normalized equivalence, not identical native logs (ADR-0007).
 * Native inputs are run through the real adapter normalizers before comparison.
 * A missing normalizer, missing status, or malformed event fails closed.
 * Shared event projections are canonicalized and compared on required fields.
 * Identity and capability digest fields are reported separately as allowed
 * profile differences. UNAVAILABLE is retained; it is never rewritten to MAPPED
 * to manufacture a match.
 */

export type SemanticParityMismatch = {
  index: number;
  field: string;
  left: unknown;
  right: unknown;
};

export type UnavailableDifference = {
  index: number;
  event_type: string;
  left_status: string;
  right_status: string;
};

export type ProfileDifference = {
  field: string;
  left: unknown;
  right: unknown;
};

export type SemanticParityAdapters = {
  normalizeClaudeEvent?: (input: unknown) => Record<string, unknown>;
  normalizeCodexEvent?: (input: unknown) => Record<string, unknown>;
};

export type SemanticParityResult = {
  equivalent: boolean;
  left: Record<string, unknown>[];
  right: Record<string, unknown>[];
  required_field_mismatches: SemanticParityMismatch[];
  unavailable_differences: UnavailableDifference[];
  profile_differences: ProfileDifference[];
  errors: string[];
};

const REQUIRED_FIELDS = [
  "event_type",
  "event_group",
  "status",
  "actor",
  "task_id",
  "parent_id",
  "redaction_state",
  "evidence_digest",
  "payload"
] as const;

const DIGEST_FIELDS = [
  "runtime_version",
  "protocol_or_schema_version",
  "adapter_version",
  "source_class",
  "supported_event_groups",
  "known_missing_events"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const same = (left: unknown, right: unknown): boolean => stableJson(left) === stableJson(right);

const eventList = (trace: Record<string, unknown>, errors: string[], side: string): Record<string, unknown>[] => {
  if (!Array.isArray(trace.events)) {
    errors.push(`${side} events must be an array`);
    return [];
  }
  const records: Record<string, unknown>[] = [];
  for (let index = 0; index < trace.events.length; index += 1) {
    const entry = trace.events[index];
    if (!isRecord(entry)) {
      errors.push(`${side} events[${index}] is not an object`);
      continue;
    }
    records.push(entry);
  }
  return records;
};

const normalizerFor = (
  runtime: unknown,
  adapters: SemanticParityAdapters
): ((input: unknown) => Record<string, unknown>) | undefined => {
  if (runtime === "claude-code") return adapters.normalizeClaudeEvent;
  if (runtime === "codex") return adapters.normalizeCodexEvent;
  return undefined;
};

const eventsFromTrace = (
  trace: Record<string, unknown>,
  adapters: SemanticParityAdapters,
  errors: string[],
  side: string
): Record<string, unknown>[] => {
  if (!Object.prototype.hasOwnProperty.call(trace, "native") || trace.native === undefined) {
    return eventList(trace, errors, side);
  }
  const natives = Array.isArray(trace.native) ? trace.native : [trace.native];
  const normalize = normalizerFor(trace.runtime, adapters);
  if (typeof normalize !== "function") {
    errors.push(`${side} ${String(trace.runtime)} normalizer is unavailable`);
    return [];
  }
  const events: Record<string, unknown>[] = [];
  for (let index = 0; index < natives.length; index += 1) {
    let event: unknown;
    try {
      event = normalize(natives[index]);
    } catch {
      errors.push(`${side} native[${index}] failed to normalize`);
      continue;
    }
    if (!isRecord(event)) {
      errors.push(`${side} native[${index}] did not produce an object`);
      continue;
    }
    events.push(event);
  }
  return events;
};

const canonicalParent = (event: Record<string, unknown>, events: Record<string, unknown>[]): unknown => {
  const parentId = event.parent_id;
  if (parentId === null || parentId === undefined) return null;
  if (typeof parentId !== "string") return parentId;
  const index = events.findIndex((candidate) => candidate.event_id === parentId);
  return index >= 0 ? index : parentId;
};

const projectEvent = (
  event: Record<string, unknown>,
  events: Record<string, unknown>[],
  errors: string[],
  side: string,
  index: number
): Record<string, unknown> => {
  if (event.status == null) {
    errors.push(`${side} event[${index}] status is missing`);
  }
  return {
    event_type: event.event_type ?? null,
    event_group: event.event_group ?? null,
    status: event.status ?? null,
    actor: event.actor ?? null,
    task_id: event.task_id ?? null,
    parent_id: canonicalParent(event, events),
    redaction_state: event.redaction_state ?? "none",
    evidence_digest: event.evidence_digest ?? null,
    payload: event.payload ?? null
  };
};

const recordProfile = (
  field: string,
  left: unknown,
  right: unknown,
  differences: ProfileDifference[]
): void => {
  if (!same(left, right)) differences.push({ field, left, right });
};

export const compareSemanticTrace = (
  leftInput: unknown,
  rightInput: unknown,
  adaptersInput: SemanticParityAdapters = {}
): SemanticParityResult => {
  const errors: string[] = [];
  const adapters = isRecord(adaptersInput) ? adaptersInput as SemanticParityAdapters : {};
  if (!isRecord(leftInput)) errors.push("left trace must be an object");
  if (!isRecord(rightInput)) errors.push("right trace must be an object");
  const leftTrace = isRecord(leftInput) ? leftInput : {};
  const rightTrace = isRecord(rightInput) ? rightInput : {};
  const leftEvents = eventsFromTrace(leftTrace, adapters, errors, "left");
  const rightEvents = eventsFromTrace(rightTrace, adapters, errors, "right");
  const left = leftEvents.map((event, index) => projectEvent(event, leftEvents, errors, "left", index));
  const right = rightEvents.map((event, index) => projectEvent(event, rightEvents, errors, "right", index));

  const required_field_mismatches: SemanticParityMismatch[] = [];
  const unavailable_differences: UnavailableDifference[] = [];

  if (left.length !== right.length) {
    required_field_mismatches.push({
      index: -1,
      field: "length",
      left: left.length,
      right: right.length
    });
  }

  const paired = Math.min(left.length, right.length);
  for (let index = 0; index < paired; index += 1) {
    const leftEvent = left[index];
    const rightEvent = right[index];
    for (const field of REQUIRED_FIELDS) {
      if (!same(leftEvent[field], rightEvent[field])) {
        required_field_mismatches.push({
          index,
          field,
          left: leftEvent[field],
          right: rightEvent[field]
        });
      }
    }
    const leftStatus = String(leftEvent.status);
    const rightStatus = String(rightEvent.status);
    if (leftStatus !== rightStatus && (leftStatus === "UNAVAILABLE" || rightStatus === "UNAVAILABLE")) {
      unavailable_differences.push({
        index,
        event_type: String(leftEvent.event_type ?? rightEvent.event_type ?? ""),
        left_status: leftStatus,
        right_status: rightStatus
      });
    }
  }

  const leftCapability = isRecord(leftTrace.capability) ? leftTrace.capability : {};
  const rightCapability = isRecord(rightTrace.capability) ? rightTrace.capability : {};
  const profile_differences: ProfileDifference[] = [];
  recordProfile("runtime", leftTrace.runtime, rightTrace.runtime, profile_differences);
  recordProfile("identity", leftTrace.identity, rightTrace.identity, profile_differences);
  for (const field of DIGEST_FIELDS) {
    recordProfile(field, leftCapability[field], rightCapability[field], profile_differences);
  }

  return {
    equivalent: errors.length === 0 && required_field_mismatches.length === 0,
    left,
    right,
    required_field_mismatches,
    unavailable_differences,
    profile_differences,
    errors
  };
};
