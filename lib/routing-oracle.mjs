import { Buffer } from "node:buffer";

import { canonicalJson } from "./core.mjs";
import { sha256Bytes } from "./digest.mjs";
import { isRealInstant } from "./execution-plan.mjs";
import { METRICS } from "./metrics.mjs";
import { ADAPTERS } from "./profile.mjs";

// Whether the work went to an owner that could do it, by the shortest route that still could.
//
// M09 used to answer that question with `new Set(n items).size <= n`, which is true of every set
// that has ever existed, and with `tasks.every(task => isText(task.route))` -- whether the agent
// wrote a word in a field. `lib/observe.mjs` carried the first one as a known defect with the
// reason it had not been replaced: "simplest adequate route needs to know what each agent is
// capable of and what the work required; the plan carries neither, and a threshold on the number of
// distinct routes would fail plans that are fine for having more agents."
//
// That reason was right about the plan and wrong about the run. The work AOS seeds carries the
// requirement -- the tasks, their resources, their dependencies -- and AOS knows which runtimes it
// ships an adapter for. So this module does what the comment said was missing: it builds the
// requirement from the seeded work rather than from the artifact under measurement, builds a
// capability record per owner from what AOS actually knows, solves the cheapest route that
// satisfies every constraint, and compares it with the route that was taken.
//
// Three things it deliberately is not.
//
//   It is not a general orchestrator. The search is over the controlled suite's handful of tasks
//   and refuses to answer at all above a declared bound, because a router that starts guessing when
//   the graph gets large is a router whose answers cannot be checked.
//
//   It is not a scorer of declarations. An owner AOS knows nothing about is NOT_OBSERVED, never a
//   pass; a capability an artifact claims for itself is provenance, not evidence. A plan can be
//   perfect and still earn no full credit, because two of the four questions are asked of the
//   invocation ledger.
//
//   It is not #583. It publishes the delegation reference that issue consumes -- the minimal
//   adequate route, and over- and under-delegation against it -- and produces no reliance episode
//   of its own.

/** The versioned records this module reads and writes. A field moving means a new schema id. */
export const ROUTING_REQUIREMENT_SCHEMA = "aos-routing-requirement.v1";
export const AGENT_CAPABILITY_SCHEMA = "aos-agent-capability.v1";
export const ACTUAL_ROUTE_EVENT_SCHEMA = "aos-actual-route-event.v1";
export const ROUTE_ORACLE_SCHEMA = "aos-route-oracle.v1";
export const DELEGATION_ORACLE_SCHEMA = "aos-delegation-oracle.v1";

/** Named in every observation this module decides, so a reader can see which authority answered. */
export const ROUTE_ORACLE_VERIFIER = "aos-route-oracle.v1";

/**
 * Where a capability record came from, and which of those may decide a capability question.
 *
 * `declared` is in the first list and not in the second on purpose. An owner's own account of what
 * it can do is worth recording -- it is why the record carries a source at all -- and it is not
 * evidence about itself. `detected` is declared here and never produced by this release; nothing in
 * AOS probes a runtime for its abilities yet, and a source that is never emitted is a seam rather
 * than a claim.
 */
export const CAPABILITY_SOURCES = Object.freeze(["aos-known", "detected", "declared", "unknown"]);
export const SCORABLE_CAPABILITY_SOURCES = Object.freeze(["aos-known", "detected"]);

/** How a task may sit beside the others that are ready at the same time. */
export const PARALLELISM = Object.freeze(["serial", "parallel", "conditional"]);

/**
 * The capability words this module will accept, so a typo is a refusal rather than a requirement
 * nothing can satisfy.
 */
export const CAPABILITY_VOCABULARY = Object.freeze([
  "artifact-write",
  "code-read",
  "code-write",
  "doc-write",
  "independent-verify",
  "release-join",
  "spec-write",
  "test-run"
]);

/**
 * What AOS knows a runtime it ships an adapter for can do.
 *
 * This is AOS's statement, not the runtime's and not the operator's: these are general coding
 * agents driven from a terminal inside a workspace, which is what every capability below describes.
 * An adapter absent from this table is `unknown` rather than assumed, which is what leaves
 * `generic-command.v1` -- a runtime nobody described -- unable to answer a capability question.
 */
export const AOS_KNOWN_CAPABILITIES = Object.freeze({
  "codex-cli.v1": Object.freeze([...CAPABILITY_VOCABULARY]),
  "claude-code.v1": Object.freeze([...CAPABILITY_VOCABULARY])
});

/**
 * The bounds. An input past one of these is refused, never truncated and never sampled.
 *
 * The search is exponential in the task count, so the state bound is the line between an oracle
 * that can be checked and a solver that takes as long as it takes. Crossing it is a stated refusal
 * -- `SEARCH_SPACE_EXCEEDED` -- because a minimum nobody finished computing is not a minimum, and
 * reporting the cheapest route found so far would be a threshold wearing an oracle's name.
 */
export const MAX_TASKS = 24;
export const MAX_LIST = 64;
export const MAX_SEARCH_STATES = 20000;

/** The six routing questions this oracle answers, in the order it publishes them. */
export const ROUTING_OBSERVABLE_IDS = Object.freeze([
  "capability-matches-task",
  "simplest-adequate-route",
  "no-redundant-invocation",
  "invocation-budget-respected",
  "verification-independence",
  "collision-safe-parallelism"
]);

/**
 * The four of them M09 carries, taken from `lib/metrics.mjs` rather than repeated here.
 *
 * The metric contract owns which questions M09 asks. Writing the four names again in this file
 * would be a second answer to that, and the two would drift the first time one of them moved.
 */
export const M09_OBSERVABLE_IDS = Object.freeze([...METRICS.M09.subchecks]);

/**
 * The instant shape, for reading one that `isRealInstant` has already said is real.
 *
 * The calendar check is not repeated here -- `lib/execution-plan.mjs` owns it and every instant this
 * module reads has been through it -- so this is the field split and nothing else.
 */
const INSTANT_TEXT = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/u;

const isText = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * What an owner may be called.
 *
 * The declared side of an assignment comes out of an artifact the agent wrote, so an owner label is
 * untrusted text that this module then puts into a record on the operator's disk. Anything that is
 * not the shape of an identifier is not an identifier: a label with a newline, a path or a
 * paragraph in it names nobody, so the task it was written against is unassigned and every question
 * that needs an owner answers nothing. Bounded as well as shaped, because an unbounded label is an
 * unbounded record.
 */
const OWNER_ID_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;

/** The two operator references this record may carry, spelled apart so neither can pass for the
 * other. Both shapes are the ones the product already mints: `lib/operator-events.mjs` for the
 * event and `lib/cli.mjs` for the opportunity a checkpoint offered. */
const OPERATOR_EVENT_ID_TEXT = /^operator-[0-9a-fA-F-]{36}$/u;
const OPPORTUNITY_ID_TEXT = /^opp-[A-Za-z0-9._:+-]{1,124}$/u;
const isOwnerId = (value) => typeof value === "string" && OWNER_ID_TEXT.test(value);

const boundedList = (value, allowed = null) =>
  Array.isArray(value) && value.length <= MAX_LIST &&
  value.every((entry) => isText(entry) && (allowed === null || allowed.includes(entry)));

const sortedUnique = (values) => [...new Set(values)].sort();

const byField = (field) => (left, right) => (left[field] < right[field] ? -1 : left[field] > right[field] ? 1 : 0);

/** A digest over the bytes of the canonical form, never over a re-decoded string of it. */
const digestOfValue = (value) => sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));

