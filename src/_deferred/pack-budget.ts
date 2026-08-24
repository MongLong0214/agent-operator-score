import { createHash } from "node:crypto";
import { auditOpportunities } from "./opportunity-audit.ts";

type Json = Record<string, unknown>;
type FactorId = "F1" | "F2" | "F3" | "F4" | "F5";

type RawRow = {
  trial: number;
  minutes: number;
  families: Record<string, number>;
};

type PackBudgetResult = {
  ok: boolean;
  reasons: string[];
  seed: number;
  median_minutes: number;
  p90_minutes: number;
  eligible_metrics: number;
  factor_minima: Record<FactorId, boolean>;
  required_core: boolean;
  coverage: { n: number; d: number };
  prescription_path: boolean;
  raw_rows: RawRow[];
  manifest_digest: string;
};

const TRIALS = 1000;
// FACTOR_OPPORTUNITY (issuance.v0 ordinal 5) binds F1-F5; FACTOR_COVERAGE (ordinal 4) binds
// only F1-F4. The asymmetry is the contract's, not a shortcut: F5 must be exercised twice
// but need not already carry a scored metric at simulation time.
const FACTORS: FactorId[] = ["F1", "F2", "F3", "F4", "F5"];
const COVERAGE_FACTORS: FactorId[] = ["F1", "F2", "F3", "F4"];
const FACTOR_OPPORTUNITY_MIN = 2;
// REQUIRED_OUTCOME (ordinal 1) is M15-M17 and REQUIRED_RECOVERY_VALUE (ordinal 2) is M18 and
// M20. M19 is REQUIRED_SAFETY (ordinal 3), a separate gate, so it is not folded in here.
const REQUIRED_SCORED = ["M15", "M16", "M17", "M18", "M20"] as const;
const SAFETY_METRIC = "M19";
const METRIC_COUNT = 20;

// Copied from specs/issuance.v0.json metric_factor_map, which is the frozen authority. The
// simulator is handed the pack-simulation spec only, and that document carries family budgets
// rather than factors — FAM-6 holds M18, M19 and M20 while the factor map splits M18 into F5.
// Reading a second spec from disk would make this function non-hermetic, so the table is
// mirrored here and any drift from issuance.v0 is a defect in this file.
const METRIC_FACTOR: Record<string, FactorId | "F6"> = {
  M01: "F1", M02: "F1", M03: "F1", M04: "F1",
  M05: "F2", M06: "F2", M07: "F2",
  M08: "F3", M09: "F3", M10: "F3", M11: "F3",
  M12: "F4", M13: "F4", M14: "F4",
  M15: "F5", M16: "F5", M17: "F5", M18: "F5",
  M19: "F6", M20: "F6"
};

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

const asArray = (value: unknown): unknown[] | null => Array.isArray(value) ? value : null;

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};

// The median is taken analytically and the p90 empirically, and the two are not
// interchangeable. A sum of symmetric triangulars has its exact median at the sum of the
// per-family medians, so the analytic route carries no Monte Carlo error; the seeded p50 of
// the same 1000 rows lands at 40.03 for the preregistered assumptions and would read the
// 40-minute threshold as breached on sampling noise alone. No closed form is available for
// the p90 of a sum, so that one must be sampled. The exactness holds only while every family
// distribution is symmetric: for an asymmetric triangular the median of the sum is not the
// sum of the medians, and this derivation would have to be replaced rather than adjusted.
const triangularMedian = (low: number, mode: number, high: number): number => {
  if (high === low) return low;
  const midpoint = (low + high) / 2;
  if (mode >= midpoint) return high - Math.sqrt((high - low) * (high - mode) / 2);
  return low + Math.sqrt((high - low) * (mode - low) / 2);
};

