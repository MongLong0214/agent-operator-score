from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"patch target not found: {path}: {old[:80]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


# Process supervision: absorb stdin EPIPE, clean the whole detached process group after the
# leader exits, and make survivor detection part of the returned result.
replace(
    "lib/core.mjs",
    '''  child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, Buffer.from(chunk)); });
  child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, Buffer.from(chunk)); });
  if (!promptInArgs) child.stdin.end(context.prompt);
''',
    '''  child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, Buffer.from(chunk)); });
  child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, Buffer.from(chunk)); });
  child.stdin.on("error", () => {});
  if (!promptInArgs) child.stdin.end(context.prompt);
'''
)
replace(
    "lib/core.mjs",
    '''  const outcome = await new Promise((resolvePromise) => {
    child.once("error", (error) => resolvePromise({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => resolvePromise({ code, signal, error: null }));
  });
  clearTimeout(timer);
''',
    '''  const outcome = await new Promise((resolvePromise) => {
    child.once("error", (error) => resolvePromise({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => resolvePromise({ code, signal, error: null }));
  });
  clearTimeout(timer);
  const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
  const groupAlive = () => {
    if (child.pid === undefined) return false;
    try { process.kill(-child.pid, 0); return true; } catch { return false; }
  };
  if (groupAlive()) {
    terminate("SIGTERM");
    await sleep(250);
  }
  if (groupAlive()) {
    terminate("SIGKILL");
    await sleep(250);
  }
  const survivor = groupAlive();
'''
)
replace(
    "lib/core.mjs",
    '''    ok: !timedOut && outcome.error === null && outcome.code === 0,
''',
    '''    ok: !timedOut && !survivor && outcome.error === null && outcome.code === 0,
'''
)
replace(
    "lib/core.mjs",
    '''    timed_out: timedOut,
''',
    '''    timed_out: timedOut,
    survivor,
'''
)
replace(
    "lib/core.mjs",
    '''export function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of Object.values(import("node:fs"))) void entry;
}

''',
    ''''''
)

# Secret-safe payload inspection. Values that look credential-bearing are dropped before an event
# can be serialized, even when the field name is otherwise allowlisted.
replace(
    "lib/core.mjs",
    '''export function rejectSecretLike(values) {
  const joined = values.join(" ");
  const patterns = [
''',
    '''export function containsSecretLike(values) {
  const joined = values.join(" ");
  const patterns = [
'''
)
replace(
    "lib/core.mjs",
    '''  ];
  if (patterns.some((pattern) => pattern.test(joined))) throw new Error("AOS_SECRET_IN_AGENT_CONFIG");
}
''',
    '''  ];
  return patterns.some((pattern) => pattern.test(joined));
}

export function rejectSecretLike(values) {
  if (containsSecretLike(values)) throw new Error("AOS_SECRET_IN_AGENT_CONFIG");
}
'''
)

# Fsync every NDJSON append. A completed line must be durable before a later cursor or terminal can
# refer to it.
replace(
    "lib/core.mjs",
    '''  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${line}\\n`, { encoding: "utf8", mode: 0o600 });
}
''',
    '''  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, "a", 0o600);
  try {
    writeFileSync(fd, `${line}\\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
'''
)

