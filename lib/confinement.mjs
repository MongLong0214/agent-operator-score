/**
 * STRICT workspace confinement and the official-issuance gate. #556.
 *
 * Phase 0 (docs/STRICT_CONFINEMENT_FEASIBILITY.md, fixtures/confinement/probe.json) measured what
 * each backend on this stack can enforce: macOS Seatbelt holds the filesystem boundary in the
 * kernel and runs the real Codex runtime inside it, and leaves the process axis open; the Linux
 * container holds the boundary and cannot run the darwin-only runtime. This module is what Phase B
 * built on that: an adapter per platform that renders a boundary from the workspace, the run store
 * and the runtime's declared policy, a canary that runs inside that boundary before the agent does
 * and reports what it could reach, a descendant scan that does not depend on the process group,
 * and one decision -- `issuanceGate` -- that says whether a run may be issued as official
 * PROFILE_BOUND and, when it may not, names why in an `AOS_ISOLATION_*` code.
 *
 * Three things are kept apart on purpose, because the issue forbids joining them: the filesystem,
 * process and network axes are separate fields with separate evidence; the policy the run was
 * *meant* to have (digested, placeholder-only, comparable across machines) is separate from the
 * profile it actually got (digested over the rendered bytes); and "not measured" is a value of its
 * own, `NOT_OBSERVED`, never spelled as "denied".
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "./digest.mjs";

export const CONFINEMENT_RECORD_SCHEMA = "aos-confinement-record.v1";
export const ISOLATION_POLICY_SCHEMA = "aos-isolation-policy.v1";
export const SUPPORT_MATRIX_SCHEMA = "aos-confinement-support-matrix.v1";
export const BOUNDARY_CANARY_SCHEMA = "aos-boundary-canary.v1";

export const ISOLATION_LEVELS = Object.freeze(["STRICT", "BEST_EFFORT_CLI", "NONE"]);
export const CONFINED_PLATFORMS = Object.freeze(["darwin", "linux"]);
export const NETWORK_POLICIES = Object.freeze(["provider-required-unrestricted", "restricted", "disabled"]);
export const CANARY_RESULTS = Object.freeze(["PASS", "FAIL", "NOT_RUN"]);
export const SUPPORT_STATUSES = Object.freeze(["SUPPORTED", "SUPPORTED_WITH_CONSTRAINTS", "BLOCKED", "NOT_OBSERVED"]);
// The two statuses a release may issue under. `BLOCKED` and `NOT_OBSERVED` are the other two, and
// the difference between them matters to a reader even though the gate treats both as "no".
export const SUPPORTED_RELEASE_SET = new Set(["SUPPORTED", "SUPPORTED_WITH_CONSTRAINTS"]);
export const CLAIM_STAGE_CEILING = Object.freeze({ official: "PROFILE_BOUND", withheld: "RUN_DIAGNOSTIC" });
export const DESCENDANT_POLL_INTERVAL_MS = 200;

export const BACKENDS = Object.freeze({
  "macos-seatbelt": Object.freeze({ id: "macos-seatbelt", platform: "darwin", mechanism: "kernel", command: "sandbox-exec", deprecated: true }),
  "linux-bubblewrap": Object.freeze({ id: "linux-bubblewrap", platform: "linux", mechanism: "namespace", command: "bwrap", deprecated: false }),
  none: Object.freeze({ id: "none", platform: null, mechanism: "none", command: null, deprecated: false })
});

/**
 * What of a runtime's configuration directory a STRICT run stages into the agent's private HOME.
 *
 * Phase 0 named `~/.codex` read-only in the profile and the runtime authenticated; Phase B measured
 * `codex exec` under that hole and it exits 1 before the first turn, because it opens its state
 * database, its installation id and a temp file for writing under `CODEX_HOME`. Opening the
 * operator's directory read-write would let the agent rewrite the operator's own `config.toml` --
 * a `notify` command or an MCP server the operator's next interactive session would run outside
 * any boundary. So the run gets a copy: the two files Codex needs, and nothing that carries the
 * operator's history. `dir` is the name the runtime looks for under HOME when the variable is
 * unset, so the copy is found either way. The list is a fact about the runtime, which is why it is
 * keyed by adapter; when `lib/profile.mjs` grows a field for it (#561), this table moves there.
 */
export const RUNTIME_CONFIG_STAGING = new Map([
  ["codex-cli.v1", Object.freeze({ dir: ".codex", files: Object.freeze(["auth.json", "config.toml"]) })],
  ["claude-code.v1", Object.freeze({ dir: ".claude", files: Object.freeze([]) })]
]);

export const ISSUANCE_REASONS = Object.freeze({
  LEVEL_NOT_STRICT: "AOS_ISOLATION_LEVEL_NOT_STRICT",
  BACKEND_ABSENT: "AOS_ISOLATION_BACKEND_ABSENT",
  FILESYSTEM_NOT_ENFORCED: "AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED",
  PROCESS_NOT_ENFORCED: "AOS_ISOLATION_PROCESS_NOT_ENFORCED",
  SETUP_UNVERIFIED: "AOS_ISOLATION_SETUP_UNVERIFIED",
  CANARY_NOT_PASS: "AOS_ISOLATION_CANARY_NOT_PASS",
  LEAKED_DESCENDANT: "AOS_ISOLATION_LEAKED_DESCENDANT",
  CLEANUP_UNVERIFIED: "AOS_ISOLATION_CLEANUP_UNVERIFIED",
  POLICY_DIGEST_MISSING: "AOS_ISOLATION_POLICY_DIGEST_MISSING",
  SUPPORT_STATUS: "AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE",
  LANE_NOT_PROVEN: "AOS_ISOLATION_LANE_NOT_PROVEN",
  NO_INVOCATIONS: "AOS_ISOLATION_NO_INVOCATIONS",
  RECORD_INVALID: "AOS_ISOLATION_RECORD_INVALID"
});

// What the canary tries, by name. The order is the order it reports in and the order the
// evaluator walks; a cell missing from a report is a failure, not a pass by omission.
export const CANARY_CELLS = Object.freeze([
  "workspace_read",
  "workspace_write",
  "outside_read",
  "outside_write",
  "outside_delete",
  "store_root_read",
  "run_store_read",
  "symlink_escape_read",
  "operator_home_list",
  "network_outbound_connect",
  "detached_descendant"
]);

/**
 * The release declaration: which platform/backend/adapter combinations have a real lane behind
 * them. This is the table `issuanceGate` consults, and it ships in the package, which is why it
 * lives here and not only in the fixture. `fixtures/confinement/support-matrix.json` is the
 * evidence ledger for the same lanes -- which committed observation proves each one -- and the
 * product test holds the two equal.
 *
 * Only one lane is proven: Seatbelt on darwin with the Codex CLI, measured on this machine by the
 * committed canary and login runs. Everything else is `NOT_OBSERVED` and says so, including the
 * generic adapter on the same backend: its boundary is measured by the very same canary, but no
 * real runtime authenticated under it, and a fixture-only lane is not a lane the release may issue
 * on. An adapter of `*` means the row holds for every adapter at that level.
 */
export const SUPPORT_LANES = Object.freeze([
  lane("darwin", "macos-seatbelt", "codex-cli.v1", "STRICT", "SUPPORTED_WITH_CONSTRAINTS"),
  lane("darwin", "macos-seatbelt", "claude-code.v1", "STRICT", "NOT_OBSERVED"),
  lane("darwin", "macos-seatbelt", "generic-command.v1", "STRICT", "NOT_OBSERVED"),
  lane("darwin", "none", "*", "BEST_EFFORT_CLI", "BLOCKED"),
  lane("darwin", "none", "*", "NONE", "BLOCKED"),
  lane("linux", "linux-bubblewrap", "codex-cli.v1", "STRICT", "NOT_OBSERVED"),
  lane("linux", "linux-bubblewrap", "claude-code.v1", "STRICT", "NOT_OBSERVED"),
  lane("linux", "linux-bubblewrap", "generic-command.v1", "STRICT", "NOT_OBSERVED"),
  lane("linux", "linux-container", "*", "STRICT", "NOT_OBSERVED"),
  lane("linux", "none", "*", "BEST_EFFORT_CLI", "BLOCKED"),
  lane("linux", "none", "*", "NONE", "BLOCKED")
]);

function lane(platform, backend, adapter, level, support_status) {
  return Object.freeze({ platform, backend, adapter, level, support_status });
}

