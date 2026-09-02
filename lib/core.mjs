import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { buildAgentEnv, isolationRecord } from "./isolation.mjs";
import { assertNoStorePathInEnv, prepareConfinement, redactCleanupFailure, settleConfinement, survivorSweep } from "./confinement.mjs";
import { envPolicyFor } from "./env-policy.mjs";
import { adapterFor } from "./profile.mjs";
import { resolveRuntimeAuthForAgent, runtimeIdentityRecord } from "./runtime-auth.mjs";
import { redactText, redactValue } from "./redact.mjs";
import { sha256Bytes } from "./digest.mjs";

// Read from the manifest rather than restated here. A literal drifted once already: the CLI
// reported 0.1.0 while the root package carried 0.0.0 and `private: true`, so the binary claimed
// a release the repository had withdrawn. One source, and the two cannot disagree again.
export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;
export const SUPPORTED_PLATFORMS = new Set(["darwin", "linux"]);
export const SUPPORTED_ARCHITECTURES = new Set(["x64", "arm64"]);
export const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
export const MAX_EVENT_LINE_BYTES = 64 * 1024;

export function canonicalJson(value) {
  const visit = (input, path = "$") => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error(`non-finite number at ${path}`);
      return Object.is(input, -0) ? 0 : input;
    }
    if (Array.isArray(input)) return input.map((entry, index) => visit(entry, `${path}[${index}]`));
    if (typeof input === "object") {
      const out = {};
      for (const key of Object.keys(input).sort()) {
        const child = input[key];
        if (child === undefined || typeof child === "function" || typeof child === "symbol" || typeof child === "bigint") {
          throw new Error(`non-JSON value at ${path}.${key}`);
        }
        out[key] = visit(child, `${path}.${key}`);
      }
      return out;
    }
    throw new Error(`non-JSON value at ${path}`);
  };
  return `${JSON.stringify(visit(value))}\n`;
}

export function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256Value(value) {
  return sha256Text(canonicalJson(value));
}

export function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function assertSupportedPlatform() {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    throw new Error(`AOS_UNSUPPORTED_PLATFORM ${process.platform}; supported: macOS and Linux`);
  }
  if (!SUPPORTED_ARCHITECTURES.has(process.arch)) {
    throw new Error(`AOS_UNSUPPORTED_ARCH ${process.arch}; supported: x64 and arm64`);
  }
  if (process.platform === "linux") {
    let version = "";
    try { version = readFileSync("/proc/version", "utf8"); } catch {}
    if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(version)) {
      throw new Error("AOS_UNSUPPORTED_PLATFORM WSL; use native macOS or Linux");
    }
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18) || major >= 25) {
    throw new Error(`AOS_UNSUPPORTED_NODE ${process.versions.node}; required >=22.18 <25`);
  }
}

export function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, file);
    const dirFd = openSync(dirname(file), "r");
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    rmSync(temp, { force: true });
    throw error;
  }
}

