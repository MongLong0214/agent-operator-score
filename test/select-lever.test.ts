import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, "../fixtures/prescription");
const modulePath = "../src/reporter/diagnosis/select-lever.ts";

// Pinned pre-GREEN reason. Without it every case dies on a module-resolution error whose
// text names a loader internal rather than the contract that is missing, and the RED
// receipt then records an accident instead of an expectation.
const ABSENT =
  "selectPrimaryConstraint is not implemented in src/reporter/diagnosis/select-lever.ts";

// Independent oracle for SSOT §8.2 rules 1-8 and PRD-E0D requirements 2 and 4. Every
// expectation below is written here as a literal and is not read from the fixture; the
// fixture's own `expected` block is compared against the same literal so a fixture cannot
// make a wrong selector agree by restating whatever the selector returned.
type Selection = {
  outcome: string;
  reason: string;
  factor_id: string | null;
  metric_id: string | null;
  treatment_id: string | null;
  lever_count: number;
  trace: string[];
};

type SelectPrimaryConstraint = (input: unknown) => Selection;

const loadSelector = async (): Promise<SelectPrimaryConstraint> => {
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(modulePath)) as Record<string, unknown>;
  } catch {
    throw new Error(ABSENT);
  }
  const selector = loaded.selectPrimaryConstraint;
  if (typeof selector !== "function") throw new Error(ABSENT);
  return selector as SelectPrimaryConstraint;
};

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(fixtureDir, `${name}.json`), "utf8"));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const verdict = (selection: Selection) => ({
  outcome: selection.outcome,
  reason: selection.reason,
  factor_id: selection.factor_id,
  metric_id: selection.metric_id,
  treatment_id: selection.treatment_id,
  lever_count: selection.lever_count
});

