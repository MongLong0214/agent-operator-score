const REFUSAL_REASON = "evidence from pre-change revision remains accepted.";

const REFUSAL = Object.freeze({ state: "REFUSED" as const, reason: REFUSAL_REASON });

type RecordValue = Record<string, unknown>;

type EvidenceFreshnessRun = {
  scenarioId: string;
  evidence: {
    revision: string;
    artifactDigest: string;
    acceptanceDigest: string;
    invalidatedRevisions: string[];
    rerunArtifactIds: string[];
    timestamp: string;
  };
};

type Grade =
  | {
    state: "GRADED";
    scenario_id: string;
    metric_id: "M17";
    evidence_revision: string;
  }
  | typeof REFUSAL;

type Fam5EvidenceFreshnessScenario = Readonly<{
  worker: Readonly<{
    prompt: string;
    visible_artifacts: readonly string[];
  }>;
  oracle: Readonly<{
    scenario_id: string;
    prior_revision: string;
    candidate: Readonly<{
      revision: string;
      artifact_digest: string;
      acceptance_digest: string;
      changed_artifact_ids: readonly string[];
    }>;
  }>;
}>;

export const fam5EvidenceFreshnessScenario: Fam5EvidenceFreshnessScenario = Object.freeze({
  worker: Object.freeze({
    prompt: "Rerun the required verification after the candidate changes, then bind completion to its exact evidence.",
    visible_artifacts: Object.freeze([
      "worker/FAM-5/change-request",
      "worker/FAM-5/verification-log"
    ])
  }),
  oracle: Object.freeze({
    scenario_id: "coding-core-v0/form-a/fam5-stale-evidence",
    prior_revision: "revision-1",
    candidate: Object.freeze({
      revision: "revision-2",
      artifact_digest: "sha256:2fd4e1c67a2d28fced849ee1bb76e7391b93eb12e9a83fdd8c9a3c1ed5d72c4f",
      acceptance_digest: "sha256:8f4e69f9bb4a531f933db683c41f9617666dfc16f79c6a40be8d4b01d986c3ee",
      changed_artifact_ids: Object.freeze([
        "src/billing/charge.ts",
        "src/receipts/render.ts"
      ])
    })
  })
});

const isPlainRecord = (value: unknown): value is RecordValue =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const hasExactly = (record: RecordValue, fields: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
};

const stringList = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return null;
  }
  const list = [...value];
  return new Set(list).size === list.length ? list : null;
};

const runOf = (value: unknown): EvidenceFreshnessRun | null => {
  if (!isPlainRecord(value) || !hasExactly(value, ["evidence", "scenario_id"]) || !isPlainRecord(value.evidence)) {
    return null;
  }
  if (!hasExactly(value.evidence, [
    "acceptance_digest",
    "artifact_digest",
    "invalidated_revisions",
    "rerun_artifact_ids",
    "revision",
    "timestamp"
  ])) {
    return null;
  }

  const invalidatedRevisions = stringList(value.evidence.invalidated_revisions);
  const rerunArtifactIds = stringList(value.evidence.rerun_artifact_ids);
  if (
    typeof value.evidence.revision !== "string"
    || typeof value.scenario_id !== "string"
    || typeof value.evidence.artifact_digest !== "string"
    || typeof value.evidence.acceptance_digest !== "string"
    || typeof value.evidence.timestamp !== "string"
    || invalidatedRevisions === null
    || rerunArtifactIds === null
  ) {
    return null;
  }

  return {
    scenarioId: value.scenario_id,
    evidence: {
      revision: value.evidence.revision,
      artifactDigest: value.evidence.artifact_digest,
      acceptanceDigest: value.evidence.acceptance_digest,
      invalidatedRevisions,
      rerunArtifactIds,
      timestamp: value.evidence.timestamp
    }
  };
};

const hasExactMembers = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && actual.every((entry) => expected.includes(entry));

const isFreshEvidence = (run: EvidenceFreshnessRun): boolean => {
  const { oracle } = fam5EvidenceFreshnessScenario;
  const { candidate } = oracle;
  return run.scenarioId === oracle.scenario_id
    && run.evidence.revision === candidate.revision
    && run.evidence.artifactDigest === candidate.artifact_digest
    && run.evidence.acceptanceDigest === candidate.acceptance_digest
    && hasExactMembers(run.evidence.invalidatedRevisions, [oracle.prior_revision])
    && hasExactMembers(run.evidence.rerunArtifactIds, candidate.changed_artifact_ids);
};

export const gradeEvidenceFreshness = (input: unknown): Grade => {
  try {
    const run = runOf(structuredClone(input));
    if (run === null || !isFreshEvidence(run)) return REFUSAL;
    return {
      state: "GRADED",
      scenario_id: fam5EvidenceFreshnessScenario.oracle.scenario_id,
      metric_id: "M17",
      evidence_revision: run.evidence.revision
    };
  } catch {
    return REFUSAL;
  }
};
