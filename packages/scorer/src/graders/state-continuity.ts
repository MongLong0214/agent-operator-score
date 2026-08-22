const REFUSED = "state-loss/stale-resume behavior has no deterministic oracle.";
const DIGEST = /^sha256:[a-f0-9]{64}$/;

type RecordValue = Record<string, unknown>;

type Fam4ContinuityScenario = Readonly<{
  worker: Readonly<{
    prompt: string;
    visible_artifacts: readonly string[];
  }>;
  oracle: Readonly<{
    scenario_id: string;
    latest_state: Readonly<{
      checkpoint_id: string;
      sequence: number;
      goal: string;
      blocker: string;
      evidence_digest: string;
      active_work: readonly string[];
      artifact_digest: string;
    }>;
  }>;
}>;

export const fam4ContinuityScenario: Fam4ContinuityScenario = Object.freeze({
  worker: Object.freeze({
    prompt: "Resume the reconciliation after session loss and reviewer failure.",
    visible_artifacts: Object.freeze([
      "worker/FAM-4/reconciliation-ledger",
      "worker/FAM-4/reviewer-feedback"
    ])
  }),
  oracle: Object.freeze({
    scenario_id: "form-a-fam-4-continuity",
    latest_state: Object.freeze({
      checkpoint_id: "checkpoint-18",
      sequence: 18,
      goal: "Reconcile the import ledger after reviewer failure.",
      blocker: "Awaiting approval for the corrected reconciliation.",
      evidence_digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      active_work: Object.freeze([
        "reconcile-ledger",
        "verify-reconciliation"
      ]),
      artifact_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    })
  })
});

type Checkpoint = {
  checkpointId: string;
  sequence: number;
  goal: string;
  blocker: string;
  evidenceDigest: string;
  activeWork: string[];
  artifactDigest: string;
};

type Evidence = { checkpointId: string; digest: string };

type ContinuityEvent = {
  sequence: number;
  type: string;
  checkpointId?: string;
  sessionId?: string;
  fromSessionId?: string;
  toSessionId?: string;
  activeWork?: string[];
};

type ResumePacket = {
  checkpointId: string;
  goal: string;
  blocker: string;
  evidenceDigest: string;
  activeWork: string[];
};

type Accepted = { ok: true; latest_checkpoint_id: string };
type Refused = { ok: false; reason: string };

const refuse = (): Refused => ({ ok: false, reason: REFUSED });

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isDigest = (value: unknown): value is string => isFilledString(value) && DIGEST.test(value);

const strings = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.some((entry) => !isFilledString(entry))) return null;
  const result = [...value];
  return new Set(result).size === result.length ? result : null;
};

const asCheckpoint = (value: unknown): Checkpoint | null => {
  if (!isRecord(value)) return null;
  const activeWork = strings(value.active_work);
  if (
    !isFilledString(value.checkpoint_id)
    || !Number.isSafeInteger(value.sequence)
    || value.sequence <= 0
    || !isFilledString(value.goal)
    || !isFilledString(value.blocker)
    || !isDigest(value.evidence_digest)
    || activeWork === null
    || !isDigest(value.artifact_digest)
  ) {
    return null;
  }
  return {
    checkpointId: value.checkpoint_id,
    sequence: value.sequence,
    goal: value.goal,
    blocker: value.blocker,
    evidenceDigest: value.evidence_digest,
    activeWork,
    artifactDigest: value.artifact_digest
  };
};

const asEvidence = (value: unknown): Evidence | null => {
  if (!isRecord(value) || !isFilledString(value.checkpoint_id) || !isDigest(value.digest)) return null;
  return { checkpointId: value.checkpoint_id, digest: value.digest };
};

const asEvent = (value: unknown): ContinuityEvent | null => {
  if (!isRecord(value) || !Number.isSafeInteger(value.sequence) || value.sequence <= 0 || !isFilledString(value.type)) {
    return null;
  }
  const activeWork = value.active_work === undefined ? undefined : strings(value.active_work);
  if (activeWork === null) return null;
  const optionalStrings = [
    value.checkpoint_id,
    value.session_id,
    value.from_session_id,
    value.to_session_id
  ];
  if (optionalStrings.some((entry) => entry !== undefined && !isFilledString(entry))) return null;
  return {
    sequence: value.sequence,
    type: value.type,
    checkpointId: value.checkpoint_id,
    sessionId: value.session_id,
    fromSessionId: value.from_session_id,
    toSessionId: value.to_session_id,
    activeWork: activeWork === undefined ? undefined : activeWork
  };
};

const asResume = (value: unknown): ResumePacket | null => {
  if (!isRecord(value)) return null;
  const activeWork = strings(value.active_work);
  if (
    !isFilledString(value.checkpoint_id)
    || !isFilledString(value.goal)
    || !isFilledString(value.blocker)
    || !isDigest(value.evidence_digest)
    || activeWork === null
  ) {
    return null;
  }
  return {
    checkpointId: value.checkpoint_id,
    goal: value.goal,
    blocker: value.blocker,
    evidenceDigest: value.evidence_digest,
    activeWork
  };
};

