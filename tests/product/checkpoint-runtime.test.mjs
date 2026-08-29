import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addAgent, makePlan, newestResult, newestRunId, run } from "./helpers.mjs";
import { MAX_CHECKPOINTS_PER_STAGE, QUESTIONS, parseDecision, renderCheckpoint, resolveCheckpoint } from "../../lib/checkpoint-runtime.mjs";
import { checkpointEvidence, detectCheckpoints, interventionSummary } from "../../lib/checkpoint.mjs";
import { readEvents } from "../../lib/store.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const temporary = () => mkdtempSync(join(tmpdir(), "aos-checkpoint-"));

// The interactive path has to be driven through a real process: the answers arrive on stdin, one
// line at a time, and the bug this guards against -- reading the whole stream for the first
// question and having none left for the second -- only exists across a pipe.
const assessAnswering = (answers, { profile = "needs-instruction", expected = 0 } = {}) => {
  const cwd = temporary();
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    addAgent(cwd, "spare");
    const plan = makePlan(cwd, { default: "solo" });
    const result = spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--seed", "11", "--checkpoints"], {
      cwd,
      encoding: "utf8",
      input: answers.map((line) => `${line}\n`).join(""),
      timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: profile }
    });
    const runId = newestRunId(cwd);
    // A run every stage failed never reaches a result, which is a legitimate outcome here rather
    // than a broken fixture: reading it eagerly would make those cases fail for the wrong reason.
    let scored = null;
    try { scored = newestResult(cwd); } catch { scored = null; }
    return { result, cwd, runId, events: readEvents(join(cwd, ".aos"), runId), scored };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test("a stage that failed stops the run and asks", () => {
  // The one moment in a run where what the operator does is observable at all.
  const { result, events } = assessAnswering(Array.from({ length: 12 }, () => ["", "", "", "y", "AOS-TEST-UNBLOCK proceed"]).flat());
  assert.match(result.stdout, /AOS checkpoint/);
  // The prompt is four y/n questions now, not a five-way menu with arguments.
  assert.match(result.stdout, /Show the full evidence\?/);
  assert.match(result.stdout, /Stop here\?/);
  assert.match(result.stdout, /Change the instruction\?/);
  const raised = events.filter((event) => event.event_type === "checkpoint.raised");
  assert.equal(raised.length > 0, true, "no checkpoint was recorded");
  for (const event of raised) {
    assert.equal(typeof event.payload.evidence_digest, "string");
    assert.equal(event.payload.evidence_digest.length, 64, "the evidence must be reconstructible");
  }
});

test("changing the instruction is what unblocks the run, and it is recorded as a change", () => {
  const { events } = assessAnswering(Array.from({ length: 12 }, () => ["", "", "", "y", "AOS-TEST-UNBLOCK proceed"]).flat());
  const summary = interventionSummary(events);
  assert.equal(summary.observed, true, "no intervention was observed");
  assert.equal(summary.checkpoints_raised > 0, true);
  assert.equal(
    summary.observations.some((entry) => entry.state_change === "instruction-changed"),
    true,
    JSON.stringify(summary.observations.map((entry) => entry.state_change))
  );
});

test("an operator who was there is scored on the dimension nobody else can fill", () => {
  // An unattended run leaves D4 unobserved by design. This is the run that fills it, and it is the
  // only way this product ever produces a number about the operator rather than about the agent.
  const { scored } = assessAnswering(Array.from({ length: 12 }, () => ["", "", "", "y", "AOS-TEST-UNBLOCK proceed"]).flat());
  assert.notEqual(scored, null, "the run produced no result at all");
  assert.equal(scored.coverage.unobserved_dimensions.includes("D4"), false, JSON.stringify(scored.coverage));
  assert.equal(scored.dimensions.D4 !== null, true, "D4 was still empty");
});

test("retrying unchanged is not an intervention, whatever it is called", () => {
  // The choice is never the score. Picking an option and then running the same thing again produced
  // no state a later step could act on, and that is what gets recorded.
  const { events } = assessAnswering(Array.from({ length: 27 }, () => ["", "", "", ""]).flat());
  const summary = interventionSummary(events);
  assert.equal(summary.checkpoints_raised > 0, true, "the stage should still have failed");
  assert.equal(
    summary.observations.every((entry) => entry.state_change !== "instruction-changed"),
    true,
    "an unchanged retry was counted as a changed instruction"
  );
});

test("one stage cannot stop forever", () => {
  // An operator who keeps answering retry would otherwise hold the run open indefinitely.
  const { events } = assessAnswering(Array.from({ length: 60 }, () => ["", "", "", ""]).flat());
  const perStage = new Map();
  for (const event of events.filter((entry) => entry.event_type === "checkpoint.raised")) {
    const key = `${event.family}:${event.payload.detail}`;
    perStage.set(key, (perStage.get(key) ?? 0) + 1);
  }
  for (const [key, count] of perStage) {
    assert.equal(count <= MAX_CHECKPOINTS_PER_STAGE, true, `${key} raised ${count}`);
  }
});

