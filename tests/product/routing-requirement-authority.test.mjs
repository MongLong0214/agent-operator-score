// #558 / directive §5.1. The requirement, the budget and the capability record are the operator's
// and AOS's. This file is the adversary: for each of the seven ways an agent could reach into them,
// it writes the artifact an agent would write and asserts nothing moved.
//
// These are negative tests in the strict sense -- every one of them passes by *not* changing an
// answer -- so each also asserts the positive it is paired with, or it would pass just as well
// against a module that answered nothing at all.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTUAL_ROUTE_EVENT_SCHEMA,
  CAPABILITY_VOCABULARY,
  capabilityRecord,
  capabilityRecordsFor,
  capabilityDigestOf,
  operatorAssignment,
  taskOfOpportunity,
  requirementsFromRoute,
  routeOracle,
  routingObservables,
  workRequirementAtPlanApproval,
  validateActualRouteEvent
} from "../../lib/routing-oracle.mjs";

// The floor here is the production one, and this file is the only one of the five that is not a
// work-graph fixture.
//
// Its requirement comes from `requirementsFromRoute` over a two-stage route, because its subject is
// what an agent's artifact can and cannot move -- proposal authority, not minimality. It would
// therefore have been the one file where "price the fixture against its own requirement" meant
// pricing a route against itself, which is the tautology #558's second half removes. So it takes
// the same floor an ordinary run takes: AOS's statement of FAM-3's work, through
// `workRequirementAtPlanApproval`. The consequence is stated rather than worked around -- the
// baseline route below is two stages against a floor of one, so production reports it as costing
// more than the work asked for, and `HONEST()` is the run this file measures *deviation* from
// rather than a run that is minimal.
const productionFloor = () => workRequirementAtPlanApproval({ form_id: "FAM-3" });
const pricedObservables = (input) => routingObservables({ ...input, work_requirement: productionFloor() });

const OPERATOR_ROUTE = "alpha>beta";
const REQUIREMENT = () => requirementsFromRoute({
  form_id: "FAM-3",
  route: OPERATOR_ROUTE,
  required_artifacts: ["artifact:plan.json"]
});

const CAPABILITIES = () => new Map(["alpha", "beta"].map((agent_id) => [agent_id, capabilityRecord({
  agent_id,
  capabilities: [...CAPABILITY_VOCABULARY],
  source: "detected",
  evidence_ids: ["verifier:aos-capability-probe.v1"]
})]));

const event = (taskId, agentId, overrides = {}) => ({
  schema_id: ACTUAL_ROUTE_EVENT_SCHEMA,
  task_id: taskId,
  agent_id: agentId,
  route_id: OPERATOR_ROUTE,
  invocation_id: `invocation-${taskId}`,
  purpose_id: taskId,
  started_at: null,
  completed_at: null,
  artifact_ids: [],
  handoff_ids: [],
  capability_digest: null,
  operator_decision_event_id: null,
  operator_opportunity_id: null,
  ...overrides
});

