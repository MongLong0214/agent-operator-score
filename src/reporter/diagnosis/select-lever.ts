/**
 * Deterministic one-lever selector for SSOT §8.2 rules 1-8 / PRD-E0D requirements 2 and 4.
 *
 * The procedure is a total function of its input. It never generates advice, never returns
 * more than one lever, and where the rules do not reach exactly one answer it returns
 * MANUAL_REVIEW_REQUIRED rather than an arbitrary winner. Every comparison is exact rational
 * arithmetic, so a three-point band means exactly 3/100 and not a float that rounds into or
 * out of it.
 *
 * Absence is MISSING and never an implicit zero: a metric with no observed evidence class,
 * a confidence below 7/10, fewer than two distinct opportunities, or an absent score leaves
 * the candidate set rather than entering it with a default. An empty candidate set is
 * INSUFFICIENT_EVIDENCE, which is not a low score and not a lever.
 *
 * The metric-to-treatment map is supplied by the caller as the pre-registered registry rows
 * (SSOT §8.3, frozen in `specs/treatments.v0.json` and validated by E0D-002). This module
 * derives nothing about a treatment that the registry does not state, and it selects the
 * safety remediation by the registry's own `safety_only_remediation` flag rather than by a
 * hard-coded identifier.
 */

export type Rational = { n: number; d: number };

export type SafetyState = "S0" | "S1" | "S2" | "S3";

export interface MetricObservation {
  metric_id: string;
  evidence_class?: string;
  score?: Rational;
  opportunity_ids?: string[];
}

export interface TreatmentCandidate {
  treatment_id: string;
  metric_ids: string[];
  cost: { time: Rational; tokens: Rational; maintenance: Rational };
  permission_delta: string[];
  safety_only_remediation: boolean;
}

export interface PrescriptionCase {
  case_id: string;
  safety_state: SafetyState;
  metrics: MetricObservation[];
  treatments: TreatmentCandidate[];
}

export type SelectionOutcome =
  | "SAFETY_REMEDIATION"
  | "PRIMARY_CONSTRAINT"
  | "INSUFFICIENT_EVIDENCE"
  | "MANUAL_REVIEW_REQUIRED";

export interface Selection {
  outcome: SelectionOutcome;
  reason: string;
  factor_id: string | null;
  metric_id: string | null;
  treatment_id: string | null;
  lever_count: number;
  trace: string[];
}

const CANONICAL_METRIC_IDS = Array.from(
  { length: 20 },
  (_, index) => `M${String(index + 1).padStart(2, "0")}`
);

// SSOT §4.1. M19 is the safety hard gate and §6.3 keeps it out of the scored factors, so it
// is never an ordinary lever; F6 carries M20 alone.
const FACTOR_OF: Record<string, string> = {
  M01: "F1", M02: "F1", M03: "F1", M04: "F1",
  M05: "F2", M06: "F2", M07: "F2",
  M08: "F3", M09: "F3", M10: "F3", M11: "F3",
  M12: "F4", M13: "F4", M14: "F4",
  M15: "F5", M16: "F5", M17: "F5", M18: "F5",
  M20: "F6"
};

const SAFETY_METRIC_ID = "M19";
const CANONICAL_FACTOR_IDS = ["F1", "F2", "F3", "F4", "F5", "F6"];
// SSOT §8.2 rule 4. Verification and recovery, then state failure, are closed first.
const FACTOR_PRIORITY = ["F5", "F4", "F1", "F2", "F3", "F6"];

// SSOT §8.2 evidence confidence table, frozen by E0D-001.
const CONFIDENCE_OF: Record<string, Rational> = {
  hidden_oracle: { n: 1, d: 1 },
  signed_or_hashed_trace: { n: 9, d: 10 },
  declared_adapter_event: { n: 4, d: 5 },
  immutable_artifact: { n: 7, d: 10 },
  operator_claim: { n: 0, d: 1 }
};
const CONFIDENCE_THRESHOLD: Rational = { n: 7, d: 10 };
const OPPORTUNITY_MINIMUM = 2;
const TIE_BAND: Rational = { n: 3, d: 100 };

