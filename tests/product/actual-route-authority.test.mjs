// #558, the ledger's authority over the declaration.
//
// A capability digest on an event is a claim about who produced the record it names, and it is
// checked against the record AOS holds rather than believed. A declared schedule is the artifact's
// account of its own order, and two invocations recorded in the air together outrank it. The
// oracle's own digest is recomputed rather than read off the record it sits on.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { METRICS } from "../../lib/metrics.mjs";
import { observeRun } from "../../lib/observe.mjs";
import { ADAPTERS } from "../../lib/profile.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import {
  ACTUAL_ROUTE_EVENT_SCHEMA,
  AGENT_CAPABILITY_SCHEMA,
  AOS_KNOWN_CAPABILITIES,
  CAPABILITY_VOCABULARY,
  M09_OBSERVABLE_IDS,
  MAX_SEARCH_STATES,
  ROUTE_ORACLE_SCHEMA,
  ROUTING_OBSERVABLE_IDS,
  ROUTING_REQUIREMENT_SCHEMA,
  capabilityDigestOf,
  capabilityRecord,
  capabilityRecordsFor,
  delegationOracle,
  minimumRoute,
  parseRouteOracleEvidenceId,
  requirementsFromWork,
  routeOracle,
  routeOracleDigest,
  routeOracleEvidenceId,
  routingObservables,
  validateActualRouteEvent,
  validateAgentCapability,
  validateRoutingRequirement
} from "../../lib/routing-oracle.mjs";

// #558's second half made the cost floor a separate input, and since round 1 of the merge gate the
// oracle derives that floor from the envelope's `work_graph` rather than reading a requirement list
// off it -- a list no digest covered, swappable for the route-derived one on an otherwise honest
// record. So a fixture supplies the graph, not the requirements. These fixtures' graph IS their
// work. What production supplies instead -- `FORM_WORK` through `workRequirementAtPlanApproval` --
// is asked in `routing-work-requirement.test.mjs`.
const floorOf = (workGraph) => ({ work_graph: workGraph, problems: [] });
/** The oracle asked with a floor, which every one of these fixtures prices against its own work. */
const pricedOracle = (input, workGraph = WORK) => routeOracle({ ...input, work_requirement: floorOf(workGraph) });

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const corpus = JSON.parse(readFileSync(join(root, "fixtures", "attacks", "corpus.v1.json"), "utf8"));

const WORK = {
  tasks: [
    { id: "contract", resource: "spec", depends_on: [] },
    { id: "implementation", resource: "src", depends_on: ["contract"] },
    { id: "docs", resource: "docs", depends_on: ["contract"] },
    { id: "verification", resource: "src", depends_on: ["implementation"] },
    { id: "release", resource: "join", depends_on: ["docs", "verification"] }
  ]
};

const known = (id) => capabilityRecord({ agent_id: id, capabilities: [...CAPABILITY_VOCABULARY], source: "aos-known", evidence_ids: ["adapter:claude-code.v1"] });
const twoKnown = () => new Map([["one", known("one")], ["two", known("two")]]);

const event = (overrides = {}) => ({
  schema_id: ACTUAL_ROUTE_EVENT_SCHEMA,
  task_id: null,
  agent_id: "one",
  route_id: "one",
  invocation_id: "invocation-1",
  purpose_id: "FAM-3/stage-1",
  started_at: null,
  completed_at: null,
  artifact_ids: [],
  handoff_ids: [],
  capability_digest: null,
  operator_decision_event_id: null,
  operator_opportunity_id: null,
  ...overrides
});

test("the capability digest is recomputed from the record and never read off it", () => {
  const record = known("one");
  assert.equal(capabilityDigestOf(record), record.capability_digest);
  // The same abilities from a different source are a different record.
  const declaredSame = capabilityRecord({ agent_id: "one", capabilities: [...CAPABILITY_VOCABULARY], source: "declared", evidence_ids: ["adapter:claude-code.v1"] });
  assert.notEqual(capabilityDigestOf(declaredSame), record.capability_digest);
  // A record carrying somebody else's digest is not believed.
  assert.notEqual(capabilityDigestOf({ ...record, agent_id: "two" }), record.capability_digest);
});

