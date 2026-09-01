import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalJson } from "./core.mjs";

// The execution plan, and the checks that keep it honest.
//
// Three things describe what v0.2.0 is: the epic prose, the GitHub issues, and this manifest. Prose
// and labels drift -- an issue gets closed by a documentation PR, a status label outlives the work
// it described, someone adds a dependency that quietly closes a loop -- and an agent reading the
// drifted version starts work it is not allowed to start. So the manifest is the authority, and
// this module is what refuses to let the three disagree.
//
// Nothing here reaches the network. `checkPlan` reads the manifest alone; `checkGithubState` and
// `auditCloseEvidence` take a snapshot of GitHub as an argument, so the same code runs against a
// committed fixture in the suite and against the live API in the release audit.

export const CANONICAL_ISSUE_COUNT = 32;
export const EXCLUDED_ISSUES = Object.freeze([579, 580, 581]);
export const COMPLETION_SCHEMA = "aos-issue-completion.v1";

const PLAN_URL = new URL("../governance/v0.2.0-execution-plan.json", import.meta.url);
const SCHEMA_URL = new URL("../schemas/aos-execution-plan.v1.schema.json", import.meta.url);

export const loadPlan = (url = PLAN_URL) => JSON.parse(readFileSync(url, "utf8"));
export const loadSchema = (url = SCHEMA_URL) => JSON.parse(readFileSync(url, "utf8"));

/** The digest the epic and the evidence bundle quote. Key order cannot change it; content can. */
export const planDigest = (plan) =>
  `sha256:${createHash("sha256").update(canonicalJson(plan)).digest("hex")}`;

export const fileDigest = (url) =>
  `sha256:${createHash("sha256").update(readFileSync(url)).digest("hex")}`;

// --- schema ---------------------------------------------------------------------------------

// A validator for the subset of JSON Schema this repository writes, and no more. Pulling in a
// general one would be the first runtime dependency in a product whose whole claim is that it runs
// from a clone with nothing else installed; writing the subset keeps that true and keeps the
// failure messages in the vocabulary of the manifest rather than of a library.
const KEYWORDS = new Set([
  "$schema", "$id", "title", "description", "$defs", "$ref", "type", "const", "enum",
  "properties", "required", "additionalProperties", "minProperties", "items", "minItems",
  "maxItems", "uniqueItems", "minimum", "maximum", "minLength", "maxLength", "pattern"
]);

const typeOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "number" ? "number" : typeof value;
};

const typeMatches = (value, expected) =>
  expected === "number" ? typeOf(value) === "integer" || typeOf(value) === "number" : typeOf(value) === expected;

const resolveRef = (root, ref) => {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
  let node = root;
  for (const segment of ref.slice(2).split("/")) {
    node = node?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  }
  return node;
};