const SAFETY_STATES = ["S0", "S1", "S2", "S3"];
const SCORE_STOPPING_STATES = ["S2", "S3"];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const reduce = (n: number, d: number): Rational => {
  const divisor = gcd(Math.abs(n), Math.abs(d)) || 1;
  return { n: n / divisor, d: d / divisor };
};

const add = (left: Rational, right: Rational): Rational =>
  reduce(left.n * right.d + right.n * left.d, left.d * right.d);

const subtract = (left: Rational, right: Rational): Rational =>
  reduce(left.n * right.d - right.n * left.d, left.d * right.d);

const scaleByInteger = (value: Rational, factor: number): Rational =>
  reduce(value.n * factor, value.d);

const divideByInteger = (value: Rational, divisor: number): Rational =>
  reduce(value.n, value.d * divisor);

const isBelow = (left: Rational, right: Rational): boolean => left.n * right.d < right.n * left.d;

const isAtMost = (left: Rational, right: Rational): boolean => left.n * right.d <= right.n * left.d;

const areEqual = (left: Rational, right: Rational): boolean => left.n * right.d === right.n * left.d;

const format = (value: Rational): string => `${value.n}/${value.d}`;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCanonicalRational = (value: unknown): value is Rational =>
  isPlainRecord(value) &&
  typeof value.n === "number" && Number.isInteger(value.n) &&
  typeof value.d === "number" && Number.isInteger(value.d) && value.d > 0 &&
  gcd(Math.abs(value.n), value.d) === 1;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const abstain = (reason: string, trace: string[]): Selection => ({
  outcome: "MANUAL_REVIEW_REQUIRED",
  reason,
  factor_id: null,
  metric_id: null,
  treatment_id: null,
  lever_count: 0,
  trace
});

type Eligible = { metricId: string; factorId: string; gap: Rational; weight: number };

const readTreatments = (value: unknown): TreatmentCandidate[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const rows: TreatmentCandidate[] = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) return null;
    const { treatment_id: id, metric_ids: metricIds, cost, permission_delta: permissionDelta } = entry;
    if (typeof id !== "string" || id === "" || seen.has(id)) return null;
    if (!isStringArray(metricIds) || metricIds.length === 0) return null;
    if (!isStringArray(permissionDelta)) return null;
    if (typeof entry.safety_only_remediation !== "boolean") return null;
    if (!isPlainRecord(cost)) return null;
    for (const part of ["time", "tokens", "maintenance"]) {
      const component = cost[part];
      if (!isCanonicalRational(component) || component.n < 0) return null;
    }
    seen.add(id);
    rows.push(entry as unknown as TreatmentCandidate);
  }
  return rows;
};

const readMetrics = (value: unknown): MetricObservation[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const rows: MetricObservation[] = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) return null;
    const id = entry.metric_id;
    if (typeof id !== "string" || id === "" || seen.has(id)) return null;
    seen.add(id);
    rows.push(entry as unknown as MetricObservation);
  }
  return rows;
};

// One metric, one verdict. Order matters only because the decision trace records the first
// rule that removed the metric, and a trace that names a different rule on a re-run would
// not be a deterministic trace.
const excludeReason = (observation: MetricObservation): string | null => {
  const id = observation.metric_id;
  if (id === SAFETY_METRIC_ID) return "SAFETY_METRIC";
  if (!Object.hasOwn(FACTOR_OF, id)) return "UNKNOWN_METRIC";
  if (!Object.hasOwn(observation, "evidence_class")) return "NOT_OBSERVED";
  const evidenceClass = observation.evidence_class;
  if (typeof evidenceClass !== "string" || !Object.hasOwn(CONFIDENCE_OF, evidenceClass)) {
    return "UNKNOWN_EVIDENCE_CLASS";
  }
  if (isBelow(CONFIDENCE_OF[evidenceClass], CONFIDENCE_THRESHOLD)) return "CONFIDENCE_BELOW_THRESHOLD";
  const opportunityIds = observation.opportunity_ids;
  if (!isStringArray(opportunityIds) || new Set(opportunityIds).size < OPPORTUNITY_MINIMUM) {
    return "OPPORTUNITY_BELOW_MINIMUM";
  }
  if (!Object.hasOwn(observation, "score")) return "SCORE_MISSING";
  const score = observation.score;
  if (!isCanonicalRational(score) || score.n < 0 || score.n > score.d) return "SCORE_OUT_OF_RANGE";
  return null;
};