export function laneOf({ platform, backend, adapter, level }) {
  return SUPPORT_LANES.find((one) =>
    one.platform === platform && one.backend === backend && one.level === level && (one.adapter === "*" || one.adapter === adapter)
  ) ?? null;
}

export function platformLaneOf({ platform, backend, adapter }) {
  return `${platform ?? "unknown"}/${backend ?? "none"}/${adapter ?? "unknown"}`;
}

const fail = (code, detail) => new Error(detail === undefined ? code : `${code} ${detail}`);

// Sorted keys at every level, so a digest is over the policy and not over the order somebody
// happened to build the object in.
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const walkStrings = (value, visit) => {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) value.forEach((one) => walkStrings(one, visit));
  else if (value && typeof value === "object") Object.values(value).forEach((one) => walkStrings(one, visit));
};

/**
 * The policy a run is confined under, with every machine-specific path left as a placeholder.
 *
 * Two runs are comparable exactly when their policy digests match, which is only useful if the
 * digest describes the shape of the boundary -- what is writable, what is readable, which holes the
 * adapter's runtime needed, what the network is -- and not the temp directory names this machine
 * happened to draw. The paths go in at render time and are digested separately, over the rendered
 * bytes, as `rendered_profile_digest`.
 */
export function isolationPolicyFor({ level, platform, backend, adapter, networkPolicy = null }) {
  if (!ISOLATION_LEVELS.includes(level)) throw fail("AOS_ISOLATION_LEVEL_INVALID", String(level));
  if (!adapter || typeof adapter !== "object" || typeof adapter.id !== "string") throw fail("AOS_ISOLATION_ADAPTER_INVALID");
  const network = networkPolicy ?? (adapter.provider_network === "required" ? "provider-required-unrestricted" : "disabled");
  if (!NETWORK_POLICIES.includes(network)) throw fail("AOS_ISOLATION_NETWORK_POLICY_INVALID", String(network));
  // No backend on this stack filters by destination host. Seatbelt can filter by port and
  // bubblewrap can only unshare the whole namespace, so "restricted" would be a policy name with
  // nothing enforcing it. Refused rather than approximated.
  if (network === "restricted") throw fail("AOS_ISOLATION_NETWORK_POLICY_UNSUPPORTED", "restricted: no backend here filters network by destination");
  const config = adapter.config_env ? String(adapter.config_env) : null;
  const staged = config ? RUNTIME_CONFIG_STAGING.get(adapter.id)?.files ?? Object.freeze([]) : Object.freeze([]);
  if (level !== "STRICT") {
    return Object.freeze({
      schema: ISOLATION_POLICY_SCHEMA,
      policy_version: 1,
      level,
      platform: platform ?? null,
      backend: "none",
      adapter: adapter.id,
      filesystem: Object.freeze({ default: "allow", enforcement: "none", writable: [], readable: [], denied: [], symlink_escape: "not-enforced" }),
      process: Object.freeze({ session: "own", scan: "process-group", enforcement: "none", leaked_descendant: "recorded", cleanup_failure: "recorded" }),
      network: Object.freeze({ policy: network, enforcement: "none", provider_transport: "allowed", task_external: "NOT_OBSERVED" }),
      holes: Object.freeze(config ? [Object.freeze({ env: config, path: "@RUNTIME_CONFIG_DIR@", access: "unconfined" })] : [])
    });
  }
  const mechanism = BACKENDS[backend]?.mechanism;
  if (!mechanism || backend === "none") throw fail("AOS_ISOLATION_BACKEND_INVALID", String(backend));
  if (BACKENDS[backend].platform !== platform) throw fail("AOS_ISOLATION_BACKEND_PLATFORM_MISMATCH", `${backend} is not a ${platform} backend`);
  return Object.freeze({
    schema: ISOLATION_POLICY_SCHEMA,
    policy_version: 1,
    level: "STRICT",
    platform,
    backend,
    adapter: adapter.id,
    filesystem: Object.freeze({
      default: "deny",
      enforcement: mechanism,
      writable: Object.freeze(["@WORKSPACE@", "@AGENT_HOME@"]),
      readable: Object.freeze(["@RUN_SCRATCH@", "@NODE_TREE@", "@RUNTIME_CLI_TREE@"]),
      denied: Object.freeze(["@AOS_HOME@", "@OPERATOR_HOME@", "@WORKSPACE_PARENT@"]),
      symlink_escape: mechanism === "kernel" ? "resolved-by-kernel" : "resolved-by-mount-namespace"
    }),
    process: Object.freeze({
      session: "own",
      scan: "ancestry-poll",
      poll_interval_ms: DESCENDANT_POLL_INTERVAL_MS,
      enforcement: backend === "linux-bubblewrap" ? "pid-namespace" : "scan-and-signal",
      leaked_descendant: "blocks_issuance",
      cleanup_failure: "blocks_issuance"
    }),
    network: Object.freeze({
      policy: network,
      enforcement: mechanism,
      provider_transport: network === "disabled" ? "denied" : "allowed",
      // Provider transport and a task-initiated external call are the same syscall at this layer.
      // Nothing here distinguishes them, so nothing here may claim the second was stopped.
      task_external: "NOT_OBSERVED"
    }),
    // The runtime's configuration directory is not a hole in the boundary: the named files are
    // copied into the agent's private HOME before the spawn and the variable points there. What
    // the runtime writes -- session logs, its state database, a refreshed token -- lands in the
    // copy and goes with the run. The operator's own directory stays under the denied HOME.
    holes: Object.freeze(config ? [Object.freeze({ env: config, path: "@RUNTIME_CONFIG_STAGE@", access: "staged-copy", staged })] : [])
  });
}

/**
 * `sha256:` over the canonical form of a policy. Exported for `lib/profile.mjs` (#561), which
 * folds it into the profile digest so that two profiles that differ only in their boundary differ
 * in their digest.
 */
export function isolationPolicyDigestOf(policy) {
  if (!policy || typeof policy !== "object" || policy.schema !== ISOLATION_POLICY_SCHEMA) throw fail("AOS_ISOLATION_POLICY_INVALID");
  if (!ISOLATION_LEVELS.includes(policy.level)) throw fail("AOS_ISOLATION_POLICY_INVALID", `level ${policy.level}`);
  // A concrete path in the policy would make the digest describe this machine instead of the
  // boundary, and every run would then be incomparable with every other.
  walkStrings(policy, (text) => {
    if (text.startsWith("/")) throw fail("AOS_ISOLATION_POLICY_PATH_LEAK", text);
  });
  return sha256Bytes(Buffer.from(canonical(policy), "utf8"));
}

