import { createHash } from "node:crypto";

type Json = Record<string, unknown>;

type ThresholdKey =
  | "median_minutes_max"
  | "p90_minutes_max"
  | "eligible_metrics_min"
  | "primary_opportunities_per_scenario_max";

type ThresholdRow = {
  key: ThresholdKey;
  limit: number;
  observed: number;
  status: "PASS" | "FAIL";
};

const VERSION = "aos-preflight.v0";

// Structural refusal. A record that is not a complete {spec, assumptions, simulation} triple
// cannot be given a verdict at all, and rendering a FAIL for it would imply the pack was
// examined. Throwing keeps the gate closed without manufacturing evidence.
const REFUSAL = "Preflight input is not a complete simulation record.";

const HUMAN_DATA = "human_data: none; this report does not claim human calibration.";

// E0C-002 takes the median analytically and the p90 empirically, and the two are not
// interchangeable. Every preregistered family is a symmetric triangular, so the exact median
// of their sum is the sum of the per-family centres and lands on 40 with no Monte Carlo
// error; the seeded p50 of the same thousand rows is 40.0346, which would read the 40-minute
// threshold as breached on sampling noise alone. This gate reports the analytic value and
// says so. The exactness is conditional, so ASYMMETRIC_DISTRIBUTION below blocks the freeze
// the moment a family stops being symmetric rather than letting the claim quietly go stale.
const MEDIAN_SOURCE = "median_source: analytic; the median is the sum of the six symmetric triangular family centres, which is exact for a sum of symmetric distributions. The seeded p50 of the same rows is higher and is not used.";

// The frozen registry is M01-M20. A pack that fails cannot be made to pass by declaring
// fewer metrics, so the declared width is rendered on every path and a narrower spec blocks.
const METRIC_REGISTRY_SIZE = 20;

// Symmetry is compared with a tolerance because the preregistered edges are decimal literals
// that do not land exactly in binary. The tolerance is far below any minute-scale asymmetry a
// real assumption edit would introduce.
const SYMMETRY_TOLERANCE = 1e-9;

const THRESHOLD_ORDER: { key: ThresholdKey; direction: "max" | "min"; kind: "minutes" | "count" }[] = [
  { key: "median_minutes_max", direction: "max", kind: "minutes" },
  { key: "p90_minutes_max", direction: "max", kind: "minutes" },
  { key: "eligible_metrics_min", direction: "min", kind: "count" },
  { key: "primary_opportunities_per_scenario_max", direction: "max", kind: "count" }
];

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

const asArray = (value: unknown): unknown[] | null => Array.isArray(value) ? value : null;

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

// Transcribed from packages/scorer/src/simulation/pack-budget.ts. The gate has to be able to
// recompute the simulator's manifest digest from the inputs it was handed, and importing the
// simulator would make the reporter depend on the package it is auditing. Any drift between
// this canonicaliser and the simulator's is a defect in one of the two files, and it surfaces
// as DIGEST_MISMATCH on a record that is in fact intact.
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Json;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

const minutes = (value: number): string => value.toFixed(6);

const readThreshold = (source: Json | null, key: ThresholdKey): number | null =>
  asFiniteNumber(asObject(source?.thresholds)?.[key]);

