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

/**
 * The phases that exist, and what each is permitted to do. A plan may not answer this differently.
 *
 * Pinning only the identifiers was not enough: flipping #572's `read-only-audit` phase to
 * `code_integration_allowed: true` passed every check, because the scope rule fires only when the
 * parent issue is blocked and #572 is ready. The permission is the part that matters, so the
 * permission is what is pinned.
 */
export const PHASED_ISSUES = Object.freeze({
  556: {
    "feasibility-proof": { code_integration_allowed: false },
    "final-integration": { code_integration_allowed: true }
  },
  572: {
    "read-only-audit": { code_integration_allowed: false },
    "final-deletion": { code_integration_allowed: false }
  }
});

/**
 * Where an issue's evidence has to come from, fixed outside the document it checks.
 *
 * `evidence_bindings: {}` made every digest confirmation vacuously true, and
 * `owned_paths: ["README.md"]` made "the pull request changed something this issue owns" satisfiable
 * by a documentation edit. Both were one-line edits to the file being checked. A binding an issue
 * must have belongs beside the exclusion list and the phase contract, not inside the plan.
 */
export const EVIDENCE_CONTRACT = Object.freeze({
  553: { fields: ["controller_subject_probe_digests", "attack_matrix", "process_cleanup_matrix", "mutation"] },
  554: { fields: ["executable_identity_binding", "credential_canary", "mutation"] },
  555: { fields: ["env_allowlist_digest", "leak_canary", "mutation"] },
  556: { fields: ["isolation_backend", "boundary_canary", "platform_lane", "mutation"] },
  557: { fields: ["actual_effect_observation", "safety_canary", "mutation"] },
  558: { fields: ["route_oracle_digest", "counterfactual", "mutation"] },
  559: { fields: ["result_schema_digest", "aggregation_vectors", "mutation"] },
  560: { fields: ["operator_event_schema_digest", "opportunity_binding", "mutation"] },
  561: { fields: ["model_identity_digest", "comparability_rule", "mutation"] },
  562: { fields: ["frozen_contract_digests", "mutation"] },
  563: { fields: ["form_completion_gate", "withheld_states", "mutation"] },
  564: { fields: ["suite_form_digests", "form_equivalence_status", "mutation"] },
  565: { fields: ["holdout_floor", "precision_recall", "undecided_gate", "mutation"] },
  566: { fields: ["cap_trigger_cells", "verifier_evidence", "mutation"] },
  567: { fields: ["raw_byte_digest_api", "mutation"] },
  568: { fields: ["band_removal_proof", "uncertainty_surface", "mutation"] },
  569: { fields: ["stable_main_sha", "gate_matrix", "branch_protection"] },
  570: { fields: ["pinned_action_shas", "supply_chain_check", "mutation"], bindings: {"pinned_action_shas": "governance/action-pin-policy.json"} },
  571: { fields: ["tarball_sha256", "sbom", "provenance", "install_manifest_digest"] },
  572: { fields: ["audit_report_digest", "deletion_log"] },
  573: { fields: ["final_closeout_report", "evidence_bundle_digest"] },
  574: { fields: ["discovery_matrix", "profile_digest", "mutation"] },
  575: { fields: ["orchestration_ledger", "idempotency_proof", "mutation"] },
  576: { fields: ["relay_protocol_digest", "initial_before_advice_proof", "mutation"] },
  577: { fields: ["install_receipt", "manifest_verification", "clean_install_matrix"] },
  578: { fields: ["zero_context_ux_ledger", "cycle_id", "profiles_delivered", "evidence_bundle_digest"] },
  582: { fields: ["construct_map_digest", "evidence_model_digest", "task_model_digest", "use_argument_digest", "cell_mapping", "mutation"] },
  583: { fields: ["reliance_event_schema_digest", "opportunity_floor", "mutation"] },
  584: { fields: ["facet_record_digest", "uncertainty_status", "generalizability_default", "mutation"] },
  585: { fields: ["form_class_registry", "exposure_ledger", "transfer_classification", "mutation"] },
  586: { fields: ["validation_registry_digest", "claim_stage", "forbidden_use_policy", "mutation"] },
  588: { fields: ["manifest_digest", "schema_digest", "canonical_issue_count", "live_audit", "mutation"], bindings: {"manifest_digest": "governance/v0.2.0-execution-plan.json", "schema_digest": "schemas/aos-execution-plan.v1.schema.json"} }
});