/**
 * The oracle's digest as an evidence id a published result carries unchanged.
 *
 * `lib/result-schema.mjs` digests any run of thirty-two or more alphanumerics on its way out,
 * because a long opaque token is what a leaked credential looks like and the gate cannot tell one
 * from the other. A bare `sha256:` digest is exactly that shape, so an evidence id written that way
 * is replaced in the stored result -- and `verify --run`, which recomputes from the stored
 * observations, then disagrees with the record it is checking.
 *
 * So the digest is grouped, the way `processEvidenceId` is readable for the same reason. Nothing is
 * truncated: the whole digest is there and `parseRouteOracleEvidenceId` reads it back, which is what
 * makes this a structure rather than a string somebody formats by hand.
 */
export const routeOracleEvidenceId = (digest) =>
  `route-oracle:${String(digest).replace(/^sha256:/u, "sha256-").replace(/([0-9a-f]{8})(?=[0-9a-f])/gu, "$1-")}`;

/** The same reference, read back. Null for any string that is not one -- not a guess at one. */
export function parseRouteOracleEvidenceId(id) {
  if (typeof id !== "string") return null;
  const match = /^route-oracle:sha256-((?:[0-9a-f]{8}-){7}[0-9a-f]{8})$/u.exec(id);
  return match === null ? null : `sha256:${match[1].replaceAll("-", "")}`;
}

// --- the three records --------------------------------------------------------------------------

/**
 * What is wrong with a requirement manifest, as a list.
 *
 * Every list is bounded and every capability word has to be one this module declares. An unbounded
 * `required_capabilities` is not a stricter requirement, it is a manifest that can make the search
 * below take arbitrarily long from the outside.
 */
export function validateRoutingRequirement(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["a requirement manifest must be an object"];
  if (manifest.schema_id !== ROUTING_REQUIREMENT_SCHEMA) problems.push(`schema_id must be ${ROUTING_REQUIREMENT_SCHEMA}`);
  if (!isText(manifest.task_id)) problems.push("task_id is required");
  if (!boundedList(manifest.required_capabilities, CAPABILITY_VOCABULARY)) {
    problems.push(`required_capabilities must be at most ${MAX_LIST} words from the declared vocabulary`);
  }
  if (!boundedList(manifest.forbidden_same_owner_with)) problems.push("forbidden_same_owner_with must be a bounded list of task ids");
  if (!boundedList(manifest.shared_resources)) problems.push("shared_resources must be a bounded list of resource names");
  if (!PARALLELISM.includes(manifest.allowed_parallelism)) problems.push(`allowed_parallelism must be one of ${PARALLELISM.join(", ")}`);
  if (!Array.isArray(manifest.required_artifacts) || manifest.required_artifacts.length > MAX_LIST) problems.push("required_artifacts must be a bounded array");
  // `required_handoffs` is the only place this record states an order, and each entry has to arrive
  // at the task that declares it. A manifest carrying an order twice -- once as edges and once as a
  // dependency list -- is a manifest that can disagree with itself, and the oracle would then have
  // two answers to which task comes first.
  if (!boundedList(manifest.required_handoffs)) problems.push("required_handoffs must be a bounded list of handoff edges");
  else {
    for (const edge of manifest.required_handoffs) {
      const parts = edge.split(HANDOFF_ARROW);
      if (parts.length !== 2 || parts[0].length === 0 || parts[1] !== manifest.task_id) {
        problems.push(`required_handoffs entry ${edge} is not an edge of the form <from>->${manifest.task_id}`);
      }
    }
  }
  if (!Number.isInteger(manifest.max_invocations) || manifest.max_invocations < 1) problems.push("max_invocations must be a positive integer");
  if (!Number.isInteger(manifest.route_cost_budget) || manifest.route_cost_budget < 1) problems.push("route_cost_budget must be a positive integer");
  if (!boundedList(manifest.construct_opportunity_ids)) problems.push("construct_opportunity_ids must be a bounded list");
  return problems;
}

/** The separator an edge is spelled with, and the reason a task id may not contain one. */
const HANDOFF_ARROW = "->";

/**
 * The tasks a requirement's work has to arrive from, read off its handoffs.
 *
 * Not a second field. `required_handoffs` already names every edge into this task, and a
 * `depends_on` beside it would be the same graph written twice -- which is one edit away from two
 * graphs that disagree and an oracle with two answers to which task comes first.
 */
export const dependenciesOf = (requirement) =>
  (Array.isArray(requirement?.required_handoffs) ? requirement.required_handoffs : [])
    .map((edge) => (typeof edge === "string" ? edge.split(HANDOFF_ARROW) : []))
    .filter((parts) => parts.length === 2 && parts[0].length > 0)
    .map((parts) => parts[0]);

/** What is wrong with a capability record. Whether its digest is genuine is not one of the things
 * this asks: that is `capabilityDigestOf`, which recomputes rather than reads. */
export function validateAgentCapability(record) {
  const problems = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["a capability record must be an object"];
  if (record.schema_id !== AGENT_CAPABILITY_SCHEMA) problems.push(`schema_id must be ${AGENT_CAPABILITY_SCHEMA}`);
  if (!isText(record.agent_id)) problems.push("agent_id is required");
  if (!Array.isArray(record.capabilities) || record.capabilities.length > MAX_LIST ||
      !record.capabilities.every((entry) => CAPABILITY_VOCABULARY.includes(entry))) {
    problems.push("capabilities must be a bounded list of declared capability words");
  }
  if (!CAPABILITY_SOURCES.includes(record.source)) problems.push(`source must be one of ${CAPABILITY_SOURCES.join(", ")}`);
  if (!Array.isArray(record.evidence_ids) || record.evidence_ids.length > MAX_LIST) problems.push("evidence_ids must be a bounded array");
  if (typeof record.capability_digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(record.capability_digest)) {
    problems.push("capability_digest must be a sha256 digest");
  }
  // A record whose source is unknown and which still lists abilities is claiming to know what it
  // says it does not. Refused, rather than read as a weaker claim.
  if (record.source === "unknown" && Array.isArray(record.capabilities) && record.capabilities.length > 0) {
    problems.push("a record whose source is unknown may not list capabilities");
  }
  return problems;
}

