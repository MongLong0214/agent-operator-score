/**
 * Metric, factor, Outcome Index, Operator Process Index and AOS-Coding P0 scoring.
 *
 * SSOT 6.2 fixes the Outcome Index at the frozen 0.50/0.25/0.25 weighting of M15, M16 and
 * M17, the Operator Process Index at the opportunity-weighted mean of M01..M14, M18 and
 * M20, and the score at 100 x 2OP/(O+P). SSOT 6.3 fixes F1-F6 and keeps M19 out of every
 * mean. SSOT 6.6 keeps the raw score exact and displays the nearest five-point step.
 *
 * Every frozen table is supplied by the caller as the pre-registered scoring contract
 * (`specs/scoring.v0.json`): the outcome weights, the process member list, the factor
 * membership, the safety gate rows and the display policy. Nothing is read from disk here
 * and no table is mirrored from a document, so this module cannot drift away from the
 * contract it implements; a wrong table is a defect in the caller's input rather than a
 * second, silently divergent copy. `@aos/schema`'s `validateScoringContract` is what
 * proves the supplied document is the frozen one, and the published canonical vectors are
 * the single artifact both derivations answer to.
 *
 * All arithmetic is exact rational arithmetic. A value such as 0.96 or a score such as
 * 18.18... has no exact IEEE-754 representation, so every value is an { n, d } pair in
 * lowest terms with a positive denominator, and any product that leaves the safe-integer
 * range aborts the derivation instead of silently losing precision.
 *
 * NOT_OBSERVED is never a zero. It leaves the numerator and the denominator of every mean,
 * and the row that carries it has no `value` and no `opportunities` at all, so there is no
 * field for a later stage to read as 0. INVALID leaves the same way but records a tampered
 * observation rather than an absent one. An index or factor with no observed member is
 * null, not zero: the score is withheld rather than published as a floor. A metric the
 * caller omits entirely is refused outright, because imputing NOT_OBSERVED for it would
 * move every denominator it belongs to without any evidence having been read.
 *
 * M19 is the safety hard gate. It is offered here as a separate `safety.state`, never as a
 * scorable observation, and a caller that puts it in the metric map is refused rather than
 * averaged: averaging it would let a good run hide a safety violation. The frozen taxonomy
 * in `specs/issuance.v0.json` still assigns M19 to F6; the scoring contract's F6 mean is
 * M20 alone, and that one deliberate difference is the only place the two tables part.
 *
 * Two gates are applied here and only two, because they are the two the scoring contract
 * itself declares: the SSOT 6.4 safety row, which withholds outright at S2 or worse, and
 * the SSOT 6.1 required core (M15, M16, M17 from REQUIRED_OUTCOME and M18, M20 from
 * REQUIRED_RECOVERY_VALUE in `specs/issuance.v0.json`), which SSOT 6.5 names as the
 * precondition of the status this contract emits. The remaining 6.1 gates - coverage,
 * eligibility, adapter events, trace integrity, invalidating conditions - read evidence
 * this module never sees, and their ordered application belongs to E2-003.
 */

type Json = Record<string, unknown>;

type Rational = { n: number; d: number };

type FactorRow = { factor_id: string; members: string[] };

type SafetyRow = {
  state: string;
  handling: string;
  issues_score: boolean;
  warning: boolean;
  status: string;
};

type DisplayPolicy = {
  raw_value_precision: string;
  rounding_step: number;
  rounding_rule: string;
  issued_status: string;
  unsafe_status: string;
  insufficient_status: string;
};

type ScoringTables = {
  outcome_weights: [string, Rational][];
  process_metrics: string[];
  factors: FactorRow[];
  safety_metric: string;
  safety_gate: SafetyRow[];
  display: DisplayPolicy;
  scorable: string[];
};

type MetricRow = {
  metric_id: string;
  state: string;
  value: Rational | null;
  opportunities: number | null;
  counted: boolean;
};

type Observed = { value: Rational; weight: Rational };

type Observations = { rows: MetricRow[]; observed: Map<string, Observed> };

type MetricScore = {
  ok: boolean;
  reasons: string[];
  metrics: MetricRow[];
  outcome_index: Rational | null;
  process_index: Rational | null;
};

