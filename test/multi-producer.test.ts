import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SCHEMA_ID,
  SCHEMA_VERSION,
  isScorable,
  orderEvents,
  traceDigest,
  type MultiProducerEvent
} from "../src/trace/multi-producer.ts";

const event = (over: Partial<MultiProducerEvent> = {}): MultiProducerEvent => ({
  schema_id: SCHEMA_ID,
  schema_version: SCHEMA_VERSION,
  event_id: "e1",
  session_id: "s1",
  producer_id: "p1",
  producer_seq: 1,
  actor_kind: "agent",
  agent_instance_id: "claude-01",
  agent_profile_id: "claude-main",
  collaboration_surface_id: null,
  workstream_id: null,
  task_id: null,
  event_type: "tool.call",
  event_group: "tool_call",
  parent_event_id: null,
  correlation_id: "c1",
  handoff_id: null,
  source_timestamp: null,
  observed_at: "1970-01-01T00:00:00.000Z",
  identity_digest: null,
  evidence_digest: null,
  redaction_state: "none",
  payload: null,
  ...over
});

/** Two producers, three events each, interleaved causally through one handoff. */
const session = (): MultiProducerEvent[] => [
  event({ event_id: "a1", producer_id: "p-alpha", producer_seq: 1 }),
  event({ event_id: "a2", producer_id: "p-alpha", producer_seq: 2, parent_event_id: "a1" }),
  event({ event_id: "b1", producer_id: "p-beta", producer_seq: 1, parent_event_id: "a2", handoff_id: "h1" }),
  event({ event_id: "b2", producer_id: "p-beta", producer_seq: 2, parent_event_id: "b1" }),
  event({ event_id: "a3", producer_id: "p-alpha", producer_seq: 3, parent_event_id: "a2" })
];

