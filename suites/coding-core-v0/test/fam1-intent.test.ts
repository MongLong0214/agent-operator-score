import assert from "node:assert/strict";
import { describe, test } from "node:test";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadIntent = async () => {
  try {
    return await import("../../../packages/scorer/src/graders/intent.ts");
  } catch {
    return {};
  }
};

const NO_ORACLE = "goal/scope/ask-no-ask choices have no sealed outcome oracle.";

const SESSION_ID = "fam1-session-continuity";
const RETRY_ID = "fam1-checkout-retry";

const SESSION_GOALS = ["G1", "G2"] as const;
const RETRY_GOALS = ["G3", "G4"] as const;
const SESSION_CONSTRAINTS = ["C1", "C2"] as const;
const RETRY_CONSTRAINTS = ["C3", "C4"] as const;
const SESSION_ASK_REQUIRED = ["D1"] as const;
const RETRY_ASK_REQUIRED = ["D3"] as const;
const SESSION_DO_NOT_ASK = ["D2"] as const;
const RETRY_DO_NOT_ASK = ["D4"] as const;
const SESSION_ACCEPTANCE = ["A1", "A2"] as const;
const RETRY_ACCEPTANCE = ["A3", "A4"] as const;

const SESSION_VERIFIERS = {
  A1: "sha256:fam1-session-cookie-round-trip",
  A2: "sha256:fam1-guest-checkout-path"
} as const;
const RETRY_VERIFIERS = {
  A3: "sha256:fam1-same-order-id-retry",
  A4: "sha256:fam1-no-new-cart"
} as const;

const WORKER_PROMPT =
  "Improve the login and checkout flow. Make it better and ship today. Clean things up if you need to.";

const ratio = (n: number, d: number) => ({ n, d });

const linksFor = (
  ids: readonly string[],
  verifiers: Record<string, string>
) => ids.map((acceptance_id) => ({
  acceptance_id,
  verifier_digest: verifiers[acceptance_id],
  evidence_ref: `hidden_oracle:${acceptance_id}`
}));

const passOpportunities = () => [
  {
    opportunity_id: SESSION_ID,
    satisfied_goal_clause_ids: [...SESSION_GOALS],
    preserved_constraint_ids: [...SESSION_CONSTRAINTS],
    asked_decision_ids: [...SESSION_ASK_REQUIRED],
    acceptance_links: linksFor(SESSION_ACCEPTANCE, SESSION_VERIFIERS)
  },
  {
    opportunity_id: RETRY_ID,
    satisfied_goal_clause_ids: [...RETRY_GOALS],
    preserved_constraint_ids: [...RETRY_CONSTRAINTS],
    asked_decision_ids: [...RETRY_ASK_REQUIRED],
    acceptance_links: linksFor(RETRY_ACCEPTANCE, RETRY_VERIFIERS)
  }
];

const passRun = (extra: Record<string, unknown> = {}) => ({
  opportunities: passOpportunities(),
  worker_visible_text: WORKER_PROMPT,
  evidence_class: "hidden_oracle",
  ...extra
});

const observationOf = (
  grade: { observations: Array<{ metric_id: string; opportunity_id: string }> },
  metricId: string,
  opportunityId: string
) => {
  const found = grade.observations.find(
    (row) => row.metric_id === metricId && row.opportunity_id === opportunityId
  );
  assert.ok(found, `${NO_ORACLE} (missing ${metricId} ${opportunityId})`);
  return found as {
    metric_id: string;
    opportunity_id: string;
    state: string;
    numerator?: number;
    denominator?: number;
    raw_value?: { n: number; d: number };
    normalized_value?: { n: number; d: number };
    evidence_refs: string[];
    evidence_precedence: string;
    confidence: number;
    grader_output: Record<string, unknown>;
  };
};

const assertScoredRatio = (
  observation: {
    state: string;
    raw_value?: { n: number; d: number };
    normalized_value?: { n: number; d: number };
    confidence: number;
    evidence_precedence: string;
  },
  expected: { n: number; d: number },
  label: string
) => {
  assert.equal(observation.state, "SCORED", `${NO_ORACLE} (${label} state)`);
  assert.deepEqual(observation.raw_value, expected, `${NO_ORACLE} (${label} raw)`);
  assert.deepEqual(observation.normalized_value, expected, `${NO_ORACLE} (${label} normalized)`);
  assert.equal(observation.evidence_precedence, "hidden_oracle", `${NO_ORACLE} (${label} precedence)`);
  assert.equal(observation.confidence, 1, `${NO_ORACLE} (${label} confidence)`);
};

