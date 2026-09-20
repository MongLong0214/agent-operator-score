// #558, the solver. The cheapest route that satisfies every constraint the requirement states, the
// same answer every time it is asked, and a stated refusal rather than a guess when the search is
// larger than this oracle will answer for.
//
// The six observables that follow from it are here too, including the one that is a shortfall and
// the one that is a silence -- an owner AOS cannot judge and an owner AOS judged and found wanting
// are different answers.

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

const known = (id) => capabilityRecord({ agent_id: id, capabilities: [...CAPABILITY_VOCABULARY], source: "detected", evidence_ids: ["verifier:aos-capability-probe.v1"] });
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

test("the minimum route is the same route every time it is asked", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const forward = minimumRoute(requirements, twoKnown());
  const backward = minimumRoute([...requirements].reverse(), new Map([...twoKnown()].reverse()));
  assert.equal(forward.status, "SOLVED");
  assert.deepEqual(forward.assignment, backward.assignment, "the answer moved when only the input order did");
  assert.equal(forward.minimum_cost, backward.minimum_cost);
});

test("the minimum route honours the independence the requirement declares", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const solved = minimumRoute(requirements, twoKnown());
  const owner = new Map(solved.assignment.map((entry) => [entry.task_id, entry.owner_id]));
  assert.notEqual(owner.get("verification"), owner.get("implementation"));
  // One owner cannot satisfy it, so there is no route at all.
  const alone = minimumRoute(requirements, new Map([["one", known("one")]]));
  assert.equal(alone.status, "INFEASIBLE");
  assert.equal(alone.minimum_cost, null);
});

test("a route the requirement cannot afford is not an adequate route", () => {
  const requirements = requirementsFromWork(WORK).requirements
    .map((entry) => (entry.task_id === "verification" ? { ...entry, route_cost_budget: 1 } : entry));
  // verification must go to a different owner than implementation, which costs it a handoff, and a
  // budget of one leaves no room for it.
  assert.equal(minimumRoute(requirements, twoKnown()).status, "INFEASIBLE");
  assert.equal(minimumRoute(requirementsFromWork(WORK).requirements, twoKnown()).status, "SOLVED");
});

test("an owner AOS knows nothing about is not a candidate for the minimum route", () => {
  const capabilities = new Map([["one", known("one")], ["mystery", capabilityRecord({ agent_id: "mystery", source: "unknown" })]]);
  const solved = minimumRoute(requirementsFromWork(WORK).requirements, capabilities);
  assert.equal(solved.status, "INFEASIBLE", "an unknown owner was used to satisfy independence");
});

test("a declared capability is provenance and never a candidate the oracle may route to", () => {
  const declared = capabilityRecord({ agent_id: "self-described", capabilities: [...CAPABILITY_VOCABULARY], source: "declared" });
  assert.deepEqual(declared.capabilities, [...CAPABILITY_VOCABULARY], "the claim is kept on the record");
  const capabilities = new Map([["one", known("one")], ["self-described", declared]]);
  assert.equal(minimumRoute(requirementsFromWork(WORK).requirements, capabilities).status, "INFEASIBLE");
});

test("a search space past the declared bound is refused rather than approximated", () => {
  const tasks = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, resource: `r${index}`, depends_on: [] }));
  const requirements = requirementsFromWork({ tasks }).requirements;
  const capabilities = new Map(Array.from({ length: 3 }, (_, index) => [`a${index}`, known(`a${index}`)]));
  const solved = minimumRoute(requirements, capabilities);
  assert.equal(solved.status, "SEARCH_SPACE_EXCEEDED");
  assert.equal(solved.minimum_cost, null);
  assert.equal(solved.states_explored, 0, "the bound was checked after the enumeration it was there to prevent");
  assert.equal(3 ** 20 > MAX_SEARCH_STATES, true);
});

// --- what the metric layer and #583 read ---------------------------------------------------------------

test("the four subchecks the oracle answers for M09 are the four the metric contract declares", () => {
  assert.deepEqual([...M09_OBSERVABLE_IDS], [...METRICS.M09.subchecks]);
  for (const id of M09_OBSERVABLE_IDS) assert.equal(ROUTING_OBSERVABLE_IDS.includes(id), true, `${id} is not one of the oracle's observables`);
  assert.equal(ROUTING_OBSERVABLE_IDS.length, 6);
});