test("an event whose capability digest is not the one AOS holds is refused, not read", () => {
  const capabilities = twoKnown();
  const requirements = requirementsFromWork(WORK).requirements;
  const good = event({ capability_digest: capabilityDigestOf(capabilities.get("one")) });
  const forged = event({ invocation_id: "invocation-2", capability_digest: `sha256:${"0".repeat(64)}` });
  const oracle = pricedOracle({ requirements, capabilities, actual_route_events: [good, forged] });
  assert.deepEqual(oracle.actual_route_events.map((entry) => entry.invocation_id), ["invocation-1"]);
  assert.equal(oracle.rejected_route_events.length, 1);
  assert.match(oracle.rejected_route_events[0].reason, /not the digest of the record AOS holds/u);
});

test("an event naming an agent with no capability record at all is refused when it claims a digest", () => {
  const oracle = pricedOracle({
    requirements: requirementsFromWork(WORK).requirements,
    capabilities: twoKnown(),
    actual_route_events: [event({ agent_id: "stranger", capability_digest: `sha256:${"a".repeat(64)}` })]
  });
  assert.deepEqual(oracle.actual_route_events, []);
  assert.match(oracle.rejected_route_events[0].reason, /has no capability record in this run/u);
});

// --- the solver --------------------------------------------------------------------------------------

test("the route oracle digest covers the record and moves when the record does", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const one = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event()] });
  const again = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event()] });
  assert.equal(one.route_oracle_digest, again.route_oracle_digest);
  assert.equal(routeOracleDigest(one), one.route_oracle_digest, "the digest is not the digest of the record it sits on");
  const different = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event({ agent_id: "two" })] });
  assert.notEqual(different.route_oracle_digest, one.route_oracle_digest);
  // A record whose digest field is edited still recomputes to the real one.
  assert.equal(routeOracleDigest({ ...one, route_oracle_digest: `sha256:${"0".repeat(64)}` }), one.route_oracle_digest);
});

test("shared-resource work shown overlapping in the ledger fails even when the schedule orders it", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const schedule = WORK.tasks.map((task) => ({ task_id: task.id, after: task.depends_on }));
  const timed = (taskId, agentId, from, to) => event({
    task_id: taskId, agent_id: agentId, invocation_id: `invocation-${taskId}`, purpose_id: taskId,
    started_at: from, completed_at: to, artifact_ids: [`artifact-${taskId}`]
  });
  const apart = [
    timed("implementation", "one", "2026-09-01T10:00:00Z", "2026-09-01T10:05:00Z"),
    timed("verification", "two", "2026-09-01T10:06:00Z", "2026-09-01T10:09:00Z")
  ];
  const together = [
    timed("implementation", "one", "2026-09-01T10:00:00Z", "2026-09-01T10:05:00Z"),
    timed("verification", "two", "2026-09-01T10:04:00Z", "2026-09-01T10:09:00Z")
  ];
  const collision = (events) => pricedOracle({ requirements, capabilities: twoKnown(), declared_schedule: schedule, actual_route_events: events })
    .observables.find((entry) => entry.observable_id === "collision-safe-parallelism");

  assert.equal(collision(apart).pass, true);
  assert.equal(collision(together).pass, false, "the declared order excused an overlap the ledger recorded");
});

test("a schedule that orders nothing and a ledger that timed nothing leaves the collision unobserved", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const oracle = pricedOracle({ requirements, capabilities: twoKnown(), declared_schedule: [], actual_route_events: [] });
  const collision = oracle.observables.find((entry) => entry.observable_id === "collision-safe-parallelism");
  assert.equal(collision.pass, null);
  assert.match(collision.reason, /not observed/u);
});

test("a schedule edge naming a task the requirement does not hold orders nothing", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const smuggled = [{ task_id: "verification", after: ["a-task-nobody-asked-for"] }];
  const oracle = pricedOracle({ requirements, capabilities: twoKnown(), declared_schedule: smuggled, actual_route_events: [] });
  assert.equal(oracle.observables.find((entry) => entry.observable_id === "collision-safe-parallelism").pass, null);
});

