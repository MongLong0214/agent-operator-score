import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sha256Bytes } from "../../lib/digest.mjs";
import {
  AUTHORITY_MATRIX,
  BOUND_FIELDS,
  NON_OPERATOR_SOURCES,
  OPERATOR_EVENT_SCHEMA_URL,
  OPERATOR_SOURCES,
  authorityOf,
  createOperatorLedger,
  refusalForSource,
  loadOperatorEventSchema,
  mintOperatorEvent,
  operatorEventSchemaDigest,
  sessionBindingOf,
  validateOperatorEvent
} from "../../lib/operator-events.mjs";

const SECRET = "9d1c".repeat(16);
const RUN = "run-560-authority";

const mint = (over = {}, secret = SECRET) => mintOperatorEvent({
  run_id: RUN,
  source: "interactive-tty",
  decision_type: "spec.goal",
  construct_cell_id: "C1.OF.01",
  opportunity_id: "opp-d1-goal",
  challenge: { asked: "state the goal" },
  value: { goal: "ship it" },
  state_revision: 1,
  ...over
}, { secret });

test("each operator source carries exactly the authority, provenance and confidence the matrix gives it", () => {
  assert.deepEqual(authorityOf("interactive-tty"), { authority: "DIRECT_LOCAL", provenance: "DIRECT", confidence: "HIGH" });
  assert.deepEqual(authorityOf("trusted-local-ui"), { authority: "DIRECT_LOCAL", provenance: "DIRECT", confidence: "HIGH" });
  assert.deepEqual(authorityOf("agent-relay"), { authority: "LOCAL_OWNER_RELAY", provenance: "RELAY_ATTESTED", confidence: "MEDIUM" });
  assert.deepEqual(authorityOf("operator-file"), { authority: "ADVANCED_FILE", provenance: "FILE_ATTESTED", confidence: "LOW" });
  assert.deepEqual(Object.keys(AUTHORITY_MATRIX).sort(), [...OPERATOR_SOURCES].sort());
  // A minted event takes its triple from the matrix rather than from the caller, so a caller that
  // asked for a file's source cannot also ask for a keyboard's authority.
  const filed = mint({
    source: "operator-file",
    file_provenance: { path_digest: `sha256:${"a".repeat(64)}`, file_digest: `sha256:${"b".repeat(64)}`, attested_by: "local-owner", attested_at: "2026-09-03T00:00:00Z" },
    authority: "DIRECT_LOCAL",
    confidence: "HIGH"
  });
  assert.equal(filed.authority, "ADVANCED_FILE");
  assert.equal(filed.confidence, "LOW");
});

test("no source outside the matrix can mint an operator event, and each refusal names the source", () => {
  for (const source of NON_OPERATOR_SOURCES) {
    assert.equal(authorityOf(source), null, `${source} was given an authority`);
    assert.throws(() => mint({ source }), (error) => {
      assert.match(error.message, /AOS_NOT_OPERATOR_AUTHORITY/u);
      // The refusal says which of this product's own paths tried to speak for the operator, rather
      // than "unknown source" -- an operator cannot act on a message that names nothing.
      assert.equal(error.message.includes(refusalForSource(source)), true, error.message);
      return true;
    }, `${source} minted an operator event`);
  }
  assert.throws(() => mint({ source: "something-else" }), /is not a source this contract recognises/u);
  assert.throws(() => mint({ source: undefined }), /no operator source was declared/u);
});