const validateNode = (value, schema, root, path, errors) => {
  // A boolean is a schema in its own right: `true` accepts everything, `false` rejects everything.
  // Treating `false` as "no schema here" is the direction that silently accepts, so it is spelled
  // out rather than left to a truthiness test.
  if (schema === true) return;
  if (schema === false) {
    errors.push({ path, message: "no value is allowed here" });
    return;
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push({ path, message: "the schema at this position is not a schema" });
    return;
  }
  for (const keyword of Object.keys(schema)) {
    // An unsupported keyword is reported, not thrown. A throw here would crash the verifier
    // instead of failing it, and a crashed required check reads to a human like infrastructure
    // trouble rather than like the schema saying something this validator cannot promise to honour.
    if (!KEYWORDS.has(keyword)) errors.push({ path, message: `unsupported schema keyword "${keyword}"` });
  }
  if (schema.$ref) {
    let target;
    try {
      target = resolveRef(root, schema.$ref);
    } catch (error) {
      errors.push({ path, message: error.message });
      return;
    }
    // Draft 2020-12 applies $ref's siblings too. Returning early here accepted 3 against
    // `{$ref: …, minimum: 5}`, which is the shape a schema grows into the first time someone
    // narrows a reused definition at one use site.
    validateNode(value, target, root, path, errors);
    const siblings = { ...schema };
    delete siblings.$ref;
    if (Object.keys(siblings).length > 0) validateNode(value, siblings, root, path, errors);
    return;
  }

  const fail = (message) => errors.push({ path, message });

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((one) => typeMatches(value, one))) {
      fail(`expected ${allowed.join(" or ")}, got ${typeOf(value)}`);
      return;
    }
  }
  if (schema.const !== undefined && value !== schema.const) fail(`expected the constant ${JSON.stringify(schema.const)}`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    fail(`${JSON.stringify(value)} is not one of ${schema.enum.map((one) => JSON.stringify(one)).join(", ")}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be <= ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
    if (schema.uniqueItems === true) {
      // Key order is not part of a JSON value's identity, so the comparison canonicalises first.
      // `JSON.stringify` alone called {a:1,b:2} and {b:2,a:1} distinct, which is the opposite of
      // what uniqueItems means.
      const seen = new Set(value.map((one) => canonicalJson(one)));
      if (seen.size !== value.length) fail("items must be unique");
    }
    if (schema.items !== undefined) value.forEach((item, index) => validateNode(item, schema.items, root, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) fail(`must have at least ${schema.minProperties} properties`);
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail(`missing required property "${key}"`);
    }
    for (const key of keys) {
      // `Object.hasOwn`, not truthiness: `{properties: {x: false}}` says x is forbidden, and
      // `if (child)` read that as "x has no schema" and let it through.
      if (Object.hasOwn(schema.properties ?? {}, key)) {
        validateNode(value[key], schema.properties[key], root, `${path}.${key}`, errors);
        continue;
      }
      if (schema.additionalProperties === undefined) continue;
      if (schema.additionalProperties === false) fail(`unexpected property "${key}"`);
      else validateNode(value[key], schema.additionalProperties, root, `${path}.${key}`, errors);
    }
  }
};

export function validateAgainstSchema(document, schema) {
  const errors = [];
  try {
    validateNode(document, schema, schema, "$", errors);
  } catch (error) {
    errors.push({ path: "$", message: `the validator could not finish: ${error.message}` });
  }
  return { ok: errors.length === 0, errors };
}

// --- static checks --------------------------------------------------------------------------

const CANONICAL = Object.freeze([
  ...Array.from({ length: 26 }, (_, index) => 553 + index),
  582, 583, 584, 585, 586, 588
]);

const asList = (values) => [...values].sort((a, b) => a - b).join(", ");

/** Statuses that assert work has begun or finished, and so require every predecessor to be done. */
const STARTED = new Set(["ready", "in-progress", "done"]);

export const GATE_NAMES = Object.freeze(["X", "S", "C", "G", "E", "Q", "U", "R", "P"]);

/** Everything an issue transitively waits on. Tolerates cycles: a repeat is simply not re-entered. */
function ancestorsOf(number, byNumber, seen = new Set()) {
  const out = new Set();
  for (const predecessor of byNumber.get(number)?.blocked_by ?? []) {
    if (seen.has(predecessor)) continue;
    out.add(predecessor);
    for (const older of ancestorsOf(predecessor, byNumber, new Set([...seen, predecessor]))) out.add(older);
  }
  return out;
}

/**
 * Every check that can be answered from the manifest alone.
 *
 * Returns a report rather than throwing, because the interesting output is the whole list of what
 * is wrong -- a verifier that stops at the first failure makes a plan with four problems look like
 * a plan with one, four times.
 */
export function checkPlan(plan, { schema = loadSchema() } = {}) {
  const failures = [];
  const fail = (check, detail, issue = null) => failures.push({ check, detail, issue });

  const schemaReport = validateAgainstSchema(plan, schema);
  for (const error of schemaReport.errors) fail("schema-invalid", `${error.path}: ${error.message}`);
  if (!schemaReport.ok) return { ok: false, failures };

  const issues = plan.issues;
  const byNumber = new Map();
  for (const one of issues) {
    if (byNumber.has(one.issue)) fail("duplicate-issue", `#${one.issue} appears more than once`, one.issue);
    else byNumber.set(one.issue, one);
  }

  if (issues.length !== CANONICAL_ISSUE_COUNT || byNumber.size !== CANONICAL_ISSUE_COUNT) {
    fail("canonical-issue-count", `expected ${CANONICAL_ISSUE_COUNT} entries, found ${byNumber.size}`);
  }
  const missing = CANONICAL.filter((number) => !byNumber.has(number));
  const unknown = [...byNumber.keys()].filter((number) => !CANONICAL.includes(number));
  if (missing.length > 0) fail("canonical-issue-set", `missing ${asList(missing)}`);
  if (unknown.length > 0) fail("canonical-issue-set", `not canonical: ${asList(unknown)}`);
  // The exclusion list is a floor, not a field. Emptying `excluded_issues` used to switch the
  // whole excluded-issue check off from inside the document being checked -- a check that its own
  // subject can disable is not a check.
  for (const excluded of EXCLUDED_ISSUES) {
    if (!plan.excluded_issues.includes(excluded)) {
      fail("excluded-issue-dropped", `#${excluded} is excluded by contract and the plan does not list it`, excluded);
    }
  }
  for (const excluded of plan.excluded_issues) {
    if (byNumber.has(excluded)) fail("excluded-issue-present", `#${excluded} is excluded but appears in the plan`, excluded);
  }

  // Edges, in both directions. A plan where blocked_by and blocks disagree has two answers to
  // "what does this unblock", and a reader picks whichever one it happened to consult.
  for (const one of issues) {
    if (one.blocked_by.includes(one.issue)) fail("self-dependency", `#${one.issue} blocks itself`, one.issue);
    if (one.blocks.includes(one.issue)) fail("self-dependency", `#${one.issue} lists itself in blocks`, one.issue);
    for (const predecessor of one.blocked_by) {
      if (!byNumber.has(predecessor)) {
        fail("unknown-dependency", `#${one.issue} is blocked by #${predecessor}, which is not in the plan`, one.issue);
        continue;
      }
      if (!byNumber.get(predecessor).blocks.includes(one.issue)) {
        fail("reverse-edge-inconsistent", `#${one.issue} is blocked by #${predecessor}, but #${predecessor} does not list it in blocks`, one.issue);
      }
    }
    for (const successor of one.blocks) {
      if (!byNumber.has(successor)) {
        fail("unknown-dependency", `#${one.issue} blocks #${successor}, which is not in the plan`, one.issue);
        continue;
      }
      if (!byNumber.get(successor).blocked_by.includes(one.issue)) {
        fail("reverse-edge-inconsistent", `#${one.issue} blocks #${successor}, but #${successor} is not blocked by it`, one.issue);
      }
    }
    if (one.allowed_parallel_with.includes(one.issue)) {
      fail("self-dependency", `#${one.issue} lists itself as a parallel peer`, one.issue);
    }
  }

  for (const cycle of findCycles(byNumber)) {
    fail("dependency-cycle", cycle.map((number) => `#${number}`).join(" -> "), cycle[0]);
  }

  // Status against the graph. Ready means nothing is left to wait for; blocked means something is.
  // The second half is the one that rots: a predecessor lands, nobody re-labels the successor, and
  // an agent skips work that was in fact unblocked days ago.
  const done = (number) => byNumber.get(number)?.status === "done";
  for (const one of issues) {
    const unfinished = one.blocked_by.filter((number) => !done(number));
    // Every status that means "this work has begun or finished" carries the same precondition.
    // Constraining only `ready` let an issue be moved to `in-progress` and then to `done` while
    // its predecessors were untouched, which is the permission bypass the manifest exists to stop
    // -- and `done` predecessors are what unblock everything downstream, so it propagates.
    if (STARTED.has(one.status) && unfinished.length > 0) {
      fail("ready-with-unfinished-predecessor", `#${one.issue} is ${one.status} but waits on ${asList(unfinished)}`, one.issue);
    }
    if (one.status === "blocked" && one.blocked_by.length > 0 && unfinished.length === 0) {
      fail("stale-blocked-status", `#${one.issue} is still blocked but every predecessor passed`, one.issue);
    }
    if (one.status === "blocked" && one.blocked_by.length === 0) {
      fail("blocked-without-predecessor", `#${one.issue} is blocked by nothing`, one.issue);
    }
    if (one.release_critical && !one.close_evidence_required) {
      fail("release-critical-needs-close-evidence", `#${one.issue} is release-critical without a close-evidence contract`, one.issue);
    }
    if (one.close_evidence_required && one.required_evidence_fields.length === 0) {
      fail("close-evidence-fields-empty", `#${one.issue} requires close evidence but names no fields`, one.issue);
    }
    for (const peer of one.allowed_parallel_with) {
      if (!byNumber.has(peer)) {
        fail("unknown-dependency", `#${one.issue} may run beside #${peer}, which is not in the plan`, one.issue);
        continue;
      }
      if (!byNumber.get(peer).allowed_parallel_with.includes(one.issue)) {
        fail("parallel-not-symmetric", `#${one.issue} may run beside #${peer} but not the other way round`, one.issue);
      }
    }
  }

  // Phase-ready is not READY. A phase may be open while its issue is blocked -- that is what lets
  // #556 prove a platform is feasible before its predecessors land -- but such a phase must not be
  // allowed to merge the integration that the blocked status exists to withhold.
  for (const one of issues) {
    const ids = new Set();
    for (const phase of one.phases) {
      if (ids.has(phase.id)) fail("duplicate-phase", `#${one.issue} declares phase "${phase.id}" twice`, one.issue);
      ids.add(phase.id);
      for (const output of phase.allowed_outputs) {
        if (!plan.phase_output_vocabulary.includes(output)) {
          fail("phase-output-not-allowed", `#${one.issue} phase "${phase.id}" declares the undeclared output "${output}"`, one.issue);
        }
      }
      if (phase.status === "ready" && one.status !== "ready" && phase.code_integration_allowed) {
        fail("phase-scope-exceeded", `#${one.issue} phase "${phase.id}" is open while the issue is ${one.status}, so it cannot integrate code`, one.issue);
      }
      const unfinishedPhase = phase.blocked_by.filter((number) => !done(number));
      if (STARTED.has(phase.status) && unfinishedPhase.length > 0) {
        fail("phase-ready-with-unfinished-predecessor", `#${one.issue} phase "${phase.id}" is ${phase.status} but waits on ${asList(unfinishedPhase)}`, one.issue);
      }
      // The same rot as stale-blocked at issue level: a phase whose predecessors all landed and
      // whose status never moved makes available work look unavailable.
      if (phase.status === "blocked" && phase.blocked_by.length > 0 && unfinishedPhase.length === 0) {
        fail("stale-blocked-phase", `#${one.issue} phase "${phase.id}" is still blocked but every predecessor passed`, one.issue);
      }
      if (phase.status === "blocked" && phase.blocked_by.length === 0) {
        fail("phase-blocked-without-predecessor", `#${one.issue} phase "${phase.id}" is blocked by nothing`, one.issue);
      }
    }
  }

  // Hot files. Two primary owners of one surface is how two branches rewrite the same schema and
  // the second merge silently wins.
  const owners = new Map();
  for (const one of issues) {
    for (const surface of one.owner_surfaces) {
      if (owners.has(surface)) {
        fail("hot-file-owner-collision", `"${surface}" is owned by both #${owners.get(surface)} and #${one.issue}`, one.issue);
      } else owners.set(surface, one.issue);
    }
  }

  // Gates. Every release-critical issue that is not the epic has to be behind one, or the release
  // gate list is a description of some of the work rather than a gate on all of it.
  const gated = new Set(Object.values(plan.gates).flat());
  for (const [gate, members] of Object.entries(plan.gates)) {
    if (!GATE_NAMES.includes(gate)) fail("gate-unknown-name", `"${gate}" is not one of ${GATE_NAMES.join(" ")}`);
    for (const number of members) {
      if (!byNumber.has(number)) fail("gate-unknown-issue", `gate ${gate} names #${number}, which is not in the plan`, number);
    }
  }
  for (const one of issues) {
    if (one.release_critical && one.kind !== "epic" && !gated.has(one.issue)) {
      fail("release-critical-not-gated", `#${one.issue} is release-critical and behind no gate`, one.issue);
    }
  }

  // Batches must not run backwards. A batch is a wave, not a claim of parallelism -- the epic puts
  // #558 and #583 in the same wave and #583 waits on #558 -- so the rule is that a successor never
  // lands in an *earlier* wave than something it waits on. What may actually run at the same time
  // is `allowed_parallel_with`, which is checked separately and excludes dependency-related pairs.
  // Without this the field was decorative: nothing read it, and #578 could be moved to batch 0.
  for (const one of issues) {
    if (one.batch === null && one.kind !== "epic") {
      fail("batch-missing", `#${one.issue} is scheduled into no batch`, one.issue);
      continue;
    }
    for (const predecessor of one.blocked_by) {
      const before = byNumber.get(predecessor);
      if (!before || before.batch === null || one.batch === null) continue;
      if (before.batch > one.batch) {
        fail("batch-out-of-order", `#${one.issue} is in batch ${one.batch} but waits on #${predecessor} in batch ${before.batch}`, one.issue);
      }
    }
  }

  // "May run beside" and "waits on" are contradictory claims about the same pair.
  for (const one of issues) {
    const upstream = ancestorsOf(one.issue, byNumber);
    for (const peer of one.allowed_parallel_with) {
      if (upstream.has(peer) || ancestorsOf(peer, byNumber).has(one.issue)) {
        fail("parallel-with-dependency", `#${one.issue} may not run beside #${peer}: one waits on the other`, one.issue);
      }
    }
  }

  return { ok: failures.length === 0, failures, owners: Object.fromEntries(owners) };
}

