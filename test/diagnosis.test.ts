import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const BLOCKING = "selector output is not rendered with evidence/cost/application/retest contract.";
const modulePath = "../src/reporter/diagnosis.ts";

type RenderDiagnosis = (input: unknown) => string;
type RecordValue = Record<string, unknown>;

const golden = JSON.parse(readFileSync(resolve(here, "diagnosis.golden.json"), "utf8")) as Record<string, string>;

const loadRenderer = async (): Promise<RenderDiagnosis> => {
  let loaded: RecordValue;
  try {
    loaded = (await import(modulePath)) as RecordValue;
  } catch {
    throw new Error(BLOCKING);
  }
  if (typeof loaded.renderDiagnosis !== "function") throw new Error(BLOCKING);
  return loaded.renderDiagnosis as RenderDiagnosis;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    const record = value as RecordValue;
    return Object.fromEntries(Object.keys(record).reverse().map((key) => [key, reverseKeys(record[key])]));
  }
  return value;
};

const expectRefusal = (renderDiagnosis: RenderDiagnosis, input: unknown): void => {
  assert.throws(() => renderDiagnosis(input), { message: BLOCKING }, BLOCKING);
};

const ordinary = (): RecordValue => ({
  selection: {
    outcome: "PRIMARY_CONSTRAINT",
    reason: "DETERMINISTIC_SELECTION",
    factor_id: "F4",
    metric_id: "M12",
    treatment_id: "T-M12",
    lever_count: 1,
    trace: [
      "safety S0",
      "metric M12 eligible gap 1/2 weight 2",
      "factor F4 gap 1/2",
      "band F4",
      "factor F4 selected",
      "metric M12 selected",
      "treatment T-M12 cost 2/1 permission 0",
      "treatment T-M12 selected"
    ]
  },
  evidence: {
    run_id: "run-ordinary",
    metric_id: "M12",
    opportunity_id: "opp-ordinary",
    event_id: "event-ordinary",
    artifact_id: "artifact-ordinary",
    artifact_digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    artifact_path: "/evidence/run-ordinary.json",
    excerpt: "conditional performance in declared environment"
  },
  treatment: {
    treatment_id: "T-M12",
    metric_ids: ["M12"],
    label: "durable checkpoint and resume packet",
    implementation_protocol: "persist goal, progress, blockers and evidence so a new session can resume from the last checkpoint",
    cost: {
      time: { n: 1, d: 1 },
      tokens: { n: 1, d: 1 },
      maintenance: { n: 0, d: 1 }
    },
    permission_delta: [],
    transferability: "environment",
    retest_criteria: "target metric improved; M15-M17 non-degradation; M19 safety held; cost and intervention in bounds; not explained by memorizing the same answer",
    safety_only_remediation: false
  },
  expected_uplift_class: "recovery"
});

const safetyRemediation = (): RecordValue => ({
  selection: {
    outcome: "SAFETY_REMEDIATION",
    reason: "SAFETY_FIRST",
    factor_id: null,
    metric_id: "M19",
    treatment_id: "T-M19",
    lever_count: 1,
    trace: ["safety S2", "safety_remediation T-M19"]
  },
  evidence: {
    run_id: "run-safety",
    metric_id: "M19",
    opportunity_id: "opp-safety",
    event_id: "event-safety",
    artifact_id: "artifact-safety",
    artifact_digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    artifact_path: "/evidence/run-safety.json",
    excerpt: "permission violation was observed"
  },
  treatment: {
    treatment_id: "T-M19",
    metric_ids: ["M19"],
    label: "least-privilege remediation; required before re-evaluation",
    implementation_protocol: "revoke excess permissions, external actions and secret surfaces; do not emit an ordinary quality or process lever",
    cost: {
      time: { n: 1, d: 1 },
      tokens: { n: 1, d: 1 },
      maintenance: { n: 0, d: 1 }
    },
    permission_delta: [],
    transferability: "environment",
    retest_criteria: "required before re-evaluation; target metric improved; M15-M17 non-degradation; M19 safety held; cost and intervention in bounds; not explained by memorizing the same answer",
    safety_only_remediation: true
  },
  expected_uplift_class: "safety"
});

const manualReview = (): RecordValue => ({
  selection: {
    outcome: "MANUAL_REVIEW_REQUIRED",
    reason: "AMBIGUOUS_TREATMENT",
    factor_id: "F4",
    metric_id: "M12",
    treatment_id: null,
    lever_count: 0,
    trace: [
      "safety S0",
      "metric M12 eligible gap 1/2 weight 2",
      "factor F4 gap 1/2",
      "band F4",
      "factor F4 selected",
      "metric M12 selected",
      "treatment ambiguous T-M12,T-M12-ALT"
    ]
  }
});

const insufficientEvidence = (): RecordValue => ({
  selection: {
    outcome: "INSUFFICIENT_EVIDENCE",
    reason: "NO_ELIGIBLE_CANDIDATE",
    factor_id: null,
    metric_id: null,
    treatment_id: null,
    lever_count: 0,
    trace: ["safety S0", "no eligible candidate"]
  }
});

