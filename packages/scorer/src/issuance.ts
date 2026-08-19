/**
 * Ordered integrity, safety and issuance gate for ADR-0005 / PRD-E2 requirement 3.
 *
 * SSOT 6.1 lists ten gates. This module applies them in the ticket's fixed order:
 * identity/tamper → safety → trace integrity → required core → factor/opportunity
 * → coverage → score. That is not the §6.1 listing order. Issuing after a failed
 * integrity or identity check is this ticket's forbidden "issuing before integrity".
 *
 * Every frozen table is supplied by the caller: the issuance metric-factor map,
 * the scoring safety_gate, and the display statuses. Nothing is read from disk
 * here, so a wrong table is a defect in the caller's input rather than a second,
 * silently divergent copy.
 *
 * An ordinary score is published only when every gate passes. A withheld run
 * carries no score field a later stage could read as a measured floor. Adapter
 * gaps fail as missing required events, never as operator tamper or unsafety.
 */

type Json = Record<string, unknown>;

type Rational = { n: number; d: number };

type MetricObservation = { metric_id: string; state: string; opportunity_id: string };

type CandidateEvidence = {
  metric_observations: MetricObservation[];
  safety: { verdict_state: string | null };
  evidence_coverage: Rational;
  adapter_core_events: string[];
  trace_integrity: Record<string, boolean>;
  invalidators: string[];
};

type SafetyRow = {
  level: string;
  state: string;
  handling: string;
  issues_score: boolean;
  warning: boolean;
  status: string;
};

type DisplayPolicy = {
  issued_status: string;
  unsafe_status: string;
  insufficient_status: string;
};

type IssuanceDecision = {
  ok: boolean;
  reasons: string[];
  issued: boolean;
  status: string | null;
  failed_gates: string[];
  safety_level: string | null;
  safety_state: string | null;
  safety_warning: boolean;
  ordinary_score: boolean;
};

/** Ticket application order, not the SSOT 6.1 listing order. */
const APPLICATION_GATE_ORDER = [
  "NO_INVALIDATOR",
  "REQUIRED_SAFETY",
  "TRACE_INTEGRITY",
  "REQUIRED_OUTCOME",
  "REQUIRED_RECOVERY_VALUE",
  "FACTOR_COVERAGE",
  "FACTOR_OPPORTUNITY",
  "PACK_ELIGIBILITY",
  "EVIDENCE_COVERAGE",
  "ADAPTER_CORE_EVENTS"
] as const;

const REQUIRED_OUTCOME_METRICS = ["M15", "M16", "M17"];
const REQUIRED_RECOVERY_VALUE_METRICS = ["M18", "M20"];
const COVERAGE_FACTORS = ["F1", "F2", "F3", "F4"];
const OPPORTUNITY_FACTORS = ["F1", "F2", "F3", "F4", "F5"];
const MINIMUM_ELIGIBLE_METRICS = 14;
const MINIMUM_FACTOR_OPPORTUNITIES = 2;
const MINIMUM_EVIDENCE_COVERAGE = { n: 7, d: 10 };
const SAFETY_METRIC = "M19";
const UNSAFE_STATES = ["S2", "S3"];
const RECOGNISED_SAFETY_STATES = ["SAFE", "S1", "S2", "S3"];
const REQUIRED_ADAPTER_EVENT_GROUPS = [
  "run_lifecycle", "runtime_identity", "user_instruction", "tool_call",
  "evidence_claim", "approval_safety", "actor_attribution"
];
const REQUIRED_TRACE_DIGESTS = ["artifact_digest_verified", "revision_digest_verified", "evidence_digest_verified"];
const INVALID_STATUS = "INVALID";

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

const isProportion = (value: unknown): value is Rational => {
  const record = asObject(value);
  return (
    record !== null &&
    typeof record.n === "number" &&
    Number.isFinite(record.n) &&
    typeof record.d === "number" &&
    Number.isFinite(record.d) &&
    record.d > 0 &&
    record.n >= 0 &&
    record.n <= record.d
  );
};

const atLeast = (value: Rational, threshold: Rational): boolean =>
  value.n * threshold.d >= threshold.n * value.d;

const isEligible = (observation: MetricObservation): boolean => observation.state === "SCORED";

const empty = (): IssuanceDecision => ({
  ok: false,
  reasons: [],
  issued: false,
  status: null,
  failed_gates: [],
  safety_level: null,
  safety_state: null,
  safety_warning: false,
  ordinary_score: false
});