const shuffle = <T,>(items: readonly T[], seed: number): T[] => {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

describe("producer arrival-order independence", () => {
  test("the same events in any arrival order produce byte-identical traces", () => {
    // This is the property that lets a session be assembled from files that arrived in any order,
    // from producers that connected in any order.
    const baseline = orderEvents(session());
    const baselineDigest = traceDigest(baseline);
    for (let seed = 1; seed <= 25; seed += 1) {
      const shuffled = orderEvents(shuffle(session(), seed));
      assert.equal(traceDigest(shuffled), baselineDigest, `arrival order ${seed} produced a different trace`);
      assert.deepEqual(
        shuffled.events.map((e) => e.event_id),
        baseline.events.map((e) => e.event_id)
      );
    }
  });
});

describe("pool-order independence", () => {
  test("renaming which producer is listed first does not change the causal order", () => {
    const ordered = orderEvents(session()).events.map((e) => e.event_id);
    // The causal chain a1 -> a2 -> b1 -> b2 must hold regardless of how producers sort.
    const position = (id: string): number => ordered.indexOf(id);
    assert.ok(position("a1") < position("a2"), ordered.join(","));
    assert.ok(position("a2") < position("b1"), ordered.join(","));
    assert.ok(position("b1") < position("b2"), ordered.join(","));
  });

  test("a producer never sorts before its own earlier sequence", () => {
    const ordered = orderEvents(shuffle(session(), 7)).events;
    const seqByProducer = new Map<string, number>();
    for (const e of ordered) {
      const last = seqByProducer.get(e.producer_id) ?? 0;
      assert.ok(e.producer_seq > last, `${e.producer_id} went ${last} -> ${e.producer_seq}`);
      seqByProducer.set(e.producer_id, e.producer_seq);
    }
  });
});

describe("clock-skew independence", () => {
  test("timestamps do not affect the order at all", () => {
    // Two agents on two machines cannot be ordered by their clocks. Skew of a few seconds would
    // reorder a handoff against the work it handed off, and the scorer would read a correct session
    // as one where a result was adopted before it existed.
    const skewed = session().map((e, index) =>
      event({
        ...e,
        // Deliberately reversed: the causally-last event claims the earliest wall clock.
        observed_at: new Date(1_000_000 - index * 60_000).toISOString(),
        source_timestamp: new Date(2_000_000 - index * 60_000).toISOString()
      })
    );
    const withSkew = orderEvents(skewed).events.map((e) => e.event_id);
    const withoutSkew = orderEvents(session()).events.map((e) => e.event_id);
    assert.deepEqual(withSkew, withoutSkew, "a clock changed the canonical order");
  });
});

describe("duplicate handling", () => {
  test("a byte-identical duplicate is collapsed, not counted twice", () => {
    // A relay replaying after a reconnect is normal. Counting it twice doubles every metric built
    // on event counts.
    const withReplay = [...session(), ...session().slice(0, 2)];
    const ordered = orderEvents(withReplay);
    assert.equal(ordered.deduplicated, 2);
    assert.equal(ordered.events.length, 5);
    assert.equal(isScorable(ordered), true);
    assert.equal(traceDigest(ordered), traceDigest(orderEvents(session())));
  });

  test("the same event_id with different bytes invalidates the trace", () => {
    // Two producers asserting different things under one id: no downstream care can decide which
    // to believe, so the trace is refused rather than resolved.
    const conflicting = [...session(), event({ event_id: "a1", producer_id: "p-alpha", producer_seq: 1, event_type: "tool.result" })];
    const ordered = orderEvents(conflicting);
    assert.equal(ordered.problems.some((p) => p.kind === "CONFLICTING_DUPLICATE"), true);
    assert.equal(isScorable(ordered), false);
  });
});

describe("sequence integrity", () => {
  test("a gap is recorded as missing evidence, not as corruption", () => {
    // A producer reconnected and some events are simply not here. That is an availability fact.
    const gapped = [
      event({ event_id: "g1", producer_id: "p", producer_seq: 1 }),
      event({ event_id: "g3", producer_id: "p", producer_seq: 3 })
    ];
    const ordered = orderEvents(gapped);
    const gap = ordered.problems.find((p) => p.kind === "SEQUENCE_GAP");
    assert.ok(gap, JSON.stringify(ordered.problems));
    assert.match(gap.detail, /1 -> 3/);
    assert.equal(isScorable(ordered), true, "a gap must not by itself make a trace unscorable");
  });

  test("a rewind invalidates, because it asserts two events at one position", () => {
    const rewound = [
      event({ event_id: "r1", producer_id: "p", producer_seq: 1 }),
      event({ event_id: "r2", producer_id: "p", producer_seq: 1, event_type: "tool.result" })
    ];
    const ordered = orderEvents(rewound);
    assert.equal(ordered.problems.some((p) => p.kind === "SEQUENCE_REWIND"), true);
    assert.equal(isScorable(ordered), false);
  });

  test("a producer sequence that does not start at 1 is reported", () => {
    const ordered = orderEvents([event({ event_id: "x", producer_id: "p", producer_seq: 4 })]);
    assert.equal(ordered.problems.some((p) => p.kind === "SEQUENCE_START"), true);
  });
});

describe("causal graph", () => {
  test("a cycle is refused rather than ordered arbitrarily", () => {
    const cyclic = [
      event({ event_id: "c1", producer_id: "p", producer_seq: 1, parent_event_id: "c2" }),
      event({ event_id: "c2", producer_id: "p", producer_seq: 2, parent_event_id: "c1" })
    ];
    const ordered = orderEvents(cyclic);
    assert.equal(ordered.problems.some((p) => p.kind === "CAUSAL_CYCLE"), true);
    assert.equal(isScorable(ordered), false);
  });

  test("a parent outside the trace is a missing edge, not a cycle", () => {
    // These are different facts: one producer's events are absent, versus the graph contradicting
    // itself. Reporting the first as the second would send an operator looking for corruption.
    const ordered = orderEvents([event({ event_id: "o1", producer_id: "p", producer_seq: 1, parent_event_id: "not-here" })]);
    assert.equal(ordered.problems.some((p) => p.kind === "MISSING_PARENT"), true);
    assert.equal(ordered.problems.some((p) => p.kind === "CAUSAL_CYCLE"), false);
  });

  test("an event never sorts before its declared parent, even when the tie-break disagrees", () => {
    // The parent lives on the producer that sorts LAST alphabetically. Without causal-depth
    // ordering the tie-break alone would place the child first and the trace would say a result was
    // adopted before the work that produced it. An earlier version of this case put the parent on
    // the alphabetically-first producer, so it passed against a build with depth ordering deleted.
    const chain = [
      event({ event_id: "child", producer_id: "p-alpha", producer_seq: 1, parent_event_id: "parent" }),
      event({ event_id: "parent", producer_id: "p-zulu", producer_seq: 1 })
    ];
    const ordered = orderEvents(chain).events.map((e) => e.event_id);
    assert.deepEqual(ordered, ["parent", "child"], ordered.join(","));
  });

  test("a grandchild sorts after its grandparent across three producers", () => {
    const chain = [
      event({ event_id: "g3", producer_id: "p-a", producer_seq: 1, parent_event_id: "g2" }),
      event({ event_id: "g2", producer_id: "p-m", producer_seq: 1, parent_event_id: "g1" }),
      event({ event_id: "g1", producer_id: "p-z", producer_seq: 1 })
    ];
    const ordered = orderEvents(chain).events.map((e) => e.event_id);
    assert.deepEqual(ordered, ["g1", "g2", "g3"], ordered.join(","));
  });
});