# Store: inspect allowlisted strings, prohibit appending after terminal, and canonicalize causal
# order rather than relying on producer name ordering.
replace(
    "lib/store.mjs",
    '''import { appendNdjson, atomicWrite, canonicalJson, makeId, readJson, readJsonIfExists, requireId, sha256Value, writeJson } from "./core.mjs";
''',
    '''import { appendNdjson, atomicWrite, canonicalJson, containsSecretLike, makeId, readJson, readJsonIfExists, requireId, sha256Value, writeJson } from "./core.mjs";
'''
)
replace(
    "lib/store.mjs",
    '''    const value = payload[key];
    if (value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((entry) => typeof entry === "string"))) {
      result[key] = value;
    }
''',
    '''    const value = payload[key];
    const strings = typeof value === "string" ? [value] : Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
    if (strings.some((entry) => entry.length > 512) || containsSecretLike(strings)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((entry) => typeof entry === "string"))) {
      result[key] = value;
    }
'''
)
replace(
    "lib/store.mjs",
    '''  const p = runPaths(cwd, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  const file = join(p.events, `${producerId}.ndjson`);
''',
    '''  const p = runPaths(cwd, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  if (existsSync(p.terminal)) throw new Error(`AOS_RUN_TERMINAL ${runId}`);
  const file = join(p.events, `${producerId}.ndjson`);
'''
)
replace(
    "lib/store.mjs",
    '''  return [...new Map(events.map((event) => [event.event_id, event])).values()].sort((a, b) => {
    if (a.producer_id === b.producer_id) return a.producer_seq - b.producer_seq;
    return a.producer_id.localeCompare(b.producer_id) || a.event_id.localeCompare(b.event_id);
  });
}
''',
    '''  const unique = [...new Map(events.map((event) => [event.event_id, event])).values()];
  const byId = new Map(unique.map((event) => [event.event_id, event]));
  const depthCache = new Map();
  const visiting = new Set();
  const depthOf = (event) => {
    if (depthCache.has(event.event_id)) return depthCache.get(event.event_id);
    if (visiting.has(event.event_id)) throw new Error(`AOS_CAUSAL_CYCLE ${event.event_id}`);
    visiting.add(event.event_id);
    const parent = event.parent_event_id ? byId.get(event.parent_event_id) : null;
    const depth = parent ? depthOf(parent) + 1 : 0;
    visiting.delete(event.event_id);
    depthCache.set(event.event_id, depth);
    return depth;
  };
  for (const event of unique) depthOf(event);
  return unique.sort((a, b) => {
    const causal = depthOf(a) - depthOf(b);
    if (causal !== 0) return causal;
    if (a.producer_id === b.producer_id) return a.producer_seq - b.producer_seq;
    return a.producer_id.localeCompare(b.producer_id) || a.event_id.localeCompare(b.event_id);
  });
}
'''
)

# Issuance must also require safety evidence and factor coverage, not only total observed count.
replace(
    "lib/scorer.mjs",
    '''  const safetyBlocks = safetyState === "S2" || safetyState === "S3";
''',
    '''  const safetyBlocks = safetyState === "S2" || safetyState === "S3";
  const factorCoverage = ["F1", "F2", "F3", "F4"].every((factor) => FACTORS[factor].some((id) => metrics[id].state === "SCORED"));
  const safetyObserved = metrics.M19.state === "SCORED";
'''
)
replace(
    "lib/scorer.mjs",
    '''  const issued = !safetyBlocks && requiredMissing.length === 0 && observed >= 14 && raw !== null;
''',
    '''  const issued = !safetyBlocks && safetyObserved && factorCoverage && requiredMissing.length === 0 && observed >= 14 && raw !== null;
'''
)

