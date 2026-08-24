import assert from "node:assert/strict";
import { describe, test } from "node:test";

// A missing module or export must surface through the ticket's pinned RED
// message instead of stopping test discovery before every named case runs.
const loadStateContinuity = async () => {
  try {
    return await import("../src/scorer/graders/state-continuity.ts");
  } catch {
    return {};
  }
};

const NO_ORACLE = "state-loss/stale-resume behavior has no deterministic oracle.";

const SCENARIO_ID = "form-a-fam-4-continuity";
const FIRST_CHECKPOINT = "checkpoint-17";
const CURRENT_CHECKPOINT = "checkpoint-18";
const LOST_SESSION = "session-alpha";
const RESUMED_SESSION = "session-beta";
const BAD_DIGEST = `sha256:${"f".repeat(64)}`;

const previousState = {
  checkpoint_id: FIRST_CHECKPOINT,
  sequence: 17,
  goal: "Reconcile the import ledger.",
  blocker: "Awaiting reviewer evidence.",
  evidence_digest: `sha256:${"1".repeat(64)}`,
  active_work: ["reconcile-ledger"],
  artifact_digest: `sha256:${"a".repeat(64)}`
};

const currentState = {
  checkpoint_id: CURRENT_CHECKPOINT,
  sequence: 18,
  goal: "Reconcile the import ledger after reviewer failure.",
  blocker: "Awaiting approval for the corrected reconciliation.",
  evidence_digest: `sha256:${"2".repeat(64)}`,
  active_work: ["reconcile-ledger", "verify-reconciliation"],
  artifact_digest: `sha256:${"b".repeat(64)}`
};

type Checkpoint = typeof currentState;

type ContinuityEvent = {
  sequence: number;
  type: string;
  checkpoint_id?: string;
  session_id?: string;
  from_session_id?: string;
  to_session_id?: string;
  active_work?: string[];
};

type ContinuityAttempt = {
  scenario_id: string;
  artifacts: {
    checkpoints: Checkpoint[];
    evidence: Array<{ checkpoint_id: string; digest: string }>;
  };
  events: ContinuityEvent[];
  resume: {
    checkpoint_id: string;
    goal: string;
    blocker: string;
    evidence_digest: string;
    active_work: string[];
  };
};

type ContinuityGrade =
  | { ok: true; latest_checkpoint_id: string }
  | { ok: false; reason: string };

type GradeStateContinuity = (input: unknown) => ContinuityGrade;

const freshResume = (): ContinuityAttempt => ({
  scenario_id: SCENARIO_ID,
  artifacts: {
    checkpoints: [{ ...previousState, active_work: [...previousState.active_work] }, {
      ...currentState,
      active_work: [...currentState.active_work]
    }],
    evidence: [
      { checkpoint_id: FIRST_CHECKPOINT, digest: previousState.evidence_digest },
      { checkpoint_id: CURRENT_CHECKPOINT, digest: currentState.evidence_digest }
    ]
  },
  events: [
    { sequence: 17, type: "checkpoint_persisted", checkpoint_id: FIRST_CHECKPOINT },
    { sequence: 18, type: "checkpoint_persisted", checkpoint_id: CURRENT_CHECKPOINT },
    { sequence: 19, type: "session_lost", session_id: LOST_SESSION },
    { sequence: 20, type: "reviewer_failed" },
    {
      sequence: 21,
      type: "session_resumed",
      from_session_id: LOST_SESSION,
      to_session_id: RESUMED_SESSION,
      checkpoint_id: CURRENT_CHECKPOINT
    },
    {
      sequence: 22,
      type: "work_resumed",
      session_id: RESUMED_SESSION,
      active_work: [...currentState.active_work]
    }
  ],
  resume: {
    checkpoint_id: CURRENT_CHECKPOINT,
    goal: currentState.goal,
    blocker: currentState.blocker,
    evidence_digest: currentState.evidence_digest,
    active_work: [...currentState.active_work]
  }
});

const withEvent = (
  attempt: ContinuityAttempt,
  sequence: number,
  changed: Partial<ContinuityEvent>
): ContinuityAttempt => ({
  ...attempt,
  events: attempt.events.map((event) => event.sequence === sequence ? { ...event, ...changed } : event)
});

type OptionalEventField =
  | "checkpoint_id"
  | "session_id"
  | "from_session_id"
  | "to_session_id"
  | "active_work";

