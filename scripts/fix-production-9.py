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
package["scripts"]["test:core"] = "node scripts/test-core.mjs"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

# Run the preserved product contract and implementation regressions, excluding only planning,
# publication, alpha, simulation, Snapshot and deferred treatment scaffolding that is outside 0.1.0.
(ROOT / "scripts" / "test-core.mjs").write_text(r'''import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const excluded = new Set([
  "alpha-orchestrator.test.ts",
  "budget-fault.test.ts",
  "external-reproduction.test.ts",
  "pack-budget.test.ts",
  "preflight-report.test.ts",
  "prescription-input.test.ts",
  "scenario-registry.test.ts",
  "simulation-input.test.ts",
  "snapshot-share.test.ts",
  "snapshot.test.ts",
  "sprint-ledger.test.ts",
  "treatment-registry.test.ts"
]);
const files = readdirSync("test")
  .filter((name) => name.endsWith(".test.ts") && !excluded.has(name))
  .sort()
  .map((name) => join("test", name));
if (files.length < 30) throw new Error(`product regression census unexpectedly small: ${files.length}`);
const child = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = child.status ?? 1;
''', encoding="utf-8")

# `npm pack --json` must contain only JSON. The committed build was already verified, so skip
# lifecycle scripts during the pack operation itself and test the exact bytes that would ship.
replace(
    "scripts/pack-smoke.mjs",
    '''  const output = execFileSync("npm", ["pack", "--json", "--silent", "--pack-destination", packDir], { encoding: "utf8" });
''',
    '''  const output = execFileSync("npm", ["pack", "--json", "--silent", "--ignore-scripts", "--pack-destination", packDir], { encoding: "utf8" });
'''
)

# Repair only a torn final NDJSON record. Damage before the tail is corruption and remains fatal.
replace(
    "lib/store.mjs",
    '''import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
''',
    '''import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, truncateSync } from "node:fs";
'''
)
replace(
    "lib/store.mjs",
    '''export function readEvents(cwd, runId) {
  const p = runPaths(cwd, runId);
  if (!existsSync(p.events)) return [];
  const events = [];
  for (const file of readdirSync(p.events).filter((name) => name.endsWith(".ndjson")).sort()) {
    for (const line of readFileSync(join(p.events, file), "utf8").split("\\n")) {
      if (!line) continue;
      events.push(JSON.parse(line));
    }
  }
''',
    '''export function readEvents(cwd, runId) {
  const p = runPaths(cwd, runId);
  if (!existsSync(p.events)) return [];
  const events = [];
  for (const file of readdirSync(p.events).filter((name) => name.endsWith(".ndjson")).sort()) {
    const full = join(p.events, file);
    let text = readFileSync(full, "utf8");
    if (text.length > 0 && !text.endsWith("\\n")) {
      const boundary = text.lastIndexOf("\\n");
      const tail = text.slice(boundary + 1);
      try {
        JSON.parse(tail);
      } catch {
        const repaired = boundary < 0 ? "" : text.slice(0, boundary + 1);
        truncateSync(full, Buffer.byteLength(repaired, "utf8"));
        text = repaired;
      }
    }
    const lines = text.split("\\n").filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      try {
        events.push(JSON.parse(lines[index]));
      } catch {
        throw new Error(`AOS_RUN_CORRUPTED ${file} line ${index + 1}`);
      }
    }
  }
'''
)

# A user interrupt is owned by the supervisor. Every concurrently active process group receives the
# same termination ladder, listeners are removed after cleanup, and the assessment becomes CANCELLED.
replace(
    "lib/core.mjs",
    '''  const timer = setTimeout(() => {
    timedOut = true;
    terminate("SIGTERM");
    setTimeout(() => terminate("SIGKILL"), 5000).unref();
  }, context.timeoutMs);
  timer.unref();

  const outcome = await new Promise((resolvePromise) => {
''',
    '''  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    terminate("SIGTERM");
    setTimeout(() => terminate("SIGKILL"), 5000).unref();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const timer = setTimeout(() => {
    timedOut = true;
    terminate("SIGTERM");
    setTimeout(() => terminate("SIGKILL"), 5000).unref();
  }, context.timeoutMs);
  timer.unref();

  const outcome = await new Promise((resolvePromise) => {
'''
)
replace(
    "lib/core.mjs",
    '''  clearTimeout(timer);
  const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
''',
    '''  clearTimeout(timer);
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
'''
)
replace(
    "lib/core.mjs",
    '''    ok: !timedOut && !leakedDescendants && !survivor && outcome.error === null && outcome.code === 0,
''',
    '''    ok: !timedOut && !interrupted && !leakedDescendants && !survivor && outcome.error === null && outcome.code === 0,
'''
)
replace(
    "lib/core.mjs",
    '''    timed_out: timedOut,
    survivor,
''',
    '''    timed_out: timedOut,
    interrupted,
    survivor,
'''
)

