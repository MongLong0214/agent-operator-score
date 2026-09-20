import assert from "node:assert/strict";
import test from "node:test";

import {
  DIMENSIONS,
  METRICS,
  METRIC_CONTRACT_V1,
  METRIC_IDS,
  NOT_OBSERVED,
  SUBCHECKS_PER_METRIC,
  coverageOf,
  dimensionScore,
  metricsOf,
  observationOf,
  validateObservations
} from "../../lib/metrics.mjs";

const full = (id, passing) =>
  observationOf({
    metric_id: id,
    verifier_id: "test.v1",
    subchecks: METRICS[id].subchecks.map((subcheck, index) => ({ id: subcheck, pass: index < passing })),
    evidence_ids: ["event-1"],
    reason: `${passing} of four`
  });

test("the contract is twenty metrics, six dimensions, four subchecks each", () => {
  assert.equal(METRIC_IDS.length, 20);
  assert.equal(Object.keys(DIMENSIONS).length, 6);
  for (const id of METRIC_IDS) {
    assert.equal(METRICS[id].subchecks.length, SUBCHECKS_PER_METRIC, id);
    assert.equal(new Set(METRICS[id].subchecks).size, SUBCHECKS_PER_METRIC, `${id} repeats a subcheck`);
    assert.equal(Object.hasOwn(DIMENSIONS, METRICS[id].dimension), true, id);
  }
  assert.equal(METRIC_IDS.reduce((total, id) => total + (metricsOf(METRICS[id].dimension).includes(id) ? 1 : 0), 0), 20);
});

test("the dimension weights are a whole", () => {
  // A set that does not sum to one silently rescales every score, and nothing in the output would
  // say so.
  const total = Object.values(DIMENSIONS).reduce((sum, dimension) => sum + dimension.weight, 0);
  assert.equal(Math.round(total * 1000) / 1000, 1);
});

test("a value is how many of the four questions were answered yes", () => {
  assert.deepEqual([full("M15", 4).state, full("M15", 4).value], ["PASS", 1]);
  assert.deepEqual([full("M15", 3).state, full("M15", 3).value], ["PARTIAL_HIGH", 0.75]);
  assert.deepEqual([full("M15", 2).state, full("M15", 2).value], ["PARTIAL", 0.5]);
  assert.deepEqual([full("M15", 1).state, full("M15", 1).value], ["PARTIAL_LOW", 0.25]);
  assert.deepEqual([full("M15", 0).state, full("M15", 0).value], ["FAIL", 0]);
});

test("not observed is null, and never a zero", () => {
  // Every place that treats it as a zero turns "we did not look" into "they failed".
  const absent = observationOf({ metric_id: "M11" });
  assert.equal(absent.state, NOT_OBSERVED);
  assert.equal(absent.value, null);
  assert.deepEqual(absent.subchecks, []);
  assert.notEqual(absent.value, 0);
});

test("a metric that answered none of its four questions is not observed, not a zero", () => {
  // The mirror of the test above, and the one that was missing. `subchecks: null` was the only way
  // to reach NOT_OBSERVED, so a verifier that asked all four questions and could answer none rolled
  // up through `STATE_BY_PASSING[0]` to FAIL with a value of 0 -- counted as an observed metric and
  // averaged into its dimension as a nought. Until #558 no metric could produce four nulls, so the
  // rule stated twice in `lib/metrics.mjs` was true by accident rather than by construction; M09's
  // oracle can decline all four, and this fixes it at the layer that turns subchecks into a state
  // rather than at the one call site that reaches it today.
  const none = observationOf({
    metric_id: "M09",
    verifier_id: "aos-route-oracle.v2",
    subchecks: METRICS.M09.subchecks.map((id) => ({ id, pass: null })),
    evidence_ids: ["route-oracle-1"],
    reason: "the oracle answered none of its four questions"
  });
  assert.equal(none.state, NOT_OBSERVED);
  assert.equal(none.value, null);
  assert.notEqual(none.value, 0);
  // The four nulls are kept, unlike the `subchecks: null` route above: which verifier looked, on
  // what evidence, and which questions it could not answer are all worth more than an empty array,
  // and `opportunitiesOf` builds one opportunity per declared subcheck either way.
  assert.deepEqual(none.subchecks.map((entry) => entry.pass), [null, null, null, null]);
  assert.equal(none.verifier_id, "aos-route-oracle.v2");
  assert.deepEqual(validateObservations([none]).filter((entry) => entry.metric_id === "M09"), []);

  // It leaves the dimension and the coverage count alone, which is the whole point: a row nobody
  // answered must not be the row that drags D3 to zero.
  assert.equal(dimensionScore([none], "D3"), null);
  assert.equal(coverageOf([none]).observed, 0);

  // One answered subcheck is a different thing entirely, and still scores.
  const one = observationOf({
    metric_id: "M09",
    verifier_id: "aos-route-oracle.v2",
    subchecks: METRICS.M09.subchecks.map((id, index) => ({ id, pass: index === 0 ? false : null })),
    reason: "one answer"
  });
  assert.deepEqual([one.state, one.value], ["FAIL", 0]);
});

test("a metric answered with some of its questions is refused", () => {
  // Not a partial result: a result whose author did not say what happened to the rest.
  assert.throws(
    () => observationOf({ metric_id: "M15", subchecks: [{ id: METRICS.M15.subchecks[0], pass: true }] }),
    /AOS_SUBCHECK_MISMATCH/
  );
  assert.throws(
    () => observationOf({ metric_id: "M15", subchecks: METRICS.M15.subchecks.map((id) => ({ id, pass: true })).concat({ id: "invented", pass: true }) }),
    /AOS_SUBCHECK_MISMATCH/
  );
  assert.throws(() => observationOf({ metric_id: "M99" }), /AOS_UNKNOWN_METRIC/);
});

