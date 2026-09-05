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
import { mintOperatorEvent } from "../../lib/operator-events.mjs";
import { routeOracleDigest } from "../../lib/routing-oracle.mjs";
import { readFileSync } from "node:fs";
import { sha256Bytes } from "../../lib/digest.mjs";

const OPERATOR_SECRET = "operator-583a".repeat(8);
const INSTRUMENT_SECRET = "instrument-583b".repeat(8);
const RUN = "run-583-reliance";

const journal = () => {
  const entries = [];
  let head = null;
  return {
    entries,
    record: (entry, nextHead) => {
      if (entry !== null) entries.push(structuredClone(entry));
      head = structuredClone(nextHead);
    },
    read: () => entries.map((entry) => structuredClone(entry)),
    readHead: () => head === null ? null : structuredClone(head)
  };
};

const operator = (kind, opportunity, confidence, evidence = ["evidence-1"]) => mintOperatorEvent({
  run_id: RUN,
  source: "interactive-tty",
  decision_type: kind === "initial" ? "initial.judgment" : kind === "inspect" ? "checkpoint.observe" : "advice.response",
  construct_cell_id: "C3.RA.01",
  opportunity_id: `opp-${opportunity}`,
  challenge: { kind, opportunity },
  value: { kind, opportunity, confidence },
  named_evidence_ids: evidence,
  reported_confidence: confidence,
  state_revision: kind === "initial" ? 1 : kind === "inspect" ? 2 : 3,
  ...(kind === "initial" ? { proactive_delegation: "DELEGATE" } : {}),
  created_at: "2026-09-05T00:00:00Z"
}, { secret: OPERATOR_SECRET, now: new Date("2026-09-05T00:00:00Z") });

const traceFor = (log) => createRelianceTrace({
  run_id: RUN,
  operator_secret: OPERATOR_SECRET,
  instrument_secret: INSTRUMENT_SECRET,
  journal: log
});

