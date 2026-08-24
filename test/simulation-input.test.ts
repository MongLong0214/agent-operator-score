import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../specs/pack-simulation.v0.json");
const assumptionsPath = resolve(here, "../fixtures/simulation/assumptions.v0.json");
const preflightPath = resolve(here, "../docs/VALIDATION-PREFLIGHT.md");

const UNCHECKABLE = "simulation assumptions and opportunity independence are not machine-checkable";

const REQUIRED_SPEC_FIELDS = [
  "contract_id",
  "contract_version",
  "source_authority",
  "family_budgets",
  "transition_overhead",
  "policy_classes",
  "distributions",
  "primary_cap",
  "opportunity_independence",
  "thresholds",
  "seed_policy"
] as const;

const REQUIRED_THRESHOLD_KEYS = [
  "median_minutes_max",
  "p90_minutes_max",
  "eligible_metrics_min",
  "primary_opportunities_per_scenario_max"
] as const;

const SSOT_FAMILY_BUDGETS: [string, string, number, number, string[]][] = [
  ["FAM-1", "Intent & Contracting", 5, 4, ["M01", "M02", "M03", "M04"]],
  ["FAM-2", "Context, RAG & Decoy", 6, 3, ["M05", "M06", "M07"]],
  ["FAM-3", "Graph & Orchestration", 8, 4, ["M08", "M09", "M10", "M11"]],
  ["FAM-4", "Loop, State & Continuity", 7, 3, ["M12", "M13", "M14"]],
  ["FAM-5", "Verification & False Completion", 7, 3, ["M15", "M16", "M17"]],
  ["FAM-6", "Recovery, Safety & Efficiency", 7, 3, ["M18", "M19", "M20"]]
];

const POLICY_CLASSES = ["reference_operator", "scripted_policy"] as const;
const DISTRIBUTION_KIND = "triangular";
const DISTRIBUTION_PARAMETERS = ["low_minutes", "mode_minutes", "high_minutes"] as const;

type Json = Record<string, unknown>;
type ValidationResult = { ok: boolean; errors: string[] };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const codes = (result: ValidationResult) => result.errors.map((entry) => entry.split(" ")[0]);
const has = (result: ValidationResult, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));

const isMissingPreregistration = (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "ENOENT";
};

const loadPreregistered = () => {
  try {
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    const assumptions = JSON.parse(readFileSync(assumptionsPath, "utf8"));
    const preflight = readFileSync(preflightPath, "utf8");
    return { spec, assumptions, preflight };
  } catch (error) {
    if (isMissingPreregistration(error) || !existsSync(specPath) || !existsSync(assumptionsPath) || !existsSync(preflightPath)) {
      throw new Error(UNCHECKABLE);
    }
    throw error;
  }
};

const push = (errors: string[], code: string, detail = "") => {
  errors.push(detail ? `${code} ${detail}` : code);
};

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