/** What is wrong with an actual route event. */
export function validateActualRouteEvent(event) {
  const problems = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) return ["an actual route event must be an object"];
  if (event.schema_id !== ACTUAL_ROUTE_EVENT_SCHEMA) problems.push(`schema_id must be ${ACTUAL_ROUTE_EVENT_SCHEMA}`);
  if (!isText(event.agent_id)) problems.push("agent_id is required");
  if (!isText(event.invocation_id)) problems.push("invocation_id is required");
  if (!isText(event.purpose_id)) problems.push("purpose_id is required");
  if (!isText(event.route_id)) problems.push("route_id is required");
  if (event.task_id !== null && !isText(event.task_id)) problems.push("task_id must be a task id or null");
  for (const field of ["started_at", "completed_at"]) {
    // Shape and calendar, or nothing at all. `Date.parse` accepts "0" and rolls 2026-02-30 into
    // March, so an event timestamped with a day that does not exist would otherwise order itself
    // against real ones and decide whether two tasks overlapped.
    if (event[field] !== null && !isRealInstant(event[field])) problems.push(`${field} must be a real ISO-8601 instant or null`);
  }
  if (!boundedList(event.artifact_ids) && !(Array.isArray(event.artifact_ids) && event.artifact_ids.length === 0)) problems.push("artifact_ids must be a bounded list of ids");
  if (!boundedList(event.handoff_ids) && !(Array.isArray(event.handoff_ids) && event.handoff_ids.length === 0)) problems.push("handoff_ids must be a bounded list of ids");
  if (event.capability_digest !== null && (typeof event.capability_digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(event.capability_digest))) {
    problems.push("capability_digest must be a sha256 digest or null");
  }
  // Two references, and the shapes keep them apart. An opportunity id is what AOS's checkpoint hands
  // back -- `opp-FAM-3-stage-1-1` -- and an operator event id is #560's, minted as `operator-<uuid>`.
  // They answer different questions ("which chance to decide was this" against "which decision was
  // recorded"), and a field named for one holding the other is an identifier's shape standing in for
  // its provenance. The validator refuses the swap rather than trusting the caller not to make it.
  if (event.operator_decision_event_id !== null &&
      (typeof event.operator_decision_event_id !== "string" || !OPERATOR_EVENT_ID_TEXT.test(event.operator_decision_event_id))) {
    problems.push("operator_decision_event_id must be an operator event id (operator-<uuid>) or null");
  }
  if (event.operator_opportunity_id !== null &&
      (typeof event.operator_opportunity_id !== "string" || !OPPORTUNITY_ID_TEXT.test(event.operator_opportunity_id))) {
    problems.push("operator_opportunity_id must be an opportunity id (opp-...) or null");
  }
  const startedMillis = instantMillis(event.started_at);
  const completedMillis = instantMillis(event.completed_at);
  if (startedMillis !== null && completedMillis !== null && completedMillis < startedMillis) {
    problems.push("completed_at is before started_at");
  }
  return problems;
}

/**
 * A capability record, with its digest computed here rather than accepted.
 *
 * The digest covers the identity, the abilities and the source together. Two records naming the
 * same agent with the same list but a different provenance are different records, because "AOS
 * knows this" and "the artifact said so" are different facts about the same list.
 */
export function capabilityRecord({ agent_id: agentId, capabilities = [], source = "unknown", evidence_ids: evidenceIds = [] }) {
  const known = source === "unknown" ? [] : sortedUnique(capabilities.filter((entry) => CAPABILITY_VOCABULARY.includes(entry)));
  const ids = [...evidenceIds].sort();
  const body = { agent_id: agentId, capabilities: known, source, evidence_ids: ids };
  return Object.freeze({
    schema_id: AGENT_CAPABILITY_SCHEMA,
    agent_id: agentId,
    capabilities: Object.freeze(known),
    source,
    evidence_ids: Object.freeze(ids),
    capability_digest: digestOfValue({ schema_id: AGENT_CAPABILITY_SCHEMA, ...body })
  });
}

/**
 * The digest a record should carry, recomputed from its own fields.
 *
 * Never `record.capability_digest`. A digest-shaped string on a record is a claim about who made
 * the record, and the whole reason an actual route event carries one is so that this module can
 * disagree with it.
 */
export function capabilityDigestOf(record) {
  return digestOfValue({
    schema_id: AGENT_CAPABILITY_SCHEMA,
    agent_id: record?.agent_id ?? null,
    capabilities: record?.source === "unknown" ? [] : sortedUnique((record?.capabilities ?? []).filter((entry) => CAPABILITY_VOCABULARY.includes(entry))),
    source: record?.source ?? "unknown",
    evidence_ids: [...(record?.evidence_ids ?? [])].sort()
  });
}

/**
 * One capability record per registered agent, from what AOS knows about the adapter it declared.
 *
 * The operator's registration says which adapter an agent is; the table above says what AOS knows
 * that adapter can do. An adapter AOS does not ship, or none at all, is `unknown` -- and an unknown
 * owner cannot answer a capability question, which is what the source field is for.
 */
export function capabilityRecordsFor(agents = {}) {
  const records = new Map();
  for (const [agentId, agent] of Object.entries(agents ?? {})) {
    const adapterId = typeof agent?.adapter === "string" && Object.hasOwn(ADAPTERS, agent.adapter) ? agent.adapter : null;
    const known = adapterId !== null && Object.hasOwn(AOS_KNOWN_CAPABILITIES, adapterId) ? AOS_KNOWN_CAPABILITIES[adapterId] : null;
    records.set(agentId, known === null
      ? capabilityRecord({ agent_id: agentId, source: "unknown", evidence_ids: adapterId === null ? [] : [`adapter:${adapterId}`] })
      : capabilityRecord({ agent_id: agentId, capabilities: known, source: "aos-known", evidence_ids: [`adapter:${adapterId}`] }));
  }
  return records;
}

// --- the requirement, built from the work rather than from the answer ----------------------------

/**
 * The requirement manifests for a seeded work graph.
 *
 * Read from what AOS wrote into the workspace before the agent ran, never from the artifact the
 * agent wrote afterwards. A requirement recovered from the answer is not a requirement, and every
 * subcheck below would then be asking the plan whether it agreed with itself.
 *
 * The capability words come from the structure, not from the task's name. A task whose resource is
 * one that an ancestor of it already owns is re-entering that ancestor's work, which is what
 * verification is; matching on the id "verification" would have graded the suite's spelling instead
 * of its shape.
 */
export function requirementsFromWork(work) {
  if (!work || typeof work !== "object" || Array.isArray(work)) return { requirements: [], problems: ["work must be an object"] };
  const tasks = Array.isArray(work.tasks) ? work.tasks : null;
  if (tasks === null) return { requirements: [], problems: ["work.tasks must be an array"] };
  if (tasks.length === 0) return { requirements: [], problems: ["work.tasks is empty"] };
  if (tasks.length > MAX_TASKS) return { requirements: [], problems: [`work.tasks holds ${tasks.length} tasks and this oracle answers for at most ${MAX_TASKS}`] };

  const problems = [];
  // `Map`, not an object literal. The ids come out of a JSON file, and `__proto__` as a key writes
  // through a plain object into `Object.prototype` and then vanishes from `Object.keys`.
  const byId = new Map();
  for (const task of tasks) {
    if (!isText(task?.id)) { problems.push("every task needs an id"); continue; }
    // An id holding the edge separator would make `a->b` ambiguous, and the handoff list is where
    // this record keeps its order.
    if (task.id.includes(HANDOFF_ARROW)) { problems.push(`${task.id} cannot be a task id: ${HANDOFF_ARROW} is how a handoff is spelled`); continue; }
    if (byId.has(task.id)) { problems.push(`${task.id} is declared more than once`); continue; }
    if (!Array.isArray(task.depends_on) || task.depends_on.length > MAX_LIST) { problems.push(`${task.id}.depends_on must be a bounded array`); continue; }
    byId.set(task.id, { id: task.id, resource: isText(task.resource) ? task.resource : null, depends_on: task.depends_on.filter(isText) });
  }
  for (const task of byId.values()) {
    for (const dependency of task.depends_on) {
      if (!byId.has(dependency)) problems.push(`${task.id} depends on ${dependency}, which is not a task in this work`);
    }
  }
  if (problems.length > 0) return { requirements: [], problems };

  const ancestors = transitiveAncestors(byId);
  for (const [id, above] of ancestors) {
    if (above.has(id)) problems.push(`${id} depends on itself through the graph, so this work has no order to route`);
  }
  if (problems.length > 0) return { requirements: [], problems };

  const ordered = [...byId.keys()].sort();
  const requirements = ordered.map((id) => {
    const task = byId.get(id);
    const mine = ancestors.get(id);
    const sharesWith = ordered.filter((other) => other !== id && task.resource !== null && byId.get(other).resource === task.resource);
    // An ancestor holding this task's resource is work this task re-enters, so this task checks it.
    const reenters = sharesWith.filter((other) => mine.has(other));
    // A task sharing a resource with something neither above nor below it in the graph can only be
    // run beside it, which is the collision the family brief names.
    const unordered = sharesWith.filter((other) => !mine.has(other) && !ancestors.get(other).has(id));
    const capabilities = new Set(["code-read", "artifact-write"]);
    if (task.depends_on.length >= 2) capabilities.add("release-join");
    if (reenters.length > 0) { capabilities.add("test-run"); capabilities.add("independent-verify"); }
    else if (task.resource === "docs") capabilities.add("doc-write");
    else if (task.resource === "spec") capabilities.add("spec-write");
    else if (task.depends_on.length < 2) capabilities.add("code-write");
    return Object.freeze({
      schema_id: ROUTING_REQUIREMENT_SCHEMA,
      task_id: id,
      required_capabilities: Object.freeze(sortedUnique([...capabilities])),
      // Whoever did the work does not get to be the one who checks it.
      forbidden_same_owner_with: Object.freeze(reenters.slice().sort()),
      shared_resources: Object.freeze(task.resource === null ? [] : [task.resource]),
      allowed_parallelism: unordered.length > 0 ? "conditional" : task.depends_on.length > 0 ? "serial" : "parallel",
      required_artifacts: Object.freeze([]),
      // Every dependency edge is a handoff: the thing it depends on has to reach it.
      required_handoffs: Object.freeze(task.depends_on.slice().sort().map((from) => `${from}${HANDOFF_ARROW}${id}`)),
      max_invocations: 1,
      // One invocation, plus the handoffs this task's own dependencies oblige somebody to carry.
      // A tighter number would make the cheapest adequate route unaffordable and report every run
      // as over budget, which is a constant, not a measurement.
      route_cost_budget: 1 + task.depends_on.length,
      construct_opportunity_ids: Object.freeze(["C2.ROUTE.01"])
    });
  });
  return { requirements: Object.freeze(requirements), problems: [] };
}