test("no answer is an unattended run, not a crash", () => {
  // Nothing here asks whether stdin is a terminal. The stream ending is the operator not answering.
  const { result, events } = assessAnswering([], { expected: 3 });
  assert.equal([0, 1, 3, 4].includes(result.status), true, `exit ${result.status}: ${result.stderr}`);
  assert.equal(result.stderr.includes("AOS_CANCELLED") || result.status !== 0, true);
  // The checkpoint was still raised and recorded; what is missing is a turn from anybody.
  assert.equal(events.some((event) => event.event_type === "checkpoint.raised"), true);
  assert.equal(interventionSummary(events).observed, false, "an unanswered run must not report an intervention");
});

test("the record keeps what the operator was shown, not just that they were shown something", () => {
  // A digest over evidence the record does not hold is a claim of checkability nothing can honour.
  // The payload is bounded where it is built, so what was shown, what was stored and what the
  // digest covers are the same bytes.
  const { events } = assessAnswering(Array.from({ length: 12 }, () => ["", "", "", ""]).flat());
  const raised = events.filter((event) => event.event_type === "checkpoint.raised");
  assert.equal(raised.length > 0, true);
  for (const event of raised) {
    assert.equal(typeof event.payload.detail, "string");
    assert.equal(event.payload.detail.length > 0, true, JSON.stringify(event.payload));
    assert.equal(Array.isArray(event.payload.calls), true);
    assert.equal(event.payload.evidence_digest.length, 64);
    // Bounded so the record can hold it at all: the event layer drops a string over 512 bytes, and
    // a payload silently dropped is the failure this test exists for.
    assert.equal((event.payload.output ?? "").length <= 512, true);
  }

  // The digest is over the payload, so it can be recomputed from what was stored.
  const sample = raised[0].payload;
  const recomputed = checkpointEvidence({
    kind: sample.kind,
    family: raised[0].family,
    detail: sample.detail,
    output: sample.output ?? "",
    calls: (sample.calls ?? []).map((entry) => {
      const [outcome, signature] = String(entry).split("\t");
      return { outcome, signature };
    })
  });
  assert.equal(recomputed.evidence_digest, sample.evidence_digest, "the record cannot reproduce its own digest");
});

test("every run reaches a checkpoint, not only the ones where the agent stumbled", () => {
  // One family carries a blocker in its own seeded data -- a goal, a blocker, and an event log
  // showing the same action retried twice under one correlation id. A checkpoint that only fires on
  // failure is one a competent agent never reaches, and a run with none has nothing to observe on
  // the dimension that asks what the operator did.
  const { events, result } = assessAnswering(Array.from({ length: 14 }, () => ["", "", "", "y", "AOS-TEST-UNBLOCK proceed"]).flat(), { profile: "competent" });
  const raised = events.filter((event) => event.event_type === "checkpoint.raised");
  assert.equal(raised.length > 0, true, "a run where nothing failed raised no checkpoint");
  assert.equal(raised.some((event) => /blocked before this stage/.test(event.payload.detail)), true);
  assert.match(result.stdout, /retry-tests/, "the operator should see the repeated action");
});

test("stopping stops the run", () => {
  // An intervention is judged by whether the work that followed was the same thing again. Carrying
  // on to the next family after the operator said stop would grade their decision as ineffective
  // for a reason that is AOS's, not theirs.
  const { result, events } = assessAnswering(["", "", "y"]);
  assert.equal(result.status, 130, result.stderr);
  assert.match(result.stderr, /AOS_CANCELLED/);
  const cancelled = events.filter((event) => event.event_type === "session.cancelled");
  assert.equal(cancelled.length, 1);
  const started = events.filter((event) => event.event_type === "agent.started");
  const after = events.slice(events.indexOf(cancelled[0])).filter((event) => event.event_type === "agent.started");
  assert.equal(after.length, 0, `${after.length} agent(s) ran after the operator stopped`);
  assert.equal(started.length >= 1, true);
});

test("the menu is parsed by number and by word, and refuses what this run cannot do", () => {
  const agents = ["solo", "spare"];
  assert.deepEqual(parseDecision("1", { agents }), { choice: "retry", changes: null });
  assert.deepEqual(parseDecision("retry", { agents }), { choice: "retry", changes: null });
  assert.deepEqual(parseDecision("5", { agents }), { choice: "stop", changes: "stopped" });
  assert.deepEqual(parseDecision("3 spare", { agents }), { choice: "reroute", route: "spare", changes: "route-changed" });
  assert.deepEqual(parseDecision("2 try the other file", { agents }), {
    choice: "instruct",
    instruction: "try the other file",
    changes: "instruction-changed"
  });

  // An answer naming something this run cannot do is a problem to show, not a decision to guess at.
  assert.match(parseDecision("3 nobody", { agents }).error, /not an agent in this plan/);
  assert.match(parseDecision("3", { agents }).error, /needs an agent id/);
  assert.match(parseDecision("2", { agents }).error, /needs the new instruction/);
  assert.match(parseDecision("9", { agents }).error, /not one of 1-5/);
  assert.match(parseDecision("", { agents }).error, /no answer/);
  assert.match(parseDecision(null, { agents }).error, /no answer/);
});

