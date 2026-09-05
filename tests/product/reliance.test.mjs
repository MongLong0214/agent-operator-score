import assert from "node:assert/strict";
import test from "node:test";

import {
  RELIANCE_CONFIDENCE_OBSERVATION_FLOOR,
  RELIANCE_OPPORTUNITY_FLOOR,
  createRelianceTrace,
  deriveRelianceProfile,
  loadRelianceEventSchema,
  loadRelianceOpportunityFloor,
  relianceEventSchemaDigest,
  relianceOpportunityFloorDigest,
  relianceTraceEventDigest
} from "../../lib/reliance.mjs";
import { routeOracleDigest } from "../../lib/routing-oracle.mjs";
import { readFileSync } from "node:fs";
import { sha256Bytes } from "../../lib/digest.mjs";

const SECRET = "583a".repeat(16);
const RUN = "run-583-reliance";

const journal = () => {
  const entries = [];
  return {
    entries,
    record: (entry) => entries.push(entry),
    read: () => entries.map((entry) => structuredClone(entry))
  };
};

const operator = (kind, opportunity, confidence, evidence = ["evidence-1"]) => ({
  schema_id: "aos-operator-event.v2",
  event_id: `operator-${kind}-${opportunity}`,
  run_id: RUN,
  producer: "operator",
  source: "interactive-tty",
  authority: "DIRECT_LOCAL",
  provenance: "DIRECT",
  confidence: "HIGH",
  decision_type: kind === "initial" ? "initial.judgment" : kind === "inspect" ? "checkpoint.observe" : "advice.response",
  construct_cell_id: "C3.RA.01",
  opportunity_id: `opp-${opportunity}`,
  challenge_digest: `sha256:${"a".repeat(64)}`,
  value_digest: `sha256:${"b".repeat(64)}`,
  named_evidence_ids: evidence,
  reported_confidence: confidence,
  state_revision: kind === "initial" ? 1 : 2,
  ...(kind === "initial" ? { proactive_delegation: "DELEGATE" } : {}),
  created_at: "2026-09-05T00:00:00.000Z"
});

const routeOracle = (id) => {
  const record = { route_id: id };
  return { ...record, route_oracle_digest: routeOracleDigest(record) };
};

// This fixture is observed intervention provenance.  It deliberately is not synthesized by the
// reliance module: production callers must provide what the instrument actually administered.
const forcing = () => ({
  forcing_protocol_id: "initial-judgment-before-advice.v1",
  burden_interaction_count: 1,
  skip_or_refusal: "NONE",
  timeout: false,
  interface: "interactive-tty"
});

test("an attested initial judgment before the advice is the evidence from which CAIR is replayed", () => {
  const log = journal();
  const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  trace.commitInitial({
    opportunity_id: "rel-cair-1",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "cair-1", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("cair-1") },
    forcing: forcing()
  });
  trace.revealAdvice({
    opportunity_id: "rel-cair-1",
    proposal_evidence_digest: `sha256:${"c".repeat(64)}`
  });
  trace.recordOracle({
    opportunity_id: "rel-cair-1",
    advice: { correct: true, error_type: "none", domain: "routing", evidence_digest: `sha256:${"c".repeat(64)}` }
  });
  trace.recordInspection({ opportunity_id: "rel-cair-1", operator_event: operator("inspect", "cair-1", 0.2) });
  trace.recordFinal({ opportunity_id: "rel-cair-1", action: "adopt", operator_event: operator("final", "cair-1", 0.8) });
  trace.recordOutcome({
    opportunity_id: "rel-cair-1",
    initial_correct: false,
    final_correct: true,
    verified_outcome_evidence_ids: ["outcome-cair-1"]
  });

  const derived = deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  assert.equal(derived.opportunities[0].initial.correct, false);
  assert.equal(derived.opportunities[0].advice.correct, true);
  assert.equal(derived.opportunities[0].final.correct, true);
  assert.deepEqual(derived.profile.metrics.cair.eligible_opportunity_ids, ["rel-cair-1"]);
  assert.deepEqual(derived.profile.metrics.cair.opportunity_ids, ["rel-cair-1"]);
  assert.equal(derived.profile.metrics.cair.status, "WITHHELD", "one eligible opportunity preserves the raw case but not a rate");
});

const digest = (letter) => `sha256:${letter.repeat(64)}`;

