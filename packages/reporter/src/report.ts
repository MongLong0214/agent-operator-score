type Json = Record<string, unknown>;

const REFUSAL = "canonical result has no stable honest user projection.";

const RESULT_FIELDS = [
  "schema_id",
  "schema_version",
  "run_id",
  "status",
  "score",
  "factors",
  "safety",
  "coverage",
  "score_digest",
  "scorer_digest",
  "suite_digest",
  "adapter_digest",
  "declared_manual_takeover",
  "external_mutation",
  "attribution",
  "attribution_confidence",
  "retest_type",
  "comparison_eligible",
  "opportunity_profile",
  "limitations"
] as const;

const PROFILE_FIELDS = [
  "suite",
  "family",
  "form_version",
  "language",
  "runtime",
  "adapter_version",
  "model_id",
  "model_revision",
  "reasoning_settings",
  "harness_profile",
  "harness_digest",
  "skill_hook_mcp",
  "skill_hook_mcp_digest",
  "tool_surface",
  "permission_profile",
  "network_profile",
  "context_budget",
  "token_budget",
  "time_budget",
  "tool_call_budget",
  "intervention_policy",
  "repository_digest",
  "environment_digest"
] as const;

const FACTOR_IDS = ["F1", "F2", "F3", "F4", "F5", "F6"] as const;
const SCORELESS_STATUSES = new Set([
  "ESTIMATE",
  "INSUFFICIENT_EVIDENCE",
  "UNSAFE",
  "INVALID",
  "DIAGNOSTIC ONLY"
]);
const RETEST_TYPES = new Set(["none", "operator_transfer", "environment_uplift", "combined_uplift"]);
const ATTRIBUTIONS = new Set(["agent", "human/takeover", "external_mutation", "actor.attribution_unknown"]);
const PROFILE_DIGEST_FIELDS = new Set([
  "harness_digest",
  "skill_hook_mcp_digest",
  "repository_digest",
  "environment_digest"
]);
const DIGEST = /^[a-f0-9]{64}$/;

const asRecord = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

const hasExactFields = (value: unknown, fields: readonly string[]): value is Json => {
  const record = asRecord(value);
  if (!record || Object.keys(record).length !== fields.length) return false;
  return fields.every((field) => Object.hasOwn(record, field));
};

const filledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const finiteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;

const digest = (value: unknown): value is string => typeof value === "string" && DIGEST.test(value);

const scoreIsValid = (score: unknown): boolean => {
  if (!hasExactFields(score, ["raw", "display"])) return false;
  return finiteInRange(score.raw, 0, 100)
    && finiteInRange(score.display, 0, 100)
    && score.display % 5 === 0;
};

const factorsAreValid = (factors: unknown): factors is Json => {
  if (!hasExactFields(factors, FACTOR_IDS)) return false;
  return FACTOR_IDS.every((id) => factors[id] === null || finiteInRange(factors[id], 0, 1));
};

const safetyIsValid = (safety: unknown): safety is Json => {
  if (!hasExactFields(safety, ["level", "state"])) return false;
  const expectedStates: Record<string, string> = { S0: "SAFE", S1: "S1", S2: "S2", S3: "S3" };
  return typeof safety.level === "string" && expectedStates[safety.level] === safety.state;
};

const profileIsValid = (profile: unknown): profile is Json => {
  if (!hasExactFields(profile, PROFILE_FIELDS)) return false;
  for (const field of PROFILE_FIELDS) {
    const entry = profile[field];
    if (field === "model_revision") {
      if (entry !== null && !filledString(entry)) return false;
    } else if (PROFILE_DIGEST_FIELDS.has(field)) {
      if (!digest(entry)) return false;
    } else if (!filledString(entry)) {
      return false;
    }
  }
  return true;
};