const LEDGER = () => [
  event("FAM-3/stage-1", "alpha", { artifact_ids: ["artifact-1"], started_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T10:01:00Z" }),
  event("FAM-3/stage-2", "beta", { artifact_ids: ["artifact:plan.json"], handoff_ids: ["FAM-3/stage-1->FAM-3/stage-2"], started_at: "2026-09-01T10:02:00Z", completed_at: "2026-09-01T10:03:00Z" })
];

const oracleFor = (plan, ledger = LEDGER()) => pricedObservables({
  requirements: REQUIREMENT().requirements,
  requirement_problems: REQUIREMENT().problems,
  plan,
  capabilities: CAPABILITIES(),
  actual_route_events: ledger
}).oracle;

const verdicts = (oracle) => Object.fromEntries(oracle.observables.map((entry) => [entry.observable_id, entry.pass]));

// The run this file measures deviation from. If this stops passing, every assertion below is
// comparing two identical failures.
const HONEST = () => oracleFor({ tasks: [{ id: "contract", route: "alpha", depends_on: [] }] });

test("the reference run this file measures against is answered, not withheld", () => {
  const baseline = verdicts(HONEST());
  // Answered is the property this file needs: a withheld baseline would make every comparison below
  // two silences held against each other.
  for (const id of ["capability-matches-task", "simplest-adequate-route", "no-redundant-invocation", "invocation-budget-respected", "verification-independence"]) {
    assert.equal(baseline[id] === null, false, `${id} is withheld in the run this file measures deviation from`);
  }
  assert.equal(baseline["capability-matches-task"], true);
  assert.equal(baseline["no-redundant-invocation"], true);
  assert.equal(baseline["invocation-budget-respected"], true);
  assert.equal(baseline["verification-independence"], true);
  // And false, not true, because the route is two stages against a floor of one. That is what
  // production says about `alpha>beta` since the floor stopped being derived from the route; a
  // baseline asserting `true` here would be asserting the tautology this file's own subject is
  // about, in the one file whose requirement is route-derived.
  assert.equal(baseline["simplest-adequate-route"], false);
  assert.equal(HONEST().minimum.minimum_cost, 1, "the floor moved with the route this file declares");
});

test("an agent that writes a different route label changes no requirement and no owner", () => {
  // The plan is the agent's. It can name whatever route it likes; the requirement is the route the
  // operator declared, and the owner is the agent AOS invoked.
  const hostile = oracleFor({
    tasks: [{ id: "contract", route: "an-agent-i-invented", depends_on: [] }],
    route: "an-agent-i-invented>and-another"
  });
  assert.deepEqual(verdicts(hostile), verdicts(HONEST()));
  assert.deepEqual(hostile.requirements.map((entry) => entry.task_id), ["FAM-3/stage-1", "FAM-3/stage-2"]);
  for (const row of hostile.assignment) assert.equal(["alpha", "beta"].includes(row.owner_id), true, `${row.task_id} went to ${row.owner_id}`);
  assert.equal(hostile.route_oracle_digest, HONEST().route_oracle_digest, "the artifact moved the record it is the subject of");
});

test("an agent that invents a task id adds no task and, as an event, is refused", () => {
  const hostile = oracleFor({ tasks: [{ id: "a-task-nobody-asked-for", route: "alpha", depends_on: [] }] });
  assert.deepEqual(hostile.requirements.map((entry) => entry.task_id), ["FAM-3/stage-1", "FAM-3/stage-2"]);
  assert.deepEqual(verdicts(hostile), verdicts(HONEST()));

  // And the same id arriving as a ledger event is refused rather than dropped.
  const forged = oracleFor(null, [...LEDGER(), event("a-task-nobody-asked-for", "alpha", { invocation_id: "invocation-forged" })]);
  assert.equal(forged.rejected_route_events.length, 1);
  assert.match(forged.rejected_route_events[0].reason, /is not a task in this run's routing requirement/u);
});

test("an agent cannot raise the invocation or cost budget it is measured against", () => {
  const budgets = (oracle) => oracle.requirements.map((entry) => [entry.task_id, entry.max_invocations, entry.route_cost_budget]);
  const hostile = oracleFor({
    tasks: [{ id: "contract", route: "alpha", depends_on: [], max_invocations: 99, route_cost_budget: 99 }],
    max_invocations: 99,
    budget: { max_total_invocations: 99 }
  });
  assert.deepEqual(budgets(hostile), budgets(HONEST()));
  assert.deepEqual(budgets(hostile), [["FAM-3/stage-1", 1, 1], ["FAM-3/stage-2", 1, 2]]);

  // The budget still bites: a second invocation of one stage fails it whatever the plan asked for.
  const twice = oracleFor({ tasks: [] }, [...LEDGER(), event("FAM-3/stage-1", "alpha", { invocation_id: "invocation-again", artifact_ids: ["artifact-again"] })]);
  assert.equal(verdicts(twice)["invocation-budget-respected"], false);
});

test("an agent cannot remove a required artifact from the requirement", () => {
  const artifacts = (oracle) => oracle.requirements.flatMap((entry) => entry.required_artifacts);
  const hostile = oracleFor({ tasks: [{ id: "contract", route: "alpha", depends_on: [] }], required_artifacts: [] });
  assert.deepEqual(artifacts(hostile), ["artifact:plan.json"]);
  assert.deepEqual(verdicts(hostile), verdicts(HONEST()));

  // And the obligation still bites when the ledger does not show the artifact. The verdict is
  // already false on this route for cost, so the constraint failure is what isolates the artifact:
  // the baseline carries no `artifact` failure and this one does.
  const without = oracleFor(null, [LEDGER()[0], { ...LEDGER()[1], artifact_ids: [] }]);
  assert.equal(verdicts(without)["simplest-adequate-route"], false);
  assert.equal(HONEST().constraint_failures.some((entry) => entry.constraint === "artifact"), false);
  assert.equal(without.constraint_failures.some((entry) => entry.constraint === "artifact"), true);
});

test("an agent cannot declare itself a runtime AOS holds a capability record for", () => {
  // The capability record is built from the operator's registration and AOS's adapter table. An
  // artifact claiming an adapter is text in a file the oracle never reads for this.
  const claimed = capabilityRecordsFor({ ghost: { id: "ghost", adapter: "codex-cli.v1", declared_by: "the agent" } });
  const honestly = capabilityRecordsFor({ ghost: { id: "ghost" } });
  assert.equal(claimed.get("ghost").source, "aos-known", "an operator registration is the operator's");
  assert.equal(honestly.get("ghost").source, "unknown");

  // What an agent can reach -- the plan -- moves nothing.
  const hostile = oracleFor({
    tasks: [{ id: "contract", route: "alpha", depends_on: [] }],
    agent_capabilities: { alpha: [...CAPABILITY_VOCABULARY] },
    adapter: "codex-cli.v1"
  });
  assert.deepEqual(
    hostile.capabilities.map((entry) => [entry.agent_id, entry.source]),
    HONEST().capabilities.map((entry) => [entry.agent_id, entry.source])
  );

  // And a capability digest submitted on an event is recomputed, never believed.
  const forged = oracleFor(null, [
    { ...LEDGER()[0], capability_digest: `sha256:${"0".repeat(64)}` },
    LEDGER()[1]
  ]);
  assert.equal(forged.rejected_route_events.length, 1);
  assert.match(forged.rejected_route_events[0].reason, /not the digest of the record AOS holds/u);
  assert.equal(capabilityDigestOf(CAPABILITIES().get("alpha")), CAPABILITIES().get("alpha").capability_digest);
});

test("an opportunity id offered as the operator event id is refused in both directions", () => {
  const opportunity = "opp-FAM-3-stage-1-1";
  const operatorEvent = "operator-2f1c4d0e-9b7a-4c31-8f52-0a6d3b8e1c47";
  assert.deepEqual(validateActualRouteEvent(event("FAM-3/stage-1", "alpha", { operator_opportunity_id: opportunity })), []);
  assert.equal(validateActualRouteEvent(event("FAM-3/stage-1", "alpha", { operator_decision_event_id: opportunity })).length, 1);
  assert.equal(validateActualRouteEvent(event("FAM-3/stage-1", "alpha", { operator_opportunity_id: operatorEvent })).length, 1);
});

test("the requirement is a function of the operator's route alone, so a record edited later re-derives", () => {
  // There is no path from a run's artifacts back into the requirement: it is built by
  // `requirementsFromRoute` from the route string and the artifact list AOS states, and
  // `routingObservables` reads no plan at all -- it takes a requirement its caller already built.
  // The "diagnostic proposal and schedule" this comment used to name were the agent's artifact
  // supplying a proposed owner and a declared schedule; both were removed when the requirement's
  // tasks became the stages AOS runs, and the proposal that remains is the operator's own attested
  // `route.assign`, which is not an artifact. So the same route always produces the same
  // requirement, and an edited plan cannot change it.
  const first = requirementsFromRoute({ form_id: "FAM-3", route: OPERATOR_ROUTE, required_artifacts: ["artifact:plan.json"] });
  const again = requirementsFromRoute({ form_id: "FAM-3", route: OPERATOR_ROUTE, required_artifacts: ["artifact:plan.json"] });
  assert.deepEqual(first, again);

  // A different route is a different requirement, which is what makes the sameness above a fact
  // about the input rather than about the function ignoring it.
  const other = requirementsFromRoute({ form_id: "FAM-3", route: "alpha", required_artifacts: ["artifact:plan.json"] });
  assert.notDeepEqual(other.requirements.map((entry) => entry.task_id), first.requirements.map((entry) => entry.task_id));

  // And the plan reaches nothing at all. Since the requirement's tasks became the stages AOS runs,
  // the plan's own task ids cannot line up with them, so the proposal and the declared schedule are
  // both empty however hostile the artifact is. That is stronger than the diagnostic-only rule it
  // replaced -- there is no path from the artifact into the record to argue about -- and it is
  // recorded here rather than left as two fields a reader would assume were populated.
  const oracle = oracleFor({
    tasks: [{ id: "contract", route: "someone-else", depends_on: [] }, { id: "FAM-3/stage-1", route: "someone-else", depends_on: [] }]
  });
  assert.equal(JSON.stringify(oracle.requirements).includes("someone-else"), false, "the artifact reached the requirement");
  assert.equal(JSON.stringify(oracle.observables).includes("someone-else"), false, "the artifact reached a verdict");
  // Even a plan that guesses the stage id: the ledger already assigned that task, and the ledger wins.
  assert.equal(oracle.assignment.find((entry) => entry.task_id === "FAM-3/stage-1").owner_id, "alpha");
  assert.equal(oracle.assignment.find((entry) => entry.task_id === "FAM-3/stage-1").provenance, "actual-route-event");
  assert.deepEqual(verdicts(oracle), verdicts(HONEST()));
});

test("the proposal the oracle reads is the operator's attested decision, not the agent's plan", () => {
  // #560 mints `route.assign` at a checkpoint, through the store's authority gate, session-bound.
  // That is the one statement about who should own a stage that is neither the artifact under
  // measurement nor the ledger, so it is what supplies the proposal. The plan is not an input at
  // all any more: `routingObservables` has no `plan` parameter to pass one to.
  const rows = [
    { decision_type: "route.assign", opportunity_id: "opp-FAM-3-stage-2-1", declared_route: ["beta"], state_revision: 3, operator_event_id: "operator-2f1c4d0e-9b7a-4c31-8f52-0a6d3b8e1c47" },
    { decision_type: "route.assign", opportunity_id: "opp-FAM-3-stage-2-2", declared_route: ["gamma"], state_revision: 7, operator_event_id: "operator-3a2b5c6d-1e0f-4a9b-8c7d-6e5f4a3b2c1d" }
  ];
  const assignment = operatorAssignment(rows);
  assert.deepEqual(assignment.map((entry) => [entry.task_id, entry.owner_id]), [["FAM-3/stage-2", "gamma"]],
    "the later revision of the same stage is the operator's current decision");

  const oracle = pricedObservables({
    requirements: REQUIREMENT().requirements,
    declared_assignment: assignment,
    capabilities: CAPABILITIES(),
    actual_route_events: LEDGER()
  }).oracle;
  // The ledger still assigns; the operator's decision is the proposal beside it, and it is on the
  // record so a reader can see the run went somewhere the operator did not last ask for.
  const stage2 = oracle.assignment.find((entry) => entry.task_id === "FAM-3/stage-2");
  assert.equal(stage2.owner_id, "beta", "the ledger stopped assigning");
  assert.equal(stage2.provenance, "actual-route-event");
  assert.equal(stage2.proposed_owner_id, "gamma", "the operator's decision is not on the record");

  // A decision of another kind, an unparsable opportunity, or a route that is not one owner
  // contributes nothing rather than a guess.
  assert.deepEqual(operatorAssignment([{ decision_type: "intervention.decide", opportunity_id: "opp-FAM-3-stage-1-1", declared_route: ["beta"], state_revision: 1 }]), []);
  assert.deepEqual(operatorAssignment([{ decision_type: "route.assign", opportunity_id: "not-an-opportunity", declared_route: ["beta"], state_revision: 1 }]), []);
  assert.deepEqual(operatorAssignment([{ decision_type: "route.assign", opportunity_id: "opp-FAM-3-stage-1-1", declared_route: ["beta", "gamma"], state_revision: 1 }]), []);
  assert.equal(taskOfOpportunity("opp-FAM-3-stage-1-1"), "FAM-3/stage-1");
  assert.equal(taskOfOpportunity("opp-FAM-3-stage-1"), null);

  // An unattended run mints no such event, so the proposal is empty and nothing is said about it.
  const unattended = pricedObservables({
    requirements: REQUIREMENT().requirements, declared_assignment: [], capabilities: CAPABILITIES(), actual_route_events: LEDGER()
  }).oracle;
  for (const row of unattended.assignment) assert.equal(row.proposed_owner_id, null);
  assert.deepEqual(verdicts(unattended), verdicts(HONEST()), "an absent operator decision changed a verdict");
});
