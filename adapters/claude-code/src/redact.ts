/**
 * Bounded Claude Code payload redaction. Raw secrets and hidden reasoning are
 * never stored. Excerpts longer than the frozen 2048-character bound are cut.
 */

export const BOUNDED_PAYLOAD_MAX_CHARS = 2048;
export const SECRET_CANARY = "AOS_SECRET_CANARY";

const SECRET_PATTERNS = [
  /AOS_SECRET_CANARY/g,
  /sk-ant-[A-Za-z0-9-]+/g,
  /chain-of-thought:[^\n]*/gi
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const redactString = (value: string): { value: string; redacted: boolean } => {
  let next = value;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const replaced = next.replace(pattern, "[REDACTED]");
    if (replaced !== next) redacted = true;
    next = replaced;
  }
  return { value: next, redacted };
};

const redactValue = (value: unknown): { value: unknown; redacted: boolean } => {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    let redacted = false;
    const items = value.map((entry) => {
      const inner = redactValue(entry);
      redacted = redacted || inner.redacted;
      return inner.value;
    });
    return { value: items, redacted };
  }
  if (isRecord(value)) {
    let redacted = false;
    const record: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const inner = redactValue(entry);
      redacted = redacted || inner.redacted;
      record[key] = inner.value;
    }
    return { value: record, redacted };
  }
  return { value, redacted: false };
};

export const redactClaudePayload = (payload: unknown): Record<string, unknown> => {
  const walked = redactValue(payload);
  const serialized = walked.value === null || walked.value === undefined
    ? null
    : typeof walked.value === "string"
      ? walked.value
      : JSON.stringify(walked.value) ?? null;
  let result = serialized;
  let redacted = walked.redacted;
  if (result !== null && result.length > BOUNDED_PAYLOAD_MAX_CHARS) {
    result = result.slice(0, BOUNDED_PAYLOAD_MAX_CHARS);
    redacted = true;
  }
  return {
    payload: result ?? null,
    redaction_state: redacted ? "redacted" : "none"
  };
};
