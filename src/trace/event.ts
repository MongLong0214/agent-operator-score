import { readFileSync } from "node:fs";

import { projectPayload, type RedactionState } from "./privacy-projection.ts";

/**
 * The canonical event vocabulary, read from `specs/events.v0.json` rather than restated here.
 *
 * Restating it would create two lists that drift: the contract would say 42 events and the code
 * would enforce whatever was last typed. The contract is the authority; this module is the
 * executable reading of it.
 */

interface EventContract {
  readonly contract_id: string;
  readonly contract_version: string;
  readonly bounded_payload_max_chars: number;
  readonly secret_canary: string;
  readonly events: readonly { readonly event_type: string; readonly event_group: string; readonly ordinal: number }[];
}

const contractUrl = new URL("../../specs/events.v0.json", import.meta.url);

const loadContract = (): EventContract => {
  const parsed: unknown = JSON.parse(readFileSync(contractUrl, "utf8"));
  const contract = parsed as EventContract;
  if (!Array.isArray(contract.events) || contract.events.length === 0) {
    throw new Error("AOS_TRACE_INVALID specs/events.v0.json declares no events");
  }
  return contract;
};

const CONTRACT = loadContract();

export const EVENT_TYPES: readonly string[] = Object.freeze(
  CONTRACT.events.map((event) => event.event_type)
);

export const EVENT_GROUP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CONTRACT.events.map((event) => [event.event_type, event.event_group]))
);

export const BOUNDED_PAYLOAD_MAX_CHARS = CONTRACT.bounded_payload_max_chars;
export const SECRET_CANARY = CONTRACT.secret_canary;

export const isEventType = (value: unknown): value is string =>
  typeof value === "string" && Object.hasOwn(EVENT_GROUP, value);

export interface CanonicalEvent {
  readonly seq: number;
  /** Monotonic milliseconds since the run started. Wall-clock is not recorded: it is not needed to
   *  order or measure anything here, and it identifies when a person was working. */
  readonly elapsed_ms: number;
  readonly event_type: string;
  readonly event_group: string;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly redaction: RedactionState;
  readonly removed: readonly string[];
}

export interface RawEvent {
  readonly seq: number;
  readonly elapsed_ms: number;
  readonly event_type: string;
  readonly payload?: unknown;
}

export type EventResult =
  | { readonly ok: true; readonly event: CanonicalEvent }
  | { readonly ok: false; readonly reason: string };

/**
 * Builds a canonical event, projecting the payload on the way in. Projection happens here rather
 * than at the writer so an unprojected payload has no path to disk at all: a caller that forgot to
 * project cannot exist, because there is no way to construct an event without it.
 */
export const canonicalizeEvent = (raw: RawEvent): EventResult => {
  if (!Number.isInteger(raw.seq) || raw.seq < 1) {
    return { ok: false, reason: `seq must be a positive integer, got ${String(raw.seq)}` };
  }
  if (!Number.isFinite(raw.elapsed_ms) || raw.elapsed_ms < 0) {
    return { ok: false, reason: `elapsed_ms must be a non-negative number, got ${String(raw.elapsed_ms)}` };
  }
  if (!isEventType(raw.event_type)) {
    // An unknown type is refused rather than passed through as an opaque record: the scorer counts
    // events by type, and a type nothing declares would be counted as nothing while looking present.
    return { ok: false, reason: `${String(raw.event_type)} is not a declared event type` };
  }
  const projection = projectPayload(raw.event_type, raw.payload ?? null);
  return {
    ok: true,
    event: Object.freeze({
      seq: raw.seq,
      elapsed_ms: raw.elapsed_ms,
      event_type: raw.event_type,
      event_group: EVENT_GROUP[raw.event_type] as string,
      payload: projection.payload,
      redaction: projection.redaction,
      removed: projection.removed
    })
  };
};
