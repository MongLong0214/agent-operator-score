import { canonicalJson, type JsonValue } from "../core/canonical-json.ts";
import { appendNdjsonLine } from "../storage/atomic-file.ts";

import { canonicalizeEvent, type CanonicalEvent, type RawEvent } from "./event.ts";

/**
 * Appends canonical events to a run's NDJSON trace.
 *
 * Sequence numbers are assigned here, not accepted from the caller. A caller that assigns its own
 * can repeat or skip one, and the scorer reads gaps as evidence about the run rather than as a bug
 * in whoever wrote the file — an off-by-one in an adapter would become a finding about the operator.
 *
 * The writer refuses out-of-order elapsed times for the same reason: a trace whose clock goes
 * backwards cannot be measured for stalls or latency, and silently sorting it would invent an order
 * nothing observed.
 */

export interface TraceWriter {
  readonly append: (raw: Omit<RawEvent, "seq">) => { readonly ok: true; readonly event: CanonicalEvent } | { readonly ok: false; readonly reason: string };
  readonly count: () => number;
  readonly lastElapsedMs: () => number;
}

export const createTraceWriter = (
  path: string,
  sink: (line: string) => void = (line) => appendNdjsonLine(path, line)
): TraceWriter => {
  let seq = 0;
  let lastElapsed = 0;

  return Object.freeze({
    append: (raw: Omit<RawEvent, "seq">) => {
      if (raw.elapsed_ms < lastElapsed) {
        return {
          ok: false as const,
          reason: `elapsed_ms went backwards: ${raw.elapsed_ms} after ${lastElapsed}`
        };
      }
      const next = seq + 1;
      const result = canonicalizeEvent({ ...raw, seq: next });
      if (!result.ok) return result;

      // Canonical JSON so a trace written twice from the same events is byte-identical, which is
      // what makes a trace digest mean anything.
      sink(canonicalJson(result.event as unknown as JsonValue));
      seq = next;
      lastElapsed = raw.elapsed_ms;
      return result;
    },
    count: () => seq,
    lastElapsedMs: () => lastElapsed
  });
};

export interface ParsedTrace {
  readonly events: readonly CanonicalEvent[];
  readonly problems: readonly string[];
}

/**
 * Reads a trace back. A malformed line is reported rather than skipped: skipping would shorten the
 * event count that the scorer's denominators are built from, which turns a corrupt file into a
 * quietly different score instead of a refusal.
 */
export const parseTrace = (text: string): ParsedTrace => {
  const events: CanonicalEvent[] = [];
  const problems: string[] = [];
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    if (line.length === 0) {
      // Only a trailing newline is acceptable; a blank line in the middle means a truncated write.
      if (index !== lines.length - 1) problems.push(`line ${index + 1} is empty`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`line ${index + 1} is not valid JSON`);
      return;
    }
    const record = parsed as CanonicalEvent;
    if (record.seq !== events.length + 1) {
      problems.push(`line ${index + 1} carries seq ${String(record.seq)}, expected ${events.length + 1}`);
      return;
    }
    events.push(record);
  });

  return { events: Object.freeze(events), problems: Object.freeze(problems) };
};

/**
 * Whether a parsed trace may be scored.
 *
 * Parsing continues past a malformed line so the caller can see the full extent of the damage
 * rather than only the first break. That means `events` can be non-empty for a file that is not
 * trustworthy, so the decision is stated here instead of left to each caller remembering to check
 * `problems` — a trace with any problem is not scorable, because the events it lost are exactly
 * the ones the denominators would have counted.
 */
export const isScorable = (parsed: ParsedTrace): boolean => parsed.problems.length === 0;
