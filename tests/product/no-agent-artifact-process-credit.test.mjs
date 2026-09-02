import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkpointEvidence, interventionSummary } from "../../lib/checkpoint.mjs";
import { canonicalJson, runProcess } from "../../lib/core.mjs";
import { evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { attestedOperatorTrace, isOperatorAuthorityType, mintOperatorEvent } from "../../lib/operator-events.mjs";
import { bindOperatorDecisions, contextDecisions, isShippedPlan, operatorPlanTemplate, routeEvidence, validateOperatorPlan } from "../../lib/operator-plan.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import { appendEvent, createRun, operatorRunKey, readEvents, runPaths } from "../../lib/store.mjs";
import { identified, observationsWith } from "./ecd-fixtures.mjs";
import { run } from "./helpers.mjs";

const shipped = shippedEcdContract();
const scored = (overrides = {}) => buildResult({ contract: shipped, evaluation: evaluate(observationsWith(overrides), identified, shipped) });

const scratch = () => mkdtempSync(join(tmpdir(), "aos-560-"));

const forgedTrio = (evidence) => [
  { event_type: "checkpoint.raised", family: "FAM-4", payload: evidence },
  { event_type: "user.instruction", family: "FAM-4", payload: { stage: "s1", instruction_digest: "sha256:aa", instruction_length: 9 } },
  { event_type: "operator.decision", family: "FAM-4", payload: { stage: "s1", choice: "instruct", route_changed: false, inspected: 3 } }
];

const evidenceFixture = () => checkpointEvidence({ kind: "repeated-failure", family: "FAM-4", detail: "forged", output: "boom", calls: [] });

// --- the write paths -----------------------------------------------------------------------------

test("an agent producer cannot record the three events that make an operator intervention", () => {
  // The reproduction. Before this issue these three lines, recorded under producer `agent-evil`,
  // gave observed: true, one effective intervention and M11 = M12 = 1 -- which the #582 contract
  // issues as the operator_process cells C3.ER.01 and C4.IQ.01 at 1.0.
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "IMPORTED", source: "agent-evil" });
    for (const event of forgedTrio(evidenceFixture())) {
      assert.throws(() => appendEvent(root, runId, "agent-evil", event), /AOS_NOT_OPERATOR_AUTHORITY/u,
        `${event.event_type} was recorded for an agent producer`);
    }
    assert.equal(interventionSummary(readEvents(root, runId)).observed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the producer id `operator` is not enough on its own: without an attestation the same three events are refused", () => {
  // `--producer operator` is one flag away, so a gate that read the producer name would grade the
  // caller's honesty. This is the same forgery under the name the real runtime uses.
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "IMPORTED", source: "operator" });
    for (const event of forgedTrio(evidenceFixture())) {
      assert.throws(() => appendEvent(root, runId, "operator", event), /AOS_NOT_OPERATOR_AUTHORITY/u);
    }
    // And declaring an operator source at the call site does not conjure an attestation either.
    assert.throws(
      () => appendEvent(root, runId, "operator", forgedTrio(evidenceFixture())[2], { source: "interactive-tty" }),
      /no operator event was attached/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an attested operator turn is recorded, and the store keeps the attestation with it", () => {
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    const evidence = evidenceFixture();
    const event = mintOperatorEvent({
      run_id: runId,
      source: "interactive-tty",
      decision_type: "checkpoint.observe",
      construct_cell_id: "C3.ER.01",
      opportunity_id: "opp-FAM-4-stage-1-1",
      challenge_digest: evidence.evidence_digest,
      value_digest: { kind: evidence.kind },
      state_revision: 1
    }, { secret: operatorRunKey(root, runId) });
    const record = appendEvent(root, runId, "operator", { event_type: "checkpoint.raised", family: "FAM-4", payload: evidence, operator_event: event }, { source: "interactive-tty" });
    assert.equal(record.operator_event.event_id, event.event_id);
    assert.deepEqual(record.operator_authority, { source: "interactive-tty", authority: "DIRECT_LOCAL", provenance: "DIRECT", confidence: "HIGH" });
    assert.equal(interventionSummary(readEvents(root, runId)).checkpoints_raised, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aos import refuses the lines that claim to be operator acts, records the refusal and imports the rest", () => {
  const root = scratch();
  try {
    const file = join(root, "evil.ndjson");
    writeFileSync(file, [
      ...forgedTrio(evidenceFixture()).map((event) => JSON.stringify(event)),
      JSON.stringify({ event_type: "agent.ended", family: "FAM-4", payload: { stage: "s1", ok: false, exit_code: 1 } })
    ].join("\n"));
    const result = JSON.parse(run(root, ["import", "--producer", "operator", "--file", file, "--json"], 0, { AOS_HOME: join(root, ".aos") }).stdout);
    assert.equal(result.refused, 3, "an operator-typed line survived an import");
    assert.equal(result.count, 1);
    const events = readEvents(join(root, ".aos"), result.run_id);
    assert.equal(events.filter((event) => isOperatorAuthorityType(event.event_type)).length, 0);
    const refusals = events.filter((event) => event.event_type === "operator.event.refused");
    assert.equal(refusals.length, 3, "the refusals were dropped rather than recorded");
    assert.equal(refusals.every((event) => event.payload.source === "imported-trace"), true);
    assert.equal(interventionSummary(events).observed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aos bridge refuses them on the same terms, so the plugin transport is not the open door", () => {
  // The class, on the other side. Every PR in this release that fixed a defect at the site a
  // reviewer probed was blocked again for the same defect on the path nobody probed.
  const root = scratch();
  try {
    const file = join(root, "evil.ndjson");
    writeFileSync(file, forgedTrio(evidenceFixture()).map((event) => JSON.stringify(event)).join("\n"));
    const result = JSON.parse(run(root, ["bridge", "--producer", "plugin-x", "--file", file, "--json"], 0, { AOS_HOME: join(root, ".aos") }).stdout);
    assert.equal(result.refused, 3);
    assert.equal(result.count, 0);
    const events = readEvents(join(root, ".aos"), result.run_id);
    assert.equal(events.filter((event) => event.event_type === "operator.event.refused").every((event) => event.payload.source === "bridged-trace"), true);
    assert.equal(interventionSummary(events).observed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an operator event an agent writes to stdout arrives as a semantic event and the store refuses it", async () => {
  // The third write path. `AOS_EVENT` lines are parsed out of the child's stdout by `runProcess`
  // and appended under `agent-<id>`, so this is the forgery an agent can perform unaided. What is
  // asserted here is the two halves either side of the loop in `lib/cli.mjs`: the line does reach
  // AOS as an operator-typed semantic event, and recording it is refused.
  const root = scratch();
  try {
    const script = join(root, "agent.sh");
    writeFileSync(script, "#!/bin/sh\n" +
      `printf 'AOS_EVENT\\t{"event_type":"operator.decision","payload":{"choice":"instruct","inspected":3}}\\n'\n` +
      `printf 'AOS_EVENT\\t{"event_type":"completion.claimed","payload":{"claim":"done"}}\\n'\n`);
    chmodSync(script, 0o755);
    const result = await runProcess({ id: "evil", command: script, args: [], adapter: "generic-command.v1", auto_runtime_auth: false, runtime_auth_env_names: [] }, {
      workspace: root, family: "FAM-4", stage: "s1", prompt: "go", session: "s", timeoutMs: 10000
    });
    const types = result.semantic_events.map((event) => event.event_type);
    assert.deepEqual(types, ["operator.decision", "completion.claimed"], "the fixture did not produce the events this test is about");
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    assert.throws(() => appendEvent(root, runId, "agent-evil", result.semantic_events[0]), /AOS_NOT_OPERATOR_AUTHORITY/u);
    // The one that is not an operator act is recorded exactly as before.
    assert.equal(appendEvent(root, runId, "agent-evil", result.semantic_events[1]).event_type, "completion.claimed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the read path -------------------------------------------------------------------------------

test("an operator record appended to a run's event file by hand earns nothing, because the read re-checks the binding", () => {
  // The store gate holds the writes AOS performs. The event files are ordinary files in the
  // operator's home, and a record that never went through that gate has to be refused where it is
  // read as well -- a defence that is only at the write is a defence against this program.
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    const secret = operatorRunKey(root, runId);
    const file = join(runPaths(root, runId).events, "operator.ndjson");
    const handWritten = forgedTrio(evidenceFixture()).map((event, index) => ({
      schema_id: "aos-event",
      schema_version: "aos-event.v1",
      event_id: `event-hand-${index}`,
      run_id: runId,
      producer_id: "operator",
      producer_seq: index + 1,
      event_type: event.event_type,
      parent_event_id: null,
      correlation_id: `corr-${index}`,
      agent_profile_id: null,
      family: "FAM-4",
      observed_at: "2026-09-03T00:00:00.000Z",
      evidence_digest: null,
      redaction_state: "projected",
      payload: event.payload,
      // Including the claim that it was attested. A record's own word for its authority arrived
      // with the record.
      operator_authority: { source: "interactive-tty", authority: "DIRECT_LOCAL", provenance: "DIRECT", confidence: "HIGH" }
    }));
    writeFileSync(file, `${handWritten.map((record) => JSON.stringify(record)).join("\n")}\n`);
    const events = readEvents(root, runId);
    assert.equal(events.length, 3, "the fixture did not reach the reader");
    const attested = attestedOperatorTrace(events, { run_id: runId, secret });
    assert.equal(attested.accepted.length, 0);
    assert.equal(attested.rejected.length, 3);
    assert.equal(attested.rejected.every((entry) => /no operator event was attached/u.test(entry.reason)), true, canonicalJson(attested.rejected));
    assert.equal(interventionSummary(attested.trace).observed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint observation ignores a recorded event whose producer is not the operator, without deciding anything about an unattributed one", () => {
  // The narrowest of the three layers, and the name says so. This predicate answers "the record
  // says an agent wrote it"; whether an unattributed object is an operator turn is what the
  // attestation answers, and this cannot tell a bare fixture from a real turn.
  const evidence = evidenceFixture();
  const stored = (producer) => forgedTrio(evidence).map((event, index) => ({ ...event, event_id: `e-${producer}-${index}`, producer_id: producer, producer_seq: index + 1 }));
  assert.equal(interventionSummary(stored("agent-evil")).observed, false);
  assert.equal(interventionSummary(stored("plugin-x")).observed, false);
  assert.equal(interventionSummary(stored("aos")).observed, false);
  // Unattributed objects are left alone: two layers above this one decide that case.
  const unattributed = forgedTrio(evidence).map((event, index) => ({ ...event, event_id: `e-bare-${index}` }));
  assert.equal(interventionSummary(unattributed).observed, true);
});

// --- D1-D3 binding -------------------------------------------------------------------------------

const SECRET = "4b6e".repeat(16);
const RUN = "run-560-binding";
const decision = (over = {}) => mintOperatorEvent({
  run_id: RUN,
  source: "interactive-tty",
  decision_type: "spec.goal",
  construct_cell_id: "C1.OF.01",
  opportunity_id: "opp-d1-goal",
  challenge_digest: { asked: "goal" },
  value_digest: { goal: "ship" },
  state_revision: 1,
  ...over
}, { secret: SECRET });

test("every scored Process row carries the operator event, the cell, the opportunity, the authority and the state revision", () => {
  const binding = bindOperatorDecisions([
    decision(),
    decision({ decision_type: "context.include", construct_cell_id: "C2.OD.01", opportunity_id: "opp-d2-include" }),
    decision({ decision_type: "route.assign", construct_cell_id: "C2.OD.01", opportunity_id: "opp-d3-route", declared_route: ["alpha", "beta"] })
  ], { contract: shipped });
  assert.equal(binding.rows.length, 3);
  for (const row of binding.rows) {
    for (const field of ["operator_event_id", "construct_cell_id", "opportunity_id", "source", "authority", "provenance", "state_revision"]) {
      assert.ok(row[field] !== undefined && row[field] !== null, `${field} is missing from a scored row`);
    }
  }
  assert.deepEqual(binding.rows.map((row) => row.dimension), ["D1", "D2", "D3"]);
  const bound = binding.cells.filter((cell) => cell.status === "BOUND").map((cell) => cell.cell_id);
  assert.deepEqual(bound.sort(), ["C1.OF.01", "C2.OD.01"]);
});

test("a decision missing any one of the five references is not a scored row, and its cell stays NOT_OBSERVED", () => {
  for (const field of ["event_id", "construct_cell_id", "opportunity_id", "authority", "state_revision"]) {
    const stripped = { ...decision() };
    delete stripped[field];
    const binding = bindOperatorDecisions([stripped], { contract: shipped });
    assert.equal(binding.rows.length, 0, `a row survived with no ${field}`);
    assert.equal(binding.rejected.length, 1);
    assert.match(binding.rejected[0].reason, /a scored Process row references/u);
    assert.equal(binding.cells.find((cell) => cell.cell_id === "C1.OF.01").status, "NOT_OBSERVED");
  }
});

test("a decision bound to a cell on another axis, another construct, or no cell at all is refused rather than credited", () => {
  const wrongAxis = bindOperatorDecisions([decision({ construct_cell_id: "C1.GF.01" })], { contract: shipped });
  assert.match(wrongAxis.rejected[0].reason, /delegated_artifact axis/u);
  const wrongConstruct = bindOperatorDecisions([decision({ construct_cell_id: "C2.OD.01" })], { contract: shipped });
  assert.match(wrongConstruct.rejected[0].reason, /is evidence about C1 and C2.OD.01 belongs to C2/u);
  const noCell = bindOperatorDecisions([decision({ construct_cell_id: "C9.ZZ.99" })], { contract: shipped });
  assert.match(noCell.rejected[0].reason, /is not a cell in this contract/u);
  for (const binding of [wrongAxis, wrongConstruct, noCell]) assert.equal(binding.rows.length, 0);
});

test("the cells this binding reports are the operator_process cells the contract declares, with the contract's own subcheck mapping", () => {
  const binding = bindOperatorDecisions([], { contract: shipped });
  assert.deepEqual(binding.cells.map((cell) => cell.cell_id).sort(), ["C1.OF.01", "C2.OD.01", "C3.ER.01", "C4.IQ.01", "C5.VD.01", "C6.OG.01"]);
  // Read from `subcheckMapping()`, not restated: the contract is the only place a subcheck is bound
  // to a cell, and a second table here would be a second answer.
  const errorRecognition = binding.cells.find((cell) => cell.cell_id === "C3.ER.01");
  assert.deepEqual(errorRecognition.subcheck_ids, [
    "M11.blocked-before-unsafe-continuation",
    "M11.critical-evidence-inspected",
    "M11.failure-class-correct",
    "M11.injected-failure-detected"
  ]);
  assert.equal(errorRecognition.authority, "operator-canonical-event");
});

// --- the six counterfactuals ---------------------------------------------------------------------

test("counterfactual: the same operator input with a stronger model output leaves Process where it was and moves Outcome", () => {
  // M11 and M12 are the operator's; M14 and M17 are the system's.
  const weak = scored({ M14: false, M17: false });
  const strong = scored();
  assert.deepEqual(
    weak.operator_process_profile.constructs.C3,
    strong.operator_process_profile.constructs.C3
  );
  assert.deepEqual(
    weak.operator_process_profile.constructs.C4,
    strong.operator_process_profile.constructs.C4
  );
  assert.notEqual(weak.system_outcome_profile.index, strong.system_outcome_profile.index);
  assert.ok(strong.system_outcome_profile.index > weak.system_outcome_profile.index);
});

test("counterfactual: a perfect autogenerated plan with an operator who said nothing withholds Process", () => {
  const template = operatorPlanTemplate(["alpha"], { alpha: { adapter: "claude-code.v1" } });
  assert.deepEqual(validateOperatorPlan(template, ["alpha"]), [], "the shipped template is not a valid plan, so this test is about the wrong thing");
  assert.equal(isShippedPlan(template, ["alpha"]), true);
  // A complete, valid, shipped plan and no operator event at all.
  const binding = bindOperatorDecisions([], { contract: shipped });
  assert.equal(binding.rows.length, 0);
  assert.equal(binding.cells.every((cell) => cell.status === "NOT_OBSERVED"), true);
  assert.equal(binding.cells.every((cell) => /an AOS default, a template the operator did not edit and an agent's own artifact are all silence here/u.test(cell.reason)), true);
  // And through the result: with no operator turn observed, every process construct is withheld and
  // the index and the composite go with it.
  const silent = scored({ M11: null, M12: null, M13: null });
  assert.equal(silent.operator_process_profile.issued, false);
  assert.equal(silent.operator_process_profile.index, null);
  assert.deepEqual(silent.operator_process_profile.withheld_for, ["C1", "C2", "C3", "C4", "C5", "C6"]);
  assert.equal(silent.aos_composite.issued, false);
  assert.equal(silent.cells.find((cell) => cell.cell_id === "C3.ER.01").status, "NOT_OBSERVED");
  assert.equal(silent.cells.find((cell) => cell.cell_id === "C4.IQ.01").status, "NOT_OBSERVED");
});

test("counterfactual: an operator who chose a stale source keeps that D2 Process record when an agent corrects it", () => {
  const binding = bindOperatorDecisions([
    decision({ decision_type: "context.include", construct_cell_id: "C2.OD.01", opportunity_id: "opp-d2-stale", state_revision: 1, candidate_source: { source_id: "docs/stale.md", authority_class: "UNVERIFIED", version: "2019-01-01", untrusted_content: false, size_bytes: 100 } })
  ], { contract: shipped });
  const correction = { opportunity_id: "opp-d2-stale", corrected_by: "agent-alpha", source_id: "docs/authoritative.md" };
  const [row] = contextDecisions(binding, [correction]);
  assert.equal(row.operator_event_id, binding.rows[0].operator_event_id);
  assert.equal(row.axis, "operator_process");
  assert.equal(row.agent_corrections.length, 1);
  assert.equal(row.agent_corrections[0].axis, "system_outcome");
  // The agent's correction is beside the operator's decision, never in place of it.
  const withoutCorrection = contextDecisions(binding, [])[0];
  assert.equal(withoutCorrection.operator_event_id, row.operator_event_id);
  assert.equal(withoutCorrection.decision_type, row.decision_type);
  assert.equal(withoutCorrection.state_revision, row.state_revision);
});

test("counterfactual: a route the operator declared and the route that ran are two records, and the outcome can still be high", () => {
  const binding = bindOperatorDecisions([
    decision({ decision_type: "route.assign", construct_cell_id: "C2.OD.01", opportunity_id: "opp-d3-route", declared_route: ["weak-agent"] })
  ], { contract: shipped });
  const evidence = routeEvidence(binding, [{ agent: "strong-agent" }, { agent: "strong-agent" }]);
  assert.equal(evidence.process.axis, "operator_process");
  assert.deepEqual(evidence.process.declared[0].route, ["weak-agent"]);
  assert.equal(evidence.outcome.axis, "system_outcome");
  assert.deepEqual(evidence.outcome.invoked, ["strong-agent", "strong-agent"]);
  assert.equal(evidence.diverged, true, "the declared route and the route that ran were reported as the same thing");
  // A run with no declared route leaves divergence undecided rather than false.
  assert.equal(routeEvidence(bindOperatorDecisions([], { contract: shipped }), [{ agent: "strong-agent" }]).diverged, null);
  // And a strong outcome is still a strong outcome.
  assert.equal(scored().system_outcome_profile.index, 100);
});

test("counterfactual: an agent or plugin event that claims to be an operator act is refused by the authority on every write path", () => {
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    const evidence = evidenceFixture();
    // Same event, four producers, one refusal each.
    for (const producer of ["agent-alpha", "plugin-x", "aos", "grader"]) {
      assert.throws(() => appendEvent(root, runId, producer, { event_type: "operator.decision", family: "FAM-4", payload: { choice: "instruct" } }), /AOS_NOT_OPERATOR_AUTHORITY/u, producer);
    }
    // And an event minted under a different run's key, offered here under the right producer.
    const elsewhere = mintOperatorEvent({
      run_id: "run-somewhere-else", source: "interactive-tty", decision_type: "intervention.decide",
      construct_cell_id: "C4.IQ.01", opportunity_id: "opp-x", challenge_digest: evidence.evidence_digest, value_digest: { choice: "instruct" }, state_revision: 1
    }, { secret: SECRET });
    assert.throws(
      () => appendEvent(root, runId, "operator", { event_type: "operator.decision", family: "FAM-4", payload: { choice: "instruct" }, operator_event: elsewhere }, { source: "interactive-tty" }),
      /minted for run-somewhere-else/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("counterfactual: an initial judgment bundled into one payload with the post-advice response is refused as a reliance opportunity", async () => {
  const { createRelianceTrace } = await import("../../lib/operator-events.mjs");
  const reliance = createRelianceTrace({ run_id: RUN, secret: SECRET });
  assert.throws(() => reliance.commitInitialJudgment({
    source: "interactive-tty",
    construct_cell_id: "C3.ER.01",
    opportunity_id: "opp-reliance-bundled",
    value_digest: { answer: "mine" },
    reported_confidence: 0.5,
    advice_response: { answer: "the model's" }
  }), /reliance opportunity rejected/u);
  assert.equal(reliance.opportunities().length, 0);
});