const sampleTriangular = (unit: number, low: number, mode: number, high: number): number => {
  if (high === low) return low;
  const c = (mode - low) / (high - low);
  if (unit < c) return low + Math.sqrt(unit * (high - low) * (mode - low));
  return high - Math.sqrt((1 - unit) * (high - low) * (high - mode));
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Json;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

const readDistribution = (value: unknown): { low: number; mode: number; high: number } | null => {
  const distribution = asObject(value);
  if (!distribution || distribution.kind !== "triangular") return null;
  const low = asFiniteNumber(distribution.low_minutes);
  const mode = asFiniteNumber(distribution.mode_minutes);
  const high = asFiniteNumber(distribution.high_minutes);
  if (low === null || mode === null || high === null) return null;
  return { low, mode, high };
};

const emptyMinima = (): Record<FactorId, boolean> => ({
  F1: false, F2: false, F3: false, F4: false, F5: false
});

export const simulatePackBudget = (spec: unknown, assumptions: unknown): PackBudgetResult => {
  const reasons: string[] = [];
  const audit = auditOpportunities(spec, assumptions);
  const input = asObject(assumptions);
  const specObject = asObject(spec);
  const seed = asFiniteNumber(input?.seed);
  const seedOk = seed !== null && Number.isInteger(seed) && seed >= 0;
  if (!seedOk) reasons.push("SEED_POLICY");

  const thresholds = asObject(input?.thresholds) ?? asObject(specObject?.thresholds);
  const medianMax = asFiniteNumber(thresholds?.median_minutes_max) ?? 40;
  const p90Max = asFiniteNumber(thresholds?.p90_minutes_max) ?? 45;
  const eligibleMin = asFiniteNumber(thresholds?.eligible_metrics_min) ?? 14;

  const eligibleIds = new Set(audit.eligible_metric_ids);
  const eligibleMetrics = eligibleIds.size;
  const coverage = { n: eligibleMetrics, d: METRIC_COUNT };

  const eligibleByFactor: Record<FactorId, Set<string>> = {
    F1: new Set(), F2: new Set(), F3: new Set(), F4: new Set(), F5: new Set()
  };
  const opportunitiesByFactor: Record<FactorId, Set<string>> = {
    F1: new Set(), F2: new Set(), F3: new Set(), F4: new Set(), F5: new Set()
  };

  const families: { familyId: string; distribution: { low: number; mode: number; high: number } }[] = [];
  const scenarios = asArray(input?.scenarios) ?? [];
  for (const scenarioValue of scenarios) {
    const scenario = asObject(scenarioValue);
    if (!scenario) continue;
    const familyId = asString(scenario.family_id) ?? "unknown";
    const distribution = readDistribution(scenario.distribution);
    if (!distribution) {
      reasons.push(`DISTRIBUTION_KIND ${familyId}`);
    } else {
      families.push({ familyId, distribution });
    }
    const opportunities = asArray(scenario.primary_opportunities) ?? [];
    for (const opportunityValue of opportunities) {
      const opportunity = asObject(opportunityValue);
      const metricId = asString(opportunity?.metric_id);
      const opportunityId = asString(opportunity?.opportunity_id);
      if (!metricId || !opportunityId) continue;
      const factor = METRIC_FACTOR[metricId];
      if (!factor || factor === "F6") continue;
      opportunitiesByFactor[factor].add(opportunityId);
      if (eligibleIds.has(metricId)) eligibleByFactor[factor].add(metricId);
    }
  }

  const factorMinima = emptyMinima();
  for (const factor of FACTORS) {
    const opportunityOk = opportunitiesByFactor[factor].size >= FACTOR_OPPORTUNITY_MIN;
    const coverageOk = !COVERAGE_FACTORS.includes(factor) || eligibleByFactor[factor].size >= 1;
    factorMinima[factor] = opportunityOk && coverageOk;
  }

  const requiredCore = REQUIRED_SCORED.every((metricId) => eligibleIds.has(metricId));
  const prescriptionPath = requiredCore && eligibleIds.has(SAFETY_METRIC);

  // transition_overhead in the spec is declared but never added here. The preregistered
  // assumptions carry no overhead term, and inventing one would be fabricated timing; the
  // family distributions are the only declared source of minutes.
  let medianMinutes = 0;
  const rawRows: RawRow[] = [];
  if (families.length > 0) {
    medianMinutes = families.reduce(
      (sum, family) => sum + triangularMedian(family.distribution.low, family.distribution.mode, family.distribution.high),
      0
    );
  }
  const random = mulberry32(seedOk ? seed : 0);
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    const familyMinutes: Record<string, number> = {};
    let minutes = 0;
    for (const family of families) {
      const drawn = sampleTriangular(
        random(),
        family.distribution.low,
        family.distribution.mode,
        family.distribution.high
      );
      familyMinutes[family.familyId] = drawn;
      minutes += drawn;
    }
    rawRows.push({ trial, minutes, families: familyMinutes });
  }
  const sorted = rawRows.map((row) => row.minutes).sort((left, right) => left - right);
  const p90Minutes = percentile(sorted, 0.9);

  const doubleCount = audit.errors.some((entry) => entry.split(" ")[0] === "DOUBLE_COUNT");
  if (doubleCount) reasons.push("DOUBLE_COUNT");
  else if (!audit.ok) reasons.push(...audit.errors);

  if (!doubleCount && eligibleMetrics < eligibleMin) reasons.push("UNDER_OBSERVED");
  if (medianMinutes > medianMax || p90Minutes > p90Max) reasons.push("SLOW_PACK");
  if (!doubleCount && !prescriptionPath) reasons.push("NO_PRESCRIPTION");
  if (!doubleCount && !FACTORS.every((factor) => factorMinima[factor])) reasons.push("FACTOR_MINIMA");
  if (!doubleCount && !requiredCore) reasons.push("REQUIRED_CORE");

  const uniqueReasons = [...new Set(reasons)];
  const result: PackBudgetResult = {
    ok: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    seed: seedOk ? seed : -1,
    median_minutes: medianMinutes,
    p90_minutes: p90Minutes,
    eligible_metrics: eligibleMetrics,
    factor_minima: factorMinima,
    required_core: requiredCore,
    coverage,
    prescription_path: prescriptionPath,
    raw_rows: rawRows,
    manifest_digest: ""
  };
  result.manifest_digest = digest({
    seed: result.seed,
    spec,
    assumptions,
    median_minutes: result.median_minutes,
    p90_minutes: result.p90_minutes,
    eligible_metrics: result.eligible_metrics,
    reasons: result.reasons,
    raw_rows: result.raw_rows
  });
  return result;
};
