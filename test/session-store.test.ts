import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import {
  appendProducerEvent,
  commitTerminal,
  createSession,
  decideRecovery,
  listProducers,
  readCursor,
  readProducerEvents,
  readTerminal,
  resultDigestOf,
  writeCursor,
  type RecoveryInput,
  type Terminal
} from "../src/storage/session-store.ts";

const roots: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "aos-session-"));
  roots.push(dir);
  return dir;
};
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const session = () => createSession(scratch(), "s-1", { session_id: "s-1" });

describe("multi-producer append isolation", () => {
  test("each producer owns its own file", () => {
    // Several processes appending to one file interleave partial writes under load, and a torn line
    // is indistinguishable from a producer that stopped mid-record.
    const paths = session();
    appendProducerEvent(paths, "p-alpha", { event_id: "a1" });
    appendProducerEvent(paths, "p-beta", { event_id: "b1" });
    appendProducerEvent(paths, "p-alpha", { event_id: "a2" });

    assert.deepEqual(listProducers(paths), ["p-alpha", "p-beta"]);
    assert.equal(readProducerEvents(paths, "p-alpha").lines.length, 2);
    assert.equal(readProducerEvents(paths, "p-beta").lines.length, 1);
  });

  test("an unknown producer reads as empty rather than failing", () => {
    const paths = session();
    const read = readProducerEvents(paths, "never-started");
    assert.deepEqual(read.lines, []);
    assert.equal(read.truncated, false);
  });

  test("appended events are canonical, so key order never reaches the file", () => {
    const paths = session();
    appendProducerEvent(paths, "p", { b: 1, a: 2 });
    appendProducerEvent(paths, "p", { a: 2, b: 1 });
    const lines = readProducerEvents(paths, "p").lines;
    assert.equal(lines[0], lines[1]);
  });
});

describe("torn trailing line", () => {
  test("a crash mid-append is repaired by truncating the last record", () => {
    // Every earlier line was fsynced whole, so the tail is the only position a partial record can
    // appear at. That makes truncation a targeted repair rather than a guess.
    const paths = session();
    appendProducerEvent(paths, "p", { event_id: "e1" });
    appendProducerEvent(paths, "p", { event_id: "e2" });
    appendFileSync(join(paths.producers, "p", "events.ndjson"), '{"event_id":"e3","par');

    const read = readProducerEvents(paths, "p");
    assert.equal(read.truncated, true, "the torn line was not detected");
    assert.equal(read.lines.length, 2, "a complete record was lost with the torn one");
  });

  test("damage anywhere but the tail is refused, not silently repaired", () => {
    // Truncating here would drop records the crash story does not explain, and the event count is
    // what every denominator is built from.
    const paths = session();
    appendProducerEvent(paths, "p", { event_id: "e1" });
    appendFileSync(join(paths.producers, "p", "events.ndjson"), "not json\n");
    appendProducerEvent(paths, "p", { event_id: "e3" });
    assert.throws(() => readProducerEvents(paths, "p"), /AOS_RUN_CORRUPTED/);
  });
});

describe("producer cursors", () => {
  test("a cursor round-trips", () => {
    const paths = session();
    writeCursor(paths, { producer_id: "p", last_seq: 42 });
    assert.deepEqual(readCursor(paths, "p"), { producer_id: "p", last_seq: 42 });
  });

  test("an unreadable cursor is absent, not zero", () => {
    // Resuming from zero replays the whole producer, and a replayed event is only deduplicated if
    // it is byte-identical -- which it will not be if anything about the environment moved.
    const paths = session();
    writeCursor(paths, { producer_id: "p", last_seq: 7 });
    appendFileSync(join(paths.producers, "p", "cursor.json"), "{{{");
    assert.equal(readCursor(paths, "p"), null);
    assert.equal(readCursor(paths, "never-written"), null);
  });
});

describe("exactly-once terminal", () => {
  const terminal = (over: Partial<Terminal> = {}): Terminal => ({
    session_id: "s-1",
    state: "COMPLETED",
    result_digest: resultDigestOf({ score: 1 }),
    workspaces_retained: false,
    ...over
  });

  test("the first commit writes and binds the result digest", () => {
    const paths = session();
    const written = commitTerminal(paths, terminal());
    assert.equal(written.ok, true);
    assert.equal(readTerminal(paths)?.result_digest, terminal().result_digest);
  });

  test("an identical re-commit is accepted, so a repeated recovery step is not an error", () => {
    const paths = session();
    assert.equal(commitTerminal(paths, terminal()).ok, true);
    assert.equal(commitTerminal(paths, terminal()).ok, true);
  });

  test("a different terminal is refused rather than overwritten", () => {
    // A recovery pass that relabels a finished session is the only way a refused run becomes a
    // scored one.
    const paths = session();
    commitTerminal(paths, terminal({ state: "UNSAFE" }));
    const second = commitTerminal(paths, terminal({ state: "COMPLETED" }));
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.existing.state, "UNSAFE");
    assert.equal(readTerminal(paths)?.state, "UNSAFE", "the committed terminal was overwritten");
  });

  test("a terminal carrying a different result digest is refused", () => {
    const paths = session();
    commitTerminal(paths, terminal());
    const second = commitTerminal(paths, terminal({ result_digest: resultDigestOf({ score: 2 }) }));
    assert.equal(second.ok, false);
  });

  test("a non-terminal state cannot be committed as terminal", () => {
    const paths = session();
    const attempt = commitTerminal(paths, terminal({ state: "RUNNING" }));
    assert.equal(attempt.ok, false);
    assert.equal(readTerminal(paths), null, "a running state reached terminal.json");
  });
});

describe("recovery decisions", () => {
  const base: RecoveryInput = {
    hasActiveProducer: false,
    hasFinalSeal: false,
    hasValidCursor: false,
    hasResult: false,
    hasTerminal: false,
    resultDigestMatchesTerminal: true
  };

  test("a committed terminal outranks everything and never rescores", () => {
    assert.equal(decideRecovery({ ...base, hasTerminal: true }), "NO_RESCORE");
    assert.equal(
      decideRecovery({ ...base, hasTerminal: true, hasResult: true, hasFinalSeal: true, hasActiveProducer: true }),
      "NO_RESCORE",
      "a later signal outranked a committed terminal"
    );
  });

  test("a result that disagrees with its terminal is INVALID", () => {
    assert.equal(
      decideRecovery({ ...base, hasTerminal: true, hasResult: true, resultDigestMatchesTerminal: false }),
      "INVALID"
    );
  });

  test("a result without a terminal commits the terminal once", () => {
    assert.equal(decideRecovery({ ...base, hasResult: true }), "COMMIT_TERMINAL_ONCE");
  });

  test("a final seal without a result scores once", () => {
    assert.equal(decideRecovery({ ...base, hasFinalSeal: true }), "SCORE_ONCE");
  });

  test("an active producer with a valid cursor resumes", () => {
    assert.equal(decideRecovery({ ...base, hasActiveProducer: true, hasValidCursor: true }), "RESUME_INGESTION");
  });

  test("no producer and no seal aborts", () => {
    assert.equal(decideRecovery(base), "ABORTED");
  });

  test("an active producer with no usable cursor is not silently resumed", () => {
    // Resuming without a cursor would replay from the start and double-count everything that
    // survived; aborting or refusing is the honest answer.
    const decision = decideRecovery({ ...base, hasActiveProducer: true, hasValidCursor: false });
    assert.notEqual(decision, "RESUME_INGESTION");
    assert.equal(decision, "INVALID");
  });
});