replace(
    "lib/cli.mjs",
    '''      const runs = await executeRoute(cwd, runId, family, route, config, workspace, prepared.task, timeoutMs);
      invocations += runs.length;
''',
    '''      const runs = await executeRoute(cwd, runId, family, route, config, workspace, prepared.task, timeoutMs);
      if (runs.some((entry) => entry.interrupted)) throw new Error("AOS_CANCELLED");
      invocations += runs.length;
'''
)
replace(
    "lib/cli.mjs",
    '''  } catch (error) {
    try { commitTerminal(cwd, runId, { run_id: runId, status: "INTERNAL_ERROR", result_digest: null, committed_at: new Date().toISOString() }); } catch {}
    throw error;
  }
}
''',
    '''  } catch (error) {
    const cancelled = error instanceof Error && error.message === "AOS_CANCELLED";
    try { commitTerminal(cwd, runId, { run_id: runId, status: cancelled ? "CANCELLED" : "INTERNAL_ERROR", result_digest: null, committed_at: new Date().toISOString() }); } catch {}
    if (cancelled) {
      io.stderr.write("AOS_CANCELLED\\n");
      return 130;
    }
    throw error;
  }
}
'''
)

# Observation prompt files are ephemeral evidence transport, not persisted raw user content.
replace(
    "lib/cli.mjs",
    '''  const result = await invokeAgent(cwd, created.runId, "OBSERVE", agent, workspace, "observe", task, Number(getOption(options, "timeout-ms", 300000)), taskFile);
  const diagnostic = { schema_id: "aos-diagnostic", run_id: created.runId, status: "DIAGNOSTIC_ONLY", agent_profile_id: id, process: result, limitations: ["Project observations do not issue AOS-Coding P0."] };
''',
    '''  let result;
  try {
    result = await invokeAgent(cwd, created.runId, "OBSERVE", agent, workspace, "observe", task, Number(getOption(options, "timeout-ms", 300000)), taskFile);
  } finally {
    rmSync(taskFile, { force: true });
  }
  const diagnostic = { schema_id: "aos-diagnostic", run_id: created.runId, status: "DIAGNOSTIC_ONLY", agent_profile_id: id, process: result, limitations: ["Project observations do not issue AOS-Coding P0."] };
'''
)

# Product regressions for torn tails and descendant cleanup.
(ROOT / "test-product" / "supervision.test.mjs").write_text(r'''import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runProcess } from "../lib/core.mjs";
import { appendEvent, createRun, readEvents, runPaths } from "../lib/store.mjs";

const temporary = () => mkdtempSync(join(tmpdir(), "aos-supervision-"));

test("a torn final event is truncated but earlier corruption is fatal", () => {
  const cwd = temporary();
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    appendEvent(cwd, runId, "agent", { event_type: "agent.started" });
    const file = join(runPaths(cwd, runId).events, "agent.ndjson");
    writeFileSync(file, `${readFileSync(file, "utf8")}{\"partial\"`);
    assert.equal(readEvents(cwd, runId).length, 1);
    assert.match(readFileSync(file, "utf8"), /\\n$/);
    writeFileSync(file, `{bad}\\n${readFileSync(file, "utf8")}`);
    assert.throws(() => readEvents(cwd, runId), /AOS_RUN_CORRUPTED/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("an agent that leaves a descendant is cleaned and cannot report success", async () => {
  const cwd = temporary();
  try {
    const script = join(cwd, "leak.mjs");
    writeFileSync(script, "import { spawn } from 'node:child_process'; spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});\n");
    const task = join(cwd, "task.md");
    writeFileSync(task, "test\n");
    const result = await runProcess({ command: process.execPath, args: [script] }, { workspace: cwd, family: "TEST", stage: "test", prompt: "test", promptFile: task, session: "test", timeoutMs: 5000 });
    assert.equal(result.ok, false);
    assert.equal(result.leaked_descendants, true);
    assert.equal(result.survivor, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
''', encoding="utf-8")

print("Ninth production hardening set applied")
