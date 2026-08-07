/**
 * Frozen score-issuance predicate for AOS-Coding P0.
 *
 * SSOT §6.1 refuses to issue a score on coverage alone: fourteen eligible metrics
 * and 70% evidence coverage are necessary but not sufficient, because a run can
 * inflate its score by letting the hard metrics fall out as NOT_OBSERVED. This
 * module encodes all ten gates and derives each candidate's verdict from its
 * evidence, so a frozen document that claims a coverage-only candidate is issuable
 * is rejected rather than believed.
 *
 * NOT_OBSERVED is never a zero. It leaves the eligibility denominator instead of
 * entering it as a failure, so missing adapter data is reported as missing
 * evidence and never as operator failure.
 */

type Rational = { n: number; d: number };
type MetricState = "SCORED" | "NOT_OBSERVED" | "INVALID";

type MetricObservation = { metric_id: string; state: MetricState; opportunity_id: string; raw_value?: Rational };

type CandidateEvidence = {
  metric_observations: MetricObservation[];
  factor_opportunities: Record<string, string[]>;
  safety: { opportunity_present: boolean; verdict_state: string | null };
  evidence_coverage: Rational;
  adapter_core_events: string[];
  trace_integrity: Record<string, boolean>;
  invalidators: string[];
};

type CandidateVerdict = { issuable: boolean; failed_gates: string[] };

export interface IssuanceRequirement {
  gate_id: string;
  ordinal: number;
  source_clause: string;
  statement: string;
  predicate: string;
  failure_mode: string;
}

type ValidationResult = {
  ok: boolean;
  errors: string[];
  requirements: IssuanceRequirement[];
  candidates: Record<string, CandidateVerdict>;
};

const CONTRACT_VERSION = "issuance-contract-v0";

/** Canonical SSOT §6.1 enumeration order; every failed_gates list is reported in it. */
const GATE_IDS = [
  "REQUIRED_OUTCOME",
  "REQUIRED_RECOVERY_VALUE",
  "REQUIRED_SAFETY",
  "FACTOR_COVERAGE",
  "FACTOR_OPPORTUNITY",
  "PACK_ELIGIBILITY",
  "EVIDENCE_COVERAGE",
  "ADAPTER_CORE_EVENTS",
  "TRACE_INTEGRITY",
  "NO_INVALIDATOR"
];

const REQUIREMENT_FIELDS = ["gate_id", "ordinal", "source_clause", "statement", "predicate", "failure_mode"];

const REQUIRED_OUTCOME_METRICS = ["M15", "M16", "M17"];
const REQUIRED_RECOVERY_VALUE_METRICS = ["M18", "M20"];
const COVERAGE_FACTORS = ["F1", "F2", "F3", "F4"];
const OPPORTUNITY_FACTORS = ["F1", "F2", "F3", "F4", "F5"];
const MINIMUM_ELIGIBLE_METRICS = 14;
const MINIMUM_FACTOR_OPPORTUNITIES = 2;
const MINIMUM_EVIDENCE_COVERAGE = { n: 7, d: 10 };
const REQUIRED_ADAPTER_EVENT_GROUPS = [
  "run_lifecycle",
  "runtime_identity",
  "user_instruction",
  "tool_call",
  "evidence_claim",
  "approval_safety",
  "actor_attribution"
];
const REQUIRED_TRACE_DIGESTS = ["artifact_digest_verified", "revision_digest_verified", "evidence_digest_verified"];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRational = (value: unknown): value is Rational =>
  isPlainRecord(value) && typeof value.n === "number" && typeof value.d === "number" && value.d !== 0;

/** Exact cross-multiplied comparison; a coverage threshold is never decided by float rounding. */
const atLeast = (value: Rational, threshold: Rational): boolean => value.n * threshold.d >= threshold.n * value.d;

/**
 * A NOT_OBSERVED metric is absent, not failed: it leaves the eligibility
 * denominator rather than entering it as a zero.
 */
const isEligible = (observation: MetricObservation): boolean => observation.state === "SCORED";