test("every observable the oracle publishes carries a verdict and a reason", () => {
  const oracle = pricedOracle({ requirements: requirementsFromWork(WORK).requirements, capabilities: twoKnown() });
  assert.deepEqual(oracle.observables.map((entry) => entry.observable_id), [...ROUTING_OBSERVABLE_IDS]);
  for (const entry of oracle.observables) {
    assert.equal([true, false, null].includes(entry.pass), true, `${entry.observable_id} answered with something that is not a verdict`);
    assert.equal(typeof entry.reason === "string" && entry.reason.length > 0, true, `${entry.observable_id} answered without a reason`);
  }
  assert.equal(oracle.schema_id, ROUTE_ORACLE_SCHEMA);
});

test("an invalid requirement withholds all six observables rather than answering the ones it can", () => {
  const requirements = requirementsFromWork(WORK).requirements.map((entry) => ({ ...entry, max_invocations: 0 }));
  const oracle = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event()] });
  for (const entry of oracle.observables) assert.equal(entry.pass, null, `${entry.observable_id} was answered against an invalid contract`);
  assert.equal(oracle.contract_problems.length > 0, true);
  assert.equal(oracle.minimum.status, "CONTRACT_INVALID");
});

test("a requirement asking for a capability the owner does not hold fails rather than withholding", () => {
  const partial = capabilityRecord({ agent_id: "narrow", capabilities: ["code-read", "artifact-write"], source: "detected" });
  const capabilities = new Map([["one", known("one")], ["narrow", partial]]);
  const requirements = requirementsFromWork(WORK).requirements;
  const owners = { contract: "one", implementation: "one", docs: "one", verification: "narrow", release: "one" };
  const events = Object.keys(owners).sort().map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId, artifact_ids: [`artifact-${index + 1}`]
  }));
  const oracle = pricedOracle({ requirements, capabilities, actual_route_events: events });
  const capability = oracle.observables.find((entry) => entry.observable_id === "capability-matches-task");
  assert.equal(capability.pass, false, "a known shortfall was withheld instead of failed");
  assert.match(capability.reason, /lacks/u);
  assert.equal(oracle.constraint_failures.some((entry) => entry.basis === "missing-capability"), true);
});

test("the delegation reference tells over-delegation from inadequacy and owns no reliance episode", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const capabilities = twoKnown();
  const handoffsInto = (taskId) => requirements.find((entry) => entry.task_id === taskId).required_handoffs;
  const assign = (owners) => Object.keys(owners).sort().map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId,
    artifact_ids: [`artifact-${index + 1}`], handoff_ids: [...handoffsInto(taskId)],
    started_at: `2026-09-01T10:${String(index * 2).padStart(2, "0")}:00Z`,
    completed_at: `2026-09-01T10:${String(index * 2 + 1).padStart(2, "0")}:00Z`
  }));
  const minimal = { contract: "one", implementation: "one", docs: "one", verification: "two", release: "one" };
  const split = { contract: "one", implementation: "one", docs: "two", verification: "two", release: "one" };
  const sameOwner = { contract: "one", implementation: "one", docs: "one", verification: "one", release: "one" };

  const best = delegationOracle(pricedOracle({ requirements, capabilities, actual_route_events: assign(minimal) }));
  assert.equal(best.expected_value_class, "MINIMAL");
  assert.equal(best.over_delegation_reference, 0);
  assert.deepEqual(best.under_delegation_reference, []);

  const over = delegationOracle(pricedOracle({ requirements, capabilities, actual_route_events: assign(split) }));
  assert.equal(over.expected_value_class, "OVER_DELEGATED");
  assert.equal(over.over_delegation_reference > 0, true);

  const under = delegationOracle(pricedOracle({ requirements, capabilities, actual_route_events: assign(sameOwner) }));
  assert.equal(under.expected_value_class, "UNDER_DELEGATED");
  assert.equal(under.under_delegation_reference.some((entry) => entry.constraint === "independence"), true);

  for (const reference of [best, over, under]) {
    assert.equal(reference.reliance_episodes, null, "the delegation reference produced a reliance episode of its own");
    assert.equal(reference.reliance_owner, "issue-583");
  }
  // Nothing to compare is not a class of delegation.
  assert.equal(delegationOracle(pricedOracle({ requirements, capabilities })).expected_value_class, "NOT_OBSERVED");
});

