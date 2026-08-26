import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(here, "../../../specs/metrics.v0.json");
const modulePath = "../src/eligibility.ts";

// The ticket's own pre-GREEN reason, carried verbatim so the RED receipt records the
// expectation rather than an accident. Without it every case dies on a module-resolution
// error whose text names a loader internal, and a loader internal is not the contract that
// is missing. Both owned symbols are named because either one absent breaks every case.
const ABSENT =
  "secondary/no-opportunity and duplicate correlation events can inflate denominators: " +
  "deriveMetricEligibility and deduplicateEvidence are not implemented in " +
  "packages/scorer/src/eligibility.ts";

// Independent oracle for ADR-0005 opportunity semantics and the Metric Scoring Contract v1
// common model. Every expectation below is a literal written here; nothing is read back out
// of the value under test, so an implementation cannot make a wrong answer agree by
// restating whatever it returned.
type MetricRow = {
  metric_id: string;
  minimum_opportunities: number;
  evidence_precedence: string[];
  confidence: Record<string, number>;
};

type EligibilityRow = {
  metric_id: string;
  state: string;
  reason: string;
  opportunity_ids: string[];
  opportunity_count: number;
  minimum_opportunities: number;
};

type Derivation = {
  ok: boolean;
  metrics: EligibilityRow[];
  eligible_metric_ids: string[];
  eligible_metric_count: number;
  reasons: string[];
};

type Deduplication = {
  ok: boolean;
  evidence: {
    evidence_id: string;
    correlation_id: string;
    metric_id: string;
    opportunity_id: string;
    source_class: string;
  }[];
  reasons: string[];
};

type DeriveMetricEligibility = (input: unknown) => Derivation;
type DeduplicateEvidence = (input: unknown) => Deduplication;

// Namespace/dynamic import: a missing module or a missing named export must surface as the
// ticket's pinned sentence. A static named import would be a module-load error, which the
// RED contract treats as an unrelated stop.
const loadModule = async (): Promise<Record<string, unknown>> => {
  try {
    return (await import(modulePath)) as Record<string, unknown>;
  } catch {
    throw new Error(ABSENT);
  }
};

const loadDerive = async (): Promise<DeriveMetricEligibility> => {
  const loaded = await loadModule();
  if (typeof loaded.deriveMetricEligibility !== "function") throw new Error(ABSENT);
  return loaded.deriveMetricEligibility as DeriveMetricEligibility;
};

const loadDeduplicate = async (): Promise<DeduplicateEvidence> => {
  const loaded = await loadModule();
  if (typeof loaded.deduplicateEvidence !== "function") throw new Error(ABSENT);
  return loaded.deduplicateEvidence as DeduplicateEvidence;
};

// The frozen registry, not a local copy. `minimum_opportunities` is 2 for nineteen metrics
// and 1 for M19, and a derivation that hard-codes either number is wrong for the other.
const registryRows: MetricRow[] = JSON.parse(readFileSync(registryPath, "utf8")).metrics;
const PRECEDENCE = registryRows[0].evidence_precedence;

const row = (derivation: Derivation, metricId: string): EligibilityRow => {
  const found = derivation.metrics.find((entry) => entry.metric_id === metricId);
  assert.ok(found, `no eligibility row for ${metricId}`);
  return found;
};

const opportunity = (opportunityId: string, metricId: string, role: string) =>
  ({ opportunity_id: opportunityId, metric_id: metricId, role });

const evidence = (
  evidenceId: string,
  correlationId: string,
  metricId: string,
  opportunityId: string,
  sourceClass = "hidden_oracle"
) => ({
  evidence_id: evidenceId,
  correlation_id: correlationId,
  metric_id: metricId,
  opportunity_id: opportunityId,
  source_class: sourceClass
});

const derivationInput = (parts: {
  opportunities?: unknown[];
  evidence?: unknown[];
  adapter_capabilities?: unknown[];
}) => ({
  precedence: PRECEDENCE,
  registry: registryRows,
  opportunities: parts.opportunities ?? [],
  evidence: parts.evidence ?? [],
  adapter_capabilities: parts.adapter_capabilities ?? []
});

