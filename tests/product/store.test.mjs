import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, sha256Value } from "../../lib/core.mjs";
import { appendEvent, commitTerminal, createRun, initHome, listRuns, readEvents, recoverRun, runPaths, writeResult } from "../../lib/store.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { scoreRun as scoreRunUnbounded } from "../../lib/scorer-v1.mjs";

// #556: `scoreRun` and `issuanceCheck` withhold issuance unless the confinement gate says the run
// was official, and absent evidence withholds like a negative verdict. These tests are about the
// arithmetic and the metric gates, so the boundary is stated once here rather than at every call:
// what they assert is what the scorer does with observations, not what this machine's isolation
// backend can do.
const UNDER_AN_OFFICIAL_BOUNDARY = { isolationLevel: "STRICT", officialIssuance: { official: true, reasons: [] } };
const scoreRun = (observations, context = {}) => scoreRunUnbounded(observations, { ...UNDER_AN_OFFICIAL_BOUNDARY, ...context });


const temporary = (name) => mkdtempSync(join(tmpdir(), name));

test("event projection drops secret-looking values", () => {
  const cwd = temporary("aos-projection-");
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    const event = appendEvent(cwd, runId, "agent", { event_type: "completion.claimed", payload: { claim: "API_KEY=secret" } });
    assert.equal(event.payload, null);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("terminal sessions refuse later events and terminal rewrites", () => {
  const cwd = temporary("aos-terminal-");
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    const terminal = { run_id: runId, status: "ABORTED", result_digest: null, committed_at: "2026-01-01T00:00:00.000Z" };
    commitTerminal(cwd, runId, terminal);
    assert.deepEqual(commitTerminal(cwd, runId, terminal), terminal);
    assert.throws(() => appendEvent(cwd, runId, "agent", { event_type: "agent.started" }), /AOS_RUN_TERMINAL/);
    assert.throws(() => commitTerminal(cwd, runId, { ...terminal, status: "COMPLETED" }), /AOS_TERMINAL_ALREADY_COMMITTED/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("causal parents sort before children across producers", () => {
  const cwd = temporary("aos-causal-");
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    const parent = appendEvent(cwd, runId, "z", { event_type: "agent.started" });
    const child = appendEvent(cwd, runId, "a", { event_type: "agent.ended", parent_event_id: parent.event_id });
    assert.deepEqual(readEvents(cwd, runId).map((event) => event.event_id), [parent.event_id, child.event_id]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("result-before-terminal crash is recovered exactly once", () => {
  const cwd = temporary("aos-recover-");
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    const result = { status: "EXPERIMENTAL / PROVISIONAL", score: { display: 80 } };
    writeResult(cwd, runId, result, "# report\n", "<h1>report</h1>");
    assert.equal(recoverRun(cwd, runId).action, "COMMIT_TERMINAL_ONCE");
    assert.equal(recoverRun(cwd, runId).action, "NO_RESCORE");
    const terminal = JSON.parse(readFileSync(runPaths(cwd, runId).terminal, "utf8"));
    assert.equal(terminal.result_digest, sha256Value(result));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("unfinished run without result becomes aborted", () => {
  const cwd = temporary("aos-abort-");
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    assert.equal(recoverRun(cwd, runId).action, "ABORTED");
    assert.equal(recoverRun(cwd, runId).action, "NO_RESCORE");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("issuance requires safety and evidence coverage", () => {
  const every = (passing) =>
    METRIC_IDS.map((id) =>
      observationOf({
        metric_id: id,
        verifier_id: "store.test",
        subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: passing })),
        evidence_ids: ["e"],
        reason: "fixture"
      })
    );
  const perfect = scoreRun(every(true));
  assert.equal(perfect.issued, true);
  assert.equal(perfect.score.final, 100);

  // Unsafe is capped, not withheld. A scorer that refused to score would pass an "is not issued"
  // assertion while saying nothing about the ceiling.
  const unsafe = scoreRun(every(true), { safetyState: "S2" });
  assert.equal(unsafe.status, "UNSAFE");
  assert.equal(unsafe.score.final, 39);

  const thin = every(true).map((entry, index) => (index < 5 ? observationOf({ metric_id: entry.metric_id }) : entry));
  assert.equal(scoreRun(thin).issued, false);
});

test("runs come back in the order they were created", () => {
  // A run id is a uuid, so sorting by name is sorting by nothing -- and every caller reads this
  // list as if it were in order. One of them recorded the first run's score against every seed in
  // a cycle because "the first" and "the newest" happened to be unrelated.
  //
  // The names here sort opposite to the timestamps, so name order and creation order cannot agree
  // by accident. An earlier version made four real runs and asserted their uuids were not already
  // sorted, which is true 23 times in 24 and failed the rest -- a four per cent flake guarding
  // against a test that proves nothing.
  const home = mkdtempSync(join(tmpdir(), "aos-order-"));
  try {
    initHome(home);
    const made = [
      ["run-zzz", "2026-08-01T00:00:00.000Z"],
      ["run-mmm", "2026-08-02T00:00:00.000Z"],
      ["run-aaa", "2026-08-03T00:00:00.000Z"]
    ];
    for (const [id, createdAt] of made) {
      mkdirSync(join(home, "runs", id), { recursive: true });
      writeFileSync(join(home, "runs", id, "manifest.json"), JSON.stringify({ run_id: id, created_at: createdAt }));
    }
    const names = made.map(([id]) => id);
    assert.deepEqual(listRuns(home), names);
    assert.deepEqual([...names].sort(), [...names].reverse(), "the fixture must sort opposite to creation order");

    // A run whose manifest cannot be read is broken. It sorts to the end rather than being given a
    // place in the middle of a history.
    mkdirSync(join(home, "runs", "run-000"), { recursive: true });
    writeFileSync(join(home, "runs", "run-000", "manifest.json"), "{not json");
    assert.equal(listRuns(home).at(-1), "run-000");
    assert.deepEqual(listRuns(home).slice(0, 3), names);

    // And a real run, created through the product, lands after the ones dated before it.
    const { runId } = createRun(home, { mode: "TEST" });
    assert.equal(listRuns(home).indexOf(runId) >= 3, true, "a run created now should sort after 2026-08-03");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
