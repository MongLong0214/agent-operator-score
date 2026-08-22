import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { validateArtifactManifestV3 as validateArtifactManifestV3Module } from "./validate-artifact-manifest.mjs";
import { deriveGitHubAcceptance } from "./derive-github-acceptance.mjs";

const execFileAsync = promisify(execFile);

const PHASES = new Set([
  "planned",
  "gate_preparation",
  "ready_for_red",
  "red",
  "implementing",
  "review",
  "ci",
  "merged_pending_post_ci",
  "verified",
  "superseded",
  "invalidated"
]);

const READINESS = new Set(["ready", "blocked", "active", "terminal", "unknown"]);

export const BLOCKER_CODES = new Set([
  "DEPENDENCY_UNVERIFIED",
  "MILESTONE_GATE_BLOCKED",
  "ADR_GATE_MISSING",
  "PRD_GATE_MISSING",
  "TICKET_GATE_MISSING",
  "TICKET_CONTRACT_CONFLICT",
  "TICKET_CONTRACT_INCOMPLETE",
  "EXECUTION_PACKET_MISSING",
  "OWNERSHIP_OVERLAP",
  "RED_CONTRACT_INVALID",
  "EXACT_HEAD_CI_FAILED",
  "CUMULATIVE_REVIEW_MISSING",
  "MERGE_AUTHORIZATION_MISSING",
  "POST_MERGE_CI_MISSING",
  "POST_MERGE_CI_FAILED",
  "EXTERNAL_STATE_UNAVAILABLE",
  "STALE_DIGEST",
  "WRONG_TARGET",
  "COMPLETION_EFFECT_REVERTED",
  "COMPLETION_EFFECT_UNKNOWN"
]);

const RUNTIME_KEYS = new Set(["current_head", "resolved_at", "runtime"]);

const DEFAULT_ROOT = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const blocker = (code, reason) => {
  if (!BLOCKER_CODES.has(code)) {
    throw new Error(`unregistered blocker code ${code}`);
  }
  return { code, reason };
};