/**
 * The order the artifact declared, as a graph this module can close over.
 *
 * Edges naming a task the requirement does not hold are dropped rather than invented: a schedule
 * about work nobody asked for orders nothing, and keeping it would let a plan add a task id and
 * declare two real tasks ordered through it.
 */
function scheduleGraph(requirements, declaredSchedule) {
  const ids = new Set(requirements.map((requirement) => requirement.task_id));
  const graph = new Map([...ids].map((id) => [id, { id, depends_on: [] }]));
  for (const entry of Array.isArray(declaredSchedule) ? declaredSchedule : []) {
    if (!isText(entry?.task_id) || !ids.has(entry.task_id)) continue;
    const after = (Array.isArray(entry.after) ? entry.after : []).filter((id) => isText(id) && ids.has(id) && id !== entry.task_id);
    graph.get(entry.task_id).depends_on = [...new Set([...graph.get(entry.task_id).depends_on, ...after])].slice(0, MAX_LIST);
  }
  return graph;
}

/** Every task each task transitively depends on. A cycle shows up as a task among its own
 * ancestors, which the caller reports; it is not resolved here. */
function transitiveAncestors(byId) {
  const ancestors = new Map([...byId.keys()].map((id) => [id, new Set()]));
  // Bounded by the task count, which `MAX_TASKS` bounds. A fixpoint loop with no bound is where a
  // cyclic graph turns a validator into a hang.
  for (let round = 0; round < byId.size; round += 1) {
    let grew = false;
    for (const task of byId.values()) {
      const mine = ancestors.get(task.id);
      for (const dependency of task.depends_on) {
        if (!mine.has(dependency)) { mine.add(dependency); grew = true; }
        for (const above of ancestors.get(dependency) ?? []) {
          if (!mine.has(above)) { mine.add(above); grew = true; }
        }
      }
    }
    if (!grew) break;
  }
  return ancestors;
}

// --- the oracle -----------------------------------------------------------------------------------

/**
 * What a route costs, in the one unit this contract defines.
 *
 * One per invocation, plus one for every dependency edge whose two ends have different owners --
 * because that edge is a handoff somebody has to carry, and a route that splits work across more
 * owners buys the split with handoffs. Both halves are needed: counting only invocations makes
 * every assignment cost the same, and counting only handoffs makes doing everything alone free.
 *
 * Agent count is deliberately not a term. "Fewer agents" is not a virtue this instrument pays for
 * -- the issue prohibits it by name -- and it falls out of the handoff term anyway, where it is a
 * consequence of the work rather than a target.
 */
export function taskCost(requirement, ownerOf, invocations = 1) {
  const owner = ownerOf.get(requirement.task_id);
  return invocations + dependenciesOf(requirement).filter((dependency) => ownerOf.get(dependency) !== owner).length;
}

/**
 * The whole route's cost.
 *
 * `invocationsOf` says how many times each task was actually invoked; the default of one per task
 * is what an assignment proposes before anybody runs it, which is what the oracle's own candidates
 * cost.
 */
export function routeCost(requirements, ownerOf, invocationsOf = null) {
  let cost = 0;
  for (const requirement of requirements) {
    cost += taskCost(requirement, ownerOf, invocationsOf === null ? 1 : (invocationsOf.get(requirement.task_id) ?? 0));
  }
  return cost;
}

/**
 * Why an assignment is not adequate, or an empty list.
 *
 * Adequacy is every constraint at once. A route that is cheaper because it skipped one of them is
 * not a cheaper route to the same place.
 */
export function routeConstraintFailures(requirements, ownerOf, capabilities) {
  const failures = [];
  for (const requirement of requirements) {
    const owner = ownerOf.get(requirement.task_id);
    if (owner === undefined) { failures.push({ constraint: "assignment", basis: "unassigned", task_id: requirement.task_id, owner: null, detail: `${requirement.task_id} has no owner` }); continue; }
    const record = capabilities.get(owner) ?? null;
    if (record === null || !SCORABLE_CAPABILITY_SOURCES.includes(record.source)) {
      // Not knowing and knowing it cannot are two different failures, and only the second is the
      // operator's. The basis travels with the entry so a consumer cannot read one as the other:
      // an unknown owner withholds the minimality verdict, a shortfall fails it.
      failures.push({ constraint: "capability", basis: "unknown-owner", task_id: requirement.task_id, owner, detail: `${owner} has no capability record AOS may score` });
      continue;
    }
    const missing = requirement.required_capabilities.filter((entry) => !record.capabilities.includes(entry));
    if (missing.length > 0) failures.push({ constraint: "capability", basis: "missing-capability", task_id: requirement.task_id, owner, detail: `${owner} lacks ${missing.join(", ")}` });
  }
  for (const requirement of requirements) {
    for (const peer of requirement.forbidden_same_owner_with) {
      const owner = ownerOf.get(requirement.task_id);
      if (owner !== undefined && ownerOf.get(peer) === owner) {
        failures.push({ constraint: "independence", basis: "same-owner", task_id: requirement.task_id, owner, detail: `${requirement.task_id} and ${peer} share owner ${owner}` });
      }
    }
  }
  // The manifest's own ceiling on what a task's place in the route may cost. A route the requirement
  // cannot afford is not an adequate route however capable its owners are, and this is the
  // constraint that lets a caller state a budget the oracle has to solve inside rather than one it
  // reports afterwards.
  for (const requirement of requirements) {
    if (!ownerOf.has(requirement.task_id)) continue;
    const cost = taskCost(requirement, ownerOf);
    if (cost > requirement.route_cost_budget) {
      failures.push({ constraint: "budget", basis: "over-cost", task_id: requirement.task_id, owner: ownerOf.get(requirement.task_id), detail: `${requirement.task_id} costs ${cost} against a budget of ${requirement.route_cost_budget}` });
    }
  }
  return failures;
}

