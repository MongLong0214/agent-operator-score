import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { appendNdjsonLine, writeFileAtomic } from "../src/storage/atomic-file.ts";
import {
  RUN_STATES,
  TERMINAL_STATES,
  canTransition,
  isRunState,
  isTerminal,
  type RunState
} from "../src/storage/run-state.ts";

const roots: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "aos-storage-"));
  roots.push(dir);
  return dir;
};
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe("atomic-file", () => {
  test("a completed write is readable and leaves no temp file behind", () => {
    const dir = scratch();
    const target = join(dir, "nested", "result.json");
    writeFileAtomic(target, '{"a":1}');
    assert.equal(readFileSync(target, "utf8"), '{"a":1}');
    // A leftover temp file is how a directory listing starts lying about what a run produced.
    assert.deepEqual(readdirSync(join(dir, "nested")), ["result.json"]);
  });

  test("a second write replaces the first without a window where the file is absent", () => {
    const dir = scratch();
    const target = join(dir, "result.json");
    writeFileAtomic(target, "first");
    writeFileAtomic(target, "second");
    assert.equal(readFileSync(target, "utf8"), "second");
    assert.deepEqual(readdirSync(dir), ["result.json"]);
  });

  test("a failed write does not leave a temp file behind", () => {
    const dir = scratch();
    // The target is a non-empty directory, so the temp file is created and written and only then
    // does rename fail. Failing earlier than that never exercises the cleanup at all, which is how
    // this case passed against a build that had the cleanup removed.
    const target = join(dir, "occupied");
    mkdirSync(join(target, "child"), { recursive: true });
    assert.throws(() => writeFileAtomic(target, "x"));
    assert.deepEqual(
      readdirSync(dir).sort(),
      ["occupied"],
      `a temp file survived a failed write: ${readdirSync(dir).join(", ")}`
    );
  });

  test("NDJSON append writes whole lines and refuses an embedded newline", () => {
    const dir = scratch();
    const target = join(dir, "trace.ndjson");
    appendNdjsonLine(target, '{"seq":1}');
    appendNdjsonLine(target, '{"seq":2}');
    assert.equal(readFileSync(target, "utf8"), '{"seq":1}\n{"seq":2}\n');
    // A record containing a newline would be read back as two records, one of them malformed.
    assert.throws(() => appendNdjsonLine(target, '{"a":\n1}'), /must not contain a newline/);
  });

  test("every appended line parses on its own", () => {
    const dir = scratch();
    const target = join(dir, "trace.ndjson");
    for (const seq of [1, 2, 3]) appendNdjsonLine(target, JSON.stringify({ seq }));
    const lines = readFileSync(target, "utf8").split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 3);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  });

  test("append does not truncate a file another writer already started", () => {
    const dir = scratch();
    const target = join(dir, "trace.ndjson");
    writeFileSync(target, '{"seq":0}\n');
    appendNdjsonLine(target, '{"seq":1}');
    assert.equal(readFileSync(target, "utf8"), '{"seq":0}\n{"seq":1}\n');
  });
});

describe("run-state", () => {
  test("a terminal state is final in both directions", () => {
    for (const terminal of TERMINAL_STATES) {
      assert.equal(isTerminal(terminal), true);
      for (const to of RUN_STATES) {
        assert.equal(
          canTransition(terminal, to),
          false,
          `${terminal} -> ${to} would let a recovery pass relabel a finished run`
        );
      }
    }
  });

  test("UNSAFE cannot become COMPLETED", () => {
    // The single transition that would let this product issue a score for a run it refused.
    assert.equal(canTransition("UNSAFE", "COMPLETED"), false);
    assert.equal(canTransition("INVALID", "COMPLETED"), false);
    assert.equal(canTransition("ABORTED", "COMPLETED"), false);
  });

  test("the non-terminal chain moves forward only", () => {
    const chain: RunState[] = ["CREATED", "DOCTOR_PASSED", "PREPARING", "RUNNING", "FINALIZING"];
    for (let i = 0; i < chain.length - 1; i += 1) {
      assert.equal(canTransition(chain[i] as RunState, chain[i + 1] as RunState), true);
      assert.equal(
        canTransition(chain[i + 1] as RunState, chain[i] as RunState),
        false,
        "a run must not walk backwards into a state it already left"
      );
    }
    assert.equal(canTransition("CREATED", "RUNNING"), false, "skipping doctor must not be possible");
  });

  test("any non-terminal state may end at any terminal state", () => {
    // A run can be aborted or found unsafe at any point; forcing an intermediate hop would make a
    // caller fake a transition that did not happen.
    for (const from of RUN_STATES.filter((state) => !isTerminal(state))) {
      for (const terminal of TERMINAL_STATES) {
        assert.equal(canTransition(from, terminal), true, `${from} -> ${terminal}`);
      }
    }
  });

  test("isRunState refuses anything outside the vocabulary", () => {
    assert.equal(isRunState("COMPLETED"), true);
    assert.equal(isRunState("completed"), false);
    assert.equal(isRunState("DONE"), false);
    assert.equal(isRunState(null), false);
  });
});