const normalizeGitHubRepository = (remoteUrl) => {
  if (typeof remoteUrl !== "string") return null;
  const value = remoteUrl.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match = value.match(/^(?:(?:https?|ssh):\/\/)?(?:[^@/]+@)?github\.com(?::|\/)([^/]+)\/([^/]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
};

const git = (root, args) => {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
};

const deriveRuntimeIdentity = (root) => {
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  const repository = normalizeGitHubRepository(remote);
  const head = git(root, ["rev-parse", "HEAD"]);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return { repository, branch, head };
};

const loadJsonIfExists = (path) => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const SCHEMA_RELATIVE_PATH = "specs/execution-state.schema.v1.json";

const REQUIRED_FACT_ARRAYS = [
  "gateBatches",
  "gatePRs",
  "postMergeCI",
  "verifiedTickets",
  "issues",
  "prs",
  "reviews",
  "authorizations",
  "checkRuns",
  "workflowRuns",
  "activeOwnership"
];

const REQUIRED_FACT_OBJECTS = ["tickets", "liveDigests", "permissions", "workflowBlobs", "operationalAuthority"];

/**
 * Bounded draft-2020-12 validator covering constructs used by the checked-in
 * execution-state schema. Schema file is loaded and enforced (not dead code).
 */
export const validateAgainstSchema = (value, schema, rootSchema = schema, path = "$") => {
  const errors = [];
  if (!plainObject(schema)) {
    return [`${path}: schema must be an object`];
  }

  if (schema.$ref) {
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/$defs/")) {
      return [`${path}: unsupported $ref ${schema.$ref}`];
    }
    const defName = schema.$ref.slice("#/$defs/".length);
    const def = rootSchema.$defs?.[defName];
    if (!def) return [`${path}: missing $defs.${defName}`];
    return validateAgainstSchema(value, def, rootSchema, path);
  }

  if (schema.anyOf) {
    const nested = schema.anyOf.map((entry, index) =>
      validateAgainstSchema(value, entry, rootSchema, `${path}/anyOf/${index}`)
    );
    if (nested.some((list) => list.length === 0)) return [];
    return [`${path}: anyOf failed`, ...nested.flat()];
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value not in enum`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((type) => {
      if (type === "object") return plainObject(value);
      if (type === "array") return Array.isArray(value);
      if (type === "string") return typeof value === "string";
      if (type === "boolean") return typeof value === "boolean";
      if (type === "number") return typeof value === "number" && Number.isFinite(value);
      if (type === "integer") return Number.isInteger(value);
      if (type === "null") return value === null;
      return false;
    });
    if (!ok) errors.push(`${path}: wrong type`);
  }

  if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${path}: minLength`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => {
      errors.push(...validateAgainstSchema(entry, schema.items, rootSchema, `${path}/${index}`));
    });
  }

  if (plainObject(value) && (schema.properties || schema.required || schema.additionalProperties !== undefined)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required ${key}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) {
        errors.push(...validateAgainstSchema(child, schema.properties[key], rootSchema, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: additional property ${key}`);
      } else if (plainObject(schema.additionalProperties)) {
        errors.push(
          ...validateAgainstSchema(child, schema.additionalProperties, rootSchema, `${path}.${key}`)
        );
      }
    }
  }

  return errors;
};

export const loadExecutionStateSchema = (root = DEFAULT_ROOT) => {
  const schemaPath = resolve(root, SCHEMA_RELATIVE_PATH);
  const schema = loadJsonIfExists(schemaPath);
  if (!schema) return { ok: false, schema: null, errors: [`missing schema ${SCHEMA_RELATIVE_PATH}`] };
  return { ok: true, schema, errors: [] };
};

export const validateFactsCorpus = (facts) => {
  const failures = [];
  if (!plainObject(facts)) {
    return { ok: false, failures: ["facts corpus must be a plain object"] };
  }
  if (typeof facts.externalAvailable !== "boolean") {
    failures.push("externalAvailable must be a boolean");
  }
  if (typeof facts.repository !== "string" || facts.repository.length === 0) {
    failures.push("repository required");
  }
  if (typeof facts.defaultBranch !== "string" || facts.defaultBranch.length === 0) {
    failures.push("defaultBranch required");
  }
  for (const key of REQUIRED_FACT_ARRAYS) {
    if (!Array.isArray(facts[key])) failures.push(`${key} must be an array`);
  }
  for (const key of REQUIRED_FACT_OBJECTS) {
    // operationalAuthority may be absent/malformed; that is a ticket-contract conflict, not a corpus shape error.
    if (key === "operationalAuthority") {
      if (facts[key] != null && !plainObject(facts[key])) {
        failures.push(`${key} must be an object when present`);
      }
      continue;
    }
    if (!plainObject(facts[key])) failures.push(`${key} must be an object`);
  }
  if (plainObject(facts.tickets) && Object.keys(facts.tickets).length === 0) {
    failures.push("empty canonical ticket corpus");
  }
  if (plainObject(facts.liveDigests) && Object.keys(facts.liveDigests).length === 0) {
    failures.push("empty live digest corpus");
  }
  // activeOwnership canonical field contract: owned_paths + owned_symbols (collector shape).
  if (Array.isArray(facts.activeOwnership)) {
    for (let index = 0; index < facts.activeOwnership.length; index += 1) {
      const entry = facts.activeOwnership[index];
      const prefix = `activeOwnership[${index}]`;
      if (!plainObject(entry)) {
        failures.push(`${prefix} must be an object`);
        continue;
      }
      if (typeof entry.ticket_id !== "string" || entry.ticket_id.length === 0) {
        failures.push(`${prefix}.ticket_id must be a non-empty string`);
      }
      if (!Array.isArray(entry.owned_paths)) {
        failures.push(`${prefix}.owned_paths must be an array`);
      } else if (entry.owned_paths.some((path) => typeof path !== "string")) {
        failures.push(`${prefix}.owned_paths items must be strings`);
      }
      if (!Array.isArray(entry.owned_symbols)) {
        failures.push(`${prefix}.owned_symbols must be an array`);
      } else if (entry.owned_symbols.some((symbol) => typeof symbol !== "string")) {
        failures.push(`${prefix}.owned_symbols items must be strings`);
      }
    }
  }
  // Executable tickets require present, schema-valid, nonempty owned_paths and present owned_symbols.
  if (plainObject(facts.tickets)) {
    for (const [ticketId, ticket] of Object.entries(facts.tickets)) {
      if (!plainObject(ticket)) {
        failures.push(`tickets.${ticketId} must be an object`);
        continue;
      }
      if (ticket.kind === "superseded") continue;
      const ownership = declaredOwnershipContract(ticket);
      if (!ownership.ok) {
        failures.push(`tickets.${ticketId}: ${ownership.reason}`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
};

const declaredOwnershipContract = (ticket) => {
  if (!plainObject(ticket)) {
    return { ok: false, reason: "ticket ownership contract missing" };
  }
  if (!Array.isArray(ticket.owned_paths)) {
    return { ok: false, reason: "owned_paths must be a present array" };
  }
  if (ticket.owned_paths.length === 0) {
    return { ok: false, reason: "owned_paths must be nonempty" };
  }
  if (ticket.owned_paths.some((path) => typeof path !== "string" || path.length === 0)) {
    return { ok: false, reason: "owned_paths items must be non-empty strings" };
  }
  if (!Array.isArray(ticket.owned_symbols)) {
    return { ok: false, reason: "owned_symbols must be a present array" };
  }
  if (ticket.owned_symbols.some((symbol) => typeof symbol !== "string")) {
    return { ok: false, reason: "owned_symbols items must be strings" };
  }
  return { ok: true };
};

const expectedActorPolicyFromTicket = () => ({
  governance_mode: "single_owner_agent_team",
  repository: "MongLong0214/agent-operator-score",
  target_branch: "dev",
  repository_owner: {
    login: "MongLong0214",
    type: "User"
  },
  self_authored_strings_and_registry_fields: "not_authorization",
  distinct_external_actor: "record_if_available_not_required",
  bootstrap: {
    state: "NOT_REQUIRED_UNTIL_D0_004C",
    until: "D0-004C is merged into dev",
    gate: [
      "existing CI",
      "local offline resolver/contract tests",
      "exact-head technical review evidence"
    ],
    deferred_workflow_checks: [
      "operational-state-offline",
      "exact-head-review",
      "exact-head-authorization"
    ],
    after_d0_004c_merge: "resolver_and_workflow_mode_required_fail_closed",
    fail_closed_regressions: [
      "single-owner-spoof-is-not-authorization",
      "future-check-premature",
      "bootstrap-after-c-fails-closed"
    ]
  },
  candidate_ci: {
    required_checks: [
      { name: "planning-contract (22)", workflow_path: ".github/workflows/ci.yml" },
      { name: "planning-contract (24)", workflow_path: ".github/workflows/ci.yml" },
      { name: "operational-state-offline", workflow_path: ".github/workflows/operational-state.yml" }
    ],
    required_event: "pull_request",
    target_branch: "dev",
    head_sha_relation: "equals_live_pr_head",
    workflow_blob_relation: "candidate_and_live_target_equal",
    run_selection: "latest_run_attempt_only",
    required_status: "completed",
    required_conclusion: "success",
    check_creator_app: {
      id: 15368,
      slug: "github-actions",
      owner: "github"
    }
  },
  review: {
    eligible_permissions: ["maintain", "admin"],
    must_differ_from_pr_author: false,
    protected_check: "exact-head-review",
    workflow_path: ".github/workflows/operational-state.yml",
    trusted_ref: "refs/heads/dev",
    required_event: "workflow_dispatch",
    workflow_commit_relation: "reachable_from_live_target",
    bind_workflow_blob_oid: true,
    workflow_blob_relation: "equals_live_target_blob",
    check_creator_app: "github-actions",
    external_id_prefix: "aos-exact-head-review:"
  },
  authorization: {
    eligible_permissions: ["maintain", "admin"],
    must_differ_from_pr_author: false,
    protected_check: "exact-head-authorization",
    workflow_path: ".github/workflows/operational-state.yml",
    trusted_ref: "refs/heads/dev",
    required_event: "workflow_dispatch",
    workflow_commit_relation: "reachable_from_live_target",
    bind_workflow_blob_oid: true,
    workflow_blob_relation: "equals_live_target_blob",
    check_creator_app: "github-actions",
    external_id_prefix: "aos-exact-head-authorization:"
  }
});

const actorPolicyAgrees = (policy) => {
  if (!plainObject(policy)) return false;
  return stableJson(policy) === stableJson(expectedActorPolicyFromTicket());
};

const GOVERNANCE_DECLARED_MODES = ["SOLE_OWNER_ADVISORY", "AUTHENTICATED_REVIEW"];
const GOVERNANCE_DECLARED_MODE_SET = new Set(GOVERNANCE_DECLARED_MODES);
const D0_004_AUTHORITY_MODES = new Set(["single_owner_agent_team", "single_owner_bootstrap"]);
const GOVERNANCE_MODE_CONTRACT_RELATIVE = "docs/decisions/governance-mode-contract.v1.json";
const ARTIFACT_MANIFEST_V3_RELATIVE = "docs/decisions/maintainer-gate-artifact-manifest.v3.json";
const ARTIFACT_MANIFEST_V3_SCHEMA_RELATIVE = "docs/decisions/maintainer-gate-artifact-manifest.schema.v3.json";

const governanceModeContractError = (reason) => new Error(`governance mode contract error: ${reason}`);

export const parseGovernanceModeContract = (input) => {
  if (!plainObject(input)) {
    throw governanceModeContractError("malformed contract");
  }
  if (D0_004_AUTHORITY_MODES.has(input.governance_mode)) {
    throw governanceModeContractError("D0-004 is not an authority source");
  }
  if (!Object.hasOwn(input, "current_mode")) {
    throw governanceModeContractError("missing current_mode");
  }
  if (typeof input.current_mode !== "string") {
    throw governanceModeContractError("malformed contract");
  }
  if (!GOVERNANCE_DECLARED_MODE_SET.has(input.current_mode)) {
    throw governanceModeContractError("unknown mode");
  }
  if (!Array.isArray(input.modes) || input.modes.some((mode) => typeof mode !== "string")) {
    throw governanceModeContractError("malformed contract");
  }
  if (input.modes.some((mode) => !GOVERNANCE_DECLARED_MODE_SET.has(mode))) {
    throw governanceModeContractError("unknown mode");
  }
  if (!input.modes.includes(input.current_mode)) {
    throw governanceModeContractError("contradictory current_mode");
  }
  if (input.version !== 1) {
    throw governanceModeContractError("malformed contract");
  }
  if (!plainObject(input.authenticated_review_activation)) {
    throw governanceModeContractError("malformed contract");
  }
  if (input.claims_separation_of_duties !== false) {
    throw governanceModeContractError("malformed contract");
  }
  return {
    version: 1,
    modes: [...input.modes],
    current_mode: input.current_mode,
    authenticated_review_activation: { ...input.authenticated_review_activation },
    claims_separation_of_duties: false
  };
};

export const loadGovernanceModeContract = (root = DEFAULT_ROOT) => {
  const path = resolve(root, GOVERNANCE_MODE_CONTRACT_RELATIVE);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw governanceModeContractError("malformed contract");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw governanceModeContractError("malformed contract");
  }
  return parseGovernanceModeContract(parsed);
};

export const resolveGovernanceModeResult = (input, options = {}) => {
  // Role strings are observations only. Advisory never derives a separation-of-duties claim from them.
  void options;
  try {
    parseGovernanceModeContract(input);
  } catch {
    throw governanceModeContractError("invalid contract has no fallback");
  }
  return {
    modes: [...GOVERNANCE_DECLARED_MODES],
    governance_mode: "SOLE_OWNER_ADVISORY",
    readySet: [],
    tickets: {},
    claims_merge_authorization: false,
    artifact_freeze: null,
    claims_separation_of_duties: false
  };
};

const extractExactGateBatchField = (body) => {
  if (typeof body !== "string") return { ok: false, reason: "missing body" };
  const matches = [...body.matchAll(/^Gate-Batch:\s*(\S+)\s*$/gm)];
  if (matches.length !== 1) {
    return { ok: false, reason: "exactly one structured Gate-Batch field is required" };
  }
  return { ok: true, batchId: matches[0][1] };
};

const findAcceptedGate = (facts, artifactPath, expectedSha, kind) => {
  const batches = Array.isArray(facts.gateBatches) ? facts.gateBatches : [];
  for (const batch of batches) {
    if (batch?.status !== "ACCEPTED") continue;
    const artifacts = Array.isArray(batch.required_artifacts) ? batch.required_artifacts : [];
    const match = artifacts.find(
      (artifact) =>
        artifact?.path === artifactPath &&
        artifact?.kind === kind &&
        artifact?.sha256 === expectedSha
    );
    if (!match) continue;
    const pr = (facts.gatePRs ?? []).find((candidate) => {
      if (candidate.merged !== true || candidate.base !== "dev" || candidate.head_contains_batch !== true) {
        return false;
      }
      const field = extractExactGateBatchField(candidate.body);
      return field.ok && field.batchId === batch.id;
    });
    if (!pr) continue;
    const ownerLogin = facts.owner?.login ?? facts.operationalAuthority?.repository_owner?.login;
    if (pr.merged_by !== ownerLogin) continue;
    // Independently require owner still matches repository owner fact.
    if (facts.owner?.login !== ownerLogin) continue;
    // Live authority digests must be present and exact; missing or ambiguous fails closed.
    const live = facts.liveDigests?.[artifactPath];
    if (typeof live !== "string" || live.length === 0 || live !== expectedSha) continue;
    return { batch, pr };
  }
  return null;
};

const compareRunAttempts = (left, right) => {
  const leftId = left?.run_id ?? Number.NEGATIVE_INFINITY;
  const rightId = right?.run_id ?? Number.NEGATIVE_INFINITY;
  if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  const leftAttempt = left?.run_attempt ?? Number.NEGATIVE_INFINITY;
  const rightAttempt = right?.run_attempt ?? Number.NEGATIVE_INFINITY;
  if (leftAttempt !== rightAttempt) return leftAttempt < rightAttempt ? -1 : 1;
  return 0;
};

const selectLatestRunAttempt = (runs) => {
  if (!Array.isArray(runs) || runs.length === 0) return { missing: true };
  if (runs.length === 1) return { run: runs[0] };
  const ordered = runs.some((run) => run?.run_id != null || run?.run_attempt != null);
  if (!ordered) {
    // Multiple runs without unambiguous attempt ordering fail closed.
    return { ambiguous: true };
  }
  const latest = runs.reduce((best, run) => {
    if (!best) return run;
    return compareRunAttempts(best, run) < 0 ? run : best;
  }, null);
  // Ambiguity is disagreement, not repetition. Rows tie on (run_id, run_attempt), and two rows
  // carrying the same run_id ARE the same run: a pull request that links both a Gate-Batch and a
  // Ticket-Completion receipt is selected into the gate corpus and the completion corpus, and each
  // pass fetches and records the same workflow run. Failing closed on that made both receipts
  // report POST_MERGE_CI_MISSING while the merge commit's CI was green, and nothing warned.
  //
  // What must still fail closed is two rows that claim the same run and disagree about how it
  // ended — that is a real conflict about the same fact, and picking either answer would be a
  // guess.
  const ties = runs.filter((run) => compareRunAttempts(run, latest) === 0);
  if (ties.length !== 1) {
    const observations = new Set(ties.map((run) => `${String(run?.status)}\u0000${String(run?.conclusion)}`));
    if (observations.size !== 1) return { ambiguous: true };
  }
  return { run: latest };
};

const sameSha = (left, right) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

const ancestryCompareStatus = (facts, base, head) => {
  if (sameSha(base, head)) return "identical";
  if (!plainObject(facts?.ancestry)) return null;
  const direct = facts.ancestry[`${base}...${head}`];
  return typeof direct === "string" ? direct : null;
};

const isAuthenticatedAncestor = (facts, ancestor, descendant) => {
  if (sameSha(ancestor, descendant)) return true;
  const forward = ancestryCompareStatus(facts, ancestor, descendant);
  if (forward === "ahead" || forward === "identical") return true;
  const reverse = ancestryCompareStatus(facts, descendant, ancestor);
  return reverse === "behind" || reverse === "identical";
};

const isAuthenticatedDescendantOnLiveLine = (facts, mergeCommitSha, headSha) => {
  const tip = typeof facts?.currentHead === "string" ? facts.currentHead : null;
  if (!tip || typeof mergeCommitSha !== "string" || typeof headSha !== "string") return false;
  return isAuthenticatedAncestor(facts, mergeCommitSha, headSha) && isAuthenticatedAncestor(facts, headSha, tip);
};

const recordAncestryCompare = (ancestryFacts, base, head, status) => {
  if (!plainObject(ancestryFacts)) return;
  if (typeof base !== "string" || typeof head !== "string" || typeof status !== "string") return;
  ancestryFacts[`${base}...${head}`] = status;
};

// A completion's effect has two directions and they must be derived together, because each one
// decides what the other may claim. Split across two independent filters they cannot see the
// overlap, and three of the shapes below were wrong for exactly that reason.
//
//   surviving  every path the merge leaves behind: added, modified, and a rename's NEW name
//   removed    every path it takes away: deletions, and a rename's OLD name
//
// A path in both is surviving, not removed. A merge may rename `A` to `B` and add a replacement
// `A` in the same commit; GitHub then reports `A` as added and as a rename's `previous_filename`,
// and treating it as removed refuses a completion whose effect is entirely intact.
//
// Returns null when the response cannot support either answer. That is not the same as an empty
// set and must not collapse into one: a fail-closed authority owes the difference between "this
// merge deleted nothing" and "I could not tell what it deleted".
const COMMIT_FILES_PAGE_LIMIT = 300;

export const filesToEffect = (files) => {
  if (!Array.isArray(files)) return null;
  // GitHub truncates a commit's file list at 300 and this collector does not page it. A deletion
  // past the cut would read as "not deleted", so the whole answer is unavailable rather than
  // partial. Measured across all 76 completion merges here, the largest carries 38 files.
  if (files.length >= COMMIT_FILES_PAGE_LIMIT) return null;
  const surviving = [];
  const removed = [];
  for (const file of files) {
    if (!plainObject(file) || typeof file.filename !== "string" || typeof file.status !== "string") {
      return null;
    }
    if (file.status === "removed") {
      removed.push(file.filename);
      continue;
    }
    if (file.status === "renamed") {
      // A rename whose old name is missing is incomplete evidence, not a rename that removed
      // nothing -- silently skipping it reports "no removals" for a merge that had one.
      if (typeof file.previous_filename !== "string") return null;
      removed.push(file.previous_filename);
    }
    surviving.push(file.filename);
  }
  const survivingSet = new Set(surviving);
  return {
    changed: [...surviving].sort(),
    removed: removed.filter((path) => !survivingSet.has(path)).sort()
  };
};

const postMergeStatus = (facts, mergeCommitSha) => {
  const all = Array.isArray(facts.postMergeCI) ? facts.postMergeCI : [];
  const exact = all.filter(
    (run) => sameSha(run.merge_commit_sha, mergeCommitSha) && sameSha(run.head_sha, mergeCommitSha)
  );
  if (exact.length) {
    const selected = selectLatestRunAttempt(exact);
    if (selected.ambiguous) return { missing: true };
    if (selected.run) {
      const latest = selected.run;
      if (latest.status === "completed" && latest.conclusion === "success") return { ok: true };
      if (latest.status === "completed" && (latest.conclusion === "failure" || latest.conclusion === "cancelled")) {
        return { failed: true };
      }
    }
  }
  const descendantSuccess = all.some(
    (run) =>
      run.status === "completed" &&
      run.conclusion === "success" &&
      typeof run.head_sha === "string" &&
      !sameSha(run.head_sha, mergeCommitSha) &&
      isAuthenticatedDescendantOnLiveLine(facts, mergeCommitSha, run.head_sha)
  );
  if (descendantSuccess) return { ok: true };
  return { missing: true };
};

const ticketPathFor = (facts, ticketId) => {
  const digests = facts.liveDigests ?? {};
  return Object.keys(digests).find((path) => path.includes(`/${ticketId}-`) || path.endsWith(`/${ticketId}.md`)) ?? null;
};

const ownershipEntryPaths = (entry) =>
  Array.isArray(entry?.owned_paths) ? entry.owned_paths : [];
const ownershipEntrySymbols = (entry) =>
  Array.isArray(entry?.owned_symbols) ? entry.owned_symbols : [];

const ownershipCollisions = (facts, ticketId) => {
  const active = Array.isArray(facts.activeOwnership) ? facts.activeOwnership : [];
  const selfRows = active.filter((entry) => entry.ticket_id === ticketId);
  const collisions = [];
  // Duplicate / ambiguous self rows fail closed (more than one active lane for this ticket).
  if (selfRows.length > 1) {
    collisions.push({ ticket: ticketId, ambiguous: true, reason: "duplicate-active-ownership-rows" });
  }
  // Canonical live ownership fields match the collector: owned_paths / owned_symbols.
  // Always union declared ticket ownership with any self row so ready tickets without a
  // self activeOwnership entry still collide against other active lanes.
  const declaredPaths = Array.isArray(facts.tickets?.[ticketId]?.owned_paths)
    ? facts.tickets[ticketId].owned_paths
    : [];
  const declaredSymbols = Array.isArray(facts.tickets?.[ticketId]?.owned_symbols)
    ? facts.tickets[ticketId].owned_symbols
    : [];
  const selfPaths = new Set([
    ...declaredPaths,
    ...selfRows.flatMap((entry) => ownershipEntryPaths(entry))
  ]);
  const selfSymbols = new Set([
    ...declaredSymbols,
    ...selfRows.flatMap((entry) => ownershipEntrySymbols(entry))
  ]);
  for (const other of active) {
    if (other.ticket_id === ticketId) continue;
    for (const path of ownershipEntryPaths(other)) {
      if (selfPaths.has(path)) collisions.push({ ticket: other.ticket_id, path });
    }
    for (const symbol of ownershipEntrySymbols(other)) {
      if (selfSymbols.has(symbol)) collisions.push({ ticket: other.ticket_id, symbol });
    }
  }
  return collisions;
};

const extractExactTicketField = (body) => {
  if (typeof body !== "string") return { ok: false, reason: "missing body" };
  const matches = [...body.matchAll(/^Ticket:\s*(\S+)\s*$/gm)];
  if (matches.length !== 1) {
    return { ok: false, reason: "exactly one structured Ticket field is required" };
  }
  return { ok: true, ticketId: matches[0][1] };
};

const extractExactLineField = (body, label) => {
  if (typeof body !== "string") return { ok: false };
  const matches = [...body.matchAll(new RegExp(`^${label}:\\s*(\\S+)\\s*$`, "gm"))];
  if (matches.length !== 1) return { ok: false };
  return { ok: true, value: matches[0][1] };
};

const extractExactCompletionField = (body) => {
  if (typeof body !== "string") return { present: false };
  const matches = [...body.matchAll(/^Ticket-Completion:\s*(\S+)\s*$/gm)];
  if (matches.length === 0) return { present: false };
  if (matches.length !== 1) return { present: true, ok: false, malformed: true };
  return { present: true, ok: true, value: matches[0][1] };
};

/** A well-formed linkage line: exactly one anchored `Ticket: <ID>` with no trailing token. */
const TICKET_FIELD_RE = /^Ticket:\s*(\S+)\s*$/gm;

/**
 * Does this body DECLARE ticket linkage, well-formed or not?
 *
 * Absence of any `Ticket:` line means the receipt is simply unlinked, which is the common
 * case for a GitHub full-text search hit that only mentions the substring in prose. A line
 * that opens with `Ticket:` but does not parse — `Ticket:` with no value, `Ticket:` with
 * only whitespace, or `Ticket: D0-001 extra` with a trailing token — is a declaration that
 * fails to state what it declares. Callers must fail closed on that rather than treating it
 * as unlinked, or a real receipt disappears from evidence behind a typo.
 */
const declaresTicketLinkage = (body) => /^Ticket:/m.test(body);

/**
 * Classify a single merged PR body against the `Ticket-Completion:` grammar for
 * ticketId. `Ticket:` remains the sole ticket-linkage field and its meaning is
 * unchanged; `Ticket-Completion:` never establishes linkage on its own and only
 * classifies a PR that is already exactly `Ticket:`-linked to ticketId (via
 * extractExactTicketField — same exact-single-structured-field discipline: exactly one
 * anchored line, no partial or fuzzy matching) as the PR author's claimed unique
 * whole-ticket completion merge. Both fields must match exactly; malformed/duplicated
 * `Ticket-Completion:` lines, or a value that disagrees with the PR's own `Ticket:`
 * value, fail closed instead of being silently ignored.
 */
export const classifyCompletionMerge = (body, ticketId) => {
  const completion = extractExactCompletionField(body);
  if (!completion.present) {
    return { isCompletion: false, failClosed: false };
  }
  if (!completion.ok) {
    return {
      isCompletion: false,
      failClosed: true,
      reason: "malformed or duplicated Ticket-Completion field"
    };
  }
  const ticketField = extractExactTicketField(body);
  if (!ticketField.ok || ticketField.ticketId !== ticketId) {
    // No matching Ticket: line linking this PR to ticketId — Ticket-Completion never
    // establishes linkage on its own, and this is not, by itself, a failure.
    return { isCompletion: false, failClosed: false };
  }
  if (completion.value !== ticketField.ticketId) {
    return {
      isCompletion: false,
      failClosed: true,
      reason: `Ticket-Completion value ${completion.value} does not match Ticket value ${ticketField.ticketId}`
    };
  }
  return { isCompletion: true, failClosed: false };
};

/**
 * True when `entry` is exactly the declared legacy completion binding for ticketId
 * (see HISTORICAL_IMPLEMENTATION_LINKAGE) — matched on the exact PR number AND exact
 * merge commit SHA, never on ticket_id alone. Only D0-001 PR #130 and D0-002 PR #143
 * ever qualify; no other ticket, PR, or merge inherits this exception.
 */
const isLegacyCompletionBinding = (ticketId, entry) => {
  const binding = HISTORICAL_IMPLEMENTATION_LINKAGE[ticketId];
  if (!binding) return false;
  return entry?.number === binding.pr_number && entry?.merge_commit_sha === binding.merge_commit_sha;
};

const isLinkedTicketPr = (pr, ticketId, targetBranch) => {
  if (!pr) return false;
  const field = extractExactTicketField(pr.body);
  if (!field.ok || field.ticketId !== ticketId) return false;
  if (pr.base !== targetBranch) return false;
  if (typeof pr.head_sha !== "string" || !/^[0-9a-f]{40}$/i.test(pr.head_sha)) return false;
  if (typeof pr.number !== "number" || !Number.isFinite(pr.number)) return false;
  return true;
};

const isOpenLiveCandidate = (pr) => {
  if (!pr) return false;
  if (pr.merged === true) return false;
  if (pr.closed === true) return false;
  if (pr.state === "closed" || pr.state === "merged") return false;
  if (pr.superseded === true || pr.state === "superseded") return false;
  return true;
};

const explicitSupersededBy = (pr) => {
  if (typeof pr?.superseded_by === "number") return pr.superseded_by;
  const field = extractExactLineField(pr?.body, "Superseded-By");
  if (field.ok && /^\d+$/.test(field.value)) return Number(field.value);
  return null;
};

const explicitSupersedes = (pr) => {
  if (typeof pr?.supersedes === "number") return pr.supersedes;
  const field = extractExactLineField(pr?.body, "Supersedes");
  if (field.ok && /^\d+$/.test(field.value)) return Number(field.value);
  return null;
};

/**
 * Link candidates only via exactly one structured Ticket field; never ticket_id alone.
 * Multiple live open Ticket candidates fail closed unless structured supersession facts
 * (state/fields/body) explicitly mark predecessors and bind the successor. PR number is
 * not supersession authority.
 */
const resolveCandidatePrs = (facts, ticketId) => {
  const targetBranch = facts.operationalAuthority?.target_branch ?? "dev";
  const linked = (Array.isArray(facts.prs) ? facts.prs : []).filter((pr) =>
    isLinkedTicketPr(pr, ticketId, targetBranch)
  );
  if (!linked.length) return { active: null, superseded: [], ambiguous: false };

  const byNumber = new Map(linked.map((pr) => [pr.number, pr]));
  const openLive = linked.filter((pr) => isOpenLiveCandidate(pr));

  if (openLive.length === 0) {
    return { active: null, superseded: [], ambiguous: false };
  }

  if (openLive.length === 1) {
    const active = openLive[0];
    const superseded = linked
      .filter((pr) => pr.number !== active.number)
      .filter((pr) => {
        const by = explicitSupersededBy(pr);
        const supersedes = explicitSupersedes(active);
        const marked = pr.superseded === true || pr.state === "superseded" || pr.closed === true || pr.state === "closed";
        return marked && (by === active.number || supersedes === pr.number);
      })
      .map((pr) => ({ number: pr.number, head_sha: pr.head_sha, base: pr.base }))
      .sort((a, b) => a.number - b.number);
    // Additional open? already only one open. Extra linked without relation are ignored (closed history).
    const unaccounted = linked.filter(
      (pr) =>
        pr.number !== active.number &&
        isOpenLiveCandidate(pr) === false &&
        !superseded.some((entry) => entry.number === pr.number) &&
        (pr.superseded === true || pr.state === "superseded")
    );
    if (unaccounted.length) {
      // Superseded markers without successor binding fail closed.
      return { active: null, superseded: [], ambiguous: true };
    }
    return { active, superseded, ambiguous: false };
  }

  // Multiple open live candidates: require explicit supersession graph reducing to one active.
  const openNumbers = new Set(openLive.map((pr) => pr.number));
  const remaining = new Set(openNumbers);
  const superseded = [];
  for (const pr of openLive) {
    const successor = explicitSupersededBy(pr);
    const marked = pr.superseded === true || pr.state === "superseded" || successor != null;
    if (!marked) continue;
    if (successor == null || !byNumber.has(successor) || successor === pr.number) {
      return { active: null, superseded: [], ambiguous: true };
    }
    // Successor must be linked for the same ticket; may itself be later superseded.
    const supersedesBack = explicitSupersedes(byNumber.get(successor));
    if (supersedesBack != null && supersedesBack !== pr.number) {
      return { active: null, superseded: [], ambiguous: true };
    }
    remaining.delete(pr.number);
    superseded.push({ number: pr.number, head_sha: pr.head_sha, base: pr.base });
  }

  if (remaining.size !== 1) {
    return { active: null, superseded: [], ambiguous: true };
  }
  const activeNumber = [...remaining][0];
  const active = byNumber.get(activeNumber);
  // Active may declare Supersedes for each predecessor; when present it must match.
  for (const entry of superseded) {
    const supersedes = explicitSupersedes(active);
    if (supersedes != null && supersedes !== entry.number && superseded.length === 1) {
      return { active: null, superseded: [], ambiguous: true };
    }
  }
  superseded.sort((a, b) => a.number - b.number);
  return { active, superseded, ambiguous: false };
};

const candidatePrFor = (facts, ticketId) => resolveCandidatePrs(facts, ticketId).active;

const evaluateCandidateCi = (facts, policy, pr, ticketId) => {
  const d0c = facts.d0_004c_merged === true;
  const required = (policy.candidate_ci?.required_checks ?? []).filter((check) => {
    if (d0c) return true;
    return check.name !== "operational-state-offline";
  });
  const head = pr.head_sha;
  const checks = Array.isArray(facts.checkRuns) ? facts.checkRuns : [];
  const runs = Array.isArray(facts.workflowRuns) ? facts.workflowRuns : [];
  const failures = [];
  const requiredAppSlug = policy.candidate_ci?.check_creator_app?.slug;
  const requiredAppId = policy.candidate_ci?.check_creator_app?.id;
  const requiredEvent = policy.candidate_ci?.required_event;
  const requiredBase = policy.candidate_ci?.target_branch;
  const liveBaseSha = facts.liveBaseSha ?? facts.targetBaseSha ?? null;

  if (typeof liveBaseSha !== "string" || !/^[0-9a-f]{40}$/i.test(liveBaseSha)) {
    failures.push("missing live target base SHA");
  } else if (typeof pr.base_sha !== "string" || pr.base_sha !== liveBaseSha) {
    failures.push("candidate base_sha does not match live target base SHA");
  }

  for (const requiredCheck of required) {
    const blobMap = facts.workflowBlobs?.[requiredCheck.workflow_path] ?? {};
    const devBlob = blobMap.dev;
    const headBlob = blobMap.heads?.[head];
    if (typeof devBlob !== "string" || devBlob.length === 0) {
      failures.push(`missing live target workflow blob for ${requiredCheck.workflow_path}`);
      continue;
    }
    if (typeof headBlob !== "string" || headBlob.length === 0) {
      failures.push(`missing candidate head workflow blob for ${requiredCheck.workflow_path}`);
      continue;
    }
    if (devBlob !== headBlob) {
      failures.push(`workflow blob mismatch for ${requiredCheck.workflow_path}`);
      continue;
    }

    const runMatches = runs.filter((entry) => entry.name === requiredCheck.name && entry.head_sha === head);
    if (!runMatches.length) {
      failures.push(`missing workflow run for ${requiredCheck.name}`);
      continue;
    }
    const selected = selectLatestRunAttempt(runMatches);
    if (selected.ambiguous || selected.missing || !selected.run) {
      failures.push(`ambiguous or missing run attempt for ${requiredCheck.name}`);
      continue;
    }
    const selectedRun = selected.run;
    if (selectedRun.run_id == null || selectedRun.run_attempt == null) {
      failures.push(`run_id and run_attempt required for ${requiredCheck.name}`);
      continue;
    }
    if (selectedRun.head_sha !== head) {
      failures.push(`stale or wrong head for run ${requiredCheck.name}`);
      continue;
    }

    // Exactly one job/check fact mapped to the selected workflow-run attempt.
    const mappedChecks = checks.filter(
      (entry) =>
        entry.name === requiredCheck.name &&
        entry.head_sha === head &&
        entry.run_id === selectedRun.run_id &&
        entry.run_attempt === selectedRun.run_attempt &&
        (entry.ticket_id === ticketId || !entry.ticket_id)
    );
    if (mappedChecks.length !== 1) {
      failures.push(`exact run-to-check mapping required for ${requiredCheck.name}`);
      continue;
    }
    const subject = mappedChecks[0];
    if (subject.run_id == null || subject.run_attempt == null) {
      failures.push(`check run_id/run_attempt required for ${requiredCheck.name}`);
      continue;
    }

    const checkFields = [
      ["app slug", subject.app_slug, requiredAppSlug],
      ["app id", subject.app_id, requiredAppId],
      ["event", subject.event, requiredEvent],
      ["base", subject.base, requiredBase],
      ["workflow path", subject.workflow_path, requiredCheck.workflow_path]
    ];
    let fieldFailed = false;
    for (const [label, actual, expected] of checkFields) {
      if (actual == null || actual === "") {
        failures.push(`missing ${label} for ${requiredCheck.name}`);
        fieldFailed = true;
        break;
      }
      if (actual !== expected) {
        failures.push(`wrong ${label} for ${requiredCheck.name}`);
        fieldFailed = true;
        break;
      }
    }
    if (fieldFailed) continue;

    const runFields = [
      ["app slug", selectedRun.app_slug, requiredAppSlug],
      ["app id", selectedRun.app_id, requiredAppId],
      ["event", selectedRun.event, requiredEvent],
      ["base", selectedRun.base, requiredBase],
      ["workflow path", selectedRun.workflow_path, requiredCheck.workflow_path]
    ];
    for (const [label, actual, expected] of runFields) {
      if (actual == null || actual === "") {
        failures.push(`missing run ${label} for ${requiredCheck.name}`);
        fieldFailed = true;
        break;
      }
      if (actual !== expected) {
        failures.push(`wrong run ${label} for ${requiredCheck.name}`);
        fieldFailed = true;
        break;
      }
    }
    if (fieldFailed) continue;

    if (subject.status !== "completed" || subject.conclusion !== "success") {
      failures.push(`required check ${requiredCheck.name} not successful`);
    }
    if (selectedRun.status !== "completed" || selectedRun.conclusion !== "success") {
      failures.push(`required workflow run ${requiredCheck.name} not successful`);
    }
  }

  return { ok: failures.length === 0, failures };
};

const permissionEligible = (facts, actor, eligible) => {
  if (!actor) return false;
  const permission = facts.permissions?.[actor];
  return eligible.includes(permission);
};

const evaluateReview = (facts, policy, pr, ticketId) => {
  const d0c = facts.d0_004c_merged === true;

  if (!d0c) {
    // Bootstrap: CTO/CEO review is an out-of-band process gate, not a resolver input.
    // No fact (formal GitHub review, comment, registry field, or premature protected
    // check) is evaluated here; the resolver simply never asserts this requirement.
    return { ok: true };
  }

  const head = pr.head_sha;

  // After C: the protected exact-head-review technical check is the review evidence.
  // A formal GitHub "APPROVED" PR review is never required here — with a single
  // repository collaborator who authors every candidate, GitHub blocks self-approval,
  // making that fact permanently unobtainable. The check itself (maintainer/admin
  // dispatched, workflow_dispatch, bound to the trusted dev workflow blob, attached to
  // this exact head) is trusted technical automation evidence, not independent approval;
  // genuine independent review is deferred to E14-003/G4.
  const checks = (facts.checkRuns ?? []).filter(
    (check) => check.name === policy.review.protected_check && check.head_sha === head
  );
  if (!checks.length) return { ok: false, reason: "exact-head-review check missing" };

  for (const check of checks) {
    if (check.status !== "completed" || check.conclusion !== "success") continue;
    if (check.app_slug !== policy.review.check_creator_app) continue;
    if (check.event !== policy.review.required_event) continue;
    if (check.workflow_path !== policy.review.workflow_path) continue;
    if (check.workflow_reachable_from_dev === false) continue;
    const devBlob = facts.workflowBlobs?.[policy.review.workflow_path]?.dev;
    if (policy.review.bind_workflow_blob_oid) {
      if (!check.workflow_blob_oid || check.workflow_blob_oid !== devBlob) continue;
    }
    const prefix = policy.review.external_id_prefix;
    if (!check.external_id || !String(check.external_id).startsWith(prefix)) continue;
    const rest = String(check.external_id).slice(prefix.length);
    if (!/^\d+:\d+$/.test(rest)) continue;
    if (!permissionEligible(facts, check.dispatch_actor, policy.review.eligible_permissions)) continue;
    return { ok: true };
  }
  return { ok: false, reason: "exact-head-review invalid" };
};

const evaluateAuthorization = (facts, policy, pr, ticketId, reviewOk) => {
  const d0c = facts.d0_004c_merged === true;

  if (!d0c) {
    // Bootstrap: the owner merge decision is an out-of-band process gate, not a resolver
    // input. No fact (CEO production PASS, comment, registry field, deployment, commit
    // status, or tag) is evaluated here, and none can make this ok:false path unreachable
    // by construction — the resolver never claims merge authorization from it. See the
    // top-level `claims_merge_authorization` output field, which stays false regardless.
    return { ok: true };
  }

  if (!reviewOk) return { ok: false, reason: "authorization requires current review" };
  const head = pr.head_sha;

  // After C: the protected exact-head-authorization technical check is the authorization
  // evidence. There is no `facts.authorizations` / ceo_production_pass producer and none
  // is built — merge authorization is an out-of-band process gate the resolver never
  // asserts (see the top-level `claims_merge_authorization` output field, which stays
  // false in every mode). The check is trusted technical automation evidence only.
  const checks = (facts.checkRuns ?? []).filter(
    (check) => check.name === policy.authorization.protected_check && check.head_sha === head
  );
  for (const check of checks) {
    if (check.status !== "completed" || check.conclusion !== "success") continue;
    if (check.app_slug !== policy.authorization.check_creator_app) continue;
    if (check.event !== policy.authorization.required_event) continue;
    if (check.workflow_path !== policy.authorization.workflow_path) continue;
    if (check.workflow_reachable_from_dev === false) continue;
    const devBlob = facts.workflowBlobs?.[policy.authorization.workflow_path]?.dev;
    if (policy.authorization.bind_workflow_blob_oid) {
      if (!check.workflow_blob_oid || check.workflow_blob_oid !== devBlob) continue;
    }
    const prefix = policy.authorization.external_id_prefix;
    if (!check.external_id || !String(check.external_id).startsWith(prefix)) continue;
    if (!permissionEligible(facts, check.dispatch_actor, policy.authorization.eligible_permissions)) continue;
    return { ok: true };
  }
  return { ok: false, reason: "exact-head-authorization invalid" };
};

const evaluateTicketGates = (facts, ticketId, ticket) => {
  const blockers = [];
  const path = ticketPathFor(facts, ticketId);
  if (!path || !ticket?.digests?.ticket) {
    blockers.push(blocker("TICKET_CONTRACT_INCOMPLETE", `${ticketId} lacks ticket digest binding`));
    return { blockers, accepted: false, mergeSha: null, postMerge: null };
  }

  // Live digest staleness relative to bound ticket digest.
  const live = facts.liveDigests?.[path];
  if (live && live !== ticket.digests.ticket) {
    blockers.push(blocker("STALE_DIGEST", `${ticketId} ticket digest is stale`));
  }

  // Bootstrap: per-ADR/PRD/ticket Gate-Batch PR facts and repeated digest acceptance are
  // not readiness conditions. The existing registry stays as historical evidence and no
  // renewal batch or gate-receipt PR is minted to satisfy this path. Current-source
  // consistency above — binding completeness and live digest staleness — still blocks,
  // and every non-gate check downstream is unchanged.
  if (facts.d0_004c_merged !== true) {
    // Waiving gate-batch PR acceptance never waives current-source consistency for the
    // authority documents the ticket itself declares. A referenced PRD/ADR that is
    // missing from the live digest corpus, or whose live content no longer matches the
    // ticket's recorded digest, still fails closed in bootstrap.
    if (ticket.digests?.prd) {
      const prdPath = ticket.prd_path ?? ticket.digests?.prd_path ?? null;
      const livePrd = prdPath ? facts.liveDigests?.[prdPath] : undefined;
      if (!prdPath || typeof livePrd !== "string" || livePrd.length === 0) {
        blockers.push(blocker("PRD_GATE_MISSING", `${ticketId} lacks a live PRD digest binding`));
      } else if (livePrd !== ticket.digests.prd) {
        blockers.push(blocker("STALE_DIGEST", `${ticketId} PRD digest is stale`));
      }
    }
    for (const [adrId, sha] of Object.entries(ticket.digests?.adrs ?? {})) {
      const adrPath =
        ticket.adr_paths?.[adrId] ??
        ticket.digests?.adr_paths?.[adrId] ??
        Object.keys(facts.liveDigests ?? {}).find((candidate) => candidate.includes(`/${adrId}-`)) ??
        null;
      const liveAdr = adrPath ? facts.liveDigests?.[adrPath] : undefined;
      if (!adrPath || typeof liveAdr !== "string" || liveAdr.length === 0) {
        blockers.push(blocker("ADR_GATE_MISSING", `${ticketId} lacks a live ADR digest binding for ${adrId}`));
      } else if (liveAdr !== sha) {
        blockers.push(blocker("STALE_DIGEST", `${ticketId} ADR digest is stale for ${adrId}`));
      }
    }
    return { blockers, accepted: blockers.length === 0, mergeSha: null, postMerge: null };
  }

  if (ticket.digests?.prd) {
    const prdPath =
      ticket.prd_path ??
      ticket.digests?.prd_path ??
      null;
    if (typeof prdPath !== "string" || !prdPath.startsWith("docs/prd/")) {
      blockers.push(blocker("PRD_GATE_MISSING", `${ticketId} lacks owning PRD path binding`));
    } else {
      const prdGate = findAcceptedGate(facts, prdPath, ticket.digests.prd, "PRD");
      if (!prdGate) blockers.push(blocker("PRD_GATE_MISSING", `${ticketId} PRD gate not accepted for ${prdPath}`));
    }
  } else {
    blockers.push(blocker("PRD_GATE_MISSING", `${ticketId} lacks PRD digest`));
  }

  const adrs = ticket.digests?.adrs ?? {};
  for (const [adrId, sha] of Object.entries(adrs)) {
    const adrPath =
      ticket.adr_paths?.[adrId] ??
      ticket.digests?.adr_paths?.[adrId] ??
      Object.keys(facts.liveDigests ?? {}).find((candidate) => candidate.includes(`/${adrId}-`)) ??
      null;
    if (typeof adrPath !== "string" || !adrPath.startsWith("docs/adr/")) {
      blockers.push(blocker("ADR_GATE_MISSING", `${ticketId} ADR path missing for ${adrId}`));
      continue;
    }
    const adrGate = findAcceptedGate(facts, adrPath, sha, "ADR");
    if (!adrGate) blockers.push(blocker("ADR_GATE_MISSING", `${ticketId} ADR gate missing for ${adrId}`));
  }

  const ticketGate = findAcceptedGate(facts, path, ticket.digests.ticket, "TICKET");
  if (!ticketGate) {
    blockers.push(blocker("TICKET_GATE_MISSING", `${ticketId} ticket gate not accepted via gate PR facts`));
    return { blockers, accepted: false, mergeSha: null, postMerge: null };
  }

  // Gate PR post-merge CI authenticates gate acceptance (not implementation verification).
  const ci = postMergeStatus(facts, ticketGate.pr.merge_commit_sha);
  if (ci.failed) {
    blockers.push(blocker("POST_MERGE_CI_FAILED", `${ticketId} gate post-merge CI failed`));
  } else if (ci.missing) {
    blockers.push(blocker("POST_MERGE_CI_MISSING", `${ticketId} gate post-merge CI missing`));
  }

  const hardGateCodes = new Set([
    "ADR_GATE_MISSING",
    "PRD_GATE_MISSING",
    "TICKET_GATE_MISSING",
    "STALE_DIGEST",
    "POST_MERGE_CI_MISSING",
    "POST_MERGE_CI_FAILED"
  ]);
  const accepted = !blockers.some((entry) => hardGateCodes.has(entry.code));
  return { blockers, accepted, mergeSha: ticketGate.pr.merge_commit_sha, postMerge: ci };
};

export const applyEffectiveGateStateToGateFacts = (facts, effectiveState = null) => {
  const empty = { freeze_inputs: [], authorization_inputs: [], ready_set: [] };
  if (!plainObject(facts)) return empty;
  const batches = Array.isArray(facts.gateBatches) ? facts.gateBatches : [];
  const records = Array.isArray(effectiveState?.records) ? effectiveState.records : null;
  if (!records || effectiveState?.ok === false) {
    return { ...facts, gateBatches: batches, ...empty };
  }
  const authorizing = new Set();
  for (const record of records) {
    if (!plainObject(record) || typeof record.source_record_id !== "string") continue;
    if (record.effective_gate_state === "ACCEPTED") authorizing.add(record.source_record_id);
  }
  const freezeInputs = [];
  const authorizationInputs = [];
  for (const batch of batches) {
    if (!plainObject(batch) || typeof batch.id !== "string") continue;
    if (!authorizing.has(batch.id) || batch.status !== "ACCEPTED") continue;
    for (const artifact of Array.isArray(batch.artifacts) ? batch.artifacts : []) {
      if (
        typeof artifact?.path !== "string" ||
        typeof artifact?.sha256 !== "string" ||
        typeof artifact?.kind !== "string"
      ) continue;
      const token = `${artifact.kind}:${artifact.path}:${artifact.sha256}`;
      freezeInputs.push(token);
      authorizationInputs.push(token);
    }
  }
  return {
    ...facts,
    gateBatches: batches,
    freeze_inputs: freezeInputs.sort(),
    authorization_inputs: authorizationInputs.sort(),
    ready_set: [],
    effective_gate_state_records: records
  };
};

export const collectArtifactManifestV3Facts = (root = DEFAULT_ROOT) => {
  const schemaPath = resolve(root, ARTIFACT_MANIFEST_V3_SCHEMA_RELATIVE);
  const manifestPath = resolve(root, ARTIFACT_MANIFEST_V3_RELATIVE);
  let schemaBytes;
  let manifestBytes;
  try {
    schemaBytes = readFileSync(schemaPath);
    manifestBytes = readFileSync(manifestPath);
  } catch {
    return { ok: false, reason: "artifact manifest v3 files unavailable", facts: null };
  }
  let schema;
  let manifest;
  try {
    schema = JSON.parse(schemaBytes.toString("utf8"));
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "artifact manifest v3 files malformed", facts: null };
  }
  return {
    ok: true,
    facts: {
      schema,
      manifest,
      schema_path: ARTIFACT_MANIFEST_V3_SCHEMA_RELATIVE,
      manifest_path: ARTIFACT_MANIFEST_V3_RELATIVE,
      schema_digest: createHash("sha256").update(schemaBytes).digest("hex"),
      manifest_digest: createHash("sha256").update(manifestBytes).digest("hex")
    }
  };
};

export const validateArtifactManifestV3ForResolution = (facts) => {
  if (!plainObject(facts) || !plainObject(facts.manifest)) {
    return { ok: false, failures: ["artifact manifest v3 facts malformed"] };
  }
  try {
    const validated = validateArtifactManifestV3Module({
      manifest: facts.manifest,
      source_registry: facts.source_registry,
      source_bytes: facts.source_bytes,
      source_sha256: facts.source_sha256,
      source_records: facts.source_records
    });
    return {
      ok: true,
      schema_version: validated.schema_version,
      manifest_id: validated.manifest_id,
      artifacts: validated.artifacts,
      manifest_digest: typeof facts.manifest_digest === "string" ? facts.manifest_digest : null
    };
  } catch (error) {
    return {
      ok: false,
      failures: [error instanceof Error ? error.message : String(error)]
    };
  }
};

const GITHUB_ACCEPTANCE_OUTAGE = "github acceptance rejected: github outage";
const GITHUB_ACCEPTANCE_FIXTURE_RELATIVE = "fixtures/governance/github-acceptance";

/**
 * Observation-only collector for inactive GitHub-acceptance facts.
 * Reuses the existing authenticated/fixture transport boundary. Not consulted
 * by collectLiveExecutionFacts or ready-set derivation.
 */
export const collectGitHubAcceptanceFacts = (root = DEFAULT_ROOT, options = {}) => {
  if (plainObject(options.facts)) {
    if (options.facts.github_outage === true) {
      return { ok: false, reason: GITHUB_ACCEPTANCE_OUTAGE, facts: null };
    }
    return { ok: true, facts: options.facts };
  }

  if (typeof options.fixture === "string" && options.fixture.length > 0 && !options.fixture.includes("/") && !options.fixture.includes("\\")) {
    try {
      const fixturePath = resolve(root, GITHUB_ACCEPTANCE_FIXTURE_RELATIVE, `${options.fixture}.json`);
      const facts = JSON.parse(readFileSync(fixturePath, "utf8"));
      return collectGitHubAcceptanceFacts(root, { facts });
    } catch {
      return { ok: false, reason: GITHUB_ACCEPTANCE_OUTAGE, facts: null };
    }
  }

  const transport = options.transport;
  if (!transport || typeof transport.getJson !== "function") {
    return { ok: false, reason: GITHUB_ACCEPTANCE_OUTAGE, facts: null };
  }
  try {
    if (typeof options.probePath === "string") {
      transport.getJson(options.probePath);
    }
    if (plainObject(options.collected)) {
      return { ok: true, facts: options.collected };
    }
    return { ok: false, reason: GITHUB_ACCEPTANCE_OUTAGE, facts: null };
  } catch {
    return { ok: false, reason: GITHUB_ACCEPTANCE_OUTAGE, facts: null };
  }
};

/**
 * Inactive exact-head acceptance candidate. Activation stays false. This result
 * never authorizes RED, accepts a gate, or freezes an artifact.
 */
export const resolveInactiveGitHubAcceptanceCandidate = (input = {}, options = {}) => {
  const collected = collectGitHubAcceptanceFacts(options.root ?? DEFAULT_ROOT, {
    facts: input,
    transport: options.transport,
    fixture: options.fixture
  });
  if (!collected.ok) {
    throw new Error(collected.reason);
  }
  return deriveGitHubAcceptance({ ...collected.facts, activation: false });
};

const ACTIVATION_FIXTURE_RELATIVE = "fixtures/governance/authenticated-review-activation";
const ACTIVATION_ELIGIBLE_PERMISSIONS = new Set(["write", "maintain", "admin"]);
const ACTIVATION_GIT_SHA = /^[0-9a-f]{40}$/i;
const ACTIVATION_MANIFEST_DIGEST = /^[a-f0-9]{64}$/;
const ACTIVATION_INACTIVE = "authenticated review activation is inactive";
const ACTIVATION_GITHUB_OUTAGE = "authenticated review activation is inactive: github outage";
const ACTIVATION_PROTECTION_404 = "authenticated review activation is inactive: protection 404";
const ACTIVATION_PARTIAL_PROTECTION = "authenticated review activation is inactive: partial protection";
const ACTIVATION_PERMISSION_LOSS = "authenticated review activation is inactive: permission loss";
const ACTIVATION_ADMIN_ENFORCEMENT =
  "authenticated review activation is inactive: administrator enforcement is required";
const ACTIVATION_LAST_PUSH = "authenticated review activation is inactive: last-push approval is required";
const ACTIVATION_USER_BYPASS = "authenticated review activation is inactive: user bypass";
const ACTIVATION_TEAM_BYPASS = "authenticated review activation is inactive: team bypass";
const ACTIVATION_APP_BYPASS = "authenticated review activation is inactive: app bypass";
const ACTIVATION_WRONG_TARGET = "authenticated review activation is inactive: wrong target";
const ACTIVATION_IDENTITY_COLLISION = "authenticated review activation is inactive: identity collision";
const ACTIVATION_ARTIFACT_MISMATCH = "authenticated review activation is inactive: artifact mismatch";
const ACTIVATION_STALE_REVIEW_DISMISSAL =
  "authenticated review activation is inactive: stale-review dismissal is required";
// Module-private: Symbol.for is the global registry, so any caller can reconstruct it.
const LIVE_ACTIVATION_FACTS = Symbol("aos.liveCollectedActivationFacts");

const rejectActivation = (message) => {
  throw new Error(message);
};

const stableActivationId = (value) => Number.isInteger(value) && value > 0;

// GitHub review states that replace a reviewer's previous state. COMMENTED and PENDING do not.
const ACTIVATION_STATE_CHANGING_REVIEWS = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

const nonemptyBypassList = (value) => Array.isArray(value) && value.length > 0;

/**
 * Observation collector for D0-009 activation facts. Reuses the existing
 * authenticated/fixture transport. Issues only GET protection, collaborator
 * permission, pull, and pull-reviews. Failures are recorded as facts; they
 * never fail the surrounding live corpus collection.
 */
export const collectAuthenticatedReviewActivationFacts = (root = DEFAULT_ROOT, options = {}) => {
  if (plainObject(options.facts)) {
    if (options.facts.github_outage === true) {
      return { ok: false, reason: ACTIVATION_GITHUB_OUTAGE, facts: options.facts };
    }
    return { ok: true, facts: options.facts };
  }

  if (
    typeof options.fixture === "string" &&
    options.fixture.length > 0 &&
    !options.fixture.includes("/") &&
    !options.fixture.includes("\\")
  ) {
    try {
      const fixturePath = resolve(root, ACTIVATION_FIXTURE_RELATIVE, `${options.fixture}.json`);
      const facts = JSON.parse(readFileSync(fixturePath, "utf8"));
      return collectAuthenticatedReviewActivationFacts(root, { facts });
    } catch {
      return { ok: false, reason: ACTIVATION_GITHUB_OUTAGE, facts: { github_outage: true } };
    }
  }

  const transport = options.transport;
  if (!transport || typeof transport.getJson !== "function") {
    return { ok: false, reason: ACTIVATION_GITHUB_OUTAGE, facts: { github_outage: true } };
  }

  const repository =
    typeof options.repository === "string" && options.repository.length > 0
      ? options.repository
      : expectedActorPolicyFromTicket().repository;
  const facts = {
    github_outage: false,
    target_branch: "dev"
  };

  const protectionResult = transportCall(transport, "getJson", `repos/${repository}/branches/dev/protection`);
  if (!protectionResult.ok) {
    if (isAuthenticatedNotFound(protectionResult)) {
      facts.protection_status = 404;
    } else {
      facts.github_outage = true;
    }
  } else {
    facts.protection_status = 200;
    const protection = protectionResult.value;
    const reviews = protection?.required_pull_request_reviews;
    const bypass = reviews?.bypass_pull_request_allowances;
    facts.required_approving_review_count = reviews?.required_approving_review_count;
    facts.dismiss_stale_reviews = reviews?.dismiss_stale_reviews;
    facts.require_last_push_approval = reviews?.require_last_push_approval;
    facts.enforce_admins = protection?.enforce_admins?.enabled;
    facts.user_bypass_allowances = Array.isArray(bypass?.users) ? bypass.users : [];
    facts.team_bypass_allowances = Array.isArray(bypass?.teams) ? bypass.teams : [];
    facts.app_bypass_allowances = Array.isArray(bypass?.apps) ? bypass.apps : [];
  }

  const readJson = (apiPath, assign) => {
    const result = transportCall(transport, "getJson", apiPath);
    if (!result.ok) {
      if (!isAuthenticatedNotFound(result)) facts.github_outage = true;
      return;
    }
    assign(result.value);
  };

  if (Number.isInteger(options.prNumber) && options.prNumber > 0) {
    readJson(`repos/${repository}/pulls/${options.prNumber}`, (pull) => {
      facts.candidate_base = pull?.base?.ref;
      if (typeof pull?.head?.sha === "string") facts.exact_head_sha = pull.head.sha;
      if (stableActivationId(pull?.user?.id)) facts.author_id = pull.user.id;
      if (stableActivationId(pull?.merged_by?.id)) facts.merger_id = pull.merged_by.id;
    });
    readJson(`repos/${repository}/pulls/${options.prNumber}/reviews`, (reviews) => {
      // A reviewer's *current* state is their latest state-changing review, not the newest
      // APPROVED anywhere in the list. Scanning in reverse for APPROVED kept a stale approval
      // alive after the same reviewer later requested changes or had the approval dismissed,
      // which misstates a live GitHub fact. COMMENTED and PENDING never change an approval on
      // GitHub, so they are not state-changing here either.
      const latestByReviewer = new Map();
      for (const review of Array.isArray(reviews) ? reviews : []) {
        if (!stableActivationId(review?.user?.id)) continue;
        if (!ACTIVATION_STATE_CHANGING_REVIEWS.has(review?.state)) continue;
        latestByReviewer.set(review.user.id, review);
      }
      let approved = null;
      for (const review of latestByReviewer.values()) {
        if (review.state === "APPROVED") approved = review;
      }
      if (approved) {
        facts.review_state = "APPROVED";
        if (typeof approved.commit_id === "string") facts.review_head_sha = approved.commit_id;
        if (stableActivationId(approved?.user?.id)) facts.reviewer_id = approved.user.id;
        if (typeof approved?.user?.login === "string" && approved.user.login.length > 0) {
          facts.reviewer_login = approved.user.login;
        }
      }
    });
  }

  // Permission is bound to the approving reviewer's identity. A separately supplied
  // reviewerLogin that names a different collaborator must not attach that
  // collaborator's permission to the approver's id.
  if (typeof facts.reviewer_login === "string" && facts.reviewer_login.length > 0) {
    readJson(`repos/${repository}/collaborators/${facts.reviewer_login}/permission`, (value) => {
      if (stableActivationId(value?.user?.id) && value.user.id === facts.reviewer_id) {
        facts.reviewer_permission = value?.permission;
        facts.reviewer_permission_id = value.user.id;
      }
    });
  }

  return { ok: facts.github_outage !== true, facts };
};

/**
 * Re-evaluate current GitHub activation facts. Does not inherit D0-008
 * derivation results. Any missing, stale, bypassable, or ambiguous fact
 * fails closed.
 */
export const evaluateAuthenticatedReviewActivation = (input = {}) => {
  void input.inherited_github_acceptance;
  if (!plainObject(input)) rejectActivation(ACTIVATION_IDENTITY_COLLISION);
  if (input.github_outage !== false) rejectActivation(ACTIVATION_GITHUB_OUTAGE);
  if (input.protection_status === 404) rejectActivation(ACTIVATION_PROTECTION_404);
  if (input.protection_status !== 200) rejectActivation(ACTIVATION_GITHUB_OUTAGE);

  const hasCount = Object.hasOwn(input, "required_approving_review_count");
  const hasDismiss = Object.hasOwn(input, "dismiss_stale_reviews");
  const hasLastPush = Object.hasOwn(input, "require_last_push_approval");
  const hasEnforce = Object.hasOwn(input, "enforce_admins");
  const hasUserBypass = Object.hasOwn(input, "user_bypass_allowances");
  const hasTeamBypass = Object.hasOwn(input, "team_bypass_allowances");
  const hasAppBypass = Object.hasOwn(input, "app_bypass_allowances");
  if (!hasCount || !hasDismiss || !hasLastPush || !hasEnforce || !hasUserBypass || !hasTeamBypass || !hasAppBypass) {
    rejectActivation(ACTIVATION_PARTIAL_PROTECTION);
  }
  if (!Number.isInteger(input.required_approving_review_count)) rejectActivation(ACTIVATION_PARTIAL_PROTECTION);
  if (typeof input.dismiss_stale_reviews !== "boolean") rejectActivation(ACTIVATION_PARTIAL_PROTECTION);
  if (typeof input.require_last_push_approval !== "boolean") rejectActivation(ACTIVATION_PARTIAL_PROTECTION);
  if (typeof input.enforce_admins !== "boolean") rejectActivation(ACTIVATION_PARTIAL_PROTECTION);
  if (!Array.isArray(input.user_bypass_allowances)) rejectActivation(ACTIVATION_PARTIAL_PROTECTION);
  if (!Array.isArray(input.team_bypass_allowances)) rejectActivation(ACTIVATION_PARTIAL_PROTECTION);
  if (!Array.isArray(input.app_bypass_allowances)) rejectActivation(ACTIVATION_PARTIAL_PROTECTION);

  if (
    !stableActivationId(input.author_id) ||
    !stableActivationId(input.reviewer_id) ||
    !stableActivationId(input.merger_id)
  ) {
    rejectActivation(ACTIVATION_IDENTITY_COLLISION);
  }
  if (
    input.author_id === input.reviewer_id ||
    input.author_id === input.merger_id ||
    input.reviewer_id === input.merger_id
  ) {
    rejectActivation(ACTIVATION_IDENTITY_COLLISION);
  }

  if (input.target_branch !== "dev" || input.candidate_base !== "dev") {
    rejectActivation(ACTIVATION_WRONG_TARGET);
  }
  if (typeof input.exact_head_sha !== "string" || !ACTIVATION_GIT_SHA.test(input.exact_head_sha)) {
    rejectActivation(ACTIVATION_WRONG_TARGET);
  }

  if (
    stableActivationId(input.reviewer_permission_id) &&
    input.reviewer_permission_id !== input.reviewer_id
  ) {
    rejectActivation(ACTIVATION_IDENTITY_COLLISION);
  }
  if (!ACTIVATION_ELIGIBLE_PERMISSIONS.has(input.reviewer_permission)) {
    rejectActivation(ACTIVATION_PERMISSION_LOSS);
  }
  if (input.enforce_admins !== true) rejectActivation(ACTIVATION_ADMIN_ENFORCEMENT);
  if (input.require_last_push_approval !== true) rejectActivation(ACTIVATION_LAST_PUSH);
  if (input.required_approving_review_count < 1) rejectActivation(ACTIVATION_INACTIVE);
  if (nonemptyBypassList(input.user_bypass_allowances)) rejectActivation(ACTIVATION_USER_BYPASS);
  if (nonemptyBypassList(input.team_bypass_allowances)) rejectActivation(ACTIVATION_TEAM_BYPASS);
  if (nonemptyBypassList(input.app_bypass_allowances)) rejectActivation(ACTIVATION_APP_BYPASS);
  if (input.dismiss_stale_reviews !== true) rejectActivation(ACTIVATION_STALE_REVIEW_DISMISSAL);

  if (input.review_state !== "APPROVED") rejectActivation(ACTIVATION_INACTIVE);
  if (typeof input.review_head_sha !== "string" || !ACTIVATION_GIT_SHA.test(input.review_head_sha)) {
    rejectActivation(ACTIVATION_INACTIVE);
  }
  if (input.review_head_sha.toLowerCase() !== input.exact_head_sha.toLowerCase()) {
    rejectActivation(ACTIVATION_INACTIVE);
  }

  if (input.manifest_in_head !== true) rejectActivation(ACTIVATION_ARTIFACT_MISMATCH);
  if (typeof input.manifest_digest !== "string" || !ACTIVATION_MANIFEST_DIGEST.test(input.manifest_digest)) {
    rejectActivation(ACTIVATION_ARTIFACT_MISMATCH);
  }
  if (!plainObject(input.manifest) || !Array.isArray(input.manifest.artifacts) || input.manifest.artifacts.length < 1) {
    rejectActivation(ACTIVATION_ARTIFACT_MISMATCH);
  }
  const digest = createHash("sha256").update(Buffer.from(JSON.stringify(input.manifest), "utf8")).digest("hex");
  if (digest !== input.manifest_digest) rejectActivation(ACTIVATION_ARTIFACT_MISMATCH);
  try {
    validateArtifactManifestV3Module({ manifest: input.manifest });
  } catch {
    rejectActivation(ACTIVATION_ARTIFACT_MISMATCH);
  }
  const artifact = input.manifest.artifacts[0];
  if (
    !plainObject(artifact) ||
    typeof input.manifest.manifest_id !== "string" ||
    typeof artifact.path !== "string" ||
    typeof artifact.sha256 !== "string" ||
    !ACTIVATION_MANIFEST_DIGEST.test(artifact.sha256) ||
    typeof artifact.kind !== "string"
  ) {
    rejectActivation(ACTIVATION_ARTIFACT_MISMATCH);
  }

  const exactHead = input.exact_head_sha.toLowerCase();
  return {
    active: true,
    mode: "AUTHENTICATED_REVIEW",
    author_id: input.author_id,
    reviewer_id: input.reviewer_id,
    merger_id: input.merger_id,
    exact_head_sha: exactHead,
    artifact_freeze: {
      manifest_id: input.manifest.manifest_id,
      path: artifact.path,
      sha256: artifact.sha256,
      kind: artifact.kind,
      exact_head_sha: exactHead
    },
    activation_blockers: []
  };
};

export const selectActiveGovernanceMode = (evaluation) => {
  if (evaluation?.active === true && evaluation?.mode === "AUTHENTICATED_REVIEW") {
    return "AUTHENTICATED_REVIEW";
  }
  return "SOLE_OWNER_ADVISORY";
};

const gitBlobAt = (root, sha, path) => {
  try {
    return execFileSync("git", ["cat-file", "blob", `${sha}:${path}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
};

const evaluateLiveArtifactFreeze = (facts, root = DEFAULT_ROOT) => {
  try {
    const live = facts?.[LIVE_ACTIVATION_FACTS];
    if (!plainObject(live)) return null;
    const evaluated = evaluateAuthenticatedReviewActivation(live);
    if (selectActiveGovernanceMode(evaluated) !== "AUTHENTICATED_REVIEW") return null;
    const freeze = evaluated.artifact_freeze;
    if (!plainObject(freeze) || typeof freeze.path !== "string" || typeof freeze.sha256 !== "string") {
      return null;
    }
    const blob = gitBlobAt(root, freeze.exact_head_sha, freeze.path);
    if (blob == null) return null;
    const digest = createHash("sha256").update(blob).digest("hex");
    if (digest !== freeze.sha256) return null;
    return freeze;
  } catch {
    return null;
  }
};

/**
 * Resolve whole-ticket implementation completion from recorded implementation merge
 * receipts (facts.implementationMerges). A ticket may legitimately accumulate several
 * merged PRs that each carry the exact `Ticket: <ID>` field (docs/contract corrections,
 * gate PRs, declared in-ticket subtask merges) without any of them being the whole-ticket
 * completion merge — see classifyCompletionMerge.
 *
 * This is UNIVERSAL at every receipt count, including zero and one: there is no
 * receipt-count-inferred exception anywhere in this function. Zero recorded merges is
 * simply zero completion markers (not verified, not itself an error). A single recorded
 * merge with passing post-merge CI but no valid completion marker is likewise not
 * verified — a lone receipt never bypasses the marker requirement. The sole exceptions
 * are the two explicit legacy completion bindings declared in
 * HISTORICAL_IMPLEMENTATION_LINKAGE (D0-001 PR #130, D0-002 PR #143), matched only on
 * their exact PR number and merge commit SHA, and even those still require authenticated
 * reachability and successful post-merge CI below — never a receipt-count fallback.
 *
 * Any number of plain `Ticket:`-only contributing merges are ignored for completion
 * selection. More than one completion (marker or legacy-bound) for the same ticket, a
 * completion value mismatch, malformed/duplicated completion field data, a completion
 * merge commit not authenticated as reachable from the live target branch, or a
 * failed/missing latest post-merge CI on the identified completion merge all fail closed.
 */
const resolveImplementationCompletion = (facts, ticketId) => {
  const entries = (facts.implementationMerges ?? []).filter((entry) => entry.ticket_id === ticketId);
  const blockers = [];
  const completions = [];

  for (const entry of entries) {
    if (isLegacyCompletionBinding(ticketId, entry)) {
      completions.push(entry);
      continue;
    }
    const classification = classifyCompletionMerge(entry.body, ticketId);
    if (classification.failClosed) {
      blockers.push(blocker("TICKET_CONTRACT_CONFLICT", `${ticketId}: ${classification.reason}`));
      continue;
    }
    if (classification.isCompletion) completions.push(entry);
  }

  if (completions.length > 1) {
    blockers.push(
      blocker(
        "TICKET_CONTRACT_CONFLICT",
        `${ticketId} has multiple completion merges (#${completions.map((entry) => entry.number).join(", #")})`
      )
    );
  }

  if (blockers.length) {
    return { verified: false, blockers: uniqueBlockers(blockers) };
  }

  if (completions.length === 0) {
    // Zero completion markers among any number of plain contributing merges leaves the
    // ticket unverified. This is never a fail-closed error.
    return { verified: false, blockers: [] };
  }

  const completionEntry = completions[0];
  if (completionEntry.reachable !== true) {
    return {
      verified: false,
      blockers: [
        blocker(
          "TICKET_CONTRACT_CONFLICT",
          `${ticketId} completion merge commit is not authenticated as reachable from the live target branch`
        )
      ]
    };
  }
  // The completion's own effect must still be present. A revert leaves the merge commit
  // in the ancestry, so without this a reverted ticket stays verified forever.
  const introduced = completionEntry.added_paths;
  if (introduced === null || introduced === undefined) {
    return {
      verified: false,
      blockers: [
        blocker(
          "COMPLETION_EFFECT_UNKNOWN",
          `${ticketId} completion merge introduced-path set is unavailable, so its effect cannot be confirmed present`
        )
      ]
    };
  }
  const livePaths = facts.liveTreePaths;
  if (!Array.isArray(livePaths)) {
    return {
      verified: false,
      blockers: [
        blocker("EXTERNAL_STATE_UNAVAILABLE", `${ticketId} live tree listing unavailable for completion-effect check`)
      ]
    };
  }
  const liveSet = new Set(livePaths);
  const absent = introduced.filter((path) => !liveSet.has(path));
  if (absent.length) {
    return {
      verified: false,
      blockers: [
        blocker(
          "COMPLETION_EFFECT_REVERTED",
          `${ticketId} completion merge introduced ${absent.join(", ")}, absent from the live target branch`
        )
      ]
    };
  }
  // The other direction, and it applies to every completion rather than only to the empty
  // ones: a path this merge deleted must still be gone. Restoring a file a completion
  // deliberately removed reverts that completion exactly as deleting a file it added does, and
  // a check that only looks for presence cannot see it. A rename's old path counts here.
  const removed = completionEntry.removed_paths;
  if (!Array.isArray(removed)) {
    return {
      verified: false,
      blockers: [
        blocker(
          "COMPLETION_EFFECT_UNKNOWN",
          `${ticketId} completion merge removed-path set is unavailable, so half its effect cannot be confirmed`
        )
      ]
    };
  }
  const restored = removed.filter((path) => liveSet.has(path));
  if (restored.length) {
    return {
      verified: false,
      blockers: [
        blocker(
          "COMPLETION_EFFECT_REVERTED",
          `${ticketId} completion merge removed ${restored.join(", ")}, present again on the live target branch`
        )
      ]
    };
  }
  // An empty introduced set has nothing that could go absent, so the check above passes on
  // any evidence at all -- including none. Refactor, deletion and doc-correction completions
  // are legitimately in that shape, so the answer is not to demand an added path but to check
  // the effect such a merge does have: the files it changed must still be at the tip.
  if (introduced.length === 0) {
    const changed = completionEntry.changed_paths;
    if (!Array.isArray(changed)) {
      return {
        verified: false,
        blockers: [
          blocker(
            "COMPLETION_EFFECT_UNKNOWN",
            `${ticketId} completion merge introduced no path and its changed-path set is unavailable, so it has no confirmable effect`
          )
        ]
      };
    }
    // A completion whose entire effect is a deletion leaves nothing behind by construction, and
    // the deletions were confirmed still absent above. That is a confirmed effect, not an absent
    // one -- refusing it would make "delete this" an unverifiable kind of work.
    if (changed.length === 0 && removed.length > 0) {
      return { verified: true, blockers: [] };
    }
    if (changed.length === 0) {
      return {
        verified: false,
        blockers: [
          blocker(
            "COMPLETION_EFFECT_UNKNOWN",
            `${ticketId} completion merge added and modified no file, so there is no effect to confirm present`
          )
        ]
      };
    }
    const changedAbsent = changed.filter((path) => !liveSet.has(path));
    if (changedAbsent.length) {
      return {
        verified: false,
        blockers: [
          blocker(
            "COMPLETION_EFFECT_REVERTED",
            `${ticketId} completion merge changed ${changedAbsent.join(", ")}, absent from the live target branch`
          )
        ]
      };
    }
  }
  const ci = postMergeStatus(facts, completionEntry.merge_commit_sha);
  if (ci.failed) {
    return {
      verified: false,
      blockers: [blocker("POST_MERGE_CI_FAILED", `${ticketId} completion merge post-merge CI failed`)]
    };
  }
  if (ci.missing) {
    return {
      verified: false,
      blockers: [blocker("POST_MERGE_CI_MISSING", `${ticketId} completion merge post-merge CI missing or nonterminal`)]
    };
  }
  return { verified: true, blockers: [] };
};

/**
 * Implementation verification requires an explicit verified fact (fixture/online merge
 * receipt) plus gate acceptance; closed issues never verify. Whole-ticket completion is
 * always resolved via resolveImplementationCompletion — see its docstring for the
 * universal (no receipt-count exception) marker/legacy-binding semantics.
 */
const isVerified = (facts, ticketId, gateEvaluation) => {
  if (!gateEvaluation.accepted) return false;
  if (!Array.isArray(facts.verifiedTickets) || !facts.verifiedTickets.includes(ticketId)) return false;
  return resolveImplementationCompletion(facts, ticketId).verified === true;
};

const resolveOneTicket = (facts, ticketId, ticket, policy, context) => {
  const blockers = [];

  if (context.wrongTarget) {
    blockers.push(blocker("WRONG_TARGET", "repository or branch identity does not match actor policy"));
    return finalize("invalidated", "blocked", blockers, null, null);
  }

  if (context.policyConflict) {
    blockers.push(blocker("TICKET_CONTRACT_CONFLICT", "actor policy missing, malformed, or non-identical to ticket binding"));
    return finalize("invalidated", "blocked", blockers, null, null);
  }

  if (context.externalUnavailable) {
    blockers.push(blocker("EXTERNAL_STATE_UNAVAILABLE", "required external repository facts unavailable"));
    return finalize("planned", "unknown", blockers, null, null);
  }

  if (ticket?.kind === "superseded") {
    return finalize("superseded", "terminal", [], null, null);
  }

  const gateEvaluation = evaluateTicketGates(facts, ticketId, ticket);

  const candidateResolution = resolveCandidatePrs(facts, ticketId);
  if (candidateResolution.ambiguous) {
    return finalize(
      "implementing",
      "blocked",
      [
        blocker(
          "TICKET_CONTRACT_CONFLICT",
          `${ticketId} has multiple live Ticket candidates without explicit structured supersession`
        )
      ],
      null,
      null
    );
  }
  const pr = candidateResolution.active;

  // Explicit implementation verification (never from issue state alone).
  if (isVerified(facts, ticketId, gateEvaluation) && !pr) {
    return finalize("verified", "terminal", [], null, null);
  }

  // Claimed verified but gate/post-merge CI broken → surface post-merge blockers.
  if (Array.isArray(facts.verifiedTickets) && facts.verifiedTickets.includes(ticketId) && !gateEvaluation.accepted) {
    const phase = gateEvaluation.postMerge?.missing
      ? "merged_pending_post_ci"
      : gateEvaluation.postMerge?.failed
        ? "merged_pending_post_ci"
        : "gate_preparation";
    return finalize(phase, "blocked", uniqueBlockers(gateEvaluation.blockers), null, null);
  }

  if (!gateEvaluation.accepted) {
    return finalize("gate_preparation", "blocked", uniqueBlockers(gateEvaluation.blockers), null, null);
  }

  // Implementation merge receipts (even without verifiedTickets) must surface post-merge
  // CI / completion fail-closed state before ready-set computation. Zero completion
  // markers among plain contributing merges is never a failure here
  // (resolveImplementationCompletion returns no blockers in that case) — the ticket
  // simply falls through to the normal readiness pipeline below, unverified.
  const implementationCompletion = resolveImplementationCompletion(facts, ticketId);
  if (!pr && implementationCompletion.blockers.length) {
    return finalize(
      "merged_pending_post_ci",
      "blocked",
      uniqueBlockers(implementationCompletion.blockers),
      null,
      null
    );
  }

  // Dependencies must be verified implementations.
  const readyBlockers = [];
  for (const dep of ticket?.dependencies ?? []) {
    const depTicket = facts.tickets?.[dep];
    if (!depTicket) {
      readyBlockers.push(blocker("DEPENDENCY_UNVERIFIED", `dependency ${dep} missing`));
      continue;
    }
    if (depTicket.kind === "superseded") continue;
    const depGate = evaluateTicketGates(facts, dep, depTicket);
    if (!isVerified(facts, dep, depGate)) {
      readyBlockers.push(blocker("DEPENDENCY_UNVERIFIED", `dependency ${dep} is not verified`));
    }
  }

  // Declared ownership must be present and schema-valid before collision evaluation or packet emission.
  const declaredOwnership = declaredOwnershipContract(ticket);
  if (!declaredOwnership.ok) {
    readyBlockers.push(
      blocker("TICKET_CONTRACT_INCOMPLETE", `${ticketId} ${declaredOwnership.reason}`)
    );
  }

  const collisions = ownershipCollisions(facts, ticketId);
  if (collisions.length) {
    readyBlockers.push(
      blocker(
        "OWNERSHIP_OVERLAP",
        `${ticketId} ownership collides with ${collisions.map((entry) => entry.ticket).join(",")}`
      )
    );
  }

  const path = ticketPathFor(facts, ticketId);
  const live = path ? facts.liveDigests?.[path] : null;
  if (live && ticket?.digests?.ticket && live !== ticket.digests.ticket) {
    readyBlockers.push(blocker("STALE_DIGEST", `${ticketId} ticket digest is stale`));
  }
  if (!ticket?.red_command) {
    readyBlockers.push(blocker("RED_CONTRACT_INVALID", `${ticketId} lacks RED command`));
  }

  if (pr) {
    const candidate = {
      number: pr.number,
      head_sha: pr.head_sha,
      base: pr.base,
      // Superseded heads are reported only; their review/CI evidence is never reused.
      superseded_heads: candidateResolution.superseded
    };
    let phase = "implementing";
    const candidateBlockers = [...readyBlockers];

    const ci = evaluateCandidateCi(facts, policy, pr, ticketId);
    if (!ci.ok) {
      candidateBlockers.push(blocker("EXACT_HEAD_CI_FAILED", ci.failures.join("; ") || "candidate CI failed"));
      phase = "ci";
    }

    const review = evaluateReview(facts, policy, pr, ticketId);
    if (!review.ok) {
      candidateBlockers.push(blocker("CUMULATIVE_REVIEW_MISSING", review.reason));
      if (ci.ok) phase = "review";
    }

    const authorization = evaluateAuthorization(facts, policy, pr, ticketId, review.ok);
    if (!authorization.ok) {
      candidateBlockers.push(blocker("MERGE_AUTHORIZATION_MISSING", authorization.reason));
    }

    const unique = uniqueBlockers(candidateBlockers);
    return finalize(phase, unique.length ? "blocked" : "active", unique, null, candidate);
  }

  if (readyBlockers.length) {
    const phase = readyBlockers.some((entry) => entry.code === "STALE_DIGEST")
      ? "gate_preparation"
      : "gate_preparation";
    return finalize(phase, "blocked", uniqueBlockers(readyBlockers), null, null);
  }

  // Ready for RED packet emission. RED itself is not authorized by readiness alone.
  const packet = {
    base: facts.currentHead,
    authority_digests: {
      ticket: ticket.digests.ticket,
      prd: ticket.digests.prd,
      adrs: ticket.digests.adrs ?? {}
    },
    owned_paths: [...(ticket.owned_paths ?? [])],
    owned_symbols: [...(ticket.owned_symbols ?? [])],
    red_command: ticket.red_command
  };
  return finalize("ready_for_red", "ready", [], packet, null);
};

const uniqueBlockers = (entries) => {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = `${entry.code}:${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
};

const finalize = (phase, readiness, blockers, packet, candidate) => {
  if (!PHASES.has(phase)) throw new Error(`invalid phase ${phase}`);
  if (!READINESS.has(readiness)) throw new Error(`invalid readiness ${readiness}`);
  return {
    phase,
    readiness,
    blockers,
    packet: readiness === "ready" ? packet : null,
    red_authorized: false,
    requires_maintainer_exact_base_packet: true,
    candidate
  };
};

export const canonicalExecutionState = (state) => {
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (RUNTIME_KEYS.has(key)) continue;
        out[key] = strip(value[key]);
      }
      return out;
    }
    return value;
  };
  return strip(state);
};

export const emptyFailureState = (mode, now, runtimeIdentity, errors) => ({
  schema_version: 1,
  mode,
  repository: runtimeIdentity?.repository ?? expectedActorPolicyFromTicket().repository,
  target_branch: runtimeIdentity?.branch ?? expectedActorPolicyFromTicket().target_branch,
  current_head: runtimeIdentity?.head ?? null,
  resolved_at: now,
  governance_mode: "single_owner_bootstrap",
  claims_merge_authorization: false,
  claims_separation_of_duties: false,
  artifact_freeze: null,
  bootstrap: { active: true, d0_004c_merged: false },
  tickets: {},
  readySet: [],
  errors
});

const sha256Text = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const GITHUB_ACTIONS_APP = { id: 15368, slug: "github-actions", owner: "github" };
/**
 * Collection cost scales with the number of merged Ticket-linked pull requests: one
 * authoritative fetch per search hit, plus one commit fetch per completion receipt, plus
 * one recursive tree listing. At 35 merged receipts a full run measured 89.5s against the
 * former 90s ceiling, so the budget was being hit by ordinary backlog growth rather than
 * by any outage. Raising the ceiling again would fail at the same place, later; independent
 * reads run with bounded concurrency instead. The 300s budget stays as a fail-closed cap,
 * not as the scaling lever.
 */
const DEFAULT_PER_CALL_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_COLLECTION_TIMEOUT_MS = 300_000;
export const DEFAULT_COLLECTION_CONCURRENCY = 8;
const GH_API_POOL_ENV = "AOS_GH_API_POOL";

const timeoutError = (reason, apiPath) => {
  const error = new Error(reason);
  error.code = "COLLECTION_TIMEOUT";
  if (typeof apiPath === "string" && apiPath.length > 0) error.apiPath = apiPath;
  return error;
};

// Presence, not value, is what forces colour: GH_FORCE_TTY=0 and
// CLICOLOR_FORCE=false still colour gh api. NO_COLOR does not override
// CLICOLOR_FORCE. Delete the force class; do not set the keys to 0/false.
const GH_COLOUR_FORCE_KEYS = ["CLICOLOR_FORCE", "FORCE_COLOR", "GH_FORCE_TTY"];

const sanitiseGhChildEnv = (source = process.env) => {
  const env = { ...source };
  for (const key of GH_COLOUR_FORCE_KEYS) {
    delete env[key];
  }
  env.NO_COLOR = "1";
  return env;
};

export const isGitHubSecondaryRateLimit = (error) => {
  if (!error) return false;
  if (error.code === "SECONDARY_RATE_LIMIT") return true;
  const blob = [error.message, error.stderr, error.stdout].map((value) => String(value ?? "")).join("\n");
  const status = Number(error.status);
  const http403 = status === 403 || /\bHTTP\s+403\b/i.test(blob);
  return http403 && /secondary rate limit/i.test(blob);
};

const secondaryRateLimitError = (apiPath, error) => {
  const wrapped = new Error(`GitHub secondary rate limit on ${apiPath}`);
  wrapped.code = "SECONDARY_RATE_LIMIT";
  wrapped.apiPath = apiPath;
  wrapped.cause = error;
  return wrapped;
};

const resolveCollectionConcurrency = (value) =>
  Number.isInteger(value) && value > 0 ? value : DEFAULT_COLLECTION_CONCURRENCY;

/**
 * Run independent async work with a fixed in-flight cap. Result order matches input
 * order. Any thrown mapper error stops launching further work (in-flight work still
 * settles) and is rethrown as the lowest-index error. Per-item HTTP failures must be
 * returned as values, not thrown, or they would abort the rest of a batch.
 */
export const mapWithBoundedConcurrency = async (items, concurrency, mapper) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("collection concurrency must be a positive integer");
  }
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = new Array(items.length);
  const errors = new Array(items.length);
  let nextIndex = 0;
  let stopLaunching = false;
  const runWorker = async () => {
    while (true) {
      if (stopLaunching) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        errors[index] = error;
        stopLaunching = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  const firstError = errors.find((error) => error != null);
  if (firstError) throw firstError;
  return results;
};

const classifyGhExecError = (apiPath, error) => {
  if (isGitHubSecondaryRateLimit(error)) {
    throw secondaryRateLimitError(apiPath, error);
  }
  if (
    error?.code === "ETIMEDOUT" ||
    error?.killed === true ||
    /ETIMEDOUT|timed out|TIMEOUT/i.test(String(error?.message ?? ""))
  ) {
    throw timeoutError(`per-call timeout for ${apiPath}`, apiPath);
  }
  if (
    error?.status === 404 ||
    /\bHTTP\s+404\b/i.test(String(error?.stderr ?? error?.message ?? ""))
  ) {
    error.code = "AUTHENTICATED_NOT_FOUND";
  }
  return error;
};

const stdoutFromExecResult = (result) => {
  if (typeof result === "string") return result;
  if (result && typeof result.stdout === "string") return result.stdout;
  return "";
};

export const executeGhApiPool = async (request, options = {}) => {
  const execAsync = options.execFile ?? execFileAsync;
  const calls = Array.isArray(request?.calls) ? request.calls : [];
  const concurrency = resolveCollectionConcurrency(request?.concurrency);
  const perCallTimeoutMs =
    Number.isFinite(request?.perCallTimeoutMs) && request.perCallTimeoutMs > 0
      ? request.perCallTimeoutMs
      : DEFAULT_PER_CALL_TIMEOUT_MS;
  const deadline = Number.isFinite(request?.deadline) ? request.deadline : Number.POSITIVE_INFINITY;
  const root = request?.root;
  return mapWithBoundedConcurrency(calls, concurrency, async (call) => {
    const apiPath = call?.apiPath;
    if (Date.now() > deadline) {
      return {
        ok: false,
        apiPath,
        code: "COLLECTION_TIMEOUT",
        message: `collection total timeout exceeded before ${apiPath}`
      };
    }
    const remaining = deadline - Date.now();
    const callTimeout = Math.max(1, Math.min(perCallTimeoutMs, remaining));
    const args = ["api", apiPath];
    if (call?.accept) args.push("-H", `Accept: ${call.accept}`);
    try {
      const raw = await execAsync("gh", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 100 * 1024 * 1024,
        timeout: callTimeout,
        env: sanitiseGhChildEnv()
      });
      return { ok: true, raw: stdoutFromExecResult(raw) };
    } catch (error) {
      try {
        classifyGhExecError(apiPath, error);
      } catch (classified) {
        if (classified?.code === "COLLECTION_TIMEOUT") {
          return {
            ok: false,
            apiPath,
            status: error?.status ?? null,
            code: classified.code,
            killed: error?.killed === true,
            stderr: String(error?.stderr ?? ""),
            message: String(classified.message ?? "")
          };
        }
        throw classified;
      }
      return {
        ok: false,
        apiPath,
        status: error?.status ?? null,
        code: error?.code ?? null,
        killed: error?.killed === true,
        stderr: String(error?.stderr ?? ""),
        message: String(error?.message ?? "")
      };
    }
  });
};

const invokeGhApiPoolProcess = (calls, poolOptions) => {
  if (typeof poolOptions.runMany === "function") {
    return poolOptions.runMany(calls, poolOptions);
  }
  const payload = {
    calls,
    concurrency: poolOptions.concurrency,
    perCallTimeoutMs: poolOptions.perCallTimeoutMs,
    deadline: poolOptions.deadline,
    root: poolOptions.root
  };
  const remaining = Math.max(1, poolOptions.deadline - Date.now());
  let raw;
  try {
    raw = poolOptions.exec(
      process.execPath,
      [fileURLToPath(import.meta.url)],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
        cwd: poolOptions.root,
        timeout: remaining,
        maxBuffer: 100 * 1024 * 1024,
        env: { ...sanitiseGhChildEnv(), [GH_API_POOL_ENV]: "1" }
      }
    );
  } catch (error) {
    if (isGitHubSecondaryRateLimit(error)) throw secondaryRateLimitError(calls[0]?.apiPath, error);
    if (
      error?.code === "ETIMEDOUT" ||
      error?.killed === true ||
      /ETIMEDOUT|timed out|TIMEOUT/i.test(String(error?.message ?? ""))
    ) {
      throw timeoutError(
        `collection total timeout exceeded before ${calls[0]?.apiPath ?? "batch"}`,
        calls[0]?.apiPath
      );
    }
    const stdout = String(error?.stdout ?? "");
    if (stdout.trim()) raw = stdout;
    else throw error;
  }
  const parsed = JSON.parse(raw);
  if (parsed && parsed.ok === false) {
    if (parsed.code === "SECONDARY_RATE_LIMIT") {
      throw secondaryRateLimitError(parsed.apiPath ?? calls[0]?.apiPath, parsed);
    }
    if (parsed.code === "COLLECTION_TIMEOUT") {
      throw timeoutError(
        parsed.reason ?? `collection total timeout exceeded before ${parsed.apiPath ?? calls[0]?.apiPath ?? "batch"}`,
        parsed.apiPath ?? calls[0]?.apiPath
      );
    }
    throw new Error(parsed.reason ?? "gh api pool failed");
  }
  if (!Array.isArray(parsed) || parsed.length !== calls.length) {
    throw new Error("gh api pool returned a length-mismatched payload");
  }
  return parsed;
};

const writePoolStdout = (value) => {
  // writeSync: process.stdout.write of a large JSON payload plus process.exit
  // truncates at the ~64KiB pipe buffer. POSIX write of n > PIPE_BUF to a pipe
  // may also return short; loop until every byte is in the kernel.
  const bytes = Buffer.from(JSON.stringify(value));
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(1, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written < 1) {
      throw new Error("gh api pool worker short write");
    }
    offset += written;
  }
};

const runGhApiPoolWorker = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  try {
    const results = await executeGhApiPool(request);
    writePoolStdout(results);
  } catch (error) {
    writePoolStdout({
      ok: false,
      code:
        error?.code === "SECONDARY_RATE_LIMIT"
          ? "SECONDARY_RATE_LIMIT"
          : error?.code === "COLLECTION_TIMEOUT"
            ? "COLLECTION_TIMEOUT"
            : "POOL_FAILURE",
      reason: error?.message ?? "gh api pool failed",
      apiPath: error?.apiPath ?? null
    });
  }
};

/**
 * Authenticated read-only GitHub transport used by the live collector.
 * Performs zero repository writes. Callers may inject a fixture transport.
 * Every call has an explicit per-call timeout; the collector also enforces a total budget.
 */
export const createAuthenticatedGitHubTransport = (root = DEFAULT_ROOT, options = {}) => {
  const exec = options.execFileSync ?? execFileSync;
  const perCallTimeoutMs =
    Number.isFinite(options.perCallTimeoutMs) && options.perCallTimeoutMs > 0
      ? options.perCallTimeoutMs
      : DEFAULT_PER_CALL_TIMEOUT_MS;
  const totalTimeoutMs =
    Number.isFinite(options.totalTimeoutMs) && options.totalTimeoutMs > 0
      ? options.totalTimeoutMs
      : DEFAULT_TOTAL_COLLECTION_TIMEOUT_MS;
  const concurrency = resolveCollectionConcurrency(options.concurrency);
  const deadline = Date.now() + totalTimeoutMs;
  const ghApi = (apiPath, { accept } = {}) => {
    if (Date.now() > deadline) {
      throw timeoutError(`collection total timeout exceeded before ${apiPath}`, apiPath);
    }
    const remaining = deadline - Date.now();
    const callTimeout = Math.max(1, Math.min(perCallTimeoutMs, remaining));
    const args = ["api", apiPath];
    if (accept) args.push("-H", `Accept: ${accept}`);
    try {
      const raw = exec("gh", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 100 * 1024 * 1024,
        timeout: callTimeout,
        env: sanitiseGhChildEnv()
      });
      return raw;
    } catch (error) {
      classifyGhExecError(apiPath, error);
      throw error;
    }
  };
  const ghApiMany = (calls) => {
    if (Date.now() > deadline) {
      throw timeoutError(
        `collection total timeout exceeded before ${calls[0]?.apiPath ?? "batch"}`,
        calls[0]?.apiPath
      );
    }
    return invokeGhApiPoolProcess(calls, {
      exec,
      runMany: options.runMany,
      concurrency,
      perCallTimeoutMs,
      deadline,
      root
    });
  };
  const poolErrorToTransport = (apiPath, entry) => {
    const error = new Error(entry?.message || `unavailable external response for ${apiPath}`);
    error.code = entry?.code ?? null;
    error.status = entry?.status ?? null;
    error.killed = entry?.killed === true;
    error.stderr = entry?.stderr ?? "";
    error.apiPath = apiPath;
    try {
      classifyGhExecError(apiPath, error);
    } catch (classified) {
      if (classified && typeof classified === "object") classified.apiPath = classified.apiPath ?? apiPath;
      return classified;
    }
    return error;
  };
  return {
    kind: "github-authenticated",
    perCallTimeoutMs,
    totalTimeoutMs,
    concurrency,
    getJson(apiPath) {
      return JSON.parse(ghApi(apiPath));
    },
    getRaw(apiPath) {
      return ghApi(apiPath, { accept: "application/vnd.github.raw" });
    },
    getJsonMany(apiPaths) {
      if (!Array.isArray(apiPaths) || apiPaths.length === 0) return [];
      const rawResults = ghApiMany(apiPaths.map((apiPath) => ({ apiPath })));
      return rawResults.map((entry, index) => {
        const apiPath = apiPaths[index];
        if (!entry?.ok) {
          const error = poolErrorToTransport(apiPath, entry ?? {});
          if (
            error?.code === "COLLECTION_TIMEOUT" ||
            error?.code === "ETIMEDOUT" ||
            error?.killed === true ||
            /timeout/i.test(String(error?.message ?? ""))
          ) {
            return {
              ok: false,
              reason: `EXTERNAL_STATE_UNAVAILABLE: collection timeout for ${apiPath}`,
              error,
              timeout: true
            };
          }
          if (error instanceof SyntaxError) {
            return { ok: false, reason: `unparseable transport response for ${apiPath}`, error };
          }
          return {
            ok: false,
            reason: error?.code === "FIXTURE_AMBIGUOUS"
              ? `ambiguous external response for ${apiPath}`
              : `unavailable external response for ${apiPath}`,
            error
          };
        }
        try {
          return { ok: true, value: JSON.parse(entry.raw) };
        } catch (error) {
          return { ok: false, reason: `unparseable transport response for ${apiPath}`, error };
        }
      });
    },
    getRawMany(apiPaths) {
      if (!Array.isArray(apiPaths) || apiPaths.length === 0) return [];
      const rawResults = ghApiMany(
        apiPaths.map((apiPath) => ({ apiPath, accept: "application/vnd.github.raw" }))
      );
      return rawResults.map((entry, index) => {
        const apiPath = apiPaths[index];
        if (!entry?.ok) {
          const error = poolErrorToTransport(apiPath, entry ?? {});
          if (
            error?.code === "COLLECTION_TIMEOUT" ||
            error?.code === "ETIMEDOUT" ||
            error?.killed === true ||
            /timeout/i.test(String(error?.message ?? ""))
          ) {
            return {
              ok: false,
              reason: `EXTERNAL_STATE_UNAVAILABLE: collection timeout for ${apiPath}`,
              error,
              timeout: true
            };
          }
          return {
            ok: false,
            reason: `unavailable external response for ${apiPath}`,
            error
          };
        }
        return { ok: true, value: entry.raw };
      });
    }
  };
};

const withCollectionTimeouts = (transport, options = {}) => {
  const totalTimeoutMs =
    Number.isFinite(options.totalTimeoutMs) && options.totalTimeoutMs > 0
      ? options.totalTimeoutMs
      : transport.totalTimeoutMs ?? DEFAULT_TOTAL_COLLECTION_TIMEOUT_MS;
  const deadline = Date.now() + totalTimeoutMs;
  const guard = (method, apiPath) => {
    if (Date.now() > deadline) {
      throw timeoutError(`collection total timeout exceeded before ${apiPath}`, apiPath);
    }
    return transport[method](apiPath);
  };
  const wrapped = {
    kind: transport.kind,
    perCallTimeoutMs: transport.perCallTimeoutMs ?? options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
    totalTimeoutMs,
    concurrency: resolveCollectionConcurrency(options.concurrency ?? transport.concurrency),
    getJson(apiPath) {
      return guard("getJson", apiPath);
    },
    getRaw(apiPath) {
      return guard("getRaw", apiPath);
    }
  };
  if (typeof transport.getJsonMany === "function") {
    wrapped.getJsonMany = (apiPaths) => {
      if (Date.now() > deadline) {
        throw timeoutError(
          `collection total timeout exceeded before ${apiPaths[0] ?? "batch"}`,
          apiPaths[0]
        );
      }
      return transport.getJsonMany(apiPaths);
    };
  }
  if (typeof transport.getRawMany === "function") {
    wrapped.getRawMany = (apiPaths) => {
      if (Date.now() > deadline) {
        throw timeoutError(
          `collection total timeout exceeded before ${apiPaths[0] ?? "batch"}`,
          apiPaths[0]
        );
      }
      return transport.getRawMany(apiPaths);
    };
  }
  return wrapped;
};

const extractMarkdownSection = (markdown, heading) => {
  if (typeof markdown !== "string") return null;
  const pattern = new RegExp(
    `^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "im"
  );
  const match = pattern.exec(markdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
};

const isOwnedPathToken = (token) => {
  if (typeof token !== "string" || !token) return false;
  if (token.includes("/") || token.includes("\\")) return true;
  return /^(package\.json|AGENTS\.md|README\.md|CONTRIBUTING\.md)$/.test(token) ||
    /\.(mjs|cjs|js|ts|tsx|json|yml|yaml|md)$/.test(token);
};

const isOwnedSymbolToken = (token) =>
  typeof token === "string" &&
  /^[A-Za-z_$][\w$]*$/.test(token) &&
  !/^(true|false|null|undefined)$/.test(token);

const PATH_TOKEN_RE =
  /(?<![A-Za-z0-9_./@-])((?:docs|scripts|specs|tests|fixtures|packages|adapters|conformance|apps|\.github|src)\/[A-Za-z0-9_./@{}*+-]+|package\.json|AGENTS\.md|README\.md|CONTRIBUTING\.md)/g;

const extractOwnershipSubtaskBlock = (ownership, subtask) => {
  if (!subtask) return ownership;
  const lines = ownership.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^-\\s*${subtask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line)
  );
  if (start === -1) return null;
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    // Stop only at another D0-004A/B/C (or peer ticket-lane) ownership bullet, not prose bullets.
    if (/^-\s+D0-004[ABC]\b/.test(lines[i])) break;
    if (/^-\s+No other file or symbol\b/i.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join("\n").trim();
};

const detectTicketSubtask = (ticketId, markdown, options = {}) => {
  if (typeof options.subtask === "string" && options.subtask) return options.subtask;
  if (ticketId !== "D0-004" || typeof markdown !== "string") return null;
  const ownership = extractMarkdownSection(markdown, "Exact ownership") ?? "";
  const present = [...ownership.matchAll(/^- (D0-004[ABC])\b/gm)].map((match) => match[1]);
  if (!present.length) return null;
  // While C is not merged, the active implementation ownership/RED lane is B.
  if (options.d0_004c_merged === true && present.includes("D0-004C")) return "D0-004C";
  if (present.includes("D0-004B")) return "D0-004B";
  return present[0] ?? null;
};

const extractPathsAndSymbolsFromProse = (text) => {
  const owned_paths = [];
  const owned_symbols = [];
  const pushPath = (token) => {
    const cleaned = token.replace(/[.,;:]+$/g, "").trim();
    if (!cleaned) return;
    if (cleaned.includes("/") || isOwnedPathToken(cleaned)) {
      if (!owned_paths.includes(cleaned)) owned_paths.push(cleaned);
    }
  };
  const pushSymbol = (token) => {
    const cleaned = token.trim();
    if (!cleaned || !isOwnedSymbolToken(cleaned)) return;
    if (
      /^(No|none|other|file|symbol|may|be|edited|without|replacement|ticket|and|or|the|only|not|authorize|implementation|change|Exact|ownership|resolver|core|scripts|Narrow|pre|RED|harness|carve|out)$/i.test(
        cleaned
      )
    ) {
      return;
    }
    // Prefer camelCase/PascalCase/snake API identifiers over plain English.
    if (!/[A-Z]/.test(cleaned) && !cleaned.includes("_") && cleaned === cleaned.toLowerCase()) {
      return;
    }
    if (!owned_symbols.includes(cleaned)) owned_symbols.push(cleaned);
  };

  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    if (!token) continue;
    if (token.includes("/") || isOwnedPathToken(token) || token.endsWith("/**")) {
      pushPath(token);
      continue;
    }
    pushSymbol(token);
  }
  PATH_TOKEN_RE.lastIndex = 0;
  for (const match of text.matchAll(PATH_TOKEN_RE)) {
    pushPath(match[1]);
  }
  for (const line of text.split("\n")) {
    const dashSplit = line.split(/—|–|--/).slice(1).join(" ");
    if (!dashSplit) continue;
    for (const match of dashSplit.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      pushSymbol(match[1]);
    }
  }
  return { owned_paths, owned_symbols };
};

const extractRedCommandFromSection = (redSection, subtask) => {
  if (typeof redSection !== "string" || !redSection.trim()) return null;
  if (/Focused command:\s*none\b/i.test(redSection) || /Focused command:\s*`none`/i.test(redSection)) {
    return null;
  }
  if (subtask) {
    const subtaskLine = redSection
      .split("\n")
      .find((line) => new RegExp(`${subtask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+test\\b`, "i").test(line));
    if (subtaskLine) {
      const patterns = [
        /command:\s*`((?:npm test|npm run|node --test)[^`]*)`/i,
        /`((?:npm test|npm run|node --test)[^`]*)`/
      ];
      for (const pattern of patterns) {
        const hit = subtaskLine.match(pattern);
        if (hit?.[1]?.trim()) return hit[1].trim();
      }
    }
  }
  const patterns = [
    /Focused command:\s*`([^`]+)`/i,
    /command:\s*`((?:npm test|npm run|node --test)[^`]*)`/i,
    /`((?:npm test|npm run|node --test)[^`]*)`/
  ];
  for (const pattern of patterns) {
    const hit = redSection.match(pattern);
    if (hit?.[1]?.trim()) return hit[1].trim();
  }
  return null;
};

/**
 * Parse Exact ownership + RED contract from a canonical ticket markdown body.
 * Multi-lane tickets (D0-004A/B/C) select one deterministic subtask lane.
 * Missing/ambiguous mappings fail closed for executable tickets.
 */
export const parseTicketOwnershipAndRed = (markdown, options = {}) => {
  if (typeof markdown !== "string" || !markdown.trim()) {
    return { ok: false, reason: "ticket markdown missing" };
  }
  const ownership = extractMarkdownSection(markdown, "Exact ownership");
  if (!ownership) {
    return { ok: false, reason: "Exact ownership section missing" };
  }
  // Superseded / no-implementation ownership markers.
  if (/^\s*[-*]?\s*None\b/im.test(ownership) && !PATH_TOKEN_RE.test(ownership)) {
    PATH_TOKEN_RE.lastIndex = 0;
    return { ok: false, reason: "owned_paths empty or unparseable" };
  }
  PATH_TOKEN_RE.lastIndex = 0;

  const ticketId = typeof options.ticketId === "string" ? options.ticketId : null;
  const subtask = detectTicketSubtask(ticketId, markdown, options);
  const ownershipText = extractOwnershipSubtaskBlock(ownership, subtask);
  if (subtask && !ownershipText) {
    return { ok: false, reason: `ownership subtask ${subtask} missing` };
  }
  const { owned_paths, owned_symbols } = extractPathsAndSymbolsFromProse(ownershipText || ownership);
  if (owned_paths.length === 0) {
    return { ok: false, reason: "owned_paths empty or unparseable" };
  }

  const redSection = extractMarkdownSection(markdown, "RED contract");
  const red_command = extractRedCommandFromSection(redSection, subtask);
  if (!red_command) {
    return { ok: false, reason: "red_command missing or unparseable" };
  }
  return {
    ok: true,
    owned_paths,
    owned_symbols,
    red_command,
    subtask: subtask ?? null
  };
};

const ACCEPTED_GATE_TRANSITIONS = new Set([
  "ADR_ACCEPTED",
  "PRD_ACCEPTED",
  "TICKET_READY_FOR_RED"
]);

const validAcceptedArtifact = (artifact) =>
  plainObject(artifact) &&
  typeof artifact.path === "string" &&
  artifact.path.length > 0 &&
  ["ADR", "PRD", "TICKET"].includes(artifact.kind) &&
  typeof artifact.sha256 === "string" &&
  /^[a-f0-9]{64}$/.test(artifact.sha256);

const acceptedBatchRecordIsWellFormed = (row) => {
  if (!plainObject(row) || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(row.id)) {
    return false;
  }
  if (row.status !== "ACCEPTED" || typeof row.scope !== "string" || !row.scope.trim()) return false;
  if (
    !plainObject(row.target) ||
    row.target.repository !== "github.com/MongLong0214/agent-operator-score" ||
    row.target.branch !== "dev" ||
    typeof row.target.reviewed_head !== "string" ||
    !/^[a-f0-9]{40}$/.test(row.target.reviewed_head)
  ) {
    return false;
  }

  if (
    !Array.isArray(row.required_artifacts) ||
    row.required_artifacts.length === 0 ||
    !row.required_artifacts.every(validAcceptedArtifact) ||
    !Array.isArray(row.artifacts) ||
    row.artifacts.length === 0 ||
    !row.artifacts.every(validAcceptedArtifact)
  ) {
    return false;
  }
  const requiredArtifacts = row.required_artifacts.map(stableJson);
  const artifacts = row.artifacts.map(stableJson);
  if (new Set(requiredArtifacts).size !== requiredArtifacts.length) return false;
  if (new Set(artifacts).size !== artifacts.length) return false;
  if (stableJson([...requiredArtifacts].sort()) !== stableJson([...artifacts].sort())) return false;

  if (
    !Array.isArray(row.required_transitions) ||
    row.required_transitions.length === 0 ||
    !row.required_transitions.every((entry) => ACCEPTED_GATE_TRANSITIONS.has(entry)) ||
    new Set(row.required_transitions).size !== row.required_transitions.length ||
    !Array.isArray(row.transitions) ||
    row.transitions.length === 0
  ) {
    return false;
  }
  const transitionNames = row.transitions.map((entry) => {
    if (!plainObject(entry)) return null;
    const name = entry.type ?? entry.name;
    return ACCEPTED_GATE_TRANSITIONS.has(name) ? name : null;
  });
  if (transitionNames.some((entry) => entry == null)) return false;
  if (new Set(transitionNames).size !== transitionNames.length) return false;
  return (
    stableJson([...row.required_transitions].sort()) === stableJson([...transitionNames].sort())
  );
};

/**
 * Canonicalize an accepted gate-registry batch for identical-record comparison.
 * Includes target/reviewed head and transition structure, not only artifact digests.
 */
export const canonicalizeAcceptedBatchRecord = (row) => {
  if (!acceptedBatchRecordIsWellFormed(row)) return null;
  // Preserve every field in the accepted row (events, preparation, approval,
  // and any future canonical content included by both tips). Object key order
  // is normalized only by stableJson at comparison time; array structure is exact.
  try {
    return JSON.parse(JSON.stringify(row));
  } catch {
    return null;
  }
};

/**
 * Require the gate PR head registry blob to contain the identical ACCEPTED batch
 * record (full canonical structure), not mere batch-id or digest-subset presence.
 */
export const registryHeadBindsAcceptedBatch = (registryText, batch) => {
  if (typeof registryText !== "string" || !plainObject(batch) || typeof batch.id !== "string") {
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(registryText);
  } catch {
    return false;
  }
  const rows = Array.isArray(parsed?.batches) ? parsed.batches : [];
  const matches = rows.filter((entry) => entry?.id === batch.id);
  if (matches.length !== 1) return false;
  const row = matches[0];
  if (row.status !== "ACCEPTED" || batch.status !== "ACCEPTED") return false;
  const expected = canonicalizeAcceptedBatchRecord(batch);
  const actual = canonicalizeAcceptedBatchRecord(row);
  if (!expected || !actual) return false;
  return stableJson(expected) === stableJson(actual);
};

/**
 * Online-strict process failure predicate. Ticket-level external ambiguity/blockers
 * (not ordinary missing gates) must fail the strict CLI even when top-level errors are empty.
 */
export const onlineStrictProcessShouldFail = (result) => {
  if (!result || typeof result !== "object") return true;
  const externalCodes = new Set([
    "EXTERNAL_STATE_UNAVAILABLE",
    "WRONG_TARGET",
    "TICKET_CONTRACT_CONFLICT",
    "TICKET_CONTRACT_INCOMPLETE"
  ]);
  if ((result.errors ?? []).some((entry) => externalCodes.has(entry?.code))) {
    return true;
  }
  for (const state of Object.values(result.tickets ?? {})) {
    if (state?.readiness === "unknown") return true;
    if (
      (state?.blockers ?? []).some((entry) =>
        ["TICKET_CONTRACT_CONFLICT", "EXTERNAL_STATE_UNAVAILABLE", "TICKET_CONTRACT_INCOMPLETE"].includes(
          entry?.code
        )
      )
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Fixture/test transport adapter. Provenance is explicit: responses must be supplied
 * by the test harness; missing keys fail closed as unavailable.
 */
export const createFixtureTransport = (responses) => {
  if (!plainObject(responses)) {
    throw new Error("fixture transport requires a response map");
  }
  return {
    kind: "fixture-authenticated",
    getJson(apiPath) {
      if (!Object.hasOwn(responses, apiPath)) {
        const err = new Error(`fixture missing json ${apiPath}`);
        err.code = "FIXTURE_MISSING";
        throw err;
      }
      const value = responses[apiPath];
      if (value && value.__not_found === true) {
        const err = new Error(`fixture authenticated not found at ${apiPath}`);
        err.code = "AUTHENTICATED_NOT_FOUND";
        throw err;
      }
      if (value === null) {
        const err = new Error(`fixture outage at ${apiPath}`);
        err.code = "FIXTURE_OUTAGE";
        throw err;
      }
      if (value && value.__ambiguous === true) {
        const err = new Error(`fixture ambiguous at ${apiPath}`);
        err.code = "FIXTURE_AMBIGUOUS";
        throw err;
      }
      return typeof value === "string" ? JSON.parse(value) : value;
    },
    getRaw(apiPath) {
      const key = `raw:${apiPath}`;
      if (!Object.hasOwn(responses, key) && !Object.hasOwn(responses, apiPath)) {
        const err = new Error(`fixture missing raw ${apiPath}`);
        err.code = "FIXTURE_MISSING";
        throw err;
      }
      const value = Object.hasOwn(responses, key) ? responses[key] : responses[apiPath];
      if (value && value.__not_found === true) {
        const err = new Error(`fixture authenticated not found at ${apiPath}`);
        err.code = "AUTHENTICATED_NOT_FOUND";
        throw err;
      }
      if (value === null) {
        const err = new Error(`fixture outage at ${apiPath}`);
        err.code = "FIXTURE_OUTAGE";
        throw err;
      }
      return typeof value === "string" ? value : JSON.stringify(value);
    }
  };
};

const transportFailureFromError = (error, apiPath) => {
  if (error?.code === "SECONDARY_RATE_LIMIT" || isGitHubSecondaryRateLimit(error)) {
    return {
      ok: false,
      reason: `EXTERNAL_STATE_UNAVAILABLE: GitHub secondary rate limit for ${apiPath}`,
      error,
      secondaryRateLimit: true
    };
  }
  if (
    error?.code === "COLLECTION_TIMEOUT" ||
    error?.code === "ETIMEDOUT" ||
    error?.killed === true ||
    /timeout/i.test(String(error?.message ?? ""))
  ) {
    return {
      ok: false,
      reason: `EXTERNAL_STATE_UNAVAILABLE: collection timeout for ${apiPath}`,
      error,
      timeout: true
    };
  }
  if (error instanceof SyntaxError) {
    return {
      ok: false,
      reason: `unparseable transport response for ${apiPath}`,
      error
    };
  }
  return {
    ok: false,
    reason: error?.code === "FIXTURE_AMBIGUOUS"
      ? `ambiguous external response for ${apiPath}`
      : `unavailable external response for ${apiPath}`,
    error
  };
};

const transportCall = (transport, method, apiPath) => {
  try {
    return { ok: true, value: transport[method](apiPath) };
  } catch (error) {
    return transportFailureFromError(error, apiPath);
  }
};

const callJsonMany = (transport, apiPaths) => {
  if (!Array.isArray(apiPaths) || apiPaths.length === 0) return [];
  if (typeof transport.getJsonMany === "function") {
    try {
      const results = transport.getJsonMany(apiPaths);
      if (!Array.isArray(results) || results.length !== apiPaths.length) {
        return apiPaths.map((apiPath) => ({
          ok: false,
          reason: `unavailable external response for ${apiPath}`
        }));
      }
      return results.map((result, index) => {
        if (result?.ok === true) return result;
        if (result?.ok === false) return result;
        return { ok: false, reason: `unavailable external response for ${apiPaths[index]}` };
      });
    } catch (error) {
      const named = typeof error?.apiPath === "string" && apiPaths.includes(error.apiPath)
        ? error.apiPath
        : apiPaths[0];
      return apiPaths.map((apiPath) => transportFailureFromError(error, named ?? apiPath));
    }
  }
  return apiPaths.map((apiPath) => transportCall(transport, "getJson", apiPath));
};

const callRawMany = (transport, apiPaths) => {
  if (!Array.isArray(apiPaths) || apiPaths.length === 0) return [];
  if (typeof transport.getRawMany === "function") {
    try {
      const results = transport.getRawMany(apiPaths);
      if (!Array.isArray(results) || results.length !== apiPaths.length) {
        return apiPaths.map((apiPath) => ({
          ok: false,
          reason: `unavailable external response for ${apiPath}`
        }));
      }
      return results.map((result, index) => {
        if (result?.ok === true) return result;
        if (result?.ok === false) return result;
        return { ok: false, reason: `unavailable external response for ${apiPaths[index]}` };
      });
    } catch (error) {
      return apiPaths.map((apiPath) => transportFailureFromError(error, apiPath));
    }
  }
  return apiPaths.map((apiPath) => transportCall(transport, "getRaw", apiPath));
};

const requireJsonMany = (transport, apiPaths, failures) => {
  const results = callJsonMany(transport, apiPaths);
  const fatal = results.find((result) => result?.secondaryRateLimit || result?.timeout);
  if (fatal) failures.push(fatal.reason);
  return results.map((result, index) => {
    if (result?.ok) return result.value;
    if (!fatal) failures.push(result?.reason ?? `unavailable external response for ${apiPaths[index]}`);
    return null;
  });
};

const requireRawMany = (transport, apiPaths, failures) => {
  const results = callRawMany(transport, apiPaths);
  const fatal = results.find((result) => result?.secondaryRateLimit || result?.timeout);
  if (fatal) failures.push(fatal.reason);
  return results.map((result, index) => {
    if (result?.ok) return result.value;
    if (!fatal) failures.push(result?.reason ?? `unavailable external response for ${apiPaths[index]}`);
    return null;
  });
};

/**
 * Verify a workflow SHA is reachable from (an ancestor of, or equal to) the live
 * trusted `dev` tip via an authenticated GitHub compare. `head_branch` is never
 * ancestry evidence: GitHub still reports a branch label for an orphan or detached
 * historical commit whose workflow blob happens to match, so trusting the label alone
 * lets a non-ancestor commit pass the protected check. Any compare outage or an
 * unrecognized compare status fails closed (never reachable, never a silent pass).
 */
const interpretGitHubCompareStatus = (status) => {
  // GitHub compare(base=dev, head=workflowSha): "behind"/"identical" means workflowSha is
  // an ancestor of (or equal to) dev; "ahead"/"diverged" means it is not reachable from dev.
  if (status === "identical" || status === "behind") return { ok: true, reachable: true, status };
  if (status === "ahead" || status === "diverged") return { ok: true, reachable: false, status };
  return { ok: false, reachable: false, reason: `unrecognized workflow ancestry compare status ${String(status)}` };
};

export const verifyWorkflowShaReachableFromDev = (transport, repoPath, devSha, workflowSha) => {
  if (typeof workflowSha !== "string" || !/^[0-9a-f]{40}$/i.test(workflowSha)) {
    return { ok: true, reachable: false };
  }
  if (typeof devSha !== "string" || !/^[0-9a-f]{40}$/i.test(devSha)) {
    return { ok: false, reachable: false, reason: "missing live dev tip SHA for workflow ancestry check" };
  }
  if (workflowSha === devSha) return { ok: true, reachable: true, status: "identical" };
  const result = transportCall(transport, "getJson", `${repoPath}/compare/${devSha}...${workflowSha}`);
  if (!result.ok) {
    return { ok: false, reachable: false, reason: result.reason || "workflow ancestry compare unavailable" };
  }
  return interpretGitHubCompareStatus(result.value?.status);
};

const resolveAncestryMany = (transport, repoPath, liveTip, shas, failures) => {
  const results = new Array(shas.length);
  const pendingIndexes = [];
  const pendingPaths = [];
  for (let i = 0; i < shas.length; i += 1) {
    const sha = shas[i];
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
      results[i] = { ok: true, reachable: false };
      continue;
    }
    if (typeof liveTip !== "string" || !/^[0-9a-f]{40}$/i.test(liveTip)) {
      results[i] = { ok: false, reachable: false, reason: "missing live dev tip SHA for workflow ancestry check" };
      continue;
    }
    if (sha === liveTip) {
      results[i] = { ok: true, reachable: true, status: "identical" };
      continue;
    }
    pendingIndexes.push(i);
    pendingPaths.push(`${repoPath}/compare/${liveTip}...${sha}`);
  }
  const batch = callJsonMany(transport, pendingPaths);
  const fatal = batch.find((result) => result?.secondaryRateLimit || result?.timeout);
  if (fatal) failures.push(fatal.reason);
  for (let j = 0; j < pendingIndexes.length; j += 1) {
    const i = pendingIndexes[j];
    const result = batch[j];
    if (result?.ok) {
      results[i] = interpretGitHubCompareStatus(result.value?.status);
      continue;
    }
    const reason = result?.reason ?? `unavailable external response for ${pendingPaths[j]}`;
    if (!fatal) failures.push(reason);
    results[i] = {
      ok: false,
      reachable: false,
      reason
    };
  }
  return results;
};

const isAuthenticatedNotFound = (result) =>
  result?.ok === false && result.error?.code === "AUTHENTICATED_NOT_FOUND";

const requireJson = (transport, apiPath, failures) => {
  const result = transportCall(transport, "getJson", apiPath);
  if (!result.ok) {
    failures.push(result.reason);
    return null;
  }
  return result.value;
};

/**
 * Collect a full GitHub list endpoint under the collector timeout budget.
 * First page uses the legacy URL (no page=) for fixture compatibility; later pages append &page=N.
 * A full final page without a short trailing page fails closed as possible truncation.
 */
const collectAllJsonPages = (transport, firstPagePath, failures, { perPage = 50, maxPages = 40, label = "list" } = {}) => {
  const first = requireJson(transport, firstPagePath, failures);
  if (!Array.isArray(first)) {
    failures.push(`${label} unavailable or not an array`);
    return null;
  }
  if (first.length < perPage) return first;
  const all = [...first];
  const pageSep = firstPagePath.includes("?") ? "&" : "?";
  for (let page = 2; page <= maxPages; page += 1) {
    const pagePath = `${firstPagePath}${pageSep}page=${page}`;
    const batch = requireJson(transport, pagePath, failures);
    if (!Array.isArray(batch)) {
      failures.push(`${label} page ${page} unavailable or truncated`);
      return null;
    }
    all.push(...batch);
    if (batch.length < perPage) return all;
  }
  failures.push(`${label} truncated after ${maxPages} pages of ${perPage}`);
  return null;
};

const rejectPossiblyTruncatedList = (items, perPage, failures, label) => {
  if (!Array.isArray(items)) return false;
  if (items.length >= perPage) {
    failures.push(`${label} possibly truncated at ${perPage} items`);
    return true;
  }
  return false;
};

/**
 * Authoritative GitHub list payloads require a present, finite, nonnegative integer
 * total_count that exactly equals the returned array length for non-paginated bounded
 * collection. Full pages also fail closed (possible omitted next page).
 */
const rejectPartialCountPayload = (payload, arrayKey, perPage, failures, label) => {
  if (!payload || typeof payload !== "object") {
    failures.push(`${label} payload missing`);
    return true;
  }
  const items = payload[arrayKey];
  if (!Array.isArray(items)) {
    failures.push(`${label} ${arrayKey} missing or not an array`);
    return true;
  }
  if (typeof payload.total_count !== "number" || !Number.isFinite(payload.total_count)) {
    failures.push(`${label} missing total_count`);
    return true;
  }
  if (payload.total_count < 0 || !Number.isInteger(payload.total_count)) {
    failures.push(`${label} invalid total_count`);
    return true;
  }
  if (payload.total_count !== items.length) {
    failures.push(
      `${label} total_count ${payload.total_count} disagrees with returned ${items.length}`
    );
    return true;
  }
  if (items.length >= perPage) {
    failures.push(`${label} possibly truncated at ${perPage} items`);
    return true;
  }
  return false;
};

/**
 * Collect every page of a GitHub search result. A single page that happens to be full is
 * not evidence of truncation, but a collection that cannot be completed is: the promised
 * total_count must be reached exactly, or the whole collection fails closed. GitHub caps
 * search at 1000 results, so a total beyond that is uncollectable and also fails closed.
 */
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 10;
const collectSearchItems = (transport, queryPath, failures, label) => {
  const separator = queryPath.includes("?") ? "&" : "?";
  const items = [];
  let expectedTotal = null;
  for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
    const payload = requireJson(
      transport,
      `${queryPath}${separator}per_page=${SEARCH_PAGE_SIZE}&page=${page}`,
      failures
    );
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
      failures.push(`${label} page ${page} unavailable or not a search payload`);
      return null;
    }
    const total = payload.total_count;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
      failures.push(`${label} missing or invalid total_count`);
      return null;
    }
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal) {
      failures.push(`${label} total_count changed from ${expectedTotal} to ${total} between pages`);
      return null;
    }
    // R14: the flag must be a present boolean. A missing or non-boolean flag is a
    // malformed payload, not an implicit "complete".
    if (typeof payload.incomplete_results !== "boolean") {
      failures.push(`${label} page ${page} has a missing or malformed incomplete_results flag`);
      return null;
    }
    if (payload.incomplete_results) {
      failures.push(`${label} reported incomplete results`);
      return null;
    }
    items.push(...payload.items);
    if (items.length >= expectedTotal) break;
    if (payload.items.length === 0) break;
  }
  if (expectedTotal === null || items.length !== expectedTotal) {
    failures.push(`${label} collected ${items.length} of ${expectedTotal ?? "unknown"} results`);
    return null;
  }
  return items;
};

const requireRaw = (transport, apiPath, failures) => {
  const result = transportCall(transport, "getRaw", apiPath);
  if (!result.ok) {
    failures.push(result.reason);
    return null;
  }
  return result.value;
};

const parseTicketIdFromBody = (body) => {
  const field = extractExactTicketField(body ?? "");
  return field.ok ? field.ticketId : null;
};

const parseGateBatchFromBody = (body) => {
  const field = extractExactGateBatchField(body ?? "");
  return field.ok ? field.batchId : null;
};

const selectLatestWorkflowRun = (runs) => {
  const selected = selectLatestRunAttempt(runs);
  if (selected.ambiguous) return { ok: false, reason: "ambiguous workflow run attempts" };
  if (selected.missing || !selected.run) return { ok: false, reason: "missing workflow run" };
  return { ok: true, run: selected.run };
};

/**
 * A small number of historical implementation merges predate the `Ticket:`/`Ticket-Completion:`
 * structured PR-body grammar that the primary search-based path relies on (D0-001 merged via
 * PR #130, D0-002 via PR #143, both before that grammar existed). This is the sole legacy
 * completion exception declared by the D0-004 ticket contract: each binding is keyed on the
 * exact PR number and merge commit SHA for its ticket, and nothing else ever qualifies.
 * Retroactively adding `Ticket:`/`Ticket-Completion:` lines to an already-merged PR body is a
 * separate, explicitly-authorized metadata correction and is never performed by this resolver.
 * Each entry here is therefore independently re-verified against live authenticated GitHub facts
 * (merged state, exact merge commit SHA, base branch, ancestry/reachability from the live target
 * branch, and post-merge CI) before being trusted; any outage, ambiguity, or mismatch fails the
 * whole collection closed rather than silently skipping it.
 */
export const HISTORICAL_IMPLEMENTATION_LINKAGE = {
  "D0-001": {
    pr_number: 130,
    merge_commit_sha: "6e872ccf2387067b49217a27a7c255343ad2eb8d",
    base_branch: "dev"
  },
  "D0-002": {
    pr_number: 143,
    merge_commit_sha: "782946e96baa4a3f2734a2ad6b42210d289bebb7",
    base_branch: "dev"
  }
};

/**
 * Apply HISTORICAL_IMPLEMENTATION_LINKAGE on top of whatever the primary Ticket-field
 * search already found. Returns false (and appends to `failures`) on any outage,
 * ambiguity, or mismatch between the declared historical fact and the live PR/CI state.
 * `liveTip` authenticates the completion merge commit as reachable from (an ancestor of,
 * or equal to) the live target branch — the same compare-based check used for trusted
 * workflow SHAs (verifyWorkflowShaReachableFromDev); a compare outage or an unrecognized
 * compare status fails the whole collection closed rather than defaulting to reachable.
 */
export const applyHistoricalImplementationLinkage = (
  transport,
  repoPath,
  tickets,
  failures,
  { implementationMerges, postMergeCI, verifiedTickets, ancestryFacts },
  liveTip
) => {
  for (const [ticketId, link] of Object.entries(HISTORICAL_IMPLEMENTATION_LINKAGE)) {
    if (!tickets[ticketId]) continue;
    if (implementationMerges.some((entry) => entry.ticket_id === ticketId)) continue;
    const pull = requireJson(transport, `${repoPath}/pulls/${link.pr_number}`, failures);
    if (!pull) return false;
    if (
      pull.merged !== true ||
      pull.merge_commit_sha !== link.merge_commit_sha ||
      pull.base?.ref !== link.base_branch
    ) {
      failures.push(`historical implementation linkage mismatch for ${ticketId} PR #${link.pr_number}`);
      return false;
    }
    const ancestry = verifyWorkflowShaReachableFromDev(transport, repoPath, liveTip, pull.merge_commit_sha);
    if (!ancestry.ok) {
      failures.push(
        ancestry.reason || `historical implementation linkage ancestry unavailable for ${ticketId} PR #${link.pr_number}`
      );
      return false;
    }
    recordAncestryCompare(ancestryFacts, liveTip, pull.merge_commit_sha, ancestry.status);
    const runs = requireJson(
      transport,
      `${repoPath}/actions/runs?head_sha=${pull.merge_commit_sha}&event=push&per_page=20`,
      failures
    );
    if (
      !runs ||
      rejectPartialCountPayload(
        runs,
        "workflow_runs",
        20,
        failures,
        `historical implementation post-merge runs for #${link.pr_number}`
      )
    ) {
      return false;
    }
    const ciRuns = runs.workflow_runs.filter((run) => run.name === "CI" || run.path === ".github/workflows/ci.yml");
    const latest = selectLatestWorkflowRun(
      ciRuns.map((run) => ({
        head_sha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        run_id: run.id,
        run_attempt: run.run_attempt
      }))
    );
    // A legacy binding is a completion too, so it owes the same effect-still-present
    // evidence as a marker-carrying receipt.
    const legacyCommit = requireJson(transport, `${repoPath}/commits/${pull.merge_commit_sha}`, failures);
    if (!legacyCommit || !Array.isArray(legacyCommit.files)) {
      failures.push(`historical completion merge ${pull.merge_commit_sha} file list unavailable`);
      return false;
    }
    // Always record the merge receipt so failed/nonterminal post-merge CI is classified
    // by the resolver (POST_MERGE_CI_FAILED / MISSING), not silently discarded.
    const legacyEffect = filesToEffect(legacyCommit.files);
    implementationMerges.push({
      ticket_id: ticketId,
      merge_commit_sha: pull.merge_commit_sha,
      number: pull.number,
      reachable: ancestry.reachable,
      added_paths: legacyCommit.files
        .filter((file) => file?.status === "added" && typeof file.filename === "string")
        .map((file) => file.filename)
        .sort(),
      changed_paths: legacyEffect?.changed ?? null,
      removed_paths: legacyEffect?.removed ?? null
    });
    if (!latest.ok) continue;
    postMergeCI.push({
      merge_commit_sha: pull.merge_commit_sha,
      head_sha: latest.run.head_sha,
      status: latest.run.status,
      conclusion: latest.run.conclusion,
      run_id: latest.run.run_id,
      run_attempt: latest.run.run_attempt
    });
    if (latest.run.status === "completed" && latest.run.conclusion === "success") {
      if (!verifiedTickets.includes(ticketId)) verifiedTickets.push(ticketId);
    }
  }
  return true;
};