const recordOpportunity = (trace, {
  id,
  initialCorrect,
  adviceCorrect,
  finalCorrect,
  action,
  expected = "BENEFICIAL",
  choice = undefined,
  initialConfidence = initialCorrect ? 0.9 : 0.1,
  finalConfidence = finalCorrect ? 0.8 : 0.9
}) => {
  trace.commitInitial({
    opportunity_id: `rel-${id}`,
    task_form_id: "form-fam-3",
    operator_event: operator("initial", id, initialConfidence, [`initial-${id}`]),
    delegation: { chosen: true, oracle_expected_value: expected, route_oracle: routeOracle(id) },
    forcing: forcing(),
    ...(choice === undefined ? {} : { choice_independence: choice })
  });
  trace.revealAdvice({ opportunity_id: `rel-${id}`, proposal_evidence_digest: digest("d") });
  trace.recordOracle({
    opportunity_id: `rel-${id}`,
    advice: {
      correct: adviceCorrect,
      error_type: adviceCorrect ? "none" : "systematic",
      domain: "routing",
      evidence_digest: digest("e")
    }
  });
  trace.recordInspection({ opportunity_id: `rel-${id}`, operator_event: operator("inspect", id, initialConfidence, [`inspection-${id}`]) });
  trace.recordFinal({ opportunity_id: `rel-${id}`, action, operator_event: operator("final", id, finalConfidence, [`final-${id}`]) });
  trace.recordOutcome({
    opportunity_id: `rel-${id}`,
    initial_correct: initialCorrect,
    final_correct: finalCorrect,
    verified_outcome_evidence_ids: [`outcome-${id}`]
  });
};

test("the complete behavioural profile keeps CAIR, CSR, over/under reliance, delegation, adoption, choice, and calibration separate", () => {
  const log = journal();
  const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  const pairs = ["pair-1", "pair-2", "pair-3", "pair-4"];
  const cases = [
    ["cair-good-a", false, true, true, "adopt", "BENEFICIAL"],
    ["cair-good-b", false, true, true, "adopt", "BENEFICIAL"],
    ["cair-reject-a", false, true, false, "reject", "BENEFICIAL"],
    ["cair-reject-b", false, true, false, "reject", "BENEFICIAL"],
    ["csr-good-a", true, false, true, "reject", "HARMFUL"],
    ["csr-good-b", true, false, true, "reject", "HARMFUL"],
    ["csr-adopt-a", true, false, false, "adopt", "HARMFUL"],
    ["csr-adopt-b", true, false, false, "adopt", "HARMFUL"]
  ];
  for (const [index, row] of cases.entries()) {
    const [id, initialCorrect, adviceCorrect, finalCorrect, action, expected] = row;
    recordOpportunity(trace, {
      id,
      initialCorrect,
      adviceCorrect,
      finalCorrect,
      action,
      expected,
      choice: {
        pair_id: pairs[Math.floor(index / 2)],
        current_evidence_digest: digest(["1", "2", "3", "4"][Math.floor(index / 2)]),
        unrelated_prior_ai_error: index % 2 === 1
      }
    });
  }

  const derived = deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  const metrics = derived.profile.metrics;
  assert.equal(derived.opportunities.length, 8);
  for (const id of ["cair", "csr", "overreliance", "underreliance", "switch_gain", "switch_harm", "delegation_regret", "adoption_quality", "choice_independence", "confidence_calibration"]) {
    assert.equal(metrics[id].status, "ISSUED", `${id} has enough independently replayed cases`);
  }
  assert.deepEqual([metrics.cair.value, metrics.csr.value], [0.5, 0.5], "same final correctness with different initial state remains two constructs");
  assert.deepEqual([metrics.overreliance.value, metrics.underreliance.value], [0.5, 0.5], "over and under reliance are not netted away");
  assert.deepEqual([metrics.switch_gain.value, metrics.switch_harm.value], [0.25, 0.25]);
  assert.equal(metrics.delegation_regret.value, 0.5, "proactive delegation is evaluated against its own pre-advice oracle");
  assert.equal(metrics.adoption_quality.value, 0.5, "deliberative adoption remains a separate conditional response measure");
  assert.equal(metrics.choice_independence.value, 1, "four paired conditions preserve both delegation and action");
  assert.equal(metrics.confidence_calibration.observation_count, 16);
  assert.notEqual(metrics.confidence_calibration.discrimination, null, "calibration does not pretend discrimination was observed when it was not");
  assert.equal(metrics.confidence_calibration.brier_score > 0, true, "the profile reports Brier loss rather than rewarding raw confidence");
});

test("a second initial after advice cannot count as an independent judgment", () => {
  const log = journal();
  const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  trace.commitInitial({
    opportunity_id: "rel-ordered",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "ordered", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("ordered") },
    forcing: forcing()
  });
  trace.revealAdvice({ opportunity_id: "rel-ordered", proposal_evidence_digest: digest("f") });
  assert.throws(() => trace.commitInitial({
    opportunity_id: "rel-ordered",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "ordered", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("ordered") },
    forcing: forcing()
  }), /AOS_RELIANCE_TRACE_ORDER/, "the missing property is pre-advice independence, not merely an expected field");
});