test("only a literal true is a pass", () => {
  // A verifier that returns pass: "false" or pass: 1 is answering in a shape nobody agreed on, and
  // a truthiness test would score the string "false" as a pass.
  //
  // #558 made the unrecognised answer a refusal rather than a `false`. The property this test was
  // written for is unchanged and stronger: nothing but a literal `true` reaches a pass. What moved
  // is the other side -- rounding an answer down to `false` reported a verifier that had said
  // something nobody agreed on as the operator getting it wrong, and a `false` drives ceilings.
  const loose = (pass) => observationOf({
    metric_id: "M19",
    verifier_id: "v",
    subchecks: METRICS.M19.subchecks.map((id, index) => ({ id, pass: index === 0 ? true : pass })),
    reason: "r"
  });
  for (const pass of ["true", 1, "yes", "false", 0, {}]) {
    assert.throws(() => loose(pass), /AOS_INVALID_SUBCHECK_VERDICT M19\./u, `${JSON.stringify(pass)} was rounded instead of refused`);
  }
  // The three that are answers.
  assert.equal(loose(false).value, 0.25, "a truthy non-boolean was counted as a pass");
  assert.deepEqual(loose(false).subchecks.map((entry) => entry.pass), [true, false, false, false]);
  assert.deepEqual(loose(null).subchecks.map((entry) => entry.pass), [true, null, null, null]);
  assert.equal(loose(true).value, 1);
});

test("an observation carries who decided it and what from", () => {
  // A number whose author cannot be named cannot be checked, and two verifiers disagreeing is a
  // thing a reader has to be able to see.
  const observation = full("M16", 4);
  assert.equal(observation.verifier_id, "test.v1");
  assert.deepEqual(observation.evidence_ids, ["event-1"]);
  assert.equal(observation.reason, "4 of four");
  assert.deepEqual(observation.subchecks.map((entry) => entry.id), METRICS.M16.subchecks);
});

test("subchecks come back in the declared order whatever order they arrived in", () => {
  // A report lists them, and a list whose order depends on who assembled it is not comparable
  // between two runs.
  const reversed = observationOf({
    metric_id: "M19",
    verifier_id: "v",
    subchecks: [...METRICS.M19.subchecks].reverse().map((id, index) => ({ id, pass: index === 0 })),
    reason: "r"
  });
  assert.deepEqual(reversed.subchecks.map((entry) => entry.id), METRICS.M19.subchecks);
  assert.equal(reversed.value, 0.25);
});

test("a dimension with nothing observed is not a zero either", () => {
  // Dropping it and renormalising the remaining weights would make not measuring a dimension raise
  // the score, because the missing axis's weight lands on the axes that happened to go well. An
  // instrument whose number improves when it observes less is not measuring anything.
  const observations = [full("M01", 4), full("M02", 2), full("M03", 0), observationOf({ metric_id: "M11" })];
  assert.equal(dimensionScore(observations, "D1"), 50);
  assert.equal(dimensionScore(observations, "D4"), null);
  assert.equal(dimensionScore(observations, "D2"), null, "a dimension with no observation at all");
});

test("coverage names which dimensions are empty", () => {
  const observations = [full("M01", 4), observationOf({ metric_id: "M11" })];
  const coverage = coverageOf(observations);
  assert.equal(coverage.observed, 1);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.by_dimension.D1.observed, 1);
  assert.equal(coverage.by_dimension.D1.total, 3);
  assert.equal(coverage.unobserved_dimensions.includes("D4"), true);
  assert.equal(coverage.unobserved_dimensions.includes("D1"), false);
});

test("validation lists every problem instead of stopping at the first", () => {
  // A result is assembled from many verifiers, and one malformed observation should not stop the
  // others from being reported.
  const problems = validateObservations([
    { metric_id: "M01", dimension: "D1", state: "PASS", value: 1, subchecks: [], verifier_id: "", reason: "" },
    { metric_id: "M01", dimension: "D1", state: "PASS", value: 1, subchecks: [], verifier_id: "v", reason: "r" },
    { metric_id: "M99", dimension: "D9", state: "PASS", value: 1, subchecks: [], verifier_id: "v", reason: "r" }
  ]);
  const reasons = problems.filter((problem) => problem.metric_id === "M01").map((problem) => problem.reason);
  assert.equal(reasons.includes("does not answer all four subchecks"), true);
  assert.equal(reasons.includes("scored without naming a verifier"), true);
  assert.equal(reasons.includes("scored without a reason"), true);
  assert.equal(reasons.includes("observed more than once"), true);
  assert.equal(problems.some((problem) => problem.metric_id === "M99"), true);
  // And every metric that never appeared.
  assert.equal(problems.filter((problem) => problem.reason === "absent from the result").length, 19);
});

test("a not-observed metric carrying a value is a contradiction and is reported", () => {
  const problems = validateObservations([
    { metric_id: "M11", dimension: "D4", state: NOT_OBSERVED, value: 0, subchecks: [], verifier_id: null, reason: "" }
  ]);
  assert.equal(problems.some((problem) => problem.metric_id === "M11" && /carries a value/.test(problem.reason)), true);
});

test("the contract is a value a manifest can bind", () => {
  assert.equal(METRIC_CONTRACT_V1.contract_id, "aos-metric-contract.v1");
  assert.equal(METRIC_CONTRACT_V1.subchecks_per_metric, 4);
  assert.equal(Object.keys(METRIC_CONTRACT_V1.metrics).length, 20);
});
