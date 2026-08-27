import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  "import.received": ["source", "count"],
  "bridge.received": ["source", "count"],
  "surface.registered": ["surface_id", "kind", "transport"],
  "surface.removed": ["surface_id"]
};

export function paths(cwd) {
  const root = join(resolve(cwd), ".aos");
  return { root, config: join(root, "agents.json"), runs: join(root, "runs") };
}

export function defaultConfig() {
  return { schema_id: CONFIG_SCHEMA, agents: {}, collaboration_surfaces: {} };
}

export function initProject(cwd) {
  const p = paths(cwd);
  mkdirSync(p.runs, { recursive: true });
  if (!existsSync(p.config)) writeJson(p.config, defaultConfig());
  const gitignore = join(resolve(cwd), ".gitignore");
  const existing = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (!existing.split(/\r?\n/).includes(".aos/")) atomicWrite(gitignore, `${existing.replace(/\s*$/, "")}\n.aos/\n`);
  return p;
}

export function readConfig(cwd) {
  const p = initProject(cwd);
  const config = readJson(p.config);
  if (config.schema_id !== CONFIG_SCHEMA || typeof config.agents !== "object") throw new Error("AOS_INVALID_CONFIG");
  return config;
}

export function writeConfig(cwd, config) {
  const p = initProject(cwd);
  writeJson(p.config, config);
}

export function addAgent(cwd, agent) {
  requireId(agent.id, "agent id");
  const config = readConfig(cwd);
  config.agents[agent.id] = {
    id: agent.id,
    display_name: agent.display_name ?? agent.id,
    runtime_name: agent.runtime_name ?? agent.id,
    vendor: agent.vendor ?? null,
    command: agent.command,
    args: agent.args,
    adapter: "generic-command",
    config_digest: sha256Value({ command: agent.command, args: agent.args })
  };
  writeConfig(cwd, config);
  return config.agents[agent.id];
}

export function removeAgent(cwd, id) {
  const config = readConfig(cwd);
  if (!(id in config.agents)) return false;
  delete config.agents[id];
  writeConfig(cwd, config);
  return true;
}

export function addSurface(cwd, surface) {
  requireId(surface.id, "surface id");
  const config = readConfig(cwd);
  config.collaboration_surfaces[surface.id] = {
    id: surface.id,
    display_name: surface.display_name ?? surface.id,
    kind: surface.kind ?? "other",
    transport: surface.transport ?? "ndjson",
    available: true
  };
  writeConfig(cwd, config);
  return config.collaboration_surfaces[surface.id];
}

export function removeSurface(cwd, id) {
  const config = readConfig(cwd);
  if (!(id in config.collaboration_surfaces)) return false;
  delete config.collaboration_surfaces[id];
  writeConfig(cwd, config);
  return true;
}

export function runPaths(cwd, runId) {
  requireId(runId, "run id");
  const base = paths(cwd);
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

export function createRun(cwd, manifest) {
  initProject(cwd);
  const runId = manifest.run_id ?? makeId("run");
  const p = runPaths(cwd, runId);
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

export function appendEvent(cwd, runId, producerId, event) {
  requireId(producerId, "producer id");
  const p = runPaths(cwd, runId);
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

export function readEvents(cwd, runId) {
  const p = runPaths(cwd, runId);
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

export function writeResult(cwd, runId, result, markdown, html) {
  const p = runPaths(cwd, runId);
  writeJson(p.result, result);
  atomicWrite(p.reportMd, markdown);
  atomicWrite(p.reportHtml, html);
}

export function commitTerminal(cwd, runId, terminal) {
  const p = runPaths(cwd, runId);
  const existing = readJsonIfExists(p.terminal);
  if (existing !== null) {
    if (canonicalJson(existing) === canonicalJson(terminal)) return existing;
    throw new Error("AOS_TERMINAL_ALREADY_COMMITTED");
  }
  writeJson(p.terminal, terminal);
  return terminal;
}

export function recoverRun(cwd, runId) {
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
  const p = paths(cwd);
  if (!existsSync(p.runs)) return [];
  return readdirSync(p.runs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function readRun(cwd, runId) {
  const p = runPaths(cwd, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  return {
    paths: p,
    manifest: readJson(p.manifest),
    result: readJsonIfExists(p.result),
    terminal: readJsonIfExists(p.terminal),
    events: readEvents(cwd, runId)
  };
}

export function deleteRun(cwd, runId) {
  const p = runPaths(cwd, runId);
  rmSync(p.root, { recursive: true, force: true });
}