const withoutEventField = (
  attempt: ContinuityAttempt,
  sequence: number,
  field: OptionalEventField
): ContinuityAttempt => ({
  ...attempt,
  events: attempt.events.map((event) => {
    if (event.sequence !== sequence) return event;
    const changed = { ...event };
    delete changed[field];
    return changed;
  })
});

const withResume = (
  attempt: ContinuityAttempt,
  changed: Partial<ContinuityAttempt["resume"]>
): ContinuityAttempt => ({ ...attempt, resume: { ...attempt.resume, ...changed } });

const withCurrentCheckpoint = (
  attempt: ContinuityAttempt,
  changed: Partial<Checkpoint>
): ContinuityAttempt => ({
  ...attempt,
  artifacts: {
    ...attempt.artifacts,
    checkpoints: attempt.artifacts.checkpoints.map((checkpoint) =>
      checkpoint.checkpoint_id === CURRENT_CHECKPOINT ? { ...checkpoint, ...changed } : checkpoint
    )
  }
});

const requireGrader = async (): Promise<GradeStateContinuity> => {
  const loaded = await loadStateContinuity();
  assert.equal(typeof loaded.gradeStateContinuity, "function", NO_ORACLE);
  return loaded.gradeStateContinuity as GradeStateContinuity;
};

const accepted = (grade: ContinuityGrade) => {
  assert.equal(grade.ok, true, NO_ORACLE);
  if (grade.ok) assert.equal(grade.latest_checkpoint_id, CURRENT_CHECKPOINT, NO_ORACLE);
};

const refused = (grade: ContinuityGrade) => {
  assert.equal(grade.ok, false, NO_ORACLE);
  if (!grade.ok) assert.equal(grade.reason, NO_ORACLE, NO_ORACLE);
};

