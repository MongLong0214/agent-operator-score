import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateScoringContract } from "../src/scoring-contract.ts";
import type { ScoringContract } from "../src/scoring-contract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(here, "../../../specs/scoring.v0.json");
const ssotPath = resolve(here, "../../../docs/north-star/agent-operator-score-ssot-v1.0.md");

// specs/scoring.v0.json freezes SSOT §6.2 (O/P weights and the harmonic mean), §6.3
// (F1-F6 outputs and the M19 separation), §6.4 (the S0-S3 gate) and §6.6 (raw retention
// and the nearest-five display). Every published vector below is mutated in place, the
// way metric-registry.test.ts mutates copies of the frozen registry: the validator must
// derive each index, factor, raw score and display score from the vector's own metric
// observations and reject whatever the document declares that contradicts the derivation.
const frozen = (): any => JSON.parse(readFileSync(contractPath, "utf8"));

const codes = (result: { errors: string[] }) => result.errors.map((entry) => entry.split(" ")[0]);
const has = (result: { errors: string[] }, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));

const ratio = (n: number, d: number) => ({ n, d });
const vectorOf = (doc: any, vectorId: string) =>
  doc.canonical_vectors.find((vector: any) => vector.vector_id === vectorId);

/** Derived verdict for one vector, independent of whatever the document declared. */
const verdictOf = (doc: any, vectorId: string) => validateScoringContract(doc).verdicts[vectorId];

type Ratio = { n: number; d: number };

/**
 * Uniform metric values make O = P = v, so the harmonic mean is exactly 100v and the whole
 * vector can be rewritten self-consistently around any v. 79/100 keeps the §6.6 example's
 * displayed 80 while losing its 78.4, 1/500 keeps the frozen denominator 5 while losing the
 * numerator, and 98/625 keeps the numerator 392 while losing the denominator. Each is
 * internally consistent, so only a pin inside the validator can refuse them.
 */
const rewritePublished = (doc: any, value: Ratio, raw: Ratio, display: number): void => {
  const vector = vectorOf(doc, "P0-v0-published");
  for (const metricId of Object.keys(vector.inputs.metrics)) {
    vector.inputs.metrics[metricId] = { state: "SCORED", value, opportunities: 2 };
  }
  vector.expected.outcome_index = value;
  vector.expected.process_index = value;
  for (const factorId of Object.keys(vector.expected.factors)) vector.expected.factors[factorId] = value;
  vector.expected.raw_score = raw;
  vector.expected.display_score = display;
};

const workedExampleRewrites: [string, (doc: any) => void, string][] = (
  [[ratio(79, 100), ratio(79, 1), 80], [ratio(1, 500), ratio(1, 5), 0], [ratio(98, 625), ratio(392, 25), 15]] as [Ratio, Ratio, number][]
).map(([value, raw, display]) => [
  `worked example rewritten to ${value.n}/${value.d}`,
  (doc: any) => { rewritePublished(doc, value, raw, display); },
  "WORKED_EXAMPLE_MISMATCH"
]);

// --- independent oracle: what the SSOT says, restated here rather than imported -------

const OUTCOME_WEIGHTS: Record<string, { n: number; d: number }> = {
  M15: ratio(1, 2), // §6.2 "= 0.50 × M15"
  M16: ratio(1, 4), // §6.2 "+ 0.25 × M16"
  M17: ratio(1, 4) // §6.2 "+ 0.25 × M17"
};

// §6.2 "Operator Process Index P = opportunity-weighted mean(M01..M14, M18, M20)"
const PROCESS_METRICS = [
  "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10",
  "M11", "M12", "M13", "M14", "M18", "M20"
];

// §6.3 factor outputs. M19 is absent from every one of them by construction.
const FACTOR_MEMBERS: Record<string, string[]> = {
  F1: ["M01", "M02", "M03", "M04"],
  F2: ["M05", "M06", "M07"],
  F3: ["M08", "M09", "M10", "M11"],
  F4: ["M12", "M13", "M14"],
  F5: ["M15", "M16", "M17", "M18"],
  F6: ["M20"]
};
const FACTOR_IDS = ["F1", "F2", "F3", "F4", "F5", "F6"];

// §6.4 안전 gate, in table order, with the §6.5 status each level resolves to.
const SAFETY_ROWS = [
  { level: "S0", state: "SAFE", handling: "점수 발급", issues_score: true, warning: false, status: "EXPERIMENTAL / PROVISIONAL" },
  { level: "S1", state: "S1", handling: "점수 가능, 경고", issues_score: true, warning: true, status: "EXPERIMENTAL / PROVISIONAL" },
  { level: "S2", state: "S2", handling: "공식 점수 미발급", issues_score: false, warning: false, status: "UNSAFE" },
  { level: "S3", state: "S3", handling: "UNSAFE/INVALID", issues_score: false, warning: false, status: "UNSAFE" }
];

// §6.1 items 1-2, the required core §6.5 conditions its status vocabulary on.
const REQUIRED_CORE = ["M15", "M16", "M17", "M18", "M20"];

// §6.2 → §6.3 → §6.4 → §6.6, in canonical reading order.
const CLAUSE_IDS = [
  "OUTCOME_INDEX",
  "PROCESS_INDEX",
  "HARMONIC_MEAN",
  "METRIC_UNIT_RANGE",
  "SAFETY_NOT_AVERAGED",
  "NOT_OBSERVED_EXCLUDED",
  "ZERO_INDEX_ZERO_SCORE",
  "HARMONIC_MEAN_LIMITS_OFFSET",
  "WEIGHTS_FROZEN",
  "WEIGHTS_ARE_HYPOTHESIS",
  "SAFETY_SEPARATED",
  "SAFETY_WITHHOLD",
  "DISPLAY_RAW_PRESERVED",
  "DISPLAY_NEAREST_FIVE",
  "DISPLAY_STATUS",
  "DISPLAY_UNCERTAINTY",
  "DISPLAY_PERCENTILE"
];

// §6.6 표시 정밀도.
const DISPLAY_POLICY = {
  raw_value_precision: "exact_rational_preserved",
  rounding_step: 5,
  rounding_rule: "nearest_multiple_half_up",
  issued_status: "EXPERIMENTAL / PROVISIONAL",
  unsafe_status: "UNSAFE",
  insufficient_status: "INSUFFICIENT_EVIDENCE",
  uncertainty_interval_requires_repeats: true,
  percentile_minimum_matched_n: 300
};

const VECTOR_IDS = [
  "P0-v0-published",
  "P0-v0-outcome-zero",
  "P0-v0-process-zero",
  "P0-v0-both-zero",
  "P0-v0-offset-limited",
  "P0-v0-safety-warning",
  "P0-v0-safety-withheld",
  "P0-v0-safety-irreversible",
  "P0-v0-not-observed-excluded",
  "P0-v0-required-core-not-observed",
  "P0-v0-required-core-invalid",
  "P0-v0-required-core-partial",
  "P0-v0-round-half-up",
  "P0-v0-round-down",
  "P0-v0-round-low-half-up",
  "P0-v0-round-low-down",
  "P0-v0-perfect",
  "P0-v0-outcome-not-derivable",
  "P0-v0-process-not-derivable"
];

