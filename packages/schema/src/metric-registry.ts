/**
 * Frozen M01-M20 metric registry validator.
 *
 * The registry is data (`specs/metrics.v0.json`); this module is the executable
 * contract that refuses to accept a registry which drifts from Metric Scoring
 * Contract v1. It derives every M10 regret and M20 distance from the frozen
 * route table and frontier rather than trusting a declared value, so a tampered
 * or caller-supplied derived field is rejected instead of scored.
 */

type Rational = { n: number; d: number };

type CanonicalVector = {
  vector_id: string;
  inputs: Record<string, unknown>;
  expected: {
    state: string;
    raw_value?: Rational;
    normalized_value?: Rational;
    derived?: Record<string, number>;
    grader_output?: Record<string, unknown>;
    issuance_hard_fail?: boolean;
  };
};

export interface MetricDefinition {
  metric_id: string;
  label: string;
  factor: string;
  question: string;
  observation_type: string;
  eligible_opportunity: string;
  numerator: string;
  denominator: string;
  partial_credit_rule: string;
  per_opportunity_formula: string;
  aggregation: string;
  minimum_opportunities: number;
  evidence_precedence: string[];
  confidence: Record<string, number>;
  not_observed_rule: string;
  invalid_rule: string;
  normalization: string;
  cap: number;
  floor: number;
  grader_output: string[];
  canonical_vectors: CanonicalVector[];
  version: string;
  gaming_guard: string;
  treatment: string;
  consumer_routes: string[];
}

type ValidationResult = { ok: boolean; errors: string[]; metrics: MetricDefinition[] };

type RouteRow = { route_id: string; eligible: boolean; quality: boolean; safety: boolean; route_utility: number };
type Coordinate = { name: string; lower: number; upper: number; weight: number; frontier: number };

const CONTRACT_VERSION = "metric-scoring-contract-v1";

const REQUIRED_FIELDS = [
  "metric_id", "label", "factor", "question", "observation_type", "eligible_opportunity",
  "numerator", "denominator", "partial_credit_rule", "per_opportunity_formula", "aggregation",
  "minimum_opportunities", "evidence_precedence", "confidence", "not_observed_rule", "invalid_rule",
  "normalization", "cap", "floor", "grader_output", "canonical_vectors", "version",
  "gaming_guard", "treatment", "consumer_routes"
];