describe("fam4-continuity", () => {
  test("fresh-resume", async () => {
    const gradeStateContinuity = await requireGrader();
    accepted(gradeStateContinuity(freshResume()));
    accepted(gradeStateContinuity({ ...freshResume(), events: [...freshResume().events].reverse() }));
    refused(gradeStateContinuity({ ...freshResume(), scenario_id: "unknown-scenario" }));
    refused(gradeStateContinuity(withEvent(freshResume(), 19, { type: "session_present" })));
    refused(gradeStateContinuity(withEvent(freshResume(), 20, { type: "reviewer_passed" })));
    refused(gradeStateContinuity(withEvent(freshResume(), 21, { from_session_id: "session-unknown" })));
    refused(gradeStateContinuity(withEvent(freshResume(), 21, { type: "resume_skipped" })));
    refused(gradeStateContinuity(withEvent(freshResume(), 22, { session_id: LOST_SESSION })));
    refused(gradeStateContinuity(withEvent(freshResume(), 22, { type: "work_resume_skipped" })));
    refused(gradeStateContinuity(withEvent(freshResume(), 21, { to_session_id: LOST_SESSION })));
    refused(
      gradeStateContinuity(
        withEvent(
          withEvent(freshResume(), 21, { to_session_id: LOST_SESSION }),
          22,
          { session_id: LOST_SESSION }
        )
      )
    );
    refused(gradeStateContinuity(withEvent(freshResume(), 20, { sequence: 25 })));
  });

  test("stale-checkpoint", async () => {
    const gradeStateContinuity = await requireGrader();
    const lostSessionIdPresent = freshResume();
    accepted(gradeStateContinuity(lostSessionIdPresent));
    refused(gradeStateContinuity(withoutEventField(lostSessionIdPresent, 19, "session_id")));
    refused(gradeStateContinuity(withResume(freshResume(), { checkpoint_id: FIRST_CHECKPOINT })));
    refused(gradeStateContinuity(withEvent(freshResume(), 21, { checkpoint_id: FIRST_CHECKPOINT })));
    refused(gradeStateContinuity(withEvent(freshResume(), 18, { checkpoint_id: FIRST_CHECKPOINT })));
    refused(gradeStateContinuity(withCurrentCheckpoint(freshResume(), { sequence: 17 })));
    const consistentStale = freshResume();
    consistentStale.artifacts.checkpoints[0] = { ...currentState, checkpoint_id: FIRST_CHECKPOINT };
    consistentStale.artifacts.evidence[0] = {
      checkpoint_id: FIRST_CHECKPOINT,
      digest: currentState.evidence_digest
    };
    consistentStale.events = consistentStale.events.map((event) => {
      if (event.sequence === 18 || event.sequence === 21) return { ...event, checkpoint_id: FIRST_CHECKPOINT };
      return event;
    });
    consistentStale.resume = { ...consistentStale.resume, checkpoint_id: FIRST_CHECKPOINT };
    refused(gradeStateContinuity(consistentStale));
  });

  test("missing-blocker", async () => {
    const gradeStateContinuity = await requireGrader();
    const resumedFromSessionIdPresent = freshResume();
    accepted(gradeStateContinuity(resumedFromSessionIdPresent));
    refused(gradeStateContinuity(withoutEventField(resumedFromSessionIdPresent, 21, "from_session_id")));
    refused(gradeStateContinuity(withResume(freshResume(), { blocker: "" })));
    refused(gradeStateContinuity(withResume(freshResume(), { blocker: previousState.blocker })));
    refused(gradeStateContinuity(withResume(freshResume(), { goal: previousState.goal })));
    refused(gradeStateContinuity(withCurrentCheckpoint(freshResume(), { blocker: previousState.blocker })));
    refused(gradeStateContinuity(withCurrentCheckpoint(freshResume(), { goal: previousState.goal })));
    refused(
      gradeStateContinuity(
        withResume(
          withCurrentCheckpoint(freshResume(), { goal: previousState.goal }),
          { goal: previousState.goal }
        )
      )
    );
    refused(
      gradeStateContinuity(
        withResume(
          withCurrentCheckpoint(freshResume(), { blocker: previousState.blocker }),
          { blocker: previousState.blocker }
        )
      )
    );
  });

  test("wrong-evidence", async () => {
    const gradeStateContinuity = await requireGrader();
    const resumedToSessionIdPresent = freshResume();
    accepted(gradeStateContinuity(resumedToSessionIdPresent));
    refused(gradeStateContinuity(withoutEventField(resumedToSessionIdPresent, 21, "to_session_id")));
    refused(gradeStateContinuity(withResume(freshResume(), { evidence_digest: BAD_DIGEST })));
    const alteredEvidence = freshResume();
    alteredEvidence.artifacts.evidence[1] = { checkpoint_id: CURRENT_CHECKPOINT, digest: BAD_DIGEST };
    refused(gradeStateContinuity(alteredEvidence));
    const alteredArtifact = freshResume();
    alteredArtifact.artifacts.checkpoints[1] = { ...currentState, artifact_digest: BAD_DIGEST };
    refused(gradeStateContinuity(alteredArtifact));
    refused(gradeStateContinuity(withCurrentCheckpoint(freshResume(), { evidence_digest: BAD_DIGEST })));
    refused(
      gradeStateContinuity(
        withResume(
          withCurrentCheckpoint(freshResume(), { evidence_digest: BAD_DIGEST }),
          { evidence_digest: BAD_DIGEST }
        )
      )
    );
  });

  test("valid-alternative", async () => {
    const gradeStateContinuity = await requireGrader();
    const resumedCheckpointIdPresent = freshResume();
    accepted(gradeStateContinuity(resumedCheckpointIdPresent));
    refused(gradeStateContinuity(withoutEventField(resumedCheckpointIdPresent, 21, "checkpoint_id")));
    const workResumedSessionIdPresent = freshResume();
    accepted(gradeStateContinuity(workResumedSessionIdPresent));
    refused(gradeStateContinuity(withoutEventField(workResumedSessionIdPresent, 22, "session_id")));
    const workResumedActiveWorkPresent = freshResume();
    accepted(gradeStateContinuity(workResumedActiveWorkPresent));
    refused(gradeStateContinuity(withoutEventField(workResumedActiveWorkPresent, 22, "active_work")));
    accepted(
      gradeStateContinuity(
        withResume(freshResume(), { active_work: [...currentState.active_work].reverse() })
      )
    );
    refused(
      gradeStateContinuity(
        withResume(freshResume(), { active_work: [currentState.active_work[0]] })
      )
    );
    refused(
      gradeStateContinuity(
        withResume(freshResume(), { active_work: [currentState.active_work[0], "publish-result"] })
      )
    );
    refused(
      gradeStateContinuity(
        withEvent(freshResume(), 22, { active_work: [currentState.active_work[0]] })
      )
    );
    refused(
      gradeStateContinuity(
        withCurrentCheckpoint(freshResume(), { active_work: [currentState.active_work[0]] })
      )
    );
    refused(
      gradeStateContinuity(
        withEvent(
          withResume(
            withCurrentCheckpoint(freshResume(), { active_work: [currentState.active_work[0]] }),
            { active_work: [currentState.active_work[0]] }
          ),
          22,
          { active_work: [currentState.active_work[0]] }
        )
      )
    );
  });
});