describe("diagnosis", () => {
  test("ordinary", async () => {
    const renderDiagnosis = await loadRenderer();
    const input = ordinary();
    assert.equal(renderDiagnosis(input), golden.ordinary, BLOCKING);

    const reordered = reverseKeys(input);
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(input), BLOCKING);
    assert.equal(renderDiagnosis(reordered), golden.ordinary, BLOCKING);

    const missingSelectionFields = ["outcome", "reason", "factor_id", "metric_id", "treatment_id", "lever_count", "trace"];
    for (const field of missingSelectionFields) {
      const invalid = ordinary();
      delete (invalid.selection as RecordValue)[field];
      expectRefusal(renderDiagnosis, invalid);
    }
    const wrongPrimaryReason = ordinary();
    (wrongPrimaryReason.selection as RecordValue).reason = "SAFETY_FIRST";
    expectRefusal(renderDiagnosis, wrongPrimaryReason);
    const noTrace = ordinary();
    (noTrace.selection as RecordValue).trace = [];
    expectRefusal(renderDiagnosis, noTrace);
    const extraSelectionField = ordinary();
    (extraSelectionField.selection as RecordValue).unexpected = true;
    expectRefusal(renderDiagnosis, extraSelectionField);

    const missingFields = ["treatment_id", "metric_ids", "label", "implementation_protocol", "permission_delta", "transferability", "retest_criteria", "safety_only_remediation"];
    for (const field of missingFields) {
      const invalid = ordinary();
      delete (invalid.treatment as RecordValue)[field];
      expectRefusal(renderDiagnosis, invalid);
    }
    for (const field of ["time", "tokens", "maintenance"]) {
      const invalid = ordinary();
      delete ((invalid.treatment as RecordValue).cost as RecordValue)[field];
      expectRefusal(renderDiagnosis, invalid);
    }
    for (const component of ["time", "tokens", "maintenance"]) {
      for (const field of ["n", "d"]) {
        const invalid = ordinary();
        delete (((((invalid.treatment as RecordValue).cost as RecordValue)[component]) as RecordValue))[field];
        expectRefusal(renderDiagnosis, invalid);
      }
    }

    const wrongMetric = ordinary();
    (wrongMetric.treatment as RecordValue).metric_ids = ["M13"];
    expectRefusal(renderDiagnosis, wrongMetric);
    const matchingTreatment = ordinary();
    assert.equal(renderDiagnosis(matchingTreatment), golden.ordinary, BLOCKING);
    const mismatchedTreatment = clone(matchingTreatment);
    (mismatchedTreatment.treatment as RecordValue).treatment_id = "T-OTHER";
    expectRefusal(renderDiagnosis, mismatchedTreatment);
    const unsafeOrdinary = ordinary();
    (unsafeOrdinary.treatment as RecordValue).safety_only_remediation = true;
    expectRefusal(renderDiagnosis, unsafeOrdinary);
    const wrongUplift = ordinary();
    wrongUplift.expected_uplift_class = "unsupported";
    expectRefusal(renderDiagnosis, wrongUplift);
    const wrongTransferability = ordinary();
    (wrongTransferability.treatment as RecordValue).transferability = "unsupported";
    expectRefusal(renderDiagnosis, wrongTransferability);
    const wrongPermissionShape = ordinary();
    (wrongPermissionShape.treatment as RecordValue).permission_delta = [1];
    expectRefusal(renderDiagnosis, wrongPermissionShape);
    const extraTreatmentField = ordinary();
    (extraTreatmentField.treatment as RecordValue).unexpected = true;
    expectRefusal(renderDiagnosis, extraTreatmentField);
    const extraTopLevelField = ordinary();
    extraTopLevelField.unexpected = true;
    expectRefusal(renderDiagnosis, extraTopLevelField);
  });

  test("safety-remediation", async () => {
    const renderDiagnosis = await loadRenderer();
    const input = safetyRemediation();
    assert.equal(renderDiagnosis(input), golden["safety-remediation"], BLOCKING);

    const ordinaryOutcome = safetyRemediation();
    const selection = ordinaryOutcome.selection as RecordValue;
    selection.outcome = "PRIMARY_CONSTRAINT";
    selection.reason = "DETERMINISTIC_SELECTION";
    selection.factor_id = "F4";
    selection.metric_id = "M12";
    selection.treatment_id = "T-M12";
    selection.trace = (ordinary().selection as RecordValue).trace;
    ordinaryOutcome.evidence = ordinary().evidence;
    ordinaryOutcome.treatment = ordinary().treatment;
    ordinaryOutcome.expected_uplift_class = "recovery";
    assert.equal(renderDiagnosis(ordinaryOutcome), golden.ordinary, BLOCKING);

    const missingSafetyFlag = safetyRemediation();
    (missingSafetyFlag.treatment as RecordValue).safety_only_remediation = false;
    expectRefusal(renderDiagnosis, missingSafetyFlag);
    const wrongSafetyUplift = safetyRemediation();
    wrongSafetyUplift.expected_uplift_class = "recovery";
    expectRefusal(renderDiagnosis, wrongSafetyUplift);
    const ordinaryUplift = ordinary();
    assert.equal(renderDiagnosis(ordinaryUplift), golden.ordinary, BLOCKING);
    const ordinarySafetyUplift = clone(ordinaryUplift);
    ordinarySafetyUplift.expected_uplift_class = "safety";
    expectRefusal(renderDiagnosis, ordinarySafetyUplift);
    const ordinaryAsSafety = ordinary();
    (ordinaryAsSafety.selection as RecordValue).outcome = "SAFETY_REMEDIATION";
    (ordinaryAsSafety.selection as RecordValue).reason = "SAFETY_FIRST";
    (ordinaryAsSafety.selection as RecordValue).factor_id = null;
    expectRefusal(renderDiagnosis, ordinaryAsSafety);
  });

  test("manual-review", async () => {
    const renderDiagnosis = await loadRenderer();
    assert.equal(renderDiagnosis(manualReview()), golden["manual-review"], BLOCKING);

    const invalidManual = manualReview();
    (invalidManual.selection as RecordValue).lever_count = 1;
    expectRefusal(renderDiagnosis, invalidManual);
    const invalidTreatment = manualReview();
    (invalidTreatment.selection as RecordValue).treatment_id = "T-M12";
    expectRefusal(renderDiagnosis, invalidTreatment);
    const acceptedManual = manualReview();
    assert.equal(renderDiagnosis(acceptedManual), golden["manual-review"], BLOCKING);
    const manualWithActionableFields = clone(acceptedManual);
    manualWithActionableFields.treatment = ordinary().treatment;
    expectRefusal(renderDiagnosis, manualWithActionableFields);
  });

  test("evidence-missing", async () => {
    const renderDiagnosis = await loadRenderer();
    assert.equal(renderDiagnosis(ordinary()), golden.ordinary, BLOCKING);

    const withoutExcerpt = ordinary();
    (withoutExcerpt.evidence as RecordValue).excerpt = null;
    assert.equal(renderDiagnosis(withoutExcerpt), golden["ordinary-no-excerpt"], BLOCKING);

    const evidenceFields = ["run_id", "metric_id", "opportunity_id", "event_id", "artifact_id", "artifact_digest", "artifact_path", "excerpt"];
    for (const field of evidenceFields) {
      const missing = ordinary();
      delete (missing.evidence as RecordValue)[field];
      expectRefusal(renderDiagnosis, missing);
    }
    const wrongEvidenceMetric = ordinary();
    (wrongEvidenceMetric.evidence as RecordValue).metric_id = "M13";
    expectRefusal(renderDiagnosis, wrongEvidenceMetric);
    const invalidDigest = ordinary();
    (invalidDigest.evidence as RecordValue).artifact_digest = "not-a-digest";
    expectRefusal(renderDiagnosis, invalidDigest);
    const extraEvidenceField = ordinary();
    (extraEvidenceField.evidence as RecordValue).unexpected = true;
    expectRefusal(renderDiagnosis, extraEvidenceField);

    const acceptedInsufficientEvidence = insufficientEvidence();
    assert.equal(
      renderDiagnosis(acceptedInsufficientEvidence),
      "# Diagnosis\noutcome: \"INSUFFICIENT_EVIDENCE\"\nreason: \"NO_ELIGIBLE_CANDIDATE\"\nfactor_id: null\nmetric_id: null\ntreatment_id: null\nlever_count: 0\n## decision trace\n1. \"safety S0\"\n2. \"no eligible candidate\"\n## insufficient evidence\nevidence_reason: \"NO_ELIGIBLE_CANDIDATE\"\nform_b: \"additional authoritative evidence required before retest\"",
      BLOCKING
    );
    const insufficientEvidenceWithActionableFields = clone(acceptedInsufficientEvidence);
    insufficientEvidenceWithActionableFields.evidence = ordinary().evidence;
    expectRefusal(renderDiagnosis, insufficientEvidenceWithActionableFields);
  });

  test("prohibited-copy", async () => {
    const renderDiagnosis = await loadRenderer();
    const allowed = ordinary();
    assert.equal(renderDiagnosis(allowed), golden.ordinary, BLOCKING);
    assert.ok(renderDiagnosis(allowed).includes("conditional performance in declared environment"), BLOCKING);

    for (const copy of [
      "percentile",
      "certification",
      "hiring signal",
      "global rank",
      "industry standard",
      "personal ability",
      "AOS-G",
      "exact growth score"
    ]) {
      const prohibited = clone(allowed);
      (prohibited.evidence as RecordValue).excerpt = copy;
      expectRefusal(renderDiagnosis, prohibited);
    }
  });
});
