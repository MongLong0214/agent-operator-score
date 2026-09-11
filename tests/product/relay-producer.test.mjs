import assert from "node:assert/strict";
import test from "node:test";

import { createRelayCheckpoint } from "../../lib/checkpoint.mjs";
import { createAgentRelayProtocol } from "../../lib/relay.mjs";
import {
  RELIANCE_FORCING_PROTOCOL_ID,
  RELIANCE_INTERFACE,
  catalogueCoverage,
  gradeRelianceOutcome,
  preparedOpportunity,
  relianceOpportunities
} from "../../lib/relay-producer.mjs";
import { createRelianceTrace, deriveRelianceProfile, loadRelianceOpportunityFloor } from "../../lib/reliance.mjs";
import { scenarioParams } from "../../lib/suite-seed.mjs";

const OPERATOR_SECRET = "operator-key";
const INSTRUMENT_SECRET = "instrument-key";
const EXPIRES_AT = "2030-01-01T00:00:00Z";
const ROUTE_ORACLE = { route_id: "producer-route" };

const producedFor = (seed) => {
  const params = scenarioParams(seed);
  return relianceOpportunities({ seed: params.seed, params, expires_at: EXPIRES_AT, route_oracle: ROUTE_ORACLE });
};

const memoryCheckpoint = (sessionId) => {
  let state = null;
  const responses = new Map();
  return createRelayCheckpoint({
    session_id: sessionId,
    read: () => state,
    write: (next) => { state = structuredClone(next); },
    readResponse: (challengeId) => responses.get(challengeId) ?? null,
    writeResponse: (challengeId, bytes) => responses.set(challengeId, Buffer.from(bytes))
  });
};

const memoryJournal = () => {
  const entries = [];
  let head = null;
  return {
    record: (entry, nextHead) => { if (entry !== null) entries.push(structuredClone(entry)); head = structuredClone(nextHead); },
    read: () => structuredClone(entries),
    readHead: () => structuredClone(head)
  };
};

const responseBytes = (challenge, selected, { confidence = 0.7, ...rest } = {}) => Buffer.from(JSON.stringify({
  schema_id: "aos-agent-relay-response.v2",
  challenge_id: challenge.challenge_id,
  selected_option_ids: selected,
  operator_text: "I read the current record before answering.",
  reported_confidence: confidence,
  named_evidence_ids: ["evidence-1"],
  ...rest,
  relay: {
    source: "agent-relay",
    agent_runtime_digest: `sha256:${"b".repeat(64)}`,
    conversation_turn_id: "turn-1",
    attestation: "relay-declared-user-response",
    autonomous: false,
    submitted_at: "2026-09-11T00:00:00Z"
  }
}), "utf8");

const wrongOptionOf = (one) => one.action.initial_options
  .map((option) => option.option_id)
  .find((id) => !one.grading.correct_option_ids.includes(id));

/**
 * Administer every produced opportunity against the real protocol.
 *
 * `answer` decides what the simulated operator submits, so a test can describe an operator rather
 * than hand-build trace entries: an episode is only evidence here if it survived `prepare`,
 * `respond` and `recordOutcome` unmodified.
 */
const administer = (produced, answer) => {
  const sessionId = "producer-run";
  const checkpoint = memoryCheckpoint(sessionId);
  const journal = memoryJournal();
  const trace = createRelianceTrace({ run_id: sessionId, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET, journal });
  produced.forEach((one, index) => {
    const protocol = createAgentRelayProtocol({
      session_id: sessionId, checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET
    });
    protocol.prepare(preparedOpportunity(one));
    const initialChallenge = protocol.next();
    const { initial, final, inspected, action } = answer(one, index);
    const finalChallenge = protocol.respond(responseBytes(initialChallenge, initial));
    protocol.respond(responseBytes(finalChallenge, final, { inspected, final_action: action }));
    const mine = trace.entries().filter((entry) => entry.opportunity_id === one.reliance_opportunity_id);
    protocol.recordOutcome(gradeRelianceOutcome({
      opportunity: one,
      initial_selected_option_ids: initial,
      final_selected_option_ids: final,
      initial_value_digest: mine.find((entry) => entry.kind === "initial").payload.operator_event.value_digest,
      final_value_digest: mine.find((entry) => entry.kind === "final").payload.operator_event.value_digest
    }));
  });
  return { journal, trace };
};