describe("select-lever", () => {
  // AC-E0D-003-1. SSOT §8.2 rule 1: an S2 or S3 safety state stops the score and every
  // ordinary lever. The same case at S1 must still produce one, or the S2 result would
  // only prove that nothing was selectable.
  test("S2", async () => {
    const selectPrimaryConstraint = await loadSelector();
    const loaded = fixture("s2-safety");
    const expected = {
      outcome: "SAFETY_REMEDIATION",
      reason: "SAFETY_FIRST",
      factor_id: null,
      metric_id: "M19",
      treatment_id: "T-M19",
      lever_count: 1
    };

    const selection = selectPrimaryConstraint(loaded.case);
    assert.deepEqual(verdict(selection), expected);
    assert.deepEqual(loaded.expected, expected);
    assert.deepEqual(selection.trace, ["safety S2", "safety_remediation T-M19"]);

    const escalated = clone(loaded.case);
    escalated.safety_state = "S3";
    const escalatedSelection = selectPrimaryConstraint(escalated);
    assert.deepEqual(verdict(escalatedSelection), expected);
    assert.deepEqual(escalatedSelection.trace, ["safety S3", "safety_remediation T-M19"]);

    const warned = clone(loaded.case);
    warned.safety_state = "S1";
    assert.deepEqual(verdict(selectPrimaryConstraint(warned)), {
      outcome: "PRIMARY_CONSTRAINT",
      reason: "DETERMINISTIC_SELECTION",
      factor_id: "F5",
      metric_id: "M15",
      treatment_id: "T-M15-M17",
      lever_count: 1
    });
  });

  // AC-E0D-003-2. SSOT §8.2 rule 4: on an exact tie the order is F5 -> F4 -> F1 -> F2 ->
  // F3 -> F6. F2 and F3 tie exactly and F2 wins; F5 carries the highest priority but its
  // gap is far outside the band, so priority alone must not select it.
  test("factor-priority", async () => {
    const selectPrimaryConstraint = await loadSelector();
    const loaded = fixture("factor-priority");
    const expected = {
      outcome: "PRIMARY_CONSTRAINT",
      reason: "DETERMINISTIC_SELECTION",
      factor_id: "F2",
      metric_id: "M05",
      treatment_id: "T-M05",
      lever_count: 1
    };

    const selection = selectPrimaryConstraint(loaded.case);
    assert.deepEqual(verdict(selection), expected);
    assert.deepEqual(loaded.expected, expected);
    assert.deepEqual(selection.trace, [
      "safety S0",
      "metric M05 eligible gap 1/2 weight 2",
      "metric M08 eligible gap 1/2 weight 2",
      "metric M15 eligible gap 1/5 weight 2",
      "factor F2 gap 1/2",
      "factor F3 gap 1/2",
      "factor F5 gap 1/5",
      "band F2,F3",
      "factor F2 selected",
      "metric M05 selected",
      "treatment T-M05 cost 2/1 permission 0",
      "treatment T-M05 selected"
    ]);
  });

  // AC-E0D-003-3. SSOT §8.2 rule 4: a difference of three points or less is a tie. F1
  // holds the largest gap at 50/100, F4 sits exactly 3/100 below it and is inside the
  // band, F5 sits 4/100 below and is outside it. F4 therefore wins. A band narrower than
  // 3/100 elects F1 and a band of 4/100 or wider elects F5, so one fixture pins both
  // edges of the interval.
  test("three-point-tie", async () => {
    const selectPrimaryConstraint = await loadSelector();
    const loaded = fixture("three-point-tie");
    const expected = {
      outcome: "PRIMARY_CONSTRAINT",
      reason: "DETERMINISTIC_SELECTION",
      factor_id: "F4",
      metric_id: "M12",
      treatment_id: "T-M12",
      lever_count: 1
    };

    const selection = selectPrimaryConstraint(loaded.case);
    assert.deepEqual(verdict(selection), expected);
    assert.deepEqual(loaded.expected, expected);
    assert.deepEqual(selection.trace, [
      "safety S0",
      "metric M01 eligible gap 1/2 weight 2",
      "metric M12 eligible gap 47/100 weight 2",
      "metric M15 eligible gap 23/50 weight 2",
      "factor F1 gap 1/2",
      "factor F4 gap 47/100",
      "factor F5 gap 23/50",
      "band F1,F4",
      "factor F4 selected",
      "metric M12 selected",
      "treatment T-M12 cost 2/1 permission 0",
      "treatment T-M12 selected"
    ]);
  });

  // AC-E0D-003-4. SSOT §8.2 rule 7: between two candidates for the same metric the lower
  // implementation cost wins. Cost is the total of time, tokens and maintenance, so the
  // comparison cannot be made on one component.
  test("lower-cost", async () => {
    const selectPrimaryConstraint = await loadSelector();
    const loaded = fixture("lower-cost");
    const expected = {
      outcome: "PRIMARY_CONSTRAINT",
      reason: "DETERMINISTIC_SELECTION",
      factor_id: "F5",
      metric_id: "M15",
      treatment_id: "T-M15-M17-LEAN",
      lever_count: 1
    };

    const selection = selectPrimaryConstraint(loaded.case);
    assert.deepEqual(verdict(selection), expected);
    assert.deepEqual(loaded.expected, expected);
    assert.deepEqual(selection.trace, [
      "safety S0",
      "metric M15 eligible gap 1/2 weight 2",
      "factor F5 gap 1/2",
      "band F5",
      "factor F5 selected",
      "metric M15 selected",
      "treatment T-M15-M17 cost 2/1 permission 0",
      "treatment T-M15-M17-LEAN cost 1/1 permission 0",
      "treatment T-M15-M17-LEAN selected"
    ]);
  });

  // AC-E0D-003-5. SSOT §8.2 rule 7: at equal cost the smaller permission surface wins.
  // The two candidates carry the same total cost from different components, and the
  // cheaper `time` belongs to the candidate with the wider permission surface, so a
  // comparison that stops at one cost component elects the wrong treatment.
  test("lower-permission", async () => {
    const selectPrimaryConstraint = await loadSelector();
    const loaded = fixture("lower-permission");
    const expected = {
      outcome: "PRIMARY_CONSTRAINT",
      reason: "DETERMINISTIC_SELECTION",
      factor_id: "F5",
      metric_id: "M15",
      treatment_id: "T-M15-M17-SCOPED",
      lever_count: 1
    };

    const selection = selectPrimaryConstraint(loaded.case);
    assert.deepEqual(verdict(selection), expected);
    assert.deepEqual(loaded.expected, expected);
    assert.deepEqual(selection.trace, [
      "safety S0",
      "metric M15 eligible gap 1/2 weight 2",
      "factor F5 gap 1/2",
      "band F5",
      "factor F5 selected",
      "metric M15 selected",
      "treatment T-M15-M17 cost 1/1 permission 2",
      "treatment T-M15-M17-SCOPED cost 1/1 permission 1",
      "treatment T-M15-M17-SCOPED selected"
    ]);
  });

  // AC-E0D-003-6. SSOT §8.2 rule 2 and §6.1: an unobserved metric, a confidence below
  // 7/10, fewer than two distinct opportunities, and an absent score each remove a metric
  // from the candidate set, and an empty candidate set is INSUFFICIENT_EVIDENCE rather
  // than a lever. The threshold is inclusive: 7/10 exactly is eligible.
  test("insufficient", async () => {
    const selectPrimaryConstraint = await loadSelector();
    const loaded = fixture("insufficient");
    const expected = {
      outcome: "INSUFFICIENT_EVIDENCE",
      reason: "NO_ELIGIBLE_CANDIDATE",
      factor_id: null,
      metric_id: null,
      treatment_id: null,
      lever_count: 0
    };

    const selection = selectPrimaryConstraint(loaded.case);
    assert.deepEqual(verdict(selection), expected);
    assert.deepEqual(loaded.expected, expected);
    assert.deepEqual(selection.trace, [
      "safety S0",
      "metric M01 excluded CONFIDENCE_BELOW_THRESHOLD",
      "metric M05 excluded OPPORTUNITY_BELOW_MINIMUM",
      "metric M08 excluded OPPORTUNITY_BELOW_MINIMUM",
      "metric M12 excluded NOT_OBSERVED",
      "metric M15 excluded SCORE_MISSING"
    ]);

    const atThreshold = clone(loaded.case);
    atThreshold.metrics[0].evidence_class = "immutable_artifact";
    assert.deepEqual(verdict(selectPrimaryConstraint(atThreshold)), {
      outcome: "PRIMARY_CONSTRAINT",
      reason: "DETERMINISTIC_SELECTION",
      factor_id: "F1",
      metric_id: "M01",
      treatment_id: "T-M01-M02",
      lever_count: 1
    });
  });

  // AC-E0D-003-7. SSOT §8.2 rule 8: where the procedure cannot reach one lever it emits
  // MANUAL_REVIEW_REQUIRED and invents nothing. Two paths reach it — two metrics tied at
  // the factor minimum, and two treatments tied on both cost and permission surface.
  test("manual-review", async () => {
    const selectPrimaryConstraint = await loadSelector();
    const loaded = fixture("manual-review");
    const expected = {
      outcome: "MANUAL_REVIEW_REQUIRED",
      reason: "AMBIGUOUS_METRIC_MINIMUM",
      factor_id: "F5",
      metric_id: null,
      treatment_id: null,
      lever_count: 0
    };

    const selection = selectPrimaryConstraint(loaded.case);
    assert.deepEqual(verdict(selection), expected);
    assert.deepEqual(loaded.expected, expected);
    assert.deepEqual(selection.trace, [
      "safety S0",
      "metric M15 eligible gap 1/2 weight 2",
      "metric M16 eligible gap 1/2 weight 2",
      "metric M17 eligible gap 1/10 weight 2",
      "factor F5 gap 11/30",
      "band F5",
      "factor F5 selected",
      "metric ambiguous M15,M16"
    ]);

    const tiedTreatments = fixture("manual-review-treatment");
    const tiedExpected = {
      outcome: "MANUAL_REVIEW_REQUIRED",
      reason: "AMBIGUOUS_TREATMENT",
      factor_id: "F4",
      metric_id: "M12",
      treatment_id: null,
      lever_count: 0
    };
    const tiedSelection = selectPrimaryConstraint(tiedTreatments.case);
    assert.deepEqual(verdict(tiedSelection), tiedExpected);
    assert.deepEqual(tiedTreatments.expected, tiedExpected);
    assert.deepEqual(tiedSelection.trace, [
      "safety S0",
      "metric M12 eligible gap 1/2 weight 2",
      "factor F4 gap 1/2",
      "band F4",
      "factor F4 selected",
      "metric M12 selected",
      "treatment T-M12 cost 2/1 permission 0",
      "treatment T-M12-ALT cost 2/1 permission 0",
      "treatment ambiguous T-M12,T-M12-ALT"
    ]);
  });
});
