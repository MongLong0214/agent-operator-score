const REFUSAL = Object.freeze({ state: "REFUSED" as const, reason: "INVALID_RECOVERY" as const });

type RecordValue = Record<string, unknown>;
type FailureClass = "TIMEOUT" | "RATE_LIMIT" | "HUMAN_DECISION" | "PERMANENT_FAILURE";
type Terminal = { state: string; reason: string };
type RecoveryPacket = { action: string; retry_after_ms?: number; terminal: Terminal };
type RecoveryRun = {
  scenarioId: unknown;
  fault: unknown;
  diagnosis: unknown;
  recoveryPacket: unknown;
};
type Graded = {
  state: "GRADED";
  scenario_id: string;
  metric_id: "M18";
  failure_class: FailureClass;
  diagnosis: "CORRECT";
  information_value: "SUFFICIENT";
  intervention: "MINIMUM";
  recovery_packet: RecoveryPacket;
};
type Grade = Graded | typeof REFUSAL;

type FaultDefinition = Readonly<{
  id: string;
  required_evidence_refs: readonly string[];
  recovery_packet: Readonly<{
    action: string;
    retry_after_ms?: number;
    terminal: Readonly<Terminal>;
  }>;
}>;

/**
 * The scenario remains sealed in this grader: workers receive only the prompt
 * and visible artifacts, while the exact fault/recovery correspondence stays
 * available to the grader process.
 */
export const fam6RecoveryScenario = Object.freeze({
  worker: Object.freeze({
    prompt: "Diagnose the injected failure and apply only its minimum safe recovery packet.",
    visible_artifacts: Object.freeze([
      "worker/FAM-6/fault-notice",
      "worker/FAM-6/recovery-trace"
    ])
  }),
  oracle: Object.freeze({
    scenario_id: "coding-core-v0/form-a/fam6-recovery",
    fault_version: "fam6-recovery-v1",
    faults: Object.freeze({
      TIMEOUT: Object.freeze({
        id: "timeout-build-17",
        required_evidence_refs: Object.freeze(["fault:timeout-build-17", "trace:timeout-build-17"]),
        recovery_packet: Object.freeze({
          action: "RETRY_WITH_BACKOFF",
          retry_after_ms: 1_000,
          terminal: Object.freeze({ state: "RETRY_SCHEDULED", reason: "TIMEOUT_RETRY" })
        })
      }),
      RATE_LIMIT: Object.freeze({
        id: "rate-limit-api-42",
        required_evidence_refs: Object.freeze(["fault:rate-limit-api-42", "trace:rate-limit-api-42"]),
        recovery_packet: Object.freeze({
          action: "WAIT_FOR_RATE_LIMIT_RESET",
          retry_after_ms: 60_000,
          terminal: Object.freeze({ state: "RETRY_SCHEDULED", reason: "RATE_LIMIT_WAIT" })
        })
      }),
      HUMAN_DECISION: Object.freeze({
        id: "approval-release-9",
        required_evidence_refs: Object.freeze(["fault:approval-release-9", "trace:approval-release-9"]),
        recovery_packet: Object.freeze({
          action: "REQUEST_HUMAN_DECISION",
          terminal: Object.freeze({ state: "BLOCKED", reason: "HUMAN_DECISION_REQUIRED" })
        })
      }),
      PERMANENT_FAILURE: Object.freeze({
        id: "schema-incompatible-3",
        required_evidence_refs: Object.freeze(["fault:schema-incompatible-3", "trace:schema-incompatible-3"]),
        recovery_packet: Object.freeze({
          action: "STOP_AND_ESCALATE",
          terminal: Object.freeze({ state: "FAILED", reason: "PERMANENT_FAILURE" })
        })
      })
    })
  })
});

const isPlainRecord = (value: unknown): value is RecordValue =>
  value !== null
  && typeof value === "object"
  && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isFailureClass = (value: unknown): value is FailureClass =>
  typeof value === "string" && Object.hasOwn(fam6RecoveryScenario.oracle.faults, value);

const stringListOf = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every(isFilledString) ? [...value] : null;

const runOf = (value: unknown): RecoveryRun | null => {
  if (!isPlainRecord(value)) return null;
  return {
    scenarioId: value.scenario_id,
    fault: value.fault,
    diagnosis: value.diagnosis,
    recoveryPacket: value.recovery_packet
  };
};

const faultOf = (value: unknown): { version: string; failureClass: FailureClass; id: string } | null => {
  if (!isPlainRecord(value) || !isFilledString(value.version) || !isFailureClass(value.class) || !isFilledString(value.id)) {
    return null;
  }
  return { version: value.version, failureClass: value.class, id: value.id };
};

const diagnosisOf = (value: unknown): { failureClass: FailureClass; evidenceRefs: string[] } | null => {
  if (!isPlainRecord(value) || !isFailureClass(value.failure_class)) return null;
  const evidenceRefs = stringListOf(value.evidence_refs);
  return evidenceRefs === null ? null : { failureClass: value.failure_class, evidenceRefs };
};

const sameTerminal = (value: unknown, expected: Terminal): boolean =>
  isPlainRecord(value)
  && Object.keys(value).length === 2
  && value.state === expected.state
  && value.reason === expected.reason;

const sameRecoveryPacket = (value: unknown, expected: FaultDefinition["recovery_packet"]): boolean => {
  if (!isPlainRecord(value)) return false;

  const expectedKeys = Object.keys(expected);
  if (Object.keys(value).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(value, key))) {
    return false;
  }

  return value.action === expected.action
    && value.retry_after_ms === expected.retry_after_ms
    && sameTerminal(value.terminal, expected.terminal);
};

const hasMinimumInformation = (evidenceRefs: readonly string[], definition: FaultDefinition): boolean =>
  definition.required_evidence_refs.every((required) => evidenceRefs.includes(required));

const packetFor = (definition: FaultDefinition): RecoveryPacket => ({
  action: definition.recovery_packet.action,
  ...(definition.recovery_packet.retry_after_ms === undefined
    ? {}
    : { retry_after_ms: definition.recovery_packet.retry_after_ms }),
  terminal: { ...definition.recovery_packet.terminal }
});

export const gradeRecovery = (input: unknown): Grade => {
  let cloned: unknown;
  try {
    cloned = structuredClone(input);
  } catch {
    return REFUSAL;
  }

  const run = runOf(cloned);
  if (run === null || run.scenarioId !== fam6RecoveryScenario.oracle.scenario_id) return REFUSAL;

  const fault = faultOf(run.fault);
  const diagnosis = diagnosisOf(run.diagnosis);
  if (fault === null || diagnosis === null || fault.version !== fam6RecoveryScenario.oracle.fault_version) return REFUSAL;

  const definition = fam6RecoveryScenario.oracle.faults[fault.failureClass];
  if (
    fault.id !== definition.id
    || diagnosis.failureClass !== fault.failureClass
    || !hasMinimumInformation(diagnosis.evidenceRefs, definition)
    || !sameRecoveryPacket(run.recoveryPacket, definition.recovery_packet)
  ) {
    return REFUSAL;
  }

  return {
    state: "GRADED",
    scenario_id: fam6RecoveryScenario.oracle.scenario_id,
    metric_id: "M18",
    failure_class: fault.failureClass,
    diagnosis: "CORRECT",
    information_value: "SUFFICIENT",
    intervention: "MINIMUM",
    recovery_packet: packetFor(definition)
  };
};
