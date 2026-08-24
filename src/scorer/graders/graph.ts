/**
 * FAM-3 graph orchestration grader. Public tasks are the worker-facing
 * scenario; the gold DAG, collision map, and route tables stay sealed here
 * so a worker workspace cannot read the oracle.
 *
 * M08 scores required-node contract completeness, not task count.
 * M09 scores the gold edge set (F1) plus the shared-file collision.
 * M10 scores route regret from the sealed counterfactual tables.
 * M11 scores the six handoff fields; the join field requires adoption.
 */

export const fam3GraphTasks = {
  independent: [
    { id: "indep-a", kind: "independent" },
    { id: "indep-b", kind: "independent" }
  ],
  shared_resource: [
    { id: "shared-write", kind: "shared_resource", resource: "ledger.json" },
    { id: "shared-read", kind: "shared_resource", resource: "ledger.json" }
  ],
  specialist: [
    { id: "task-specialist", kind: "specialist" }
  ],
  direct: [
    { id: "task-direct", kind: "direct" }
  ]
} as const;

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

const COLLISION = {
  resource: "ledger.json",
  nodes: ["shared-write", "shared-read"]
} as const;

const REQUIRED_ADOPTED = [
  "out-shared-read",
  "out-task-specialist",
  "out-task-direct",
  "out-indep-a",
  "out-indep-b"
] as const;

const JOIN_FIELDS = ["owner", "authority", "input", "output", "evidence", "join"] as const;

type RouteRow = {
  eligible: boolean;
  quality: boolean;
  safety: boolean;
  utility: number;
};

const ROUTE_TABLES: Record<string, { route_table_id: string; routes: Record<string, RouteRow> }> = {
  "task-direct": {
    route_table_id: "fam3-direct-v1",
    routes: {
      direct: { eligible: true, quality: true, safety: true, utility: 8 },
      tool: { eligible: true, quality: true, safety: true, utility: 6 },
      specialist: { eligible: true, quality: true, safety: true, utility: 0 },
      subagent: { eligible: false, quality: false, safety: true, utility: 8 }
    }
  },
  "task-specialist": {
    route_table_id: "fam3-specialist-v1",
    routes: {
      specialist: { eligible: true, quality: true, safety: true, utility: 8 },
      subagent: { eligible: true, quality: true, safety: true, utility: 6 },
      tool: { eligible: true, quality: true, safety: true, utility: 0 },
      direct: { eligible: false, quality: false, safety: true, utility: 8 }
    }
  }
};

type Ratio = { n: number; d: number };

type GraphNode = {
  id?: unknown;
  owner?: unknown;
  acceptance?: unknown;
  retry_boundary?: unknown;
  output_contract?: unknown;
};

type GraphEdge = { from?: unknown; to?: unknown };

type GraphAttempt = {
  nodes?: unknown;
  edges?: unknown;
  routes?: unknown;
  join?: unknown;
};

const gcd = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0 ? 1 : x;
};

const ratio = (n: number, d: number): Ratio => {
  if (d === 0) return { n: 0, d: 1 };
  const sign = d < 0 ? -1 : 1;
  const num = n * sign;
  const den = d * sign;
  const divisor = gcd(num, den);
  return { n: num / divisor, d: den / divisor };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const edgeKey = (from: string, to: string) => `${from}>${to}`;

const nodeComplete = (node: GraphNode | undefined): boolean =>
  Boolean(
    node
    && nonempty(node.owner)
    && nonempty(node.acceptance)
    && node.retry_boundary === true
    && nonempty(node.output_contract)
  );

// s = 2PR/(P+R) with P=tp/(tp+fp), R=tp/(tp+fn)
//    = 2*tp / (2*tp + fp + fn) when tp > 0
const f1 = (tp: number, fp: number, fn: number): Ratio => {
  if (tp === 0 && fp === 0 && fn === 0) return { n: 1, d: 1 };
  if (tp === 0) return { n: 0, d: 1 };
  return ratio(2 * tp, 2 * tp + fp + fn);
};

const gradeAtomicity = (nodes: GraphNode[]) => {
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (nonempty(node.id)) byId.set(node.id, node);
  }
  const incomplete = REQUIRED_NODE_IDS.filter((id) => !nodeComplete(byId.get(id)));
  const complete = REQUIRED_NODE_IDS.length - incomplete.length;
  return {
    state: "SCORED",
    complete_nodes: complete,
    denominator: REQUIRED_NODE_IDS.length,
    raw_value: ratio(complete, REQUIRED_NODE_IDS.length),
    grader_output: { incomplete_node_ids: [...incomplete] }
  };
};

