import assert from "node:assert/strict";
import { describe, test } from "node:test";

const HONEST = "canonical result has no stable honest user projection.";

type ReportApi = {
  renderJsonReport: (result: unknown) => string;
  renderMarkdownReport: (result: unknown) => string;
};

const loadReport = async () => {
  try {
    return await import("../src/reporter/report.ts");
  } catch {
    return {};
  }
};

const requireReports = async (): Promise<ReportApi> => {
  const report = await loadReport();
  assert.equal(typeof report.renderJsonReport, "function", HONEST);
  assert.equal(typeof report.renderMarkdownReport, "function", HONEST);
  return report as ReportApi;
};

const digest = (character: string): string => character.repeat(64);

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const value = (input: unknown): string => JSON.stringify(input);

const profile = () => ({
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
  harness_digest: digest("e"),
  skill_hook_mcp: "none",
  skill_hook_mcp_digest: digest("f"),
  tool_surface: "standard",
  permission_profile: "restricted",
  network_profile: "deny-all",
  context_budget: "standard",
  token_budget: "standard",
  time_budget: "45m",
  tool_call_budget: "standard",
  intervention_policy: "declared-takeover-only",
  repository_digest: digest("0"),
  environment_digest: digest("1")
});

const issuable = (extra: Record<string, unknown> = {}) => ({
  schema_id: "aos-result",
  schema_version: "aos-result.schema.v0",
  run_id: "e10-001-report",
  status: "EXPERIMENTAL / PROVISIONAL",
  score: { raw: 78.4, display: 80 },
  factors: { F1: 0.71, F2: 0.72, F3: 0.73, F4: 0.74, F5: 0.75, F6: 0.76 },
  safety: { level: "S0", state: "SAFE" },
  coverage: 0.86,
  score_digest: digest("a"),
  scorer_digest: digest("b"),
  suite_digest: digest("c"),
  adapter_digest: digest("d"),
  declared_manual_takeover: false,
  external_mutation: false,
  attribution: "agent",
  attribution_confidence: 0.99,
  retest_type: "operator_transfer",
  comparison_eligible: false,
  opportunity_profile: profile(),
  limitations: "EXPERIMENTAL / PROVISIONAL. No percentile. Matched N<300.",
  ...extra
});

const withheld = (
  status: "INSUFFICIENT_EVIDENCE" | "UNSAFE" | "INVALID",
  extra: Record<string, unknown> = {}
) => issuable({ status, score: null, score_digest: null, ...extra });

const fields = [
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
];

const profileFields = [
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
];

const markdown = (result: Record<string, unknown>): string => {
  const factors = result.factors as Record<string, unknown>;
  const safety = result.safety as Record<string, unknown>;
  const opportunity = result.opportunity_profile as Record<string, unknown>;
  const comparison = result.comparison_eligible === true
    ? "DIRECT_COMPARISON_ELIGIBLE"
    : "DIRECT_COMPARISON_NOT_ALLOWED";
  return [
    "# AOS report",
    `schema_id: ${value(result.schema_id)}`,
    `schema_version: ${value(result.schema_version)}`,
    `run_id: ${value(result.run_id)}`,
    `status: ${value(result.status)}`,
    `score: ${value(result.score)}`,
    `coverage: ${value(result.coverage)}`,
    `safety_level: ${value(safety.level)}`,
    `safety_state: ${value(safety.state)}`,
    "## factors",
    `F1: ${value(factors.F1)}`,
    `F2: ${value(factors.F2)}`,
    `F3: ${value(factors.F3)}`,
    `F4: ${value(factors.F4)}`,
    `F5: ${value(factors.F5)}`,
    `F6: ${value(factors.F6)}`,
    "## versions and digests",
    `score_digest: ${value(result.score_digest)}`,
    `scorer_digest: ${value(result.scorer_digest)}`,
    `suite_digest: ${value(result.suite_digest)}`,
    `adapter_digest: ${value(result.adapter_digest)}`,
    "## takeover and retest",
    `declared_manual_takeover: ${value(result.declared_manual_takeover)}`,
    `external_mutation: ${value(result.external_mutation)}`,
    `attribution: ${value(result.attribution)}`,
    `attribution_confidence: ${value(result.attribution_confidence)}`,
    `retest_type: ${value(result.retest_type)}`,
    `comparison_restriction: ${comparison}`,
    "## Opportunity Profile",
    ...profileFields.map((field) => `${field}: ${value(opportunity[field])}`),
    "## limitations",
    `limitations: ${value(result.limitations)}`
  ].join("\n");
};