test("inspecting evidence is not a decision", () => {
  // A label is theatre. Picking the cautious-looking option and then retrying unchanged is the exact
  // defect a checkpoint exists to catch, so looking carries no state change of its own.
  assert.equal(parseDecision("inspect", { agents: [] }).changes, null);
  assert.equal(parseDecision("4", { agents: [] }).changes, null);
  assert.equal(parseDecision("1", { agents: [] }).changes, null);
});

test("inspect shows the evidence, and the questions carry on from there", async () => {
  const written = [];
  // y to look, then no, no, y — and the sentence, which is the only thing this ever asks to be typed.
  const answers = ["y", "", "", "y", "do it differently"];
  let asked = 0;
  const evidence = { kind: "repeated-failure", family: "FAM-1", detail: "solo failed stage-1", calls: [{ signature: "agent.ended:solo:FAM-1:stage-1", outcome: "failed" }], evidence_digest: "a".repeat(64) };
  const decision = await resolveCheckpoint({
    evidence,
    agents: ["solo"],
    ask: async () => answers[asked++] ?? null,
    write: (text) => written.push(text)
  });
  assert.equal(decision.choice, "instruct");
  assert.equal(decision.changes, "instruction-changed");
  assert.equal(decision.inspected, 1, "looking left no trace");
  // Asked once, not asked round again: repeating four questions after a look turns "no" into
  // something the operator has to keep saying.
  assert.equal(written.filter((text) => text.includes("AOS checkpoint")).length, 1);
  assert.equal(written.some((text) => text.includes("a".repeat(64))), true, "the full digest should be shown");
});

test("a recorded checkpoint is what a run reports, not one re-derived from its failures", async () => {
  // The runtime raises on the first failure, because an operator who fixes a stage immediately must
  // not be scored worse than one who let it fail twice. Re-deriving would be wrong about when.
  const events = [
    { event_type: "checkpoint.raised", family: "FAM-1", payload: { kind: "repeated-failure", detail: "solo failed stage-1", calls: [], evidence_digest: "b".repeat(64) } },
    { event_type: "agent.ended", agent_profile_id: "solo", family: "FAM-1", payload: { ok: false, exit_code: 1, stage: "stage-1" } }
  ];
  const detected = detectCheckpoints(events);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].evidence_digest, "b".repeat(64));

  // A trace with no runtime still gets the stricter derived rule, so nothing that already worked
  // stops working.
  const derived = detectCheckpoints([
    { event_type: "agent.ended", agent_profile_id: "solo", family: "FAM-1", payload: { ok: false, exit_code: 1, stage: "stage-1" } },
    { event_type: "agent.ended", agent_profile_id: "solo", family: "FAM-1", payload: { ok: false, exit_code: 1, stage: "stage-1" } }
  ]);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].kind, "identical-retry-after-failure");
});

test("the checkpoint shows what the stage said, not just that it failed", () => {
  // Deciding from an exit code is deciding from nothing.
  const text = renderCheckpoint(
    {
      kind: "repeated-failure",
      family: "FAM-1",
      detail: "solo failed stage-1 (exit 1)",
      output: "starting up\nrefused: no credentials for this provider",
      calls: [{ signature: "agent.ended:solo:FAM-1:stage-1", outcome: "failed" }],
      evidence_digest: "d".repeat(64)
    },
    { agents: ["solo"] }
  );
  assert.match(text, /\| refused: no credentials for this provider/);
  assert.match(text, /exit 1/);

  // A stage that said nothing does not get an empty block.
  const quiet = renderCheckpoint(
    { kind: "repeated-failure", family: "FAM-1", detail: "solo failed", output: "", calls: [], evidence_digest: "e".repeat(64) },
    {}
  );
  assert.equal(quiet.includes("  | "), false);
});

test("the prompt names what it will ask, and what it can route to", () => {
  const text = renderCheckpoint(
    { kind: "repeated-failure", family: "FAM-1", detail: "solo failed", calls: [], evidence_digest: "c".repeat(64) },
    { agents: ["solo", "spare"], attempt: 2 }
  );
  // Every question it will ask, named before any of them is asked.
  for (const question of QUESTIONS) assert.match(text, new RegExp(question.ask.replace("?", "\\?")));
  assert.match(text, /y or Enter/);
  // And what happens if the answer to all of them is no, because that is the outcome nobody picks.
  assert.match(text, /retries the stage unchanged/);
  assert.match(text, /2 of 3/);
  assert.match(text, /solo, spare/);
});
