import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadGraph = async () => {
  try {
    return await import("../../../packages/scorer/src/graders/graph.ts");
  } catch {
    return {};
  }
};

const ORACLE_MISSING =
  "atomicity/DAG/routing/join choices lack counterfactual and collision oracle.";

const ATOMICITY_MESSAGE = "graph oracle rejected: atomicity";
const FALSE_PARALLEL_MESSAGE = "graph oracle rejected: false-parallel";
const VALID_PARALLEL_MESSAGE = "graph oracle rejected: valid-parallel";
const DIRECT_BEST_MESSAGE = "graph oracle rejected: direct-best";
const SPECIALIST_BEST_MESSAGE = "graph oracle rejected: specialist-best";
const JOIN_INTEGRITY_MESSAGE = "graph oracle rejected: join-integrity";

const REQUIRED_NODE_IDS = [
  "indep-a",
  "indep-b",
  "shared-write",
  "shared-read",
  "task-specialist",
  "task-direct",
  "join"
] as const;

const GOLD_EDGES = [
  { from: "shared-write", to: "shared-read" },
  { from: "shared-read", to: "join" },
  { from: "task-specialist", to: "join" },
  { from: "task-direct", to: "join" },
  { from: "indep-a", to: "join" },
  { from: "indep-b", to: "join" }
] as const;

const JOIN_FIELDS = ["owner", "authority", "input", "output", "evidence", "join"] as const;
const REQUIRED_ADOPTED = [
  "out-shared-read",
  "out-task-specialist",
  "out-task-direct",
  "out-indep-a",
  "out-indep-b"
] as const;

const TASK_KINDS = ["direct", "independent", "shared_resource", "specialist"] as const;

type GraphNode = {
  id: string;
  owner?: string;
  acceptance?: string;
  retry_boundary?: boolean;
  output_contract?: string;
};

type GraphEdge = { from: string; to: string };

type GraphAttempt = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: Record<string, string>;
  join: {
    owner?: string;
    authority?: string;
    input?: string;
    output?: string;
    evidence?: string;
    join?: string;
    adopted?: string[];
  };
};

type Ratio = { n: number; d: number };

type AtomicityGrade = {
  state: string;
  complete_nodes: number;
  denominator: number;
  raw_value: Ratio;
  grader_output: { incomplete_node_ids: string[] };
};

type DagGrade = {
  state: string;
  raw_value: Ratio;
  grader_output: { TP: number; FP: number; FN: number };
  collisions: Array<{ resource: string; nodes: string[] }>;
};

type RouteGrade = {
  state: string;
  raw_value: Ratio;
  grader_output: {
    route_table_id: string;
    selected_route_id: string;
    selected_regret: number;
    maximum_regret: number;
  };
};

type JoinGrade = {
  state: string;
  satisfied_fields: number;
  adoption: boolean;
  raw_value: Ratio;
  grader_output: { missing_fields: string[] };
};

type GraphGrade = {
  atomicity: AtomicityGrade;
  dag: DagGrade;
  routing: Record<string, RouteGrade>;
  join: JoinGrade;
};

type Fam3Tasks = {
  independent: Array<{ id: string; kind: string }>;
  shared_resource: Array<{ id: string; kind: string; resource: string }>;
  specialist: Array<{ id: string; kind: string }>;
  direct: Array<{ id: string; kind: string }>;
};

type GraphModule = {
  gradeGraphOrchestration?: (attempt: GraphAttempt) => GraphGrade;
  fam3GraphTasks?: Fam3Tasks;
};

const completeNode = (id: string): GraphNode => ({
  id,
  owner: `owner-${id}`,
  acceptance: `ac-${id}`,
  retry_boundary: true,
  output_contract: `out-${id}`
});

const validAttempt = (): GraphAttempt => ({
  nodes: REQUIRED_NODE_IDS.map((id) => completeNode(id)),
  edges: GOLD_EDGES.map((edge) => ({ ...edge })),
  routes: {
    "task-direct": "direct",
    "task-specialist": "specialist"
  },
  join: {
    owner: "orchestrator",
    authority: "merge",
    input: "join-inputs",
    output: "join-output",
    evidence: "join-evidence",
    join: "adopt",
    adopted: [...REQUIRED_ADOPTED]
  }
});