// --- what AOS knows about its own runtimes -----------------------------------------------------------

test("the routing evidence id is one a published result carries unchanged", () => {
  // `lib/result-schema.mjs` digests any run of thirty-two or more alphanumerics on the way out,
  // because that is what a leaked credential looks like. A bare `sha256:` digest is that shape, so
  // an evidence id written that way is rewritten in the stored result and `verify --run` -- which
  // recomputes from the stored observations -- then disagrees with the record it is checking.
  const observations = observeRun({ artifacts: {}, params: {} });
  const contract = shippedEcdContract();
  const digest = `sha256:${"a".repeat(64)}`;
  const facets = { language: "en", interface: "cli", harness: "aos@test", runtime: null, model: null, operator: null, occasion: null };
  const evaluation = evaluate(observations, { facets, profile_digest: digest, forms_completed: [] }, contract);
  const built = buildResult({
    evaluation,
    contract,
    observations,
    run: {
      run_id: "run-1", mode: "ASSESS", suite: "verified-core-v0", suite_digest: digest, seed: "0",
      seeded_families: [], forms_completed: [], profile_digest: digest, isolation_level: "BEST_EFFORT_CLI",
      scoring_permitted: true, evidence_status: "COMPLETE", safety_state: "S0", agents_used: [],
      invocation_count: 0, fixture_backed_agents: [], unrecognised_runtime_agents: [],
      operator_plan_digest: digest, operator_plan_authored: false
    }
  });
  const raw = observations.find((entry) => entry.metric_id === "M09").evidence_ids;
  const stored = built.observations.find((entry) => entry.metric_id === "M09").evidence_ids;
  assert.deepEqual([...stored], [...raw], "the published result rewrote the routing evidence id");
  const id = raw.find((entry) => entry.startsWith("route-oracle:"));
  assert.equal(typeof id, "string");
  assert.match(parseRouteOracleEvidenceId(id), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(routeOracleEvidenceId(parseRouteOracleEvidenceId(id)), id, "the reference does not round trip");
  assert.equal(parseRouteOracleEvidenceId("route-oracle:not-a-digest"), null);
  assert.equal(parseRouteOracleEvidenceId(`route-oracle:${"a".repeat(64)}`), null);
});

test("a route label that is not an identifier assigns nobody", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const declared = [
    { task_id: "contract", owner_id: "one" },
    { task_id: "implementation", owner_id: "one" },
    { task_id: "docs", owner_id: "one" },
    // Untrusted text out of an artifact. None of these names an owner, and none of them reaches the
    // record as though it did.
    { task_id: "verification", owner_id: "two\nrm -rf /" },
    { task_id: "release", owner_id: "/Users/alice/private/notes.txt" }
  ];
  const oracle = pricedOracle({ requirements, capabilities: twoKnown(), declared_assignment: declared });
  const proposed = new Map(oracle.assignment.map((entry) => [entry.task_id, entry.proposed_owner_id]));
  assert.equal(proposed.get("verification"), null, "the artifact's text was recorded as a proposed owner");
  assert.equal(proposed.get("release"), null);
  assert.deepEqual(oracle.refused_owner_labels, ["release", "verification"]);
  assert.equal(JSON.stringify(oracle).includes("rm -rf"), false, "the artifact's text reached the oracle record");
  assert.equal(JSON.stringify(oracle).includes("/Users/alice"), false);
  // A proposal is not an assignment either way: nothing here has an owner, because no event ran.
  for (const entry of oracle.assignment) assert.equal(entry.owner_id, null);
  assert.equal(oracle.observables.find((entry) => entry.observable_id === "capability-matches-task").pass, null);
  // An owner label that is an identifier is kept as the proposal it is.
  const good = pricedOracle({ requirements, capabilities: twoKnown(), declared_assignment: declared.slice(0, 3) });
  assert.equal(new Map(good.assignment.map((entry) => [entry.task_id, entry.proposed_owner_id])).get("contract"), "one");
  assert.deepEqual(good.refused_owner_labels, []);
});