const asArray = (value: unknown): unknown[] | null => Array.isArray(value) ? value : null;

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const validateSimulationInput = (spec: unknown, assumptions: unknown): ValidationResult => {
  const errors: string[] = [];
  const specObject = asObject(spec);
  if (!specObject) {
    push(errors, "MALFORMED_SPEC");
    return { ok: false, errors };
  }

  for (const field of REQUIRED_SPEC_FIELDS) {
    if (!(field in specObject)) push(errors, "MISSING_SPEC_FIELD", field);
  }

  if (specObject.contract_id !== "pack-simulation.v0") {
    push(errors, "CONTRACT_ID", String(specObject.contract_id ?? "missing"));
  }
  if (specObject.contract_version !== "pack-simulation-contract-v0") {
    push(errors, "CONTRACT_VERSION", String(specObject.contract_version ?? "missing"));
  }
  if (specObject.source_authority !== "docs/north-star/agent-operator-score-ssot-v1.0.md#5.3") {
    push(errors, "SOURCE_AUTHORITY", String(specObject.source_authority ?? "missing"));
  }

  const primaryCap = asFiniteNumber(specObject.primary_cap);
  if (primaryCap !== 4) push(errors, "PRIMARY_CAP", String(specObject.primary_cap ?? "missing"));

  const thresholds = asObject(specObject.thresholds);
  if (!thresholds) {
    push(errors, "MISSING_THRESHOLD", "thresholds");
  } else {
    for (const key of REQUIRED_THRESHOLD_KEYS) {
      if (!(key in thresholds)) push(errors, "MISSING_THRESHOLD", key);
    }
    if (thresholds.median_minutes_max !== 40) push(errors, "THRESHOLD_VALUE", "median_minutes_max");
    if (thresholds.p90_minutes_max !== 45) push(errors, "THRESHOLD_VALUE", "p90_minutes_max");
    if (thresholds.eligible_metrics_min !== 14) push(errors, "THRESHOLD_VALUE", "eligible_metrics_min");
    if (thresholds.primary_opportunities_per_scenario_max !== 4) {
      push(errors, "THRESHOLD_VALUE", "primary_opportunities_per_scenario_max");
    }
  }

  const transition = asObject(specObject.transition_overhead);
  if (!transition || asFiniteNumber(transition.max_minutes) !== 5) {
    push(errors, "TRANSITION_OVERHEAD", "max_minutes");
  }

  const policyClasses = asArray(specObject.policy_classes);
  const registeredPolicies = new Set<string>();
  if (!policyClasses) {
    push(errors, "POLICY_CLASSES", "missing");
  } else {
    const ids = policyClasses.map((entry) => asObject(entry)?.policy_id).filter((id): id is string => typeof id === "string");
    if (ids.join(",") !== POLICY_CLASSES.join(",")) {
      push(errors, "POLICY_CLASSES", ids.join(",") || "empty");
    }
    for (const id of ids) registeredPolicies.add(id);
  }

  const distributions = asObject(specObject.distributions);
  if (!distributions || distributions.kind !== DISTRIBUTION_KIND) {
    push(errors, "DISTRIBUTION_KIND", String(asObject(specObject.distributions)?.kind ?? "missing"));
  } else {
    const parameters = asArray(distributions.parameters);
    if (!parameters || parameters.join(",") !== DISTRIBUTION_PARAMETERS.join(",")) {
      push(errors, "DISTRIBUTION_PARAMETERS", (parameters ?? []).join(","));
    }
  }

  const independence = asObject(specObject.opportunity_independence);
  if (!independence || independence.ids_must_be_unique !== true || independence.double_count_forbidden !== true) {
    push(errors, "OPPORTUNITY_INDEPENDENCE");
  }

  const seedPolicy = asObject(specObject.seed_policy);
  if (
    !seedPolicy
    || seedPolicy.required !== true
    || seedPolicy.implicit_default_forbidden !== true
    || seedPolicy.integer !== true
  ) {
    push(errors, "SEED_POLICY");
  }

  const familyBudgets = asArray(specObject.family_budgets);
  if (!familyBudgets) {
    push(errors, "FAMILY_BUDGETS", "missing");
  } else {
    if (familyBudgets.length !== SSOT_FAMILY_BUDGETS.length) {
      push(errors, "FAMILY_BUDGET_COUNT", String(familyBudgets.length));
    }
    for (const [index, expected] of SSOT_FAMILY_BUDGETS.entries()) {
      const row = asObject(familyBudgets[index]);
      const [familyId, label, targetMinutes, familyCap, metrics] = expected;
      if (!row) {
        push(errors, "FAMILY_BUDGET", familyId);
        continue;
      }
      if (row.family_id !== familyId) push(errors, "FAMILY_ID", `${index}:${String(row.family_id)}`);
      if (row.label !== label) push(errors, "FAMILY_LABEL", familyId);
      if (row.target_minutes !== targetMinutes) push(errors, "FAMILY_TARGET", familyId);
      if (row.primary_opportunity_cap !== familyCap) push(errors, "FAMILY_PRIMARY_CAP", familyId);
      const primaryMetrics = asArray(row.primary_metrics);
      if (!primaryMetrics || primaryMetrics.join(",") !== metrics.join(",")) {
        push(errors, "FAMILY_PRIMARY_METRICS", familyId);
      }
    }
  }

  const input = asObject(assumptions);
  if (!input) {
    push(errors, "MALFORMED_ASSUMPTIONS");
    return { ok: false, errors };
  }

  const seed = asFiniteNumber(input.seed);
  if (seed === null || !Number.isInteger(seed) || seed < 0) {
    push(errors, "SEED_POLICY", "seed");
  }

  const policyClass = asString(input.policy_class);
  if (!policyClass) {
    push(errors, "UNREGISTERED_POLICY", "missing");
  } else if (!registeredPolicies.has(policyClass)) {
    push(errors, "UNREGISTERED_POLICY", policyClass);
  }

  const inputThresholds = asObject(input.thresholds);
  if (!inputThresholds) {
    push(errors, "MISSING_THRESHOLD", "assumptions.thresholds");
  } else if (thresholds) {
    for (const key of REQUIRED_THRESHOLD_KEYS) {
      if (!(key in inputThresholds)) push(errors, "MISSING_THRESHOLD", key);
      else if (inputThresholds[key] !== thresholds[key]) push(errors, "THRESHOLD_VALUE", key);
    }
  }

  const scenarios = asArray(input.scenarios);
  if (!scenarios || scenarios.length === 0) {
    push(errors, "SCENARIOS", "missing");
    return { ok: errors.length === 0, errors };
  }

  const seenOpportunityIds = new Set<string>();
  for (const scenarioValue of scenarios) {
    const scenario = asObject(scenarioValue);
    if (!scenario) {
      push(errors, "MALFORMED_SCENARIO");
      continue;
    }
    const familyId = asString(scenario.family_id) ?? "unknown";
    const familyRow = (familyBudgets ?? []).map(asObject).find((row) => row?.family_id === familyId);
    const opportunities = asArray(scenario.primary_opportunities);
    if (!opportunities) {
      push(errors, "PRIMARY_OPPORTUNITIES", familyId);
      continue;
    }
    if (primaryCap !== null && opportunities.length > primaryCap) {
      push(errors, "PRIMARY_CAP_EXCEEDED", `${familyId}:${opportunities.length}`);
    }
    const familyCap = asFiniteNumber(familyRow?.primary_opportunity_cap);
    if (familyCap !== null && opportunities.length > familyCap) {
      push(errors, "FAMILY_PRIMARY_CAP_EXCEEDED", `${familyId}:${opportunities.length}`);
    }

    const distribution = asObject(scenario.distribution);
    if (!distribution || distribution.kind !== DISTRIBUTION_KIND) {
      push(errors, "DISTRIBUTION_KIND", familyId);
    } else {
      for (const parameter of DISTRIBUTION_PARAMETERS) {
        if (asFiniteNumber(distribution[parameter]) === null) {
          push(errors, "DISTRIBUTION_PARAMETERS", `${familyId}:${parameter}`);
        }
      }
    }

    for (const opportunityValue of opportunities) {
      const opportunity = asObject(opportunityValue);
      const opportunityId = asString(opportunity?.opportunity_id);
      if (!opportunityId) {
        push(errors, "OPPORTUNITY_ID", familyId);
        continue;
      }
      if (seenOpportunityIds.has(opportunityId)) {
        push(errors, "DUPLICATE_OPPORTUNITY_ID", opportunityId);
      }
      seenOpportunityIds.add(opportunityId);
    }
  }

  return { ok: errors.length === 0, errors };
};

