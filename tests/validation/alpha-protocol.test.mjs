import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const protocolPath = resolve(root, "docs/validation/ALPHA-PREREGISTRATION.md");
const analysisPath = resolve(root, "docs/validation/ANALYSIS-PLAN.md");
const schemaPath = resolve(root, "specs/alpha-row.schema.json");
const immutable = "population/forms/hypotheses/exclusions/missingness/analysis/stops are not immutable.";

const alphaRowFields = [
  "participant_id",
  "consent_recorded",
  "cohort",
  "form",
  "enrollment_status",
  "exclusion_reason",
  "reference_run_id",
  "task_id",
  "session_id",
  "reviewer_a",
  "reviewer_b",
  "review_adjudication",
  "duration_minutes",
  "automated_score",
  "expert_review",
  "missing_reason",
  "deviation_id",
  "transfer_outcome"
];
const hypotheses = ["H1", "H2", "H3", "H4", "H5", "H6"];
const prohibitedClaims = ["calibration", "certification", "population-performance", "percentile"];
const feasibilityVerdicts = ["PASS_TO_CONTINUE", "INCONCLUSIVE", "PIVOT_REQUIRED"];

const readText = (path) => {
  assert.ok(existsSync(path), immutable);
  return readFileSync(path, "utf8");
};

const between = (text, start, end) => {
  const match = text.match(new RegExp(`${start}([\\s\\S]*?)${end}`));
  assert.ok(match, immutable);
  return match[1].trim();
};

const protocolText = () => readText(protocolPath);
const analysisText = () => readText(analysisPath);
const schema = () => JSON.parse(readText(schemaPath));

const manifest = (text) => {
  const entries = new Map();
  for (const line of between(text, "<!-- alpha-protocol-manifest:start -->", "<!-- alpha-protocol-manifest:end -->").split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf("=");
    assert.ok(separator > 0, immutable);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    assert.ok(key.length > 0 && value.length > 0 && !entries.has(key), immutable);
    entries.set(key, value);
  }
  return entries;
};

const manifestValue = (text, key) => {
  const value = manifest(text).get(key);
  assert.ok(value, immutable);
  return value;
};

const manifestList = (text, key) => manifestValue(text, key).split(",").map((item) => item.trim()).filter(Boolean);

const setManifestValue = (text, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  assert.ok(pattern.test(text), immutable);
  return text.replace(pattern, `${key}=${value}`);
};

