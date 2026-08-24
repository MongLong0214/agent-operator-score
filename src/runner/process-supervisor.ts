/**
 * Termination of a runtime child, and the bounded capture of what it printed.
 *
 * The child runs in its own process group so a signal reaches everything it started. A runtime that
 * spawns a shell which spawns a compiler leaves orphans if only the direct child is signalled, and
 * those orphans keep writing into the workspace after the run is declared over — which makes the
 * recorded final state describe a moment that never existed.
 *
 * The ladder and the capture are separated from spawning so both can be tested without starting a
 * real process: the parts that decide are pure, and only the part that signals is not.
 */

export type Signal = "SIGTERM" | "SIGKILL";

export interface TerminationStep {
  readonly signal: Signal;
  /** How long to wait for the group to exit before checking again. */
  readonly graceMs: number;
}

/** PRD 13.1: SIGTERM, wait 5s, check, SIGKILL, wait 2s, check, and a survivor is INVALID. */
export const TERMINATION_LADDER: readonly TerminationStep[] = Object.freeze([
  Object.freeze({ signal: "SIGTERM" as const, graceMs: 5_000 }),
  Object.freeze({ signal: "SIGKILL" as const, graceMs: 2_000 })
]);

export type TerminationOutcome =
  | { readonly kind: "exited"; readonly afterSignal: Signal | null }
  | { readonly kind: "survived" };

export interface TerminationIo {
  /** Signals the whole process group. */
  readonly signalGroup: (signal: Signal) => void;
  /** Whether any member of the group is still alive. */
  readonly groupAlive: () => boolean;
  readonly wait: (ms: number) => Promise<void>;
}

/**
 * Walks the ladder. Liveness is re-checked after every wait, including after SIGKILL: a group that
 * survives SIGKILL is a real state — an uninterruptible wait in the kernel — and reporting it is the
 * only way the run can be marked INVALID instead of silently accepted.
 */
export const terminateGroup = async (io: TerminationIo): Promise<TerminationOutcome> => {
  if (!io.groupAlive()) return { kind: "exited", afterSignal: null };
  for (const step of TERMINATION_LADDER) {
    io.signalGroup(step.signal);
    await io.wait(step.graceMs);
    if (!io.groupAlive()) return { kind: "exited", afterSignal: step.signal };
  }
  return { kind: "survived" };
};

/**
 * Largest prefix of `text` that fits in `limit` bytes without splitting a character.
 *
 * Cutting the buffer at an arbitrary byte and decoding produces a replacement character in place of
 * the partial one, and U+FFFD is three bytes — so a naive slice can come back *longer* than the
 * limit it was meant to enforce, which is a bounded buffer that is not bounded. Walking back off
 * the continuation bytes (0b10xxxxxx) lands on a character boundary.
 */
const sliceUtf8 = (text: string, limit: number): string => {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= limit) return text;
  let end = limit;
  // Parenthesised deliberately: `buffer[end] as number & 0xc0` parses the mask as a TYPE
  // intersection, not a bitwise and, so the guard silently compared the whole byte.
  while (end > 0 && ((buffer[end] as number) & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
};

export const DEFAULT_STREAM_CAP_BYTES = 10 * 1024 * 1024;
export const MAX_TRANSPORT_LINE_BYTES = 64 * 1024;
export const TRUNCATION_MARKER = "\n[aos] output truncated at cap\n";

export interface BoundedSink {
  readonly write: (chunk: string) => void;
  readonly text: () => string;
  readonly truncated: () => boolean;
  readonly bytes: () => number;
}

/**
 * Consumes a stream immediately and keeps at most `capBytes`. The whole log is never held in
 * memory: a runtime that prints in a loop would otherwise decide how much memory this process uses,
 * and the run would die as an out-of-memory crash rather than as a recorded stall.
 *
 * The tail is dropped rather than the head. The beginning of a runtime's output says what it tried
 * to do; the end is usually the same line repeating.
 */
export const createBoundedSink = (capBytes: number = DEFAULT_STREAM_CAP_BYTES): BoundedSink => {
  const parts: string[] = [];
  let bytes = 0;
  let truncated = false;

  return Object.freeze({
    write: (chunk: string): void => {
      if (truncated) return;
      const size = Buffer.byteLength(chunk, "utf8");
      if (bytes + size <= capBytes) {
        parts.push(chunk);
        bytes += size;
        return;
      }
      const room = capBytes - bytes;
      if (room > 0) {
        const slice = sliceUtf8(chunk, room);
        if (slice.length > 0) {
          parts.push(slice);
          bytes += Buffer.byteLength(slice, "utf8");
        }
      }
      parts.push(TRUNCATION_MARKER);
      truncated = true;
    },
    text: () => parts.join(""),
    truncated: () => truncated,
    bytes: () => bytes
  });
};

export type TransportLine =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * A JSON transport line from the runtime. Over the cap it is invalid rather than truncated:
 * a truncated JSON line either fails to parse or, worse, parses into something different from what
 * was sent, and a record that parses into the wrong thing is undetectable downstream.
 */
export const parseTransportLine = (line: string): TransportLine => {
  const size = Buffer.byteLength(line, "utf8");
  if (size > MAX_TRANSPORT_LINE_BYTES) {
    return { ok: false, reason: `transport line is ${size} bytes, over the ${MAX_TRANSPORT_LINE_BYTES} cap` };
  }
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false, reason: "transport line is not valid JSON" };
  }
};

export type SignalDisposition = "graceful_cancel" | "immediate_kill";

/**
 * The CLI's own signal policy: the first interrupt cancels gracefully so a terminal state can still
 * be recorded, the second kills immediately. Without the second, a user who cannot get out has to
 * kill the process from outside, which is the one path that leaves no terminal state at all.
 */
export const createSignalPolicy = (): { readonly onSignal: () => SignalDisposition } => {
  let seen = 0;
  return Object.freeze({
    onSignal: (): SignalDisposition => {
      seen += 1;
      return seen === 1 ? "graceful_cancel" : "immediate_kill";
    }
  });
};