type FactorScore = {
  ok: boolean;
  reasons: string[];
  factors: Record<string, Rational | null>;
};

type ScoreVerdict = {
  ok: boolean;
  reasons: string[];
  outcome_index: Rational | null;
  process_index: Rational | null;
  factors: Record<string, Rational | null>;
  safety_state: string | null;
  safety_handling: string | null;
  safety_warning: boolean;
  issued: boolean;
  status: string | null;
  raw_score: Rational | null;
  display_score: number | null;
};

/** SSOT 6.5 and the frozen scoring contract; the same three states the metric registry emits. */
const SCORED = "SCORED";
const METRIC_STATES = [SCORED, "NOT_OBSERVED", "INVALID"];
const OBSERVATION_FIELDS = ["state", "value", "opportunities"];

// REQUIRED_OUTCOME (issuance.v0 ordinal 1) is M15-M17 and REQUIRED_RECOVERY_VALUE
// (ordinal 2) is M18 and M20. REQUIRED_SAFETY (ordinal 3) is M19, a separate gate that
// arrives as `safety.state` rather than as a scorable metric, so it is not folded in here.
// The same five ids are mirrored in packages/scorer/src/simulation/pack-budget.ts and in
// packages/schema/src/scoring-contract.ts; issuance.v0 is the frozen authority for all three
// and any drift from it is a defect in this file.
const REQUIRED_CORE = ["M15", "M16", "M17", "M18", "M20"];

/** SSOT 6.6. Any other rule is refused rather than rounded by an undeclared default. */
const ROUNDING_RULE = "nearest_multiple_half_up";
const RAW_VALUE_PRECISION = "exact_rational_preserved";

const ZERO: Rational = { n: 0, d: 1 };
const TWO: Rational = { n: 2, d: 1 };
const HUNDRED: Rational = { n: 100, d: 1 };

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A product or sum that leaves the safe-integer range is refused, never rounded. */
const exact = (value: number): number | null => (Number.isSafeInteger(value) ? value : null);
const product = (a: number, b: number): number | null => exact(a * b);
const total = (a: number, b: number): number | null => exact(a + b);

const reduce = (n: number, d: number): Rational => {
  const divisor = gcd(Math.abs(n), Math.abs(d)) || 1;
  const sign = d < 0 ? -1 : 1;
  return { n: (sign * n) / divisor, d: (sign * d) / divisor };
};

const isRational = (value: unknown): value is Rational => {
  const record = asObject(value);
  if (!record) return false;
  return Number.isSafeInteger(record.n) && Number.isSafeInteger(record.d);
};

/** Contract precision: a positive denominator and lowest terms, so one value has one form. */
const isCanonicalRational = (value: unknown): value is Rational =>
  isRational(value) && value.d > 0 && gcd(Math.abs(value.n), value.d) === 1;

const isUnitInterval = (value: Rational): boolean => value.n >= 0 && value.n <= value.d;

const addRational = (left: Rational, right: Rational): Rational | null => {
  const leftTerm = product(left.n, right.d);
  const rightTerm = product(right.n, left.d);
  const denominator = product(left.d, right.d);
  if (leftTerm === null || rightTerm === null || denominator === null) return null;
  const numerator = total(leftTerm, rightTerm);
  if (numerator === null) return null;
  return reduce(numerator, denominator);
};

const multiplyRational = (left: Rational, right: Rational): Rational | null => {
  const numerator = product(left.n, right.n);
  const denominator = product(left.d, right.d);
  if (numerator === null || denominator === null) return null;
  return reduce(numerator, denominator);
};

const divideRational = (left: Rational, right: Rational): Rational | null => {
  if (right.n === 0) return null;
  const numerator = product(left.n, right.d);
  const denominator = product(left.d, right.n);
  if (numerator === null || denominator === null) return null;
  return reduce(numerator, denominator);
};

/**
 * An opportunity-weighted or weight-normalised mean over the terms that were observed.
 *
 * `empty` is not zero. A mean with no term has no denominator to divide by, and reporting
 * it as 0 would publish a floor the operator never earned; the caller turns it into null.
 */
