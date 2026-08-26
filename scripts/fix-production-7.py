from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"patch target not found: {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


# Recover the two durable crash windows without ever relabelling an existing terminal: result written
# before terminal, and an interrupted run with no result. A digest conflict is reported, not repaired.
replace(
    "lib/store.mjs",
    '''export function listRuns(cwd) {
''',
    '''export function recoverRun(cwd, runId) {
  const p = runPaths(cwd, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  const result = readJsonIfExists(p.result);
  const terminal = readJsonIfExists(p.terminal);
  if (terminal !== null) {
    if (result !== null) {
      const expected = sha256Value(result);
      if (terminal.result_digest !== expected) return { run_id: runId, action: "INVALID", reason: "terminal/result digest mismatch" };
    } else if (terminal.result_digest !== null) {
      return { run_id: runId, action: "INVALID", reason: "terminal binds a missing result" };
    }
    return { run_id: runId, action: "NO_RESCORE", terminal };
  }
  if (result !== null) {
    const recovered = commitTerminal(cwd, runId, { run_id: runId, status: result.status ?? "DIAGNOSTIC_ONLY", result_digest: sha256Value(result), committed_at: new Date().toISOString() });
    return { run_id: runId, action: "COMMIT_TERMINAL_ONCE", terminal: recovered };
  }
  const aborted = commitTerminal(cwd, runId, { run_id: runId, status: "ABORTED", result_digest: null, committed_at: new Date().toISOString() });
  return { run_id: runId, action: "ABORTED", terminal: aborted };
}

export function listRuns(cwd) {
'''
)

replace(
    "lib/cli.mjs",
    '''  readRun,
  removeAgent,
''',
    '''  readRun,
  recoverRun,
  removeAgent,
'''
)
replace(
    "lib/cli.mjs",
    '''  if (action === "graph") { const edges = run.events.filter((event) => ["handoff.created", "handoff.consumed"].includes(event.event_type)).map((event) => ({ type: event.event_type, from: event.payload?.from ?? null, to: event.payload?.to ?? null, family: event.family })); emit(io, json ? edges : edges.map((edge) => `${edge.type}\\t${edge.from ?? "?"} -> ${edge.to ?? "?"}\\t${edge.family ?? ""}`).join("\\n"), json); return 0; }
  if (action === "cancel") { appendEvent(cwd, id, "operator", { event_type: "session.cancelled", payload: { reason: "operator" } }); const terminal = commitTerminal(cwd, id, { run_id: id, status: "CANCELLED", result_digest: null, committed_at: new Date().toISOString() }); emit(io, json ? terminal : `Cancelled ${id}`, json); return 0; }
''',
    '''  if (action === "graph") { const edges = run.events.filter((event) => ["handoff.created", "handoff.consumed"].includes(event.event_type)).map((event) => ({ type: event.event_type, from: event.payload?.from ?? null, to: event.payload?.to ?? null, family: event.family })); emit(io, json ? edges : edges.map((edge) => `${edge.type}\\t${edge.from ?? "?"} -> ${edge.to ?? "?"}\\t${edge.family ?? ""}`).join("\\n"), json); return 0; }
  if (action === "recover") { const recovered = recoverRun(cwd, id); emit(io, json ? recovered : `${recovered.action} ${id}`, json); return recovered.action === "INVALID" ? 4 : 0; }
  if (action === "cancel") { appendEvent(cwd, id, "operator", { event_type: "session.cancelled", payload: { reason: "operator" } }); const terminal = commitTerminal(cwd, id, { run_id: id, status: "CANCELLED", result_digest: null, committed_at: new Date().toISOString() }); emit(io, json ? terminal : `Cancelled ${id}`, json); return 0; }
'''
)
replace(
    "lib/cli.mjs",
    '''  aos session list | status <id> | graph <id> | cancel <id>
''',
    '''  aos session list | status <id> | graph <id> | recover <id> | cancel <id>
'''
)

# Export the recovery primitive for embedding users.
replace(
    "lib/index.mjs",
    '''export { runCli } from "./cli.mjs";
''',
    '''export { runCli } from "./cli.mjs";
export { recoverRun } from "./store.mjs";
'''
)

readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8")
readme = readme.replace(
    "aos session status <run-id>\naos report",
    "aos session status <run-id>\naos session recover <run-id>\naos report"
)
readme += '''

## Crash recovery

AOS writes result and terminal records atomically. If a process is interrupted after `result.json` but before `terminal.json`, run `aos session recover <run-id>`; it verifies the result digest and commits the terminal exactly once. An interrupted run with no result becomes `ABORTED`. An existing terminal is never relabelled, and a terminal/result digest conflict is reported as `INVALID`.
'''
readme_path.write_text(readme, encoding="utf-8")

# The finalizer itself must not accidentally ship planning-only package metadata.
package = (ROOT / "package.json").read_text(encoding="utf-8")
for forbidden in ['"private": true', '"version": "0.0.0"', '"workspaces"']:
    if forbidden in package:
        raise SystemExit(f"release package still contains {forbidden}")

# Recovery regression.
test_path = ROOT / "test-product" / "recovery.test.mjs"
test_path.write_text(r'''import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, sha256Value } from "../lib/core.mjs";
import { createRun, recoverRun, runPaths, writeResult } from "../lib/store.mjs";

test("result-before-terminal crash is recovered exactly once", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-recover-"));
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    const result = { status: "EXPERIMENTAL / PROVISIONAL", score: { display: 80 } };
    writeResult(cwd, runId, result, "# report\n", "<h1>report</h1>");
    const first = recoverRun(cwd, runId);
    assert.equal(first.action, "COMMIT_TERMINAL_ONCE");
    const second = recoverRun(cwd, runId);
    assert.equal(second.action, "NO_RESCORE");
    const terminal = JSON.parse(readFileSync(runPaths(cwd, runId).terminal, "utf8"));
    assert.equal(terminal.result_digest, sha256Value(result));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("unfinished run without result becomes aborted and cannot be relabelled", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-abort-"));
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    assert.equal(recoverRun(cwd, runId).action, "ABORTED");
    assert.equal(recoverRun(cwd, runId).action, "NO_RESCORE");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
''', encoding="utf-8")

print("Durable recovery and release assertions applied")
