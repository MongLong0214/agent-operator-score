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
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const VERSION = "0.1.0";
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

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function readJsonIfExists(file) {
  return existsSync(file) ? readJson(file) : null;
}

export function writeJson(file, value) {
  atomicWrite(file, canonicalJson(value));
}

export function ensureInside(root, candidate) {
  const base = resolve(root);
  const target = resolve(candidate);
  if (target !== base && !target.startsWith(`${base}/`)) throw new Error(`AOS_PATH_ESCAPE ${target}`);
  return target;
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

function processGroupMembers(pgid) {
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

export async function runProcess(spec, context) {
  assertSupportedPlatform();
  const internalDir = mkdtempSync(join(tmpdir(), "aos-prompt-"));
  const safePromptFile = join(internalDir, "prompt.txt");
  writeFileSync(safePromptFile, context.prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const runtimeContext = { ...context, promptFile: safePromptFile };
  const args = spec.args.map((value) => replaceTemplate(value, runtimeContext));
  const promptInArgs = spec.args.some((value) => value.includes("{prompt}"));
  const started = Date.now();
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let timedOut = false;
  let interrupted = false;
  let child;
  try {
    child = spawn(spec.command, args, {
      cwd: context.workspace,
      detached: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        AOS_SESSION_ID: context.session,
        AOS_FAMILY: context.family,
        AOS_WORKSPACE: context.workspace,
        AOS_TASK_FILE: safePromptFile
      }
    });
    const pgid = child.pid;
    child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, Buffer.from(chunk)); });
    child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, Buffer.from(chunk)); });
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
    const membersBeforeCleanup = pgid ? processGroupMembers(pgid).filter((pid) => pid !== pgid) : [];
    const leakedDescendants = membersBeforeCleanup.length > 0;
    if (pgid && processGroupMembers(pgid).length > 0) {
      signalProcessGroup(pgid, "SIGTERM");
      await sleep(250);
    }
    if (pgid && processGroupMembers(pgid).length > 0) {
      signalProcessGroup(pgid, "SIGKILL");
      await sleep(250);
    }
    const survivors = pgid ? processGroupMembers(pgid) : [];
    const survivor = survivors.length > 0;
    const text = stdout.toString("utf8");
    const semanticEvents = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("AOS_EVENT\t")) continue;
      try {
        const parsed = JSON.parse(line.slice("AOS_EVENT\t".length));
        if (parsed && typeof parsed === "object") semanticEvents.push(parsed);
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
      stdout_bytes: stdout.length,
      stderr_bytes: stderr.length,
      stdout_digest: sha256Text(text),
      stderr_digest: sha256Text(stderr.toString("utf8")),
      semantic_events: semanticEvents,
      error: outcome.error instanceof Error ? outcome.error.message : null
    };
  } finally {
    rmSync(internalDir, { recursive: true, force: true });
  }
}

export function fileDigest(file) {
  return sha256Text(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

export function fileMode(file) {
  return statSync(file).mode & 0o777;
}

export function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