/** An issue's owned paths must include somewhere work actually happens, not only prose. */
const DOCUMENTATION_ONLY = /^(docs\/|README|CHANGELOG|LICENSE|SECURITY|CONTRIBUTING)/;
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
    // Characters, not UTF-16 code units, and `u` on the pattern. A single emoji is one character
    // and two code units, so the previous version called "\u{1F600}" long enough for minLength 2
    // and matched it against `^..$`.
    const characters = [...value].length;
    if (schema.minLength !== undefined && characters < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && characters > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined) {
      // No fallback to a non-unicode regex. `\\8` is invalid under `u` and legal without it, so the
      // fallback quietly evaluated a *different* pattern from the one the schema wrote down.
      let pattern = null;
      try {
        pattern = new RegExp(schema.pattern, "u");
      } catch {
        fail(`the pattern ${schema.pattern} is not a valid unicode regular expression`);
      }
      if (pattern && !pattern.test(value)) fail(`does not match ${schema.pattern}`);
    }
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

/** Every fact the live audit has to establish before a closed issue counts as implemented. */
export const REQUIRED_CONFIRMATIONS = Object.freeze([
  "evidence_digests_match",
  "pr_changed_owned_files",
  "commit_exists",
  "commit_on_integration_branch",
  "pr_merged",
  "pr_targets_integration_branch",
  "pr_closes_issue",
  "pr_produced_the_commit",
  "ci_runs_succeeded",
  "ci_runs_ran_on_this_work"
]);

/**
 * Does `from` transitively wait on `to`?
 *
 * A breadth-first search per question, rather than a closure for the whole graph. The closure was
 * both recursive -- a twelve-thousand-node ring overflowed the stack -- and quadratic in memory on
 * exactly that shape, where every node waits on every other. There are only a handful of declared
 * parallel peers to check, so asking one question at a time is cheaper than answering all of them.
 */
