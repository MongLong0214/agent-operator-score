/**
 * E3-002 worker isolation: an allowlisted worker envelope, and the assertion that a worker (or a
 * child it spawns) never reached the oracle, a secret, an inherited descriptor, or a temporary
 * location -- and that the oracle is materialized only after the worker has terminated.
 *
 * Denial is by allowlist. Nothing here relies on the oracle living somewhere the worker is
 * unlikely to guess: a path is admitted because it resolves inside the workspace, not because it
 * failed to match a deny pattern.
 */
import { copyFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const REACHED =
  "worker can reach an oracle file, environment canary, inherited descriptor, temporary location, symlink, /proc file descriptor, or a post-run oracle before termination.";

// Only these names cross into the worker. An oracle secret is dropped because it is not on the
// list, not because it was recognised -- a deny list would miss the next variable someone adds.
const WORKER_ENV_ALLOWLIST = new Set(["PATH", "LANG", "LC_ALL", "TZ"]);

// A descriptor path names whatever a file descriptor points at without naming a file, so a check
// that only compares directory prefixes never sees it.
const DESCRIPTOR_PATHS = [/^\/proc\/[^/]+\/fd(\/|$)/, /^\/dev\/fd(\/|$)/];

const MIN_SECRET_LENGTH = 8;

type Classification = "INVALID" | "UNSAFE";
type Fail = { ok: false; reason: string; classification: Classification };
type EnvelopeOk = {
  ok: true;
  env: Record<string, string>;
  cwd: string;
  stdio: (string | number)[];
  allowedPaths: string[];
  ipc: { enabled: boolean; channels: string[] };
};
type Registered = {
  workspaceRoot: string;
  oracleReal: string;
  tempRoots: string[];
  secrets: string[];
};

const registry = new WeakMap<object, Registered>();

const invalid = (): Fail => ({ ok: false, reason: REACHED, classification: "INVALID" });
const unsafe = (): Fail => ({ ok: false, reason: REACHED, classification: "UNSAFE" });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const insideOrEqual = (parent: string, child: string): boolean => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

const realDirectory = (value: unknown): string | null => {
  if (!isFilledString(value) || !isAbsolute(value)) return null;
  try {
    return realpathSync(value);
  } catch {
    return null;
  }
};

/** Resolve as far as the filesystem allows, so a symlink is judged by its target and a path that
 *  does not exist yet is still judged by the deepest real ancestor it would live under. */
const resolveThroughLinks = (value: string): string => {
  try {
    return realpathSync(value);
  } catch {
    const parent = resolve(value, "..");
    if (parent === value) return resolve(value);
    try {
      return resolve(realpathSync(parent), value.slice(parent.length + 1) || ".");
    } catch {
      return resolve(value);
    }
  }
};

/** Every string the oracle document contains, so a secret is detected wherever it surfaces --
 *  under another variable name, inside an IPC message, or nested in a child's environment. */
const secretsOf = (oracleReal: string): string[] => {
  let text: string;
  try {
    text = readFileSync(oracleReal, "utf8");
  } catch {
    return [];
  }
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.length >= MIN_SECRET_LENGTH) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (isPlainRecord(value)) {
      for (const entry of Object.values(value)) walk(entry);
    }
  };
  try {
    walk(JSON.parse(text));
  } catch {
    if (text.length >= MIN_SECRET_LENGTH) found.add(text.trim());
  }
  return [...found];
};

const carriesSecret = (value: unknown, secrets: string[]): boolean => {
  if (typeof value === "string") return secrets.some((secret) => value.includes(secret));
  if (Array.isArray(value)) return value.some((entry) => carriesSecret(entry, secrets));
  if (isPlainRecord(value)) {
    return Object.entries(value).some(([key, entry]) => carriesSecret(key, secrets) || carriesSecret(entry, secrets));
  }
  return false;
};