test("the shipped catalogue meets every opportunity floor, recomputed from the contract file", () => {
  const floor = loadRelianceOpportunityFloor();
  const coverage = catalogueCoverage();
  assert.ok(coverage.opportunities >= floor.planned_opportunities_per_cycle, `${coverage.opportunities} opportunities cannot meet a floor of ${floor.planned_opportunities_per_cycle}`);
  assert.ok(coverage.correct_advice_conditions >= floor.correct_advice_conditions, "too few correct-advice conditions");
  assert.ok(coverage.incorrect_advice_conditions >= floor.incorrect_advice_conditions, "too few incorrect-advice conditions");
  assert.ok(coverage.families.length >= floor.families_represented, "too few families represented");
  assert.ok(coverage.choice_independence_pairs >= floor.choice_independence_pairs, "too few choice-independence pairs");
  assert.ok(coverage.confidence_observations >= floor.confidence_observations, "too few confidence observations");
});

test("no produced opportunity binds a form the reliance coverage cannot count", () => {
  const produced = producedFor("1");
  // `lib/reliance.mjs` counts a family only when it matches /^FAM-[2-6]$/. A FAM-1 episode is not a
  // wider measurement: it lands in `unknownTaskForms`, raises TASK_FORM_FAMILY_UNBOUND, and that one
  // unmet reason withholds all ten metrics -- so the answered run reports as an unanswered one.
  for (const one of produced) {
    assert.match(one.task_form_id, /^FAM-[2-6]$/u, `${one.reliance_opportunity_id} binds ${one.task_form_id}`);
  }
});

test("every produced opportunity is one the protocol accepts, with its advice absent from the initial challenge", () => {
  const produced = producedFor("2a");
  assert.equal(produced.length, catalogueCoverage().opportunities);
  for (const one of produced) {
    const checkpoint = memoryCheckpoint("producer-accepts");
    const protocol = createAgentRelayProtocol({
      session_id: "producer-accepts", checkpoint,
      trace: createRelianceTrace({ run_id: "producer-accepts", operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET, journal: memoryJournal() }),
      operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET
    });
    const challenge = protocol.prepare(preparedOpportunity(one));
    assert.equal(challenge.phase, "INITIAL_JUDGMENT", one.reliance_opportunity_id);
    assert.equal(challenge.advice, undefined, `${one.reliance_opportunity_id} exposed its advice in the initial challenge`);
    assert.ok(challenge.action.options.length >= 2, `${one.reliance_opportunity_id} offers fewer than two options`);
    assert.equal(one.forcing.forcing_protocol_id, RELIANCE_FORCING_PROTOCOL_ID);
    assert.equal(one.forcing.interface, RELIANCE_INTERFACE);
  }
});

test("the protocol half a challenge is prepared from carries no grading material", () => {
  const one = producedFor("3")[0];
  const prepared = preparedOpportunity(one);
  assert.equal(prepared.grading, undefined, "the graded option set reached the prepared opportunity");
  assert.ok(one.grading.correct_option_ids.length > 0, "the producer kept the graded option set for the verifier");
});

test("a paired question produces two episodes that differ only in the prior-error condition", () => {
  const produced = producedFor("4");
  const byPair = new Map();
  for (const one of produced.filter((entry) => entry.choice_independence !== undefined)) {
    const bucket = byPair.get(one.choice_independence.pair_id) ?? [];
    bucket.push(one);
    byPair.set(one.choice_independence.pair_id, bucket);
  }
  assert.equal(byPair.size, catalogueCoverage().choice_independence_pairs);
  for (const [pairId, members] of byPair) {
    assert.equal(members.length, 2, `${pairId} is not a pair`);
    const [left, right] = members;
    // `choiceCases` accepts a pair only when both members carry one current evidence digest and
    // the two prior-error conditions. Either half alone leaves the pair incomplete.
    assert.equal(left.choice_independence.current_evidence_digest, right.choice_independence.current_evidence_digest, `${pairId} members rest on different evidence`);
    assert.deepEqual(
      [left.choice_independence.unrelated_prior_ai_error, right.choice_independence.unrelated_prior_ai_error].sort(),
      [false, true],
      `${pairId} does not vary the unrelated prior error`
    );
    assert.equal(left.advice.oracle.correct, right.advice.oracle.correct, `${pairId} asks one question under two advice conditions`);
  }
});