function waitsOn(from, to, byNumber, budget = 100_000) {
  const seen = new Set([from]);
  const queue = [from];
  let head = 0;
  let steps = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    for (const predecessor of byNumber.get(node)?.blocked_by ?? []) {
      steps += 1;
      if (steps > budget) return false;
      if (predecessor === to) return true;
      if (!byNumber.has(predecessor) || seen.has(predecessor)) continue;
      seen.add(predecessor);
      queue.push(predecessor);
    }
  }
  return false;
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
  // Exactly the contract's three. A floor let an extra number be added, and `checkGithubState` then
  // looked only at the constants -- so the plan could name an exclusion nobody ever checked.
  for (const excluded of EXCLUDED_ISSUES) {
    if (!plan.excluded_issues.includes(excluded)) {
      fail("excluded-issue-dropped", `#${excluded} is excluded by contract and the plan does not list it`, excluded);
    }
  }
  for (const excluded of plan.excluded_issues) {
    if (!EXCLUDED_ISSUES.includes(excluded)) {
      fail("excluded-issue-invented", `#${excluded} is not one of the contract's excluded issues`, excluded);
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

  // A plan that is not the canonical set is already rejected, and running graph analysis over it
  // answers a question nobody asked at a cost nobody bounded -- a twelve-thousand-node ring is
  // schema-valid and took ninety seconds. The count check has already failed by here.
  if (missing.length > 0 || unknown.length > 0 || byNumber.size !== CANONICAL_ISSUE_COUNT) {
    fail("graph-checks-skipped", "the issue set is not canonical, so the dependency graph was not analysed");
    return { ok: false, failures, owners: {} };
  }

  const cycles = findCycles(byNumber);
  for (const cycle of cycles) {
    fail("dependency-cycle", cycle.map((number) => `#${number}`).join(" -> "), cycle[0]);
  }
  // A truncated search must never read as a complete one.
  if (cycles.truncated) fail("cycle-search-truncated", "the cycle search hit its bound, so this list is not every cycle");

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
    // Not "release-critical implies evidence" -- *every* canonical issue, because
    // `release_critical: false` was one edit away and it switched the evidence gate off from inside
    // the document the gate reads. #572 with `close_evidence_required: false`, `phases: []` and no
    // required fields passed every check while being marked done with nothing behind it.
    if (!one.close_evidence_required) {
      fail("release-critical-needs-close-evidence", `#${one.issue} has no close-evidence contract`, one.issue);
    }
    if (one.required_evidence_fields.length === 0) {
      fail("close-evidence-fields-empty", `#${one.issue} requires close evidence but names no fields`, one.issue);
    }
    if (one.owned_paths.length === 0) {
      fail("owned-paths-empty", `#${one.issue} owns no path, so nothing can show work was done on it`, one.issue);
    }
    // Documentation is not where an implementation issue does its work. Narrowing owned_paths to
    // README.md would have made "the pull request changed something this issue owns" true of a
    // typo fix.
    if (one.kind !== "epic" && one.kind !== "audit" && one.owned_paths.every((path) => DOCUMENTATION_ONLY.test(path))) {
      fail("owned-paths-documentation-only", `#${one.issue} owns only prose, so no change to it can show work was done`, one.issue);
    }
    for (const [field, path] of Object.entries(one.evidence_bindings)) {
      if (!one.required_evidence_fields.includes(field)) {
        fail("evidence-binding-unknown-field", `#${one.issue} binds "${field}" to ${path} but does not require it`, one.issue);
      }
    }
    if (EVIDENCE_CONTRACT[one.issue] === undefined) {
      fail("evidence-contract-missing", `#${one.issue} has no pinned evidence contract`, one.issue);
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
  for (const [number, required] of Object.entries(PHASED_ISSUES)) {
    const one = byNumber.get(Number(number));
    if (!one) continue;
    const declared = one.phases.map((phase) => phase.id).sort();
    if (JSON.stringify(declared) !== JSON.stringify(Object.keys(required).sort())) {
      fail("phases-do-not-match-contract", `#${number} must declare the phases ${Object.keys(required).join(", ")}, found ${declared.join(", ") || "none"}`, Number(number));
      continue;
    }
    for (const phase of one.phases) {
      if (phase.code_integration_allowed !== required[phase.id].code_integration_allowed) {
        fail("phases-do-not-match-contract", `#${number} phase "${phase.id}" may${required[phase.id].code_integration_allowed ? "" : " not"} integrate code, and the plan says otherwise`, Number(number));
      }
    }
  }

  for (const [number, contract] of Object.entries(EVIDENCE_CONTRACT)) {
    const one = byNumber.get(Number(number));
    if (!one) continue;
    // The fields themselves, not only that there are some. `required_evidence_fields: ["x"]` was a
    // one-line edit that satisfied "non-empty" while asking for nothing.
    if (JSON.stringify([...one.required_evidence_fields].sort()) !== JSON.stringify([...contract.fields].sort())) {
      fail("evidence-fields-do-not-match-contract", `#${number} must require ${contract.fields.join(", ")}`, Number(number));
    }
    for (const [field, path] of Object.entries(contract.bindings ?? {})) {
      if (one.evidence_bindings[field] !== path) {
        fail("evidence-binding-dropped", `#${number} must bind "${field}" to ${path}, found ${one.evidence_bindings[field] ?? "nothing"}`, Number(number));
      }
      if (!one.required_evidence_fields.includes(field)) {
        fail("evidence-binding-dropped", `#${number} must require "${field}"`, Number(number));
      }
    }
  }

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
      // An issue is not done while a phase of it is withheld. Moving #572 to `done` while
      // `final-deletion` still waited on #578 passed every other check, and #572's withheld phase
      // is the one that deletes branches.
      if (one.status === "done" && phase.status !== "done") {
        fail("done-with-unfinished-phase", `#${one.issue} is done while phase "${phase.id}" is ${phase.status}`, one.issue);
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
  for (const gate of GATE_NAMES) {
    // Deleting a gate and folding its issues into another one passed every other check while
    // erasing a release condition, so the set is fixed in both directions.
    if (!Object.hasOwn(plan.gates, gate)) fail("gate-missing", `gate ${gate} is not in the plan`);
  }
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
    for (const peer of one.allowed_parallel_with) {
      if (waitsOn(one.issue, peer, byNumber) || waitsOn(peer, one.issue, byNumber)) {
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
export const MAX_REPORTED_CYCLES = 50;

/**
 * Tarjan's strongly connected components, iteratively so a deep graph cannot overflow the stack.
 *
 * This is what makes cycle detection safe on inputs that are not cyclic at all. A dense *acyclic*
 * graph has zero cycles and exponentially many simple paths, and the enumeration below explored all
 * of them before finding nothing: thirty-two issues each depending on every higher-numbered one hung
 * the check outright. Every elementary cycle lies inside one strongly connected component, so
 * anything not in a non-trivial component is not worth walking.
 */
function stronglyConnected(byNumber) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  for (const root of byNumber.keys()) {
    if (index.has(root)) continue;
    const work = [{ node: root, edge: 0 }];
    while (work.length > 0) {
      const frame = work.at(-1);
      const { node } = frame;
      if (frame.edge === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const edges = (byNumber.get(node)?.blocked_by ?? []).filter((one) => byNumber.has(one));
      if (frame.edge < edges.length) {
        const next = edges[frame.edge];
        frame.edge += 1;
        if (!index.has(next)) work.push({ node: next, edge: 0 });
        else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
        continue;
      }
      if (low.get(node) === index.get(node)) {
        const component = [];
        for (;;) {
          const member = stack.pop();
          onStack.delete(member);
          component.push(member);
          if (member === node) break;
        }
        components.push(component);
      }
      work.pop();
      const parent = work.at(-1);
      if (parent) low.set(parent.node, Math.min(low.get(parent.node), low.get(node)));
    }
  }
  return components;
}

/**
 * Every elementary cycle, reported once each, within a bound.
 *
 * Two bounds, because they fail differently. The cycle count stops a graph with more cycles than
 * anyone would read; the step budget stops a graph whose *search* is expensive even though its
 * answer is small. Hitting either is itself reported, so a truncated search never reads as a clean
 * one.
 */
function findCycles(byNumber) {
  const cycles = [];
  let steps = 0;
  let truncated = false;
  const BUDGET = 200_000;

  for (const component of stronglyConnected(byNumber)) {
    if (cycles.length >= MAX_REPORTED_CYCLES || truncated) break;
    // A component of one is a cycle only if the node depends on itself, and that is reported
    // separately as a self-dependency.
    if (component.length < 2) continue;
    const inside = new Set(component);
    const nodes = [...component].sort((a, b) => a - b);

    for (const start of nodes) {
      if (cycles.length >= MAX_REPORTED_CYCLES || truncated) break;
      // Iterative. A recursive walk overflowed the stack on a twelve-thousand-node ring before any
      // bound could report anything, and a RangeError is not a finding -- it reads as the tool
      // being broken rather than the plan being wrong.
      const stack = [];
      const onStack = new Set();
      const frames = [{ node: start, edge: 0 }];
      onStack.add(start);
      stack.push(start);

      while (frames.length > 0) {
        if (cycles.length >= MAX_REPORTED_CYCLES || truncated) break;
        const frame = frames.at(-1);
        const edges = byNumber.get(frame.node)?.blocked_by ?? [];
        if (frame.edge >= edges.length) {
          frames.pop();
          onStack.delete(stack.pop());
          continue;
        }
        const next = edges[frame.edge];
        frame.edge += 1;
        steps += 1;
        if (steps > BUDGET) {
          truncated = true;
          break;
        }
        if (!inside.has(next) || next < start) continue;
        if (next === start) cycles.push([...stack, start]);
        else if (!onStack.has(next)) {
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, edge: 0 });
        }
      }
    }
  }
  cycles.truncated = truncated || cycles.length >= MAX_REPORTED_CYCLES;
  return cycles;
}

// --- GitHub state ----------------------------------------------------------------------------

/** A strict ISO-8601 instant whose fields name a day that exists. */
export function isRealInstant(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value ?? "");
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match.map((one) => one);
  const [y, mo, d, h, mi, se] = [year, month, day, hour, minute, second].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 60) return false;
  // Computed, not delegated. `Date.UTC(0, …)` maps years 0-99 to 1900-1999, so year 0000 -- a leap
  // year in the proleptic Gregorian calendar -- was told February had 28 days.
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > lengths[mo - 1]) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  // A leap second is a valid RFC 3339 instant that `Date.parse` refuses, so it is checked above and
  // not asked of the parser.
  return se === 60 || Number.isFinite(Date.parse(value));
}

export const expectedState = (status) => (status === "done" ? "closed" : "open");

/**
 * The manifest against a snapshot of the issues.
 *
 * The snapshot is the same shape whether it came from a committed fixture or from a live read, so
 * the release audit runs the checks the suite already ran rather than a second, looser copy.
 */
export const SNAPSHOT_SCHEMA = "aos-github-issue-state.v1";
export const SNAPSHOT_SOURCES = Object.freeze(["live", "snapshot"]);

export function checkGithubState(plan, snapshot, { expectedSource = "snapshot" } = {}) {
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
  // The caller says how it obtained the file, and the file has to agree. Otherwise a hand-written
  // offline snapshot can stamp itself `live` and read, in the evidence bundle, as an audit that
  // talked to GitHub.
  if (snapshot?.source !== expectedSource) {
    fail("snapshot-source-mismatch", null, `this run read a ${expectedSource} snapshot and the file says ${snapshot?.source ?? "nothing"}`);
  }
  if (!SNAPSHOT_SOURCES.includes(snapshot?.source)) {
    fail("snapshot-unknown-source", null, `source must be one of ${SNAPSHOT_SOURCES.join(", ")}, found ${snapshot?.source ?? "nothing"}`);
  }
  // The checks inside the snapshot were made against some branch. If it is not the branch that
  // ships, they are checks about something else -- `--write-snapshot --branch anything` was
  // otherwise invisible afterwards.
  if (snapshot?.integration_branch !== plan.integration_branch) {
    fail("snapshot-wrong-branch", null, `the plan integrates on ${plan.integration_branch}, the snapshot was taken against ${snapshot?.integration_branch ?? "nothing"}`);
  }
  // Strict ISO-8601. `Date.parse` accepts "0" and a dozen other things that are not a capture time.
  // Shape *and* calendar. "2026-99-99T99:99:99+99:99" has the shape of an instant and is not one,
  // and "2026-02-30" is worse: it parses, and Date silently rolls it over to the second of March.
  // A re-parse cannot catch that -- it agrees with itself -- so the fields are checked directly.
  if (!isRealInstant(snapshot?.captured_at)) {
    fail("snapshot-undated", null, `captured_at is not a real ISO-8601 instant: ${snapshot?.captured_at || "nothing"}`);
  }
  if (!Array.isArray(snapshot?.issues)) {
    fail("snapshot-empty", null, "the snapshot carries no issues");
    return { ok: false, failures };
  }

  // A Map silently keeps the last entry, so appending a second copy of an issue let the second one
  // answer for the first.
  const seen = new Set();
  for (const one of snapshot.issues) {
    if (seen.has(one.number)) fail("snapshot-duplicate-issue", one.number, "the snapshot carries this issue more than once");
    seen.add(one.number);
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
    // A done issue must be closed as completed. Rejecting `not_planned` alone left `duplicate`,
    // which GitHub also offers and which says the work was never done here either.
    if (one.status === "done" && live.state_reason !== "completed") {
      fail("closed-not-planned", one.issue, `a done issue must be closed as completed, not as ${live.state_reason ?? "nothing"}`);
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

  // Absence is not a pass. Deleting the three excluded issues from the snapshot switched this check
  // off from the file it checks, which is the same shape as emptying `excluded_issues` was.
  for (const excluded of new Set([...EXCLUDED_ISSUES, ...plan.excluded_issues])) {
    const live = byNumber.get(excluded);
    if (!live) {
      fail("excluded-issue-not-in-snapshot", excluded, "the snapshot does not carry the excluded issue, so its state cannot be checked");
      continue;
    }
    if (live.milestone === plan.milestone && live.state === "open") {
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
export function auditCloseEvidence(plan, snapshot, { live = false } = {}) {
  // The caller asks for the live path; the *file* decides whether it gets it. `{live: true}` over a
  // committed snapshot was a caller-supplied assertion that nothing checked, which is the same
  // shape as the record it exists to distrust.
  const failures = [];
  const unestablished = [];
  const fail = (check, issue, detail) => failures.push({ check, issue, detail });
  if (!Array.isArray(snapshot?.issues)) {
    fail("snapshot-empty", null, "the snapshot carries no issues, so no evidence can be read from it");
    return { ok: false, failures, unestablished, established: false };
  }
  const byNumber = new Map(snapshot.issues.map((one) => [one.number, one]));
  const isLive = live && snapshot.source === "live";
  if (live && !isLive) {
    fail("close-evidence-not-live", null, `a live audit was asked for and the snapshot says source ${snapshot.source ?? "nothing"}`);
  }

  for (const one of plan.issues) {
    const live = byNumber.get(one.issue);
    if (!live || live.state !== "closed") continue;

    // Offline, the confirmations in the file are unauthenticated: a contributor who cannot pass the
    // live write-access check can still edit the fixture in their own pull request and set every
    // boolean to true. So an offline run does not *assert* that evidence holds -- it reports the
    // issue as unestablished and leaves the assertion to the live audit, which the release gate
    // requires. Saying "PASS" from a file the author controls would be the same mistake as reading
    // a verdict out of a comment.
    if (!isLive) {
      unestablished.push({ issue: one.issue, reason: "close evidence is only established by a live audit" });
      continue;
    }

    const record = live.close_evidence;
    if (record && record.author_trusted !== true) {
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
    // Every component, not the summary. `{"verified": true}` alone was a one-key forgery of the
    // whole audit; the parts have to be present and true individually.
    if (checked && typeof checked === "object") {
      const absent = REQUIRED_CONFIRMATIONS.filter((key) => checked[key] !== true);
      if (absent.length > 0 && checked.verified === true) {
        fail("close-evidence-unverified", one.issue, `the confirmation claims to have passed while ${absent.join(", ")} did not`);
        continue;
      }
    }
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
    // A non-empty string or a finite number. `[]`, `{}`, `false` and `0` were all "present" and
    // none of them is a digest, a canary result or a count.
    const meaningful = (value) =>
      (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isFinite(value) && value > 0);
    const absent = one.required_evidence_fields.filter((field) => !meaningful(evidence[field]));
    if (absent.length > 0) {
      fail("close-evidence-field-missing", one.issue, `the issue requires ${absent.join(", ")}`);
    }
  }

  return { ok: failures.length === 0, failures, unestablished, established: isLive };
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
    // Keys as the v1 schema published them: `in_progress`, not `in-progress`. Renaming a field
    // without renaming the schema hands every existing consumer an `undefined` and no error.
    counts: Object.fromEntries(
      ["ready", "blocked", "in-progress", "done", "tracking"].map((status) => [
        status.replace("-", "_"),
        plan.issues.filter((one) => one.status === status).length
      ])
    ),
    next_work: nextWork(plan),
    close_evidence_established: reports.evidence.established === true,
    close_evidence_unestablished: (reports.evidence.unestablished ?? []).map((one) => one.issue),
    // Three words, so a consumer cannot read success out of a run that established nothing. `ok`
    // stayed true, the exit status stayed 0 and the printed line began "PASS" -- every
    // machine-readable signal said the same thing whether or not the evidence had been checked.
    verdict:
      failures.length > 0
        ? "FAIL"
        : reports.evidence.established === true || (reports.evidence.unestablished ?? []).length === 0
          ? "PASS"
          : "INCOMPLETE",
    // Lane, check name and issue number only. No title, no body, no path, no token: this object is
    // published, and a leak here is a leak once and for ever.
    failures: failures.map((one) => ({ lane: one.lane, check: one.check, issue: one.issue ?? null })),
    // `ok` means "nothing this run could check was wrong". It is deliberately not the same question
    // as `verdict`, and the field name alone cannot carry that distinction, which is why `verdict`
    // exists and is the one to read.
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
