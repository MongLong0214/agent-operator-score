/**
 * Opportunity eligibility and evidence deduplication for ADR-0005 / PRD-E2 requirement 1.
 *
 * Eligibility is derived from two things and nothing else: the sealed opportunities that were
 * pre-registered before the run, and authoritative evidence that survives deduplication. An
 * opportunity is never created after the run — evidence that names an opportunity id absent
 * from the sealed set is reported and credits nothing, because a denominator a run can extend
 * by emitting one more event is not a denominator.
 *
 * NOT_OBSERVED is never a zero. It leaves the eligibility denominator rather than entering it
 * as a failure, and the row that carries it has no `raw_value` and no `normalized_value` at
 * all, so there is no field for a later stage to read as 0. An adapter that cannot observe an
 * event group keeps its own reason (`ADAPTER_UNAVAILABLE`) instead of collapsing into
 * `NO_OPPORTUNITY`: SSOT §9.2 says adapter coverage is not operator capability, and naming the
 * operator for the adapter's gap is exactly the misreading the reason codes exist to prevent.
 *
 * What makes two pieces of evidence the same is the correlation id, and only the correlation
 * id. One action produces one correlation, so one correlation may credit one opportunity of
 * one metric. Keying deduplication on the pair (correlation, opportunity) or the pair
 * (correlation, metric) reads as the natural choice and is the bug this module exists to
 * refuse: either pair lets a single action count once per opportunity and once per metric,
 * which is SSOT §5.1's forbidden 하나의 행동을 여러 지표에 중복 귀속 and this ticket's
 * forbidden "counting one action twice".
 *
 * Every frozen table is supplied by the caller as pre-registered registry rows — the metric
 * registry (`specs/metrics.v0.json`), the evidence precedence order, and the adapter's declared
 * capability statuses. Nothing is read from disk here and nothing is mirrored from a spec, so
 * this module cannot drift away from the contract it implements; a wrong table is a defect in
 * the caller's input rather than a second, silently divergent copy of the registry.
 */

type Json = Record<string, unknown>;

type EvidenceRecord = {
  evidence_id: string;
  correlation_id: string;
  metric_id: string;
  opportunity_id: string;
  source_class: string;
};

type Deduplication = {
  ok: boolean;
  evidence: EvidenceRecord[];
  reasons: string[];
};

type EligibilityRow = {
  metric_id: string;
  state: string;
  reason: string;
  opportunity_ids: string[];
  opportunity_count: number;
  minimum_opportunities: number;
};

type Derivation = {
  ok: boolean;
  metrics: EligibilityRow[];
  eligible_metric_ids: string[];
  eligible_metric_count: number;
  reasons: string[];
};

type MetricRow = {
  metric_id: string;
  minimum_opportunities: number;
  confidence: Record<string, number>;
};

type SealedOpportunity = { metric_id: string; role: string };

/** SSOT §9.2. Only UNAVAILABLE blocks; the other four statuses observe or degrade. */
const BLOCKING_ADAPTER_STATUS = "UNAVAILABLE";
const PRIMARY_ROLE = "primary";
const SECONDARY_ROLE = "secondary";
const NOT_OBSERVED_BELOW = "not_observed_below";

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

const readEvidence = (value: unknown): EvidenceRecord | null => {
  const record = asObject(value);
  if (!record) return null;
  const evidenceId = asString(record.evidence_id);
  const correlationId = asString(record.correlation_id);
  const metricId = asString(record.metric_id);
  const opportunityId = asString(record.opportunity_id);
  const sourceClass = asString(record.source_class);
  if (!evidenceId || !correlationId || !metricId || !opportunityId || !sourceClass) return null;
  return {
    evidence_id: evidenceId,
    correlation_id: correlationId,
    metric_id: metricId,
    opportunity_id: opportunityId,
    source_class: sourceClass
  };
};

/**
 * Collapse every trace record that describes the same action to exactly one.
 *
 * The winner inside a correlation is the highest-precedence record, because the Metric Scoring
 * Contract fixes that "the first available higher-precedence source wins": a hidden oracle and
 * an operator claim reporting the same action are not two observations, and the oracle is the
 * one that survives. Where two records tie at the same precedence the lower `evidence_id` wins.
 * That tiebreak is a total order over the input, so the survivor does not depend on the order
 * the records arrived in, and re-running the same trace cannot move it.
 */
