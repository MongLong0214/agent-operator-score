import { canonicalJson, type JsonValue } from "../core/canonical-json.ts";
import { sha256Text } from "../core/digest.ts";

/**
 * Canonical ordering for a session whose events come from several producers at once.
 *
 * Wall-clock time is diagnostic, never causal truth. Two agents on two machines cannot be ordered
 * by their clocks — skew of a few seconds would reorder a handoff against the work it handed off,
 * and the scorer would then read a correct session as one where results were adopted before they
 * existed. So ordering rests on what each producer can actually know: its own sequence, and the
 * causal edges it declares.
 *
 * The order is:
 *   1. causal depth — an event never sorts before its declared parent
 *   2. producer-local sequence
 *   3. a stable deterministic tie-break on producer id, then event id
 *
 * Step 3 exists because two producers are genuinely concurrent: nothing observed which came first,
 * so the answer must at least be the *same* every time, or a trace digest means nothing.
 */

export const SCHEMA_ID = "aos-event";
export const SCHEMA_VERSION = "aos-event.v1";

export type ActorKind = "operator" | "agent" | "system" | "external";
export type RedactionState = "none" | "projected" | "dropped";

export interface MultiProducerEvent {
  readonly schema_id: typeof SCHEMA_ID;
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly event_id: string;
  readonly session_id: string;
  readonly producer_id: string;
  readonly producer_seq: number;
  readonly actor_kind: ActorKind;
  readonly agent_instance_id: string | null;
  readonly agent_profile_id: string | null;
  readonly collaboration_surface_id: string | null;
  readonly workstream_id: string | null;
  readonly task_id: string | null;
  readonly event_type: string;
  readonly event_group: string;
  readonly parent_event_id: string | null;
  readonly correlation_id: string;
  readonly handoff_id: string | null;
  /** Diagnostic only. Never consulted for ordering. */
  readonly source_timestamp: string | null;
  /** Diagnostic only. Never consulted for ordering. */
  readonly observed_at: string;
  readonly identity_digest: string | null;
  readonly evidence_digest: string | null;
  readonly redaction_state: RedactionState;
  readonly payload: Readonly<Record<string, unknown>> | null;
}

export type ProblemKind =
  | "CONFLICTING_DUPLICATE"
  | "SEQUENCE_REWIND"
  | "SEQUENCE_GAP"
  | "CAUSAL_CYCLE"
  | "MISSING_PARENT"
  | "SEQUENCE_START";

export interface OrderProblem {
  readonly kind: ProblemKind;
  readonly producer_id: string | null;
  readonly event_id: string | null;
  readonly detail: string;
}

export interface OrderedTrace {
  readonly events: readonly MultiProducerEvent[];
  readonly problems: readonly OrderProblem[];
  /** Duplicates that were byte-identical and therefore safely collapsed. */
  readonly deduplicated: number;
}

/** The bytes an event is identified by. Excludes nothing: two events that differ anywhere differ. */
const bytesOf = (event: MultiProducerEvent): string => canonicalJson(event as unknown as JsonValue);

/**
 * Whether a problem makes the trace unusable rather than merely incomplete.
 *
 * A sequence gap is an availability fact — a producer reconnected and some events are simply not
 * here — and the PRD records it as UNAVAILABLE evidence rather than as corruption. A rewind, a
 * conflicting duplicate or a causal cycle are different: each means the trace asserts two
 * incompatible things, and no amount of care downstream can decide which to believe.
 */
export const isFatal = (problem: OrderProblem): boolean =>
  problem.kind !== "SEQUENCE_GAP";

export const isScorable = (trace: OrderedTrace): boolean => !trace.problems.some(isFatal);

interface Prepared {
  readonly event: MultiProducerEvent;
  readonly bytes: string;
}

const causalDepth = (
  event: MultiProducerEvent,
  byId: ReadonlyMap<string, MultiProducerEvent>,
  cache: Map<string, number | "cycle">
): number | "cycle" => {
  const seen = new Set<string>();
  let depth = 0;
  let current: MultiProducerEvent | undefined = event;
  // Bounded by the trace size as well as by `seen`. A cycle guard that is the only thing standing
  // between this walk and an infinite loop turns a missing check into a hang rather than a wrong
  // answer, and a hang is the one failure a caller cannot report.
  let steps = 0;
  const ceiling = byId.size + 1;

  while (current !== undefined && current.parent_event_id !== null) {
    steps += 1;
    if (steps > ceiling) return "cycle";
    const cached = cache.get(current.event_id);
    if (cached !== undefined) return cached === "cycle" ? "cycle" : cached + depth;
    if (seen.has(current.event_id)) return "cycle";
    seen.add(current.event_id);
    const parent = byId.get(current.parent_event_id);
    // A parent outside this trace is not a cycle: it is an edge to something not present, which is
    // reported separately so a missing producer is not mistaken for a corrupt graph.
    if (parent === undefined) break;
    depth += 1;
    current = parent;
  }
  return depth;
};

