import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  BOUNDED_PAYLOAD_MAX_CHARS,
  EVENT_GROUP,
  EVENT_TYPES,
  SECRET_CANARY,
  canonicalizeEvent,
  isEventType
} from "../src/trace/event.ts";
import { createTraceWriter, isScorable, parseTrace } from "../src/trace/writer.ts";

const contract = JSON.parse(
  readFileSync(new URL("../specs/events.v0.json", import.meta.url), "utf8")
) as {
  readonly events: readonly { readonly event_type: string; readonly event_group: string }[];
  readonly bounded_payload_max_chars: number;
  readonly secret_canary: string;
};

describe("event vocabulary comes from the contract", () => {
  test("every declared event is known, and nothing else is", () => {
    // Restating the vocabulary in code creates two lists that drift. This asserts there is one.
    assert.deepEqual([...EVENT_TYPES].sort(), contract.events.map((e) => e.event_type).sort());
    assert.equal(EVENT_TYPES.length, contract.events.length);
    for (const event of contract.events) {
      assert.equal(EVENT_GROUP[event.event_type], event.event_group, event.event_type);
    }
    assert.equal(isEventType("tool.call"), true);
    assert.equal(isEventType("tool.calll"), false);
    assert.equal(isEventType("Tool.Call"), false);
  });

  test("the bounded payload limit and canary are read, not guessed", () => {
    assert.equal(BOUNDED_PAYLOAD_MAX_CHARS, contract.bounded_payload_max_chars);
    assert.equal(SECRET_CANARY, contract.secret_canary);
  });
});

describe("canonicalizeEvent", () => {
  test("an undeclared event type is refused, not passed through", () => {
    // The scorer counts by type. A type nothing declares would be counted as nothing while
    // appearing in the file, so it is refused at construction.
    const result = canonicalizeEvent({ seq: 1, elapsed_ms: 0, event_type: "made.up", payload: null });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, /not a declared event type/);
  });

  test("the payload is projected on the way in, with no way to skip it", () => {
    const result = canonicalizeEvent({
      seq: 1,
      elapsed_ms: 10,
      event_type: "tool.call",
      payload: { tool_name: "write", raw_arguments: "the prompt itself" }
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(Object.keys(result.event.payload ?? {}), ["tool_name"]);
    assert.equal(result.event.redaction, "redacted");
    assert.deepEqual(result.event.removed, ["raw_arguments"]);
  });

  test("the group is derived from the contract, not supplied", () => {
    const result = canonicalizeEvent({ seq: 1, elapsed_ms: 0, event_type: "approval.denied", payload: null });
    assert.equal(result.ok && result.event.event_group, "approval_safety");
  });

  test("seq and elapsed_ms are validated", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      assert.equal(canonicalizeEvent({ seq: bad, elapsed_ms: 0, event_type: "tool.call" }).ok, false, String(bad));
    }
    assert.equal(canonicalizeEvent({ seq: 1, elapsed_ms: -1, event_type: "tool.call" }).ok, false);
  });

  test("no wall-clock timestamp is recorded", () => {
    // Elapsed time orders and measures the run. A wall clock additionally says when a person was
    // working, which this product has no reason to keep.
    const result = canonicalizeEvent({ seq: 1, elapsed_ms: 5, event_type: "tool.call", payload: null });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const keys = Object.keys(result.event);
    assert.equal(keys.some((key) => /time|date|clock|utc|iso/i.test(key) && key !== "elapsed_ms"), false, keys.join(","));
  });
});

