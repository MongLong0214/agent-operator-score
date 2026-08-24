/**
 * E3-002 worker isolation: an allowlisted worker envelope, and the assertion that a worker (or a
 * child it spawns) never reached the oracle, a secret, an inherited descriptor, or a temporary
 * location -- and that the oracle is materialized only after the worker has terminated.
 *
 * Denial is by allowlist. Nothing here relies on the oracle living somewhere the worker is
 * unlikely to guess: a path is admitted because it resolves inside the workspace, not because it
 * failed to match a deny pattern.
 */
import { copyFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

const REACHED =
  "worker can reach an oracle file, environment canary, inherited descriptor, temporary location, symlink, /proc file descriptor, or a post-run oracle before termination.";

// Only these names cross into the worker. An oracle secret is dropped because it is not on the
// list, not because it was recognised -- a deny list would miss the next variable someone adds.
const WORKER_ENV_ALLOWLIST = new Set(["PATH", "LANG", "LC_ALL", "TZ"]);

// A descriptor path names whatever a file descriptor points at without naming a file, so a check
// that only compares directory prefixes never sees it.
const DESCRIPTOR_PATHS = [/^\/proc\/[^/]+\/fd(\/|$)/, /^\/dev\/fd(\/|$)/];

// The bounds make oracle processing finite before JSON parsing or graph traversal. Thirty-two
// containers and one MiB are far beyond v0 oracle needs while keeping malformed input from
// becoming a stack or memory authority.
const MAX_ORACLE_BYTES = 1024 * 1024;
const MAX_ORACLE_NESTING = 32;
const MAX_ORACLE_VALUES = 10_000;
const MAX_PAYLOAD_VALUES = 10_000;

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
type FileIdentity = { dev: number; ino: number };
type Oracle = {
  real: string;
  identity: FileIdentity;
  digest: string;
  secrets: string[];
};
type Registered = {
  workspaceRoot: string;
  tempRoots: string[];
  oracle: Oracle;
  envelopeFingerprint: string;
};
type InteractionCheck = { valid: boolean; safe: boolean; evidence: boolean };

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
    const real = realpathSync(value);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
};

/** Resolve to the deepest existing ancestor, then append every missing segment. This keeps a
 * missing grandchild below a directory symlink bound to the symlink's real target. */
const resolveThroughLinks = (value: string): string => {
  let cursor = resolve(value);
  const missing: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(cursor), ...missing);
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(value);
      missing.unshift(basename(cursor));
      cursor = parent;
    }
  }
};

const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

const identityOf = (path: string): FileIdentity | null => {
  try {
    const stat = statSync(path);
    return stat.isFile() ? { dev: stat.dev, ino: stat.ino } : null;
  } catch {
    return null;
  }
};

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean => left.dev === right.dev && left.ino === right.ino;

const addSecret = (found: Set<string>, value: string): void => {
  // The empty string is excluded only because it is contained in every payload; every non-empty
  // string, including a one-character canary, is protected without a length floor.
  if (value.length > 0) found.add(value);
};

/** Count JSON containers without recursing and before JSON.parse. Quoted braces do not count. */
const nestingWithinBound = (text: string): boolean => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAX_ORACLE_NESTING) return false;
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }
  }
  return true;
};

const jsonSecrets = (document: unknown): string[] | null => {
  const found = new Set<string>();
  const pending: Array<{ value: unknown; depth: number }> = [{ value: document, depth: 0 }];
  let values = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || ++values > MAX_ORACLE_VALUES) return null;
    const { value, depth } = current;
    if (typeof value === "string") {
      addSecret(found, value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      addSecret(found, String(value));
    } else if (Array.isArray(value)) {
      for (const entry of value) pending.push({ value: entry, depth: depth + 1 });
    } else if (isPlainRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        addSecret(found, key);
        pending.push({ value: entry, depth: depth + 1 });
      }
    }
  }
  return [...found];
};

const nonJsonSecrets = (text: string): string[] => {
  const found = new Set<string>();
  // A non-JSON oracle is opaque rather than structured data. Protecting the whole document and
  // each delimiter-bounded field catches a field leak from formats such as `answer=canary` without
  // guessing a schema or silently accepting a document that could not be parsed.
  addSecret(found, text);
  for (const field of text.split(/[\s=,:;|&]+/u)) addSecret(found, field);
  return [...found];
};