export const renderPreflightReport = (input: unknown): string => {
  const record = asObject(input);
  const spec = asObject(record?.spec);
  const assumptions = asObject(record?.assumptions);
  const simulation = asObject(record?.simulation);
  if (!spec || !assumptions || !simulation) throw new Error(REFUSAL);

  const reasons: string[] = [];

  // --- identity of the frozen inputs -------------------------------------------------
  const inputDigest = digest({ spec, assumptions });
  const recordedDigest = asString(simulation.manifest_digest) ?? "";
  const simulationReasons = (asArray(simulation.reasons) ?? []).map((entry) => String(entry));
  if (!asArray(simulation.reasons)) reasons.push("SIMULATION_MALFORMED");
  const rawRows = asArray(simulation.raw_rows) ?? [];
  if (rawRows.length === 0) reasons.push("NO_RAW_ROWS");

  const recomputedDigest = digest({
    seed: simulation.seed,
    spec,
    assumptions,
    median_minutes: simulation.median_minutes,
    p90_minutes: simulation.p90_minutes,
    eligible_metrics: simulation.eligible_metrics,
    reasons: simulationReasons,
    raw_rows: rawRows
  });
  if (recomputedDigest !== recordedDigest) reasons.push("DIGEST_MISMATCH");

  // --- seed identity ------------------------------------------------------------------
  const declaredSeed = asFiniteNumber(assumptions.seed);
  const simulationSeed = asFiniteNumber(simulation.seed);
  const seedOk = declaredSeed !== null
    && Number.isInteger(declaredSeed)
    && declaredSeed >= 0
    && simulationSeed === declaredSeed;
  if (!seedOk) reasons.push("SEED_POLICY");

  // --- declared pack width ------------------------------------------------------------
  const declaredMetrics = new Set<string>();
  for (const budget of asArray(spec.family_budgets) ?? []) {
    for (const metric of asArray(asObject(budget)?.primary_metrics) ?? []) {
      const metricId = asString(metric);
      if (metricId) declaredMetrics.add(metricId);
    }
  }
  if (declaredMetrics.size < METRIC_REGISTRY_SIZE) {
    reasons.push(`METRIC_DELETION ${declaredMetrics.size}`);
  }

  // --- assumptions, and the symmetry the analytic median depends on --------------------
  const scenarios = asArray(assumptions.scenarios) ?? [];
  const assumptionLines: string[] = [];
  let maxPrimaryOpportunities = 0;
  for (const scenarioValue of scenarios) {
    const scenario = asObject(scenarioValue);
    if (!scenario) {
      reasons.push("MALFORMED_SCENARIO");
      continue;
    }
    const scenarioId = asString(scenario.scenario_id) ?? "unknown";
    const familyId = asString(scenario.family_id) ?? "unknown";
    const distribution = asObject(scenario.distribution);
    const low = asFiniteNumber(distribution?.low_minutes);
    const mode = asFiniteNumber(distribution?.mode_minutes);
    const high = asFiniteNumber(distribution?.high_minutes);
    const opportunities = asArray(scenario.primary_opportunities) ?? [];
    maxPrimaryOpportunities = Math.max(maxPrimaryOpportunities, opportunities.length);

    if (distribution?.kind !== "triangular" || low === null || mode === null || high === null) {
      reasons.push(`DISTRIBUTION_KIND ${familyId}`);
      assumptionLines.push(`scenario ${scenarioId} family ${familyId} triangular unreadable opportunities ${opportunities.length}`);
    } else {
      if (Math.abs((high - mode) - (mode - low)) > SYMMETRY_TOLERANCE) {
        reasons.push(`ASYMMETRIC_DISTRIBUTION ${familyId}`);
      }
      assumptionLines.push(
        `scenario ${scenarioId} family ${familyId} triangular low ${minutes(low)} mode ${minutes(mode)} high ${minutes(high)} opportunities ${opportunities.length}`
      );
    }
    for (const opportunityValue of opportunities) {
      const opportunity = asObject(opportunityValue);
      const opportunityId = asString(opportunity?.opportunity_id) ?? "unknown";
      const metricId = asString(opportunity?.metric_id) ?? "unknown";
      assumptionLines.push(`opportunity ${scenarioId} ${opportunityId} ${metricId}`);
    }
  }

  // --- every threshold, evaluated here rather than taken on trust ----------------------
  // The simulator does not police primary_opportunities_per_scenario_max at all, so a gate
  // that only echoed simulation.reasons would freeze a scenario carrying five primaries.
  const observedFor: Record<ThresholdKey, number> = {
    median_minutes_max: asFiniteNumber(simulation.median_minutes) ?? Number.NaN,
    p90_minutes_max: asFiniteNumber(simulation.p90_minutes) ?? Number.NaN,
    eligible_metrics_min: asFiniteNumber(simulation.eligible_metrics) ?? Number.NaN,
    primary_opportunities_per_scenario_max: maxPrimaryOpportunities
  };

  const thresholdRows: ThresholdRow[] = [];
  const thresholdLines: string[] = [];
  for (const { key, direction, kind } of THRESHOLD_ORDER) {
    const specLimit = readThreshold(spec, key);
    const assumedLimit = readThreshold(assumptions, key);
    if (specLimit === null || assumedLimit === null) {
      reasons.push(`THRESHOLD_MISSING ${key}`);
    } else if (specLimit !== assumedLimit) {
      reasons.push(`THRESHOLD_DISAGREEMENT ${key}`);
    }
    // The contract is the authority when the two copies disagree; the assumptions file may
    // not loosen a threshold the spec froze.
    const limit = specLimit ?? assumedLimit ?? Number.NaN;
    const observed = observedFor[key];
    const held = Number.isFinite(limit)
      && Number.isFinite(observed)
      && (direction === "max" ? observed <= limit : observed >= limit);
    const status: "PASS" | "FAIL" = held ? "PASS" : "FAIL";
    if (!held) reasons.push(`THRESHOLD ${key}`);
    thresholdRows.push({ key, limit, observed, status });
    const format = (value: number) => kind === "minutes" ? minutes(value) : String(value);
    thresholdLines.push(`threshold ${key} limit ${format(limit)} observed ${format(observed)} status ${status}`);
  }

  // --- the simulator's own refusals are carried, never summarised away ------------------
  for (const entry of simulationReasons) reasons.push(`SIMULATION ${entry}`);
  if (typeof simulation.ok === "boolean" && simulation.ok !== (simulationReasons.length === 0)) {
    reasons.push("SIMULATION_SELF_CONTRADICTION");
  }

  const uniqueReasons = [...new Set(reasons)];
  const verdict = uniqueReasons.length === 0 ? "PASS" : "FAIL";
  const freeze = verdict === "PASS" ? "ELIGIBLE" : "BLOCKED";
  const rawRowsDigest = digest(rawRows);

  const decision = {
    version: VERSION,
    verdict,
    form_a_freeze: freeze,
    seed: declaredSeed,
    simulation_seed: simulationSeed,
    policy_class: asString(assumptions.policy_class) ?? "unknown",
    input_digest: inputDigest,
    manifest_digest: recordedDigest,
    manifest_digest_recomputed: recomputedDigest,
    declared_metrics: declaredMetrics.size,
    eligible_metrics: observedFor.eligible_metrics_min,
    raw_rows: rawRows.length,
    raw_rows_digest: rawRowsDigest,
    thresholds: thresholdRows,
    reasons: uniqueReasons
  };

  const rowLines: string[] = [];
  for (const rowValue of rawRows) {
    const row = asObject(rowValue);
    const trial = asFiniteNumber(row?.trial);
    const total = asFiniteNumber(row?.minutes);
    const families = asObject(row?.families) ?? {};
    // Family keys are sorted rather than taken in insertion order so a record that survived a
    // re-serialisation renders the same bytes as the one the simulator produced.
    const breakdown = Object.keys(families).sort()
      .map((familyId) => `${familyId} ${minutes(asFiniteNumber(families[familyId]) ?? Number.NaN)}`)
      .join(" ");
    rowLines.push(`row ${trial === null ? "unknown" : String(trial)} total ${minutes(total ?? Number.NaN)} ${breakdown}`.trimEnd());
  }

  return [
    "AOS-PREFLIGHT",
    `version: ${VERSION}`,
    `verdict: ${verdict}`,
    `form_a_freeze: ${freeze}`,
    `seed: ${declaredSeed === null ? "unknown" : String(declaredSeed)}`,
    `simulation_seed: ${simulationSeed === null ? "unknown" : String(simulationSeed)}`,
    `policy_class: ${decision.policy_class}`,
    `input_digest: ${inputDigest}`,
    `output_digest: ${digest(decision)}`,
    `manifest_digest: ${recordedDigest}`,
    `manifest_digest_recomputed: ${recomputedDigest}`,
    `declared_metrics: ${declaredMetrics.size}`,
    `eligible_metrics: ${Number.isFinite(observedFor.eligible_metrics_min) ? String(observedFor.eligible_metrics_min) : "unknown"}`,
    `raw_rows: ${rawRows.length}`,
    `raw_rows_digest: ${rawRowsDigest}`,
    HUMAN_DATA,
    MEDIAN_SOURCE,
    "",
    "## thresholds",
    ...thresholdLines,
    "",
    "## assumptions",
    `assumption seed ${declaredSeed === null ? "unknown" : String(declaredSeed)}`,
    `assumption policy_class ${decision.policy_class}`,
    ...THRESHOLD_ORDER.map(({ key }) => {
      const declared = readThreshold(assumptions, key);
      return `assumption threshold ${key} ${declared === null ? "unknown" : String(declared)}`;
    }),
    ...assumptionLines,
    "",
    "## reasons",
    ...(uniqueReasons.length === 0 ? ["reason none"] : uniqueReasons.map((entry) => `reason ${entry}`)),
    "",
    "## raw rows",
    ...rowLines
  ].join("\n");
};
