/**
 * Every user-facing failure carries a stable code, so a caller can branch on the cause without
 * matching prose. The codes are the product surface; the messages are not.
 *
 * A failure is returned as data rather than raised as a subclass. Two reasons: a thrown value
 * crossing an async boundary loses its type in `catch (e: unknown)` and has to be re-narrowed at
 * every site, and a `run_id` belongs to the failure even when the failure happened before any
 * scoring — a shape carries that, a message does not.
 */

export type AosErrorCode =
  | "AOS_UNSUPPORTED_PLATFORM"
  | "AOS_NODE_VERSION_UNSUPPORTED"
  | "AOS_RUNTIME_NOT_FOUND"
  | "AOS_RUNTIME_AUTH_UNAVAILABLE"
  | "AOS_RUNTIME_CAPABILITY_MISSING"
  | "AOS_RUNTIME_START_FAILED"
  | "AOS_RUNTIME_TIMED_OUT"
  | "AOS_RUNTIME_TERMINATION_FAILED"
  | "AOS_SUITE_INVALID"
  | "AOS_WORKSPACE_INVALID"
  | "AOS_WORKSPACE_LIMIT_EXCEEDED"
  | "AOS_TRACE_INVALID"
  | "AOS_TRACE_INSUFFICIENT"
  | "AOS_PRIVACY_PROJECTION_FAILED"
  | "AOS_SCORE_CONTRACT_INVALID"
  | "AOS_SCORE_ARITHMETIC_OVERFLOW"
  | "AOS_RUN_LOCKED"
  | "AOS_RUN_CORRUPTED"
  | "AOS_USER_ABORTED"
  | "AOS_INTERNAL_ERROR";

export const AOS_ERROR_CODES: readonly AosErrorCode[] = Object.freeze([
  "AOS_UNSUPPORTED_PLATFORM",
  "AOS_NODE_VERSION_UNSUPPORTED",
  "AOS_RUNTIME_NOT_FOUND",
  "AOS_RUNTIME_AUTH_UNAVAILABLE",
  "AOS_RUNTIME_CAPABILITY_MISSING",
  "AOS_RUNTIME_START_FAILED",
  "AOS_RUNTIME_TIMED_OUT",
  "AOS_RUNTIME_TERMINATION_FAILED",
  "AOS_SUITE_INVALID",
  "AOS_WORKSPACE_INVALID",
  "AOS_WORKSPACE_LIMIT_EXCEEDED",
  "AOS_TRACE_INVALID",
  "AOS_TRACE_INSUFFICIENT",
  "AOS_PRIVACY_PROJECTION_FAILED",
  "AOS_SCORE_CONTRACT_INVALID",
  "AOS_SCORE_ARITHMETIC_OVERFLOW",
  "AOS_RUN_LOCKED",
  "AOS_RUN_CORRUPTED",
  "AOS_USER_ABORTED",
  "AOS_INTERNAL_ERROR"
] as const);

export interface AosFailure {
  readonly ok: false;
  readonly code: AosErrorCode;
  readonly message: string;
  /** What the user can do next. Required: a code with no way forward is a dead end, not an error. */
  readonly remediation: string;
  readonly run_id: string | null;
}

export const failure = (
  code: AosErrorCode,
  message: string,
  remediation: string,
  runId: string | null = null
): AosFailure => Object.freeze({ ok: false as const, code, message, remediation, run_id: runId });

export const isAosFailure = (value: unknown): value is AosFailure =>
  typeof value === "object" &&
  value !== null &&
  (value as { ok?: unknown }).ok === false &&
  AOS_ERROR_CODES.includes((value as { code?: AosErrorCode }).code as AosErrorCode);

/**
 * Exit codes are part of the CLI contract and identical in JSON mode: a script that branches on
 * them must not have to parse output to learn what happened.
 */
export const EXIT = Object.freeze({
  OK: 0,
  BAD_INPUT: 2,
  ENVIRONMENT: 3,
  INCOMPLETE: 4,
  UNSAFE: 5,
  INVALID: 6,
  ABORTED: 7,
  INTERNAL: 8
} as const);

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const EXIT_BY_CODE: Readonly<Record<AosErrorCode, ExitCode>> = Object.freeze({
  AOS_UNSUPPORTED_PLATFORM: EXIT.ENVIRONMENT,
  AOS_NODE_VERSION_UNSUPPORTED: EXIT.ENVIRONMENT,
  AOS_RUNTIME_NOT_FOUND: EXIT.ENVIRONMENT,
  AOS_RUNTIME_AUTH_UNAVAILABLE: EXIT.ENVIRONMENT,
  AOS_RUNTIME_CAPABILITY_MISSING: EXIT.ENVIRONMENT,
  AOS_RUNTIME_START_FAILED: EXIT.INCOMPLETE,
  AOS_RUNTIME_TIMED_OUT: EXIT.INCOMPLETE,
  AOS_RUNTIME_TERMINATION_FAILED: EXIT.INCOMPLETE,
  AOS_SUITE_INVALID: EXIT.BAD_INPUT,
  AOS_WORKSPACE_INVALID: EXIT.INCOMPLETE,
  AOS_WORKSPACE_LIMIT_EXCEEDED: EXIT.INCOMPLETE,
  AOS_TRACE_INVALID: EXIT.INVALID,
  AOS_TRACE_INSUFFICIENT: EXIT.INCOMPLETE,
  AOS_PRIVACY_PROJECTION_FAILED: EXIT.INVALID,
  AOS_SCORE_CONTRACT_INVALID: EXIT.INVALID,
  AOS_SCORE_ARITHMETIC_OVERFLOW: EXIT.INTERNAL,
  AOS_RUN_LOCKED: EXIT.BAD_INPUT,
  AOS_RUN_CORRUPTED: EXIT.INVALID,
  AOS_USER_ABORTED: EXIT.ABORTED,
  AOS_INTERNAL_ERROR: EXIT.INTERNAL
} as const);

export const exitCodeFor = (code: AosErrorCode): ExitCode => EXIT_BY_CODE[code];
