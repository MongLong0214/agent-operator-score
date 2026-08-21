/**
 * Explicit-root fresh workspace lifecycle.
 *
 * A run is a unique directory under a caller-supplied parent, never cwd.
 * Source is copied as regular files only. Symlinks, reused roots, and
 * digest mismatch fail closed. verifyWorkspace always compares a fresh
 * inspectTree(recorded.root).digest to recorded.baseDigest; a caller pin
 * is extra and cannot skip that check. Workspace mutations are classified
 * from wrapper events plus the live tree. correlation_id must be filled.
 * Correlation is exact equality of the classified relative path against
 * a named field on an object payload (`payload.input.path` or
 * `payload.path`). EVENT_DEAD_FIELD `path` is not correlation.
 *
 * SSOT 6.7 splits the outcome on whether an observation set existed:
 *   no traces, or a payload with no readable workspace-relative target
 *     -> actor.attribution_unknown, score withheld (:721)
 *   readable traces, none naming this path
 *     -> workspace.external_mutation (:720)
 *
 * Create refuses a parent or run root inside source before mkdir.
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const CONTAINED = "dirty/wrong-root/symlink/cross-run residue is not contained.";
const CONFIDENCE_DROP = 0.69;
const RUNNER_PROVENANCE = "runner-workspace-correlation";

type FileEntry = { path: string; digest: string };
type TreeOk = { ok: true; files: FileEntry[]; digest: string };
type Fail = { ok: false; reason: string };
type WorkspaceOk = {
  ok: true;
  root: string;
  runId: string;
  baseDigest: string;
  environmentDigest: string;
};
type SealOk = {
  ok: true;
  phase: "initial" | "final";
  digest: string;
  files: FileEntry[];
};
type ClassificationOk = {
  ok: true;
  actor: string;
  event_type: string;
  provenance: string;
  path: string;
  confidence?: number;
  score_withheld?: boolean;
};
type Recorded = {
  root: string;
  parentRoot: string;
  sourceRoot: string;
  runId: string;
  baseDigest: string;
  baseFiles: FileEntry[];
  environmentDigest: string;
};

const registry = new Map<string, Recorded>();

const fail = (): Fail => ({ ok: false, reason: CONTAINED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

// A pin is a caller's claim about identity. Absent means no claim; present-but-unusable is a claim
// that cannot be checked, and collapsing it into "absent" told the caller its pin had been honoured
// when nothing was compared. `expectedEnvironmentDigest: 7` was accepted by both create and verify.
//
// The value is captured here, before any filesystem work, and every later comparison uses the
// capture. Two earlier attempts were both fail-open, in opposite directions, and a review found
// each:
//
//   Object.hasOwn + three reads  an inherited pin read as absent although every other field on the
//                                request is read through the prototype chain, and an accessor could
//                                show a correct digest to the validation and a different one to the
//                                comparison.
//   exactly one read             a Proxy answering [correct, wrong] was accepted, while the guard
//                                it replaced read twice and refused it.
//
// So an unstable pin is refused rather than resolved to whichever read wins: two reads must agree
// with each other before either is compared to anything. Capturing before the tree is inspected
// also keeps caller code from running after the digest it is checked against was computed -- an
// accessor could otherwise delete a workspace file and still be verified against the cached tree.
const PIN_UNUSABLE = Symbol("aos.unusablePin");

const capturePin = (input: Record<string, unknown>, key: string): string | undefined | symbol => {
  let first: unknown;
  let second: unknown;
  try {
    first = input[key];
    second = input[key];
  } catch {
    return PIN_UNUSABLE;
  }
  if (first === undefined && second === undefined) return undefined;
  if (first !== second) return PIN_UNUSABLE;
  if (!isFilledString(first)) return PIN_UNUSABLE;
  return first;
};

const pinDisagrees = (pin: string | undefined | symbol, actual: string): boolean => {
  if (pin === undefined) return false;
  return typeof pin !== "string" || pin !== actual;
};

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const posixRel = (from: string, to: string): string => relative(from, to).replaceAll("\\", "/");

const logicalInside = (parent: string, child: string): boolean => {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
};

const cwdReal = (): string => realpathSync(process.cwd());

const explicitDirectory = (value: unknown): string | null => {
  if (!isFilledString(value) || !isAbsolute(value)) return null;
  let stat;
  try {
    stat = lstatSync(value);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
  let real;
  try {
    real = realpathSync(value);
  } catch {
    return null;
  }
  if (real === cwdReal()) return null;
  return real;
};

const environmentDigestOf = (value: unknown): string | null => {
  if (!isPlainRecord(value)) return null;
  for (const entry of Object.values(value)) {
    if (typeof entry !== "string") return null;
  }
  return sha256(stableJson(value));
};

const inspectTree = (root: string): TreeOk | Fail => {
  const files: FileEntry[] = [];
  const walk = (directory: string): boolean => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!walk(absolute)) return false;
        continue;
      }
      if (!entry.isFile()) return false;
      let bytes;
      try {
        bytes = readFileSync(absolute);
      } catch {
        return false;
      }
      files.push({ path: posixRel(root, absolute), digest: sha256(bytes) });
    }
    return true;
  };
  if (!walk(root)) return fail();
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { ok: true, files, digest: sha256(files.map((file) => `${file.path}:${file.digest}`).join("\n")) };
};

const copyTree = (source: string, dest: string): boolean => {
  let entries;
  try {
    entries = readdirSync(source, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(dest, entry.name);
    if (entry.isSymbolicLink()) return false;
    if (entry.isDirectory()) {
      try {
        mkdirSync(to);
      } catch {
        return false;
      }
      if (!copyTree(from, to)) return false;
      continue;
    }
    if (!entry.isFile()) return false;
    try {
      copyFileSync(from, to);
    } catch {
      return false;
    }
  }
  return true;
};

const recordedOf = (root: unknown): Recorded | null => {
  const real = explicitDirectory(root);
  if (real === null) return null;
  return registry.get(real) ?? null;
};

// An absolute payload target is readable: the run root is known, so resolve it. Inside the
// workspace it correlates like any relative target; outside it names a different file, which is
// an observation rather than a failure to read.
const workspaceRelative = (root: string, absolutePath: string): string | null => {
  const rel = relative(root, absolutePath).replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("../") || rel === "..") return null;
  return rel;
};

const relativePathInside = (root: string, pathValue: unknown): string | null => {
  if (!isFilledString(pathValue) || isAbsolute(pathValue)) return null;
  const posix = pathValue.replaceAll("\\", "/");
  const segments = posix.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  const absolute = resolve(root, ...segments);
  if (!logicalInside(root, absolute)) return null;
  return posix;
};

const fileAt = (files: FileEntry[], path: string): FileEntry | undefined =>
  files.find((file) => file.path === path);

const namedPayloadPath = (payload: unknown): string | null => {
  if (!isPlainRecord(payload)) return null;
  if (isPlainRecord(payload.input) && isFilledString(payload.input.path)) {
    return payload.input.path;
  }
  if (isFilledString(payload.path)) return payload.path;
  return null;
};

export const createRunWorkspace = (input: unknown): WorkspaceOk | Fail => {
  if (!isPlainRecord(input)) return fail();
  const basePin = capturePin(input, "expectedBaseDigest");
  const environmentPin = capturePin(input, "expectedEnvironmentDigest");
  const parentReal = explicitDirectory(input.parentRoot);
  const sourceReal = explicitDirectory(input.sourceRoot);
  const environmentDigest = environmentDigestOf(input.environment);
  if (parentReal === null || sourceReal === null || environmentDigest === null) return fail();
  if (parentReal === sourceReal) return fail();
  if (logicalInside(sourceReal, parentReal)) return fail();

  const sourceTree = inspectTree(sourceReal);
  if (!sourceTree.ok) return sourceTree;
  if (pinDisagrees(basePin, sourceTree.digest)) return fail();
  if (pinDisagrees(environmentPin, environmentDigest)) return fail();

  let runId: string;
  if (input.runId === undefined) {
    runId = randomUUID();
  } else if (!isFilledString(input.runId) || input.runId.includes("/") || input.runId.includes("\\") || input.runId.includes("..")) {
    return fail();
  } else {
    runId = input.runId;
  }
  const root = join(parentReal, runId);
  if (!logicalInside(parentReal, root) || existsSync(root)) return fail();
  if (logicalInside(sourceReal, root) || root === sourceReal) return fail();

  try {
    mkdirSync(root);
  } catch {
    return fail();
  }
  let copiedOk = false;
  try {
    copiedOk = copyTree(sourceReal, root);
  } catch {
    copiedOk = false;
  }
  if (!copiedOk) {
    rmSync(root, { recursive: true, force: true });
    return fail();
  }
  const copied = inspectTree(root);
  if (!copied.ok || copied.digest !== sourceTree.digest) {
    rmSync(root, { recursive: true, force: true });
    return fail();
  }

  const record: Recorded = {
    root,
    parentRoot: parentReal,
    sourceRoot: sourceReal,
    runId,
    baseDigest: sourceTree.digest,
    baseFiles: copied.files.map((file) => ({ path: file.path, digest: file.digest })),
    environmentDigest
  };
  registry.set(root, record);
  return {
    ok: true,
    root,
    runId,
    baseDigest: sourceTree.digest,
    environmentDigest
  };
};

export const verifyWorkspace = (input: unknown): WorkspaceOk | Fail => {
  if (!isPlainRecord(input)) return fail();
  const basePin = capturePin(input, "expectedBaseDigest");
  const environmentPin = capturePin(input, "expectedEnvironmentDigest");
  const recorded = recordedOf(input.root);
  if (recorded === null) return fail();
  const parentReal = explicitDirectory(input.parentRoot);
  if (parentReal === null || parentReal !== recorded.parentRoot) return fail();
  const environmentDigest = environmentDigestOf(input.environment);
  if (environmentDigest === null || environmentDigest !== recorded.environmentDigest) return fail();
  const tree = inspectTree(recorded.root);
  if (!tree.ok) return fail();
  if (tree.digest !== recorded.baseDigest) return fail();
  if (pinDisagrees(basePin, tree.digest)) return fail();
  if (pinDisagrees(environmentPin, environmentDigest)) return fail();
  return {
    ok: true,
    root: recorded.root,
    runId: recorded.runId,
    baseDigest: tree.digest,
    environmentDigest
  };
};

export const sealWorkspace = (input: unknown): SealOk | Fail => {
  if (!isPlainRecord(input)) return fail();
  const recorded = recordedOf(input.root);
  if (recorded === null) return fail();
  if (input.phase !== "initial" && input.phase !== "final") return fail();
  const tree = inspectTree(recorded.root);
  if (!tree.ok) return fail();
  if (input.phase === "initial" && tree.digest !== recorded.baseDigest) return fail();
  return { ok: true, phase: input.phase, digest: tree.digest, files: tree.files };
};

const externalMutationClassification = (path: string): ClassificationOk => ({
  ok: true,
  actor: "external_mutation",
  event_type: "workspace.external_mutation",
  provenance: RUNNER_PROVENANCE,
  path
});

const unknownClassification = (path: string): ClassificationOk => ({
  ok: true,
  actor: "actor.attribution_unknown",
  event_type: "actor.attribution_unknown",
  provenance: RUNNER_PROVENANCE,
  path,
  confidence: CONFIDENCE_DROP,
  score_withheld: true
});

export const classifyWorkspaceMutation = (input: unknown): ClassificationOk | Fail => {
  if (!isPlainRecord(input)) return fail();
  const recorded = recordedOf(input.root);
  if (recorded === null) return fail();
  const path = relativePathInside(recorded.root, input.path);
  if (path === null) return fail();
  const tree = inspectTree(recorded.root);
  if (!tree.ok) return fail();
  const live = fileAt(tree.files, path);
  if (live === undefined) return fail();
  const base = fileAt(recorded.baseFiles, path);
  if (base !== undefined && base.digest === live.digest) return fail();
  if (!Array.isArray(input.traces)) return fail();

  const matching: Record<string, unknown>[] = [];
  let unreadablePayload = false;
  for (const trace of input.traces) {
    if (!isPlainRecord(trace)) return fail();
    if (!isFilledString(trace.correlation_id)) continue;
    const named = namedPayloadPath(trace.payload);
    // A payload this classifier cannot read a workspace-relative target out of leaves attribution
    // undetermined rather than uncorrelated: a truncated excerpt may have named this file before
    // the slice, and that is not an observation that the path was untouched.
    //
    // An absolute path is readable, though. The run root is known, so resolve it: inside the
    // workspace it correlates like any relative target, and outside it names a different file.
    if (named === null) {
      unreadablePayload = true;
      continue;
    }
    const target = isAbsolute(named) ? workspaceRelative(recorded.root, named) : named;
    if (target === null) {
      unreadablePayload = true;
      continue;
    }
    if (target !== path) continue;
    matching.push(trace);
  }

  // SSOT 6.7 is two rules, and which one applies turns on whether there was an observation
  // set to correlate against:
  //   :720  uncorrelated mutation            -> external_mutation
  //   :721  attribution cannot be determined -> actor.attribution_unknown, score withheld
  //
  // "Uncorrelated" means an observation set existed and this mutation is not in it. Three cases
  // fall out, and only the middle one is :720:
  //
  //   no traces at all              missing evidence, not an observation set     -> :721
  //   a trace whose payload cannot  the set is unreadable at this point, so
  //   be read for a path            attribution cannot be determined             -> :721
  //   readable traces, none naming  the set was observed and this path is not
  //   this path                     in it                                        -> :720
  //
  // The second case is the one #298 measures: an ordinary source write is serialized and sliced
  // past the 2048-character payload bound, so the path stops being recoverable. Calling that
  // external would assert an actor from a parsing failure.
  if (input.traces.length === 0) return unknownClassification(path);
  if (unreadablePayload) return unknownClassification(path);
  if (matching.length === 0) return externalMutationClassification(path);

  const actors = new Set<string>();
  for (const trace of matching) {
    if (trace.event_type === "human.manual_edit_declared" || trace.actor === "human/takeover") {
      actors.add("human/takeover");
      continue;
    }
    if (trace.event_type === "workspace.external_mutation" || trace.actor === "external_mutation") {
      actors.add("external_mutation");
      continue;
    }
    if (trace.event_type === "actor.attribution_unknown" || trace.actor === "actor.attribution_unknown") {
      actors.add("actor.attribution_unknown");
      continue;
    }
    if (trace.actor === "agent" || trace.event_type === "tool.call" || trace.event_type === "tool.result") {
      actors.add("agent");
      continue;
    }
    actors.add("actor.attribution_unknown");
  }
  if (actors.size !== 1 || actors.has("actor.attribution_unknown")) {
    return unknownClassification(path);
  }

  const actor = [...actors][0];
  const primary = matching[0];
  if (actor === "human/takeover") {
    const eventType = isFilledString(primary.event_type) ? primary.event_type : "human.manual_edit_declared";
    return {
      ok: true,
      actor: "human/takeover",
      event_type: eventType,
      provenance: RUNNER_PROVENANCE,
      path
    };
  }
  if (actor === "external_mutation") {
    return {
      ok: true,
      actor: "external_mutation",
      event_type: "workspace.external_mutation",
      provenance: RUNNER_PROVENANCE,
      path
    };
  }
  const eventType = isFilledString(primary.event_type) ? primary.event_type : "tool.call";
  return {
    ok: true,
    actor: "agent",
    event_type: eventType,
    provenance: RUNNER_PROVENANCE,
    path
  };
};