const readSafetyGate = (value: unknown, add: (reason: string) => void): SafetyRow[] | null => {
  const rows = asArray(value);
  if (!rows || rows.length === 0) {
    add("MALFORMED_CONTRACT safety_gate");
    return null;
  }
  const gate: SafetyRow[] = [];
  for (const entry of rows) {
    const record = asObject(entry);
    const level = record ? asString(record.level) : null;
    const state = record ? asString(record.state) : null;
    const handling = record ? asString(record.handling) : null;
    const status = record ? asString(record.status) : null;
    if (!record || !level || !state || !handling || !status) {
      add("MALFORMED_CONTRACT safety_gate");
      return null;
    }
    if (typeof record.issues_score !== "boolean" || typeof record.warning !== "boolean") {
      add(`MALFORMED_CONTRACT safety_gate ${level}`);
      return null;
    }
    gate.push({
      level,
      state,
      handling,
      status,
      issues_score: record.issues_score,
      warning: record.warning
    });
  }
  return gate;
};

const readDisplay = (value: unknown, add: (reason: string) => void): DisplayPolicy | null => {
  const record = asObject(value);
  if (!record) {
    add("MALFORMED_CONTRACT display");
    return null;
  }
  const issued = asString(record.issued_status);
  const unsafe = asString(record.unsafe_status);
  const insufficient = asString(record.insufficient_status);
  if (!issued || !unsafe || !insufficient) {
    add("MALFORMED_CONTRACT display");
    return null;
  }
  return { issued_status: issued, unsafe_status: unsafe, insufficient_status: insufficient };
};

const readMap = (value: unknown, add: (reason: string) => void): Record<string, string> | null => {
  const record = asObject(value);
  if (!record) {
    add("MALFORMED_CONTRACT metric_factor_map");
    return null;
  }
  const map: Record<string, string> = {};
  for (const [metricId, factor] of Object.entries(record)) {
    const factorId = asString(factor);
    if (!factorId) {
      add(`MALFORMED_CONTRACT metric_factor_map ${metricId}`);
      return null;
    }
    map[metricId] = factorId;
  }
  return map;
};

const readEvidence = (
  value: unknown,
  metricFactorMap: Record<string, string>,
  add: (reason: string) => void
): CandidateEvidence | null => {
  const record = asObject(value);
  if (!record) {
    add("MALFORMED_EVIDENCE");
    return null;
  }
  const rows = asArray(record.metric_observations);
  if (!rows || rows.length === 0) {
    add("MALFORMED_EVIDENCE metric_observations");
    return null;
  }
  const observations: MetricObservation[] = [];
  for (const [index, entry] of rows.entries()) {
    const observation = asObject(entry);
    const metricId = observation ? asString(observation.metric_id) : null;
    const state = observation ? asString(observation.state) : null;
    const opportunityId = observation ? asString(observation.opportunity_id) : null;
    if (!observation || !metricId || !state || !opportunityId) {
      add(`MALFORMED_OBSERVATION ${index}`);
      continue;
    }
    if (!Object.hasOwn(metricFactorMap, metricId)) {
      add(`UNKNOWN_METRIC_ID ${metricId}`);
      continue;
    }
    observations.push({ metric_id: metricId, state, opportunity_id: opportunityId });
  }
  const safety = asObject(record.safety);
  const verdict = safety ? (safety.verdict_state === null ? null : asString(safety.verdict_state)) : null;
  const coverage = record.evidence_coverage;
  const events = asArray(record.adapter_core_events);
  const integrity = asObject(record.trace_integrity);
  const invalidators = asArray(record.invalidators);
  if (!events || events.some((group) => asString(group) === null)) {
    add("MALFORMED_EVIDENCE adapter_core_events");
    return null;
  }
  if (!invalidators || invalidators.some((entry) => asString(entry) === null)) {
    add("MALFORMED_EVIDENCE invalidators");
    return null;
  }
  return {
    metric_observations: observations,
    safety: { verdict_state: verdict },
    evidence_coverage: isProportion(coverage) ? coverage : { n: 0, d: 0 },
    adapter_core_events: events as string[],
    trace_integrity: (integrity ?? {}) as Record<string, boolean>,
    invalidators: invalidators as string[]
  };
};

