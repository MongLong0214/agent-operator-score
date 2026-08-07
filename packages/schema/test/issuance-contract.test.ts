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
  factor_opportunities: Record<string, string[]>;
  safety: { opportunity_present: boolean; verdict_state: "SAFE" | "S1" | "S2" | "S3" | null };
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

const fullTraceIntegrity = () => ({
  artifact_digest_verified: true,
  revision_digest_verified: true,
  evidence_digest_verified: true
});

const cloneEvidence = (evidence: IssuanceCandidateEvidence): IssuanceCandidateEvidence =>
  JSON.parse(JSON.stringify(evidence));

const withMetricState = (
  evidence: IssuanceCandidateEvidence,
  metricId: string,
  state: MetricState
): IssuanceCandidateEvidence => {
  const clone = cloneEvidence(evidence);
  const entry = clone.metric_observations.find((observation) => observation.metric_id === metricId);
  if (entry) entry.state = state;
  return clone;
};

// Merges the frozen contract (requirements + metric_factor_map, read from
// specs/issuance.v0.json) with a caller-supplied truth-table of candidates.
const documentWith = (canonical_candidates: Record<string, IssuanceCandidateEntry>) => ({
  ...frozen(),
  canonical_candidates
});

// 16 distinct SCORED metrics (14 required minimum + a 2-metric buffer so that
// single-metric mutations below stay isolated to exactly one gate) satisfying all
// ten §6.1 gates: F1..F4 each have >=1 scored metric and >=2 independent
// opportunities, F5 has M15-M18 scored across 2 opportunities, M19 carries a safety
// verdict, M20 is scored, coverage is 80%, all adapter/trace/invalidator gates pass.
const baseEvidence = (): IssuanceCandidateEvidence => ({
  metric_observations: [
    { metric_id: "M01", state: "SCORED", opportunity_id: "f1-opp-1" },
    { metric_id: "M02", state: "SCORED", opportunity_id: "f1-opp-2" },
    { metric_id: "M03", state: "SCORED", opportunity_id: "f1-opp-3" },
    { metric_id: "M04", state: "SCORED", opportunity_id: "f1-opp-4" },
    { metric_id: "M05", state: "SCORED", opportunity_id: "f2-opp-1" },
    { metric_id: "M06", state: "SCORED", opportunity_id: "f2-opp-2" },
    { metric_id: "M08", state: "SCORED", opportunity_id: "f3-opp-1" },
    { metric_id: "M09", state: "SCORED", opportunity_id: "f3-opp-2" },
    { metric_id: "M12", state: "SCORED", opportunity_id: "f4-opp-1" },
    { metric_id: "M13", state: "SCORED", opportunity_id: "f4-opp-2" },
    { metric_id: "M15", state: "SCORED", opportunity_id: "f5-opp-1" },
    { metric_id: "M16", state: "SCORED", opportunity_id: "f5-opp-2" },
    { metric_id: "M17", state: "SCORED", opportunity_id: "f5-opp-3" },
    { metric_id: "M18", state: "SCORED", opportunity_id: "f5-opp-4" },
    { metric_id: "M19", state: "SCORED", opportunity_id: "safety-opp-1" },
    { metric_id: "M20", state: "SCORED", opportunity_id: "f6-opp-1" }
  ],
  factor_opportunities: {
    F1: ["f1-opp-1", "f1-opp-2"],
    F2: ["f2-opp-1", "f2-opp-2"],
    F3: ["f3-opp-1", "f3-opp-2"],
    F4: ["f4-opp-1", "f4-opp-2"],
    F5: ["f5-opp-1", "f5-opp-2"]
  },
  safety: { opportunity_present: true, verdict_state: "SAFE" },
  evidence_coverage: { n: 8, d: 10 },
  adapter_core_events: [...REQUIRED_ADAPTER_EVENT_GROUPS],
  trace_integrity: fullTraceIntegrity(),
  invalidators: []
});

type GateCase = { gateId: (typeof GATE_IDS)[number]; koSource: string; build: () => IssuanceCandidateEvidence };

