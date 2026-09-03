// #558, the records. What AOS asks of a task before anyone routes it, what it is willing to say an
// agent can do, and what it will accept as an account of an invocation that happened.
//
// The requirement is derived from the work AOS seeds into the workspace, not from the artifact under
// measurement. That is the whole difference between a routing measurement and a plan agreeing with
// itself, so the first test here reads the file the suite actually writes.

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

test("the requirement the oracle uses is the work AOS seeded, not a copy written beside it", () => {
  // A second copy of the task graph in this module would pass its own test forever while the suite
  // moved. This reads the file the suite writes into a real workspace.
  const workspace = mkdtempSync(join(tmpdir(), "aos-routing-"));
  try {
    prepareScenario("FAM-3", workspace, "0");
    const seeded = JSON.parse(readFileSync(join(workspace, "work.json"), "utf8"));
    const fromSeed = requirementsFromWork(seeded);
    const fromFixture = requirementsFromWork(WORK);
    assert.deepEqual(fromSeed.problems, []);
    assert.deepEqual(
      fromSeed.requirements.map((entry) => entry.task_id),
      fromFixture.requirements.map((entry) => entry.task_id),
      "the seeded FAM-3 work no longer produces the requirement these tests are written against"
    );
    const verification = fromSeed.requirements.find((entry) => entry.task_id === "verification");
    assert.deepEqual(verification.forbidden_same_owner_with, ["implementation"]);
    assert.equal(verification.required_capabilities.includes("independent-verify"), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("independence is derived from the shape of the work, not from a task called verification", () => {
  const renamed = {
    tasks: [
      { id: "alpha", resource: "src", depends_on: [] },
      { id: "beta", resource: "src", depends_on: ["alpha"] }
    ]
  };
  const derived = requirementsFromWork(renamed);
  const beta = derived.requirements.find((entry) => entry.task_id === "beta");
  assert.deepEqual(beta.forbidden_same_owner_with, ["alpha"], "a task re-entering an ancestor's resource is the one that checks it");
  assert.equal(beta.required_capabilities.includes("independent-verify"), true);
  // And a task that shares no resource with an ancestor is not one.
  const alpha = derived.requirements.find((entry) => entry.task_id === "alpha");
  assert.deepEqual(alpha.forbidden_same_owner_with, []);
});

test("a work graph that refers to itself is refused rather than routed", () => {
  const cyclic = { tasks: [{ id: "a", resource: "r", depends_on: ["b"] }, { id: "b", resource: "r", depends_on: ["a"] }] };
  const derived = requirementsFromWork(cyclic);
  assert.deepEqual(derived.requirements, []);
  assert.equal(derived.problems.length > 0, true);
  assert.match(derived.problems.join(" "), /depends on itself/u);
});

test("a work graph naming a dependency that is not a task is refused", () => {
  const derived = requirementsFromWork({ tasks: [{ id: "a", resource: "r", depends_on: ["ghost"] }] });
  assert.deepEqual(derived.requirements, []);
  assert.match(derived.problems.join(" "), /ghost/u);
});

test("a prototype key in the work does not become a task through Object.prototype", () => {
  for (const key of corpus.classes["prototype-keys"].cases) {
    const derived = requirementsFromWork({ tasks: [{ id: key, resource: "r", depends_on: [] }, { id: "real", resource: "r2", depends_on: [key] }] });
    assert.deepEqual(derived.problems, [], `${key} was refused as a task id`);
    assert.deepEqual(derived.requirements.map((entry) => entry.task_id).sort(), [key, "real"].sort());
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test("a work graph larger than the declared bound is refused, not sampled", () => {
  const tasks = Array.from({ length: 25 }, (_, index) => ({ id: `t${index}`, resource: "r", depends_on: [] }));
  const derived = requirementsFromWork({ tasks });
  assert.deepEqual(derived.requirements, []);
  assert.match(derived.problems.join(" "), /at most 24/u);
});

// --- the records -----------------------------------------------------------------------------------

test("a requirement manifest is refused when a field is missing or outside the vocabulary", () => {
  const [valid] = requirementsFromWork({ tasks: [{ id: "solo", resource: "r", depends_on: [] }] }).requirements;
  assert.deepEqual(validateRoutingRequirement(valid), []);
  assert.equal(validateRoutingRequirement({ ...valid, schema_id: "aos-routing-requirement.v2" }).length, 1);
  assert.equal(validateRoutingRequirement({ ...valid, required_capabilities: ["teleport"] }).length, 1);
  assert.equal(validateRoutingRequirement({ ...valid, allowed_parallelism: "whenever" }).length, 1);
  assert.equal(validateRoutingRequirement({ ...valid, max_invocations: 0 }).length, 1);
  assert.equal(validateRoutingRequirement({ ...valid, route_cost_budget: 1.5 }).length, 1);
  assert.equal(validateRoutingRequirement({ ...valid, required_capabilities: Array.from({ length: 65 }, () => "code-read") }).length, 1);
  assert.equal(validateRoutingRequirement(null).length, 1);
});

test("the requirement schema is the versioned one and the manifest says so", () => {
  for (const entry of requirementsFromWork(WORK).requirements) {
    assert.equal(entry.schema_id, ROUTING_REQUIREMENT_SCHEMA);
    assert.deepEqual(entry.construct_opportunity_ids, ["C2.ROUTE.01"]);
  }
});

test("a capability record whose source is unknown may not also list what it can do", () => {
  const record = capabilityRecord({ agent_id: "one", capabilities: ["code-read"], source: "unknown" });
  assert.deepEqual(record.capabilities, [], "an unknown source keeps no abilities");
  assert.deepEqual(validateAgentCapability(record), []);
  // Hand-built, which is the shape a caller could pass in.
  const forged = { ...record, capabilities: ["code-read"] };
  assert.equal(validateAgentCapability(forged).some((problem) => /unknown may not list/u.test(problem)), true);
  assert.equal(validateAgentCapability({ ...record, capability_digest: "not-a-digest" }).length, 1);
  assert.equal(validateAgentCapability({ ...record, schema_id: "something-else" }).length, 1);
  assert.equal(record.schema_id, AGENT_CAPABILITY_SCHEMA);
});

test("an agent registered under an adapter AOS does not ship has no capability AOS may score", () => {
  const records = capabilityRecordsFor({
    real: { id: "real", adapter: "claude-code.v1" },
    generic: { id: "generic", adapter: "generic-command.v1" },
    none: { id: "none" },
    invented: { id: "invented", adapter: "definitely-not-an-adapter.v9" }
  });
  assert.equal(records.get("real").source, "aos-known");
  for (const id of ["generic", "none", "invented"]) {
    assert.equal(records.get(id).source, "unknown", `${id} was granted capabilities AOS cannot know`);
    assert.deepEqual(records.get(id).capabilities, []);
  }
  // Every adapter AOS knows a capability for is an adapter AOS actually ships.
  for (const adapterId of Object.keys(AOS_KNOWN_CAPABILITIES)) {
    assert.equal(Object.hasOwn(ADAPTERS, adapterId), true, `${adapterId} has capabilities and no adapter`);
  }
  assert.equal(Object.hasOwn(AOS_KNOWN_CAPABILITIES, "generic-command.v1"), false);
});

test("an actual route event with an impossible instant is refused", () => {
  assert.deepEqual(validateActualRouteEvent(event()), []);
  for (const instant of corpus.classes["impossible-instants"].cases) {
    assert.equal(validateActualRouteEvent(event({ started_at: instant, completed_at: instant })).length > 0, true, `${instant} was accepted as a time`);
  }
  for (const instant of corpus.classes["impossible-instants"].valid_cases) {
    assert.deepEqual(validateActualRouteEvent(event({ started_at: instant, completed_at: instant })), []);
  }
  assert.equal(
    validateActualRouteEvent(event({ started_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T09:00:00Z" })).length,
    1,
    "an invocation cannot finish before it starts"
  );
});