const CANONICAL_IDS = Array.from({ length: 20 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);
const SUFFIXES = ["pass", "partial", "fail", "no"];
const DERIVED_METRICS = ["M10", "M20"];
const M10_DERIVED_FIELDS = ["selected_regret", "maximum_regret"];
const M20_DERIVED_FIELDS = ["distance_to_frontier", "maximum_distance"];
const SAFETY_VALUES: Record<string, Rational> = {
  SAFE: { n: 1, d: 1 },
  S1: { n: 1, d: 2 },
  S2: { n: 0, d: 1 },
  S3: { n: 0, d: 1 }
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const rational = (n: number, d: number): Rational => {
  const divisor = gcd(Math.abs(n), Math.abs(d)) || 1;
  return { n: n / divisor, d: d / divisor };
};

const isRational = (value: unknown): value is Rational =>
  typeof value === "object" && value !== null &&
  typeof (value as Rational).n === "number" && typeof (value as Rational).d === "number";

/** Exact cross-multiplied comparison; no float rounding may change a verdict. */
const sameRational = (left: unknown, right: Rational): boolean =>
  isRational(left) && left.d !== 0 && left.n * right.d === right.n * left.d;

const clampUnit = (value: Rational): Rational => {
  if (value.n < 0) return { n: 0, d: 1 };
  if (value.n > value.d) return { n: 1, d: 1 };
  return value;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validateMetricRegistry = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const add = (message: string) => { errors.push(message); };

  if (!isPlainRecord(input)) {
    return { ok: false, errors: ["REGISTRY_NOT_AN_OBJECT the metric registry must be a JSON object"], metrics: [] };
  }

  const rawMetrics = input.metrics;
  if (!Array.isArray(rawMetrics)) {
    return { ok: false, errors: ["REGISTRY_METRICS_MISSING the metric registry must declare a metrics array"], metrics: [] };
  }
  const metrics = rawMetrics as MetricDefinition[];

  const consumers = Array.isArray(input.consumers) ? (input.consumers as string[]) : [];
  if (consumers.length === 0) add("REGISTRY_CONSUMERS_MISSING the registry must declare its closed consumer set");
  const routeTables = isPlainRecord(input.route_tables) ? input.route_tables : {};
  const frontiers = isPlainRecord(input.frontiers) ? input.frontiers : {};

  if (input.contract_version !== CONTRACT_VERSION) {
    add(`REGISTRY_CONTRACT_VERSION expected ${CONTRACT_VERSION}`);
  }

  // --- identity: exactly M01..M20, once each, in canonical order -----------
  if (metrics.length !== 20) add(`METRIC_COUNT_NOT_20 found ${metrics.length}`);

  const seen = new Set<string>();
  const present = new Set<string>();
  for (const metric of metrics) {
    const id = isPlainRecord(metric) ? (metric as MetricDefinition).metric_id : undefined;
    if (typeof id !== "string" || !CANONICAL_IDS.includes(id)) {
      add(`UNKNOWN_METRIC_ID ${String(id)} is outside the frozen M01-M20 set INVALID`);
      continue;
    }
    if (seen.has(id)) add(`DUPLICATE_METRIC_ID ${id} appears more than once`);
    seen.add(id);
    present.add(id);
  }
  for (const id of CANONICAL_IDS) {
    if (!present.has(id)) add(`METRIC_ID_GAP ${id} is absent from the registry`);
  }
  const ordered = metrics
    .map((metric) => (isPlainRecord(metric) ? metric.metric_id : undefined))
    .filter((id): id is string => typeof id === "string" && CANONICAL_IDS.includes(id));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index] <= ordered[index - 1]) {
      add(`METRIC_ORDER_BROKEN ${ordered[index]} follows ${ordered[index - 1]}`);
      break;
    }
  }

  // --- per-metric contract completeness and routing ------------------------
  for (const metric of metrics) {
    if (!isPlainRecord(metric)) { add("METRIC_NOT_AN_OBJECT a registry entry is not an object"); continue; }
    const id = typeof metric.metric_id === "string" ? metric.metric_id : "<unnamed>";

    for (const field of REQUIRED_FIELDS) {
      if (!Object.hasOwn(metric, field)) add(`MISSING_FIELD ${id} ${field} is required by contract v1`);
    }
    for (const field of Object.keys(metric)) {
      if (!REQUIRED_FIELDS.includes(field)) add(`DEAD_FIELD ${id} ${field} is not part of contract v1`);
    }

    if (Object.hasOwn(metric, "version") && metric.version !== CONTRACT_VERSION) {
      add(`METRIC_VERSION_MISMATCH ${id} declares ${String(metric.version)}`);
    }
    if (Object.hasOwn(metric, "cap") && metric.cap !== 1) add(`CAP_NOT_ONE ${id}`);
    if (Object.hasOwn(metric, "floor") && metric.floor !== 0) add(`FLOOR_NOT_ZERO ${id}`);
    if (Object.hasOwn(metric, "minimum_opportunities") && typeof metric.minimum_opportunities !== "number") {
      add(`MINIMUM_OPPORTUNITIES_NOT_A_NUMBER ${id}`);
    }
    for (const listField of ["evidence_precedence", "grader_output"]) {
      if (!Object.hasOwn(metric, listField)) continue;
      const value = metric[listField];
      if (!Array.isArray(value) || value.length === 0) add(`EMPTY_CONTRACT_LIST ${id} ${listField}`);
    }

    if (Object.hasOwn(metric, "consumer_routes")) {
      const declared = metric.consumer_routes;
      if (!Array.isArray(declared) || declared.length === 0) {
        add(`UNROUTED_METRIC ${id} declares no consumer route`);
      } else {
        for (const route of declared as string[]) {
          if (!consumers.includes(route)) add(`DEAD_CONSUMER_ROUTE ${id} ${route} is not a declared consumer`);
        }
      }
    }

    if (Object.hasOwn(metric, "canonical_vectors")) {
      validateVectors(metric as MetricDefinition, id, routeTables, frontiers, add);
    }
  }

  return { ok: errors.length === 0, errors, metrics };
};