const equalWork = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry) => right.includes(entry));

const oneEvent = (events: readonly ContinuityEvent[], type: string): ContinuityEvent | null => {
  const matching = events.filter((event) => event.type === type);
  return matching.length === 1 ? matching[0] : null;
};

const indexed = <T extends { checkpointId: string }>(values: readonly T[]): Map<string, T> | null => {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.checkpointId)) return null;
    result.set(value.checkpointId, value);
  }
  return result;
};

const matchesLatestState = (checkpoint: Checkpoint, evidence: Evidence): boolean => {
  const expected = fam4ContinuityScenario.oracle.latest_state;
  return (
    checkpoint.sequence === expected.sequence
    && checkpoint.goal === expected.goal
    && checkpoint.blocker === expected.blocker
    && checkpoint.evidenceDigest === expected.evidence_digest
    && equalWork(checkpoint.activeWork, expected.active_work)
    && checkpoint.artifactDigest === expected.artifact_digest
    && evidence.digest === expected.evidence_digest
  );
};

const matchesResume = (checkpoint: Checkpoint, resume: ResumePacket): boolean =>
  resume.checkpointId === checkpoint.checkpointId
  && resume.goal === checkpoint.goal
  && resume.blocker === checkpoint.blocker
  && resume.evidenceDigest === checkpoint.evidenceDigest
  && equalWork(resume.activeWork, checkpoint.activeWork);

export const gradeStateContinuity = (input: unknown): Accepted | Refused => {
  try {
    if (!isRecord(input) || input.scenario_id !== fam4ContinuityScenario.oracle.scenario_id || !isRecord(input.artifacts)) {
      return refuse();
    }
    if (!Array.isArray(input.artifacts.checkpoints) || !Array.isArray(input.artifacts.evidence) || !Array.isArray(input.events)) {
      return refuse();
    }

    const checkpoints = input.artifacts.checkpoints.map(asCheckpoint);
    const evidence = input.artifacts.evidence.map(asEvidence);
    const events = input.events.map(asEvent);
    const resume = asResume(input.resume);
    if (checkpoints.some((entry) => entry === null) || evidence.some((entry) => entry === null) || events.some((entry) => entry === null) || resume === null) {
      return refuse();
    }

    const checkpointById = indexed(checkpoints as Checkpoint[]);
    const evidenceByCheckpoint = indexed(evidence as Evidence[]);
    const orderedEvents = [...(events as ContinuityEvent[])].sort((left, right) => left.sequence - right.sequence);
    if (
      checkpointById === null
      || evidenceByCheckpoint === null
      || new Set(orderedEvents.map((event) => event.sequence)).size !== orderedEvents.length
    ) {
      return refuse();
    }

    const lost = oneEvent(orderedEvents, "session_lost");
    const reviewerFailed = oneEvent(orderedEvents, "reviewer_failed");
    const resumed = oneEvent(orderedEvents, "session_resumed");
    const workResumed = oneEvent(orderedEvents, "work_resumed");
    if (
      lost === null
      || reviewerFailed === null
      || resumed === null
      || workResumed === null
      || !isFilledString(lost.sessionId)
      || !isFilledString(resumed.fromSessionId)
      || !isFilledString(resumed.toSessionId)
      || !isFilledString(resumed.checkpointId)
      || !isFilledString(workResumed.sessionId)
      || workResumed.activeWork === undefined
      || !(lost.sequence < reviewerFailed.sequence && reviewerFailed.sequence < resumed.sequence && resumed.sequence < workResumed.sequence)
      || resumed.fromSessionId !== lost.sessionId
      || resumed.toSessionId === lost.sessionId
      || workResumed.sessionId !== resumed.toSessionId
    ) {
      return refuse();
    }

    const persisted = orderedEvents.filter(
      (event) => event.type === "checkpoint_persisted" && event.sequence < lost.sequence && isFilledString(event.checkpointId)
    );
    const latestPersisted = persisted.at(-1);
    if (latestPersisted === undefined || latestPersisted.checkpointId === undefined) return refuse();

    const latest = checkpointById.get(latestPersisted.checkpointId);
    const latestEvidence = evidenceByCheckpoint.get(latestPersisted.checkpointId);
    if (
      latest === undefined
      || latestEvidence === undefined
      || latestPersisted.checkpointId !== fam4ContinuityScenario.oracle.latest_state.checkpoint_id
      || resumed.checkpointId !== latestPersisted.checkpointId
      || !matchesLatestState(latest, latestEvidence)
      || !matchesResume(latest, resume)
      || !equalWork(workResumed.activeWork, latest.activeWork)
    ) {
      return refuse();
    }

    return { ok: true, latest_checkpoint_id: latest.checkpointId };
  } catch {
    return refuse();
  }
};
