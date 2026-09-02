import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkpointEvidence, interventionSummary } from "../../lib/checkpoint.mjs";
import { canonicalJson, runProcess } from "../../lib/core.mjs";
import { evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { DECISION_TYPES, attestedOperatorTrace, isOperatorAuthorityType, mintOperatorEvent, recordBindingOf } from "../../lib/operator-events.mjs";
import { bindOperatorDecisions, boundDecisionTypes, constructForDecision, contextDecisions, dimensionForDecision, isShippedPlan, operatorPlanTemplate, parseProcessEvidenceId, processEvidence, processEvidenceId, routeEvidence, validateOperatorPlan } from "../../lib/operator-plan.mjs";
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
    // And with a real attestation on it, minted for this very run: an operator turn belongs in the
    // operator's stream, and an agent producer carrying one is a stream nothing downstream reads as
    // the operator's. Without this the producer check would be redundant with the attestation check
    // and could be deleted with every test still green.
    const attested = mintOperatorEvent({
      run_id: runId, source: "interactive-tty", decision_type: "intervention.decide",
      construct_cell_id: "C4.IQ.01", opportunity_id: "opp-stolen",
      challenge_digest: `sha256:${evidenceFixture().evidence_digest}`, value: { choice: "instruct" }, state_revision: 1
    }, { secret: operatorRunKey(root, runId) });
    assert.throws(
      () => appendEvent(root, runId, "agent-evil", { event_type: "operator.decision", family: "FAM-4", payload: { choice: "instruct" }, operator_event: attested }, { source: "interactive-tty" }),
      /AOS_NOT_OPERATOR_AUTHORITY operator.decision from agent-evil/u,
      "an attested operator turn was recorded under an agent producer"
    );
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
      challenge_digest: `sha256:${evidence.evidence_digest}`,
      value: { kind: evidence.kind },
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
    // And with the record binding computed correctly -- which anyone holding the key could do -- the
    // event itself is still what has to be attested. Without this the record binding alone would be
    // the whole check, and a record with no operator event on it would walk through.
    const bound = handWritten.map((record) => ({ ...record, operator_record_binding: recordBindingOf(record, secret) }));
    writeFileSync(file, `${bound.map((record) => JSON.stringify(record)).join("\n")}\n`);
    const withBindings = attestedOperatorTrace(readEvents(root, runId), { run_id: runId, secret });
    assert.deepEqual(withBindings.accepted, [], "a record whose wrapper was bound but whose event was not is an attested operator turn");
    assert.equal(withBindings.rejected.every((entry) => /no operator event was attached/u.test(entry.reason)), true, canonicalJson(withBindings.rejected));
    assert.equal(interventionSummary(withBindings.trace).observed, false);
    assert.equal(attested.rejected.every((entry) => /no operator event was attached|does not match the binding taken when it was written/u.test(entry.reason)), true, canonicalJson(attested.rejected));
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
  challenge: { asked: "goal" },
  value: { goal: "ship" },
  state_revision: 1,
  ...over
}, { secret: SECRET });