describe("simulation-input", () => {
  test("valid-input", () => {
    const { spec, assumptions, preflight } = loadPreregistered();
    const result = validateSimulationInput(spec, assumptions);

    assert.deepEqual(result.errors, [], result.errors.join("; "));
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(spec), [...REQUIRED_SPEC_FIELDS]);
    assert.equal(spec.primary_cap, 4);
    assert.deepEqual(
      spec.family_budgets.map((row: { family_id: string }) => row.family_id),
      SSOT_FAMILY_BUDGETS.map(([familyId]) => familyId)
    );
    assert.equal(spec.transition_overhead.max_minutes, 5);
    assert.deepEqual(
      spec.policy_classes.map((entry: { policy_id: string }) => entry.policy_id),
      [...POLICY_CLASSES]
    );
    assert.equal(spec.distributions.kind, DISTRIBUTION_KIND);
    assert.equal(spec.opportunity_independence.ids_must_be_unique, true);
    assert.equal(spec.seed_policy.required, true);
    assert.equal(spec.seed_policy.implicit_default_forbidden, true);
    assert.match(preflight, /median 40/);
    assert.match(preflight, /p90 45/);
    assert.match(preflight, /14 eligible/);
    assert.match(preflight, /does not claim human calibration/);
    assert.match(preflight, /does not freeze Form A/);
    assert.match(preflight, /required integer seed/);
  });

  test("over-four-primary", () => {
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    const first = mutated.scenarios[0];
    const extra = clone(first.primary_opportunities[0]);
    extra.opportunity_id = "FAM1-OPP-OVER-FOUR";
    first.primary_opportunities = [
      ...first.primary_opportunities,
      extra,
      { ...extra, opportunity_id: "FAM1-OPP-OVER-FOUR-2" }
    ];
    assert.ok(first.primary_opportunities.length > 4);

    const result = validateSimulationInput(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(has(result, "PRIMARY_CAP_EXCEEDED"), result.errors.join("; "));
    assert.ok(codes(result).includes("PRIMARY_CAP_EXCEEDED"), result.errors.join("; "));
  });

  test("duplicate-opportunity", () => {
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    const firstId = mutated.scenarios[0].primary_opportunities[0].opportunity_id;
    mutated.scenarios[1].primary_opportunities[0].opportunity_id = firstId;

    const result = validateSimulationInput(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(has(result, `DUPLICATE_OPPORTUNITY_ID ${firstId}`), result.errors.join("; "));
  });

  test("missing-threshold", () => {
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    delete mutated.thresholds.eligible_metrics_min;

    const result = validateSimulationInput(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(has(result, "MISSING_THRESHOLD eligible_metrics_min"), result.errors.join("; "));
  });

  test("unregistered-policy", () => {
    const { spec, assumptions } = loadPreregistered();
    const mutated = clone(assumptions);
    mutated.policy_class = "human_calibration";

    const result = validateSimulationInput(spec, mutated);
    assert.equal(result.ok, false);
    assert.ok(has(result, "UNREGISTERED_POLICY human_calibration"), result.errors.join("; "));
  });
});
