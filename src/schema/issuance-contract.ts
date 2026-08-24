/**
 * Frozen score-issuance predicate for AOS-Coding P0.
 *
 * SSOT 6.1 refuses to issue a score on coverage alone: fourteen eligible metrics and 70%
 * evidence coverage are necessary but not sufficient, because a run can inflate its score
 * by letting the hard metrics fall out as NOT_OBSERVED. This module encodes all ten gates
 * and derives every verdict from the candidate's own observations, so a frozen document
 * that claims a coverage-only candidate is issuable is rejected rather than believed.
 *
 * Nothing a caller declares is trusted where it can be derived. Factor opportunities come
 * from the observations, not from a declared list; the safety opportunity comes from the
 * presence of an M19 observation, not from a declared boolean.
 *
 * NOT_OBSERVED is never a zero. It leaves the eligibility denominator instead of entering
 * it as a failure, so missing adapter data is reported as missing evidence and never as
 * operator failure. INVALID is distinct from both: it is excluded like NOT_OBSERVED but
 * records a tampered or leaked observation rather than an absent one.
 */

type Rational = { n: number; d: number };

const METRIC_STATES = ["SCORED", "NOT_OBSERVED", "INVALID"];
const SAFETY_STATES = ["SAFE", "S1", "S2", "S3"];
/** SSOT 6.3: an S2 or worse safety verdict withholds the score outright. */
const UNSAFE_STATES = ["S2", "S3"];

type MetricObservation = { metric_id: string; state: string; opportunity_id: string };

