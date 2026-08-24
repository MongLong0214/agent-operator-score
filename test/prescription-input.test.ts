import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(here, "../specs/prescription-inputs.v0.json");
const modulePath = "../src/_deferred/prescription-input.ts";

// Independent oracle for SSOT §8.2 / PRD-E0D requirement 1. The seven required
// inputs, in the order the PRD names them. Each must carry source events, a total
// formula, a closed range, an explicit missing rule, a tie-break, one fixture,
// and the contract version. Nothing here is read from the frozen document.
const INPUT_IDS = [
  "confidence",
  "normalized_gap",
  "opportunity_count",
  "treatment_cost",
  "permission_delta",
  "expected_uplift",
  "transferability"
] as const;

const REQUIRED_FIELDS = [
  "input_id",
  "source_events",
  "formula",
  "range",
  "missing_rule",
  "tie_break",
  "fixture",
  "version"
] as const;

const CONTRACT_ID = "prescription-inputs.v0";
const CONTRACT_VERSION = "prescription-input-contract-v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#8.2";

const ratio = (n: number, d: number) => ({ n, d });

const CONFIDENCE_TABLE: Record<string, { n: number; d: number }> = {
  hidden_oracle: ratio(1, 1),
  signed_or_hashed_trace: ratio(9, 10),
  declared_adapter_event: ratio(4, 5),
  immutable_artifact: ratio(7, 10),
  operator_claim: ratio(0, 1)
};

const CONFIDENCE_THRESHOLD = ratio(7, 10);
const THREE_POINT_BAND = ratio(3, 100);

const UPLIFT_OF: Record<string, string> = {};
for (let index = 1; index <= 20; index += 1) {
  const id = `M${String(index).padStart(2, "0")}`;
  UPLIFT_OF[id] = id === "M19" ? "safety" : id === "M18" ? "recovery" : "quality";
}

const UPLIFT_CLASSES = ["quality", "recovery", "safety"] as const;
const TRANSFERABILITY_CLASSES = ["operator", "environment", "combined"] as const;

const SOURCE_EVENTS: Record<(typeof INPUT_IDS)[number], string[]> = {
  confidence: Object.keys(CONFIDENCE_TABLE),
  normalized_gap: ["factor.score"],
  opportunity_count: ["opportunity.observed"],
  treatment_cost: ["treatment.cost.time", "treatment.cost.tokens", "treatment.cost.maintenance"],
  permission_delta: ["treatment.permission.granted"],
  expected_uplift: ["metric.id"],
  transferability: ["treatment.operator_changed", "treatment.environment_changed"]
};

type ValidatePrescriptionInputContract = (input: unknown) => {
  ok: boolean;
  errors: string[];
  inputs: Array<Record<string, unknown>>;
};

const loadValidator = async (): Promise<ValidatePrescriptionInputContract> => {
  const loaded = await import(modulePath);
  return loaded.validatePrescriptionInputContract;
};