const requireExports = async (message: string) => {
  const loaded = (await loadGraph()) as GraphModule;
  assert.equal(typeof loaded.gradeGraphOrchestration, "function", ORACLE_MISSING);
  assert.equal(typeof loaded.fam3GraphTasks, "object", ORACLE_MISSING);
  assert.ok(loaded.fam3GraphTasks, ORACLE_MISSING);
  return {
    gradeGraphOrchestration: loaded.gradeGraphOrchestration as (attempt: GraphAttempt) => GraphGrade,
    fam3GraphTasks: loaded.fam3GraphTasks as Fam3Tasks,
    message
  };
};

const assertTasks = (tasks: Fam3Tasks, message: string) => {
  assert.deepEqual(Object.keys(tasks).sort(), [...TASK_KINDS], message);
  assert.deepEqual(
    tasks.independent.map((task) => task.id).sort(),
    ["indep-a", "indep-b"],
    message
  );
  assert.deepEqual(
    tasks.shared_resource.map((task) => task.id).sort(),
    ["shared-read", "shared-write"],
    message
  );
  assert.deepEqual(tasks.specialist.map((task) => task.id), ["task-specialist"], message);
  assert.deepEqual(tasks.direct.map((task) => task.id), ["task-direct"], message);
  const shared = tasks.shared_resource;
  assert.ok(
    shared.every((task) => task.resource === "ledger.json"),
    message
  );
};

const sharedCollision = (grade: GraphGrade) =>
  (grade.dag.collisions ?? []).some(
    (entry) =>
      entry.resource === "ledger.json"
      && entry.nodes.includes("shared-write")
      && entry.nodes.includes("shared-read")
  );

const independentCollision = (grade: GraphGrade) =>
  (grade.dag.collisions ?? []).some(
    (entry) => entry.nodes.includes("indep-a") && entry.nodes.includes("indep-b")
  );