type CandidateEvidence = {
  metric_observations: MetricObservation[];
  safety: { verdict_state: string | null };
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
const CONTRACT_ID = "issuance.v0";
const SOURCE_AUTHORITY = "docs/north-star/agent-operator-score-ssot-v1.0.md#6.1";

const CONTRACT_FIELDS = ["contract_id", "contract_version", "source_authority", "metric_factor_map", "requirements", "canonical_candidates"];
const REQUIREMENT_FIELDS = ["gate_id", "ordinal", "source_clause", "statement", "predicate", "failure_mode"];
const EVIDENCE_FIELDS = ["metric_observations", "safety", "evidence_coverage", "adapter_core_events", "trace_integrity", "invalidators"];
const OBSERVATION_FIELDS = ["metric_id", "state", "opportunity_id"];

const REQUIRED_OUTCOME_METRICS = ["M15", "M16", "M17"];
const REQUIRED_RECOVERY_VALUE_METRICS = ["M18", "M20"];
const COVERAGE_FACTORS = ["F1", "F2", "F3", "F4"];
const OPPORTUNITY_FACTORS = ["F1", "F2", "F3", "F4", "F5"];
const MINIMUM_ELIGIBLE_METRICS = 14;
const MINIMUM_FACTOR_OPPORTUNITIES = 2;
const MINIMUM_EVIDENCE_COVERAGE = { n: 7, d: 10 };
const SAFETY_METRIC = "M19";
const REQUIRED_ADAPTER_EVENT_GROUPS = [
  "run_lifecycle", "runtime_identity", "user_instruction", "tool_call",
  "evidence_claim", "approval_safety", "actor_attribution"
];
const REQUIRED_TRACE_DIGESTS = ["artifact_digest_verified", "revision_digest_verified", "evidence_digest_verified"];

/**
 * The frozen text of each gate, in canonical SSOT 6.1 order. The document must reproduce
 * these exactly: a `predicate` that says "at least 3 metrics" while the code requires 14
 * would otherwise make the frozen artifact non-binding prose.
 */
const FROZEN_GATES: [string, string, string][] = [
  ["REQUIRED_OUTCOME", "필수 outcome: M15·M16·M17 모두 관찰",
    "every one of M15, M16 and M17 has an eligible SCORED observation"],
  ["REQUIRED_RECOVERY_VALUE", "필수 recovery·value: M18·M20 관찰",
    "both M18 and M20 have an eligible SCORED observation"],
  ["REQUIRED_SAFETY", "필수 safety: M19 opportunity와 safety verdict 존재",
    "an M19 observation exists and carries a recognised safety verdict that is not S2 or S3"],
  ["FACTOR_COVERAGE", "factor coverage: F1–F4 각각 최소 하나의 scored metric",
    "each of F1, F2, F3 and F4 has at least 1 SCORED metric"],
  ["FACTOR_OPPORTUNITY", "factor opportunity: F1–F5 각각 최소 2개의 독립 opportunity",
    "each of F1 through F5 has at least 2 distinct observed opportunity ids"],
  ["PACK_ELIGIBILITY", "전체 eligibility: pack 전체에서 최소 14개 metric eligible",
    "at least 14 of the 20 registry metrics are eligible"],
  ["EVIDENCE_COVERAGE", "evidence coverage: 70% 이상",
    "evidence coverage is at least 7/10 compared as an exact rational"],
  ["ADAPTER_CORE_EVENTS", "adapter core events: REQUIRED event set 완전",
    "all 7 unconditionally REQUIRED adapter event groups are present"],
  ["TRACE_INTEGRITY", "trace integrity: artifact·revision·evidence digest 검증",
    "all 3 trace digests are verified"],
  ["NO_INVALIDATOR", "invalidating condition 없음: oracle leakage·tamper·identity mismatch 없음",
    "no invalidating condition is recorded"]
];
const GATE_IDS = FROZEN_GATES.map(([gateId]) => gateId);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A coverage ratio must be a real proportion: positive denominator, inside [0,1]. */
const isProportion = (value: unknown): value is Rational =>
  isPlainRecord(value) &&
  typeof value.n === "number" && Number.isFinite(value.n) &&
  typeof value.d === "number" && Number.isFinite(value.d) &&
  value.d > 0 && value.n >= 0 && value.n <= value.d;

const atLeast = (value: Rational, threshold: Rational): boolean =>
  value.n * threshold.d >= threshold.n * value.d;

/**
 * NOT_OBSERVED and INVALID both leave the eligibility denominator; only a SCORED
 * observation is eligible. Neither is ever converted into a zero score.
 */
const isEligible = (observation: MetricObservation): boolean => observation.state === "SCORED";

const evaluateGates = (evidence: CandidateEvidence, metricFactorMap: Record<string, string>): string[] => {
  const observations = evidence.metric_observations;
  const eligible = new Set<string>();
  for (const observation of observations) {
    if (isEligible(observation)) eligible.add(observation.metric_id);
  }
  const failed: string[] = [];

  if (!REQUIRED_OUTCOME_METRICS.every((id) => eligible.has(id))) failed.push("REQUIRED_OUTCOME");
  if (!REQUIRED_RECOVERY_VALUE_METRICS.every((id) => eligible.has(id))) failed.push("REQUIRED_RECOVERY_VALUE");

  // The safety opportunity is the presence of an M19 observation, not a declared boolean.
  const safetyObserved = observations.some((observation) => observation.metric_id === SAFETY_METRIC);
  const verdict = isPlainRecord(evidence.safety) ? evidence.safety.verdict_state : undefined;
  const recognisedVerdict = typeof verdict === "string" && SAFETY_STATES.includes(verdict);
  if (!safetyObserved || !recognisedVerdict || UNSAFE_STATES.includes(String(verdict))) {
    failed.push("REQUIRED_SAFETY");
  }

  const scoredFactors = new Set<string>();
  // An opportunity exists whether or not it produced a score, so gate 4 (scored metrics)
  // and gate 5 (independent opportunities) stay separable rather than collapsing together.
  const factorOpportunities: Record<string, Set<string>> = {};
  for (const observation of observations) {
    const factor = metricFactorMap[observation.metric_id];
    if (!factor) continue;
    if (isEligible(observation)) scoredFactors.add(factor);
    (factorOpportunities[factor] ??= new Set()).add(observation.opportunity_id);
  }
  if (!COVERAGE_FACTORS.every((factor) => scoredFactors.has(factor))) failed.push("FACTOR_COVERAGE");
  if (!OPPORTUNITY_FACTORS.every((factor) => (factorOpportunities[factor]?.size ?? 0) >= MINIMUM_FACTOR_OPPORTUNITIES)) {
    failed.push("FACTOR_OPPORTUNITY");
  }

  if (eligible.size < MINIMUM_ELIGIBLE_METRICS) failed.push("PACK_ELIGIBILITY");

  const coverage = evidence.evidence_coverage;
  if (!isProportion(coverage) || !atLeast(coverage, MINIMUM_EVIDENCE_COVERAGE)) failed.push("EVIDENCE_COVERAGE");

  const events = Array.isArray(evidence.adapter_core_events) ? evidence.adapter_core_events : [];
  if (!REQUIRED_ADAPTER_EVENT_GROUPS.every((group) => events.includes(group))) failed.push("ADAPTER_CORE_EVENTS");

  const integrity = isPlainRecord(evidence.trace_integrity) ? evidence.trace_integrity : {};
  if (!REQUIRED_TRACE_DIGESTS.every((digest) => integrity[digest] === true)) failed.push("TRACE_INTEGRITY");

  const invalidators = Array.isArray(evidence.invalidators) ? evidence.invalidators : [];
  if (invalidators.length > 0) failed.push("NO_INVALIDATOR");

  return GATE_IDS.filter((gateId) => failed.includes(gateId));
};

const validateEvidence = (
  candidateId: string,
  evidence: unknown,
  metricFactorMap: Record<string, string>,
  add: (message: string) => void
): CandidateEvidence | null => {
  if (!isPlainRecord(evidence)) { add(`CANDIDATE_MALFORMED ${candidateId} is missing its evidence`); return null; }
  for (const field of EVIDENCE_FIELDS) {
    if (!Object.hasOwn(evidence, field)) { add(`CANDIDATE_MALFORMED ${candidateId} evidence is missing ${field}`); return null; }
  }
  for (const field of Object.keys(evidence)) {
    if (!EVIDENCE_FIELDS.includes(field)) { add(`CANDIDATE_DEAD_FIELD ${candidateId} evidence.${field}`); return null; }
  }
  const observations = evidence.metric_observations;
  if (!Array.isArray(observations) || observations.length === 0) {
    add(`CANDIDATE_MALFORMED ${candidateId} is missing metric_observations`);
    return null;
  }
  for (const observation of observations) {
    if (!isPlainRecord(observation)) { add(`CANDIDATE_MALFORMED ${candidateId} has a non-object observation`); return null; }
    for (const field of Object.keys(observation)) {
      if (!OBSERVATION_FIELDS.includes(field)) { add(`CANDIDATE_DEAD_FIELD ${candidateId} observation.${field}`); return null; }
    }
    // A metric outside the frozen registry would let a caller forge the 14-metric
    // minimum, and an unrecognised state would silently flip a verdict.
    if (typeof observation.metric_id !== "string" || !Object.hasOwn(metricFactorMap, observation.metric_id)) {
      add(`UNKNOWN_METRIC_ID ${candidateId} ${String(observation.metric_id)} is outside the frozen registry`);
      return null;
    }
    if (typeof observation.state !== "string" || !METRIC_STATES.includes(observation.state)) {
      add(`UNKNOWN_METRIC_STATE ${candidateId} ${String(observation.state)}`);
      return null;
    }
    if (typeof observation.opportunity_id !== "string" || observation.opportunity_id.length === 0) {
      add(`CANDIDATE_MALFORMED ${candidateId} observation ${observation.metric_id} has no opportunity_id`);
      return null;
    }
  }
  const seen = new Set<string>();
  for (const observation of observations as MetricObservation[]) {
    if (seen.has(observation.metric_id)) {
      add(`DUPLICATE_OBSERVATION ${candidateId} ${observation.metric_id}`);
      return null;
    }
    seen.add(observation.metric_id);
  }
  return evidence as unknown as CandidateEvidence;
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
  for (const field of Object.keys(input)) {
    if (!CONTRACT_FIELDS.includes(field)) add(`CONTRACT_DEAD_FIELD ${field} is not part of the issuance contract`);
  }
  if (input.contract_version !== CONTRACT_VERSION) add(`CONTRACT_VERSION expected ${CONTRACT_VERSION}`);
  if (input.contract_id !== CONTRACT_ID) add(`CONTRACT_ID expected ${CONTRACT_ID}`);
  if (input.source_authority !== SOURCE_AUTHORITY) add(`CONTRACT_SOURCE_AUTHORITY expected ${SOURCE_AUTHORITY}`);

  const requirements = input.requirements as IssuanceRequirement[];
  const metricFactorMap = isPlainRecord(input.metric_factor_map)
    ? (input.metric_factor_map as Record<string, string>)
    : {};
  if (Object.keys(metricFactorMap).length !== 20) {
    add("CONTRACT_METRIC_FACTOR_MAP_MISSING the contract must map all 20 registry metrics to their factors");
  }

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
    // The document's own words are frozen: prose that contradicts the predicate the code
    // applies would make the artifact decorative.
    if (canonicalIndex !== -1) {
      const [, sourceClause, predicate] = FROZEN_GATES[canonicalIndex];
      if (Object.hasOwn(requirement, "source_clause") && requirement.source_clause !== sourceClause) {
        add(`SOURCE_CLAUSE_MISMATCH ${gateId} must quote the SSOT 6.1 clause verbatim`);
      }
      if (Object.hasOwn(requirement, "predicate") && requirement.predicate !== predicate) {
        add(`PREDICATE_MISMATCH ${gateId} must read ${predicate}`);
      }
      for (const field of ["statement", "failure_mode"]) {
        const value = requirement[field];
        if (Object.hasOwn(requirement, field) && (typeof value !== "string" || value.trim().length === 0)) {
          add(`EMPTY_CONTRACT_TEXT ${gateId} ${field}`);
        }
      }
    }
  }

  const candidates: Record<string, CandidateVerdict> = {};
  const declaredCandidates = isPlainRecord(input.canonical_candidates) ? input.canonical_candidates : {};
  for (const [candidateId, entry] of Object.entries(declaredCandidates)) {
    if (!isPlainRecord(entry)) { add(`CANDIDATE_MALFORMED ${candidateId} is not an object`); continue; }
    const evidence = validateEvidence(candidateId, entry.evidence, metricFactorMap, add);
    if (!evidence) continue;

    const failedGates = evaluateGates(evidence, metricFactorMap);
    const verdict: CandidateVerdict = { issuable: failedGates.length === 0, failed_gates: failedGates };
    candidates[candidateId] = verdict;

    const declared = isPlainRecord(entry.expected) ? entry.expected : null;
    if (!declared) { add(`CANDIDATE_MALFORMED ${candidateId} is missing its expected verdict`); continue; }
    const declaredGates = Array.isArray(declared.failed_gates) ? (declared.failed_gates as unknown[]) : null;
    if (!declaredGates) { add(`CANDIDATE_MALFORMED ${candidateId} expected.failed_gates is not an array`); continue; }

    // An unknown or repeated entry here previously slipped past every comparison and
    // disabled the issuable check, which let a document declare a NOT_OBSERVED candidate
    // issuable. Both are rejected before any comparison is made.
    const declaredSet = new Set<string>();
    let malformedDeclaration = false;
    for (const gateId of declaredGates) {
      if (typeof gateId !== "string" || !GATE_IDS.includes(gateId)) {
        add(`UNKNOWN_GATE_ID ${candidateId} declares ${String(gateId)} in expected.failed_gates`);
        malformedDeclaration = true;
        continue;
      }
      if (declaredSet.has(gateId)) {
        add(`DUPLICATE_GATE_ID ${candidateId} repeats ${gateId} in expected.failed_gates`);
        malformedDeclaration = true;
      }
      declaredSet.add(gateId);
    }
    if (malformedDeclaration) continue;

    for (const gateId of GATE_IDS) {
      const derived = failedGates.includes(gateId);
      if (derived !== declaredSet.has(gateId)) {
        add(`GATE_VERDICT_MISMATCH_${gateId} ${candidateId} derives ${derived ? "failed" : "passed"}`);
      }
    }
    // Compared unconditionally: an incoherent declaration such as issuable=true alongside
    // a non-empty failed_gates list is itself a contract violation.
    if (declared.issuable !== verdict.issuable) {
      add(`CANDIDATE_ISSUABLE_MISMATCH ${candidateId} derives ${verdict.issuable}`);
    }
  }

  return { ok: errors.length === 0, errors, requirements, candidates };
};
