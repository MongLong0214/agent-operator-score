import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { appendNdjson, atomicWrite, canonicalJson, containsSecretLike, makeId, readJson, readJsonIfExists, repairTornTrailingNdjson, requireId, sha256Value, writeJson } from "./core.mjs";

const CONFIG_SCHEMA = "aos-config.v1";
const EVENT_PAYLOAD_ALLOWLIST = {
  "assessment.started": ["mode", "suite"],
  "assessment.ended": ["status"],
  "user.instruction": ["agent_profile_id", "family", "stage", "instruction_digest", "instruction_length"],
  "agent.started": ["agent_profile_id", "family", "stage"],
  "agent.ended": ["agent_profile_id", "family", "stage", "ok", "exit_code", "timed_out", "duration_ms", "stdout_bytes", "stderr_bytes", "stdout_digest", "stderr_digest"],
  "handoff.created": ["from", "to", "family", "artifact_digests"],
  "handoff.consumed": ["from", "to", "family", "artifact_digests"],
  "completion.claimed": ["family", "claim"],
  "verification.completed": ["family", "verdict", "evidence_digest"],
  "safety.event": ["family", "level", "kind"],
  "session.cancelled": ["reason"],
  // Raised by AOS at a moment it can point to. The payload the operator was shown is kept, bounded
  // at the source: a digest over evidence the record does not hold is a claim of checkability that
  // nothing can honour, and a run whose checkpoints cannot say what they showed cannot be reviewed.
  "checkpoint.raised": ["family", "kind", "detail", "output", "calls", "evidence_digest"],
  // Recorded when an operator acts during a run. `choice` is kept for the reader and is never a
  // scoring input -- what is scored is the state change that followed it.
  "operator.decision": ["family", "kind", "choice", "evidence_digest", "route_changed", "instruction_digest"],
  "import.received": ["source", "count"],
  "bridge.received": ["source", "count"],
  "surface.registered": ["surface_id", "kind", "transport"],
  "surface.removed": ["surface_id"]
};

/**
 * Where AOS keeps its data.
 *
 * One place per machine, not one per project. Runs were kept in `<project>/.aos`, which made a
 * result belong to whichever directory the command happened to start in and meant the operator's
 * history was scattered across every repository they had ever assessed.
 *
 * `--data-dir` wins over `AOS_HOME`, which wins over `~/.aos`. The explicit flag is what makes a
 * test able to run without touching the operator's real history.
 */
export function resolveHome({ dataDir, env = {}, home = homedir() } = {}) {
  if (typeof dataDir === "string" && dataDir.length > 0) return resolve(dataDir);
  const fromEnv = env.AOS_HOME;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return resolve(fromEnv);
  return join(home, ".aos");
}

export function paths(home) {
  const root = resolve(home);
  return { root, config: join(root, "agents.json"), runs: join(root, "runs") };
}

export function defaultConfig() {
  return { schema_id: CONFIG_SCHEMA, agents: {}, collaboration_surfaces: {} };
}

/**
 * Creates the home if it is not there. Never touches anything outside it.
 *
 * This used to append `.aos/` to the project's .gitignore, and readConfig calls it -- so `aos
 * review`, a read, rewrote a tracked file in whatever repository it was run from. Nothing AOS reads
 * with should modify the operator's work.
 *
 * 0700 because the runs underneath carry transcripts of the operator's own sessions.
 */
export function initHome(home) {
  const p = paths(home);
  mkdirSync(p.runs, { recursive: true, mode: 0o700 });
  if (!existsSync(p.config)) writeJson(p.config, defaultConfig());
  return p;
}

export function readConfig(home) {
  const p = initHome(home);
  const config = readJson(p.config);
  if (config.schema_id !== CONFIG_SCHEMA || typeof config.agents !== "object") throw new Error("AOS_INVALID_CONFIG");
  return config;
}

export function writeConfig(home, config) {
  const p = initHome(home);
  writeJson(p.config, config);
}