/**
 * Collapses byte-identical duplicates, refuses conflicting ones, checks each producer's sequence,
 * and returns one deterministic order.
 *
 * Input order is not consulted anywhere. That is the property that makes a trace assembled from
 * files arriving in any order, from producers connecting in any order, byte-identical every time.
 */
export const orderEvents = (input: readonly MultiProducerEvent[]): OrderedTrace => {
  const problems: OrderProblem[] = [];
  const byId = new Map<string, Prepared>();
  let deduplicated = 0;

  for (const event of input) {
    const bytes = bytesOf(event);
    const existing = byId.get(event.event_id);
    if (existing === undefined) {
      byId.set(event.event_id, { event, bytes });
      continue;
    }
    if (existing.bytes === bytes) {
      // The same event delivered twice. A relay that replays after a reconnect is normal, and
      // counting it twice would double every metric built on event counts.
      deduplicated += 1;
      continue;
    }
    problems.push({
      kind: "CONFLICTING_DUPLICATE",
      producer_id: event.producer_id,
      event_id: event.event_id,
      detail: "the same event_id was delivered with different bytes"
    });
  }

  const events = [...byId.values()].map((prepared) => prepared.event);
  const eventById = new Map(events.map((event) => [event.event_id, event]));

  // Per-producer sequence checks. Sorting by sequence first means the checks see the producer's
  // own order, not the order the events happened to arrive in.
  const byProducer = new Map<string, MultiProducerEvent[]>();
  for (const event of events) {
    const list = byProducer.get(event.producer_id);
    if (list === undefined) byProducer.set(event.producer_id, [event]);
    else list.push(event);
  }
  for (const [producerId, list] of byProducer) {
    list.sort((left, right) => left.producer_seq - right.producer_seq);
    const first = list[0] as MultiProducerEvent;
    if (first.producer_seq !== 1) {
      problems.push({
        kind: "SEQUENCE_START",
        producer_id: producerId,
        event_id: first.event_id,
        detail: `producer sequence starts at ${first.producer_seq}, not 1`
      });
    }
    for (let i = 1; i < list.length; i += 1) {
      const previous = list[i - 1] as MultiProducerEvent;
      const current = list[i] as MultiProducerEvent;
      if (current.producer_seq === previous.producer_seq) {
        problems.push({
          kind: "SEQUENCE_REWIND",
          producer_id: producerId,
          event_id: current.event_id,
          detail: `two distinct events share producer_seq ${current.producer_seq}`
        });
        continue;
      }
      if (current.producer_seq > previous.producer_seq + 1) {
        problems.push({
          kind: "SEQUENCE_GAP",
          producer_id: producerId,
          event_id: current.event_id,
          detail: `producer_seq jumps ${previous.producer_seq} -> ${current.producer_seq}`
        });
      }
    }
  }

  const depthCache = new Map<string, number | "cycle">();
  const depths = new Map<string, number>();
  for (const event of events) {
    const depth = causalDepth(event, eventById, depthCache);
    if (depth === "cycle") {
      problems.push({
        kind: "CAUSAL_CYCLE",
        producer_id: event.producer_id,
        event_id: event.event_id,
        detail: "the causal parent chain returns to this event"
      });
      depths.set(event.event_id, 0);
      continue;
    }
    depths.set(event.event_id, depth);
    if (event.parent_event_id !== null && !eventById.has(event.parent_event_id)) {
      problems.push({
        kind: "MISSING_PARENT",
        producer_id: event.producer_id,
        event_id: event.event_id,
        detail: `parent ${event.parent_event_id} is not present in this trace`
      });
    }
  }

  const ordered = [...events].sort((left, right) => {
    const depthDelta = (depths.get(left.event_id) ?? 0) - (depths.get(right.event_id) ?? 0);
    if (depthDelta !== 0) return depthDelta;
    if (left.producer_id === right.producer_id) return left.producer_seq - right.producer_seq;
    // Genuinely concurrent. Nothing observed which came first, so the answer only has to be the
    // same every time: producer id, then event id, both of which every producer already agrees on.
    if (left.producer_id !== right.producer_id) return left.producer_id < right.producer_id ? -1 : 1;
    return left.event_id < right.event_id ? -1 : 1;
  });

  return {
    events: Object.freeze(ordered),
    problems: Object.freeze(problems),
    deduplicated
  };
};

/** Digest of the canonical ordering. Equal digests mean equal traces, whatever the arrival order. */
export const traceDigest = (trace: OrderedTrace): string =>
  sha256Text(trace.events.map((event) => bytesOf(event)).join("\n"));