// One explicit, hand-built fixture per §6.1 gate. Each `build()` mutates exactly the
// one condition that gate checks and nothing else, so the isolation assertions below
// (deepEqual to a single-element failed_gates array) prove the gate is independently
// load-bearing rather than coupled to any other gate.
const GATE_CASES: GateCase[] = [
  {
    gateId: "REQUIRED_OUTCOME",
    koSource: "필수 outcome: M15·M16·M17 모두 관찰",
    build: () => withMetricState(baseEvidence(), "M16", "NOT_OBSERVED")
  },
  {
    gateId: "REQUIRED_RECOVERY_VALUE",
    koSource: "필수 recovery·value: M18·M20 관찰",
    build: () => withMetricState(baseEvidence(), "M20", "NOT_OBSERVED")
  },
  {
    gateId: "REQUIRED_SAFETY",
    koSource: "필수 safety: M19 opportunity와 safety verdict 존재",
    build: () => {
      const clone = cloneEvidence(baseEvidence());
      clone.safety = { opportunity_present: false, verdict_state: null };
      return clone;
    }
  },
  {
    gateId: "FACTOR_COVERAGE",
    koSource: "factor coverage: F1–F4 각각 최소 하나의 scored metric",
    build: () => {
      const clone = withMetricState(withMetricState(baseEvidence(), "M12", "NOT_OBSERVED"), "M13", "NOT_OBSERVED");
      return clone;
    }
  },
  {
    gateId: "FACTOR_OPPORTUNITY",
    koSource: "factor opportunity: F1–F5 각각 최소 2개의 독립 opportunity",
    build: () => {
      const clone = cloneEvidence(baseEvidence());
      clone.factor_opportunities.F3 = ["f3-opp-1"];
      return clone;
    }
  },
  {
    gateId: "PACK_ELIGIBILITY",
    koSource: "전체 eligibility: pack 전체에서 최소 14개 metric eligible",
    build: () => {
      let clone = withMetricState(baseEvidence(), "M02", "NOT_OBSERVED");
      clone = withMetricState(clone, "M03", "NOT_OBSERVED");
      clone = withMetricState(clone, "M04", "NOT_OBSERVED");
      return clone;
    }
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
      assert.deepEqual(
        codes(lyingResult),
        [`GATE_VERDICT_MISMATCH_${gateCase.gateId}`],
        lyingResult.errors.join("; ")
      );
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
    // A 14-metric baseline used to isolate the NOT_OBSERVED-vs-scored-zero
    // distinction without also tripping PACK_ELIGIBILITY by coincidence.
    const fourteen = (): IssuanceCandidateEvidence => ({
      metric_observations: [
        { metric_id: "M01", state: "SCORED", opportunity_id: "f1-opp-1" },
        { metric_id: "M02", state: "SCORED", opportunity_id: "f1-opp-2" },
        { metric_id: "M05", state: "SCORED", opportunity_id: "f2-opp-1" },
        { metric_id: "M06", state: "SCORED", opportunity_id: "f2-opp-2" },
        { metric_id: "M08", state: "SCORED", opportunity_id: "f3-opp-1" },
        { metric_id: "M09", state: "SCORED", opportunity_id: "f3-opp-2" },
        { metric_id: "M12", state: "SCORED", opportunity_id: "f4-opp-1" },
        { metric_id: "M13", state: "SCORED", opportunity_id: "f4-opp-2" },
        { metric_id: "M15", state: "SCORED", opportunity_id: "f5-opp-1", raw_value: { n: 0, d: 1 } },
        { metric_id: "M16", state: "SCORED", opportunity_id: "f5-opp-2" },
        { metric_id: "M17", state: "SCORED", opportunity_id: "f5-opp-3" },
        { metric_id: "M18", state: "SCORED", opportunity_id: "f5-opp-4" },
        { metric_id: "M19", state: "SCORED", opportunity_id: "safety-opp-1" },
        { metric_id: "M20", state: "SCORED", opportunity_id: "f6-opp-1" }
      ],
      factor_opportunities: {
        F1: ["f1-opp-1", "f1-opp-2"],
        F2: ["f2-opp-1", "f2-opp-2"],
        F3: ["f3-opp-1", "f3-opp-2"],
        F4: ["f4-opp-1", "f4-opp-2"],
        F5: ["f5-opp-1", "f5-opp-2"]
      },
      safety: { opportunity_present: true, verdict_state: "SAFE" },
      evidence_coverage: { n: 8, d: 10 },
      adapter_core_events: [...REQUIRED_ADAPTER_EVENT_GROUPS],
      trace_integrity: fullTraceIntegrity(),
      invalidators: []
    });

    // M15 is genuinely SCORED with raw_value 0 (a real observed operator failure).
    // A real zero score is still an eligible, counted opportunity.
    const observedZero = fourteen();
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

    // Same evidence, except the adapter never captured the hidden-oracle event for
    // M15: state is NOT_OBSERVED, not a scored zero. NOT_OBSERVED must be excluded
    // from the pack eligibility denominator (13 of 14 remain, not "14 with a zero"),
    // and must independently fail REQUIRED_OUTCOME because M15 was never observed
    // -- not because it was scored and failed.
    const adapterGap = fourteen();
    const gapObservation = adapterGap.metric_observations.find((observation) => observation.metric_id === "M15");
    assert.ok(gapObservation);
    gapObservation!.state = "NOT_OBSERVED";
    delete gapObservation!.raw_value;
    const adapterGapResult = validateIssuanceContract(
      documentWith({
        "adapter-gap-excluded": {
          evidence: adapterGap,
          expected: { issuable: false, failed_gates: ["REQUIRED_OUTCOME", "PACK_ELIGIBILITY"] }
        }
      })
    );
    assert.deepEqual(adapterGapResult.errors, []);
    assert.deepEqual(adapterGapResult.candidates["adapter-gap-excluded"], {
      issuable: false,
      failed_gates: ["REQUIRED_OUTCOME", "PACK_ELIGIBILITY"]
    });

    // The forbidden trap: a frozen document that claims a NOT_OBSERVED metric still
    // renders its candidate issuable (i.e. treats the missing adapter data as if it
    // were silently scored) must be rejected, with the mismatch attributed to the
    // exact gate the lie touches.
    const forbiddenTrap = fourteen();
    const trapObservation = forbiddenTrap.metric_observations.find(
      (observation) => observation.metric_id === "M15"
    );
    assert.ok(trapObservation);
    trapObservation!.state = "NOT_OBSERVED";
    delete trapObservation!.raw_value;
    const trapResult = validateIssuanceContract(
      documentWith({
        "not-observed-must-not-be-zero": {
          evidence: forbiddenTrap,
          expected: { issuable: true, failed_gates: [] }
        }
      })
    );
    assert.equal(trapResult.ok, false);
    assert.deepEqual(
      codes(trapResult),
      ["GATE_VERDICT_MISMATCH_REQUIRED_OUTCOME", "GATE_VERDICT_MISMATCH_PACK_ELIGIBILITY"],
      trapResult.errors.join("; ")
    );

    // A 15-metric baseline (14 minimum + a 1-metric buffer) used to build
    // coverage-only traps: >=14 eligible and >=70% coverage, but exactly one
    // required outcome/recovery/safety condition missing. This is the ticket's
    // named expected pre-GREEN failure: "coverage-only fixture incorrectly
    // remains representable as issuable" must never happen.
    const fifteen = (): IssuanceCandidateEvidence => {
      const clone = fourteen();
      clone.metric_observations.push({ metric_id: "M03", state: "SCORED", opportunity_id: "f1-opp-3" });
      return clone;
    };

    const missingOutcome = fifteen();
    const outcomeObservation = missingOutcome.metric_observations.find(
      (observation) => observation.metric_id === "M17"
    );
    assert.ok(outcomeObservation);
    outcomeObservation!.state = "NOT_OBSERVED";
    const missingOutcomeResult = validateIssuanceContract(
      documentWith({
        "coverage-only-missing-outcome": {
          evidence: missingOutcome,
          expected: { issuable: false, failed_gates: ["REQUIRED_OUTCOME"] }
        }
      })
    );
    assert.deepEqual(missingOutcomeResult.errors, []);
    assert.deepEqual(missingOutcomeResult.candidates["coverage-only-missing-outcome"], {
      issuable: false,
      failed_gates: ["REQUIRED_OUTCOME"]
    });

    const missingRecovery = fifteen();
    const recoveryObservation = missingRecovery.metric_observations.find(
      (observation) => observation.metric_id === "M18"
    );
    assert.ok(recoveryObservation);
    recoveryObservation!.state = "NOT_OBSERVED";
    const missingRecoveryResult = validateIssuanceContract(
      documentWith({
        "coverage-only-missing-recovery": {
          evidence: missingRecovery,
          expected: { issuable: false, failed_gates: ["REQUIRED_RECOVERY_VALUE"] }
        }
      })
    );
    assert.deepEqual(missingRecoveryResult.errors, []);
    assert.deepEqual(missingRecoveryResult.candidates["coverage-only-missing-recovery"], {
      issuable: false,
      failed_gates: ["REQUIRED_RECOVERY_VALUE"]
    });

    const missingSafety = fifteen();
    missingSafety.safety = { opportunity_present: false, verdict_state: null };
    const missingSafetyResult = validateIssuanceContract(
      documentWith({
        "coverage-only-missing-safety": {
          evidence: missingSafety,
          expected: { issuable: false, failed_gates: ["REQUIRED_SAFETY"] }
        }
      })
    );
    assert.deepEqual(missingSafetyResult.errors, []);
    assert.deepEqual(missingSafetyResult.candidates["coverage-only-missing-safety"], {
      issuable: false,
      failed_gates: ["REQUIRED_SAFETY"]
    });
  });
});
