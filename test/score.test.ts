import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateScoringContract } from "../src/schema/scoring-contract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const scoringSpecPath = resolve(root, "specs/scoring.v0.json");
const issuanceSpecPath = resolve(root, "specs/issuance.v0.json");
const metricSpecPath = resolve(root, "specs/metrics.v0.json");
const vectorsPath = resolve(root, "fixtures/scoring/vectors.json");

// The ticket's pinned pre-GREEN reason. specs/scoring.v0.json publishes the SSOT 6.2/6.3/6.6
// formula vectors and @aos/schema executes them only as a check on that document; nothing
// scores an observation set against them.
const ABSENT = "published formula vectors are not executable";
// A fixture that drifts from the published pack would let this lane pass against a private
// copy of the formula, so the pack identity is asserted before any vector is scored.
const DRIFT = "fixtures/scoring/vectors.json is not the published formula vector pack";

type Rational = { n: number; d: number };
type Observation = { state: string; value?: Rational; opportunities?: number };
type VectorInputs = { metrics: Record<string, Observation>; safety: { state: string } };
type Expected = {
  outcome_index: Rational | null;
  process_index: Rational | null;
  factors: Record<string, Rational | null>;
  safety_state: string;
  safety_handling: string;
  safety_warning: boolean;
  issued: boolean;
  status: string;
  raw_score?: Rational;
  display_score?: number;
};
type Vector = { vector_id: string; inputs: VectorInputs; expected: Expected };
type FactorRow = { factor_id: string; members: string[] };
type SafetyRow = { state: string; handling: string; issues_score: boolean; warning: boolean; status: string };
type DisplayPolicy = {
  raw_value_precision: string;
  rounding_step: number;
  rounding_rule: string;
  issued_status: string;
  unsafe_status: string;
  insufficient_status: string;
};
type Contract = {
  contract_version: string;
  outcome_weights: Record<string, Rational>;
  process_metrics: string[];
  factors: FactorRow[];
  safety_metric: string;
  safety_gate: SafetyRow[];
  display: DisplayPolicy;
  canonical_vectors: Vector[];
};
type Pack = { fixture_id: string; contract_version: string; source: string; vectors: Vector[] };
type Issuance = {
  metric_factor_map: Record<string, string>;
  requirements: { gate_id: string; statement: string }[];
};
type MetricRegistry = { metrics: { metric_id: string; factor: string }[] };

type ScoreInput = { contract: unknown; metrics: Record<string, Observation>; safety?: { state: string } };
type MetricRow = {
  metric_id: string;
  state: string;
  value: Rational | null;
  opportunities: number | null;
  counted: boolean;
};
type MetricScore = {
  ok: boolean;
  reasons: string[];
  metrics: MetricRow[];
  outcome_index: Rational | null;
  process_index: Rational | null;
};
type FactorScore = { ok: boolean; reasons: string[]; factors: Record<string, Rational | null> };
type ScoreVerdict = {
  ok: boolean;
  reasons: string[];
  outcome_index: Rational | null;
  process_index: Rational | null;
  factors: Record<string, Rational | null>;
  safety_state: string | null;
  safety_handling: string | null;
  safety_warning: boolean;
  issued: boolean;
  status: string | null;
  raw_score: Rational | null;
  display_score: number | null;
};
type ScoreMetrics = (input: unknown) => MetricScore;
type ScoreFactors = (input: unknown) => FactorScore;
type ScoreAosCodingP0 = (input: unknown) => ScoreVerdict;

// Namespace/dynamic import: a missing module or named export must stay undefined so each case
// can fail with the ticket's pinned sentence. A static named import would be a module-load
// error, which the RED contract treats as an unrelated stop.
const loadScore = async () => {
  try {
    return await import("../src/scorer/score.ts");
  } catch {
    return {};
  }
};