const reportInput = (value: unknown): Json | null => {
  if (!hasExactFields(value, RESULT_FIELDS)) return null;
  if (value.schema_id !== "aos-result" || value.schema_version !== "aos-result.schema.v0") return null;
  if (!filledString(value.run_id) || !filledString(value.status) || !filledString(value.limitations)) return null;
  if (!factorsAreValid(value.factors) || !safetyIsValid(value.safety)) return null;
  if (!finiteInRange(value.coverage, 0, 1)) return null;
  if (!digest(value.scorer_digest) || !digest(value.suite_digest) || !digest(value.adapter_digest)) return null;
  if (typeof value.declared_manual_takeover !== "boolean" || typeof value.external_mutation !== "boolean") return null;
  if (typeof value.comparison_eligible !== "boolean" || !ATTRIBUTIONS.has(String(value.attribution))) return null;
  if (!finiteInRange(value.attribution_confidence, 0, 1) || !RETEST_TYPES.has(String(value.retest_type))) return null;
  if (!profileIsValid(value.opportunity_profile)) return null;

  const scored = scoreIsValid(value.score);
  if (value.status === "EXPERIMENTAL / PROVISIONAL") {
    if (!scored || !digest(value.score_digest)) return null;
  } else if (SCORELESS_STATUSES.has(String(value.status))) {
    if (value.score !== null || value.score_digest !== null) return null;
  } else {
    return null;
  }

  if (value.attribution === "actor.attribution_unknown") {
    if (value.status !== "DIAGNOSTIC ONLY" || value.score !== null || value.attribution_confidence >= 0.7) return null;
  }
  if (value.status === "DIAGNOSTIC ONLY" && value.attribution !== "actor.attribution_unknown") return null;
  return value;
};

// Reports are trust boundaries: accepting a partial or score-incoherent record would turn an
// upstream absence of evidence into a polished but false claim.
const requireReportInput = (value: unknown): Json => {
  const accepted = reportInput(value);
  if (!accepted) throw new Error(REFUSAL);
  return accepted;
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Json;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const scalar = (value: unknown): string => JSON.stringify(value);

export const renderJsonReport = (result: unknown): string => canonical(requireReportInput(result));

export const renderMarkdownReport = (result: unknown): string => {
  const accepted = requireReportInput(result);
  const factors = accepted.factors as Json;
  const safety = accepted.safety as Json;
  const profile = accepted.opportunity_profile as Json;
  const comparison = accepted.comparison_eligible === true
    ? "DIRECT_COMPARISON_ELIGIBLE"
    : "DIRECT_COMPARISON_NOT_ALLOWED";
  return [
    "# AOS report",
    `schema_id: ${scalar(accepted.schema_id)}`,
    `schema_version: ${scalar(accepted.schema_version)}`,
    `run_id: ${scalar(accepted.run_id)}`,
    `status: ${scalar(accepted.status)}`,
    `score: ${scalar(accepted.score)}`,
    `coverage: ${scalar(accepted.coverage)}`,
    `safety_level: ${scalar(safety.level)}`,
    `safety_state: ${scalar(safety.state)}`,
    "## factors",
    ...FACTOR_IDS.map((id) => `${id}: ${scalar(factors[id])}`),
    "## versions and digests",
    `score_digest: ${scalar(accepted.score_digest)}`,
    `scorer_digest: ${scalar(accepted.scorer_digest)}`,
    `suite_digest: ${scalar(accepted.suite_digest)}`,
    `adapter_digest: ${scalar(accepted.adapter_digest)}`,
    "## takeover and retest",
    `declared_manual_takeover: ${scalar(accepted.declared_manual_takeover)}`,
    `external_mutation: ${scalar(accepted.external_mutation)}`,
    `attribution: ${scalar(accepted.attribution)}`,
    `attribution_confidence: ${scalar(accepted.attribution_confidence)}`,
    `retest_type: ${scalar(accepted.retest_type)}`,
    `comparison_restriction: ${comparison}`,
    "## Opportunity Profile",
    ...PROFILE_FIELDS.map((field) => `${field}: ${scalar(profile[field])}`),
    "## limitations",
    `limitations: ${scalar(accepted.limitations)}`
  ].join("\n");
};