/** Refuses unreadable, non-file, oversize, or over-nested oracles; an empty secret list is never
 * substituted for an oracle that could not be inspected. */
const oracleOf = (oraclePath: string): Oracle | null => {
  const real = resolveThroughLinks(oraclePath);
  let bytes: Buffer;
  let identity: FileIdentity;
  try {
    const stat = statSync(real);
    if (!stat.isFile() || stat.size > MAX_ORACLE_BYTES) return null;
    bytes = readFileSync(real);
    if (bytes.byteLength > MAX_ORACLE_BYTES) return null;
    identity = { dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }

  const text = bytes.toString("utf8");
  if (!nestingWithinBound(text)) return null;
  let secrets: string[];
  try {
    const parsed = jsonSecrets(JSON.parse(text));
    if (parsed === null) return null;
    secrets = parsed;
  } catch {
    secrets = nonJsonSecrets(text);
  }
  return { real, identity, digest: sha256(bytes), secrets };
};

const secretInText = (value: string, secrets: string[]): boolean => secrets.some((secret) => value.includes(secret));

/** Scan values in the same forms that IPC can carry. Errors, accessors, and unbounded graphs are
 * unsafe because they prevent an authority from establishing that a canary was absent. */
const carriesSecret = (value: unknown, secrets: string[]): boolean => {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  let values = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (++values > MAX_PAYLOAD_VALUES) return true;
    if (typeof current === "string") {
      if (secretInText(current, secrets)) return true;
      continue;
    }
    if (typeof current === "number" || typeof current === "boolean" || typeof current === "bigint") {
      if (secretInText(String(current), secrets)) return true;
      continue;
    }
    if (current === null || current === undefined || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    try {
      if (Buffer.isBuffer(current)) {
        if (secretInText(current.toString("utf8"), secrets)) return true;
        continue;
      }
      if (current instanceof String) {
        if (secretInText(current.valueOf(), secrets)) return true;
        continue;
      }
      if (current instanceof Map) {
        for (const [key, entry] of current) {
          pending.push(key, entry);
        }
        continue;
      }
      if (current instanceof Set) {
        for (const entry of current) pending.push(entry);
        continue;
      }

      for (const key of Object.getOwnPropertyNames(current)) {
        if (secretInText(key, secrets)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        // Evaluating an accessor can execute worker-controlled code; its unreadable result is an
        // unsafe report rather than a reason to silently skip a possible secret.
        if (descriptor === undefined || !("value" in descriptor)) return true;
        pending.push(descriptor.value);
      }
      for (const key of Object.getOwnPropertySymbols(current)) {
        if (secretInText(String(key), secrets)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor)) return true;
        pending.push(descriptor.value);
      }

      const candidate = current as { toJSON?: unknown; toString?: unknown };
      if (typeof candidate.toJSON === "function") pending.push(candidate.toJSON.call(current));
      if (
        typeof candidate.toString === "function" &&
        candidate.toString !== Object.prototype.toString &&
        !Buffer.isBuffer(current) &&
        !(current instanceof String)
      ) {
        pending.push(candidate.toString.call(current));
      }
    } catch {
      return true;
    }
  }
  return false;
};

const dataValue = (record: object, key: string): unknown | null => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : null;
  } catch {
    return null;
  }
};

const exactKeys = (record: object, expected: string[]): boolean => {
  try {
    const actual = Object.getOwnPropertyNames(record).sort();
    return (
      Object.getOwnPropertySymbols(record).length === 0 &&
      actual.length === expected.length &&
      actual.every((key, index) => key === expected[index])
    );
  } catch {
    return false;
  }
};