describe("trace writer", () => {
  const collect = () => {
    const lines: string[] = [];
    return { lines, writer: createTraceWriter("unused", (line) => lines.push(line)) };
  };

  test("sequence numbers are assigned by the writer, not accepted from the caller", () => {
    // An adapter that assigns its own can repeat or skip one, and the scorer would read the gap as
    // evidence about the operator rather than as a bug in the adapter.
    const { lines, writer } = collect();
    for (const elapsed of [0, 5, 10]) {
      const r = writer.append({ elapsed_ms: elapsed, event_type: "tool.call", payload: null });
      assert.equal(r.ok, true);
    }
    assert.deepEqual(lines.map((line) => (JSON.parse(line) as { seq: number }).seq), [1, 2, 3]);
    assert.equal(writer.count(), 3);
  });

  test("a caller-supplied seq is ignored", () => {
    // The type forbids it, but the writer runs as JavaScript and an adapter can pass one anyway.
    // Without this the claim that sequencing is owned here is only enforced at compile time.
    const { lines, writer } = collect();
    writer.append({ seq: 99, elapsed_ms: 0, event_type: "tool.call" } as never);
    writer.append({ seq: 99, elapsed_ms: 1, event_type: "tool.call" } as never);
    assert.deepEqual(lines.map((line) => (JSON.parse(line) as { seq: number }).seq), [1, 2]);
  });

  test("a clock that goes backwards is refused, not sorted", () => {
    const { lines, writer } = collect();
    assert.equal(writer.append({ elapsed_ms: 10, event_type: "tool.call" }).ok, true);
    const back = writer.append({ elapsed_ms: 9, event_type: "tool.call" });
    assert.equal(back.ok, false, "an out-of-order trace cannot be measured for stalls or latency");
    assert.equal(lines.length, 1, "a refused event must not reach the file");
    assert.equal(writer.count(), 1, "a refused event must not consume a sequence number");
  });

  test("a refused event consumes nothing", () => {
    const { lines, writer } = collect();
    assert.equal(writer.append({ elapsed_ms: 0, event_type: "not.real" }).ok, false);
    assert.equal(writer.count(), 0);
    assert.equal(lines.length, 0);
    const good = writer.append({ elapsed_ms: 0, event_type: "tool.call" });
    assert.equal(good.ok && good.event.seq, 1, "the sequence must not have skipped past the refusal");
  });

  test("lines are canonical, so the same events write the same bytes", () => {
    const a = collect();
    const b = collect();
    for (const w of [a.writer, b.writer]) {
      w.append({ elapsed_ms: 1, event_type: "tool.call", payload: { target_path: "src/a.ts", tool_name: "read" } });
    }
    assert.deepEqual(a.lines, b.lines);
    // Key order in the input must not reach the output.
    const c = collect();
    c.writer.append({ elapsed_ms: 1, event_type: "tool.call", payload: { tool_name: "read", target_path: "src/a.ts" } });
    assert.deepEqual(c.lines, a.lines);
  });

  test("the canary never survives into a written line", () => {
    const { lines, writer } = collect();
    writer.append({ elapsed_ms: 0, event_type: "tool.call", payload: { tool_name: SECRET_CANARY } });
    writer.append({ elapsed_ms: 1, event_type: "user.instruction", payload: { instruction_digest: SECRET_CANARY } });
    for (const line of lines) {
      assert.equal(line.includes(SECRET_CANARY), false, `the canary reached the trace: ${line}`);
    }
  });
});

describe("trace reader", () => {
  test("a malformed line is reported, not skipped", () => {
    // Skipping shortens the event count the scorer's denominators are built from, turning a corrupt
    // file into a quietly different score instead of a refusal.
    const parsed = parseTrace('{"seq":1}\nnot json\n{"seq":2}\n');
    assert.match(parsed.problems[0] as string, /line 2 is not valid JSON/);
    // Parsing continues so the caller sees the full extent of the damage, not only the first break.
    // That is why a non-empty `events` cannot be taken as permission to score.
    assert.equal(isScorable(parsed), false, "a trace with a corrupt line must not be scorable");
  });

  test("a sequence gap is reported and makes the trace unscorable", () => {
    const parsed = parseTrace('{"seq":1}\n{"seq":3}\n');
    assert.equal(parsed.problems.some((p) => p.includes("expected 2")), true);
    assert.equal(isScorable(parsed), false);
  });

  test("a trailing newline is not a problem but an interior blank line is", () => {
    assert.deepEqual(parseTrace('{"seq":1}\n').problems, []);
    assert.equal(parseTrace('{"seq":1}\n\n{"seq":2}\n').problems.length > 0, true);
  });

  test("a written trace reads back as what was written", () => {
    const lines: string[] = [];
    const writer = createTraceWriter("unused", (line) => lines.push(line));
    writer.append({ elapsed_ms: 0, event_type: "assessment.started" });
    writer.append({ elapsed_ms: 7, event_type: "tool.call", payload: { tool_name: "read" } });
    const parsed = parseTrace(`${lines.join("\n")}\n`);
    assert.deepEqual(parsed.problems, []);
    assert.equal(isScorable(parsed), true);
    assert.equal(parsed.events.length, 2);
    assert.equal(parsed.events[1]?.event_type, "tool.call");
  });
});