const frozen = () => JSON.parse(readFileSync(contractPath, "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const has = (result: { errors: string[] }, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));
const inputOf = (doc: any, id: string) => doc.inputs.find((entry: any) => entry.input_id === id);

describe("prescription-input", () => {
  test("one-case-per-input", async () => {
    const validatePrescriptionInputContract = await loadValidator();
    const result = validatePrescriptionInputContract(frozen());

    assert.deepEqual(result.errors, [], "frozen prescription input contract must validate with zero errors");
    assert.equal(result.ok, true);
    assert.equal(result.inputs.length, INPUT_IDS.length);
    assert.deepEqual(
      result.inputs.map((entry) => entry.input_id),
      [...INPUT_IDS],
      "contract must declare exactly the seven required inputs in PRD order"
    );

    const doc = frozen();
    assert.equal(doc.contract_id, CONTRACT_ID);
    assert.equal(doc.contract_version, CONTRACT_VERSION);
    assert.equal(doc.source_authority, SOURCE_AUTHORITY);

    for (const inputId of INPUT_IDS) {
      const entry = inputOf(doc, inputId);
      assert.ok(entry, `${inputId} is absent`);
      for (const field of REQUIRED_FIELDS) {
        assert.ok(Object.hasOwn(entry, field), `${inputId} is missing ${field}`);
      }
      assert.deepEqual(
        Object.keys(entry).sort(),
        [...REQUIRED_FIELDS].sort(),
        `${inputId} carries a dead or undeclared field`
      );
      assert.equal(entry.version, CONTRACT_VERSION, inputId);
      assert.equal(typeof entry.formula, "string");
      assert.notEqual(entry.formula.trim(), "", `${inputId} formula is empty`);
      assert.notEqual(String(entry.missing_rule).trim(), "", `${inputId} missing rule is empty`);
      assert.ok(entry.fixture && typeof entry.fixture === "object" && !Array.isArray(entry.fixture));
      assert.equal(entry.fixture.fixture_id, `${inputId}-v0`);
      assert.ok(entry.fixture.inputs && typeof entry.fixture.inputs === "object");
      assert.ok(entry.fixture.expected && typeof entry.fixture.expected === "object");
    }

    const extra = frozen();
    extra.inputs.push({
      ...clone(inputOf(extra, "confidence")),
      input_id: "learned_uplift",
      fixture: { ...clone(inputOf(extra, "confidence").fixture), fixture_id: "learned_uplift-v0" }
    });
    const extraResult = validatePrescriptionInputContract(extra);
    assert.equal(extraResult.ok, false);
    assert.ok(has(extraResult, "UNKNOWN_INPUT_ID learned_uplift"), extraResult.errors.join("; "));
    assert.ok(has(extraResult, "INPUT_COUNT_NOT_7"), extraResult.errors.join("; "));

    const dropped = frozen();
    dropped.inputs = dropped.inputs.filter((entry: any) => entry.input_id !== "transferability");
    const droppedResult = validatePrescriptionInputContract(dropped);
    assert.equal(droppedResult.ok, false);
    assert.ok(has(droppedResult, "INPUT_ID_GAP transferability"), droppedResult.errors.join("; "));

    const doubled = frozen();
    doubled.inputs[1] = {
      ...clone(inputOf(doubled, "confidence")),
      fixture: { ...clone(inputOf(doubled, "confidence").fixture), fixture_id: "confidence-v0-dup" }
    };
    const doubledResult = validatePrescriptionInputContract(doubled);
    assert.equal(doubledResult.ok, false);
    assert.ok(has(doubledResult, "DUPLICATE_INPUT_ID confidence"), doubledResult.errors.join("; "));
    assert.ok(has(doubledResult, "INPUT_ID_GAP normalized_gap"), doubledResult.errors.join("; "));
  });

  test("missing-formula", async () => {
    const validatePrescriptionInputContract = await loadValidator();
    const clean = validatePrescriptionInputContract(frozen());
    assert.deepEqual(clean.errors, [], "frozen contract must already have a total formula for every input");
    assert.ok(
      String(inputOf(frozen(), "confidence").missing_rule).includes(
        `${CONFIDENCE_THRESHOLD.n}/${CONFIDENCE_THRESHOLD.d}`
      ),
      "confidence missing rule must name the 7/10 threshold"
    );

    for (const inputId of INPUT_IDS) {
      const missing = frozen();
      delete inputOf(missing, inputId).formula;
      const result = validatePrescriptionInputContract(missing);
      assert.equal(result.ok, false, `dropping formula from ${inputId} was accepted`);
      assert.ok(
        has(result, `MISSING_FORMULA ${inputId}`),
        `dropping formula from ${inputId} produced ${result.errors.join("; ")}`
      );
    }

    for (const inputId of ["confidence", "normalized_gap", "treatment_cost", "permission_delta", "expected_uplift"] as const) {
      const emptied = frozen();
      inputOf(emptied, inputId).formula = "   ";
      const result = validatePrescriptionInputContract(emptied);
      assert.equal(result.ok, false, `blank formula on ${inputId} was accepted`);
      assert.ok(
        has(result, `MISSING_FORMULA ${inputId}`),
        `blank formula on ${inputId} produced ${result.errors.join("; ")}`
      );
    }

    const rewritten = frozen();
    inputOf(rewritten, "confidence").formula = "confidence = 1";
    const rewrittenResult = validatePrescriptionInputContract(rewritten);
    assert.equal(rewrittenResult.ok, false, "a rewritten confidence formula was accepted");
    assert.ok(has(rewrittenResult, "FORMULA_MISMATCH confidence"), rewrittenResult.errors.join("; "));

    const belowThreshold = frozen();
    const confidenceFixture = inputOf(belowThreshold, "confidence").fixture;
    confidenceFixture.inputs = { evidence_class: "operator_claim" };
    confidenceFixture.expected = { state: "PRESENT", value: ratio(0, 1) };
    const belowResult = validatePrescriptionInputContract(belowThreshold);
    assert.equal(belowResult.ok, false, "operator_claim presented as a present confidence");
    assert.ok(has(belowResult, "FIXTURE_MISMATCH confidence-v0"), belowResult.errors.join("; "));

    const admittedMissing = frozen();
    const missingFixture = inputOf(admittedMissing, "confidence").fixture;
    missingFixture.inputs = { evidence_class: "operator_claim" };
    missingFixture.expected = { state: "MISSING" };
    assert.deepEqual(
      validatePrescriptionInputContract(admittedMissing).errors,
      [],
      "operator_claim must resolve to MISSING under the 7/10 rule"
    );
  });

  test("range", async () => {
    const validatePrescriptionInputContract = await loadValidator();
    const result = validatePrescriptionInputContract(frozen());
    assert.deepEqual(result.errors, []);

    const doc = frozen();
    assert.deepEqual(inputOf(doc, "confidence").range, {
      kind: "unit_rational",
      min: ratio(0, 1),
      max: ratio(1, 1)
    });
    assert.deepEqual(inputOf(doc, "normalized_gap").range, {
      kind: "unit_rational",
      min: ratio(0, 1),
      max: ratio(1, 1)
    });
    assert.deepEqual(inputOf(doc, "opportunity_count").range, { kind: "non_negative_integer" });
    assert.deepEqual(inputOf(doc, "treatment_cost").range, { kind: "non_negative_rational" });
    assert.deepEqual(inputOf(doc, "permission_delta").range, { kind: "non_negative_integer" });
    assert.deepEqual(inputOf(doc, "expected_uplift").range, { kind: "enum", values: [...UPLIFT_CLASSES] });
    assert.deepEqual(inputOf(doc, "transferability").range, {
      kind: "enum",
      values: [...TRANSFERABILITY_CLASSES]
    });
    assert.ok(
      String(inputOf(doc, "normalized_gap").tie_break).includes(`${THREE_POINT_BAND.n}/${THREE_POINT_BAND.d}`),
      "normalized_gap tie-break must encode the three-point band as 3/100"
    );

    const highScore = frozen();
    const gap = inputOf(highScore, "normalized_gap").fixture;
    gap.inputs = { score: ratio(3, 2) };
    gap.expected = { state: "PRESENT", value: ratio(-1, 2) };
    const highResult = validatePrescriptionInputContract(highScore);
    assert.equal(highResult.ok, false, "a factor score above 1 was accepted");
    assert.ok(has(highResult, "RANGE normalized_gap-v0"), highResult.errors.join("; "));

    const negativeCost = frozen();
    const cost = inputOf(negativeCost, "treatment_cost").fixture;
    cost.inputs = { time: ratio(-1, 1), tokens: ratio(0, 1), maintenance: ratio(0, 1) };
    cost.expected = { state: "PRESENT", value: ratio(-1, 1) };
    const costResult = validatePrescriptionInputContract(negativeCost);
    assert.equal(costResult.ok, false, "a negative treatment cost was accepted");
    assert.ok(has(costResult, "RANGE treatment_cost-v0"), costResult.errors.join("; "));

    const unknownClass = frozen();
    const uplift = inputOf(unknownClass, "expected_uplift").fixture;
    uplift.inputs = { metric_id: "M18" };
    uplift.expected = { state: "PRESENT", value: "learned" };
    const classResult = validatePrescriptionInputContract(unknownClass);
    assert.equal(classResult.ok, false, "an expected-uplift class outside the frozen set was accepted");
    assert.ok(has(classResult, "RANGE expected_uplift-v0"), classResult.errors.join("; "));

    const drifted = frozen();
    inputOf(drifted, "confidence").range = { kind: "unit_rational", min: ratio(0, 1), max: ratio(2, 1) };
    const driftedResult = validatePrescriptionInputContract(drifted);
    assert.equal(driftedResult.ok, false, "a rewritten confidence range was accepted");
    assert.ok(has(driftedResult, "RANGE_MISMATCH confidence"), driftedResult.errors.join("; "));
  });

  test("unknown-source", async () => {
    const validatePrescriptionInputContract = await loadValidator();
    const result = validatePrescriptionInputContract(frozen());
    assert.deepEqual(result.errors, []);

    for (const inputId of INPUT_IDS) {
      assert.deepEqual(
        inputOf(frozen(), inputId).source_events,
        SOURCE_EVENTS[inputId],
        `${inputId} source events drifted from the frozen vocabulary`
      );
    }

    const extraSource = frozen();
    inputOf(extraSource, "confidence").source_events = [
      ...SOURCE_EVENTS.confidence,
      "learned.model"
    ];
    const extraResult = validatePrescriptionInputContract(extraSource);
    assert.equal(extraResult.ok, false, "learned.model was admitted as a confidence source");
    assert.ok(has(extraResult, "UNKNOWN_SOURCE confidence learned.model"), extraResult.errors.join("; "));

    const unknownClass = frozen();
    const fixture = inputOf(unknownClass, "confidence").fixture;
    fixture.inputs = { evidence_class: "learned.model" };
    fixture.expected = { state: "MISSING" };
    const classResult = validatePrescriptionInputContract(unknownClass);
    assert.equal(classResult.ok, false, "a fixture that reads learned.model was accepted");
    assert.ok(has(classResult, "UNKNOWN_SOURCE confidence-v0 learned.model"), classResult.errors.join("; "));

    const unknownMetric = frozen();
    const uplift = inputOf(unknownMetric, "expected_uplift").fixture;
    uplift.inputs = { metric_id: "M21" };
    uplift.expected = { state: "MISSING" };
    const metricResult = validatePrescriptionInputContract(unknownMetric);
    assert.equal(metricResult.ok, false, "M21 was accepted as an uplift source");
    assert.ok(has(metricResult, "UNKNOWN_SOURCE expected_uplift-v0 M21"), metricResult.errors.join("; "));
  });

  test("version", async () => {
    const validatePrescriptionInputContract = await loadValidator();
    const result = validatePrescriptionInputContract(frozen());
    assert.deepEqual(result.errors, []);

    const doc = frozen();
    assert.equal(doc.contract_version, CONTRACT_VERSION);
    for (const inputId of INPUT_IDS) {
      assert.equal(inputOf(doc, inputId).version, CONTRACT_VERSION, inputId);
    }

    const driftedContract = frozen();
    driftedContract.contract_version = "prescription-input-contract-v1";
    const contractResult = validatePrescriptionInputContract(driftedContract);
    assert.equal(contractResult.ok, false);
    assert.ok(has(contractResult, "VERSION_MISMATCH"), contractResult.errors.join("; "));

    const driftedInput = frozen();
    inputOf(driftedInput, "confidence").version = "prescription-input-contract-v1";
    const inputResult = validatePrescriptionInputContract(driftedInput);
    assert.equal(inputResult.ok, false);
    assert.ok(has(inputResult, "VERSION_MISMATCH confidence"), inputResult.errors.join("; "));
  });
});
