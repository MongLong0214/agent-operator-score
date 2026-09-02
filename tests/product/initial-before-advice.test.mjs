import assert from "node:assert/strict";
import test from "node:test";

import { RELIANCE_REJECTED, createRelianceTrace } from "../../lib/operator-events.mjs";

const SECRET = "7c30".repeat(16);
const RUN = "run-560-reliance";

const trace = () => createRelianceTrace({ run_id: RUN, secret: SECRET });

const judgment = (over = {}) => ({
  source: "interactive-tty",
  construct_cell_id: "C3.ER.01",
  opportunity_id: "opp-reliance-1",
  challenge_digest: { question: "is this migration safe to run" },
  value_digest: { answer: "no, it drops a column" },
  named_evidence_ids: ["migrations/0042.sql"],
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
  assert.deepEqual(event.named_evidence_ids, ["migrations/0042.sql"]);
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
  const response = reliance.recordAdviceResponse(judgment({ value_digest: { answer: "I kept my own answer" } }));
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
  reliance.recordAdviceResponse(judgment({ value_digest: { answer: "adopted" } }));
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
