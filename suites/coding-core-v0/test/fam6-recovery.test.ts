import assert from "node:assert/strict";
import { describe, test } from "node:test";

const MESSAGE = "timeout/rate-limit/blocker classes and recovery packets are not distinguishable.";

const SCENARIO_ID = "coding-core-v0/form-a/fam6-recovery";
const FAULT_VERSION = "fam6-recovery-v1";

type FailureClass = "TIMEOUT" | "RATE_LIMIT" | "HUMAN_DECISION" | "PERMANENT_FAILURE";

type RecoveryPacket = {
  action: string;
  retry_after_ms?: number;
  terminal: { state: string; reason: string };
};

type RecoveryRun = {
  scenario_id: string;
  fault: { version: string; class: FailureClass; id: string };
  diagnosis: { failure_class: FailureClass; evidence_refs: string[] };
  recovery_packet: RecoveryPacket;
};

type Grade =
  | {
    state: "GRADED";
    scenario_id: string;
    metric_id: "M18";
    failure_class: FailureClass;
    diagnosis: "CORRECT";
    information_value: "SUFFICIENT";
    intervention: "MINIMUM";
    recovery_packet: RecoveryPacket;
  }
  | { state: "REFUSED"; reason: "INVALID_RECOVERY" };

type GradeRecovery = (input: unknown) => Grade;

const FAULTS: Record<FailureClass, { id: string; packet: RecoveryPacket }> = {
  TIMEOUT: {
    id: "timeout-build-17",
    packet: {
      action: "RETRY_WITH_BACKOFF",
      retry_after_ms: 1_000,
      terminal: { state: "RETRY_SCHEDULED", reason: "TIMEOUT_RETRY" }
    }
  },
  RATE_LIMIT: {
    id: "rate-limit-api-42",
    packet: {
      action: "WAIT_FOR_RATE_LIMIT_RESET",
      retry_after_ms: 60_000,
      terminal: { state: "RETRY_SCHEDULED", reason: "RATE_LIMIT_WAIT" }
    }
  },
  HUMAN_DECISION: {
    id: "approval-release-9",
    packet: {
      action: "REQUEST_HUMAN_DECISION",
      terminal: { state: "BLOCKED", reason: "HUMAN_DECISION_REQUIRED" }
    }
  },
  PERMANENT_FAILURE: {
    id: "schema-incompatible-3",
    packet: {
      action: "STOP_AND_ESCALATE",
      terminal: { state: "FAILED", reason: "PERMANENT_FAILURE" }
    }
  }
};

const refused: Grade = { state: "REFUSED", reason: "INVALID_RECOVERY" };

const packetFor = (failureClass: FailureClass): RecoveryPacket => {
  const packet = FAULTS[failureClass].packet;
  return {
    ...packet,
    terminal: { ...packet.terminal }
  };
};

const recoveryRun = (failureClass: FailureClass): RecoveryRun => {
  const fault = FAULTS[failureClass];
  return {
    scenario_id: SCENARIO_ID,
    fault: { version: FAULT_VERSION, class: failureClass, id: fault.id },
    diagnosis: {
      failure_class: failureClass,
      evidence_refs: [`fault:${fault.id}`, `trace:${fault.id}`]
    },
    recovery_packet: packetFor(failureClass)
  };
};

const graded = (failureClass: FailureClass): Grade => ({
  state: "GRADED",
  scenario_id: SCENARIO_ID,
  metric_id: "M18",
  failure_class: failureClass,
  diagnosis: "CORRECT",
  information_value: "SUFFICIENT",
  intervention: "MINIMUM",
  recovery_packet: packetFor(failureClass)
});

const loadGradeRecovery = async (): Promise<GradeRecovery> => {
  let loaded: { gradeRecovery?: unknown } = {};
  try {
    loaded = await import("../../../packages/scorer/src/graders/recovery.ts");
  } catch {
    loaded = {};
  }
  assert.equal(typeof loaded.gradeRecovery, "function", MESSAGE);
  return loaded.gradeRecovery as GradeRecovery;
};

const assertGrade = (gradeRecovery: GradeRecovery, input: unknown, expected: Grade) => {
  assert.deepEqual(gradeRecovery(input), expected, MESSAGE);
};