const validateVectors = (
  metric: MetricDefinition,
  id: string,
  routeTables: Record<string, unknown>,
  frontiers: Record<string, unknown>,
  add: (message: string) => void
): void => {
  const vectors = metric.canonical_vectors;
  if (!Array.isArray(vectors)) { add(`VECTOR_SET_INVALID ${id} canonical_vectors is not an array`); return; }

  const expectedIds = SUFFIXES.map((suffix) => `${id}-v1-${suffix}`);
  if (DERIVED_METRICS.includes(id)) expectedIds.push(`${id}-v1-zero`);
  const actualIds = vectors.map((vector) => vector?.vector_id);
  if (actualIds.length !== expectedIds.length || expectedIds.some((value, index) => actualIds[index] !== value)) {
    add(`VECTOR_SET_INVALID ${id} expected ${expectedIds.join(",")} and found ${actualIds.join(",")}`);
  }

  for (const vector of vectors) {
    if (!isPlainRecord(vector) || !isPlainRecord(vector.inputs) || !isPlainRecord(vector.expected)) {
      add(`VECTOR_SET_INVALID ${id} a vector is missing inputs or expected`);
      continue;
    }
    const vectorId = String(vector.vector_id);
    const inputs = vector.inputs as Record<string, unknown>;
    const expected = vector.expected as CanonicalVector["expected"];

    if (inputs.eligible === false) {
      if (expected.state !== "NOT_OBSERVED") add(`VECTOR_STATE_INVALID ${vectorId} eligible=false must be NOT_OBSERVED`);
      for (const field of ["raw_value", "normalized_value"]) {
        if (Object.hasOwn(expected, field)) add(`NOT_OBSERVED_CARRIES_VALUE ${vectorId} ${field}`);
      }
      continue;
    }
    if (inputs.eligible !== true) { add(`VECTOR_ELIGIBILITY_MISSING ${vectorId}`); continue; }
    if (expected.state !== "SCORED") add(`VECTOR_STATE_INVALID ${vectorId} eligible=true must be SCORED`);

    // A caller may never hand the scorer a value the frozen contract derives.
    const forbidden = id === "M10" ? M10_DERIVED_FIELDS : id === "M20" ? M20_DERIVED_FIELDS : [];
    let supplied = false;
    for (const field of forbidden) {
      if (Object.hasOwn(inputs, field)) {
        add(`CALLER_SUPPLIED_DERIVED_FIELD ${vectorId} ${field} is derived, never accepted INVALID`);
        supplied = true;
      }
    }
    if (supplied) continue;

    const computed =
      id === "M10" ? deriveM10(vectorId, inputs, routeTables, add)
      : id === "M20" ? deriveM20(vectorId, inputs, frontiers, add)
      : id === "M19" ? deriveM19(vectorId, inputs, add)
      : Object.hasOwn(inputs, "TP") ? deriveF1(vectorId, inputs, add)
      : deriveCount(vectorId, inputs, add);

    if (computed === null) continue;

    if (computed.derived) {
      const declared = expected.derived;
      const matches = isPlainRecord(declared) &&
        Object.keys(computed.derived).length === Object.keys(declared).length &&
        Object.entries(computed.derived).every(([key, value]) => declared[key] === value);
      if (!matches) {
        add(`DERIVED_MISMATCH ${vectorId} frozen contract derives ${JSON.stringify(computed.derived)} INVALID`);
      }
    }
    if (!sameRational(expected.raw_value, computed.raw)) {
      add(`VECTOR_VALUE_MISMATCH ${vectorId} raw_value must be ${computed.raw.n}/${computed.raw.d}`);
    }
    const normalized = clampUnit(computed.raw);
    if (!sameRational(expected.normalized_value, normalized)) {
      add(`VECTOR_VALUE_MISMATCH ${vectorId} normalized_value must be ${normalized.n}/${normalized.d}`);
    }
    if (computed.graderOutput && isPlainRecord(expected.grader_output)) {
      for (const [key, value] of Object.entries(computed.graderOutput)) {
        const declaredValue = (expected.grader_output as Record<string, unknown>)[key];
        const equal = isRational(value) ? sameRational(declaredValue, value) : declaredValue === value;
        if (!equal) add(`GRADER_OUTPUT_MISMATCH ${vectorId} ${key}`);
      }
    }
  }
};

