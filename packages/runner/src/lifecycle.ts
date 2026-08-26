const REFUSED = "timeout/interruption can leave nonterminal state or active child.";

type Fail = { ok: false; reason: string };
type TerminalReason =
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "TIMED_OUT"
  | "STALLED"
  | "CANCELLED"
  | "UNSAFE"
  | "INVALID"
  | "INSUFFICIENT_EVIDENCE";
type State = "PENDING" | "RUNNING" | TerminalReason;
type Checkpoint = { phase: "final"; id: string; digest: string; observedAt: number };
type Attribution = {
  actor: "agent" | "human/takeover" | "external_mutation" | "actor.attribution_unknown";
  event_type: string;
  provenance: string;
  path: string;
  confidence?: number;
  score_withheld?: boolean;
};
type Terminal = {
  reason: TerminalReason;
  final_checkpoint: Checkpoint;
  attribution: Attribution;
  score: "ELIGIBLE" | "WITHHELD";
  outcome: "SCORED" | "DIAGNOSTIC ONLY";
};
type Snapshot = { state: State; terminal?: Terminal; checkpoints: Checkpoint[] };
type TransitionOk = { ok: true; state: State };
type FinishOk = { ok: true; terminal: Terminal };
type Machine = {
  ok: true;
  transition: (input: unknown) => TransitionOk | Fail;
  finish: (input: unknown) => FinishOk | Fail;
  snapshot: () => Snapshot;
};

const TERMINAL_REASONS = new Set<TerminalReason>([
  "PASSED",
  "FAILED",
  "BLOCKED",
  "TIMED_OUT",
  "STALLED",
  "CANCELLED",
  "UNSAFE",
  "INVALID",
  "INSUFFICIENT_EVIDENCE"
]);

const refuse = (): Fail => ({ ok: false, reason: REFUSED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isTimestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && value >= 0;

const terminalReasonOf = (value: unknown): TerminalReason | null =>
  typeof value === "string" && TERMINAL_REASONS.has(value as TerminalReason) ? (value as TerminalReason) : null;

const checkpointOf = (value: unknown): Checkpoint | null => {
  if (!isPlainRecord(value)) return null;
  if (value.phase !== "final" || !isFilledString(value.id) || !isFilledString(value.digest) || !isTimestamp(value.observedAt)) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/u.test(value.digest)) return null;
  return { phase: "final", id: value.id, digest: value.digest, observedAt: value.observedAt };
};

const attributionOf = (value: unknown): Attribution | null => {
  if (!isPlainRecord(value)) return null;
  const actor = value.actor;
  if (
    actor !== "agent" &&
    actor !== "human/takeover" &&
    actor !== "external_mutation" &&
    actor !== "actor.attribution_unknown"
  ) {
    return null;
  }
  if (!isFilledString(value.event_type) || !isFilledString(value.provenance) || !isFilledString(value.path)) return null;
  if (actor === "actor.attribution_unknown") {
    if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
      return null;
    }
    if (value.score_withheld !== true) return null;
    return {
      actor,
      event_type: value.event_type,
      provenance: value.provenance,
      path: value.path,
      confidence: value.confidence,
      score_withheld: true
    };
  }
  if (value.confidence !== undefined || value.score_withheld !== undefined) return null;
  return { actor, event_type: value.event_type, provenance: value.provenance, path: value.path };
};

const copyCheckpoint = (checkpoint: Checkpoint): Checkpoint => ({ ...checkpoint });

const copyAttribution = (attribution: Attribution): Attribution => ({ ...attribution });

const copyTerminal = (terminal: Terminal): Terminal => ({
  reason: terminal.reason,
  final_checkpoint: copyCheckpoint(terminal.final_checkpoint),
  attribution: copyAttribution(terminal.attribution),
  score: terminal.score,
  outcome: terminal.outcome
});

export const RunStateMachine = (input: unknown): Machine | Fail => {
  if (!isPlainRecord(input) || !isFilledString(input.runId)) return refuse();

  let state: State = "PENDING";
  let terminal: Terminal | undefined;
  const checkpoints: Checkpoint[] = [];

  const transition = (request: unknown): TransitionOk | Fail => {
    if (!isPlainRecord(request) || request.to !== "RUNNING" || state !== "PENDING") return refuse();
    state = "RUNNING";
    return { ok: true, state };
  };

  const finish = (request: unknown): FinishOk | Fail => {
    if (!isPlainRecord(request) || state !== "RUNNING" || terminal !== undefined) return refuse();
    const reason = terminalReasonOf(request.reason);
    const checkpoint = checkpointOf(request.checkpoint);
    const attribution = attributionOf(request.attribution);
    if (reason === null || checkpoint === null || attribution === null) return refuse();

    // Committing both records only after all parsing succeeds leaves no final checkpoint behind
    // without its terminal state when an interruption supplies incomplete evidence.
    const unknownAttribution = attribution.actor === "actor.attribution_unknown";
    terminal = {
      reason,
      final_checkpoint: checkpoint,
      attribution,
      score: unknownAttribution ? "WITHHELD" : "ELIGIBLE",
      outcome: unknownAttribution ? "DIAGNOSTIC ONLY" : "SCORED"
    };
    checkpoints.push(copyCheckpoint(checkpoint));
    state = reason;
    return { ok: true, terminal: copyTerminal(terminal) };
  };

  const snapshot = (): Snapshot => ({
    state,
    ...(terminal === undefined ? {} : { terminal: copyTerminal(terminal) }),
    checkpoints: checkpoints.map(copyCheckpoint)
  });

  return { ok: true, transition, finish, snapshot };
};