const familyOfTaskForm = (taskFormId) => /^form-fam-([2-6])$/u.exec(taskFormId)?.[1] ? `FAM-${/^form-fam-([2-6])$/u.exec(taskFormId)[1]}` : null;
const deriveFor = (log) => deriveRelianceProfile({
  run_id: RUN,
  operator_secret: OPERATOR_SECRET,
  instrument_secret: INSTRUMENT_SECRET,
  journal: log,
  taskFormFamilyOf: familyOfTaskForm
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
  const trace = traceFor(log);
  const initialEvent = operator("initial", "cair-1", 0.2);
  const finalEvent = operator("final", "cair-1", 0.8);
  trace.commitInitial({
    opportunity_id: "rel-cair-1",
    operator_opportunity_id: "opp-cair-1",
    task_form_id: "form-fam-3",
    operator_event: initialEvent,
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
  trace.recordInspection({ opportunity_id: "rel-cair-1", observed: true, operator_event: operator("inspect", "cair-1", 0.2) });
  trace.recordFinal({ opportunity_id: "rel-cair-1", action: "adopt", operator_event: finalEvent });
  trace.recordOutcome({
    opportunity_id: "rel-cair-1",
    initial_correct: false,
    initial_value_digest: initialEvent.value_digest,
    final_correct: true,
    final_value_digest: finalEvent.value_digest,
    verified_outcome_evidence_ids: ["outcome-cair-1"]
  });

  const derived = deriveFor(log);
  assert.equal(derived.opportunities[0].initial.correct, false);
  assert.equal(derived.opportunities[0].advice.correct, true);
  assert.equal(derived.opportunities[0].final.correct, true);
  assert.deepEqual(derived.profile.metrics.cair.eligible_opportunity_ids, ["rel-cair-1"]);
  assert.deepEqual(derived.profile.metrics.cair.opportunity_ids, ["rel-cair-1"]);
  assert.equal(derived.profile.metrics.cair.status, "WITHHELD", "one eligible opportunity preserves the raw case but not a rate");
});

test("a non-canonical observation is refused with the reliance error vocabulary", () => {
  assert.throws(
    () => relianceTraceEventDigest({ payload: { accidental_undefined: undefined } }, INSTRUMENT_SECRET),
    /AOS_RELIANCE_CANONICAL_INPUT/
  );
});

test("every metric-bearing fact is bound to the attested slot that supplies it", () => {
  const log = journal();
  const trace = traceFor(log);
  const initial = {
    opportunity_id: "rel-bound-facts",
    operator_opportunity_id: "opp-bound-facts",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "other-opportunity", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("bound-facts") },
    forcing: forcing()
  };

  assert.throws(
    () => trace.commitInitial(initial),
    /AOS_RELIANCE_OPERATOR_EVENT_OPPORTUNITY/,
    "a pre-advice operator commitment belongs to this opportunity, not any opportunity that later reuses it"
  );

  const matched = { ...initial, operator_event: operator("initial", "bound-facts", 0.2) };
  trace.commitInitial(matched);
  trace.revealAdvice({ opportunity_id: "rel-bound-facts", proposal_evidence_digest: digest("a") });
  assert.throws(
    () => trace.recordOracle({
      opportunity_id: "rel-bound-facts",
      advice: { correct: true, error_type: "none", domain: "routing", evidence_digest: digest("b") }
    }),
    /AOS_RELIANCE_ADVICE_REVEAL_BINDING/,
    "the hidden oracle must grade the proposal that was revealed"
  );
  assert.throws(
    () => trace.commitInitial({
      ...matched,
      opportunity_id: "rel-reused-event",
      operator_opportunity_id: "opp-bound-facts"
    }),
    /AOS_RELIANCE_OPERATOR_EVENT_REUSED/,
    "one authenticated operator event cannot become the pre-advice commitment for a second opportunity"
  );

  const outcomeLog = journal();
  const outcomeTrace = traceFor(outcomeLog);
  const initialEvent = operator("initial", "outcome-bound", 0.2);
  const finalEvent = operator("final", "outcome-bound", 0.8);
  outcomeTrace.commitInitial({
    opportunity_id: "rel-outcome-bound",
    operator_opportunity_id: "opp-outcome-bound",
    task_form_id: "form-fam-3",
    operator_event: initialEvent,
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("outcome-bound") },
    forcing: forcing()
  });
  outcomeTrace.revealAdvice({ opportunity_id: "rel-outcome-bound", proposal_evidence_digest: digest("c") });
  outcomeTrace.recordOracle({ opportunity_id: "rel-outcome-bound", advice: { correct: true, error_type: "none", domain: "routing", evidence_digest: digest("c") } });
  outcomeTrace.recordInspection({ opportunity_id: "rel-outcome-bound", observed: true, operator_event: operator("inspect", "outcome-bound", 0.2) });
  outcomeTrace.recordFinal({ opportunity_id: "rel-outcome-bound", action: "adopt", operator_event: finalEvent });
  assert.throws(
    () => outcomeTrace.recordOutcome({
      opportunity_id: "rel-outcome-bound",
      initial_correct: false,
      initial_value_digest: digest("f"),
      final_correct: true,
      final_value_digest: finalEvent.value_digest,
      verified_outcome_evidence_ids: ["outcome-bound"]
    }),
    /AOS_RELIANCE_OUTCOME_COMMITMENT_BINDING/,
    "a post-advice verdict cannot grade an initial value that the pre-advice operator event did not commit"
  );
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
  taskFormId = "form-fam-3",
  errorType = "systematic",
  adviceValue = undefined,
  forcingValue = forcing(),
  inspectionObserved = true,
  initialConfidence = initialCorrect ? 0.9 : 0.1,
  finalConfidence = finalCorrect ? 0.8 : 0.9
}) => {
  const initialEvent = operator("initial", id, initialConfidence, [`initial-${id}`]);
  const finalEvent = operator("final", id, finalConfidence, [`final-${id}`]);
  trace.commitInitial({
    opportunity_id: `rel-${id}`,
    operator_opportunity_id: `opp-${id}`,
    task_form_id: taskFormId,
    operator_event: initialEvent,
    delegation: { chosen: true, oracle_expected_value: expected, route_oracle: routeOracle(id) },
    forcing: forcingValue,
    ...(choice === undefined ? {} : { choice_independence: choice })
  });
  trace.revealAdvice({ opportunity_id: `rel-${id}`, proposal_evidence_digest: digest("e") });
  trace.recordOracle({
    opportunity_id: `rel-${id}`,
    advice: adviceValue ?? {
      correct: adviceCorrect,
      error_type: adviceCorrect ? "none" : errorType,
      domain: "routing",
      evidence_digest: digest("e")
    }
  });
  trace.recordInspection(inspectionObserved
    ? { opportunity_id: `rel-${id}`, observed: true, operator_event: operator("inspect", id, initialConfidence, [`inspection-${id}`]) }
    : { opportunity_id: `rel-${id}`, observed: false });
  trace.recordFinal({ opportunity_id: `rel-${id}`, action, operator_event: finalEvent });
  return trace.recordOutcome({
    opportunity_id: `rel-${id}`,
    initial_correct: initialCorrect,
    initial_value_digest: initialEvent.value_digest,
    final_correct: finalCorrect,
    final_value_digest: finalEvent.value_digest,
    verified_outcome_evidence_ids: [`outcome-${id}`]
  });
};

