type Json = Record<string, unknown>;
type Rational = { n: number; d: number };

const REFUSAL = "selector output is not rendered with evidence/cost/application/retest contract.";
const DIGEST = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set([
  "SAFETY_REMEDIATION",
  "PRIMARY_CONSTRAINT",
  "INSUFFICIENT_EVIDENCE",
  "MANUAL_REVIEW_REQUIRED"
]);
const UPLIFT_CLASSES = new Set(["quality", "recovery", "safety"]);
const TRANSFERABILITY = new Set(["operator", "environment", "combined"]);
const PROHIBITED_COPY = [
  /\bpercentile\b/i,
  /\bcertification\b/i,
  /\bhiring(?:\s+signal)?\b/i,
  /\bglobal\s+rank\b/i,
  /\bindustry\s+standard\b/i,
  /\bpersonal\s+ability\b/i,
  /\bAOS-G\b/i,
  /\bexact\s+growth\s+score\b/i
];

type Selection = {
  outcome: string;
  reason: string;
  factorId: string | null;
  metricId: string | null;
  treatmentId: string | null;
  leverCount: number;
  trace: string[];
};

type Evidence = {
  runId: string;
  metricId: string;
  opportunityId: string;
  eventId: string;
  artifactId: string;
  artifactDigest: string;
  artifactPath: string;
  excerpt: string | null;
};

type Treatment = {
  treatmentId: string;
  metricIds: string[];
  label: string;
  application: string;
  cost: { time: Rational; tokens: Rational; maintenance: Rational };
  permissionDelta: string[];
  transferability: string;
  retestCriteria: string;
  safetyOnlyRemediation: boolean;
};

const refuse = (): never => {
  throw new Error(REFUSAL);
};

const asRecord = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

const hasExactFields = (value: unknown, fields: readonly string[]): value is Json => {
  const record = asRecord(value);
  return record !== null
    && Object.keys(record).length === fields.length
    && fields.every((field) => Object.hasOwn(record, field));
};

const permittedText = (value: unknown): value is string =>
  typeof value === "string"
  && value.trim().length > 0
  && !PROHIBITED_COPY.some((pattern) => pattern.test(value));

const nullableText = (value: unknown): value is string | null => value === null || permittedText(value);

const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(permittedText);

const gcd = (left: number, right: number): number => right === 0 ? left : gcd(right, left % right);

const rational = (value: unknown): value is Rational => {
  if (!hasExactFields(value, ["n", "d"])) return false;
  const numerator = value.n;
  const denominator = value.d;
  return typeof numerator === "number"
    && Number.isInteger(numerator)
    && numerator >= 0
    && typeof denominator === "number"
    && Number.isInteger(denominator)
    && denominator > 0
    && gcd(Math.abs(numerator), denominator) === 1;
};

const selection = (value: unknown): Selection | null => {
  if (!hasExactFields(value, ["outcome", "reason", "factor_id", "metric_id", "treatment_id", "lever_count", "trace"])) {
    return null;
  }
  if (
    !OUTCOMES.has(String(value.outcome))
    || !permittedText(value.reason)
    || !nullableText(value.factor_id)
    || !nullableText(value.metric_id)
    || !nullableText(value.treatment_id)
    || typeof value.lever_count !== "number"
    || !Number.isInteger(value.lever_count)
    || !Array.isArray(value.trace)
    || value.trace.length === 0
    || !value.trace.every(permittedText)
  ) {
    return null;
  }

  const accepted: Selection = {
    outcome: value.outcome,
    reason: value.reason,
    factorId: value.factor_id,
    metricId: value.metric_id,
    treatmentId: value.treatment_id,
    leverCount: value.lever_count,
    trace: value.trace
  };
  if (
    accepted.outcome === "PRIMARY_CONSTRAINT"
    && accepted.reason === "DETERMINISTIC_SELECTION"
    && permittedText(accepted.factorId)
    && permittedText(accepted.metricId)
    && permittedText(accepted.treatmentId)
    && accepted.leverCount === 1
  ) {
    return accepted;
  }
  if (
    accepted.outcome === "SAFETY_REMEDIATION"
    && accepted.reason === "SAFETY_FIRST"
    && accepted.factorId === null
    && permittedText(accepted.metricId)
    && permittedText(accepted.treatmentId)
    && accepted.leverCount === 1
  ) {
    return accepted;
  }
  if (
    accepted.outcome === "MANUAL_REVIEW_REQUIRED"
    && accepted.treatmentId === null
    && accepted.leverCount === 0
  ) {
    return accepted;
  }
  if (
    accepted.outcome === "INSUFFICIENT_EVIDENCE"
    && accepted.reason === "NO_ELIGIBLE_CANDIDATE"
    && accepted.factorId === null
    && accepted.metricId === null
    && accepted.treatmentId === null
    && accepted.leverCount === 0
  ) {
    return accepted;
  }
  return null;
};