const assertProjection = (
  api: ReportApi,
  result: Record<string, unknown>,
  expectedMarkdown = markdown(result)
): void => {
  const json = api.renderJsonReport(result);
  const renderedMarkdown = api.renderMarkdownReport(result);
  assert.equal(typeof json, "string", HONEST);
  assert.equal(typeof renderedMarkdown, "string", HONEST);
  assert.equal(json, canonical(result), HONEST);
  assert.equal(renderedMarkdown, expectedMarkdown, HONEST);
  const report = JSON.parse(json) as Record<string, unknown>;
  for (const field of fields) assert.deepEqual(report[field], result[field], HONEST);
};

const assertRefused = (render: () => string): void => {
  assert.throws(render, { message: HONEST }, HONEST);
};

const clone = <T>(input: T): T => JSON.parse(JSON.stringify(input)) as T;

const assertRejectedByBoth = (api: ReportApi, result: Record<string, unknown>): void => {
  assertRefused(() => api.renderJsonReport(result));
  assertRefused(() => api.renderMarkdownReport(result));
};

describe("report", () => {
  test("issuable", async () => {
    const api = await requireReports();
    const result = issuable();
    assertProjection(api, result);
    for (const factor of ["F1", "F2", "F3", "F4", "F5", "F6"]) {
      assertProjection(api, issuable({ factors: { ...(result.factors as Record<string, unknown>), [factor]: null } }));
    }
    for (const retestType of ["none", "environment_uplift", "combined_uplift"]) {
      assertProjection(api, issuable({ retest_type: retestType }));
    }
    const acceptedRetestType = issuable({ retest_type: "operator_transfer" });
    assertProjection(api, acceptedRetestType);
    assertRejectedByBoth(api, { ...acceptedRetestType, retest_type: "anything" });
    assertProjection(api, issuable({ declared_manual_takeover: true }));
    assertProjection(api, issuable({ external_mutation: true, attribution: "external_mutation" }));
    assertProjection(api, issuable({ attribution: "human/takeover" }));
    const acceptedAttribution = issuable({ attribution: "agent" });
    assertProjection(api, acceptedAttribution);
    assertRejectedByBoth(api, { ...acceptedAttribution, attribution: "anything" });
    assertProjection(api, issuable({ opportunity_profile: { ...profile(), model_revision: null } }));
    assertProjection(api, issuable({ status: "ESTIMATE", score: null, score_digest: null }));
    assertProjection(api, issuable({
      status: "DIAGNOSTIC ONLY",
      score: null,
      score_digest: null,
      attribution: "actor.attribution_unknown",
      attribution_confidence: 0.69
    }));
    assertRejectedByBoth(api, issuable({ score: null, score_digest: null }));
    assertRejectedByBoth(api, issuable({
      status: "DIAGNOSTIC ONLY",
      score: null,
      score_digest: null
    }));
    assertRejectedByBoth(api, issuable({
      attribution: "actor.attribution_unknown",
      attribution_confidence: 0.69
    }));
    assertRejectedByBoth(api, issuable({
      status: "DIAGNOSTIC ONLY",
      score: null,
      score_digest: null,
      attribution: "actor.attribution_unknown",
      attribution_confidence: 0.7
    }));

    // A report can only project a complete canonical result. Each omission varies one input
    // against the same accepted record, so the required-field guard cannot collapse to a
    // length check or a generic truthiness test.
    for (const field of fields) {
      const missing = clone(result);
      delete missing[field];
      assertRejectedByBoth(api, missing);
    }
    assertRejectedByBoth(api, { ...result, unsupported: true });

    const malformed: [string, Record<string, unknown>][] = [
      ["schema_id", { ...result, schema_id: "other-result" }],
      ["schema_version", { ...result, schema_version: "other-version" }],
      ["run_id", { ...result, run_id: "" }],
      ["status", { ...result, status: "CALIBRATED" }],
      ["score raw", { ...result, score: { raw: -1, display: 80 } }],
      ["score display", { ...result, score: { raw: 78.4, display: 79 } }],
      ["coverage", { ...result, coverage: 1.01 }],
      ["score digest", { ...result, score_digest: "a" }],
      ["scorer digest", { ...result, scorer_digest: "b" }],
      ["suite digest", { ...result, suite_digest: "c" }],
      ["adapter digest", { ...result, adapter_digest: "d" }],
      ["declared takeover", { ...result, declared_manual_takeover: "false" }],
      ["external mutation", { ...result, external_mutation: "false" }],
      ["attribution", { ...result, attribution: "unknown" }],
      ["attribution confidence", { ...result, attribution_confidence: 1.01 }],
      ["retest type", { ...result, retest_type: "growth" }],
      ["comparison eligible", { ...result, comparison_eligible: "false" }],
      ["limitations", { ...result, limitations: "" }],
      ["safety level", { ...result, safety: { level: "S4", state: "S4" } }],
      ["safety state", { ...result, safety: { level: "S0", state: "S1" } }]
    ];
    for (const [, malformedResult] of malformed) assertRejectedByBoth(api, malformedResult);

    for (const factor of ["F1", "F2", "F3", "F4", "F5", "F6"]) {
      const factors = clone(result.factors as Record<string, unknown>);
      factors[factor] = "not-a-factor-score";
      assertRejectedByBoth(api, { ...result, factors });
    }
    assertRejectedByBoth(api, { ...result, factors: { ...(result.factors as Record<string, unknown>), F7: 0 } });

    for (const field of profileFields) {
      const opportunity = clone(result.opportunity_profile as Record<string, unknown>);
      opportunity[field] = field === "model_revision" ? false : "";
      assertRejectedByBoth(api, { ...result, opportunity_profile: opportunity });
    }
    for (const field of ["harness_digest", "skill_hook_mcp_digest", "repository_digest", "environment_digest"]) {
      const opportunity = clone(result.opportunity_profile as Record<string, unknown>);
      opportunity[field] = "not-a-digest";
      assertRejectedByBoth(api, { ...result, opportunity_profile: opportunity });
    }
    assertRejectedByBoth(api, {
      ...result,
      opportunity_profile: { ...(result.opportunity_profile as Record<string, unknown>), unsupported: true }
    });
  });

  test("S1-warning", async () => {
    const api = await requireReports();
    assertProjection(api, issuable({ safety: { level: "S1", state: "S1" } }));
    assertProjection(api, issuable());
  });

  test("insufficient", async () => {
    const api = await requireReports();
    assertProjection(api, withheld("INSUFFICIENT_EVIDENCE"));
    assertRefused(() => api.renderJsonReport(withheld("INSUFFICIENT_EVIDENCE", {
      score: { raw: 45, display: 45 }, score_digest: digest("a")
    })));
    assertProjection(api, issuable());
  });

  test("unsafe", async () => {
    const api = await requireReports();
    const safe = withheld("UNSAFE", { safety: { level: "S2", state: "S2" } });
    assertProjection(api, safe);
    assertProjection(api, withheld("UNSAFE", { safety: { level: "S3", state: "S3" } }));
    assertRefused(() => api.renderMarkdownReport({
      ...safe,
      score: { raw: 80, display: 80 },
      score_digest: digest("a")
    }));
    assertProjection(api, issuable());
  });

  test("invalid", async () => {
    const api = await requireReports();
    assertProjection(api, withheld("INVALID"));
    assertRefused(() => api.renderJsonReport(withheld("INVALID", {
      score: { raw: 10, display: 10 }, score_digest: digest("a")
    })));
    assertProjection(api, issuable());
  });

  test("profile-unmatched", async () => {
    const api = await requireReports();
    assertProjection(api, issuable({ comparison_eligible: false }));
    assertProjection(api, issuable({ comparison_eligible: true }));
  });

  test("stable-bytes", async () => {
    const api = await requireReports();
    const result = issuable();
    const reordered = {
      limitations: result.limitations,
      opportunity_profile: result.opportunity_profile,
      comparison_eligible: result.comparison_eligible,
      retest_type: result.retest_type,
      attribution_confidence: result.attribution_confidence,
      attribution: result.attribution,
      external_mutation: result.external_mutation,
      declared_manual_takeover: result.declared_manual_takeover,
      adapter_digest: result.adapter_digest,
      suite_digest: result.suite_digest,
      scorer_digest: result.scorer_digest,
      score_digest: result.score_digest,
      coverage: result.coverage,
      safety: result.safety,
      factors: result.factors,
      score: result.score,
      status: result.status,
      run_id: result.run_id,
      schema_version: result.schema_version,
      schema_id: result.schema_id
    };
    assert.equal(api.renderJsonReport(result), api.renderJsonReport(reordered), HONEST);
    assert.equal(api.renderMarkdownReport(result), api.renderMarkdownReport(reordered), HONEST);
    assertProjection(api, reordered);
  });
});