test("append validates completed v3 events before the append-only journal records them", () => {
  const cases = [
    ["forcing properties", { forcingValue: { ...forcing(), unexpected: true } }],
    ["advice properties", { adviceValue: { correct: true, error_type: "none", domain: "routing", evidence_digest: digest("e"), unexpected: true } }],
    ["task form length", { taskFormId: "f".repeat(129) }]
  ];
  for (const [id, override] of cases) {
    const log = journal();
    assert.throws(
      () => recordOpportunity(traceFor(log), {
        id: `schema-${id.replaceAll(" ", "-")}`,
        initialCorrect: false,
        adviceCorrect: true,
        finalCorrect: true,
        action: "adopt",
        ...override
      }),
      /AOS_RELIANCE_EVENT_SCHEMA_INVALID/,
      `${id} is refused before it can make a completed trace permanently underivable`
    );
    assert.equal(log.entries.length, 5, `${id} leaves the journal at the last derivable prefix`);
  }
});

test("an append validates its existing prefix once instead of replaying it", () => {
  const persisted = journal();
  recordOpportunity(traceFor(persisted), {
    id: "verified-prefix",
    initialCorrect: false,
    adviceCorrect: true,
    finalCorrect: true,
    action: "adopt"
  });
  let prefixValidationReads = 0;
  const reopenedJournal = {
    record: persisted.record,
    read: () => persisted.entries.map((entry) => {
      const copy = { ...entry };
      Object.defineProperty(copy, "payload", {
        enumerable: true,
        get: () => {
          prefixValidationReads += 1;
          return structuredClone(entry.payload);
        }
      });
      return copy;
    }),
    readHead: persisted.readHead
  };
  const trace = createRelianceTrace({
    run_id: RUN,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET,
    journal: reopenedJournal
  });
  const validationsAfterOpen = prefixValidationReads;
  assert.ok(validationsAfterOpen > 0, "opening the trace validates the persisted prefix");
  for (let index = 0; index < 4; index += 1) {
    recordOpportunity(trace, {
      id: `cached-prefix-${index}`,
      initialCorrect: false,
      adviceCorrect: true,
      finalCorrect: true,
      action: "adopt"
    });
  }
  assert.equal(prefixValidationReads, validationsAfterOpen, "the existing six-entry prefix is validated once; each of 24 appends checks only its signed head and candidate entry");
  assert.equal(persisted.entries.length, 30);
});