export const deduplicateEvidence = (input: unknown): Deduplication => {
  const reasons: string[] = [];
  const request = asObject(input);
  if (!request) return { ok: false, evidence: [], reasons: ["MALFORMED_DEDUPLICATION_INPUT"] };

  const declaredPrecedence = asArray(request.precedence);
  const precedence = declaredPrecedence?.every((entry) => asString(entry) !== null)
    ? (declaredPrecedence as string[])
    : null;
  if (!precedence || precedence.length === 0) {
    return { ok: false, evidence: [], reasons: ["MALFORMED_PRECEDENCE"] };
  }

  const rows = asArray(request.evidence);
  if (!rows) return { ok: false, evidence: [], reasons: ["MALFORMED_EVIDENCE_LIST"] };

  const byCorrelation = new Map<string, EvidenceRecord[]>();
  for (const [index, value] of rows.entries()) {
    const record = readEvidence(value);
    if (!record) {
      reasons.push(`MALFORMED_EVIDENCE ${index}`);
      continue;
    }
    // An unrecognised source class has no place in the frozen precedence order, so it can be
    // neither ranked against another record nor trusted on its own.
    if (!precedence.includes(record.source_class)) {
      reasons.push(`UNKNOWN_SOURCE_CLASS ${record.evidence_id}`);
      continue;
    }
    const group = byCorrelation.get(record.correlation_id);
    if (group) group.push(record);
    else byCorrelation.set(record.correlation_id, [record]);
  }

  const survivors: EvidenceRecord[] = [];
  for (const [correlationId, group] of byCorrelation) {
    if (group.length > 1) reasons.push(`DUPLICATE_CORRELATION ${correlationId}`);
    let winner = group[0];
    for (const candidate of group) {
      const candidateRank = precedence.indexOf(candidate.source_class);
      const winnerRank = precedence.indexOf(winner.source_class);
      if (candidateRank < winnerRank) winner = candidate;
      else if (candidateRank === winnerRank && candidate.evidence_id < winner.evidence_id) {
        winner = candidate;
      }
    }
    survivors.push(winner);
  }
  survivors.sort((left, right) => (left.correlation_id < right.correlation_id ? -1 : 1));

  const uniqueReasons = sortedUnique(reasons);
  return { ok: uniqueReasons.length === 0, evidence: survivors, reasons: uniqueReasons };
};

const readRegistry = (value: unknown): MetricRow[] | null => {
  const rows = asArray(value);
  if (!rows || rows.length === 0) return null;
  const registry: MetricRow[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const record = asObject(entry);
    if (!record) return null;
    const metricId = asString(record.metric_id);
    const minimum = asFiniteNumber(record.minimum_opportunities);
    const confidence = asObject(record.confidence);
    if (!metricId || seen.has(metricId) || minimum === null || minimum < 1 || !confidence) return null;
    seen.add(metricId);
    registry.push({
      metric_id: metricId,
      minimum_opportunities: minimum,
      confidence: confidence as Record<string, number>
    });
  }
  return registry;
};

/**
 * A source class earns credit only where the frozen registry row rates it at or above its own
 * `not_observed_below` threshold. The threshold is read per metric rather than hard-coded, so
 * an operator claim (0.00) never earns credit and the module cannot disagree with the registry
 * about what counts as authoritative.
 */
const isAuthoritative = (metric: MetricRow, sourceClass: string): boolean => {
  const threshold = asFiniteNumber(metric.confidence[NOT_OBSERVED_BELOW]);
  const confidence = asFiniteNumber(metric.confidence[sourceClass]);
  if (threshold === null || confidence === null) return false;
  return confidence >= threshold;
};