/**
 * The cheapest adequate route, or the stated reason there is none.
 *
 * Exhaustive over the owner set, which is why the state bound exists and why crossing it is a
 * refusal rather than a longer wait. Among equal minima the assignment whose canonical form sorts
 * first is the answer, so the same requirement over the same owners always produces the same route
 * and the same digest -- an oracle whose answer depended on iteration order would make every
 * comparison against it meaningless.
 */
export function minimumRoute(requirements, capabilities, { owners = null } = {}) {
  const list = [...requirements];
  const candidates = owners === null
    ? [...capabilities.keys()].filter((id) => SCORABLE_CAPABILITY_SOURCES.includes(capabilities.get(id)?.source)).sort()
    : [...owners].sort();
  if (list.length === 0) return Object.freeze({ status: "NO_REQUIREMENT", minimum_cost: null, assignment: null, states_explored: 0 });
  if (candidates.length === 0) return Object.freeze({ status: "NO_SCORABLE_OWNER", minimum_cost: null, assignment: null, states_explored: 0 });
  // Computed before the loop, not discovered inside it. A bound checked while enumerating has
  // already paid for the enumeration it was there to prevent.
  const states = candidates.length ** list.length;
  if (!Number.isFinite(states) || states > MAX_SEARCH_STATES) {
    return Object.freeze({ status: "SEARCH_SPACE_EXCEEDED", minimum_cost: null, assignment: null, states_explored: 0 });
  }

  let best = null;
  let bestKey = null;
  let explored = 0;
  for (let index = 0; index < states; index += 1) {
    explored += 1;
    const ownerOf = new Map();
    let remainder = index;
    for (const requirement of list) {
      ownerOf.set(requirement.task_id, candidates[remainder % candidates.length]);
      remainder = Math.floor(remainder / candidates.length);
    }
    if (routeConstraintFailures(list, ownerOf, capabilities).length > 0) continue;
    const cost = routeCost(list, ownerOf);
    const key = canonicalAssignmentKey(ownerOf);
    if (best === null || cost < best.cost || (cost === best.cost && key < bestKey)) {
      best = { cost, ownerOf };
      bestKey = key;
    }
  }
  if (best === null) return Object.freeze({ status: "INFEASIBLE", minimum_cost: null, assignment: null, states_explored: explored });
  return Object.freeze({
    status: "SOLVED",
    minimum_cost: best.cost,
    assignment: Object.freeze([...best.ownerOf.entries()]
      .map(([task_id, owner_id]) => Object.freeze({ task_id, owner_id }))
      .sort(byField("task_id"))),
    states_explored: explored
  });
}

const canonicalAssignmentKey = (ownerOf) =>
  [...ownerOf.entries()].map(([task, owner]) => `${task}=${owner}`).sort().join(" ");

// --- what actually happened -----------------------------------------------------------------------

/**
 * The events that may be read, and the ones that may not, with the reason each was refused.
 *
 * The capability digest on an event is checked against the record AOS holds rather than believed. A
 * digest-shaped field is a claim about who produced the record it names; an event that names a
 * capability set AOS does not hold describes some other run, and reading it anyway would let the
 * shape of a digest stand in for its provenance.
 */
export function admitRouteEvents(events, capabilities) {
  const records = capabilities instanceof Map ? capabilities : new Map(Object.entries(capabilities ?? {}));
  const admitted = [];
  const rejected = [];
  for (const event of Array.isArray(events) ? events : []) {
    const problems = validateActualRouteEvent(event);
    if (problems.length > 0) { rejected.push({ invocation_id: isText(event?.invocation_id) ? event.invocation_id : null, reason: problems.join("; ") }); continue; }
    const record = records.get(event.agent_id) ?? null;
    if (event.capability_digest !== null) {
      if (record === null) {
        rejected.push({ invocation_id: event.invocation_id, reason: `this event carries a capability digest for ${event.agent_id}, which has no capability record in this run` });
        continue;
      }
      if (capabilityDigestOf(record) !== event.capability_digest) {
        rejected.push({ invocation_id: event.invocation_id, reason: `the capability digest on this event is not the digest of the record AOS holds for ${event.agent_id}` });
        continue;
      }
    }
    admitted.push(Object.freeze({
      schema_id: event.schema_id,
      task_id: event.task_id,
      agent_id: event.agent_id,
      route_id: event.route_id,
      invocation_id: event.invocation_id,
      purpose_id: event.purpose_id,
      started_at: event.started_at,
      completed_at: event.completed_at,
      artifact_ids: Object.freeze([...event.artifact_ids]),
      handoff_ids: Object.freeze([...event.handoff_ids]),
      capability_digest: event.capability_digest,
      operator_decision_event_id: event.operator_decision_event_id,
      operator_opportunity_id: event.operator_opportunity_id
    }));
  }
  return { admitted: Object.freeze(admitted), rejected: Object.freeze(rejected) };
}

/**
 * An instant as a number, computed rather than parsed.
 *
 * `Date.parse` is not a reader here for the same reason it is not a validator: it accepts "0", it
 * rolls 2026-02-30 into March, and it maps years 0-99 into the 1900s. The fields are already known
 * to name a real day -- `isRealInstant` said so before an event was admitted -- so what is left is
 * arithmetic, and doing it here means an instant this module orders is the instant it validated.
 *
 * Returns null for anything that is not the shape, so a caller cannot get a number out of a string
 * that never was one.
 */
export function instantMillis(value) {
  const match = INSTANT_TEXT.exec(value ?? "");
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, fraction, sign, offsetHour, offsetMinute] = match;
  const [y, mo, d] = [year, month, day].map(Number);
  // Days from the civil date, with no library and no epoch table: shift the year so that March is
  // month one, which makes the leap day the last day of the year and the century rules exact.
  const shifted = y - (mo <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const days = era * 146097 + dayOfEra - 719468;
  const millis = Number((fraction ?? "").padEnd(3, "0").slice(0, 3));
  const offset = sign === undefined ? 0 : (sign === "-" ? -1 : 1) * (Number(offsetHour) * 60 + Number(offsetMinute)) * 60000;
  return days * 86400000 + Number(hour) * 3600000 + Number(minute) * 60000 + Number(second) * 1000 + millis - offset;
}

/** Whether two invocations were in the air at the same time, or `null` when nobody timed them. */
function overlaps(left, right) {
  const [leftStart, leftEnd, rightStart, rightEnd] =
    [left.started_at, left.completed_at, right.started_at, right.completed_at].map((value) => instantMillis(value));
  if ([leftStart, leftEnd, rightStart, rightEnd].some((value) => value === null)) return null;
  return leftStart < rightEnd && rightStart < leftEnd;
}

// --- the six observables ---------------------------------------------------------------------------

const verdict = (pass, reason, extra = {}) => Object.freeze({ pass, reason, ...extra });