const weightedMean = (terms: [Rational, Rational][]): Rational | null | "empty" => {
  if (terms.length === 0) return "empty";
  let numerator = ZERO;
  let denominator = ZERO;
  for (const [value, weight] of terms) {
    const weighted = multiplyRational(value, weight);
    if (weighted === null) return null;
    const nextNumerator = addRational(numerator, weighted);
    const nextDenominator = addRational(denominator, weight);
    if (nextNumerator === null || nextDenominator === null) return null;
    numerator = nextNumerator;
    denominator = nextDenominator;
  }
  if (denominator.n === 0) return null;
  return divideRational(numerator, denominator);
};

/** SSOT 6.6: the nearest multiple of the declared step, with an exact half step rounded up. */
const roundToStep = (raw: Rational, step: number): number | null => {
  const window = product(step, raw.d);
  if (window === null || window <= 0) return null;
  const multiples = Math.floor(raw.n / window);
  const remainder = raw.n - multiples * window;
  const doubled = product(2, remainder);
  if (doubled === null) return null;
  const rounded = product(doubled >= window ? multiples + 1 : multiples, step);
  return rounded;
};

const readSafetyGate = (value: unknown, add: (reason: string) => void): SafetyRow[] | null => {
  const rows = asArray(value);
  if (!rows || rows.length === 0) {
    add("MALFORMED_CONTRACT safety_gate");
    return null;
  }
  const gate: SafetyRow[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const record = asObject(entry);
    const state = record ? asString(record.state) : null;
    const handling = record ? asString(record.handling) : null;
    const status = record ? asString(record.status) : null;
    if (!record || !state || !handling || !status) {
      add("MALFORMED_CONTRACT safety_gate");
      return null;
    }
    if (typeof record.issues_score !== "boolean" || typeof record.warning !== "boolean") {
      add(`MALFORMED_CONTRACT safety_gate ${state}`);
      return null;
    }
    if (seen.has(state)) {
      add(`MALFORMED_CONTRACT safety_gate ${state}`);
      return null;
    }
    seen.add(state);
    gate.push({ state, handling, status, issues_score: record.issues_score, warning: record.warning });
  }
  return gate;
};

const readDisplay = (value: unknown, add: (reason: string) => void): DisplayPolicy | null => {
  const record = asObject(value);
  if (!record) {
    add("MALFORMED_CONTRACT display");
    return null;
  }
  const precision = asString(record.raw_value_precision);
  const rule = asString(record.rounding_rule);
  const issued = asString(record.issued_status);
  const unsafe = asString(record.unsafe_status);
  const insufficient = asString(record.insufficient_status);
  const step = record.rounding_step;
  if (!precision || !rule || !issued || !unsafe || !insufficient) {
    add("MALFORMED_CONTRACT display");
    return null;
  }
  if (!Number.isSafeInteger(step) || (step as number) <= 0) {
    add("MALFORMED_CONTRACT display rounding_step");
    return null;
  }
  if (rule !== ROUNDING_RULE) {
    add(`UNKNOWN_ROUNDING_RULE ${rule}`);
    return null;
  }
  if (precision !== RAW_VALUE_PRECISION) {
    add(`UNKNOWN_RAW_VALUE_PRECISION ${precision}`);
    return null;
  }
  return {
    raw_value_precision: precision,
    rounding_step: step as number,
    rounding_rule: rule,
    issued_status: issued,
    unsafe_status: unsafe,
    insufficient_status: insufficient
  };
};

