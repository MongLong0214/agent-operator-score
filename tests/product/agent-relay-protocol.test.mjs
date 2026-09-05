import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileRelayCheckpoint, createRelayCheckpoint, readRestrictedRelayResponseFile } from "../../lib/checkpoint.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { mintOperatorEvent } from "../../lib/operator-events.mjs";
import { createAgentRelayProtocol } from "../../lib/relay.mjs";
import { createRelianceTrace } from "../../lib/reliance.mjs";
import { routeOracleDigest } from "../../lib/routing-oracle.mjs";
import { createRun } from "../../lib/store.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const RELAY_DIGEST = `sha256:${"b".repeat(64)}`;
const OPERATOR_SECRET = "operator-key";
const INSTRUMENT_SECRET = "instrument-key";

const memoryCheckpoint = (sessionId = "relay-session") => {
  let state = null;
  const responses = new Map();
  const checkpoint = createRelayCheckpoint({
    session_id: sessionId,
    read: () => state,
    write: (next) => { state = structuredClone(next); },
    readResponse: (challengeId) => responses.get(challengeId) ?? null,
    writeResponse: (challengeId, bytes) => responses.set(challengeId, Buffer.from(bytes))
  });
  return { checkpoint, responses, state: () => structuredClone(state) };
};

const memoryTrace = (runId) => {
  const entries = [];
  let head = null;
  return createRelianceTrace({
    run_id: runId,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET,
    journal: {
      record: (entry, nextHead) => {
        if (entry !== null) entries.push(structuredClone(entry));
        head = structuredClone(nextHead);
      },
      read: () => structuredClone(entries),
      readHead: () => structuredClone(head)
    }
  });
};

const opportunity = () => {
  const route = { route_id: "relay-route" };
  return {
    reliance_opportunity_id: "rel-agent-relay",
    operator_opportunity_id: "opp-agent-relay",
    construct_cell_id: "C3.RA.01",
    task_form_id: "form-fam-3",
    expires_at: "2030-01-01T00:00:00Z",
    proactive_delegation: "DELEGATE",
    forcing: {
      forcing_protocol_id: "initial-judgment-before-advice.v1",
      burden_interaction_count: 1,
      skip_or_refusal: "NONE",
      timeout: false,
      interface: "agent-relay"
    },
    delegation: {
      chosen: true,
      oracle_expected_value: "BENEFICIAL",
      route_oracle: { ...route, route_oracle_digest: routeOracleDigest(route) }
    },
    advice: {
      summary: "The independent checker recommends adopting the prepared change.",
      proposal_evidence_digest: DIGEST,
      oracle: { correct: true, error_type: "none", domain: "change-review", evidence_digest: DIGEST }
    },
    action: {
      initial_prompt: "What is your independent initial judgment?",
      final_prompt: "After inspecting the advice, what is your final decision?",
      context_summary: "A prepared change needs a decision.",
      initial_options: [],
      final_options: [],
      free_text_allowed: true
    }
  };
};

const response = (challenge, values = {}) => Buffer.from(JSON.stringify({
  schema_id: "aos-agent-relay-response.v2",
  challenge_id: challenge.challenge_id,
  selected_option_ids: [],
  operator_text: "I inspected the available evidence.",
  reported_confidence: 0.6,
  named_evidence_ids: ["evidence-1"],
  relay: {
    source: "agent-relay",
    agent_runtime_digest: RELAY_DIGEST,
    conversation_turn_id: "local-turn-1",
    attestation: "relay-declared-user-response",
    autonomous: false,
    submitted_at: "2026-09-05T12:00:00Z"
  },
  ...values
}), "utf8");