test("the correct/incorrect advice split is exact on every seed, and which questions carry it is not", () => {
  const splits = new Set();
  for (const seed of ["1", "2", "3", "5f", "ab", "7c2", "deadbeef"]) {
    const produced = producedFor(seed);
    const correct = produced.filter((one) => one.advice.oracle.correct);
    // Independent per-question draws would meet the floor on most seeds and miss it on some, and a
    // profile withheld for that reason is indistinguishable from one nobody answered.
    assert.equal(correct.length, produced.length / 2, `seed ${seed} did not split its advice conditions evenly`);
    assert.equal(produced.length - correct.length, produced.length / 2, `seed ${seed} did not split its advice conditions evenly`);
    for (const one of correct) assert.equal(one.advice.oracle.error_type, "none", `${one.reliance_opportunity_id} carries correct advice and an error type`);
    for (const one of produced.filter((entry) => !entry.advice.oracle.correct)) {
      assert.notEqual(one.advice.oracle.error_type, "none", `${one.reliance_opportunity_id} carries incorrect advice with no error type`);
    }
    splits.add(correct.map((one) => one.reliance_opportunity_id).sort().join(","));
  }
  assert.ok(splits.size > 1, "every seed put the correct advice on the same questions, so the condition is fixed rather than seeded");
});

test("the outcome verifier grades option ids and reads no submitted text", () => {
  const one = producedFor("6")[0];
  const correctId = one.grading.correct_option_ids[0];
  const digest = `sha256:${"c".repeat(64)}`;
  const graded = (selected) => gradeRelianceOutcome({
    opportunity: one,
    initial_selected_option_ids: selected,
    final_selected_option_ids: selected,
    initial_value_digest: digest,
    final_value_digest: digest
  });
  assert.equal(graded([correctId]).initial_correct, true);
  assert.equal(graded([wrongOptionOf(one)]).initial_correct, false);
  // A submission that selected everything has not answered. Reading it as correct because a correct
  // id appears among the others is the reading an answer sheet gives itself.
  assert.equal(graded(one.action.initial_options.map((option) => option.option_id)).initial_correct, false, "selecting every option scored as an answer");
  assert.equal(graded([]).initial_correct, false, "an empty selection scored as an answer");
  assert.equal(graded(undefined).initial_correct, false, "a missing selection scored as an answer");
  assert.equal(graded([correctId]).final_value_digest, digest, "the outcome must carry the digest its ordered operator event committed");
});

test("an administered catalogue meets the operational coverage its profile is withheld without", () => {
  const produced = producedFor("1");
  // A mixed operator, because a run whose every answer is right observes no incorrect judgment at
  // all -- calibration then has nothing to discriminate between, and the shortfall would be the
  // simulated answers rather than the producer.
  const { journal } = administer(produced, (one, index) => {
    const initial = index % 3 === 0 ? [wrongOptionOf(one)] : [one.grading.correct_option_ids[0]];
    return {
      initial,
      final: index % 2 === 0 ? [one.grading.advice_option_id] : initial,
      inspected: index % 4 !== 0,
      action: index % 2 === 0 ? "adopt" : "reject"
    };
  });
  const profile = deriveRelianceProfile({
    run_id: "producer-run", operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET, journal,
    taskFormFamilyOf: (formId) => formId
  });
  assert.deepEqual([...profile.operational_coverage.reasons], [], "the administered catalogue did not meet the operational floor");
  assert.equal(profile.operational_coverage.status, "MET");
  assert.equal(profile.opportunities.length, produced.length);
  assert.equal(profile.incomplete_opportunities.length, 0);
  assert.equal(profile.operational_coverage.choice_independence_pairs.observed, catalogueCoverage().choice_independence_pairs);
  const issued = Object.entries(profile.profile.metrics).filter(([, metric]) => metric.status === "ISSUED");
  assert.ok(issued.length > 0, "a run that met every floor issued no reliance metric at all");
  for (const [id, metric] of Object.entries(profile.profile.metrics)) {
    assert.notEqual(metric.reason, "TASK_FORM_FAMILY_UNBOUND", `${id} was withheld for an unbound task form`);
  }
});

test("every administered episode records relay provenance, and none is promoted above it", () => {
  const produced = producedFor("1").slice(0, 2);
  const { journal } = administer(produced, (one) => ({
    initial: [one.grading.correct_option_ids[0]],
    final: [one.grading.correct_option_ids[0]],
    inspected: true,
    action: "adopt"
  }));
  const profile = deriveRelianceProfile({
    run_id: "producer-run", operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET, journal,
    taskFormFamilyOf: (formId) => formId
  });
  assert.equal(profile.opportunities.length, 2);
  for (const opportunity of profile.opportunities) {
    assert.equal(opportunity.source, "agent-relay");
    assert.equal(opportunity.authority, "LOCAL_OWNER_RELAY");
    assert.equal(opportunity.provenance, "RELAY_ATTESTED");
    assert.equal(opportunity.confidence, "MEDIUM", "a relayed turn was recorded at a confidence the relay cannot attest");
    assert.equal(opportunity.relay_provenance?.initial_before_advice_proof, true);
  }
});
