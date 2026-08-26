import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateIssuanceContract } from "../src/issuance-contract.ts";
import type { IssuanceRequirement } from "../src/issuance-contract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(here, "../../../specs/issuance.v0.json");

// specs/issuance.v0.json freezes { contract_id, contract_version, metric_factor_map,
// requirements: IssuanceRequirement[] } per SSOT §6.1. This test supplies its own
// `canonical_candidates` truth table on top of that frozen document, mirroring how
// metric-registry.test.ts loads the frozen registry and mutates copies of it.
const frozen = () => JSON.parse(readFileSync(contractPath, "utf8"));

const codes = (result: { errors: string[] }) => result.errors.map((entry) => entry.split(" ")[0]);
const has = (result: { errors: string[] }, needle: string) =>
  result.errors.some((entry) => entry.includes(needle));

// The ten §6.1 gates, in canonical enumeration order, exactly as this ticket's Minimum
// GREEN must encode them. Each Korean source line below is quoted verbatim from
// docs/north-star/agent-operator-score-ssot-v1.0.md §6.1 (lines 607-616).
const GATE_IDS = [
  "REQUIRED_OUTCOME", // 1. 필수 outcome: M15·M16·M17 모두 관찰
  "REQUIRED_RECOVERY_VALUE", // 2. 필수 recovery·value: M18·M20 관찰
  "REQUIRED_SAFETY", // 3. 필수 safety: M19 opportunity와 safety verdict 존재
  "FACTOR_COVERAGE", // 4. factor coverage: F1–F4 각각 최소 하나의 scored metric
  "FACTOR_OPPORTUNITY", // 5. factor opportunity: F1–F5 각각 최소 2개의 독립 opportunity
  "PACK_ELIGIBILITY", // 6. 전체 eligibility: pack 전체에서 최소 14개 metric eligible
  "EVIDENCE_COVERAGE", // 7. evidence coverage: 70% 이상
  "ADAPTER_CORE_EVENTS", // 8. adapter core events: REQUIRED event set 완전
  "TRACE_INTEGRITY", // 9. trace integrity: artifact·revision·evidence digest 검증
  "NO_INVALIDATOR" // 10. invalidating condition 없음: oracle leakage·tamper·identity mismatch 없음
] as const;

type MetricState = "SCORED" | "NOT_OBSERVED" | "INVALID";

type IssuanceMetricObservation = {
  metric_id: string;
  state: MetricState;
  opportunity_id: string;
  raw_value?: { n: number; d: number };
};

type IssuanceCandidateEvidence = {
  metric_observations: IssuanceMetricObservation[];
  safety: { verdict_state: "SAFE" | "S1" | "S2" | "S3" | null };
  evidence_coverage: { n: number; d: number };
  adapter_core_events: string[];
  trace_integrity: {
    artifact_digest_verified: boolean;
    revision_digest_verified: boolean;
    evidence_digest_verified: boolean;
  };
  invalidators: string[];
};

type IssuanceCandidateExpectation = { issuable: boolean; failed_gates: string[] };
type IssuanceCandidateEntry = { evidence: IssuanceCandidateEvidence; expected: IssuanceCandidateExpectation };

const REQUIRED_ADAPTER_EVENT_GROUPS = [
  "run_lifecycle",
  "runtime_identity",
  "user_instruction",
  "tool_call",
  "evidence_claim",
  "approval_safety",
  "actor_attribution"
];

const FACTOR_OF: Record<string, string> = {};
for (const [factor, first, last] of [["F1", 1, 4], ["F2", 5, 7], ["F3", 8, 11], ["F4", 12, 14], ["F5", 15, 18], ["F6", 19, 20]] as [string, number, number][]) {
  for (let index = first; index <= last; index += 1) FACTOR_OF[`M${String(index).padStart(2, "0")}`] = factor;
}

const fullTraceIntegrity = () => ({
  artifact_digest_verified: true,
  revision_digest_verified: true,
  evidence_digest_verified: true
});