export function addAgent(home, agent) {
  requireId(agent.id, "agent id");
  const config = readConfig(home);
  // Everything that changes what this agent is goes into the digest. The allowed environment names
  // and the adapter are part of that: a run that carried one more variable, or that was read
  // through a different adapter, is not the same environment as one that did not.
  const allowedEnvNames = [...new Set(agent.allowed_env_names ?? [])].sort();
  // A run where the agent was handed its runtime credential is not the same environment as one
  // where it was not, so this belongs in the digest beside the rest.
  const runtimeAuthEnvNames = [...new Set(agent.runtime_auth_env_names ?? [])].sort();
  const adapter = agent.adapter ?? "generic-command.v1";
  config.agents[agent.id] = {
    id: agent.id,
    display_name: agent.display_name ?? agent.id,
    runtime_name: agent.runtime_name ?? agent.id,
    vendor: agent.vendor ?? null,
    command: agent.command,
    args: agent.args,
    adapter,
    allowed_env_names: allowedEnvNames,
    runtime_auth_env_names: runtimeAuthEnvNames,
    auto_runtime_auth: agent.auto_runtime_auth !== false,
    config_digest: sha256Value({
      command: agent.command,
      args: agent.args,
      adapter,
      allowed_env_names: allowedEnvNames,
      runtime_auth_env_names: runtimeAuthEnvNames,
      auto_runtime_auth: agent.auto_runtime_auth !== false
    })
  };
  writeConfig(home, config);
  return config.agents[agent.id];
}

export function removeAgent(home, id) {
  const config = readConfig(home);
  if (!(id in config.agents)) return false;
  delete config.agents[id];
  writeConfig(home, config);
  return true;
}

export function addSurface(home, surface) {
  requireId(surface.id, "surface id");
  const config = readConfig(home);
  config.collaboration_surfaces[surface.id] = {
    id: surface.id,
    display_name: surface.display_name ?? surface.id,
    kind: surface.kind ?? "other",
    transport: surface.transport ?? "ndjson",
    available: true
  };
  writeConfig(home, config);
  return config.collaboration_surfaces[surface.id];
}

export function removeSurface(home, id) {
  const config = readConfig(home);
  if (!(id in config.collaboration_surfaces)) return false;
  delete config.collaboration_surfaces[id];
  writeConfig(home, config);
  return true;
}

export function runPaths(home, runId) {
  requireId(runId, "run id");
  const base = paths(home);
  const root = join(base.runs, runId);
  return {
    root,
    manifest: join(root, "manifest.json"),
    events: join(root, "events"),
    workspaces: join(root, "workspaces"),
    result: join(root, "result.json"),
    reportMd: join(root, "report.md"),
    reportHtml: join(root, "report.html"),
    terminal: join(root, "terminal.json")
  };
}

/**
 * Holds a run's writer lock for the duration of `body`.
 *
 * Two processes appending to one run interleave events and can both commit a terminal, and the
 * second one loses without either being told. `wx` is the whole mechanism: creating the file is
 * the acquisition, and it fails if someone holds it.
 *
 * A lock whose owner is gone is broken rather than honoured. A crash would otherwise make the run
 * permanently unwritable, and the operator's only repair would be to delete a file nobody told
 * them about.
 */
export function withRunLock(home, runId, body) {
  const p = runPaths(home, runId);
  const lock = join(p.root, "run.lock");
  let descriptor;
  try {
    descriptor = openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const holder = Number.parseInt(readFileSync(lock, "utf8").trim(), 10);
    // Including this process. Exempting our own pid let a re-entrant call walk through the lock,
    // and its `finally` then deleted the lock the outer caller was still holding -- so the guard
    // removed itself at exactly the moment two writers existed.
    if (Number.isInteger(holder) && isAlive(holder)) {
      throw new Error(`AOS_RUN_LOCKED ${runId} held by pid ${holder}`);
    }
    rmSync(lock, { force: true });
    descriptor = openSync(lock, "wx", 0o600);
  }
  try {
    writeFileSync(descriptor, String(process.pid), "utf8");
    return body();
  } finally {
    try { closeSync(descriptor); } catch {}
    rmSync(lock, { force: true });
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists and belongs to someone else, which still counts as held.
    return error?.code === "EPERM";
  }
};