// Absolute, and free of the two characters that would end a quoted Seatbelt string early and of
// control characters, which have no place in a path a profile is rendered from.
const SAFE_PATH = /^\/[^"\\\p{Cc}]*$/u;

const safePath = (name, value) => {
  if (value === undefined || value === null) throw fail("AOS_ISOLATION_BINDING_MISSING", name);
  if (typeof value !== "string" || !isAbsolute(value) || !SAFE_PATH.test(value)) throw fail("AOS_ISOLATION_UNSAFE_PATH", `${name}: ${String(value)}`);
  if (value !== "/" && value.endsWith("/")) throw fail("AOS_ISOLATION_UNSAFE_PATH", `${name}: trailing separator`);
  return value;
};

const within = (base, target) => target === base || target.startsWith(base.endsWith("/") ? base : `${base}/`);

const REQUIRED_BINDINGS = Object.freeze(["@WORKSPACE@", "@AOS_HOME@", "@AGENT_HOME@", "@RUN_SCRATCH@", "@NODE_TREE@", "@RUNTIME_CLI_TREE@"]);

// The invariants both renderers share. The workspace lives inside the store -- that is where
// `runPaths` puts it -- and it is allowed by a later, more specific rule than the one denying the
// store, so a workspace that *contains* the store would re-open all of it. Scratch inside the store
// is refused for the same reason; a tree bound at `/` would allow everything.
function checkBindings(policy, bindings) {
  const bound = Object.create(null);
  for (const name of REQUIRED_BINDINGS) bound[name] = safePath(name, bindings[name]);
  if (within(bound["@WORKSPACE@"], bound["@AOS_HOME@"])) throw fail("AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME", bound["@WORKSPACE@"]);
  for (const name of ["@AGENT_HOME@", "@RUN_SCRATCH@"]) {
    if (within(bound["@AOS_HOME@"], bound[name]) || within(bound[name], bound["@AOS_HOME@"])) throw fail("AOS_ISOLATION_SCRATCH_INSIDE_AOS_HOME", `${name}: ${bound[name]}`);
  }
  for (const name of ["@NODE_TREE@", "@RUNTIME_CLI_TREE@"]) {
    const value = bound[name];
    if (value === "/" || within(value, bound["@AOS_HOME@"])) throw fail("AOS_ISOLATION_UNSAFE_TREE", `${name}: ${value}`);
  }
  return bound;
}

/**
 * The Seatbelt profile for a STRICT policy, with the machine's paths bound in.
 *
 * Phase 0's provider-lane profile is the base -- it is the one under which the real runtime
 * authenticated -- with four changes measured for Phase B: the store is denied by name before the
 * workspace inside it is allowed (a later rule wins, measured on darwin 26.3), the agent's
 * temporary HOME is writable because it is also its TMPDIR and holds the staged runtime config,
 * the run scratch that holds the task file is readable and nothing more, and the operator's
 * runtime config directory is no longer named at all. Network rules appear only under a
 * provider-required policy; an adapter that describes no runtime gets none.
 */
export function renderSeatbeltProfile(policy, bindings) {
  if (!policy || policy.level !== "STRICT" || policy.backend !== "macos-seatbelt") throw fail("AOS_ISOLATION_POLICY_INVALID", "not a STRICT Seatbelt policy");
  const bound = checkBindings(policy, bindings ?? {});
  const lines = [
    "(version 1)",
    "(deny default)",
    `; AOS STRICT confinement, isolation policy ${isolationPolicyDigestOf(policy)}`,
    "(allow process-fork)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow signal (target self) (target pgrp))",
    "(allow file-read-metadata)",
    '(allow file-write* (literal "/dev/null"))',
    '(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/zero") (literal "/dev/dtracehelper"))',
    '(allow file-read* (subpath "/usr/lib") (subpath "/usr/share") (subpath "/System") (subpath "/Library") (subpath "/bin") (subpath "/usr/bin") (subpath "/private/etc") (subpath "/private/var/db/dyld") (subpath "/private/var/db/timezone") (subpath "/private/var/select") (literal "/") (literal "/private") (literal "/private/tmp") (literal "/private/var") (literal "/private/var/folders") (literal "/Users") (literal "/etc") (literal "/tmp") (literal "/var"))',
    '(allow process-exec (subpath "/usr/bin") (subpath "/bin") (subpath "/usr/lib") (subpath "/System"))',
    '(allow file-read* process-exec (subpath "@NODE_TREE@"))',
    '(allow file-read* process-exec (subpath "@RUNTIME_CLI_TREE@"))',
    '(allow file-read* (subpath "@RUN_SCRATCH@"))'
  ];
  if (policy.network.policy === "provider-required-unrestricted") {
    lines.push("(allow network-outbound)", "(allow network-bind)", "(allow system-socket)");
  }
  lines.push(
    "(allow ipc-posix-shm)",
    '(deny file-read* file-write* (subpath "@AOS_HOME@"))',
    '(allow file-read* file-write* (subpath "@WORKSPACE@"))',
    '(allow file-read* file-write* (subpath "@AGENT_HOME@"))'
  );
  let text = `${lines.join("\n")}\n`;
  for (const [name, value] of Object.entries(bound)) {
    if (value !== null) text = text.split(name).join(value);
  }
  if (/@[A-Z_]+@/u.test(text)) throw fail("AOS_ISOLATION_BINDING_MISSING", text.match(/@[A-Z_]+@/u)[0]);
  return text;
}

/**
 * bubblewrap's argument vector for a STRICT policy. Not measured on this machine -- bwrap is
 * absent here, and the support table says so -- but the vector is deterministic, so what it would
 * mount is testable: the store is never bound, the workspace and agent home read-write, the run
 * scratch read-only, and the pid namespace plus
 * `--die-with-parent` are what make the process axis enforced rather than scanned.
 */
export function bubblewrapArgs(policy, bindings, command) {
  if (!policy || policy.level !== "STRICT" || policy.backend !== "linux-bubblewrap") throw fail("AOS_ISOLATION_POLICY_INVALID", "not a STRICT bubblewrap policy");
  if (!Array.isArray(command) || command.length === 0) throw fail("AOS_ISOLATION_COMMAND_UNRESOLVED");
  const bound = checkBindings(policy, bindings ?? {});
  const args = ["--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc", "--unshare-uts"];
  if (policy.network.policy === "disabled") args.push("--unshare-net");
  for (const tree of ["/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc"]) args.push("--ro-bind-try", tree, tree);
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  args.push("--ro-bind", bound["@NODE_TREE@"], bound["@NODE_TREE@"]);
  args.push("--ro-bind", bound["@RUNTIME_CLI_TREE@"], bound["@RUNTIME_CLI_TREE@"]);
  args.push("--ro-bind", bound["@RUN_SCRATCH@"], bound["@RUN_SCRATCH@"]);
  args.push("--bind", bound["@WORKSPACE@"], bound["@WORKSPACE@"]);
  args.push("--bind", bound["@AGENT_HOME@"], bound["@AGENT_HOME@"]);
  args.push("--chdir", bound["@WORKSPACE@"], "--", ...command);
  return args;
}

/**
 * Every process on the host as `{ pid, ppid, pgid, start }`. `start` is only ever compared for
 * equality, which is what it is for: a pid that comes back with a different start time is a
 * different process wearing a number this run once tracked, and must not be signalled.
 */
export function processTable(platform = process.platform) {
  if (platform === "linux") {
    const rows = [];
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/u.test(name)) continue;
      let stat;
      try { stat = readFileSync(`/proc/${name}/stat`, "utf8"); } catch { continue; }
      const close = stat.lastIndexOf(")");
      if (close < 0) continue;
      const fields = stat.slice(close + 2).split(" ");
      rows.push({ pid: Number(name), ppid: Number(fields[1]), pgid: Number(fields[2]), start: fields[19] ?? "" });
    }
    return rows;
  }
  const listed = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (listed.error || listed.status !== 0) throw fail("AOS_ISOLATION_PROCESS_TABLE_UNAVAILABLE", listed.error?.message ?? `ps exited ${listed.status}`);
  const rows = [];
  for (const line of listed.stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*\S)\s*$/u);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), start: match[4] });
  }
  return rows;
}

/**
 * Tracks what the agent starts, by ancestry rather than by process group.
 *
 * Phase 0 measured the gap this closes: a descendant that calls `setsid` leaves the group AOS
 * signals and is not listed by `processGroupMembers`, so it survived cleanup and the record could
 * not say so. Here a process is adopted when its parent chain reaches one already tracked, or
 * when it shares the agent's group, and it stays tracked after it is reparented to init. What
 * the poll cannot see is a double-fork whose middle process exited between two polls; that
 * residual is named on the record, and under Seatbelt such a process is still confined by the
 * kernel, because the profile is inherited across fork and exec.
 */
const residualOf = (intervalMs) => `a descendant whose parent exited between two polls (${intervalMs} ms apart) after a double-fork is not tracked; it remains confined by the backend, and the process-group scan runs beside this one`;

export function descendantTracker(rootPid, { table = processTable, intervalMs = DESCENDANT_POLL_INTERVAL_MS } = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 1) throw fail("AOS_ISOLATION_TRACKER_ROOT_INVALID", String(rootPid));
  const identity = new Map();
  const order = [];
  let rootSeen = false;
  let polls = 0;
  let timer = null;
  let last = new Map();
  const adopt = (row) => {
    if (!identity.has(row.pid)) order.push(row.pid);
    identity.set(row.pid, row.start);
  };
  const isLive = (pid, byPid) => identity.has(pid) && byPid.get(pid)?.start === identity.get(pid);
  const poll = () => {
    polls += 1;
    const rows = table();
    const byPid = new Map(rows.map((row) => [row.pid, row]));
    const root = byPid.get(rootPid);
    if (root && !rootSeen) { rootSeen = true; adopt(root); }
    // Only after the root was seen once: a pid, or a group id, equal to a root that was never
    // observed could belong to anybody.
    if (rootSeen) {
      for (const row of rows) {
        if (isLive(row.pid, byPid)) continue;
        let ancestor = row.ppid;
        let adopted = row.pgid === rootPid;
        for (let hops = 0; !adopted && ancestor > 1 && hops < 64; hops += 1) {
          if (isLive(ancestor, byPid)) adopted = true;
          else ancestor = byPid.get(ancestor)?.ppid ?? 0;
        }
        if (adopted) adopt(row);
      }
    }
    last = byPid;
    return rows;
  };
  const alive = () => order.filter((pid) => isLive(pid, last));
  const signalAll = (pids, signal) => {
    for (const pid of pids) {
      try { process.kill(pid, signal); } catch {}
    }
  };
  const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
  return {
    start() {
      poll();
      timer = setInterval(poll, intervalMs);
      timer.unref();
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    poll,
    polls: () => polls,
    tracked: () => order.slice(),
    alive,
    rootSeen: () => rootSeen,
    // SIGTERM, then SIGKILL, each pid by itself; the survivors are whatever still answers.
    async terminate() {
      poll();
      if (alive().length > 0) { signalAll(alive(), "SIGTERM"); await pause(250); poll(); }
      if (alive().length > 0) { signalAll(alive(), "SIGKILL"); await pause(250); poll(); }
      return alive();
    },
    residual: () => residualOf(intervalMs)
  };
}