/**
 * Build ticket → owning PRD path + required ADR ids from TRACEABILITY semantic catalog.
 */
export const buildTicketAuthorityIndex = (traceabilityMarkdown) => {
  if (typeof traceabilityMarkdown !== "string" || !traceabilityMarkdown.trim()) {
    return { ok: false, reason: "traceability markdown missing", index: null };
  }
  const match = traceabilityMarkdown.match(
    /<!--\s*AOS_SEMANTIC_CATALOG_V2_START\s*-->\s*```json\s*([\s\S]*?)\s*```/i
  );
  if (!match?.[1]) {
    return { ok: false, reason: "semantic catalog v2 missing from TRACEABILITY", index: null };
  }
  let catalog;
  try {
    catalog = JSON.parse(match[1]);
  } catch {
    return { ok: false, reason: "semantic catalog JSON malformed", index: null };
  }
  const index = {};
  for (const prd of catalog.prds ?? []) {
    if (typeof prd?.path !== "string" || !prd.path.startsWith("docs/prd/")) {
      return { ok: false, reason: `catalog PRD path invalid for ${prd?.id ?? "?"}`, index: null };
    }
    const adr_ids = Array.isArray(prd.adr_ids) ? prd.adr_ids.map(String) : [];
    for (const ticketId of prd.ticket_ids ?? []) {
      if (typeof ticketId !== "string" || !ticketId) continue;
      index[ticketId] = {
        prd_id: prd.id ?? null,
        prd_path: prd.path,
        adr_ids: [...adr_ids]
      };
    }
  }
  return { ok: true, index };
};