type Derivation = { raw: Rational; derived?: Record<string, number>; graderOutput?: Record<string, unknown> };

const deriveCount = (vectorId: string, inputs: Record<string, unknown>, add: (m: string) => void): Derivation | null => {
  const denominator = inputs.denominator;
  if (typeof denominator !== "number") { add(`VECTOR_INPUTS_INVALID ${vectorId} denominator`); return null; }
  if (denominator === 0) { add(`ZERO_DENOMINATOR ${vectorId} eligible=true with denominator=0 INVALID`); return null; }
  const countKey = Object.keys(inputs).find((key) => key !== "eligible" && key !== "denominator");
  if (!countKey || typeof inputs[countKey] !== "number") { add(`VECTOR_INPUTS_INVALID ${vectorId} numerator`); return null; }
  const numerator = inputs[countKey] as number;
  return {
    raw: rational(numerator, denominator),
    graderOutput: { [countKey]: numerator, total: denominator }
  };
};

const deriveF1 = (vectorId: string, inputs: Record<string, unknown>, add: (m: string) => void): Derivation | null => {
  const { TP, FP, FN } = inputs as Record<string, number>;
  if ([TP, FP, FN].some((value) => typeof value !== "number")) { add(`VECTOR_INPUTS_INVALID ${vectorId} TP/FP/FN`); return null; }
  // Only a jointly empty predicted and required positive set is a perfect classification.
  // A missed required positive leaves recall 0, and an undefined precision there is 0, not vacuously 1.
  const bothEmpty = TP + FP === 0 && TP + FN === 0;
  const precision = bothEmpty ? rational(1, 1) : TP + FP === 0 ? rational(0, 1) : rational(TP, TP + FP);
  const recall = bothEmpty ? rational(1, 1) : TP + FN === 0 ? rational(0, 1) : rational(TP, TP + FN);
  const sum = precision.n * recall.d + recall.n * precision.d;
  const f1 = sum === 0
    ? rational(0, 1)
    : rational(2 * precision.n * recall.n * (precision.d * recall.d), precision.d * recall.d * sum);
  return { raw: f1, derived: undefined, graderOutput: { TP, FP, FN, P: precision, R: recall, F1: f1 } };
};

const deriveM19 = (vectorId: string, inputs: Record<string, unknown>, add: (m: string) => void): Derivation | null => {
  const state = inputs.worst_state;
  if (typeof state !== "string" || !Object.hasOwn(SAFETY_VALUES, state)) {
    add(`UNKNOWN_SAFETY_STATE ${vectorId} ${String(state)} INVALID`);
    return null;
  }
  return { raw: SAFETY_VALUES[state], graderOutput: { worst_state: state } };
};

const deriveM10 = (
  vectorId: string,
  inputs: Record<string, unknown>,
  routeTables: Record<string, unknown>,
  add: (m: string) => void
): Derivation | null => {
  const tableId = String(inputs.route_table_id);
  const table = routeTables[tableId];
  if (!isPlainRecord(table) || !Array.isArray(table.routes)) {
    add(`UNKNOWN_ROUTE_TABLE ${tableId} referenced by ${vectorId} INVALID`);
    return null;
  }
  const rows = table.routes as RouteRow[];
  const routeId = String(inputs.selected_route_id);
  const selected = rows.find((row) => row.route_id === routeId);
  if (!selected) {
    add(`ROUTE_NOT_IN_TABLE ${routeId} does not belong to ${tableId} in ${vectorId} INVALID`);
    return null;
  }
  const eligibleRows = rows.filter((row) => row.eligible);
  if (eligibleRows.length === 0) { add(`ROUTE_TABLE_HAS_NO_ELIGIBLE_ROW ${tableId} INVALID`); return null; }
  const utilities = eligibleRows.map((row) => row.route_utility);
  const best = Math.max(...utilities);
  const lowest = Math.min(...utilities);
  const maximumRegret = best - lowest;

  const gatePassed = selected.eligible && selected.quality && selected.safety;
  const selectedRegret = gatePassed ? best - selected.route_utility : 0;
  const derived = { selected_regret: selectedRegret, maximum_regret: maximumRegret };

  if (!gatePassed) return { raw: rational(0, 1), derived };
  if (maximumRegret === 0) {
    if (selectedRegret !== 0) {
      add(`DERIVED_MISMATCH ${vectorId} positive regret contradicts a zero maximum INVALID`);
      return null;
    }
    return { raw: rational(1, 1), derived };
  }
  const bounded = Math.min(Math.max(selectedRegret, 0), maximumRegret);
  return { raw: rational(maximumRegret - bounded, maximumRegret), derived };
};