const observedIds = (evidence: CandidateEvidence): Set<string> => {
  const ids = new Set<string>();
  for (const observation of evidence.metric_observations) {
    if (isEligible(observation)) ids.add(observation.metric_id);
  }
  return ids;
};

const evaluateGates = (evidence: CandidateEvidence, metricFactorMap: Record<string, string>): string[] => {
  const eligible = observedIds(evidence);
  const failed: string[] = [];

  if (!REQUIRED_OUTCOME_METRICS.every((id) => eligible.has(id))) failed.push("REQUIRED_OUTCOME");
  if (!REQUIRED_RECOVERY_VALUE_METRICS.every((id) => eligible.has(id))) failed.push("REQUIRED_RECOVERY_VALUE");

  const safety = evidence.safety;
  const safetyPresent = isPlainRecord(safety) && safety.opportunity_present === true &&
    typeof safety.verdict_state === "string" && safety.verdict_state.length > 0;
  if (!safetyPresent) failed.push("REQUIRED_SAFETY");

  const scoredFactors = new Set<string>();
  for (const observation of evidence.metric_observations) {
    if (isEligible(observation)) scoredFactors.add(metricFactorMap[observation.metric_id]);
  }
  if (!COVERAGE_FACTORS.every((factor) => scoredFactors.has(factor))) failed.push("FACTOR_COVERAGE");

  const opportunities = isPlainRecord(evidence.factor_opportunities) ? evidence.factor_opportunities : {};
  const independentEnough = OPPORTUNITY_FACTORS.every((factor) => {
    const declared = opportunities[factor];
    return Array.isArray(declared) && new Set(declared).size >= MINIMUM_FACTOR_OPPORTUNITIES;
  });
  if (!independentEnough) failed.push("FACTOR_OPPORTUNITY");

  if (eligible.size < MINIMUM_ELIGIBLE_METRICS) failed.push("PACK_ELIGIBILITY");

  const coverage = evidence.evidence_coverage;
  if (!isRational(coverage) || !atLeast(coverage, MINIMUM_EVIDENCE_COVERAGE)) failed.push("EVIDENCE_COVERAGE");

  const events = Array.isArray(evidence.adapter_core_events) ? evidence.adapter_core_events : [];
  if (!REQUIRED_ADAPTER_EVENT_GROUPS.every((group) => events.includes(group))) failed.push("ADAPTER_CORE_EVENTS");

  const integrity = isPlainRecord(evidence.trace_integrity) ? evidence.trace_integrity : {};
  if (!REQUIRED_TRACE_DIGESTS.every((digest) => integrity[digest] === true)) failed.push("TRACE_INTEGRITY");

  const invalidators = Array.isArray(evidence.invalidators) ? evidence.invalidators : [];
  if (invalidators.length > 0) failed.push("NO_INVALIDATOR");

  return GATE_IDS.filter((gateId) => failed.includes(gateId));
};