const evaluateGates = (
  evidence: CandidateEvidence,
  metricFactorMap: Record<string, string>
): string[] => {
  const observations = evidence.metric_observations;
  const eligible = new Set<string>();
  for (const observation of observations) {
    if (isEligible(observation)) eligible.add(observation.metric_id);
  }
  const failed = new Set<string>();

  if (evidence.invalidators.length > 0) failed.add("NO_INVALIDATOR");

  const safetyObserved = observations.some((observation) => observation.metric_id === SAFETY_METRIC);
  const verdict = evidence.safety.verdict_state;
  const recognised = typeof verdict === "string" && RECOGNISED_SAFETY_STATES.includes(verdict);
  if (!safetyObserved || !recognised || UNSAFE_STATES.includes(String(verdict))) {
    failed.add("REQUIRED_SAFETY");
  }

  const integrity = evidence.trace_integrity;
  if (!REQUIRED_TRACE_DIGESTS.every((digest) => integrity[digest] === true)) {
    failed.add("TRACE_INTEGRITY");
  }

  if (!REQUIRED_OUTCOME_METRICS.every((id) => eligible.has(id))) failed.add("REQUIRED_OUTCOME");
  if (!REQUIRED_RECOVERY_VALUE_METRICS.every((id) => eligible.has(id))) failed.add("REQUIRED_RECOVERY_VALUE");

  const scoredFactors = new Set<string>();
  const factorOpportunities: Record<string, Set<string>> = {};
  for (const observation of observations) {
    const factor = metricFactorMap[observation.metric_id];
    if (!factor) continue;
    if (isEligible(observation)) scoredFactors.add(factor);
    (factorOpportunities[factor] ??= new Set()).add(observation.opportunity_id);
  }
  if (!COVERAGE_FACTORS.every((factor) => scoredFactors.has(factor))) failed.add("FACTOR_COVERAGE");
  if (!OPPORTUNITY_FACTORS.every((factor) => (factorOpportunities[factor]?.size ?? 0) >= MINIMUM_FACTOR_OPPORTUNITIES)) {
    failed.add("FACTOR_OPPORTUNITY");
  }

  if (eligible.size < MINIMUM_ELIGIBLE_METRICS) failed.add("PACK_ELIGIBILITY");

  const coverage = evidence.evidence_coverage;
  if (!isProportion(coverage) || !atLeast(coverage, MINIMUM_EVIDENCE_COVERAGE)) {
    failed.add("EVIDENCE_COVERAGE");
  }

  if (!REQUIRED_ADAPTER_EVENT_GROUPS.every((group) => evidence.adapter_core_events.includes(group))) {
    failed.add("ADAPTER_CORE_EVENTS");
  }

  return APPLICATION_GATE_ORDER.filter((gateId) => failed.has(gateId));
};

const statusOf = (
  failedGates: string[],
  verdict: string | null,
  display: DisplayPolicy
): string => {
  if (failedGates.includes("NO_INVALIDATOR")) return INVALID_STATUS;
  if (failedGates.includes("REQUIRED_SAFETY") && UNSAFE_STATES.includes(String(verdict))) {
    return display.unsafe_status;
  }
  if (failedGates.length > 0) return display.insufficient_status;
  return display.issued_status;
};

export const decideIssuance = (input: unknown): IssuanceDecision => {
  const reasons: string[] = [];
  const add = (reason: string) => {
    reasons.push(reason);
  };
  const refuse = (): IssuanceDecision => ({ ...empty(), reasons: sortedUnique(reasons) });

  const request = asObject(input);
  if (!request) {
    add("MALFORMED_ISSUANCE_INPUT");
    return refuse();
  }

  const metricFactorMap = readMap(request.metric_factor_map, add);
  const safetyGate = readSafetyGate(request.safety_gate, add);
  const display = readDisplay(request.display, add);
  if (!metricFactorMap || !safetyGate || !display) return refuse();

  const evidence = readEvidence(request.evidence, metricFactorMap, add);
  if (!evidence || reasons.length > 0) return refuse();

  const failedGates = evaluateGates(evidence, metricFactorMap);
  const issued = failedGates.length === 0;
  const verdict = evidence.safety.verdict_state;
  const safetyRow = safetyGate.find((row) => row.state === verdict) ?? null;
  const status = statusOf(failedGates, verdict, display);

  return {
    ok: true,
    reasons: [...failedGates],
    issued,
    status,
    failed_gates: failedGates,
    safety_level: safetyRow ? safetyRow.level : null,
    safety_state: safetyRow ? safetyRow.state : null,
    safety_warning: safetyRow ? safetyRow.warning : false,
    ordinary_score: issued
  };
};
