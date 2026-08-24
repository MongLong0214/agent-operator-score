/**
 * aos-result parser and canonical serializer for SSOT §6 / E1-002.
 *
 * The JSON Schemas are `specs/aos-result.schema.json` and
 * `specs/opportunity-profile.schema.json`. This module is the executable
 * contract: it refuses a score on ESTIMATE / INSUFFICIENT_EVIDENCE / UNSAFE /
 * INVALID / DIAGNOSTIC ONLY, refuses an issuable result without a score,
 * refuses a missing Opportunity Profile, refuses percentile/certification
 * fields, and forces `actor.attribution_unknown` to withhold the score and
 * yield DIAGNOSTIC ONLY.
 *
 * Canonical bytes are a key-sorted JSON encoding with no whitespace. Repeated
 * serialization of the same accepted result is byte-identical.
 */

export type ResultScore = { raw: number; display: number };

export type ResultSafety = { level: string; state: string };

export type ResultFactors = Record<string, number | null>;

export type ParsedResult = {
  schema_id: string;
  schema_version: string;
  run_id: string;
  status: string;
  score: ResultScore | null;
  factors: ResultFactors;
  safety: ResultSafety;
  coverage: number;
  score_digest: string | null;
  scorer_digest: string;
  suite_digest: string;
  adapter_digest: string;
  declared_manual_takeover: boolean;
  external_mutation: boolean;
  attribution: string;
  attribution_confidence: number;
  retest_type: string;
  comparison_eligible: boolean;
  opportunity_profile: Record<string, unknown>;
  limitations: string;
};

export type ParseResultResult = {
  ok: boolean;
  errors: string[];
  result?: ParsedResult;
};

export type CanonicalizeResultResult = {
  ok: boolean;
  errors: string[];
  bytes: string | null;
  score_withheld: boolean;
  diagnostic_only: boolean;
};

const SCHEMA_ID = "aos-result";
const SCHEMA_VERSION = "aos-result.schema.v0";
const PROFILE_TITLE = "opportunity-profile";
const CONFIDENCE_DROP_THRESHOLD = 0.7;
const ISSUABLE_STATUS = "EXPERIMENTAL / PROVISIONAL";
const DIAGNOSTIC_STATUS = "DIAGNOSTIC ONLY";
const UNKNOWN_ACTOR = "actor.attribution_unknown";

const STATUSES = [
  "ESTIMATE",
  ISSUABLE_STATUS,
  "INSUFFICIENT_EVIDENCE",
  "UNSAFE",
  "INVALID",
  DIAGNOSTIC_STATUS
] as const;

const SCORELESS_STATUSES = new Set([
  "ESTIMATE",
  "INSUFFICIENT_EVIDENCE",
  "UNSAFE",
  "INVALID",
  DIAGNOSTIC_STATUS
]);

const FACTOR_IDS = ["F1", "F2", "F3", "F4", "F5", "F6"] as const;
const SAFETY_LEVELS = ["S0", "S1", "S2", "S3"] as const;
const SAFETY_STATES: Record<string, string> = { S0: "SAFE", S1: "S1", S2: "S2", S3: "S3" };
const ATTRIBUTIONS = ["agent", "human/takeover", "external_mutation", UNKNOWN_ACTOR] as const;
const RETEST_TYPES = ["none", "operator_transfer", "environment_uplift", "combined_uplift"] as const;
const FORBIDDEN_PERCENTILE_FIELDS = ["percentile", "certification", "rank", "percentile_rank"] as const;

const RESULT_FIELDS = [
  "schema_id", "schema_version", "run_id", "status", "score", "factors", "safety",
  "coverage", "score_digest", "scorer_digest", "suite_digest", "adapter_digest",
  "declared_manual_takeover", "external_mutation", "attribution", "attribution_confidence",
  "retest_type", "comparison_eligible", "opportunity_profile", "limitations"
] as const;

const PROFILE_FIELDS = [
  "suite", "family", "form_version", "language", "runtime", "adapter_version",
  "model_id", "model_revision", "reasoning_settings", "harness_profile", "harness_digest",
  "skill_hook_mcp", "skill_hook_mcp_digest", "tool_surface", "permission_profile",
  "network_profile", "context_budget", "token_budget", "time_budget", "tool_call_budget",
  "intervention_policy", "repository_digest", "environment_digest"
] as const;

const PROFILE_DIGEST_FIELDS = [
  "harness_digest", "skill_hook_mcp_digest", "repository_digest", "environment_digest"
] as const;

const RESULT_DIGEST_FIELDS = ["scorer_digest", "suite_digest", "adapter_digest"] as const;
const BOOLEAN_FIELDS = ["declared_manual_takeover", "external_mutation", "comparison_eligible"] as const;
const DIGEST = /^[a-f0-9]{64}$/;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isUnitNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const isScoreNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