const assertClass = async (failureClass: FailureClass) => {
  const gradeRecovery = await loadGradeRecovery();
  const matching = recoveryRun(failureClass);
  assertGrade(gradeRecovery, matching, graded(failureClass));

  const wrongScenario = recoveryRun(failureClass);
  wrongScenario.scenario_id = "coding-core-v0/form-a/fam6-wrong-target";
  assertGrade(gradeRecovery, wrongScenario, refused);

  const wrongVersion = recoveryRun(failureClass);
  wrongVersion.fault.version = "fam6-recovery-v0";
  assertGrade(gradeRecovery, wrongVersion, refused);

  const wrongFaultId = recoveryRun(failureClass);
  wrongFaultId.fault.id = "fault-unknown";
  assertGrade(gradeRecovery, wrongFaultId, refused);

  const wrongDiagnosis = recoveryRun(failureClass);
  wrongDiagnosis.diagnosis.failure_class = failureClass === "TIMEOUT" ? "RATE_LIMIT" : "TIMEOUT";
  assertGrade(gradeRecovery, wrongDiagnosis, refused);

  for (const index of matching.diagnosis.evidence_refs.keys()) {
    const missingEvidence = recoveryRun(failureClass);
    missingEvidence.diagnosis.evidence_refs.splice(index, 1);
    assertGrade(gradeRecovery, missingEvidence, refused);
  }

  const wrongAction = recoveryRun(failureClass);
  wrongAction.recovery_packet.action = "UNSAFE_FALLBACK";
  assertGrade(gradeRecovery, wrongAction, refused);

  const wrongTerminalState = recoveryRun(failureClass);
  wrongTerminalState.recovery_packet.terminal.state = "COMPLETED";
  assertGrade(gradeRecovery, wrongTerminalState, refused);

  const wrongTerminalReason = recoveryRun(failureClass);
  wrongTerminalReason.recovery_packet.terminal.reason = "UNREGISTERED_REASON";
  assertGrade(gradeRecovery, wrongTerminalReason, refused);

  const extraPacketField = recoveryRun(failureClass);
  Object.assign(extraPacketField.recovery_packet, { unsafe_fallback: true });
  assertGrade(gradeRecovery, extraPacketField, refused);

  const extraTerminalField = recoveryRun(failureClass);
  Object.assign(extraTerminalField.recovery_packet.terminal, { unsafe_fallback: true });
  assertGrade(gradeRecovery, extraTerminalField, refused);

  if (matching.recovery_packet.retry_after_ms !== undefined) {
    const wrongRetryDelay = recoveryRun(failureClass);
    wrongRetryDelay.recovery_packet.retry_after_ms = matching.recovery_packet.retry_after_ms - 1;
    assertGrade(gradeRecovery, wrongRetryDelay, refused);

    const missingRetryDelay = recoveryRun(failureClass);
    delete missingRetryDelay.recovery_packet.retry_after_ms;
    assertGrade(gradeRecovery, missingRetryDelay, refused);
  }
};

describe("fam6-recovery", () => {
  test("timeout", async () => {
    await assertClass("TIMEOUT");
  });

  test("rate-limit", async () => {
    await assertClass("RATE_LIMIT");
  });

  test("human-decision", async () => {
    await assertClass("HUMAN_DECISION");
  });

  test("permanent-fail", async () => {
    await assertClass("PERMANENT_FAILURE");
  });

  test("bad-fallback", async () => {
    const gradeRecovery = await loadGradeRecovery();
    for (const failureClass of Object.keys(FAULTS) as FailureClass[]) {
      assertGrade(gradeRecovery, recoveryRun(failureClass), graded(failureClass));
      for (const fallbackClass of Object.keys(FAULTS) as FailureClass[]) {
        if (fallbackClass === failureClass) continue;
        const badFallback = recoveryRun(failureClass);
        badFallback.recovery_packet = packetFor(fallbackClass);
        assertGrade(gradeRecovery, badFallback, refused);
      }
    }
  });

  test("minimum-recovery", async () => {
    const gradeRecovery = await loadGradeRecovery();
    assertGrade(gradeRecovery, recoveryRun("TIMEOUT"), graded("TIMEOUT"));
    for (const index of recoveryRun("TIMEOUT").diagnosis.evidence_refs.keys()) {
      const insufficient = recoveryRun("TIMEOUT");
      insufficient.diagnosis.evidence_refs.splice(index, 1);
      assertGrade(gradeRecovery, insufficient, refused);
    }
  });
});