test("an owner AOS cannot judge is not delegation the operator got wrong", () => {
  // The distinction `simplest-adequate-route` makes, made on this side too. A route whose owners
  // AOS holds no record for is undecided, and classing it as under-delegation would hand #583 a
  // judgement about the operator built out of AOS not knowing what an agent can do.
  const requirements = requirementsFromWork(WORK).requirements;
  const capabilities = twoKnown();
  const handoffsInto = (taskId) => requirements.find((entry) => entry.task_id === taskId).required_handoffs;
  const assign = (owners) => Object.keys(owners).sort().map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId,
    artifact_ids: [`artifact-${index + 1}`], handoff_ids: [...handoffsInto(taskId)],
    started_at: `2026-09-01T10:${String(index * 2).padStart(2, "0")}:00Z`,
    completed_at: `2026-09-01T10:${String(index * 2 + 1).padStart(2, "0")}:00Z`
  }));
  const unknownOwners = { contract: "a1", implementation: "a1", docs: "a1", verification: "a2", release: "a1" };
  const undecided = delegationOracle(pricedOracle({ requirements, capabilities, actual_route_events: assign(unknownOwners) }));
  assert.equal(undecided.expected_value_class, "NOT_OBSERVED");
  assert.equal(undecided.over_delegation_reference, null);
  // The failures are still on the record, named as what they are.
  assert.equal(undecided.under_delegation_reference.every((entry) => entry.basis === "unknown-owner"), true);

  // A real shortfall is still under-delegation.
  const narrow = new Map([...capabilities, ["narrow", capabilityRecord({ agent_id: "narrow", capabilities: ["code-read", "artifact-write"], source: "detected" })]]);
  const shortfall = delegationOracle(pricedOracle({
    requirements, capabilities: narrow,
    actual_route_events: assign({ contract: "one", implementation: "one", docs: "one", verification: "narrow", release: "one" })
  }));
  assert.equal(shortfall.expected_value_class, "UNDER_DELEGATED");
});

