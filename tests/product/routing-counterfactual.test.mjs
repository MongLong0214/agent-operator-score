// #558. The counterfactuals the issue names, asked of the observation layer rather than of the
// oracle module, because a subcheck is only replaced when the thing that computes M09 has changed.
//
// M09 answered `capability-matches-task` with "did the agent write a word in the route field" and
// `simplest-adequate-route` with `new Set(n).size <= n`, which is true of every set that has ever
// existed. Both are gone. What is here is the run: a seeded requirement AOS wrote before the agent
// started, capability records AOS holds for the runtimes it ships an adapter for, and the
// invocation ledger.

import assert from "node:assert/strict";
import test from "node:test";

import { observeRun } from "../../lib/observe.mjs";
import { ACTUAL_ROUTE_EVENT_SCHEMA, CAPABILITY_VOCABULARY, capabilityRecord, routingObservables } from "../../lib/routing-oracle.mjs";

const WORK = {
  tasks: [
    { id: "contract", resource: "spec", depends_on: [] },
    { id: "implementation", resource: "src", depends_on: ["contract"] },
    { id: "docs", resource: "docs", depends_on: ["contract"] },
    { id: "verification", resource: "src", depends_on: ["implementation"] },
    { id: "release", resource: "join", depends_on: ["docs", "verification"] }
  ],
  collision: "implementation and verification both own src and must be serial"
};

const known = (id) => capabilityRecord({ agent_id: id, capabilities: [...CAPABILITY_VOCABULARY], source: "aos-known", evidence_ids: ["adapter:claude-code.v1"] });
const CAPABILITIES = () => new Map([["strong", known("strong")], ["other", known("other")]]);

const PLAN = (routes) => ({
  tasks: WORK.tasks.map((task) => ({
    id: task.id,
    objective: `do ${task.id}`,
    acceptance: `${task.id} is checkable`,
    route: routes[task.id],
    depends_on: [...task.depends_on]
  })),
  handoffs: [{ from: "implementation", to: "verification", artifacts: ["src"] }],
  join: { requires: ["docs", "verification"] }
});

const MINIMAL = { contract: "other", implementation: "other", docs: "other", verification: "strong", release: "other" };

const event = (taskId, agentId, index) => ({
  schema_id: ACTUAL_ROUTE_EVENT_SCHEMA,
  task_id: taskId,
  agent_id: agentId,
  route_id: "strong>other",
  invocation_id: `invocation-${index}`,
  purpose_id: taskId,
  started_at: null,
  completed_at: null,
  artifact_ids: [`artifact-${index}`],
  handoff_ids: [],
  capability_digest: null,
  operator_decision_event_id: null,
  operator_opportunity_id: null
});

const ledgerFor = (assignment) => Object.keys(assignment).sort().map((taskId, index) => event(taskId, assignment[taskId], index + 1));

const m09 = ({ routes = MINIMAL, ledger = null, work = WORK, capabilities = CAPABILITIES() } = {}) =>
  observeRun({
    artifacts: { plan: PLAN(routes) },
    params: { "FAM-3": {} },
    routing: { work, capabilities, actual_route_events: ledger ?? ledgerFor(routes) }
  }).find((entry) => entry.metric_id === "M09");

const sub = (observation, id) => observation.subchecks.find((entry) => entry.id === id).pass;