// A fully observed metric, used as the control in every case. A case that only shows a
// metric failing to become eligible would equally pass against a derivation that never
// makes anything eligible at all.
const observedPair = (metricId: string, correlationPrefix: string) => ({
  opportunities: [
    opportunity(`${metricId}-a`, metricId, "primary"),
    opportunity(`${metricId}-b`, metricId, "primary")
  ],
  evidence: [
    evidence(`ev-${correlationPrefix}-1`, `corr-${correlationPrefix}-1`, metricId, `${metricId}-a`),
    evidence(`ev-${correlationPrefix}-2`, `corr-${correlationPrefix}-2`, metricId, `${metricId}-b`)
  ]
});

describe("eligibility", () => {
  // AC-E2-001-1. SSOT §4.2: 기회가 없으면 NOT OBSERVED이며 0점이 아니다. A metric with no
  // sealed opportunity leaves the eligibility denominator; it never enters it as a zero,
  // because a zero is an operator failure and an absent opportunity is not one.
  test("no-opportunity", async () => {
    const deriveMetricEligibility = await loadDerive();
    const control = observedPair("M01", "a");

    const derivation = deriveMetricEligibility(derivationInput(control));

    const absent = row(derivation, "M02");
    assert.equal(absent.state, "NOT_OBSERVED");
    assert.equal(absent.reason, "NO_OPPORTUNITY");
    assert.deepEqual(absent.opportunity_ids, []);
    assert.equal(absent.opportunity_count, 0);

    // NOT_OBSERVED is never a zero. A raw or normalized value on this row would be exactly
    // the substitution the Metric Scoring Contract forbids, so the fields must be absent
    // rather than present and set to 0.
    assert.equal(Object.hasOwn(absent, "raw_value"), false);
    assert.equal(Object.hasOwn(absent, "normalized_value"), false);
    assert.equal(Object.hasOwn(absent, "score"), false);

    // It leaves the denominator: nineteen unobserved metrics do not make the pack
    // nineteen-way failed, they make it one-metric observed.
    assert.equal(derivation.eligible_metric_ids.includes("M02"), false);
    assert.deepEqual(derivation.eligible_metric_ids, ["M01"]);
    assert.equal(derivation.eligible_metric_count, 1);

    // Control: the same call does make M01 eligible, so the M02 verdict is a verdict about
    // M02 and not about a derivation that can never observe anything.
    assert.equal(row(derivation, "M01").state, "SCORED");

    // All twenty registry metrics are accounted for; silence is not a state.
    assert.deepEqual(
      derivation.metrics.map((entry) => entry.metric_id),
      registryRows.map((entry) => entry.metric_id)
    );
  });

  // AC-E2-001-2. Metric Scoring Contract v1: "A metric with fewer than its stated minimum
  // independent opportunities is NOT_OBSERVED." The minimum is the frozen registry's, which
  // is 2 for M01 and 1 for M19, so a hard-coded threshold is wrong for one of them.
  test("independent-two", async () => {
    const deriveMetricEligibility = await loadDerive();
    const control = observedPair("M01", "a");

    const two = deriveMetricEligibility(derivationInput(control));
    const scored = row(two, "M01");
    assert.equal(scored.state, "SCORED");
    assert.equal(scored.reason, "OBSERVED");
    assert.deepEqual(scored.opportunity_ids, ["M01-a", "M01-b"]);
    assert.equal(scored.opportunity_count, 2);
    assert.equal(scored.minimum_opportunities, 2);
    assert.deepEqual(two.eligible_metric_ids, ["M01"]);
    assert.equal(two.eligible_metric_count, 1);

    // One independent opportunity is below the minimum. The sealed second opportunity still
    // exists, so this is not NO_OPPORTUNITY; it is an observed shortfall and must say so.
    const one = deriveMetricEligibility(
      derivationInput({ opportunities: control.opportunities, evidence: [control.evidence[0]] })
    );
    const short = row(one, "M01");
    assert.equal(short.state, "NOT_OBSERVED");
    assert.equal(short.reason, "BELOW_MINIMUM_OPPORTUNITIES");
    assert.deepEqual(short.opportunity_ids, ["M01-a"]);
    assert.equal(short.opportunity_count, 1);
    assert.deepEqual(one.eligible_metric_ids, []);
    assert.equal(one.eligible_metric_count, 0);

    // M19's frozen minimum is 1: one opportunity is enough, and the identical shape under
    // M01's minimum of 2 is not. The pair pins that the threshold is read per metric.
    const safety = deriveMetricEligibility(
      derivationInput({
        opportunities: [opportunity("M19-a", "M19", "primary")],
        evidence: [evidence("ev-s-1", "corr-s-1", "M19", "M19-a")]
      })
    );
    const safetyRow = row(safety, "M19");
    assert.equal(safetyRow.state, "SCORED");
    assert.equal(safetyRow.reason, "OBSERVED");
    assert.equal(safetyRow.opportunity_count, 1);
    assert.equal(safetyRow.minimum_opportunities, 1);
    assert.deepEqual(safety.eligible_metric_ids, ["M19"]);

    // Authority, not volume. An operator claim carries frozen confidence 0.00 and never
    // earns credit, so two of them are still no observed opportunity.
    const claimed = deriveMetricEligibility(
      derivationInput({
        opportunities: control.opportunities,
        evidence: [
          evidence("ev-c-1", "corr-c-1", "M01", "M01-a", "operator_claim"),
          evidence("ev-c-2", "corr-c-2", "M01", "M01-b", "operator_claim")
        ]
      })
    );
    const unauthorised = row(claimed, "M01");
    assert.equal(unauthorised.state, "NOT_OBSERVED");
    assert.equal(unauthorised.reason, "BELOW_MINIMUM_OPPORTUNITIES");
    assert.equal(unauthorised.opportunity_count, 0);
    assert.deepEqual(claimed.eligible_metric_ids, []);
  });

  // AC-E2-001-3. SSOT §5.1: 하나의 행동을 여러 지표에 중복 귀속해 숫자를 채우지 않는다.
  // The correlation id is what makes two evidence records the same action, so it is the
  // whole dedup key. Keying on the pair (correlation, opportunity) or (correlation, metric)
  // would let one action count once per opportunity and once per metric, which is precisely
  // the double count the ticket forbids.
  test("duplicate-correlation", async () => {
    const deduplicateEvidence = await loadDeduplicate();
    const deriveMetricEligibility = await loadDerive();
    const opportunities = [
      opportunity("M01-a", "M01", "primary"),
      opportunity("M01-b", "M01", "primary")
    ];

    // One action, reported twice against two different opportunities of the same metric.
    const doubled = [
      evidence("ev-1", "corr-1", "M01", "M01-a"),
      evidence("ev-2", "corr-1", "M01", "M01-b")
    ];

    const collapsed = deduplicateEvidence({ evidence: doubled, precedence: PRECEDENCE });
    assert.equal(collapsed.evidence.length, 1);
    assert.equal(collapsed.evidence[0].correlation_id, "corr-1");
    assert.equal(collapsed.evidence[0].evidence_id, "ev-1");
    assert.equal(collapsed.ok, false);
    assert.deepEqual(collapsed.reasons, ["DUPLICATE_CORRELATION corr-1"]);

    const inflated = deriveMetricEligibility(derivationInput({ opportunities, evidence: doubled }));
    const deduped = row(inflated, "M01");
    assert.equal(deduped.opportunity_count, 1);
    assert.deepEqual(deduped.opportunity_ids, ["M01-a"]);
    assert.equal(deduped.state, "NOT_OBSERVED");
    assert.equal(deduped.reason, "BELOW_MINIMUM_OPPORTUNITIES");
    assert.deepEqual(inflated.eligible_metric_ids, []);
    assert.equal(inflated.eligible_metric_count, 0);

    // Control: the identical two opportunities under two distinct correlations are two
    // independent observations and do make the metric eligible. Without this the case would
    // also pass against an implementation that credits nothing.
    const distinct = deriveMetricEligibility(
      derivationInput({
        opportunities,
        evidence: [
          evidence("ev-1", "corr-1", "M01", "M01-a"),
          evidence("ev-2", "corr-2", "M01", "M01-b")
        ]
      })
    );
    assert.equal(row(distinct, "M01").opportunity_count, 2);
    assert.equal(row(distinct, "M01").state, "SCORED");

    // One action attributed across two metrics credits one metric, not both. The survivor
    // is the higher-precedence record; the frozen order puts the hidden oracle above a
    // declared adapter event, so M05 keeps the correlation and M01 gets nothing.
    const crossMetric = deriveMetricEligibility(
      derivationInput({
        opportunities: [
          opportunity("M01-a", "M01", "primary"),
          opportunity("M01-b", "M01", "primary"),
          opportunity("M05-a", "M05", "primary"),
          opportunity("M05-b", "M05", "primary")
        ],
        evidence: [
          evidence("ev-1", "corr-shared", "M01", "M01-a", "declared_adapter_event"),
          evidence("ev-2", "corr-shared", "M05", "M05-a", "hidden_oracle"),
          evidence("ev-3", "corr-3", "M01", "M01-b"),
          evidence("ev-4", "corr-4", "M05", "M05-b")
        ]
      })
    );
    assert.equal(row(crossMetric, "M01").opportunity_count, 1);
    assert.deepEqual(row(crossMetric, "M01").opportunity_ids, ["M01-b"]);
    assert.equal(row(crossMetric, "M05").opportunity_count, 2);
    assert.deepEqual(row(crossMetric, "M05").opportunity_ids, ["M05-a", "M05-b"]);
    assert.deepEqual(crossMetric.eligible_metric_ids, ["M05"]);
    assert.equal(crossMetric.reasons.includes("DUPLICATE_CORRELATION corr-shared"), true);

    // Precedence, not input order: reversing the two records must not move the survivor.
    const reversed = deduplicateEvidence({
      evidence: [
        evidence("ev-2", "corr-shared", "M05", "M05-a", "hidden_oracle"),
        evidence("ev-1", "corr-shared", "M01", "M01-a", "declared_adapter_event")
      ],
      precedence: PRECEDENCE
    });
    assert.equal(reversed.evidence.length, 1);
    assert.equal(reversed.evidence[0].evidence_id, "ev-2");
    assert.equal(reversed.evidence[0].metric_id, "M05");
  });

  // AC-E2-001-4. Two ways a denominator inflates without a sealed opportunity behind it,
  // both named in this ticket's forbidden scope. SSOT §5.1: secondary metric은 실제 기회가
  // 발생한 경우에만 채점한다; and an opportunity may never be created post-run.
  test("secondary-without-opportunity", async () => {
    const deriveMetricEligibility = await loadDerive();

    // A secondary opportunity with no primary behind it is not a scoring opportunity.
    const secondaryOnly = deriveMetricEligibility(
      derivationInput({
        opportunities: [
          opportunity("M07-a", "M07", "secondary"),
          opportunity("M07-b", "M07", "secondary")
        ],
        evidence: [
          evidence("ev-1", "corr-1", "M07", "M07-a"),
          evidence("ev-2", "corr-2", "M07", "M07-b")
        ]
      })
    );
    const orphan = row(secondaryOnly, "M07");
    assert.equal(orphan.state, "NOT_OBSERVED");
    assert.equal(orphan.reason, "SECONDARY_WITHOUT_OPPORTUNITY");
    assert.equal(orphan.opportunity_count, 0);
    assert.deepEqual(orphan.opportunity_ids, []);
    assert.deepEqual(secondaryOnly.eligible_metric_ids, []);

    // Control: with one evidenced primary, the same secondary does count, so a secondary is
    // deferred to a real opportunity rather than discarded outright.
    const withPrimary = deriveMetricEligibility(
      derivationInput({
        opportunities: [
          opportunity("M07-a", "M07", "secondary"),
          opportunity("M07-p", "M07", "primary")
        ],
        evidence: [
          evidence("ev-1", "corr-1", "M07", "M07-a"),
          evidence("ev-2", "corr-2", "M07", "M07-p")
        ]
      })
    );
    const promoted = row(withPrimary, "M07");
    assert.equal(promoted.state, "SCORED");
    assert.equal(promoted.reason, "OBSERVED");
    assert.equal(promoted.opportunity_count, 2);
    assert.deepEqual(promoted.opportunity_ids, ["M07-a", "M07-p"]);

    // Evidence naming an opportunity that was never sealed does not create one after the
    // run. The unsealed reference is reported and credits nothing.
    const unsealed = deriveMetricEligibility(
      derivationInput({
        opportunities: [opportunity("M08-a", "M08", "primary")],
        evidence: [
          evidence("ev-1", "corr-1", "M08", "M08-a"),
          evidence("ev-2", "corr-2", "M08", "M08-invented")
        ]
      })
    );
    const partial = row(unsealed, "M08");
    assert.equal(partial.state, "NOT_OBSERVED");
    assert.equal(partial.reason, "BELOW_MINIMUM_OPPORTUNITIES");
    assert.equal(partial.opportunity_count, 1);
    assert.deepEqual(partial.opportunity_ids, ["M08-a"]);
    assert.equal(unsealed.reasons.includes("UNSEALED_OPPORTUNITY M08-invented"), true);
    assert.deepEqual(unsealed.eligible_metric_ids, []);
  });

  // AC-E2-001-5. SSOT §9.2: UNAVAILABLE은 adapter가 관찰할 수 없다는 뜻이고 관련 metric은
  // NOT OBSERVED다. Adapter coverage is not operator capability, so the block keeps its own
  // reason instead of collapsing into a shortfall the operator could have closed.
  test("unavailable-adapter", async () => {
    const deriveMetricEligibility = await loadDerive();
    const observed = observedPair("M06", "r");
    const blocked = [
      { event_group: "retrieval_memory", status: "UNAVAILABLE", blocked_metric_ids: ["M06"] }
    ];

    const derivation = deriveMetricEligibility(
      derivationInput({ ...observed, adapter_capabilities: blocked })
    );
    const unavailable = row(derivation, "M06");
    assert.equal(unavailable.state, "NOT_OBSERVED");
    assert.equal(unavailable.reason, "ADAPTER_UNAVAILABLE");

    // Never a zero, and never a shortfall the operator owns.
    assert.equal(Object.hasOwn(unavailable, "raw_value"), false);
    assert.equal(Object.hasOwn(unavailable, "normalized_value"), false);
    assert.equal(unavailable.state === "SCORED", false);
    assert.deepEqual(derivation.eligible_metric_ids, []);
    assert.equal(derivation.eligible_metric_count, 0);
    assert.equal(derivation.reasons.includes("ADAPTER_UNAVAILABLE M06"), true);

    // Control: the identical evidence under any non-UNAVAILABLE status is eligible, so the
    // block is the adapter status and not the shape of the input.
    const bestEffort = deriveMetricEligibility(
      derivationInput({
        ...observed,
        adapter_capabilities: [
          { event_group: "retrieval_memory", status: "BEST_EFFORT", blocked_metric_ids: ["M06"] }
        ]
      })
    );
    assert.equal(row(bestEffort, "M06").state, "SCORED");
    assert.deepEqual(bestEffort.eligible_metric_ids, ["M06"]);

    // The adapter reason survives where a second reason also applies. A blocked metric that
    // additionally has no sealed opportunity still reports the block, because reporting
    // NO_OPPORTUNITY there would name the operator for the adapter's gap.
    const alsoAbsent = deriveMetricEligibility(
      derivationInput({ adapter_capabilities: blocked })
    );
    assert.equal(row(alsoAbsent, "M06").reason, "ADAPTER_UNAVAILABLE");
    assert.equal(row(alsoAbsent, "M06").state, "NOT_OBSERVED");
    assert.equal(row(alsoAbsent, "M07").reason, "NO_OPPORTUNITY");
  });
});