test("an operator-file event without its file provenance and a relay event without its attestation are both refused", () => {
  const filed = mint({ source: "operator-file", file_provenance: { path_digest: `sha256:${"a".repeat(64)}`, file_digest: `sha256:${"b".repeat(64)}`, attested_by: "local-owner", attested_at: "2026-09-03T00:00:00Z" } });
  assert.equal(validateOperatorEvent(filed, { run_id: RUN, secret: SECRET }).accepted, true);
  const stripped = { ...filed };
  delete stripped.file_provenance;
  const rebound = { ...stripped, session_binding: sessionBindingOf(stripped, SECRET) };
  const verdict = validateOperatorEvent(rebound, { run_id: RUN, secret: SECRET });
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /explicit file provenance/u);

  const relayed = mint({ source: "agent-relay", relay_attestation: { relay_id: "relay-1", owner_challenge_digest: `sha256:${"c".repeat(64)}`, attested_at: "2026-09-03T00:00:00Z" } });
  assert.equal(validateOperatorEvent(relayed, { run_id: RUN, secret: SECRET }).accepted, true);
  const bare = { ...relayed };
  delete bare.relay_attestation;
  const reboundRelay = { ...bare, session_binding: sessionBindingOf(bare, SECRET) };
  assert.match(validateOperatorEvent(reboundRelay, { run_id: RUN, secret: SECRET }).reason, /#576/u);
});

test("the session binding covers every field of the event, so editing any one of them refuses it", () => {
  const event = mint();
  assert.equal(validateOperatorEvent(event, { run_id: RUN, secret: SECRET }).accepted, true);
  const edits = {
    decision_type: "budget.set",
    construct_cell_id: "C2.OD.01",
    opportunity_id: "opp-other",
    state_revision: 7,
    value_digest: `sha256:${"f".repeat(64)}`,
    challenge_digest: `sha256:${"e".repeat(64)}`,
    named_evidence_ids: ["invented"],
    reported_confidence: 0.9,
    created_at: "2020-01-01T00:00:00Z",
    source: "trusted-local-ui"
  };
  for (const [field, value] of Object.entries(edits)) {
    const tampered = { ...event, [field]: value };
    const verdict = validateOperatorEvent(tampered, { run_id: RUN, secret: SECRET });
    assert.equal(verdict.accepted, false, `editing ${field} left the event acceptable`);
  }
});

test("the bound fields are the schema's own fields, so a field added later cannot fall outside the binding", () => {
  const declared = Object.keys(loadOperatorEventSchema().properties).filter((name) => name !== "session_binding").sort();
  assert.deepEqual([...BOUND_FIELDS].sort(), declared);
});

test("an event minted for one run is refused when it is offered to another", () => {
  const event = mint();
  const verdict = validateOperatorEvent(event, { run_id: "run-560-elsewhere", secret: SECRET });
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /minted for run-560-authority/u);
  // And with the run id rewritten to match, the binding is what refuses it -- the run id is inside
  // the bound material, so a cross-session replay cannot be repaired by editing the field.
  const relabelled = { ...event, run_id: "run-560-elsewhere" };
  assert.match(validateOperatorEvent(relabelled, { run_id: "run-560-elsewhere", secret: SECRET }).reason, /session binding does not bind/u);
});

test("an event minted under one run's key is refused under another's, with no key at all, and with the wrong key", () => {
  const event = mint();
  assert.match(validateOperatorEvent(event, { run_id: RUN, secret: "0".repeat(64) }).reason, /session binding does not bind/u);
  assert.match(validateOperatorEvent(event, { run_id: RUN, secret: undefined }).reason, /AOS_OPERATOR_KEY_MISSING/u);
  assert.match(validateOperatorEvent(null, { run_id: RUN, secret: SECRET }).reason, /no operator event was attached/u);
});

test("the ledger admits an event id once and refuses a state revision that does not advance its opportunity", () => {
  const ledger = createOperatorLedger({ run_id: RUN, secret: SECRET });
  const first = mint({ state_revision: 1 });
  assert.equal(ledger.accept(first).accepted, true);
  assert.equal(ledger.accept(first).accepted, false);
  assert.match(ledger.rejected.at(-1).reason, /has already been recorded/u);

  const same = mint({ state_revision: 1 });
  assert.equal(ledger.accept(same).accepted, false);
  assert.match(ledger.rejected.at(-1).reason, /does not advance opp-d1-goal/u);

  const older = mint({ state_revision: 1, opportunity_id: "opp-d1-goal" });
  assert.equal(ledger.accept(older).accepted, false);

  assert.equal(ledger.accept(mint({ state_revision: 2 })).accepted, true);
  assert.equal(ledger.accepted.length, 2);
});