test("the complete behavioural profile keeps CAIR, CSR, over/under reliance, delegation, adoption, choice, and calibration separate", () => {
  const log = journal();
  const trace = traceFor(log);
  const baseCases = [
    ["cair-good-a", false, true, true, "adopt", "BENEFICIAL"],
    ["cair-good-b", false, true, true, "adopt", "BENEFICIAL"],
    ["cair-reject-a", false, true, false, "reject", "BENEFICIAL"],
    ["cair-reject-b", false, true, false, "reject", "BENEFICIAL"],
    ["csr-good-a", true, false, true, "reject", "HARMFUL"],
    ["csr-good-b", true, false, true, "reject", "HARMFUL"],
    ["csr-adopt-a", true, false, false, "adopt", "HARMFUL"],
    ["csr-adopt-b", true, false, false, "adopt", "HARMFUL"]
  ];
  const cases = [...baseCases, ...baseCases.map(([id, ...rest]) => [`${id}-repeat`, ...rest])];
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
        pair_id: `pair-${Math.floor(index / 2) + 1}`,
        current_evidence_digest: digest(String(Math.floor(index / 2) + 1)),
        unrelated_prior_ai_error: index % 2 === 1
      },
      taskFormId: `form-fam-${(index % 4) + 2}`,
      errorType: index % 2 === 0 ? "systematic" : "omission"
    });
  }

  const derived = deriveFor(log);
  const metrics = derived.profile.metrics;
  assert.equal(derived.opportunities.length, 16);
  for (const id of ["cair", "csr", "overreliance", "underreliance", "switch_gain", "switch_harm", "delegation_regret", "adoption_quality", "choice_independence", "confidence_calibration"]) {
    assert.equal(metrics[id].status, "ISSUED", `${id} has enough independently replayed cases`);
  }
  assert.deepEqual([metrics.cair.value, metrics.csr.value], [0.5, 0.5], "same final correctness with different initial state remains two constructs");
  assert.deepEqual([metrics.overreliance.value, metrics.underreliance.value], [0.5, 0.5], "over and under reliance are not netted away");
  assert.deepEqual([metrics.switch_gain.value, metrics.switch_harm.value], [0.25, 0.25]);
  assert.equal(metrics.delegation_regret.value, 0.5, "proactive delegation is evaluated against its own pre-advice oracle");
  assert.equal(metrics.adoption_quality.value, 0.5, "deliberative adoption remains a separate conditional response measure");
  assert.equal(metrics.choice_independence.value, 1, "four paired conditions preserve both delegation and action");
  assert.equal(metrics.confidence_calibration.observation_count, 32);
  assert.notEqual(metrics.confidence_calibration.discrimination, null, "calibration does not pretend discrimination was observed when it was not");
  assert.equal(metrics.confidence_calibration.brier_score > 0, true, "the profile reports Brier loss rather than rewarding raw confidence");
});

test("a second initial after advice cannot count as an independent judgment", () => {
  const log = journal();
  const trace = traceFor(log);
  trace.commitInitial({
    opportunity_id: "rel-ordered",
    operator_opportunity_id: "opp-ordered",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "ordered", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("ordered") },
    forcing: forcing()
  });
  trace.revealAdvice({ opportunity_id: "rel-ordered", proposal_evidence_digest: digest("f") });
  assert.throws(() => trace.commitInitial({
    opportunity_id: "rel-ordered",
    operator_opportunity_id: "opp-ordered",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "ordered", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("ordered") },
    forcing: forcing()
  }), /AOS_RELIANCE_TRACE_ORDER/, "the missing property is pre-advice independence, not merely an expected field");
});

