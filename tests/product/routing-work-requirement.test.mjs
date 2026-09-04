// #558, the half PR #614 left open: the requirement a run is judged against was built from the
// operator's own declared route, so route breadth was structurally unjudgeable.
//
// `requirementsFromRoute` writes one task per stage of the route it is given. Adding a stage
// therefore adds a task, and the minimum rises by exactly what the actual route rises by. Measured
// through the binary at four breadths before this change -- alpha>beta 3/3, alpha>beta>gamma 5/5,
// alpha>beta>gamma>delta 7/7, alpha|beta>gamma 5/5 -- `actual_cost` equalled `minimum_cost` every
// time and `over_delegation_reference` was zero however wide the operator went.
//
// What closes it is a requirement AOS states about the work, produced at plan approval and
// independent of the route: what the form asks for, which is one deliverable however many agents
// the operator puts in front of it. This file asks the product for that, at the four breadths that
// reproduced the defect and at the one that did not.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ACTUAL_ROUTE_EVENT_SCHEMA,
  FORM_WORK,
  ROUTING_REQUIREMENT_SCHEMA,
  WORK_REQUIREMENT_SCHEMA,
  capabilityRecordsFor,
  delegationOracle,
  requirementsFromRoute,
  requirementsFromWork,
  routeOracle,
  workRequirementAtPlanApproval,
  workRequirementDigest
} from "../../lib/routing-oracle.mjs";
import { addAgent, fakeAgent, initBare, makePlan, newestRecord, newestResult, run as runCli } from "./helpers.mjs";

const workspace = (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-work-requirement-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
};

const addAdaptedAgent = (cwd, id) => addAgent(cwd, id, fakeAgent, ["--adapter", "codex-cli.v1"]);

/** One assessment, unattended. Exit 3 is the ordinary outcome of a run nobody was watching. */
const assess = (cwd, route) => {
  const plan = makePlan(cwd, { default: "alpha", "FAM-3": route });
  runCli(cwd, ["assess", "--plan", plan, "--seed", "1"], 3);
  return { record: newestRecord(cwd), result: newestResult(cwd) };
};

const minimalityOf = (record) => record.routing_oracle.observables.find((entry) => entry.observable_id === "simplest-adequate-route");

// --- the defect, at the four breadths that reproduced it -------------------------------------------

test("route breadth costs more than the work AOS asked for, at every breadth that used to be free", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  for (const id of ["alpha", "beta", "gamma", "delta"]) addAdaptedAgent(cwd, id);

  // The one route whose cost is the work's own minimum: one invocation, no handoff.
  const single = assess(cwd, "alpha");
  assert.equal(single.record.routing_oracle.actual_cost, 1);
  assert.equal(single.record.routing_oracle.minimum.minimum_cost, 1);
  assert.equal(minimalityOf(single.record).pass, true, "a single-stage route is the cheapest adequate route and must still say so");
  assert.equal(single.record.delegation_oracle.over_delegation_reference, 0);
  assert.equal(single.record.delegation_oracle.expected_value_class, "MINIMAL");

  // And the four breadths #614 measured as equal to their own minimum.
  for (const [route, actual] of [["alpha>beta", 3], ["alpha>beta>gamma", 5], ["alpha>beta>gamma>delta", 7], ["alpha|beta>gamma", 5]]) {
    const { record } = assess(cwd, route);
    const oracle = record.routing_oracle;
    assert.equal(oracle.actual_cost, actual, `${route} spent something other than the cost the ledger records`);
    assert.equal(oracle.minimum.minimum_cost, 1, `${route}: the minimum still follows the route under measurement`);
    assert.equal(minimalityOf(record).pass, false, `${route} is reported as the cheapest adequate route`);
    assert.equal(record.delegation_oracle.over_delegation_reference, actual - 1, `${route}: over-delegation is still structurally zero`);
    assert.equal(record.delegation_oracle.expected_value_class, "OVER_DELEGATED");
  }
});

// --- the requirement does not come from the thing it judges ----------------------------------------