/**
 * The whole record: what was required, who could do it, what ran, the cheapest route that would
 * have done, and the six answers that follow.
 *
 * `declared_assignment` is the artifact's proposal and `actual_route_events` is the ledger. Where
 * both speak about a task the ledger wins, because the prohibited implementation this replaces is
 * exactly the one that preferred the declaration. Where only the artifact speaks, the assignment is
 * carried with its provenance recorded, and every question that needs to know what an owner can do
 * refuses to answer about an owner AOS knows nothing about.
 */
export function routeOracle({
  requirements = [],
  capabilities = new Map(),
  declared_assignment: declaredAssignment = [],
  declared_schedule: declaredSchedule = [],
  actual_route_events: actualRouteEvents = [],
  requirement_problems: requirementProblems = []
} = {}) {
  const caps = capabilities instanceof Map ? capabilities : new Map(Object.entries(capabilities ?? {}));
  const { admitted, rejected } = admitRouteEvents(actualRouteEvents, caps);
  if (!Array.isArray(requirements)) throw new Error("AOS_INVALID_ROUTING_REQUIREMENTS routeOracle takes the array requirementsFromWork produces");
  const invalid = requirements.flatMap((requirement) =>
    validateRoutingRequirement(requirement).map((problem) => `${isText(requirement?.task_id) ? requirement.task_id : "an unnamed task"}: ${problem}`));
  const contractProblems = [...requirementProblems, ...invalid];

  // Actual first, declaration second, and the provenance of each task's owner recorded either way.
  const declaredOf = new Map();
  const refusedOwners = [];
  for (const entry of (Array.isArray(declaredAssignment) ? declaredAssignment : []).slice(0, MAX_TASKS)) {
    if (!isText(entry?.task_id) || declaredOf.has(entry.task_id)) continue;
    if (!isOwnerId(entry?.owner_id)) { refusedOwners.push(entry.task_id); continue; }
    declaredOf.set(entry.task_id, entry.owner_id);
  }
  // One task, one owner, or none. Two invocations of a task by two different agents do not say who
  // owned it -- the first is the one it was assigned to and the last is the one whose work stands,
  // and picking either would be this module deciding a question the ledger did not answer. So it is
  // recorded as ambiguous and every question that needs an owner withholds, which is the missing
  // policy this issue states. A task invoked twice by the same agent is not ambiguous.
  const agentsPerTask = new Map();
  for (const event of admitted) {
    if (event.task_id === null) continue;
    agentsPerTask.set(event.task_id, (agentsPerTask.get(event.task_id) ?? new Set()).add(event.agent_id));
  }
  const actualOf = new Map();
  const ambiguous = new Set();
  for (const [taskId, agents] of agentsPerTask) {
    if (agents.size === 1) actualOf.set(taskId, [...agents][0]);
    else ambiguous.add(taskId);
  }
  const ownerOf = new Map();
  const provenance = new Map();
  for (const requirement of requirements) {
    if (!isText(requirement?.task_id)) continue;
    if (actualOf.has(requirement.task_id)) {
      ownerOf.set(requirement.task_id, actualOf.get(requirement.task_id));
      provenance.set(requirement.task_id, "actual-route-event");
    } else if (declaredOf.has(requirement.task_id)) {
      ownerOf.set(requirement.task_id, declaredOf.get(requirement.task_id));
      provenance.set(requirement.task_id, "declared");
    } else {
      provenance.set(requirement.task_id, ambiguous.has(requirement.task_id) ? "ambiguous" : "unassigned");
    }
  }

  // Every owner this route used gets a record, and an owner AOS has never heard of gets one that
  // says so. Leaving it absent would make "unknown" indistinguishable from "not looked up".
  const ownerCapabilities = new Map(caps);
  for (const owner of ownerOf.values()) {
    if (!ownerCapabilities.has(owner)) ownerCapabilities.set(owner, capabilityRecord({ agent_id: owner, source: "unknown" }));
  }
  const assigned = requirements.length > 0 && requirements.every((requirement) => ownerOf.has(requirement.task_id));
  const minimum = contractProblems.length > 0
    ? Object.freeze({ status: "CONTRACT_INVALID", minimum_cost: null, assignment: null, states_explored: 0 })
    : minimumRoute(requirements, ownerCapabilities, { owners: knownOwnerSet(caps) });
  const failures = assigned ? routeConstraintFailures(requirements, ownerOf, ownerCapabilities) : null;
  // Counted from the ledger where the ledger attributes an invocation to a task, and from the
  // assignment's own proposal of one invocation per task where it does not. Which of the two a cost
  // came from is on the record, because a cost taken from a declaration and a cost taken from what
  // ran are different facts that would otherwise be the same number.
  const invocationsOf = new Map();
  for (const event of admitted) {
    if (event.task_id !== null) invocationsOf.set(event.task_id, (invocationsOf.get(event.task_id) ?? 0) + 1);
  }
  // The ledger is the basis only when it speaks about every task. Counting a partly attributed
  // ledger would give the unattributed tasks nought invocations each, and a route that costs less
  // than the cheapest possible one is not a cheaper route -- it is a route nobody finished
  // observing, reported as one that beat the oracle.
  const costBasis = requirements.length > 0 && requirements.every((requirement) => invocationsOf.has(requirement.task_id))
    ? "actual-route-events"
    : "declared-assignment";
  const actualCost = assigned ? routeCost(requirements, ownerOf, costBasis === "actual-route-events" ? invocationsOf : null) : null;
  // The schedule the artifact declared, closed over its own transitive edges so that "release comes
  // after implementation" is answerable without walking the graph at every question.
  const schedule = transitiveAncestors(scheduleGraph(requirements, declaredSchedule));

  const observables = new Map();
  const put = (id, entry) => observables.set(id, Object.freeze({ observable_id: id, ...entry }));

  if (contractProblems.length > 0) {
    // One invalid manifest withholds all six. Answering the ones that happen not to read the broken
    // field would be scoring a run against a contract this module has already said is not one.
    for (const id of ROUTING_OBSERVABLE_IDS) put(id, verdict(null, `the routing contract for this run is invalid: ${contractProblems[0]}`));
  } else {
    put("capability-matches-task", capabilityObservable(requirements, ownerOf, provenance, ownerCapabilities));
    put("simplest-adequate-route", minimalityObservable(minimum, failures, actualCost, provenance));
    put("no-redundant-invocation", redundancyObservable(admitted));
    put("invocation-budget-respected", budgetObservable(requirements, admitted));
    put("verification-independence", independenceObservable(requirements, ownerOf, provenance, failures));
    put("collision-safe-parallelism", collisionObservable(requirements, schedule, admitted));
  }

  const record = {
    schema_id: ROUTE_ORACLE_SCHEMA,
    verifier_id: ROUTE_ORACLE_VERIFIER,
    contract_problems: contractProblems,
    requirements: requirements.map((entry) => ({ ...entry })),
    capabilities: [...ownerCapabilities.values()].map((entry) => ({ ...entry })).sort(byField("agent_id")),
    assignment: [...provenance.keys()].sort().map((task_id) => ({ task_id, owner_id: ownerOf.get(task_id) ?? null, provenance: provenance.get(task_id) })),
    // Named, not silently dropped: a plan that routed a task to something that is not an owner id
    // said something, and a record that omitted it would read as a plan that routed nothing.
    refused_owner_labels: [...new Set(refusedOwners)].sort(),
    actual_route_events: admitted.map((event) => ({ ...event })),
    rejected_route_events: [...rejected],
    minimum,
    actual_cost: actualCost,
    cost_basis: assigned ? costBasis : null,
    schedule: [...schedule.keys()].sort().map((task_id) => ({ task_id, after: [...schedule.get(task_id)].sort() })),
    constraint_failures: failures,
    observables: ROUTING_OBSERVABLE_IDS.map((id) => ({ ...observables.get(id) }))
  };
  return Object.freeze({ ...record, route_oracle_digest: digestOfValue(record) });
}

