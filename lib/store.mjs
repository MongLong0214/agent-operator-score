import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { appendNdjson, atomicWrite, canonicalJson, containsSecretLike, makeId, readJson, readJsonIfExists, repairTornTrailingNdjson, requireId, sha256Value, writeJson } from "./core.mjs";
import { OPERATOR_PRODUCER, admitOperatorEvent, isOperatorAuthorityType, recordBindingOf, refusalForSource } from "./operator-events.mjs";

const CONFIG_SCHEMA = "aos-config.v1";
const EVENT_PAYLOAD_ALLOWLIST = {
  "assessment.started": ["mode", "suite"],
  "assessment.ended": ["status"],
  "user.instruction": ["agent_profile_id", "family", "stage", "instruction_digest", "instruction_length", "previous_instruction_digest"],
  // The instruction AOS sends to carry out the plan, which is not an operator turn and is no longer
  // typed as one. It used to be recorded as `user.instruction` under producer `operator`, so the
  // shipped template's own sentences were filed as things the user said -- an AOS default converted
  // into operator evidence, which is the defect #560 exists for. `observeInterventions` still reads
  // it as the baseline an operator's own instruction is compared against, and it is never scored.
  "plan.instruction": ["agent_profile_id", "family", "stage", "instruction_digest", "instruction_length"],
  // What was refused, and why. A forged operator event that vanished silently would leave the run
  // looking like one where nothing tried: absence is not the same fact as a refusal.
  "operator.event.refused": ["family", "refused_type", "source", "reason"],
  "agent.started": ["agent_profile_id", "family", "stage"],
  "agent.ended": ["agent_profile_id", "family", "stage", "ok", "exit_code", "timed_out", "duration_ms", "stdout_bytes", "stderr_bytes", "stdout_digest", "stderr_digest"],
  "handoff.created": ["from", "to", "family", "artifact_digests"],
  "handoff.consumed": ["from", "to", "family", "artifact_digests"],
  "completion.claimed": ["family", "claim"],
  "verification.completed": ["family", "verdict", "evidence_digest"],
  "safety.event": ["family", "level", "kind"],
  "session.cancelled": ["reason"],
  // A run ended by the `session cancel` command. AOS can witness that the command was run; it cannot
  // witness who ran it, and anything with a shell can. So the run's own lifecycle is recorded and
  // nothing claims an operator turn -- `session.cancelled` above stays the turn an operator took
  // inside a run, at a checkpoint, on a channel this instrument could name.
  "run.cancelled": ["reason", "channel"],
  // AOS stopped and asked. Its own act, recorded whether or not anybody answered and whatever the
  // channel was: a run where the instrument offered an opportunity and nobody took it is a different
  // run from one that never offered, and only `checkpoint.raised` below is a claim about a person.
  "checkpoint.offered": ["family", "kind", "detail", "evidence_digest"],
  // Raised by AOS at a moment it can point to. The payload the operator was shown is kept, bounded
  // at the source: a digest over evidence the record does not hold is a claim of checkability that
  // nothing can honour, and a run whose checkpoints cannot say what they showed cannot be reviewed.
  "checkpoint.raised": ["family", "kind", "detail", "output", "calls", "evidence_digest"],
  // The operator's own routing decision, made at a checkpoint. Its state change is already carried by
  // the `operator.decision` beside it; this exists so that D3 has a declared route to compare the
  // invocations against, bound to the opportunity the decision was made in.
  "operator.route": ["family", "stage", "from", "to"],
  // Recorded when an operator acts during a run. `choice` is kept for the reader and is never a
  // scoring input -- what is scored is the state change that followed it.
  "operator.decision": ["family", "kind", "choice", "evidence_digest", "route_changed", "instruction_digest", "inspected"],
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
  // Proxy and certificate names are approved separately from the rest, so they are stored
  // separately and digested separately. A run whose traffic could have been redirected or whose
  // TLS could have been terminated elsewhere is not the same environment as one that could not.
  const transportEnvNames = [...new Set(agent.transport_env_names ?? [])].sort();
  const adapter = agent.adapter ?? "generic-command.v1";
  // Recorded by the caller, which is the only place that can read the filesystem at the moment the
  // operator registers the agent. Stored as given and never invented here: an identity this
  // function made up would be a verification nobody performed. Null means the agent predates the
  // record, which the credential gate reads as MIGRATION_REQUIRED rather than as permission.
  const runtimeIdentity = agent.runtime_identity ?? null;
  // What the operator says the model is. Stored as given: whether it is exact, an alias, or
  // contradicted by the command line is the profile's judgement (#561), made every time the agent
  // is bound, not a fact this function could settle once. Null is "not declared", never a default.
  const modelId = typeof agent.model_id === "string" && agent.model_id !== "" ? agent.model_id : null;
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
    transport_env_names: transportEnvNames,
    auto_runtime_auth: agent.auto_runtime_auth !== false,
    runtime_identity: runtimeIdentity,
    model_id: modelId,
    config_digest: sha256Value({
      command: agent.command,
      args: agent.args,
      adapter,
      allowed_env_names: allowedEnvNames,
      runtime_auth_env_names: runtimeAuthEnvNames,
      transport_env_names: transportEnvNames,
      auto_runtime_auth: agent.auto_runtime_auth !== false,
      // Which executable this command was verified to be. A configuration that names the same
      // command while the program behind it changed is not the same configuration.
      runtime_identity_digest: runtimeIdentity?.identity_digest ?? null,
      // The declared model is part of what this agent is: the same command declared as two
      // different models is two registrations, and their runs must not share a digest.
      model_id: modelId
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

/**
 * Where a run's workspaces live, which is deliberately not inside the store.
 *
 * An agent runs with its workspace as its working directory, so a workspace under `AOS_HOME`
 * hands it the store's path through `getcwd` -- the disclosure #556 forbids, and one no
 * environment filtering can take back. The store keeps AOS's own records; the workspaces sit in
 * their own root beside it, named so that the store's path is not a prefix of theirs. The boundary
 * denies that root by name and grants back only the one workspace of the run in hand, so a run
 * still cannot read another run's workspace.
 */
export function workspacesRoot(home) {
  const root = canonical(resolve(home));
  const override = process.env.AOS_WORKSPACES;
  const chosen = typeof override === "string" && override.length > 0
    ? canonical(resolve(override))
    : join(dirname(root), `${basename(root).replace(/^\./u, "")}-workspaces`);
  // Canonical, and refused when it lands inside the store however it was spelled. A symlinked
  // override -- `AOS_WORKSPACES=/tmp/ws` where `/tmp/ws -> <store>/workspaces` -- looks outside the
  // store to a string comparison and is inside it to the kernel, which is the cwd disclosure this
  // root exists to prevent.
  if (chosen === root || chosen.startsWith(`${root}/`) || root.startsWith(`${chosen}/`)) {
    throw new Error(`AOS_WORKSPACES_INSIDE_STORE ${chosen} resolves inside ${root}`);
  }
  return chosen;
}

// The path the kernel would use. A path that does not exist yet is its own answer: the parents that
// do exist are resolved, so a link anywhere above it is followed even before the leaf is created.
function canonical(path) {
  let at = path;
  const trail = [];
  for (let hops = 0; hops < 64; hops += 1) {
    try { return trail.length === 0 ? realpathSync(at) : join(realpathSync(at), ...trail); } catch {}
    const parent = dirname(at);
    if (parent === at) return path;
    trail.unshift(basename(at));
    at = parent;
  }
  return path;
}

export function runPaths(home, runId) {
  requireId(runId, "run id");
  const base = paths(home);
  const root = join(base.runs, runId);
  return {
    root,
    manifest: join(root, "manifest.json"),
    events: join(root, "events"),
    // Outside the store: see `workspacesRoot`. Still one directory per run, so a run's workspaces
    // are removed together with it and a sibling run's are a directory the boundary denies.
    //
    // #560's rule survives the move and is strengthened by it. The assessed agent works in the
    // workspace as the same user, so anything within reach of that directory is within reach of the
    // thing being measured -- which is why nothing kept in the store may be a credential, the rule
    // the run key obeys and `tests/product/no-agent-artifact-process-credit.test.mjs` walks the home
    // to hold. Since #556 the workspace is not under the home at all: the agent's reach and the
    // store are separate trees, and the Seatbelt profile denies the store by name.
    workspaces: join(workspacesRoot(home), runId),
    result: join(root, "result.json"),
    // The run's working record: what the store keeps about how the run went. Separate from the
    // result because the result is the artifact an operator publishes and this is not -- it holds
    // the suite manifest, the per-agent environment and the operator's own plan projection.
    record: join(root, "record.json"),
    reportMd: join(root, "report.md"),
    reportHtml: join(root, "report.html"),
    // The shareable one. A self-contained SVG with no external reference, so it survives being dragged
    // into Slack or committed to a repository -- the only sharing a local-only tool can honestly offer.
    card: join(root, "card.svg"),
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
  operatorRunKey(home, runId, { create: true });
  writeJson(p.manifest, { ...manifest, run_id: runId, created_at: new Date().toISOString() });
  return { runId, paths: p };
}

/**
 * The keys, in this process's memory, for the lifetime of this process. Never on disk.
 *
 * The first version wrote `<run>/operator.key` at 0600 under a 0700 home, and that was wrong in a
 * way the mode bits cannot fix. `lib/cli.mjs` runs the assessed agent in `<run>/workspaces/<family>`
 * as the same user, so `$AOS_WORKSPACE/../../operator.key` was one relative path from the process
 * the key exists to keep out -- and the review read it, minted three correctly bound records, and
 * appended them to `<run>/events/operator.ndjson`, where the reader accepted all three.
 *
 * Placement could not have fixed it. Anywhere under the operator's home is reachable by the same
 * user, and moving the workspace elsewhere leaves the run id in the workspace path. What fixes it is
 * that there is nothing to read: the secret exists only in the address space of the process that is
 * both minting and checking, and a process that could read that address space could already do
 * everything AOS can do.
 *
 * The scope this buys, stated plainly: the binding proves a record was produced by the AOS process
 * that created this run's secret, and it is checked inside that process. That is exactly what the
 * defect needed -- the assessed agent is a different process, and it can no longer produce a record
 * the scorer accepts. It is not a signature over anybody's identity and does not survive the
 * process, which is why `attestedOperatorTrace` refuses a trace read under a key it did not mint.
 */
const operatorKeys = new Map();

export function operatorRunKey(home, runId, { create = false } = {}) {
  // Keyed by the resolved home as well as the run, so two homes in one test process cannot share a
  // key and read each other's records as attested.
  const key = `${paths(home).root}\u0000${runId}`;
  // Minted once, by the process that creates the run, and never on demand. Minting on demand meant a
  // second process asking for the same run got a different key, so every genuine record it read came
  // back as tampering -- a key epoch nobody chose, reported as a forgery. A process that holds no
  // key for a run says so with null, and `attestedOperatorTrace` says what that means.
  if (create && !operatorKeys.has(key)) operatorKeys.set(key, randomBytes(32).toString("hex"));
  return operatorKeys.get(key) ?? null;
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

/**
 * Records one event, and refuses to record an operator act on anything else's word.
 *
 * The gate is here because this is the one function every write path goes through: agent stdout via
 * `AOS_EVENT`, a plugin's output on the same route, `aos import`, `aos bridge` and AOS's own
 * checkpoint runtime. Closing it at each of those would have been five decisions to keep in step,
 * and the review that found this hole found it after three of them had already been fixed
 * separately.
 *
 * `source` is the call site's own declaration and is never read off the event: the event arrived
 * from the thing being checked. The import and bridge paths declare nothing, which is why a forged
 * `operator.decision` on their line is refused by name rather than by luck.
 */
export function appendEvent(home, runId, producerId, event, { source = null } = {}) {
  requireId(producerId, "producer id");
  const p = runPaths(home, runId);
  if (!existsSync(p.manifest)) throw new Error(`AOS_RUN_NOT_FOUND ${runId}`);
  if (existsSync(p.terminal)) throw new Error(`AOS_RUN_TERMINAL ${runId}`);
  let operatorEvent = null;
  let operatorAuthority = null;
  if (isOperatorAuthorityType(event.event_type)) {
    if (producerId !== OPERATOR_PRODUCER) {
      throw new Error(`AOS_NOT_OPERATOR_AUTHORITY ${event.event_type} from ${producerId}: ${refusalForSource(source)}`);
    }
    const verdict = admitOperatorEvent({ event: event.operator_event, run_id: runId, secret: operatorRunKey(home, runId, { create: true }), source });
    if (!verdict.accepted) throw new Error(`AOS_NOT_OPERATOR_AUTHORITY ${event.event_type} from ${producerId}: ${verdict.reason}`);
    operatorEvent = verdict.event;
    operatorAuthority = verdict.authority;
  }
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
  // Attached only where it means something. Every other record keeps the shape it has always had,
  // so a reader can tell an event that was never subject to this gate from one that passed it.
  if (operatorEvent !== null) {
    record.operator_event = operatorEvent;
    record.operator_authority = operatorAuthority;
    // Taken after the payload has been projected, so what is bound is the bytes a reader will read.
    // The event signs itself; this signs the record it arrived on, which is what the scorer reads.
    record.operator_record_binding = recordBindingOf(record, operatorRunKey(home, runId, { create: true }));
  }
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

export function writeResult(home, runId, result, markdown, html, card = null) {
  const p = runPaths(home, runId);
  writeJson(p.result, result);
  atomicWrite(p.reportMd, markdown);
  atomicWrite(p.reportHtml, html);
  if (typeof card === "string" && card.length > 0) atomicWrite(p.card, card);
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
 * Rewrites a run's projections when they do not match the result.
 *
 * The reports are a projection of result.json, so the result is the authority and a report that
 * disagrees with it is stale rather than a second opinion. The renderers are deterministic, which
 * is what makes "does it match" answerable without storing a digest for it.
 *
 * Every projection the run has, not the two this function was first written for. The card was
 * outside the comparison and outside the recovery callback, so a deleted or edited `card.svg` was
 * reported as "reports match the result" -- a projection nobody was checking is a projection that
 * can say anything, and the card is the one most likely to be forwarded on its own. A file that is
 * missing counts as disagreeing: what the result projects to is what the run should hold.
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
  const current = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);
  const projections = [
    ["report.md", p.reportMd, rendered.markdown],
    ["report.html", p.reportHtml, rendered.html],
    ["card.svg", p.card, rendered.card]
  ].filter(([, , drawn]) => typeof drawn === "string" && drawn.length > 0);
  const stale = projections.filter(([, file, drawn]) => current(file) !== drawn);
  if (stale.length === 0) return { regenerated: false, reason: "reports match the result" };
  for (const [, file, drawn] of stale) atomicWrite(file, drawn);
  return { regenerated: true, reason: `did not match the result: ${stale.map(([name]) => name).join(", ")}` };
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

