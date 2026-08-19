import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadAssessment = async () => {
  try {
    return await import("../../packages/runner/src/assessment.ts");
  } catch {
    return {};
  }
};

const UNBOUND =
  "six families are not bound into one timed eligibility-valid controlled pack.";

const FAMILIES = ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"] as const;
const REQUIRED_CORE = ["M15", "M16", "M17", "M18", "M20"] as const;
const SAFETY_METRIC = "M19";
const COVERAGE_FACTORS = ["F1", "F2", "F3", "F4"] as const;
const OPPORTUNITY_FACTORS = ["F1", "F2", "F3", "F4", "F5"] as const;
const PRESCRIPTION_PATH = [
  "confidence",
  "normalized_gap",
  "opportunity_count",
  "treatment_cost",
  "permission_delta",
  "expected_uplift",
  "transferability"
] as const;
const FACTOR_OF: Record<string, string> = {
  M01: "F1", M02: "F1", M03: "F1", M04: "F1",
  M05: "F2", M06: "F2", M07: "F2",
  M08: "F3", M09: "F3", M10: "F3", M11: "F3",
  M12: "F4", M13: "F4", M14: "F4",
  M15: "F5", M16: "F5", M17: "F5", M18: "F5",
  M19: "F6", M20: "F6"
};

type Opportunity = { opportunity_id: string; metric_id: string };
type FamilyManifest = {
  family_id: string;
  scenario_id: string;
  budget_minutes: number;
  primary_opportunities: Opportunity[];
  exposure: { worker_visible: string[]; hidden_oracle: string[] };
};
type FormAManifest = {
  form: string;
  version: string;
  seed: number;
  families: FamilyManifest[];
  transitions: { max_minutes: number; minutes: number };
  terminal: { registered: string[]; reason: string };
  prescription: { path: string[] };
};
type AssessmentPackResult = {
  frozen: boolean;
  form: string;
  seed: number;
  families: string[];
  scenarios: FamilyManifest[];
  eligible_metrics: string[];
  required_core: { observed: string[]; missing: string[] };
  factor_coverage: Record<string, number>;
  factor_opportunities: Record<string, number>;
  timing: { median_minutes: number; p90_minutes: number; metric_count: number };
  exposure: { worker_can_access_oracle: boolean };
  terminal: { reason: string; registered: string[]; count: number };
  prescription: { eligible: boolean; path: string[] };
  manifest: FormAManifest;
  reasons: string[];
};
type RunAssessmentPack = (input?: FormAManifest) => AssessmentPackResult;

const requirePack = async (): Promise<RunAssessmentPack> => {
  const mod = await loadAssessment();
  assert.equal(typeof mod.runAssessmentPack, "function", UNBOUND);
  return mod.runAssessmentPack as RunAssessmentPack;
};

const clone = <T>(value: T): T => structuredClone(value);

const passPack = async () => {
  const runAssessmentPack = await requirePack();
  const result = runAssessmentPack();
  assert.equal(result.frozen, true, UNBOUND);
  return { runAssessmentPack, result };
};