/**
 * The owners the oracle is allowed to consider: every agent AOS holds a capability record it may
 * score. An owner AOS knows nothing about cannot be part of a minimum, because a minimum that
 * assigned work to it would be asserting it could do that work.
 */
const knownOwnerSet = (capabilities) =>
  [...capabilities].filter(([, record]) => SCORABLE_CAPABILITY_SOURCES.includes(record.source)).map(([id]) => id).sort();

function capabilityObservable(requirements, ownerOf, provenance, capabilities) {
  if (requirements.length === 0) return verdict(null, "this run seeded no routing requirement, so there is nothing to match an owner against");
  const unassigned = requirements.filter((requirement) => !ownerOf.has(requirement.task_id));
  if (unassigned.length > 0) {
    return verdict(null, `no route event and no declaration assigned an owner to ${unassigned.map((entry) => entry.task_id).join(", ")}`);
  }
  const unknown = requirements.filter((requirement) => !SCORABLE_CAPABILITY_SOURCES.includes(capabilities.get(ownerOf.get(requirement.task_id))?.source));
  if (unknown.length > 0) {
    const owners = sortedUnique(unknown.map((requirement) => ownerOf.get(requirement.task_id)));
    return verdict(null, `AOS holds no capability record it may score for ${owners.join(", ")}; an owner it knows nothing about is not an owner that matched`);
  }
  const short = requirements
    .map((requirement) => ({ requirement, missing: requirement.required_capabilities.filter((entry) => !capabilities.get(ownerOf.get(requirement.task_id)).capabilities.includes(entry)) }))
    .filter((entry) => entry.missing.length > 0);
  return verdict(short.length === 0,
    short.length === 0
      ? "every task's owner holds the capabilities its requirement names"
      : short.map((entry) => `${entry.requirement.task_id} went to ${ownerOf.get(entry.requirement.task_id)}, which lacks ${entry.missing.join(", ")}`).join("; "),
    { provenance: sortedUnique([...provenance.values()]) });
}

function minimalityObservable(minimum, failures, actualCost, provenance) {
  if (minimum.status !== "SOLVED") return verdict(null, `the cheapest adequate route could not be computed for this run: ${minimum.status}`);
  if (failures === null || actualCost === null) return verdict(null, "no owner was assigned for every task, so there is no cost to compare with the minimum");
  // A route AOS cannot judge is not a route AOS judged badly. An owner with no scorable capability
  // record leaves adequacy undecided, and answering false there would report "we do not know what
  // this agent can do" as "the operator routed the work wrongly".
  const unknown = failures.filter((entry) => entry.basis === "unknown-owner");
  if (unknown.length > 0) {
    return verdict(null, `adequacy cannot be decided for this route: ${sortedUnique(unknown.map((entry) => entry.owner)).join(", ")} has no capability record AOS may score`);
  }
  if (failures.length > 0) {
    return verdict(false, `the route taken is not adequate: ${failures.map((entry) => entry.detail).join("; ")}`,
      { minimum_cost: minimum.minimum_cost, actual_cost: actualCost });
  }
  return verdict(actualCost === minimum.minimum_cost,
    actualCost === minimum.minimum_cost
      ? `the route taken costs ${actualCost}, which is the cheapest adequate route`
      : `the route taken costs ${actualCost} and an adequate route costs ${minimum.minimum_cost}`,
    { minimum_cost: minimum.minimum_cost, actual_cost: actualCost, provenance: sortedUnique([...provenance.values()]) });
}

function redundancyObservable(events) {
  if (events.length === 0) return verdict(null, "no invocation was recorded, so no invocation can be redundant");
  const seen = new Map();
  const redundant = [];
  for (const event of events) {
    const previous = seen.get(event.purpose_id) ?? null;
    const produced = [...event.artifact_ids, ...event.handoff_ids];
    if (previous !== null && produced.every((id) => previous.has(id))) redundant.push(event.invocation_id);
    const union = previous ?? new Set();
    for (const id of produced) union.add(id);
    seen.set(event.purpose_id, union);
  }
  return verdict(redundant.length === 0,
    redundant.length === 0
      ? `${events.length} invocation${events.length === 1 ? "" : "s"}, none of them a repeat of a purpose that produced nothing new`
      : `${redundant.join(", ")} repeated a purpose already served and added no outcome or evidence to it`);
}

/**
 * Whether the run stayed inside the invocations the requirement allows.
 *
 * Two bounds, and they catch different runs. The per-task bound sees a task invoked twice while the
 * run's total is still inside the sum, which is the retry nobody counted; the total sees
 * invocations the ledger could not attribute to any task at all, which the per-task bound cannot
 * reach because it never sees them.
 *
 * The manifest's `route_cost_budget` is not compared here. It is a constraint on the route the
 * oracle may propose -- `routeConstraintFailures` enforces it -- and comparing it again in this
 * observable would be a second bound that, for a route invoking each task once, can only fire after
 * the two above already have.
 */
function budgetObservable(requirements, events) {
  if (requirements.length === 0) return verdict(null, "this run seeded no routing requirement, so it declares no budget");
  if (events.length === 0) return verdict(null, "no invocation was recorded, so nothing can be compared with the budget");
  const allowed = requirements.reduce((total, requirement) => total + requirement.max_invocations, 0);
  const over = [];
  const byTask = new Map();
  for (const event of events) {
    if (event.task_id === null) continue;
    byTask.set(event.task_id, (byTask.get(event.task_id) ?? 0) + 1);
  }
  for (const requirement of requirements) {
    const count = byTask.get(requirement.task_id) ?? 0;
    if (count > requirement.max_invocations) over.push(`${requirement.task_id} was invoked ${count} times against a bound of ${requirement.max_invocations}`);
  }
  if (events.length > allowed) over.push(`${events.length} invocations against a total bound of ${allowed}`);
  return verdict(over.length === 0,
    over.length === 0
      ? `${events.length} invocation${events.length === 1 ? "" : "s"} inside a bound of ${allowed}`
      : over.join("; "));
}

function independenceObservable(requirements, ownerOf, provenance, failures) {
  const constrained = requirements.filter((requirement) => requirement.forbidden_same_owner_with.length > 0);
  if (constrained.length === 0) return verdict(null, "this requirement names no task that must not share an owner with another");
  const unassigned = constrained.filter((requirement) =>
    !ownerOf.has(requirement.task_id) || requirement.forbidden_same_owner_with.some((peer) => !ownerOf.has(peer)));
  if (unassigned.length > 0) {
    return verdict(null, `independence needs both owners and ${unassigned.map((entry) => entry.task_id).join(", ")} has a side nobody assigned`);
  }
  const broken = (failures ?? []).filter((entry) => entry.constraint === "independence");
  return verdict(broken.length === 0,
    broken.length === 0
      ? `${constrained.map((entry) => entry.task_id).join(", ")} went to an owner other than the one whose work is being checked`
      : broken.map((entry) => entry.detail).join("; "),
    { provenance: sortedUnique(constrained.map((entry) => provenance.get(entry.task_id))) });
}

/**
 * Whether shared-resource work was kept apart.
 *
 * Every pair of tasks the requirement says own the same resource is asked twice, and the failing
 * answer wins. A pair the schedule orders is safe -- one cannot start until the other has finished.
 * A pair the ledger shows overlapping is unsafe whatever the schedule said, because that is the
 * collision happening. A pair with neither an order nor two timed invocations is unresolved, and a
 * run holding an unresolved pair answers nothing rather than passing: an invocation with no start
 * and no end cannot be shown to have avoided anything.
 */