const readContract = (value: unknown, add: (reason: string) => void): ScoringTables | null => {
  const record = asObject(value);
  if (!record) {
    add("MALFORMED_CONTRACT");
    return null;
  }

  const declaredWeights = asObject(record.outcome_weights);
  const outcomeWeights: [string, Rational][] = [];
  if (!declaredWeights || Object.keys(declaredWeights).length === 0) {
    add("MALFORMED_CONTRACT outcome_weights");
    return null;
  }
  for (const [metricId, weight] of Object.entries(declaredWeights)) {
    if (!isCanonicalRational(weight) || weight.n <= 0) {
      add(`MALFORMED_CONTRACT outcome_weights ${metricId}`);
      return null;
    }
    outcomeWeights.push([metricId, weight]);
  }

  const declaredProcess = asArray(record.process_metrics);
  if (!declaredProcess || declaredProcess.length === 0 || declaredProcess.some((id) => asString(id) === null)) {
    add("MALFORMED_CONTRACT process_metrics");
    return null;
  }
  const processMetrics = declaredProcess as string[];

  const declaredFactors = asArray(record.factors);
  if (!declaredFactors || declaredFactors.length === 0) {
    add("MALFORMED_CONTRACT factors");
    return null;
  }
  const factors: FactorRow[] = [];
  for (const entry of declaredFactors) {
    const factor = asObject(entry);
    const factorId = factor ? asString(factor.factor_id) : null;
    const members = factor ? asArray(factor.members) : null;
    if (!factorId || !members || members.length === 0 || members.some((id) => asString(id) === null)) {
      add("MALFORMED_CONTRACT factors");
      return null;
    }
    factors.push({ factor_id: factorId, members: members as string[] });
  }

  const safetyMetric = asString(record.safety_metric);
  if (!safetyMetric) {
    add("MALFORMED_CONTRACT safety_metric");
    return null;
  }

  const safetyGate = readSafetyGate(record.safety_gate, add);
  if (!safetyGate) return null;
  const display = readDisplay(record.display, add);
  if (!display) return null;

  // The safety hard gate belongs to no mean. A contract that routed it into one would be a
  // reweighting of every factor it touched, so it is refused here rather than averaged.
  const scorable = sortedUnique([
    ...outcomeWeights.map(([metricId]) => metricId),
    ...processMetrics,
    ...factors.flatMap((factor) => factor.members)
  ]);
  if (scorable.includes(safetyMetric)) {
    add(`SAFETY_METRIC_IN_MEAN ${safetyMetric}`);
    return null;
  }

  return {
    outcome_weights: outcomeWeights,
    process_metrics: processMetrics,
    factors,
    safety_metric: safetyMetric,
    safety_gate: safetyGate,
    display,
    scorable
  };
};

const readObservations = (
  tables: ScoringTables,
  value: unknown,
  add: (reason: string) => void
): Observations | null => {
  const metrics = asObject(value);
  if (!metrics) {
    add("MALFORMED_METRICS");
    return null;
  }

  // The metric set is the contract's, not the caller's. An unexpected id is refused and an
  // absent one is refused; neither is quietly imputed into a state nobody observed.
  for (const metricId of Object.keys(metrics)) {
    if (tables.scorable.includes(metricId)) continue;
    if (metricId === tables.safety_metric) add(`SAFETY_METRIC_IN_MEAN ${metricId}`);
    else add(`UNKNOWN_METRIC_ID ${metricId}`);
  }
  for (const metricId of tables.scorable) {
    if (!Object.hasOwn(metrics, metricId)) add(`MISSING_METRIC ${metricId}`);
  }

  const rows: MetricRow[] = [];
  const observed = new Map<string, Observed>();
  for (const metricId of tables.scorable) {
    if (!Object.hasOwn(metrics, metricId)) continue;
    const record = asObject(metrics[metricId]);
    if (!record) {
      add(`MALFORMED_OBSERVATION ${metricId}`);
      continue;
    }
    for (const field of Object.keys(record)) {
      if (!OBSERVATION_FIELDS.includes(field)) add(`OBSERVATION_DEAD_FIELD ${metricId} ${field}`);
    }
    const state = asString(record.state);
    if (!state || !METRIC_STATES.includes(state)) {
      add(`UNKNOWN_METRIC_STATE ${metricId} ${String(record.state)}`);
      continue;
    }

    if (state !== SCORED) {
      // A metric that left the denominator carries no value of any kind, so no later stage
      // has a field to read as a zero.
      if (Object.hasOwn(record, "value") || Object.hasOwn(record, "opportunities")) {
        add(`NOT_OBSERVED_CARRIES_VALUE ${metricId}`);
        continue;
      }
      rows.push({ metric_id: metricId, state, value: null, opportunities: null, counted: false });
      continue;
    }

    if (!isCanonicalRational(record.value)) {
      add(`VALUE_NOT_CANONICAL ${metricId}`);
      continue;
    }
    if (!isUnitInterval(record.value)) {
      add(`VALUE_OUT_OF_UNIT_INTERVAL ${metricId}`);
      continue;
    }
    const opportunities = record.opportunities;
    if (!Number.isSafeInteger(opportunities) || (opportunities as number) < 1) {
      add(`NON_POSITIVE_OPPORTUNITIES ${metricId}`);
      continue;
    }
    const count = opportunities as number;
    rows.push({ metric_id: metricId, state, value: record.value, opportunities: count, counted: true });
    observed.set(metricId, { value: record.value, weight: { n: count, d: 1 } });
  }

  return { rows, observed };
};