/**
 * The program that runs inside the boundary before the agent does. It ships as source in this
 * module so that it is present wherever the package is, is written into the run scratch at prepare
 * time, and is digested by its bytes on every record that quotes a result from it.
 *
 * Every attempt records what came back, in the Phase 0 vocabulary: `allowed`, `denied` with the
 * errno, or `inconclusive` when the answer was neither. The program never decides PASS or FAIL --
 * AOS does, from these cells and from what it can check from outside: whether the planted files
 * are still intact, whether the detached descendant was seen by the scan, and whether it is dead
 * after teardown. A program's word about its own confinement is a self-report; the effect is what
 * is judged.
 */
export const BOUNDARY_CANARY_PROGRAM = `// AOS boundary canary. Written by lib/confinement.mjs; do not edit in place.
import { readFileSync, writeFileSync, readdirSync, unlinkSync, symlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";
const spec = JSON.parse(readFileSync(process.env.AOS_CANARY_SPEC, "utf8"));
const cells = Object.create(null);
const attempt = (name, fn) => {
  try {
    const detail = fn();
    cells[name] = { outcome: "allowed", errno: null, detail: detail ?? null };
  } catch (error) {
    const errno = error && typeof error.code === "string" ? error.code : null;
    cells[name] = { outcome: errno === "EPERM" || errno === "EACCES" || errno === "ENOENT" ? "denied" : "inconclusive", errno, detail: errno === null ? String(error && error.message) : null };
  }
};
attempt("workspace_read", () => ({ bytes: readFileSync(join(spec.workspace, spec.workspace_file)).length }));
attempt("workspace_write", () => { writeFileSync(join(spec.workspace, ".aos-canary-write-" + spec.nonce), spec.nonce); return { wrote: true }; });
attempt("outside_read", () => ({ bytes: readFileSync(spec.outside_file).length }));
attempt("outside_write", () => { writeFileSync(spec.outside_file + ".written", spec.nonce); return { wrote: true }; });
attempt("outside_delete", () => { unlinkSync(spec.outside_file); return { deleted: true }; });
attempt("store_root_read", () => ({ bytes: readFileSync(spec.store_root_file).length }));
attempt("run_store_read", () => ({ bytes: readFileSync(spec.run_store_file).length }));
attempt("symlink_escape_read", () => {
  const link = join(spec.workspace, ".aos-canary-link-" + spec.nonce);
  symlinkSync(spec.store_root_file, link);
  return { bytes: readFileSync(link).length };
});
attempt("operator_home_list", () => ({ entries: readdirSync(spec.operator_home).length }));
const network = await new Promise((resolve) => {
  const socket = connect({ host: "127.0.0.1", port: spec.probe_port });
  const timer = setTimeout(() => { socket.destroy(); resolve({ outcome: "inconclusive", errno: "ETIMEDOUT", detail: null }); }, 3000);
  socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve({ outcome: "allowed", errno: null, detail: { connected: true } }); });
  socket.once("error", (error) => {
    clearTimeout(timer);
    const errno = error && typeof error.code === "string" ? error.code : null;
    if (errno === "EPERM" || errno === "EACCES") resolve({ outcome: "denied", errno, detail: null });
    else if (errno === "ECONNREFUSED" || errno === "ECONNRESET") resolve({ outcome: "allowed", errno, detail: { refused_by_peer: true } });
    else resolve({ outcome: "inconclusive", errno, detail: null });
  });
});
cells.network_outbound_connect = network;
try {
  const child = spawn("/bin/sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  child.unref();
  cells.detached_descendant = { outcome: "spawned", errno: null, detail: { pid: child.pid } };
} catch (error) {
  cells.detached_descendant = { outcome: "failed", errno: error && error.code ? error.code : null, detail: String(error && error.message) };
}
// Held so that the scan outside has several polls in which to see the descendant while this
// process, its parent, is still alive.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, spec.hold_ms);
process.stdout.write(JSON.stringify({ schema: "${BOUNDARY_CANARY_SCHEMA}", nonce: spec.nonce, pid: process.pid, cells }));
`;

export const BOUNDARY_CANARY_PROGRAM_DIGEST = sha256Bytes(Buffer.from(BOUNDARY_CANARY_PROGRAM, "utf8"));

const EXPECTED_CELL = Object.freeze({
  workspace_read: "allowed",
  workspace_write: "allowed",
  outside_read: "denied",
  outside_write: "denied",
  outside_delete: "denied",
  store_root_read: "denied",
  run_store_read: "denied",
  symlink_escape_read: "denied",
  operator_home_list: "denied",
  detached_descendant: "spawned"
});

/**
 * PASS or FAIL over the canary's cells and AOS's own checks made from outside the boundary. PASS requires every cell
 * to be present and to hold the outcome the policy expects, every planted file to be intact, and
 * the detached descendant to have been seen by the scan and to be dead after teardown. The
 * network cell is judged against the policy: an unrestricted policy expects the connect to reach
 * the peer (which refuses it -- there is nothing listening) and a disabled policy expects the
 * boundary to refuse it first. `inconclusive` never passes.
 */
export function evaluateCanary({ cells, stdout, networkPolicy, outOfBand, exitCode = 0, spawnError = null }) {
  const failed = [];
  const judged = Object.create(null);
  const reported = cells && typeof cells === "object" ? cells : null;
  if (reported === null) failed.push("report_unparseable");
  if (exitCode !== 0) failed.push(`exit_${exitCode === null ? "signal" : exitCode}`);
  if (spawnError) failed.push("spawn_error");
  for (const name of CANARY_CELLS) {
    const cell = reported?.[name];
    const expected = name === "network_outbound_connect" ? (networkPolicy === "disabled" ? "denied" : "allowed") : EXPECTED_CELL[name];
    const observed = cell && typeof cell === "object" && typeof cell.outcome === "string" ? cell.outcome : "not_reported";
    judged[name] = { expected, observed, errno: cell?.errno ?? null };
    if (observed !== expected) failed.push(name);
  }
  const planted = outOfBand?.planted_intact ?? {};
  for (const name of ["outside", "store_root", "run_store"]) {
    if (planted[name] !== true) failed.push(`planted_intact.${name}`);
  }
  const descendant = outOfBand?.descendant ?? {};
  for (const name of ["observed_by_scan", "dead_after_cleanup"]) {
    if (descendant[name] !== true) failed.push(`descendant.${name}`);
  }
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
  return {
    result: failed.length === 0 ? "PASS" : "FAIL",
    failed,
    cells: judged,
    out_of_band: { planted_intact: { ...planted }, descendant: { ...descendant } },
    evidence_digest: sha256Bytes(bytes),
    program_digest: BOUNDARY_CANARY_PROGRAM_DIGEST
  };
}

