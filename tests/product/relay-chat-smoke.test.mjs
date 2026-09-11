import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { addAgent, makePlan, newestRecord, newestRunId, run } from "./helpers.mjs";

// The coding-agent chat smoke #576 asks for.
//
// Every other relay test drives the protocol or the administration in process. This one runs the
// shipped binary as a subprocess and answers it the way a coding agent actually would: by reading
// the published challenge off disk and writing a response file. Nothing here imports the relay, so
// what is exercised is the path an operator's answer really takes -- `aos assess --relay`, the
// producer, the protocol, the trace, and the derivation -- rather than a harness standing in for it.
//
// The answers are a person's, relayed. They are not the agent's own: `autonomous` is false in every
// response, which is the one field the protocol refuses a run on, and the responder never picks
// from a recommendation because it has none -- the advice is sealed until the initial answer
// commits, and this responder decides before it can see one.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");

/** Where the run under way published its current question, or null before the first one exists. */
const findChallenge = (home) => {
  const runsDir = join(home, "runs");
  if (!existsSync(runsDir)) return null;
  for (const entry of readdirSync(runsDir)) {
    const file = join(runsDir, entry, "agent-relay", "challenge.json");
    if (existsSync(file)) return { file, inbox: join(runsDir, entry, "agent-relay", "inbox") };
  }
  return null;
};

const answerFor = (challenge) => {
  const options = challenge.action.options.map((option) => option.option_id);
  // A person answering, not an oracle: the first option every time. It is right on some questions
  // and wrong on others, which is what a reliance measurement needs -- a run answered perfectly
  // observes no incorrect judgment at all.
  const selected = options.length > 0 ? [options[0]] : [];
  return {
    schema_id: "aos-agent-relay-response.v2",
    challenge_id: challenge.challenge_id,
    selected_option_ids: selected,
    operator_text: "Relayed from the chat window.",
    reported_confidence: 0.65,
    named_evidence_ids: ["chat-turn"],
    ...(challenge.phase === "POST_ADVICE_DECISION" ? { inspected: true, final_action: "reject" } : {}),
    relay: {
      source: "agent-relay",
      agent_runtime_digest: `sha256:${"c".repeat(64)}`,
      conversation_turn_id: `chat-${challenge.state_revision}`,
      attestation: "relay-declared-user-response",
      autonomous: false,
      submitted_at: new Date().toISOString()
    }
  };
};

/**
 * The coding agent: watch for a published question, put the person's answer where AOS reads it.
 *
 * 0600 inside the 0700 relay directory, because `readRestrictedRelayResponseFile` accepts nothing
 * else -- the permission is part of the interface, not housekeeping.
 */