export function createRun(home, manifest) {
  initHome(home);
  const runId = manifest.run_id ?? makeId("run");
  const p = runPaths(home, runId);
  if (existsSync(p.root)) throw new Error(`AOS_RUN_EXISTS ${runId}`);
  mkdirSync(p.events, { recursive: true });
  mkdirSync(p.workspaces, { recursive: true });
  writeJson(p.manifest, { ...manifest, run_id: runId, created_at: new Date().toISOString() });
  return { runId, paths: p };
}

function projectPayload(type, payload) {
  const allowed = EVENT_PAYLOAD_ALLOWLIST[type] ?? [];
  if (!payload || typeof payload !== "object") return null;
  const result = {};
  for (const key of allowed) {
    const value = payload[key];
    const strings = typeof value === "string" ? [value] : Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
    if (strings.some((entry) => entry.length > 512) || containsSecretLike(strings)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((entry) => typeof entry === "string"))) {
      result[key] = value;
    }
  }
  return Object.keys(result).length === 0 ? null : result;
}

export function appendEvent(home, runId, producerId, event) {
  requireId(producerId, "producer id");
  const p = runPaths(home, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  if (existsSync(p.terminal)) throw new Error(`AOS_RUN_TERMINAL ${runId}`);
  const file = join(p.events, `${producerId}.ndjson`);
  let sequence = 1;
  if (existsSync(file)) sequence = readFileSync(file, "utf8").split("\n").filter(Boolean).length + 1;
  const record = {
    schema_id: "aos-event",
    schema_version: "aos-event.v1",
    event_id: event.event_id ?? makeId("event"),
    run_id: runId,
    producer_id: producerId,
    producer_seq: sequence,
    event_type: event.event_type,
    parent_event_id: event.parent_event_id ?? null,
    correlation_id: event.correlation_id ?? makeId("corr"),
    agent_profile_id: event.agent_profile_id ?? null,
    family: event.family ?? null,
    observed_at: new Date().toISOString(),
    evidence_digest: event.evidence_digest ?? null,
    redaction_state: event.payload ? "projected" : "none",
    payload: projectPayload(event.event_type, event.payload)
  };
  appendNdjson(file, record);
  return record;
}

export function readEvents(home, runId) {
  const p = runPaths(home, runId);
  if (!existsSync(p.events)) return [];
  const events = [];
  for (const file of readdirSync(p.events).filter((name) => name.endsWith(".ndjson")).sort()) {
    const full = join(p.events, file);
    repairTornTrailingNdjson(full);
    const text = readFileSync(full, "utf8");
    const lines = text.split("\n").filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      try {
        events.push(JSON.parse(lines[index]));
      } catch {
        throw new Error(`AOS_RUN_CORRUPTED ${file} line ${index + 1}`);
      }
    }
  }
  const ids = new Map();
  for (const event of events) {
    const bytes = canonicalJson(event);
    if (ids.has(event.event_id) && ids.get(event.event_id) !== bytes) throw new Error(`AOS_CONFLICTING_EVENT ${event.event_id}`);
    ids.set(event.event_id, bytes);
  }
  const unique = [...new Map(events.map((event) => [event.event_id, event])).values()];
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

export function writeResult(home, runId, result, markdown, html) {
  const p = runPaths(home, runId);
  writeJson(p.result, result);
  atomicWrite(p.reportMd, markdown);
  atomicWrite(p.reportHtml, html);
}

export function commitTerminal(home, runId, terminal) {
  const p = runPaths(home, runId);
  const existing = readJsonIfExists(p.terminal);
  if (existing !== null) {
    if (canonicalJson(existing) === canonicalJson(terminal)) return existing;
    throw new Error("AOS_TERMINAL_ALREADY_COMMITTED");
  }
  writeJson(p.terminal, terminal);
  return terminal;
}

/**
 * Rewrites a run's reports when they do not match the result.
 *
 * The reports are a projection of result.json, so the result is the authority and a report that
 * disagrees with it is stale rather than a second opinion. The renderers are deterministic, which
 * is what makes "does it match" answerable without storing a digest for it.
 */
export function regenerateReports(home, runId, render) {
  const p = runPaths(home, runId);
  const result = readJsonIfExists(p.result);
  if (result === null || typeof render !== "function") return { regenerated: false, reason: "no result" };
  // A recover that dies because one report could not be drawn has failed at the job it exists for.
  // The terminal still gets committed; the reports say they could not be rebuilt.
  let rendered;
  try {
    rendered = render(result);
  } catch (error) {
    return { regenerated: false, reason: `render failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const { markdown, html } = rendered;
  const current = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);
  if (current(p.reportMd) === markdown && current(p.reportHtml) === html) {
    return { regenerated: false, reason: "reports match the result" };
  }
  atomicWrite(p.reportMd, markdown);
  atomicWrite(p.reportHtml, html);
  return { regenerated: true, reason: "reports did not match the result" };
}

export function recoverRun(home, runId, render) {
  const p = runPaths(home, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  const result = readJsonIfExists(p.result);
  const reports = regenerateReports(home, runId, render);
  const terminal = readJsonIfExists(p.terminal);
  if (terminal !== null) {
    if (result !== null) {
      const expected = sha256Value(result);
      if (terminal.result_digest !== expected) return { run_id: runId, action: "INVALID", reason: "terminal/result digest mismatch" };
    } else if (terminal.result_digest !== null) {
      return { run_id: runId, action: "INVALID", reason: "terminal binds a missing result" };
    }
    return { run_id: runId, action: "NO_RESCORE", terminal, reports };
  }
  if (result !== null) {
    const recovered = commitTerminal(home, runId, { run_id: runId, status: result.status ?? "DIAGNOSTIC_ONLY", result_digest: sha256Value(result), committed_at: new Date().toISOString() });
    return { run_id: runId, action: "COMMIT_TERMINAL_ONCE", terminal: recovered, reports };
  }
  const aborted = commitTerminal(home, runId, { run_id: runId, status: "ABORTED", result_digest: null, committed_at: new Date().toISOString() });
  return { run_id: runId, action: "ABORTED", terminal: aborted, reports };
}

/**
 * Every run, oldest first.
 *
 * By when it was created, not by its name. A run id is a uuid, so sorting by name is sorting by
 * nothing -- and every caller here reads this list as if it were in order: the dashboard lists
 * runs, the cycle looks for the one that just appeared, `session list` shows a history. One of
 * them recorded the first run's score against every seed in a cycle because "the first" and "the
 * newest" happened to be unrelated.
 *
 * A run whose manifest cannot be read sorts by name, at the end. It is broken, and guessing a
 * position for it would put a damaged record in the middle of a history.
 */
export function listRuns(home) {
  const p = paths(home);
  if (!existsSync(p.runs)) return [];
  const names = readdirSync(p.runs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  // Read defensively. A damaged manifest is exactly the situation in which somebody reaches for the
  // dashboard or for `session recover`, and one unreadable file taking down every command that
  // lists runs would break the tools at the moment they are needed.
  const createdAt = new Map(
    names.map((name) => {
      try {
        return [name, readJsonIfExists(join(p.runs, name, "manifest.json"))?.created_at ?? null];
      } catch {
        return [name, null];
      }
    })
  );
  return names.sort((a, b) => {
    const left = createdAt.get(a);
    const right = createdAt.get(b);
    if (left === right) return a.localeCompare(b);
    if (left === null) return 1;
    if (right === null) return -1;
    return left.localeCompare(right) || a.localeCompare(b);
  });
}

export function readRun(home, runId) {
  const p = runPaths(home, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  return {
    paths: p,
    manifest: readJson(p.manifest),
    result: readJsonIfExists(p.result),
    terminal: readJsonIfExists(p.terminal),
    events: readEvents(home, runId)
  };
}

