import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, uptime } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { appendNdjson, atomicWrite, canonicalJson, containsSecretLike, makeId, readJson, readJsonIfExists, repairTornTrailingNdjson, requireId, sha256Value, writeJson } from "./core.mjs";
import { OPERATOR_PRODUCER, admitOperatorEvent, isOperatorAuthorityType, recordBindingOf, refusalForSource } from "./operator-events.mjs";
import { finalizeExposure } from "./exposure-finalization.mjs";
import { renderHtml, renderMarkdown } from "./report.mjs";
import { renderCard } from "./report-card.mjs";

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
  // #557. What the run was observed to have actually done, recorded beside the number it produced.
  // Ids, classes and digests only: an effect event names its target by digest, so this is
  // publishable and still joins to the `evidence_ids` the safety metric carries on the result.
  "safety.effects_observed": ["collectors", "observation_digest", "effect_event_ids", "cells", "coverage", "cap_trigger_cells"],
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
    // One atomically replaced record holds both the authenticated entries and their signed head.
    // Splitting the head into a sibling file would let a crash leave a tail and its commitment from
    // different writes, which is a state this instrument never observed.
    relianceTrace: join(root, "reliance-trace.json"),
    reportMd: join(root, "report.md"),
    reportHtml: join(root, "report.html"),
    // The shareable one. A self-contained SVG with no external reference, so it survives being dragged
    // into Slack or committed to a repository -- the only sharing a local-only tool can honestly offer.
    card: join(root, "card.svg"),
    terminal: join(root, "terminal.json")
  };
}

// Publish only a complete, durable owner record. A hard link is exclusive (EEXIST), whereas
// rename would overwrite a live owner's lock. A crash before publication can leave a private
// candidate, but cannot leave an empty resource lock blocking the next writer.
function publishLock(lockPath) {
  const candidate = `${lockPath}.owner-${process.pid}-${randomBytes(12).toString("hex")}`;
  const descriptor = openSync(candidate, "wx", 0o600);
  try {
    writeFileSync(descriptor, canonicalJson(lockRecord()), "utf8");
    fsyncSync(descriptor);
    linkSync(candidate, lockPath);
  } finally {
    closeSync(descriptor);
    rmSync(candidate, { force: true });
  }
}

/**
 * Holds an exclusive lock at `lockPath` for the duration of `body`. Publishing the owner record
 * is the acquisition, and fails if someone holds it.
 *
 * A lock whose owner is gone is broken rather than honoured. A crash would otherwise make the
 * locked resource permanently unwritable, and the operator's only repair would be to delete a
 * file nobody told them about. Shared by `withRunLock` and `withExposureLedgerLock` (#585) rather
 * than reimplemented for each lockable resource, per `buildLockedError`'s own message.
 */