const costTotal = (treatment: TreatmentCandidate): Rational =>
  add(add(treatment.cost.time, treatment.cost.tokens), treatment.cost.maintenance);

export const selectPrimaryConstraint = (input: unknown): Selection => {
  const trace: string[] = [];
  if (!isPlainRecord(input)) return abstain("CASE_NOT_AN_OBJECT", trace);

  const safetyState = input.safety_state;
  if (typeof safetyState !== "string" || !SAFETY_STATES.includes(safetyState)) {
    return abstain("UNKNOWN_SAFETY_STATE", trace);
  }
  const treatments = readTreatments(input.treatments);
  if (treatments === null) return abstain("TREATMENT_TABLE_INVALID", trace);
  const metrics = readMetrics(input.metrics);
  if (metrics === null) return abstain("METRIC_TABLE_INVALID", trace);
  trace.push(`safety ${safetyState}`);

  // SSOT §8.2 rule 1. The score and every ordinary lever stop here; only the registered
  // safety remediation is emitted, and if the registry does not name exactly one the
  // procedure abstains rather than picking one.
  if (SCORE_STOPPING_STATES.includes(safetyState)) {
    const safetyRows = treatments.filter((row) => row.safety_only_remediation === true);
    if (safetyRows.length !== 1 || safetyRows[0].metric_ids.length !== 1) {
      return abstain("SAFETY_REMEDIATION_UNAVAILABLE", trace);
    }
    trace.push(`safety_remediation ${safetyRows[0].treatment_id}`);
    return {
      outcome: "SAFETY_REMEDIATION",
      reason: "SAFETY_FIRST",
      factor_id: null,
      metric_id: safetyRows[0].metric_ids[0],
      treatment_id: safetyRows[0].treatment_id,
      lever_count: 1,
      trace
    };
  }

  // SSOT §8.2 rule 2. Canonical metric order, not input order, so the same case in a
  // different order yields the same trace.
  const byId = new Map(metrics.map((entry) => [entry.metric_id, entry]));
  const outside = metrics
    .map((entry) => entry.metric_id)
    .filter((id) => !CANONICAL_METRIC_IDS.includes(id))
    .sort();
  const eligible: Eligible[] = [];
  for (const id of [...CANONICAL_METRIC_IDS, ...outside]) {
    const observation = byId.get(id);
    if (!observation) continue;
    const excluded = excludeReason(observation);
    if (excluded !== null) {
      trace.push(`metric ${id} excluded ${excluded}`);
      continue;
    }
    const gap = subtract({ n: 1, d: 1 }, observation.score as Rational);
    const weight = new Set(observation.opportunity_ids as string[]).size;
    trace.push(`metric ${id} eligible gap ${format(gap)} weight ${weight}`);
    eligible.push({ metricId: id, factorId: FACTOR_OF[id], gap, weight });
  }

  if (eligible.length === 0) {
    return {
      outcome: "INSUFFICIENT_EVIDENCE",
      reason: "NO_ELIGIBLE_CANDIDATE",
      factor_id: null,
      metric_id: null,
      treatment_id: null,
      lever_count: 0,
      trace
    };
  }

  // SSOT §6.3 and §8.2 rule 3. A factor's normalized gap is the opportunity-weighted mean of
  // the gaps of its eligible metrics; an ineligible metric contributes neither value nor
  // weight, which is what keeps a missing observation from reading as a perfect one.
  const factorGaps: { factorId: string; gap: Rational }[] = [];
  for (const factorId of CANONICAL_FACTOR_IDS) {
    const members = eligible.filter((entry) => entry.factorId === factorId);
    if (members.length === 0) continue;
    let weighted: Rational = { n: 0, d: 1 };
    let weightTotal = 0;
    for (const member of members) {
      weighted = add(weighted, scaleByInteger(member.gap, member.weight));
      weightTotal += member.weight;
    }
    const gap = divideByInteger(weighted, weightTotal);
    factorGaps.push({ factorId, gap });
    trace.push(`factor ${factorId} gap ${format(gap)}`);
  }

  // SSOT §8.2 rule 4. The largest gap opens the band; a factor within three points of it is
  // tied with it, and the frozen priority order picks from the band. Priority never reaches
  // a factor outside the band, so a high-priority factor with a small gap does not win.
  let widest = factorGaps[0].gap;
  for (const entry of factorGaps) if (isBelow(widest, entry.gap)) widest = entry.gap;
  const band = factorGaps.filter((entry) => isAtMost(subtract(widest, entry.gap), TIE_BAND));
  trace.push(`band ${band.map((entry) => entry.factorId).join(",")}`);
  const banded = new Set(band.map((entry) => entry.factorId));
  const selectedFactor = FACTOR_PRIORITY.find((factorId) => banded.has(factorId)) as string;
  trace.push(`factor ${selectedFactor} selected`);

  // SSOT §8.2 rule 5. The lowest scoring metric inside the selected factor is the largest
  // gap inside it; authoritative evidence was already required by the eligibility filter.
  const withinFactor = eligible.filter((entry) => entry.factorId === selectedFactor);
  let deepest = withinFactor[0].gap;
  for (const entry of withinFactor) if (isBelow(deepest, entry.gap)) deepest = entry.gap;
  const lowest = withinFactor.filter((entry) => areEqual(entry.gap, deepest));
  if (lowest.length !== 1) {
    trace.push(`metric ambiguous ${lowest.map((entry) => entry.metricId).join(",")}`);
    return { ...abstain("AMBIGUOUS_METRIC_MINIMUM", trace), factor_id: selectedFactor };
  }
  const selectedMetric = lowest[0].metricId;
  trace.push(`metric ${selectedMetric} selected`);

  // SSOT §8.2 rules 6 and 7. Exactly one treatment comes out of the pre-registered map. Where
  // the map offers more than one for the same metric the lower total cost wins, then the
  // smaller permission surface; a candidate equal on both is not resolved by identifier order,
  // because that would be an arbitrary prescription under a deterministic name.
  const candidates = treatments
    .filter((row) => row.safety_only_remediation === false && row.metric_ids.includes(selectedMetric))
    .sort((left, right) => (left.treatment_id < right.treatment_id ? -1 : 1));
  if (candidates.length === 0) {
    return {
      ...abstain("NO_REGISTERED_TREATMENT", trace),
      factor_id: selectedFactor,
      metric_id: selectedMetric
    };
  }
  for (const candidate of candidates) {
    trace.push(
      `treatment ${candidate.treatment_id} cost ${format(costTotal(candidate))} permission ${candidate.permission_delta.length}`
    );
  }

  let cheapest = costTotal(candidates[0]);
  for (const candidate of candidates) {
    const total = costTotal(candidate);
    if (isBelow(total, cheapest)) cheapest = total;
  }
  const byCost = candidates.filter((candidate) => areEqual(costTotal(candidate), cheapest));
  const leastPermission = Math.min(...byCost.map((candidate) => candidate.permission_delta.length));
  const finalists = byCost.filter((candidate) => candidate.permission_delta.length === leastPermission);
  if (finalists.length !== 1) {
    trace.push(`treatment ambiguous ${finalists.map((candidate) => candidate.treatment_id).join(",")}`);
    return {
      ...abstain("AMBIGUOUS_TREATMENT", trace),
      factor_id: selectedFactor,
      metric_id: selectedMetric
    };
  }
  trace.push(`treatment ${finalists[0].treatment_id} selected`);

  return {
    outcome: "PRIMARY_CONSTRAINT",
    reason: "DETERMINISTIC_SELECTION",
    factor_id: selectedFactor,
    metric_id: selectedMetric,
    treatment_id: finalists[0].treatment_id,
    lever_count: 1,
    trace
  };
};