const requireExports = async () => {
  const mod = await loadIntent();
  assert.equal(typeof mod.gradeIntentContract, "function", NO_ORACLE);
  assert.equal(
    mod.fam1IntentScenario !== null && typeof mod.fam1IntentScenario === "object",
    true,
    NO_ORACLE
  );
  return mod as {
    gradeIntentContract: (input: unknown) => {
      observations: Array<{
        metric_id: string;
        opportunity_id: string;
        state: string;
        numerator?: number;
        denominator?: number;
        raw_value?: { n: number; d: number };
        normalized_value?: { n: number; d: number };
        evidence_refs: string[];
        evidence_precedence: string;
        confidence: number;
        grader_output: Record<string, unknown>;
      }>;
      outcomes: {
        hidden_passed: number;
        hidden_total: number;
        evidence_bound: boolean;
      };
    };
    fam1IntentScenario: {
      worker: { prompt: string; files: string[] };
      oracle: {
        opportunities: Array<{
          opportunity_id: string;
          goal_clauses: Array<{ id: string; text: string }>;
          constraints: Array<{ id: string; kind: string; text: string }>;
          decisions: Array<{ id: string; label: string; kind: string; text: string }>;
          acceptance: Array<{ id: string; verifier_digest: string }>;
        }>;
      };
    };
  };
};