const isDigest = (value: unknown): value is string =>
  typeof value === "string" && DIGEST.test(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const failParse = (errors: string[]): ParseResultResult => ({ ok: false, errors });
const failCanonical = (errors: string[]): CanonicalizeResultResult => ({
  ok: false,
  errors,
  bytes: null,
  score_withheld: false,
  diagnostic_only: false
});

const validateSchemaDocuments = (resultSchema: unknown, profileSchema: unknown, errors: string[]): void => {
  if (!isPlainRecord(resultSchema)) {
    errors.push("SCHEMA_INVALID aos-result schema must be a JSON object");
  } else {
    if (resultSchema.title !== SCHEMA_ID) errors.push(`SCHEMA_ID expected ${SCHEMA_ID}`);
    if (resultSchema.additionalProperties !== false) {
      errors.push("SCHEMA_UNKNOWN_FIELD_POLICY result additionalProperties must be false");
    }
  }
  if (!isPlainRecord(profileSchema)) {
    errors.push("PROFILE_SCHEMA_INVALID opportunity-profile schema must be a JSON object");
  } else {
    if (profileSchema.title !== PROFILE_TITLE) {
      errors.push(`PROFILE_SCHEMA_ID expected ${PROFILE_TITLE}`);
    }
    if (profileSchema.additionalProperties !== false) {
      errors.push("SCHEMA_UNKNOWN_FIELD_POLICY profile additionalProperties must be false");
    }
  }
};

const parseProfile = (profile: unknown, errors: string[]): Record<string, unknown> | null => {
  if (profile === null || profile === undefined) {
    errors.push("MISSING_PROFILE opportunity_profile is required");
    return null;
  }
  if (!isPlainRecord(profile)) {
    errors.push("MISSING_PROFILE opportunity_profile is required");
    return null;
  }
  for (const field of PROFILE_FIELDS) {
    if (!Object.hasOwn(profile, field)) {
      errors.push(`MISSING_PROFILE opportunity_profile.${field} is required`);
    }
  }
  for (const field of Object.keys(profile)) {
    if (!(PROFILE_FIELDS as readonly string[]).includes(field)) {
      errors.push(`PROFILE_DEAD_FIELD ${field} is not part of the opportunity-profile contract`);
    }
  }
  for (const field of PROFILE_DIGEST_FIELDS) {
    if (Object.hasOwn(profile, field) && !isDigest(profile[field])) {
      errors.push(`PROFILE_DIGEST_INVALID ${field} must be a 64-character lowercase hex SHA-256`);
    }
  }
  if (Object.hasOwn(profile, "model_revision") && profile.model_revision !== null && !isFilledString(profile.model_revision)) {
    errors.push("PROFILE_FIELD_INVALID model_revision must be a non-empty string or null");
  }
  for (const field of PROFILE_FIELDS) {
    if (field === "model_revision" || (PROFILE_DIGEST_FIELDS as readonly string[]).includes(field)) continue;
    if (Object.hasOwn(profile, field) && !isFilledString(profile[field])) {
      errors.push(`PROFILE_FIELD_INVALID ${field} must be a non-empty string`);
    }
  }
  return errors.some((entry) => entry.startsWith("MISSING_PROFILE") || entry.startsWith("PROFILE_"))
    ? null
    : profile;
};

const parseScore = (score: unknown, errors: string[]): ResultScore | null | undefined => {
  if (score === null) return null;
  if (!isPlainRecord(score)) {
    errors.push("SCORE_INVALID score must be null or an object with raw and display");
    return undefined;
  }
  for (const field of Object.keys(score)) {
    if (field !== "raw" && field !== "display") {
      errors.push(`SCORE_DEAD_FIELD ${field} is not part of the score contract`);
    }
  }
  if (!isScoreNumber(score.raw)) errors.push("SCORE_RAW_INVALID raw must be a finite number in [0, 100]");
  if (!isScoreNumber(score.display) || score.display % 5 !== 0) {
    errors.push("SCORE_DISPLAY_INVALID display must be a multiple of 5 in [0, 100]");
  }
  if (typeof score.raw === "number" && typeof score.display === "number") {
    return { raw: score.raw, display: score.display };
  }
  return undefined;
};

const parseFactors = (factors: unknown, errors: string[]): ResultFactors | null => {
  if (!isPlainRecord(factors)) {
    errors.push("FACTORS_INVALID factors must be an object with F1-F6");
    return null;
  }
  for (const field of Object.keys(factors)) {
    if (field === "safety") {
      errors.push("SAFETY_NOT_A_FACTOR safety is reported beside the score and never inside factors");
      continue;
    }
    if (!(FACTOR_IDS as readonly string[]).includes(field)) {
      errors.push(`FACTOR_DEAD_FIELD ${field} is not one of F1-F6`);
    }
  }
  const parsed: ResultFactors = {};
  for (const factorId of FACTOR_IDS) {
    if (!Object.hasOwn(factors, factorId)) {
      errors.push(`FACTOR_MISSING ${factorId} is required`);
      continue;
    }
    const value = factors[factorId];
    if (value !== null && !isUnitNumber(value)) {
      errors.push(`FACTOR_INVALID ${factorId} must be a finite number in [0, 1] or null`);
      continue;
    }
    parsed[factorId] = value;
  }
  return parsed;
};

const parseSafety = (safety: unknown, errors: string[]): ResultSafety | null => {
  if (!isPlainRecord(safety)) {
    errors.push("SAFETY_INVALID safety must be an object with level and state");
    return null;
  }
  for (const field of Object.keys(safety)) {
    if (field !== "level" && field !== "state") {
      errors.push(`SAFETY_DEAD_FIELD ${field} is not part of the safety contract`);
    }
  }
  const level = safety.level;
  const state = safety.state;
  if (typeof level !== "string" || !(SAFETY_LEVELS as readonly string[]).includes(level)) {
    errors.push(`SAFETY_LEVEL_INVALID ${String(level)} is outside S0-S3`);
  }
  const expectedState = typeof level === "string" ? SAFETY_STATES[level] : undefined;
  if (typeof state !== "string" || (expectedState !== undefined && state !== expectedState)) {
    errors.push(`SAFETY_STATE_MISMATCH ${String(level)} derives ${String(expectedState)}`);
  }
  return typeof level === "string" && typeof state === "string" ? { level, state } : null;
};

const parseOneResult = (input: unknown, errors: string[]): ParsedResult | null => {
  if (!isPlainRecord(input)) {
    errors.push("RESULT_NOT_AN_OBJECT an aos-result must be a JSON object");
    return null;
  }

  for (const field of RESULT_FIELDS) {
    if (!Object.hasOwn(input, field)) {
      if (field === "opportunity_profile") {
        errors.push("MISSING_PROFILE opportunity_profile is required");
      } else {
        errors.push(`RESULT_MISSING_FIELD ${field} is required by the aos-result contract`);
      }
    }
  }
  for (const field of Object.keys(input)) {
    if ((FORBIDDEN_PERCENTILE_FIELDS as readonly string[]).includes(field)) {
      errors.push(`PERCENTILE_FORBIDDEN ${field} is not representable on a P0 result`);
    } else if (!(RESULT_FIELDS as readonly string[]).includes(field)) {
      errors.push(`RESULT_DEAD_FIELD ${field} is not part of the aos-result contract`);
    }
  }

  if (Object.hasOwn(input, "schema_id") && input.schema_id !== SCHEMA_ID) {
    errors.push(`RESULT_SCHEMA_ID expected ${SCHEMA_ID}`);
  }
  if (Object.hasOwn(input, "schema_version") && input.schema_version !== SCHEMA_VERSION) {
    errors.push(`RESULT_SCHEMA_VERSION expected ${SCHEMA_VERSION}`);
  }
  if (Object.hasOwn(input, "run_id") && !isFilledString(input.run_id)) {
    errors.push("RESULT_RUN_ID run_id must be a non-empty string");
  }

  const status = input.status;
  if (Object.hasOwn(input, "status") && (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status))) {
    errors.push(`UNKNOWN_STATUS ${String(status)} is outside the frozen result status set`);
  }

  const score = Object.hasOwn(input, "score") ? parseScore(input.score, errors) : undefined;
  const hasScore = score !== null && score !== undefined;
  if (status === ISSUABLE_STATUS && !hasScore) {
    errors.push("SCORE_REQUIRED EXPERIMENTAL / PROVISIONAL requires a score");
  }
  if (typeof status === "string" && SCORELESS_STATUSES.has(status) && hasScore) {
    errors.push(`SCORE_NOT_ALLOWED ${status} cannot encode a score`);
  }

  const attribution = input.attribution;
  if (Object.hasOwn(input, "attribution") &&
      (typeof attribution !== "string" || !(ATTRIBUTIONS as readonly string[]).includes(attribution))) {
    errors.push(`UNKNOWN_ATTRIBUTION ${String(attribution)} is outside the frozen attribution set`);
  }
  const confidence = input.attribution_confidence;
  if (Object.hasOwn(input, "attribution_confidence") && !isUnitNumber(confidence)) {
    errors.push("ATTRIBUTION_CONFIDENCE_INVALID attribution_confidence must be a finite number in [0, 1]");
  }
  if (attribution === UNKNOWN_ACTOR) {
    if (status !== DIAGNOSTIC_STATUS) {
      errors.push("DIAGNOSTIC_ONLY actor.attribution_unknown must yield DIAGNOSTIC ONLY");
    }
    if (hasScore) {
      errors.push("SCORE_NOT_ALLOWED actor.attribution_unknown must withhold the score");
    }
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence >= CONFIDENCE_DROP_THRESHOLD) {
      errors.push("CONFIDENCE_DROP_REQUIRED actor.attribution_unknown must record confidence below 0.7");
    }
  }
  if (status === DIAGNOSTIC_STATUS && attribution !== UNKNOWN_ACTOR) {
    errors.push("DIAGNOSTIC_ONLY DIAGNOSTIC ONLY requires actor.attribution_unknown");
  }

  const factors = Object.hasOwn(input, "factors") ? parseFactors(input.factors, errors) : null;
  const safety = Object.hasOwn(input, "safety") ? parseSafety(input.safety, errors) : null;

  if (Object.hasOwn(input, "coverage") && !isUnitNumber(input.coverage)) {
    errors.push("COVERAGE_INVALID coverage must be a finite number in [0, 1]");
  }

  if (hasScore) {
    if (!isDigest(input.score_digest)) {
      errors.push("SCORE_DIGEST_REQUIRED a scored result requires a 64-character lowercase hex score_digest");
    }
  } else if (Object.hasOwn(input, "score_digest") && input.score_digest !== null) {
    errors.push("SCORE_DIGEST_NOT_ALLOWED a withheld score cannot carry a score_digest");
  }
  for (const field of RESULT_DIGEST_FIELDS) {
    if (Object.hasOwn(input, field) && !isDigest(input[field])) {
      errors.push(`RESULT_DIGEST_INVALID ${field} must be a 64-character lowercase hex SHA-256`);
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    if (Object.hasOwn(input, field) && typeof input[field] !== "boolean") {
      errors.push(`RESULT_FIELD_INVALID ${field} must be a boolean`);
    }
  }
  if (Object.hasOwn(input, "retest_type") &&
      (typeof input.retest_type !== "string" || !(RETEST_TYPES as readonly string[]).includes(input.retest_type))) {
    errors.push(`UNKNOWN_RETEST_TYPE ${String(input.retest_type)} is outside the frozen retest types`);
  }
  if (Object.hasOwn(input, "limitations") && !isFilledString(input.limitations)) {
    errors.push("RESULT_FIELD_INVALID limitations must be a non-empty string");
  }

  const profile = Object.hasOwn(input, "opportunity_profile")
    ? parseProfile(input.opportunity_profile, errors)
    : null;

  if (errors.length > 0) return null;
  if (score === undefined || factors === null || safety === null || profile === null) return null;
  if (!isFilledString(input.run_id) || typeof status !== "string") return null;
  if (typeof input.coverage !== "number" || typeof input.attribution !== "string") return null;
  if (typeof input.attribution_confidence !== "number") return null;
  if (typeof input.retest_type !== "string" || typeof input.limitations !== "string") return null;
  if (typeof input.scorer_digest !== "string" || typeof input.suite_digest !== "string") return null;
  if (typeof input.adapter_digest !== "string") return null;
  if (typeof input.declared_manual_takeover !== "boolean") return null;
  if (typeof input.external_mutation !== "boolean") return null;
  if (typeof input.comparison_eligible !== "boolean") return null;

  return {
    schema_id: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    run_id: input.run_id,
    status,
    score,
    factors,
    safety,
    coverage: input.coverage,
    score_digest: isDigest(input.score_digest) ? input.score_digest : null,
    scorer_digest: input.scorer_digest,
    suite_digest: input.suite_digest,
    adapter_digest: input.adapter_digest,
    declared_manual_takeover: input.declared_manual_takeover,
    external_mutation: input.external_mutation,
    attribution: input.attribution,
    attribution_confidence: input.attribution_confidence,
    retest_type: input.retest_type,
    comparison_eligible: input.comparison_eligible,
    opportunity_profile: profile,
    limitations: input.limitations
  };
};

export const parseResult = (
  result: unknown,
  resultSchema: unknown,
  profileSchema: unknown
): ParseResultResult => {
  const errors: string[] = [];
  validateSchemaDocuments(resultSchema, profileSchema, errors);
  if (errors.length > 0) return failParse(errors);
  const parsed = parseOneResult(result, errors);
  if (errors.length > 0 || parsed === null) return failParse(errors);
  return { ok: true, errors: [], result: parsed };
};

export const canonicalizeResult = (
  result: unknown,
  resultSchema: unknown,
  profileSchema: unknown
): CanonicalizeResultResult => {
  const parsed = parseResult(result, resultSchema, profileSchema);
  if (!parsed.ok || parsed.result === undefined) return failCanonical(parsed.errors);
  const canonical = parsed.result;
  return {
    ok: true,
    errors: [],
    bytes: stableJson(canonical),
    score_withheld: canonical.attribution === UNKNOWN_ACTOR,
    diagnostic_only: canonical.status === DIAGNOSTIC_STATUS
  };
};