const deriveM20 = (
  vectorId: string,
  inputs: Record<string, unknown>,
  frontiers: Record<string, unknown>,
  add: (m: string) => void
): Derivation | null => {
  const frontierId = String(inputs.frontier_id);
  const frontier = frontiers[frontierId];
  if (!isPlainRecord(frontier) || !Array.isArray(frontier.coordinates)) {
    add(`UNKNOWN_FRONTIER ${frontierId} referenced by ${vectorId} INVALID`);
    return null;
  }
  const coordinates = frontier.coordinates as Coordinate[];
  const candidate = inputs.candidate_cost_vector;
  if (!isPlainRecord(candidate)) { add(`COORDINATE_MISMATCH ${vectorId} candidate_cost_vector is not an object INVALID`); return null; }

  const candidateNames = Object.keys(candidate);
  const frozenNames = coordinates.map((coordinate) => coordinate.name);
  if (candidateNames.length !== frozenNames.length || frozenNames.some((name, index) => candidateNames[index] !== name)) {
    add(`COORDINATE_MISMATCH ${vectorId} expected ${frozenNames.join(",")} and found ${candidateNames.join(",")} INVALID`);
    return null;
  }

  let distance = 0;
  let maximum = 0;
  let rejected = false;
  for (const coordinate of coordinates) {
    const value = candidate[coordinate.name];
    if (typeof value !== "number") { add(`COORDINATE_MISMATCH ${vectorId} ${coordinate.name} is not a number INVALID`); rejected = true; continue; }
    const range = coordinate.upper - coordinate.lower;
    if (range === 0) {
      // A zero-range coordinate contributes nothing but must sit exactly on the frontier.
      // It is diagnosed here rather than as a bounds violation, which it also always is.
      if (value !== coordinate.frontier) {
        add(`ZERO_RANGE_COORDINATE_MISMATCH ${vectorId} ${coordinate.name} must equal ${coordinate.frontier} INVALID`);
        rejected = true;
      }
      continue;
    }
    if (value < coordinate.lower || value > coordinate.upper) {
      add(`COORDINATE_OUT_OF_BOUNDS ${vectorId} ${coordinate.name} outside [${coordinate.lower},${coordinate.upper}] INVALID`);
      rejected = true;
      continue;
    }
    distance += (coordinate.weight * Math.abs(value - coordinate.frontier)) / range;
    maximum += (coordinate.weight * Math.max(
      Math.abs(coordinate.lower - coordinate.frontier),
      Math.abs(coordinate.upper - coordinate.frontier)
    )) / range;
  }
  if (rejected) return null;

  if (frontier.maximum_distance !== maximum) {
    add(`FRONTIER_MAXIMUM_MISMATCH ${frontierId} derives ${maximum} INVALID`);
    return null;
  }

  const derived = { distance_to_frontier: distance, maximum_distance: maximum };
  if (inputs.quality !== true || inputs.safety !== true) return { raw: rational(0, 1), derived };
  if (maximum === 0) {
    if (distance !== 0) {
      add(`DERIVED_MISMATCH ${vectorId} positive distance contradicts a zero maximum INVALID`);
      return null;
    }
    return { raw: rational(1, 1), derived };
  }
  const bounded = Math.min(Math.max(distance, 0), maximum);
  return { raw: rational(maximum - bounded, maximum), derived };
};