test("a pre-advice commitment rejects a bundled post-advice response and missing forcing provenance", () => {
  const payload = {
    opportunity_id: "rel-atomic",
    operator_opportunity_id: "opp-atomic",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "atomic", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("atomic") },
    forcing: forcing()
  };
  assert.throws(() => traceFor(journal()).commitInitial({
    ...payload,
    final: { action: "adopt" }
  }), /AOS_RELIANCE_PAYLOAD_BUNDLED/, "an atomic initial submission cannot smuggle the post-advice response that ordering is meant to separate");
  assert.throws(() => traceFor(journal()).commitInitial({
    ...payload,
    forcing: undefined
  }), /AOS_RELIANCE_FORCING_PROVENANCE/, "missing intervention provenance remains missing rather than becoming a default protocol");
});

test("a verifier withholding operator authority leaves the declaration unscored", () => {
  const unverified = { ...operator("initial", "unverified", 0.2), session_binding: digest("0") };
  assert.throws(() => traceFor(journal()).commitInitial({
    opportunity_id: "rel-unverified",
    operator_opportunity_id: "opp-unverified",
    task_form_id: "form-fam-3",
    operator_event: unverified,
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("unverified") },
    forcing: forcing()
  }), /AOS_RELIANCE_OPERATOR_EVENT_UNVERIFIED/, "a verifier's null is not collapsed to a subject-authored success or failure score");
});

test("a persisted trace has to retain the verifier binding that makes a reordered conclusion detectable", () => {
  const log = journal();
  const trace = traceFor(log);
  trace.commitInitial({
    opportunity_id: "rel-bound",
    operator_opportunity_id: "opp-bound",
    task_form_id: "form-fam-3",
    operator_event: operator("initial", "bound", 0.2),
    delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: routeOracle("bound") },
    forcing: forcing()
  });
  const real = log.entries[0].event_digest;
  log.entries[0].event_digest = digest("0");
  assert.throws(() => deriveFor(log), /AOS_RELIANCE_TRACE_BINDING/, "the HMAC binds the observed sequence, so an edited persisted trace does not authorize its own conclusion");
  log.entries[0].event_digest = real;
  assert.equal(log.entries[0].event_digest, relianceTraceEventDigest(log.entries[0], INSTRUMENT_SECRET), "the test changed the binding, not the evidence the binding covers");
});

test("low denominators and unpaired calibration facts withhold rather than become zero or a neutral midpoint", () => {
  const log = journal();
  const trace = traceFor(log);
  recordOpportunity(trace, { id: "thin", initialCorrect: false, adviceCorrect: true, finalCorrect: true, action: "adopt" });
  const derived = deriveFor(log);
  assert.equal(derived.profile.metrics.cair.status, "WITHHELD", "a single eligible CAIR case remains a raw case, not an issued rate");
  assert.equal(derived.profile.metrics.cair.value, null);
  assert.equal(derived.profile.metrics.cair.numerator, 1);
  assert.equal(derived.profile.metrics.cair.denominator, 1);
  assert.equal(derived.profile.metrics.choice_independence.status, "NOT_OBSERVED", "no paired opportunity is absence of an answer, not a low observed rate");
  assert.equal(derived.profile.metrics.confidence_calibration.status, "WITHHELD");
  assert.equal(derived.profile.metrics.confidence_calibration.observation_count, 2);
  for (const field of ["brier_score", "calibration_in_the_large", "confidence_accuracy_gap", "discrimination"]) {
    assert.equal(derived.profile.metrics.confidence_calibration[field], null, `${field} is not published as a precise calibration claim below the floor`);
  }
  assert.equal(derived.status, "PARTIALLY_NOT_OBSERVED", "a mixed run is not collapsed into WITHHELD when some metrics were never observed");
  assert.equal(Object.hasOwn(derived.profile, "status"), false, "the aggregate status has one envelope authority");
  assert.deepEqual(derived.profile.metric_status_counts, { ISSUED: 0, WITHHELD: 7, NOT_OBSERVED: 3 });
});