export const deriveMetricEligibility = (input: unknown): Derivation => {
  const empty = { metrics: [] as EligibilityRow[], eligible_metric_ids: [] as string[], eligible_metric_count: 0 };
  const request = asObject(input);
  if (!request) return { ok: false, ...empty, reasons: ["MALFORMED_ELIGIBILITY_INPUT"] };

  const registry = readRegistry(request.registry);
  if (!registry) return { ok: false, ...empty, reasons: ["MALFORMED_REGISTRY"] };
  const byMetricId = new Map(registry.map((metric) => [metric.metric_id, metric]));

  const reasons: string[] = [];

  // SSOT §9.2. An UNAVAILABLE event group blocks its metrics whatever the trace shows; every
  // other declared status leaves them observable.
  const blocked = new Set<string>();
  for (const value of asArray(request.adapter_capabilities) ?? []) {
    const capability = asObject(value);
    if (!capability) continue;
    if (asString(capability.status) !== BLOCKING_ADAPTER_STATUS) continue;
    for (const entry of asArray(capability.blocked_metric_ids) ?? []) {
      const metricId = asString(entry);
      if (!metricId) continue;
      blocked.add(metricId);
      reasons.push(`ADAPTER_UNAVAILABLE ${metricId}`);
    }
  }

  // The sealed set is the whole universe of opportunities. It is read before any evidence, so
  // no evidence record can add to it.
  const sealed = new Map<string, SealedOpportunity>();
  const sealedByMetric = new Map<string, string[]>();
  for (const value of asArray(request.opportunities) ?? []) {
    const declared = asObject(value);
    if (!declared) {
      reasons.push("MALFORMED_OPPORTUNITY");
      continue;
    }
    const opportunityId = asString(declared.opportunity_id);
    const metricId = asString(declared.metric_id);
    const role = asString(declared.role) ?? PRIMARY_ROLE;
    if (!opportunityId || !metricId) {
      reasons.push("MALFORMED_OPPORTUNITY");
      continue;
    }
    if (sealed.has(opportunityId)) {
      reasons.push(`DUPLICATE_OPPORTUNITY ${opportunityId}`);
      continue;
    }
    sealed.set(opportunityId, { metric_id: metricId, role });
    const existing = sealedByMetric.get(metricId);
    if (existing) existing.push(opportunityId);
    else sealedByMetric.set(metricId, [opportunityId]);
  }

  const deduplicated = deduplicateEvidence({
    evidence: request.evidence,
    precedence: request.precedence
  });
  reasons.push(...deduplicated.reasons);

  // One surviving correlation credits at most one opportunity, so an opportunity is observed
  // when at least one deduplicated authoritative record names it. Two records for the same
  // opportunity are still one opportunity; the set does that.
  const observedPrimary = new Map<string, Set<string>>();
  const observedSecondary = new Map<string, Set<string>>();
  for (const record of deduplicated.evidence) {
    const seal = sealed.get(record.opportunity_id);
    if (!seal) {
      reasons.push(`UNSEALED_OPPORTUNITY ${record.opportunity_id}`);
      continue;
    }
    // The seal and the evidence must agree about which metric this opportunity belongs to.
    // Trusting either side alone would let one of them redirect an observation to a metric the
    // other never registered it against.
    if (seal.metric_id !== record.metric_id) {
      reasons.push(`OPPORTUNITY_METRIC_MISMATCH ${record.opportunity_id}`);
      continue;
    }
    const metric = byMetricId.get(seal.metric_id);
    if (!metric) {
      reasons.push(`UNKNOWN_METRIC_ID ${seal.metric_id}`);
      continue;
    }
    if (!isAuthoritative(metric, record.source_class)) {
      reasons.push(`UNAUTHORITATIVE_EVIDENCE ${record.opportunity_id}`);
      continue;
    }
    const bucket = seal.role === SECONDARY_ROLE ? observedSecondary : observedPrimary;
    const existing = bucket.get(seal.metric_id);
    if (existing) existing.add(record.opportunity_id);
    else bucket.set(seal.metric_id, new Set([record.opportunity_id]));
  }

  const metrics: EligibilityRow[] = [];
  const eligibleMetricIds: string[] = [];
  for (const metric of registry) {
    const metricId = metric.metric_id;
    const primary = observedPrimary.get(metricId) ?? new Set<string>();
    const secondary = observedSecondary.get(metricId) ?? new Set<string>();

    // SSOT §5.1: secondary metric은 실제 기회가 발생한 경우에만 채점한다. A secondary
    // opportunity rides on a primary one; with no observed primary it is not an opportunity
    // that occurred, and counting it would manufacture the denominator this ticket forbids.
    const secondaryCounts = primary.size > 0;
    const counted = secondaryCounts ? [...primary, ...secondary] : [...primary];
    const opportunityIds = [...new Set(counted)].sort();
    const row: EligibilityRow = {
      metric_id: metricId,
      state: "NOT_OBSERVED",
      reason: "NO_OPPORTUNITY",
      opportunity_ids: opportunityIds,
      opportunity_count: opportunityIds.length,
      minimum_opportunities: metric.minimum_opportunities
    };

    if (blocked.has(metricId)) {
      row.reason = "ADAPTER_UNAVAILABLE";
    } else if (opportunityIds.length >= metric.minimum_opportunities) {
      row.state = "SCORED";
      row.reason = "OBSERVED";
      eligibleMetricIds.push(metricId);
    } else if ((sealedByMetric.get(metricId) ?? []).length === 0) {
      row.reason = "NO_OPPORTUNITY";
    } else if (!secondaryCounts && secondary.size > 0) {
      row.reason = "SECONDARY_WITHOUT_OPPORTUNITY";
    } else {
      row.reason = "BELOW_MINIMUM_OPPORTUNITIES";
    }
    metrics.push(row);
  }

  const uniqueReasons = sortedUnique(reasons);
  return {
    ok: uniqueReasons.length === 0,
    metrics,
    eligible_metric_ids: eligibleMetricIds,
    eligible_metric_count: eligibleMetricIds.length,
    reasons: uniqueReasons
  };
};