test("a pre-advice commitment rejects a bundled post-advice response and missing forcing provenance", () => {
  const payload = {
    opportunity_id: "rel-atomic",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "atomic", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("atomic") },
    forcing: forcing()
  };
  assert.throws(() => createRelianceTrace({ run_id: RUN, secret: SECRET, journal: journal(), verifyOperatorEvent: () => true }).commitInitial({
    ...payload,
    final: { action: "adopt" }
  }), /AOS_RELIANCE_PAYLOAD_BUNDLED/, "an atomic initial submission cannot smuggle the post-advice response that ordering is meant to separate");
  assert.throws(() => createRelianceTrace({ run_id: RUN, secret: SECRET, journal: journal(), verifyOperatorEvent: () => true }).commitInitial({
    ...payload,
    forcing: undefined
  }), /AOS_RELIANCE_FORCING_PROVENANCE/, "missing intervention provenance remains missing rather than becoming a default protocol");
});

test("a verifier withholding operator authority leaves the declaration unscored", () => {
  assert.throws(() => createRelianceTrace({ run_id: RUN, secret: SECRET, journal: journal(), verifyOperatorEvent: () => null }).commitInitial({
    opportunity_id: "rel-unverified",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "unverified", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("unverified") },
    forcing: forcing()
  }), /AOS_RELIANCE_OPERATOR_EVENT_UNVERIFIED/, "a verifier's null is not collapsed to a subject-authored success or failure score");
});

test("a persisted trace has to retain the verifier binding that makes a reordered conclusion detectable", () => {
  const log = journal();
  const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  trace.commitInitial({
    opportunity_id: "rel-bound",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "bound", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("bound") },
    forcing: forcing()
  });
  const real = log.entries[0].event_digest;
  log.entries[0].event_digest = digest("0");
  assert.throws(() => deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true }), /AOS_RELIANCE_TRACE_BINDING/, "the HMAC binds the observed sequence, so an edited persisted trace does not authorize its own conclusion");
  log.entries[0].event_digest = real;
  assert.equal(log.entries[0].event_digest, relianceTraceEventDigest(log.entries[0], SECRET), "the test changed the binding, not the evidence the binding covers");
});

test("low denominators and unpaired calibration facts withhold rather than become zero or a neutral midpoint", () => {
  const log = journal();
  const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  recordOpportunity(trace, { id: "thin", initialCorrect: false, adviceCorrect: true, finalCorrect: true, action: "adopt" });
  const derived = deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  assert.equal(derived.profile.metrics.cair.status, "WITHHELD", "a single eligible CAIR case remains a raw case, not an issued rate");
  assert.equal(derived.profile.metrics.cair.value, null);
  assert.equal(derived.profile.metrics.cair.numerator, 1);
  assert.equal(derived.profile.metrics.cair.denominator, 1);
  assert.equal(derived.profile.metrics.choice_independence.status, "NOT_OBSERVED", "no paired opportunity is absence of an answer, not a low observed rate");
  assert.equal(derived.profile.metrics.confidence_calibration.status, "WITHHELD");
  assert.equal(derived.profile.metrics.confidence_calibration.observation_count, 2);
});

test("an unanswered reliance metric is NOT_OBSERVED rather than a zero or a withheld rate", () => {
  const derived = deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: journal(), verifyOperatorEvent: () => true });
  assert.equal(derived.status, "NOT_OBSERVED");
  assert.equal(derived.profile.metrics.cair.status, "NOT_OBSERVED");
  assert.equal(derived.profile.metrics.cair.value, null, "no independent/advice transition was observed, so CAIR has no numeric value");
  assert.equal(derived.profile.metrics.cair.denominator, 0);
});

test("neutral delegation expectations do not masquerade as observed non-regret", () => {
  const log = journal();
  const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  recordOpportunity(trace, { id: "neutral-route", initialCorrect: false, adviceCorrect: true, finalCorrect: true, action: "adopt", expected: "NEUTRAL" });
  const regret = deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true }).profile.metrics.delegation_regret;
  assert.equal(regret.status, "NOT_OBSERVED", "a neutral oracle establishes neither necessary nor harmful delegation");
  assert.equal(regret.denominator, 0);
});

