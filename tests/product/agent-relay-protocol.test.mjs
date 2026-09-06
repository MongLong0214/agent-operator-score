import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileRelayCheckpoint, createRelayCheckpoint, readRestrictedRelayResponseFile } from "../../lib/checkpoint.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { mintOperatorEvent } from "../../lib/operator-events.mjs";
import { RELAY_PHASES, createAgentRelayProtocol } from "../../lib/relay.mjs";
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

  protocol.prepare(opportunity());
  const initial = protocol.next();
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

test("response-store I/O leaves an otherwise observed relay ordering claim partially not observed", () => {
  const sessionId = "relay-response-store-unavailable";
  const { checkpoint } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  const protocol = createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  protocol.prepare(opportunity());
  const initial = protocol.next();
  protocol.respond(response(initial));
  const unavailable = createAgentRelayProtocol({
    session_id: sessionId,
    checkpoint: {
      ...checkpoint,
      readResponse: () => { throw new Error("EIO response store unavailable"); }
    },
    trace,
    operator_secret: OPERATOR_SECRET,
    instrument_secret: INSTRUMENT_SECRET
  }).verify();

  assert.deepEqual(unavailable, {
    relay_protocol_digest: protocol.protocol_digest,
    initial_before_advice_proof: null,
    status: "PARTIALLY_NOT_OBSERVED",
    reason: "EIO response store unavailable",
    trace_kinds: ["initial", "advice_reveal", "oracle"]
  }, "a response store refusal prevents verification; it does not observe contradictory evidence");
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

test("reachable relay challenge and supplied response do not read terminal input", () => {
  const relaySource = readFileSync(new URL("../../lib/relay.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(relaySource, /\bprocess\.(?:stdin|stdout|stderr)\b|node:readline|from\s+["']readline(?:\/promises)?["']/u,
    "the protocol has no terminal channel to prompt on; it accepts only the supplied response bytes");

  const sessionId = "relay-no-terminal-input";
  const { checkpoint } = memoryCheckpoint(sessionId);
  const trace = memoryTrace(sessionId);
  const protocol = createAgentRelayProtocol({ session_id: sessionId, checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  protocol.prepare(opportunity());
  const initial = protocol.next();
  const postAdvice = protocol.respond(response(initial));
  assert.equal(postAdvice.phase, "POST_ADVICE_DECISION", "the reachable initial challenge advances solely from supplied response bytes");
  const waiting = protocol.respond(response(postAdvice, { inspected: true, final_action: "adopt" }));
  assert.equal(waiting.status, "RUNNING", "the reachable post-advice response also advances without terminal input");
});

const statMode = (path) => {
  return statSync(path).mode;
};

test("the lifecycle owner supersedes or cancels only an unanswered challenge; a recorded human turn refuses to be abandoned", () => {
  const abandoned = memoryCheckpoint("relay-supersede");
  const abandonedTrace = memoryTrace("relay-supersede");
  const protocol = createAgentRelayProtocol({ session_id: "relay-supersede", checkpoint: abandoned.checkpoint, trace: abandonedTrace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  assert.throws(() => protocol.supersede(), /AOS_RELAY_NO_CHALLENGE/, "there is nothing to supersede before a challenge is prepared");
  protocol.prepare(opportunity());
  assert.deepEqual(protocol.supersede(), {
    schema_id: "aos-agent-relay.v2",
    session_id: "relay-supersede",
    status: "BLOCKED",
    reason: "SUPERSEDED"
  }, "the producer returns exactly what next() will report");
  assert.equal(abandoned.state().status, "SUPERSEDED", "the transition is durable, not a projection");
  assert.deepEqual(protocol.next(), { schema_id: "aos-agent-relay.v2", session_id: "relay-supersede", status: "BLOCKED", reason: "SUPERSEDED" });
  assert.throws(() => protocol.supersede(), /AOS_RELAY_CLOSE_STATE/, "a closed challenge is not closed twice");

  const cancelled = memoryCheckpoint("relay-cancel");
  const cancelProtocol = createAgentRelayProtocol({ session_id: "relay-cancel", checkpoint: cancelled.checkpoint, trace: memoryTrace("relay-cancel"), operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  cancelProtocol.prepare(opportunity());
  cancelProtocol.next();
  assert.equal(cancelled.state().status, "DELIVERED");
  assert.deepEqual(cancelProtocol.cancel(), { schema_id: "aos-agent-relay.v2", session_id: "relay-cancel", status: "BLOCKED", reason: "CANCELLED" });
  assert.throws(() => cancelProtocol.respond(response({ challenge_id: "challenge-late" })), /AOS_RELAY_RESPONSE_STATE/, "a cancelled challenge accepts no response");

  // Counterfactual: the same DELIVERED status, now holding a committed Phase A turn.  The deciding
  // input is the recorded human turn, not the lifecycle label.
  const answered = memoryCheckpoint("relay-answered");
  const answeredTrace = memoryTrace("relay-answered");
  const answeredProtocol = createAgentRelayProtocol({ session_id: "relay-answered", checkpoint: answered.checkpoint, trace: answeredTrace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  answeredProtocol.prepare(opportunity());
  const initial = answeredProtocol.next();
  const postAdvice = answeredProtocol.respond(response(initial));
  assert.equal(postAdvice.phase, "POST_ADVICE_DECISION");
  assert.throws(() => answeredProtocol.supersede(), /AOS_RELAY_HUMAN_TURN_RETAINED/, "abandoning the opportunity would strand the recorded Phase A turn");
  assert.throws(() => answeredProtocol.cancel(), /AOS_RELAY_HUMAN_TURN_RETAINED/);
  assert.equal(answered.state().status, "DELIVERED", "the refused transition changed nothing");
  assert.deepEqual(answeredTrace.entries().map((entry) => entry.kind), ["initial", "advice_reveal", "oracle"], "the refusal minted no event");
  const running = answeredProtocol.respond(response(postAdvice, { inspected: true, final_action: "adopt" }));
  assert.equal(running.status, "RUNNING");
  assert.throws(() => answeredProtocol.cancel(), /AOS_RELAY_CLOSE_STATE/, "a committed decision is finished, not cancellable");
});

test("a superseded, cancelled, or finished challenge admits a replacement; retained response evidence blocks one", () => {
  const store = memoryCheckpoint("relay-replace");
  const trace = memoryTrace("relay-replace");
  let instant = new Date("2026-09-05T12:00:00Z");
  const protocol = createAgentRelayProtocol({ session_id: "relay-replace", checkpoint: store.checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET, now: () => instant });

  const first = protocol.prepare(opportunity());
  protocol.supersede();
  const second = protocol.prepare({ ...opportunity(), reliance_opportunity_id: "rel-agent-relay-2", operator_opportunity_id: "opp-agent-relay-2" });
  assert.notEqual(second.challenge_id, first.challenge_id, "a replacement is a new challenge, not the abandoned one revived");
  assert.equal(second.phase, "INITIAL_JUDGMENT");

  protocol.cancel();
  const third = protocol.prepare({ ...opportunity(), reliance_opportunity_id: "rel-agent-relay-3", operator_opportunity_id: "opp-agent-relay-3" });
  assert.equal(store.state().status, "PREPARED");

  // An unanswered challenge that expires leaves nothing a replacement could discard.
  instant = new Date("2031-01-01T00:00:00Z");
  assert.throws(() => protocol.next(), /AOS_RELAY_CHALLENGE_EXPIRED/);
  assert.equal(store.state().status, "EXPIRED");
  instant = new Date("2026-09-05T12:00:00Z");
  const fourth = protocol.prepare({ ...opportunity(), reliance_opportunity_id: "rel-agent-relay-4", operator_opportunity_id: "opp-agent-relay-4" });
  assert.notEqual(fourth.challenge_id, third.challenge_id);

  // A Phase B challenge that expires retains the committed Phase A ledger.  The same terminal
  // status now refuses a replacement: the deciding input is the retained turn, not EXPIRED itself.
  const initial = protocol.next();
  protocol.respond(response(initial));
  instant = new Date("2031-01-01T00:00:00Z");
  assert.throws(() => protocol.next(), /AOS_RELAY_CHALLENGE_EXPIRED/);
  assert.equal(store.state().status, "EXPIRED");
  assert.equal(Object.keys(store.state().response_digests).length, 1);
  instant = new Date("2026-09-05T12:00:00Z");
  assert.throws(() => protocol.prepare({ ...opportunity(), reliance_opportunity_id: "rel-agent-relay-5", operator_opportunity_id: "opp-agent-relay-5" }), /AOS_RELAY_HUMAN_TURN_RETAINED/,
    "a replacement cannot discard the ledger that re-derives a recorded human turn");

  // A finished opportunity admits the next question: its ordering proof was consumed into the
  // instrument-authenticated trace by recordOutcome, so the checkpoint is no longer its only home.
  const finished = memoryCheckpoint("relay-finish");
  const finishedTrace = memoryTrace("relay-finish");
  const finishedProtocol = createAgentRelayProtocol({ session_id: "relay-finish", checkpoint: finished.checkpoint, trace: finishedTrace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  finishedProtocol.prepare(opportunity());
  const firstInitial = finishedProtocol.next();
  const firstPost = finishedProtocol.respond(response(firstInitial));
  finishedProtocol.respond(response(firstPost, { inspected: true, final_action: "adopt" }));
  assert.throws(() => finishedProtocol.prepare(opportunity()), /AOS_RELAY_ACTIVE_CHALLENGE/, "a committed decision without its outcome is not finished");
  const [initialEntry, , , , finalEntry] = finishedTrace.entries();
  finishedProtocol.recordOutcome({
    initial_correct: false,
    initial_value_digest: initialEntry.payload.operator_event.value_digest,
    final_correct: true,
    final_value_digest: finalEntry.payload.operator_event.value_digest,
    verified_outcome_evidence_ids: ["verified-outcome"]
  });
  const replacement = finishedProtocol.prepare({ ...opportunity(), reliance_opportunity_id: "rel-agent-relay-6", operator_opportunity_id: "opp-agent-relay-6" });
  assert.equal(replacement.phase, "INITIAL_JUDGMENT");
  assert.notEqual(replacement.challenge_id, firstInitial.challenge_id);
});

test("every phase the protocol digest promises is issued by the protocol itself", () => {
  const { checkpoint } = memoryCheckpoint("relay-phases");
  const trace = memoryTrace("relay-phases");
  const protocol = createAgentRelayProtocol({ session_id: "relay-phases", checkpoint, trace, operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  const issued = new Set();
  issued.add(protocol.prepare(opportunity()).phase);
  const initial = protocol.next();
  issued.add(initial.phase);
  issued.add(protocol.respond(response(initial)).phase);
  assert.deepEqual([...issued].sort(), [...RELAY_PHASES].sort(),
    "a phase inside the protocol digest that no surface can issue is a promised transition that does not exist");

  // Written around the protocol, a checkpoint claiming an unissuable phase is refused on read
  // rather than becoming a challenge this module never learned to serve.
  const raw = memoryCheckpoint("relay-forged-phase");
  const forgery = createAgentRelayProtocol({ session_id: "relay-forged-phase", checkpoint: raw.checkpoint, trace: memoryTrace("relay-forged-phase"), operator_secret: OPERATOR_SECRET, instrument_secret: INSTRUMENT_SECRET });
  forgery.prepare(opportunity());
  raw.checkpoint.write({ ...raw.checkpoint.read(), phase: "OTHER_OPERATOR_DECISION" });
  assert.throws(() => forgery.next(), /AOS_RELAY_CHECKPOINT_SHAPE/, "a stored phase the protocol cannot issue does not authorize itself");
});