const evidence = (value: unknown): Evidence | null => {
  if (!hasExactFields(value, [
    "run_id",
    "metric_id",
    "opportunity_id",
    "event_id",
    "artifact_id",
    "artifact_digest",
    "artifact_path",
    "excerpt"
  ])) {
    return null;
  }
  if (
    !permittedText(value.run_id)
    || !permittedText(value.metric_id)
    || !permittedText(value.opportunity_id)
    || !permittedText(value.event_id)
    || !permittedText(value.artifact_id)
    || typeof value.artifact_digest !== "string"
    || !DIGEST.test(value.artifact_digest)
    || typeof value.artifact_path !== "string"
    || value.artifact_path.length === 0
    || !nullableText(value.excerpt)
  ) {
    return null;
  }
  return {
    runId: value.run_id,
    metricId: value.metric_id,
    opportunityId: value.opportunity_id,
    eventId: value.event_id,
    artifactId: value.artifact_id,
    artifactDigest: value.artifact_digest,
    artifactPath: value.artifact_path,
    excerpt: value.excerpt
  };
};

const treatment = (value: unknown): Treatment | null => {
  if (!hasExactFields(value, [
    "treatment_id",
    "metric_ids",
    "label",
    "implementation_protocol",
    "cost",
    "permission_delta",
    "transferability",
    "retest_criteria",
    "safety_only_remediation"
  ])) {
    return null;
  }
  if (!hasExactFields(value.cost, ["time", "tokens", "maintenance"])) return null;
  if (
    !permittedText(value.treatment_id)
    || !stringList(value.metric_ids)
    || value.metric_ids.length === 0
    || !permittedText(value.label)
    || !permittedText(value.implementation_protocol)
    || !rational(value.cost.time)
    || !rational(value.cost.tokens)
    || !rational(value.cost.maintenance)
    || !stringList(value.permission_delta)
    || !TRANSFERABILITY.has(String(value.transferability))
    || !permittedText(value.retest_criteria)
    || typeof value.safety_only_remediation !== "boolean"
  ) {
    return null;
  }
  return {
    treatmentId: value.treatment_id,
    metricIds: value.metric_ids,
    label: value.label,
    application: value.implementation_protocol,
    cost: value.cost as { time: Rational; tokens: Rational; maintenance: Rational },
    permissionDelta: value.permission_delta,
    transferability: value.transferability,
    retestCriteria: value.retest_criteria,
    safetyOnlyRemediation: value.safety_only_remediation
  };
};

const scalar = (value: unknown): string => JSON.stringify(value);

const formatRational = (value: Rational): string => `${value.n}/${value.d}`;

const retestMode = (transferability: string): string => ({
  operator: "Operator Transfer Signal",
  environment: "Environment Uplift Signal",
  combined: "Combined Uplift Signal"
})[transferability] as string;

const operatorGrowthClaim = (transferability: string): string => {
  if (transferability === "environment") return "NOT_ALLOWED";
  if (transferability === "combined") return "NOT_ATTRIBUTABLE";
  return "SEPARATE_RETEST_REQUIRED";
};

const linesForSelection = (accepted: Selection): string[] => [
  "# Diagnosis",
  `outcome: ${scalar(accepted.outcome)}`,
  `reason: ${scalar(accepted.reason)}`,
  `factor_id: ${scalar(accepted.factorId)}`,
  `metric_id: ${scalar(accepted.metricId)}`,
  `treatment_id: ${scalar(accepted.treatmentId)}`,
  `lever_count: ${accepted.leverCount}`,
  "## decision trace",
  ...accepted.trace.map((entry, index) => `${index + 1}. ${scalar(entry)}`)
];