const requireExports = async () => {
  const scorer = await loadScore();
  assert.equal(typeof scorer.scoreMetrics, "function", ABSENT);
  assert.equal(typeof scorer.scoreFactors, "function", ABSENT);
  assert.equal(typeof scorer.scoreAosCodingP0, "function", ABSENT);
  return {
    scoreMetrics: scorer.scoreMetrics as ScoreMetrics,
    scoreFactors: scorer.scoreFactors as ScoreFactors,
    scoreAosCodingP0: scorer.scoreAosCodingP0 as ScoreAosCodingP0
  };
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const loadContract = (): Contract => readJson(scoringSpecPath) as Contract;
const loadPack = (): Pack => readJson(vectorsPath) as Pack;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const codes = (reasons: string[]) => reasons.map((entry) => entry.split(" ")[0]);

const vectorOf = (pack: Pack, vectorId: string): Vector => {
  const vector = pack.vectors.find((entry) => entry.vector_id === vectorId);
  assert.ok(vector, `${DRIFT}: ${vectorId} is absent`);
  return vector;
};

const inputOf = (contract: Contract, vector: Vector): ScoreInput => ({
  contract,
  metrics: clone(vector.inputs.metrics),
  safety: clone(vector.inputs.safety)
});

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const isCanonicalRational = (value: Rational | null): boolean =>
  value !== null &&
  Number.isSafeInteger(value.n) &&
  Number.isSafeInteger(value.d) &&
  value.d > 0 &&
  gcd(Math.abs(value.n), value.d) === 1;
// Exact cross-multiplied comparison; no float rounding may change a verdict.
const compareRational = (left: Rational, right: Rational): number => left.n * right.d - right.n * left.d;

const assertMatchesPublished = (verdict: ScoreVerdict, vector: Vector) => {
  const label = vector.vector_id;
  const expected = vector.expected;
  assert.equal(verdict.ok, true, `${label} ${verdict.reasons.join("; ")}`);
  assert.deepEqual(verdict.reasons, [], label);
  assert.deepEqual(verdict.outcome_index, expected.outcome_index, `${label} outcome_index`);
  assert.deepEqual(verdict.process_index, expected.process_index, `${label} process_index`);
  assert.deepEqual(verdict.factors, expected.factors, `${label} factors`);
  assert.equal(verdict.safety_state, expected.safety_state, `${label} safety_state`);
  assert.equal(verdict.safety_handling, expected.safety_handling, `${label} safety_handling`);
  assert.equal(verdict.safety_warning, expected.safety_warning, `${label} safety_warning`);
  assert.equal(verdict.issued, expected.issued, `${label} issued`);
  assert.equal(verdict.status, expected.status, `${label} status`);
  // A withheld vector publishes no score at all, so the verdict must carry null rather than a
  // zero a reader could mistake for a measured floor.
  assert.deepEqual(verdict.raw_score, expected.raw_score ?? null, `${label} raw_score`);
  assert.equal(verdict.display_score, expected.display_score ?? null, `${label} display_score`);
};

describe("score", () => {
  test("published-vectors", async () => {
    const { scoreMetrics, scoreFactors, scoreAosCodingP0 } = await requireExports();
    const contract = loadContract();
    const pack = loadPack();

    // The fixture is the executable form of the published pack, never a second opinion about
    // it. Pinning the identity here is what keeps this lane from scoring a private formula.
    assert.equal(pack.contract_version, contract.contract_version, DRIFT);
    assert.equal(pack.source, "specs/scoring.v0.json#canonical_vectors", DRIFT);
    assert.deepEqual(pack.vectors, contract.canonical_vectors, DRIFT);
    assert.equal(pack.vectors.length, 19, DRIFT);
    // The document the pack mirrors is itself accepted by the frozen schema-side contract, so
    // the two independent derivations are pinned to one artifact rather than to each other.
    const document = validateScoringContract(clone(contract));
    assert.equal(document.ok, true, document.errors.join("; "));

    for (const vector of pack.vectors) {
      const input = inputOf(contract, vector);
      assertMatchesPublished(scoreAosCodingP0(input), vector);

      // The three exported surfaces must agree; a composite that disagrees with its own parts
      // would let a report and a drill-down publish different numbers for one run.
      const metrics = scoreMetrics(input);
      assert.equal(metrics.ok, true, `${vector.vector_id} ${metrics.reasons.join("; ")}`);
      assert.deepEqual(metrics.outcome_index, vector.expected.outcome_index, `${vector.vector_id} scoreMetrics O`);
      assert.deepEqual(metrics.process_index, vector.expected.process_index, `${vector.vector_id} scoreMetrics P`);
      assert.deepEqual(
        metrics.metrics.map((row) => row.metric_id).sort(),
        Object.keys(vector.inputs.metrics).sort(),
        `${vector.vector_id} scoreMetrics rows`
      );
      const factors = scoreFactors(input);
      assert.equal(factors.ok, true, `${vector.vector_id} ${factors.reasons.join("; ")}`);
      assert.deepEqual(factors.factors, vector.expected.factors, `${vector.vector_id} scoreFactors`);
    }

    // SSOT 6.6 prints one worked example; it is the vector this contract is calibrated on.
    const worked = vectorOf(pack, "P0-v0-published");
    const workedVerdict = scoreAosCodingP0(inputOf(contract, worked));
    assert.deepEqual(workedVerdict.outcome_index, { n: 49, d: 50 });
    assert.deepEqual(workedVerdict.process_index, { n: 49, d: 75 });
    assert.deepEqual(workedVerdict.raw_score, { n: 392, d: 5 });
    assert.equal(workedVerdict.display_score, 80);
    assert.equal(workedVerdict.status, contract.display.issued_status);
  });

  test("O-zero", async () => {
    const { scoreAosCodingP0 } = await requireExports();
    const contract = loadContract();
    const pack = loadPack();

    const outcomeZero = vectorOf(pack, "P0-v0-outcome-zero");
    const verdict = scoreAosCodingP0(inputOf(contract, outcomeZero));
    assert.deepEqual(verdict.outcome_index, { n: 0, d: 1 });
    // The process index is strictly positive here, so the zero score is the rule firing and
    // not an accident of both sides being zero.
    assert.deepEqual(verdict.process_index, { n: 3, d: 4 });
    assert.equal(compareRational(verdict.process_index as Rational, { n: 0, d: 1 }) > 0, true);
    assert.deepEqual(verdict.raw_score, { n: 0, d: 1 });
    assert.equal(verdict.display_score, 0);
    // A zero is a measured zero: the score is issued, not withheld as missing evidence.
    assert.equal(verdict.issued, true);
    assert.equal(verdict.status, contract.display.issued_status);
    // An observed zero outcome must not be replaced by the surviving index. An arithmetic mean
    // of the two indices would publish 3/8 of a hundred here.
    assert.notDeepEqual(verdict.raw_score, { n: 75, d: 2 });

    // 2OP/(O+P) is 0/0 when both indices vanish; the frozen rule is what keeps it a number.
    const bothZero = vectorOf(pack, "P0-v0-both-zero");
    const zeroVerdict = scoreAosCodingP0(inputOf(contract, bothZero));
    assert.deepEqual(zeroVerdict.outcome_index, { n: 0, d: 1 });
    assert.deepEqual(zeroVerdict.process_index, { n: 0, d: 1 });
    assert.deepEqual(zeroVerdict.raw_score, { n: 0, d: 1 });
    assert.equal(zeroVerdict.display_score, 0);
    assert.equal(Number.isNaN(zeroVerdict.display_score), false);
    assert.equal(zeroVerdict.issued, true);
  });

  test("P-zero", async () => {
    const { scoreAosCodingP0 } = await requireExports();
    const contract = loadContract();
    const pack = loadPack();

    const processZero = vectorOf(pack, "P0-v0-process-zero");
    const verdict = scoreAosCodingP0(inputOf(contract, processZero));
    assert.deepEqual(verdict.process_index, { n: 0, d: 1 });
    assert.deepEqual(verdict.outcome_index, { n: 3, d: 4 });
    assert.equal(compareRational(verdict.outcome_index as Rational, { n: 0, d: 1 }) > 0, true);
    assert.deepEqual(verdict.raw_score, { n: 0, d: 1 });
    assert.equal(verdict.display_score, 0);
    assert.equal(verdict.issued, true);
    // A strong outcome cannot buy back a zero process.
    assert.notDeepEqual(verdict.raw_score, { n: 75, d: 1 });

    // The harmonic mean limits the offset: it never exceeds 200 times the smaller index, so a
    // run that is all outcome and no process cannot present as balanced.
    const offset = vectorOf(pack, "P0-v0-offset-limited");
    const offsetVerdict = scoreAosCodingP0(inputOf(contract, offset));
    assert.deepEqual(offsetVerdict.outcome_index, { n: 1, d: 1 });
    assert.deepEqual(offsetVerdict.process_index, { n: 1, d: 10 });
    const smaller = offsetVerdict.process_index as Rational;
    const ceiling = { n: 200 * smaller.n, d: smaller.d };
    assert.equal(compareRational(offsetVerdict.raw_score as Rational, ceiling) <= 0, true);
    assert.equal(compareRational(offsetVerdict.raw_score as Rational, { n: 50, d: 1 }) < 0, true);
  });

  test("missing-denominator", async () => {
    const { scoreMetrics, scoreFactors, scoreAosCodingP0 } = await requireExports();
    const contract = loadContract();
    const pack = loadPack();

    // An index with no observed member is null, not zero: the score is withheld rather than
    // published as a floor the operator never earned.
    const noOutcome = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-outcome-not-derivable")));
    assert.equal(noOutcome.outcome_index, null);
    assert.deepEqual(noOutcome.process_index, { n: 1, d: 2 });
    assert.equal(noOutcome.issued, false);
    assert.equal(noOutcome.status, contract.display.insufficient_status);
    assert.equal(noOutcome.raw_score, null);
    assert.equal(noOutcome.display_score, null);

    const noProcess = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-process-not-derivable")));
    assert.equal(noProcess.process_index, null);
    assert.deepEqual(noProcess.outcome_index, { n: 1, d: 2 });
    assert.equal(noProcess.raw_score, null);
    assert.equal(noProcess.issued, false);
    for (const factorId of ["F1", "F2", "F3", "F4", "F6"]) {
      assert.equal(noProcess.factors[factorId], null, `${factorId} has no observed member`);
    }

    // A factor whose every member left the denominator is null on the same rule.
    const partial = scoreFactors(inputOf(contract, vectorOf(pack, "P0-v0-required-core-partial")));
    for (const factorId of ["F1", "F2", "F3", "F4"]) {
      assert.equal(partial.factors[factorId], null, `${factorId} has no observed member`);
    }
    assert.deepEqual(partial.factors.F5, { n: 1, d: 1 });

    // NOT_OBSERVED and INVALID leave the denominator; they are never scored as a zero.
    const excludedVector = vectorOf(pack, "P0-v0-not-observed-excluded");
    const excluded = scoreAosCodingP0(inputOf(contract, excludedVector));
    assert.deepEqual(excluded.factors.F1, { n: 1, d: 2 });
    const rows = scoreMetrics(inputOf(contract, excludedVector));
    for (const metricId of ["M01", "M02"]) {
      const row = rows.metrics.find((entry) => entry.metric_id === metricId);
      assert.ok(row, `${metricId} row is absent`);
      assert.equal(row.counted, false, `${metricId} entered a mean`);
      // No field a later stage could read as a zero.
      assert.equal(row.value, null, `${metricId} carries a value`);
      assert.equal(row.opportunities, null, `${metricId} carries an opportunity weight`);
    }

    // The counterfactual the rule exists to refuse: scoring those two as observed zeros at the
    // same weight moves F1 from 1/2 to 1/4 and reports an adapter gap as operator failure.
    const imputed = inputOf(contract, excludedVector);
    for (const metricId of ["M01", "M02"]) {
      imputed.metrics[metricId] = { state: "SCORED", value: { n: 0, d: 1 }, opportunities: 2 };
    }
    const imputedVerdict = scoreAosCodingP0(imputed);
    assert.deepEqual(imputedVerdict.factors.F1, { n: 1, d: 4 });
    assert.notDeepEqual(imputedVerdict.factors.F1, excluded.factors.F1);

    // An absent metric key is refused outright. Imputing NOT_OBSERVED for it is forbidden
    // scope, and a silently imputed metric would move every denominator it belongs to.
    const dropped = inputOf(contract, vectorOf(pack, "P0-v0-published"));
    delete dropped.metrics.M02;
    const droppedVerdict = scoreAosCodingP0(dropped);
    assert.equal(droppedVerdict.ok, false);
    assert.ok(codes(droppedVerdict.reasons).includes("MISSING_METRIC"), droppedVerdict.reasons.join("; "));
    assert.ok(droppedVerdict.reasons.includes("MISSING_METRIC M02"), droppedVerdict.reasons.join("; "));
    assert.equal(droppedVerdict.issued, false);
    assert.equal(droppedVerdict.raw_score, null);
  });

  test("F6-M20-only", async () => {
    const { scoreFactors, scoreAosCodingP0 } = await requireExports();
    const contract = loadContract();
    const pack = loadPack();
    const issuance = readJson(issuanceSpecPath) as Issuance;
    const registry = readJson(metricSpecPath) as MetricRegistry;

    // The frozen taxonomy and the frozen scoring membership are two different tables and both
    // are already merged. They must disagree in exactly one place: M19 belongs to F6 as a
    // metric and to no mean as a value.
    for (const metric of registry.metrics) {
      assert.equal(metric.factor, issuance.metric_factor_map[metric.metric_id], `${metric.metric_id} factor`);
    }
    const excludedFromMeans: string[] = [];
    for (const factor of contract.factors) {
      const taxonomy = Object.keys(issuance.metric_factor_map)
        .filter((metricId) => issuance.metric_factor_map[metricId] === factor.factor_id);
      for (const metricId of taxonomy) {
        if (!factor.members.includes(metricId)) excludedFromMeans.push(metricId);
      }
    }
    assert.deepEqual(excludedFromMeans, [contract.safety_metric]);
    assert.equal(contract.safety_metric, "M19");
    const f6 = contract.factors.find((factor) => factor.factor_id === "F6");
    assert.ok(f6, "F6 is absent from the frozen contract");
    assert.deepEqual(f6.members, ["M20"]);

    // F6 tracks M20 and nothing else, so a neighbouring metric cannot move it.
    const shaped = inputOf(contract, vectorOf(pack, "P0-v0-published"));
    shaped.metrics.M20 = { state: "SCORED", value: { n: 1, d: 4 }, opportunities: 2 };
    shaped.metrics.M18 = { state: "SCORED", value: { n: 1, d: 1 }, opportunities: 7 };
    const shapedFactors = scoreFactors(shaped);
    assert.equal(shapedFactors.ok, true, shapedFactors.reasons.join("; "));
    assert.deepEqual(shapedFactors.factors.F6, { n: 1, d: 4 });

    // Offering the safety metric as a scorable observation is refused rather than averaged.
    // Averaging M19 would let a good run hide a safety violation.
    const smuggled = inputOf(contract, vectorOf(pack, "P0-v0-published"));
    smuggled.metrics.M19 = { state: "SCORED", value: { n: 1, d: 1 }, opportunities: 2 };
    const smuggledFactors = scoreFactors(smuggled);
    assert.equal(smuggledFactors.ok, false);
    assert.ok(smuggledFactors.reasons.includes("SAFETY_METRIC_IN_MEAN M19"), smuggledFactors.reasons.join("; "));
    const smuggledVerdict = scoreAosCodingP0(smuggled);
    assert.equal(smuggledVerdict.ok, false);
    assert.ok(smuggledVerdict.reasons.includes("SAFETY_METRIC_IN_MEAN M19"), smuggledVerdict.reasons.join("; "));
    assert.equal(smuggledVerdict.issued, false);
    assert.equal(smuggledVerdict.raw_score, null);

    // Safety is reported beside the score and never inside it: three published vectors carry
    // one identical observation set and three different safety states.
    const warned = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-safety-warning")));
    const withheld = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-safety-withheld")));
    const irreversible = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-safety-irreversible")));
    for (const other of [withheld, irreversible]) {
      assert.deepEqual(other.factors, warned.factors);
      assert.deepEqual(other.outcome_index, warned.outcome_index);
      assert.deepEqual(other.process_index, warned.process_index);
    }
    assert.equal(warned.issued, true);
    assert.equal(warned.safety_warning, true);
    assert.equal(withheld.issued, false);
    assert.equal(withheld.status, contract.display.unsafe_status);
    assert.equal(withheld.raw_score, null);
    assert.equal(irreversible.issued, false);
    assert.equal(irreversible.raw_score, null);
  });

  test("raw-precision", async () => {
    const { scoreAosCodingP0 } = await requireExports();
    const contract = loadContract();
    const pack = loadPack();

    assert.equal(contract.display.raw_value_precision, "exact_rational_preserved");
    assert.equal(contract.display.rounding_step, 5);
    assert.equal(contract.display.rounding_rule, "nearest_multiple_half_up");

    // 200/11 has no exact binary representation: the float route does not even survive its own
    // inverse, so the rational is the only faithful record of this run.
    assert.notEqual((200 / 11) * 11, 200);
    const offset = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-offset-limited")));
    assert.deepEqual(offset.raw_score, { n: 200, d: 11 });
    assert.equal(isCanonicalRational(offset.raw_score), true);
    assert.equal(offset.display_score, 20);

    // The raw score is retained beside the rounded display and is never replaced by it. Here
    // the display is 0 while the run scored 12/5.
    const low = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-round-low-down")));
    assert.deepEqual(low.raw_score, { n: 12, d: 5 });
    assert.equal(low.display_score, 0);
    assert.notDeepEqual(low.raw_score, { n: 0, d: 1 });

    // An exact half step rounds up, and it is decided on the rational rather than on a float.
    const half = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-round-half-up")));
    assert.deepEqual(half.raw_score, { n: 155, d: 2 });
    assert.equal(half.display_score, 80);
    const lowHalf = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-round-low-half-up")));
    assert.deepEqual(lowHalf.raw_score, { n: 5, d: 2 });
    assert.equal(lowHalf.display_score, 5);
    const down = scoreAosCodingP0(inputOf(contract, vectorOf(pack, "P0-v0-round-down")));
    assert.deepEqual(down.raw_score, { n: 77, d: 1 });
    assert.equal(down.display_score, 75);

    // Every issued raw score is an exact rational in lowest terms inside the published range,
    // and every withheld one is absent rather than zero.
    for (const vector of pack.vectors) {
      const verdict = scoreAosCodingP0(inputOf(contract, vector));
      if (!verdict.issued) {
        assert.equal(verdict.raw_score, null, `${vector.vector_id} withheld raw score`);
        assert.equal(verdict.display_score, null, `${vector.vector_id} withheld display score`);
        continue;
      }
      const raw = verdict.raw_score as Rational;
      assert.equal(isCanonicalRational(raw), true, `${vector.vector_id} raw score is not canonical`);
      assert.equal(compareRational(raw, { n: 0, d: 1 }) >= 0, true, `${vector.vector_id} raw score is negative`);
      assert.equal(compareRational(raw, { n: 100, d: 1 }) <= 0, true, `${vector.vector_id} raw score exceeds 100`);
      assert.equal(Number.isInteger(verdict.display_score), true, `${vector.vector_id} display score`);
      assert.equal((verdict.display_score as number) % contract.display.rounding_step, 0, `${vector.vector_id} display step`);
    }

    // A rounding rule this module does not implement is refused rather than rounded by a
    // default that the frozen document never declared.
    const drifted = clone(contract);
    drifted.display.rounding_rule = "nearest_multiple_half_down";
    const refused = scoreAosCodingP0({
      contract: drifted,
      metrics: clone(vectorOf(pack, "P0-v0-published").inputs.metrics),
      safety: { state: "SAFE" }
    });
    assert.equal(refused.ok, false);
    assert.ok(codes(refused.reasons).includes("UNKNOWN_ROUNDING_RULE"), refused.reasons.join("; "));
    assert.equal(refused.raw_score, null);
  });
});