test("a declared schedule cannot certify that shared-resource work was kept apart", () => {
  // It could, and that was the defect: a pair the plan said was ordered passed with
  // `basis: ["declared-schedule"]` and no timing at all -- the agent's own artifact certifying the
  // safety fact the artifact is the subject of. Labelling the basis did not stop the verdict being
  // issued; only the ledger issues one now.
  const requirements = requirementsFromWork(WORK).requirements;
  const schedule = WORK.tasks.map((task) => ({ task_id: task.id, after: task.depends_on }));
  const collision = (events, declaredSchedule) => pricedOracle({
    requirements, capabilities: twoKnown(), declared_schedule: declaredSchedule, actual_route_events: events
  }).observables.find((entry) => entry.observable_id === "collision-safe-parallelism");

  // The artifact's own order, complete and correct, and nothing timed. It answers nothing.
  const declaredOnly = collision([], schedule);
  assert.equal(declaredOnly.pass, null, "a declaration certified that two tasks did not collide");
  assert.deepEqual(declaredOnly.basis, []);
  assert.match(declaredOnly.reason, /not evidence that it happened/u);

  const timed = (taskId, agentId, from, to) => event({
    task_id: taskId, agent_id: agentId, invocation_id: `invocation-${taskId}`, purpose_id: taskId,
    started_at: from, completed_at: to, artifact_ids: [`artifact-${taskId}`]
  });
  const apart = [
    timed("implementation", "one", "2026-09-01T10:00:00Z", "2026-09-01T10:05:00Z"),
    timed("verification", "two", "2026-09-01T10:06:00Z", "2026-09-01T10:09:00Z")
  ];
  // Only the ledger passes it, and it says so.
  assert.equal(collision(apart, []).pass, true);
  assert.deepEqual(collision(apart, []).basis, ["invocation-ledger"]);
  assert.deepEqual(collision(apart, schedule).basis, ["invocation-ledger"]);

  // The declaration is still on the record, so a reader can compare what was planned with what ran.
  const oracle = pricedOracle({ requirements, capabilities: twoKnown(), declared_schedule: schedule, actual_route_events: [] });
  assert.equal(oracle.declared_schedule.length > 0, true, "the plan's schedule was dropped rather than kept as context");
});

test("the scored row and the oracle record describe the same oracle", () => {
  // `assess` builds both from one frozen input object, so the digest the M09 row carries as evidence
  // has to be the digest of the record written beside the run. If the two could differ, the number
  // and the working it rests on would be two different oracles with one name.
  const capabilities = twoKnown();
  const plan = { tasks: WORK.tasks.map((task) => ({ id: task.id, route: "one", depends_on: task.depends_on })) };
  const input = { work: WORK, plan, capabilities, actual_route_events: [event({ agent_id: "one" })] };

  const observation = observeRun({ artifacts: { plan }, params: { "FAM-3": {} }, routing: input })
    .find((entry) => entry.metric_id === "M09");
  const record = routingObservables(input).oracle;

  assert.equal(observation.verifier_id, record.verifier_id);
  assert.equal(
    observation.evidence_ids.includes(routeOracleEvidenceId(record.route_oracle_digest)),
    true,
    "the scored row names a different oracle record from the one written beside the run"
  );
  // And the digest is the record's own, recomputed rather than read off it.
  assert.equal(routeOracleDigest(record), record.route_oracle_digest);
});

test("a ledger that speaks about some tasks does not make the route cheaper than the cheapest one", () => {
  // Counting a partly attributed ledger gives the unattributed tasks nought invocations each, and
  // the route then costs less than the minimum -- a route nobody finished observing, reported as
  // one that beat the oracle.
  const requirements = requirementsFromWork(WORK).requirements;
  const capabilities = twoKnown();
  const owners = { contract: "one", implementation: "one", docs: "one", verification: "two", release: "one" };
  const declared = Object.keys(owners).map((task_id) => ({ task_id, owner_id: owners[task_id] }));
  const partial = ["contract", "docs"].map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId, artifact_ids: [`artifact-${index + 1}`]
  }));

  const oracle = pricedOracle({ requirements, capabilities, declared_assignment: declared, actual_route_events: partial });
  assert.equal(oracle.cost_basis, null, "a partly attributed ledger produced a cost");
  assert.equal(oracle.actual_cost, null);
  // And nothing is scored off the proposal that filled the gap in the first version.
  assert.equal(oracle.observables.find((entry) => entry.observable_id === "simplest-adequate-route").pass, null);
  assert.equal(oracle.observables.find((entry) => entry.observable_id === "capability-matches-task").pass, null);

  // Every task attributed, and the ledger is the basis.
  const whole = Object.keys(owners).sort().map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId, artifact_ids: [`artifact-${index + 1}`]
  }));
  const full = pricedOracle({ requirements, capabilities, declared_assignment: declared, actual_route_events: whole });
  assert.equal(full.cost_basis, "actual-route-events");
  assert.equal(full.actual_cost, full.minimum.minimum_cost);
});

