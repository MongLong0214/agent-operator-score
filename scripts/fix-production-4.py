from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"patch target not found: {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"]["test:product"] = "node --test test-product/*.test.mjs"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

# A process that leaves descendants behind has violated the lifecycle contract even when AOS can
# clean them up. Keep the cleanup, but do not report that invocation as successful.
replace(
    "lib/core.mjs",
    '''  if (groupAlive()) {
    terminate("SIGTERM");
    await sleep(250);
  }
''',
    '''  const leakedDescendants = groupAlive();
  if (leakedDescendants) {
    terminate("SIGTERM");
    await sleep(250);
  }
'''
)
replace(
    "lib/core.mjs",
    '''    ok: !timedOut && !survivor && outcome.error === null && outcome.code === 0,
''',
    '''    ok: !timedOut && !leakedDescendants && !survivor && outcome.error === null && outcome.code === 0,
'''
)
replace(
    "lib/core.mjs",
    '''    survivor,
''',
    '''    survivor,
    leaked_descendants: leakedDescendants,
'''
)

# Allow controlled callers to place a prompt file under the run directory rather than mutating a
# user's project root. Controlled assessment keeps using the scenario's task.md.
replace(
    "lib/cli.mjs",
    '''async function invokeAgent(cwd, runId, family, agent, workspace, stage, prompt, timeoutMs) {
''',
    '''async function invokeAgent(cwd, runId, family, agent, workspace, stage, prompt, timeoutMs, taskFile = join(workspace, "task.md")) {
'''
)
replace(
    "lib/cli.mjs",
    '''  const promptFile = join(workspace, "task.md");
  const result = await runProcess(agent, { workspace, family, stage, prompt, promptFile, session: runId, timeoutMs });
''',
    '''  const result = await runProcess(agent, { workspace, family, stage, prompt, promptFile: taskFile, session: runId, timeoutMs });
'''
)
replace(
    "lib/cli.mjs",
    '''  const created = createRun(cwd, { mode: "PROJECT_OBSERVATION", agent_profile_id: id, task_digest: sha256Text(task) });
  const result = await invokeAgent(cwd, created.runId, "OBSERVE", agent, workspace, "observe", task, Number(getOption(options, "timeout-ms", 300000)));
''',
    '''  const created = createRun(cwd, { mode: "PROJECT_OBSERVATION", agent_profile_id: id, task_digest: sha256Text(task) });
  const taskFile = join(created.paths.root, "observe-task.md");
  writeFileSync(taskFile, `${task}\\n`, "utf8");
  const result = await invokeAgent(cwd, created.runId, "OBSERVE", agent, workspace, "observe", task, Number(getOption(options, "timeout-ms", 300000)), taskFile);
'''
)

# A terminal is the last durable answer. Record cancellation evidence before committing it.
replace(
    "lib/cli.mjs",
    '''  if (action === "cancel") { const terminal = commitTerminal(cwd, id, { run_id: id, status: "CANCELLED", result_digest: null, committed_at: new Date().toISOString() }); appendEvent(cwd, id, "operator", { event_type: "session.cancelled", payload: { reason: "operator" } }); emit(io, json ? terminal : `Cancelled ${id}`, json); return 0; }
''',
    '''  if (action === "cancel") { appendEvent(cwd, id, "operator", { event_type: "session.cancelled", payload: { reason: "operator" } }); const terminal = commitTerminal(cwd, id, { run_id: id, status: "CANCELLED", result_digest: null, committed_at: new Date().toISOString() }); emit(io, json ? terminal : `Cancelled ${id}`, json); return 0; }
'''
)

# Imported logs can start a diagnostic session with or without an explicit caller-provided run id.
replace(
    "lib/cli.mjs",
    '''  if (typeof runId !== "string") runId = createRun(cwd, { mode: "IMPORTED", source: producer }).runId;
  let count = 0;
''',
    '''  if (typeof runId !== "string") runId = createRun(cwd, { mode: "IMPORTED", source: producer }).runId;
  else if (!existsSync(runPaths(cwd, runId).manifest)) createRun(cwd, { run_id: runId, mode: "IMPORTED", source: producer });
  let count = 0;
'''
)

# Verify deterministic scorer bytes in addition to semantic checks.
replace(
    "lib/cli.mjs",
    '''    { check: "agent-count-not-score-input", ok: !JSON.stringify(perfect).includes("agent_count") }
''',
    '''    { check: "agent-count-not-score-input", ok: !JSON.stringify(perfect).includes("agent_count") },
    { check: "deterministic-score", ok: canonicalJson(perfect) === canonicalJson(scoreMetrics(perfectMetricInput(), "S0")) }
'''
)

# Product tests for cancellation and import-created diagnostics.
test_path = ROOT / "test-product" / "lifecycle.test.mjs"
test_path.write_text(r'''import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const cli = new URL("../bin/aos.mjs", import.meta.url).pathname;
function invoke(cwd, args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, expected, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("import creates a diagnostic run and cancellation seals once", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-life-"));
  try {
    invoke(cwd, ["init"]);
    const source = join(cwd, "events.ndjson");
    writeFileSync(source, `${JSON.stringify({ event_type: "completion.claimed", payload: { claim: "blocked" } })}\n`);
    const imported = JSON.parse(invoke(cwd, ["import", "--producer", "legacy", "--file", source, "--json"]));
    assert.equal(imported.status, "DIAGNOSTIC_ONLY");
    invoke(cwd, ["session", "cancel", imported.run_id]);
    const terminal = JSON.parse(readFileSync(join(cwd, ".aos", "runs", imported.run_id, "terminal.json"), "utf8"));
    assert.equal(terminal.status, "CANCELLED");
    const again = spawnSync(process.execPath, [cli, "session", "cancel", imported.run_id], { cwd, encoding: "utf8" });
    assert.notEqual(again.status, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
''', encoding="utf-8")

print("Fourth production fix set applied")
