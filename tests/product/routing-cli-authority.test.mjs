// #558, through the binary. The oracle tests hand the oracle a ledger; these run `aos assess` and
// read what the product actually emitted.
//
// The distinction matters because two rounds of the merge gate failed here. The first version let
// the plan's proposed owner stand in wherever the ledger was silent; the second emitted every event
// with `task_id: null`, so the ledger was silent about ownership in every run and the two questions
// that need an owner withheld forever. An instrument whose only production answer is "not observed"
// is not measuring the thing it is named for.
//
// The task AOS can attribute is the stage of the route the operator declared, because AOS invoked an
// agent for exactly that. So the requirement is built from the operator's route before anything
// runs, its tasks are those stages, and this file asks the questions of the run: what the emitter
// produced, whether it attributes, and whether the answers move when the run does.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";

import { ACTUAL_ROUTE_EVENT_SCHEMA, routeOracleEvidenceId, validateActualRouteEvent } from "../../lib/routing-oracle.mjs";
import { cli, fakeAgent, initBare, makePlan, newestRecord, newestResult, run as runCli } from "./helpers.mjs";

// An agent that starts, says something and writes nothing. It has to say something: AOS refuses to
// score a command that produced no output at all, which is a different failure from an agent that
// ran and left nothing behind.
const SILENT_AGENT = 'process.stdout.write("ran and wrote nothing" + String.fromCharCode(10));\n';

const OWNER_DEPENDENT = ["capability-matches-task", "simplest-adequate-route"];
const LEDGER_ANSWERED = ["no-redundant-invocation", "invocation-budget-respected"];

/**
 * A writable temporary directory. It throws where there is none, and that is the point.
 *
 * This used to catch `mkdtemp`'s EPERM and skip by name, on the reasoning that a read-only host is
 * evidence this machine could not collect rather than a product defect. #556 refuses that shape and
 * is right to: five of the guards in `tests/mutation/manifest.mjs` are witnessed by tests in this
 * file, and a witness that can decide not to assert lets the mutation it guards survive while the
 * runner reads `ok ... # SKIP` as a pass. The guard is then load-bearing nowhere and says nothing.
 *
 * Nothing is lost by throwing. Every other end-to-end test in `tests/product/` calls `mkdtempSync`
 * bare, so a host that refuses one already fails the suite in fifty other places; catching it here
 * only made this file the one that stayed green on a machine where nothing had run.
 */
