export const BOUNDED_PAYLOAD_MAX_CHARS = 2048;
export const SECRET_CANARY = "AOS_SECRET_CANARY";

type Redaction = { value: unknown; redacted: boolean };
type RedactedPayload = {
  payload: string | null;
  redaction_state: "none" | "redacted";
};

const SECRET_PATTERNS = [
  /AOS_SECRET_CANARY/g,
  /\bsk-[A-Za-z0-9_-]+/g,
  /(?:chain-of-thought|hidden-reasoning):[^\n]*/gi
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const redactString = (value: string): Redaction => {
  let next = value;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const replaced = next.replace(pattern, "[REDACTED]");
    redacted = redacted || replaced !== next;
    next = replaced;
  }
  return { value: next, redacted };
};

const redactValue = (value: unknown, seen: Set<object>): Redaction => {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return { value: "[REDACTED]", redacted: true };
    seen.add(value);
    let redacted = false;
    const items = value.map((entry) => {
      const result = redactValue(entry, seen);
      redacted = redacted || result.redacted;
      return result.value;
    });
    seen.delete(value);
    return { value: items, redacted };
  }
  if (!isRecord(value)) return { value, redacted: false };
  if (seen.has(value)) return { value: "[REDACTED]", redacted: true };
  seen.add(value);
  let redacted = false;
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const safeKey = redactString(key);
    const safeValue = redactValue(entry, seen);
    redacted = redacted || safeKey.redacted || safeValue.redacted;
    record[String(safeKey.value)] = safeValue.value;
  }
  seen.delete(value);
  return { value: record, redacted };
};

export const redactCodexPayload = (payload: unknown): RedactedPayload => {
  const walked = redactValue(payload, new Set<object>());
  let serialized: string | null;
  try {
    serialized = walked.value === null || walked.value === undefined
      ? null
      : typeof walked.value === "string"
        ? walked.value
        : JSON.stringify(walked.value) ?? null;
  } catch {
    serialized = null;
  }

  let redacted = walked.redacted || serialized === null;
  if (serialized !== null && serialized.length > BOUNDED_PAYLOAD_MAX_CHARS) {
    serialized = serialized.slice(0, BOUNDED_PAYLOAD_MAX_CHARS);
    redacted = true;
  }
  return {
    payload: serialized,
    redaction_state: redacted ? "redacted" : "none"
  };
};