const commandOnPath = (name, pathValue) => {
  if (name.includes("/")) return existsSync(name) ? name : null;
  for (const dir of String(pathValue ?? "").split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
};

const defaultCommandExists = (name) => commandOnPath(name, process.env.PATH) !== null;

/**
 * The adapter for a platform. Each one answers the five questions the issue names -- probe,
 * prepare, spawnSpec, verifyBoundary, cleanup -- and a sixth, record. `commandExists` is
 * injectable so that a machine without the backend can be described in a test without
 * pretending; the answer on a machine without it is a refusal that names the missing command.
 */
const PROBE_PROFILE = '(version 1)(deny default)(allow process-exec (literal "/usr/bin/true") (literal "/bin/cat"))(allow file-read* (literal "/") (subpath "/usr/lib") (subpath "/System") (subpath "/usr/bin") (subpath "/bin") (subpath "/private/var/db/dyld") (literal "/dev/null"))(allow file-read-metadata)(allow sysctl-read)(allow mach-lookup)';

export function adapterForPlatform(platform, { commandExists = defaultCommandExists } = {}) {
  if (platform === "darwin") {
    return {
      id: "macos-seatbelt",
      platform,
      probe() {
        if (!commandExists("sandbox-exec")) {
          return { available: false, backend: "macos-seatbelt", level_ceiling: "BEST_EFFORT_CLI", reason: `${ISSUANCE_REASONS.BACKEND_ABSENT} sandbox-exec is not on PATH` };
        }
        // Functional, not merely present -- Apple deprecated the tool, so presence proves little.
        // The same deny-default profile has to let `/usr/bin/true` run and stop `/bin/cat` from
        // reading a file it does not name; a kernel that no longer enforced it would pass the
        // first and fail the second.
        const trial = spawnSync("sandbox-exec", ["-p", PROBE_PROFILE, "/usr/bin/true"], { stdio: "ignore" });
        if (trial.error || trial.status !== 0) {
          return { available: false, backend: "macos-seatbelt", level_ceiling: "BEST_EFFORT_CLI", reason: `${ISSUANCE_REASONS.BACKEND_ABSENT} sandbox-exec is present but a deny-default profile did not apply (${trial.error?.message ?? `exit ${trial.status ?? trial.signal}`})` };
        }
        const denial = spawnSync("sandbox-exec", ["-p", PROBE_PROFILE, "/bin/cat", "/etc/hosts"], { stdio: "ignore" });
        if (denial.error || denial.status === 0) {
          return { available: false, backend: "macos-seatbelt", level_ceiling: "BEST_EFFORT_CLI", reason: `${ISSUANCE_REASONS.BACKEND_ABSENT} sandbox-exec ran a deny-default profile that did not deny: /etc/hosts was readable under it` };
        }
        return { available: true, backend: "macos-seatbelt", level_ceiling: "STRICT", reason: null, deprecated: true };
      },
      prepare(policy, bindings, dir) {
        const text = renderSeatbeltProfile(policy, bindings);
        const file = join(dir, "strict.sb");
        writeFileSync(file, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
        return { profile_path: file, rendered_profile_digest: sha256Bytes(Buffer.from(text, "utf8")), profile: text };
      },
      spawnSpec(prepared, command, args) {
        return { command: "/usr/bin/sandbox-exec", args: ["-f", prepared.profile_path, command, ...args], argv0: "sandbox-exec" };
      }
    };
  }
  if (platform === "linux") {
    return {
      id: "linux-bubblewrap",
      platform,
      probe() {
        if (!commandExists("bwrap")) {
          return { available: false, backend: "linux-bubblewrap", level_ceiling: "BEST_EFFORT_CLI", reason: `${ISSUANCE_REASONS.BACKEND_ABSENT} bwrap (bubblewrap) is not on PATH; user-namespace and rootless-container lanes are not implemented, so this host is diagnostic-only` };
        }
        const trial = spawnSync("bwrap", ["--ro-bind", "/", "/", "--unshare-pid", "--die-with-parent", "/bin/true"], { stdio: "ignore" });
        if (trial.error || trial.status !== 0) {
          return { available: false, backend: "linux-bubblewrap", level_ceiling: "BEST_EFFORT_CLI", reason: `${ISSUANCE_REASONS.BACKEND_ABSENT} bwrap is present but cannot unshare a pid namespace here (${trial.error?.message ?? `exit ${trial.status}`})` };
        }
        return { available: true, backend: "linux-bubblewrap", level_ceiling: "STRICT", reason: null, deprecated: false };
      },
      prepare(policy, bindings) {
        checkBindings(policy, bindings);
        const text = JSON.stringify(bubblewrapArgs(policy, bindings, ["@COMMAND@"]));
        return { profile_path: null, rendered_profile_digest: sha256Bytes(Buffer.from(text, "utf8")), policy, bindings };
      },
      spawnSpec(prepared, command, args) {
        return { command: "bwrap", args: bubblewrapArgs(prepared.policy, prepared.bindings, [command, ...args]), argv0: "bwrap" };
      }
    };
  }
  throw fail("AOS_ISOLATION_PLATFORM_UNSUPPORTED", String(platform));
}

const realpathOrNull = (value) => {
  try { return realpathSync(value); } catch { return null; }
};

const isRegularFile = (path) => {
  try { return statSync(path).isFile(); } catch { return false; }
};

/**
 * Copies the runtime's declared configuration files into a directory under the agent's private
 * HOME and returns the variable that points the runtime at it. The source is the operator's
 * variable when set and the runtime's default directory under the operator's HOME otherwise --
 * the same resolution the runtime itself performs, which is what makes the copy equivalent to
 * what it would have read. A file that is absent is listed as absent, not invented; a runtime
 * whose credential is absent will say it is not logged in, which is the true answer.
 *
 * The copy holds a credential value for as long as the run lasts. It is written with the owner's
 * permissions only, under a directory `mkdtemp` created the same way, and it leaves with the agent
 * HOME; `cleanup_verified` on the record is false if it did not. Nothing here records what was
 * copied beyond the file names.
 */
export function stageRuntimeConfig(adapter, env, agentHome, operatorHome) {
  const envOut = Object.create(null);
  const spec = adapter?.config_env ? RUNTIME_CONFIG_STAGING.get(adapter.id) ?? null : null;
  if (spec === null) return { env: envOut, dir: null, staged: [], missing: [], source: "none" };
  const fromEnv = env?.[adapter.config_env] ?? null;
  const source = fromEnv ? "operator_env" : operatorHome ? "default_dir" : "absent";
  const sourceDir = fromEnv ? realpathOrNull(fromEnv) : operatorHome ? realpathOrNull(join(operatorHome, spec.dir)) : null;
  const dir = join(agentHome, spec.dir);
  mkdirSync(dir, { mode: 0o700 });
  const staged = [];
  const missing = [];
  for (const name of spec.files) {
    const from = sourceDir === null ? null : join(sourceDir, name);
    if (from === null || !isRegularFile(from)) {
      missing.push(name);
      continue;
    }
    writeFileSync(join(dir, name), readFileSync(from), { mode: 0o600, flag: "wx" });
    staged.push(name);
  }
  envOut[adapter.config_env] = dir;
  return { env: envOut, dir, staged, missing, source: sourceDir === null ? "absent" : source };
}

// The tree a runtime executable lives in. A node-packaged CLI (`codex` here is a `#!` script under
// `node_modules/@openai/codex/bin`) needs its whole `node_modules` sibling set; a native binary
// needs its own directory.
const runtimeTreeOf = (realPath) => {
  const marker = "/node_modules/";
  const at = realPath.indexOf(marker);
  if (at >= 0) {
    const rest = realPath.slice(at + marker.length);
    // The nearest node_modules above the file, not the first one on the path.
    const deeper = rest.lastIndexOf(marker);
    return deeper >= 0 ? realPath.slice(0, at + marker.length + deeper + marker.length - 1) : realPath.slice(0, at + marker.length - 1);
  }
  return dirname(realPath);
};

const nodeTreeOf = (execPath) => {
  const real = realpathSync(execPath);
  // <prefix>/bin/node -> <prefix>; anything else -> its own directory.
  return basename(dirname(real)) === "bin" ? dirname(dirname(real)) : dirname(real);
};

const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

const CANARY_TIMEOUT_MS = 20000;
const CANARY_HOLD_MS = 700;

/**
 * Runs the canary inside the prepared boundary and judges it. Plants the files the canary must
 * not reach -- in the workspace's parent, at the store root, under the store's `runs` directory --
 * before it starts, and checks them after it exits; the planted names are dotfiles that `listRuns`
 * does not read. The descendant the canary detaches is what the tracker has to catch, and it is
 * killed here, by AOS, before the agent is ever started.
 */
export async function runBoundaryCanary({ adapter, prepared, workspace, aosHome, agentHome, runScratch, operatorHome, nodeBinary = process.execPath, pathValue = "/usr/bin:/bin", networkPolicy, tracker = descendantTracker }) {
  const nonce = randomBytes(8).toString("hex");
  const plants = {
    outside: join(dirname(workspace), `.aos-canary-${nonce}`),
    store_root: join(aosHome, `.aos-canary-${nonce}`),
    run_store: join(aosHome, "runs", `.aos-canary-${nonce}`)
  };
  mkdirSync(join(aosHome, "runs"), { recursive: true });
  for (const file of Object.values(plants)) writeFileSync(file, nonce, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const workspaceFile = `.aos-canary-read-${nonce}`;
  writeFileSync(join(workspace, workspaceFile), nonce, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const probePort = await closedPort();
  const program = join(runScratch, "boundary-canary.mjs");
  const specFile = join(runScratch, "boundary-canary.spec.json");
  writeFileSync(program, BOUNDARY_CANARY_PROGRAM, { encoding: "utf8", mode: 0o600, flag: "wx" });
  writeFileSync(specFile, JSON.stringify({
    workspace,
    workspace_file: workspaceFile,
    outside_file: plants.outside,
    store_root_file: plants.store_root,
    run_store_file: plants.run_store,
    operator_home: operatorHome,
    probe_port: probePort,
    hold_ms: CANARY_HOLD_MS,
    nonce
  }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  const launch = adapter.spawnSpec(prepared, nodeBinary, [program]);
  const env = Object.create(null);
  env.PATH = pathValue;
  env.HOME = agentHome;
  env.TMPDIR = agentHome;
  env.AOS_CANARY_SPEC = specFile;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let spawnError = null;
  let scan = null;
  let outcome;
  try {
    const child = spawn(launch.command, launch.args, { cwd: workspace, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"], env, argv0: launch.argv0 ?? launch.command });
    child.stdout.on("data", (chunk) => { if (stdout.length < 1024 * 1024) stdout = Buffer.concat([stdout, Buffer.from(chunk)]); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 64 * 1024) stderr = Buffer.concat([stderr, Buffer.from(chunk)]); });
    scan = tracker(child.pid).start();
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, CANARY_TIMEOUT_MS);
    timer.unref();
    outcome = await new Promise((resolvePromise) => {
      child.once("error", (error) => resolvePromise({ code: null, signal: null, error }));
      child.once("exit", (code, signal) => resolvePromise({ code, signal, error: null }));
    });
    clearTimeout(timer);
    spawnError = outcome.error ? outcome.error.message : null;
  } catch (error) {
    spawnError = error.message;
    outcome = { code: null, signal: null, error };
  }
  await pause(50);
  let report = null;
  try { report = JSON.parse(stdout.toString("utf8")); } catch {}
  const cells = report && typeof report === "object" && report.cells && typeof report.cells === "object" ? report.cells : null;
  const descendantPid = Number.isInteger(cells?.detached_descendant?.detail?.pid) ? cells.detached_descendant.detail.pid : null;
  let observedByScan = false;
  let survivors = [];
  if (scan) {
    scan.stop();
    scan.poll();
    observedByScan = descendantPid !== null && scan.tracked().includes(descendantPid);
    survivors = await scan.terminate();
  }
  // Judged on the tracker's teardown alone: a descendant still answering after it is a failure of
  // the scan, and is killed here only so that it is not left behind while the failure is recorded.
  const deadAfterCleanup = descendantPid !== null && await waitDead(descendantPid, 500);
  if (descendantPid !== null && !deadAfterCleanup) {
    try { process.kill(descendantPid, "SIGKILL"); } catch {}
  }
  const intact = Object.create(null);
  for (const [name, file] of Object.entries(plants)) {
    let content = null;
    try { content = readFileSync(file, "utf8"); } catch {}
    intact[name] = content === nonce && !existsSync(`${file}.written`);
  }
  for (const file of Object.values(plants)) { try { unlinkSync(file); } catch {} }
  // The spec named the store by path. It, and the program, are gone before the agent starts, so
  // the readable run scratch carries neither.
  for (const file of [`${plants.outside}.written`, join(workspace, workspaceFile), join(workspace, `.aos-canary-write-${nonce}`), join(workspace, `.aos-canary-link-${nonce}`), specFile, program]) {
    try { rmSync(file, { force: true }); } catch {}
  }
  const evaluated = evaluateCanary({
    cells,
    stdout,
    networkPolicy,
    exitCode: outcome.code,
    spawnError,
    outOfBand: { planted_intact: intact, descendant: { pid: descendantPid, observed_by_scan: observedByScan, dead_after_cleanup: deadAfterCleanup, survivors } }
  });
  return {
    ...evaluated,
    exit_code: outcome.code,
    signal: outcome.signal,
    spawn_error: spawnError,
    stderr_excerpt: stderr.toString("utf8").slice(-2000),
    stdout_bytes: stdout.length,
    scan_polls: scan ? scan.polls() : 0,
    command: [launch.command, ...launch.args]
  };
}

// True once `kill(pid, 0)` reports the process gone. A just-killed process can still be a zombie
// until its new parent reaps it, so the answer is asked for a little while, not once.
const waitDead = async (pid, budgetMs) => {
  const until = Date.now() + budgetMs;
  for (;;) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") return true; }
    if (Date.now() >= until) return false;
    await pause(25);
  }
};

// A port nothing is listening on, found by binding and releasing one; the canary connects to it
// and either reaches the (refusing) peer or is stopped by the boundary before that.
const closedPort = () => new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.once("error", rejectPort);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolvePort(port));
  });
});

