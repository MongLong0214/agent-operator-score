import { sha256Text } from "../core/digest.ts";

/**
 * Privacy projection: what a canonical event is allowed to carry.
 *
 * The primary control is that raw text is never stored. Pattern matching is secondary and exists
 * only to catch a secret that reached an allowlisted *shape* — a path or a tool name that happens
 * to contain a token. Passing the patterns never earns permission to keep raw content, because a
 * detector that has to enumerate what a secret looks like will always be behind the secrets.
 *
 * So: payload defaults to null, each event type declares the few metadata fields it may keep, and
 * anything not on that list is gone before this module returns.
 */

export type RedactionState = "none" | "redacted" | "dropped";

export interface Projection {
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly redaction: RedactionState;
  /** Which allowlisted fields were removed. Named so an operator can see what was lost and why. */
  readonly removed: readonly string[];
}

/** Per-event allowlists. A field absent here cannot be stored, whatever it contains. */
export const PAYLOAD_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "approval.denied": Object.freeze(["action_class", "decision"]),
  "approval.granted": Object.freeze(["action_class", "decision"]),
  "approval.requested": Object.freeze(["action_class", "decision"]),
  "context.compacted": Object.freeze(["item_count", "before_digest", "after_digest"]),
  "context.injected": Object.freeze(["item_count", "digests"]),
  "context.selected": Object.freeze(["item_count", "digests"]),
  "evidence.created": Object.freeze(["evidence_digest"]),
  "evidence.invalidated": Object.freeze(["evidence_digest"]),
  "memory.read": Object.freeze(["item_count", "digests"]),
  "memory.written": Object.freeze(["item_count", "digests"]),
  "retrieval.query": Object.freeze(["query_digest", "result_count"]),
  "retrieval.result": Object.freeze(["result_count", "digests"]),
  "tool.call": Object.freeze(["tool_name", "target_path", "argument_count", "input_digest"]),
  "tool.error": Object.freeze(["tool_name", "error_class"]),
  "tool.result": Object.freeze(["success", "byte_count", "output_digest"]),
  "user.clarification": Object.freeze(["character_count", "instruction_digest"]),
  "user.instruction": Object.freeze(["character_count", "instruction_digest"]),
  "workspace.external_mutation": Object.freeze(["target_path", "before_digest", "after_digest"])
});

export const MAX_NESTING = 32;
export const MAX_VALUES = 10_000;

/**
 * Secondary detectors. Deliberately not exhaustive — the comment above says why that is acceptable
 * here and would not be if raw text were storable.
 */
const SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{16,}\b/,                       // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,                   // Anthropic-style
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,                  // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/,                            // AWS access key id
  /\bBearer\s+[A-Za-z0-9._-]{16,}/i,                 // bearer token
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/,               // private key header
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i,    // credentials in a database URL
  /AOS_SECRET_CANARY/,                             // fixed canary, from specs/events.v0.json
  /<\s*(?:thinking|antml:thinking|reasoning)\s*>/i   // hidden reasoning marker
]);

export const looksSecret = (text: string): boolean =>
  SECRET_PATTERNS.some((pattern) => pattern.test(text));

const DROPPED: Projection = Object.freeze({ payload: null, redaction: "dropped", removed: Object.freeze([]) });

/**
 * Walks a value without running anything the value controls: no getters, no `toJSON`, no `toString`.
 * A payload that cannot be inspected under those rules is dropped rather than guessed at, because
 * the alternative is executing attacker-influenced code to decide whether it is safe to store.
 */
export type RefusalReason = "none" | "depth" | "budget" | "cycle" | "accessor" | "exotic" | "serializer" | "type";

const inspect = (
  value: unknown,
  depth: number,
  budget: { count: number },
  seen: WeakSet<object>
): RefusalReason => {
  if (depth > MAX_NESTING) return "depth";
  budget.count += 1;
  if (budget.count > MAX_VALUES) return "budget";

  if (value === null) return "none";
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return "none";
  if (kind !== "object") return "type";

  const object = value as object;
  if (seen.has(object)) return "cycle";
  seen.add(object);

  // A Proxy, an exotic object, or anything with a custom serializer is refused: descriptor
  // inspection is the only way to look without triggering behaviour, and if that is not available
  // the safe answer is to store nothing.
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return "exotic";
  // Own properties only: `in` walks the prototype chain, and every plain object inherits
  // toString, so testing with `in` here rejected every payload and stored nothing at all.
  if (Object.hasOwn(object, "toJSON") || Object.hasOwn(object, "toString")) return "serializer";

  for (const key of Reflect.ownKeys(object)) {
    if (typeof key !== "string") return "exotic";
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor === undefined) return "exotic";
    // Checked before the value is read. An accessor carries no `value`, so relying on the recursive
    // call to refuse it would report the wrong reason and would stop holding the moment anything
    // else about undefined changed.
    if (descriptor.get !== undefined || descriptor.set !== undefined) return "accessor";
    const nested = inspect(descriptor.value, depth + 1, budget, seen);
    if (nested !== "none") return nested;
  }
  return "none";
};

export const refusalReason = (value: unknown): RefusalReason =>
  inspect(value, 0, { count: 0 }, new WeakSet());

/** Keys are inspected as well as values: a key is just as good a channel for smuggling a secret. */
const containsSecret = (value: unknown): boolean => {
  if (typeof value === "string") return looksSecret(value);
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) => looksSecret(key) || containsSecret(entry)
    );
  }
  return false;
};

export const projectPayload = (eventType: string, raw: unknown): Projection => {
  const allowed = PAYLOAD_ALLOWLIST[eventType];
  // An event type with no allowlist keeps nothing. New event types are silent by default rather
  // than permissive by default.
  if (allowed === undefined) return DROPPED;
  if (raw === null || raw === undefined) {
    return Object.freeze({ payload: null, redaction: "none", removed: Object.freeze([]) });
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return DROPPED;
  if (refusalReason(raw) !== "none") return DROPPED;

  const source = raw as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  const removed: string[] = [];

  for (const field of allowed) {
    if (!Object.hasOwn(source, field)) continue;
    const value = source[field];
    if (containsSecret(value) || looksSecret(field)) {
      removed.push(field);
      continue;
    }
    kept[field] = value;
  }
  // Anything the event carried that is not allowlisted was never a candidate; it is reported as
  // removed so the count an operator sees matches what actually happened to their data.
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) removed.push(key);
  }

  if (Object.keys(kept).length === 0) {
    return Object.freeze({ payload: null, redaction: removed.length > 0 ? "dropped" : "none", removed: Object.freeze(removed.sort()) });
  }
  return Object.freeze({
    payload: Object.freeze(kept),
    redaction: removed.length > 0 ? "redacted" : "none",
    removed: Object.freeze(removed.sort())
  });
};

/** Digest helper for callers replacing raw content with a reference to it. */
export const contentDigest = (text: string): string => sha256Text(text);
