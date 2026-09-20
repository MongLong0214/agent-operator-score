import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addAgent, run } from "./helpers.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");

// The loop, driven against the shipped binary rather than against its own functions.
//
// Every other test in this file's neighbourhood calls `nextStep` and `agentReply` directly, which
// is the right way to check a decision and the wrong way to check that the decisions are wired to
// anything. The first real drive of this loop found three defects no unit test could have seen: a
// step that threw escaped as a broken stdout stream, `cycle run` was invoked without the option it
// needs, and an already-open cycle was reported as a report failure. This is what catches that
// class.
//
// The fixture agent, not a real runtime: `FAKE_AGENT_PROFILE` drives the same code path a provider
// would without a network call or a quota. What that buys is the orchestration; what it does not
// buy is any claim about a real model, and this test makes none.

// Under the *run*, not under the home. The first draft of this looked in `<home>/agent-relay/`,
// found nothing, and so never answered -- the form sat out its relay deadline in silence, 270
// seconds of it, measured. The orchestration had the same bug for the same reason.
const findChallenge = (home) => {
  const runsDir = join(home, "runs");
  try {
    for (const entry of readdirSync(runsDir)) {
      const file = join(runsDir, entry, "agent-relay", "challenge.json");
      try {
        readFileSync(file, "utf8");
        return { file, inbox: join(runsDir, entry, "agent-relay", "inbox") };
      } catch { /* not this run */ }
    }
  } catch { /* no runs yet */ }
  return null;
};

/** The person at the keyboard, answering their own question. Never the agent. */
const respondingOperator = (home, seen) => setInterval(() => {
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
  // The shape the relay actually accepts, not one invented for the fixture: a wrong shape is
  // refused and reads exactly like no answer at all.
  const options = (challenge.action?.options ?? []).map((option) => option.option_id);
  const answer = {
    schema_id: "aos-agent-relay-response.v2",
    challenge_id: challenge.challenge_id,
    selected_option_ids: options.length > 0 ? [options[0]] : [],
    operator_text: "Relayed from the chat window.",
    state_revision: challenge.state_revision,
    conversation_turn_id: `chat-${challenge.state_revision}`,
    attestation: "relay-declared-user-response",
    autonomous: false,
    submitted_at: new Date().toISOString()
  };
  const path = join(found.inbox, `${challenge.challenge_id}.json`);
  writeFileSync(path, JSON.stringify(answer), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}, 50);

test("the shipped binary drives the whole loop and ends on one terminal envelope", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-qs-smoke-"));
  const home = join(cwd, ".aos");
  const seen = new Set();
  let responder = null;
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    responder = respondingOperator(home, seen);

    const { code, out, err } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "quickstart", "--agent-mode", "--json"], {
        cwd,
        env: { ...process.env, AOS_HOME: home, FAKE_AGENT_PROFILE: "competent" }
      });
      const out = [];
      const err = [];
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      // Its own deadline and its own message. A loop that hangs is a defect, and a test that hangs
      // with it reports nothing at all -- #576 measured what that costs on the relay smoke.
      const deadline = setTimeout(() => { child.kill("SIGKILL"); }, 900_000);
      child.on("error", (error) => { clearTimeout(deadline); reject(error); });
      child.on("close", (code) => {
        clearTimeout(deadline);
        resolve({ code, out: Buffer.concat(out).toString("utf8"), err: Buffer.concat(err).toString("utf8") });
      });
    });

    assert.notEqual(code, null, `the loop was killed at its deadline rather than finishing; stderr tail: ${err.slice(-600)}`);

    // stdout is the protocol: every line parses, and nothing else is on it.
    const lines = out.split("\n").filter((line) => line.trim() !== "");
    assert.ok(lines.length > 0, `the loop produced no envelope; stderr tail: ${err.slice(-600)}`);
    const replies = lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`stdout line ${index + 1} is not JSON, so the stream is not parseable: ${line.slice(0, 200)}`);
      }
    });
    for (const reply of replies) assert.equal(reply.schema_id, "aos-agent-quickstart.v2");

    // Exactly one terminal envelope, and it is the last. A loop that stops without one is
    // indistinguishable from a hang to the agent reading it -- the defect the first drive found.
    const terminal = replies.filter((reply) => ["COMPLETE", "BLOCKED", "FAILED"].includes(reply.status));
    assert.equal(terminal.length, 1, `expected exactly one terminal envelope, got ${terminal.length}`);
    assert.equal(replies.at(-1).status, terminal[0].status, "the terminal envelope is not the last line");
    assert.ok(terminal[0].reason_code !== null, "the loop stopped without naming a reason");
    // The bar this smoke has to clear, and the reason it is not "it ended cleanly": a loop that
    // broke on its own step also ends cleanly, and a test that accepts any terminal envelope would
    // pass on a completely broken orchestration. AOS_QS_STEP_FAILED means the loop could not drive
    // the command it exists to drive; every other terminal code is a fact about the environment or
    // the measurement, which is what this loop is allowed to stop on.
    assert.notEqual(terminal[0].reason_code, "AOS_QS_STEP_FAILED",
      `the loop failed on its own step rather than on a measurement fact: ${terminal[0].safe_summary}; stderr tail: ${err.slice(-800)}`);

    // The session is durable: it exists on disk and names the phase the loop reached.
    const session = JSON.parse(readFileSync(join(home, "quickstart-session.json"), "utf8"));
    assert.equal(session.schema_id, "aos-quickstart-session.v2");
    assert.ok(session.state_revision >= 1);

    // Zero-setup: the operator typed one command. Whatever the outcome, the loop never asked them
    // to run another, edit a config, or look up a path.
    assert.equal(/aos cycle run|aos report|edit .*agents\.json/u.test(out), false,
      "the loop told the operator to run a command themselves");
    // And no raw private path reached the protocol stream.
    assert.equal(/\/Users\/|\/home\/[a-z]/u.test(out), false, "a raw private path reached stdout");
  } finally {
    if (responder !== null) clearInterval(responder);
    rmSync(cwd, { recursive: true, force: true });
  }
});