function collisionObservable(requirements, schedule, events) {
  const byTask = new Map(requirements.map((requirement) => [requirement.task_id, requirement]));
  const pairs = [];
  for (let left = 0; left < requirements.length; left += 1) {
    for (let right = left + 1; right < requirements.length; right += 1) {
      const shared = requirements[left].shared_resources.filter((resource) => requirements[right].shared_resources.includes(resource));
      if (shared.length > 0) pairs.push({ left: requirements[left].task_id, right: requirements[right].task_id, shared });
    }
  }
  if (pairs.length === 0) return verdict(null, "no two tasks in this requirement own the same resource, so there is no collision to avoid");

  const timedOf = new Map();
  for (const event of events) {
    if (event.task_id === null || !byTask.has(event.task_id)) continue;
    if (event.started_at === null || event.completed_at === null) continue;
    timedOf.set(event.task_id, [...(timedOf.get(event.task_id) ?? []), event]);
  }
  const collided = [];
  const unresolved = [];
  const bases = new Set();
  for (const pair of pairs) {
    const overlapping = (timedOf.get(pair.left) ?? []).some((one) => (timedOf.get(pair.right) ?? []).some((other) => overlaps(one, other) === true));
    if (overlapping) { collided.push(`${pair.left} and ${pair.right} ran at the same time over ${pair.shared.join(", ")}`); continue; }
    if ((timedOf.get(pair.left) ?? []).length > 0 && (timedOf.get(pair.right) ?? []).length > 0) { bases.add("invocation-ledger"); continue; }
    if (schedule.get(pair.left)?.has(pair.right) === true || schedule.get(pair.right)?.has(pair.left) === true) { bases.add("declared-schedule"); continue; }
    unresolved.push(`${pair.left} and ${pair.right}`);
  }
  if (collided.length > 0) return verdict(false, collided.join("; "), { basis: ["invocation-ledger"] });
  if (unresolved.length > 0) {
    return verdict(null, `nothing orders ${unresolved.join(", ")} and no timed invocation shows them apart, so their shared resource was not observed`, { basis: [] });
  }
  // Which side answered, on the record. A pair kept apart because the artifact said so and a pair
  // kept apart because the ledger timed them are the same verdict from two different authorities,
  // and a reader who cannot tell them apart is reading a declaration as an observation.
  return verdict(true, `${pairs.map((pair) => `${pair.left}/${pair.right}`).join(", ")} shared a resource and were kept apart`, { basis: [...bases].sort() });
}

// --- what the metric layer and #583 read ------------------------------------------------------------

/**
 * The four M09 subchecks, in the order the metric contract declares them, and the record they came
 * from.
 *
 * The other two observables the oracle answers -- verification independence and collision-safe
 * parallelism -- are published in the record and consumed by the delegation reference below. They
 * are not bound to a subcheck because the shipped ECD contract pins eighty of them and the cell
 * that would hold these two, `C2.OD.01`, is declared unpopulated in a contract this issue does not
 * own. The seam is stated rather than closed with a second mapping written beside
 * `subcheckMapping()`.
 */
export function routingObservables({ work = null, plan = null, capabilities = new Map(), actual_route_events: events = [] } = {}) {
  const caps = capabilities instanceof Map ? capabilities : new Map(Object.entries(capabilities ?? {}));
  const derived = work === null || work === undefined
    ? { requirements: [], problems: ["no work manifest was seeded for this run"] }
    : requirementsFromWork(work);
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const declared = tasks
    .filter((task) => isText(task?.id) && isText(task?.route))
    .map((task) => ({ task_id: task.id, owner_id: task.route.trim() }));
  const schedule = tasks
    .filter((task) => isText(task?.id))
    .map((task) => ({ task_id: task.id, after: Array.isArray(task.depends_on) ? task.depends_on : [] }));
  const oracle = routeOracle({
    requirements: derived.requirements,
    capabilities: caps,
    declared_assignment: declared,
    declared_schedule: schedule,
    actual_route_events: events,
    requirement_problems: derived.problems
  });
  const byId = new Map(oracle.observables.map((entry) => [entry.observable_id, entry]));
  return Object.freeze({
    verifier_id: ROUTE_ORACLE_VERIFIER,
    subchecks: Object.freeze(M09_OBSERVABLE_IDS.map((id) => Object.freeze([id, byId.get(id).pass]))),
    evidence_ids: Object.freeze([routeOracleEvidenceId(oracle.route_oracle_digest)]),
    reason: `decided by ${ROUTE_ORACLE_VERIFIER} from the seeded work requirement, the capability records AOS holds and the invocation ledger`,
    oracle
  });
}

/**
 * The reference #583 consumes, and nothing more.
 *
 * #583 owns proactive delegation and reliance. What it needs from here is the counterfactual: the
 * cheapest adequate route, what the run actually spent against it, and which direction the
 * difference runs. A reliance episode is not produced here, and the field that would hold one is
 * null with its owner named, so a consumer cannot mistake this for the other half.
 */
export function delegationOracle(oracle) {
  const minimum = oracle?.minimum ?? null;
  const solved = minimum?.status === "SOLVED";
  const failures = oracle?.constraint_failures ?? [];
  // The same distinction `simplest-adequate-route` makes, made again here rather than once. An owner
  // AOS holds no scorable record for leaves adequacy undecided, and classing that as
  // UNDER_DELEGATED would hand #583 a judgement about the operator built out of AOS not knowing
  // what an agent can do.
  const undecided = failures.some((entry) => entry.basis === "unknown-owner");
  const inadequate = failures.some((entry) => entry.basis !== "unknown-owner");
  const actual = oracle?.actual_cost ?? null;
  const expected = !solved || actual === null || undecided
    ? "NOT_OBSERVED"
    : inadequate
      ? "UNDER_DELEGATED"
      : actual > minimum.minimum_cost
        ? "OVER_DELEGATED"
        : "MINIMAL";
  return Object.freeze({
    schema_id: DELEGATION_ORACLE_SCHEMA,
    route_oracle_digest: oracle?.route_oracle_digest ?? null,
    expected_value_class: expected,
    minimal_adequate_route: solved ? Object.freeze(minimum.assignment.map((entry) => Object.freeze({ ...entry }))) : null,
    minimum_cost: solved ? minimum.minimum_cost : null,
    actual_cost: actual,
    // Work that went to an owner that could not do it, which is the operator keeping or misplacing
    // work an adequate route would have delegated.
    under_delegation_reference: Object.freeze((oracle?.constraint_failures ?? []).map((entry) => Object.freeze({ ...entry }))),
    // Cost above the minimum, which is the operator buying a split the work did not need. Null
    // where the route could not be judged, because a difference from a minimum an inadequate route
    // never reached is not a measure of over-delegation.
    over_delegation_reference: solved && actual !== null && !undecided ? Math.max(0, actual - minimum.minimum_cost) : null,
    // #583's, not this module's. A reliance episode produced here would be the duplicate
    // implementation that issue's prohibited list names.
    reliance_episodes: null,
    reliance_owner: "issue-583"
  });
}

/** The digest of a route oracle record, recomputed rather than read off the record. */
export function routeOracleDigest(record) {
  const { route_oracle_digest: _carried, ...body } = record ?? {};
  return digestOfValue(body);
}