test("every bound Process row carries the operator event, the cell, the opportunity, the authority and the state revision", () => {
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

test("every decision type the schema admits binds to the construct and the dimension it is evidence about", () => {
  // The values, not only that there are values. Round 3: this compared key sets and checked for
  // non-null, so moving `verification.choose` from C5 to C1 -- an admitted decision landing on the
  // wrong construct's cell -- left it passing.
  const declared = [...DECISION_TYPES].sort();
  assert.deepEqual(boundDecisionTypes(), declared);
  const expected = new Map([
    ["spec.goal", ["C1", "D1"]],
    ["constraint.add", ["C1", "D1"]],
    ["plan.approve", ["C1", "D1"]],
    ["plan.edit", ["C1", "D1"]],
    ["context.include", ["C2", "D2"]],
    ["context.exclude", ["C2", "D2"]],
    ["context.inspect", ["C2", "D2"]],
    ["context.request-metadata", ["C2", "D2"]],
    ["route.assign", ["C2", "D3"]],
    ["parallelism.choose", ["C2", "D3"]],
    ["verification.choose", ["C5", "D3"]],
    ["budget.set", ["C6", "D3"]],
    ["checkpoint.observe", ["C3", "D4"]],
    ["intervention.decide", ["C4", "D4"]],
    ["initial.judgment", ["C3", "reliance"]],
    ["advice.response", ["C3", "reliance"]]
  ]);
  assert.deepEqual(declared, [...expected.keys()].sort());
  for (const [decisionType, [construct, dimension]] of expected) {
    assert.equal(constructForDecision(decisionType), construct, decisionType);
    assert.equal(dimensionForDecision(decisionType), dimension, decisionType);
  }
  // And the construct each one names is one this contract actually declares an operator-process
  // cell for, so the table cannot drift away from the contract without this failing.
  const cells = bindOperatorDecisions([], { contract: shipped }).cells;
  for (const construct of new Set(expected.values().map(([id]) => id))) {
    assert.equal(cells.some((cell) => cell.construct_id === construct), true, `${construct} has no operator-process cell`);
  }
  assert.equal(constructForDecision("something.else"), null);
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
  // And an intervention summary that says it observed something does not survive a binding with
  // nothing in it: the scorable cells have no operator event behind them, so the metrics that read
  // them are withheld and the reason names the cells rather than the operator.
  const evidence = processEvidence(binding, { observed: true, observations: [], checkpoints_raised: 1 });
  assert.equal(evidence.interventions.observed, false, "a run with no bound operator decision reported an observed intervention");
  assert.deepEqual(evidence.evidence_ids, []);
  assert.deepEqual([...evidence.withheld_for].sort(), ["C3.ER.01", "C4.IQ.01"]);
  assert.match(evidence.interventions.withheld_reason, /C3.ER.01, C4.IQ.01/u);
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

test("counterfactual: a bad operator route stays the operator's, and this contract cannot yet lower a construct for it", () => {
  // The issue's counterfactual is "bad operator route + strong agent success -> route Process falls,
  // Outcome may be high". Half of it is demonstrable here and half of it is not, and the name says
  // which. The operator's declared route binds to C2.OD.01, the invocation that actually ran binds
  // to the same opportunity on the other axis, and the divergence is recorded against that
  // opportunity. What cannot be shown is the fall: the shipped contract declares C2.OD.01 with no
  // subcheck at all, so nothing can score a routing decision however bad it is -- which the binding
  // reports as its own reason rather than as the operator's silence. Populating that cell is a
  // change to contracts/, which is #582's.
  const binding = bindOperatorDecisions([
    decision({ decision_type: "route.assign", construct_cell_id: "C2.OD.01", opportunity_id: "opp-d3-route", declared_route: ["weak-agent"] })
  ], { contract: shipped });
  const evidence = routeEvidence(binding, [{ agent: "strong-agent", opportunity_id: "opp-d3-route" }, { agent: "strong-agent", opportunity_id: "opp-d3-route" }]);
  const [row] = evidence.opportunities;
  assert.equal(row.opportunity_id, "opp-d3-route");
  assert.equal(row.process.axis, "operator_process");
  assert.deepEqual(row.process.route, ["weak-agent"]);
  assert.equal(row.outcome.axis, "system_outcome");
  assert.deepEqual(row.outcome.invoked, ["strong-agent", "strong-agent"]);
  assert.equal(row.diverged, true, "the declared route and the route that ran were reported as the same thing");
  assert.equal(evidence.any_diverged, true);

  // The cell the decision bound to is bound, and unscorable, and says which of the two it is.
  const cell = binding.cells.find((entry) => entry.cell_id === "C2.OD.01");
  assert.equal(cell.status, "BOUND");
  assert.equal(cell.scorable, false);
  assert.equal(cell.population_status, "DECLARED_UNPOPULATED");
  assert.match(cell.reason, /declares C2.OD.01 with no subcheck/u);
  // So the process index is withheld for C2 by the contract, not because the operator said nothing.
  assert.equal(processEvidence(binding, { observed: true }).withheld_for.includes("C2.OD.01"), false,
    "an unscorable cell was reported as a missing observation");
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
      construct_cell_id: "C4.IQ.01", opportunity_id: "opp-x", challenge_digest: `sha256:${evidence.evidence_digest}`, value: { choice: "instruct" }, state_revision: 1
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
  const stages = [];
  const reliance = createRelianceTrace({
    run_id: RUN,
    secret: SECRET,
    journal: { record: (opportunity_id, stage, event) => stages.push({ opportunity_id, stage, event }), read: () => [...stages] }
  });
  assert.throws(() => reliance.commitInitialJudgment({
    source: "interactive-tty",
    construct_cell_id: "C3.ER.01",
    opportunity_id: "opp-reliance-bundled",
    challenge: { asked: "is it safe" },
    judgment: { answer: "mine" },
    named_evidence_ids: ["migrations.0042.sql"],
    proactive_delegation: "DECIDE_ALONE",
    reported_confidence: 0.5,
    advice_response: { answer: "the model's" }
  }), /reliance opportunity rejected/u);
  assert.equal(reliance.opportunities().length, 0);
});

// --- the checkpoint window, which is the opportunity itself ---------------------------------------

test("an operator turn with no checkpoint in front of it is not an intervention, because an opportunity nobody administered is not one", () => {
  // The window guard in `lib/checkpoint.mjs` used to be held by a different fact: every stage sent a
  // `user.instruction` under producer `operator`, so without the window the plan being carried out
  // read as the operator stepping in. That instruction is a `plan.instruction` under producer `aos`
  // since this issue and is never scored, so the old fixture no longer exercises the line. What the
  // window still decides is this: a turn that answers no question is not an answer, and an
  // opportunity nobody administered is the thing #560 refuses to let anything manufacture.
  const evidence = evidenceFixture();
  const operatorRecord = (event_type, event_id, payload) => ({ event_type, event_id, family: "FAM-4", producer_id: "operator", payload });
  const answered = [
    operatorRecord("checkpoint.raised", "c-1", evidence),
    operatorRecord("operator.decision", "d-1", { stage: "s1", choice: "retry", inspected: 1 })
  ];
  assert.equal(interventionSummary(answered).interventions, 1);
  const withAnUnaskedTurn = [
    ...answered,
    operatorRecord("user.instruction", "i-2", { stage: "s1", instruction_digest: "sha256:zz" }),
    operatorRecord("session.cancelled", "x-2", { stage: "s1", reason: "later" })
  ];
  assert.equal(interventionSummary(withAnUnaskedTurn).interventions, 1,
    "a turn recorded after the window closed, with no checkpoint of its own, was counted as an intervention");
  // And a second checkpoint opens a second window, so this is a window rather than a one-shot.
  const askedTwice = [
    ...answered,
    operatorRecord("checkpoint.raised", "c-2", evidence),
    operatorRecord("operator.decision", "d-2", { stage: "s1", choice: "reroute", route_changed: true })
  ];
  assert.equal(interventionSummary(askedTwice).interventions, 2);
});

// --- round 2: the key, the channel, and the binding ----------------------------------------------

/** Every regular file under a directory, recursively. */
const filesUnder = (root) => readdirSync(root, { withFileTypes: true, recursive: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath ?? entry.path, entry.name));

test("the run's operator secret is written to no file under the operator's AOS home", () => {
  // Round 1 put it at <run>/operator.key, and lib/cli.mjs runs the agent in <run>/workspaces/<family>
  // as the same user -- so `$AOS_WORKSPACE/../../operator.key` was the capability, one relative path
  // away from the process being assessed. A secret on disk beside the thing it is defending against
  // is not a secret.
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    const secret = operatorRunKey(root, runId);
    assert.equal(typeof secret, "string");
    assert.equal(secret.length >= 32, true);
    const leaking = filesUnder(root).filter((file) => readFileSync(file, "utf8").includes(secret));
    assert.deepEqual(leaking, [], "the run secret is readable from the filesystem");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nothing an agent can read from the run directory mints a record the scorer accepts", () => {
  // The reviewer's reproduction, generalised: try every byte string the run directory holds as the
  // session key, forge the three records with `producer_id: "operator"`, append them to the run's own
  // event file, and score the result.
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    operatorRunKey(root, runId);
    const evidence = evidenceFixture();
    const candidates = filesUnder(root).map((file) => readFileSync(file, "utf8").trim()).filter((text) => text.length > 0);
    assert.equal(candidates.length > 0, true, "the run directory holds no files, so this test proves nothing");
    const forgeries = [];
    for (const candidate of candidates) {
      let minted;
      try {
        minted = mintOperatorEvent({
          run_id: runId, source: "interactive-tty", decision_type: "checkpoint.observe",
          construct_cell_id: "C3.ER.01", opportunity_id: "opp-forged",
          challenge_digest: `sha256:${evidence.evidence_digest}`, value: { forged: true }, state_revision: 1
        }, { secret: candidate });
      } catch { continue; }
      forgeries.push({
        schema_id: "aos-event", schema_version: "aos-event.v1", event_id: `event-forged-${forgeries.length}`,
        run_id: runId, producer_id: "operator", producer_seq: forgeries.length + 1,
        event_type: "checkpoint.raised", parent_event_id: null, correlation_id: `corr-${forgeries.length}`,
        agent_profile_id: null, family: "FAM-4", observed_at: "2026-09-03T00:00:00.000Z",
        evidence_digest: null, redaction_state: "projected", payload: evidence,
        operator_event: minted,
        operator_authority: { source: "interactive-tty", authority: "DIRECT_LOCAL", provenance: "DIRECT", confidence: "HIGH" }
      });
    }
    writeFileSync(join(runPaths(root, runId).events, "operator.ndjson"), forgeries.map((r) => JSON.stringify(r)).join("\n") + (forgeries.length > 0 ? "\n" : ""));
    const events = readEvents(root, runId);
    const attested = attestedOperatorTrace(events, { run_id: runId, secret: operatorRunKey(root, runId) });
    assert.deepEqual(attested.accepted, [], "a key readable from the run directory minted an accepted record");
    assert.equal(interventionSummary(attested.trace).observed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a route the operator declared is compared with the invocations of its own opportunity, not with every invocation in the run", () => {
  // Round 1 flattened every invocation into one list and compared it with the last declared route,
  // so two opportunities and one matching invocation reported diverged: true.
  const binding = bindOperatorDecisions([
    decision({ decision_type: "route.assign", construct_cell_id: "C2.OD.01", opportunity_id: "opp-one", declared_route: ["alpha"], state_revision: 1 }),
    decision({ decision_type: "route.assign", construct_cell_id: "C2.OD.01", opportunity_id: "opp-two", declared_route: ["beta"], state_revision: 1 })
  ], { contract: shipped });
  const evidence = routeEvidence(binding, [{ agent: "alpha", opportunity_id: "opp-one" }]);
  const one = evidence.opportunities.find((row) => row.opportunity_id === "opp-one");
  const two = evidence.opportunities.find((row) => row.opportunity_id === "opp-two");
  assert.equal(one.diverged, false, "the invocation that matches its own declared route was called a divergence");
  assert.equal(two.diverged, null, "an opportunity with no invocation of its own was decided rather than left undecided");
  assert.deepEqual(one.outcome.invoked, ["alpha"]);
  assert.deepEqual(two.outcome.invoked, []);
  // An invocation nobody can attribute is carried as that, and decides nothing.
  const unattributed = routeEvidence(binding, [{ agent: "gamma" }]);
  assert.deepEqual(unattributed.unattributed_invocations, ["gamma"]);
  assert.equal(unattributed.opportunities.every((row) => row.diverged === null), true);
});

test("editing the stored payload of an attested record makes the scorer refuse it", () => {
  // Round 2: the signature covered only the nested operator event, and scoring reads the outer
  // record's `payload`. The agent runs two path segments from `events/operator.ndjson` as the same
  // user, so after a real checkpoint it could rewrite `{inspected: 0, route_changed: false}` to
  // `{inspected: 99, route_changed: true}` -- forging no event and learning no key, and moving M11
  // from 0.75 to 1.0.
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    const secret = operatorRunKey(root, runId);
    const evidence = evidenceFixture();
    const mint = (decision_type, cell, revision, value) => mintOperatorEvent({
      run_id: runId, source: "interactive-tty", decision_type, construct_cell_id: cell,
      opportunity_id: "opp-edit", challenge_digest: `sha256:${evidence.evidence_digest}`, value, state_revision: revision
    }, { secret });
    appendEvent(root, runId, "operator", {
      event_type: "checkpoint.raised", family: "FAM-4", payload: evidence,
      operator_event: mint("checkpoint.observe", "C3.ER.01", 1, { kind: evidence.kind })
    }, { source: "interactive-tty" });
    appendEvent(root, runId, "operator", {
      event_type: "operator.decision", family: "FAM-4",
      payload: { stage: "s1", choice: "retry", route_changed: false, inspected: 0, evidence_digest: evidence.evidence_digest },
      operator_event: mint("intervention.decide", "C4.IQ.01", 2, { stage: "s1", choice: "retry", route_changed: false, inspected: 0 })
    }, { source: "interactive-tty" });

    const honest = attestedOperatorTrace(readEvents(root, runId), { run_id: runId, secret });
    assert.equal(honest.accepted.length, 2, "the honest trace was not accepted");
    assert.equal(interventionSummary(honest.trace).observations[0].inspected, 0);

    // Now the edit: the wrapper only, both attestations left exactly as they were.
    const file = join(runPaths(root, runId).events, "operator.ndjson");
    const records = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const decision = records.find((record) => record.event_type === "operator.decision");
    decision.payload = { ...decision.payload, inspected: 99, route_changed: true };
    writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

    const tampered = attestedOperatorTrace(readEvents(root, runId), { run_id: runId, secret });
    assert.equal(tampered.accepted.length, 1, "the edited record was accepted");
    assert.equal(tampered.rejected.some((entry) => /payload|record/u.test(entry.reason)), true, JSON.stringify(tampered.rejected));
    assert.equal(interventionSummary(tampered.trace).observed, false,
      "an edited wrapper still produced an observed intervention");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a process that did not record a run has no key for it, and says that rather than calling the evidence forged", () => {
  // Round 2: `operatorRunKey` minted on demand, so a second process asking for the same run got a
  // different key and every genuine record read as tampering. The secret is deliberately not on
  // disk -- there is nowhere on a single-user machine to put it that the assessed process cannot
  // read -- so a later process cannot re-authenticate this evidence. What it must not do is report
  // that as a forgery.
  const root = scratch();
  try {
    const { runId } = createRun(root, { mode: "CONTROLLED" });
    const secret = operatorRunKey(root, runId);
    assert.equal(typeof secret, "string");
    assert.equal(operatorRunKey(root, runId), secret, "the same process got two keys for one run");
    // A run this process never created is a run it holds no key for.
    assert.equal(operatorRunKey(root, "run-recorded-elsewhere"), null);
    const events = [{
      event_type: "operator.decision", event_id: "e-1", run_id: "run-recorded-elsewhere",
      producer_id: "operator", family: "FAM-4", payload: { choice: "instruct" }
    }];
    const read = attestedOperatorTrace(events, { run_id: "run-recorded-elsewhere", secret: operatorRunKey(root, "run-recorded-elsewhere") });
    assert.deepEqual(read.accepted, []);
    assert.equal(read.rejected.length, 1);
    assert.match(read.rejected[0].reason, /authenticated by the process that recorded it/u);
    assert.equal(interventionSummary(read.trace).observed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