/** A canonical, data-property-only snapshot guards every worker-visible envelope field. */
const fingerprintEnvelope = (candidate: unknown): string | null => {
  if (!isPlainRecord(candidate) || !exactKeys(candidate, ["allowedPaths", "cwd", "env", "ipc", "ok", "stdio"])) return null;
  const ok = dataValue(candidate, "ok");
  const env = dataValue(candidate, "env");
  const cwd = dataValue(candidate, "cwd");
  const stdio = dataValue(candidate, "stdio");
  const allowedPaths = dataValue(candidate, "allowedPaths");
  const ipc = dataValue(candidate, "ipc");
  if (ok !== true || !isPlainRecord(env) || !isFilledString(cwd) || !Array.isArray(stdio) || !Array.isArray(allowedPaths) || !isPlainRecord(ipc)) {
    return null;
  }
  if (!exactKeys(ipc, ["channels", "enabled"]) || dataValue(ipc, "enabled") !== true) return null;
  const channels = dataValue(ipc, "channels");
  if (!Array.isArray(channels) || !channels.every((channel) => typeof channel === "string")) return null;
  if (!stdio.every((slot) => typeof slot === "string") || !allowedPaths.every((path) => typeof path === "string")) return null;

  const environment: Array<[string, string]> = [];
  for (const key of Object.getOwnPropertyNames(env).sort()) {
    const value = dataValue(env, key);
    if (!WORKER_ENV_ALLOWLIST.has(key) || typeof value !== "string") return null;
    environment.push([key, value]);
  }
  if (Object.getOwnPropertySymbols(env).length > 0) return null;
  return JSON.stringify({ ok, env: environment, cwd, stdio, allowedPaths, ipc: { enabled: true, channels } });
};

export const buildWorkerEnvelope = (input: unknown): EnvelopeOk | Fail => {
  if (!isPlainRecord(input)) return invalid();
  const workspaceRoot = realDirectory(input.workspaceRoot);
  const tempRoot = realDirectory(input.tempRoot);
  if (workspaceRoot === null || tempRoot === null) return invalid();
  if (!isFilledString(input.oraclePath) || !isAbsolute(input.oraclePath)) return invalid();
  const oracle = oracleOf(input.oraclePath);
  if (oracle === null) return invalid();
  // An oracle inside the workspace cannot be denied by containment, so the envelope is refused
  // rather than issued with a rule it cannot enforce.
  if (insideOrEqual(workspaceRoot, oracle.real)) return invalid();
  if (!isPlainRecord(input.env)) return invalid();

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.env)) {
    if (!WORKER_ENV_ALLOWLIST.has(name)) continue;
    if (typeof value !== "string") return invalid();
    env[name] = value;
  }
  // An allowlisted variable whose value happens to carry the oracle is still the oracle.
  if (Object.values(env).some((value) => carriesSecret(value, oracle.secrets))) return unsafe();

  const envelope: EnvelopeOk = {
    ok: true,
    env,
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
    allowedPaths: [workspaceRoot],
    ipc: { enabled: true, channels: ["control"] }
  };
  const envelopeFingerprint = fingerprintEnvelope(envelope);
  if (envelopeFingerprint === null) return invalid();
  // Only the declared run scratch root is denied. An earlier version also denied the system
  // temporary directory outright, which is wrong wherever a workspace legitimately lives under it:
  // on Linux tmpdir() is /tmp, so that rule refused every read in the workspace itself. Paths
  // elsewhere under the system temp directory are already outside the workspace, so containment
  // refuses them without a second rule that has to know where temp is.
  registry.set(envelope, { workspaceRoot, tempRoots: [tempRoot], oracle, envelopeFingerprint });
  return envelope;
};

const pathReachable = (recorded: Registered, candidate: unknown): boolean => {
  if (!isFilledString(candidate) || !isAbsolute(candidate)) return false;
  if (DESCRIPTOR_PATHS.some((pattern) => pattern.test(candidate))) return false;
  const real = resolveThroughLinks(candidate);
  if (DESCRIPTOR_PATHS.some((pattern) => pattern.test(real))) return false;
  // This explicit check documents the non-negotiable oracle rule before general containment.
  if (real === recorded.oracle.real || insideOrEqual(recorded.oracle.real, real)) return false;
  if (recorded.tempRoots.some((root) => insideOrEqual(root, real))) return false;
  if (!insideOrEqual(recorded.workspaceRoot, real)) return false;

  // A hardlink retains device/inode identity; a copied oracle has a distinct identity but exactly
  // the recorded bytes. Together these recognise both aliases without relying on path spelling.
  const identity = identityOf(real);
  if (identity !== null && sameIdentity(identity, recorded.oracle.identity)) return false;
  if (identity !== null) {
    try {
      if (sha256(readFileSync(real)) === recorded.oracle.digest) return false;
    } catch {
      return false;
    }
  }
  return true;
};