const renderManual = (accepted: Selection): string => [
  ...linesForSelection(accepted),
  accepted.outcome === "MANUAL_REVIEW_REQUIRED" ? "## manual review" : "## insufficient evidence",
  accepted.outcome === "MANUAL_REVIEW_REQUIRED"
    ? `manual_review_reason: ${scalar(accepted.reason)}`
    : `evidence_reason: ${scalar(accepted.reason)}`,
  accepted.outcome === "MANUAL_REVIEW_REQUIRED"
    ? "form_b: \"manual review required before retest\""
    : "form_b: \"additional authoritative evidence required before retest\""
].join("\n");

const renderActionable = (
  accepted: Selection,
  resolvedEvidence: Evidence,
  registeredTreatment: Treatment,
  upliftClass: string
): string => [
  ...linesForSelection(accepted),
  "## evidence",
  `run_id: ${scalar(resolvedEvidence.runId)}`,
  `metric_id: ${scalar(resolvedEvidence.metricId)}`,
  `opportunity_id: ${scalar(resolvedEvidence.opportunityId)}`,
  `event_id: ${scalar(resolvedEvidence.eventId)}`,
  `artifact_id: ${scalar(resolvedEvidence.artifactId)}`,
  `artifact_digest: ${scalar(resolvedEvidence.artifactDigest)}`,
  `evidence_excerpt: ${scalar(resolvedEvidence.excerpt)}`,
  accepted.outcome === "SAFETY_REMEDIATION" ? "## safety remediation" : "## treatment",
  `treatment_id: ${scalar(registeredTreatment.treatmentId)}`,
  `label: ${scalar(registeredTreatment.label)}`,
  `expected_uplift_class: ${scalar(upliftClass)}`,
  `cost_time: ${formatRational(registeredTreatment.cost.time)}`,
  `cost_tokens: ${formatRational(registeredTreatment.cost.tokens)}`,
  `cost_maintenance: ${formatRational(registeredTreatment.cost.maintenance)}`,
  `permission_delta: ${scalar(registeredTreatment.permissionDelta)}`,
  `transferability: ${scalar(registeredTreatment.transferability)}`,
  "## application",
  `implementation_protocol: ${scalar(registeredTreatment.application)}`,
  "## Form B retest criteria",
  `retest_mode: ${scalar(retestMode(registeredTreatment.transferability))}`,
  `operator_growth_claim: ${scalar(operatorGrowthClaim(registeredTreatment.transferability))}`,
  `retest_criteria: ${scalar(registeredTreatment.retestCriteria)}`
].join("\n");

export const renderDiagnosis = (input: unknown): string => {
  const record = asRecord(input);
  if (!record || !Object.hasOwn(record, "selection")) refuse();
  const accepted = selection(record.selection);
  if (!accepted) refuse();

  if (accepted.outcome === "MANUAL_REVIEW_REQUIRED" || accepted.outcome === "INSUFFICIENT_EVIDENCE") {
    if (!hasExactFields(record, ["selection"])) refuse();
    return renderManual(accepted);
  }

  if (!hasExactFields(record, ["selection", "evidence", "treatment", "expected_uplift_class"])) refuse();
  const resolvedEvidence = evidence(record.evidence);
  const registeredTreatment = treatment(record.treatment);
  if (!resolvedEvidence || !registeredTreatment || !UPLIFT_CLASSES.has(String(record.expected_uplift_class))) refuse();
  if (
    resolvedEvidence.metricId !== accepted.metricId
    || registeredTreatment.treatmentId !== accepted.treatmentId
    || !registeredTreatment.metricIds.includes(accepted.metricId as string)
    || registeredTreatment.safetyOnlyRemediation !== (accepted.outcome === "SAFETY_REMEDIATION")
    || (accepted.outcome === "SAFETY_REMEDIATION" && record.expected_uplift_class !== "safety")
    || (accepted.outcome === "PRIMARY_CONSTRAINT" && record.expected_uplift_class === "safety")
  ) {
    refuse();
  }
  return renderActionable(accepted, resolvedEvidence, registeredTreatment, record.expected_uplift_class as string);
};