test("a signed head detects tail truncation, and refusals and non-inspection remain visible", () => {
  const log = journal();
  const trace = traceFor(log);
  recordOpportunity(trace, { id: "head", initialCorrect: false, adviceCorrect: true, finalCorrect: true, action: "adopt", inspectionObserved: false });
  assert.equal(deriveFor(log).opportunities[0].inspection.observed, false, "adoption without an inspection is recorded rather than made inexpressible");
  log.entries.splice(3);
  assert.throws(() => deriveFor(log), /AOS_RELIANCE_TRACE_TRUNCATED/, "the committed head exposes a journal tail that was omitted after it was signed");

  const refusalLog = journal();
  const refusalTrace = traceFor(refusalLog);
  recordOpportunity(refusalTrace, {
    id: "refusal",
    initialCorrect: false,
    adviceCorrect: true,
    finalCorrect: true,
    action: "adopt",
    forcingValue: { ...forcing(), skip_or_refusal: "REFUSAL", timeout: true }
  });
  const refused = deriveFor(refusalLog);
  assert.equal(refused.opportunities.length, 0, "a refused initial is not scored as an independent judgment");
  assert.deepEqual(refused.unscorable_opportunities, [{ opportunity_id: "rel-refusal", reason: "INITIAL_JUDGMENT_SKIPPED_OR_REFUSED", skip_or_refusal: "REFUSAL" }]);
  assert.ok(refused.operational_coverage.reasons.includes("INCOMPLETE_RELIANCE_OPPORTUNITIES"));
});

test("the complete operational floor gates all issued rates and reports each missing condition", () => {
  const log = journal();
  const trace = traceFor(log);
  for (let index = 0; index < 16; index += 1) {
    recordOpportunity(trace, {
      id: `all-correct-${index}`,
      initialCorrect: false,
      adviceCorrect: true,
      finalCorrect: true,
      action: "adopt",
      taskFormId: `form-fam-${(index % 4) + 2}`,
      choice: {
        pair_id: `pair-all-correct-${Math.floor(index / 2)}`,
        current_evidence_digest: digest(String(Math.floor(index / 2) + 1)),
        unrelated_prior_ai_error: index % 2 === 1
      }
    });
  }
  const derived = deriveFor(log);
  assert.equal(derived.profile.metrics.cair.status, "WITHHELD", "an all-correct-advice corpus does not issue CAIR just because its local denominator is large");
  assert.equal(derived.profile.metrics.cair.value, null);
  assert.ok(derived.operational_coverage.reasons.includes("INSUFFICIENT_INCORRECT_ADVICE_CONDITIONS"));
  assert.ok(derived.operational_coverage.reasons.includes("INSUFFICIENT_INCORRECT_ADVICE_ERROR_TYPES"));
});

test("an unanswered reliance metric is NOT_OBSERVED rather than a zero or a withheld rate", () => {
  const log = journal();
  traceFor(log);
  const derived = deriveFor(log);
  assert.equal(derived.status, "NOT_OBSERVED");
  assert.equal(derived.profile.metrics.cair.status, "NOT_OBSERVED");
  assert.equal(derived.profile.metrics.cair.value, null, "no independent/advice transition was observed, so CAIR has no numeric value");
  assert.equal(derived.profile.metrics.cair.denominator, 0);
});

test("neutral delegation expectations do not masquerade as observed non-regret", () => {
  const log = journal();
  const trace = traceFor(log);
  recordOpportunity(trace, { id: "neutral-route", initialCorrect: false, adviceCorrect: true, finalCorrect: true, action: "adopt", expected: "NEUTRAL" });
  const regret = deriveFor(log).profile.metrics.delegation_regret;
  assert.equal(regret.status, "NOT_OBSERVED", "a neutral oracle establishes neither necessary nor harmful delegation");
  assert.equal(regret.denominator, 0);
});

