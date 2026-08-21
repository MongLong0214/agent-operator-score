/**
 * Explicit-root fresh workspace lifecycle.
 *
 * A run is a unique directory under a caller-supplied parent, never cwd.
 * Source is copied as regular files only. Symlinks, reused roots, and
 * digest mismatch fail closed. Workspace mutations are classified from
 * wrapper events plus the live tree: correlation_id and payload name the
 * path; a dead `path` field is not correlation. Uncorrelated writes are
 * external_mutation.
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
      mkdirSync(to);
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

const payloadNamesPath = (payload: unknown, path: string): boolean => {
  if (!isFilledString(payload)) return false;
  if (payload === path) return true;
  return payload.split(/[ \t\n\r]+/).includes(path);
};

export const createRunWorkspace = (input: unknown): WorkspaceOk | Fail => {
  if (!isPlainRecord(input)) return fail();
  const parentReal = explicitDirectory(input.parentRoot);
  const sourceReal = explicitDirectory(input.sourceRoot);
  const environmentDigest = environmentDigestOf(input.environment);
  if (parentReal === null || sourceReal === null || environmentDigest === null) return fail();
  if (parentReal === sourceReal) return fail();

  const sourceTree = inspectTree(sourceReal);
  if (!sourceTree.ok) return sourceTree;
  if (isFilledString(input.expectedBaseDigest) && input.expectedBaseDigest !== sourceTree.digest) {
    return fail();
  }
  if (isFilledString(input.expectedEnvironmentDigest) && input.expectedEnvironmentDigest !== environmentDigest) {
    return fail();
  }

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

  mkdirSync(root);
  if (!copyTree(sourceReal, root)) {
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
  const recorded = recordedOf(input.root);
  if (recorded === null) return fail();
  const parentReal = explicitDirectory(input.parentRoot);
  if (parentReal === null || parentReal !== recorded.parentRoot) return fail();
  const environmentDigest = environmentDigestOf(input.environment);
  if (environmentDigest === null || environmentDigest !== recorded.environmentDigest) return fail();
  const tree = inspectTree(recorded.root);
  if (!tree.ok) return fail();
  if (isFilledString(input.expectedBaseDigest) && input.expectedBaseDigest !== recorded.baseDigest) {
    return fail();
  }
  if (isFilledString(input.expectedEnvironmentDigest) && input.expectedEnvironmentDigest !== recorded.environmentDigest) {
    return fail();
  }
  return {
    ok: true,
    root: recorded.root,
    runId: recorded.runId,
    baseDigest: recorded.baseDigest,
    environmentDigest: recorded.environmentDigest
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
  for (const trace of input.traces) {
    if (!isPlainRecord(trace)) return fail();
    if (!isFilledString(trace.correlation_id)) continue;
    if (!payloadNamesPath(trace.payload, path)) continue;
    matching.push(trace);
  }

  if (matching.length === 0) {
    return {
      ok: true,
      actor: "external_mutation",
      event_type: "workspace.external_mutation",
      provenance: RUNNER_PROVENANCE,
      path
    };
  }

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
