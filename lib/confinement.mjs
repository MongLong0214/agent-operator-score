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
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "./digest.mjs";
import { describeExecutable } from "./runtime-identity.mjs";

export const CONFINEMENT_RECORD_SCHEMA = "aos-confinement-record.v1";
export const ISOLATION_POLICY_SCHEMA = "aos-isolation-policy.v1";
export const SUPPORT_MATRIX_SCHEMA = "aos-confinement-support-matrix.v1";
export const BOUNDARY_CANARY_SCHEMA = "aos-boundary-canary.v1";

export const ISOLATION_LEVELS = Object.freeze(["STRICT", "BEST_EFFORT_CLI", "NONE"]);
export const CONFINED_PLATFORMS = Object.freeze(["darwin", "linux"]);
export const NETWORK_POLICIES = Object.freeze(["provider-required-unrestricted", "restricted", "disabled"]);
// Who stops the traffic, in the same shape: the kernel under a Seatbelt profile, the mount and
// network namespaces under bubblewrap, or nobody.
export const NETWORK_ENFORCEMENT = Object.freeze(["kernel", "mount-namespace", "none"]);
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
  // `runtime_path` is what makes staging a decision about the executable rather than about the
  // label the operator typed. The adapter id is a string an agent registration chooses freely, and
  // staging copies the operator's credential: `aos agent add evil --command node --adapter
  // codex-cli.v1` was handed `~/.codex/auth.json` because the two were never connected. A staged
  // credential now needs a VERIFIED identity (#554) whose resolved real path is the runtime this
  // adapter is the adapter for.
  ["codex-cli.v1", Object.freeze({ dir: ".codex", files: Object.freeze(["auth.json", "config.toml"]), runtime_path: /(?:^|\/)@openai\/codex\//u })],
  ["claude-code.v1", Object.freeze({ dir: ".claude", files: Object.freeze([]), runtime_path: /(?:^|\/)@anthropic-ai\/claude-code\//u })]
]);

/**
 * Whether a verified identity is the runtime this adapter names.
 *
 * Two questions, and the old code asked neither: is the file what #554 verified (owner, mode,
 * parent security, no writable link in the chain), and is that file the runtime whose credential
 * is about to be copied? A VERIFIED identity for `/usr/bin/node` is a true statement about node and
 * says nothing about Codex.
 */
export function runtimeIdentityMatches(identity, adapter) {
  const spec = adapter?.id ? RUNTIME_CONFIG_STAGING.get(adapter.id) ?? null : null;
  if (spec === null) return { ok: false, reason: "this adapter stages nothing" };
  if (!identity || typeof identity !== "object") return { ok: false, reason: "no runtime identity was verified for this command" };
  if (identity.identity_status !== "VERIFIED") return { ok: false, reason: `runtime identity is ${identity.identity_status ?? "absent"}` };
  const real = typeof identity.resolved_realpath === "string" ? identity.resolved_realpath : "";
  const chain = Array.isArray(identity.interpreter_chain) ? identity.interpreter_chain.map((one) => (typeof one === "string" ? one : one?.realpath ?? "")) : [];
  if (![real, ...chain].some((path) => spec.runtime_path.test(path))) {
    return { ok: false, reason: `the verified executable is not ${adapter.id}` };
  }
  return { ok: true, reason: null };
}

/**
 * The platform's own paths, which are constants of the operating system rather than facts about
 * this machine.
 *
 * The policy declares which of these the boundary grants, and `isolationPolicyDigestOf` refuses
 * any other absolute string: a machine path in the policy -- an operator's home, a temporary
 * directory with a run id in it -- would make the digest describe the host instead of the
 * boundary, and two runs on two machines would never be comparable. These are the narrowest set
 * the runtime was measured to need on darwin; each is either proved necessary by a canary cell or
 * is a symlink a path must resolve through.
 */
export const PLATFORM_READ_SETS = Object.freeze({
  darwin: Object.freeze({
    trees: Object.freeze(["/usr/lib", "/System/Library", "/private/var/db/dyld"]),
    files: Object.freeze(["/", "/private", "/private/tmp", "/private/var", "/private/var/folders", "/Users", "/etc", "/tmp", "/var", "/usr", "/usr/bin", "/bin"]),
    devices_readable: Object.freeze(["/dev/null", "/dev/urandom", "/dev/random", "/dev/zero", "/dev/dtracehelper"]),
    devices_writable: Object.freeze(["/dev/null"]),
    executable: Object.freeze(["/usr/bin", "/bin", "/usr/lib", "/System/Library"])
  }),
  linux: Object.freeze({
    trees: Object.freeze(["/usr", "/lib", "/lib64", "/bin", "/etc/ssl", "/etc/resolv.conf"]),
    files: Object.freeze([]),
    devices_readable: Object.freeze(["/dev/null", "/dev/urandom", "/dev/random", "/dev/zero"]),
    devices_writable: Object.freeze(["/dev/null"]),
    executable: Object.freeze(["/usr/bin", "/bin", "/usr/lib"])
  })
});

const PLATFORM_PATHS = new Set(Object.values(PLATFORM_READ_SETS).flatMap((set) => Object.values(set).flat()));

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
  RECORD_INVALID: "AOS_ISOLATION_RECORD_INVALID",
  EVIDENCE_DIGEST_MISMATCH: "AOS_ISOLATION_EVIDENCE_DIGEST_MISMATCH",
  EVIDENCE_EXECUTION_FAILED: "AOS_ISOLATION_EVIDENCE_EXECUTION_FAILED",
  RUNTIME_IDENTITY_UNVERIFIED: "AOS_ISOLATION_RUNTIME_IDENTITY_UNVERIFIED",
  EVIDENCE_MISSING: "AOS_ISOLATION_EVIDENCE_MISSING"
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
  // The two grants the narrowed read policy keeps, proved rather than assumed: the tree the
  // runtime needs is readable, and the host configuration tree that used to be granted with it
  // is not. A policy that widens again fails here.
  "system_library_read",
  "host_etc_read",
  "detached_descendant",
  "orphaned_descendant",
  // The one no scan can find, and the one that carries the lane's actual claim: it sheds every
  // marker and the kernel still refuses it the world outside the workspace.
  "stripped_descendant"
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
  const platformRead = PLATFORM_READ_SETS[platform];
  if (platformRead === undefined) throw fail("AOS_ISOLATION_PLATFORM_UNSUPPORTED", String(platform));
  if (BACKENDS[backend].platform !== platform) throw fail("AOS_ISOLATION_BACKEND_PLATFORM_MISMATCH", `${backend} is not a ${platform} backend`);
  return Object.freeze({
    schema: ISOLATION_POLICY_SCHEMA,
    policy_version: 1,
    level: "STRICT",
    platform,
    backend,
    adapter: adapter.id,
    // Every grant the boundary will carry, declared here and nowhere else. The renderer emits
    // these arrays; a second list inside the renderer was the defect the review found -- setting
    // `readable` to `[]` changed the policy digest and left the rendered rules byte-identical,
    // which is a digest that governs nothing. The system trees are the narrowest set the runtime
    // was measured to need on this machine: `/usr/lib` and `/System/Library` for the dynamic
    // loader and the TLS stack, `/private/var/db/dyld` for the shared cache, and the literals for
    // the symlinks a path has to resolve through (`/tmp`, `/var`, `/etc`, `/Users`). `/Library`,
    // `/usr/share`, `/private/etc`, `/private/var/select` and `/private/var/db/timezone` were
    // granted and are not needed: `codex login status` and `codex exec` both run without them, and
    // two canary cells hold the line -- one proves the granted tree is readable, the other proves
    // `/private/etc/hosts` is not.
    filesystem: Object.freeze({
      default: "deny",
      enforcement: mechanism,
      writable: Object.freeze(["@WORKSPACE@", "@AGENT_HOME@"]),
      readable: Object.freeze(["@RUN_SCRATCH@", "@NODE_TREE@", "@RUNTIME_CLI_TREE@"]),
      system_readable: platformRead.trees,
      system_readable_files: platformRead.files,
      device_readable: platformRead.devices_readable,
      device_writable: platformRead.devices_writable,
      executable: Object.freeze([...platformRead.executable, "@NODE_TREE@", "@RUNTIME_CLI_TREE@"]),
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
    if (text.startsWith("/") && !PLATFORM_PATHS.has(text)) throw fail("AOS_ISOLATION_POLICY_PATH_LEAK", text);
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
const OPTIONAL_BINDINGS = Object.freeze(["@OPERATOR_HOME@", "@WORKSPACE_PARENT@"]);

// The invariants both renderers share. The workspace lives inside the store -- that is where
// `runPaths` puts it -- and it is allowed by a later, more specific rule than the one denying the
// store, so a workspace that *contains* the store would re-open all of it. Scratch inside the store
// is refused for the same reason; a tree bound at `/` would allow everything.
function checkBindings(policy, bindings) {
  const bound = Object.create(null);
  for (const name of REQUIRED_BINDINGS) bound[name] = safePath(name, bindings[name]);
  // Optional: a deny for a path this run has no value for is dropped rather than rendered as a
  // placeholder. Every other binding is required, and a missing one is a refusal.
  for (const name of OPTIONAL_BINDINGS) bound[name] = typeof bindings[name] === "string" ? safePath(name, bindings[name]) : null;
  // Both directions, and against the canonical path. A workspace that *contains* the store re-opens
  // all of it through the allow that follows the deny; a workspace *inside* the store is the cwd
  // disclosure the issue forbids -- and a symlinked workspaces root (`AOS_WORKSPACES=/tmp/ws` where
  // `/tmp/ws -> <store>/workspaces`) is inside it while looking as if it is not, which is why the
  // comparison is made on realpaths rather than on the strings the operator typed.
  if (within(bound["@WORKSPACE@"], bound["@AOS_HOME@"])) throw fail("AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME", bound["@WORKSPACE@"]);
  if (within(bound["@AOS_HOME@"], bound["@WORKSPACE@"])) throw fail("AOS_ISOLATION_WORKSPACE_INSIDE_STORE", bound["@WORKSPACE@"]);
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
  const fs = policy.filesystem;
  const subpaths = (names) => names.map((name) => `(subpath "${name}")`).join(" ");
  const literals = (names) => names.map((name) => `(literal "${name}")`).join(" ");
  const lines = [
    "(version 1)",
    "(deny default)",
    `; AOS STRICT confinement, isolation policy ${isolationPolicyDigestOf(policy)}`,
    "(allow process-fork)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow signal (target self) (target pgrp))",
    // Metadata only: `stat` on a path the process cannot read. Without it nothing can resolve a
    // path at all, and it discloses no content.
    "(allow file-read-metadata)",
    `(allow file-write* ${literals(fs.device_writable)})`,
    `(allow file-read* ${literals(fs.device_readable)})`,
    `(allow file-read* ${subpaths(fs.system_readable)} ${literals(fs.system_readable_files)})`,
    `(allow process-exec ${subpaths(fs.executable)})`
  ];
  if (policy.network.policy === "provider-required-unrestricted") {
    lines.push("(allow network-outbound)", "(allow network-bind)", "(allow system-socket)");
  }
  // Denies before allows: Seatbelt's later rule wins, so the store is denied by name and the run's
  // own workspace inside it -- when it is inside it -- is granted back by the rule after it.
  lines.push("(allow ipc-posix-shm)");
  for (const name of fs.denied) {
    // A deny whose path this run has no value for is skipped, not rendered: an unbound
    // placeholder in a profile is a rule about a literal `@NAME@` directory.
    if (bound[name] === null || bound[name] === undefined) continue;
    lines.push(`(deny file-read* file-write* (subpath "${name}"))`);
  }
  // After the denies, because Seatbelt's later rule wins and these are the exceptions to them: the
  // node and runtime trees can sit inside the operator's denied home (a user-level install
  // usually does), and the run's own workspace can sit inside a denied workspaces root.
  lines.push(`(allow file-read* ${subpaths(fs.readable)})`);
  lines.push(`(allow file-read* file-write* ${subpaths(fs.writable)})`);
  let text = `${lines.join("\n")}\n`;
  for (const [name, value] of Object.entries(bound)) {
    if (value !== null) text = text.split(name).join(value);
    // A binding the policy does not name is not silently dropped: an unbound placeholder left in
    // the text is refused below, and a placeholder bound to null must not appear in a rule.
  }
  // `@OPERATOR_HOME@` and `@WORKSPACE_PARENT@` are declared denies whose paths may be absent on a
  // given run (no operator home to deny, or a workspace with no parent inside the store). A deny
  // rule for a path that does not exist is harmless; an unbound placeholder is not.
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
  const fs = policy.filesystem;
  const args = ["--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc", "--unshare-uts"];
  if (policy.network.policy === "disabled") args.push("--unshare-net");
  // Mounted from the policy, the way the Seatbelt profile is rendered from it. This renderer kept
  // its own list -- all of `/etc` and all of `/sbin` where the policy declares `/etc/ssl` and
  // `/etc/resolv.conf` -- which is the same defect the Seatbelt side had: a second mapping makes
  // the policy digest a description of something other than the boundary that was applied, and it
  // put `/etc/hostname` and `/etc/machine-id` inside a boundary that never declared them.
  for (const tree of [...fs.system_readable, ...fs.system_readable_files]) args.push("--ro-bind-try", tree, tree);
  // `/proc` and `/dev` are the namespace's own, not the host's: `--proc` and `--dev` mount fresh
  // instances inside the sandbox, and the policy names the device nodes that instance carries.
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  for (const tree of fs.readable) args.push("--ro-bind", bound[tree] ?? tree, bound[tree] ?? tree);
  for (const tree of fs.writable) args.push("--bind", bound[tree] ?? tree, bound[tree] ?? tree);
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
// Ancestry polling, and the group sweep beside it. Named on the record because the gate demands
// both: the poll catches a descendant that re-sessions while its parent lives, the sweep catches
// one that double-forks and keeps the group, and neither alone is the process axis.
export const DESCENDANT_SCAN = "ancestry-poll+process-group-sweep+survivor-sweep";

const residualOf = (intervalMs) => `a survivor with no marker, no handle and no pid AOS ever held: a descendant that double-forks, re-sessions, clears its environment, closes every inherited descriptor and changes directory is in none of the three scans (ancestry at ${intervalMs} ms, process group, survivor sweep). Measured and accepted rather than missed: a review reproduced it with poll 1 holding the root pid and poll 2 holding a live pid reparented to init and regrouped to itself, and this record still reports process_enforced. Anything AOS did hold a pid for -- including the canary's own escapee, which sheds every marker on purpose -- is killed and checked, and a live one is a detected leak that blocks. What holds the rest is the boundary itself, inherited across fork and exec and unsheddable with the markers, proved per run by that escapee being refused a write outside the workspace. Such a process can outlive the run and write inside that run's own workspace after the evidence has been digested; it cannot reach anything else, and it cannot see another run`;

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
attempt("system_library_read", () => ({ bytes: readFileSync(spec.system_library_file).length }));
attempt("host_etc_read", () => ({ bytes: readFileSync(spec.host_etc_file).length }));
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
  // The descendant tries to leave the boundary before it sleeps, and writes what happened where
  // the parent can read it. A process that outlives its parent is only dangerous if it is outside;
  // this is the evidence that it is not, and it is the kernel's answer rather than a claim.
  const escapee = spec.outside_file + ".escapee";
  const marker = join(spec.workspace, ".aos-canary-escapee-" + spec.nonce);
  const child = spawn("/bin/sh", ["-c", 'printf escapee > "$1" 2>/dev/null; printf %s "$?" > "$2"; sleep 30', "sh", escapee, marker], { detached: true, stdio: "ignore" });
  child.unref();
  cells.detached_descendant = { outcome: "spawned", errno: null, detail: { pid: child.pid } };
} catch (error) {
  cells.detached_descendant = { outcome: "failed", errno: error && error.code ? error.code : null, detail: String(error && error.message) };
}
try {
  // The descendant that sheds everything: no environment, no inherited descriptors, its own
  // session, and a working directory outside the run. No scan can find it -- that is the point of
  // this cell. What it proves is the property the lane actually rests on: the Seatbelt profile is
  // inherited across fork and exec and cannot be shed with the markers, so this process writes
  // inside the workspace (allowed, which is how the parent knows it ran) and is refused outside it
  // (denied by the kernel, which is the claim). An enumeration that comes back empty proves
  // nothing; this does.
  const strippedInside = join(spec.workspace, ".aos-canary-stripped-" + spec.nonce);
  const strippedOutside = spec.outside_file + ".stripped";
  const stripped = spawn("/bin/sh", ["-c", 'cd /; exec 0<&- 1>&- 2>&-; printf escaped > "$2" 2>/dev/null; s=$?; printf %s "$s" > "$1"; sleep 30', "sh", strippedInside, strippedOutside], {
    detached: true,
    stdio: "ignore",
    cwd: "/",
    env: {}
  });
  stripped.unref();
  cells.stripped_descendant = { outcome: "spawned", errno: null, detail: { pid: stripped.pid } };
} catch (error) {
  cells.stripped_descendant = { outcome: "failed", errno: error && error.code ? error.code : null, detail: String(error && error.message) };
}
try {
  // And the escape the ancestry poll cannot follow: a child in its own session that starts a
  // grandchild and exits at once, leaving it reparented to init with a group of its own and no
  // live link to this run. Its pid is written into the workspace so the parent can look for it by
  // pid as well as by sweep. This is the case the record used to admit and issue over.
  const pidFile = join(spec.workspace, ".aos-canary-orphan-" + spec.nonce);
  const orphan = spawn("/bin/sh", ["-c", 'sleep 30 & printf %s "$!" > "$1"; exit 0', "sh", pidFile], { detached: true, stdio: "ignore" });
  orphan.unref();
  cells.orphaned_descendant = { outcome: "spawned", errno: null, detail: { parent: orphan.pid } };
} catch (error) {
  cells.orphaned_descendant = { outcome: "failed", errno: error && error.code ? error.code : null, detail: String(error && error.message) };
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
  system_library_read: "allowed",
  host_etc_read: "denied",
  detached_descendant: "spawned",
  orphaned_descendant: "spawned",
  stripped_descendant: "spawned"
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
  // `escapee_confined` is the third: the descendant tried to write outside the boundary before it
  // slept, and the kernel refused it. A process that survives a poll interval is a lifetime
  // problem; a process that survives *and is outside* is an access problem, and this is what says
  // the second did not happen.
  for (const name of ["observed_by_scan", "dead_after_cleanup", "escapee_confined"]) {
    if (descendant[name] !== true) failed.push(`descendant.${name}`);
  }
  // And the orphan, which the ancestry poll is not expected to have seen: the sweep has to have
  // found it, and it has to be gone afterwards. This is the double-fork-plus-setsid case, measured
  // rather than admitted.
  const orphan = outOfBand?.orphan ?? {};
  for (const name of ["found_by_sweep", "dead_after_cleanup"]) {
    if (orphan[name] !== true) failed.push(`orphan.${name}`);
  }
  // The stripped descendant, which is the one the lane's claim is about: it ran, and the kernel
  // refused it the world outside the workspace. Nothing here asks whether it was found.
  const strippedOut = outOfBand?.stripped ?? {};
  // `dead_after_cleanup` among them: this escapee is AOS's own child and its pid was in hand, so a
  // live one is a leak this run detected, and a detected leak blocks. The residual the lane carries
  // is narrower -- a survivor with no marker, no handle, and no pid AOS ever held.
  for (const name of ["ran", "confined", "dead_after_cleanup"]) {
    if (strippedOut[name] !== true) failed.push(`stripped.${name}`);
  }
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
  return {
    result: failed.length === 0 ? "PASS" : "FAIL",
    failed,
    cells: judged,
    out_of_band: { planted_intact: { ...planted }, descendant: { ...descendant }, orphan: { ...orphan }, stripped: { ...strippedOut } },
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
 * A file this run may copy: a regular file, reached without following a link, whose own path is
 * where it says it is.
 *
 * `statSync` follows the last component, so `~/.codex/config.toml -> /etc/shadow` was a regular
 * file by that test and its bytes were copied into a directory the assessed agent reads. What
 * comes out is not credential-shaped, so nothing downstream removes it: plain host content walks
 * out through the agent's own stdout. The rule the issue states for the boundary is the rule here
 * -- a symlink fails closed, by name -- and the realpath is compared as well, because a link in a
 * parent directory moves the file just as effectively as one on the leaf.
 */
const stageableFile = (path, sourceDir) => {
  let entry;
  try { entry = lstatSync(path); } catch { return { ok: false, reason: "absent" }; }
  if (entry.isSymbolicLink()) return { ok: false, reason: "symlink" };
  if (!entry.isFile()) return { ok: false, reason: "not-a-regular-file" };
  const real = realpathOrNull(path);
  if (real === null) return { ok: false, reason: "unresolvable" };
  // Belt and braces, and deliberately unreachable while the caller canonicalises the directory
  // before joining a name onto it: with a real parent chain and a leaf that is not a link, the
  // realpath is the path. It stays because the cost is one comparison and the failure it would
  // catch -- a source directory that stops being canonicalised -- is the same class as the leaf
  // link above. No test can kill it, so no guard claims it.
  if (real !== path && !within(sourceDir, real)) return { ok: false, reason: "resolves-outside-the-config-directory" };
  return { ok: true, reason: null };
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
export function stageRuntimeConfig(adapter, env, agentHome, operatorHome, identity = null) {
  const envOut = Object.create(null);
  const digests = Object.create(null);
  const secrets = new Set();
  const spec = adapter?.config_env ? RUNTIME_CONFIG_STAGING.get(adapter.id) ?? null : null;
  if (spec === null) return { env: envOut, dir: null, staged: [], missing: [], refused: [], digests, secrets: [], source: "none", identity: null };
  // The credential is copied for the runtime, not for the label. Nothing is staged, and no
  // variable is set, when the executable about to run is not the verified runtime this adapter
  // names -- the child then runs with no configuration directory at all, which is what an
  // unidentified program is entitled to.
  const match = runtimeIdentityMatches(identity, adapter);
  if (!match.ok) {
    return { env: envOut, dir: null, staged: [], missing: [...spec.files], refused: [], digests, secrets: [], source: "refused", identity: { status: identity?.identity_status ?? null, digest: identity?.identity_digest ?? null, matches_adapter: false, reason: match.reason } };
  }
  const fromEnv = env?.[adapter.config_env] ?? null;
  const source = fromEnv ? "operator_env" : operatorHome ? "default_dir" : "absent";
  const sourceDir = fromEnv ? realpathOrNull(fromEnv) : operatorHome ? realpathOrNull(join(operatorHome, spec.dir)) : null;
  const dir = join(agentHome, spec.dir);
  mkdirSync(dir, { mode: 0o700 });
  const staged = [];
  const missing = [];
  const refused = [];
  for (const name of spec.files) {
    const from = sourceDir === null ? null : join(sourceDir, name);
    if (from === null) {
      missing.push(name);
      continue;
    }
    const stageable = stageableFile(from, sourceDir);
    if (!stageable.ok) {
      // Named, not silently skipped: an operator whose `config.toml` is a link into a dotfiles
      // repository needs to know why the runtime came up without it, and a reader of the record
      // needs to know that this run copied nothing from there.
      (stageable.reason === "absent" ? missing : refused).push(stageable.reason === "absent" ? name : `${name}: ${stageable.reason}`);
      continue;
    }
    const bytes = readFileSync(from);
    writeFileSync(join(dir, name), bytes, { mode: 0o600, flag: "wx" });
    staged.push(name);
    // Configuration only. `auth.json` holds the credential: its digest would go into a published
    // record, it changes whenever the runtime refreshes a token, and a cohort defined by it would
    // split for a reason nobody could act on. What is bound is what changes the runtime's
    // behaviour -- MCP servers, plugins, model settings.
    if (name !== "auth.json") digests[name] = sha256Bytes(bytes);
    for (const value of credentialValuesIn(bytes)) secrets.add(value);
  }
  envOut[adapter.config_env] = dir;
  // `secrets` is what the caller must scrub out of anything the child prints. The exact-value
  // scrubber used to be built from the environment alone, and staging put a credential somewhere
  // the child can read that never passed through the environment: a task that opens its staged
  // `auth.json` and prints a token shape nothing recognises published it verbatim.
  // `digests` binds the bytes of the configuration the runtime was actually given -- MCP servers,
  // plugins, model settings -- so two runs cannot differ in it and still claim one cohort.
  return { env: envOut, dir, staged, missing, refused, digests, secrets: [...secrets], source: sourceDir === null ? "absent" : source, identity: { status: identity.identity_status, digest: identity.identity_digest ?? null, matches_adapter: true, reason: null } };
}

/**
 * The credential-shaped strings inside a staged runtime config file.
 *
 * Two ways in, because a credential announces itself in two ways. The first is the name it is
 * filed under: any string value under a key that says token, secret, password, credential, key,
 * auth, session or cookie is a credential whatever it looks like -- `"shortsecret"` is one, and so
 * is one with a space in it. Length and shape were the only tests here, so an eleven-character
 * refresh token was collected by nothing and printed by the agent into the public result. The
 * second is shape alone, for values filed under names this module does not recognise: a long
 * unbroken string is collected because it cannot be prose.
 *
 * The floor of four characters is not a guess about credentials; it is about what removing a value
 * from every surface would do. A three-character string appears inside ordinary words, and
 * scrubbing it would rewrite the evidence around it.
 */
export function credentialValuesIn(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes ?? "");
  const found = new Set();
  // Anywhere under a credential-shaped key, not only directly beneath one: `tokens.refresh_token`
  // and `session.material` are both inside a subtree the name says is credential material, and the
  // leaf's own name is no longer the question once an ancestor has answered it.
  const walk = (value, credentialed = false) => {
    if (typeof value === "string") {
      if ((credentialed && value.length >= KEYED_SECRET_MIN) || (value.length >= STAGED_SECRET_MIN && !/\s/u.test(value))) found.add(value);
      return;
    }
    if (Array.isArray(value)) { for (const one of value) walk(one, credentialed); return; }
    if (value && typeof value === "object") {
      for (const [name, one] of Object.entries(value)) walk(one, credentialed || CREDENTIAL_KEY.test(String(name)));
    }
  };
  try { walk(JSON.parse(text)); } catch {
    // Not JSON: an assignment carries its own key, and the same two ways in apply to it.
    for (const line of text.split("\n")) {
      const assignment = line.match(/^\s*([A-Za-z_][\w.-]*)\s*[=:]\s*"?([^"\n]*?)"?\s*$/u);
      if (assignment && CREDENTIAL_KEY.test(assignment[1]) && assignment[2].length >= KEYED_SECRET_MIN) found.add(assignment[2]);
    }
    for (const match of text.matchAll(/"([^"\n]{16,})"|=\s*([^\s"'#]{16,})/gu)) {
      const value = match[1] ?? match[2];
      if (typeof value === "string" && !/\s/u.test(value)) found.add(value);
    }
  }
  return [...found];
}

// What a credential is filed under. Names, not values: this is the half that does not depend on
// guessing what an unfamiliar runtime's token looks like.
const CREDENTIAL_KEY = /(?:token|secret|password|passwd|credential|api[_-]?key|^key$|_key$|key_|auth|session|cookie|bearer|signature|private)/iu;

const KEYED_SECRET_MIN = 4;

// Below this a "credential" is a word, and removing every occurrence of it removes prose.
const STAGED_SECRET_MIN = 16;

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
export async function runBoundaryCanary({ adapter, prepared, workspace, aosHome, agentHome, runScratch, operatorHome, nodeBinary = process.execPath, pathValue = "/usr/bin:/bin", networkPolicy, platform = process.platform, tracker = descendantTracker }) {
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
    // One file inside a tree the policy grants, and one inside a tree it used to grant and no
    // longer does. Both are platform constants, and the pair is what makes the narrowed read
    // policy a measurement rather than a claim.
    system_library_file: platform === "linux" ? "/usr/lib/os-release" : "/usr/lib/dyld",
    host_etc_file: platform === "linux" ? "/etc/hostname" : "/private/etc/hosts",
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
  // The mark the sweep looks for. Unique to this canary run, inherited by everything it starts,
  // and it survives a reparent and a regroup -- which is the point.
  env.AOS_SESSION_ID = `canary-${nonce}`;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let spawnError = null;
  let canaryPid = null;
  let scan = null;
  let outcome;
  try {
    const child = spawn(launch.command, launch.args, { cwd: workspace, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"], env, argv0: launch.argv0 ?? launch.command });
    canaryPid = Number.isInteger(child.pid) ? child.pid : null;
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
  // The orphan: reparented to init, in a session and a group of its own, with nothing in the
  // process table tying it to this run. The sweep is the only thing that finds it, and this is
  // where the record learns whether the sweep did.
  let orphanPid = null;
  try { orphanPid = Number(readFileSync(join(workspace, `.aos-canary-orphan-${nonce}`), "utf8").trim()); } catch {}
  if (!Number.isInteger(orphanPid) || orphanPid <= 1) orphanPid = null;
  // What the stripped descendant proved, read from outside it: it wrote its own status inside the
  // workspace (so it ran, under the inherited profile) and the file it tried to create outside the
  // boundary is not there (so the kernel refused it). This is the lane's claim about a descendant
  // no scan can find, and it is a fact about this run rather than a property of the scanners.
  let strippedStatus = null;
  try { strippedStatus = readFileSync(join(workspace, `.aos-canary-stripped-${nonce}`), "utf8").trim(); } catch {}
  const strippedConfined = strippedStatus !== null && strippedStatus !== "" && strippedStatus !== "0" && !existsSync(`${plants.outside}.stripped`);
  // The pid AOS already holds. This descendant is invisible to all three scans by construction, but
  // it is not invisible to the process that started it: a leak we can see is not a residual, and a
  // run that could not kill its own canary escapee has not shown a clean teardown. Killed here and
  // then checked, exactly as the tracked descendant is.
  const strippedPid = Number.isInteger(cells?.stripped_descendant?.detail?.pid) ? cells.stripped_descendant.detail.pid : null;
  if (strippedPid !== null) {
    try { process.kill(strippedPid, "SIGKILL"); } catch {}
  }
  const strippedDead = strippedPid === null ? false : await waitDead(strippedPid, 1000);
  const sweepPaths = [workspace, agentHome, runScratch];
  const found = survivorSweep({ marker: `canary-${nonce}`, groupId: canaryPid, paths: sweepPaths, platform });
  const orphanFound = orphanPid !== null && found.survivors.includes(orphanPid);
  for (const pid of found.survivors) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  if (found.survivors.length > 0) await pause(250);
  // Swept again after the signal: what the first sweep found is what escaped, and what the second
  // still sees is what survived being killed. The record's `survivors` is the second, so a lane
  // that caught its own orphan reads as clean and one that could not kill it does not.
  const sweep = found.survivors.length === 0
    ? found
    : { ...survivorSweep({ marker: `canary-${nonce}`, groupId: canaryPid, paths: sweepPaths, platform }), found_before_signal: found.survivors };
  const orphanDead = orphanPid === null ? false : await waitDead(orphanPid, 1000);
  // What the descendant reported about its own attempt to leave, read from the workspace it was
  // allowed to write and cross-checked against the file it tried to create outside. Both have to
  // agree: a marker saying "denied" while the outside file exists is not a confined descendant.
  let escapeeStatus = null;
  try { escapeeStatus = readFileSync(join(workspace, `.aos-canary-escapee-${nonce}`), "utf8").trim(); } catch {}
  const escapeeConfined = escapeeStatus !== null && escapeeStatus !== "" && escapeeStatus !== "0" && !existsSync(`${plants.outside}.escapee`);
  const intact = Object.create(null);
  for (const [name, file] of Object.entries(plants)) {
    let content = null;
    try { content = readFileSync(file, "utf8"); } catch {}
    intact[name] = content === nonce && !existsSync(`${file}.written`);
  }
  for (const file of Object.values(plants)) { try { unlinkSync(file); } catch {} }
  // The spec named the store by path. It, and the program, are gone before the agent starts, so
  // the readable run scratch carries neither.
  for (const file of [`${plants.outside}.written`, `${plants.outside}.escapee`, `${plants.outside}.stripped`, join(workspace, `.aos-canary-stripped-${nonce}`), join(workspace, workspaceFile), join(workspace, `.aos-canary-write-${nonce}`), join(workspace, `.aos-canary-link-${nonce}`), join(workspace, `.aos-canary-escapee-${nonce}`), join(workspace, `.aos-canary-orphan-${nonce}`), specFile, program]) {
    try { rmSync(file, { force: true }); } catch {}
  }
  // The group the canary child led, swept from the table after teardown. The canary is spawned
  // detached, so its pid is its process group id: this is the same sweep `runProcess` makes at the
  // end of a run, measured here so that a committed observation carries one instead of a matrix
  // row inventing it.
  const canaryGroup = { pgid: canaryPid, members: canaryPid === null ? [] : processTable().filter((row) => row.pgid === canaryPid && row.pid !== canaryPid).map((row) => row.pid) };
  const evaluated = evaluateCanary({
    cells,
    stdout,
    networkPolicy,
    exitCode: outcome.code,
    spawnError,
    outOfBand: {
      planted_intact: intact,
      descendant: { pid: descendantPid, observed_by_scan: observedByScan, dead_after_cleanup: deadAfterCleanup, escapee_confined: escapeeConfined, escapee_status: escapeeStatus, survivors },
      orphan: { pid: orphanPid, found_by_sweep: orphanFound, dead_after_cleanup: orphanDead, scanners: sweep.scanners },
      // No `found_by_sweep` here on purpose: this descendant is not expected to be found by a scan,
      // and a cell asking whether it was would assert the thing this run cannot prove. `pid` and
      // `dead_after_cleanup` are a different question, and AOS can answer it: this is its own
      // child, so its death is measured rather than assumed.
      stripped: { pid: strippedPid, ran: strippedStatus !== null && strippedStatus !== "", confined: strippedConfined, dead_after_cleanup: strippedDead, status: strippedStatus }
    }
  });
  return {
    ...evaluated,
    group_sweep: canaryGroup,
    survivor_sweep: sweep,
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
export async function prepareConfinement({ level, platform = process.platform, adapter, workspace, aosHome, agentHome, runScratch, command, env, commandExists = defaultCommandExists, tracker = descendantTracker, identify = describeExecutable, operatorHome: operatorHomeOverride = null }) {
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
  // Where the runtime's own configuration lives, which is a fact about the operator's account and
  // not about the child's environment. Passed in so a test can name a home of its own; production
  // reads it from this process, which is the account whose credential is being copied.
  const operatorHome = operatorHomeOverride ?? process.env.HOME ?? null;
  const bindings = {
    "@WORKSPACE@": realpathSync(workspace),
    "@AOS_HOME@": realpathSync(aosHome),
    "@AGENT_HOME@": realpathSync(agentHome),
    "@RUN_SCRATCH@": realpathSync(runScratch),
    "@NODE_TREE@": nodeTreeOf(nodeBinary),
    "@RUNTIME_CLI_TREE@": runtimeTreeOf(commandReal),
    // Denied by name as well as by the deny-default: the operator's home, and the directory this
    // run's workspace sits in -- which holds every other run's workspace. The run's own workspace
    // is granted back by the rule after the denies, so what this removes is the sibling runs and
    // nothing else.
    "@OPERATOR_HOME@": operatorHome === null ? null : realpathOrNull(operatorHome),
    "@WORKSPACE_PARENT@": realpathOrNull(dirname(realpathSync(workspace)))
  };
  const effectivePolicy = policy;
  // #554's identity, computed here because this is where the credential is copied. An adapter that
  // stages nothing does not need one; one that does gets no staging without it, and the record says
  // which executable it was.
  const runtimeIdentity = identify(command, { adapterId: adapter.id, env });
  const staging = stageRuntimeConfig(adapter, env, bindings["@AGENT_HOME@"], operatorHome, runtimeIdentity);
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
    scan_polls: canary.scan_polls,
    group_sweep: canary.group_sweep ?? null
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
    staging: { dir: staging.dir, staged: staging.staged, digests: staging.digests, source: staging.source, identity: staging.identity },
    // Never recorded, never logged: handed to the caller so that whatever the child prints can be
    // scrubbed of the values AOS put where the child could read them.
    secrets: staging.secrets,
    canary: canaryRecord,
    canary_run: canary,
    support_status: supportStatus,
    spawnSpec: (spawnCommand, args) => platformAdapter.spawnSpec(prepared, spawnCommand, args),
    track: (pid) => tracker(pid).start(),
    record: ({ leaked = [], survivors = [], tracked = [], polls = 0, groupSweep = null, sweep = null } = {}) => ({
      schema: CONFINEMENT_RECORD_SCHEMA,
      level: "STRICT",
      platform,
      backend: platformAdapter.id,
      adapter: adapter.id,
      // Measured, not assumed: the canary passed inside this very profile, which is the only
      // way a filesystem claim gets onto a record here.
      filesystem_enforced: canary.result === "PASS",
      // Not "a canary passed and something was polled once". The process axis is enforced when
      // three measured things hold together: the canary's own descendant tried to leave the
      // boundary and the kernel refused it, the ancestry scan ran more than once while the agent
      // was alive, and the process group was swept at teardown beside it. What remains unprovable
      // -- a descendant that re-sessions and reparents inside one poll interval -- is named on
      // `descendants.residual`, and it is confined by the same inherited profile the canary just
      // measured.
      process_enforced: processAxisEnforced({ canary, polls, groupSweep, survivorSweep: sweep, networkPolicy: effectivePolicy.network.policy }),
      // What enforces it, named. `inherited-profile` is the kernel refusing an unseen descendant
      // everything outside the workspace; `pid-namespace` would be membership that cannot be shed
      // at all, which is what bubblewrap's `--unshare-pid` gives and Seatbelt has no equivalent of.
      // The scans are recorded beside it as what they are: detection, not containment.
      process_containment: platformAdapter.id === "linux-bubblewrap" ? "pid-namespace" : "inherited-profile",
      network_policy: effectivePolicy.network.policy,
      network: { provider_transport: effectivePolicy.network.provider_transport, task_external: "NOT_OBSERVED", enforcement: effectivePolicy.network.enforcement },
      policy_digest: policyDigest,
      rendered_profile_digest: prepared.rendered_profile_digest,
      setup_verified: canary.result === "PASS",
      boundary_canary: canaryRecord,
      descendants: { scan: DESCENDANT_SCAN, poll_interval_ms: DESCENDANT_POLL_INTERVAL_MS, polls, tracked, leaked, survivors, group_sweep: groupSweep, survivor_sweep: sweep, residual: residualOf(DESCENDANT_POLL_INTERVAL_MS) },
      // Settled by the caller once the scratch directories are gone: see `settleConfinement`.
      cleanup_verified: null,
      support_status: supportStatus,
      platform_lane: platformLaneOf({ platform, backend: platformAdapter.id, adapter: adapter.id }),
      // Which executable this lane actually ran, and whether #554 verified it as the runtime the
      // adapter names. The gate reads it: an adapter that stages a credential is official only for
      // the runtime whose credential it is.
      runtime_identity: staging.identity,
      // A hole is a hole in the boundary, and nothing was opened when nothing was staged: an
      // adapter that declares one but was refused the staging has no hole to record.
      holes: staging.staged.length === 0 ? [] : policy.holes.map((one) => ({ env: one.env, access: one.access, staged: staging.staged, staged_digests: staging.digests, refused: staging.refused ?? [], source: staging.source }))
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
  record.scratch_not_removed = Array.isArray(cleanupFailures) ? cleanupFailures.map(redactCleanupFailure) : null;
  return record;
}

// Which directory failed to go, and why -- by class and by digest, never by name. This record is
// copied whole into the result the operator publishes, and the paths here are absolute paths on
// the operator's machine: `/Users/<them>/...`, the agent HOME with the run's own id in it. A
// digest still tells two failures apart and still matches the same directory across runs, which is
// everything the field was read for.
const SCRATCH_CLASSES = Object.freeze([
  [/aos-agent-home-/u, "agent-home"],
  [/aos-confinement-/u, "confinement-scratch"],
  [/aos-prompt-/u, "run-scratch"]
]);

export function redactCleanupFailure(failure) {
  const text = typeof failure === "string" ? failure : String(failure?.path ?? failure ?? "");
  const split = text.lastIndexOf(": ");
  const path = split > 0 ? text.slice(0, split) : text;
  const code = split > 0 ? text.slice(split + 2) : null;
  const matched = SCRATCH_CLASSES.find(([pattern]) => pattern.test(path));
  return {
    class: matched ? matched[1] : "other",
    path_digest: sha256Bytes(Buffer.from(path, "utf8")),
    code: typeof code === "string" && /^[A-Z][A-Z0-9_]*$/u.test(code) ? code : "UNKNOWN"
  };
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
    return decision({ official: false, level: null, backend: null, adapter: null, platform: null, canary: null, reasons: [ISSUANCE_REASONS.RECORD_INVALID], network: null, policyDigest: null, problems: ["record: not an object"] });
  }
  const reasons = [];
  // Authenticity before conditions. Every field below used to be read for its shape, so an object
  // with the right shape and no boundary behind it -- no schema, digests of nothing, a canary
  // result with no cells and no poll -- satisfied all of them at once. What the run measured has
  // to be present for the run to be judged, and what is missing is named rather than defaulted.
  const problems = record.level === "STRICT" ? authenticityProblems(record) : [];
  if (problems.length > 0) reasons.push(ISSUANCE_REASONS.RECORD_INVALID);
  const canary = record.boundary_canary && typeof record.boundary_canary === "object" ? record.boundary_canary : null;
  if (record.level !== "STRICT") reasons.push(ISSUANCE_REASONS.LEVEL_NOT_STRICT);
  if (typeof record.backend !== "string" || record.backend === "none" || !(record.backend in BACKENDS)) reasons.push(ISSUANCE_REASONS.BACKEND_ABSENT);
  if (record.filesystem_enforced !== true) reasons.push(ISSUANCE_REASONS.FILESYSTEM_NOT_ENFORCED);
  if (record.process_enforced !== true) reasons.push(ISSUANCE_REASONS.PROCESS_NOT_ENFORCED);
  if (record.setup_verified !== true) reasons.push(ISSUANCE_REASONS.SETUP_UNVERIFIED);
  // The derived verdict, not the reported one: `record.boundary_canary.result` is a summary and
  // the cells are the observation.
  const canaryVerdict = derivedCanaryVerdict(canary, record.network_policy ?? null);
  if (canaryVerdict !== "PASS" || !isDigest(canary?.evidence_digest)) reasons.push(ISSUANCE_REASONS.CANARY_NOT_PASS);
  const leaked = Array.isArray(record.descendants?.leaked) ? record.descendants.leaked : null;
  const survivors = Array.isArray(record.descendants?.survivors) ? record.descendants.survivors : null;
  if (leaked === null || leaked.length > 0 || survivors === null || survivors.length > 0) reasons.push(ISSUANCE_REASONS.LEAKED_DESCENDANT);
  if (record.cleanup_verified !== true) reasons.push(ISSUANCE_REASONS.CLEANUP_UNVERIFIED);
  if (!isDigest(record.policy_digest)) reasons.push(ISSUANCE_REASONS.POLICY_DIGEST_MISSING);
  if (!SUPPORTED_RELEASE_SET.has(record.support_status)) reasons.push(ISSUANCE_REASONS.SUPPORT_STATUS);
  // The lane belongs to the runtime, not to the label. An adapter that stages a credential is
  // official only for an executable #554 verified as that runtime; anything else ran with nothing
  // staged and is not the lane the release proved.
  if (RUNTIME_CONFIG_STAGING.has(record.adapter) && record.runtime_identity?.matches_adapter !== true) {
    reasons.push(ISSUANCE_REASONS.RUNTIME_IDENTITY_UNVERIFIED);
  }
  const lane = laneOf({ platform: record.platform, backend: record.backend, adapter: record.adapter, level: record.level });
  if (lane === null || !SUPPORTED_RELEASE_SET.has(lane.support_status)) reasons.push(ISSUANCE_REASONS.LANE_NOT_PROVEN);
  return decision({
    official: reasons.length === 0,
    level: ISOLATION_LEVELS.includes(record.level) ? record.level : null,
    backend: typeof record.backend === "string" ? record.backend : null,
    adapter: typeof record.adapter === "string" ? record.adapter : null,
    platform: typeof record.platform === "string" ? record.platform : null,
    canary: canaryVerdict,
    reasons,
    // Read, never supplied. A record with no network observation is a record that did not
    // measure the axis, and answering "NOT_OBSERVED" on its behalf is this gate inventing the one
    // fact it exists to check.
    network: record.network && typeof record.network === "object"
      ? { policy: typeof record.network_policy === "string" ? record.network_policy : null, provider_transport: record.network.provider_transport ?? null, task_external: typeof record.network.task_external === "string" ? record.network.task_external : null }
      : { policy: null, provider_transport: null, task_external: null },
    policyDigest: isDigest(record.policy_digest) ? record.policy_digest : null,
    problems
  });
}

/**
 * Each canary cell's verdict, computed from what it expected against what it observed.
 *
 * The canary reports observations; AOS decides. `result` on the record is a summary of this and is
 * never an input to it: a summary can be written by anything, and the pair on each cell is what the
 * kernel answered. A cell missing either half is `unreported` -- not a pass by omission.
 */
export function derivedCanaryCells(canary, networkPolicy = null) {
  const cells = canary?.cells && typeof canary.cells === "object" ? canary.cells : Object.create(null);
  const out = Object.create(null);
  for (const name of CANARY_CELLS) {
    const cell = cells[name];
    // The expectation comes from this module's own table, never from the record. A record that
    // carries its own `expected` is a record that can say what it was supposed to find: the review
    // set `outside_read` to `{expected:"allowed", observed:"allowed"}` and the gate agreed with it.
    // The record's claim is kept beside the canonical one only so a mismatch can be named.
    const expected = canonicalExpectation(name, networkPolicy);
    const claimed = typeof cell?.expected === "string" ? cell.expected : null;
    const observed = typeof cell?.observed === "string" ? cell.observed : null;
    out[name] = {
      expected,
      claimed,
      observed,
      unreported: observed === null,
      // Either the observation contradicts what the policy expects, or the record claims a
      // different expectation than the policy has. Both are the same failure: a second authority
      // for what the boundary was supposed to do.
      contradicted: (observed !== null && observed !== expected) || (claimed !== null && claimed !== expected)
    };
  }
  return out;
}

/**
 * This module's own expectation for a cell, which is the only one the gate reads.
 *
 * The network cell is the one that depends on policy: an unrestricted provider policy expects the
 * connect to reach the peer, a disabled one expects the boundary to refuse it first.
 */
export function canonicalExpectation(name, networkPolicy = null) {
  if (name !== "network_outbound_connect") return EXPECTED_CELL[name] ?? null;
  // Enumerated, not defaulted. Everything that was not the word "disabled" used to expect the
  // connect to succeed, so a record whose policy read `WITHHELD` -- or anything else nobody has
  // measured -- was judged against the most permissive expectation there is. A policy this module
  // does not know has no expectation, and a cell with no expectation cannot pass.
  if (networkPolicy === "disabled") return "denied";
  if (networkPolicy === "provider-required-unrestricted" || networkPolicy === "restricted") return "allowed";
  return null;
}

/** PASS only when every cell holds and every check made outside the boundary holds with it. */
export function derivedCanaryVerdict(canary, networkPolicy = null) {
  if (!canary || typeof canary !== "object") return "NOT_RUN";
  const derived = Object.values(derivedCanaryCells(canary, networkPolicy));
  if (derived.some((cell) => cell.unreported)) return "NOT_RUN";
  if (derived.some((cell) => cell.contradicted)) return "FAIL";
  const descendant = canary.out_of_band?.descendant ?? null;
  const planted = canary.out_of_band?.planted_intact ?? null;
  if (planted === null || ["outside", "store_root", "run_store"].some((name) => planted[name] !== true)) return "FAIL";
  if (descendant === null || ["observed_by_scan", "dead_after_cleanup", "escapee_confined"].some((name) => descendant[name] !== true)) return "FAIL";
  const orphan = canary.out_of_band?.orphan ?? null;
  if (orphan === null || ["found_by_sweep", "dead_after_cleanup"].some((name) => orphan[name] !== true)) return "FAIL";
  const stripped = canary.out_of_band?.stripped ?? null;
  if (stripped === null || ["ran", "confined", "dead_after_cleanup"].some((name) => stripped[name] !== true)) return "FAIL";
  return "PASS";
}

/**
 * What a STRICT record has to carry before any of it is believed.
 *
 * Each entry is a fact the run produced and nothing else could: the schema the builder stamps, the
 * digest of the canary source that shipped in this package, the cells that program reported, the
 * profile that was rendered for this workspace, the poll count and the group sweep from teardown.
 * A record missing one of them was not produced by a boundary, whatever its other fields claim.
 */
export function authenticityProblems(record) {
  const problems = [];
  if (record.schema !== CONFINEMENT_RECORD_SCHEMA) problems.push(`schema: ${JSON.stringify(record.schema ?? null)} is not ${CONFINEMENT_RECORD_SCHEMA}`);
  if (!isDigest(record.rendered_profile_digest)) problems.push("rendered_profile_digest: absent or not a sha256 digest");
  if (!isDigest(record.policy_digest)) problems.push("policy_digest: absent or not a sha256 digest");
  const network = record.network;
  const networkStated = network !== null && typeof network === "object";
  if (!networkStated) problems.push("network: no observation of the network axis");
  if (networkStated) {
    // Every value enumerated. A string was enough for the policy and the enforcement, and the
    // transport was never read at all, so a record could name a policy nobody has measured and
    // publish `provider_transport: null` beside it and still be official.
    if (!NETWORK_ENFORCEMENT.includes(network.enforcement)) problems.push(`network.enforcement: ${JSON.stringify(network.enforcement ?? null)} is not one of ${NETWORK_ENFORCEMENT.join("/")}`);
    if (!["allowed", "denied", "NOT_OBSERVED"].includes(network.task_external)) problems.push("network.task_external: not one of allowed/denied/NOT_OBSERVED");
    if (!["allowed", "denied"].includes(network.provider_transport)) problems.push(`network.provider_transport: ${JSON.stringify(network.provider_transport ?? null)} is not one of allowed/denied`);
    if (!NETWORK_POLICIES.includes(record.network_policy)) problems.push(`network_policy: ${JSON.stringify(record.network_policy ?? null)} is not a policy this release measures`);
    // And the two have to agree: a disabled policy that reports its transport allowed is a record
    // describing two different boundaries.
    if (record.network_policy === "disabled" && network.provider_transport !== "denied") problems.push("network.provider_transport: allowed under a disabled policy");
  }
  const canary = record.boundary_canary;
  if (!canary || typeof canary !== "object") problems.push("boundary_canary: absent");
  else {
    // Derived, never read. `result: "PASS"` is a claim by whoever built the record; the cells are
    // the observation. A record whose `outside_read` says `observed: "allowed"` against
    // `expected: "denied"` describes a boundary that failed, and the review got `official: true`
    // out of exactly that, because the gate checked that each cell was an object and then trusted
    // the summary above them.
    for (const [name, cell] of Object.entries(derivedCanaryCells(canary, record.network_policy ?? null))) {
      if (cell.contradicted) problems.push(`boundary_canary.cells.${name}: observed ${JSON.stringify(cell.observed)}${cell.claimed !== null && cell.claimed !== cell.expected ? ` claiming ${JSON.stringify(cell.claimed)}` : ""} against the policy's ${JSON.stringify(cell.expected)}`);
    }
    if (canary.program_digest !== BOUNDARY_CANARY_PROGRAM_DIGEST) problems.push(`boundary_canary.program_digest: ${JSON.stringify(canary.program_digest ?? null)} is not the shipped canary`);
    if (!isDigest(canary.evidence_digest)) problems.push("boundary_canary.evidence_digest: absent or not a sha256 digest");
    const cells = canary.cells && typeof canary.cells === "object" ? canary.cells : null;
    if (cells === null) problems.push("boundary_canary.cells: no cells were reported");
    else for (const name of CANARY_CELLS) {
      const cell = cells[name];
      if (!cell || typeof cell !== "object") { problems.push(`boundary_canary.cells.${name}: not reported`); continue; }
      if (typeof cell.expected !== "string" || typeof cell.observed !== "string") problems.push(`boundary_canary.cells.${name}: no expected/observed pair`);
    }
    const descendant = canary.out_of_band?.descendant;
    if (!canary.out_of_band || typeof canary.out_of_band !== "object") problems.push("boundary_canary.out_of_band: the checks made outside the boundary are absent");
    else if (!descendant || typeof descendant !== "object") problems.push("boundary_canary.out_of_band.descendant: absent");
    else if (descendant.escapee_confined !== true) problems.push("boundary_canary.out_of_band.descendant.escapee_confined: the descendant was not proved confined");
  }
  const descendants = record.descendants;
  if (!descendants || typeof descendants !== "object") problems.push("descendants: no scan was recorded");
  else {
    if (descendants.scan !== DESCENDANT_SCAN) problems.push(`descendants.scan: ${JSON.stringify(descendants.scan ?? null)} is not ${DESCENDANT_SCAN}`);
    if (!Number.isInteger(descendants.polls) || descendants.polls < 2) problems.push("descendants.polls: fewer than two polls, so nothing was watched while the agent ran");
    if (!Number.isInteger(descendants.poll_interval_ms) || descendants.poll_interval_ms <= 0) problems.push("descendants.poll_interval_ms: not stated");
    if (!Array.isArray(descendants.tracked)) problems.push("descendants.tracked: not recorded");
    const sweep = descendants.group_sweep;
    if (!sweep || typeof sweep !== "object" || !Number.isInteger(sweep.pgid)) problems.push("descendants.group_sweep: the process group was not swept at teardown");
    const survivorScan = descendants.survivor_sweep;
    if (!survivorScan || typeof survivorScan !== "object" || survivorScan.scanned !== true || !Array.isArray(survivorScan.survivors)) {
      problems.push("descendants.survivor_sweep: nothing looked for a descendant that reparented and regrouped");
    } else if (!Array.isArray(survivorScan.scanners) || !survivorScan.scanners.includes("process-group") || !Number.isInteger(survivorScan.group_enumerated)) {
      problems.push("descendants.survivor_sweep: the process group was never enumerated, so an empty result is silence rather than evidence");
    } else if (survivorScan.survivors.length > 0) {
      problems.push(`descendants.survivor_sweep: ${survivorScan.survivors.length} process(es) still carry this run's marks`);
    }
  }
  return problems;
}

function decision({ official, level, backend, adapter, platform, canary, reasons, network, policyDigest, problems = [] }) {
  return {
    official,
    // What the record failed to carry, in words. `reasons` says which condition was not met;
    // this says which evidence was not there to meet it with.
    record_problems: problems,
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

/**
 * An observation the matrix cites, read only if its bytes are the bytes the row declared.
 *
 * The row carries a digest of the file it points at. Reading the file and ignoring that digest
 * made the declaration decorative: a row could claim any evidence it liked and the decision was
 * computed from whatever happened to be on disk. `mismatch` is returned rather than thrown so the
 * row can be refused with a named reason instead of the whole matrix failing to load.
 */
/**
 * The evidence a STRICT row has to cite, by name.
 *
 * The boundary measured (canary), the runtime authenticated under it (runtime), the runtime having
 * done a task under it (exec), the teardown that removed what the run staged (cleanup), and the
 * machine it all happened on (host). A row that cites fewer is a row claiming a lane on part of the
 * evidence the lane is defined by; a non-STRICT row claims no lane and cites nothing.
 */
export const STRICT_EVIDENCE_KINDS = Object.freeze(["canary", "runtime", "exec", "cleanup", "host"]);

// Keyed on the level alone. Reading the row's own `official` label here made the label a second
// authority by composition: set it false, delete two citations, and the gate found nothing missing
// while the decision it derives separately still came out official -- and the renderer, which shows
// the decision, printed OFFICIAL for a row citing neither host nor exec evidence. The label may
// declare which rows are expected to be official; it may never relax what the gate checks.
const strictEvidenceKinds = (row) => (row.level === "STRICT" ? [...STRICT_EVIDENCE_KINDS] : []);

const readObservation = (dir, reference) => {
  if (!reference || typeof reference.file !== "string") return { observation: null, mismatch: false, cited: false };
  let bytes;
  try { bytes = readFileSync(join(dir, reference.file)); } catch { return { observation: null, mismatch: true, cited: true }; }
  if (!isDigest(reference.digest) || sha256Bytes(bytes) !== reference.digest) return { observation: null, mismatch: true, cited: true };
  try { return { observation: JSON.parse(bytes.toString("utf8")), mismatch: false, cited: true }; } catch { return { observation: null, mismatch: true, cited: true }; }
};

/**
 * The digest of the runtime configuration a STRICT run would stage, from the operator's own
 * directory, without reading a credential into anything that leaves this process.
 *
 * `auth.json` is deliberately excluded: it holds a token, it changes when the token refreshes, and
 * a cohort defined by it would split every time the runtime re-authenticated. What is bound is the
 * configuration -- MCP servers, plugins, model settings -- which is what changes what the runtime
 * can do.
 */
export function runtimeConfigDigestFor(adapter, env = process.env) {
  const spec = adapter?.config_env ? RUNTIME_CONFIG_STAGING.get(adapter.id) ?? null : null;
  if (spec === null) return null;
  const home = env?.HOME ?? null;
  const fromEnv = env?.[adapter.config_env] ?? null;
  const dir = fromEnv ? realpathOrNull(fromEnv) : home ? realpathOrNull(join(home, spec.dir)) : null;
  if (dir === null) return null;
  const bound = spec.files.filter((name) => name !== "auth.json").map((name) => {
    const file = join(dir, name);
    return [name, isRegularFile(file) ? sha256Bytes(readFileSync(file)) : null];
  });
  if (bound.length === 0 || bound.every(([, digest]) => digest === null)) return null;
  return sha256Bytes(Buffer.from(canonicalConfigJson(bound), "utf8"));
}

const canonicalConfigJson = (entries) => JSON.stringify(Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/**
 * Refuses an environment that discloses where the store is.
 *
 * `AOS_HOME` being absent is not the rule; the rule is that the agent is not told where AOS keeps
 * its runs. A workspace path handed over as `AOS_WORKSPACE` said it in full --
 * `/operator/private/.aos/runs/run-1/workspaces/FAM-1` names the store, the run and the family --
 * and the test that guarded this looked for the variable name rather than at the values. Checked
 * over the environment the child is actually spawned with, after every layer has added its own.
 */
export function assertNoStorePathInEnv(env, aosHome) {
  if (typeof aosHome !== "string" || aosHome.length === 0) return env;
  const roots = [...new Set([aosHome, realpathOrNull(aosHome)].filter((one) => typeof one === "string" && one.length > 1))];
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value !== "string") continue;
    for (const root of roots) {
      if (value.includes(root)) throw fail("AOS_ISOLATION_STORE_PATH_IN_ENV", `${name} carries the store path`);
    }
  }
  return env;
}

/**
 * Every process still carrying this run's marks, however it has been reparented or regrouped.
 *
 * The ancestry poll loses a descendant that double-forks *and* takes its own session between two
 * polls: its parent is gone, its group is its own, and the table it appears in says nothing that
 * ties it to this run. Two handles survive both moves. The environment is one -- a process keeps
 * the variables it was started with, and `AOS_SESSION_ID` is unique to this run, so `ps -axeww`
 * finds it under any pid, ppid or pgid. The filesystem is the other -- an escapee keeps the
 * working directory and the open files it inherited, all of which are inside the run's own
 * workspace, agent HOME or scratch, so `lsof` finds it by path even if it cleared its environment.
 *
 * Fails closed: if neither scanner can run, the answer is `scanned: false` and the process axis is
 * not enforced. Silence from a scan that did not happen is not evidence of an empty room.
 */
export function survivorSweep({ marker, paths = [], groupId = null, platform = process.platform, run = spawnSync, self = process.pid, exclude = ancestorsOf, procRoot = "/proc", table = processTable } = {}) {
  const scanners = [];
  const found = new Set();
  let enumerated = null;
  // Self and every process above it. A sweep that killed what it found would otherwise be able to
  // kill the process running the sweep: the run's own marker is in this process's environment,
  // and its command line usually contains the run id as well.
  const mine = new Set([self, ...exclude(self, { platform, run })]);
  // The assignment, not the bare value. Matching the value alone matched any process whose command
  // line happened to contain it -- including the test runner whose file name carried the run's
  // name, which the sweep then killed. The variable name is what makes a short session id precise,
  // so any non-empty marker is used: a length rule here meant a run with a short session was swept
  // by one scanner on one platform and two on another.
  const assignment = `AOS_SESSION_ID=${marker}`;
  if (typeof marker === "string" && marker.length > 0) {
    const listed = platform === "linux"
      ? run("/bin/sh", ["-c", `grep -lZ -- ${shellQuote(assignment)} /proc/[0-9]*/environ 2>/dev/null | tr '\\0' '\\n'`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
      : run("/bin/ps", ["-axeww", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (!listed.error && typeof listed.stdout === "string") {
      scanners.push("environment-marker");
      for (const line of listed.stdout.split("\n")) {
        if (!line.includes(assignment)) continue;
        const pid = platform === "linux" ? Number(line.match(/\/proc\/(\d+)\/environ/u)?.[1]) : Number(line.trim().split(/\s+/u)[0]);
        if (Number.isInteger(pid) && pid > 1 && !mine.has(pid)) found.add(pid);
      }
    }
  }
  // The process group, enumerated rather than inferred. A descendant spawned with `env: {}`, a cwd
  // outside the run and every inherited handle closed matches neither of the other two scanners --
  // and it is still in the group it was forked into, because a process cannot leave a group without
  // asking the kernel for a new session. This is the scanner that makes "found nothing" evidence
  // rather than silence, and the axis requires it.
  if (Number.isInteger(groupId) && groupId > 1) {
    try {
      const rows = table(platform);
      scanners.push("process-group");
      enumerated = rows.filter((row) => row.pgid === groupId).length;
      for (const row of rows) {
        if (row.pgid === groupId && row.pid !== groupId && !mine.has(row.pid)) found.add(row.pid);
      }
    } catch {}
  }
  const directories = paths.filter((one) => typeof one === "string" && one.length > 1 && existsSync(one));
  if (directories.length > 0) {
    const scan = openPathHolders(directories, { platform, run, procRoot });
    if (scan.scanned) {
      scanners.push("open-path");
      for (const pid of scan.pids) {
        if (Number.isInteger(pid) && pid > 1 && !mine.has(pid)) found.add(pid);
      }
    }
  }
  return {
    scanned: scanners.length > 0,
    scanners,
    marker_used: typeof marker === "string" && marker.length > 0,
    paths: directories.length,
    // How many processes the group scan actually walked past, so "empty" can be told from "did not
    // look". `null` means the group was never enumerated, and the axis reads that as unenforced.
    group_enumerated: enumerated,
    survivors: [...found].sort((a, b) => a - b)
  };
}

/**
 * The processes holding one of these directories open, by pid.
 *
 * Two implementations of one question, because the two platforms answer it differently and the
 * answer has to be the same: which processes have a working directory or an open file inside the
 * run's own workspace, agent HOME or scratch. On darwin `lsof` is asked, found on PATH rather than
 * assumed at a fixed location. On linux `/proc` is walked -- and only ever as a source of
 * candidates: a pid enters this list when a *resolved* `cwd` or `fd` link of that process lands
 * inside one of the directories, never because it appeared in the listing. A listing treated as an
 * answer would make every process on the host a survivor of every run.
 *
 * `scanned` is false when neither could be asked, and the caller reads that as "the process axis
 * was not established" rather than as an empty room.
 */
export function openPathHolders(directories, { platform = process.platform, run = spawnSync, procRoot = "/proc" } = {}) {
  const pids = new Set();
  if (platform === "linux") {
    let entries;
    try { entries = readdirSync(procRoot); } catch { return { scanned: false, pids: [] }; }
    const roots = directories.map((one) => (one.endsWith("/") ? one.slice(0, -1) : one));
    const inside = (target) => typeof target === "string" && roots.some((root) => target === root || target.startsWith(`${root}/`));
    for (const entry of entries) {
      if (!/^\d+$/u.test(entry)) continue;
      const pid = Number(entry);
      let held = false;
      for (const link of ["cwd", "root"]) {
        if (held) break;
        try { held = inside(readlinkSync(join(procRoot, entry, link))); } catch {}
      }
      if (!held) {
        let descriptors = [];
        try { descriptors = readdirSync(join(procRoot, entry, "fd")); } catch { descriptors = []; }
        for (const descriptor of descriptors) {
          try {
            if (inside(readlinkSync(join(procRoot, entry, "fd", descriptor)))) { held = true; break; }
          } catch {}
        }
      }
      if (held) pids.add(pid);
    }
    return { scanned: true, pids: [...pids] };
  }
  const lsof = ["/usr/sbin/lsof", "/usr/bin/lsof", "/bin/lsof"].find((path) => existsSync(path));
  if (lsof === undefined) return { scanned: false, pids: [] };
  const listed = run(lsof, ["-t", "-w", "+D", ...directories], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  // lsof exits 1 when nothing matches, which is not a failure to scan.
  if (listed.error || typeof listed.stdout !== "string") return { scanned: false, pids: [] };
  for (const line of listed.stdout.split("\n")) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid)) pids.add(pid);
  }
  return { scanned: true, pids: [...pids] };
}

const shellQuote = (value) => `'${String(value).split("'").join(`'\\''`)}'`;

/** Every process above this one, so a sweep cannot mistake its own caller for an escapee. */
export function ancestorsOf(pid, { platform = process.platform, run = spawnSync } = {}) {
  const out = [];
  try {
    const rows = new Map(processTable(platform).map((row) => [row.pid, row.ppid]));
    let at = rows.get(pid);
    for (let hops = 0; Number.isInteger(at) && at > 1 && hops < 64; hops += 1) {
      out.push(at);
      at = rows.get(at);
    }
  } catch {}
  return out;
}

/**
 * Whether the process axis was enforced, from what this run measured.
 *
 * Not "a canary passed and something was polled once", which is what it used to be and what the
 * review broke: with one poll and no sweep, a descendant that forked away between polls left the
 * record saying the axis held. Three measured things are required together -- the canary's own
 * descendant tried to leave the boundary and the kernel refused it, the ancestry scan ran more
 * than once while the agent was alive, and the process group was swept at teardown. What remains
 * unprovable on a backend without a pid namespace -- a descendant that re-sessions *and* reparents
 * inside one poll interval -- is named on `descendants.residual`, and the escapee proof is what
 * says such a process is still inside the boundary the canary just measured.
 */
export function processAxisEnforced({ canary, polls, groupSweep, survivorSweep: sweep = null, networkPolicy = null }) {
  // What this returns is not "the scans came back empty". They cannot prove that: a descendant
  // that double-forks, re-sessions, clears its environment, closes every inherited descriptor and
  // changes directory is absent from all three, and three rounds of hardening each ended with a
  // further stripping that evaded the new scanner. Enumeration cannot prove a negative.
  //
  // What is enforced, and what this asserts, is the property the boundary actually holds: the
  // Seatbelt profile is inherited across fork and exec and cannot be shed with the markers, so a
  // descendant AOS never sees is still refused everything outside the workspace. The canary proves
  // exactly that on every run -- `stripped.ran` and `stripped.confined` in `derivedCanaryVerdict`
  // are a descendant that shed every marker, wrote inside the boundary, and was refused outside
  // it by the kernel. The scans stay, and anything they *do* find still blocks, because a
  // descendant AOS can see is one it must terminate; but they are the belt, and the inherited
  // profile is the braces.
  //
  // The residual is named on the record and in the support table: such a process can outlive the
  // run and can write inside that run's own workspace after AOS has digested it. It cannot read or
  // write anything else, and it cannot see another run. `lib/verifier-run.mjs` digests the
  // workspace at teardown, so what it could still touch is a tree nothing reads afterwards.
  // `derivedCanaryVerdict` is where the stripped descendant's proof is required -- `stripped.ran`
  // and `stripped.confined` -- so PASS here already means the kernel answered about a descendant
  // nothing could see. Repeating the condition would be a second place for the same rule to drift.
  return derivedCanaryVerdict(canary, networkPolicy) === "PASS"
    && Number.isInteger(polls) && polls >= 2
    && groupSweep !== null && typeof groupSweep === "object" && Number.isInteger(groupSweep.pgid) && groupSweep.pgid > 0
    && sweep !== null && typeof sweep === "object" && sweep.scanned === true
    && Array.isArray(sweep.scanners) && sweep.scanners.includes("process-group")
    && Number.isInteger(sweep.group_enumerated)
    && Array.isArray(sweep.survivors) && sweep.survivors.length === 0;
}

/**
 * Whether a suite that exists to run the real STRICT lane is allowed to skip.
 *
 * `verify:real-runtime-strict` is asked one question: did a real runtime run under a real
 * boundary on this machine? A suite whose STRICT tests all skip because the platform cannot host
 * them, and which then exits 0, answers "yes". `AOS_REAL_STRICT_REQUIRED=1` -- which that script
 * sets and `npm test` does not -- turns the skip into the failure it is, so the honest answer on a
 * machine that cannot run the lane is a refusal naming NOT_RUN rather than a pass.
 */
export function realStrictLaneStatus({ env = process.env, platform = process.platform, backendAvailable = false, reason = null } = {}) {
  const required = env?.AOS_REAL_STRICT_REQUIRED === "1";
  const available = backendAvailable === true;
  const detail = reason ?? (available ? "the lane is available here" : `no STRICT backend for ${platform} on this machine`);
  return {
    required,
    available,
    reason: detail,
    assertRan() {
      if (required && !available) throw fail("AOS_REAL_STRICT_NOT_RUN", `${detail}; a skipped lane is NOT_OBSERVED and is not a pass`);
      return available;
    }
  };
}

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
    // Every observation the row cites, not only the two that used to be read. A citation is a
    // claim about a file: the bytes have to match the digest declared for them, and the run they
    // record has to have succeeded. `exec` was cited and never consumed, so a committed
    // observation of `codex exec` exiting 71 -- the runtime failing to start under the boundary --
    // left the lane official.
    const cited = Object.entries(row.evidence ?? {}).map(([name, reference]) => [name, reference, readObservation(dir, reference)]);
    const mismatched = cited.filter(([, , read]) => read.mismatch).map(([name]) => name);
    const failedExecution = cited
      .filter(([, , read]) => !read.mismatch && read.observation !== null && read.observation.exit_status !== 0)
      .map(([name, , read]) => `${name}: exit ${JSON.stringify(read.observation.exit_status)}`);
    const canaryObservation = cited.find(([name]) => name === "canary")?.[2]?.observation ?? null;
    const captured = canaryObservation?.captured ?? null;
    // Built from the observation's own cells and checks made outside it, whatever the word above them
    // says, and then judged by the same derivation a run's record goes through. A row used to be
    // read through `captured.result`, which is a summary and not an observation.
    const observedCanary = captured === null
      ? { result: "NOT_RUN", failed: [], evidence_digest: null, program_digest: null }
      : {
          result: derivedCanaryVerdict(captured, row.network_policy ?? null),
          failed: captured.failed ?? [],
          cells: captured.cells ?? null,
          out_of_band: captured.out_of_band ?? null,
          evidence_digest: captured.evidence_digest ?? null,
          program_digest: captured.program_digest ?? null,
          scan_polls: captured.scan_polls ?? 0,
          group_sweep: captured.group_sweep ?? null
        };
    const canaryPassed = observedCanary.result === "PASS" && isDigest(captured?.evidence_digest);
    // By name, not by whatever the row happens to cite. Iterating the entries that exist made every
    // kind optional: deleting `runtime` and `exec` from the official row left one surviving
    // citation, `everyCitedRan` was satisfied by it, and the lane stayed official with no evidence
    // that the runtime ever authenticated or ran.
    const strict = row.level === "STRICT";
    const byKind = new Map(cited.map(([name, , read]) => [name, read.observation]));
    const missingEvidence = strictEvidenceKinds(row).filter((kind) => !byKind.has(kind) || byKind.get(kind) === null);
    // And what those observations say, not only that they exited zero. An authentication that
    // reported no login, or an execution whose answer was not the word the prompt asked for, is a
    // runtime that did not do the thing the lane claims it did.
    const unmetMarkers = [
      ...(byKind.get("runtime") && !(byKind.get("runtime").stderr?.markers?.logged_in || byKind.get("runtime").stdout?.markers?.logged_in) ? ["runtime: no login was reported"] : []),
      ...(byKind.get("exec") && byKind.get("exec").captured?.answered_expected_word !== true ? ["exec: the runtime did not answer inside the boundary"] : [])
    ];
    const everyCitedRan = cited.length > 0 && cited.every(([, , read]) => read.observation !== null && read.observation.exit_status === 0);
    // The canary block the observation actually holds, rebuilt field for field. Everything the
    // gate reads about the boundary comes from here, so a row cannot declare an axis it did not
    // record.
    const boundaryCanary = observedCanary;
    // The same helper a run uses, over the same fields, with no synthesized sweep. The row used to
    // take `row.gate.process_enforced` on trust and hand the gate a `{ pgid: 0 }` the helper
    // rejects, which is a second and weaker formula for the one decision this table exists to make.
    const processEnforced = strict && canaryPassed && processAxisEnforced({
      canary: boundaryCanary,
      polls: captured.scan_polls ?? 0,
      groupSweep: captured.group_sweep ?? null,
      survivorSweep: captured.survivor_sweep ?? null,
      networkPolicy: row.network_policy ?? null
    });
    const cleanup = byKind.get("cleanup") ?? null;
    // Every path the teardown reports, and nothing it could not remove. The observation used to be
    // written as a success whatever `handle.cleanup()` returned, so a profile the kernel refused to
    // delete was a clean teardown; `not_removed` is read here for the same reason the run record
    // reads its own.
    const cleanupRemoved = cleanup !== null && cleanup.captured !== null && typeof cleanup.captured === "object"
      && cleanup.exit_status === 0
      && (cleanup.captured.not_removed ?? []).length === 0
      && Object.values(cleanup.captured.removed ?? {}).length > 0
      && Object.values(cleanup.captured.removed ?? {}).every((gone) => gone === true);
    const record = {
      schema: CONFINEMENT_RECORD_SCHEMA,
      level: row.level,
      platform: row.platform,
      backend: row.backend,
      adapter: row.adapter === "*" ? "generic-command.v1" : row.adapter,
      filesystem_enforced: strict && canaryPassed,
      process_enforced: processEnforced,
      network_policy: row.network_policy ?? null,
      // The row's declared policy, and the axis stated the way a run states it: the transport the
      // policy needs, the task-initiated traffic nobody observed, and who enforces it.
      network: { provider_transport: row.provider_transport ?? null, task_external: "NOT_OBSERVED", enforcement: strict ? "kernel" : "none" },
      policy_digest: isDigest(captured?.policy_digest) ? captured.policy_digest : null,
      rendered_profile_digest: captured?.rendered_profile_digest ?? null,
      setup_verified: strict && canaryPassed && everyCitedRan && missingEvidence.length === 0 && unmetMarkers.length === 0,
      boundary_canary: boundaryCanary,
      // Quoted from the observation, not invented for the row: the poll count the recorded run
      // reported, and the sweep it recorded beside it. A row whose observation carries neither is
      // a row whose process axis was never measured, and the gate says so.
      descendants: strict && canaryPassed
        ? { scan: DESCENDANT_SCAN, poll_interval_ms: DESCENDANT_POLL_INTERVAL_MS, polls: captured.scan_polls ?? 0, tracked: [], leaked: captured.out_of_band?.descendant?.survivors ?? [], survivors: captured.out_of_band?.descendant?.survivors ?? [], group_sweep: captured.group_sweep ?? null, survivor_sweep: captured.survivor_sweep ?? null, residual: null }
        : { scan: "process-group", polls: 0, tracked: [], leaked: [], survivors: [], residual: null },
      // Measured by the probe after it tore the lane down, not declared by the row: the staged
      // credential copy, the agent HOME, the run scratch and the base store are gone or they are
      // not, and the observation says which.
      cleanup_verified: strict && canaryPassed && cleanupRemoved,
      // From the observation of the runtime that actually authenticated, not from the canary
      // beside it: the identity has to describe the binary that produced the evidence the row
      // cites, or it is a statement about some other program on the same machine.
      runtime_identity: byKind.get("runtime")?.captured?.runtime_identity ?? null,
      support_status: row.support_status
    };
    const decided = issuanceGate(record);
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
      evidence_mismatch: mismatched,
      evidence_execution_failed: failedExecution,
      evidence_missing: missingEvidence,
      evidence_markers_unmet: unmetMarkers,
      decision: mismatched.length > 0
        ? withReason(issuanceGate({ ...record, filesystem_enforced: false, process_enforced: false, setup_verified: false, cleanup_verified: false }), ISSUANCE_REASONS.EVIDENCE_DIGEST_MISMATCH, mismatched)
        : missingEvidence.length > 0
          ? withReason(decided, ISSUANCE_REASONS.EVIDENCE_MISSING, missingEvidence.map((kind) => `${kind}: not cited`))
          : failedExecution.length > 0 || unmetMarkers.length > 0
            ? withReason(decided, ISSUANCE_REASONS.EVIDENCE_EXECUTION_FAILED, [...failedExecution, ...unmetMarkers])
            : decided
    };
  });
}

// A decision with one more reason on it, said once. Used where the evidence a row cites is not
// the evidence on disk: the row is refused for that, and the conditions it can no longer support
// are refused beside it.
const withReason = (made, reason, detail) => ({
  ...made,
  official: false,
  reasons: [...new Set([reason, ...made.reasons])],
  record_problems: [...made.record_problems, `evidence: ${detail.join(", ")}`],
  claim_stage_ceiling: CLAIM_STAGE_CEILING.withheld
});

/**
 * The table the document shows, rendered from decisions already made so that the two cannot say
 * different things. It used to take the fixture and run the gate again, which is a second decision
 * about the same rows and a place for the table and the gate to drift apart. The product test
 * asserts the document contains this text verbatim.
 */
export function renderSupportMatrix(rows) {
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.decision !== "object")) {
    throw fail("AOS_ISOLATION_SUPPORT_MATRIX_INVALID", "renderSupportMatrix takes the rows supportMatrixDecisions returned");
  }
  const lines = [
    "| Platform | Backend | Adapter | Level | Support | Official | Reason / evidence |",
    "|---|---|---|---|---|---|---|"
  ];
  for (const row of rows) {
    // The decision, and nothing beside it. The column used to read `row.official && decision`, so a
    // row the gate had made official rendered as withheld whenever the fixture's own label said
    // otherwise -- which is the fixture keeping a second vote on the one question this table exists
    // to answer. What the label is for is declaring which rows must carry evidence; whether they do
    // is the decision's to say.
    const official = row.decision.official ? "OFFICIAL" : "withheld";
    // What the decision rested on, when there is evidence to name; a row the gate made official
    // without citing files is still shown as official, because the column is the decision.
    const cited = Object.entries(row.evidence ?? {}).map(([kind, reference]) => `${kind} \`${basename(String(reference?.file ?? "?"))}\``);
    const why = row.decision.official
      ? cited.length > 0 ? cited.join("; ") : "the gate issued this row"
      : row.decision.reasons.join(", ") + (row.reason ? ` -- ${row.reason}` : "");
    lines.push(`| ${row.platform} | ${row.backend} | ${row.adapter} | ${row.level} | ${row.support_status} | ${official} | ${why} |`);
  }
  return `${lines.join("\n")}\n`;
}
