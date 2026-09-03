// #558, the ledger's authority over the declaration.
//
// A capability digest on an event is a claim about who produced the record it names, and it is
// checked against the record AOS holds rather than believed. A declared schedule is the artifact's
// account of its own order, and two invocations recorded in the air together outrank it. The
// oracle's own digest is recomputed rather than read off the record it sits on.

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
  const oracle = routeOracle({ requirements, capabilities, actual_route_events: [good, forged] });
  assert.deepEqual(oracle.actual_route_events.map((entry) => entry.invocation_id), ["invocation-1"]);
  assert.equal(oracle.rejected_route_events.length, 1);
  assert.match(oracle.rejected_route_events[0].reason, /not the digest of the record AOS holds/u);
});

test("an event naming an agent with no capability record at all is refused when it claims a digest", () => {
  const oracle = routeOracle({
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
  const one = routeOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event()] });
  const again = routeOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event()] });
  assert.equal(one.route_oracle_digest, again.route_oracle_digest);
  assert.equal(routeOracleDigest(one), one.route_oracle_digest, "the digest is not the digest of the record it sits on");
  const different = routeOracle({ requirements, capabilities: twoKnown(), actual_route_events: [event({ agent_id: "two" })] });
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
  const collision = (events) => routeOracle({ requirements, capabilities: twoKnown(), declared_schedule: schedule, actual_route_events: events })
    .observables.find((entry) => entry.observable_id === "collision-safe-parallelism");

  assert.equal(collision(apart).pass, true);
  assert.equal(collision(together).pass, false, "the declared order excused an overlap the ledger recorded");
});

test("a schedule that orders nothing and a ledger that timed nothing leaves the collision unobserved", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const oracle = routeOracle({ requirements, capabilities: twoKnown(), declared_schedule: [], actual_route_events: [] });
  const collision = oracle.observables.find((entry) => entry.observable_id === "collision-safe-parallelism");
  assert.equal(collision.pass, null);
  assert.match(collision.reason, /not observed/u);
});

test("a schedule edge naming a task the requirement does not hold orders nothing", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const smuggled = [{ task_id: "verification", after: ["a-task-nobody-asked-for"] }];
  const oracle = routeOracle({ requirements, capabilities: twoKnown(), declared_schedule: smuggled, actual_route_events: [] });
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
  const oracle = routeOracle({ requirements, capabilities: twoKnown(), declared_assignment: declared });
  const owners = new Map(oracle.assignment.map((entry) => [entry.task_id, entry.owner_id]));
  assert.equal(owners.get("verification"), null);
  assert.equal(owners.get("release"), null);
  assert.deepEqual(oracle.refused_owner_labels, ["release", "verification"]);
  assert.equal(JSON.stringify(oracle).includes("rm -rf"), false, "the artifact's text reached the oracle record");
  assert.equal(JSON.stringify(oracle).includes("/Users/alice"), false);
  // And an unassigned task withholds rather than passing.
  const capability = oracle.observables.find((entry) => entry.observable_id === "capability-matches-task");
  assert.equal(capability.pass, null);
  // An owner label that is an identifier is kept.
  const good = routeOracle({ requirements, capabilities: twoKnown(), declared_assignment: declared.slice(0, 3) });
  assert.equal(new Map(good.assignment.map((entry) => [entry.task_id, entry.owner_id])).get("contract"), "one");
  assert.deepEqual(good.refused_owner_labels, []);
});

test("the collision verdict says which authority decided it", () => {
  const requirements = requirementsFromWork(WORK).requirements;
  const schedule = WORK.tasks.map((task) => ({ task_id: task.id, after: task.depends_on }));
  const collision = (events, declaredSchedule) => routeOracle({
    requirements, capabilities: twoKnown(), declared_schedule: declaredSchedule, actual_route_events: events
  }).observables.find((entry) => entry.observable_id === "collision-safe-parallelism");

  // The artifact's own order, and nothing timed. A reader has to be able to see that a declaration
  // answered this, not an observation.
  assert.deepEqual(collision([], schedule).basis, ["declared-schedule"]);

  const timed = (taskId, agentId, from, to) => event({
    task_id: taskId, agent_id: agentId, invocation_id: `invocation-${taskId}`, purpose_id: taskId,
    started_at: from, completed_at: to, artifact_ids: [`artifact-${taskId}`]
  });
  const apart = [
    timed("implementation", "one", "2026-09-01T10:00:00Z", "2026-09-01T10:05:00Z"),
    timed("verification", "two", "2026-09-01T10:06:00Z", "2026-09-01T10:09:00Z")
  ];
  assert.deepEqual(collision(apart, []).basis, ["invocation-ledger"]);
  // The ledger answers it even where the schedule also would, so the stronger authority is the one
  // recorded.
  assert.deepEqual(collision(apart, schedule).basis, ["invocation-ledger"]);
});