/**
 * Every elementary cycle in blocked_by, each reported exactly once.
 *
 * A plain depth-first search with one shared visited set finds *a* cycle in any cyclic graph, which
 * is enough to fail the check, but it is not enough to describe the graph: on
 * `553↔554↔555` it reported three cycles and silently missed `553 → 555 → 553`, because 555 had
 * already been reached through 554. A verifier whose diagnostic omits the edge someone has to
 * remove sends them to fix the wrong one.
 *
 * So each cycle is enumerated from its own smallest member, and the search never steps to a node
 * below that member. Every elementary cycle has exactly one smallest node, so it is found exactly
 * once, from there, and the rotation printed is the one that starts at it.
 */
function findCycles(byNumber) {
  const cycles = [];
  const nodes = [...byNumber.keys()].sort((a, b) => a - b);

  for (const start of nodes) {
    const stack = [];
    const onStack = new Set();

    const walk = (number) => {
      stack.push(number);
      onStack.add(number);
      for (const next of byNumber.get(number)?.blocked_by ?? []) {
        if (!byNumber.has(next) || next < start) continue;
        if (next === start) cycles.push([...stack, start]);
        else if (!onStack.has(next)) walk(next);
      }
      stack.pop();
      onStack.delete(number);
    };

    walk(start);
  }
  return cycles;
}

