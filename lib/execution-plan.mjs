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
  "uniqueItems", "minimum", "maximum", "minLength", "pattern"
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
  for (const keyword of Object.keys(schema)) {
    if (!KEYWORDS.has(keyword)) throw new Error(`unsupported schema keyword "${keyword}" at ${path}`);
  }
  if (schema.$ref) return validateNode(value, resolveRef(root, schema.$ref), root, path, errors);

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
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} items`);
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((one) => JSON.stringify(one)));
      if (seen.size !== value.length) fail("items must be unique");
    }
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, root, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) fail(`must have at least ${schema.minProperties} properties`);
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail(`missing required property "${key}"`);
    }
    for (const key of keys) {
      const child = schema.properties?.[key];
      if (child) {
        validateNode(value[key], child, root, `${path}.${key}`, errors);
        continue;
      }
      if (schema.additionalProperties === false) fail(`unexpected property "${key}"`);
      else if (typeof schema.additionalProperties === "object") {
        validateNode(value[key], schema.additionalProperties, root, `${path}.${key}`, errors);
      }
    }
  }
};

export function validateAgainstSchema(document, schema) {
  const errors = [];
  validateNode(document, schema, schema, "$", errors);
  return { ok: errors.length === 0, errors };
}

// --- static checks --------------------------------------------------------------------------

const CANONICAL = Object.freeze([
  ...Array.from({ length: 26 }, (_, index) => 553 + index),
  582, 583, 584, 585, 586, 588
]);

const asList = (values) => [...values].sort((a, b) => a - b).join(", ");

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
    if (one.status === "ready" && unfinished.length > 0) {
      fail("ready-with-unfinished-predecessor", `#${one.issue} is ready but waits on ${asList(unfinished)}`, one.issue);
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
      if (phase.status === "ready" && unfinishedPhase.length > 0) {
        fail("phase-ready-with-unfinished-predecessor", `#${one.issue} phase "${phase.id}" is ready but waits on ${asList(unfinishedPhase)}`, one.issue);
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

  for (const [gate, members] of Object.entries(plan.gates)) {
    for (const number of members) {
      if (!byNumber.has(number)) fail("gate-unknown-issue", `gate ${gate} names #${number}, which is not in the plan`, number);
    }
  }

  return { ok: failures.length === 0, failures, owners: Object.fromEntries(owners) };
}

/** Every elementary cycle reachable in blocked_by, reported once each. */
function findCycles(byNumber) {
  const cycles = [];
  const seen = new Set();
  const stack = [];
  const onStack = new Set();
  const visited = new Set();

  const walk = (number) => {
    visited.add(number);
    stack.push(number);
    onStack.add(number);
    for (const next of byNumber.get(number)?.blocked_by ?? []) {
      if (!byNumber.has(next)) continue;
      if (onStack.has(next)) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort((a, b) => a - b).join(",");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...cycle, next]);
        }
      } else if (!visited.has(next)) walk(next);
    }
    stack.pop();
    onStack.delete(number);
  };

  for (const number of byNumber.keys()) if (!visited.has(number)) walk(number);
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
export function checkGithubState(plan, snapshot) {
  const failures = [];
  const fail = (check, issue, detail) => failures.push({ check, issue, detail });

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
    if (!labels.has(`status:${one.status}`)) {
      fail("status-label-mismatch", one.issue, `expected status:${one.status}, found ${[...labels].filter((l) => l.startsWith("status:")).join(", ") || "none"}`);
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

/** What an agent is allowed to start right now, decided from the manifest and nothing else. */
export function nextWork(plan) {
  const ready = plan.issues.filter((one) => one.status === "ready").map((one) => one.issue);
  const phaseReady = plan.issues
    .filter((one) => one.status !== "ready")
    .flatMap((one) =>
      one.phases.filter((phase) => phase.status === "ready").map((phase) => ({ issue: one.issue, phase: phase.id, code_integration_allowed: phase.code_integration_allowed }))
    );
  return { ready, phase_ready: phaseReady };
}