const passthrough = (level, platform, adapter, policy) => {
  const record = {
    schema: CONFINEMENT_RECORD_SCHEMA,
    level,
    platform,
    backend: "none",
    adapter: adapter.id,
    filesystem_enforced: false,
    process_enforced: false,
    network_policy: policy.network.policy,
    network: { provider_transport: policy.network.provider_transport, task_external: "NOT_OBSERVED", enforcement: "none" },
    policy_digest: isolationPolicyDigestOf(policy),
    rendered_profile_digest: null,
    setup_verified: false,
    boundary_canary: { result: "NOT_RUN", reason: level === "NONE" ? "NONE runs with no boundary to measure" : "BEST_EFFORT_CLI replaces HOME and the environment and applies no OS boundary; a temporary HOME is not a sandbox", failed: [], evidence_digest: null, program_digest: null },
    descendants: { scan: "process-group", poll_interval_ms: null, polls: 0, tracked: [], leaked: [], survivors: [], residual: "the process-group scan does not list a descendant that took its own session" },
    cleanup_verified: null,
    support_status: laneOf({ platform, backend: "none", adapter: adapter.id, level })?.support_status ?? "NOT_OBSERVED",
    platform_lane: platformLaneOf({ platform, backend: "none", adapter: adapter.id }),
    holes: policy.holes.map((one) => ({ env: one.env, access: one.access, staged: [], source: "unconfined" }))
  };
  return {
    level,
    backend: "none",
    platform,
    policy,
    policy_digest: record.policy_digest,
    rendered_profile_digest: null,
    env: Object.create(null),
    staging: null,
    canary: record.boundary_canary,
    support_status: record.support_status,
    spawnSpec: (command, args) => ({ command, args, argv0: null }),
    track: () => null,
    record: ({ leaked = [], survivors = [] } = {}) => ({ ...record, descendants: { ...record.descendants, leaked, survivors } }),
    cleanup: () => []
  };
};

/**
 * Everything that has to be true before the agent is spawned under STRICT, done in the order the
 * issue requires: probe the backend, render the policy for this workspace and store, run the
 * canary inside it, and refuse -- by throwing, inside the caller's `try`, so scratch is removed --
 * if any of it did not hold. A run that asked for STRICT and did not get it does not proceed as
 * something else; the forbidden implementation is exactly the silent downgrade.
 *
 * For the other two levels this returns a passthrough handle whose record says, in the same
 * fields, that nothing was enforced and the canary was not run.
 */