test("counterfactual: an unrelated prior AI error may not move a paired current decision", () => {
  const log = journal();
  const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
  for (const [id, action, previousError] of [["choice-a", "adopt", false], ["choice-b", "reject", true]]) {
    recordOpportunity(trace, {
      id,
      initialCorrect: false,
      adviceCorrect: true,
      finalCorrect: action === "adopt",
      action,
      choice: { pair_id: "pair-counterfactual", current_evidence_digest: digest("5"), unrelated_prior_ai_error: previousError }
    });
  }
  const row = deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true }).profile.metrics.choice_independence;
  assert.equal(row.numerator, 0, "the pair changed its adoption decision when only unrelated prior error differed");
  assert.deepEqual(row.eligible_opportunity_ids, ["rel-choice-a", "rel-choice-b"]);
});

test("counterfactual: the same acceptance rate with different advice correctness has a different reliance profile", () => {
  const profileFor = (adviceCorrect) => {
    const log = journal();
    const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
    for (const id of ["one", "two", "three", "four"]) {
      recordOpportunity(trace, {
        id: `acceptance-${adviceCorrect}-${id}`,
        initialCorrect: true,
        adviceCorrect,
        finalCorrect: false,
        action: "adopt"
      });
    }
    return deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true }).profile.metrics;
  };
  const correctAdvice = profileFor(true);
  const incorrectAdvice = profileFor(false);
  assert.equal(correctAdvice.adoption_quality.value, 1, "adoption of correct advice is appropriate even though the final outcome in this counterfactual is wrong");
  assert.equal(incorrectAdvice.adoption_quality.value, 0, "the same adoption rate becomes inappropriate when the advice was wrong");
  assert.equal(incorrectAdvice.overreliance.value, 1, "harmful adoption remains visible rather than being renamed as raw acceptance");
});

test("counterfactual: high confidence followed by a wrong outcome worsens calibration and earns no confidence credit", () => {
  const profileFor = (confidence) => {
    const log = journal();
    const trace = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true });
    for (const [index, id] of ["one", "two", "three", "four", "five", "six"].entries()) {
      const finalCorrect = index >= 4;
      recordOpportunity(trace, {
        id: `cal-${confidence}-${id}`,
        initialCorrect: true,
        adviceCorrect: false,
        finalCorrect,
        action: finalCorrect ? "reject" : "adopt",
        initialConfidence: 0.5,
        finalConfidence: finalCorrect ? 0.5 : confidence
      });
    }
    return deriveRelianceProfile({ run_id: RUN, secret: SECRET, journal: log, verifyOperatorEvent: () => true }).profile.metrics.confidence_calibration;
  };
  const cautious = profileFor(0.1);
  const certain = profileFor(0.9);
  assert.equal(certain.brier_score > cautious.brier_score, true, "wrong high confidence raises Brier loss");
  assert.equal(certain.value < cautious.value, true, "calibration quality falls; the raw confidence itself receives no credit");
});

test("the committed schema and floor state the operational release contract", () => {
  const schema = loadRelianceEventSchema();
  const opportunityFloor = loadRelianceOpportunityFloor();
  assert.equal(schema.properties.schema_id.const, "aos-reliance-event.v2");
  assert.deepEqual(schema.required.slice(0, 12), [
    "schema_id", "opportunity_id", "construct_cell_id", "task_form_id", "initial_operator_event_id",
    "forcing", "initial", "delegation", "advice", "inspection", "final", "verified_outcome_evidence_ids"
  ]);
  assert.deepEqual(schema.properties.forcing.required, ["forcing_protocol_id", "burden_interaction_count", "skip_or_refusal", "timeout", "interface"]);
  assert.equal(relianceEventSchemaDigest(), sha256Bytes(readFileSync(new URL("../../reliance-events/aos-reliance-event.v2.schema.json", import.meta.url))));
  assert.equal(relianceOpportunityFloorDigest(), sha256Bytes(readFileSync(new URL("../../reliance-events/opportunity-floor.v1.json", import.meta.url))));
  assert.equal(RELIANCE_OPPORTUNITY_FLOOR, 4);
  assert.equal(RELIANCE_CONFIDENCE_OBSERVATION_FLOOR, 12);
  assert.equal(Object.hasOwn(schema.properties, "explanation"), false, "explanation length is not a reliance evidence or scoring input");
  assert.deepEqual(opportunityFloor, {
    schema_id: "aos-reliance-opportunity-floor.v1",
    metric_eligible_opportunities: 4,
    planned_opportunities_per_cycle: 16,
    correct_advice_conditions: 8,
    incorrect_advice_conditions: 8,
    families_represented: 4,
    incorrect_advice_error_types: 2,
    choice_independence_pairs: 4,
    confidence_observations: 12
  });
});