const protocolFields = (text) => {
  const table = between(text, "<!-- alpha-row-fields:start -->", "<!-- alpha-row-fields:end -->");
  const fields = [...table.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
  assert.ok(fields.length > 0, immutable);
  return fields;
};

const removeProtocolField = (text, field) => {
  const lines = text.split("\n");
  const mutated = lines.filter((line) => !line.startsWith(`| \`${field}\` |`)).join("\n");
  assert.notEqual(mutated, text, immutable);
  return mutated;
};

const protocolHypotheses = (text) => manifestList(text, "hypotheses");

const analysisHypotheses = (text) => {
  const section = between(text, "<!-- alpha-analysis-hypotheses:start -->", "<!-- alpha-analysis-hypotheses:end -->");
  const ids = [...section.matchAll(/^(H\d+)=.+$/gm)].map((match) => match[1]);
  assert.ok(ids.length > 0, immutable);
  return ids;
};

const exactSet = (actual, expected) => {
  assert.equal(new Set(actual).size, actual.length, immutable);
  assert.equal(new Set(expected).size, expected.length, immutable);
  assert.deepEqual([...actual].sort(), [...expected].sort(), immutable);
};

const expectAccept = (fn) => assert.doesNotThrow(fn, immutable);
const expectReject = (fn) => assert.throws(fn, new RegExp(immutable.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), immutable);

const assertSchemaMatchesProtocol = (protocol, candidateSchema) => {
  const declared = protocolFields(protocol);
  const properties = Object.keys(candidateSchema.properties ?? {});
  exactSet(declared, alphaRowFields);
  exactSet(properties, declared);
  exactSet(candidateSchema.required ?? [], declared);
  assert.equal(candidateSchema.additionalProperties, false, immutable);
};

const assertHypothesesAlign = (protocol, analysis) => {
  const declared = protocolHypotheses(protocol);
  const planned = analysisHypotheses(analysis);
  exactSet(declared, hypotheses);
  exactSet(planned, hypotheses);
  exactSet(planned, declared);
};

const assertMissingnessFrozen = (protocol) => {
  assert.equal(manifestValue(protocol, "row_accounting"), "all_enrolled_rows", immutable);
  assert.equal(manifestValue(protocol, "missing_value"), "null", immutable);
  exactSet(manifestList(protocol, "missing_reasons"), ["withdrawn", "technical_failure", "review_unavailable"]);
  assert.equal(manifestValue(protocol, "delete_rows"), "false", immutable);
  exactSet(manifestList(protocol, "exclusion_codes"), ["NO_CONSENT", "INELIGIBLE", "PRE_ASSESSMENT_WITHDRAWAL"]);
  assert.equal(manifestValue(protocol, "posthoc_primary_subset"), "false", immutable);
};

const assertBlindReviewFrozen = (protocol) => {
  assert.equal(manifestValue(protocol, "reviewer_count"), "2", immutable);
  exactSet(manifestList(protocol, "blinded_fields"), ["participant_id", "cohort", "form", "automated_score"]);
  assert.equal(manifestValue(protocol, "adjudication"), "third_blinded_expert", immutable);
};

const parseStopRules = (protocol) => ({
  participants: Number(manifestValue(protocol, "stop_participants")),
  referenceRunsMin: Number(manifestValue(protocol, "stop_reference_runs_min")),
  referenceRunsMax: Number(manifestValue(protocol, "stop_reference_runs_max")),
  maxMedianDurationMinutes: Number(manifestValue(protocol, "stop_median_duration_minutes_max")),
  blindReviewRequired: manifestValue(protocol, "stop_blind_review_required") === "true",
  signalRule: manifestValue(protocol, "stop_signal_rule")
});

const assertStopRulesFrozen = (protocol) => {
  const rules = parseStopRules(protocol);
  assert.equal(rules.participants, 20, immutable);
  assert.equal(rules.referenceRunsMin, 48, immutable);
  assert.equal(rules.referenceRunsMax, 96, immutable);
  assert.equal(rules.maxMedianDurationMinutes, 45, immutable);
  assert.equal(rules.blindReviewRequired, true, immutable);
  assert.equal(rules.signalRule, "person_signal_exceeds_task_session_noise", immutable);
  return rules;
};

const feasibilityVerdict = (summary, rules) => {
  if (
    summary.accountedRows !== rules.participants ||
    summary.referenceRuns < rules.referenceRunsMin ||
    summary.referenceRuns > rules.referenceRunsMax ||
    summary.medianDurationMinutes > rules.maxMedianDurationMinutes ||
    (rules.blindReviewRequired && !summary.blindReviewComplete)
  ) return "PIVOT_REQUIRED";
  return summary.personSignalExceedsTaskSessionNoise ? "PASS_TO_CONTINUE" : "INCONCLUSIVE";
};

const assertProhibitedClaimsFrozen = (protocol) => exactSet(manifestList(protocol, "prohibited_claims"), prohibitedClaims);

const assertClaimAllowed = (protocol, candidate) => {
  const normalizedCandidate = candidate.toLowerCase().replace(/[-_\\s]+/g, " ");
  for (const prohibited of manifestList(protocol, "prohibited_claims")) {
    const normalizedProhibited = prohibited.toLowerCase().replace(/[-_\\s]+/g, " ");
    assert.equal(normalizedCandidate.includes(normalizedProhibited), false, immutable);
  }
};

const assertFeasibilityVerdictsFrozen = (protocol) => exactSet(manifestList(protocol, "allowed_verdicts"), feasibilityVerdicts);

const assertVerdictAllowed = (protocol, candidate) => {
  assert.ok(manifestList(protocol, "allowed_verdicts").includes(candidate), immutable);
};

test("schema", () => {
  const protocol = protocolText();
  const rowSchema = schema();
  expectAccept(() => assertSchemaMatchesProtocol(protocol, rowSchema));

  for (const field of alphaRowFields) {
    expectReject(() => assertSchemaMatchesProtocol(removeProtocolField(protocol, field), rowSchema));
    const withoutSchemaField = structuredClone(rowSchema);
    delete withoutSchemaField.properties[field];
    withoutSchemaField.required = withoutSchemaField.required.filter((item) => item !== field);
    expectReject(() => assertSchemaMatchesProtocol(protocol, withoutSchemaField));
  }

  const withUndeclaredSchemaField = structuredClone(rowSchema);
  withUndeclaredSchemaField.properties.undeclared_future_field = { type: "string" };
  withUndeclaredSchemaField.required.push("undeclared_future_field");
  expectReject(() => assertSchemaMatchesProtocol(protocol, withUndeclaredSchemaField));
});

test("sample-balance", () => {
  const protocol = protocolText();
  const expected = {
    population: "consenting_adult_software_practitioners",
    enrollment_n: "20",
    cohort_novice: "7",
    cohort_intermediate: "7",
    cohort_expert: "6",
    form_a: "10",
    form_b: "10"
  };
  const assertSampleBalance = (candidate) => {
    for (const [key, value] of Object.entries(expected)) assert.equal(manifestValue(candidate, key), value, immutable);
  };
  expectAccept(() => assertSampleBalance(protocol));
  for (const [key, value] of Object.entries(expected)) {
    const changed = key === "population" ? "different_population" : String(Number(value) + 1);
    expectReject(() => assertSampleBalance(setManifestValue(protocol, key, changed)));
  }
});

test("hypotheses", () => {
  const protocol = protocolText();
  const analysis = analysisText();
  expectAccept(() => assertHypothesesAlign(protocol, analysis));

  for (const hypothesis of hypotheses) {
    const protocolWithoutHypothesis = setManifestValue(protocol, "hypotheses", hypotheses.filter((item) => item !== hypothesis).join(","));
    expectReject(() => assertHypothesesAlign(protocolWithoutHypothesis, analysis));
    const analysisWithoutHypothesis = analysis.replace(new RegExp(`^${hypothesis}=.*\\n?`, "m"), "");
    expectReject(() => assertHypothesesAlign(protocol, analysisWithoutHypothesis));
  }

  expectReject(() => assertHypothesesAlign(setManifestValue(protocol, "hypotheses", `${hypotheses.join(",")},H7`), analysis));
  expectReject(() => assertHypothesesAlign(protocol, analysis.replace("<!-- alpha-analysis-hypotheses:end -->", "H7=unregistered_analysis\n<!-- alpha-analysis-hypotheses:end -->")));
});

test("missingness", () => {
  const protocol = protocolText();
  expectAccept(() => assertMissingnessFrozen(protocol));

  const scalarChanges = {
    row_accounting: "complete_cases_only",
    missing_value: "omitted",
    delete_rows: "true",
    posthoc_primary_subset: "true"
  };
  for (const [key, value] of Object.entries(scalarChanges)) expectReject(() => assertMissingnessFrozen(setManifestValue(protocol, key, value)));
  for (const reason of manifestList(protocol, "missing_reasons")) {
    expectReject(() => assertMissingnessFrozen(setManifestValue(protocol, "missing_reasons", manifestList(protocol, "missing_reasons").filter((item) => item !== reason).join(","))));
  }
  for (const exclusion of manifestList(protocol, "exclusion_codes")) {
    expectReject(() => assertMissingnessFrozen(setManifestValue(protocol, "exclusion_codes", manifestList(protocol, "exclusion_codes").filter((item) => item !== exclusion).join(","))));
  }
});

test("blind-review", () => {
  const protocol = protocolText();
  expectAccept(() => assertBlindReviewFrozen(protocol));
  expectReject(() => assertBlindReviewFrozen(setManifestValue(protocol, "reviewer_count", "1")));
  for (const field of manifestList(protocol, "blinded_fields")) {
    expectReject(() => assertBlindReviewFrozen(setManifestValue(protocol, "blinded_fields", manifestList(protocol, "blinded_fields").filter((item) => item !== field).join(","))));
  }
  expectReject(() => assertBlindReviewFrozen(setManifestValue(protocol, "adjudication", "lead_reviewer_decides")));
});

test("stop-rules", () => {
  const protocol = protocolText();
  const rules = assertStopRulesFrozen(protocol);
  const lowerBoundary = {
    accountedRows: 20,
    referenceRuns: 48,
    medianDurationMinutes: 45,
    blindReviewComplete: true,
    personSignalExceedsTaskSessionNoise: true
  };
  const upperBoundary = { ...lowerBoundary, referenceRuns: 96 };
  expectAccept(() => assert.equal(feasibilityVerdict(lowerBoundary, rules), "PASS_TO_CONTINUE", immutable));
  expectAccept(() => assert.equal(feasibilityVerdict(upperBoundary, rules), "PASS_TO_CONTINUE", immutable));
  expectAccept(() => assert.equal(feasibilityVerdict({ ...lowerBoundary, referenceRuns: 47 }, rules), "PIVOT_REQUIRED", immutable));
  expectAccept(() => assert.equal(feasibilityVerdict({ ...lowerBoundary, referenceRuns: 97 }, rules), "PIVOT_REQUIRED", immutable));
  expectAccept(() => assert.equal(feasibilityVerdict({ ...lowerBoundary, accountedRows: 19 }, rules), "PIVOT_REQUIRED", immutable));
  expectAccept(() => assert.equal(feasibilityVerdict({ ...lowerBoundary, medianDurationMinutes: 46 }, rules), "PIVOT_REQUIRED", immutable));
  expectAccept(() => assert.equal(feasibilityVerdict({ ...lowerBoundary, blindReviewComplete: false }, rules), "PIVOT_REQUIRED", immutable));
  expectAccept(() => assert.equal(feasibilityVerdict({ ...lowerBoundary, personSignalExceedsTaskSessionNoise: false }, rules), "INCONCLUSIVE", immutable));

  const lowerShift = parseStopRules(setManifestValue(protocol, "stop_reference_runs_min", "49"));
  const upperShift = parseStopRules(setManifestValue(protocol, "stop_reference_runs_max", "95"));
  const durationShift = parseStopRules(setManifestValue(protocol, "stop_median_duration_minutes_max", "44"));
  expectReject(() => assert.equal(feasibilityVerdict(lowerBoundary, lowerShift), "PASS_TO_CONTINUE", immutable));
  expectReject(() => assert.equal(feasibilityVerdict(upperBoundary, upperShift), "PASS_TO_CONTINUE", immutable));
  expectReject(() => assert.equal(feasibilityVerdict(lowerBoundary, durationShift), "PASS_TO_CONTINUE", immutable));
  for (const [key, value] of Object.entries({
    stop_participants: "21",
    stop_reference_runs_min: "49",
    stop_reference_runs_max: "95",
    stop_median_duration_minutes_max: "44",
    stop_blind_review_required: "false",
    stop_signal_rule: "different_signal_rule"
  })) expectReject(() => assertStopRulesFrozen(setManifestValue(protocol, key, value)));
});

test("no-percentile", () => {
  const protocol = protocolText();
  expectAccept(() => assertProhibitedClaimsFrozen(protocol));
  expectAccept(() => assertClaimAllowed(protocol, "A feasibility observation from the preregistered rows."));
  expectReject(() => assertClaimAllowed(protocol, "A percentile rank would be reported."));
  for (const claim of prohibitedClaims) {
    expectReject(() => assertClaimAllowed(protocol, `A ${claim.replace("-", " ")} claim would be reported.`));
    expectReject(() => assertProhibitedClaimsFrozen(setManifestValue(protocol, "prohibited_claims", prohibitedClaims.filter((item) => item !== claim).join(","))));
  }
});

test("feasibility-only-verdicts", () => {
  const protocol = protocolText();
  expectAccept(() => assertFeasibilityVerdictsFrozen(protocol));
  for (const verdict of feasibilityVerdicts) expectAccept(() => assertVerdictAllowed(protocol, verdict));
  expectReject(() => assertVerdictAllowed(protocol, "CERTIFIED"));
  for (const verdict of feasibilityVerdicts) {
    expectReject(() => assertVerdictAllowed(setManifestValue(protocol, "allowed_verdicts", feasibilityVerdicts.filter((item) => item !== verdict).join(",")), verdict));
  }
  expectReject(() => assertFeasibilityVerdictsFrozen(setManifestValue(protocol, "allowed_verdicts", `${feasibilityVerdicts.join(",")},CERTIFIED`)));
});