test("a required artifact the ledger does not show is inadequate, and a silent handoff withholds", () => {
  // Both lists were validated at construction and read by nothing. A route whose every event
  // carried `artifact_ids: []` took full credit for work with nothing to show for it, and a handoff
  // that was named and never made cost the route a point of cost and proved nothing.
  const SOLO_WORK = { tasks: [{ id: "a", resource: "r", depends_on: [] }] };
  const [solo] = requirementsFromWork(SOLO_WORK).requirements;
  const withArtifact = { ...solo, required_artifacts: Object.freeze(["artifact:out.json"]) };
  const ran = (overrides) => event({ task_id: "a", agent_id: "one", purpose_id: "a", invocation_id: "invocation-1", started_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T10:01:00Z", ...overrides });
  const capabilities = twoKnown();
  // The floor is the graph these requirements were derived from, not the suite's five-task one.
  const observableOf = (requirements, events, id, workGraph = SOLO_WORK) =>
    pricedOracle({ requirements, capabilities, actual_route_events: events }, workGraph).observables.find((entry) => entry.observable_id === id);

  assert.equal(observableOf([withArtifact], [ran({ artifact_ids: ["artifact:out.json"] })], "simplest-adequate-route").pass, true);
  assert.equal(observableOf([withArtifact], [ran({ artifact_ids: [] })], "simplest-adequate-route").pass, false,
    "a task that produced none of the artifacts it owed was adequate");
  assert.match(observableOf([withArtifact], [ran({ artifact_ids: [] })], "simplest-adequate-route").reason, /requires artifact/u);

  // The same for a handoff, on the two-task graph where one is declared.
  const PAIR_WORK = { tasks: [{ id: "a", resource: "r1", depends_on: [] }, { id: "b", resource: "r2", depends_on: ["a"] }] };
  const pair = requirementsFromWork(PAIR_WORK).requirements;
  assert.deepEqual(pair.find((entry) => entry.task_id === "b").required_handoffs, ["a->b"]);
  const both = (handoffs) => [
    event({ task_id: "a", agent_id: "one", purpose_id: "a", invocation_id: "invocation-a", artifact_ids: ["artifact-a"], started_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T10:01:00Z" }),
    event({ task_id: "b", agent_id: "one", purpose_id: "b", invocation_id: "invocation-b", artifact_ids: ["artifact-b"], handoff_ids: handoffs, started_at: "2026-09-01T10:02:00Z", completed_at: "2026-09-01T10:03:00Z" })
  ];
  assert.equal(observableOf(pair, both(["a->b"]), "simplest-adequate-route", PAIR_WORK).pass, true);
  // Withheld, not failed. ISSUE.md's missing policy puts "handoff incomplete" with the states that
  // are NOT_OBSERVED: a ledger that is silent about an edge is missing evidence, and the artifact
  // above is different because AOS opened the workspace and looked.
  assert.equal(observableOf(pair, both([]), "simplest-adequate-route", PAIR_WORK).pass, null, "a silent ledger decided the route was inadequate");
  assert.equal(pricedOracle({ requirements: pair, capabilities, actual_route_events: both([]) }, PAIR_WORK)
    .constraint_failures.some((entry) => entry.constraint === "handoff" && entry.basis === "missing-evidence"), true,
    "the missing edge is still on the record, it just does not decide adequacy");
});

test("two tasks the requirement does not allow in parallel are not adequate when the ledger shows them together", () => {
  // `allowed_parallelism` was validated at construction and consumed nowhere, so a shared-resource
  // overlap made `collision-safe-parallelism` false while the route stayed minimal and adequate.
  const requirements = requirementsFromWork(WORK).requirements;
  const timed = (taskId, agentId, from, to) => event({
    task_id: taskId, agent_id: agentId, invocation_id: `invocation-${taskId}`, purpose_id: taskId,
    started_at: from, completed_at: to, artifact_ids: [`artifact-${taskId}`],
    handoff_ids: [...requirements.find((entry) => entry.task_id === taskId).required_handoffs]
  });
  const owners = { contract: "one", implementation: "one", docs: "one", verification: "two", release: "one" };
  const ledger = (implementationEnd, verificationStart) => Object.keys(owners).sort().map((taskId) =>
    taskId === "implementation" ? timed(taskId, owners[taskId], "2026-09-01T10:00:00Z", implementationEnd)
      : taskId === "verification" ? timed(taskId, owners[taskId], verificationStart, "2026-09-01T10:20:00Z")
        : timed(taskId, owners[taskId], "2026-09-01T09:00:00Z", "2026-09-01T09:01:00Z"));

  const apart = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: ledger("2026-09-01T10:05:00Z", "2026-09-01T10:06:00Z") });
  assert.equal(apart.observables.find((entry) => entry.observable_id === "collision-safe-parallelism").pass, true);
  assert.equal(apart.observables.find((entry) => entry.observable_id === "simplest-adequate-route").pass, true);

  // implementation and verification both own `src`, and the requirement calls both serial.
  const together = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: ledger("2026-09-01T10:10:00Z", "2026-09-01T10:05:00Z") });
  assert.equal(together.observables.find((entry) => entry.observable_id === "collision-safe-parallelism").pass, false);
  assert.equal(together.observables.find((entry) => entry.observable_id === "simplest-adequate-route").pass, false,
    "a route the ledger shows colliding over a shared resource was still adequate");
  assert.equal(together.constraint_failures.some((entry) => entry.constraint === "parallelism" && entry.basis === "observed-overlap"), true);
});

test("an event naming a task the requirement does not hold is refused, not silently dropped", () => {
  // The shape of an identifier is not proof that it identifies anything. A well-formed
  // `task_id: "phantom"` was admitted and then dropped by every consumer that looked its task up,
  // so it counted as an invocation nowhere and left the route looking cheaper than the work it did.
  const requirements = requirementsFromWork({ tasks: [{ id: "a", resource: "r", depends_on: [] }] }).requirements;
  const real = event({ task_id: "a", agent_id: "one", purpose_id: "a", invocation_id: "invocation-a", artifact_ids: ["artifact-a"] });
  const phantom = event({ task_id: "phantom", agent_id: "one", purpose_id: "phantom", invocation_id: "invocation-phantom", artifact_ids: ["artifact-p"] });

  const oracle = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: [real, phantom] });
  assert.deepEqual(oracle.actual_route_events.map((entry) => entry.invocation_id), ["invocation-a"]);
  assert.equal(oracle.rejected_route_events.length, 1);
  assert.match(oracle.rejected_route_events[0].reason, /is not a task in this run's routing requirement/u);
  // A null task id is still admitted: it attributes nobody and says so, which is different from
  // naming a task that does not exist.
  const unattributed = pricedOracle({ requirements, capabilities: twoKnown(), actual_route_events: [real, event({ invocation_id: "invocation-loose" })] });
  assert.deepEqual(unattributed.rejected_route_events, []);
  assert.equal(unattributed.actual_route_events.length, 2);
});
