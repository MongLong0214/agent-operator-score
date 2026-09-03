// #558, the solver. The cheapest route that satisfies every constraint the requirement states, the
// same answer every time it is asked, and a stated refusal rather than a guess when the search is
// larger than this oracle will answer for.
//
// The six observables that follow from it are here too, including the one that is a shortfall and
// the one that is a silence -- an owner AOS cannot judge and an owner AOS judged and found wanting
// are different answers.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { METRICS } from "../../lib/metrics.mjs";
import { observeRun } from "../../lib/observe.mjs";
import { ADAPTERS } from "../../lib/profile.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import { prepareScenario } from "../../lib/suite.mjs";
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
  const oracle = routeOracle({ requirements: requirementsFromWork(WORK).requirements, capabilities: twoKnown() });
  assert.deepEqual(oracle.observables.map((entry) => entry.observable_id), [...ROUTING_OBSERVABLE_IDS]);
  for (const entry of oracle.observables) {
    assert.equal([true, false, null].includes(entry.pass), true, `${entry.observable_id} answered with something that is not a verdict`);
    assert.equal(typeof entry.reason === "string" && entry.reason.length > 0, true, `${entry.observable_id} answered without a reason`);
  }
  assert.equal(oracle.schema_id, ROUTE_ORACLE_SCHEMA);
});

test("an invalid requirement withholds all six observables rather than answering the ones it can", () => {
  const requirements = requirementsFromWork(WORK).requirements.map((entry) => ({ ...entry, max_invocations: 0 }));
  const oracle = routeOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event()] });
  for (const entry of oracle.observables) assert.equal(entry.pass, null, `${entry.observable_id} was answered against an invalid contract`);
  assert.equal(oracle.contract_problems.length > 0, true);
  assert.equal(oracle.minimum.status, "CONTRACT_INVALID");
});

test("a requirement asking for a capability the owner does not hold fails rather than withholding", () => {
  const partial = capabilityRecord({ agent_id: "narrow", capabilities: ["code-read", "artifact-write"], source: "aos-known" });
  const capabilities = new Map([["one", known("one")], ["narrow", partial]]);
  const requirements = requirementsFromWork(WORK).requirements;
  const owners = { contract: "one", implementation: "one", docs: "one", verification: "narrow", release: "one" };
  const events = Object.keys(owners).sort().map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId, artifact_ids: [`artifact-${index + 1}`]
  }));
  const oracle = routeOracle({ requirements, capabilities, actual_route_events: events });
  const capability = oracle.observables.find((entry) => entry.observable_id === "capability-matches-task");
  assert.equal(capability.pass, false, "a known shortfall was withheld instead of failed");
  assert.match(capability.reason, /lacks/u);
  assert.equal(oracle.constraint_failures.some((entry) => entry.basis === "missing-capability"), true);
});

test("the delegation reference tells over-delegation from inadequacy and owns no reliance episode", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const capabilities = twoKnown();
  const assign = (owners) => Object.keys(owners).sort().map((taskId, index) => event({
    task_id: taskId, agent_id: owners[taskId], invocation_id: `invocation-${index + 1}`, purpose_id: taskId, artifact_ids: [`artifact-${index + 1}`]
  }));
  const minimal = { contract: "one", implementation: "one", docs: "one", verification: "two", release: "one" };
  const split = { contract: "one", implementation: "one", docs: "two", verification: "two", release: "one" };
  const sameOwner = { contract: "one", implementation: "one", docs: "one", verification: "one", release: "one" };

  const best = delegationOracle(routeOracle({ requirements, capabilities, actual_route_events: assign(minimal) }));
  assert.equal(best.expected_value_class, "MINIMAL");
  assert.equal(best.over_delegation_reference, 0);
  assert.deepEqual(best.under_delegation_reference, []);

  const over = delegationOracle(routeOracle({ requirements, capabilities, actual_route_events: assign(split) }));
  assert.equal(over.expected_value_class, "OVER_DELEGATED");
  assert.equal(over.over_delegation_reference > 0, true);

  const under = delegationOracle(routeOracle({ requirements, capabilities, actual_route_events: assign(sameOwner) }));
  assert.equal(under.expected_value_class, "UNDER_DELEGATED");
  assert.equal(under.under_delegation_reference.some((entry) => entry.constraint === "independence"), true);

  for (const reference of [best, over, under]) {
    assert.equal(reference.reliance_episodes, null, "the delegation reference produced a reliance episode of its own");
    assert.equal(reference.reliance_owner, "issue-583");
  }
  // Nothing to compare is not a class of delegation.
  assert.equal(delegationOracle(routeOracle({ requirements, capabilities })).expected_value_class, "NOT_OBSERVED");
});
