import assert from "node:assert/strict";
import test from "node:test";

import { RELIANCE_REJECTED, createRelianceTrace } from "../../lib/operator-events.mjs";

const SECRET = "7c30".repeat(16);
const RUN = "run-560-reliance";

/** A journal that survives the trace it was made for, the way a run's event log does. */
const journal = () => {
  const stages = [];
  return {
    stages,
    record: (opportunity_id, stage, event) => stages.push({ opportunity_id, stage, event }),
    read: () => stages.map((entry) => ({ ...entry }))
  };
};

const trace = () => createRelianceTrace({ run_id: RUN, secret: SECRET, journal: journal() });

const judgment = (over = {}) => ({
  source: "interactive-tty",
  construct_cell_id: "C3.ER.01",
  opportunity_id: "opp-reliance-1",
  challenge: { question: "is this migration safe to run" },
  judgment: { answer: "no, it drops a column" },
  named_evidence_ids: ["migrations.0042.sql"],
  reported_confidence: 0.6,
  proactive_delegation: "DECIDE_ALONE",
  ...over
});

test("an initial judgment is one commit carrying the judgment, its confidence, its evidence and the delegation decision", () => {
  const reliance = trace();
  const event = reliance.commitInitialJudgment(judgment());
  assert.equal(event.decision_type, "initial.judgment");
  assert.equal(event.state_revision, 1);
  assert.equal(event.reported_confidence, 0.6);
  assert.deepEqual(event.named_evidence_ids, ["migrations.0042.sql"]);
  assert.equal(event.proactive_delegation, "DECIDE_ALONE");
  assert.match(event.value_digest, /^sha256:[0-9a-f]{64}$/u);
  // One event, not four that a caller could assemble in any order afterwards.
  assert.equal(reliance.opportunities().length, 1);
  assert.equal(reliance.opportunities()[0].advice_revealed, false);
});

test("a payload carrying the initial judgment and the post-advice response together is refused", () => {
  const reliance = trace();
  assert.throws(() => reliance.commitInitialJudgment(judgment({ advice_response: { answer: "the model says yes" } })), (error) => {
    assert.equal(error.message.startsWith(RELIANCE_REJECTED), true, error.message);
    assert.match(error.message, /which was formed first/u);
    return true;
  });
  assert.throws(() => reliance.commitInitialJudgment(judgment({ post_advice: {} })), /reliance opportunity rejected/u);
  assert.equal(reliance.opportunities().length, 0, "a refused payload left an opportunity behind");
});

test("an initial judgment committed after the advice was revealed is refused rather than recorded with a caveat", () => {
  const reliance = trace();
  reliance.commitInitialJudgment(judgment());
  reliance.revealAdvice("opp-reliance-1");
  assert.throws(() => reliance.commitInitialJudgment(judgment({ opportunity_id: "opp-reliance-1" })), /already revealed/u);
  // And a second opportunity is unaffected: the refusal is about the one whose advice is out.
  const second = reliance.commitInitialJudgment(judgment({ opportunity_id: "opp-reliance-2" }));
  assert.equal(second.opportunity_id, "opp-reliance-2");
});

test("advice cannot be revealed for an opportunity with no committed judgment, and a response cannot precede the reveal", () => {
  const reliance = trace();
  assert.throws(() => reliance.revealAdvice("opp-reliance-1"), /no committed initial judgment/u);
  assert.throws(() => reliance.recordAdviceResponse(judgment()), /no revealed advice/u);
  reliance.commitInitialJudgment(judgment());
  reliance.revealAdvice("opp-reliance-1");
  const response = reliance.recordAdviceResponse(judgment({ judgment: { answer: "I kept my own answer" } }));
  assert.equal(response.decision_type, "advice.response");
  assert.equal(response.state_revision, 2);
});

test("an initial judgment with no reported confidence is refused, because a calibration with no confidence is not one", () => {
  const reliance = trace();
  assert.throws(() => reliance.commitInitialJudgment(judgment({ reported_confidence: undefined })), /states none/u);
  assert.throws(() => reliance.commitInitialJudgment(judgment({ reported_confidence: "high" })), /states none/u);
});