test("the source the call site declared and the source the record claims have to be the same", () => {
  const event = mint({ source: "trusted-local-ui" });
  assert.equal(validateOperatorEvent(event, { run_id: RUN, secret: SECRET, source: "trusted-local-ui" }).accepted, true);
  const verdict = validateOperatorEvent(event, { run_id: RUN, secret: SECRET, source: "interactive-tty" });
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /recorded by a interactive-tty call site/u);
});

test("the schema digest is over the schema file's bytes", () => {
  assert.equal(operatorEventSchemaDigest(), sha256Bytes(readFileSync(OPERATOR_EVENT_SCHEMA_URL)));
  assert.match(operatorEventSchemaDigest(), /^sha256:[0-9a-f]{64}$/u);
});

// --- round 2 ------------------------------------------------------------------------------------

test("a raw value is digested because it was supplied as a raw value, never because of how it looks", () => {
  // Round 1: `digestOf` decided by string shape, so a raw judgment that happened to be 64 hex
  // characters was emitted as `value_digest: "sha256:<the secret itself>"`. Which field the caller
  // supplied is the only thing that may decide this.
  const secret = "0123456789abcdef".repeat(4);
  const event = mintOperatorEvent({
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-raw",
    challenge: { asked: "state it" }, value: secret, state_revision: 1
  }, { secret: SECRET });
  assert.notEqual(event.value_digest, `sha256:${secret}`, "the raw value was published as its own digest");
  assert.equal(event.value_digest.includes(secret), false);
  assert.match(event.value_digest, /^sha256:[0-9a-f]{64}$/u);
});

test("a value and a value digest may not both be supplied, and neither may be omitted", () => {
  const base = {
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-raw", challenge: { asked: "x" }, state_revision: 1
  };
  assert.throws(() => mintOperatorEvent({ ...base, value: "a", value_digest: `sha256:${"b".repeat(64)}` }, { secret: SECRET }), /both/u);
  assert.throws(() => mintOperatorEvent({ ...base }, { secret: SECRET }), /value/u);
  assert.throws(() => mintOperatorEvent({ ...base, value_digest: "not-a-digest" }, { secret: SECRET }), /value_digest/u);
  // Round 1 digested `null` for an omitted challenge, so an event that stated nothing still minted.
  assert.throws(() => mintOperatorEvent({
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-raw", value: "a", state_revision: 1
  }, { secret: SECRET }), /challenge/u);
});

test("an operator event with no state revision is refused rather than defaulted to the first one", () => {
  // Round 2: an omitted revision became 1, which then satisfied the binding's required-reference
  // check -- a missing reference converted into a default, which is the one thing this issue's
  // completion list forbids by name.
  const base = {
    run_id: RUN, source: "interactive-tty", decision_type: "spec.goal",
    construct_cell_id: "C1.OF.01", opportunity_id: "opp-rev", challenge: { asked: "x" }, value: { goal: "y" }
  };
  // Refused by this module, in its own words. Matching "state_revision" alone would also match the
  // schema's own "missing required property", so the check would pass with the module's rule deleted
  // -- which is a guard that reports the schema and calls it this rule.
  const refusal = /is which revision of its opportunity this decision is/u;
  assert.throws(() => mint({ ...base, state_revision: undefined }), refusal);
  assert.throws(() => mint({ ...base, state_revision: 0 }), refusal);
  assert.throws(() => mint({ ...base, state_revision: 1.5 }), refusal);
  assert.throws(() => mint({ ...base, state_revision: "1" }), refusal);
  assert.equal(mint({ ...base, state_revision: 1 }).state_revision, 1);
});