test("M09 carries no subcheck whose expression is true of every input", () => {
  // All four, each shown passing and then shown not passing. A subcheck that has never been
  // observed to answer anything but `true` is the defect this issue exists to remove, so the
  // falsifying run is named for each of them rather than for the two that were tautologies.
  const ledger = ledgerFor(MINIMAL);
  const passing = m09({ routes: MINIMAL });
  for (const id of ["capability-matches-task", "simplest-adequate-route", "no-redundant-invocation", "invocation-budget-respected"]) {
    assert.equal(sub(passing, id), true, `${id} does not pass on a run that satisfies it`);
  }
  assert.equal(passing.value, 1);

  // `simplest-adequate-route` distinguished nothing at all: `new Set(n).size <= n`.
  const spread = { contract: "strong", implementation: "other", docs: "strong", verification: "other", release: "strong" };
  assert.equal(sub(m09({ routes: spread }), "simplest-adequate-route"), false);

  // `capability-matches-task` was satisfied by any non-empty string. An owner AOS holds no record
  // for is now not an owner that matched.
  assert.equal(sub(m09({ routes: { ...MINIMAL, docs: "someone-else" } }), "capability-matches-task"), null);
  // And a known shortfall is a fail rather than a silence.
  const narrow = new Map([...CAPABILITIES(), ["narrow", capabilityRecord({ agent_id: "narrow", capabilities: ["code-read", "artifact-write"], source: "aos-known" })]]);
  assert.equal(sub(m09({ routes: { ...MINIMAL, verification: "narrow" }, capabilities: narrow }), "capability-matches-task"), false);

  const repeat = { ...ledger[0], invocation_id: "invocation-repeat" };
  assert.equal(sub(m09({ routes: MINIMAL, ledger: [...ledger, repeat] }), "no-redundant-invocation"), false);
  const extra = { ...ledger[0], invocation_id: "invocation-extra", artifact_ids: ["artifact-extra"] };
  assert.equal(sub(m09({ routes: MINIMAL, ledger: [...ledger, extra] }), "invocation-budget-respected"), false);
});

test("one redundant agent lowers routing minimality and nothing else", () => {
  const minimal = m09({ routes: MINIMAL });
  // The same five tasks and the same five invocations, with one task moved to a second owner that
  // the work did not need -- which buys two handoffs.
  const extra = { ...MINIMAL, docs: "strong" };
  const spread = m09({ routes: extra });

  assert.equal(sub(minimal, "simplest-adequate-route"), true);
  assert.equal(sub(spread, "simplest-adequate-route"), false);
  for (const id of ["capability-matches-task", "no-redundant-invocation", "invocation-budget-respected"]) {
    assert.equal(sub(spread, id), sub(minimal, id), `${id} moved when only routing minimality should have`);
  }
});

test("the same plan text with a different actual route is judged by the actual route", () => {
  const plan = PLAN(MINIMAL);
  const followed = observeRun({
    artifacts: { plan },
    params: { "FAM-3": {} },
    routing: { work: WORK, capabilities: CAPABILITIES(), actual_route_events: ledgerFor(MINIMAL) }
  }).find((entry) => entry.metric_id === "M09");
  // Identical plan bytes. The ledger says verification went to the agent that wrote the code.
  const diverged = observeRun({
    artifacts: { plan },
    params: { "FAM-3": {} },
    routing: { work: WORK, capabilities: CAPABILITIES(), actual_route_events: ledgerFor({ ...MINIMAL, verification: "other" }) }
  }).find((entry) => entry.metric_id === "M09");

  assert.equal(sub(followed, "simplest-adequate-route"), true);
  assert.equal(sub(diverged, "simplest-adequate-route"), false);
  // The plan is the same object in both, so nothing about the artifact explains the difference.
  assert.equal(followed.verifier_id, "aos-route-oracle.v1");
  assert.equal(diverged.verifier_id, "aos-route-oracle.v1");
  assert.notEqual(followed.value, diverged.value);
});

test("a perfect declaration with no invocation event cannot reach full credit", () => {
  const declared = m09({ routes: MINIMAL, ledger: [] });
  for (const entry of declared.subchecks) assert.equal(entry.pass, null, `${entry.id} was answered from the plan alone`);
  assert.equal(declared.value, 0, "a declaration alone earned credit");

  // Nor when the ledger recorded invocations it could not attribute to a task. That is the shape a
  // real run produces, and it used to let the plan supply every owner: two events naming two
  // different agents gave the same full result, because neither decided anything.
  const unattributed = (agent) => [1, 2].map((index) => ({
    ...event("contract", agent, index), task_id: null, purpose_id: `FAM-3/stage-${index}`, artifact_ids: [`artifact-${index}`]
  }));
  const one = m09({ routes: MINIMAL, ledger: unattributed("strong") });
  const other = m09({ routes: MINIMAL, ledger: unattributed("other") });
  assert.equal(sub(one, "capability-matches-task"), null);
  assert.equal(sub(one, "simplest-adequate-route"), null);
  assert.notEqual(one.value, 1, "task-null events plus a plan reached full marks");
  // The ledger half is answerable and identical, which is what makes the two runs comparable at all.
  assert.deepEqual(one.subchecks, other.subchecks);
  assert.equal(sub(one, "invocation-budget-respected"), true);
});