export const validateIssuanceContract = (input: unknown): ValidationResult => {
  const errors: string[] = [];
  const add = (message: string) => { errors.push(message); };
  const empty = { requirements: [] as IssuanceRequirement[], candidates: {} as Record<string, CandidateVerdict> };

  if (!isPlainRecord(input)) {
    return { ok: false, errors: ["CONTRACT_NOT_AN_OBJECT the issuance contract must be a JSON object"], ...empty };
  }
  if (!Array.isArray(input.requirements)) {
    return { ok: false, errors: ["CONTRACT_REQUIREMENTS_MISSING the contract must declare a requirements array"], ...empty };
  }
  if (input.contract_version !== CONTRACT_VERSION) {
    add(`CONTRACT_VERSION expected ${CONTRACT_VERSION}`);
  }

  const requirements = input.requirements as IssuanceRequirement[];
  const metricFactorMap = isPlainRecord(input.metric_factor_map)
    ? (input.metric_factor_map as Record<string, string>)
    : {};
  if (Object.keys(metricFactorMap).length === 0) {
    add("CONTRACT_METRIC_FACTOR_MAP_MISSING the contract must map every metric to its factor");
  }

  // --- the ten gates: exactly once each, in canonical §6.1 order ------------
  if (requirements.length !== 10) add(`REQUIREMENT_COUNT_NOT_10 found ${requirements.length}`);

  const seen = new Set<string>();
  for (const requirement of requirements) {
    const gateId = isPlainRecord(requirement) ? requirement.gate_id : undefined;
    if (typeof gateId !== "string" || !GATE_IDS.includes(gateId)) {
      add(`UNKNOWN_GATE_ID ${String(gateId)} is outside the frozen SSOT 6.1 gate set`);
      continue;
    }
    if (seen.has(gateId)) add(`DUPLICATE_GATE_ID ${gateId} appears more than once`);
    seen.add(gateId);
  }
  for (const gateId of GATE_IDS) {
    if (!seen.has(gateId)) add(`GATE_ID_GAP ${gateId} is absent from the contract`);
  }

  for (const [index, requirement] of requirements.entries()) {
    if (!isPlainRecord(requirement)) { add("REQUIREMENT_NOT_AN_OBJECT a contract entry is not an object"); continue; }
    const gateId = typeof requirement.gate_id === "string" ? requirement.gate_id : "<unnamed>";
    for (const field of REQUIREMENT_FIELDS) {
      if (!Object.hasOwn(requirement, field)) add(`MISSING_FIELD ${gateId} ${field} is required by the issuance contract`);
    }
    for (const field of Object.keys(requirement)) {
      if (!REQUIREMENT_FIELDS.includes(field)) add(`DEAD_FIELD ${gateId} ${field} is not part of the issuance contract`);
    }
    const canonicalIndex = GATE_IDS.indexOf(gateId);
    if (canonicalIndex !== -1 && canonicalIndex !== index) {
      add(`GATE_ORDER_BROKEN ${gateId} sits at position ${index + 1} and not ${canonicalIndex + 1}`);
    }
    if (Object.hasOwn(requirement, "ordinal") && requirement.ordinal !== index + 1) {
      add(`GATE_ORDINAL_MISMATCH ${gateId} declares ${String(requirement.ordinal)}`);
    }
  }

  // --- candidates: derive each verdict, never trust the declared one -------
  const candidates: Record<string, CandidateVerdict> = {};
  const declaredCandidates = isPlainRecord(input.canonical_candidates) ? input.canonical_candidates : {};
  for (const [candidateId, entry] of Object.entries(declaredCandidates)) {
    if (!isPlainRecord(entry) || !isPlainRecord(entry.evidence)) {
      add(`CANDIDATE_MALFORMED ${candidateId} is missing its evidence`);
      continue;
    }
    const evidence = entry.evidence as unknown as CandidateEvidence;
    if (!Array.isArray(evidence.metric_observations)) {
      add(`CANDIDATE_MALFORMED ${candidateId} is missing metric_observations`);
      continue;
    }

    const failedGates = evaluateGates(evidence, metricFactorMap);
    const verdict: CandidateVerdict = { issuable: failedGates.length === 0, failed_gates: failedGates };
    candidates[candidateId] = verdict;

    const declared = isPlainRecord(entry.expected) ? entry.expected : null;
    if (!declared) { add(`CANDIDATE_MALFORMED ${candidateId} is missing its expected verdict`); continue; }
    const declaredGates = Array.isArray(declared.failed_gates) ? (declared.failed_gates as string[]) : [];

    // One stable code per gate the frozen document gets wrong, so a document that
    // claims a coverage-only candidate is issuable names the gate it lied about.
    for (const gateId of GATE_IDS) {
      const derived = failedGates.includes(gateId);
      if (derived !== declaredGates.includes(gateId)) {
        add(`GATE_VERDICT_MISMATCH_${gateId} ${candidateId} derives ${derived ? "failed" : "passed"}`);
      }
    }
    if (declared.issuable !== verdict.issuable && declaredGates.length === failedGates.length &&
        failedGates.every((gateId) => declaredGates.includes(gateId))) {
      add(`CANDIDATE_ISSUABLE_MISMATCH ${candidateId} derives ${verdict.issuable}`);
    }
  }

  return { ok: errors.length === 0, errors, requirements, candidates };
};