test("counterfactual: an unrelated prior AI error may not move a paired current decision", () => {
  const log = journal();
  const trace = traceFor(log);
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
  const row = deriveFor(log).profile.metrics.choice_independence;
  assert.equal(row.numerator, 0, "the pair changed its adoption decision when only unrelated prior error differed");
  assert.deepEqual(row.eligible_opportunity_ids, ["rel-choice-a", "rel-choice-b"]);
});

test("counterfactual: the same acceptance rate with different advice correctness has a different reliance profile", () => {
  const profileFor = (adviceCorrect) => {
    const log = journal();
    const trace = traceFor(log);
    for (const id of ["one", "two", "three", "four"]) {
      recordOpportunity(trace, {
        id: `acceptance-${adviceCorrect}-${id}`,
        initialCorrect: true,
        adviceCorrect,
        finalCorrect: false,
        action: "adopt"
      });
    }
    return deriveFor(log).profile.metrics;
  };
  const correctAdvice = profileFor(true);
  const incorrectAdvice = profileFor(false);
  assert.deepEqual([correctAdvice.adoption_quality.value, incorrectAdvice.adoption_quality.value], [null, null], "the short counterfactual preserves raw cases but does not issue a rate");
  assert.equal(correctAdvice.adoption_quality.numerator, 4, "adoption of correct advice is appropriate even though the final outcome in this counterfactual is wrong");
  assert.equal(incorrectAdvice.adoption_quality.numerator, 0, "the same adoption rate becomes inappropriate when the advice was wrong");
  assert.equal(incorrectAdvice.overreliance.numerator, 4, "harmful adoption remains visible rather than being renamed as raw acceptance");
});

test("counterfactual: high confidence followed by a wrong outcome worsens calibration and earns no confidence credit", () => {
  const profileFor = (confidence) => {
    const log = journal();
    const trace = traceFor(log);
    for (let index = 0; index < 16; index += 1) {
      const finalCorrect = index >= 12;
      const adviceCorrect = index >= 8;
      recordOpportunity(trace, {
        id: `cal-${confidence}-${index}`,
        initialCorrect: true,
        adviceCorrect,
        finalCorrect,
        action: finalCorrect ? "reject" : "adopt",
        initialConfidence: 0.5,
        finalConfidence: finalCorrect ? 0.5 : confidence,
        errorType: index % 2 === 0 ? "systematic" : "omission",
        taskFormId: `form-fam-${(index % 4) + 2}`,
        choice: {
          pair_id: `pair-cal-${Math.floor(index / 2)}`,
          current_evidence_digest: digest(String(Math.floor(index / 2) + 1)),
          unrelated_prior_ai_error: index % 2 === 1
        }
      });
    }
    return deriveFor(log).profile.metrics.confidence_calibration;
  };
  const cautious = profileFor(0.1);
  const certain = profileFor(0.9);
  assert.equal(certain.brier_score > cautious.brier_score, true, "wrong high confidence raises Brier loss");
  assert.equal(certain.value < cautious.value, true, "calibration quality falls; the raw confidence itself receives no credit");
});

test("the committed schema and floor state the operational release contract", () => {
  const schema = loadRelianceEventSchema();
  const opportunityFloor = loadRelianceOpportunityFloor();
  assert.equal(schema.properties.schema_id.const, "aos-reliance-event.v3");
  assert.deepEqual(schema.required.slice(0, 12), [
    "schema_id", "opportunity_id", "construct_cell_id", "task_form_id", "initial_operator_event_id",
    "forcing", "initial", "delegation", "advice", "inspection", "final", "verified_outcome_evidence_ids"
  ]);
  assert.deepEqual(schema.properties.forcing.required, ["forcing_protocol_id", "burden_interaction_count", "skip_or_refusal", "timeout", "interface"]);
  assert.equal(relianceEventSchemaDigest(), sha256Bytes(readFileSync(new URL("../../reliance-events/aos-reliance-event.v3.schema.json", import.meta.url))));
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