function workspace(t) {
  const cwd = mkdtempSync(join(tmpdir(), "aos-routing-cli-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

/**
 * Registered the way a real runtime is, under an adapter AOS ships a capability record for.
 *
 * `codex-cli.v1` and not `claude-code.v1`: the latter resolves its credential from the login
 * keychain, so AOS refuses to hand it to a binary on a world-writable path -- which is where the CI
 * runner keeps node. That refusal is correct and it is `lib/runtime-identity.mjs`'s subject, not
 * this file's; a routing test that trips it is testing the wrong thing on one platform only.
 */
const addAdaptedAgent = (cwd, id, adapter) => runCli(cwd, [
  "agent", "add", id, "--command", process.execPath, "--arg", fakeAgent,
  ...(adapter === null ? [] : ["--adapter", adapter]),
  "--allow-env", "FAKE_AGENT_PROFILE", "--allow-env", "FAKE_AGENT_SKIP_EVIDENCE"
]);

const assess = (cwd, route, seed, env = {}) => {
  const plan = makePlan(cwd, { default: route });
  // Exit 3: nobody was watching, so D4 is unobserved and the score is withheld. That is the
  // ordinary outcome of an unattended run and not what this file is about.
  runCli(cwd, ["assess", "--plan", plan, "--seed", seed], 3, env);
  return { record: newestRecord(cwd), result: newestResult(cwd) };
};

const m09Of = (result) => result.observations.find((entry) => entry.metric_id === "M09");
const subOf = (result, id) => m09Of(result).subchecks.find((entry) => entry.id === id).pass;

test("a completed run attributes every route event to a stage the operator's route declared", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addAdaptedAgent(cwd, "alpha", "codex-cli.v1");

  const { record, result } = assess(cwd, "alpha", "1");
  const oracle = record.routing_oracle;

  // The emitter produces the versioned record and every one of them is admitted.
  assert.equal(oracle.actual_route_events.length > 0, true, "the run recorded no route event at all");
  for (const event of oracle.actual_route_events) {
    assert.equal(event.schema_id, ACTUAL_ROUTE_EVENT_SCHEMA);
    assert.deepEqual(validateActualRouteEvent(event), [], `${event.invocation_id} is not a valid route event`);
  }
  assert.deepEqual(oracle.rejected_route_events, [], "the run emitted an event its own validator refused");

  // Every event names a task the requirement holds, and the requirement's tasks are the stages of
  // the operator's route -- not task ids out of the agent's plan, which AOS invoked nobody for.
  const tasks = new Set(oracle.requirements.map((entry) => entry.task_id));
  assert.deepEqual([...tasks], ["FAM-3/stage-1"]);
  for (const event of oracle.actual_route_events) {
    assert.equal(tasks.has(event.task_id), true, `${event.invocation_id} names ${event.task_id}, which is not a task of this run`);
  }
  // And an owner for every task, taken from the ledger.
  for (const entry of oracle.assignment) {
    assert.equal(entry.owner_id, "alpha");
    assert.equal(entry.provenance, "actual-route-event");
  }
  assert.equal(oracle.cost_basis, "actual-route-events");
  assert.equal(typeof oracle.actual_cost, "number");

  // Which reaches the metric: the two questions that need an owner are answered, not withheld.
  for (const id of [...OWNER_DEPENDENT, ...LEDGER_ANSWERED]) {
    assert.equal([true, false].includes(subOf(result, id)), true, `${id} is still withheld in a completed run`);
  }
  assert.equal(m09Of(result).verifier_id, "aos-route-oracle.v1");
  assert.notEqual(record.delegation_oracle.expected_value_class, "NOT_OBSERVED");
});

test("an agent AOS holds no capability record for withholds the two questions that need one", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  // The same run, registered with no adapter AOS ships. Nothing else changes.
  addAdaptedAgent(cwd, "alpha", null);

  const { record, result } = assess(cwd, "alpha", "1");
  assert.equal(record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha").source, "unknown");
  // Still attributed -- the ledger says who ran -- and still withheld, because AOS does not know
  // what that runtime can do.
  for (const entry of record.routing_oracle.assignment) assert.equal(entry.provenance, "actual-route-event");
  for (const id of OWNER_DEPENDENT) assert.equal(subOf(result, id), null, `${id} was answered about an owner AOS knows nothing about`);
  for (const id of LEDGER_ANSWERED) assert.equal([true, false].includes(subOf(result, id)), true, `${id} needs no capability record and was withheld anyway`);
});

test("the agent a route event names is the agent that ran, not the one the plan named", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addAdaptedAgent(cwd, "alpha", "codex-cli.v1");
  addAdaptedAgent(cwd, "beta", "codex-cli.v1");

  const agents = (record) => [...new Set(record.routing_oracle.actual_route_events.map((event) => event.agent_id))].sort();
  const routeIds = (record) => [...new Set(record.routing_oracle.actual_route_events.map((event) => event.route_id))];

  // A route with two stages in it, because a one-agent route spells its agent and its route the
  // same way -- an emitter that wrote the route where the agent belongs would look right in every
  // single-agent run. Here they differ, and the ledger has to name the one that ran.
  const two = assess(cwd, "alpha>beta", "1").record;
  assert.deepEqual(agents(two), ["alpha", "beta"]);
  assert.deepEqual(routeIds(two), ["alpha>beta"], "the route the operator declared is recorded beside the agents, not in place of them");

  // Two stages, two tasks, and the second one owes a handoff to the first.
  const tasks = two.routing_oracle.requirements;
  assert.deepEqual(tasks.map((entry) => entry.task_id), ["FAM-3/stage-1", "FAM-3/stage-2"]);
  assert.deepEqual(tasks[1].required_handoffs, ["FAM-3/stage-1->FAM-3/stage-2"]);
  assert.deepEqual(tasks[1].forbidden_same_owner_with, ["FAM-3/stage-1"]);
  const carried = two.routing_oracle.actual_route_events.find((event) => event.task_id === "FAM-3/stage-2");
  assert.deepEqual([...carried.handoff_ids], ["FAM-3/stage-1->FAM-3/stage-2"], "the ledger did not record the work arriving at the second stage");

  // And the same plan shape with a different agent doing the work says so.
  assert.deepEqual(agents(assess(cwd, "beta", "1").record), ["beta"]);
});

test("a stage that produced no required artifact is not an adequate route", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  // An agent that writes nothing at all. `assess` still completes; what changes is that the
  // artifact FAM-3 owes is absent, and AOS looked for it rather than reading a claim about it.
  const silent = join(cwd, "silent-agent.mjs");
  writeFileSync(silent, SILENT_AGENT);
  runCli(cwd, ["agent", "add", "alpha", "--command", process.execPath, "--arg", silent, "--adapter", "codex-cli.v1"]);

  const { record, result } = assess(cwd, "alpha", "1");
  const oracle = record.routing_oracle;
  assert.deepEqual(oracle.requirements[0].required_artifacts, ["artifact:plan.json"]);
  assert.equal(oracle.actual_route_events.every((event) => !event.artifact_ids.includes("artifact:plan.json")), true);
  assert.equal(oracle.constraint_failures.some((entry) => entry.constraint === "artifact" && entry.basis === "missing-evidence"), true,
    "a route that produced none of the artifacts it owed was adequate");
  assert.equal(subOf(result, "simplest-adequate-route"), false);
});