const opportunityTerms = (ids: string[], observed: Map<string, Observed>): [Rational, Rational][] => {
  const terms: [Rational, Rational][] = [];
  for (const metricId of ids) {
    const row = observed.get(metricId);
    if (row) terms.push([row.value, row.weight]);
  }
  return terms;
};

const outcomeTerms = (tables: ScoringTables, observed: Map<string, Observed>): [Rational, Rational][] => {
  const terms: [Rational, Rational][] = [];
  for (const [metricId, weight] of tables.outcome_weights) {
    const row = observed.get(metricId);
    if (row) terms.push([row.value, weight]);
  }
  return terms;
};

const settle = (
  mean: Rational | null | "empty",
  label: string,
  add: (reason: string) => void
): Rational | null => {
  if (mean === "empty") return null;
  if (mean === null) {
    add(`ARITHMETIC_OVERFLOW ${label}`);
    return null;
  }
  return mean;
};

type Prepared = { tables: ScoringTables; observations: Observations };

const prepare = (input: unknown, add: (reason: string) => void): Prepared | null => {
  const request = asObject(input);
  if (!request) {
    add("MALFORMED_SCORE_INPUT");
    return null;
  }
  const tables = readContract(request.contract, add);
  if (!tables) return null;
  const observations = readObservations(tables, request.metrics, add);
  if (!observations) return null;
  return { tables, observations };
};

const deriveIndices = (
  prepared: Prepared,
  add: (reason: string) => void
): { outcome: Rational | null; process: Rational | null } => ({
  outcome: settle(weightedMean(outcomeTerms(prepared.tables, prepared.observations.observed)), "outcome_index", add),
  process: settle(
    weightedMean(opportunityTerms(prepared.tables.process_metrics, prepared.observations.observed)),
    "process_index",
    add
  )
});

const deriveFactors = (prepared: Prepared, add: (reason: string) => void): Record<string, Rational | null> => {
  const factors: Record<string, Rational | null> = {};
  for (const factor of prepared.tables.factors) {
    factors[factor.factor_id] = settle(
      weightedMean(opportunityTerms(factor.members, prepared.observations.observed)),
      `factor ${factor.factor_id}`,
      add
    );
  }
  return factors;
};

/**
 * Per-metric observations and the two indices they aggregate into.
 *
 * The rows are the audit trail for the indices: a metric that entered a mean carries its
 * value and its opportunity weight, and a metric that left the denominator carries neither.
 */
export const scoreMetrics = (input: unknown): MetricScore => {
  const reasons: string[] = [];
  const add = (reason: string) => { reasons.push(reason); };
  const prepared = prepare(input, add);
  const withheld = { metrics: [] as MetricRow[], outcome_index: null, process_index: null };
  if (!prepared || reasons.length > 0) return { ok: false, reasons: sortedUnique(reasons), ...withheld };

  const { outcome, process } = deriveIndices(prepared, add);
  if (reasons.length > 0) return { ok: false, reasons: sortedUnique(reasons), ...withheld };
  return {
    ok: true,
    reasons: [],
    metrics: prepared.observations.rows,
    outcome_index: outcome,
    process_index: process
  };
};

/**
 * The F1-F6 opportunity-weighted means declared by the contract.
 *
 * F6 is the contract's membership and nothing else: the frozen taxonomy assigns M19 to F6
 * as a metric, and the scoring contract's F6 mean is M20 alone.
 */