test("an actual route whose owner AOS knows nothing about is not observed", () => {
  const unknown = m09({ routes: { contract: "a1", implementation: "a1", docs: "a1", verification: "a2", release: "a1" } });
  assert.equal(sub(unknown, "capability-matches-task"), null);
  assert.equal(sub(unknown, "simplest-adequate-route"), null);
  // The ledger half is still answerable: five invocations happened whoever made them.
  assert.equal(sub(unknown, "invocation-budget-respected"), true);
});

test("routing the independent verifier to the owner of the work it checks fails independence", () => {
  const sameOwner = { contract: "strong", implementation: "strong", docs: "strong", verification: "strong", release: "strong" };
  const input = { work: WORK, plan: PLAN(sameOwner), capabilities: CAPABILITIES(), actual_route_events: ledgerFor(sameOwner) };

  // The independence observable itself, by name, not only the minimality verdict it also sinks.
  const independence = routingObservables(input).oracle.observables
    .find((entry) => entry.observable_id === "verification-independence");
  assert.equal(independence.pass, false);
  assert.match(independence.reason, /verification and implementation share owner strong/u);

  // And it reaches the metric, through the one subcheck adequacy is asked on.
  const observation = m09({ routes: sameOwner });
  assert.equal(sub(observation, "simplest-adequate-route"), false);
  assert.match(
    routingObservables(input).oracle.observables.find((entry) => entry.observable_id === "simplest-adequate-route").reason,
    /not adequate/u
  );
  assert.equal(sub(m09({ routes: MINIMAL }), "simplest-adequate-route"), true);
  assert.notEqual(observation.value, 1);
});

test("an invocation that repeats a purpose and produces nothing new is redundant", () => {
  const ledger = ledgerFor(MINIMAL);
  const repeat = { ...ledger[0], invocation_id: "invocation-repeat" };
  assert.equal(sub(m09({ routes: MINIMAL, ledger: [...ledger, repeat] }), "no-redundant-invocation"), false);
  // A second invocation of the same purpose that did produce something new is not redundant.
  const productive = { ...ledger[0], invocation_id: "invocation-new", artifact_ids: ["artifact-new"] };
  assert.equal(sub(m09({ routes: MINIMAL, ledger: [...ledger, productive] }), "no-redundant-invocation"), true);
});

test("more invocations than the requirement allows breaks the invocation budget", () => {
  const ledger = ledgerFor(MINIMAL);
  assert.equal(sub(m09({ routes: MINIMAL, ledger }), "invocation-budget-respected"), true);

  // The per-task bound, on its own. Five invocations against a total allowance of five, with one
  // task invoked twice and another not at all -- the retry nobody counted, which a total cannot see.
  const twice = ledger
    .filter((entry) => entry.task_id !== "release")
    .concat([{ ...ledger[0], invocation_id: "invocation-again", artifact_ids: ["artifact-again"] }]);
  assert.equal(twice.length, 5);
  assert.equal(sub(m09({ routes: MINIMAL, ledger: twice }), "invocation-budget-respected"), false);

  // The total, on its own. Six invocations the ledger could not attribute to any task, which the
  // per-task bound never sees because it never counts them.
  const unattributed = Array.from({ length: 6 }, (_, index) => ({
    ...ledger[0], task_id: null, invocation_id: `invocation-loose-${index}`, purpose_id: `purpose-${index}`, artifact_ids: [`artifact-loose-${index}`]
  }));
  assert.equal(sub(m09({ routes: MINIMAL, ledger: unattributed }), "invocation-budget-respected"), false);
  // Five of the same shape is inside the bound, so the count is what decided it.
  assert.equal(sub(m09({ routes: MINIMAL, ledger: unattributed.slice(0, 5) }), "invocation-budget-respected"), true);
});

test("no seeded requirement leaves every routing question unanswered rather than passed", () => {
  const nothing = observeRun({ artifacts: { plan: PLAN(MINIMAL) }, params: { "FAM-3": {} } }).find((entry) => entry.metric_id === "M09");
  for (const entry of nothing.subchecks) assert.equal(entry.pass, null, `${entry.id} answered without a requirement`);
  assert.equal(nothing.value, 0);
});