test("a handoff from a stage that produced nothing is not a handoff that happened", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  // Two stages, and the first one writes nothing at all. The requirement says stage 2 is owed a
  // handoff from stage 1; the ledger has to say whether anything arrived, and an empty hand is not
  // a delivery.
  const silent = join(cwd, "silent-agent.mjs");
  writeFileSync(silent, SILENT_AGENT);
  runCli(cwd, ["agent", "add", "alpha", "--command", process.execPath, "--arg", silent, "--adapter", "codex-cli.v1"]);
  addAdaptedAgent(cwd, "beta", "codex-cli.v1");

  const { record } = assess(cwd, "alpha>beta", "1");
  const oracle = record.routing_oracle;
  const second = oracle.requirements.find((entry) => entry.task_id === "FAM-3/stage-2");
  assert.deepEqual(second.required_handoffs, ["FAM-3/stage-1->FAM-3/stage-2"]);

  const arrived = oracle.actual_route_events.find((event) => event.task_id === "FAM-3/stage-2");
  assert.deepEqual([...arrived.handoff_ids], [], "an edge was recorded for a stage that handed nothing over");
  assert.equal(oracle.constraint_failures.some((entry) => entry.constraint === "handoff" && entry.basis === "missing-evidence"), true,
    "a handoff that carried nothing satisfied a requirement that asks for the work to have arrived");
});

test("the oracle record the run stores is the one the scored row names", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addAdaptedAgent(cwd, "alpha", "codex-cli.v1");

  const { record, result } = assess(cwd, "alpha", "2");
  assert.equal(
    m09Of(result).evidence_ids.includes(routeOracleEvidenceId(record.routing_oracle.route_oracle_digest)),
    true,
    "the scored row names a different oracle record from the one stored beside the run"
  );
  assert.match(record.routing_oracle.route_oracle_digest, /^sha256:[0-9a-f]{64}$/u);
  // The requirement came from the operator's plan, before the run. Nothing the agent wrote is in it.
  const serialized = JSON.stringify(record.routing_oracle.requirements);
  assert.equal(serialized.includes("plan.json"), true, "the artifact obligation is not on the requirement");
  assert.equal(spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).status, 0);
});