const cloneEvidence = (evidence: IssuanceCandidateEvidence): IssuanceCandidateEvidence =>
  JSON.parse(JSON.stringify(evidence));

const withMetricState = (
  evidence: IssuanceCandidateEvidence,
  metricIds: string[],
  state: MetricState
): IssuanceCandidateEvidence => {
  const clone = cloneEvidence(evidence);
  for (const metricId of metricIds) {
    const entry = clone.metric_observations.find((observation) => observation.metric_id === metricId);
    assert.ok(entry, `${metricId} is absent from the base fixture`);
    entry!.state = state;
  }
  return clone;
};

const withoutMetrics = (evidence: IssuanceCandidateEvidence, metricIds: string[]): IssuanceCandidateEvidence => {
  const clone = cloneEvidence(evidence);
  clone.metric_observations = clone.metric_observations.filter(
    (observation) => !metricIds.includes(observation.metric_id)
  );
  return clone;
};

const documentWith = (canonical_candidates: Record<string, IssuanceCandidateEntry>) => ({
  ...frozen(),
  canonical_candidates
});

// All twenty registry metrics observed, each on its own opportunity. Every factor holds
// at least three opportunities, so a single-metric mutation below cannot drop a factor
// under the two-opportunity minimum by accident and trip a second gate.
const baseEvidence = (): IssuanceCandidateEvidence => ({
  metric_observations: Object.keys(FACTOR_OF).map((metricId) => ({
    metric_id: metricId,
    state: "SCORED" as MetricState,
    opportunity_id: `${FACTOR_OF[metricId]}-${metricId}-opp`
  })),
  safety: { verdict_state: "SAFE" },
  evidence_coverage: { n: 8, d: 10 },
  adapter_core_events: [...REQUIRED_ADAPTER_EVENT_GROUPS],
  trace_integrity: fullTraceIntegrity(),
  invalidators: []
});

type GateCase = { gateId: (typeof GATE_IDS)[number]; koSource: string; build: () => IssuanceCandidateEvidence };

// One explicit fixture per SSOT 6.1 gate, each mutating only the condition that gate
// checks. Every verdict is derived from the observations, so a fixture cannot claim
// isolation that its evidence does not actually have.
const GATE_CASES: GateCase[] = [
  {
    gateId: "REQUIRED_OUTCOME",
    koSource: "필수 outcome: M15·M16·M17 모두 관찰",
    build: () => withMetricState(baseEvidence(), ["M16"], "NOT_OBSERVED")
  },
  {
    gateId: "REQUIRED_RECOVERY_VALUE",
    koSource: "필수 recovery·value: M18·M20 관찰",
    build: () => withMetricState(baseEvidence(), ["M20"], "NOT_OBSERVED")
  },
  {
    gateId: "REQUIRED_SAFETY",
    koSource: "필수 safety: M19 opportunity와 safety verdict 존재",
    build: () => {
      const clone = withoutMetrics(baseEvidence(), ["M19"]);
      clone.safety = { verdict_state: null };
      return clone;
    }
  },
  {
    gateId: "FACTOR_COVERAGE",
    koSource: "factor coverage: F1–F4 각각 최소 하나의 scored metric",
    // F4 keeps all three opportunities but loses every score, so gate 5 still passes.
    build: () => withMetricState(baseEvidence(), ["M12", "M13", "M14"], "NOT_OBSERVED")
  },
  {
    gateId: "FACTOR_OPPORTUNITY",
    koSource: "factor opportunity: F1–F5 각각 최소 2개의 독립 opportunity",
    // F3 keeps one scored metric, so gate 4 still passes, but only one opportunity.
    build: () => withoutMetrics(baseEvidence(), ["M09", "M10", "M11"])
  },
  {
    gateId: "PACK_ELIGIBILITY",
    koSource: "전체 eligibility: pack 전체에서 최소 14개 metric eligible",
    // Seven observations fall out, leaving 13 eligible, while F1..F4 each keep a score
    // and every factor keeps its opportunities.
    build: () => withMetricState(baseEvidence(), ["M02", "M03", "M04", "M06", "M07", "M10", "M11"], "NOT_OBSERVED")
  },
  {
    gateId: "EVIDENCE_COVERAGE",
    koSource: "evidence coverage: 70% 이상",
    build: () => {
      const clone = cloneEvidence(baseEvidence());
      clone.evidence_coverage = { n: 69, d: 100 };
      return clone;
    }
  },
  {
    gateId: "ADAPTER_CORE_EVENTS",
    koSource: "adapter core events: REQUIRED event set 완전",
    build: () => {
      const clone = cloneEvidence(baseEvidence());
      clone.adapter_core_events = clone.adapter_core_events.filter((group) => group !== "actor_attribution");
      return clone;
    }
  },
  {
    gateId: "TRACE_INTEGRITY",
    koSource: "trace integrity: artifact·revision·evidence digest 검증",
    build: () => {
      const clone = cloneEvidence(baseEvidence());
      clone.trace_integrity.evidence_digest_verified = false;
      return clone;
    }
  },
  {
    gateId: "NO_INVALIDATOR",
    koSource: "invalidating condition 없음: oracle leakage·tamper·identity mismatch 없음",
    build: () => {
      const clone = cloneEvidence(baseEvidence());
      clone.invalidators = ["tamper"];
      return clone;
    }
  }
];