// --- GitHub state ----------------------------------------------------------------------------

export const expectedState = (status) => (status === "done" ? "closed" : "open");

/**
 * The manifest against a snapshot of the issues.
 *
 * The snapshot is the same shape whether it came from a committed fixture or from a live read, so
 * the release audit runs the checks the suite already ran rather than a second, looser copy.
 */
export const SNAPSHOT_SCHEMA = "aos-github-issue-state.v1";
export const SNAPSHOT_SOURCES = Object.freeze(["live", "snapshot"]);

export function checkGithubState(plan, snapshot) {
  const failures = [];
  const fail = (check, issue, detail) => failures.push({ check, issue, detail });

  // The snapshot is the comparison authority, so it has to say what it is. Without this, a branch
  // that changes both the plan and the fixture can put the pair into a mutually consistent
  // fictional state -- a different repository, an unparseable date, a `source` of the author's
  // choosing -- and the check would agree with itself all the way to green.
  if (snapshot?.schema !== SNAPSHOT_SCHEMA) {
    fail("snapshot-not-a-snapshot", null, `expected ${SNAPSHOT_SCHEMA}, found ${snapshot?.schema ?? "nothing"}`);
  }
  if (snapshot?.repository !== plan.repository) {
    fail("snapshot-wrong-repository", null, `the plan is for ${plan.repository}, the snapshot is for ${snapshot?.repository ?? "nothing"}`);
  }
  if (!SNAPSHOT_SOURCES.includes(snapshot?.source)) {
    fail("snapshot-unknown-source", null, `source must be one of ${SNAPSHOT_SOURCES.join(", ")}, found ${snapshot?.source ?? "nothing"}`);
  }
  if (!Number.isFinite(Date.parse(snapshot?.captured_at ?? ""))) {
    fail("snapshot-undated", null, `captured_at is not a date: ${snapshot?.captured_at ?? "nothing"}`);
  }
  if (!Array.isArray(snapshot?.issues)) {
    fail("snapshot-empty", null, "the snapshot carries no issues");
    return { ok: false, failures };
  }

  const byNumber = new Map(snapshot.issues.map((one) => [one.number, one]));
  for (const one of plan.issues) {
    const live = byNumber.get(one.issue);
    if (!live) {
      fail("issue-missing-from-snapshot", one.issue, "the plan names it and GitHub does not have it");
      continue;
    }
    const labels = new Set(live.labels ?? []);

    if (live.state !== expectedState(one.status)) {
      fail("open-state-mismatch", one.issue, `the plan says ${one.status} (${expectedState(one.status)}), GitHub says ${live.state}`);
    }
    // Closed as "not planned" is not closed as done, and the two are one word apart in the API and
    // identical in the issue list.
    if (live.state === "closed" && live.state_reason === "not_planned") {
      fail("closed-not-planned", one.issue, "a canonical issue was closed as not planned");
    }
    // Exactly one, the way priority and area are already checked. Presence alone let an issue carry
    // status:blocked *and* status:ready at once, and an agent reading labels then sees permission
    // to start while the manifest says it is blocked.
    const statuses = [...labels].filter((label) => label.startsWith("status:"));
    if (statuses.length !== 1 || statuses[0] !== `status:${one.status}`) {
      fail("status-label-mismatch", one.issue, `expected exactly status:${one.status}, found ${statuses.join(", ") || "none"}`);
    }
    const priorities = [...labels].filter((label) => label.startsWith("priority:"));
    if (priorities.length !== 1 || priorities[0] !== `priority:${one.priority}`) {
      fail("priority-label-mismatch", one.issue, `expected exactly priority:${one.priority}, found ${priorities.join(", ") || "none"}`);
    }
    const areas = [...labels].filter((label) => label.startsWith("area:"));
    if (areas.length !== 1 || areas[0] !== `area:${one.area}`) {
      fail("area-label-mismatch", one.issue, `expected exactly area:${one.area}, found ${areas.join(", ") || "none"}`);
    }
    if (!labels.has(plan.release_label)) {
      fail("release-label-missing", one.issue, `expected ${plan.release_label}`);
    }
    if (live.milestone !== plan.milestone) {
      fail("milestone-mismatch", one.issue, `expected milestone ${plan.milestone}, found ${live.milestone ?? "none"}`);
    }

    const marker = one.issue === plan.epic ? plan.epic_body_marker : plan.body_marker;
    if (live.body_marker !== marker) {
      fail("body-marker-missing", one.issue, `expected ${marker}, found ${live.body_marker ?? "none"}`);
    }

    const prefix = one.kind === "epic" ? "[EPIC]" : `[${one.priority}]`;
    if (typeof live.title !== "string" || !live.title.startsWith(prefix)) {
      fail("title-prefix-mismatch", one.issue, `expected the title to start with ${prefix}`);
    }
  }

  for (const excluded of plan.excluded_issues) {
    const live = byNumber.get(excluded);
    if (live && live.milestone === plan.milestone && live.state === "open") {
      fail("excluded-issue-open-in-milestone", excluded, "an excluded issue is still open in the release milestone");
    }
  }

  return { ok: failures.length === 0, failures };
}