test("the relay commits an initial user judgment before it reveals advice", () => {
  const sessionId = "relay-red-baseline";
  const { checkpoint, state } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  const protocol = createAgentRelayProtocol({
    session_id: sessionId,
    checkpoint,
    trace,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET
  });

  const initial = protocol.prepare(opportunity());
  assert.equal(initial.phase, "INITIAL_JUDGMENT");
  assert.equal(Object.hasOwn(initial, "advice"), false, "the initial challenge must not carry advice in another field");
  assert.equal(Object.hasOwn(state().opportunity, "advice"), false, "checkpoint state cannot carry the answer material before Phase A commits");
  assert.equal(JSON.stringify(state()).includes(opportunity().advice.summary), false, "the advice summary is not plaintext before the initial response");
  assert.equal(JSON.stringify(state()).includes('"correct":true'), false, "the oracle answer key is not plaintext before the initial response");
  assert.equal(protocol.next().challenge_digest, initial.challenge_digest, "rerunning next returns the same durable initial challenge");

  const postAdvice = protocol.respond(response(initial));
  assert.equal(postAdvice.phase, "POST_ADVICE_DECISION");
  assert.equal(postAdvice.advice.summary, opportunity().advice.summary, "advice appears only after the initial commit");
  assert.deepEqual(trace.entries().map((entry) => entry.kind), ["initial", "advice_reveal", "oracle"]);
  assert.equal(trace.entries()[0].payload.operator_event.source, "agent-relay");
  assert.equal(trace.entries()[0].payload.operator_event.relay_attestation.owner_challenge_digest, initial.challenge_digest);
  assert.deepEqual(protocol.verify(), {
    relay_protocol_digest: protocol.protocol_digest,
    initial_before_advice_proof: true,
    status: "OBSERVED",
    trace_kinds: ["initial", "advice_reveal", "oracle"]
  });
  assert.equal(state().response_digests[initial.challenge_id] !== undefined, true, "the public checkpoint keeps a response digest, not a self-authorizing answered flag");
});

test("a post-advice decision records inspection and final evidence, while outcome remains independently observed", () => {
  const sessionId = "relay-final";
  const { checkpoint } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  const protocol = createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  protocol.prepare(opportunity());
  const initial = protocol.next();
  const postAdvice = protocol.respond(response(initial));
  const waiting = protocol.respond(response(postAdvice, { inspected: true, final_action: "adopt", reported_confidence: 0.8 }));
  assert.deepEqual(waiting, {
    schema_id: "aos-agent-relay.v2",
    session_id: sessionId,
    status: "RUNNING",
    reason: "OUTCOME_NOT_OBSERVED"
  }, "no outcome becomes a successful default");
  assert.deepEqual(trace.entries().map((entry) => entry.kind), ["initial", "advice_reveal", "oracle", "inspection", "final"]);
  const [initialEntry, , , , finalEntry] = trace.entries();
  const complete = protocol.recordOutcome({
    initial_correct: false,
    initial_value_digest: initialEntry.payload.operator_event.value_digest,
    final_correct: true,
    final_value_digest: finalEntry.payload.operator_event.value_digest,
    verified_outcome_evidence_ids: ["verified-outcome"]
  });
  assert.equal(complete.status, "COMPLETE");
  assert.deepEqual(trace.entries().map((entry) => entry.kind), ["initial", "advice_reveal", "oracle", "inspection", "final", "outcome"]);
  assert.deepEqual(trace.entries()[5].payload.relay_provenance, {
    relay_protocol_digest: protocol.protocol_digest,
    initial_before_advice_proof: true
  }, "the completed trace consumes verification before a reliance projection can read the relay provenance");
});

test("the relay refuses an autonomous, bundled, stale, or post-advice initial response without creating operator evidence", () => {
  const sessionId = "relay-refusals";
  const { checkpoint } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  const protocol = createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  protocol.prepare(opportunity());
  const initial = protocol.next();

  assert.throws(() => protocol.respond(response(initial, { relay: { ...JSON.parse(response(initial).toString("utf8")).relay, autonomous: true } })), /AOS_RELAY_AUTONOMOUS_REFUSED/,
    "an agent saying it answered autonomously must not create an operator event");
  assert.deepEqual(trace.entries(), [], "the refusal is before the initial trace commit");
  assert.throws(() => protocol.respond(response(initial, { final_action: "adopt" })), /AOS_RELAY_RESPONSE_BUNDLED/,
    "Phase A cannot carry the post-advice action in the same payload");
  assert.deepEqual(trace.entries(), [], "a bundled response left no initial record to reuse");

  const postAdvice = protocol.respond(response(initial));
  assert.throws(() => protocol.respond(response(initial)), /AOS_RELAY_CHALLENGE_MISMATCH/,
    "the first challenge cannot be replayed after advice became available");
  assert.throws(() => protocol.respond(response(postAdvice, { inspected: undefined })), /AOS_RELAY_RESPONSE_REQUIRED/,
    "absence of an inspection decision stays absent rather than defaulting false");
});