const stdioContained = (stdio: unknown): boolean =>
  Array.isArray(stdio) && stdio.length > 0 && stdio.every((slot) => slot === "pipe" || slot === "ignore");

const envContained = (recorded: Registered, env: unknown): boolean => {
  if (!isPlainRecord(env)) return false;
  return Object.entries(env).every(
    ([name, value]) => WORKER_ENV_ALLOWLIST.has(name) && typeof value === "string" && !carriesSecret(value, recorded.oracle.secrets)
  );
};

/** Iterative validation is required because every spawned descendant inherits a capability to
 * receive the oracle; stopping at one child generation would leave grandchildren unchecked. */
const validateInteractions = (recorded: Registered, root: Record<string, unknown>): InteractionCheck => {
  const pending: Record<string, unknown>[] = [root];
  const seen = new Set<object>();
  let evidence = false;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) return { valid: false, safe: false, evidence };
    seen.add(current);
    try {
      if (Object.hasOwn(current, "readPath")) {
        evidence = true;
        if (!pathReachable(recorded, current.readPath)) return { valid: true, safe: false, evidence };
      }
      if (Object.hasOwn(current, "env")) {
        evidence = true;
        if (!envContained(recorded, current.env)) return { valid: true, safe: false, evidence };
      }
      if (Object.hasOwn(current, "stdio")) {
        evidence = true;
        if (!stdioContained(current.stdio)) return { valid: true, safe: false, evidence };
      }
      if (Object.hasOwn(current, "ipcMessage")) {
        evidence = true;
        if (carriesSecret(current.ipcMessage, recorded.oracle.secrets)) return { valid: true, safe: false, evidence };
      }
      if (Object.hasOwn(current, "child")) {
        const child = current.child;
        if (!isPlainRecord(child)) return { valid: false, safe: false, evidence };
        pending.push(child);
      }
    } catch {
      return { valid: false, safe: false, evidence };
    }
  }
  return { valid: true, safe: true, evidence };
};

/** `kill(pid, 0)` is an observable liveness probe. A reused PID is observed as alive and refused,
 * which is fail-closed; permissions or any non-ESRCH error are likewise not evidence of death. */
const observedWorkerIsAlive = (worker: unknown): boolean | null => {
  if (!isPlainRecord(worker)) return null;
  const pid = worker.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
    return code === "ESRCH" ? false : null;
  }
};

export const assertIsolation = (input: unknown): { ok: true } | Fail => {
  if (!isPlainRecord(input)) return invalid();
  const envelope = input.envelope;
  if (!isPlainRecord(envelope)) return invalid();
  const recorded = registry.get(envelope as object);
  // An envelope this module did not issue carries no rules to check it against. Identity is not
  // enough: content is revalidated against the exact envelope issued for this run.
  if (recorded === undefined || fingerprintEnvelope(envelope) !== recorded.envelopeFingerprint) return invalid();

  const interactions = validateInteractions(recorded, input);
  if (!interactions.valid) return invalid();
  if (!interactions.safe) return unsafe();

  const hasMaterialization = Object.hasOwn(input, "materialize");
  // Minimum evidence is one observed boundary datum (path, environment, descriptor, IPC, or the
  // materialization liveness probe) at the worker or any descendant. The envelope alone only
  // states policy, so accepting it would let an authority report isolation without any evidence.
  if (!interactions.evidence && !hasMaterialization) return invalid();

  if (hasMaterialization) {
    const materialize = input.materialize;
    if (!isPlainRecord(materialize)) return invalid();
    if (!isFilledString(materialize.destination) || !isAbsolute(materialize.destination)) return invalid();
    // A caller-controlled workerTerminated boolean is ignored. Only an observed dead PID permits
    // materialization, and the PID-reuse behavior is documented by observedWorkerIsAlive.
    if (observedWorkerIsAlive(materialize.worker) !== false) return invalid();
    try {
      copyFileSync(recorded.oracle.real, materialize.destination);
    } catch {
      return invalid();
    }
  }

  return { ok: true };
};
