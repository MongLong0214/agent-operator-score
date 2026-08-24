import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadResult = async () => {
  try {
    return await import("../src/schema/result.ts");
  } catch {
    return {};
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const resultSchemaPath = resolve(here, "../specs/aos-result.schema.json");
const profileSchemaPath = resolve(here, "../specs/opportunity-profile.schema.json");

const ISSUABLE_MESSAGE = "result schema assertion failed: issuable result must parse";
const ESTIMATE_MESSAGE = "result schema assertion failed: estimate result must parse";
const INSUFFICIENT_MESSAGE = "result schema rejected: insufficient state with score";
const UNSAFE_MESSAGE = "result schema rejected: unsafe state with score";
const INVALID_MESSAGE = "result schema rejected: invalid state with score";
const MISSING_PROFILE_MESSAGE = "result schema rejected: missing profile";
const PERCENTILE_MESSAGE = "result schema rejected: percentile";
const STABLE_BYTES_MESSAGE = "result schema assertion failed: canonical bytes must be stable";
const UNKNOWN_ATTRIBUTION_MESSAGE =
  "result schema assertion failed: unknown attribution must withhold the score";

const DIGEST = "a".repeat(64);
const RUN_ID = "run-e1-002";
const CONFIDENCE_DROP_THRESHOLD = 0.7;
const FACTOR_IDS = ["F1", "F2", "F3", "F4", "F5", "F6"] as const;
const ISSUABLE_STATUS = "EXPERIMENTAL / PROVISIONAL";
const ESTIMATE_STATUS = "ESTIMATE";
const INSUFFICIENT_STATUS = "INSUFFICIENT_EVIDENCE";
const UNSAFE_STATUS = "UNSAFE";
const INVALID_STATUS = "INVALID";
const DIAGNOSTIC_STATUS = "DIAGNOSTIC ONLY";
const UNKNOWN_ACTOR = "actor.attribution_unknown";
const FORBIDDEN_PERCENTILE_FIELDS = ["percentile", "certification", "rank", "percentile_rank"];

const assertExported = (value: unknown, message: string) =>
  assert.equal(typeof value, "function", message);

const has = (result: { errors?: string[] } | undefined, needle: string) =>
  Boolean(result?.errors?.some((entry) => entry.includes(needle)));

const frozenResultSchema = () => JSON.parse(readFileSync(resultSchemaPath, "utf8"));
const frozenProfileSchema = () => JSON.parse(readFileSync(profileSchemaPath, "utf8"));

const validProfile = () => ({
  suite: "coding-core-v0",
  family: "six-family",
  form_version: "A",
  language: "typescript",
  runtime: "codex",
  adapter_version: "aos-controlled-wrapper-v0",
  model_id: "gpt-5.6-sol",
  model_revision: "2026-08-08",
  reasoning_settings: "default",
  harness_profile: "native",
  harness_digest: DIGEST,
  skill_hook_mcp: "none",
  skill_hook_mcp_digest: DIGEST,
  tool_surface: "standard",
  permission_profile: "restricted",
  network_profile: "deny-all",
  context_budget: "standard",
  token_budget: "standard",
  time_budget: "45m",
  tool_call_budget: "standard",
  intervention_policy: "declared-takeover-only",
  repository_digest: DIGEST,
  environment_digest: DIGEST
});

const validFactors = () => ({
  F1: 0.75,
  F2: 0.75,
  F3: 0.75,
  F4: 0.5,
  F5: 0.8,
  F6: 0.4
});

const validIssuable = (extra: Record<string, unknown> = {}) => ({
  schema_id: "aos-result",
  schema_version: "aos-result.schema.v0",
  run_id: RUN_ID,
  status: ISSUABLE_STATUS,
  score: { raw: 78.4, display: 80 },
  factors: validFactors(),
  safety: { level: "S0", state: "SAFE" },
  coverage: 0.86,
  score_digest: DIGEST,
  scorer_digest: DIGEST,
  suite_digest: DIGEST,
  adapter_digest: DIGEST,
  declared_manual_takeover: false,
  external_mutation: false,
  attribution: "agent",
  attribution_confidence: 1,
  retest_type: "none",
  comparison_eligible: false,
  opportunity_profile: validProfile(),
  limitations: "EXPERIMENTAL / PROVISIONAL. No percentile. Matched N<300.",
  ...extra
});

const validUnscored = (status: string, extra: Record<string, unknown> = {}) =>
  validIssuable({
    status,
    score: null,
    score_digest: null,
    ...extra
  });

describe("result-schema", () => {
test("issuable", async () => {
  const { parseResult, canonicalizeResult } = await loadResult();
  assertExported(parseResult, ISSUABLE_MESSAGE);
  assertExported(canonicalizeResult, ISSUABLE_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  assert.equal(resultSchema.title, "aos-result", ISSUABLE_MESSAGE);
  assert.equal(resultSchema.additionalProperties, false, ISSUABLE_MESSAGE);
  assert.equal(profileSchema.title, "opportunity-profile", ISSUABLE_MESSAGE);
  assert.equal(profileSchema.additionalProperties, false, ISSUABLE_MESSAGE);

  const payload = validIssuable();
  const parsed = parseResult(payload, resultSchema, profileSchema);
  assert.equal(parsed.ok, true, ISSUABLE_MESSAGE);
  assert.deepEqual(parsed.errors, [], ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.status, ISSUABLE_STATUS, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.score?.raw, 78.4, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.score?.display, 80, ISSUABLE_MESSAGE);
  for (const factorId of FACTOR_IDS) {
    assert.equal(typeof parsed.result?.factors?.[factorId], "number", `${ISSUABLE_MESSAGE}: ${factorId}`);
  }
  assert.equal(Object.hasOwn(parsed.result?.factors ?? {}, "safety"), false, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.safety?.level, "S0", ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.safety?.state, "SAFE", ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.coverage, 0.86, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.score_digest, DIGEST, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.declared_manual_takeover, false, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.external_mutation, false, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.attribution_confidence, 1, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.retest_type, "none", ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.comparison_eligible, false, ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.opportunity_profile?.suite, "coding-core-v0", ISSUABLE_MESSAGE);
  assert.equal(parsed.result?.opportunity_profile?.runtime, "codex", ISSUABLE_MESSAGE);

  const withheld = parseResult(validIssuable({ score: null, score_digest: null }), resultSchema, profileSchema);
  assert.equal(withheld.ok, false, ISSUABLE_MESSAGE);
  assert.ok(has(withheld, "SCORE_REQUIRED"), ISSUABLE_MESSAGE);

  const canonical = canonicalizeResult(payload, resultSchema, profileSchema);
  assert.equal(canonical.ok, true, ISSUABLE_MESSAGE);
  assert.equal(canonical.score_withheld, false, ISSUABLE_MESSAGE);
  assert.equal(canonical.diagnostic_only, false, ISSUABLE_MESSAGE);
});

test("estimate", async () => {
  const { parseResult } = await loadResult();
  assertExported(parseResult, ESTIMATE_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  const accepted = parseResult(validUnscored(ESTIMATE_STATUS), resultSchema, profileSchema);
  assert.equal(accepted.ok, true, ESTIMATE_MESSAGE);
  assert.deepEqual(accepted.errors, [], ESTIMATE_MESSAGE);
  assert.equal(accepted.result?.status, ESTIMATE_STATUS, ESTIMATE_MESSAGE);
  assert.equal(accepted.result?.score, null, ESTIMATE_MESSAGE);

  const scored = parseResult(
    validUnscored(ESTIMATE_STATUS, { score: { raw: 78.4, display: 80 }, score_digest: DIGEST }),
    resultSchema,
    profileSchema
  );
  assert.equal(scored.ok, false, ESTIMATE_MESSAGE);
  assert.ok(has(scored, "SCORE_NOT_ALLOWED"), ESTIMATE_MESSAGE);
});

test("insufficient", async () => {
  const { parseResult } = await loadResult();
  assertExported(parseResult, INSUFFICIENT_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  const accepted = parseResult(validUnscored(INSUFFICIENT_STATUS), resultSchema, profileSchema);
  assert.equal(accepted.ok, true, INSUFFICIENT_MESSAGE);
  assert.equal(accepted.result?.status, INSUFFICIENT_STATUS, INSUFFICIENT_MESSAGE);
  assert.equal(accepted.result?.score, null, INSUFFICIENT_MESSAGE);

  const scored = parseResult(
    validUnscored(INSUFFICIENT_STATUS, { score: { raw: 40, display: 40 }, score_digest: DIGEST }),
    resultSchema,
    profileSchema
  );
  assert.equal(scored.ok, false, INSUFFICIENT_MESSAGE);
  assert.ok(has(scored, "SCORE_NOT_ALLOWED"), INSUFFICIENT_MESSAGE);
});

test("unsafe", async () => {
  const { parseResult } = await loadResult();
  assertExported(parseResult, UNSAFE_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  const accepted = parseResult(
    validUnscored(UNSAFE_STATUS, { safety: { level: "S2", state: "S2" } }),
    resultSchema,
    profileSchema
  );
  assert.equal(accepted.ok, true, UNSAFE_MESSAGE);
  assert.equal(accepted.result?.status, UNSAFE_STATUS, UNSAFE_MESSAGE);
  assert.equal(accepted.result?.score, null, UNSAFE_MESSAGE);
  assert.equal(accepted.result?.safety?.level, "S2", UNSAFE_MESSAGE);

  const scored = parseResult(
    validUnscored(UNSAFE_STATUS, {
      safety: { level: "S2", state: "S2" },
      score: { raw: 80, display: 80 },
      score_digest: DIGEST
    }),
    resultSchema,
    profileSchema
  );
  assert.equal(scored.ok, false, UNSAFE_MESSAGE);
  assert.ok(has(scored, "SCORE_NOT_ALLOWED"), UNSAFE_MESSAGE);
});

test("invalid", async () => {
  const { parseResult } = await loadResult();
  assertExported(parseResult, INVALID_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  const accepted = parseResult(validUnscored(INVALID_STATUS), resultSchema, profileSchema);
  assert.equal(accepted.ok, true, INVALID_MESSAGE);
  assert.equal(accepted.result?.status, INVALID_STATUS, INVALID_MESSAGE);
  assert.equal(accepted.result?.score, null, INVALID_MESSAGE);

  const scored = parseResult(
    validUnscored(INVALID_STATUS, { score: { raw: 10, display: 10 }, score_digest: DIGEST }),
    resultSchema,
    profileSchema
  );
  assert.equal(scored.ok, false, INVALID_MESSAGE);
  assert.ok(has(scored, "SCORE_NOT_ALLOWED"), INVALID_MESSAGE);
});

test("missing-profile", async () => {
  const { parseResult } = await loadResult();
  assertExported(parseResult, MISSING_PROFILE_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  const omitted = validIssuable();
  delete (omitted as { opportunity_profile?: unknown }).opportunity_profile;
  const dropped = parseResult(omitted, resultSchema, profileSchema);
  assert.equal(dropped.ok, false, MISSING_PROFILE_MESSAGE);
  assert.ok(has(dropped, "MISSING_PROFILE"), MISSING_PROFILE_MESSAGE);

  const blank = validIssuable({ opportunity_profile: null });
  const blanked = parseResult(blank, resultSchema, profileSchema);
  assert.equal(blanked.ok, false, MISSING_PROFILE_MESSAGE);
  assert.ok(has(blanked, "MISSING_PROFILE"), MISSING_PROFILE_MESSAGE);
});

test("percentile-reject", async () => {
  const { parseResult } = await loadResult();
  assertExported(parseResult, PERCENTILE_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  for (const field of FORBIDDEN_PERCENTILE_FIELDS) {
    const payload = validIssuable({ [field]: 99 });
    const rejected = parseResult(payload, resultSchema, profileSchema);
    assert.equal(rejected.ok, false, `${PERCENTILE_MESSAGE}: ${field}`);
    assert.ok(has(rejected, "PERCENTILE_FORBIDDEN"), `${PERCENTILE_MESSAGE}: ${field}`);
  }
});

test("stable-bytes", async () => {
  const { canonicalizeResult } = await loadResult();
  assertExported(canonicalizeResult, STABLE_BYTES_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();
  const payload = validIssuable();
  const first = canonicalizeResult(payload, resultSchema, profileSchema);
  assert.equal(first.ok, true, STABLE_BYTES_MESSAGE);
  assert.equal(typeof first.bytes, "string", STABLE_BYTES_MESSAGE);
  assert.ok(first.bytes && first.bytes.length > 0, STABLE_BYTES_MESSAGE);
  const second = canonicalizeResult(JSON.parse(first.bytes as string), resultSchema, profileSchema);
  assert.equal(second.ok, true, STABLE_BYTES_MESSAGE);
  assert.equal(first.bytes, second.bytes, STABLE_BYTES_MESSAGE);
  const shuffled = {
    limitations: payload.limitations,
    opportunity_profile: payload.opportunity_profile,
    comparison_eligible: payload.comparison_eligible,
    retest_type: payload.retest_type,
    attribution_confidence: payload.attribution_confidence,
    attribution: payload.attribution,
    external_mutation: payload.external_mutation,
    declared_manual_takeover: payload.declared_manual_takeover,
    adapter_digest: payload.adapter_digest,
    suite_digest: payload.suite_digest,
    scorer_digest: payload.scorer_digest,
    score_digest: payload.score_digest,
    coverage: payload.coverage,
    safety: payload.safety,
    factors: payload.factors,
    score: payload.score,
    status: payload.status,
    run_id: payload.run_id,
    schema_version: payload.schema_version,
    schema_id: payload.schema_id
  };
  const reordered = canonicalizeResult(shuffled, resultSchema, profileSchema);
  assert.equal(reordered.ok, true, STABLE_BYTES_MESSAGE);
  assert.equal(reordered.bytes, first.bytes, STABLE_BYTES_MESSAGE);
});

test("unknown-attribution-withholds-score", async () => {
  const { parseResult, canonicalizeResult } = await loadResult();
  assertExported(parseResult, UNKNOWN_ATTRIBUTION_MESSAGE);
  assertExported(canonicalizeResult, UNKNOWN_ATTRIBUTION_MESSAGE);
  const resultSchema = frozenResultSchema();
  const profileSchema = frozenProfileSchema();

  const diagnostic = validUnscored(DIAGNOSTIC_STATUS, {
    attribution: UNKNOWN_ACTOR,
    attribution_confidence: 0.69
  });
  const accepted = parseResult(diagnostic, resultSchema, profileSchema);
  assert.equal(accepted.ok, true, UNKNOWN_ATTRIBUTION_MESSAGE);
  assert.equal(accepted.result?.status, DIAGNOSTIC_STATUS, UNKNOWN_ATTRIBUTION_MESSAGE);
  assert.equal(accepted.result?.score, null, UNKNOWN_ATTRIBUTION_MESSAGE);
  const canonical = canonicalizeResult(diagnostic, resultSchema, profileSchema);
  assert.equal(canonical.ok, true, UNKNOWN_ATTRIBUTION_MESSAGE);
  assert.equal(canonical.score_withheld, true, UNKNOWN_ATTRIBUTION_MESSAGE);
  assert.equal(canonical.diagnostic_only, true, UNKNOWN_ATTRIBUTION_MESSAGE);

  const scored = parseResult(
    validUnscored(DIAGNOSTIC_STATUS, {
      attribution: UNKNOWN_ACTOR,
      attribution_confidence: 0.69,
      score: { raw: 78.4, display: 80 },
      score_digest: DIGEST
    }),
    resultSchema,
    profileSchema
  );
  assert.equal(scored.ok, false, UNKNOWN_ATTRIBUTION_MESSAGE);
  assert.ok(has(scored, "SCORE_NOT_ALLOWED"), UNKNOWN_ATTRIBUTION_MESSAGE);

  const issued = parseResult(
    validIssuable({
      attribution: UNKNOWN_ACTOR,
      attribution_confidence: 0.69
    }),
    resultSchema,
    profileSchema
  );
  assert.equal(issued.ok, false, UNKNOWN_ATTRIBUTION_MESSAGE);
  assert.ok(
    has(issued, "DIAGNOSTIC_ONLY") || has(issued, "SCORE_NOT_ALLOWED"),
    UNKNOWN_ATTRIBUTION_MESSAGE
  );

  const kept = parseResult(
    validUnscored(DIAGNOSTIC_STATUS, {
      attribution: UNKNOWN_ACTOR,
      attribution_confidence: CONFIDENCE_DROP_THRESHOLD
    }),
    resultSchema,
    profileSchema
  );
  assert.equal(kept.ok, false, UNKNOWN_ATTRIBUTION_MESSAGE);
  assert.ok(has(kept, "CONFIDENCE_DROP_REQUIRED"), UNKNOWN_ATTRIBUTION_MESSAGE);
});
});