test("an operator who reroutes at a checkpoint supplies the proposal the oracle reads", async (t) => {
  // The whole path, end to end: the operator answers a checkpoint with a reroute, #560 mints an
  // attested `route.assign` through the store's authority gate, `bindOperatorDecisions` turns it
  // into a row, `operatorAssignment` lines it up with the stage its opportunity was about, and the
  // oracle records it as the proposed owner beside the one the ledger says actually ran.
  //
  // In process, through `runCli`, because the descriptor is what decides whether an answer can be
  // recorded as an operator's at all -- answers on a pipe are somebody relaying, which is #576's.
  // The same reasoning and the same helper as `operator-channel-authority.test.mjs`.
  const cwd = workspace(t);
  initBare(cwd);
  addAdaptedAgent(cwd, "solo", "codex-cli.v1");
  addAdaptedAgent(cwd, "spare", "codex-cli.v1");
  const plan = makePlan(cwd, { default: "solo" });

  const { runCli } = await import("../../lib/cli.mjs");
  const stdin = Readable.from(Array.from({ length: 12 }, () => ["", "y", "spare"]).flat().map((line) => `${line}\n`));
  stdin.isTTY = true;
  const sink = { write: () => true };
  const previous = process.env.FAKE_AGENT_PROFILE;
  process.env.FAKE_AGENT_PROFILE = "needs-instruction";
  try {
    await runCli(["assess", "--plan", plan, "--seed", "11", "--checkpoints", "--data-dir", join(cwd, ".aos")],
      { cwd, stdin, stdout: sink, stderr: sink });
  } finally {
    if (previous === undefined) delete process.env.FAKE_AGENT_PROFILE;
    else process.env.FAKE_AGENT_PROFILE = previous;
  }

  const record = newestRecord(cwd);
  const assigned = record.operator_process_binding.rows.filter((row) => row.decision_type === "route.assign");
  assert.equal(assigned.length > 0, true, "the reroute recorded no attested routing decision");
  assert.equal(assigned.every((row) => row.authority !== undefined && row.operator_event_id.startsWith("operator-")), true);

  // What the oracle did with it: the proposal is the operator's, and it is not the ledger's.
  const proposed = record.routing_oracle.assignment.filter((row) => row.proposed_owner_id !== null);
  assert.equal(proposed.length > 0, true, `no operator decision reached the oracle: ${JSON.stringify(record.routing_oracle.assignment)}`);
  for (const row of proposed) {
    assert.equal(row.proposed_owner_id, "spare", "the proposal is not the agent the operator rerouted to");
    // And it stayed a proposal. A reroute runs the stage twice, once per agent, so the ledger
    // reports two owners for one task and the oracle calls that `ambiguous` rather than picking
    // one -- least of all the one the operator asked for, which is the whole point of the
    // separation. Ownership is null; the operator's decision is beside it, not instead of it.
    assert.equal(row.provenance, "ambiguous", `a rerouted stage resolved to a single owner: ${JSON.stringify(row)}`);
    assert.equal(row.owner_id, null, "the proposal became the owner");
  }
  // The questions that need an owner therefore withhold, which is the correct answer for a stage
  // two agents ran and nothing says which one owned it.
  const capability = record.routing_oracle.observables.find((entry) => entry.observable_id === "capability-matches-task");
  assert.equal(capability.pass, null);
  // And the FAM-3 opportunity the decision was made at names the stage the requirement holds.
  const tasks = new Set(record.routing_oracle.requirements.map((entry) => entry.task_id));
  for (const row of proposed) assert.equal(tasks.has(row.task_id), true, `${row.task_id} is not a task of this run`);
});