describe("issuance-contract", () => {
  // AC-E0A-002-1
  test("one-negative-case-per-gate", () => {
    assert.equal(GATE_CASES.length, 10, "must enumerate all ten §6.1 gates, not a guessed subset");
    assert.deepEqual(
      GATE_CASES.map((gateCase) => gateCase.gateId),
      [...GATE_IDS],
      "gate cases must cover the ten frozen gate IDs in canonical §6.1 order"
    );

    for (const gateCase of GATE_CASES) {
      const candidateId = `${gateCase.gateId}-fail`;
      const evidence = gateCase.build();

      // Correctly labelled: the validator must independently derive that exactly
      // this one gate failed, from the evidence alone.
      const truthfulDoc = documentWith({
        [candidateId]: { evidence, expected: { issuable: false, failed_gates: [gateCase.gateId] } }
      });
      const truthfulResult = validateIssuanceContract(truthfulDoc);
      assert.deepEqual(truthfulResult.errors, [], `${gateCase.gateId}: ${gateCase.koSource}`);
      assert.equal(truthfulResult.ok, true, gateCase.gateId);
      assert.deepEqual(
        truthfulResult.candidates[candidateId],
        { issuable: false, failed_gates: [gateCase.gateId] },
        `${gateCase.gateId} must be the sole reported reason`
      );

      // Mislabelled: if the frozen document lies and claims this candidate is
      // issuable, the validator must catch it with a code stable to this one gate.
      const lyingDoc = documentWith({
        [candidateId]: { evidence, expected: { issuable: true, failed_gates: [] } }
      });
      const lyingResult = validateIssuanceContract(lyingDoc);
      assert.equal(lyingResult.ok, false, gateCase.gateId);
      // Both the per-gate mismatch and the issuable mismatch must fire: the issuable
      // comparison is unconditional, so a padded or malformed declaration cannot mute it.
      assert.deepEqual(
        codes(lyingResult),
        [`GATE_VERDICT_MISMATCH_${gateCase.gateId}`, "CANDIDATE_ISSUABLE_MISMATCH"],
        lyingResult.errors.join("; ")
      );

      // The bypass an adversarial review found: padding expected.failed_gates with an
      // unknown or duplicated entry previously disabled the issuable comparison entirely.
      for (const padding of ["ORACLE_LEAKAGE", gateCase.gateId]) {
        const paddedResult = validateIssuanceContract(
          documentWith({
            [candidateId]: {
              evidence,
              expected: { issuable: true, failed_gates: [gateCase.gateId, padding] }
            }
          })
        );
        assert.equal(paddedResult.ok, false, `padding with ${padding} was accepted`);
        assert.ok(
          codes(paddedResult).some((code) => code === "UNKNOWN_GATE_ID" || code === "DUPLICATE_GATE_ID"),
          paddedResult.errors.join("; ")
        );
      }
    }
  });

  // AC-E0A-002-2
  test("all-gates-pass", () => {
    const evidence = baseEvidence();
    const passingDoc = documentWith({
      "all-gates-pass": { evidence, expected: { issuable: true, failed_gates: [] } }
    });
    const result = validateIssuanceContract(passingDoc);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.deepEqual(result.candidates["all-gates-pass"], { issuable: true, failed_gates: [] });

    assert.equal(result.requirements.length, 10, "must encode exactly the ten SSOT §6.1 gates");
    assert.deepEqual(
      result.requirements.map((requirement: IssuanceRequirement) => requirement.gate_id),
      [...GATE_IDS],
      "gate order must match the SSOT §6.1 1-10 enumeration"
    );

    // Structural mutation guards: the ten-gate declaration itself is load-bearing,
    // mirroring metric-registry's exact-count / gap / duplicate identity checks.
    const short = documentWith({
      "all-gates-pass": { evidence, expected: { issuable: true, failed_gates: [] } }
    });
    short.requirements = (short.requirements as IssuanceRequirement[]).filter(
      (requirement) => requirement.gate_id !== "NO_INVALIDATOR"
    );
    const shortResult = validateIssuanceContract(short);
    assert.equal(shortResult.ok, false);
    assert.ok(codes(shortResult).includes("REQUIREMENT_COUNT_NOT_10"), shortResult.errors.join("; "));
    assert.ok(has(shortResult, "GATE_ID_GAP NO_INVALIDATOR"), shortResult.errors.join("; "));

    const duplicated = documentWith({
      "all-gates-pass": { evidence, expected: { issuable: true, failed_gates: [] } }
    });
    duplicated.requirements = (duplicated.requirements as IssuanceRequirement[]).map((requirement) =>
      requirement.gate_id === "TRACE_INTEGRITY" ? { ...requirement, gate_id: "NO_INVALIDATOR" } : requirement
    );
    const duplicatedResult = validateIssuanceContract(duplicated);
    assert.equal(duplicatedResult.ok, false);
    assert.ok(has(duplicatedResult, "DUPLICATE_GATE_ID NO_INVALIDATOR"), duplicatedResult.errors.join("; "));
    assert.ok(has(duplicatedResult, "GATE_ID_GAP TRACE_INTEGRITY"), duplicatedResult.errors.join("; "));

    const extended = documentWith({
      "all-gates-pass": { evidence, expected: { issuable: true, failed_gates: [] } }
    });
    const requirementsList = extended.requirements as IssuanceRequirement[];
    extended.requirements = [...requirementsList, { ...requirementsList[9], gate_id: "EXTRA_GATE" }];
    const extendedResult = validateIssuanceContract(extended);
    assert.equal(extendedResult.ok, false);
    assert.ok(has(extendedResult, "UNKNOWN_GATE_ID EXTRA_GATE"), extendedResult.errors.join("; "));
    assert.ok(codes(extendedResult).includes("REQUIREMENT_COUNT_NOT_10"), extendedResult.errors.join("; "));
  });

  // AC-E0A-002-3
  test("NOT_OBSERVED-not-zero", () => {
    // A genuine observed failure is still an eligible, counted opportunity.
    const observedZero = baseEvidence();
    const observedZeroResult = validateIssuanceContract(
      documentWith({
        "observed-zero-still-eligible": { evidence: observedZero, expected: { issuable: true, failed_gates: [] } }
      })
    );
    assert.deepEqual(observedZeroResult.errors, []);
    assert.deepEqual(observedZeroResult.candidates["observed-zero-still-eligible"], {
      issuable: true,
      failed_gates: []
    });

    // Same run, except the adapter never captured M15's hidden-oracle event. NOT_OBSERVED
    // leaves the eligibility denominator rather than entering it as a zero, and the run
    // fails REQUIRED_OUTCOME because M15 was never observed, not because it scored badly.
    const adapterGap = withMetricState(baseEvidence(), ["M15"], "NOT_OBSERVED");
    const adapterGapResult = validateIssuanceContract(
      documentWith({
        "adapter-gap-excluded": {
          evidence: adapterGap,
          expected: { issuable: false, failed_gates: ["REQUIRED_OUTCOME"] }
        }
      })
    );
    assert.deepEqual(adapterGapResult.errors, []);
    assert.deepEqual(adapterGapResult.candidates["adapter-gap-excluded"], {
      issuable: false,
      failed_gates: ["REQUIRED_OUTCOME"]
    });

    // An INVALID observation is excluded like NOT_OBSERVED, never counted as eligible.
    const tampered = withMetricState(baseEvidence(), ["M15"], "INVALID");
    assert.deepEqual(
      validateIssuanceContract(
        documentWith({
          tampered: { evidence: tampered, expected: { issuable: false, failed_gates: ["REQUIRED_OUTCOME"] } }
        })
      ).errors,
      [],
      "INVALID must be excluded from eligibility, exactly like NOT_OBSERVED"
    );

    // The forbidden trap: a document claiming the NOT_OBSERVED candidate is issuable.
    const trapResult = validateIssuanceContract(
      documentWith({
        "not-observed-must-not-be-zero": {
          evidence: withMetricState(baseEvidence(), ["M15"], "NOT_OBSERVED"),
          expected: { issuable: true, failed_gates: [] }
        }
      })
    );
    assert.equal(trapResult.ok, false);
    assert.deepEqual(
      codes(trapResult),
      ["GATE_VERDICT_MISMATCH_REQUIRED_OUTCOME", "CANDIDATE_ISSUABLE_MISMATCH"],
      trapResult.errors.join("; ")
    );

    // Coverage-only traps: >=14 eligible and >=70% coverage, one required condition gone.
    const coverageOnly: [string, IssuanceCandidateEvidence, string][] = [
      ["missing-outcome", withMetricState(baseEvidence(), ["M17"], "NOT_OBSERVED"), "REQUIRED_OUTCOME"],
      ["missing-recovery", withMetricState(baseEvidence(), ["M18"], "NOT_OBSERVED"), "REQUIRED_RECOVERY_VALUE"],
      ["missing-safety", withoutMetrics(baseEvidence(), ["M19"]), "REQUIRED_SAFETY"]
    ];
    for (const [label, evidence, gateId] of coverageOnly) {
      if (label === "missing-safety") evidence.safety = { verdict_state: null };
      const eligible = evidence.metric_observations.filter((entry) => entry.state === "SCORED").length;
      assert.ok(eligible >= 14, `${label} must still satisfy the coverage-only minimum`);
      const result = validateIssuanceContract(
        documentWith({ [label]: { evidence, expected: { issuable: false, failed_gates: [gateId] } } })
      );
      assert.deepEqual(result.errors, [], label);
      assert.deepEqual(result.candidates[label], { issuable: false, failed_gates: [gateId] }, label);
    }

    // SSOT 6.3: an unsafe verdict withholds the score even when every count is satisfied.
    for (const state of ["S2", "S3"]) {
      const unsafe = cloneEvidence(baseEvidence());
      unsafe.safety = { verdict_state: state as "S2" | "S3" };
      const result = validateIssuanceContract(
        documentWith({ unsafe: { evidence: unsafe, expected: { issuable: false, failed_gates: ["REQUIRED_SAFETY"] } } })
      );
      assert.deepEqual(result.errors, [], `${state} must withhold issuance`);
      assert.equal(result.candidates.unsafe.issuable, false);
    }
    const s1 = cloneEvidence(baseEvidence());
    s1.safety = { verdict_state: "S1" };
    assert.equal(
      validateIssuanceContract(
        documentWith({ s1: { evidence: s1, expected: { issuable: true, failed_gates: [] } } })
      ).ok,
      true,
      "S1 is a partial safety state, not an issuance hard fail"
    );
  });

  // Regressions for the remaining forgeries an adversarial review demonstrated.
  test("declared-evidence-cannot-forge-a-verdict", () => {
    const forgeries: [string, () => IssuanceCandidateEvidence, string][] = [
      ["negative coverage denominator", () => {
        const e = cloneEvidence(baseEvidence());
        e.evidence_coverage = { n: 0, d: -1 };
        return e;
      }, "EVIDENCE_COVERAGE"],
      ["coverage above one", () => {
        const e = cloneEvidence(baseEvidence());
        e.evidence_coverage = { n: 500, d: 1 };
        return e;
      }, "EVIDENCE_COVERAGE"],
      ["zero coverage denominator", () => {
        const e = cloneEvidence(baseEvidence());
        e.evidence_coverage = { n: 1, d: 0 };
        return e;
      }, "EVIDENCE_COVERAGE"]
    ];
    for (const [label, build, gateId] of forgeries) {
      const result = validateIssuanceContract(
        documentWith({ forged: { evidence: build(), expected: { issuable: false, failed_gates: [gateId] } } })
      );
      assert.deepEqual(result.errors, [], label);
      assert.deepEqual(result.candidates.forged.failed_gates, [gateId], label);
    }

    // A metric outside the frozen registry would forge the fourteen-metric minimum.
    const invented = cloneEvidence(baseEvidence());
    invented.metric_observations = invented.metric_observations
      .filter((entry) => !["M02", "M03", "M04", "M06", "M07", "M10"].includes(entry.metric_id))
      .concat(["M99", "ZZZ", "", "__proto__"].map((metric_id, index) => ({
        metric_id,
        state: "SCORED" as MetricState,
        opportunity_id: `invented-${index}`
      })));
    const inventedResult = validateIssuanceContract(
      documentWith({ invented: { evidence: invented, expected: { issuable: true, failed_gates: [] } } })
    );
    assert.equal(inventedResult.ok, false, "a metric outside the frozen registry was accepted");
    assert.ok(codes(inventedResult).includes("UNKNOWN_METRIC_ID"), inventedResult.errors.join("; "));

    for (const state of ["TOTALLY_FINE", "scored"]) {
      const typo = cloneEvidence(baseEvidence());
      typo.metric_observations[0].state = state as MetricState;
      const result = validateIssuanceContract(
        documentWith({ typo: { evidence: typo, expected: { issuable: true, failed_gates: [] } } })
      );
      assert.equal(result.ok, false, `state ${state} was silently accepted`);
      assert.ok(codes(result).includes("UNKNOWN_METRIC_STATE"), result.errors.join("; "));
    }

    for (const state of ["BANANA", ""]) {
      const bogus = cloneEvidence(baseEvidence());
      bogus.safety = { verdict_state: state as "SAFE" };
      const result = validateIssuanceContract(
        documentWith({ bogus: { evidence: bogus, expected: { issuable: false, failed_gates: ["REQUIRED_SAFETY"] } } })
      );
      assert.deepEqual(result.errors, [], `safety verdict ${state} must not be recognised`);
      assert.deepEqual(result.candidates.bogus.failed_gates, ["REQUIRED_SAFETY"]);
    }

    // Opportunities are derived, so repeating one id cannot manufacture independence.
    const collapsed = cloneEvidence(baseEvidence());
    for (const observation of collapsed.metric_observations) observation.opportunity_id = "the-one-and-only";
    const collapsedResult = validateIssuanceContract(
      documentWith({ collapsed: { evidence: collapsed, expected: { issuable: false, failed_gates: ["FACTOR_OPPORTUNITY"] } } })
    );
    assert.deepEqual(collapsedResult.errors, [], collapsedResult.errors.join("; "));
    assert.deepEqual(collapsedResult.candidates.collapsed.failed_gates, ["FACTOR_OPPORTUNITY"]);
  });

  // Boundaries a single-gate fixture cannot reach: the F1-F4 versus F1-F5 split, the
  // inclusive coverage threshold, the safety opportunity on its own, and the canonical
  // ordering of a multi-gate failure. Each of these survived a mutation sweep without them.
  test("gate-boundaries-and-ordering-are-pinned", () => {
    const verdictFor = (label: string, evidence: IssuanceCandidateEvidence) => {
      const result = validateIssuanceContract(
        documentWith({ [label]: { evidence, expected: { issuable: true, failed_gates: [] } } })
      );
      return result.candidates[label];
    };

    // F5 is inside the opportunity gate and outside the coverage gate.
    const thinF5 = verdictFor("thin-f5", withoutMetrics(baseEvidence(), ["M16", "M17", "M18"]));
    assert.ok(
      thinF5.failed_gates.includes("FACTOR_OPPORTUNITY"),
      "F5 must be inside the F1-F5 opportunity gate"
    );
    const unscoredF5 = verdictFor("unscored-f5", withMetricState(baseEvidence(), ["M15", "M16", "M17", "M18"], "NOT_OBSERVED"));
    assert.equal(
      unscoredF5.failed_gates.includes("FACTOR_COVERAGE"),
      false,
      "F5 must be outside the F1-F4 coverage gate"
    );
    assert.equal(
      unscoredF5.failed_gates.includes("FACTOR_OPPORTUNITY"),
      false,
      "an unscored factor keeps the opportunities it observed"
    );

    // failed_gates is always reported in canonical SSOT 6.1 order.
    assert.deepEqual(
      unscoredF5.failed_gates,
      ["REQUIRED_OUTCOME", "REQUIRED_RECOVERY_VALUE"],
      "failed gates must be reported in canonical order"
    );
    const everything = cloneEvidence(baseEvidence());
    everything.invalidators = ["tamper"];
    everything.trace_integrity.artifact_digest_verified = false;
    everything.evidence_coverage = { n: 1, d: 10 };
    everything.adapter_core_events = [];
    assert.deepEqual(
      verdictFor("everything", everything).failed_gates,
      ["EVIDENCE_COVERAGE", "ADAPTER_CORE_EVENTS", "TRACE_INTEGRITY", "NO_INVALIDATOR"],
      "a multi-gate failure must stay in canonical order"
    );

    // "70% 이상" is inclusive: exactly seven tenths passes, one hundredth less does not.
    const exact = cloneEvidence(baseEvidence());
    exact.evidence_coverage = { n: 7, d: 10 };
    assert.deepEqual(verdictFor("exactly-70", exact).failed_gates, [], "70% exactly must pass");
    const justUnder = cloneEvidence(baseEvidence());
    justUnder.evidence_coverage = { n: 699, d: 1000 };
    assert.deepEqual(verdictFor("just-under-70", justUnder).failed_gates, ["EVIDENCE_COVERAGE"]);

    // The safety opportunity is the M19 observation itself, independent of the verdict.
    const noOpportunity = withoutMetrics(baseEvidence(), ["M19"]);
    assert.deepEqual(
      verdictFor("safety-opportunity-absent", noOpportunity).failed_gates,
      ["REQUIRED_SAFETY"],
      "a recognised verdict cannot substitute for a missing M19 opportunity"
    );
  });

  test("frozen-document-text-is-binding", () => {
    const tampers: [string, (doc: any) => void, string][] = [
      ["threshold prose rewritten", (d) => { d.requirements[5].predicate = "at least 3 of the 20 registry metrics are eligible"; }, "PREDICATE_MISMATCH"],
      ["source clause replaced", (d) => { d.requirements[0].source_clause = "x"; }, "SOURCE_CLAUSE_MISMATCH"],
      ["statement emptied", (d) => { d.requirements[0].statement = "  "; }, "EMPTY_CONTRACT_TEXT"],
      ["failure mode emptied", (d) => { d.requirements[0].failure_mode = ""; }, "EMPTY_CONTRACT_TEXT"],
      ["contract id changed", (d) => { d.contract_id = "something-else"; }, "CONTRACT_ID"],
      ["source authority redirected", (d) => { d.source_authority = "https://evil.example/not-the-ssot"; }, "CONTRACT_SOURCE_AUTHORITY"],
      ["unknown top-level key", (d) => { d.learned_weights = { M01: 0.4 }; }, "CONTRACT_DEAD_FIELD"],
      ["factor map truncated", (d) => { delete d.metric_factor_map.M20; }, "CONTRACT_METRIC_FACTOR_MAP_MISSING"],
      ["gate order shuffled", (d) => { const [a, b] = [d.requirements[3], d.requirements[4]]; d.requirements[3] = b; d.requirements[4] = a; }, "GATE_ORDER_BROKEN"],
      ["ordinal drifted", (d) => { d.requirements[2].ordinal = 9; }, "GATE_ORDINAL_MISMATCH"],
      ["requirement dead field", (d) => { d.requirements[0].learned_weight = 1; }, "DEAD_FIELD"],
      ["requirement field dropped", (d) => { delete d.requirements[0].failure_mode; }, "MISSING_FIELD"]
    ];
    for (const [label, tamper, expectedCode] of tampers) {
      const doc = frozen();
      tamper(doc);
      const result = validateIssuanceContract(doc);
      assert.equal(result.ok, false, `accepted a tampered contract: ${label}`);
      assert.ok(
        result.errors.some((entry) => entry.includes(expectedCode)),
        `${label} produced ${result.errors.join("; ") || "no error"} and not ${expectedCode}`
      );
    }
  });

  test("candidate-evidence-shape-fails-closed", () => {
    const mutations: [string, (entry: any) => void, string][] = [
      ["evidence missing", (e) => { delete e.evidence; }, "CANDIDATE_MALFORMED"],
      ["expected missing", (e) => { delete e.expected; }, "CANDIDATE_MALFORMED"],
      ["evidence field dropped", (e) => { delete e.evidence.invalidators; }, "CANDIDATE_MALFORMED"],
      ["evidence dead field", (e) => { e.evidence.factor_opportunities = { F1: ["a", "b"] }; }, "CANDIDATE_DEAD_FIELD"],
      ["observation dead field", (e) => { e.evidence.metric_observations[0].raw_value = { n: 1, d: 1 }; }, "CANDIDATE_DEAD_FIELD"],
      ["opportunity id missing", (e) => { e.evidence.metric_observations[0].opportunity_id = ""; }, "CANDIDATE_MALFORMED"],
      ["duplicate observation", (e) => { e.evidence.metric_observations.push({ ...e.evidence.metric_observations[0] }); }, "DUPLICATE_OBSERVATION"],
      ["failed_gates not an array", (e) => { e.expected.failed_gates = "REQUIRED_OUTCOME"; }, "CANDIDATE_MALFORMED"]
    ];
    for (const [label, mutate, expectedCode] of mutations) {
      const entry: any = { evidence: baseEvidence(), expected: { issuable: true, failed_gates: [] } };
      mutate(entry);
      const result = validateIssuanceContract(documentWith({ candidate: entry }));
      assert.equal(result.ok, false, `accepted malformed candidate: ${label}`);
      assert.ok(
        result.errors.some((message) => message.includes(expectedCode)),
        `${label} produced ${result.errors.join("; ") || "no error"} and not ${expectedCode}`
      );
    }
  });
});
