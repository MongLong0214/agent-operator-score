export const SEMANTIC_PARITY_REFUSAL =
  "Normalized traces must preserve equivalent shared semantics and declare runtime differences.";

type Failure = { ok: false; reason: typeof SEMANTIC_PARITY_REFUSAL };
type Difference = {
  codex: string;
  claude: string;
};
type Success = {
  ok: true;
  shared_projection: string;
  declared_differences: {
    identity: Difference | null;
    capability: Difference | null;
  };
};
type CanonicalTrace = {
  projection: Record<string, unknown>[];
  identity: string;
  capability: Record<string, unknown>;
};

const SHARED_FIELDS = [
  "run_id",
  "task_id",
  "timestamp",
  "actor",
  "event_type",
  "event_group",
  "parent_id",
  "correlation_id",
  "evidence_digest",
  "redaction_state",
  "payload",
  "target_path"
] as const;

const STRING_FIELDS = [
  "run_id",
  "timestamp",
  "actor",
  "event_type",
  "event_group",
  "correlation_id",
  "redaction_state"
] as const;

const NULLABLE_FIELDS = [
  "task_id",
  "parent_id",
  "evidence_digest",
  "payload",
  "target_path"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const filledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const stringList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const entry of value) {
    if (!filledString(entry) || entries.includes(entry)) return null;
    entries.push(entry);
  }
  return entries;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const refuse = (): Failure => ({ ok: false, reason: SEMANTIC_PARITY_REFUSAL });

const projectionValue = (event: Record<string, unknown>, field: typeof SHARED_FIELDS[number]): unknown =>
  field === "target_path" && !Object.hasOwn(event, field) ? null : event[field];

const validProjection = (event: Record<string, unknown>): Record<string, unknown> | null => {
  if (!filledString(event.event_id) || !filledString(event.identity)) return null;
  const projection: Record<string, unknown> = {};
  for (const field of SHARED_FIELDS) {
    const value = projectionValue(event, field);
    if ((STRING_FIELDS as readonly string[]).includes(field) && !filledString(value)) return null;
    if ((NULLABLE_FIELDS as readonly string[]).includes(field) && value !== null && typeof value !== "string") {
      return null;
    }
    projection[field] = value;
  }
  return projection;
};

const canonicalTrace = (value: unknown): CanonicalTrace | null => {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length === 0 || !isRecord(value.profile)) {
    return null;
  }
  const identity = value.profile.identity;
  const capability = value.profile.capability;
  if (!filledString(identity) || !isRecord(capability)) return null;

  const supported = stringList(capability.supported_event_groups);
  const missing = stringList(capability.known_missing_events);
  if (supported === null || missing === null || missing.some((group) => supported.includes(group))) return null;

  const projection: Record<string, unknown>[] = [];
  for (const event of value.events) {
    if (!isRecord(event) || event.identity !== identity) return null;
    const projected = validProjection(event);
    if (projected === null || !filledString(projected.event_group)) return null;
    if (!supported.includes(projected.event_group) || missing.includes(projected.event_group)) return null;
    projection.push(projected);
  }
  return { projection, identity, capability };
};

const declaredDifference = (left: string, right: string): Difference | null =>
  left === right ? null : { codex: left, claude: right };

export const compareSemanticTrace = (codexTrace: unknown, claudeTrace: unknown): Success | Failure => {
  const codex = canonicalTrace(codexTrace);
  const claude = canonicalTrace(claudeTrace);
  if (codex === null || claude === null) return refuse();

  const codexProjection = stableJson(codex.projection);
  const claudeProjection = stableJson(claude.projection);
  if (codexProjection !== claudeProjection) return refuse();

  const codexCapability = stableJson(codex.capability);
  const claudeCapability = stableJson(claude.capability);
  return {
    ok: true,
    shared_projection: codexProjection,
    declared_differences: {
      identity: declaredDifference(codex.identity, claude.identity),
      capability: declaredDifference(codexCapability, claudeCapability)
    }
  };
};