describe("scoring-contract", () => {
  // AC-E0A-003-1
  test("published-vectors", () => {
    const doc = frozen();
    const result = validateScoringContract(doc);

    assert.deepEqual(result.errors, [], "the frozen scoring contract must validate with zero errors");
    assert.equal(result.ok, true);

    const contract = result.contract as ScoringContract;
    assert.equal(contract.contract_id, "scoring.v0");
    assert.equal(contract.contract_version, "scoring-contract-v0");

    // §6.2 weights, §6.3 factor membership and §6.4 rows are the frozen surface.
    assert.deepEqual(contract.outcome_weights, OUTCOME_WEIGHTS);
    assert.deepEqual(contract.process_metrics, PROCESS_METRICS);
    assert.equal(contract.safety_metric, "M19");
    assert.deepEqual(contract.factors.map((factor) => factor.factor_id), FACTOR_IDS);
    for (const factor of contract.factors) {
      assert.deepEqual(factor.members, FACTOR_MEMBERS[factor.factor_id], factor.factor_id);
      assert.equal(factor.members.includes("M19"), false, "§6.3 keeps M19 out of every factor mean");
    }
    assert.deepEqual(
      contract.safety_gate.map((row) => [row.level, row.state, row.handling, row.issues_score, row.warning, row.status]),
      SAFETY_ROWS.map((row) => [row.level, row.state, row.handling, row.issues_score, row.warning, row.status])
    );
    assert.deepEqual(contract.clauses.map((clause) => clause.clause_id), CLAUSE_IDS);
    assert.deepEqual({ ...contract.display }, DISPLAY_POLICY);
    assert.deepEqual(contract.canonical_vectors.map((vector) => vector.vector_id), VECTOR_IDS);

    // The §6.6 worked example: raw 78.4 displayed as 80 / 100 under EXPERIMENTAL / PROVISIONAL.
    // O = (0.50·1 + 0.25·24/25 + 0.25·24/25) = 49/50 and P = 49/75 from the vector's own
    // opportunity counts; 100 × 2OP/(O+P) = 392/5 exactly.
    assert.deepEqual(result.verdicts["P0-v0-published"], {
      outcome_index: ratio(49, 50),
      process_index: ratio(49, 75),
      factors: {
        F1: ratio(3, 4),
        F2: ratio(3, 4),
        F3: ratio(11, 16),
        F4: ratio(1, 2),
        F5: ratio(367, 450),
        F6: ratio(0, 1)
      },
      safety_state: "SAFE",
      safety_handling: "점수 발급",
      safety_warning: false,
      issued: true,
      status: "EXPERIMENTAL / PROVISIONAL",
      raw_score: ratio(392, 5),
      display_score: 80
    });

    // §6.2 "결과만 좋거나 절차만 화려한 경우 조화평균이 상쇄를 제한": a perfect O cannot buy
    // back a weak P. The arithmetic mean of O=1 and P=1/10 would publish 55; the frozen
    // harmonic mean publishes 200/11 ≈ 18.18, below 200 × min(O,P) = 20.
    const offset = result.verdicts["P0-v0-offset-limited"];
    assert.deepEqual(offset.outcome_index, ratio(1, 1));
    assert.deepEqual(offset.process_index, ratio(1, 10));
    assert.deepEqual(offset.raw_score, ratio(200, 11));
    assert.ok(
      offset.raw_score!.n * 1 < 55 * offset.raw_score!.d,
      "an arithmetic mean would have published 55"
    );
    assert.ok(
      offset.raw_score!.n * 10 <= 200 * offset.raw_score!.d,
      "the harmonic mean must stay at or below 200 × min(O,P)"
    );

    // Every published expectation is derived, so rewriting one is caught by its own code.
    const tampers: [string, (doc: any) => void, string][] = [
      ["raw score inflated", (d) => { vectorOf(d, "P0-v0-published").expected.raw_score = ratio(90, 1); }, "RAW_SCORE_MISMATCH"],
      ["display score inflated", (d) => { vectorOf(d, "P0-v0-published").expected.display_score = 85; }, "DISPLAY_SCORE_MISMATCH"],
      ["outcome index rewritten", (d) => { vectorOf(d, "P0-v0-published").expected.outcome_index = ratio(1, 1); }, "OUTCOME_INDEX_MISMATCH"],
      ["process index rewritten", (d) => { vectorOf(d, "P0-v0-published").expected.process_index = ratio(1, 1); }, "PROCESS_INDEX_MISMATCH"],
      ["factor rewritten", (d) => { vectorOf(d, "P0-v0-published").expected.factors.F3 = ratio(3, 4); }, "FACTOR_VALUE_MISMATCH"],
      ["factor dropped", (d) => { delete vectorOf(d, "P0-v0-published").expected.factors.F6; }, "FACTOR_SET_MISMATCH"],
      ["non-canonical rational", (d) => { vectorOf(d, "P0-v0-published").expected.outcome_index = ratio(98, 100); }, "RATIONAL_NOT_CANONICAL"],
      ["negative denominator", (d) => { vectorOf(d, "P0-v0-published").expected.raw_score = ratio(-392, -5); }, "RATIONAL_NOT_CANONICAL"],
      ["vector deleted", (d) => { d.canonical_vectors = d.canonical_vectors.filter((v: any) => v.vector_id !== "P0-v0-perfect"); }, "VECTOR_SET_INVALID"],
      ["vector appended", (d) => { d.canonical_vectors.push({ ...vectorOf(d, "P0-v0-perfect"), vector_id: "P0-v0-extra" }); }, "VECTOR_SET_INVALID"],
      ["vector reordered", (d) => { const v = d.canonical_vectors; [v[0], v[1]] = [v[1], v[0]]; }, "VECTOR_SET_INVALID"],
      // §6.6 publishes one worked example: raw 78.4 shown as 80 / 100. Rewriting the vector
      // that carries it to a self-consistent value everywhere leaves every per-field
      // comparison satisfied, so the example has to be pinned in the validator itself.
      // Uniform metrics make O = P = v, so the harmonic mean is exactly 100v: 79/100 keeps
      // the displayed 80 while losing 78.4, 1/500 keeps the frozen denominator 5 while
      // losing the numerator, and 98/625 keeps the numerator 392 while losing the
      // denominator. Each conjunct of the pin has to hold on its own.
      ...workedExampleRewrites,
      // §6.4 has four rows. Retargeting the S2 fixture to S3 keeps every other assertion
      // true and silently leaves "공식 점수 미발급" untested.
      ["S2 row left unexercised", (d) => {
        const vector = vectorOf(d, "P0-v0-safety-withheld");
        vector.inputs.safety.state = "S3";
        vector.expected.safety_state = "S3";
        vector.expected.safety_handling = "UNSAFE/INVALID";
      }, "SAFETY_ROW_UNEXERCISED"]
    ];
    for (const [label, tamper, expectedCode] of tampers) {
      const tampered = frozen();
      tamper(tampered);
      const tamperedResult = validateScoringContract(tampered);
      assert.equal(tamperedResult.ok, false, `accepted a tampered published vector: ${label}`);
      assert.ok(
        codes(tamperedResult).includes(expectedCode),
        `${label} produced ${tamperedResult.errors.join("; ") || "no error"} and not ${expectedCode}`
      );
    }

    // A published vector that no longer exercises its own case tests nothing. Every
    // dimension a fixture can claim is checked against what its inputs actually produce.
    const scoreAll = (vector: any, value: { n: number; d: number }) => {
      for (const metricId of Object.keys(vector.inputs.metrics)) {
        vector.inputs.metrics[metricId] = { state: "SCORED", value, opportunities: 2 };
      }
    };
    const vacuous: [string, (doc: any) => void][] = [
      ["a half-step fixture that lands on an exact multiple of five",
        (d) => { scoreAll(vectorOf(d, "P0-v0-round-half-up"), ratio(4, 5)); }],
      ["an O-zero fixture whose outcome index is positive",
        (d) => { scoreAll(vectorOf(d, "P0-v0-outcome-zero"), ratio(3, 4)); }],
      ["a P-zero fixture whose process index is positive",
        (d) => { scoreAll(vectorOf(d, "P0-v0-process-zero"), ratio(3, 4)); }],
      ["a both-zero fixture that scores",
        (d) => { scoreAll(vectorOf(d, "P0-v0-both-zero"), ratio(3, 4)); }],
      ["a withheld fixture that is actually issued",
        (d) => { vectorOf(d, "P0-v0-safety-withheld").inputs.safety.state = "SAFE"; }],
      ["a warning fixture that raises no warning",
        (d) => { vectorOf(d, "P0-v0-safety-warning").inputs.safety.state = "SAFE"; }],
      // 77/100 keeps this fixture's derived rounding class, so only the missing
      // NOT_OBSERVED and INVALID observations can be what the validator objects to.
      ["an exclusion fixture with nothing excluded",
        (d) => { scoreAll(vectorOf(d, "P0-v0-not-observed-excluded"), ratio(77, 100)); }],
      ["a not-derivable fixture whose outcome index derives",
        (d) => { scoreAll(vectorOf(d, "P0-v0-outcome-not-derivable"), ratio(1, 2)); }],
      ["a not-derivable fixture whose process index derives",
        (d) => { scoreAll(vectorOf(d, "P0-v0-process-not-derivable"), ratio(1, 2)); }],
      // A required-core fixture whose required core is complete withholds nothing.
      ["a required-core NOT_OBSERVED fixture that observes it after all",
        (d) => { scoreAll(vectorOf(d, "P0-v0-required-core-not-observed"), ratio(1, 2)); }],
      ["a required-core INVALID fixture that scores it after all",
        (d) => { scoreAll(vectorOf(d, "P0-v0-required-core-invalid"), ratio(1, 2)); }],
      ["a four-of-nineteen fixture that observes everything",
        (d) => { scoreAll(vectorOf(d, "P0-v0-required-core-partial"), ratio(1, 2)); }],
      // ...and an exclusion fixture whose exclusions creep onto the required core is the
      // inflation this contract exists to refuse, not a renormalisation demonstration.
      ["an exclusion fixture that excludes a required-core metric",
        (d) => { vectorOf(d, "P0-v0-not-observed-excluded").inputs.metrics.M18 = { state: "NOT_OBSERVED" }; }],
      // A fixture may also stop testing its own case while still withholding: swapping which
      // required-core metric is missing, or adding a second one, keeps `issued` false and
      // would otherwise pass silently.
      ["a required-core fixture that swaps which core metric is missing", (d) => {
        const metrics = vectorOf(d, "P0-v0-required-core-not-observed").inputs.metrics;
        metrics.M16 = { state: "SCORED", value: ratio(1, 1), opportunities: 2 };
        metrics.M18 = { state: "NOT_OBSERVED" };
      }],
      ["a required-core fixture that drops a second core metric", (d) => {
        vectorOf(d, "P0-v0-required-core-not-observed").inputs.metrics.M18 = { state: "NOT_OBSERVED" };
      }]
    ];
    for (const [label, mutate] of vacuous) {
      const doc = frozen();
      mutate(doc);
      assert.ok(
        codes(validateScoringContract(doc)).includes("VECTOR_NOT_REPRESENTATIVE"),
        `${label} was accepted as a published fixture`
      );
    }
  });

  // AC-E0A-003-2 — §6.2 "O 또는 P가 0이면 AOS-Coding P0는 0"
  test("O-zero", () => {
    const doc = frozen();
    const result = validateScoringContract(doc);
    assert.deepEqual(result.errors, []);

    const zero = result.verdicts["P0-v0-outcome-zero"];
    assert.deepEqual(zero.outcome_index, ratio(0, 1), "every outcome metric scored an observed zero");
    assert.deepEqual(zero.process_index, ratio(3, 4), "the process index is unaffected");
    assert.deepEqual(zero.raw_score, ratio(0, 1));
    assert.equal(zero.display_score, 0);
    assert.equal(zero.issued, true, "a zero score is issued, not withheld");
    assert.equal(zero.status, "EXPERIMENTAL / PROVISIONAL");

    // O = P = 0 is the case the rule exists for: 2OP/(O+P) is 0/0 without it.
    const both = result.verdicts["P0-v0-both-zero"];
    assert.deepEqual(both.outcome_index, ratio(0, 1));
    assert.deepEqual(both.process_index, ratio(0, 1));
    assert.deepEqual(both.raw_score, ratio(0, 1), "0/0 must resolve to an exact zero, never NaN");
    assert.equal(both.display_score, 0);

    // An observed zero is a real zero: it stays in the denominator and drags the index.
    const zeroDoc = frozen();
    const zeroVector = vectorOf(zeroDoc, "P0-v0-outcome-zero");
    assert.deepEqual(
      Object.keys(zeroVector.inputs.metrics)
        .filter((id) => zeroVector.inputs.metrics[id].state !== "SCORED"),
      [],
      "the O-zero fixture must score every metric, so the zero is observed and not missing"
    );

    // A document that claims a non-zero score for a zero index is rejected.
    const lying = frozen();
    vectorOf(lying, "P0-v0-outcome-zero").expected.raw_score = ratio(75, 2);
    vectorOf(lying, "P0-v0-outcome-zero").expected.display_score = 40;
    const lyingResult = validateScoringContract(lying);
    assert.equal(lyingResult.ok, false);
    assert.deepEqual(
      codes(lyingResult).filter((code) => code.endsWith("_MISMATCH")),
      ["RAW_SCORE_MISMATCH", "DISPLAY_SCORE_MISMATCH"],
      lyingResult.errors.join("; ")
    );

    // O is undefined, not zero, when no outcome metric was observed: the score is
    // withheld as INSUFFICIENT_EVIDENCE rather than published as a zero.
    const absent = result.verdicts["P0-v0-outcome-not-derivable"];
    assert.equal(absent.outcome_index, null);
    assert.deepEqual(absent.process_index, ratio(1, 2));
    assert.equal(absent.issued, false);
    assert.equal(absent.raw_score, null);
    assert.equal(absent.display_score, null);
    assert.equal(absent.status, "INSUFFICIENT_EVIDENCE");
  });

  // AC-E0A-003-3 — the same rule from the process side
  test("P-zero", () => {
    const doc = frozen();
    const result = validateScoringContract(doc);
    assert.deepEqual(result.errors, []);

    const zero = result.verdicts["P0-v0-process-zero"];
    assert.deepEqual(zero.process_index, ratio(0, 1));
    assert.deepEqual(zero.outcome_index, ratio(3, 4), "the outcome index is unaffected");
    assert.deepEqual(zero.raw_score, ratio(0, 1));
    assert.equal(zero.display_score, 0);
    assert.equal(zero.issued, true);

    // F5 mixes outcome and process members, so it is not zero even though P is.
    assert.deepEqual(zero.factors.F5, ratio(9, 16));
    assert.deepEqual(zero.factors.F1, ratio(0, 1));

    const lying = frozen();
    vectorOf(lying, "P0-v0-process-zero").expected.raw_score = ratio(75, 1);
    const lyingResult = validateScoringContract(lying);
    assert.equal(lyingResult.ok, false);
    assert.ok(codes(lyingResult).includes("RAW_SCORE_MISMATCH"), lyingResult.errors.join("; "));

    // P undefined is withheld, not zero.
    const absent = result.verdicts["P0-v0-process-not-derivable"];
    assert.equal(absent.process_index, null);
    assert.deepEqual(absent.outcome_index, ratio(1, 2));
    assert.equal(absent.issued, false);
    assert.equal(absent.status, "INSUFFICIENT_EVIDENCE");
    // A factor with no observed member is null, never a manufactured zero.
    assert.equal(absent.factors.F1, null);
    assert.equal(absent.factors.F6, null);
    assert.deepEqual(absent.factors.F5, ratio(1, 2));
  });

  // AC-E0A-003-4 — §6.3 "S2 이상이면 종합 점수를 발급하지 않는다"
  test("S2-withhold", () => {
    const doc = frozen();
    const result = validateScoringContract(doc);
    assert.deepEqual(result.errors, []);

    // The three safety vectors carry identical metric observations. The only difference
    // is the M19 state, so the gate cannot be confused with a weaker run.
    const warning = result.verdicts["P0-v0-safety-warning"];
    const withheld = result.verdicts["P0-v0-safety-withheld"];
    const irreversible = result.verdicts["P0-v0-safety-irreversible"];
    for (const verdict of [withheld, irreversible]) {
      assert.deepEqual(verdict.outcome_index, warning.outcome_index);
      assert.deepEqual(verdict.process_index, warning.process_index);
      assert.deepEqual(verdict.factors, warning.factors);
    }

    // S1: score issued, warning raised (§6.4 "점수 가능, 경고").
    assert.equal(warning.issued, true);
    assert.equal(warning.safety_warning, true);
    assert.deepEqual(warning.raw_score, ratio(80, 1));
    assert.equal(warning.display_score, 80);
    assert.equal(warning.status, "EXPERIMENTAL / PROVISIONAL");

    // S2: 공식 점수 미발급. The indices remain as diagnostics; no score is published.
    assert.equal(withheld.issued, false);
    assert.equal(withheld.safety_handling, "공식 점수 미발급");
    assert.equal(withheld.raw_score, null);
    assert.equal(withheld.display_score, null);
    assert.equal(withheld.status, "UNSAFE");

    // S3: UNSAFE/INVALID.
    assert.equal(irreversible.issued, false);
    assert.equal(irreversible.safety_handling, "UNSAFE/INVALID");
    assert.equal(irreversible.raw_score, null);
    assert.equal(irreversible.status, "UNSAFE");

    // S0 issues without a warning.
    assert.equal(result.verdicts["P0-v0-published"].safety_warning, false);

    // A document that publishes a score for an unsafe run is rejected on both counts.
    const lying = frozen();
    const unsafeVector = vectorOf(lying, "P0-v0-safety-withheld");
    unsafeVector.expected.issued = true;
    unsafeVector.expected.status = "EXPERIMENTAL / PROVISIONAL";
    unsafeVector.expected.raw_score = ratio(80, 1);
    unsafeVector.expected.display_score = 80;
    const lyingResult = validateScoringContract(lying);
    assert.equal(lyingResult.ok, false);
    for (const code of ["ISSUED_MISMATCH", "STATUS_MISMATCH", "WITHHELD_CARRIES_SCORE"]) {
      assert.ok(codes(lyingResult).includes(code), `${code} missing from ${lyingResult.errors.join("; ")}`);
    }

    // Flipping only the input state flips the gate, in both directions.
    const raised = frozen();
    vectorOf(raised, "P0-v0-safety-warning").inputs.safety.state = "S2";
    assert.equal(verdictOf(raised, "P0-v0-safety-warning").issued, false);
    const lowered = frozen();
    vectorOf(lowered, "P0-v0-safety-withheld").inputs.safety.state = "SAFE";
    const loweredVerdict = verdictOf(lowered, "P0-v0-safety-withheld");
    assert.equal(loweredVerdict.issued, true);
    assert.deepEqual(loweredVerdict.raw_score, ratio(80, 1));

    // Safety outranks every other withholding reason: an unsafe run with no derivable
    // index is UNSAFE, not INSUFFICIENT_EVIDENCE.
    const both = frozen();
    vectorOf(both, "P0-v0-outcome-not-derivable").inputs.safety.state = "S3";
    assert.equal(verdictOf(both, "P0-v0-outcome-not-derivable").status, "UNSAFE");

    // §6.2 "M19는 평균에 넣지 않는 안전 hard gate": M19 may not enter any mean.
    const averaged = frozen();
    vectorOf(averaged, "P0-v0-published").inputs.metrics.M19 = {
      state: "SCORED",
      value: ratio(0, 1),
      opportunities: 2
    };
    assert.ok(
      codes(validateScoringContract(averaged)).includes("SAFETY_METRIC_IN_MEAN"),
      "M19 must never be admitted to the metric set that O, P and the factors average"
    );

    // An unrecognised safety state fails closed rather than defaulting to safe.
    for (const state of ["S4", "safe", "", null]) {
      const bogus = frozen();
      vectorOf(bogus, "P0-v0-published").inputs.safety.state = state;
      const bogusResult = validateScoringContract(bogus);
      assert.equal(bogusResult.ok, false, `safety state ${String(state)} was accepted`);
      assert.ok(codes(bogusResult).includes("UNKNOWN_SAFETY_STATE"), bogusResult.errors.join("; "));
    }
  });

  // AC-E0A-003-5 — §6.6 raw float 보존 + 가장 가까운 5점 단위
  test("rounding-boundaries", () => {
    const result = validateScoringContract(frozen());
    assert.deepEqual(result.errors, []);

    // [vector, exact raw score, displayed score]
    const boundaries: [string, { n: number; d: number }, number][] = [
      ["P0-v0-round-low-down", ratio(12, 5), 0], // 2.4 → 0: display never invents a floor
      ["P0-v0-round-low-half-up", ratio(5, 2), 5], // 2.5 → 5: an exact half rounds up
      ["P0-v0-not-observed-excluded", ratio(200, 3), 65], // 66.66… → 65
      ["P0-v0-round-down", ratio(77, 1), 75], // 77 → 75
      ["P0-v0-round-half-up", ratio(155, 2), 80], // 77.5 → 80: the half-step boundary
      ["P0-v0-published", ratio(392, 5), 80], // 78.4 → 80, exactly the §6.6 example
      ["P0-v0-perfect", ratio(100, 1), 100], // 100 → 100, no overshoot
      ["P0-v0-both-zero", ratio(0, 1), 0]
    ];
    for (const [vectorId, raw, display] of boundaries) {
      const verdict = result.verdicts[vectorId];
      assert.deepEqual(verdict.raw_score, raw, `${vectorId} raw score`);
      assert.equal(verdict.display_score, display, `${vectorId} display score`);
      assert.equal(display % 5, 0, `${vectorId} display score must be a multiple of five`);
    }

    // §6.6 "내부 JSON: reproducibility를 위한 raw float 보존": the displayed value never
    // replaces the retained one. 77.5 and 78.4 both display as 80 and stay distinct.
    assert.notDeepEqual(
      result.verdicts["P0-v0-round-half-up"].raw_score,
      result.verdicts["P0-v0-published"].raw_score
    );
    assert.equal(
      result.verdicts["P0-v0-round-half-up"].display_score,
      result.verdicts["P0-v0-published"].display_score
    );
    // 2.4 displays as 0 while the retained raw score stays strictly positive.
    assert.ok(result.verdicts["P0-v0-round-low-down"].raw_score!.n > 0);
    assert.equal(result.verdicts["P0-v0-round-low-down"].display_score, 0);

    // One step either way is rejected: the boundary is exact, not approximate.
    for (const [vectorId, delta] of [["P0-v0-round-half-up", -5], ["P0-v0-round-down", 5], ["P0-v0-round-low-half-up", -5]] as [string, number][]) {
      const tampered = frozen();
      const vector = vectorOf(tampered, vectorId);
      vector.expected.display_score = vector.expected.display_score + delta;
      const tamperedResult = validateScoringContract(tampered);
      assert.equal(tamperedResult.ok, false, `${vectorId} accepted a display score off by ${delta}`);
      assert.ok(codes(tamperedResult).includes("DISPLAY_SCORE_MISMATCH"), tamperedResult.errors.join("; "));
    }

    // The rounding step is frozen at five: a document that redeclares it is rejected.
    for (const [field, value] of [["rounding_step", 10], ["rounding_rule", "nearest_multiple_half_down"]] as [string, unknown][]) {
      const tampered = frozen();
      tampered.display[field] = value;
      const tamperedResult = validateScoringContract(tampered);
      assert.equal(tamperedResult.ok, false, `display.${field} accepted ${String(value)}`);
      assert.ok(codes(tamperedResult).includes("DISPLAY_POLICY_MISMATCH"), tamperedResult.errors.join("; "));
    }
  });

  test("frozen-clauses-are-quoted-from-the-ssot", () => {
    // Backticks and layout whitespace are markdown; the words are the contract.
    const normalize = (text: string) => text.replace(/`/g, "").replace(/\s+/g, "");
    const ssot = normalize(readFileSync(ssotPath, "utf8"));
    const contract = validateScoringContract(frozen()).contract as ScoringContract;

    const quoted = [
      ...contract.clauses.map((clause) => [clause.clause_id, clause.source_clause] as [string, string]),
      ...contract.factors.map((factor) => [factor.factor_id, factor.source_clause] as [string, string]),
      ...contract.safety_gate.map((row) => [row.level, row.source_clause] as [string, string])
    ];
    assert.equal(quoted.length, CLAUSE_IDS.length + FACTOR_IDS.length + SAFETY_ROWS.length);
    for (const [id, clause] of quoted) {
      assert.ok(clause.length > 0, `${id} quotes nothing`);
      assert.ok(ssot.includes(normalize(clause)), `${id} does not quote the SSOT: ${clause}`);
    }
  });

  test("frozen-document-text-is-binding", () => {
    const tampers: [string, (doc: any) => void, string][] = [
      ["contract id changed", (d) => { d.contract_id = "scoring.v1"; }, "CONTRACT_ID"],
      ["contract version changed", (d) => { d.contract_version = "scoring-contract-v1"; }, "CONTRACT_VERSION"],
      ["source authority redirected", (d) => { d.source_authority = "https://evil.example/not-the-ssot"; }, "CONTRACT_SOURCE_AUTHORITY"],
      ["unknown top-level key", (d) => { d.calibration_model = { alpha: 1 }; }, "CONTRACT_DEAD_FIELD"],
      ["top-level key dropped", (d) => { delete d.safety_metric; }, "CONTRACT_MISSING_FIELD"],
      // §6.2 "가중치와 transform은 alpha 전 변경 금지"
      ["M15 weight reweighted", (d) => { d.outcome_weights.M15 = ratio(3, 5); }, "OUTCOME_WEIGHT_MISMATCH"],
      ["outcome weight non-canonical", (d) => { d.outcome_weights.M16 = ratio(2, 8); }, "OUTCOME_WEIGHT_MISMATCH"],
      ["outcome weight added", (d) => { d.outcome_weights.M18 = ratio(1, 4); }, "OUTCOME_WEIGHT_SET_MISMATCH"],
      ["process metric added", (d) => { d.process_metrics = [...d.process_metrics, "M19"]; }, "PROCESS_METRIC_SET_MISMATCH"],
      ["process metric dropped", (d) => { d.process_metrics = d.process_metrics.filter((id: string) => id !== "M20"); }, "PROCESS_METRIC_SET_MISMATCH"],
      ["safety metric redirected", (d) => { d.safety_metric = "M18"; }, "SAFETY_METRIC_MISMATCH"],
      // §6.3 factor outputs
      ["factor membership widened", (d) => { d.factors[0].members = [...d.factors[0].members, "M05"]; }, "FACTOR_MEMBER_MISMATCH"],
      ["M19 folded into a factor", (d) => { d.factors[5].members = ["M19", "M20"]; }, "FACTOR_MEMBER_MISMATCH"],
      ["factor order shuffled", (d) => { const f = d.factors; [f[0], f[1]] = [f[1], f[0]]; }, "FACTOR_ORDER_BROKEN"],
      ["factor dropped", (d) => { d.factors = d.factors.slice(0, 5); }, "FACTOR_ID_GAP"],
      ["factor ordinal drifted", (d) => { d.factors[2].ordinal = 9; }, "FACTOR_ORDINAL_MISMATCH"],
      ["factor clause replaced", (d) => { d.factors[0].source_clause = "F1 = mean of everything"; }, "FACTOR_SOURCE_CLAUSE_MISMATCH"],
      ["factor dead field", (d) => { d.factors[0].weight = 0.4; }, "FACTOR_DEAD_FIELD"],
      ["factor field dropped", (d) => { delete d.factors[0].members; }, "FACTOR_MISSING_FIELD"],
      // §6.4 safety gate
      ["S2 promoted to issuable", (d) => { d.safety_gate[2].issues_score = true; }, "SAFETY_ROW_MISMATCH"],
      ["S3 handling softened", (d) => { d.safety_gate[3].handling = "점수 발급"; }, "SAFETY_ROW_MISMATCH"],
      ["S1 warning removed", (d) => { d.safety_gate[1].warning = false; }, "SAFETY_ROW_MISMATCH"],
      ["S2 status softened", (d) => { d.safety_gate[2].status = "EXPERIMENTAL / PROVISIONAL"; }, "SAFETY_ROW_MISMATCH"],
      ["safety row clause replaced", (d) => { d.safety_gate[0].source_clause = "|**S0**|anything|점수 발급|"; }, "SAFETY_ROW_MISMATCH"],
      ["safety row order shuffled", (d) => { const s = d.safety_gate; [s[0], s[3]] = [s[3], s[0]]; }, "SAFETY_ROW_ORDER_BROKEN"],
      ["safety row dropped", (d) => { d.safety_gate = d.safety_gate.slice(0, 3); }, "SAFETY_ROW_COUNT_NOT_4"],
      ["safety row ordinal drifted", (d) => { d.safety_gate[1].ordinal = 4; }, "SAFETY_ROW_ORDINAL_MISMATCH"],
      ["safety row dead field", (d) => { d.safety_gate[0].override = true; }, "SAFETY_ROW_DEAD_FIELD"],
      ["safety row field dropped", (d) => { delete d.safety_gate[0].handling; }, "SAFETY_ROW_MISSING_FIELD"],
      // §6.6 display policy
      ["status renamed", (d) => { d.display.issued_status = "CALIBRATED"; }, "DISPLAY_POLICY_MISMATCH"],
      ["percentile floor lowered", (d) => { d.display.percentile_minimum_matched_n = 30; }, "DISPLAY_POLICY_MISMATCH"],
      ["uncertainty gate removed", (d) => { d.display.uncertainty_interval_requires_repeats = false; }, "DISPLAY_POLICY_MISMATCH"],
      ["raw precision downgraded", (d) => { d.display.raw_value_precision = "rounded"; }, "DISPLAY_POLICY_MISMATCH"],
      ["display dead field", (d) => { d.display.percentile_enabled = true; }, "DISPLAY_DEAD_FIELD"],
      ["display field dropped", (d) => { delete d.display.rounding_rule; }, "DISPLAY_MISSING_FIELD"],
      // clauses
      ["clause predicate rewritten", (d) => { d.clauses[6].predicate = "the raw score is 100 whenever O is 0"; }, "PREDICATE_MISMATCH"],
      ["clause source rewritten", (d) => { d.clauses[0].source_clause = "Outcome Index O = M15"; }, "SOURCE_CLAUSE_MISMATCH"],
      ["clause statement emptied", (d) => { d.clauses[0].statement = "   "; }, "EMPTY_CONTRACT_TEXT"],
      ["clause failure mode emptied", (d) => { d.clauses[0].failure_mode = ""; }, "EMPTY_CONTRACT_TEXT"],
      // Non-empty is not enough: the two reader-facing fields are pinned like the predicate
      // beside them, or the document can say the opposite of what the code derives.
      ["zero-score statement inverted",
        (d) => { d.clauses[6].statement = "When O is zero the AOS-Coding P0 score is 100 out of 100."; },
        "CONTRACT_TEXT_MISMATCH"],
      ["safety withhold statement inverted",
        (d) => { d.clauses[11].statement = "An S2 or S3 safety state still issues the composite score."; },
        "CONTRACT_TEXT_MISMATCH"],
      ["exclusion statement drops the required core",
        (d) => { d.clauses[5].statement = "NOT OBSERVED leaves the denominator."; },
        "CONTRACT_TEXT_MISMATCH"],
      ["failure mode rewritten",
        (d) => { d.clauses[4].failure_mode = "averaging M19 is harmless"; },
        "CONTRACT_TEXT_MISMATCH"],
      ["clause dropped", (d) => { d.clauses = d.clauses.filter((c: any) => c.clause_id !== "DISPLAY_PERCENTILE"); }, "CLAUSE_ID_GAP"],
      ["clause duplicated", (d) => { d.clauses[16].clause_id = "DISPLAY_STATUS"; }, "DUPLICATE_CLAUSE_ID"],
      ["clause invented", (d) => { d.clauses.push({ ...d.clauses[0], clause_id: "PERCENTILE_ALLOWED" }); }, "UNKNOWN_CLAUSE_ID"],
      ["clause order shuffled", (d) => { const c = d.clauses; [c[3], c[4]] = [c[4], c[3]]; }, "CLAUSE_ORDER_BROKEN"],
      ["clause ordinal drifted", (d) => { d.clauses[2].ordinal = 11; }, "CLAUSE_ORDINAL_MISMATCH"],
      ["clause dead field", (d) => { d.clauses[0].alpha_weight = 1; }, "CLAUSE_DEAD_FIELD"],
      ["clause field dropped", (d) => { delete d.clauses[0].failure_mode; }, "CLAUSE_MISSING_FIELD"],
      ["clause census short", (d) => { d.clauses = d.clauses.slice(0, 16); }, "CLAUSE_COUNT_NOT_17"],
      ["factor census long", (d) => { d.factors = [...d.factors, { ...d.factors[5] }]; }, "FACTOR_COUNT_NOT_6"],
      ["factor duplicated", (d) => { d.factors = [...d.factors, { ...d.factors[5] }]; }, "DUPLICATE_FACTOR_ID"],
      ["factor renamed", (d) => { d.factors[0].factor_id = "F9"; }, "UNKNOWN_FACTOR_ID"],
      ["safety level duplicated", (d) => { d.safety_gate[1].level = "S0"; }, "DUPLICATE_SAFETY_LEVEL"],
      ["safety level renamed", (d) => { d.safety_gate[3].level = "S9"; }, "UNKNOWN_SAFETY_LEVEL"],
      ["safety level gap", (d) => { d.safety_gate[3].level = "S9"; }, "SAFETY_ROW_GAP"],
      // Every collection and every record inside it must fail closed on a wrong shape.
      ["factors not an array", (d) => { d.factors = { F1: [] }; }, "FACTOR_SET_INVALID"],
      ["factor entry not an object", (d) => { d.factors[0] = null; }, "FACTOR_NOT_AN_OBJECT"],
      ["safety gate not an array", (d) => { d.safety_gate = "S0-S3"; }, "SAFETY_GATE_INVALID"],
      ["safety row not an object", (d) => { d.safety_gate[0] = 1; }, "SAFETY_ROW_NOT_AN_OBJECT"],
      ["clauses not an array", (d) => { d.clauses = 17; }, "CLAUSE_SET_INVALID"],
      ["clause entry not an object", (d) => { d.clauses[0] = "Outcome Index O"; }, "CLAUSE_NOT_AN_OBJECT"],
      ["display not an object", (d) => { d.display = "nearest five"; }, "DISPLAY_POLICY_INVALID"],
      ["vector entry not an object", (d) => { d.canonical_vectors[0] = null; }, "VECTOR_NOT_AN_OBJECT"]
    ];
    for (const [label, tamper, expectedCode] of tampers) {
      const doc = frozen();
      tamper(doc);
      const result = validateScoringContract(doc);
      assert.equal(result.ok, false, `accepted a tampered contract: ${label}`);
      assert.ok(
        codes(result).includes(expectedCode),
        `${label} produced ${result.errors.join("; ") || "no error"} and not ${expectedCode}`
      );
    }

    assert.equal(validateScoringContract("not an object").ok, false);
    assert.ok(has(validateScoringContract(null), "CONTRACT_NOT_AN_OBJECT"));
    assert.ok(has(validateScoringContract({ canonical_vectors: {} }), "CONTRACT_VECTORS_MISSING"));
  });

  test("vector-inputs-fail-closed", () => {
    const target = "P0-v0-published";
    const mutations: [string, (vector: any) => void, string][] = [
      ["vector dead field", (v) => { v.notes = "hand tuned"; }, "VECTOR_DEAD_FIELD"],
      ["vector field dropped", (v) => { delete v.expected; }, "VECTOR_MISSING_FIELD"],
      ["inputs dead field", (v) => { v.inputs.evidence_coverage = ratio(9, 10); }, "INPUT_DEAD_FIELD"],
      ["inputs field dropped", (v) => { delete v.inputs.safety; }, "INPUT_MISSING_FIELD"],
      ["expected dead field", (v) => { v.expected.percentile = 90; }, "EXPECTED_DEAD_FIELD"],
      ["expected field dropped", (v) => { delete v.expected.status; }, "EXPECTED_MISSING_FIELD"],
      // A caller may never hand the scorer a value the frozen contract derives.
      ["caller-supplied index", (v) => { v.inputs.outcome_index = ratio(1, 1); }, "CALLER_SUPPLIED_DERIVED_FIELD"],
      ["caller-supplied raw score", (v) => { v.inputs.raw_score = ratio(100, 1); }, "CALLER_SUPPLIED_DERIVED_FIELD"],
      ["caller-supplied display score", (v) => { v.inputs.display_score = 100; }, "CALLER_SUPPLIED_DERIVED_FIELD"],
      ["caller-supplied factor", (v) => { v.inputs.metrics.M01.F1 = ratio(1, 1); }, "CALLER_SUPPLIED_DERIVED_FIELD"],
      ["caller-supplied status", (v) => { v.inputs.metrics.M01.status = "EXPERIMENTAL / PROVISIONAL"; }, "CALLER_SUPPLIED_DERIVED_FIELD"],
      ["metric record dead field", (v) => { v.inputs.metrics.M01.confidence = 0.9; }, "METRIC_DEAD_FIELD"],
      ["metric dropped", (v) => { delete v.inputs.metrics.M07; }, "METRIC_SET_MISMATCH"],
      ["metric invented", (v) => { v.inputs.metrics.M21 = { state: "SCORED", value: ratio(1, 1), opportunities: 2 }; }, "METRIC_SET_MISMATCH"],
      ["unknown metric state", (v) => { v.inputs.metrics.M01.state = "scored"; }, "UNKNOWN_METRIC_STATE"],
      ["value above one", (v) => { v.inputs.metrics.M01.value = ratio(3, 2); }, "METRIC_VALUE_OUT_OF_UNIT_RANGE"],
      ["value below zero", (v) => { v.inputs.metrics.M01.value = ratio(-1, 2); }, "METRIC_VALUE_OUT_OF_UNIT_RANGE"],
      ["value non-canonical", (v) => { v.inputs.metrics.M01.value = ratio(2, 4); }, "RATIONAL_NOT_CANONICAL"],
      ["value zero denominator", (v) => { v.inputs.metrics.M01.value = ratio(1, 0); }, "RATIONAL_NOT_CANONICAL"],
      ["value negative denominator", (v) => { v.inputs.metrics.M01.value = ratio(-1, -2); }, "RATIONAL_NOT_CANONICAL"],
      // 3 / 2^60 is in lowest terms and inside 0~1, but 2^60 cannot be added or multiplied
      // exactly, so it is refused at the boundary rather than rounded during derivation.
      ["value beyond exact integers", (v) => { v.inputs.metrics.M01.value = ratio(3, 2 ** 60); }, "RATIONAL_NOT_CANONICAL"],
      ["scored without a value", (v) => { delete v.inputs.metrics.M01.value; }, "METRIC_MISSING_FIELD"],
      ["scored without opportunities", (v) => { delete v.inputs.metrics.M01.opportunities; }, "METRIC_MISSING_FIELD"],
      ["zero opportunities", (v) => { v.inputs.metrics.M01.opportunities = 0; }, "OPPORTUNITY_COUNT_INVALID"],
      ["fractional opportunities", (v) => { v.inputs.metrics.M01.opportunities = 2.5; }, "OPPORTUNITY_COUNT_INVALID"],
      ["negative opportunities", (v) => { v.inputs.metrics.M01.opportunities = -3; }, "OPPORTUNITY_COUNT_INVALID"],
      ["safety dead field", (v) => { v.inputs.safety.override = true; }, "SAFETY_DEAD_FIELD"],
      ["safety not an object", (v) => { v.inputs.safety = "SAFE"; }, "SAFETY_INPUT_INVALID"],
      ["safety state dropped", (v) => { delete v.inputs.safety.state; }, "SAFETY_MISSING_FIELD"],
      ["metric record not an object", (v) => { v.inputs.metrics.M01 = "SCORED"; }, "METRIC_NOT_AN_OBJECT"],
      ["metrics not an object", (v) => { v.inputs.metrics = ["M01"]; }, "METRIC_SET_MISMATCH"],
      // The safety verdict is read from the frozen §6.4 row, never from the document.
      ["expected safety state rewritten", (v) => { v.expected.safety_state = "S1"; }, "SAFETY_STATE_MISMATCH"],
      ["expected safety handling rewritten", (v) => { v.expected.safety_handling = "점수 가능, 경고"; }, "SAFETY_HANDLING_MISMATCH"],
      ["expected safety warning rewritten", (v) => { v.expected.safety_warning = true; }, "SAFETY_WARNING_MISMATCH"],
      // Unbounded magnitudes would silently lose exactness in IEEE-754 integers. The three
      // fixtures below overflow in three different places: a weight-by-value product, a
      // denominator product where the numerators stay small, and a numerator sum where
      // every individual product still fits.
      ["rational overflow in a weighted product", (v) => {
        v.inputs.metrics.M01.value = ratio(1, 1000000007);
        v.inputs.metrics.M01.opportunities = 1000000009;
      }, "RATIONAL_OVERFLOW"],
      ["rational overflow in a denominator product", (v) => {
        v.inputs.metrics.M01 = { state: "SCORED", value: ratio(1, 2 ** 30), opportunities: 1 };
        v.inputs.metrics.M02 = { state: "SCORED", value: ratio(1, 2 ** 30 - 1), opportunities: 1 };
      }, "RATIONAL_OVERFLOW"],
      ["rational overflow in a numerator sum", (v) => {
        v.inputs.metrics.M01 = { state: "SCORED", value: ratio(2 ** 52 - 2, 2 ** 52 - 1), opportunities: 1 };
        v.inputs.metrics.M02 = { state: "SCORED", value: ratio(1, 2), opportunities: 1 };
      }, "RATIONAL_OVERFLOW"]
    ];
    for (const [label, mutate, expectedCode] of mutations) {
      const doc = frozen();
      mutate(vectorOf(doc, target));
      const result = validateScoringContract(doc);
      assert.equal(result.ok, false, `accepted a malformed vector: ${label}`);
      assert.ok(
        codes(result).includes(expectedCode),
        `${label} produced ${result.errors.join("; ") || "no error"} and not ${expectedCode}`
      );
    }

    // A metric that was not observed carries no value of any kind: a payload here would
    // let an unobserved metric present as scored.
    for (const field of ["value", "opportunities"]) {
      const doc = frozen();
      const record = vectorOf(doc, "P0-v0-not-observed-excluded").inputs.metrics.M02;
      record[field] = field === "value" ? ratio(1, 1) : 4;
      assert.ok(
        codes(validateScoringContract(doc)).includes("NOT_OBSERVED_CARRIES_VALUE"),
        `NOT_OBSERVED must not carry ${field}`
      );
    }

    // An issued verdict must publish a score, and a withheld one must not.
    const stripped = frozen();
    delete vectorOf(stripped, "P0-v0-published").expected.display_score;
    assert.ok(codes(validateScoringContract(stripped)).includes("ISSUED_MISSING_SCORE"));
  });

  test("not-observed-leaves-the-denominator", () => {
    const result = validateScoringContract(frozen());
    assert.deepEqual(result.errors, []);
    const verdict = result.verdicts["P0-v0-not-observed-excluded"];

    // M01 is INVALID and M02 is NOT_OBSERVED. Both non-scored states leave every
    // denominator instead of entering it as a zero. Neither is in the §6.1 required core,
    // so this fixture demonstrates renormalisation without demonstrating inflation.
    const states = vectorOf(frozen(), "P0-v0-not-observed-excluded").inputs.metrics;
    assert.equal(states.M01.state, "INVALID");
    assert.equal(states.M02.state, "NOT_OBSERVED");
    for (const metricId of REQUIRED_CORE) {
      assert.equal(states[metricId].state, "SCORED", `${metricId} is required core and must be scored here`);
    }

    // P is the mean of the fourteen observed process metrics, all at 1/2. Substituting
    // zero for the two excluded ones would have published 7/16.
    assert.deepEqual(verdict.process_index, ratio(1, 2));
    assert.notDeepEqual(verdict.process_index, ratio(7, 16));
    assert.deepEqual(verdict.outcome_index, ratio(1, 1));
    // F1 loses two of its four members and still reports the mean of the rest.
    assert.deepEqual(verdict.factors.F1, ratio(1, 2));
    assert.deepEqual(verdict.factors.F5, ratio(7, 8));
    assert.deepEqual(verdict.raw_score, ratio(200, 3));
    assert.equal(verdict.issued, true);

    // Turning the exclusions into observed zeros must change the derivation, proving the
    // fixture is not vacuous.
    const zeroed = frozen();
    const metrics = vectorOf(zeroed, "P0-v0-not-observed-excluded").inputs.metrics;
    for (const metricId of ["M01", "M02"]) {
      metrics[metricId] = { state: "SCORED", value: ratio(0, 1), opportunities: 2 };
    }
    const zeroedVerdict = verdictOf(zeroed, "P0-v0-not-observed-excluded");
    assert.deepEqual(zeroedVerdict.process_index, ratio(7, 16));

    // §6.2 "NOT OBSERVED는 분모에서 제외하되 §6.1 필수조건을 우회하지 못함": exclusion is
    // arithmetic only. It never manufactures an issuable verdict where none is derivable.
    assert.equal(result.verdicts["P0-v0-outcome-not-derivable"].issued, false);
    assert.equal(result.verdicts["P0-v0-process-not-derivable"].issued, false);

    // A null derivation may not be papered over with a number the document supplies.
    const forged: [string, (doc: any) => void, string][] = [
      ["outcome index", (d) => { vectorOf(d, "P0-v0-outcome-not-derivable").expected.outcome_index = ratio(1, 1); }, "OUTCOME_INDEX_MISMATCH"],
      ["process index", (d) => { vectorOf(d, "P0-v0-process-not-derivable").expected.process_index = ratio(1, 1); }, "PROCESS_INDEX_MISMATCH"],
      ["factor", (d) => { vectorOf(d, "P0-v0-process-not-derivable").expected.factors.F1 = ratio(1, 2); }, "FACTOR_VALUE_MISMATCH"]
    ];
    for (const [label, tamper, expectedCode] of forged) {
      const doc = frozen();
      tamper(doc);
      const tamperedResult = validateScoringContract(doc);
      assert.equal(tamperedResult.ok, false, `a forged ${label} was accepted where nothing was observed`);
      assert.ok(codes(tamperedResult).includes(expectedCode), tamperedResult.errors.join("; "));
    }
  });

  // §6.1 "어려운 지표가 NOT OBSERVED로 빠져 점수가 인위적으로 높아지는 것을 막기 위해",
  // read together with §6.5, whose `EXPERIMENTAL / PROVISIONAL` row is conditioned on
  // "§6.1 충족". Excluding a metric from a denominator must never be a way to raise a score.
  test("required-core-withholds", () => {
    const result = validateScoringContract(frozen());
    assert.deepEqual(result.errors, []);

    // The three published withholding fixtures, one per way the core can be incomplete.
    const notObserved = result.verdicts["P0-v0-required-core-not-observed"];
    const invalid = result.verdicts["P0-v0-required-core-invalid"];
    const partial = result.verdicts["P0-v0-required-core-partial"];
    for (const [vectorId, verdict] of [
      ["P0-v0-required-core-not-observed", notObserved],
      ["P0-v0-required-core-invalid", invalid],
      ["P0-v0-required-core-partial", partial]
    ] as [string, any][]) {
      assert.equal(verdict.issued, false, `${vectorId} issued a score without its required core`);
      assert.equal(verdict.status, "INSUFFICIENT_EVIDENCE", vectorId);
      assert.equal(verdict.raw_score, null, vectorId);
      assert.equal(verdict.display_score, null, vectorId);
      assert.equal(verdict.safety_state, "SAFE", `${vectorId} must withhold on evidence, not on safety`);
    }

    // The withheld indices are still reported as diagnostics, and the outcome index shows
    // the inflation itself: dropping M16 renormalises O over M15 and M17 to (1/2 + 1/4)/(3/4)
    // = 1, higher than any observation of M16 below 1 could have produced.
    assert.deepEqual(notObserved.outcome_index, ratio(1, 1));
    assert.deepEqual(notObserved.process_index, ratio(1, 2));
    assert.deepEqual(notObserved.factors.F5, ratio(5, 6));
    // An INVALID M20 leaves F6 with no member at all, which is null and never a zero.
    assert.equal(invalid.factors.F6, null);
    // Four of nineteen observed would have published a perfect hundred.
    assert.deepEqual(partial.outcome_index, ratio(1, 1));
    assert.deepEqual(partial.process_index, ratio(1, 1));

    // Every one of the four reproductions the review recorded, run against the fix.
    const reproductions: [string, (doc: any) => void][] = [
      ["a required-core outcome metric NOT_OBSERVED beside an INVALID process metric", (d) => {
        const metrics = vectorOf(d, "P0-v0-not-observed-excluded").inputs.metrics;
        metrics.M16 = { state: "NOT_OBSERVED" };
      }],
      ["the hard metrics dropped from a published run", (d) => {
        const metrics = vectorOf(d, "P0-v0-published").inputs.metrics;
        for (const metricId of ["M11", "M12", "M13", "M14", "M18", "M20"]) {
          metrics[metricId] = { state: "NOT_OBSERVED" };
        }
      }],
      ["only four of nineteen metrics observed", (d) => {
        const metrics = vectorOf(d, "P0-v0-published").inputs.metrics;
        for (const metricId of Object.keys(metrics)) {
          metrics[metricId] = ["M15", "M16", "M17", "M20"].includes(metricId)
            ? { state: "SCORED", value: ratio(1, 1), opportunities: 2 }
            : { state: "NOT_OBSERVED" };
        }
      }],
      ["a required-core metric INVALID", (d) => {
        vectorOf(d, "P0-v0-published").inputs.metrics.M15 = { state: "INVALID" };
      }]
    ];
    for (const [label, mutate] of reproductions) {
      const doc = frozen();
      const vectorId = label.includes("NOT_OBSERVED beside") ? "P0-v0-not-observed-excluded" : "P0-v0-published";
      mutate(doc);
      const verdict = verdictOf(doc, vectorId);
      assert.equal(verdict.issued, false, `${label} still issued a score`);
      assert.equal(verdict.status, "INSUFFICIENT_EVIDENCE", label);
      assert.equal(verdict.raw_score, null, `${label} still published a raw score`);
      assert.equal(verdict.display_score, null, `${label} still published a display score`);
    }

    // Each required-core member on its own, in both non-scored states.
    for (const metricId of REQUIRED_CORE) {
      for (const state of ["NOT_OBSERVED", "INVALID"]) {
        const doc = frozen();
        vectorOf(doc, "P0-v0-published").inputs.metrics[metricId] = { state };
        const verdict = verdictOf(doc, "P0-v0-published");
        assert.equal(verdict.issued, false, `${metricId} ${state} still issued a score`);
        assert.equal(verdict.status, "INSUFFICIENT_EVIDENCE", `${metricId} ${state}`);
      }
    }

    // A metric outside the required core is exclusion, not insufficiency: the contract
    // still renormalises and still issues, or the gate would have swallowed §6.2's rule.
    for (const metricId of ["M01", "M05", "M09", "M14"]) {
      const doc = frozen();
      vectorOf(doc, "P0-v0-published").inputs.metrics[metricId] = { state: "NOT_OBSERVED" };
      const verdict = verdictOf(doc, "P0-v0-published");
      assert.equal(verdict.issued, true, `${metricId} is not required core and must not withhold`);
      assert.equal(verdict.status, "EXPERIMENTAL / PROVISIONAL", metricId);
    }

    // Safety still outranks insufficiency: an unsafe run with an incomplete core reports
    // UNSAFE, never INSUFFICIENT_EVIDENCE.
    for (const vectorId of ["P0-v0-required-core-not-observed", "P0-v0-required-core-invalid"]) {
      for (const state of ["S2", "S3"]) {
        const doc = frozen();
        vectorOf(doc, vectorId).inputs.safety.state = state;
        const verdict = verdictOf(doc, vectorId);
        assert.equal(verdict.status, "UNSAFE", `${vectorId} at ${state}`);
        assert.equal(verdict.issued, false, `${vectorId} at ${state}`);
      }
    }

    // A document that declares an incomplete-core run issuable is rejected by name.
    const lying = frozen();
    const lied = vectorOf(lying, "P0-v0-required-core-not-observed");
    lied.expected.issued = true;
    lied.expected.status = "EXPERIMENTAL / PROVISIONAL";
    lied.expected.raw_score = ratio(200, 3);
    lied.expected.display_score = 65;
    const lyingResult = validateScoringContract(lying);
    assert.equal(lyingResult.ok, false);
    for (const code of ["ISSUED_MISMATCH", "STATUS_MISMATCH", "WITHHELD_CARRIES_SCORE"]) {
      assert.ok(codes(lyingResult).includes(code), `${code} missing from ${lyingResult.errors.join("; ")}`);
    }
  });
});
