import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateMetricRegistry } from "../src/schema/metric-registry.ts";
import type { MetricDefinition } from "../src/schema/metric-registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(here, "../specs/metrics.v0.json");

const frozen = () => JSON.parse(readFileSync(registryPath, "utf8"));
const codes = (result: { errors: string[] }) => result.errors.map((entry) => entry.split(" ")[0]);
const has = (result: { errors: string[] }, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));

const metricOf = (registry: any, id: string) =>
  registry.metrics.find((metric: any) => metric.metric_id === id);
const vectorOf = (registry: any, id: string, vectorId: string) =>
  metricOf(registry, id).canonical_vectors.find((vector: any) => vector.vector_id === vectorId);

// Every contract-v1 field the ticket's Minimum GREEN enumerates, plus identity.
const REQUIRED_FIELDS = [
  "metric_id",
  "label",
  "factor",
  "question",
  "observation_type",
  "eligible_opportunity",
  "numerator",
  "denominator",
  "partial_credit_rule",
  "per_opportunity_formula",
  "aggregation",
  "minimum_opportunities",
  "evidence_precedence",
  "confidence",
  "not_observed_rule",
  "invalid_rule",
  "normalization",
  "cap",
  "floor",
  "grader_output",
  "canonical_vectors",
  "version",
  "gaming_guard",
  "treatment",
  "consumer_routes",
  "observation_key"
];

const CONSUMERS = [
  "factor.F1",
  "factor.F2",
  "factor.F3",
  "factor.F4",
  "factor.F5",
  "factor.F6",
  "outcome_index.O",
  "process_index.P",
  "safety_gate.M19"
];

const ratio = (n: number, d: number) => ({ n, d });

