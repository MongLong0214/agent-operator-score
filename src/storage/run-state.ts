/**
 * The lifecycle a run moves through, and the rule that a terminal state is recorded exactly once.
 *
 * Recording a second terminal state is the failure this module exists to prevent: it would let a
 * run that ended UNSAFE be overwritten as COMPLETED by a later recovery pass, which is the only way
 * this product could ever issue a score for a run it had already refused.
 */

export const RUN_STATES = Object.freeze([
  "CREATED",
  "DOCTOR_PASSED",
  "PREPARING",
  "RUNNING",
  "FINALIZING",
  "COMPLETED",
  "DIAGNOSTIC_ONLY",
  "INSUFFICIENT_EVIDENCE",
  "UNSAFE",
  "INVALID",
  "ABORTED",
  "INTERNAL_ERROR"
] as const);

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_STATES: readonly RunState[] = Object.freeze([
  "COMPLETED",
  "DIAGNOSTIC_ONLY",
  "INSUFFICIENT_EVIDENCE",
  "UNSAFE",
  "INVALID",
  "ABORTED",
  "INTERNAL_ERROR"
]);

export const isRunState = (value: unknown): value is RunState =>
  typeof value === "string" && (RUN_STATES as readonly string[]).includes(value);

export const isTerminal = (state: RunState): boolean => TERMINAL_STATES.includes(state);

/**
 * Which states may follow which. Progress is forward-only through the non-terminal chain, and any
 * non-terminal state may end at any terminal state — a run can be aborted or found unsafe at any
 * point, and pretending otherwise would force a caller to fake an intermediate transition.
 */
const NEXT: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  CREATED: ["DOCTOR_PASSED"],
  DOCTOR_PASSED: ["PREPARING"],
  PREPARING: ["RUNNING"],
  RUNNING: ["FINALIZING"],
  FINALIZING: [],
  COMPLETED: [],
  DIAGNOSTIC_ONLY: [],
  INSUFFICIENT_EVIDENCE: [],
  UNSAFE: [],
  INVALID: [],
  ABORTED: [],
  INTERNAL_ERROR: []
});

export const canTransition = (from: RunState, to: RunState): boolean => {
  // A terminal state is final. This is the guard that stops a recovery pass from relabelling a run
  // it did not perform, so it is checked before anything else.
  if (isTerminal(from)) return false;
  if (isTerminal(to)) return true;
  return NEXT[from].includes(to);
};