describe("fam3-graph", () => {
  test("atomicity", async () => {
    const { gradeGraphOrchestration, fam3GraphTasks } = await requireExports(ATOMICITY_MESSAGE);
    assertTasks(fam3GraphTasks, ATOMICITY_MESSAGE);

    const complete = gradeGraphOrchestration(validAttempt());
    assert.equal(complete.atomicity.state, "SCORED", ATOMICITY_MESSAGE);
    assert.equal(complete.atomicity.complete_nodes, 7, ATOMICITY_MESSAGE);
    assert.equal(complete.atomicity.denominator, 7, ATOMICITY_MESSAGE);
    assert.deepEqual(complete.atomicity.raw_value, { n: 1, d: 1 }, ATOMICITY_MESSAGE);
    assert.deepEqual(complete.atomicity.grader_output.incomplete_node_ids, [], ATOMICITY_MESSAGE);

    const incompleteJoin = validAttempt();
    delete incompleteJoin.nodes.find((node) => node.id === "join")?.retry_boundary;
    const partial = gradeGraphOrchestration(incompleteJoin);
    assert.equal(partial.atomicity.complete_nodes, 6, ATOMICITY_MESSAGE);
    assert.equal(partial.atomicity.denominator, 7, ATOMICITY_MESSAGE);
    assert.deepEqual(partial.atomicity.raw_value, { n: 6, d: 7 }, ATOMICITY_MESSAGE);
    assert.deepEqual(partial.atomicity.grader_output.incomplete_node_ids, ["join"], ATOMICITY_MESSAGE);

    const lumped = gradeGraphOrchestration({
      ...validAttempt(),
      nodes: [completeNode("lump")]
    });
    assert.equal(lumped.atomicity.complete_nodes, 0, ATOMICITY_MESSAGE);
    assert.equal(lumped.atomicity.denominator, 7, ATOMICITY_MESSAGE);
    assert.deepEqual(lumped.atomicity.raw_value, { n: 0, d: 1 }, ATOMICITY_MESSAGE);
    assert.deepEqual(
      lumped.atomicity.grader_output.incomplete_node_ids,
      [...REQUIRED_NODE_IDS],
      ATOMICITY_MESSAGE
    );

    const padded = gradeGraphOrchestration({
      ...validAttempt(),
      nodes: [
        ...validAttempt().nodes,
        completeNode("extra-1"),
        completeNode("extra-2"),
        completeNode("extra-3")
      ]
    });
    assert.deepEqual(padded.atomicity.raw_value, complete.atomicity.raw_value, ATOMICITY_MESSAGE);
    assert.equal(padded.atomicity.denominator, 7, ATOMICITY_MESSAGE);
    assert.deepEqual(padded.atomicity.grader_output.incomplete_node_ids, [], ATOMICITY_MESSAGE);
  });

  test("false-parallel", async () => {
    const { gradeGraphOrchestration, fam3GraphTasks } = await requireExports(FALSE_PARALLEL_MESSAGE);
    assertTasks(fam3GraphTasks, FALSE_PARALLEL_MESSAGE);

    const raced = validAttempt();
    raced.edges = raced.edges.filter(
      (edge) => !(edge.from === "shared-write" && edge.to === "shared-read")
    );
    const grade = gradeGraphOrchestration(raced);
    assert.equal(grade.dag.state, "SCORED", FALSE_PARALLEL_MESSAGE);
    assert.ok(sharedCollision(grade), FALSE_PARALLEL_MESSAGE);
    assert.deepEqual(grade.dag.grader_output, { TP: 5, FP: 0, FN: 1 }, FALSE_PARALLEL_MESSAGE);
    assert.deepEqual(grade.dag.raw_value, { n: 10, d: 11 }, FALSE_PARALLEL_MESSAGE);
  });

  test("valid-parallel", async () => {
    const { gradeGraphOrchestration, fam3GraphTasks } = await requireExports(VALID_PARALLEL_MESSAGE);
    assertTasks(fam3GraphTasks, VALID_PARALLEL_MESSAGE);

    const gold = gradeGraphOrchestration(validAttempt());
    assert.equal(gold.dag.state, "SCORED", VALID_PARALLEL_MESSAGE);
    assert.ok(sharedCollision(gold), VALID_PARALLEL_MESSAGE);
    assert.equal(independentCollision(gold), false, VALID_PARALLEL_MESSAGE);
    assert.deepEqual(gold.dag.grader_output, { TP: 6, FP: 0, FN: 0 }, VALID_PARALLEL_MESSAGE);
    assert.deepEqual(gold.dag.raw_value, { n: 1, d: 1 }, VALID_PARALLEL_MESSAGE);

    const overconstrained = validAttempt();
    overconstrained.edges.push({ from: "indep-a", to: "indep-b" });
    const extra = gradeGraphOrchestration(overconstrained);
    assert.deepEqual(extra.dag.grader_output, { TP: 6, FP: 1, FN: 0 }, VALID_PARALLEL_MESSAGE);
    assert.deepEqual(extra.dag.raw_value, { n: 12, d: 13 }, VALID_PARALLEL_MESSAGE);
  });

  test("direct-best", async () => {
    const { gradeGraphOrchestration, fam3GraphTasks } = await requireExports(DIRECT_BEST_MESSAGE);
    assertTasks(fam3GraphTasks, DIRECT_BEST_MESSAGE);

    const best = gradeGraphOrchestration(validAttempt());
    const direct = best.routing["task-direct"];
    assert.ok(direct, DIRECT_BEST_MESSAGE);
    assert.equal(direct.state, "SCORED", DIRECT_BEST_MESSAGE);
    assert.equal(direct.grader_output.selected_route_id, "direct", DIRECT_BEST_MESSAGE);
    assert.equal(direct.grader_output.selected_regret, 0, DIRECT_BEST_MESSAGE);
    assert.equal(direct.grader_output.maximum_regret, 8, DIRECT_BEST_MESSAGE);
    assert.deepEqual(direct.raw_value, { n: 1, d: 1 }, DIRECT_BEST_MESSAGE);

    const delegated = validAttempt();
    delegated.routes["task-direct"] = "subagent";
    const worse = gradeGraphOrchestration(delegated).routing["task-direct"];
    assert.equal(worse.state, "SCORED", DIRECT_BEST_MESSAGE);
    assert.equal(worse.grader_output.selected_route_id, "subagent", DIRECT_BEST_MESSAGE);
    assert.deepEqual(worse.raw_value, { n: 0, d: 1 }, DIRECT_BEST_MESSAGE);

    const padded = validAttempt();
    padded.routes["indep-a"] = "subagent";
    padded.routes["indep-b"] = "subagent";
    const stillBest = gradeGraphOrchestration(padded).routing["task-direct"];
    assert.deepEqual(stillBest.raw_value, { n: 1, d: 1 }, DIRECT_BEST_MESSAGE);
    assert.equal(stillBest.grader_output.selected_regret, 0, DIRECT_BEST_MESSAGE);
  });

  test("specialist-best", async () => {
    const { gradeGraphOrchestration, fam3GraphTasks } = await requireExports(SPECIALIST_BEST_MESSAGE);
    assertTasks(fam3GraphTasks, SPECIALIST_BEST_MESSAGE);

    const best = gradeGraphOrchestration(validAttempt());
    const specialist = best.routing["task-specialist"];
    assert.ok(specialist, SPECIALIST_BEST_MESSAGE);
    assert.equal(specialist.state, "SCORED", SPECIALIST_BEST_MESSAGE);
    assert.equal(specialist.grader_output.selected_route_id, "specialist", SPECIALIST_BEST_MESSAGE);
    assert.equal(specialist.grader_output.selected_regret, 0, SPECIALIST_BEST_MESSAGE);
    assert.equal(specialist.grader_output.maximum_regret, 8, SPECIALIST_BEST_MESSAGE);
    assert.deepEqual(specialist.raw_value, { n: 1, d: 1 }, SPECIALIST_BEST_MESSAGE);

    const forcedDirect = validAttempt();
    forcedDirect.routes["task-specialist"] = "direct";
    const worse = gradeGraphOrchestration(forcedDirect).routing["task-specialist"];
    assert.equal(worse.state, "SCORED", SPECIALIST_BEST_MESSAGE);
    assert.equal(worse.grader_output.selected_route_id, "direct", SPECIALIST_BEST_MESSAGE);
    assert.deepEqual(worse.raw_value, { n: 0, d: 1 }, SPECIALIST_BEST_MESSAGE);
  });

  test("join-integrity", async () => {
    const { gradeGraphOrchestration, fam3GraphTasks } = await requireExports(JOIN_INTEGRITY_MESSAGE);
    assertTasks(fam3GraphTasks, JOIN_INTEGRITY_MESSAGE);

    const closed = gradeGraphOrchestration(validAttempt());
    assert.equal(closed.join.state, "SCORED", JOIN_INTEGRITY_MESSAGE);
    assert.equal(closed.join.satisfied_fields, 6, JOIN_INTEGRITY_MESSAGE);
    assert.equal(closed.join.adoption, true, JOIN_INTEGRITY_MESSAGE);
    assert.deepEqual(closed.join.grader_output.missing_fields, [], JOIN_INTEGRITY_MESSAGE);
    assert.deepEqual(closed.join.raw_value, { n: 1, d: 1 }, JOIN_INTEGRITY_MESSAGE);
    assert.deepEqual([...JOIN_FIELDS], ["owner", "authority", "input", "output", "evidence", "join"]);

    const undeclared = validAttempt();
    delete undeclared.join.owner;
    const missingOwner = gradeGraphOrchestration(undeclared);
    assert.equal(missingOwner.join.satisfied_fields, 5, JOIN_INTEGRITY_MESSAGE);
    assert.deepEqual(missingOwner.join.grader_output.missing_fields, ["owner"], JOIN_INTEGRITY_MESSAGE);
    assert.deepEqual(missingOwner.join.raw_value, { n: 5, d: 6 }, JOIN_INTEGRITY_MESSAGE);

    const declaredOnly = validAttempt();
    declaredOnly.join.adopted = [];
    const noAdoption = gradeGraphOrchestration(declaredOnly);
    assert.equal(noAdoption.join.adoption, false, JOIN_INTEGRITY_MESSAGE);
    assert.equal(noAdoption.join.satisfied_fields, 5, JOIN_INTEGRITY_MESSAGE);
    assert.deepEqual(noAdoption.join.grader_output.missing_fields, ["join"], JOIN_INTEGRITY_MESSAGE);
    assert.deepEqual(noAdoption.join.raw_value, { n: 5, d: 6 }, JOIN_INTEGRITY_MESSAGE);
  });
});
