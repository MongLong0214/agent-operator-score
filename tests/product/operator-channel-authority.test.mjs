import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../../lib/cli.mjs";

import { interventionSummary } from "../../lib/checkpoint.mjs";
import { attestedOperatorTrace } from "../../lib/operator-events.mjs";
import { parseProcessEvidenceId } from "../../lib/operator-plan.mjs";
import { readEvents } from "../../lib/store.mjs";
import { addAgent, makePlan, newestRecord, newestResult, newestRunId, run } from "./helpers.mjs";

// verify:operator-channel-authority
//
// Whether the operator was there, decided from the channel the answers actually arrived on.
//
// Round 1 of the review on #611: `--checkpoints` alone was read as proof of presence and every
// answer was signed `interactive-tty` / DIRECT_LOCAL / HIGH. A controller that pipes four lines --
// which is exactly what this repository's own fixtures do -- had AOS sign them, and a `checkpoint`
// event was signed before any answer was read, so EOF alone minted an AOS-authored operator turn.
//
// A terminal is not a person. `lib/checkpoint-runtime.mjs` says so and it is right: `expect` holds a
// pty and a person can hold one and walk away. What a terminal *is* is a necessary condition -- a
// stream that is not one carries no operator this instrument can name, and the source for that is
// the owner-relay protocol #576 owns. So the tty decides only whether DIRECT_LOCAL is available, and
// what makes the turn an observation is still that somebody answered.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const temporary = () => mkdtempSync(join(tmpdir(), "aos-channel-"));

const ANSWERS = Array.from({ length: 12 }, () => ["", "", "", "y", "AOS-TEST-UNBLOCK proceed"]).flat();

const prepared = (cwd) => {
  run(cwd, ["init"]);
  addAgent(cwd, "solo");
  addAgent(cwd, "spare");
  return makePlan(cwd, { default: "solo" });
};

/** One harmless event, so an imported run exists to cancel. */
const writeTrace = (cwd) => {
  const file = join(cwd, "trace.ndjson");
  writeFileSync(file, `${JSON.stringify({ event_type: "agent.ended", family: "FAM-1", payload: { stage: "s1", ok: true, exit_code: 0 } })}\n`);
  return file;
};

const collect = (cwd) => {
  const runId = newestRunId(cwd);
  let scored = null;
  try { scored = newestResult(cwd); } catch { scored = null; }
  let record = null;
  try { record = newestRecord(cwd); } catch { record = null; }
  return { runId, events: readEvents(join(cwd, ".aos"), runId), scored, record };
};

