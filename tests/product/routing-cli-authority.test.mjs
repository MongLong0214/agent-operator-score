// #558, through the binary. The oracle tests hand the oracle a ledger; these run `aos assess` and
// read what the product actually emitted.
//
// The distinction matters because the first version of this issue failed exactly here. Every
// focused test injected one actual route event per task, so every one of them exercised the branch
// where the ledger assigns. The production emitter cannot attribute an invocation to a plan task --
// AOS invokes an agent for a family, not for one of the tasks the agent's own plan describes -- so
// it emits `task_id: null`, and the oracle then fell back to the plan for ownership. Two events
// naming two different agents produced the same full M09, because neither of them decided anything
// and the artifact decided everything. The oracle suites all passed.
//
// So this file asks the questions of the run: what shape did the emitter produce, what did the
// oracle do with it, and does the record move when the agent that ran moves.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ACTUAL_ROUTE_EVENT_SCHEMA, validateActualRouteEvent } from "../../lib/routing-oracle.mjs";
import { addAgent, initBare, makePlan, newestRecord, newestResult, run as runCli } from "./helpers.mjs";

const OWNER_DEPENDENT = ["capability-matches-task", "simplest-adequate-route"];
const LEDGER_ANSWERED = ["no-redundant-invocation", "invocation-budget-respected"];

const assess = (cwd, route, seed) => {
  const plan = makePlan(cwd, { default: route });
  // Exit 3: nobody was watching, so D4 is unobserved and the score is withheld. That is the
  // ordinary outcome of an unattended run and not what this file is about.
  runCli(cwd, ["assess", "--plan", plan, "--seed", seed], 3);
  return { record: newestRecord(cwd), result: newestResult(cwd) };
};

const m09Of = (result) => result.observations.find((entry) => entry.metric_id === "M09");
const subOf = (result, id) => m09Of(result).subchecks.find((entry) => entry.id === id).pass;

test("the run's own route events are the record the oracle scores, and the plan is not", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-routing-cli-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  initBare(cwd);
  addAgent(cwd, "alpha");
  addAgent(cwd, "beta");

  const first = assess(cwd, "alpha", "1");
  const oracle = first.record.routing_oracle;

  // The emitter produces the versioned record, and every one of them is admitted.
  assert.equal(oracle.actual_route_events.length > 0, true, "the run recorded no route event at all");
  for (const event of oracle.actual_route_events) {
    assert.equal(event.schema_id, ACTUAL_ROUTE_EVENT_SCHEMA);
    assert.deepEqual(validateActualRouteEvent(event), [], `${event.invocation_id} is not a valid route event`);
  }
  assert.deepEqual(oracle.rejected_route_events, [], "the run emitted an event its own validator refused");

  // It does not fabricate attribution. AOS did not invoke an agent for `verification`, so no event
  // says it did.
  for (const event of oracle.actual_route_events) {
    assert.equal(event.task_id, null, `${event.invocation_id} claims to have run a plan task`);
  }

  // And nothing is therefore assigned, however complete the plan's proposal is.
  const proposed = oracle.assignment.filter((entry) => entry.proposed_owner_id !== null);
  assert.equal(proposed.length > 0, true, "the plan proposed no owner, so this run does not test the fallback");
  for (const entry of oracle.assignment) {
    assert.equal(entry.owner_id, null, `${entry.task_id} was assigned an owner nothing attributed`);
    assert.equal(entry.provenance !== "actual-route-event", true);
  }
  assert.equal(oracle.actual_cost, null, "a route cost was computed from owners nothing attributed");
  assert.equal(oracle.cost_basis, null);

  // Which reaches the metric: the two questions that need an owner are withheld by name, and the
  // two the ledger can answer are answered.
  for (const id of OWNER_DEPENDENT) assert.equal(subOf(first.result, id), null, `${id} was answered without an attributed owner`);
  for (const id of LEDGER_ANSWERED) assert.equal([true, false].includes(subOf(first.result, id)), true, `${id} was not answered from the ledger`);
  assert.notEqual(m09Of(first.result).value, 1, "a plan alone reached full marks through the binary");
  assert.equal(m09Of(first.result).verifier_id, "aos-route-oracle.v1");
  assert.equal(first.record.delegation_oracle.expected_value_class, "NOT_OBSERVED");
});

test("the agent a route event names is the agent that ran, not the one the plan named", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-routing-cli-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  initBare(cwd);
  addAgent(cwd, "alpha");
  addAgent(cwd, "beta");

  const agents = (record) => [...new Set(record.routing_oracle.actual_route_events.map((event) => event.agent_id))].sort();
  const routeIds = (record) => [...new Set(record.routing_oracle.actual_route_events.map((event) => event.route_id))];

  // A route with two stages in it, because a one-agent route spells its agent and its route the
  // same way -- and an emitter that wrote the route where the agent belongs would look right in
  // every single-agent run. Here they differ, and the ledger has to name the one that ran.
  const two = assess(cwd, "alpha>beta", "1").record;
  assert.deepEqual(agents(two), ["alpha", "beta"]);
  assert.deepEqual(routeIds(two), ["alpha>beta"], "the route the operator declared is recorded as the route, beside the agents");

  // And the same plan shape with a different agent doing the work says so.
  assert.deepEqual(agents(assess(cwd, "beta", "1").record), ["beta"]);
});

test("the oracle record the run stores is the one the scored row names", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-routing-cli-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  initBare(cwd);
  addAgent(cwd, "alpha");

  const { record, result } = assess(cwd, "alpha", "2");
  const { routeOracleEvidenceId } = await import("../../lib/routing-oracle.mjs");
  assert.equal(
    m09Of(result).evidence_ids.includes(routeOracleEvidenceId(record.routing_oracle.route_oracle_digest)),
    true,
    "the scored row names a different oracle record from the one stored beside the run"
  );
  // And the stored record survived the publishing gate unchanged, which is what makes the reference
  // resolvable at all.
  assert.match(record.routing_oracle.route_oracle_digest, /^sha256:[0-9a-f]{64}$/u);
});