const respondingAgent = (home, seen) => setInterval(() => {
  const found = findChallenge(home);
  if (found === null) return;
  let challenge;
  try {
    challenge = JSON.parse(readFileSync(found.file, "utf8"));
  } catch {
    return;
  }
  if (challenge.status !== "ACTION_REQUIRED" || seen.has(challenge.challenge_id)) return;
  seen.add(challenge.challenge_id);
  const path = join(found.inbox, `${challenge.challenge_id}.json`);
  writeFileSync(path, JSON.stringify(answerFor(challenge)), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}, 50);

test("a coding agent answers the shipped binary's relay questions, and the run records them as an operator's", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-relay-smoke-"));
  const home = join(cwd, ".aos");
  const seen = new Set();
  let responder = null;
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    responder = respondingAgent(home, seen);

    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "assess", "--plan", plan, "--seed", "11", "--relay"], {
        cwd,
        env: { ...process.env, AOS_HOME: home, FAKE_AGENT_PROFILE: "competent" }
      });
      const noise = [];
      child.stdout.on("data", (chunk) => noise.push(String(chunk)));
      child.stderr.on("data", (chunk) => noise.push(String(chunk)));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output: noise.join("") }));
    });
    clearInterval(responder);
    responder = null;
    // A fixture-backed run scores low and exits 3, which is this repository's ordinary assess
    // outcome -- 29 of its own tests expect exactly that. What matters here is that the run reached
    // its end rather than stopping at a question, so the codes that mean "finished" are allowed and
    // the ones that mean "refused before running" are not.
    assert.ok([0, 3].includes(status.code), `the relayed run did not finish (exit ${status.code}):\n${status.output.slice(-2000)}`);

    // Answered at all, and answered through the relay. `seen` counts the questions this responder
    // was shown; two phases per episode is what the protocol asks of a person.
    assert.ok(seen.size >= 2, `the run published ${seen.size} challenges, so nothing was asked`);

    const record = newestRecord(cwd);
    const administration = record.reliance_administration;
    assert.notEqual(administration, null, "a --relay run recorded no reliance administration");
    assert.deepEqual(administration.abandoned, [], "an episode went unanswered in a run whose questions were all answered");
    assert.equal(administration.administered.length, administration.planned,
      `${administration.administered.length} of ${administration.planned} questions were administered`);
    assert.equal(seen.size, administration.planned * 2, "each administered episode takes exactly two user turns");

    const profile = record.reliance_trace;
    assert.equal(profile.opportunities.length, administration.planned, "the derivation did not read the episodes this run recorded");
    assert.deepEqual([...profile.operational_coverage.reasons], [],
      `a fully answered run did not meet the operational floor: ${profile.operational_coverage.reasons.join(", ")}`);

    // The provenance the trust model fixes, read off the record rather than asserted by the relay.
    // A relayed turn is MEDIUM and stays MEDIUM: this is the assertion that would fail first if
    // anything ever promoted it to the direct-terminal reading.
    for (const opportunity of profile.opportunities) {
      assert.equal(opportunity.source, "agent-relay");
      assert.equal(opportunity.authority, "LOCAL_OWNER_RELAY");
      assert.equal(opportunity.provenance, "RELAY_ATTESTED");
      assert.equal(opportunity.confidence, "MEDIUM");
      assert.equal(opportunity.relay_provenance?.initial_before_advice_proof, true,
        "an episode reached the profile without the initial-before-advice proof");
    }
  } finally {
    if (responder !== null) clearInterval(responder);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("without --relay the shipped binary asks nothing and says the journal is empty rather than measured", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-relay-smoke-off-"));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    // Bounded, and the bound is the assertion. A run that starts asking with no --relay does not
    // fail -- it waits, for the two hours of its sitting expiry, which is exactly the piped-CI
    // failure this flag exists to prevent. Without a deadline here that shows up as a dead test
    // rather than a stated defect: the mutation runner saw it as the wrong kind of death.
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "assess", "--plan", plan, "--seed", "11"], {
        cwd,
        env: { ...process.env, AOS_HOME: home, FAKE_AGENT_PROFILE: "competent" }
      });
      const noise = [];
      const deadline = setTimeout(() => { child.kill("SIGKILL"); }, 120_000);
      child.stdout.on("data", (chunk) => noise.push(String(chunk)));
      child.stderr.on("data", (chunk) => noise.push(String(chunk)));
      child.on("error", (error) => { clearTimeout(deadline); reject(error); });
      child.on("close", (code, signal) => {
        clearTimeout(deadline);
        resolve({ code, signal, output: noise.join("") });
      });
    });
    assert.notEqual(status.signal, "SIGKILL",
      "the run stopped and waited for an answer although nobody passed --relay, which is the piped-CI hang the flag prevents");
    assert.ok([0, 3].includes(status.code), `exit ${status.code}:\n${status.output.slice(-1500)}`);
    assert.equal(findChallenge(home), null, "a run nobody asked to be relayed published a question anyway");

    const record = newestRecord(cwd);
    assert.equal(record.reliance_administration, null, "a run with no --relay recorded an administration");
    // Empty, and reported as unobserved rather than as a measurement of an operator who answered
    // badly. Those are different facts and the profile has to keep them apart.
    assert.equal(record.reliance_trace.opportunities.length, 0);
    assert.equal(record.reliance_trace.status, "NOT_OBSERVED");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