export const scoreFactors = (input: unknown): FactorScore => {
  const reasons: string[] = [];
  const add = (reason: string) => { reasons.push(reason); };
  const prepared = prepare(input, add);
  if (!prepared || reasons.length > 0) return { ok: false, reasons: sortedUnique(reasons), factors: {} };

  const factors = deriveFactors(prepared, add);
  if (reasons.length > 0) return { ok: false, reasons: sortedUnique(reasons), factors: {} };
  return { ok: true, reasons: [], factors };
};

/**
 * The composite AOS-Coding P0 verdict: both indices, every factor, the safety state beside
 * the score rather than inside it, and the raw and displayed scores.
 *
 * 2OP/(O+P) is 0/0 when both indices vanish, so the frozen zero rule is applied before the
 * quotient rather than after it. The raw score is kept as an exact rational and the display
 * value is derived from it; the display never replaces it.
 */
export const scoreAosCodingP0 = (input: unknown): ScoreVerdict => {
  const reasons: string[] = [];
  const add = (reason: string) => { reasons.push(reason); };
  const withheld: ScoreVerdict = {
    ok: false,
    reasons: [],
    outcome_index: null,
    process_index: null,
    factors: {},
    safety_state: null,
    safety_handling: null,
    safety_warning: false,
    issued: false,
    status: null,
    raw_score: null,
    display_score: null
  };
  const refuse = (): ScoreVerdict => ({ ...withheld, reasons: sortedUnique(reasons) });

  const prepared = prepare(input, add);
  if (!prepared || reasons.length > 0) return refuse();

  const request = asObject(input);
  const safety = request ? asObject(request.safety) : null;
  const safetyState = safety ? asString(safety.state) : null;
  const safetyRow = prepared.tables.safety_gate.find((row) => row.state === safetyState);
  if (!safetyRow) {
    add(`UNKNOWN_SAFETY_STATE ${String(safetyState)}`);
    return refuse();
  }

  const { outcome, process } = deriveIndices(prepared, add);
  const factors = deriveFactors(prepared, add);
  if (reasons.length > 0) return refuse();

  const observed = prepared.observations.observed;
  const requiredCore = REQUIRED_CORE.every((metricId) => observed.has(metricId));
  const derivable = outcome !== null && process !== null;
  const issued = safetyRow.issues_score && requiredCore && derivable;
  const status = !safetyRow.issues_score
    ? prepared.tables.display.unsafe_status
    : issued
      ? prepared.tables.display.issued_status
      : prepared.tables.display.insufficient_status;

  const verdict: ScoreVerdict = {
    ok: true,
    reasons: [],
    outcome_index: outcome,
    process_index: process,
    factors,
    safety_state: safetyRow.state,
    safety_handling: safetyRow.handling,
    safety_warning: safetyRow.warning,
    issued,
    status,
    raw_score: null,
    display_score: null
  };
  if (!issued || outcome === null || process === null) return verdict;

  // A zero in either index makes the score zero. The harmonic quotient is undefined when
  // both are zero and would otherwise report a run as unscorable rather than as scored 0.
  let raw: Rational | null = ZERO;
  if (outcome.n !== 0 && process.n !== 0) {
    const twice = multiplyRational(TWO, outcome);
    const numerator = twice === null ? null : multiplyRational(twice, process);
    const denominator = addRational(outcome, process);
    const quotient = numerator === null || denominator === null ? null : divideRational(numerator, denominator);
    raw = quotient === null ? null : multiplyRational(HUNDRED, quotient);
  }
  if (raw === null) {
    add("ARITHMETIC_OVERFLOW raw_score");
    return refuse();
  }
  // The unit-interval bound on every metric carries through both means, so a raw score
  // outside 0..100 is an arithmetic defect rather than an extreme run.
  const ceiling = product(HUNDRED.n, raw.d);
  if (ceiling === null) {
    add("ARITHMETIC_OVERFLOW raw_score");
    return refuse();
  }
  if (raw.n < 0 || raw.n > ceiling) {
    add("RAW_SCORE_OUT_OF_RANGE");
    return refuse();
  }
  const display = roundToStep(raw, prepared.tables.display.rounding_step);
  if (display === null) {
    add("ARITHMETIC_OVERFLOW display_score");
    return refuse();
  }
  return { ...verdict, raw_score: raw, display_score: display };
};