function withLock(lockPath, buildLockedError, buildUnadjudicableError, body) {
  try {
    publishLock(lockPath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let rawHeld = null;
    let heldMtimeMs = null;
    // Both observations share one disappearance answer. The holder can release before either
    // read or stat; ENOENT cannot reach owner adjudication, regardless of which call observed it.
    try {
      rawHeld = readFileSync(lockPath, "utf8");
      heldMtimeMs = statSync(lockPath).mtimeMs;
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(buildLockedError("acquiring"));
      // An I/O refusal is not evidence that the owner disappeared.
      rawHeld = null;
    }
    // Legacy writers exposed an empty file between open and write. Its bytes cannot distinguish
    // a paused acquisition from a dead one: age is a bounded compatibility grace, NOT proof of
    // death. After 5 seconds allow recovery instead of permanent refusal. A legacy binary paused
    // longer than that is not protected by this grace; current writers publish atomically above
    // and never expose this shape, even when interrupted before the owner record is written.
    const emptyHeld = rawHeld !== null && rawHeld.trim() === "";
    if (emptyHeld && Date.now() - heldMtimeMs < 5_000) {
      throw new Error(buildLockedError("acquiring"));
    }
    const held = parseLockRecord(rawHeld);
    // Including this process. Exempting our own pid let a re-entrant call walk through the lock,
    // and its `finally` then deleted the lock the outer caller was still holding -- so the guard
    // removed itself at exactly the moment two writers existed.
    if (held !== null && Number.isInteger(held.pid) && isAlive(held.pid)) {
      throw new Error(buildLockedError(held.pid));
    }
    // For nonempty records, a dead pid alone cannot place the owner on this host and boot.
    // Same-boot and provably earlier-boot records on this host are reclaimable. Other hosts,
    // absent boot identity and unreadable nonempty records retain the ledger's refusal; the
    // bounded empty-file exception above says nothing about those owners.
    if (!emptyHeld && (held === null || held.host !== bootHost() || !(sameBoot(held.boot_instant) || earlierBoot(held.boot_instant)))) {
      if (buildUnadjudicableError !== null) {
        const why = held === null ? "unreadable" : `pid ${held.pid ?? "unknown"} from another host or boot`;
        throw new Error(buildUnadjudicableError(lockPath, why));
      }
    }
    // Reclaiming by unlinking the path and opening it again is two steps with a gap, and both
    // contenders can be inside that gap: one removes the stale lock and creates its own, the second
    // removes THAT one -- a lock it never adjudicated -- and opens its own beside it. Two writers
    // then hold what each believes is the exclusive lock, which is the state this whole function
    // exists to make impossible. The reclaim is instead done by renaming the stale file away:
    // `renameSync` onto a name only this attempt knows either moves the exact bytes we adjudicated
    // or throws because somebody else already moved them, and the loser then finds the winner's
    // fresh lock through exclusive publication rather than deleting it.
    const claim = `${lockPath}.reclaim-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      renameSync(lockPath, claim);
    } catch (raceError) {
      if (raceError?.code !== "ENOENT") throw raceError;
      // `held` is null on the run-lock path, which falls through the unadjudicable branch above
      // rather than throwing there, so reading `held.pid` here was a TypeError on exactly the race
      // this branch exists to report -- the lock message replaced by a crash.
      throw new Error(buildLockedError(held?.pid ?? "unknown"));
    }
    // The bytes we adjudicated have to still be the bytes we moved. If another attempt rewrote the
    // lock between the read above and this rename, we adjudicated a record that no longer describes
    // what we just took away, so it goes back and this attempt refuses rather than proceeding on a
    // decision about a file that changed underneath it.
    let moved = null;
    try { moved = readFileSync(claim, "utf8"); } catch {}
    if (moved !== null && moved !== rawHeld) {
      try { renameSync(claim, lockPath); } catch {}
      if (buildUnadjudicableError !== null) {
        throw new Error(buildUnadjudicableError(lockPath, "its record changed while it was being adjudicated"));
      }
      // A resource with no unadjudicable answer -- the run lock -- still must not walk on after
      // putting the record back. Falling through opened the lock it had just restored, so the very
      // attempt that decided it could not adjudicate the file took it anyway. It is somebody
      // else's lock now, and it says so with its own contended message.
      throw new Error(buildLockedError(held?.pid ?? "unknown"));
    }
    rmSync(claim, { force: true });
    publishLock(lockPath);
  }
  try {
    return body();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

// What a lock says about its owner. The pid alone cannot answer "is this mine to break"; the boot
// identity can, because a pid from a previous boot can never be the process that wrote this file.
// `Date.now()/1000 - uptime()` names the boot instant, but it jitters: flooring the two terms
// separately made it alternate between adjacent seconds inside one process, and even computed once
// per process two processes on the SAME boot can land a second apart. Comparing it for equality
// therefore reported a different boot for locks written seconds earlier, which made a genuinely
// same-boot stale lock unadjudicable and left the ledger wedged until somebody deleted the file by
// hand -- a fail-closed that fires on nothing, which is worse than the guess it replaced because it
// looks like a safety property working.
//
// So the instant is recorded and compared with a tolerance rather than for equality. The tolerance
// is safe in the direction that matters: a live owner is already protected by the `isAlive` check
// above, so this comparison only guards against a pid reused ACROSS a reboot, and no machine
// reboots inside the tolerance and hands out the same pid again. Being slightly too willing to call
// two readings the same boot costs nothing the pid check does not already cover; being too strict
// wedges the ledger, which is what happened.
// Computed on first use and never at import, because `os.uptime()` is not always allowed to
// answer: under a seatbelt sandbox it throws `uv_uptime returned EPERM`, and a top-level const
// calling it took the whole module -- and so every command that stores anything -- down at import
// time. Found by a reviewer running in a sandbox; this machine never sandboxes itself, so nothing
// here would ever have hit it. AOS runs agents under confinement as its main purpose, so AOS
// running inside one is the ordinary case rather than the exotic one.
//
// When the clock cannot be read, the boot instant is unknown rather than wrong. `sameBoot` then
// answers false for everything, which makes every held lock unadjudicable: the exposure ledger
// fails closed, and a run lock breaks the stale file exactly as it did before any of this existed.
// Both are the safe direction for their own resource.
let bootInstantCache;
const bootInstant = () => {
  if (bootInstantCache === undefined) {
    try { bootInstantCache = Date.now() / 1000 - uptime(); }
    catch { bootInstantCache = null; }
  }
  return bootInstantCache;
};
const BOOT_TOLERANCE_SECONDS = 5;
const bootHost = () => hostname();
// A lock whose boot instant is older than ours by more than the drift two processes on one boot
// produce was written before this boot, so its writer is gone: the pid space was replaced when the
// machine restarted, and a reused pid cannot span that. Refusing it was the one case backwards --
// a same-boot dead pid, where reuse IS possible, was already reclaimed, while this one, where the
// writer provably cannot be alive, wedged the home until somebody deleted a path no message names.
//
// "Died mid-transaction and left the resource half-written" is the stated reason to refuse, and it
// cannot happen to what this lock protects: every write goes through `atomicWrite`, which renames a
// fsynced temp file into place. Nothing else widens -- another host may still be running, an
// unreadable record says nothing, and a record carrying no boot instant cannot be placed on any
// boot. Those stay refused.
const earlierBoot = (recorded) => {
  const ours = bootInstant();
  return ours !== null
    && typeof recorded === "number"
    && Number.isFinite(recorded)
    && recorded < ours - BOOT_TOLERANCE_SECONDS;
};
const sameBoot = (recorded) => {
  const ours = bootInstant();
  return ours !== null
    && typeof recorded === "number"
    && Number.isFinite(recorded)
    && Math.abs(recorded - ours) <= BOOT_TOLERANCE_SECONDS;
};
const lockRecord = () => ({ schema_id: "aos-resource-lock.v1", pid: process.pid, host: bootHost(), boot_instant: bootInstant(), nonce: randomBytes(12).toString("hex"), created_at: new Date().toISOString() });
const parseLockRecord = (rawBytes) => {
  if (typeof rawBytes !== "string") return null;
  const raw = rawBytes.trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    // A bare pid is the pre-#585 format. It carries no boot identity, so it is exactly the
    // ambiguous case: readable, but not adjudicable.
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) ? { pid, host: null, boot_instant: null } : null;
  }
};

/**
 * Holds a run's writer lock for the duration of `body`.
 *
 * Two processes appending to one run interleave events and can both commit a terminal, and the
 * second one loses without either being told.
 */
export function withRunLock(home, runId, body) {
  const p = runPaths(home, runId);
  // A run's lock does not carry the exposure ledger's answer. Failing closed protects the ledger,
  // whose whole purpose is that an administration is counted once and a wrong answer is worse than
  // no answer; a run's writer lock protects an append log, where refusing forever is the harm --
  // the pre-#585 bare-pid format, or a lock written before a reboot, would make that run
  // permanently unwritable and the operator's only repair would be deleting a file nobody told
  // them about, which is the failure the original comment on this function names. So a run lock
  // this process cannot adjudicate is broken, exactly as before, and it says so under its own name
  // rather than borrowing the ledger's.
  return withLock(
    join(p.root, "run.lock"),
    (holder) => `AOS_RUN_LOCKED ${runId} held by pid ${holder}`,
    null,
    body
  );
}

// #585. One exposure history per AOS home. The home is the closest thing a local install has to an
// operator identity; the record says that scope rather than pretending to know who typed.
//
// Exported (not left private to one caller) because `exposureVerification` (lib/cycle.mjs) has to
// be checked against this exact file from more than one surface -- the `cycle run` command that
// records a run's verdict and the dashboard that reads a stored cycle back -- and a second, private
// copy of this path in each caller is exactly the drift this repository keeps finding between
// surfaces that are supposed to quote one answer.
export const exposureLedgerPath = (home) => join(home, "exposure-ledger.json");
export const pendingExposurePath = (home, runId) => {
  requireId(runId, "run id");
  return join(home, `exposure-pending-${runId}.json`);
};

const heldExposureHomes = new Set();
const exposureRecoveryError = (error, file, runId) => new Error(
  `AOS_EXPOSURE_RECOVERY_FAILED ${error.message}; pending completion recovery at ${file}; repair the named artifact or I/O failure, then run aos session recover ${runId}`,
  { cause: error }
);
const pendingExposureFiles = (home) => {
  try {
    return existsSync(home) ? readdirSync(home)
      .filter((name) => /^exposure-pending-.+\.json$/u.test(name)).sort()
      .map((name) => join(home, name)) : [];
  } catch (error) {
    throw exposureRecoveryError(error, join(home, "exposure-pending-*.json"), "<id>");
  }
};
const rawExposureLedger = (home) => existsSync(exposureLedgerPath(home)) ? readJson(exposureLedgerPath(home)) : undefined;

const reportExposureRecovery = (message) => process.stderr.write(`${message}\n`);
function quarantineExposurePending(file, error, report) {
  const quarantine = existsSync(`${file}.unreplayable`)
    ? `${file}.unreplayable-${randomBytes(6).toString("hex")}` : `${file}.unreplayable`;
  try {
    renameSync(file, quarantine);
    const directory = openSync(dirname(file), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (failure) {
    throw new Error(`AOS_EXPOSURE_PENDING_QUARANTINE_FAILED ${file} -> ${quarantine}: ${failure.message}; check directory permissions and free space, then retry aos session recover for this run`);
  }
  report(`AOS_EXPOSURE_PENDING_UNREPLAYABLE ${quarantine}: ${error.message}; inspect this file and the run's terminal; restore matching original artifacts before retrying, or remove ${quarantine} when no longer needed. Exposure history has been preserved.`);
}

// Called only under the ledger lock. Keep the signed pending until the ledger, result, working
// record, reports and terminal are all durable. A crash at any intervening rename repeats the
// same publication using the receipt committed in the ledger, without consuming a new revision.
function replayExposureFinalizations(home, report) {
  for (const file of pendingExposureFiles(home)) {
    const runId = basename(file).slice("exposure-pending-".length, -".json".length);
    try {
      try {
        replayExposureFinalization(home, file, runId);
      } catch (error) {
        // Classify the entire replay, including publication. Only malformed JSON in THIS
        // pending file is permanent; damaged ledger JSON and I/O retain the signed completion.
        if (/^(?:AOS_EXPOSURE_PENDING_(?:IDENTITY|SIGNATURE|SCHEMA|CONFLICT)|AOS_TERMINAL_ALREADY_COMMITTED)\b/u.test(error.message)
            || error.message.startsWith(`AOS_MALFORMED_JSON ${file}:`)
            || error.message === "AOS_INVALID_ID run id") {
          quarantineExposurePending(file, error, report);
          continue;
        }
        throw error;
      }
    } catch (error) {
      // Quarantine and reporting can fail too. No per-file operation escapes without its
      // recovery context, even when a rename succeeded before a later write or fsync failed.
      throw exposureRecoveryError(error, file, runId);
    }
  }
}

// This private operation has one caller: the classification/context boundary above. All replay
// work belongs here, so adding a publication step cannot put it after that boundary's catch.
function replayExposureFinalization(home, file, runId) {
  requireId(runId, "run id");
  const ledger = rawExposureLedger(home);
  const pending = readJson(file);
  const completed = finalizeExposure(ledger, pending, runId);
  const terminal = readJsonIfExists(runPaths(home, runId).terminal);
  if (terminal !== null && canonicalJson(terminal) !== canonicalJson(completed.terminal)) {
    throw new Error("AOS_TERMINAL_ALREADY_COMMITTED");
  }
  if (completed.ledger.revision !== ledger.revision) writeJson(exposureLedgerPath(home), completed.ledger);
  writeJson(runPaths(home, runId).record, completed.record);
  writeResult(home, runId, completed.result, renderMarkdown(completed.result), renderHtml(completed.result), renderCard(completed.result));
  if (!existsSync(runPaths(home, runId).terminal)
      && !readEvents(home, runId).some((event) => event.event_type === "assessment.ended")) {
    appendEvent(home, runId, "aos", { event_type: "assessment.ended", payload: { status: completed.terminal.status } });
  }
  commitTerminal(home, runId, completed.terminal);
  rmSync(file, { force: true });
}

// `readJsonIfExists` returns `null` both when the file is absent and when it holds the JSON literal
// `null` -- exactly the ambiguity `openExposureLedger` must not have, since only the first of those
// is a home that never administered anything. `undefined` here means "no file"; whatever the file
// held otherwise, including `null`, is handed on unchanged for `openExposureLedger` to judge.
export function readExposureLedgerFile(home) {
  recoverExposureFinalizations(home);
  return rawExposureLedger(home);
}

export function recoverExposureFinalizations(home, { report = reportExposureRecovery } = {}) {
  if (!heldExposureHomes.has(resolve(home)) && pendingExposureFiles(home).length > 0) {
    withExposureLedgerLock(home, () => {}, { report });
  }
}

/**
 * Holds the exposure ledger's writer lock for the duration of `body` (#585).
 *
 * The ledger is one file shared by every `aos assess` invocation against a home, read, classified
 * and rewritten as a whole on every administration. Two processes racing that read-modify-write
 * can each read the same prior entries and each write back a ledger missing the other's
 * administration -- an unlocked whole-file update silently losing exposure history, which is the
 * concurrency half of the scored-once policy this ledger exists to hold.
 */
export function withExposureLedgerLock(home, body, { report = reportExposureRecovery } = {}) {
  return withLock(
    join(paths(home).root, "exposure-ledger.lock"),
    (holder) => `AOS_EXPOSURE_LEDGER_LOCKED held by pid ${holder}`,
    (lockPath, why) => `AOS_EXPOSURE_LOCK_UNAVAILABLE ${lockPath} is held by a record this process cannot adjudicate (${why}); refusing rather than reclaiming a lock whose owner may still be running under a reused pid`,
    () => {
      const root = resolve(home);
      heldExposureHomes.add(root);
      try {
        replayExposureFinalizations(home, report);
        return body();
      } finally { heldExposureHomes.delete(root); }
    }
  );
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
  instrumentRunKey(home, runId, { create: true });
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
const instrumentKeys = new Map();

const runKeyName = (home, runId) => `${paths(home).root}\u0000${runId}`;

export function operatorRunKey(home, runId, { create = false } = {}) {
  // Keyed by the resolved home as well as the run, so two homes in one test process cannot share a
  // key and read each other's records as attested.
  const key = runKeyName(home, runId);
  // Minted once, by the process that creates the run, and never on demand. Minting on demand meant a
  // second process asking for the same run got a different key, so every genuine record it read came
  // back as tampering -- a key epoch nobody chose, reported as a forgery. A process that holds no
  // key for a run says so with null, and `attestedOperatorTrace` says what that means.
  if (create && !operatorKeys.has(key)) operatorKeys.set(key, randomBytes(32).toString("hex"));
  return operatorKeys.get(key) ?? null;
}

/**
 * The distinct key held by the assessment instrument for reliance observations.
 *
 * Operator-event bindings and instrument observations answer different questions, so sharing the
 * operator key here would let the process allowed to attest an operator decision also author the
 * oracle/outcome sequence that grades it.  Like the operator key, this capability is memory-only
 * and is never minted on a later read of an existing run.
 */
export function instrumentRunKey(home, runId, { create = false } = {}) {
  const key = runKeyName(home, runId);
  if (create && !instrumentKeys.has(key)) instrumentKeys.set(key, randomBytes(32).toString("hex"));
  return instrumentKeys.get(key) ?? null;
}

/**
 * The production reliance journal for one run.
 *
 * A single atomic record keeps entries and their signed head together.  `record` has the same
 * narrow interface as the in-memory test journal: a null entry initialises the signed empty head;
 * every other call appends exactly one entry and replaces the matching head in the same rename.
 */
export function relianceJournal(home, runId) {
  const path = runPaths(home, runId).relianceTrace;
  const state = () => {
    const stored = readJsonIfExists(path);
    if (stored === null) return { schema_id: "aos-reliance-journal.v1", entries: [], head: null };
    if (!stored || stored.schema_id !== "aos-reliance-journal.v1" || !Array.isArray(stored.entries) || !(stored.head === null || typeof stored.head === "object")) {
      throw new Error("AOS_RELIANCE_JOURNAL_SHAPE the durable reliance journal is malformed");
    }
    return stored;
  };
  return Object.freeze({
    record(entry, head) {
      const current = state();
      if (entry !== null) current.entries.push(structuredClone(entry));
      current.head = structuredClone(head);
      writeJson(path, current);
    },
    read: () => structuredClone(state().entries),
    readHead: () => structuredClone(state().head)
  });
}

/**
 * The payload as it may be stored: the declared keys, minus whatever cannot be published.
 *
 * A key that is declared, supplied, and then removed is recorded in `redacted_keys` rather than
 * dropped in silence. It was dropped in silence, and it cost the #557 axis coverage ledger: one of
 * its five axes is called `secret`, `containsSecretLike` reads `secret=` as the start of one, and
 * every persisted copy of the ledger lost the whole array on every run. Nothing said so -- a reader
 * of the stored event could not tell a filter that removed a field from a producer that never sent
 * one, which is the same shape as the rule this repository states everywhere else: absent evidence
 * must not be indistinguishable from clean evidence.
 *
 * It is a record and not a refusal. Several allowlisted keys carry free-form text an agent or an
 * operator wrote -- `checkpoint.raised`'s `output`, `operator.decision`'s `choice` -- and an agent
 * that prints `api_key=` in its own output would turn a redaction into a crashed run. What the
 * caller is owed is that the loss is visible, not that it is fatal.
 */
function projectPayload(type, payload) {
  const allowed = EVENT_PAYLOAD_ALLOWLIST[type] ?? [];
  if (!payload || typeof payload !== "object") return null;
  const result = {};
  const redacted = [];
  for (const key of allowed) {
    const value = payload[key];
    if (value === undefined) continue;
    const strings = typeof value === "string" ? [value] : Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
    if (strings.some((entry) => entry.length > 512) || containsSecretLike(strings)) {
      redacted.push(key);
      continue;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((entry) => typeof entry === "string"))) {
      result[key] = value;
    } else {
      redacted.push(key);
    }
  }
  if (redacted.length > 0) result.redacted_keys = redacted;
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
  repairTornTrailingNdjson(file);
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
  // Completion recovery can die at any write. Replace its final event atomically too, so a
  // retry observes either the old log or the complete event, never a torn completion marker.
  if (event.event_type === "assessment.ended") {
    appendNdjson(file, record, { atomic: true });
  } else {
    appendNdjson(file, record);
  }
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

export function recoverRun(home, runId, render, options) {
  recoverExposureFinalizations(home, options);
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