describe("form-a", () => {
  test("six-family-census", async () => {
    const { runAssessmentPack, result } = await passPack();
    assert.equal(result.form, "A", UNBOUND);
    assert.deepEqual(result.families, [...FAMILIES], UNBOUND);
    assert.equal(result.scenarios.length, 6, UNBOUND);
    assert.deepEqual(
      result.scenarios.map((scenario) => scenario.family_id),
      [...FAMILIES],
      UNBOUND
    );
    const scenarioIds = result.scenarios.map((scenario) => scenario.scenario_id);
    assert.equal(new Set(scenarioIds).size, 6, UNBOUND);

    const dropped = clone(result.manifest);
    dropped.families = dropped.families.filter((family) => family.family_id !== "FAM-3");
    const missing = runAssessmentPack(dropped);
    assert.equal(missing.frozen, false, UNBOUND);
    assert.equal(missing.families.includes("FAM-3"), false, UNBOUND);
    assert.notEqual(missing.families.length, 6, UNBOUND);
  });

  test("required-core", async () => {
    const { runAssessmentPack, result } = await passPack();
    for (const metricId of REQUIRED_CORE) {
      assert.equal(result.required_core.observed.includes(metricId), true, UNBOUND);
      assert.equal(result.eligible_metrics.includes(metricId), true, UNBOUND);
    }
    assert.equal(result.required_core.missing.length, 0, UNBOUND);
    assert.equal(result.eligible_metrics.includes(SAFETY_METRIC), true, UNBOUND);

    const stripped = clone(result.manifest);
    const fam5 = stripped.families.find((family) => family.family_id === "FAM-5");
    assert.ok(fam5, UNBOUND);
    fam5.primary_opportunities = fam5.primary_opportunities.filter(
      (opportunity) => opportunity.metric_id !== "M15"
    );
    const missing = runAssessmentPack(stripped);
    assert.equal(missing.frozen, false, UNBOUND);
    assert.equal(missing.required_core.observed.includes("M15"), false, UNBOUND);
    assert.equal(missing.required_core.missing.includes("M15"), true, UNBOUND);
  });

  test("eligibility", async () => {
    const { runAssessmentPack, result } = await passPack();
    assert.ok(result.eligible_metrics.length >= 14, UNBOUND);
    for (const factor of COVERAGE_FACTORS) {
      assert.ok((result.factor_coverage[factor] ?? 0) >= 1, UNBOUND);
    }
    for (const factor of OPPORTUNITY_FACTORS) {
      assert.ok((result.factor_opportunities[factor] ?? 0) >= 2, UNBOUND);
    }
    for (const scenario of result.scenarios) {
      assert.ok(scenario.primary_opportunities.length <= 4, UNBOUND);
      for (const opportunity of scenario.primary_opportunities) {
        assert.equal(FACTOR_OF[opportunity.metric_id] !== undefined, true, UNBOUND);
      }
    }
    const opportunityIds = result.scenarios.flatMap((scenario) =>
      scenario.primary_opportunities.map((opportunity) => opportunity.opportunity_id)
    );
    assert.equal(new Set(opportunityIds).size, opportunityIds.length, UNBOUND);

    const doubled = clone(result.manifest);
    doubled.families[0].primary_opportunities.push(
      clone(doubled.families[1].primary_opportunities[0])
    );
    const counted = runAssessmentPack(doubled);
    assert.equal(counted.frozen, false, UNBOUND);

    const thin = clone(result.manifest);
    thin.families = thin.families.map((family) => ({
      ...family,
      primary_opportunities: family.primary_opportunities.slice(0, 1)
    }));
    const underObserved = runAssessmentPack(thin);
    assert.equal(underObserved.frozen, false, UNBOUND);
    assert.ok(underObserved.eligible_metrics.length < 14, UNBOUND);
  });

  test("timing", async () => {
    const { runAssessmentPack, result } = await passPack();
    assert.ok(result.timing.median_minutes <= 40, UNBOUND);
    assert.ok(result.timing.p90_minutes <= 45, UNBOUND);
    assert.equal(result.timing.metric_count, result.eligible_metrics.length, UNBOUND);
    assert.ok(result.eligible_metrics.length >= 14, UNBOUND);

    const slow = clone(result.manifest);
    const fam3 = slow.families.find((family) => family.family_id === "FAM-3");
    assert.ok(fam3, UNBOUND);
    fam3.budget_minutes += 10;
    const late = runAssessmentPack(slow);
    assert.equal(late.frozen, false, UNBOUND);
    assert.ok(late.timing.median_minutes > 40, UNBOUND);
    assert.equal(late.timing.metric_count, result.timing.metric_count, UNBOUND);
    assert.equal(late.eligible_metrics.length, result.eligible_metrics.length, UNBOUND);
  });

  test("exposure", async () => {
    const { runAssessmentPack, result } = await passPack();
    assert.equal(result.exposure.worker_can_access_oracle, false, UNBOUND);
    for (const scenario of result.scenarios) {
      assert.ok(scenario.exposure.hidden_oracle.length > 0, UNBOUND);
      for (const hidden of scenario.exposure.hidden_oracle) {
        assert.equal(scenario.exposure.worker_visible.includes(hidden), false, UNBOUND);
      }
    }

    const leaked = clone(result.manifest);
    leaked.families[0].exposure.worker_visible.push(
      leaked.families[0].exposure.hidden_oracle[0]
    );
    const exposed = runAssessmentPack(leaked);
    assert.equal(exposed.frozen, false, UNBOUND);
    assert.equal(exposed.exposure.worker_can_access_oracle, true, UNBOUND);
  });

  test("terminal-integrity", async () => {
    const { runAssessmentPack, result } = await passPack();
    assert.equal(result.terminal.count, 1, UNBOUND);
    assert.equal(result.terminal.registered.includes("timeout"), true, UNBOUND);
    assert.equal(result.terminal.registered.includes(result.terminal.reason), true, UNBOUND);
    assert.ok(result.terminal.reason.length > 0, UNBOUND);

    const unregisteredTimeout = clone(result.manifest);
    unregisteredTimeout.terminal.registered = unregisteredTimeout.terminal.registered
      .filter((state) => state !== "timeout");
    const hanging = runAssessmentPack(unregisteredTimeout);
    assert.equal(hanging.frozen, false, UNBOUND);
    assert.equal(hanging.terminal.registered.includes("timeout"), false, UNBOUND);

    const twoTerminals = clone(result.manifest);
    twoTerminals.terminal.reason = "completed,timeout";
    const split = runAssessmentPack(twoTerminals);
    assert.equal(split.frozen, false, UNBOUND);
    assert.notEqual(split.terminal.count, 1, UNBOUND);
  });

  test("prescription-path", async () => {
    const { runAssessmentPack, result } = await passPack();
    assert.equal(result.prescription.eligible, true, UNBOUND);
    for (const inputId of PRESCRIPTION_PATH) {
      assert.equal(result.prescription.path.includes(inputId), true, UNBOUND);
    }

    const blank = clone(result.manifest);
    blank.prescription.path = [];
    const ineligible = runAssessmentPack(blank);
    assert.equal(ineligible.frozen, false, UNBOUND);
    assert.equal(ineligible.prescription.eligible, false, UNBOUND);
  });
});