// --- close evidence ---------------------------------------------------------------------------

/**
 * A closed issue has to say what closed it.
 *
 * The failure this exists for is real and already happened once: #582 was closed on a
 * documentation PR, which reads in the issue list exactly like an implementation that landed. A
 * reference, a merge, and a closed count are all things a documentation change produces too, so
 * none of them is evidence. A final SHA, a PR, CI runs that actually ran, a PASS, and the digests
 * the issue itself asked for -- together those cannot be produced by a change that did no work.
 */
export function auditCloseEvidence(plan, snapshot) {
  const failures = [];
  const fail = (check, issue, detail) => failures.push({ check, issue, detail });
  const byNumber = new Map(snapshot.issues.map((one) => [one.number, one]));

  for (const one of plan.issues) {
    const live = byNumber.get(one.issue);
    if (!live || live.state !== "closed") continue;
    if (!one.close_evidence_required) continue;

    const record = live.close_evidence;
    if (record && record.author_trusted === false) {
      fail("close-evidence-untrusted-author", one.issue, `the record was posted by ${record.author ?? "someone"} without write access to the repository`);
      continue;
    }
    if (!record || typeof record !== "object") {
      fail("close-evidence-missing", one.issue, `closed with no ${COMPLETION_SCHEMA} record${(live.closing_references ?? []).length > 0 ? ` (only references: ${live.closing_references.join(", ")})` : ""}`);
      continue;
    }
    if (record.schema !== COMPLETION_SCHEMA) {
      fail("close-evidence-missing", one.issue, `record is ${record.schema ?? "untyped"}, expected ${COMPLETION_SCHEMA}`);
      continue;
    }
    if (record.issue !== one.issue) {
      fail("close-evidence-wrong-issue", one.issue, `the record is for #${record.issue}`);
    }

    const incomplete = [];
    if (typeof record.final_sha !== "string" || !/^[0-9a-f]{40}$/.test(record.final_sha)) incomplete.push("final_sha");
    if (!Number.isInteger(record.pr) || record.pr <= 0) incomplete.push("pr");
    if (!Array.isArray(record.ci_run_ids) || record.ci_run_ids.length === 0) incomplete.push("ci_run_ids");
    if (record.verdict !== "PASS" && record.verdict !== "HOLD") incomplete.push("verdict");
    if (incomplete.length > 0) {
      fail("close-evidence-incomplete", one.issue, `missing or malformed: ${incomplete.join(", ")}`);
      continue;
    }
    if (record.verdict !== "PASS") {
      fail("close-evidence-not-pass", one.issue, `the record says ${record.verdict}, so the issue stays open`);
      continue;
    }

    // The claims in the record are checked against the repository, not taken at their word. Forty
    // hex characters, a positive integer and a non-empty array are things a fabricated record has
    // too; a SHA that is an ancestor of the integration branch, a merged pull request and a
    // successful workflow run are not. `checked` is filled in by the live read and travels into the
    // snapshot, so the offline audit compares against facts that were established rather than
    // against assertions that were typed.
    const checked = live.close_evidence_checked;
    if (checked && checked.verified !== true) {
      const wrong = Object.entries(checked)
        .filter(([key, value]) => key !== "verified" && value !== true)
        .map(([key, value]) => `${key}=${value}`);
      fail("close-evidence-unverified", one.issue, `the repository does not confirm the record: ${wrong.join(", ") || "unknown"}`);
      continue;
    }
    if (!checked) {
      fail("close-evidence-unchecked", one.issue, "the record has never been checked against the repository");
      continue;
    }

    const evidence = record.evidence && typeof record.evidence === "object" ? record.evidence : {};
    const absent = one.required_evidence_fields.filter(
      (field) => evidence[field] === undefined || evidence[field] === null || evidence[field] === ""
    );
    if (absent.length > 0) {
      fail("close-evidence-field-missing", one.issue, `the issue requires ${absent.join(", ")}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * The one object the release evidence bundle quotes.
 *
 * Built here rather than in the script so the test that says it carries no title, body or path can
 * actually inspect it. The previous version of that test serialised an empty failure array and
 * asserted it was empty, which would have stayed green while a title was added to the real output.
 */
export function auditSummary(plan, snapshot, reports, digests = {}) {
  const failures = [
    ...reports.plan.failures.map((one) => ({ lane: "plan", ...one })),
    ...reports.state.failures.map((one) => ({ lane: "github-state", ...one })),
    ...reports.evidence.failures.map((one) => ({ lane: "close-evidence", ...one }))
  ];
  const capturedAt = Date.parse(snapshot?.captured_at ?? "");

  return {
    schema: "aos-execution-audit.v1",
    release: plan.release,
    repository: plan.repository,
    source: snapshot?.source ?? null,
    captured_at: snapshot?.captured_at ?? null,
    captured_age_hours: Number.isFinite(capturedAt) ? Math.round((Date.now() - capturedAt) / 36e5) : null,
    plan_digest: planDigest(plan),
    ...digests,
    canonical_issue_count: plan.issues.length,
    canonical_issue_count_expected: CANONICAL_ISSUE_COUNT,
    counts: Object.fromEntries(
      ["ready", "blocked", "in-progress", "done", "tracking"].map((status) => [
        status,
        plan.issues.filter((one) => one.status === status).length
      ])
    ),
    next_work: nextWork(plan),
    // Lane, check name and issue number only. No title, no body, no path, no token: this object is
    // published, and a leak here is a leak once and for ever.
    failures: failures.map((one) => ({ lane: one.lane, check: one.check, issue: one.issue ?? null })),
    ok: failures.length === 0
  };
}

/**
 * What an agent is allowed to start right now, decided from the manifest and nothing else.
 *
 * A ready issue with a blocked phase is *not* ready in full, and saying "ready now: #572" without
 * saying so was an invitation to delete branches before #578 had preserved the evidence. So phases
 * are reported for every issue that declares them, and an issue with any blocked phase is
 * advertised as restricted rather than as ready.
 */
export function nextWork(plan) {
  const phasesOf = (one) =>
    one.phases.map((phase) => ({
      issue: one.issue,
      phase: phase.id,
      status: phase.status,
      code_integration_allowed: phase.code_integration_allowed,
      blocked_by: [...phase.blocked_by]
    }));

  const openIssues = plan.issues.filter((one) => one.status === "ready");
  const unrestricted = openIssues.filter((one) => one.phases.every((phase) => phase.status === "ready"));
  const restricted = openIssues.filter((one) => one.phases.some((phase) => phase.status !== "ready"));

  return {
    ready: unrestricted.map((one) => one.issue),
    ready_with_blocked_phases: restricted.map((one) => ({
      issue: one.issue,
      open_phases: one.phases.filter((phase) => phase.status === "ready").map((phase) => phase.id),
      withheld_phases: one.phases
        .filter((phase) => phase.status !== "ready")
        .map((phase) => ({ phase: phase.id, blocked_by: [...phase.blocked_by] }))
    })),
    phase_ready: plan.issues
      .filter((one) => one.status !== "ready")
      .flatMap((one) => phasesOf(one).filter((phase) => phase.status === "ready"))
  };
}