/** Owning PRD path from ticket markdown front-matter link. */
export const parseOwningPrdPathFromTicket = (markdown) => {
  if (typeof markdown !== "string") return null;
  const match =
    markdown.match(/Owning PRD:\s*\[[^\]]*\]\(\.\.\/\.\.\/prd\/([^)\s]+)\)/i) ||
    markdown.match(/Owning PRD:\s*\[[^\]]*\]\((?:\.\/)?(?:\.\.\/)*prd\/([^)\s]+)\)/i) ||
    markdown.match(/Owning PRD:\s*\[[^\]]*\]\((?:\/)?docs\/prd\/([^)\s]+)\)/i);
  if (!match?.[1]) return null;
  return `docs/prd/${match[1]}`;
};

const resolveAdrPathFromDigests = (adrId, digests) => {
  if (typeof adrId !== "string" || !digests) return null;
  const hit = Object.keys(digests).find(
    (path) => path.startsWith("docs/adr/") && (path.includes(`/${adrId}-`) || path.includes(`/${adrId}.`))
  );
  return hit ?? null;
};

/**
 * Bounded authenticated live collector for the full operational fact corpus required
 * by online-strict resolution. Static catalog bytes are read from the live target tip
 * via the authenticated transport; mutable GitHub state is collected with read-only APIs.
 * Partial, outage, or ambiguous responses fail closed — no empty-corpus fallback.
 */