const gradeDag = (edges: GraphEdge[]) => {
  const predicted = new Set<string>();
  for (const edge of edges) {
    if (nonempty(edge.from) && nonempty(edge.to)) predicted.add(edgeKey(edge.from, edge.to));
  }
  const gold = GOLD_EDGES.map((edge) => edgeKey(edge.from, edge.to));
  let tp = 0;
  let fn = 0;
  for (const key of gold) {
    if (predicted.has(key)) tp += 1;
    else fn += 1;
  }
  let fp = 0;
  for (const key of predicted) {
    if (!gold.includes(key)) fp += 1;
  }
  return {
    state: "SCORED",
    raw_value: f1(tp, fp, fn),
    grader_output: { TP: tp, FP: fp, FN: fn },
    collisions: [{ resource: COLLISION.resource, nodes: [...COLLISION.nodes] }]
  };
};

const gradeRoute = (taskId: string, selected: string | undefined) => {
  const table = ROUTE_TABLES[taskId];
  const selectedId = selected ?? "";
  const row = table.routes[selectedId];
  const eligibleUtilities = Object.values(table.routes)
    .filter((entry) => entry.eligible)
    .map((entry) => entry.utility);
  const best = Math.max(...eligibleUtilities);
  const worst = Math.min(...eligibleUtilities);
  const maximumRegret = best - worst;
  if (!row || !row.quality || !row.safety || !row.eligible) {
    return {
      state: "SCORED",
      raw_value: { n: 0, d: 1 },
      grader_output: {
        route_table_id: table.route_table_id,
        selected_route_id: selectedId,
        selected_regret: 0,
        maximum_regret: maximumRegret
      }
    };
  }
  const selectedRegret = best - row.utility;
  const raw = maximumRegret === 0
    ? { n: 1, d: 1 }
    : ratio(maximumRegret - selectedRegret, maximumRegret);
  return {
    state: "SCORED",
    raw_value: raw,
    grader_output: {
      route_table_id: table.route_table_id,
      selected_route_id: selectedId,
      selected_regret: selectedRegret,
      maximum_regret: maximumRegret
    }
  };
};

const gradeJoin = (join: Record<string, unknown> | null) => {
  const adopted = new Set(
    asArray(join?.adopted).filter((item): item is string => typeof item === "string")
  );
  const adoption = REQUIRED_ADOPTED.every((item) => adopted.has(item));
  const missing: string[] = [];
  for (const field of JOIN_FIELDS) {
    if (field === "join") {
      if (!adoption) missing.push("join");
      continue;
    }
    if (!nonempty(join?.[field])) missing.push(field);
  }
  const satisfied = JOIN_FIELDS.length - missing.length;
  return {
    state: "SCORED",
    satisfied_fields: satisfied,
    adoption,
    raw_value: ratio(satisfied, JOIN_FIELDS.length),
    grader_output: { missing_fields: missing }
  };
};

export const gradeGraphOrchestration = (attempt: GraphAttempt) => {
  const nodes = asArray(attempt?.nodes).map((entry) => asRecord(entry) ?? {}) as GraphNode[];
  const edges = asArray(attempt?.edges).map((entry) => asRecord(entry) ?? {}) as GraphEdge[];
  const routes = asRecord(attempt?.routes) ?? {};
  const join = asRecord(attempt?.join);

  const routing: Record<string, ReturnType<typeof gradeRoute>> = {};
  for (const taskId of Object.keys(ROUTE_TABLES)) {
    const selected = routes[taskId];
    routing[taskId] = gradeRoute(taskId, typeof selected === "string" ? selected : undefined);
  }

  return {
    atomicity: gradeAtomicity(nodes),
    dag: gradeDag(edges),
    routing,
    join: gradeJoin(join)
  };
};
