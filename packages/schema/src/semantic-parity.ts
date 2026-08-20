/**
 * Codex/Claude semantic-parity comparator for SSOT §9.2 / E9-003.
 *
 * Parity is semantic normalized equivalence, not identical native logs (ADR-0007).
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
  return trace.events.filter(isRecord);
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
  events: Record<string, unknown>[]
): Record<string, unknown> => ({
  event_type: event.event_type ?? null,
  event_group: event.event_group ?? null,
  status: event.status == null ? "MAPPED" : event.status,
  actor: event.actor ?? null,
  task_id: event.task_id ?? null,
  parent_id: canonicalParent(event, events),
  redaction_state: event.redaction_state ?? "none",
  evidence_digest: event.evidence_digest ?? null,
  payload: event.payload ?? null
});

const recordProfile = (
  field: string,
  left: unknown,
  right: unknown,
  differences: ProfileDifference[]
): void => {
  if (!same(left, right)) differences.push({ field, left, right });
};

export const compareSemanticTrace = (leftInput: unknown, rightInput: unknown): SemanticParityResult => {
  const errors: string[] = [];
  if (!isRecord(leftInput)) errors.push("left trace must be an object");
  if (!isRecord(rightInput)) errors.push("right trace must be an object");
  const leftTrace = isRecord(leftInput) ? leftInput : {};
  const rightTrace = isRecord(rightInput) ? rightInput : {};
  const leftEvents = eventList(leftTrace, errors, "left");
  const rightEvents = eventList(rightTrace, errors, "right");
  const left = leftEvents.map((event) => projectEvent(event, leftEvents));
  const right = rightEvents.map((event) => projectEvent(event, rightEvents));

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