test("the work requirement is the same whatever route the operator declares", () => {
  const one = workRequirementAtPlanApproval({ form_id: "FAM-3" });
  assert.equal(one.schema_id, WORK_REQUIREMENT_SCHEMA);
  assert.equal(one.problems.length, 0);
  assert.equal(one.requirements.length, 1);
  assert.equal(one.requirements[0].schema_id, ROUTING_REQUIREMENT_SCHEMA);
  assert.equal(workRequirementDigest(one.work_graph), one.work_digest);

  // There is no route parameter to pass one to, so a route handed in reaches nothing. The producer
  // is independent of the route by signature, which a reviewer checks by reading rather than by
  // believing a sentence about trust.
  for (const route of ["alpha", "alpha>beta", "alpha>beta>gamma>delta", "alpha|beta>gamma"]) {
    const other = workRequirementAtPlanApproval({ form_id: "FAM-3", route });
    assert.equal(other.work_digest, one.work_digest, `${route} moved the work AOS states for FAM-3`);
    assert.deepEqual(other.requirements.map((entry) => entry.task_id), one.requirements.map((entry) => entry.task_id));
    assert.deepEqual(other.requirements.map((entry) => entry.route_cost_budget), [1]);
  }
});

test("a form AOS states no work for withholds rather than passing or scoring zero", () => {
  const absent = workRequirementAtPlanApproval({ form_id: "FAM-9" });
  assert.equal(absent.requirements, null);
  assert.equal(absent.work_graph, null);
  assert.equal(absent.work_digest, null);
  assert.equal(absent.problems.length > 0, true);
  assert.equal(Object.hasOwn(FORM_WORK, "FAM-9"), false);

  const capabilities = capabilityRecordsFor({ alpha: { adapter: "codex-cli.v1" } });
  const { requirements } = requirementsFromRoute({ form_id: "FAM-3", route: "alpha" });
  const oracle = routeOracle({ requirements, capabilities, work_requirement: absent, actual_route_events: [] });
  const minimality = oracle.observables.find((entry) => entry.observable_id === "simplest-adequate-route");
  assert.equal(minimality.pass, null, "a run with no stated work answered the minimality question anyway");
  assert.equal(oracle.minimum.status, "NO_WORK_REQUIREMENT");
  assert.equal(delegationOracle(oracle).expected_value_class, "NOT_OBSERVED");
  assert.equal(delegationOracle(oracle).over_delegation_reference, null);
});

// --- the record says what was frozen, and when -----------------------------------------------------

test("the run records the work AOS froze at plan approval, bound by digest", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addAdaptedAgent(cwd, "alpha");
  addAdaptedAgent(cwd, "beta");
  const { record } = assess(cwd, "alpha>beta");

  const frozen = record.routing_oracle.work_requirement;
  assert.equal(frozen.schema_id, WORK_REQUIREMENT_SCHEMA);
  assert.equal(frozen.form_id, "FAM-3");
  assert.equal(frozen.work_digest, workRequirementAtPlanApproval({ form_id: "FAM-3" }).work_digest);
  // Recomputed from the graph on the record and equal to the envelope's own claim.
  assert.equal(frozen.work_digest, frozen.declared_work_digest);
  assert.deepEqual(frozen.requirements.map((entry) => entry.task_id), ["FAM-3/work"]);
  // Frozen before the first invocation: every route event the ledger admitted started after it.
  const started = record.routing_oracle.actual_route_events.map((event) => event.started_at).filter(Boolean);
  assert.equal(started.length > 0, true);
  for (const at of started) assert.equal(frozen.frozen_at <= at, true, "the work was stated after an invocation had already run");
});

// --- negative and counterfactual ------------------------------------------------------------------

test("a work digest that names other work than the graph beside it withholds rather than pricing", () => {
  const capabilities = capabilityRecordsFor({ alpha: { adapter: "codex-cli.v1" } });
  const { requirements } = requirementsFromRoute({ form_id: "FAM-3", route: "alpha>beta" });
  const honest = workRequirementAtPlanApproval({ form_id: "FAM-3" });
  const forged = { ...honest, work_digest: workRequirementDigest({ tasks: [{ id: "elsewhere", resource: "x", depends_on: [] }] }) };

  const priced = routeOracle({ requirements, capabilities, work_requirement: honest, actual_route_events: [] });
  assert.equal(priced.minimum.status, "SOLVED");

  const refused = routeOracle({ requirements, capabilities, work_requirement: forged, actual_route_events: [] });
  assert.equal(refused.minimum.status, "NO_WORK_REQUIREMENT");
  assert.equal(refused.work_requirement.problems.some((problem) => problem.includes("not the digest")), true);
  assert.equal(refused.observables.find((entry) => entry.observable_id === "simplest-adequate-route").pass, null);
});