/** The run this repository has always driven: answers on a pipe, which is not a terminal. */
const assessOnAPipe = (answers) => {
  const cwd = temporary();
  try {
    const plan = prepared(cwd);
    const result = spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--seed", "11", "--checkpoints"], {
      cwd,
      encoding: "utf8",
      input: answers.map((line) => `${line}\n`).join(""),
      timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: "needs-instruction" }
    });
    return { result, cwd, ...collect(cwd) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

/**
 * The same run with a stdin that reports itself a terminal.
 *
 * In process, through `runCli`, because that is the only way to hold the descriptor: `script` is the
 * portable way to get a real pty without a native dependency, and it delivers the whole answer file
 * and its EOF before the reader attaches, so every checkpoint reads as unanswered. Measured, not
 * assumed -- a run driven that way recorded seven `operator.event.refused` events and no answers.
 *
 * What this stands in for is exactly one bit: the OS saying the descriptor is a terminal. That the
 * bit is false for a pipe is proved above, against the real binary, in a real subprocess. What is
 * faked here is the operating system's answer, not the operator: the answers below are still read
 * one line at a time by the same reader, through the same checkpoint runtime, into the same store.
 */
const assessOnATerminal = async (answers) => {
  const cwd = temporary();
  try {
    const plan = prepared(cwd);
    const stdin = Readable.from(answers.map((line) => `${line}\n`));
    stdin.isTTY = true;
    const written = [];
    const sink = { write: (text) => { written.push(String(text)); return true; } };
    const profile = process.env.FAKE_AGENT_PROFILE;
    process.env.FAKE_AGENT_PROFILE = "needs-instruction";
    let status;
    try {
      status = await runCli(["assess", "--plan", plan, "--seed", "11", "--checkpoints", "--data-dir", join(cwd, ".aos")], { cwd, stdin, stdout: sink, stderr: sink });
    } finally {
      if (profile === undefined) delete process.env.FAKE_AGENT_PROFILE;
      else process.env.FAKE_AGENT_PROFILE = profile;
    }
    return { result: { status, stdout: written.join(""), stderr: "" }, cwd, ...collect(cwd) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test("answers arriving on a pipe are never signed as a direct local operator turn", () => {
  const { events } = assessOnAPipe(ANSWERS);
  const signed = events.filter((event) => event.operator_authority !== undefined);
  assert.deepEqual(signed, [], "AOS signed an operator event for answers that arrived on a pipe");
  const refused = events.filter((event) => event.event_type === "operator.event.refused");
  assert.equal(refused.length > 0, true, "the refusal was not recorded, so the run cannot say why it observed nothing");
  assert.equal(refused.every((event) => event.payload.source === "piped-stdin"), true, JSON.stringify(refused.map((e) => e.payload)));
  assert.equal(refused.some((event) => /#576/u.test(event.payload.reason)), true, "the refusal does not name the protocol that would admit a relayed answer");
});

test("a run whose answers arrive on a pipe observes no operator process at all", () => {
  const { events, scored } = assessOnAPipe(ANSWERS);
  assert.equal(interventionSummary(events).observed, false);
  assert.notEqual(scored, null, "the run produced no result at all");
  for (const id of ["M11", "M12", "M13"]) {
    const observation = scored.observations.find((entry) => entry.metric_id === id);
    assert.equal(observation.value, null, `${id} was scored from a channel nobody was on`);
  }
  assert.equal(scored.operator_process_profile.issued, false);
});

test("nothing is signed before an answer arrives, so a stream that answers nothing mints no operator event", async () => {
  // Round 1 signed `checkpoint.observe` at the moment the question was printed, so closing the
  // stream was enough to make AOS mint an operator event describing an operator who was never there.
  const { events } = await assessOnATerminal([]);
  assert.equal(events.filter((event) => event.operator_event !== undefined).length, 0,
    "an operator event was minted for a stream that answered nothing");
  const refused = events.filter((event) => event.event_type === "operator.event.refused");
  assert.equal(refused.length > 0, true, "the unanswered checkpoints left no trace");
  assert.equal(refused.every((event) => event.payload.source === "unanswered"), true, JSON.stringify(refused.map((e) => e.payload.source)));
});

test("answers on a stdin that reports itself a terminal are signed DIRECT_LOCAL and reach the scored process rows", async () => {
  const { events, scored, record, result } = await assessOnATerminal(ANSWERS);
  assert.equal(typeof result.status, "number");
  const signed = events.filter((event) => event.operator_authority !== undefined);
  assert.equal(signed.length > 0, true, `no operator event was signed on a terminal: ${result.stdout.slice(-500)}`);
  assert.equal(signed.every((event) => event.operator_authority.source === "interactive-tty"), true);
  assert.equal(signed.every((event) => event.operator_authority.authority === "DIRECT_LOCAL"), true);

  // The binding is in the assessment path, not beside it: the scored operator-process rows name the
  // operator events they rest on.
  assert.notEqual(scored, null, "the run produced no result at all");
  const errorRecognition = scored.cells.find((cell) => cell.cell_id === "C3.ER.01");
  assert.equal(errorRecognition.status, "ISSUED", JSON.stringify(errorRecognition));
  const references = errorRecognition.bound_to.flatMap((entry) => entry.evidence_ids)
    .map((id) => parseProcessEvidenceId(id))
    .filter((reference) => reference !== null);
  assert.equal(references.length > 0, true, `no scored process row names an operator event: ${JSON.stringify(errorRecognition.bound_to)}`);
  for (const reference of references) {
    assert.match(reference.operator_event_id, /^operator-/u);
    // The turns M11 and M12 both rest on, so both scorable operator-process cells appear here.
    assert.equal(["C3.ER.01", "C4.IQ.01"].includes(reference.construct_cell_id), true, reference.construct_cell_id);
    assert.match(reference.opportunity_id, /^opp-/u);
    assert.equal(reference.source, "interactive-tty");
    assert.equal(reference.authority, "DIRECT_LOCAL");
    assert.equal(reference.provenance, "DIRECT");
    assert.equal(Number.isInteger(reference.state_revision), true);
  }
  assert.equal(references.some((reference) => reference.construct_cell_id === "C3.ER.01"), true,
    "the cell being read names no operator event of its own");
  // And the run's own record carries the whole binding, cell by cell, including the cells this
  // contract declares and cannot yet score.
  assert.notEqual(record, null);
  const binding = record.operator_process_binding;
  assert.equal(Array.isArray(binding.rows), true);
  assert.equal(binding.rows.length > 0, true);
  assert.deepEqual(binding.cells.map((cell) => cell.cell_id).sort(),
    ["C1.OF.01", "C2.OD.01", "C3.ER.01", "C4.IQ.01", "C5.VD.01", "C6.OG.01"]);
  assert.equal(binding.cells.find((cell) => cell.cell_id === "C3.ER.01").status, "BOUND");
});

test("session cancel typed on a pipe records the cancellation without claiming an operator turn", () => {
  // The same class as the checkpoint prompt, on the other command. `aos session cancel` signed a
  // trusted-local-ui / DIRECT_LOCAL / HIGH operator event on the strength of having been invoked --
  // and anything with a shell can invoke it. The run is still cancelled and the terminal is still
  // committed; what is not recorded is a turn by somebody this instrument cannot see.
  const cwd = temporary();
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const imported = JSON.parse(run(cwd, ["import", "--producer", "trace", "--file", writeTrace(cwd), "--json"]).stdout);
    const cancelled = JSON.parse(run(cwd, ["session", "cancel", imported.run_id, "--json"]).stdout);
    assert.equal(cancelled.status, "CANCELLED");
    const events = readEvents(join(cwd, ".aos"), imported.run_id);
    assert.equal(events.some((event) => event.event_type === "run.cancelled"), true, "the cancellation left no record");
    assert.equal(events.some((event) => event.event_type === "session.cancelled"), false,
      "a cancellation typed on a pipe was recorded as an operator turn");
    assert.deepEqual(events.filter((event) => event.operator_authority !== undefined), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