test("a task two different agents invoked has no owner rather than the first of them", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const capabilities = twoKnown();
  const owners = { contract: "one", implementation: "one", docs: "one", verification: "two", release: "one" };
  const ledger = Object.keys(owners).sort().map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId, artifact_ids: [`artifact-${index + 1}`]
  }));
  const contested = [...ledger, event({ task_id: "verification", agent_id: "one", invocation_id: "invocation-contested", purpose_id: "verification", artifact_ids: ["artifact-contested"] })];

  const oracle = pricedOracle({ requirements, capabilities, actual_route_events: contested });
  const verification = oracle.assignment.find((entry) => entry.task_id === "verification");
  assert.equal(verification.owner_id, null, "the first invocation was taken as the owner");
  assert.equal(verification.provenance, "ambiguous");
  // And the questions that need an owner withhold rather than answering about one of the two.
  assert.equal(oracle.observables.find((entry) => entry.observable_id === "capability-matches-task").pass, null);
  assert.equal(oracle.observables.find((entry) => entry.observable_id === "verification-independence").pass, null);

  // A task invoked twice by the same agent is not ambiguous.
  const retried = [...ledger, event({ task_id: "verification", agent_id: "two", invocation_id: "invocation-retry", purpose_id: "verification", artifact_ids: ["artifact-retry"] })];
  const plain = pricedOracle({ requirements, capabilities, actual_route_events: retried });
  assert.equal(plain.assignment.find((entry) => entry.task_id === "verification").owner_id, "two");
});

test("an opportunity id cannot pass for the operator event id that recorded the decision", () => {
  // Two references that answer different questions: which chance to decide this invocation
  // followed, and which decision was recorded. `lib/cli.mjs` holds the first -- a checkpoint hands
  // back `opp-FAM-3-stage-1-1` -- and #560 mints the second as `operator-<uuid>`. A field named for
  // one holding the other is an identifier's shape standing in for its provenance, so the shapes
  // are what keep them apart.
  const opportunity = "opp-FAM-3-stage-1-1";
  const operatorEvent = "operator-2f1c4d0e-9b7a-4c31-8f52-0a6d3b8e1c47";

  assert.deepEqual(validateActualRouteEvent(event({ operator_opportunity_id: opportunity })), []);
  assert.deepEqual(validateActualRouteEvent(event({ operator_decision_event_id: operatorEvent })), []);

  // The swap, in both directions.
  assert.equal(validateActualRouteEvent(event({ operator_decision_event_id: opportunity })).length, 1);
  assert.equal(validateActualRouteEvent(event({ operator_opportunity_id: operatorEvent })).length, 1);
  // And neither accepts an arbitrary string that is neither.
  for (const value of ["", "1", "opportunity", "operator-", `operator-${"x".repeat(36)}`]) {
    assert.equal(validateActualRouteEvent(event({ operator_decision_event_id: value })).length, 1, `${value} passed as an operator event id`);
  }

  // Both survive admission with their own field.
  const admitted = pricedOracle({
    requirements: requirementsFromWork(WORK).requirements,
    capabilities: twoKnown(),
    actual_route_events: [event({ operator_opportunity_id: opportunity, operator_decision_event_id: operatorEvent })]
  }).actual_route_events;
  assert.equal(admitted[0].operator_opportunity_id, opportunity);
  assert.equal(admitted[0].operator_decision_event_id, operatorEvent);
});