export function repairTornTrailingNdjson(file) {
  if (!existsSync(file)) return { repaired: false, action: "absent" };
  const bytes = readFileSync(file);
  if (bytes.length === 0 || bytes.at(-1) === 0x0a) return { repaired: false, action: "complete" };
  const lastNewline = bytes.lastIndexOf(0x0a);
  const tailStart = lastNewline + 1;
  const tail = bytes.subarray(tailStart).toString("utf8");
  try {
    JSON.parse(tail);
    const fd = openSync(file, "a", 0o600);
    try {
      writeFileSync(fd, "\n", "utf8");
      fsyncSync(fd);
    } finally { closeSync(fd); }
    return { repaired: true, action: "newline" };
  } catch {
    const fd = openSync(file, "r+");
    try {
      ftruncateSync(fd, tailStart);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    return { repaired: true, action: "truncate" };
  }
}

export function appendNdjson(file, value) {
  const line = canonicalJson(value).trimEnd();
  if (line.includes("\n") || Buffer.byteLength(line) > MAX_EVENT_LINE_BYTES) throw new Error("AOS_INVALID_EVENT_LINE");
  mkdirSync(dirname(file), { recursive: true });
  repairTornTrailingNdjson(file);
  const fd = openSync(file, "a", 0o600);
  try {
    writeFileSync(fd, `${line}\n`, "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/**
 * Reads JSON, and says which file when it cannot.
 *
 * `Expected property name or '}' at position 1` is true and useless: the operator has a home full
 * of run records and a ledger, and the one thing they need is which of them is damaged. A parse
 * failure is also their problem to fix, not an internal error, so it is named as one.
 */
export function readJson(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`AOS_UNREADABLE ${file}: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`AOS_MALFORMED_JSON ${file}: ${error.message}`);
  }
}

export function readJsonIfExists(file) {
  return existsSync(file) ? readJson(file) : null;
}

export function writeJson(file, value) {
  atomicWrite(file, canonicalJson(value));
}

export function validId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
}

export function requireId(value, label = "id") {
  if (!validId(value)) throw new Error(`AOS_INVALID_ID ${label}`);
  return value;
}

export function getOption(options, key, fallback = undefined) {
  const value = options[key];
  if (Array.isArray(value)) return value.at(-1) ?? fallback;
  return value ?? fallback;
}

export function getOptions(options, key) {
  const value = options[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      options["--"] = argv.slice(index + 1);
      break;
    }
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const key = token.slice(2, equals === -1 ? undefined : equals);
    let value = equals === -1 ? undefined : token.slice(equals + 1);
    const next = argv[index + 1];
    const consumesFlagValue = key === "arg";
    if (value === undefined && next !== undefined && (consumesFlagValue || !next.startsWith("--"))) {
      value = next;
      index += 1;
    }
    if (value === undefined) value = true;
    if (options[key] === undefined) options[key] = value;
    else if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = [options[key], value];
  }
  return options;
}

export function commandExists(command) {
  if (!command || command.includes("\0")) return false;
  if (command.includes("/") || isAbsolute(command)) {
    try { accessSync(command, constants.X_OK); return true; } catch { return false; }
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    try { accessSync(join(directory, command), constants.X_OK); return true; } catch {}
  }
  return false;
}

export function containsSecretLike(values) {
  const joined = values.join(" ");
  const patterns = [
    /(?:api[_-]?key|token|secret|password)\s*[=:]/i,
    /authorization\s*:/i,
    /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{12,}/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/
  ];
  return patterns.some((pattern) => pattern.test(joined));
}

export function rejectSecretLike(values) {
  if (containsSecretLike(values)) throw new Error("AOS_SECRET_IN_AGENT_CONFIG");
}

function boundedAppend(current, chunk, limit = MAX_CAPTURE_BYTES) {
  if (current.length >= limit) return current;
  const remaining = limit - current.length;
  return Buffer.concat([current, chunk.subarray(0, remaining)]);
}

function replaceTemplate(value, replacements) {
  return value.replace(/\{(prompt|promptFile|workspace|family|session)\}/g, (_, key) => replacements[key] ?? "");
}

export function processGroupMembers(pgid) {
  const members = [];
  if (!Number.isInteger(pgid) || pgid <= 0) return members;
  if (process.platform === "linux" && existsSync("/proc")) {
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        const end = stat.lastIndexOf(")");
        if (end < 0) continue;
        const fields = stat.slice(end + 2).split(" ");
        const state = fields[0];
        const group = Number(fields[2]);
        if (group === pgid && state !== "Z") members.push(Number(name));
      } catch {}
    }
    return members.sort((a, b) => a - b);
  }
  const ps = spawnSync("ps", ["-axo", "pid=,pgid="], { encoding: "utf8" });
  if (ps.status !== 0) return members;
  for (const line of ps.stdout.split(/\r?\n/)) {
    const [pid, group] = line.trim().split(/\s+/).map(Number);
    if (group === pgid && Number.isInteger(pid)) members.push(pid);
  }
  return members.sort((a, b) => a - b);
}

function signalProcessGroup(pgid, signal) {
  try { process.kill(-pgid, signal); } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

/** The last of a stream, redacted, small enough to sit in an event. */
const EXCERPT_BYTES = 1500;
const excerptOf = (buffer) => {
  const text = buffer.toString("utf8");
  const tail = text.length > EXCERPT_BYTES ? text.slice(-EXCERPT_BYTES) : text;
  return redactText(tail).text;
};

/** Below this a "credential" is a word, and removing every occurrence of it would remove prose. */
const SCRUB_MIN = 8;

/**
 * Removes the exact values AOS handed the child, wherever they come back.
 *
 * `redactText` matches shapes, and a shape is a guess: it knows `sk-ant-...` and it does not know
 * whatever an unfamiliar runtime's token looks like. This knows, because these are the values this
 * process put in the child's environment a few lines above. The child is entitled to read its own
 * environment -- that is the point of handing it a credential -- and AOS is not entitled to keep
 * what it echoes back.
 */
const scrubberFor = (values) => {
  const secrets = [...new Set(values.filter((value) => typeof value === "string" && value.length >= SCRUB_MIN))];
  if (secrets.length === 0) return (text) => text;
  return (text) => secrets.reduce((carried, secret) => carried.split(secret).join("[redacted: runtime credential]"), text);
};

const realpathOrSelf = (path) => {
  try { return realpathSync(path); } catch { return path; }
};

export async function runProcess(spec, context) {
  assertSupportedPlatform();
  // Declared here and created inside the `try` below, because everything between the first
  // `mkdtempSync` and the spawn can throw: an adapter that cannot grant the stored policy raises
  // before a child exists. While the two directories were created above the `try`, that throw
  // skipped the `finally` and left both behind in the system temp folder on every refused run --
  // the refusal being new is exactly what made the leak reachable.
  let internalDir = null;
  let agentHome = null;
  // The boundary handle and the record built from it. Both outlive the `try` because the record's
  // last field -- whether teardown left anything behind -- is only known in the `finally`.
  let confinement = null;
  let confinementRecord = null;
  const cleanupFailures = [];
  // The same failures, by class and digest of the path, for the result the operator stores and
  // renders. Filled in the `finally` beside the record's copy, and referenced by the returned
  // object rather than snapshotted into it: the object is built before the cleanup runs.
  const redactedFailures = [];
  try {
    internalDir = mkdtempSync(join(tmpdir(), "aos-prompt-"));
    // The agent's HOME for this run. Replacing it keeps ~/.aws/credentials and ~/.ssh out of reach of
    // a path expansion, without pretending the provider network was blocked.
    agentHome = mkdtempSync(join(tmpdir(), "aos-agent-home-"));
    const safePromptFile = join(internalDir, "prompt.txt");
    writeFileSync(safePromptFile, context.prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const runtimeContext = { ...context, promptFile: safePromptFile };
    const args = spec.args.map((value) => replaceTemplate(value, runtimeContext));
    const promptInArgs = spec.args.some((value) => value.includes("{prompt}"));
    // Resolved before the environment is built, because it decides which names that environment has
    // to carry. `--no-auto-auth` turns it off for an operator who would rather the run fail than have
    // AOS reach into their credential store.
    //
    // The executable's identity is re-checked ahead of the lookup, not after it. #554: the check this
    // replaces compared the command's basename against the name the adapter declares, so a binary
    // rewritten in place, a path turned into a symlink, or a wrapper dropped earlier on PATH all
    // still received the operator's Keychain token. A refusal that arrives after the resolver has
    // answered is too late -- the credential has already been read out of the store on behalf of a
    // program nobody identified -- and one that arrives after the spawn is later still. Both stop
    // here: `resolveRuntimeAuthForAgent` throws before either happens, and it throws inside this
    // `try`, so the scratch directories above it are removed by the `finally` like any other refusal.
    const adapter = adapterFor(spec);
    const { resolved: resolvedAuth, verdict: identityVerdict } = resolveRuntimeAuthForAgent(spec, adapter, {});
    const declaredAuth = spec.runtime_auth_env_names ?? [];
    const carriedAuth = resolvedAuth === null ? declaredAuth : [...new Set([...declaredAuth, resolvedAuth.name])];
    // Built here rather than inside the builder so that a policy that cannot be granted fails before
    // anything is spawned, and so the same object goes into both the environment and the record. A
    // result that quoted a different policy than the one the child ran under would be worse than one
    // that quoted none.
    const envPolicy = envPolicyFor(adapter, {
      allow: spec.allowed_env_names ?? [],
      runtimeAuth: carriedAuth,
      transport: spec.transport_env_names ?? []
    });
    const environment = buildAgentEnv(context.isolation ?? "BEST_EFFORT_CLI", process.env, {
      policy: envPolicy,
      // The value lives here and nowhere else: not in an event, a result, a log line or an error.
      inject: resolvedAuth === null || resolvedAuth.source === "environment" ? {} : { [resolvedAuth.name]: resolvedAuth.value },
      home: agentHome,
      injected: {
        AOS_SESSION_ID: context.session,
        AOS_FAMILY: context.family,
        // Relative, and resolved against the cwd below, which is the workspace. The absolute path
        // named the store, the run id and the family in one string, so an agent that was never
        // given `AOS_HOME` was handed it anyway inside another variable's value.
        AOS_WORKSPACE: ".",
        AOS_TASK_FILE: safePromptFile
      }
    });
    // Every credential-shaped value this run actually handed over, by name. `runtime_auth` is the
    // set of names the isolation layer counted as credentials, which covers the resolved one and any
    // the operator approved with `--allow-runtime-auth`.
    // Built from the environment here and rebuilt after staging below, because a STRICT run puts a
    // second copy of the credential somewhere the child can read that never passed through the
    // environment at all.
    let scrub = scrubberFor(environment.runtime_auth.map((name) => environment.env[name]));
    const started = Date.now();
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutProduced = 0;
    let stderrProduced = 0;
    let timedOut = false;
    let interrupted = false;
    let child;
    // The file that was verified, not the name it was verified through.
    //
    // Passing `spec.command` here means the PATH search and the symlink chain are walked a second
    // time, by the kernel, at a later moment: a wrapper appearing earlier on PATH between the check
    // and this line is spawned with the credential in its environment, and the identity that was
    // compared belonged to a file that never ran. `execve` still resolves the absolute pathname it
    // is handed, so this narrows the window rather than closing it -- atomic replacement of that
    // one path needs a held descriptor to defeat, and Node has no `fexecve`.
    //
    // `argv0` covers what that costs, for a native executable: the child reads the configured
    // command in `argv[0]` while running the verified file. It does not cover a `#!` script -- the
    // kernel rebuilds the vector as [interpreter, script] when it dispatches one, and the script
    // sees the resolved path in `$0` where it used to see the symlink it was called through. Both
    // are pinned by tests. Only agents with a credential at stake have an identity, and only they
    // are spawned this way.
    const verifiedPath = identityVerdict.identity?.resolved_realpath ?? null;
    // #556. Under STRICT the boundary is probed, rendered for this workspace and store, and
    // measured by the canary before the agent exists; a boundary that did not hold throws here,
    // inside the `try`, and the run is refused rather than downgraded. The other two levels get a
    // passthrough whose record says, in the same fields, that nothing was enforced.
    confinement = await prepareConfinement({
      level: environment.level,
      adapter,
      workspace: context.workspace,
      aosHome: context.aosHome ?? null,
      agentHome,
      runScratch: internalDir,
      command: verifiedPath ?? spec.command,
      env: environment.env
    });
    // The staged runtime configuration holds a credential value for the length of the run. It is
    // not in the environment, so the scrubber above could not know it, and a task that reads its
    // own `auth.json` and prints what it found published it in `stdout_excerpt`.
    scrub = scrubberFor([
      ...environment.runtime_auth.map((name) => environment.env[name]),
      ...(Array.isArray(confinement.secrets) ? confinement.secrets : [])
    ]);
    const launch = confinement.spawnSpec(verifiedPath ?? spec.command, args);
    // The environment the child is actually given, checked once, here, where every layer has
    // finished adding to it: nothing in it may disclose where the store is.
    const childEnv = assertNoStorePathInEnv({ ...environment.env, ...confinement.env }, context.aosHome ?? null);
    // And the cwd, which is the other half of the same rule: an agent reads its own working
    // directory out of `getcwd` whatever the environment says, so a workspace inside the store
    // would disclose it. #556 moved the workspaces to their own root; this is the assertion that
    // says so at the spawn, because the layout is decided three files away.
    if (typeof context.aosHome === "string" && context.aosHome.length > 1) {
      for (const root of new Set([context.aosHome, realpathOrSelf(context.aosHome)])) {
        if (context.workspace === root || context.workspace.startsWith(`${root}/`)) {
          throw new Error(`AOS_ISOLATION_WORKSPACE_INSIDE_STORE ${context.workspace}`);
        }
      }
    }
    child = spawn(launch.command, launch.args, {
      cwd: context.workspace,
      detached: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      // The handle's own variables go over the built environment: under STRICT that is the
      // runtime's config variable pointed at the staged copy inside the agent HOME, and nothing
      // else, so the environment record still describes what the child received.
      env: childEnv,
      argv0: launch.argv0 ?? spec.command
    });
    const pgid = child.pid;
    // Ancestry-based, polled while the child runs. The process group below does not see a
    // descendant that took its own session -- Phase 0 measured exactly that leak -- and this does.
    const tracker = confinement.track(child.pid);
    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      stdoutProduced += buffer.length;
      stdout = boundedAppend(stdout, buffer);
    });
    child.stderr.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      stderrProduced += buffer.length;
      stderr = boundedAppend(stderr, buffer);
    });
    child.stdin.on("error", () => {});
    if (!promptInArgs) child.stdin.end(context.prompt);
    else child.stdin.end();

    const interrupt = () => {
      interrupted = true;
      if (pgid) signalProcessGroup(pgid, "SIGTERM");
      setTimeout(() => { if (pgid) signalProcessGroup(pgid, "SIGKILL"); }, 5000).unref();
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(() => {
      timedOut = true;
      if (pgid) signalProcessGroup(pgid, "SIGTERM");
      setTimeout(() => { if (pgid) signalProcessGroup(pgid, "SIGKILL"); }, 5000).unref();
    }, context.timeoutMs);
    timer.unref();

    const outcome = await new Promise((resolvePromise) => {
      child.once("error", (error) => resolvePromise({ code: null, signal: null, error }));
      child.once("exit", (code, signal) => resolvePromise({ code, signal, error: null }));
    });
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);

    const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
    await sleep(50);
    if (tracker) tracker.poll();
    const trackedBeforeCleanup = tracker ? tracker.alive().filter((pid) => pid !== pgid) : [];
    const membersBeforeCleanup = [...new Set([...(pgid ? processGroupMembers(pgid).filter((pid) => pid !== pgid) : []), ...trackedBeforeCleanup, ...survivorSweep({ marker: context.session, paths: [context.workspace, agentHome, internalDir].filter((one) => typeof one === "string") }).survivors])];
    const leakedDescendants = membersBeforeCleanup.length > 0;
    if (pgid && processGroupMembers(pgid).length > 0) {
      signalProcessGroup(pgid, "SIGTERM");
      await sleep(250);
    }
    if (pgid && processGroupMembers(pgid).length > 0) {
      signalProcessGroup(pgid, "SIGKILL");
      await sleep(250);
    }
    // Each tracked pid by itself, after the group: what the group signal did not reach is exactly
    // what the tracker is for.
    const trackedSurvivors = tracker ? await tracker.terminate() : [];
    // And the sweep that survives a reparent and a regroup: anything still carrying this run's
    // session marker in its environment, or holding the run's own directories open. Found, killed,
    // then swept again -- what the second sweep still sees is a survivor the record reports.
    const firstSweep = survivorSweep({ marker: context.session, paths: [context.workspace, agentHome, internalDir].filter((one) => typeof one === "string") });
    for (const pid of firstSweep.survivors) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    if (firstSweep.survivors.length > 0) await sleep(250);
    const sweep = firstSweep.survivors.length === 0
      ? firstSweep
      : { ...survivorSweep({ marker: context.session, paths: [context.workspace, agentHome, internalDir].filter((one) => typeof one === "string") }), found_before_signal: firstSweep.survivors };
    if (tracker) tracker.stop();
    const survivors = [...new Set([...(pgid ? processGroupMembers(pgid) : []), ...trackedSurvivors, ...sweep.survivors])];
    const survivor = survivors.length > 0;
    confinementRecord = confinement.record({
      leaked: membersBeforeCleanup,
      survivors,
      tracked: tracker ? tracker.tracked() : [],
      polls: tracker ? tracker.polls() : 0,
      // #556. The sweep the ancestry poll cannot replace: a descendant that double-forks without
      // taking its own session keeps this group, so what the group holds after teardown is a
      // measurement of the process axis and not a restatement of the poll.
      groupSweep: pgid ? { pgid, members: processGroupMembers(pgid).filter((pid) => pid !== pgid) } : null,
      sweep
    });
    const text = stdout.toString("utf8");
    // Redacted here, at the one place the child's own JSON enters AOS.
    //
    // Both excerpts above go through the redactor and these did not, and this is the copy that
    // survives: the raw object is kept in `semantic_events`, written to result.json verbatim, and
    // embedded whole by `aos observe`. The credential is in the child's environment by design, so
    // `AOS_EVENT {"payload":{"claim":"<token>"}}` is one `echo` away -- and the projected event the
    // store filters is not this copy. An agent may quote its own environment; AOS may not keep it.
    const semanticEvents = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("AOS_EVENT\t")) continue;
      try {
        const parsed = JSON.parse(scrub(line.slice("AOS_EVENT\t".length)));
        if (parsed && typeof parsed === "object") semanticEvents.push(redactValue(parsed));
      } catch {}
    }
    return {
      ok: !timedOut && !interrupted && !leakedDescendants && !survivor && outcome.error === null && outcome.code === 0,
      exit_code: outcome.code,
      signal: outcome.signal,
      timed_out: timedOut,
      interrupted,
      survivor,
      leaked_descendants: leakedDescendants,
      descendant_pids: membersBeforeCleanup,
      survivor_pids: survivors,
      duration_ms: Date.now() - started,
      // The digests cover what was captured, which is a prefix once the cap is reached. Reporting
      // only the captured length left two different outputs sharing a 10 MiB prefix with the same
      // byte count and the same digest, so the produced totals and the truncation flags are
      // recorded alongside them. Evidence that lost bytes has to say so.
      stdout_bytes: stdout.length,
      stderr_bytes: stderr.length,
      stdout_produced_bytes: stdoutProduced,
      stderr_produced_bytes: stderrProduced,
      stdout_truncated: stdoutProduced > stdout.length,
      stderr_truncated: stderrProduced > stderr.length,
      // The captured bytes, not a decoding of them. `Buffer.toString("utf8")` replaces every
      // undecodable sequence with U+FFFD, so an agent whose output is not valid UTF-8 -- a binary
      // stream, a truncated multi-byte character at the capture boundary -- produced a digest that
      // several different outputs share. This is the evidence a failure signature is built from.
      stdout_digest: sha256Bytes(stdout),
      stderr_digest: sha256Bytes(stderr),
      // The tail of what the agent said went wrong, with credential material removed.
      //
      // Only the digest used to survive, which meant a stage that produced nothing could be
      // reported as "exit 0" and nothing else -- and a checkpoint whose whole purpose is to show
      // the operator what AOS saw could show them an exit code. Measured against real Codex, three
      // of six families produced no artifact while exiting zero, and nothing AOS had kept could say
      // why.
      //
      // The tail rather than the head: a runtime that banners on startup and fails at the end puts
      // the reason last.
      stderr_excerpt: scrub(excerptOf(stderr)),
      // Both streams. A runtime that refuses to start may say so on either one -- Claude Code
      // prints `Not logged in · Please run /login` to stdout -- and an operator shown only stderr
      // is shown nothing at all.
      stdout_excerpt: scrub(excerptOf(stdout)),
      semantic_events: semanticEvents,
      isolation: isolationRecord(environment.level, {
        removed: environment.removed,
        carried: environment.carried,
        runtimeAuth: environment.runtime_auth,
        transport: environment.transport,
        explicit: environment.explicit,
        blockedClasses: environment.blocked_classes,
        policy: environment.policy,
        runtimeAuthSource: resolvedAuth?.source ?? null,
        home: agentHome,
        homeSource: environment.home_source
      }),
      // Which program the credential was bound to, by digest. Provenance without values: a reader
      // checking whether two runs used the same runtime needs the identity, and nobody ever needs
      // the token.
      runtime_identity: runtimeIdentityRecord(
        identityVerdict,
        resolvedAuth,
        environment.runtime_auth.filter((name) => name !== resolvedAuth?.name)
      ),
      // The boundary this invocation ran under and what it measured: the three axes apart, the
      // canary's verdict with its evidence digest, the descendant scan, and -- settled by the
      // `finally` below -- whether teardown left anything behind. `issuanceGate` reads this.
      confinement: confinementRecord,
      error: outcome.error instanceof Error ? outcome.error.message : null,
      // Populated by the `finally` below, which runs before this object is returned, and redacted
      // the same way the confinement record's copy is: these are absolute paths on the operator's
      // machine -- their home, the run's own id -- and this object is what `assess` stores and
      // renders. Class, digest of the path, and the errno.
      scratch_not_removed: redactedFailures
    };
  } finally {
    // Cleaning up scratch must not be able to end a run.
    //
    // `agentHome` is the agent's HOME *and* its TMPDIR, so anything it or its children write lands
    // in the directory being removed. A process still running after the agent exited -- a hook, a
    // compile cache -- creates an entry mid-walk, and rmSync raises ENOTEMPTY without retrying.
    // Thrown from a `finally`, that replaces the run's own result: an operator paid for a family,
    // got `rc=70` and one line of ENOTEMPTY, and no report at all.
    //
    // A directory left behind in the system temp folder is the smaller loss, and it is reported
    // rather than hidden.
    for (const scratch of [internalDir, agentHome]) {
      // Null when the throw arrived before this one was made.
      if (scratch === null) continue;
      try {
        rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch (error) {
        cleanupFailures.push(`${scratch}: ${error.code ?? error.message}`);
      }
    }
    if (confinement !== null) cleanupFailures.push(...confinement.cleanup());
    // Null when the throw arrived before the child ran; a record that was never settled reads as
    // "not verified" at the gate, which is the true answer for a run that never got that far.
    redactedFailures.push(...cleanupFailures.map(redactCleanupFailure));
    if (confinementRecord !== null) settleConfinement(confinementRecord, cleanupFailures);
  }
}

/**
 * Deprecated. The normalised-text digest this product used to call file identity.
 *
 * It is not identity and never was: the bytes are decoded as UTF-8 before hashing, so every byte
 * sequence that is not valid UTF-8 becomes U+FFFD and files that differ hash the same -- 0xFF, 0xFE
 * and an honest U+FFFD all returned 83d544cc... -- and the CRLF fold then hides a rewrite of every
 * line ending in the file. Both are ways to change a file and have the evidence say you did not.
 *
 * Kept, and kept under its old name, because renaming it as a byte digest would make old records
 * unreadable as what they are: a value produced by this function is a historical, normalised text
 * digest and must never be compared against, or migrated into, a `sha256:` byte digest. Use
 * `fileByteDigest` from `lib/digest.mjs` for identity and `optionalFileTextDigest` where a document
 * comparison is genuinely what is wanted.
 */
export function fileDigest(file) {
  return sha256Text(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

export function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