/**
 * Why the seeded work graph is not the run's requirement, measured rather than argued.
 *
 * `work.json` is the five-task graph AOS seeds into FAM-3's workspace, and it is the subject of the
 * agent's planning exercise: AOS invokes an agent for a stage of the family's route and for nothing
 * else, so it invokes nobody for `contract` or `verification`. Handing that graph to the oracle as
 * the run's requirement therefore makes every real invocation name a task the requirement does not
 * hold, `admitRouteEvents` refuses all of them, and every observable withholds. That is the reason
 * the floor is taken from `FORM_WORK` and the attribution from the route AOS ran.
 */
test("the seeded work graph cannot be a run's requirement: every real invocation would be refused", () => {
  const capabilities = capabilityRecordsFor({ alpha: { adapter: "codex-cli.v1" }, beta: { adapter: "codex-cli.v1" } });
  const seeded = {
    tasks: [
      { id: "contract", resource: "spec", depends_on: [] },
      { id: "implementation", resource: "src", depends_on: ["contract"] },
      { id: "docs", resource: "docs", depends_on: ["contract"] },
      { id: "verification", resource: "src", depends_on: ["implementation"] },
      { id: "release", resource: "join", depends_on: ["docs", "verification"] }
    ]
  };
  const { requirements } = requirementsFromWork(seeded);
  // The ledger a real two-stage run produces: the tasks are the stages AOS performed.
  const events = ["FAM-3/stage-1", "FAM-3/stage-2"].map((taskId, index) => ({
    schema_id: ACTUAL_ROUTE_EVENT_SCHEMA,
    task_id: taskId,
    agent_id: index === 0 ? "alpha" : "beta",
    route_id: "alpha>beta",
    invocation_id: `FAM-3:stage-${index + 1}:${index + 1}`,
    purpose_id: taskId,
    started_at: `2026-09-01T10:0${index * 2}:00Z`,
    completed_at: `2026-09-01T10:0${index * 2 + 1}:00Z`,
    artifact_ids: [],
    handoff_ids: [],
    capability_digest: null,
    operator_decision_event_id: null,
    operator_opportunity_id: null
  }));
  const oracle = routeOracle({ requirements, capabilities, work_requirement: { requirements, problems: [] }, actual_route_events: events });
  assert.equal(oracle.actual_route_events.length, 0, "an invocation was attributed to work AOS never invoked anybody for");
  assert.equal(oracle.rejected_route_events.length, 2);
  for (const rejected of oracle.rejected_route_events) {
    assert.equal(rejected.reason.includes("is not a task in this run's routing requirement"), true);
  }
  for (const observable of oracle.observables) {
    if (observable.observable_id === "collision-safe-parallelism") continue;
    assert.equal(observable.pass, null, `${observable.observable_id} answered a run in which nothing was attributed`);
  }
});

test("a narrower route that did not do the work is inadequate, not cheap", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addAdaptedAgent(cwd, "alpha");
  // An agent that runs, says something and writes no artifact at all.
  const silent = join(cwd, "silent-agent.mjs");
  writeFileSync(silent, 'process.stdout.write("ran and wrote nothing" + String.fromCharCode(10));\n', "utf8");
  addAgent(cwd, "mute", silent, ["--adapter", "codex-cli.v1"]);

  const { record } = assess(cwd, "mute");
  const oracle = record.routing_oracle;
  // One invocation, which is the floor -- and still not adequate, because the artifact the
  // requirement names is not there. Fewer invocations does not buy a pass.
  assert.equal(oracle.actual_cost, 1);
  assert.equal(oracle.minimum.minimum_cost, 1);
  const simplest = oracle.observables.find((entry) => entry.observable_id === "simplest-adequate-route");
  assert.equal(simplest.pass, false, "a route that produced nothing was scored as the cheapest adequate route");
  assert.equal(oracle.constraint_failures.some((entry) => entry.constraint === "artifact"), true);
  assert.equal(record.delegation_oracle.expected_value_class, "UNDER_DELEGATED");
});

test("nothing the agent or the operator writes can reach the floor", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addAdaptedAgent(cwd, "alpha");
  addAdaptedAgent(cwd, "beta");

  // Two runs whose operator plans differ in everything the plan can say about FAM-3's work -- the
  // route, the declared tasks, the dependencies and the handoffs -- and one floor.
  const wide = assess(cwd, "alpha>beta");
  const narrow = assess(cwd, "alpha");
  assert.equal(wide.record.routing_oracle.work_requirement.work_digest, narrow.record.routing_oracle.work_requirement.work_digest);
  assert.notEqual(wide.record.routing_oracle.requirements.length, narrow.record.routing_oracle.requirements.length);
  assert.equal(wide.record.routing_oracle.minimum.minimum_cost, narrow.record.routing_oracle.minimum.minimum_cost);

  // And the floor is not the seeded workspace either: an agent that rewrote `work.json` would move
  // nothing, because the producer never opens it.
  assert.equal(narrow.record.routing_oracle.work_requirement.work_graph.tasks.length, 1);
  assert.deepEqual(narrow.record.routing_oracle.work_requirement.work_graph.tasks.map((task) => task.id), ["work"]);
});