export const collectLiveExecutionFacts = (root = DEFAULT_ROOT, options = {}) => {
  const failures = [];
  const timeoutOptions = {
    perCallTimeoutMs: options.perCallTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs,
    concurrency: options.concurrency
  };
  const baseTransport =
    options.transport ??
    createAuthenticatedGitHubTransport(root, timeoutOptions);
  if (!baseTransport || typeof baseTransport.getJson !== "function" || typeof baseTransport.getRaw !== "function") {
    return { ok: false, reason: "authenticated transport unavailable", facts: null };
  }
  const transport = withCollectionTimeouts(baseTransport, timeoutOptions);

  const expected = expectedActorPolicyFromTicket();
  const repoPath = `repos/${expected.repository}`;
  const repo = requireJson(transport, repoPath, failures);
  if (!repo) return { ok: false, reason: failures.join("; "), facts: null };
  if (!repo.owner?.login || !repo.owner?.type || !repo.default_branch) {
    return { ok: false, reason: "repository owner/default_branch unavailable", facts: null };
  }
  if (repo.owner.login !== expected.repository_owner.login || repo.owner.type !== expected.repository_owner.type) {
    return { ok: false, reason: "live repository owner does not match actor policy", facts: null };
  }
  if (repo.default_branch !== expected.target_branch) {
    return { ok: false, reason: "live default branch does not match actor policy target_branch", facts: null };
  }

  const refPath = `${repoPath}/git/ref/heads/${repo.default_branch}`;
  const ref = requireJson(transport, refPath, failures);
  const liveTip = ref?.object?.sha;
  if (!liveTip || !/^[0-9a-f]{40}$/i.test(liveTip)) {
    return { ok: false, reason: "live target tip SHA unavailable", facts: null };
  }

  const liveFileTexts = {};
  const readTipFile = (path) => {
    if (Object.hasOwn(liveFileTexts, path)) return liveFileTexts[path];
    const api = `${repoPath}/contents/${path}?ref=${liveTip}`;
    const text = requireRaw(transport, api, failures);
    if (text != null) liveFileTexts[path] = text;
    return text;
  };
  const readTipFiles = (paths) => {
    const unique = [];
    const seen = new Set();
    for (const path of paths) {
      if (!path || seen.has(path) || Object.hasOwn(liveFileTexts, path)) continue;
      seen.add(path);
      unique.push(path);
    }
    if (unique.length) {
      const texts = requireRawMany(
        transport,
        unique.map((path) => `${repoPath}/contents/${path}?ref=${liveTip}`),
        failures
      );
      for (let i = 0; i < unique.length; i += 1) {
        if (texts[i] != null) liveFileTexts[unique[i]] = texts[i];
      }
    }
    return paths.map((path) => (path && Object.hasOwn(liveFileTexts, path) ? liveFileTexts[path] : null));
  };

  const registryText = readTipFile("docs/decisions/maintainer-gate-registry.v2.json");
  const issuesText = readTipFile("docs/issues.json");
  if (!registryText || !issuesText) {
    return { ok: false, reason: failures.join("; ") || "static authority files unavailable at live tip", facts: null };
  }

  let registry;
  let issuesCatalog;
  try {
    registry = JSON.parse(registryText);
    issuesCatalog = JSON.parse(issuesText);
  } catch {
    return { ok: false, reason: "malformed registry or issues catalog at live tip", facts: null };
  }

  if (!plainObject(issuesCatalog?.operational_authority)) {
    return { ok: false, reason: "issues catalog missing operational_authority", facts: null };
  }
  if (!actorPolicyAgrees(issuesCatalog.operational_authority)) {
    return { ok: false, reason: "live operational_authority does not match ticket actor policy", facts: null };
  }

  const catalogTickets = Array.isArray(issuesCatalog.tickets) ? issuesCatalog.tickets : null;
  if (!catalogTickets || catalogTickets.length === 0) {
    return { ok: false, reason: "issues catalog ticket corpus empty", facts: null };
  }

  const liveDigests = {};

  // Authority paths: TRACEABILITY catalog + tickets + owning PRDs + ADR corpus from INDEX.
  const authorityPaths = new Set();
  const traceText = readTipFile("docs/TRACEABILITY.md");
  if (traceText == null) {
    return { ok: false, reason: failures.join("; ") || "TRACEABILITY unavailable at live tip", facts: null };
  }
  const authorityIndexResult = buildTicketAuthorityIndex(traceText);
  if (!authorityIndexResult.ok) {
    return { ok: false, reason: authorityIndexResult.reason, facts: null };
  }
  const authorityIndex = authorityIndexResult.index;
  for (const entry of catalogTickets) {
    if (entry?.ticket_path) authorityPaths.add(entry.ticket_path);
  }
  for (const authority of Object.values(authorityIndex)) {
    if (authority.prd_path) authorityPaths.add(authority.prd_path);
  }
  const adrIndexText = readTipFile("docs/adr/INDEX.md");
  if (adrIndexText == null) {
    return { ok: false, reason: failures.join("; ") || "ADR INDEX unavailable at live tip", facts: null };
  }
  for (const match of adrIndexText.matchAll(/\]\((ADR-\d{4}-[^)\s]+\.md)\)/g)) {
    authorityPaths.add(`docs/adr/${match[1]}`);
  }
  const authorityList = [...authorityPaths];
  const authorityTexts = readTipFiles(authorityList);
  for (let i = 0; i < authorityList.length; i += 1) {
    const path = authorityList[i];
    const text = authorityTexts[i];
    if (text == null) {
      return { ok: false, reason: failures.join("; ") || `live digest unavailable for ${path}`, facts: null };
    }
    liveDigests[path] = sha256Text(text);
  }

  const tickets = {};
  for (const entry of catalogTickets) {
    if (!entry?.id || !entry?.ticket_path) {
      return { ok: false, reason: "catalog ticket missing id or ticket_path", facts: null };
    }
    const ticketDigest = liveDigests[entry.ticket_path];
    if (!ticketDigest) {
      return { ok: false, reason: `missing live ticket digest for ${entry.id}`, facts: null };
    }
    const kind = entry.kind === "superseded" ? "superseded" : "executable";
    const authority = authorityIndex[entry.id] ?? null;
    if (kind === "executable" && !authority) {
      return { ok: false, reason: `authority index missing ticket ${entry.id}`, facts: null };
    }
    const prdPath = authority?.prd_path ?? null;
    const adrIds = authority?.adr_ids ?? [];
    if (kind === "executable") {
      if (typeof prdPath !== "string" || !prdPath.startsWith("docs/prd/")) {
        return { ok: false, reason: `owning PRD path missing for ${entry.id}`, facts: null };
      }
      if (!liveDigests[prdPath]) {
        return { ok: false, reason: `live digest unavailable for ${prdPath}`, facts: null };
      }
    }
    const adrs = {};
    const adr_paths = {};
    for (const adrId of adrIds) {
      const adrPath = resolveAdrPathFromDigests(adrId, liveDigests);
      if (!adrPath || !liveDigests[adrPath]) {
        return { ok: false, reason: `live ADR path unavailable for ${entry.id} ${adrId}`, facts: null };
      }
      adrs[adrId] = liveDigests[adrPath];
      adr_paths[adrId] = adrPath;
    }
    tickets[entry.id] = {
      kind,
      dependencies: Array.isArray(entry.dependencies) ? [...entry.dependencies] : [],
      owned_paths: [],
      owned_symbols: [],
      red_command: null,
      prd_path: prdPath,
      adr_paths,
      digests: {
        ticket: ticketDigest,
        prd: prdPath ? liveDigests[prdPath] : null,
        prd_path: prdPath,
        adrs,
        adr_paths
      },
      ticket_path: entry.ticket_path
    };
  }

  // Detect D0-004C from tip workflow blob for multi-lane ownership selection (B vs C).
  // One recursive tree listing at the live tip answers every completion-effect check.
  const liveTree = requireJson(transport, `${repoPath}/git/trees/${liveTip}?recursive=1`, failures);
  if (!liveTree || !Array.isArray(liveTree.tree)) {
    return { ok: false, reason: failures.join("; ") || "live tree listing unavailable", facts: null };
  }
  if (liveTree.truncated === true) {
    return { ok: false, reason: "live tree listing truncated, completion effects cannot be confirmed", facts: null };
  }
  const liveTreePaths = liveTree.tree
    .filter((node) => node?.type === "blob" && typeof node.path === "string")
    .map((node) => node.path);

  const opsWorkflowProbe = transportCall(
    transport,
    "getJson",
    `${repoPath}/contents/.github/workflows/operational-state.yml?ref=${liveTip}`
  );
  if (!opsWorkflowProbe.ok && !isAuthenticatedNotFound(opsWorkflowProbe)) {
    return { ok: false, reason: opsWorkflowProbe.reason, facts: null };
  }
  if (opsWorkflowProbe.ok && (typeof opsWorkflowProbe.value?.sha !== "string" || !opsWorkflowProbe.value.sha)) {
    return {
      ok: false,
      reason: "EXTERNAL_STATE_UNAVAILABLE: partial operational-state workflow probe",
      facts: null
    };
  }
  const d0_004c_merged_early = opsWorkflowProbe.ok;
  const executableTickets = Object.entries(tickets).filter(([, ticket]) => ticket.kind === "executable");
  const executableBodies = readTipFiles(executableTickets.map(([, ticket]) => ticket.ticket_path));
  for (let i = 0; i < executableTickets.length; i += 1) {
    const [ticketId, ticket] = executableTickets[i];
    const ticketBody = executableBodies[i];
    if (ticketBody == null) {
      return {
        ok: false,
        reason: failures.join("; ") || `ticket body unavailable for ${ticketId}`,
        facts: null
      };
    }
    const ownership = parseTicketOwnershipAndRed(ticketBody, {
      ticketId,
      d0_004c_merged: d0_004c_merged_early
    });
    if (!ownership.ok) {
      return {
        ok: false,
        reason: `ambiguous or missing ownership/red mapping for ${ticketId}: ${ownership.reason}`,
        facts: null
      };
    }
    const owningPrdFromTicket = parseOwningPrdPathFromTicket(ticketBody);
    if (owningPrdFromTicket && ticket.prd_path && owningPrdFromTicket !== ticket.prd_path) {
      return {
        ok: false,
        reason: `owning PRD mismatch for ${ticketId}: ticket ${owningPrdFromTicket} vs catalog ${ticket.prd_path}`,
        facts: null
      };
    }
    ticket.owned_paths = ownership.owned_paths;
    ticket.owned_symbols = ownership.owned_symbols;
    ticket.red_command = ownership.red_command;
    delete ticket.ticket_path;
  }

  const acceptedBatches = (Array.isArray(registry.batches) ? registry.batches : []).filter(
    (batch) => batch?.status === "ACCEPTED"
  );
  // Preserve full accepted registry records for identical head binding (not a digest subset).
  const gateBatches = acceptedBatches.map((batch) => {
    const required_artifacts = Array.isArray(batch.required_artifacts)
      ? batch.required_artifacts
      : Array.isArray(batch.artifacts)
        ? batch.artifacts
        : [];
    return {
      ...batch,
      id: batch.id,
      status: "ACCEPTED",
      required_artifacts
    };
  });

  // Collect gate PRs from one Gate-Batch corpus search, then select each
  // accepted batch's receipt by the exact parsed field. A per-batch search
  // grows with the registry and hits GitHub's search rate limit; a truncated
  // or unavailable corpus is not evidence that a batch has no receipt.
  const gatePRs = [];
  const postMergeCI = [];
  const seenGatePr = new Set();
  const gateSearchItems = collectSearchItems(
    transport,
    `search/issues?q=${encodeURIComponent(`repo:${expected.repository} is:pr is:merged "Gate-Batch:"`)}`,
    failures,
    "gate PR corpus search"
  );
  if (!gateSearchItems) {
    return { ok: false, reason: failures.join("; ") || "gate PR corpus search unavailable", facts: null };
  }

  const receiptsByBatchId = new Map();
  const seenCorpusPr = new Set();
  const corpusNumbers = [];
  for (const item of gateSearchItems) {
    // Search is token-based, not a structured-field match. A hyphen-delimited
    // id whose tokens are a proper prefix of another id, or unrelated prose
    // carrying the same tokens, is a deterministic false candidate. The search
    // body is a snippet, not the pull resource: empty, prefix, or truncated
    // text is not evidence that the field is absent. Fetch every corpus row
    // and parse pull.body.
    const number = item?.number;
    if (!Number.isInteger(number)) {
      return { ok: false, reason: "gate PR corpus search returned a row without an issue number", facts: null };
    }
    if (seenCorpusPr.has(number)) continue;
    seenCorpusPr.add(number);
    corpusNumbers.push(number);
  }
  const corpusPulls = requireJsonMany(
    transport,
    corpusNumbers.map((number) => `${repoPath}/pulls/${number}`),
    failures
  );
  for (let i = 0; i < corpusNumbers.length; i += 1) {
    const number = corpusNumbers[i];
    const pull = corpusPulls[i];
    if (!pull) return { ok: false, reason: failures.join("; "), facts: null };
    const claimedId = parseGateBatchFromBody(pull.body);
    if (!claimedId) continue;
    const claimed = receiptsByBatchId.get(claimedId) ?? [];
    claimed.push({ number, pull });
    receiptsByBatchId.set(claimedId, claimed);
  }

  const selectedGates = [];
  for (const batch of gateBatches) {
    const exactMatches = receiptsByBatchId.get(batch.id) ?? [];
    if (exactMatches.length === 0) {
      // No exact gate PR for this accepted registry row — leave unmatched
      // (gate acceptance fails closed later). Same outcome as a zero-result search.
      continue;
    }
    if (exactMatches.length !== 1) {
      return { ok: false, reason: `ambiguous gate PR set for batch ${batch.id}`, facts: null };
    }
    const { number, pull } = exactMatches[0];
    if (seenGatePr.has(number)) continue;
    if (pull.base?.ref !== expected.target_branch || pull.merged !== true) {
      return { ok: false, reason: `gate PR #${number} is not merged into ${expected.target_branch}`, facts: null };
    }
    if (!pull.merge_commit_sha || !pull.merged_by?.login) {
      return { ok: false, reason: `gate PR #${number} missing merge actor/sha`, facts: null };
    }
    // head_contains_batch: gate PR head registry must bind the identical ACCEPTED
    // batch record and artifact digests — batch-id string presence is insufficient.
    const gateHeadSha = pull.head?.sha;
    if (!gateHeadSha || !/^[0-9a-f]{40}$/i.test(gateHeadSha)) {
      return { ok: false, reason: `gate PR #${number} missing head SHA`, facts: null };
    }
    seenGatePr.add(number);
    selectedGates.push({ batch, number, pull, gateHeadSha });
  }
  const gateRegistryTexts = requireRawMany(
    transport,
    selectedGates.map(
      (entry) => `${repoPath}/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${entry.gateHeadSha}`
    ),
    failures
  );
  for (let i = 0; i < selectedGates.length; i += 1) {
    const { batch, number, gateHeadSha } = selectedGates[i];
    const registryAtHead = gateRegistryTexts[i];
    if (registryAtHead == null) {
      return {
        ok: false,
        reason: failures.join("; ") || `registry unavailable at gate head ${gateHeadSha}`,
        facts: null
      };
    }
    if (!registryHeadBindsAcceptedBatch(registryAtHead, batch)) {
      return {
        ok: false,
        reason: `gate PR #${number} head registry does not bind identical ACCEPTED batch ${batch.id}`,
        facts: null
      };
    }
  }
  const gateRunPayloads = requireJsonMany(
    transport,
    selectedGates.map(
      (entry) => `${repoPath}/actions/runs?head_sha=${entry.pull.merge_commit_sha}&event=push&per_page=20`
    ),
    failures
  );
  for (let i = 0; i < selectedGates.length; i += 1) {
    const { number, pull, gateHeadSha } = selectedGates[i];
    gatePRs.push({
      number,
      base: pull.base.ref,
      head_sha: gateHeadSha,
      body: pull.body,
      merged: true,
      merged_by: pull.merged_by.login,
      merge_commit_sha: pull.merge_commit_sha,
      author: pull.user?.login ?? null,
      head_contains_batch: true
    });

    const runs = gateRunPayloads[i];
    if (
      !runs ||
      rejectPartialCountPayload(
        runs,
        "workflow_runs",
        20,
        failures,
        `post-merge runs for ${pull.merge_commit_sha}`
      )
    ) {
      return { ok: false, reason: failures.join("; ") || `post-merge runs unavailable for ${pull.merge_commit_sha}`, facts: null };
    }
    const ciRuns = runs.workflow_runs.filter((run) => run.name === "CI" || run.path === ".github/workflows/ci.yml");
    const latest = selectLatestWorkflowRun(
      ciRuns.map((run) => ({
        merge_commit_sha: pull.merge_commit_sha,
        head_sha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        run_id: run.id,
        run_attempt: run.run_attempt,
        name: run.name,
        event: run.event,
        workflow_path: run.path
      }))
    );
    if (!latest.ok) {
      // Record absence as missing post-merge rather than inventing success.
      continue;
    }
    postMergeCI.push({
      merge_commit_sha: pull.merge_commit_sha,
      head_sha: latest.run.head_sha,
      status: latest.run.status,
      conclusion: latest.run.conclusion,
      run_id: latest.run.run_id,
      run_attempt: latest.run.run_attempt
    });
  }

  // Active candidates: open PRs targeting live default branch (all pages; truncation fails closed).
  const openPulls = collectAllJsonPages(
    transport,
    `${repoPath}/pulls?state=open&base=${repo.default_branch}&per_page=50`,
    failures,
    { perPage: 50, maxPages: 40, label: "open pull list" }
  );
  if (!Array.isArray(openPulls)) {
    return { ok: false, reason: failures.join("; ") || "open pull list unavailable", facts: null };
  }

  const prs = [];
  const reviews = [];
  const authorizations = [];
  const checkRuns = [];
  const workflowRuns = [];
  const permissions = {};
  const actors = new Set([repo.owner.login]);

  const ensurePermission = (login) => {
    if (!login || permissions[login]) return;
    const perm = requireJson(transport, `${repoPath}/collaborators/${login}/permission`, failures);
    if (!perm || typeof perm.permission !== "string") {
      failures.push(`permission unavailable for ${login}`);
      return;
    }
    permissions[login] = perm.permission;
  };
  ensurePermission(repo.owner.login);

  for (const pull of openPulls) {
    const body = pull.body ?? "";
    const ticketId = parseTicketIdFromBody(body);
    const author = pull.user?.login ?? null;
    const authenticatedBaseSha = pull.base?.sha;
    if (typeof authenticatedBaseSha !== "string" || !/^[0-9a-f]{40}$/i.test(authenticatedBaseSha)) {
      return { ok: false, reason: `authenticated pull.base.sha unavailable for PR #${pull.number}`, facts: null };
    }
    if (author) actors.add(author);
    prs.push({
      number: pull.number,
      base: pull.base?.ref,
      base_sha: authenticatedBaseSha,
      head_sha: pull.head?.sha,
      author,
      body,
      merged: false,
      state: pull.state,
      labels: Array.isArray(pull.labels) ? pull.labels.map((label) => label.name) : []
    });

    if (!ticketId || !pull.head?.sha) continue;

    // Candidate CI: workflow runs → jobs API mapping (check name must bind to selected run attempt).
    const head = pull.head.sha;
    const headRuns = requireJson(
      transport,
      `${repoPath}/actions/runs?head_sha=${head}&event=pull_request&per_page=30`,
      failures
    );
    if (
      !headRuns ||
      rejectPartialCountPayload(headRuns, "workflow_runs", 30, failures, `workflow runs for ${head}`)
    ) {
      return { ok: false, reason: failures.join("; ") || `workflow runs unavailable for ${head}`, facts: null };
    }
    const checksPayload = requireJson(
      transport,
      `${repoPath}/commits/${head}/check-runs?per_page=50`,
      failures
    );
    if (
      !checksPayload ||
      rejectPartialCountPayload(checksPayload, "check_runs", 50, failures, `check runs for ${head}`)
    ) {
      return { ok: false, reason: failures.join("; ") || `check runs unavailable for ${head}`, facts: null };
    }
    const checksById = new Map();
    const checksByName = new Map();
    const consumedCheckRunIds = new Set();
    for (const check of checksPayload.check_runs) {
      if (check?.id != null) {
        if (checksById.has(Number(check.id))) {
          return { ok: false, reason: `duplicate live check-run id ${check.id} on ${head}`, facts: null };
        }
        checksById.set(Number(check.id), check);
      }
      if (typeof check?.name === "string") {
        const list = checksByName.get(check.name) ?? [];
        list.push(check);
        checksByName.set(check.name, list);
      }
    }

    const requiredCandidateChecks = expected.candidate_ci.required_checks.filter(
      (check) => d0_004c_merged_early || check.name !== "operational-state-offline"
    );
    const requiredByWorkflow = new Map();
    for (const requiredCheck of requiredCandidateChecks) {
      const names = requiredByWorkflow.get(requiredCheck.workflow_path) ?? new Set();
      names.add(requiredCheck.name);
      requiredByWorkflow.set(requiredCheck.workflow_path, names);
    }

    for (const [workflowPath, requiredNames] of requiredByWorkflow) {
      const candidates = headRuns.workflow_runs.filter(
        (run) =>
          run?.path === workflowPath &&
          run?.head_sha === head &&
          run?.event === expected.candidate_ci.required_event
      );
      const selected = selectLatestWorkflowRun(
        candidates.map((run) => ({ ...run, run_id: run.id }))
      );
      if (!selected.ok) {
        return {
          ok: false,
          reason: `${selected.reason} for required workflow ${workflowPath} on ${head}`,
          facts: null
        };
      }
      const run = selected.run;
      if (typeof run.id !== "number" || typeof run.run_attempt !== "number") {
        return {
          ok: false,
          reason: `missing live run_id/run_attempt for workflow run on ${head}`,
          facts: null
        };
      }
      if (typeof run.event !== "string" || !run.event) {
        return {
          ok: false,
          reason: `missing live workflow event for run ${run.id} on ${head}`,
          facts: null
        };
      }
      if (typeof run.path !== "string" || !run.path) {
        return {
          ok: false,
          reason: `missing live workflow path for run ${run.id} on ${head}`,
          facts: null
        };
      }
      const attemptJobs = transportCall(
        transport,
        "getJson",
        `${repoPath}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=50`
      );
      if (!attemptJobs.ok || !Array.isArray(attemptJobs.value?.jobs)) {
        return {
          ok: false,
          reason: attemptJobs.reason || `attempt-specific jobs unavailable for run ${run.id} attempt ${run.run_attempt}`,
          facts: null
        };
      }
      const jobsPayload = attemptJobs.value;
      const jobs = jobsPayload.jobs;
      if (
        rejectPartialCountPayload(
          jobsPayload,
          "jobs",
          50,
          failures,
          `attempt jobs for run ${run.id} attempt ${run.run_attempt}`
        )
      ) {
        return {
          ok: false,
          reason: failures.join("; ") || `attempt jobs partial for run ${run.id} attempt ${run.run_attempt}`,
          facts: null
        };
      }
      for (const requiredName of requiredNames) {
        const matchingJobs = jobs.filter((job) => job?.name === requiredName);
        if (matchingJobs.length !== 1) {
          return {
            ok: false,
            reason: `ambiguous or missing required job ${requiredName} for run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        const job = matchingJobs[0];
        if (job.run_id != null && Number(job.run_id) !== run.id) {
          return {
            ok: false,
            reason: `job ${job.name} mapped to wrong run ${job.run_id}; expected ${run.id}`,
            facts: null
          };
        }
        if (job.run_attempt != null && Number(job.run_attempt) !== run.run_attempt) {
          return {
            ok: false,
            reason: `job ${job.name} mapped to wrong attempt ${job.run_attempt}; expected ${run.run_attempt}`,
            facts: null
          };
        }
        // Bind check-run to this exact run/attempt — never reuse another attempt's check by name alone.
        let check = null;
        let declaredCheckReference = false;
        if (typeof job.check_run_url === "string") {
          const idMatch = job.check_run_url.match(/\/check-runs\/(\d+)\b/);
          if (idMatch) {
            declaredCheckReference = true;
            check = checksById.get(Number(idMatch[1])) ?? null;
          } else {
            return {
              ok: false,
              reason: `malformed check-run URL for job ${job.name} run ${run.id} attempt ${run.run_attempt}`,
              facts: null
            };
          }
        }
        if (!check && job.check_run_id != null) {
          declaredCheckReference = true;
          check = checksById.get(Number(job.check_run_id)) ?? null;
        }
        if (!check && declaredCheckReference) {
          return {
            ok: false,
            reason: `missing live check-run mapping: declared check-run unavailable for job ${job.name} run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        if (!check) {
          const named = checksByName.get(job.name) ?? [];
          // Only allow name match when it is unique AND explicitly tagged to this run/attempt.
          const bound = named.filter((entry) => {
            const entryRunId = entry.run_id ?? entry.details?.run_id ?? entry.external_id_run_id;
            const entryAttempt = entry.run_attempt ?? entry.details?.run_attempt;
            if (entryRunId != null && entryAttempt != null) {
              return Number(entryRunId) === run.id && Number(entryAttempt) === run.run_attempt;
            }
            // GitHub check-runs often omit run_id; require job-level terminal authority and
            // unique name only when a single check exists for the head (no multi-attempt collision).
            return false;
          });
          if (bound.length === 1) {
            check = bound[0];
          } else if (bound.length > 1) {
            return {
              ok: false,
              reason: `ambiguous check-run mapping for job ${job.name} run ${run.id} attempt ${run.run_attempt}`,
              facts: null
            };
          } else if (named.length > 1) {
            return {
              ok: false,
              reason: `ambiguous multi-check name mapping for job ${job.name} on ${head}`,
              facts: null
            };
          }
        }
        // App identity must come from authenticated check mapping; do not synthesize constants.
        if (!check || typeof check !== "object") {
          return {
            ok: false,
            reason: `missing live check-run mapping for job ${job.name} run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        if (!Number.isSafeInteger(check.id)) {
          return {
            ok: false,
            reason: `missing live check-run id for job ${job.name} run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        if (check.name !== job.name) {
          return {
            ok: false,
            reason: `check-run name must exactly match job ${job.name} run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        if (consumedCheckRunIds.has(check.id)) {
          return {
            ok: false,
            reason: `check-run ${check.id} already consumed by another job/run lane on ${head}`,
            facts: null
          };
        }
        consumedCheckRunIds.add(check.id);
        const checkRunId = check.run_id ?? check.details?.run_id ?? check.external_id_run_id;
        const checkAttempt = check.run_attempt ?? check.details?.run_attempt;
        if (checkRunId != null && Number(checkRunId) !== run.id) {
          return {
            ok: false,
            reason: `check-run ${check.id ?? job.name} mapped to wrong run ${checkRunId}; expected ${run.id}`,
            facts: null
          };
        }
        if (checkAttempt != null && Number(checkAttempt) !== run.run_attempt) {
          return {
            ok: false,
            reason: `check-run ${check.id ?? job.name} mapped to wrong attempt ${checkAttempt}; expected ${run.run_attempt}`,
            facts: null
          };
        }
        const appSlug = check.app?.slug;
        const appId = check.app?.id;
        if (typeof appSlug !== "string" || appSlug.length === 0 || appId == null) {
          return {
            ok: false,
            reason: `missing live check app provenance for job ${job.name} on ${head}`,
            facts: null
          };
        }
        const status = job.status;
        const conclusion = job.conclusion;
        const checkStatus = check.status;
        const checkConclusion = check.conclusion;
        if (typeof status !== "string" || !status || typeof conclusion !== "string" || !conclusion) {
          return {
            ok: false,
            reason: `missing live job terminal fields for ${job.name} run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        if (
          typeof checkStatus !== "string" ||
          !checkStatus ||
          typeof checkConclusion !== "string" ||
          !checkConclusion
        ) {
          return {
            ok: false,
            reason: `missing live check-run terminal fields for ${job.name} run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        if (status !== checkStatus || conclusion !== checkConclusion) {
          return {
            ok: false,
            reason: `job/check-run terminal mismatch for ${job.name} run ${run.id} attempt ${run.run_attempt}`,
            facts: null
          };
        }
        const common = {
          name: job.name,
          head_sha: head,
          run_id: run.id,
          run_attempt: run.run_attempt,
          status,
          conclusion: conclusion ?? null,
          app_slug: appSlug,
          app_id: appId,
          event: run.event,
          base: repo.default_branch,
          workflow_path: run.path,
          ticket_id: ticketId
        };
        workflowRuns.push({ ...common });
        checkRuns.push({
          ...common,
          external_id: Object.hasOwn(check, "external_id") ? check.external_id : null,
          check_run_id: check.id ?? null
        });
      }
    }

    // Protected exact-head technical checks (review + authorization): custom Checks-API
    // rows minted by a maintainer-dispatched workflow_dispatch run against trusted_ref,
    // attached directly to this exact candidate head — never inferred from a job/run
    // triggered by this PR's own pull_request event. GitHub does not link a standalone
    // check to the run that created it, so provenance (event/workflow path/dispatch actor/
    // workflow blob) is only authoritative from the run identified by the check's own
    // external_id; a check without a well-formed external_id yields no provenance and is
    // rejected downstream. Only attempted once D0-004C's workflow exists on live dev.
    if (d0_004c_merged_early) {
      for (const gate of [expected.review, expected.authorization]) {
        const matches = checksByName.get(gate.protected_check) ?? [];
        if (matches.length === 0) continue;
        if (matches.length > 1) {
          return {
            ok: false,
            reason: `ambiguous ${gate.protected_check} check-run set for ${head}`,
            facts: null
          };
        }
        const check = matches[0];
        if (!Number.isSafeInteger(check.id)) {
          return {
            ok: false,
            reason: `missing live check-run id for ${gate.protected_check} on ${head}`,
            facts: null
          };
        }
        const appSlug = typeof check.app?.slug === "string" ? check.app.slug : null;
        const appId = check.app?.id ?? null;
        const externalId = typeof check.external_id === "string" ? check.external_id : null;
        const rest =
          externalId && externalId.startsWith(gate.external_id_prefix)
            ? externalId.slice(gate.external_id_prefix.length)
            : null;
        const runMatch = rest ? /^(\d+):(\d+)$/.exec(rest) : null;
        const runId = runMatch ? Number(runMatch[1]) : null;
        const runAttempt = runMatch ? Number(runMatch[2]) : null;

        let event = null;
        let workflowPath = null;
        let dispatchActor = null;
        let workflowSha = null;
        let workflowReachableFromDev = false;
        let workflowBlobOid = null;

        if (runId != null) {
          const runResult = transportCall(transport, "getJson", `${repoPath}/actions/runs/${runId}`);
          if (!runResult.ok) {
            return {
              ok: false,
              reason: runResult.reason || `${gate.protected_check} run ${runId} unavailable`,
              facts: null
            };
          }
          const run = runResult.value;
          if (!run || typeof run !== "object") {
            return { ok: false, reason: `${gate.protected_check} run ${runId} unavailable`, facts: null };
          }
          if (run.run_attempt != null && Number(run.run_attempt) !== runAttempt) {
            return {
              ok: false,
              reason: `${gate.protected_check} run ${runId} attempt mismatch`,
              facts: null
            };
          }
          event = typeof run.event === "string" ? run.event : null;
          workflowPath = typeof run.path === "string" ? run.path : null;
          dispatchActor = run.triggering_actor?.login ?? run.actor?.login ?? null;
          workflowSha = typeof run.head_sha === "string" ? run.head_sha : null;
          // Ancestry, not the run's self-reported head_branch label: an orphan or detached
          // historical commit can carry any head_branch string, including "dev".
          const ancestry = verifyWorkflowShaReachableFromDev(transport, repoPath, liveTip, workflowSha);
          if (!ancestry.ok) {
            return {
              ok: false,
              reason: ancestry.reason || `${gate.protected_check} workflow ancestry unavailable`,
              facts: null
            };
          }
          workflowReachableFromDev = ancestry.reachable;
          if (dispatchActor) {
            actors.add(dispatchActor);
            ensurePermission(dispatchActor);
          }
          if (workflowSha && workflowPath) {
            const blobResult = transportCall(
              transport,
              "getJson",
              `${repoPath}/contents/${workflowPath}?ref=${workflowSha}`
            );
            workflowBlobOid =
              blobResult.ok && typeof blobResult.value?.sha === "string" ? blobResult.value.sha : null;
          }
        }

        checkRuns.push({
          name: check.name,
          // Trust-but-verify: never assume the check's own head_sha equals this query's
          // scope; evaluateReview/evaluateAuthorization re-filter on exact head_sha match.
          head_sha: typeof check.head_sha === "string" ? check.head_sha : head,
          status: typeof check.status === "string" ? check.status : null,
          conclusion: typeof check.conclusion === "string" ? check.conclusion : null,
          app_slug: appSlug,
          app_id: appId,
          event,
          workflow_path: workflowPath,
          workflow_sha: workflowSha,
          workflow_reachable_from_dev: workflowReachableFromDev,
          workflow_blob_oid: workflowBlobOid,
          external_id: externalId,
          dispatch_actor: dispatchActor,
          run_id: runId,
          run_attempt: runAttempt,
          ticket_id: ticketId
        });
      }
    }

    // Formal reviews: paginate all pages; only APPROVED reviews with commit_id == head count.
    const pullReviews = collectAllJsonPages(
      transport,
      `${repoPath}/pulls/${pull.number}/reviews`,
      failures,
      { perPage: 30, maxPages: 40, label: `reviews for PR #${pull.number}` }
    );
    if (!Array.isArray(pullReviews)) {
      return { ok: false, reason: failures.join("; ") || `reviews unavailable for PR #${pull.number}`, facts: null };
    }
    for (const review of pullReviews) {
      if (review.state !== "APPROVED") continue;
      if (review.commit_id !== head) continue;
      const reviewer = review.user?.login;
      if (!reviewer) continue;
      actors.add(reviewer);
      ensurePermission(reviewer);
      reviews.push({
        ticket_id: ticketId,
        reviewer,
        commit_id: review.commit_id,
        decision: "approved",
        permission: permissions[reviewer] ?? null,
        bootstrap_evidence: true,
        protected_check: null,
        workflow_sha: liveTip,
        workflow_reachable_from_dev: true
      });
    }
  }

  for (const actor of actors) ensurePermission(actor);
  if (failures.length) {
    return { ok: false, reason: failures.join("; "), facts: null };
  }

  // Workflow blobs at live tip and candidate heads.
  const workflowPaths = [".github/workflows/ci.yml", ".github/workflows/operational-state.yml"];
  const workflowBlobs = {};
  const blobOidFor = (path, ref, { required }) => {
    const result = transportCall(transport, "getJson", `${repoPath}/contents/${path}?ref=${ref}`);
    if (!result.ok) {
      if (!isAuthenticatedNotFound(result)) failures.push(result.reason);
      return null;
    }
    if (!result.value || typeof result.value.sha !== "string") {
      if (required) failures.push(`workflow blob unavailable for ${path}@${ref}`);
      return null;
    }
    return result.value.sha;
  };
  for (const path of workflowPaths) {
    const requiredOnDev = path.endsWith("ci.yml");
    const devBlob = blobOidFor(path, liveTip, { required: requiredOnDev });
    if (!devBlob) {
      // operational-state.yml may be absent before D0-004C; only ci.yml is mandatory pre-C.
      if (requiredOnDev) {
        return { ok: false, reason: failures.join("; ") || `workflow blob unavailable for ${path}`, facts: null };
      }
      continue;
    }
    workflowBlobs[path] = { dev: devBlob, heads: {} };
    for (const pr of prs) {
      if (!pr.head_sha) continue;
      const headBlob = blobOidFor(path, pr.head_sha, { required: false });
      if (headBlob) workflowBlobs[path].heads[pr.head_sha] = headBlob;
    }
  }
  if (failures.length) {
    return { ok: false, reason: failures.join("; "), facts: null };
  }

  // Implementation verification receipts: merged PRs with exact Ticket field + post-merge CI.
  const verifiedTickets = [];
  const implementationMerges = [];
  const ancestryFacts = {};
  const mergedSearchItems = collectSearchItems(
    transport,
    `search/issues?q=${encodeURIComponent(`repo:${expected.repository} is:pr is:merged base:${repo.default_branch} "Ticket:"`)}`,
    failures,
    "merged Ticket PR search"
  );
  if (!mergedSearchItems) {
    return { ok: false, reason: failures.join("; ") || "merged PR search unavailable", facts: null };
  }
  const mergedCandidates = [];
  for (const item of mergedSearchItems) {
    // Three distinct cases, and conflating any two of them is a fail-closed violation:
    //
    //   no `Ticket:` line at all  -> unlinked. The merged-receipt search is GitHub
    //                                full-text, so it returns bodies that merely mention
    //                                the substring in prose. Skip; this is the common case.
    //   a `Ticket:` line that does not parse as exactly one `Ticket: <ID>`
    //                             -> MALFORMED. `Ticket:`, `Ticket:   ` and
    //                                `Ticket: D0-001 extra` all declare linkage and all
    //                                fail to state it. Silently skipping them would let a
    //                                real receipt vanish behind a typo, so they fail the
    //                                whole collection closed.
    //   two or more valid lines   -> duplicated linkage. Also fails closed.
    //
    // The search payload carries the full body, so unlinked hits are filtered here before
    // a per-PR request is spent on them; without that the total collection budget is
    // exhausted. A missing or non-string search body is absence of evidence rather than
    // evidence of absence, so it falls through to the authoritative per-PR fetch.
    if (typeof item.body === "string" && !declaresTicketLinkage(item.body)) continue;
    mergedCandidates.push(item);
  }
  const mergedPulls = requireJsonMany(
    transport,
    mergedCandidates.map((item) => `${repoPath}/pulls/${item.number}`),
    failures
  );
  const linkedMerged = [];
  for (let i = 0; i < mergedCandidates.length; i += 1) {
    const item = mergedCandidates[i];
    const pull = mergedPulls[i];
    if (!pull?.merged || !pull.merge_commit_sha) continue;
    const body = typeof pull.body === "string" ? pull.body : "";
    if (!declaresTicketLinkage(body)) continue;
    const ticketLines = [...body.matchAll(TICKET_FIELD_RE)];
    if (ticketLines.length !== 1) {
      return {
        ok: false,
        reason: ticketLines.length === 0
          ? `malformed Ticket field on merged PR #${pull.number}`
          : `duplicated Ticket field on merged PR #${pull.number}`,
        facts: null
      };
    }
    const ticketId = ticketLines[0][1];
    if (!tickets[ticketId]) continue;
    linkedMerged.push({ item, pull, ticketId });
  }
  const ancestries = resolveAncestryMany(
    transport,
    repoPath,
    liveTip,
    linkedMerged.map((entry) => entry.pull.merge_commit_sha),
    failures
  );
  for (let i = 0; i < linkedMerged.length; i += 1) {
    const { pull } = linkedMerged[i];
    const ancestry = ancestries[i];
    if (!ancestry?.ok) {
      return {
        ok: false,
        reason: ancestry?.reason || `implementation merge ancestry unavailable for #${pull.number}`,
        facts: null
      };
    }
    recordAncestryCompare(ancestryFacts, liveTip, pull.merge_commit_sha, ancestry.status);
    linkedMerged[i].ancestry = ancestry;
  }
  const mergedRunPayloads = requireJsonMany(
    transport,
    linkedMerged.map(
      (entry) => `${repoPath}/actions/runs?head_sha=${entry.pull.merge_commit_sha}&event=push&per_page=20`
    ),
    failures
  );
  const completionIndexes = [];
  for (let i = 0; i < linkedMerged.length; i += 1) {
    const { pull, ticketId } = linkedMerged[i];
    const isCompletionReceipt =
      classifyCompletionMerge(pull.body ?? "", ticketId).isCompletion ||
      isLegacyCompletionBinding(ticketId, { number: pull.number, merge_commit_sha: pull.merge_commit_sha });
    linkedMerged[i].isCompletionReceipt = isCompletionReceipt;
    if (isCompletionReceipt) completionIndexes.push(i);
  }
  const completionCommits = requireJsonMany(
    transport,
    completionIndexes.map(
      (index) => `${repoPath}/commits/${linkedMerged[index].pull.merge_commit_sha}`
    ),
    failures
  );
  const commitsByLinkedIndex = new Map();
  for (let j = 0; j < completionIndexes.length; j += 1) {
    commitsByLinkedIndex.set(completionIndexes[j], completionCommits[j]);
  }
  for (let i = 0; i < linkedMerged.length; i += 1) {
    const { item, pull, ticketId, ancestry, isCompletionReceipt } = linkedMerged[i];
    const runs = mergedRunPayloads[i];
    if (
      !runs ||
      rejectPartialCountPayload(
        runs,
        "workflow_runs",
        20,
        failures,
        `implementation post-merge runs for #${item.number}`
      )
    ) {
      return { ok: false, reason: failures.join("; ") || `implementation post-merge runs unavailable for #${item.number}`, facts: null };
    }
    const ciRuns = runs.workflow_runs.filter((run) => run.name === "CI" || run.path === ".github/workflows/ci.yml");
    const latest = selectLatestWorkflowRun(
      ciRuns.map((run) => ({
        head_sha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        run_id: run.id,
        run_attempt: run.run_attempt
      }))
    );
    // Always record the implementation merge receipt so failed/nonterminal post-merge
    // CI is classified by the resolver (POST_MERGE_CI_FAILED / MISSING), not discarded.
    // `body` carries the raw PR body so the resolver can apply the Ticket-Completion:
    // exact-single-structured-field grammar (classifyCompletionMerge) universally, at
    // every receipt count, when resolving whole-ticket completion for this ticket.
    // A completion merge that has since been reverted is still an ancestor of the target
    // branch, so ancestry alone credits a ticket whose deliverable is no longer in the
    // tree. Record what the completion introduced so the resolver can require it to still
    // be there. Only completion-marked merges pay for the extra request.
    let addedPaths = null;
    let changedPaths = null;
    let removedPaths = null;
    if (isCompletionReceipt) {
      const commit = commitsByLinkedIndex.get(i);
      if (!commit || !Array.isArray(commit.files)) {
        return {
          ok: false,
          reason: failures.join("; ") || `completion merge ${pull.merge_commit_sha} file list unavailable`,
          facts: null
        };
      }
      addedPaths = commit.files
        .filter((file) => file?.status === "added" && typeof file.filename === "string")
        .map((file) => file.filename)
        .sort();
      const effect = filesToEffect(commit.files);
      changedPaths = effect?.changed ?? null;
      removedPaths = effect?.removed ?? null;
    }
    implementationMerges.push({
      ticket_id: ticketId,
      merge_commit_sha: pull.merge_commit_sha,
      number: pull.number,
      body: pull.body ?? null,
      reachable: ancestry.reachable,
      added_paths: addedPaths,
      changed_paths: changedPaths,
      removed_paths: removedPaths
    });
    if (!latest.ok) {
      // Missing/ambiguous run attempt → no postMergeCI row; resolver emits MISSING.
      continue;
    }
    postMergeCI.push({
      merge_commit_sha: pull.merge_commit_sha,
      head_sha: latest.run.head_sha,
      status: latest.run.status,
      conclusion: latest.run.conclusion,
      run_id: latest.run.run_id,
      run_attempt: latest.run.run_attempt
    });
    if (latest.run.status === "completed" && latest.run.conclusion === "success") {
      if (!verifiedTickets.includes(ticketId)) verifiedTickets.push(ticketId);
    }
  }
  if (failures.length) {
    return { ok: false, reason: failures.join("; "), facts: null };
  }

  // A small number of implementation merges predate the `Ticket:` PR-body convention;
  // apply their independently re-verified historical linkage on top of the search above.
  if (
    !applyHistoricalImplementationLinkage(
      transport,
      repoPath,
      tickets,
      failures,
      { implementationMerges, postMergeCI, verifiedTickets, ancestryFacts },
      liveTip
    )
  ) {
    return { ok: false, reason: failures.join("; ") || "historical implementation linkage unavailable", facts: null };
  }

  const isCollectedCompletionReceipt = (entry) =>
    classifyCompletionMerge(entry.body ?? "", entry.ticket_id).isCompletion ||
    isLegacyCompletionBinding(entry.ticket_id, entry);
  const hasExactShaSuccess = (mergeCommitSha) =>
    postMergeCI.some(
      (row) =>
        sameSha(row.merge_commit_sha, mergeCommitSha) &&
        sameSha(row.head_sha, mergeCommitSha) &&
        row.status === "completed" &&
        row.conclusion === "success"
    );
  const completionNeedsDescendantCi = implementationMerges.some(
    (entry) => isCollectedCompletionReceipt(entry) && entry.reachable === true && !hasExactShaSuccess(entry.merge_commit_sha)
  );
  if (completionNeedsDescendantCi) {
    const tipRuns = requireJson(
      transport,
      `${repoPath}/actions/runs?head_sha=${liveTip}&event=push&per_page=20`,
      failures
    );
    if (
      !tipRuns ||
      rejectPartialCountPayload(tipRuns, "workflow_runs", 20, failures, `post-merge runs for live tip ${liveTip}`)
    ) {
      return { ok: false, reason: failures.join("; ") || `post-merge runs unavailable for live tip ${liveTip}`, facts: null };
    }
    const tipCiRuns = tipRuns.workflow_runs.filter(
      (run) => run.name === "CI" || run.path === ".github/workflows/ci.yml"
    );
    const tipLatest = selectLatestWorkflowRun(
      tipCiRuns.map((run) => ({
        head_sha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        run_id: run.id,
        run_attempt: run.run_attempt
      }))
    );
    if (tipLatest.ok) {
      const alreadyRecorded = postMergeCI.some(
        (row) => row.run_id === tipLatest.run.run_id && row.run_attempt === tipLatest.run.run_attempt
      );
      if (!alreadyRecorded) {
        postMergeCI.push({
          merge_commit_sha: liveTip,
          head_sha: tipLatest.run.head_sha,
          status: tipLatest.run.status,
          conclusion: tipLatest.run.conclusion,
          run_id: tipLatest.run.run_id,
          run_attempt: tipLatest.run.run_attempt
        });
      }
      if (tipLatest.run.status === "completed" && tipLatest.run.conclusion === "success") {
        for (const entry of implementationMerges) {
          if (!isCollectedCompletionReceipt(entry) || entry.reachable !== true) continue;
          if (!verifiedTickets.includes(entry.ticket_id)) verifiedTickets.push(entry.ticket_id);
        }
      }
    }
  }

  // Detect D0-004C merge only when the operational-state workflow exists on live tip.
  const d0_004c_merged = Object.hasOwn(workflowBlobs, ".github/workflows/operational-state.yml");

  // Active ownership lanes: open linked candidates with catalog-derived owned paths/symbols.
  const activeOwnership = [];
  for (const pr of prs) {
    const ticketId = parseTicketIdFromBody(pr.body);
    if (!ticketId || !tickets[ticketId] || tickets[ticketId].kind !== "executable") continue;
    if (pr.merged === true || pr.state === "closed") continue;
    if (!pr.head_sha) {
      return { ok: false, reason: `active PR #${pr.number} missing head_sha for ownership`, facts: null };
    }
    activeOwnership.push({
      ticket_id: ticketId,
      pr_number: pr.number,
      head_sha: pr.head_sha,
      owned_paths: [...tickets[ticketId].owned_paths],
      owned_symbols: [...tickets[ticketId].owned_symbols]
    });
  }
  activeOwnership.sort((left, right) => left.pr_number - right.pr_number);

  const facts = {
    schema_version: 1,
    repository: expected.repository,
    defaultBranch: repo.default_branch,
    owner: { login: repo.owner.login, type: repo.owner.type },
    currentHead: liveTip,
    liveBaseSha: liveTip,
    d0_004c_merged,
    externalAvailable: true,
    operationalAuthority: issuesCatalog.operational_authority,
    tickets,
    gateBatches,
    gatePRs,
    postMergeCI,
    verifiedTickets,
    implementationMerges,
    liveTreePaths,
    issues: [],
    prs,
    reviews,
    authorizations,
    checkRuns,
    workflowRuns,
    permissions,
    workflowBlobs,
    liveDigests,
    activeOwnership,
    projectionSurfaces: {},
    ancestry: ancestryFacts,
    exactBasePackets: [],
    registryStrings: {},
    collector: {
      transport: transport.kind,
      live_tip: liveTip,
      write_actions: 0,
      per_call_timeout_ms: transport.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
      total_timeout_ms: transport.totalTimeoutMs ?? DEFAULT_TOTAL_COLLECTION_TIMEOUT_MS,
      concurrency: transport.concurrency ?? DEFAULT_COLLECTION_CONCURRENCY
    }
  };

  try {
    const candidatePr = Array.isArray(activeOwnership) ? activeOwnership[0]?.pr_number : null;
    const activationCollected = collectAuthenticatedReviewActivationFacts(root, {
      transport,
      repository: expected.repository,
      prNumber: Number.isInteger(candidatePr) ? candidatePr : undefined
    });
    facts.authenticated_review_activation_facts = plainObject(activationCollected.facts)
      ? activationCollected.facts
      : { github_outage: true };
    if (transport.kind === "github-authenticated" && plainObject(activationCollected.facts)) {
      facts[LIVE_ACTIVATION_FACTS] = structuredClone(activationCollected.facts);
    }
  } catch {
    facts.authenticated_review_activation_facts = { github_outage: true };
  }

  const corpus = validateFactsCorpus(facts);
  if (!corpus.ok) {
    return { ok: false, reason: `collected corpus invalid: ${corpus.failures.join("; ")}`, facts: null };
  }

  return { ok: true, facts, failures: [] };
};

/**
 * Online-strict fact acquisition. Prefer injected complete facts for pure unit tests;
 * otherwise run the bounded authenticated live collector (real GitHub transport or an
 * explicit fixture transport). Environment fact files are not an authorization path.
 */
export const acquireOnlineStrictFacts = (root = DEFAULT_ROOT, options = {}) => {
  if (options.facts != null) {
    const corpus = validateFactsCorpus(options.facts);
    if (!corpus.ok) return { ok: false, reason: corpus.failures.join("; "), facts: null };
    if (options.facts.externalAvailable !== true) {
      return { ok: false, reason: "injected facts mark externalAvailable=false", facts: null };
    }
    return { ok: true, facts: options.facts };
  }

  return collectLiveExecutionFacts(root, {
    transport: options.transport,
    perCallTimeoutMs: options.perCallTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs
  });
};

export const resolveExecutionState = (options = {}) => {
  const mode = options.mode === "online-strict" ? "online-strict" : "offline";
  const root = options.root ? resolve(options.root) : DEFAULT_ROOT;
  const now = typeof options.now === "string" ? options.now : new Date().toISOString();
  const schemaLoad = loadExecutionStateSchema(root);

  let facts = options.facts ?? null;
  if (!facts && mode === "offline") {
    const fixturePath = options.fixturePath
      ? resolve(options.fixturePath)
      : resolve(root, "fixtures/operational-state/current-baseline/facts.json");
    facts = loadJsonIfExists(fixturePath);
  }

  const runtimeIdentity = options.runtimeIdentity ?? (
    mode === "online-strict"
      ? (() => {
          const derived = deriveRuntimeIdentity(root);
          return {
            repository: derived.repository,
            // Resolve against the policy target branch identity, not a local feature branch name.
            branch: expectedActorPolicyFromTicket().target_branch,
            // A local feature SHA is never evidence of the live target head.
            head: facts?.currentHead ?? null
          };
        })()
      : {
          repository: facts?.repository ?? null,
          branch: facts?.defaultBranch ?? null,
          head: facts?.currentHead ?? null
        }
  );

  if (!facts) {
    const errors = [blocker("EXTERNAL_STATE_UNAVAILABLE", "required fact corpus unavailable")];
    if (!schemaLoad.ok) {
      // Still emit a schema-shaped failure object; output validation may also fail.
    }
    const state = emptyFailureState(mode, now, runtimeIdentity, errors);
    return state;
  }

  const corpus = validateFactsCorpus(facts);
  if (!corpus.ok) {
    return emptyFailureState(mode, now, runtimeIdentity, [
      blocker("TICKET_CONTRACT_INCOMPLETE", `malformed facts corpus: ${corpus.failures.join("; ")}`)
    ]);
  }

  // Projection surfaces are intentionally never read for readiness.
  void facts.projectionSurfaces;
  void facts.issues;
  void facts.registryStrings;

  const policy = facts.operationalAuthority;
  const policyConflict = !actorPolicyAgrees(policy);
  const expectedRepo = policy?.repository ?? expectedActorPolicyFromTicket().repository;
  const expectedBranch = policy?.target_branch ?? expectedActorPolicyFromTicket().target_branch;
  const wrongTarget =
    runtimeIdentity.repository !== expectedRepo ||
    runtimeIdentity.branch !== expectedBranch ||
    (facts.repository && facts.repository !== expectedRepo) ||
    (facts.defaultBranch && facts.defaultBranch !== expectedBranch) ||
    (facts.owner && policy?.repository_owner && (
      facts.owner.login !== policy.repository_owner.login ||
      facts.owner.type !== policy.repository_owner.type
    ));

  const externalUnavailable = facts.externalAvailable !== true;

  const context = { wrongTarget, policyConflict, externalUnavailable };
  const ticketIds = Object.keys(facts.tickets ?? {}).sort();
  const tickets = {};
  for (const ticketId of ticketIds) {
    tickets[ticketId] = resolveOneTicket(
      facts,
      ticketId,
      facts.tickets[ticketId],
      policy ?? expectedActorPolicyFromTicket(),
      context
    );
  }

  let readySet = Object.entries(tickets)
    .filter(([, state]) => state.readiness === "ready")
    .map(([id]) => id)
    .sort();

  // Ready set empty when any unknown readiness or external unavailable.
  if (externalUnavailable || Object.values(tickets).some((state) => state.readiness === "unknown")) {
    readySet = [];
  }

  const errors = [];
  if (wrongTarget) errors.push(blocker("WRONG_TARGET", "runtime repository/branch mismatch"));
  if (policyConflict) errors.push(blocker("TICKET_CONTRACT_CONFLICT", "actor policy conflict"));
  if (externalUnavailable) errors.push(blocker("EXTERNAL_STATE_UNAVAILABLE", "external facts unavailable"));
  // Promote ticket-level external ambiguity into top-level errors so strict CLI and
  // audit surfaces cannot ignore them when readySet is empty for other reasons.
  for (const [ticketId, state] of Object.entries(tickets)) {
    for (const entry of state.blockers ?? []) {
      if (
        entry.code === "TICKET_CONTRACT_CONFLICT" ||
        entry.code === "EXTERNAL_STATE_UNAVAILABLE" ||
        entry.code === "TICKET_CONTRACT_INCOMPLETE"
      ) {
        errors.push(blocker(entry.code, `${ticketId}: ${entry.reason}`));
      }
    }
  }

  const bootstrapActive = facts.d0_004c_merged !== true;

  const result = {
    schema_version: 1,
    mode,
    repository: expectedRepo,
    target_branch: expectedBranch,
    current_head: runtimeIdentity.head ?? null,
    resolved_at: now,
    // CTO/CEO review and the owner merge decision are out-of-band process gates, never
    // resolver inputs (a public PR comment is an audit receipt, not machine authorization).
    // This stays false even when technical readiness is green, and until D0-004C merges
    // governance_mode is explicitly the bootstrap mode, never a post-C mode by default.
    governance_mode: bootstrapActive ? "single_owner_bootstrap" : (policy?.governance_mode ?? "single_owner_agent_team"),
    claims_merge_authorization: false,
    claims_separation_of_duties: false,
    artifact_freeze: evaluateLiveArtifactFreeze(facts, root),
    bootstrap: {
      active: bootstrapActive,
      d0_004c_merged: facts.d0_004c_merged === true
    },
    tickets,
    readySet,
    errors: uniqueBlockers(errors)
  };

  if (!schemaLoad.ok) {
    result.errors.push(blocker("TICKET_CONTRACT_INCOMPLETE", schemaLoad.errors.join("; ")));
  } else {
    const schemaErrors = validateAgainstSchema(result, schemaLoad.schema);
    if (schemaErrors.length) {
      result.errors.push(
        blocker("TICKET_CONTRACT_INCOMPLETE", `output schema validation failed: ${schemaErrors[0]}`)
      );
    }
  }

  return result;
};

export const runOfflineCheck = (options = {}) => {
  const root = options.root ? resolve(options.root) : DEFAULT_ROOT;
  const fixturePath = resolve(root, "fixtures/operational-state/current-baseline/facts.json");
  const failures = [];
  if (!existsSync(fixturePath) && !options.facts) {
    failures.push("missing current-baseline fixture");
  }
  if (options.facts != null) {
    const corpus = validateFactsCorpus(options.facts);
    if (!corpus.ok) failures.push(...corpus.failures);
  }
  const result = resolveExecutionState({
    mode: "offline",
    root,
    fixturePath,
    facts: options.facts,
    runtimeIdentity: options.runtimeIdentity
  });
  if (result.errors.some((entry) => entry.code === "WRONG_TARGET")) {
    failures.push("wrong target");
  }
  if (result.errors.some((entry) => entry.code === "TICKET_CONTRACT_CONFLICT")) {
    failures.push("ticket contract conflict");
  }
  if (result.errors.some((entry) => entry.code === "TICKET_CONTRACT_INCOMPLETE")) {
    failures.push("facts/schema contract incomplete");
  }
  if (result.errors.some((entry) => entry.code === "EXTERNAL_STATE_UNAVAILABLE")) {
    failures.push("external state unavailable");
  }
  const schemaLoad = loadExecutionStateSchema(root);
  if (!schemaLoad.ok) {
    failures.push(...schemaLoad.errors);
  } else {
    const schemaErrors = validateAgainstSchema(result, schemaLoad.schema);
    if (schemaErrors.length) failures.push(`output schema: ${schemaErrors[0]}`);
  }
  // Offline check does not claim online readiness.
  return {
    ok: failures.length === 0,
    result,
    failures,
    claimsOnlineReadiness: false
  };
};

const parseArgs = (argv) => {
  const options = {
    strict: false,
    json: false,
    offline: false,
    ticket: null,
    check: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--ticket") {
      options.ticket = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--check") options.check = true;
  }
  return options;
};

export const formatExecutionState = (result, options = {}) => {
  const asked = Object.keys(result.tickets ?? {}).length > 0;
  const couldNotAsk =
    !asked &&
    (result.errors ?? []).some((entry) => entry.code === "EXTERNAL_STATE_UNAVAILABLE");
  const readySetDisplay = couldNotAsk ? "unavailable" : (result.readySet.join(",") || "none");
  const lines = [
    `EXECUTION_STATE mode=${result.mode} repository=${result.repository} branch=${result.target_branch} head=${result.current_head ?? "unknown"}`,
    `readySet=${readySetDisplay}`
  ];
  for (const [id, state] of Object.entries(result.tickets ?? {})) {
    if (options.ticket && id !== options.ticket) continue;
    const codes = (state.blockers ?? []).map((entry) => entry.code).join(",") || "none";
    lines.push(`${id} phase=${state.phase} readiness=${state.readiness} blockers=${codes}`);
  }
  if (result.errors?.length) {
    lines.push(
      `errors=${result.errors.map((entry) =>
        entry.reason ? `${entry.code}: ${entry.reason}` : entry.code
      ).join("; ")}`
    );
  }
  return lines.join("\n");
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const isCheck = process.argv[1]?.includes("resolve-execution-state") && (
    process.env.npm_lifecycle_event === "ops:check" || args.check || args.offline
  );

  // Detect npm script name when available.
  const script = process.env.npm_lifecycle_event;
  if (script === "ops:check" || (args.offline && !args.strict)) {
    const check = runOfflineCheck();
    if (args.json) {
      console.log(JSON.stringify({
        ok: check.ok,
        claimsOnlineReadiness: false,
        failures: check.failures,
        readySet: check.result.readySet,
        mode: "offline"
      }, null, 2));
    } else {
      const status = check.ok ? "OPS_CHECK_PASS" : "OPS_CHECK_FAIL";
      console.log(`${status} mode=offline claims_online_readiness=false readySet=${check.result.readySet.join(",") || "none"}`);
      for (const failure of check.failures) console.error(`- ${failure}`);
    }
    process.exit(check.ok ? 0 : 1);
  }

  const mode = args.strict ? "online-strict" : "offline";
  let result;
  if (mode === "online-strict") {
    const acquired = acquireOnlineStrictFacts(DEFAULT_ROOT);
    if (!acquired.ok) {
      const identity = deriveRuntimeIdentity(DEFAULT_ROOT);
      result = emptyFailureState(
        "online-strict",
        new Date().toISOString(),
        {
          repository: identity.repository ?? expectedActorPolicyFromTicket().repository,
          // Online-strict resolves the live target branch, not the local feature branch name.
          branch: expectedActorPolicyFromTicket().target_branch,
          // Acquisition failed, so no authenticated live-dev SHA is available.
          head: null
        },
        [blocker("EXTERNAL_STATE_UNAVAILABLE", acquired.reason ?? "external facts unavailable")]
      );
    } else {
      result = resolveExecutionState({
        mode: "online-strict",
        facts: acquired.facts,
        ticket: args.ticket,
        runtimeIdentity: {
          repository: acquired.facts.repository,
          branch: acquired.facts.defaultBranch,
          head: acquired.facts.currentHead
        }
      });
    }
  } else {
    result = resolveExecutionState({
      mode: "offline",
      ticket: args.ticket
    });
  }

  if (args.ticket) {
    const state = result.tickets[args.ticket];
    if (!state) {
      console.error(`unknown ticket ${args.ticket}`);
      process.exit(1);
    }
  }

  if (args.json) {
    const payload = args.ticket
      ? { ...result, tickets: { [args.ticket]: result.tickets[args.ticket] } }
      : result;
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(formatExecutionState(result, { ticket: args.ticket }));
  }

  const failed = args.strict
    ? onlineStrictProcessShouldFail(result)
    : result.errors.some((entry) =>
        ["EXTERNAL_STATE_UNAVAILABLE", "WRONG_TARGET", "TICKET_CONTRACT_CONFLICT", "TICKET_CONTRACT_INCOMPLETE"].includes(
          entry.code
        )
      );
  process.exit(failed ? 1 : 0);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env[GH_API_POOL_ENV] === "1") {
    runGhApiPoolWorker().then(
      () => process.exit(process.exitCode ?? 0),
      (error) => {
        process.stderr.write(String(error?.stack ?? error));
        process.exit(1);
      }
    );
  } else {
    main();
  }
}

// Silence unused import warning patterns for path helpers used by CLI consumers.
void isAbsolute;
void relative;
void PHASES;
void READINESS;