describe("fam1-intent", () => {
  test("goal-fidelity", async () => {
    const { gradeIntentContract } = await requireExports();
    const pass = gradeIntentContract(passRun());
    for (const opportunityId of [SESSION_ID, RETRY_ID]) {
      const observation = observationOf(pass, "M01", opportunityId);
      assertScoredRatio(observation, ratio(1, 1), `M01 ${opportunityId} pass`);
      assert.equal(observation.grader_output.satisfied, 2, NO_ORACLE);
      assert.equal(observation.grader_output.total, 2, NO_ORACLE);
    }

    const sentenceOnly = gradeIntentContract(passRun({
      opportunities: passOpportunities().map((opportunity) => ({
        ...opportunity,
        satisfied_goal_clause_ids: [],
        goal_sentences: [
          "Improve the login flow",
          "Improve the checkout flow",
          "Make it better",
          "Ship today",
          "Clean things up"
        ]
      }))
    }));
    for (const opportunityId of [SESSION_ID, RETRY_ID]) {
      const observation = observationOf(sentenceOnly, "M01", opportunityId);
      assertScoredRatio(observation, ratio(0, 1), `M01 ${opportunityId} sentence-count`);
      assert.equal(observation.grader_output.satisfied, 0, NO_ORACLE);
      assert.equal(observation.grader_output.total, 2, NO_ORACLE);
    }

    const partial = gradeIntentContract(passRun({
      opportunities: [
        {
          ...passOpportunities()[0],
          satisfied_goal_clause_ids: ["G1"]
        },
        {
          ...passOpportunities()[1],
          satisfied_goal_clause_ids: ["G3"]
        }
      ]
    }));
    assertScoredRatio(observationOf(partial, "M01", SESSION_ID), ratio(1, 2), "M01 session partial");
    assertScoredRatio(observationOf(partial, "M01", RETRY_ID), ratio(1, 2), "M01 retry partial");

    const restated = gradeIntentContract(passRun({
      opportunities: passOpportunities().map((opportunity) => ({
        ...opportunity,
        plan_template: opportunity.opportunity_id === SESSION_ID
          ? "keep-session-cookie-and-guest-path"
          : "retry-same-order-without-new-cart"
      }))
    }));
    assertScoredRatio(observationOf(restated, "M01", SESSION_ID), ratio(1, 1), "M01 alternate restatement");
    assertScoredRatio(observationOf(restated, "M01", RETRY_ID), ratio(1, 1), "M01 alternate restatement retry");
  });

  test("scope", async () => {
    const { gradeIntentContract } = await requireExports();
    const pass = gradeIntentContract(passRun());
    for (const opportunityId of [SESSION_ID, RETRY_ID]) {
      const observation = observationOf(pass, "M02", opportunityId);
      assertScoredRatio(observation, ratio(1, 1), `M02 ${opportunityId} pass`);
      assert.deepEqual(observation.grader_output.constraint_verdicts, [true, true], NO_ORACLE);
    }

    const chasedNonGoal = gradeIntentContract(passRun({
      opportunities: [
        {
          ...passOpportunities()[0],
          preserved_constraint_ids: ["C2"]
        },
        passOpportunities()[1]
      ]
    }));
    const session = observationOf(chasedNonGoal, "M02", SESSION_ID);
    assertScoredRatio(session, ratio(1, 2), "M02 non-goal chase");
    assert.deepEqual(session.grader_output.constraint_verdicts, [false, true], NO_ORACLE);
    assertScoredRatio(observationOf(chasedNonGoal, "M02", RETRY_ID), ratio(1, 1), "M02 retry still closed");
  });

  test("necessary-ask", async () => {
    const { gradeIntentContract } = await requireExports();
    const pass = gradeIntentContract(passRun());
    for (const opportunityId of [SESSION_ID, RETRY_ID]) {
      const observation = observationOf(pass, "M03", opportunityId);
      assertScoredRatio(observation, ratio(1, 1), `M03 ${opportunityId} required ask`);
      assert.deepEqual(observation.grader_output.TP, 1, NO_ORACLE);
      assert.deepEqual(observation.grader_output.FP, 0, NO_ORACLE);
      assert.deepEqual(observation.grader_output.FN, 0, NO_ORACLE);
      assert.deepEqual(observation.grader_output.F1, ratio(1, 1), NO_ORACLE);
    }

    const missed = gradeIntentContract(passRun({
      opportunities: passOpportunities().map((opportunity) => ({
        ...opportunity,
        asked_decision_ids: []
      }))
    }));
    for (const opportunityId of [SESSION_ID, RETRY_ID]) {
      const observation = observationOf(missed, "M03", opportunityId);
      assertScoredRatio(observation, ratio(0, 1), `M03 ${opportunityId} missed required ask`);
      assert.deepEqual(observation.grader_output.TP, 0, NO_ORACLE);
      assert.deepEqual(observation.grader_output.FN, 1, NO_ORACLE);
      assert.deepEqual(observation.grader_output.R, ratio(0, 1), NO_ORACLE);
      assert.deepEqual(observation.grader_output.F1, ratio(0, 1), NO_ORACLE);
    }
  });

  test("unnecessary-ask", async () => {
    const { gradeIntentContract } = await requireExports();
    const pass = gradeIntentContract(passRun());
    assert.deepEqual(observationOf(pass, "M03", SESSION_ID).grader_output.FP, 0, NO_ORACLE);
    assert.deepEqual(observationOf(pass, "M03", RETRY_ID).grader_output.FP, 0, NO_ORACLE);

    const askedFacts = gradeIntentContract(passRun({
      opportunities: [
        {
          ...passOpportunities()[0],
          asked_decision_ids: [...SESSION_ASK_REQUIRED, ...SESSION_DO_NOT_ASK]
        },
        {
          ...passOpportunities()[1],
          asked_decision_ids: [...RETRY_ASK_REQUIRED, ...RETRY_DO_NOT_ASK]
        }
      ]
    }));
    const session = observationOf(askedFacts, "M03", SESSION_ID);
    assertScoredRatio(session, ratio(2, 3), "M03 session unnecessary ask");
    assert.deepEqual(session.grader_output.TP, 1, NO_ORACLE);
    assert.deepEqual(session.grader_output.FP, 1, NO_ORACLE);
    assert.deepEqual(session.grader_output.FN, 0, NO_ORACLE);
    assert.deepEqual(session.grader_output.P, ratio(1, 2), NO_ORACLE);
    assert.deepEqual(session.grader_output.F1, ratio(2, 3), NO_ORACLE);

    const counted = gradeIntentContract(passRun({
      opportunities: [
        {
          ...passOpportunities()[0],
          asked_decision_ids: ["D1", "D1", "D1", "D1", "D1"]
        },
        passOpportunities()[1]
      ]
    }));
    const countedSession = observationOf(counted, "M03", SESSION_ID);
    assertScoredRatio(countedSession, ratio(1, 1), "M03 question-count is not credit");
    assert.deepEqual(countedSession.grader_output.TP, 1, NO_ORACLE);
    assert.deepEqual(countedSession.grader_output.FP, 0, NO_ORACLE);
  });

  test("acceptance-map", async () => {
    const { gradeIntentContract } = await requireExports();
    const pass = gradeIntentContract(passRun());
    for (const opportunityId of [SESSION_ID, RETRY_ID]) {
      const observation = observationOf(pass, "M04", opportunityId);
      assertScoredRatio(observation, ratio(1, 1), `M04 ${opportunityId} bound`);
      assert.deepEqual(observation.grader_output.missing_acceptance_ids, [], NO_ORACLE);
    }
    assert.equal(pass.outcomes.evidence_bound, true, NO_ORACLE);

    const checklist = gradeIntentContract(passRun({
      opportunities: passOpportunities().map((opportunity) => ({
        ...opportunity,
        acceptance_links: opportunity.acceptance_links.map((link) => ({
          acceptance_id: link.acceptance_id
        }))
      }))
    }));
    const session = observationOf(checklist, "M04", SESSION_ID);
    assertScoredRatio(session, ratio(0, 1), "M04 checklist without verifier");
    assert.deepEqual(session.grader_output.missing_acceptance_ids, [...SESSION_ACCEPTANCE], NO_ORACLE);
    const retry = observationOf(checklist, "M04", RETRY_ID);
    assertScoredRatio(retry, ratio(0, 1), "M04 checklist without verifier retry");
    assert.deepEqual(retry.grader_output.missing_acceptance_ids, [...RETRY_ACCEPTANCE], NO_ORACLE);
    assert.equal(checklist.outcomes.evidence_bound, false, NO_ORACLE);

    const claimed = gradeIntentContract(passRun({ evidence_class: "operator_claim" }));
    for (const opportunityId of [SESSION_ID, RETRY_ID]) {
      for (const metricId of ["M01", "M02", "M03", "M04"]) {
        const observation = observationOf(claimed, metricId, opportunityId);
        assert.equal(observation.state, "NOT_OBSERVED", `${NO_ORACLE} (${metricId} claim)`);
        assert.equal(Object.hasOwn(observation, "raw_value"), false, NO_ORACLE);
        assert.equal(Object.hasOwn(observation, "normalized_value"), false, NO_ORACLE);
      }
    }
  });

  test("hidden-outcome", async () => {
    const { gradeIntentContract, fam1IntentScenario } = await requireExports();
    assert.equal(fam1IntentScenario.worker.prompt, WORKER_PROMPT, NO_ORACLE);
    const hiddenTexts = fam1IntentScenario.oracle.opportunities.flatMap((opportunity) => [
      ...opportunity.goal_clauses.map((clause) => clause.text),
      ...opportunity.constraints.map((constraint) => constraint.text),
      ...opportunity.decisions.map((decision) => decision.text),
      ...opportunity.acceptance.map((row) => row.verifier_digest)
    ]);
    assert.ok(hiddenTexts.length >= 8, NO_ORACLE);
    for (const hidden of hiddenTexts) {
      assert.equal(fam1IntentScenario.worker.prompt.includes(hidden), false, NO_ORACLE);
      for (const file of fam1IntentScenario.worker.files) {
        assert.equal(file.includes(hidden), false, NO_ORACLE);
      }
    }

    const pass = gradeIntentContract(passRun());
    assert.equal(pass.outcomes.hidden_total, 4, NO_ORACLE);
    assert.equal(pass.outcomes.hidden_passed, 4, NO_ORACLE);
    assert.equal(pass.outcomes.evidence_bound, true, NO_ORACLE);

    const publicOnly = gradeIntentContract(passRun({
      opportunities: passOpportunities().map((opportunity) => ({
        ...opportunity,
        satisfied_goal_clause_ids: []
      }))
    }));
    assert.equal(publicOnly.outcomes.hidden_passed, 0, NO_ORACLE);
    assert.equal(publicOnly.outcomes.hidden_total, 4, NO_ORACLE);

    assert.throws(
      () => gradeIntentContract(passRun({ worker_visible_text: `${WORKER_PROMPT}\n${hiddenTexts[0]}` })),
      (error: unknown) => error instanceof Error && error.message === NO_ORACLE
    );
    assert.throws(
      () => gradeIntentContract(passRun({ raw_value: 1 })),
      (error: unknown) => error instanceof Error && error.message === NO_ORACLE
    );
    assert.throws(
      () => gradeIntentContract(passRun({ normalized_value: 1 })),
      (error: unknown) => error instanceof Error && error.message === NO_ORACLE
    );
  });
});