export async function prepareConfinement({ level, platform = process.platform, adapter, workspace, aosHome, agentHome, runScratch, command, env, commandExists = defaultCommandExists, tracker = descendantTracker }) {
  if (!ISOLATION_LEVELS.includes(level)) throw fail("AOS_ISOLATION_LEVEL_INVALID", String(level));
  if (!adapter || typeof adapter !== "object") throw fail("AOS_ISOLATION_ADAPTER_INVALID");
  if (level !== "STRICT") return passthrough(level, platform, adapter, isolationPolicyFor({ level, platform, backend: "none", adapter }));
  const platformAdapter = adapterForPlatform(platform, { commandExists });
  const probe = platformAdapter.probe();
  if (!probe.available) throw fail("AOS_ISOLATION_BACKEND_UNAVAILABLE", probe.reason);
  if (typeof aosHome !== "string" || aosHome === "") throw fail("AOS_ISOLATION_AOS_HOME_REQUIRED", "STRICT confinement needs the store path to deny it");
  const policy = isolationPolicyFor({ level: "STRICT", platform, backend: platformAdapter.id, adapter });
  const pathValue = env?.PATH ?? process.env.PATH;
  const commandPath = commandOnPath(command, pathValue);
  if (commandPath === null) throw fail("AOS_ISOLATION_COMMAND_UNRESOLVED", String(command));
  const commandReal = realpathSync(commandPath);
  // The node the child will run is the one on the child's PATH -- a `#!/usr/bin/env node` runtime
  // execs whichever it finds there -- and that is the tree the profile allows and the binary the
  // canary is launched with, so that the canary measures the boundary the agent gets. AOS's own
  // `process.execPath` is the fallback for a PATH with no node on it.
  const nodeBinary = commandOnPath("node", pathValue) ?? process.execPath;
  const bindings = {
    "@WORKSPACE@": realpathSync(workspace),
    "@AOS_HOME@": realpathSync(aosHome),
    "@AGENT_HOME@": realpathSync(agentHome),
    "@RUN_SCRATCH@": realpathSync(runScratch),
    "@NODE_TREE@": nodeTreeOf(nodeBinary),
    "@RUNTIME_CLI_TREE@": runtimeTreeOf(commandReal)
  };
  const effectivePolicy = policy;
  const operatorHome = process.env.HOME ?? null;
  const staging = stageRuntimeConfig(adapter, env, bindings["@AGENT_HOME@"], operatorHome);
  const confinementDir = mkdtempSync(join(tmpdir(), "aos-confinement-"));
  let prepared;
  try {
    prepared = platformAdapter.prepare(effectivePolicy, bindings, confinementDir);
  } catch (error) {
    rmSync(confinementDir, { recursive: true, force: true });
    throw error;
  }
  const canary = await runBoundaryCanary({
    adapter: platformAdapter,
    prepared,
    workspace: bindings["@WORKSPACE@"],
    aosHome: bindings["@AOS_HOME@"],
    agentHome: bindings["@AGENT_HOME@"],
    runScratch: bindings["@RUN_SCRATCH@"],
    operatorHome: operatorHome && realpathOrNull(operatorHome) ? realpathSync(operatorHome) : "/var/root",
    nodeBinary,
    pathValue,
    networkPolicy: effectivePolicy.network.policy,
    tracker
  });
  if (canary.result !== "PASS") {
    rmSync(confinementDir, { recursive: true, force: true });
    const error = fail("AOS_ISOLATION_CANARY_FAILED", `${platformAdapter.id}: ${canary.failed.join(",")}${canary.spawn_error ? ` (${canary.spawn_error})` : ""}${canary.exit_code !== 0 ? ` exit ${canary.exit_code ?? canary.signal}` : ""}`);
    // For the recorder and `agent doctor`: the cells say which attempt came back wrong.
    error.canary = canary;
    throw error;
  }
  const policyDigest = isolationPolicyDigestOf(effectivePolicy);
  const supportStatus = laneOf({ platform, backend: platformAdapter.id, adapter: adapter.id, level: "STRICT" })?.support_status ?? "NOT_OBSERVED";
  const canaryRecord = {
    result: canary.result,
    failed: canary.failed,
    cells: canary.cells,
    out_of_band: canary.out_of_band,
    evidence_digest: canary.evidence_digest,
    program_digest: canary.program_digest,
    exit_code: canary.exit_code,
    signal: canary.signal,
    scan_polls: canary.scan_polls
  };
  return {
    level: "STRICT",
    backend: platformAdapter.id,
    platform,
    policy: effectivePolicy,
    policy_digest: policyDigest,
    rendered_profile_digest: prepared.rendered_profile_digest,
    profile_path: prepared.profile_path,
    bindings,
    // Applied over the built environment by the caller: the runtime's config variable, pointed at
    // the staged copy inside the agent's HOME. Nothing else, so that the environment record and
    // its policy digest still describe what the child received.
    env: staging.env,
    staging: { dir: staging.dir, staged: staging.staged, source: staging.source },
    canary: canaryRecord,
    canary_run: canary,
    support_status: supportStatus,
    spawnSpec: (spawnCommand, args) => platformAdapter.spawnSpec(prepared, spawnCommand, args),
    track: (pid) => tracker(pid).start(),
    record: ({ leaked = [], survivors = [], tracked = [], polls = 0 } = {}) => ({
      schema: CONFINEMENT_RECORD_SCHEMA,
      level: "STRICT",
      platform,
      backend: platformAdapter.id,
      adapter: adapter.id,
      // Measured, not assumed: the canary passed inside this very profile, which is the only
      // way a filesystem claim gets onto a record here.
      filesystem_enforced: canary.result === "PASS",
      // The child ran in its own session, the ancestry scan polled at least once while it ran,
      // and teardown signalled what the scan found. A run too short for one poll is not enforced.
      process_enforced: canary.result === "PASS" && polls >= 1,
      network_policy: effectivePolicy.network.policy,
      network: { provider_transport: effectivePolicy.network.provider_transport, task_external: "NOT_OBSERVED", enforcement: effectivePolicy.network.enforcement },
      policy_digest: policyDigest,
      rendered_profile_digest: prepared.rendered_profile_digest,
      setup_verified: canary.result === "PASS",
      boundary_canary: canaryRecord,
      descendants: { scan: "ancestry-poll", poll_interval_ms: DESCENDANT_POLL_INTERVAL_MS, polls, tracked, leaked, survivors, residual: residualOf(DESCENDANT_POLL_INTERVAL_MS) },
      // Settled by the caller once the scratch directories are gone: see `settleConfinement`.
      cleanup_verified: null,
      support_status: supportStatus,
      platform_lane: platformLaneOf({ platform, backend: platformAdapter.id, adapter: adapter.id }),
      holes: policy.holes.map((one) => ({ env: one.env, access: one.access, staged: staging.staged, source: staging.source }))
    }),
    cleanup: () => {
      try {
        rmSync(confinementDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        return [];
      } catch (error) {
        return [`${confinementDir}: ${error.code ?? error.message}`];
      }
    }
  };
}

/**
 * Writes the one field that cannot be known when the record is built: whether teardown left
 * anything behind. Called from the `finally` that removes the scratch directories, with whatever
 * failed to be removed. A record that was never settled has `cleanup_verified: null`, and the gate
 * reads null as "not verified".
 */
export function settleConfinement(record, cleanupFailures) {
  if (!record || typeof record !== "object") return record;
  const survivors = Array.isArray(record.descendants?.survivors) ? record.descendants.survivors : null;
  record.cleanup_verified = record.level === "STRICT" && survivors !== null && survivors.length === 0 && Array.isArray(cleanupFailures) && cleanupFailures.length === 0;
  record.scratch_not_removed = Array.isArray(cleanupFailures) ? cleanupFailures.slice() : null;
  return record;
}

const isDigest = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);

/**
 * The decision #559 and #563 consume. Official PROFILE_BOUND issuance needs every one of the
 * issue's conditions at once, and the answer to anything less is `official: false` with each
 * failed condition named; the claim stage ceiling follows from it. A record that is not a record
 * is refused the same way, because a gate that threw on a malformed input would be a gate that
 * could be skipped by malforming the input.
 */