export const buildWorkerEnvelope = (input: unknown): EnvelopeOk | Fail => {
  if (!isPlainRecord(input)) return invalid();
  const workspaceRoot = realDirectory(input.workspaceRoot);
  const tempRoot = realDirectory(input.tempRoot);
  if (workspaceRoot === null || tempRoot === null) return invalid();
  if (!isFilledString(input.oraclePath) || !isAbsolute(input.oraclePath)) return invalid();
  const oracleReal = resolveThroughLinks(input.oraclePath);
  if (!existsSync(oracleReal)) return invalid();
  // An oracle inside the workspace cannot be denied by containment, so the envelope is refused
  // rather than issued with a rule it cannot enforce.
  if (insideOrEqual(workspaceRoot, oracleReal)) return invalid();
  if (!isPlainRecord(input.env)) return invalid();

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.env)) {
    if (!WORKER_ENV_ALLOWLIST.has(name)) continue;
    if (typeof value !== "string") return invalid();
    env[name] = value;
  }

  const secrets = secretsOf(oracleReal);
  // An allowlisted variable whose value happens to carry the oracle is still the oracle.
  if (Object.values(env).some((value) => carriesSecret(value, secrets))) return unsafe();

  const envelope: EnvelopeOk = {
    ok: true,
    env,
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
    allowedPaths: [workspaceRoot],
    ipc: { enabled: true, channels: ["control"] }
  };
  registry.set(envelope, { workspaceRoot, oracleReal, tempRoots: [tempRoot, resolveThroughLinks("/tmp")], secrets });
  return envelope;
};

const pathReachable = (recorded: Registered, candidate: unknown): boolean => {
  if (!isFilledString(candidate) || !isAbsolute(candidate)) return false;
  if (DESCRIPTOR_PATHS.some((pattern) => pattern.test(candidate))) return false;
  const real = resolveThroughLinks(candidate);
  if (DESCRIPTOR_PATHS.some((pattern) => pattern.test(real))) return false;
  if (real === recorded.oracleReal || insideOrEqual(recorded.oracleReal, real)) return false;
  if (recorded.tempRoots.some((root) => insideOrEqual(root, real))) return false;
  return insideOrEqual(recorded.workspaceRoot, real);
};

const stdioContained = (recorded: Registered, stdio: unknown): boolean => {
  if (!Array.isArray(stdio) || stdio.length === 0) return false;
  return stdio.every((slot) => slot === "pipe" || slot === "ignore");
};

const envContained = (recorded: Registered, env: unknown): boolean => {
  if (!isPlainRecord(env)) return false;
  return Object.entries(env).every(
    ([name, value]) => WORKER_ENV_ALLOWLIST.has(name) && typeof value === "string" && !carriesSecret(value, recorded.secrets)
  );
};

export const assertIsolation = (input: unknown): { ok: true } | Fail => {
  if (!isPlainRecord(input)) return invalid();
  const envelope = input.envelope;
  if (!isPlainRecord(envelope)) return invalid();
  const recorded = registry.get(envelope as object);
  // An envelope this module did not issue carries no rules to check it against.
  if (recorded === undefined) return invalid();

  if (Object.hasOwn(input, "readPath") && !pathReachable(recorded, input.readPath)) return unsafe();
  if (Object.hasOwn(input, "env") && !envContained(recorded, input.env)) return unsafe();
  if (Object.hasOwn(input, "stdio") && !stdioContained(recorded, input.stdio)) return unsafe();
  if (Object.hasOwn(input, "ipcMessage") && carriesSecret(input.ipcMessage, recorded.secrets)) return unsafe();

  if (Object.hasOwn(input, "child")) {
    const child = input.child;
    if (!isPlainRecord(child)) return invalid();
    if (Object.hasOwn(child, "env") && !envContained(recorded, child.env)) return unsafe();
    if (Object.hasOwn(child, "readPath") && !pathReachable(recorded, child.readPath)) return unsafe();
    if (Object.hasOwn(child, "stdio") && !stdioContained(recorded, child.stdio)) return unsafe();
    if (Object.hasOwn(child, "ipcMessage") && carriesSecret(child.ipcMessage, recorded.secrets)) return unsafe();
  }

  if (Object.hasOwn(input, "materialize")) {
    const materialize = input.materialize;
    if (!isPlainRecord(materialize)) return invalid();
    if (!isFilledString(materialize.destination) || !isAbsolute(materialize.destination)) return invalid();
    // Materializing while the worker can still read is the violation; the destination is left
    // untouched so a refusal cannot be the thing that leaks the oracle.
    if (materialize.workerTerminated !== true) return invalid();
    try {
      copyFileSync(recorded.oracleReal, materialize.destination);
    } catch {
      return invalid();
    }
  }

  return { ok: true };
};