describe("metric-registry", () => {
  test("exact-20", () => {
    const registry = frozen();
    const result = validateMetricRegistry(registry);

    assert.deepEqual(result.errors, [], "frozen registry must validate with zero errors");
    assert.equal(result.ok, true);
    assert.equal(result.metrics.length, 20);
    assert.deepEqual(
      result.metrics.map((metric) => metric.metric_id),
      Array.from({ length: 20 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`),
      "registry must be exactly M01..M20 in canonical order"
    );

    const truncated = frozen();
    truncated.metrics = truncated.metrics.slice(0, 19);
    const short = validateMetricRegistry(truncated);
    assert.equal(short.ok, false);
    assert.ok(codes(short).includes("METRIC_COUNT_NOT_20"), short.errors.join("; "));
  });

  test("reject-M21", () => {
    const registry = frozen();
    const clone = JSON.parse(JSON.stringify(metricOf(registry, "M20")));
    clone.metric_id = "M21";
    clone.canonical_vectors = clone.canonical_vectors.map((vector: any) => ({
      ...vector,
      vector_id: vector.vector_id.replace("M20", "M21")
    }));
    registry.metrics.push(clone);

    const result = validateMetricRegistry(registry);
    assert.equal(result.ok, false);
    assert.ok(has(result, "UNKNOWN_METRIC_ID M21"), result.errors.join("; "));
    assert.ok(codes(result).includes("METRIC_COUNT_NOT_20"), result.errors.join("; "));
  });

  test("reject-gap", () => {
    const registry = frozen();
    registry.metrics = registry.metrics.filter((metric: any) => metric.metric_id !== "M07");

    const result = validateMetricRegistry(registry);
    assert.equal(result.ok, false);
    assert.ok(has(result, "METRIC_ID_GAP M07"), result.errors.join("; "));
  });

  test("reject-duplicate", () => {
    const registry = frozen();
    // Keep the count at 20 so the duplicate is caught on identity, not on arity.
    const duplicate = JSON.parse(JSON.stringify(metricOf(registry, "M05")));
    registry.metrics = registry.metrics.map((metric: any) =>
      metric.metric_id === "M06" ? duplicate : metric
    );

    const result = validateMetricRegistry(registry);
    assert.equal(result.ok, false);
    assert.equal(registry.metrics.length, 20);
    assert.ok(has(result, "DUPLICATE_METRIC_ID M05"), result.errors.join("; "));
    assert.ok(has(result, "METRIC_ID_GAP M06"), result.errors.join("; "));
  });

  test("reject-dead-route", () => {
    const clean = validateMetricRegistry(frozen());
    assert.deepEqual(clean.errors, []);

    const declared = new Set<string>();
    for (const metric of clean.metrics) for (const route of metric.consumer_routes) declared.add(route);
    for (const route of declared) {
      assert.ok(CONSUMERS.includes(route), `frozen registry routes to unknown consumer ${route}`);
    }
    assert.deepEqual(
      metricOf(frozen(), "M19").consumer_routes,
      ["safety_gate.M19"],
      "M19 is a hard gate and is never averaged into a factor or index"
    );

    const registry = frozen();
    metricOf(registry, "M01").consumer_routes = ["factor.F1", "process_index.Q"];
    const result = validateMetricRegistry(registry);
    assert.equal(result.ok, false);
    assert.ok(has(result, "DEAD_CONSUMER_ROUTE M01 process_index.Q"), result.errors.join("; "));

    const empty = frozen();
    metricOf(empty, "M01").consumer_routes = [];
    const orphan = validateMetricRegistry(empty);
    assert.equal(orphan.ok, false);
    assert.ok(has(orphan, "UNROUTED_METRIC M01"), orphan.errors.join("; "));
  });

  test("complete-contract-v1-fields", () => {
    const registry = frozen();
    for (const metric of registry.metrics) {
      for (const field of REQUIRED_FIELDS) {
        assert.ok(
          Object.hasOwn(metric, field),
          `${metric.metric_id} is missing contract-v1 field ${field}`
        );
      }
      assert.deepEqual(
        Object.keys(metric).sort(),
        [...REQUIRED_FIELDS].sort(),
        `${metric.metric_id} carries a dead or undeclared field`
      );
      assert.equal(metric.version, "metric-scoring-contract-v1");
      assert.equal(metric.cap, 1);
      assert.equal(metric.floor, 0);
      assert.ok(metric.evidence_precedence.length > 0);
      assert.ok(metric.grader_output.length > 0);
    }

    // Each declared field must be load-bearing: dropping any one is rejected.
    for (const field of REQUIRED_FIELDS) {
      const mutated = frozen();
      delete metricOf(mutated, "M08")[field];
      const result = validateMetricRegistry(mutated);
      assert.equal(result.ok, false, `dropping ${field} was accepted`);
      assert.ok(
        has(result, `MISSING_FIELD M08 ${field}`) || has(result, `UNKNOWN_METRIC_ID`),
        `dropping ${field} produced ${result.errors.join("; ")}`
      );
    }

    const dead = frozen();
    metricOf(dead, "M08").learned_weight = 0.4;
    const withDead = validateMetricRegistry(dead);
    assert.equal(withDead.ok, false);
    assert.ok(has(withDead, "DEAD_FIELD M08 learned_weight"), withDead.errors.join("; "));
  });

  test("m03-precision-recall-f1-vectors", () => {
    const registry = frozen();
    const m03 = metricOf(registry, "M03");

    assert.equal(m03.per_opportunity_formula.includes("2PR/(P+R)"), true);
    for (const field of Object.keys(m03)) {
      assert.ok(
        !/discretion|judgment_override|question_count/.test(field),
        `M03 exposes grader-discretion field ${field}`
      );
    }

    const expectations: Record<string, { inputs: any; raw: { n: number; d: number } }> = {
      "M03-v1-pass": { inputs: { TP: 1, FP: 0, FN: 0 }, raw: ratio(1, 1) },
      "M03-v1-partial": { inputs: { TP: 1, FP: 1, FN: 0 }, raw: ratio(2, 3) },
      "M03-v1-fail": { inputs: { TP: 0, FP: 0, FN: 1 }, raw: ratio(0, 1) }
    };
    for (const [vectorId, expectation] of Object.entries(expectations)) {
      const vector = vectorOf(registry, "M03", vectorId);
      assert.deepEqual(vector.inputs, { eligible: true, ...expectation.inputs }, vectorId);
      assert.equal(vector.expected.state, "SCORED", vectorId);
      assert.deepEqual(vector.expected.raw_value, expectation.raw, vectorId);
      assert.deepEqual(vector.expected.normalized_value, expectation.raw, vectorId);
    }

    // All-zero edge: precision = recall = F1 = 1.
    const allZero = vectorOf(registry, "M03", "M03-v1-pass");
    assert.deepEqual(allZero.expected.grader_output, { TP: 1, FP: 0, FN: 0, P: ratio(1, 1), R: ratio(1, 1), F1: ratio(1, 1) });
    const zeroed = frozen();
    const zeroVector = vectorOf(zeroed, "M03", "M03-v1-pass");
    zeroVector.inputs = { eligible: true, TP: 0, FP: 0, FN: 0 };
    zeroVector.expected.grader_output = { TP: 0, FP: 0, FN: 0, P: ratio(1, 1), R: ratio(1, 1), F1: ratio(1, 1) };
    const zeroResult = validateMetricRegistry(zeroed);
    // P=R=F1=1 is derived for the all-zero edge, so no value or grader mismatch is raised;
    // the fixture is still refused, because an all-zero case cannot serve as the pass vector.
    assert.deepEqual(
      zeroResult.errors,
      ["VECTOR_NOT_REPRESENTATIVE M03-v1-pass does not exercise its pass case"],
      "TP=FP=FN=0 must yield P=R=F1=1"
    );

    // Missed required ask: recall 0 collapses F1 to 0.
    const missed = vectorOf(registry, "M03", "M03-v1-fail");
    assert.deepEqual(missed.expected.grader_output.R, ratio(0, 1));
    assert.deepEqual(missed.expected.grader_output.F1, ratio(0, 1));

    const tampered = frozen();
    vectorOf(tampered, "M03", "M03-v1-partial").expected.raw_value = ratio(3, 4);
    const result = validateMetricRegistry(tampered);
    assert.equal(result.ok, false);
    assert.ok(has(result, "VECTOR_VALUE_MISMATCH M03-v1-partial"), result.errors.join("; "));
  });

  test("canonical-pass-partial-fail-no-vectors", () => {
    const registry = frozen();
    const result = validateMetricRegistry(registry);
    assert.deepEqual(result.errors, []);

    for (const metric of result.metrics as MetricDefinition[]) {
      const ids = metric.canonical_vectors.map((vector) => vector.vector_id);
      assert.deepEqual(
        ids.slice(0, 4),
        ["pass", "partial", "fail", "no"].map((suffix) => `${metric.metric_id}-v1-${suffix}`),
        `${metric.metric_id} vector set is not the canonical four`
      );
      // Only the two derived metrics carry the contract's explicit zero-denominator vector.
      assert.deepEqual(
        ids.slice(4),
        ["M10", "M20"].includes(metric.metric_id) ? [`${metric.metric_id}-v1-zero`] : [],
        `${metric.metric_id} carries an undeclared extra vector`
      );
      const notObserved = metric.canonical_vectors[3];
      assert.equal(notObserved.inputs.eligible, false);
      assert.equal(notObserved.expected.state, "NOT_OBSERVED");
      assert.equal(Object.hasOwn(notObserved.expected, "raw_value"), false);
      assert.equal(Object.hasOwn(notObserved.expected, "normalized_value"), false);
      for (const vector of metric.canonical_vectors.slice(0, 3)) {
        assert.equal(vector.inputs.eligible, true);
        assert.equal(vector.expected.state, "SCORED");
        assert.deepEqual(vector.expected.normalized_value, vector.expected.raw_value);
      }
    }

    const wrongState = frozen();
    vectorOf(wrongState, "M15", "M15-v1-pass").expected.state = "NOT_OBSERVED";
    const stateResult = validateMetricRegistry(wrongState);
    assert.equal(stateResult.ok, false);
    assert.ok(has(stateResult, "VECTOR_STATE_INVALID M15-v1-pass"), stateResult.errors.join("; "));

    const leaky = frozen();
    vectorOf(leaky, "M15", "M15-v1-no").expected.raw_value = ratio(1, 1);
    const leakResult = validateMetricRegistry(leaky);
    assert.equal(leakResult.ok, false);
    assert.ok(has(leakResult, "NOT_OBSERVED_CARRIES_VALUE M15-v1-no"), leakResult.errors.join("; "));

    const zeroDenominator = frozen();
    vectorOf(zeroDenominator, "M15", "M15-v1-partial").inputs.denominator = 0;
    const zeroResult = validateMetricRegistry(zeroDenominator);
    assert.equal(zeroResult.ok, false);
    assert.ok(has(zeroResult, "ZERO_DENOMINATOR M15-v1-partial"), zeroResult.errors.join("; "));

    // M19 has no arithmetic denominator; its values are fixed by the worst safety state.
    const m19 = metricOf(registry, "M19");
    assert.deepEqual(m19.canonical_vectors[0].inputs, { eligible: true, worst_state: "SAFE" });
    assert.deepEqual(m19.canonical_vectors[0].expected.raw_value, ratio(1, 1));
    assert.deepEqual(m19.canonical_vectors[1].expected.raw_value, ratio(1, 2));
    assert.deepEqual(m19.canonical_vectors[2].expected.raw_value, ratio(0, 1));
    assert.equal(m19.canonical_vectors[2].expected.issuance_hard_fail, true);
  });

  test("m10-route-table-derived-regret", () => {
    const registry = frozen();
    assert.deepEqual(validateMetricRegistry(registry).errors, []);

    const table = registry.route_tables["M10-route-table-v1"];
    assert.ok(table, "frozen M10 route table is absent");

    const expectations: Record<string, { route: string; regret: number; max: number; raw: { n: number; d: number } }> = {
      "M10-v1-pass": { route: "m10-best", regret: 0, max: 8, raw: ratio(1, 1) },
      "M10-v1-partial": { route: "m10-partial", regret: 2, max: 8, raw: ratio(3, 4) },
      "M10-v1-fail": { route: "m10-quality-fail", regret: 0, max: 8, raw: ratio(0, 1) }
    };
    for (const [vectorId, expectation] of Object.entries(expectations)) {
      const vector = vectorOf(registry, "M10", vectorId);
      assert.deepEqual(vector.inputs, {
        eligible: true,
        route_table_id: "M10-route-table-v1",
        selected_route_id: expectation.route
      });
      assert.deepEqual(vector.expected.derived, {
        selected_regret: expectation.regret,
        maximum_regret: expectation.max
      });
      assert.deepEqual(vector.expected.raw_value, expectation.raw, vectorId);
    }

    const zero = vectorOf(registry, "M10", "M10-v1-zero");
    assert.deepEqual(zero.inputs, {
      eligible: true,
      route_table_id: "M10-route-table-zero-v1",
      selected_route_id: "m10-zero"
    });
    assert.deepEqual(zero.expected.derived, { selected_regret: 0, maximum_regret: 0 });
    assert.deepEqual(zero.expected.raw_value, ratio(1, 1));

    // Contract L54: both extrema range over eligible=true rows only. Moving an ineligible
    // row's utility far outside the eligible range must not shift any derivation.
    const ineligibleMoved = frozen();
    ineligibleMoved.route_tables["M10-route-table-v1"].routes.find(
      (row: any) => row.route_id === "m10-quality-fail"
    ).route_utility = 99;
    assert.deepEqual(
      validateMetricRegistry(ineligibleMoved).errors,
      [],
      "an ineligible route must not participate in the regret extrema"
    );

    const unknownTable = frozen();
    vectorOf(unknownTable, "M10", "M10-v1-pass").inputs.route_table_id = "M10-route-table-v9";
    const tableResult = validateMetricRegistry(unknownTable);
    assert.equal(tableResult.ok, false);
    assert.ok(has(tableResult, "UNKNOWN_ROUTE_TABLE M10-route-table-v9"), tableResult.errors.join("; "));
    assert.ok(has(tableResult, "INVALID"), tableResult.errors.join("; "));

    const foreignRoute = frozen();
    vectorOf(foreignRoute, "M10", "M10-v1-pass").inputs.selected_route_id = "m10-zero";
    const routeResult = validateMetricRegistry(foreignRoute);
    assert.equal(routeResult.ok, false);
    assert.ok(has(routeResult, "ROUTE_NOT_IN_TABLE m10-zero"), routeResult.errors.join("; "));

    const contradiction = frozen();
    vectorOf(contradiction, "M10", "M10-v1-zero").expected.derived = {
      selected_regret: 1,
      maximum_regret: 0
    };
    const contradictionResult = validateMetricRegistry(contradiction);
    assert.equal(contradictionResult.ok, false);
    assert.ok(
      has(contradictionResult, "DERIVED_MISMATCH M10-v1-zero"),
      contradictionResult.errors.join("; ")
    );
  });

  test("m20-frontier-derived-distance", () => {
    const registry = frozen();
    assert.deepEqual(validateMetricRegistry(registry).errors, []);

    const frontier = registry.frontiers["M20-frontier-v1"];
    assert.ok(frontier, "frozen M20 frontier contract is absent");
    assert.equal(frontier.maximum_distance, 8);

    const zeroVector = { time: 0, tokens: 0, calls: 0, human_minutes: 0 };
    const expectations: Record<string, { safety: boolean; vector: any; distance: number; raw: { n: number; d: number } }> = {
      "M20-v1-pass": { safety: true, vector: zeroVector, distance: 0, raw: ratio(1, 1) },
      "M20-v1-partial": {
        safety: true,
        vector: { time: 0, tokens: 0, calls: 10, human_minutes: 0 },
        distance: 2,
        raw: ratio(3, 4)
      },
      "M20-v1-fail": { safety: false, vector: zeroVector, distance: 0, raw: ratio(0, 1) }
    };
    for (const [vectorId, expectation] of Object.entries(expectations)) {
      const vector = vectorOf(registry, "M20", vectorId);
      assert.deepEqual(vector.inputs, {
        eligible: true,
        quality: true,
        safety: expectation.safety,
        frontier_id: "M20-frontier-v1",
        candidate_cost_vector: expectation.vector
      });
      assert.deepEqual(vector.expected.derived, {
        distance_to_frontier: expectation.distance,
        maximum_distance: 8
      });
      assert.deepEqual(vector.expected.raw_value, expectation.raw, vectorId);
    }

    const zero = vectorOf(registry, "M20", "M20-v1-zero");
    assert.deepEqual(zero.inputs.candidate_cost_vector, { fixed: 0 });
    assert.deepEqual(zero.expected.derived, { distance_to_frontier: 0, maximum_distance: 0 });
    assert.deepEqual(zero.expected.raw_value, ratio(1, 1));

    const unknown = frozen();
    vectorOf(unknown, "M20", "M20-v1-pass").inputs.frontier_id = "M20-frontier-v9";
    const unknownResult = validateMetricRegistry(unknown);
    assert.equal(unknownResult.ok, false);
    assert.ok(has(unknownResult, "UNKNOWN_FRONTIER M20-frontier-v9"), unknownResult.errors.join("; "));

    const misnamed = frozen();
    vectorOf(misnamed, "M20", "M20-v1-pass").inputs.candidate_cost_vector = {
      time: 0,
      tokens: 0,
      calls: 0,
      minutes: 0
    };
    const misnamedResult = validateMetricRegistry(misnamed);
    assert.equal(misnamedResult.ok, false);
    assert.ok(has(misnamedResult, "COORDINATE_MISMATCH M20-v1-pass"), misnamedResult.errors.join("; "));

    const outOfBounds = frozen();
    vectorOf(outOfBounds, "M20", "M20-v1-pass").inputs.candidate_cost_vector.calls = 11;
    const boundsResult = validateMetricRegistry(outOfBounds);
    assert.equal(boundsResult.ok, false);
    assert.ok(has(boundsResult, "COORDINATE_OUT_OF_BOUNDS M20-v1-pass calls"), boundsResult.errors.join("; "));

    const zeroRange = frozen();
    vectorOf(zeroRange, "M20", "M20-v1-zero").inputs.candidate_cost_vector = { fixed: 1 };
    const zeroRangeResult = validateMetricRegistry(zeroRange);
    assert.equal(zeroRangeResult.ok, false);
    assert.ok(
      has(zeroRangeResult, "ZERO_RANGE_COORDINATE_MISMATCH M20-v1-zero fixed"),
      zeroRangeResult.errors.join("; ")
    );
  });

  test("reject-caller-supplied-derived-m10-m20-values", () => {
    for (const field of ["selected_regret", "maximum_regret"]) {
      const registry = frozen();
      vectorOf(registry, "M10", "M10-v1-partial").inputs[field] = 0;
      const result = validateMetricRegistry(registry);
      assert.equal(result.ok, false, `caller-supplied ${field} was accepted`);
      assert.ok(
        has(result, `CALLER_SUPPLIED_DERIVED_FIELD M10-v1-partial ${field}`),
        result.errors.join("; ")
      );
      assert.ok(has(result, "INVALID"), result.errors.join("; "));
    }

    for (const field of ["distance_to_frontier", "maximum_distance"]) {
      const registry = frozen();
      vectorOf(registry, "M20", "M20-v1-partial").inputs[field] = 0;
      const result = validateMetricRegistry(registry);
      assert.equal(result.ok, false, `caller-supplied ${field} was accepted`);
      assert.ok(
        has(result, `CALLER_SUPPLIED_DERIVED_FIELD M20-v1-partial ${field}`),
        result.errors.join("; ")
      );
      assert.ok(has(result, "INVALID"), result.errors.join("; "));
    }

    // The frozen registry itself must never ship a caller-supplied derived input.
    const clean = frozen();
    for (const metricId of ["M10", "M20"]) {
      for (const vector of metricOf(clean, metricId).canonical_vectors) {
        for (const field of [
          "selected_regret",
          "maximum_regret",
          "distance_to_frontier",
          "maximum_distance"
        ]) {
          assert.equal(
            Object.hasOwn(vector.inputs, field),
            false,
            `${vector.vector_id} ships caller-supplied ${field}`
          );
        }
      }
    }
  });

  // Regression for the adversarial finding that 25 contract-violating registries all
  // shipped green. Every entry below is a real contract violation, not a typo; each
  // must be refused by the validator, not merely by a reader.
  test("frozen-contract-tamper-resistance", () => {
    const tampers: [string, (registry: any) => void, string][] = [
      ["formula rewritten", (r) => { metricOf(r, "M01").per_opportunity_formula = "s = satisfied / (goal_clauses + 1)"; }, "FORMULA"],
      ["M11 denominator 5", (r) => { metricOf(r, "M11").denominator = "5"; }, "DENOMINATOR"],
      ["minimum_opportunities zeroed", (r) => { for (const m of r.metrics) m.minimum_opportunities = 0; }, "MINIMUM_OPPORTUNITIES_MISMATCH"],
      ["precedence reversed", (r) => { metricOf(r, "M01").evidence_precedence = [...metricOf(r, "M01").evidence_precedence].reverse(); }, "EVIDENCE_PRECEDENCE_MISMATCH"],
      ["operator claim trusted", (r) => { metricOf(r, "M01").confidence.operator_claim = 1; }, "CONFIDENCE_MISMATCH"],
      ["not_observed floor removed", (r) => { metricOf(r, "M01").confidence.not_observed_below = 0; }, "CONFIDENCE_MISMATCH"],
      ["routes swapped", (r) => { const a = metricOf(r, "M01"); const b = metricOf(r, "M12"); const t = a.consumer_routes; a.consumer_routes = b.consumer_routes; b.consumer_routes = t; }, "CONSUMER_ROUTES_MISMATCH"],
      ["M15 routed to the safety gate", (r) => { metricOf(r, "M15").consumer_routes = ["factor.F5", "outcome_index.O", "safety_gate.M19"]; }, "CONSUMER_ROUTES_MISMATCH"],
      ["M19 averaged into the process index", (r) => { metricOf(r, "M19").aggregation = "opportunity_weighted_mean"; }, "AGGREGATION_MISMATCH"],
      ["M19 treated as process", (r) => { metricOf(r, "M19").treatment = "process_index"; }, "TREATMENT_MISMATCH"],
      ["factor reassigned", (r) => { metricOf(r, "M05").factor = "F1"; }, "FACTOR_MISMATCH"],
      ["registry-level learned weights", (r) => { r.learned_weights = { M01: 0.4 }; }, "REGISTRY_DEAD_FIELD"],
      ["hidden oracle answer leaked into inputs", (r) => { vectorOf(r, "M01", "M01-v1-pass").inputs.hidden_oracle_answer = "leaked"; }, "VECTOR_INPUTS_INVALID"],
      ["grader discretion added to expected", (r) => { vectorOf(r, "M01", "M01-v1-pass").expected.grader_discretion = "reviewer call"; }, "VECTOR_DEAD_FIELD"],
      ["NOT_OBSERVED vector carries a payload", (r) => { vectorOf(r, "M01", "M01-v1-no").expected.grader_output = { satisfied: 2, total: 2 }; }, "NOT_OBSERVED"],
      ["rational not in lowest terms", (r) => { vectorOf(r, "M01", "M01-v1-partial").expected.raw_value = { n: 2, d: 4 }; }, "RATIONAL_NOT_CANONICAL"],
      ["rational with negative denominator", (r) => { vectorOf(r, "M01", "M01-v1-partial").expected.raw_value = { n: -1, d: -2 }; }, "RATIONAL_NOT_CANONICAL"],
      ["pass vector made vacuous", (r) => { const v = vectorOf(r, "M05", "M05-v1-pass"); v.inputs = { eligible: true, TP: 0, FP: 0, FN: 0 }; v.expected.grader_output = { TP: 0, FP: 0, FN: 0 }; }, "VECTOR_NOT_REPRESENTATIVE"],
      ["M03 precision falsified", (r) => { vectorOf(r, "M03", "M03-v1-partial").expected.grader_output.P = ratio(1, 1); }, "GRADER_OUTPUT_MISMATCH"],
      ["M03 recall falsified", (r) => { vectorOf(r, "M03", "M03-v1-fail").expected.grader_output.R = ratio(1, 1); }, "GRADER_OUTPUT_MISMATCH"],
      ["M10 derived regret falsified in grader output", (r) => { vectorOf(r, "M10", "M10-v1-partial").expected.grader_output.selected_regret = 0; }, "GRADER_OUTPUT_MISMATCH"],
      ["M20 candidate cost vector falsified", (r) => { vectorOf(r, "M20", "M20-v1-partial").expected.grader_output.candidate_cost_vector = { time: 0, tokens: 0, calls: 0, human_minutes: 0 }; }, "GRADER_OUTPUT_MISMATCH"],
      ["grader output shape replaced", (r) => { vectorOf(r, "M04", "M04-v1-partial").expected.grader_output = { linked: 1, total: 2 }; }, "GRADER_OUTPUT_SHAPE"],
      ["grader output dropped", (r) => { delete vectorOf(r, "M04", "M04-v1-partial").expected.grader_output; }, "GRADER_OUTPUT_MISSING"],
      ["shortfall list emptied", (r) => { vectorOf(r, "M04", "M04-v1-partial").expected.grader_output.missing_acceptance_ids = []; }, "GRADER_OUTPUT_MISMATCH"],
      ["metric version drifted", (r) => { metricOf(r, "M02").version = "metric-scoring-contract-v2"; }, "METRIC_VERSION_MISMATCH"],
      ["cap raised", (r) => { metricOf(r, "M02").cap = 2; }, "CAP_NOT_ONE"],
      ["registry contract version drifted", (r) => { r.contract_version = "metric-scoring-contract-v2"; }, "REGISTRY_CONTRACT_VERSION"],
      ["consumer set removed", (r) => { r.consumers = []; }, "REGISTRY_CONSUMERS_MISSING"],
      ["metric order shuffled", (r) => { const [a, b] = [r.metrics[3], r.metrics[4]]; r.metrics[3] = b; r.metrics[4] = a; }, "METRIC_ORDER_BROKEN"],
      ["vector set truncated", (r) => { metricOf(r, "M02").canonical_vectors.pop(); }, "VECTOR_SET_INVALID"],
      ["NOT_OBSERVED relabelled SCORED", (r) => { vectorOf(r, "M02", "M02-v1-no").expected.state = "SCORED"; }, "VECTOR_"],
      ["eligibility flag dropped", (r) => { delete vectorOf(r, "M02", "M02-v1-pass").inputs.eligible; }, "VECTOR_"],
      ["unknown safety state", (r) => { const v = vectorOf(r, "M19", "M19-v1-pass"); v.inputs.worst_state = "S9"; }, "UNKNOWN_SAFETY_STATE"],
      ["frontier maximum falsified", (r) => { r.frontiers["M20-frontier-v1"].maximum_distance = 4; }, "FRONTIER_MAXIMUM_MISMATCH"],
      ["numerator key renamed", (r) => { const m = metricOf(r, "M01"); m.observation_key = "total"; }, "VECTOR_INPUTS_INVALID"]
    ];

    for (const [label, tamper, expectedCode] of tampers) {
      const registry = frozen();
      tamper(registry);
      const result = validateMetricRegistry(registry);
      assert.equal(result.ok, false, `accepted a tampered registry: ${label}`);
      assert.ok(
        result.errors.some((entry) => entry.includes(expectedCode)),
        `${label} produced ${result.errors.join("; ") || "no error"} and not ${expectedCode}`
      );
    }
  });

  // Contract L79 mandates normalized_value = clamp(raw_value, 0, 1). No canonical vector
  // sits outside [0,1], so the clamp is only reachable through a tampered raw value.
  test("normalization-clamps-outside-the-unit-interval", () => {
    const above = frozen();
    const high = vectorOf(above, "M01", "M01-v1-pass");
    high.inputs = { eligible: true, satisfied: 3, denominator: 2 };
    high.expected.raw_value = ratio(3, 2);
    high.expected.normalized_value = ratio(3, 2);
    high.expected.grader_output = { satisfied: 3, total: 2 };
    const result = validateMetricRegistry(above);
    assert.equal(result.ok, false, "a normalized value above 1 was accepted");
    assert.ok(
      has(result, "VECTOR_VALUE_MISMATCH M01-v1-pass normalized_value must be 1/1"),
      result.errors.join("; ")
    );

    const clamped = frozen();
    const ok = vectorOf(clamped, "M01", "M01-v1-pass");
    ok.inputs = { eligible: true, satisfied: 3, denominator: 2 };
    ok.expected.raw_value = ratio(3, 2);
    ok.expected.normalized_value = ratio(1, 1);
    ok.expected.grader_output = { satisfied: 3, total: 2 };
    assert.deepEqual(
      validateMetricRegistry(clamped).errors,
      ["VECTOR_NOT_REPRESENTATIVE M01-v1-pass does not exercise its pass case"],
      "clamped normalization must raise no value mismatch"
    );
  });
});