test("verification binds retained response values to the instrument-authenticated trace, not to checkpoint state", () => {
  const sessionId = "relay-recompute";
  const { checkpoint, responses } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  const protocol = createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  protocol.prepare(opportunity());
  const initial = protocol.next();
  protocol.respond(response(initial));
  const swapped = response(initial, { operator_text: "a different initial answer" });
  responses.set(initial.challenge_id, swapped);
  const altered = checkpoint.read();
  checkpoint.write({
    ...altered,
    response_digests: { ...altered.response_digests, [initial.challenge_id]: sha256Bytes(swapped) }
  });
  const verification = protocol.verify();
  assert.equal(verification.initial_before_advice_proof, false,
    "editing both response bytes and checkpoint digest cannot replace the trace's instrument-authenticated initial value");
  assert.equal(verification.status, "CONTRADICTED");
  assert.match(verification.reason, /AOS_RELAY_RESPONSE_TRACE_BINDING/);
});

test("a relay declaration without the relay's observed source is refused before it can become reliance evidence", () => {
  const sessionId = "relay-source-boundary";
  const trace = memoryTrace(sessionId);
  const route = { route_id: "source-boundary" };
  const event = mintOperatorEvent({
    run_id: sessionId,
    source: "agent-relay",
    decision_type: "initial.judgment",
    construct_cell_id: "C3.RA.01",
    opportunity_id: "opp-agent-relay",
    challenge_digest: DIGEST,
    value_digest: DIGEST,
    named_evidence_ids: ["evidence-1"],
    reported_confidence: 0.4,
    state_revision: 1,
    proactive_delegation: "DELEGATE",
    relay_attestation: {
      relay_id: "relay-source-boundary",
      owner_challenge_digest: DIGEST,
      attested_at: "2026-09-05T12:00:00Z"
    }
  }, { secret: OPERATOR_SECRET });
  assert.throws(() => trace.commitInitial({
    opportunity_id: "rel-source-boundary",
    operator_opportunity_id: "opp-agent-relay",
    task_form_id: "form-fam-3",
    operator_event: event,
    delegation: {
      chosen: true,
      oracle_expected_value: "BENEFICIAL",
      route_oracle: { ...route, route_oracle_digest: routeOracleDigest(route) }
    },
    forcing: {
      forcing_protocol_id: "initial-judgment-before-advice.v1",
      burden_interaction_count: 1,
      skip_or_refusal: "NONE",
      timeout: false,
      interface: "agent-relay"
    }
  }), /AOS_RELIANCE_OPERATOR_EVENT_SOURCE_BOUNDARY/,
  "the event's own source field is a declaration, not the relay observation");
  assert.deepEqual(trace.entries(), [], "an unobserved relay declaration created no initial event");
});

test("a crash after accepting a response resumes its one initial commit instead of asking again or appending twice", () => {
  const sessionId = "relay-resume";
  const { checkpoint } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  let failReveal = true;
  const interrupted = {
    ...trace,
    revealAdvice(payload) {
      if (failReveal) {
        failReveal = false;
        throw new Error("simulated crash after the initial trace commit");
      }
      return trace.revealAdvice(payload);
    }
  };
  const first = createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace: interrupted, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  first.prepare(opportunity());
  const initial = first.next();
  assert.throws(() => first.respond(response(initial)), /simulated crash/);
  assert.deepEqual(trace.entries().map((entry) => entry.kind), ["initial"], "the accepted user response committed one initial event before the crash");

  const resumed = createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  const postAdvice = resumed.next();
  assert.equal(postAdvice.phase, "POST_ADVICE_DECISION", "resume advances the durable record rather than re-asking the initial question");
  assert.deepEqual(trace.entries().map((entry) => entry.kind), ["initial", "advice_reveal", "oracle"], "resume appended only the missing observed suffix");
});

