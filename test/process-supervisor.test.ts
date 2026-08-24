import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_STREAM_CAP_BYTES,
  MAX_TRANSPORT_LINE_BYTES,
  TERMINATION_LADDER,
  TRUNCATION_MARKER,
  createBoundedSink,
  createSignalPolicy,
  parseTransportLine,
  terminateGroup,
  type Signal
} from "../src/runner/process-supervisor.ts";

const io = (aliveAfter: (signalsSent: Signal[]) => boolean) => {
  const sent: Signal[] = [];
  const waits: number[] = [];
  return {
    sent,
    waits,
    io: {
      signalGroup: (signal: Signal) => sent.push(signal),
      groupAlive: () => aliveAfter(sent),
      wait: async (ms: number) => {
        waits.push(ms);
      }
    }
  };
};

describe("termination ladder", () => {
  test("the ladder is SIGTERM then SIGKILL with the contracted grace periods", () => {
    assert.deepEqual(
      TERMINATION_LADDER.map((step) => [step.signal, step.graceMs]),
      [["SIGTERM", 5_000], ["SIGKILL", 2_000]]
    );
  });

  test("an already-dead group is not signalled at all", () => {
    const harness = io(() => false);
    return terminateGroup(harness.io).then((outcome) => {
      assert.deepEqual(outcome, { kind: "exited", afterSignal: null });
      assert.deepEqual(harness.sent, [], "a dead group must not be signalled");
    });
  });

  test("a group that exits on SIGTERM is never sent SIGKILL", () => {
    const harness = io((sent) => sent.length === 0);
    return terminateGroup(harness.io).then((outcome) => {
      assert.deepEqual(outcome, { kind: "exited", afterSignal: "SIGTERM" });
      assert.deepEqual(harness.sent, ["SIGTERM"]);
      assert.deepEqual(harness.waits, [5_000]);
    });
  });

  test("a group that ignores SIGTERM is escalated", () => {
    const harness = io((sent) => !sent.includes("SIGKILL"));
    return terminateGroup(harness.io).then((outcome) => {
      assert.deepEqual(outcome, { kind: "exited", afterSignal: "SIGKILL" });
      assert.deepEqual(harness.sent, ["SIGTERM", "SIGKILL"]);
      assert.deepEqual(harness.waits, [5_000, 2_000]);
    });
  });

  test("a group surviving SIGKILL is reported, not assumed dead", () => {
    // A group can survive SIGKILL in an uninterruptible wait. Assuming it died is how a run gets
    // marked complete while a child is still writing into the workspace it was scored on.
    const harness = io(() => true);
    return terminateGroup(harness.io).then((outcome) => {
      assert.deepEqual(outcome, { kind: "survived" });
      assert.deepEqual(harness.sent, ["SIGTERM", "SIGKILL"]);
    });
  });

  test("liveness is re-checked after every wait, including after SIGKILL", () => {
    let checks = 0;
    const harness = {
      signalGroup: () => {},
      groupAlive: () => {
        checks += 1;
        return true;
      },
      wait: async () => {}
    };
    return terminateGroup(harness).then(() => {
      // one before the ladder, one after each of the two waits
      assert.equal(checks, 3, "a check was skipped, so a survivor could go unnoticed");
    });
  });
});

describe("bounded stream capture", () => {
  test("output under the cap is kept whole", () => {
    const sink = createBoundedSink(100);
    sink.write("hello ");
    sink.write("world");
    assert.equal(sink.text(), "hello world");
    assert.equal(sink.truncated(), false);
  });

  test("the cap holds and the tail is dropped, not the head", () => {
    // The beginning says what the runtime tried to do; the end is usually one line repeating.
    const sink = createBoundedSink(10);
    sink.write("0123456789ABCDEF");
    assert.equal(sink.truncated(), true);
    assert.equal(sink.text().startsWith("0123456789"), true);
    assert.equal(sink.text().includes("ABCDEF"), false, "content past the cap was retained");
    assert.equal(sink.text().includes(TRUNCATION_MARKER.trim()), true, "truncation was silent");
  });

  test("writes after truncation are ignored rather than appended", () => {
    const sink = createBoundedSink(4);
    sink.write("aaaaaaaa");
    const afterFirst = sink.text();
    sink.write("bbbbbbbb");
    assert.equal(sink.text(), afterFirst, "the cap stopped holding after the first overflow");
  });

  test("the cap is measured in bytes, not characters", () => {
    // A multi-byte character counted as one would let a UTF-8 stream exceed the cap several times
    // over, which is how a bounded buffer stops being bounded.
    const sink = createBoundedSink(8);
    sink.write("한글한글한글");
    assert.equal(sink.bytes() <= 8, true, `kept ${sink.bytes()} bytes against a cap of 8`);
    assert.equal(sink.truncated(), true);
  });

  test("the default cap is the contracted 10 MiB", () => {
    assert.equal(DEFAULT_STREAM_CAP_BYTES, 10 * 1024 * 1024);
  });
});

describe("transport lines", () => {
  test("a line over the cap is invalid, not truncated", () => {
    // Truncating a JSON line either fails to parse or parses into something other than what was
    // sent, and the second is undetectable downstream.
    const oversized = JSON.stringify({ payload: "x".repeat(MAX_TRANSPORT_LINE_BYTES) });
    const parsed = parseTransportLine(oversized);
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /over the \d+ cap/);
  });

  test("a line at the cap is still accepted", () => {
    const body = "y".repeat(MAX_TRANSPORT_LINE_BYTES - 12);
    const line = JSON.stringify({ a: body });
    assert.equal(Buffer.byteLength(line, "utf8") <= MAX_TRANSPORT_LINE_BYTES, true);
    assert.equal(parseTransportLine(line).ok, true);
  });

  test("malformed JSON is rejected with a reason", () => {
    const parsed = parseTransportLine("{not json");
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /not valid JSON/);
  });
});

describe("signal policy", () => {
  test("the first signal cancels gracefully and the second kills", () => {
    const policy = createSignalPolicy();
    assert.equal(policy.onSignal(), "graceful_cancel");
    assert.equal(policy.onSignal(), "immediate_kill");
    assert.equal(policy.onSignal(), "immediate_kill", "a third signal must not return to graceful");
  });

  test("each run gets its own policy", () => {
    const first = createSignalPolicy();
    first.onSignal();
    assert.equal(createSignalPolicy().onSignal(), "graceful_cancel");
  });
});