// --- the envelope declares nothing the oracle believes ---------------------------------------------

/**
 * Both reproductions round 1 of the merge gate built, kept as regressions.
 *
 * The first version of this read the floor straight off `work_requirement.requirements` — a field
 * no digest covered, while the digest that *was* checked covered `work_graph`, which decided nothing
 * else. The checked field was not the deciding field. Two envelopes exploited it: one declaring a
 * route-derived requirement list and no graph at all, and the sharper one taking the honest frozen
 * record and swapping only that list, which left the digest verifying and `problems` empty while the
 * floor went back to 3 and `simplest-adequate-route` back to true.
 *
 * The floor is now recomputed from the graph the digest covers, so the first withholds and the
 * second has no effect whatsoever — the stronger of the two outcomes, because a field that is
 * ignored cannot be got wrong.
 */
test("a work record declaring a requirement list and carrying no graph withholds", () => {
  const capabilities = capabilityRecordsFor({ alpha: { adapter: "codex-cli.v1" }, beta: { adapter: "codex-cli.v1" } });
  const { requirements } = requirementsFromRoute({ form_id: "FAM-3", route: "alpha>beta" });
  const declared = { schema_id: WORK_REQUIREMENT_SCHEMA, form_id: "FAM-3", requirements, problems: [] };

  const oracle = routeOracle({ requirements, capabilities, work_requirement: declared, actual_route_events: [] });
  assert.equal(oracle.minimum.status, "NO_WORK_REQUIREMENT");
  assert.equal(oracle.minimum.minimum_cost, null);
  assert.equal(oracle.work_requirement.requirements, null, "a declared requirement list reached the record");
  assert.equal(oracle.work_requirement.problems.some((problem) => problem.includes("carries no work graph")), true);
  assert.equal(oracle.observables.find((entry) => entry.observable_id === "simplest-adequate-route").pass, null);
  assert.equal(delegationOracle(oracle).expected_value_class, "NOT_OBSERVED");
});

test("an honest work record with its requirement list swapped prices exactly as the honest one does", () => {
  const capabilities = capabilityRecordsFor({ alpha: { adapter: "codex-cli.v1" }, beta: { adapter: "codex-cli.v1" } });
  const { requirements } = requirementsFromRoute({ form_id: "FAM-3", route: "alpha>beta" });
  const honest = workRequirementAtPlanApproval({ form_id: "FAM-3" });
  // Only the requirement list differs. The digest still verifies, because it covers the graph.
  const swapped = { ...honest, requirements };

  const priced = (work) => routeOracle({ requirements, capabilities, work_requirement: work, actual_route_events: [] });
  const clean = priced(honest);
  const attacked = priced(swapped);

  assert.equal(attacked.work_requirement.work_digest, attacked.work_requirement.declared_work_digest, "the attack was caught by the digest instead of being made irrelevant");
  assert.deepEqual(attacked.work_requirement.problems, []);
  assert.equal(attacked.minimum.minimum_cost, 1, "a swapped requirement list moved the floor");
  assert.equal(attacked.minimum.minimum_cost, clean.minimum.minimum_cost);
  assert.deepEqual(
    attacked.work_requirement.requirements.map((entry) => entry.task_id),
    clean.work_requirement.requirements.map((entry) => entry.task_id)
  );
  assert.equal(attacked.route_oracle_digest, clean.route_oracle_digest, "the envelope's own list reached the record");
});

test("a form AOS states no work for cannot select a capability floor for a graph", () => {
  const capabilities = capabilityRecordsFor({ alpha: { adapter: "codex-cli.v1" } });
  const { requirements } = requirementsFromRoute({ form_id: "FAM-3", route: "alpha" });
  const borrowed = {
    schema_id: WORK_REQUIREMENT_SCHEMA,
    form_id: "FAM-9",
    work_graph: FORM_WORK["FAM-3"],
    problems: []
  };
  const oracle = routeOracle({ requirements, capabilities, work_requirement: borrowed, actual_route_events: [] });
  assert.equal(oracle.minimum.status, "NO_WORK_REQUIREMENT");
  assert.equal(oracle.work_requirement.problems.some((problem) => problem.includes("is not a form AOS states work for")), true);
});