# Finish the event stream before sealing the result, remove nondeterministic result timestamps, make
# process failures visible to the metric layer, and allow import to create its own diagnostic run.
replace(
    "lib/cli.mjs",
    '''      const graded = await gradeScenario(family, workspace, { baseline: prepared.baseline, invocationCount: runs.length });
      Object.assign(metricInput, graded.metrics);
''',
    '''      const graded = await gradeScenario(family, workspace, { baseline: prepared.baseline, invocationCount: runs.length });
      if (runs.some((entry) => !entry.ok)) {
        if (family === "FAM-4") graded.metrics.M14 = 0;
        if (family === "FAM-5") graded.metrics.M15 = 0;
        if (family === "FAM-6") graded.metrics.M18 = 0;
      }
      Object.assign(metricInput, graded.metrics);
'''
)
replace(
    "lib/cli.mjs",
    '''    const result = { ...scored, run_id: runId, suite: "verified-core-v0", suite_digest: suiteDigest(), opportunity_profile: profile, agent_portfolio: { configured: profile.length, used: [...used].sort(), invocations }, family_results: familyResults, generated_at: new Date().toISOString() };
    const markdown = renderMarkdown(result);
    const html = renderHtml(result);
    writeResult(cwd, runId, result, markdown, html);
    commitTerminal(cwd, runId, { run_id: runId, status: result.status, result_digest: sha256Text(canonicalJson(result)), committed_at: new Date().toISOString() });
    appendEvent(cwd, runId, "aos", { event_type: "assessment.ended", payload: { status: result.status } });
''',
    '''    const result = { ...scored, run_id: runId, suite: "verified-core-v0", suite_digest: suiteDigest(), opportunity_profile: profile, agent_portfolio: { configured: profile.length, used: [...used].sort(), invocations }, family_results: familyResults };
    appendEvent(cwd, runId, "aos", { event_type: "assessment.ended", payload: { status: result.status } });
    const markdown = renderMarkdown(result);
    const html = renderHtml(result);
    writeResult(cwd, runId, result, markdown, html);
    commitTerminal(cwd, runId, { run_id: runId, status: result.status, result_digest: sha256Text(canonicalJson(result)), committed_at: new Date().toISOString() });
'''
)
replace(
    "lib/cli.mjs",
    '''  const runId = getOption(options, "run");
  const producer = getOption(options, "producer");
  const file = getOption(options, "file");
  if (![runId, producer, file].every((value) => typeof value === "string")) return fail(io, "AOS_IMPORT_FIELDS_REQUIRED", 2);
''',
    '''  let runId = getOption(options, "run");
  const producer = getOption(options, "producer");
  const file = getOption(options, "file");
  if (typeof producer !== "string" || typeof file !== "string") return fail(io, "AOS_IMPORT_FIELDS_REQUIRED", 2);
  if (typeof runId !== "string") runId = createRun(cwd, { mode: "IMPORTED", source: producer }).runId;
'''
)

# `npm pack --json` must stay machine-readable even when prepack writes progress output.
replace(
    "scripts/pack-smoke.mjs",
    '''  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], { encoding: "utf8" });
''',
    '''  const output = execFileSync("npm", ["pack", "--json", "--silent", "--pack-destination", packDir], { encoding: "utf8" });
'''
)

# Add tests for the new hardening boundaries.
test_path = ROOT / "test-product" / "hardening.test.mjs"
test_path.write_text(r'''import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendEvent, commitTerminal, createRun, readEvents, runPaths } from "../lib/store.mjs";
import { scoreMetrics, perfectMetricInput } from "../lib/scorer.mjs";

const temporary = () => mkdtempSync(join(tmpdir(), "aos-hardening-"));

test("event projection drops secret-looking values", () => {
  const cwd = temporary();
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    const event = appendEvent(cwd, runId, "agent", { event_type: "completion.claimed", payload: { family: "FAM-5", claim: "token=ghp_123456789012345678901234567890" } });
    assert.equal(event.payload?.claim, undefined);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("terminal sessions refuse later events", () => {
  const cwd = temporary();
  try {
    const { runId } = createRun(cwd, { mode: "CONTROLLED" });
    commitTerminal(cwd, runId, { run_id: runId, status: "CANCELLED", result_digest: null, committed_at: "2026-01-01T00:00:00.000Z" });
    assert.throws(() => appendEvent(cwd, runId, "agent", { event_type: "completion.claimed" }), /AOS_RUN_TERMINAL/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("causal parents sort before children across producers", () => {
  const cwd = temporary();
  try {
    const { runId, paths } = createRun(cwd, { mode: "CONTROLLED" });
    appendEvent(cwd, runId, "z-parent", { event_id: "parent", event_type: "agent.started" });
    appendEvent(cwd, runId, "a-child", { event_id: "child", parent_event_id: "parent", event_type: "agent.ended" });
    assert.deepEqual(readEvents(cwd, runId).map((event) => event.event_id), ["parent", "child"]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("issuance requires safety and factor coverage", () => {
  const missingSafety = perfectMetricInput();
  missingSafety.M19 = null;
  assert.equal(scoreMetrics(missingSafety, "S0").issued, false);
  const missingF1 = perfectMetricInput();
  for (const id of ["M01", "M02", "M03", "M04"]) missingF1[id] = null;
  assert.equal(scoreMetrics(missingF1, "S0").issued, false);
});
''', encoding="utf-8")

print("Final production hardening applied")
