/**
 * Compose and freeze six-family Form A.
 *
 * The bound pack is the only object this function trusts. Required core,
 * factor minima, eligibility, timing, exposure, terminal integrity, and the
 * prescription path are derived from that pack together. A failing timing
 * budget does not delete a metric. A missing default manifest cannot be
 * replaced by an implicit pack.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UNBOUND =
  "six families are not bound into one timed eligibility-valid controlled pack.";

const DEFAULT_MANIFEST = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../suites/coding-core-v0/form-a/manifest.json"
);

const REQUIRED_FAMILIES = ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"] as const;
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

export type Opportunity = { opportunity_id: string; metric_id: string };

export type FamilyManifest = {
  family_id: string;
  scenario_id: string;
  budget_minutes: number;
  primary_opportunities: Opportunity[];
  exposure: { worker_visible: string[]; hidden_oracle: string[] };
};

export type FormAManifest = {
  form: string;
  version: string;
  seed: number;
  families: FamilyManifest[];
  transitions: { max_minutes: number; minutes: number };
  terminal: { registered: string[]; reason: string };
  prescription: { path: string[] };
};

export type AssessmentPackResult = {
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

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const loadDefaultManifest = (): FormAManifest => {
  let text: string;
  try {
    text = readFileSync(DEFAULT_MANIFEST, "utf8");
  } catch {
    throw new Error(UNBOUND);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(UNBOUND);
  }
  if (!isPlainRecord(parsed)) throw new Error(UNBOUND);
  return parsed as unknown as FormAManifest;
};

const terminalReasons = (reason: unknown): string[] =>
  typeof reason === "string"
    ? reason.split(",").map((part) => part.trim()).filter((part) => part.length > 0)
    : [];

export const runAssessmentPack = (input?: FormAManifest): AssessmentPackResult => {
  const manifest = structuredClone(input ?? loadDefaultManifest());
  const families = Array.isArray(manifest.families) ? manifest.families : [];
  const familyIds = families.map((family) => family.family_id);
  const opportunities = families.flatMap((family) =>
    Array.isArray(family.primary_opportunities) ? family.primary_opportunities : []
  );
  const eligibleMetrics = [...new Set(
    opportunities
      .map((opportunity) => opportunity.metric_id)
      .filter((metricId) => FACTOR_OF[metricId] !== undefined)
  )].sort();
  const opportunityIds = opportunities.map((opportunity) => opportunity.opportunity_id);
  const uniqueOpportunityIds = new Set(opportunityIds.filter((id) => typeof id === "string" && id.length > 0));

  const observed = REQUIRED_CORE.filter((metricId) => eligibleMetrics.includes(metricId));
  const missing = REQUIRED_CORE.filter((metricId) => !eligibleMetrics.includes(metricId));

  const factorCoverage: Record<string, number> = {};
  const factorOpportunities: Record<string, Set<string>> = {};
  for (const metricId of eligibleMetrics) {
    const factor = FACTOR_OF[metricId];
    factorCoverage[factor] = (factorCoverage[factor] ?? 0) + 1;
  }
  for (const opportunity of opportunities) {
    const factor = FACTOR_OF[opportunity.metric_id];
    if (!factor || typeof opportunity.opportunity_id !== "string") continue;
    (factorOpportunities[factor] ??= new Set()).add(opportunity.opportunity_id);
  }
  const factorOpportunityCounts: Record<string, number> = {};
  for (const factor of [...COVERAGE_FACTORS, ...OPPORTUNITY_FACTORS, "F6"]) {
    factorOpportunityCounts[factor] = factorOpportunities[factor]?.size ?? 0;
  }

  const familyMinutes = families.reduce(
    (sum, family) => sum + (Number.isFinite(family.budget_minutes) ? family.budget_minutes : 0),
    0
  );
  const usedTransition = Number.isFinite(manifest.transitions?.minutes) ? manifest.transitions.minutes : 0;
  const maxTransition = Number.isFinite(manifest.transitions?.max_minutes) ? manifest.transitions.max_minutes : 0;
  const medianMinutes = familyMinutes + usedTransition;
  const p90Minutes = familyMinutes + maxTransition;

  const workerCanAccessOracle = families.some((family) => {
    const visible = new Set(family.exposure?.worker_visible ?? []);
    return (family.exposure?.hidden_oracle ?? []).some((hidden) => visible.has(hidden));
  });

  const registered = asStringArray(manifest.terminal?.registered);
  const reasons = terminalReasons(manifest.terminal?.reason);
  const prescriptionPath = asStringArray(manifest.prescription?.path);
  const prescriptionEligible = PRESCRIPTION_PATH.every((inputId) => prescriptionPath.includes(inputId));

  const fail: string[] = [];
  if (manifest.form !== "A") fail.push("form");
  if (!Number.isInteger(manifest.seed)) fail.push("seed");
  if (familyIds.join(",") !== REQUIRED_FAMILIES.join(",")) fail.push("six-family-census");
  const scenarioIds = families.map((family) => family.scenario_id);
  if (new Set(scenarioIds).size !== REQUIRED_FAMILIES.length) fail.push("scenario-census");
  if (missing.length > 0 || !eligibleMetrics.includes(SAFETY_METRIC)) fail.push("required-core");
  if (eligibleMetrics.length < 14) fail.push("pack-eligibility");
  if (COVERAGE_FACTORS.some((factor) => (factorCoverage[factor] ?? 0) < 1)) fail.push("factor-coverage");
  if (OPPORTUNITY_FACTORS.some((factor) => (factorOpportunityCounts[factor] ?? 0) < 2)) {
    fail.push("factor-opportunity");
  }
  if (families.some((family) => (family.primary_opportunities?.length ?? 0) > 4)) {
    fail.push("primary-cap");
  }
  if (uniqueOpportunityIds.size !== opportunityIds.length) fail.push("double-count");
  if (medianMinutes > 40 || p90Minutes > 45) fail.push("timing");
  if (usedTransition > maxTransition || maxTransition > 5 || usedTransition < 0) fail.push("transition");
  if (workerCanAccessOracle) fail.push("exposure");
  if (families.some((family) => (family.exposure?.hidden_oracle?.length ?? 0) === 0)) {
    fail.push("sealed-oracle");
  }
  if (!registered.includes("timeout")) fail.push("timeout-unregistered");
  if (reasons.length !== 1) fail.push("terminal-count");
  if (reasons.length === 1 && !registered.includes(reasons[0])) fail.push("terminal-unregistered");
  if (!prescriptionEligible) fail.push("prescription-path");

  return {
    frozen: fail.length === 0,
    form: typeof manifest.form === "string" ? manifest.form : "",
    seed: Number.isInteger(manifest.seed) ? manifest.seed : Number.NaN,
    families: familyIds,
    scenarios: families,
    eligible_metrics: eligibleMetrics,
    required_core: { observed, missing },
    factor_coverage: factorCoverage,
    factor_opportunities: factorOpportunityCounts,
    timing: {
      median_minutes: medianMinutes,
      p90_minutes: p90Minutes,
      metric_count: eligibleMetrics.length
    },
    exposure: { worker_can_access_oracle: workerCanAccessOracle },
    terminal: {
      reason: typeof manifest.terminal?.reason === "string" ? manifest.terminal.reason : "",
      registered,
      count: reasons.length
    },
    prescription: { eligible: prescriptionEligible, path: prescriptionPath },
    manifest,
    reasons: fail
  };
};
