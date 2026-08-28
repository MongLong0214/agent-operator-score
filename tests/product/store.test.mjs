import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, sha256Value } from "../../lib/core.mjs";
import { appendEvent, commitTerminal, createRun, readEvents, recoverRun, runPaths, writeResult } from "../../lib/store.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { scoreRun } from "../../lib/scorer-v1.mjs";

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
