/**
 * What a run may consume before it is refused.
 *
 * A suite manifest may lower any of these and may never raise one. The direction matters: a suite
 * is data that travels with a task, so letting it raise a limit would let the thing being measured
 * decide how much of the machine it gets — and a scenario could then exhaust the host and be
 * recorded as an environment failure rather than as its own.
 */

export interface ResourceLimits {
  readonly maxFiles: number;
  readonly maxWorkspaceBytes: number;
  readonly maxFileBytes: number;
  readonly maxDirectoryDepth: number;
  readonly maxEventLogBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxJsonRecordBytes: number;
}

export const DEFAULT_LIMITS: ResourceLimits = Object.freeze({
  maxFiles: 100_000,
  maxWorkspaceBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
  maxDirectoryDepth: 64,
  maxEventLogBytes: 50 * 1024 * 1024,
  maxStdoutBytes: 10 * 1024 * 1024,
  maxStderrBytes: 10 * 1024 * 1024,
  maxJsonRecordBytes: 64 * 1024
});

const LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_LIMITS) as (keyof ResourceLimits)[]);

export type LimitOverride = Partial<Record<keyof ResourceLimits, unknown>>;

export interface LimitResolution {
  readonly limits: ResourceLimits;
  /** Fields the manifest tried to raise, or supplied in an unusable shape. Reported, never applied. */
  readonly rejected: readonly string[];
}

/**
 * Resolves a suite manifest's declared limits against the defaults.
 *
 * A rejected field is reported rather than silently ignored, because a suite author who wrote a
 * higher limit believed it took effect, and their scenario will behave differently from what they
 * intended in a way nothing else would explain.
 */
export const resolveLimits = (override: LimitOverride | null | undefined): LimitResolution => {
  if (override === null || override === undefined) {
    return { limits: DEFAULT_LIMITS, rejected: Object.freeze([]) };
  }
  const resolved: Record<string, number> = { ...DEFAULT_LIMITS };
  const rejected: string[] = [];

  for (const key of Object.keys(override)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      rejected.push(key);
      continue;
    }
    const value = override[key as keyof ResourceLimits];
    const fallback = DEFAULT_LIMITS[key as keyof ResourceLimits];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      rejected.push(key);
      continue;
    }
    if (value > fallback) {
      rejected.push(key);
      continue;
    }
    resolved[key] = value;
  }
  return { limits: Object.freeze(resolved) as unknown as ResourceLimits, rejected: Object.freeze(rejected.sort()) };
};

export type LimitBreach =
  | { readonly kind: "files"; readonly count: number; readonly limit: number }
  | { readonly kind: "workspace_bytes"; readonly bytes: number; readonly limit: number }
  | { readonly kind: "file_bytes"; readonly path: string; readonly bytes: number; readonly limit: number }
  | { readonly kind: "depth"; readonly path: string; readonly depth: number; readonly limit: number };

export const describeBreach = (breach: LimitBreach): string => {
  switch (breach.kind) {
    case "files":
      return `workspace holds ${breach.count} files, over the limit of ${breach.limit}`;
    case "workspace_bytes":
      return `workspace holds ${breach.bytes} bytes, over the limit of ${breach.limit}`;
    case "file_bytes":
      return `${breach.path} is ${breach.bytes} bytes, over the per-file limit of ${breach.limit}`;
    case "depth":
      return `${breach.path} is at depth ${breach.depth}, over the limit of ${breach.limit}`;
  }
};