export function issuanceGate(record) {
  if (!record || typeof record !== "object") {
    return decision({ official: false, level: null, backend: null, adapter: null, platform: null, canary: null, reasons: [ISSUANCE_REASONS.RECORD_INVALID], network: null, policyDigest: null });
  }
  const reasons = [];
  const canary = record.boundary_canary && typeof record.boundary_canary === "object" ? record.boundary_canary : null;
  if (record.level !== "STRICT") reasons.push(ISSUANCE_REASONS.LEVEL_NOT_STRICT);
  if (typeof record.backend !== "string" || record.backend === "none" || !(record.backend in BACKENDS)) reasons.push(ISSUANCE_REASONS.BACKEND_ABSENT);
  if (record.filesystem_enforced !== true) reasons.push(ISSUANCE_REASONS.FILESYSTEM_NOT_ENFORCED);
  if (record.process_enforced !== true) reasons.push(ISSUANCE_REASONS.PROCESS_NOT_ENFORCED);
  if (record.setup_verified !== true) reasons.push(ISSUANCE_REASONS.SETUP_UNVERIFIED);
  if (canary === null || canary.result !== "PASS" || !isDigest(canary.evidence_digest)) reasons.push(ISSUANCE_REASONS.CANARY_NOT_PASS);
  const leaked = Array.isArray(record.descendants?.leaked) ? record.descendants.leaked : null;
  const survivors = Array.isArray(record.descendants?.survivors) ? record.descendants.survivors : null;
  if (leaked === null || leaked.length > 0 || survivors === null || survivors.length > 0) reasons.push(ISSUANCE_REASONS.LEAKED_DESCENDANT);
  if (record.cleanup_verified !== true) reasons.push(ISSUANCE_REASONS.CLEANUP_UNVERIFIED);
  if (!isDigest(record.policy_digest)) reasons.push(ISSUANCE_REASONS.POLICY_DIGEST_MISSING);
  if (!SUPPORTED_RELEASE_SET.has(record.support_status)) reasons.push(ISSUANCE_REASONS.SUPPORT_STATUS);
  const lane = laneOf({ platform: record.platform, backend: record.backend, adapter: record.adapter, level: record.level });
  if (lane === null || !SUPPORTED_RELEASE_SET.has(lane.support_status)) reasons.push(ISSUANCE_REASONS.LANE_NOT_PROVEN);
  return decision({
    official: reasons.length === 0,
    level: ISOLATION_LEVELS.includes(record.level) ? record.level : null,
    backend: typeof record.backend === "string" ? record.backend : null,
    adapter: typeof record.adapter === "string" ? record.adapter : null,
    platform: typeof record.platform === "string" ? record.platform : null,
    canary: canary && CANARY_RESULTS.includes(canary.result) ? canary.result : "NOT_RUN",
    reasons,
    network: record.network && typeof record.network === "object"
      ? { policy: typeof record.network_policy === "string" ? record.network_policy : null, provider_transport: record.network.provider_transport ?? null, task_external: record.network.task_external === "NOT_OBSERVED" ? "NOT_OBSERVED" : record.network.task_external ?? "NOT_OBSERVED" }
      : { policy: null, provider_transport: null, task_external: "NOT_OBSERVED" },
    policyDigest: isDigest(record.policy_digest) ? record.policy_digest : null
  });
}

function decision({ official, level, backend, adapter, platform, canary, reasons, network, policyDigest }) {
  return {
    official,
    isolation_level: level,
    backend,
    boundary_canary: canary,
    reasons: [...new Set(reasons)],
    claim_stage_ceiling: official ? CLAIM_STAGE_CEILING.official : CLAIM_STAGE_CEILING.withheld,
    platform_lane: platformLaneOf({ platform, backend, adapter }),
    network,
    policy_digest: policyDigest
  };
}

/**
 * One decision for a run made of several invocations: official only when every invocation is,
 * with the union of every reason otherwise. A run with no invocations is not official -- nothing
 * measured is not the same as nothing wrong.
 */
export function issuanceGateForRun(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return decision({ official: false, level: null, backend: null, adapter: null, platform: null, canary: null, reasons: [ISSUANCE_REASONS.NO_INVOCATIONS], network: null, policyDigest: null });
  }
  const decisions = records.map((record) => issuanceGate(record));
  const first = decisions[0];
  const sameLane = decisions.every((one) => one.platform_lane === first.platform_lane && one.isolation_level === first.isolation_level && one.policy_digest === first.policy_digest);
  const reasons = decisions.flatMap((one) => one.reasons);
  if (!sameLane) reasons.push(ISSUANCE_REASONS.RECORD_INVALID);
  return {
    ...first,
    official: decisions.every((one) => one.official) && sameLane,
    boundary_canary: decisions.every((one) => one.boundary_canary === "PASS") ? "PASS" : decisions.some((one) => one.boundary_canary === "FAIL") ? "FAIL" : "NOT_RUN",
    reasons: [...new Set(reasons)],
    claim_stage_ceiling: decisions.every((one) => one.official) && sameLane ? CLAIM_STAGE_CEILING.official : CLAIM_STAGE_CEILING.withheld,
    invocations: decisions.length
  };
}

const readObservation = (dir, reference) => {
  if (!reference || typeof reference.file !== "string") return null;
  try { return JSON.parse(readFileSync(join(dir, reference.file), "utf8")); } catch { return null; }
};

/**
 * The support matrix fixture, with each row run through the gate. A row's evidence is read from
 * the committed observation it names; a row without one, or whose observation does not say PASS,
 * cannot be official however the row itself is labelled. `fixtureDir` defaults to the fixture's
 * own directory and is a parameter so that a test can point a copy elsewhere.
 */
export function supportMatrixDecisions(fixture, fixtureDir = null) {
  if (!fixture || fixture.schema !== SUPPORT_MATRIX_SCHEMA || !Array.isArray(fixture.lanes)) throw fail("AOS_ISOLATION_SUPPORT_MATRIX_INVALID");
  const dir = fixtureDir ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "confinement");
  return fixture.lanes.map((row) => {
    const canaryObservation = readObservation(dir, row.evidence?.canary);
    const runtimeObservation = readObservation(dir, row.evidence?.runtime);
    const captured = canaryObservation?.captured ?? null;
    const canaryPassed = captured?.result === "PASS" && isDigest(captured?.evidence_digest);
    const runtimeRan = runtimeObservation !== null && runtimeObservation.exit_status === 0;
    const gate = row.gate && typeof row.gate === "object" ? row.gate : {};
    const strict = row.level === "STRICT";
    const record = {
      schema: CONFINEMENT_RECORD_SCHEMA,
      level: row.level,
      platform: row.platform,
      backend: row.backend,
      adapter: row.adapter === "*" ? "generic-command.v1" : row.adapter,
      filesystem_enforced: strict && canaryPassed && gate.filesystem_enforced === true,
      process_enforced: strict && canaryPassed && gate.process_enforced === true,
      network_policy: row.network_policy ?? null,
      network: { provider_transport: row.provider_transport ?? null, task_external: "NOT_OBSERVED" },
      policy_digest: isDigest(captured?.policy_digest) ? captured.policy_digest : null,
      rendered_profile_digest: captured?.rendered_profile_digest ?? null,
      setup_verified: strict && canaryPassed && runtimeRan && gate.setup_verified === true,
      boundary_canary: canaryPassed ? { result: "PASS", failed: [], evidence_digest: captured.evidence_digest, program_digest: captured.program_digest ?? null } : { result: canaryObservation ? "FAIL" : "NOT_RUN", failed: captured?.failed ?? [], evidence_digest: null, program_digest: null },
      descendants: { scan: strict ? "ancestry-poll" : "process-group", polls: captured?.descendants?.polls ?? 0, tracked: [], leaked: captured?.descendants?.leaked ?? [], survivors: captured?.descendants?.survivors ?? [], residual: null },
      cleanup_verified: strict && canaryPassed && gate.cleanup_verified === true,
      support_status: row.support_status
    };
    return {
      platform: row.platform,
      backend: row.backend,
      adapter: row.adapter,
      level: row.level,
      support_status: row.support_status,
      official: row.official === true,
      evidence: row.evidence ?? null,
      constraints: row.constraints ?? [],
      reason: row.reason ?? null,
      decision: issuanceGate(record)
    };
  });
}

/**
 * The table the document shows, rendered from the fixture so that the two cannot say different
 * things. The product test asserts the document contains this text verbatim.
 */
export function renderSupportMatrix(fixture) {
  const rows = supportMatrixDecisions(fixture);
  const lines = [
    "| Platform | Backend | Adapter | Level | Support | Official | Reason / evidence |",
    "|---|---|---|---|---|---|---|"
  ];
  for (const row of rows) {
    const official = row.official && row.decision.official ? "OFFICIAL" : "withheld";
    const why = row.official && row.decision.official
      ? `canary \`${basename(row.evidence.canary.file)}\` PASS; runtime \`${basename(row.evidence.runtime.file)}\` exit 0`
      : row.decision.reasons.join(", ") + (row.reason ? ` -- ${row.reason}` : "");
    lines.push(`| ${row.platform} | ${row.backend} | ${row.adapter} | ${row.level} | ${row.support_status} | ${official} | ${why} |`);
  }
  return `${lines.join("\n")}\n`;
}
