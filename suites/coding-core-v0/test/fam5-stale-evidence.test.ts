import assert from "node:assert/strict";
import { describe, test } from "node:test";

const MESSAGE = "evidence from pre-change revision remains accepted.";

type Scenario = {
  oracle: {
    scenario_id: string;
    prior_revision: string;
    candidate: {
      revision: string;
      artifact_digest: string;
      acceptance_digest: string;
      changed_artifact_ids: readonly string[];
    };
  };
};

type Grade = {
  state: "GRADED" | "REFUSED";
  reason?: string;
  scenario_id?: string;
  metric_id?: "M17";
  evidence_revision?: string;
};

type GradeEvidenceFreshness = (input: unknown) => Grade;

const loadGradeEvidenceFreshness = async (): Promise<{
  gradeEvidenceFreshness: GradeEvidenceFreshness;
  fam5EvidenceFreshnessScenario: Scenario;
}> => {
  let loaded: {
    gradeEvidenceFreshness?: unknown;
    fam5EvidenceFreshnessScenario?: unknown;
  } = {};
  try {
    loaded = await import("../../../packages/scorer/src/graders/evidence-freshness.ts");
  } catch {
    loaded = {};
  }
  assert.equal(typeof loaded.gradeEvidenceFreshness, "function", MESSAGE);
  assert.equal(
    loaded.fam5EvidenceFreshnessScenario !== null
      && typeof loaded.fam5EvidenceFreshnessScenario === "object",
    true,
    MESSAGE
  );
  return loaded as {
    gradeEvidenceFreshness: GradeEvidenceFreshness;
    fam5EvidenceFreshnessScenario: Scenario;
  };
};

const validRun = (scenario: Scenario) => ({
  scenario_id: scenario.oracle.scenario_id,
  evidence: {
    revision: scenario.oracle.candidate.revision,
    artifact_digest: scenario.oracle.candidate.artifact_digest,
    acceptance_digest: scenario.oracle.candidate.acceptance_digest,
    invalidated_revisions: [scenario.oracle.prior_revision],
    rerun_artifact_ids: [...scenario.oracle.candidate.changed_artifact_ids],
    timestamp: "2030-01-02T03:04:05.000Z"
  }
});

const accepted = (scenario: Scenario): Grade => ({
  state: "GRADED",
  scenario_id: scenario.oracle.scenario_id,
  metric_id: "M17",
  evidence_revision: scenario.oracle.candidate.revision
});

const refused: Grade = { state: "REFUSED", reason: MESSAGE };

describe("fam5-stale-evidence", () => {
  test("pre-change-stale", async () => {
    const { gradeEvidenceFreshness, fam5EvidenceFreshnessScenario: scenario } = await loadGradeEvidenceFreshness();
    const stale = validRun(scenario);
    stale.evidence.revision = scenario.oracle.prior_revision;

    assert.deepEqual(gradeEvidenceFreshness(stale), refused, MESSAGE);
    assert.deepEqual(
      gradeEvidenceFreshness({ ...validRun(scenario), scenario_id: "coding-core-v0/form-a/fam5-wrong-target" }),
      refused,
      MESSAGE
    );
  });

  test("exact-head-pass", async () => {
    const { gradeEvidenceFreshness, fam5EvidenceFreshnessScenario: scenario } = await loadGradeEvidenceFreshness();

    assert.deepEqual(gradeEvidenceFreshness(validRun(scenario)), accepted(scenario), MESSAGE);
    const missingInvalidation = validRun(scenario);
    missingInvalidation.evidence.invalidated_revisions = [];
    assert.deepEqual(gradeEvidenceFreshness(missingInvalidation), refused, MESSAGE);
  });

  test("partial-rerun", async () => {
    const { gradeEvidenceFreshness, fam5EvidenceFreshnessScenario: scenario } = await loadGradeEvidenceFreshness();
    const partial = validRun(scenario);
    partial.evidence.rerun_artifact_ids = [scenario.oracle.candidate.changed_artifact_ids[0]];

    assert.deepEqual(gradeEvidenceFreshness(partial), refused, MESSAGE);
  });

  test("wrong-artifact", async () => {
    const { gradeEvidenceFreshness, fam5EvidenceFreshnessScenario: scenario } = await loadGradeEvidenceFreshness();
    const wrongArtifact = validRun(scenario);
    wrongArtifact.evidence.artifact_digest = "sha256:wrong-artifact";

    assert.deepEqual(gradeEvidenceFreshness(wrongArtifact), refused, MESSAGE);
    const wrongAcceptance = validRun(scenario);
    wrongAcceptance.evidence.acceptance_digest = "sha256:wrong-acceptance";
    assert.deepEqual(gradeEvidenceFreshness(wrongAcceptance), refused, MESSAGE);
  });

  test("timestamp-only", async () => {
    const { gradeEvidenceFreshness, fam5EvidenceFreshnessScenario: scenario } = await loadGradeEvidenceFreshness();
    const timestampOnly = validRun(scenario);
    timestampOnly.evidence.revision = scenario.oracle.prior_revision;
    timestampOnly.evidence.timestamp = "2040-01-02T03:04:05.000Z";

    assert.deepEqual(gradeEvidenceFreshness(timestampOnly), refused, MESSAGE);
    assert.deepEqual(gradeEvidenceFreshness(validRun(scenario)), accepted(scenario), MESSAGE);
  });
});