test("an agent-relay judgment with no relay attestation is refused, so the relay cannot answer on the operator's behalf", () => {
  const reliance = trace();
  assert.throws(() => reliance.commitInitialJudgment(judgment({ source: "agent-relay" })), (error) => {
    assert.equal(error.message.startsWith(RELIANCE_REJECTED), true, error.message);
    assert.match(error.message, /#576/u);
    return true;
  });
  assert.throws(() => reliance.commitInitialJudgment(judgment({ source: "agent-stdout" })), /AOS_NOT_OPERATOR_AUTHORITY/u);
});

test("what #583 is handed is the ordered evidence and no rate, index or error taxonomy", () => {
  const reliance = trace();
  reliance.commitInitialJudgment(judgment());
  reliance.revealAdvice("opp-reliance-1");
  reliance.recordAdviceResponse(judgment({ judgment: { answer: "adopted" } }));
  const [opportunity] = reliance.opportunities();
  assert.deepEqual(Object.keys(opportunity).sort(), ["advice_response", "advice_revealed", "initial_judgment", "opportunity_id"]);
  assert.equal(opportunity.initial_judgment.decision_type, "initial.judgment");
  assert.equal(opportunity.advice_response.length, 1);
  // Nothing here computes a reliance metric: CAIR, CSR, an appropriateness rate and the error
  // taxonomy are #583's, and a second implementation of them here would be a second answer.
  const rendered = JSON.stringify(reliance.opportunities());
  for (const metric of ["cair", "csr", "appropriate", "over_reliance", "under_reliance", "rate", "index"]) {
    assert.equal(rendered.toLowerCase().includes(metric), false, `${metric} is computed here and belongs to #583`);
  }
});

// --- round 2 ------------------------------------------------------------------------------------

test("an initial judgment with no named evidence, no challenge or no delegation decision is refused", () => {
  // Round 1 required only a numeric confidence and defaulted an omitted challenge, judgment,
  // evidence list and delegation decision into digests of null and []. A calibration opportunity
  // assembled out of nothing is not one.
  const shared = journal();
  const reliance = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: shared });
  assert.throws(() => reliance.commitInitialJudgment(judgment({ named_evidence_ids: [] })), /evidence/u);
  assert.throws(() => reliance.commitInitialJudgment(judgment({ named_evidence_ids: undefined })), /evidence/u);
  assert.throws(() => reliance.commitInitialJudgment(judgment({ proactive_delegation: undefined })), /delegation/u);
  assert.throws(() => reliance.commitInitialJudgment(judgment({ challenge: undefined, challenge_digest: undefined })), /challenge/u);
  assert.throws(() => reliance.commitInitialJudgment(judgment({ judgment: undefined })), /states its value/u);
  assert.equal(shared.read().length, 0);
});

test("a second trace for the same run cannot commit an initial judgment after the first revealed the advice", () => {
  // Round 1 kept the reveal in an in-memory Set, so reconstructing the trace reset it.
  const shared = journal();
  const first = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: shared });
  first.commitInitialJudgment(judgment());
  first.revealAdvice("opp-reliance-1");
  const rebuilt = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: shared });
  assert.throws(() => rebuilt.commitInitialJudgment(judgment()), /already revealed/u,
    "the refusal came from the second-judgment rule rather than from the reveal, so the reveal check is not what held");
});

test("a reliance trace with no journal is refused, because a reveal nobody recorded cannot be checked later", () => {
  assert.throws(() => createRelianceTrace({ run_id: RUN, secret: SECRET }), /journal/u);
  assert.throws(() => createRelianceTrace({ run_id: RUN, secret: SECRET, journal: {} }), /journal/u);
});

test("a reconstructed trace hands #583 the evidence the first one committed, not an empty list", () => {
  // Round 2: the journal recorded stage names and the events stayed in an in-memory map, so
  // `opportunities()` on a rebuilt trace returned []. #583 reads a run that has already happened, so
  // the rebuilt trace is the normal case and the one that carried nothing.
  const shared = journal();
  const first = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: shared });
  const committed = first.commitInitialJudgment(judgment());
  first.revealAdvice("opp-reliance-1");
  first.recordAdviceResponse(judgment({ judgment: { answer: "adopted" } }));

  const rebuilt = createRelianceTrace({ run_id: RUN, secret: SECRET, journal: shared });
  const opportunities = rebuilt.opportunities();
  assert.equal(opportunities.length, 1, "the rebuilt trace carries no opportunity at all");
  const [opportunity] = opportunities;
  assert.equal(opportunity.opportunity_id, "opp-reliance-1");
  assert.equal(opportunity.initial_judgment.event_id, committed.event_id);
  assert.equal(opportunity.initial_judgment.reported_confidence, 0.6);
  assert.equal(opportunity.advice_revealed, true);
  assert.equal(opportunity.advice_response.length, 1);
  assert.deepEqual(rebuilt.opportunities(), first.opportunities());
});