test("respond resumes a durable receipt even after expiry, while an edited expiry cannot revive a challenge", () => {
  const sessionId = "relay-receipt-before-expiry";
  const { checkpoint } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  let failReveal = true;
  const interrupted = {
    ...trace,
    revealAdvice(payload) {
      if (failReveal) {
        failReveal = false;
        throw new Error("simulated crash after receipt and initial commit");
      }
      return trace.revealAdvice(payload);
    }
  };
  const first = createAgentRelayProtocol({
    session_id: sessionId,
    checkpoint,
    trace: interrupted,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET,
    now: () => new Date("2026-09-05T12:00:00Z")
  });
  first.prepare(opportunity());
  const initial = first.next();
  assert.throws(() => first.respond(response(initial)), /simulated crash/);

  const resumed = createAgentRelayProtocol({
    session_id: sessionId,
    checkpoint,
    trace,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET,
    now: () => new Date("2026-09-05T12:30:00.001Z")
  });
  const postAdvice = resumed.respond(response(initial));
  assert.equal(postAdvice.phase, "POST_ADVICE_DECISION", "the received Phase A turn survives expiry while its trace suffix resumes");
  assert.deepEqual(trace.entries().map((entry) => entry.kind), ["initial", "advice_reveal", "oracle"]);

  const edited = checkpoint.read();
  checkpoint.write({ ...edited, expires_at: "2099-01-01T00:00:00Z" });
  assert.throws(() => resumed.next(), /AOS_RELAY_EXPIRY_BINDING/, "changing only checkpoint expiry cannot revive a challenge");
});

test("the relay records its receipt time rather than the counterparty's claimed submitted_at, and names unavailable verification", () => {
  const sessionId = "relay-receipt-time";
  const { checkpoint } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  const protocol = createAgentRelayProtocol({
    session_id: sessionId,
    checkpoint,
    trace,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET,
    now: () => new Date("2026-09-05T12:34:56Z")
  });
  protocol.prepare(opportunity());
  const initial = protocol.next();
  protocol.respond(response(initial, { relay: { ...JSON.parse(response(initial).toString("utf8")).relay, submitted_at: "1999-01-01T00:00:00Z" } }));
  assert.equal(trace.entries()[0].payload.operator_event.relay_attestation.attested_at, "2026-09-05T12:34:56.000Z");

  const unavailable = createAgentRelayProtocol({
    session_id: sessionId,
    checkpoint,
    trace: null,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET
  }).verify();
  assert.equal(unavailable.initial_before_advice_proof, null);
  assert.equal(unavailable.status, "PARTIALLY_NOT_OBSERVED", "a missing trace with relay state is not reported as a violated ordering claim");
});

test("relay response bytes require a restricted input file and stay restricted when retained for verification", () => {
    const root = mkdtempSync(join(tmpdir(), "aos-relay-response-"));
  try {
    const submittedDir = join(root, "submitted");
    const submitted = join(submittedDir, "response.json");
    mkdirSync(submittedDir, { mode: 0o755 });
    writeFileSync(submitted, "{}", { mode: 0o600 });
    assert.throws(() => readRestrictedRelayResponseFile(submitted), /AOS_RELAY_RESPONSE_PERMISSIONS/,
      "a 0600 file in a shared directory does not make private input restricted");
    chmodSync(submittedDir, 0o700);
    assert.deepEqual(readRestrictedRelayResponseFile(submitted), Buffer.from("{}"));

    const checkpoint = createFileRelayCheckpoint({
      session_id: "relay-file-store",
      state_file: join(root, "state.json"),
      response_dir: join(root, "responses")
    });
    checkpoint.writeResponse("challenge-file-store", Buffer.from("{}"));
    assert.deepEqual(checkpoint.readResponse("challenge-file-store"), Buffer.from("{}"));
    assert.equal((statMode(join(root, "responses")) & 0o077) === 0, true, "retained response evidence is under a 0700 directory");
    assert.equal((statMode(join(root, "responses", "challenge-file-store.json")) & 0o077) === 0, true, "retained response evidence is 0600-or-stricter");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the shipped binary honestly reports that no lifecycle producer prepared a relay challenge", () => {
  const root = mkdtempSync(join(tmpdir(), "aos-relay-cli-"));
  const sessionId = "relay-cli";
  try {
    createRun(root, { run_id: sessionId, mode: "TEST" });
    const run = spawnSync(process.execPath, ["bin/aos.mjs", "relay", "next", "--session", sessionId, "--json", "--data-dir", root], {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), {
      schema_id: "aos-agent-relay.v2",
      session_id: sessionId,
      status: "BLOCKED",
      reason: "NO_RELAY_CHALLENGE"
    }, "the real binary does not pretend the test harness produced a live relay challenge");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const statMode = (path) => {
  return statSync(path).mode;
};
