import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const BLOCKER_CODES = new Set([
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
  "WRONG_TARGET"
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
  return { ok: failures.length === 0, failures };
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
      { name: "planning-contract (20)", workflow_path: ".github/workflows/ci.yml" },
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
  // Ambiguous when more than one run shares the same latest (run_id, run_attempt).
  const ties = runs.filter((run) => compareRunAttempts(run, latest) === 0);
  if (ties.length !== 1) return { ambiguous: true };
  return { run: latest };
};

const postMergeStatus = (facts, mergeCommitSha) => {
  const runs = (facts.postMergeCI ?? []).filter((run) => run.merge_commit_sha === mergeCommitSha);
  if (!runs.length) return { missing: true };
  const selected = selectLatestRunAttempt(runs);
  if (selected.missing || selected.ambiguous || !selected.run) return { missing: true };
  const latest = selected.run;
  if (latest.head_sha !== mergeCommitSha) return { missing: true };
  if (latest.status !== "completed") return { missing: true };
  if (latest.conclusion === "success") return { ok: true };
  if (latest.conclusion === "failure" || latest.conclusion === "cancelled") return { failed: true };
  return { missing: true };
};

const ticketPathFor = (facts, ticketId) => {
  const digests = facts.liveDigests ?? {};
  return Object.keys(digests).find((path) => path.includes(`/${ticketId}-`) || path.endsWith(`/${ticketId}.md`)) ?? null;
};

const ownershipCollisions = (facts, ticketId) => {
  const active = Array.isArray(facts.activeOwnership) ? facts.activeOwnership : [];
  const self = active.find((entry) => entry.ticket_id === ticketId);
  if (!self) return [];
  const selfPaths = new Set(self.paths ?? []);
  const selfSymbols = new Set(self.symbols ?? []);
  const collisions = [];
  for (const other of active) {
    if (other.ticket_id === ticketId) continue;
    for (const path of other.paths ?? []) {
      if (selfPaths.has(path)) collisions.push({ ticket: other.ticket_id, path });
    }
    for (const symbol of other.symbols ?? []) {
      if (selfSymbols.has(symbol)) collisions.push({ ticket: other.ticket_id, symbol });
    }
  }
  // Also compare declared owned_paths against other active lanes when activeOwnership is sparse.
  const declared = facts.tickets?.[ticketId]?.owned_paths ?? [];
  for (const path of declared) {
    for (const other of active) {
      if (other.ticket_id === ticketId) continue;
      if ((other.paths ?? []).includes(path)) {
        collisions.push({ ticket: other.ticket_id, path });
      }
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
  const head = pr.head_sha;
  const reviews = (facts.reviews ?? []).filter(
    (review) => review.ticket_id === ticketId && review.commit_id === head
  );

  if (!d0c) {
    // Bootstrap: require explicit technical-review evidence; protected check alone is premature.
    const bootstrapReview = reviews.find(
      (review) =>
        review.decision === "approved" &&
        permissionEligible(facts, review.reviewer, policy.review.eligible_permissions) &&
        review.bootstrap_evidence === true
    );
    if (bootstrapReview) return { ok: true };
    return { ok: false, reason: "bootstrap technical review evidence missing" };
  }

  // After C: protected exact-head-review check required.
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
    // Formal review fact still required at same head.
    const formal = reviews.find(
      (review) =>
        review.decision === "approved" &&
        permissionEligible(facts, review.reviewer, policy.review.eligible_permissions)
    );
    if (!formal) continue;
    return { ok: true };
  }
  return { ok: false, reason: "exact-head-review invalid" };
};

const evaluateAuthorization = (facts, policy, pr, ticketId, reviewOk) => {
  if (!reviewOk) return { ok: false, reason: "authorization requires current review" };
  const d0c = facts.d0_004c_merged === true;
  const head = pr.head_sha;

  // Self-authored strings / registry fields are never authorization.
  const spoof = (facts.authorizations ?? []).filter(
    (entry) =>
      entry.ticket_id === ticketId &&
      (entry.kind === "self_authored_string" || entry.kind === "registry_string")
  );
  void spoof;

  if (!d0c) {
    const pass = (facts.authorizations ?? []).find(
      (entry) =>
        entry.ticket_id === ticketId &&
        entry.commit_id === head &&
        entry.kind === "ceo_production_pass" &&
        entry.bootstrap_evidence === true &&
        permissionEligible(facts, entry.actor, policy.authorization.eligible_permissions)
    );
    if (pass) return { ok: true };
    return { ok: false, reason: "bootstrap CEO production PASS missing" };
  }

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
    const formal = (facts.authorizations ?? []).find(
      (entry) =>
        entry.ticket_id === ticketId &&
        entry.commit_id === head &&
        entry.kind === "ceo_production_pass" &&
        permissionEligible(facts, entry.actor, policy.authorization.eligible_permissions)
    );
    if (!formal) continue;
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

  if (ticket.digests?.prd) {
    const prdPath = "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md";
    const prdGate = findAcceptedGate(facts, prdPath, ticket.digests.prd, "PRD");
    if (!prdGate) blockers.push(blocker("PRD_GATE_MISSING", `${ticketId} PRD gate not accepted`));
  } else {
    blockers.push(blocker("PRD_GATE_MISSING", `${ticketId} lacks PRD digest`));
  }

  const adrs = ticket.digests?.adrs ?? {};
  for (const [adrId, sha] of Object.entries(adrs)) {
    const adrPath =
      Object.keys(facts.liveDigests ?? {}).find((candidate) => candidate.includes(`/${adrId}-`)) ??
      `docs/adr/${adrId}-canonical-identity.md`;
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

/**
 * Implementation verification requires an explicit verified fact (fixture/online merge receipt).
 * Gate acceptance alone never verifies implementation; closed issues never verify.
 */
const isVerified = (facts, ticketId, gateEvaluation) => {
  if (!gateEvaluation.accepted) return false;
  if (!Array.isArray(facts.verifiedTickets) || !facts.verifiedTickets.includes(ticketId)) return false;
  // Implementation post-merge CI may be recorded separately; when present it must succeed.
  const impl = (facts.implementationMerges ?? []).find((entry) => entry.ticket_id === ticketId);
  if (impl) {
    const ci = postMergeStatus(facts, impl.merge_commit_sha);
    if (ci.failed || ci.missing) return false;
  }
  return true;
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

const emptyFailureState = (mode, now, runtimeIdentity, errors) => ({
  schema_version: 1,
  mode,
  repository: runtimeIdentity?.repository ?? expectedActorPolicyFromTicket().repository,
  target_branch: runtimeIdentity?.branch ?? expectedActorPolicyFromTicket().target_branch,
  current_head: runtimeIdentity?.head ?? null,
  resolved_at: now,
  bootstrap: { active: true, d0_004c_merged: false },
  tickets: {},
  readySet: [],
  errors
});

const sha256Text = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const GITHUB_ACTIONS_APP = { id: 15368, slug: "github-actions", owner: "github" };
const DEFAULT_PER_CALL_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_COLLECTION_TIMEOUT_MS = 90_000;

const timeoutError = (reason) => {
  const error = new Error(reason);
  error.code = "COLLECTION_TIMEOUT";
  return error;
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
  const deadline = Date.now() + totalTimeoutMs;
  const ghApi = (apiPath, { accept } = {}) => {
    if (Date.now() > deadline) {
      throw timeoutError(`collection total timeout exceeded before ${apiPath}`);
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
        maxBuffer: 20 * 1024 * 1024,
        timeout: callTimeout
      });
      return raw;
    } catch (error) {
      if (
        error?.code === "ETIMEDOUT" ||
        error?.killed === true ||
        /ETIMEDOUT|timed out|TIMEOUT/i.test(String(error?.message ?? ""))
      ) {
        throw timeoutError(`per-call timeout for ${apiPath}`);
      }
      throw error;
    }
  };
  return {
    kind: "github-authenticated",
    perCallTimeoutMs,
    totalTimeoutMs,
    getJson(apiPath) {
      return JSON.parse(ghApi(apiPath));
    },
    getRaw(apiPath) {
      return ghApi(apiPath, { accept: "application/vnd.github.raw" });
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
      throw timeoutError(`collection total timeout exceeded before ${apiPath}`);
    }
    return transport[method](apiPath);
  };
  return {
    kind: transport.kind,
    perCallTimeoutMs: transport.perCallTimeoutMs ?? options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
    totalTimeoutMs,
    getJson(apiPath) {
      return guard("getJson", apiPath);
    },
    getRaw(apiPath) {
      return guard("getRaw", apiPath);
    }
  };
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

const normalizeArtifactList = (list) => {
  if (!Array.isArray(list)) return null;
  return list
    .map((artifact) => ({
      path: artifact?.path ?? null,
      kind: artifact?.kind ?? null,
      sha256: artifact?.sha256 ?? null
    }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
};

/**
 * Canonicalize an accepted gate-registry batch for identical-record comparison.
 * Includes target/reviewed head and transition structure, not only artifact digests.
 */
export const canonicalizeAcceptedBatchRecord = (row) => {
  if (!plainObject(row) || typeof row.id !== "string") return null;
  const required = normalizeArtifactList(row.required_artifacts);
  const artifacts = normalizeArtifactList(
    Array.isArray(row.artifacts) ? row.artifacts : row.required_artifacts
  );
  if (!required) return null;
  const target = plainObject(row.target)
    ? {
        repository: row.target.repository ?? null,
        branch: row.target.branch ?? null,
        reviewed_head: row.target.reviewed_head ?? null
      }
    : null;
  const required_transitions = Array.isArray(row.required_transitions)
    ? [...row.required_transitions].map(String).sort()
    : null;
  const transitions = Array.isArray(row.transitions)
    ? row.transitions.map((entry) => (plainObject(entry) ? entry : entry))
    : row.transitions === undefined
      ? null
      : row.transitions;
  return {
    id: row.id,
    status: row.status ?? null,
    scope: row.scope ?? null,
    target,
    required_artifacts: required,
    artifacts,
    required_transitions,
    transitions
  };
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
      if (value === null) {
        const err = new Error(`fixture outage at ${apiPath}`);
        err.code = "FIXTURE_OUTAGE";
        throw err;
      }
      return typeof value === "string" ? value : JSON.stringify(value);
    }
  };
};

const transportCall = (transport, method, apiPath) => {
  try {
    return { ok: true, value: transport[method](apiPath) };
  } catch (error) {
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
      reason: error?.code === "FIXTURE_AMBIGUOUS"
        ? `ambiguous external response for ${apiPath}`
        : `unavailable external response for ${apiPath}`,
      error
    };
  }
};

const requireJson = (transport, apiPath, failures) => {
  const result = transportCall(transport, "getJson", apiPath);
  if (!result.ok) {
    failures.push(result.reason);
    return null;
  }
  return result.value;
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
 * Bounded authenticated live collector for the full operational fact corpus required
 * by online-strict resolution. Static catalog bytes are read from the live target tip
 * via the authenticated transport; mutable GitHub state is collected with read-only APIs.
 * Partial, outage, or ambiguous responses fail closed — no empty-corpus fallback.
 */
export const collectLiveExecutionFacts = (root = DEFAULT_ROOT, options = {}) => {
  const failures = [];
  const timeoutOptions = {
    perCallTimeoutMs: options.perCallTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs
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

  const readTipFile = (path) => {
    const api = `${repoPath}/contents/${path}?ref=${liveTip}`;
    return requireRaw(transport, api, failures);
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
  const digestFile = (path) => {
    if (liveDigests[path]) return liveDigests[path];
    const text = readTipFile(path);
    if (text == null) return null;
    const digest = sha256Text(text);
    liveDigests[path] = digest;
    return digest;
  };

  // Always bind authority digests used by D0 gates.
  const authorityPaths = new Set([
    "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
    "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
    "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
    "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md"
  ]);
  for (const entry of catalogTickets) {
    if (entry?.ticket_path) authorityPaths.add(entry.ticket_path);
  }
  for (const path of authorityPaths) {
    if (!digestFile(path)) {
      return { ok: false, reason: failures.join("; ") || `live digest unavailable for ${path}`, facts: null };
    }
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
    const prdPath = "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md";
    const adrs = {
      "ADR-0001": liveDigests["docs/adr/ADR-0001-product-identity-and-legacy-boundary.md"],
      "ADR-0003": liveDigests["docs/adr/ADR-0003-runtime-repository-and-distribution.md"],
      "ADR-0012": liveDigests["docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md"]
    };
    const kind = entry.kind === "superseded" ? "superseded" : "executable";
    tickets[entry.id] = {
      kind,
      dependencies: Array.isArray(entry.dependencies) ? [...entry.dependencies] : [],
      owned_paths: [],
      owned_symbols: [],
      red_command: null,
      digests: {
        ticket: ticketDigest,
        prd: liveDigests[prdPath],
        adrs
      },
      ticket_path: entry.ticket_path
    };
  }

  // Detect D0-004C from tip workflow blob for multi-lane ownership selection (B vs C).
  const opsWorkflowProbe = transportCall(
    transport,
    "getJson",
    `${repoPath}/contents/.github/workflows/operational-state.yml?ref=${liveTip}`
  );
  const d0_004c_merged_early = opsWorkflowProbe.ok === true && typeof opsWorkflowProbe.value?.sha === "string";
  for (const [ticketId, ticket] of Object.entries(tickets)) {
    if (ticket.kind !== "executable") continue;
    const ticketBody = readTipFile(ticket.ticket_path);
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

  // Collect gate PRs for accepted batches via authenticated search + pull fetch.
  const gatePRs = [];
  const postMergeCI = [];
  const seenGatePr = new Set();
  for (const batch of gateBatches) {
    const q = encodeURIComponent(
      `repo:${expected.repository} is:pr is:merged "Gate-Batch: ${batch.id}"`
    );
    const search = requireJson(transport, `search/issues?q=${q}&per_page=10`, failures);
    if (!search) return { ok: false, reason: failures.join("; "), facts: null };
    if (!Array.isArray(search.items)) {
      return { ok: false, reason: `ambiguous gate PR search for ${batch.id}`, facts: null };
    }
    if (search.items.length === 0) {
      // No gate PR for this accepted registry row — leave unmatched (gate acceptance fails closed later).
      continue;
    }
    if (search.items.length !== 1) {
      return { ok: false, reason: `ambiguous gate PR set for batch ${batch.id}`, facts: null };
    }
    const number = search.items[0].number;
    if (seenGatePr.has(number)) continue;
    const pull = requireJson(transport, `${repoPath}/pulls/${number}`, failures);
    if (!pull) return { ok: false, reason: failures.join("; "), facts: null };
    const batchField = parseGateBatchFromBody(pull.body);
    if (batchField !== batch.id) {
      return { ok: false, reason: `gate PR #${number} lacks exact Gate-Batch ${batch.id}`, facts: null };
    }
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
    const registryAtHead = requireRaw(
      transport,
      `${repoPath}/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${gateHeadSha}`,
      failures
    );
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
    seenGatePr.add(number);
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

    const runs = requireJson(
      transport,
      `${repoPath}/actions/runs?head_sha=${pull.merge_commit_sha}&event=push&per_page=20`,
      failures
    );
    if (!runs || !Array.isArray(runs.workflow_runs)) {
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

  // Active candidates: open PRs targeting live default branch.
  const openPulls = requireJson(
    transport,
    `${repoPath}/pulls?state=open&base=${repo.default_branch}&per_page=50`,
    failures
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
    if (author) actors.add(author);
    prs.push({
      number: pull.number,
      base: pull.base?.ref,
      base_sha: pull.base?.sha ?? liveTip,
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
    if (!headRuns || !Array.isArray(headRuns.workflow_runs)) {
      return { ok: false, reason: failures.join("; ") || `workflow runs unavailable for ${head}`, facts: null };
    }
    const checksPayload = requireJson(
      transport,
      `${repoPath}/commits/${head}/check-runs?per_page=50`,
      failures
    );
    if (!checksPayload || !Array.isArray(checksPayload.check_runs)) {
      return { ok: false, reason: failures.join("; ") || `check runs unavailable for ${head}`, facts: null };
    }
    const checksById = new Map();
    const checksByName = new Map();
    for (const check of checksPayload.check_runs) {
      if (check?.id != null) checksById.set(check.id, check);
      if (typeof check?.name === "string") {
        const list = checksByName.get(check.name) ?? [];
        list.push(check);
        checksByName.set(check.name, list);
      }
    }

    for (const run of headRuns.workflow_runs) {
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
      let jobs = null;
      const attemptJobs = transportCall(
        transport,
        "getJson",
        `${repoPath}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=50`
      );
      if (attemptJobs.ok && Array.isArray(attemptJobs.value?.jobs)) {
        jobs = attemptJobs.value.jobs;
      } else {
        const baseJobs = requireJson(transport, `${repoPath}/actions/runs/${run.id}/jobs?per_page=50`, failures);
        jobs = baseJobs?.jobs ?? null;
      }
      if (!Array.isArray(jobs)) {
        return { ok: false, reason: failures.join("; ") || `jobs unavailable for run ${run.id}`, facts: null };
      }
      for (const job of jobs) {
        // Bind check-run to this exact run/attempt — never reuse another attempt's check by name alone.
        let check = null;
        if (typeof job.check_run_url === "string") {
          const idMatch = job.check_run_url.match(/\/check-runs\/(\d+)\b/);
          if (idMatch) {
            check = checksById.get(Number(idMatch[1])) ?? null;
          }
        }
        if (!check && job.check_run_id != null) {
          check = checksById.get(Number(job.check_run_id)) ?? null;
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
          } else if (named.length === 1 && headRuns.workflow_runs.length === 1) {
            // Single-run head: unique check name may bind for app provenance only.
            check = named[0];
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
        const appSlug = check.app?.slug;
        const appId = check.app?.id;
        if (typeof appSlug !== "string" || appSlug.length === 0 || appId == null) {
          return {
            ok: false,
            reason: `missing live check app provenance for job ${job.name} on ${head}`,
            facts: null
          };
        }
        // Selected attempt's job terminal state controls — never prefer an older check-run success.
        const status = job.status;
        const conclusion = job.conclusion;
        if (typeof status !== "string" || !status) {
          return {
            ok: false,
            reason: `missing live job status for ${job.name} run ${run.id} attempt ${run.run_attempt}`,
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

    // Formal reviews: only APPROVED reviews with commit_id == head count as bootstrap evidence.
    const pullReviews = requireJson(transport, `${repoPath}/pulls/${pull.number}/reviews`, failures);
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
      if (required) failures.push(result.reason);
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
  const mergedSearch = requireJson(
    transport,
    `search/issues?q=${encodeURIComponent(`repo:${expected.repository} is:pr is:merged base:${repo.default_branch} "Ticket:"`)}&per_page=30`,
    failures
  );
  if (!mergedSearch || !Array.isArray(mergedSearch.items)) {
    return { ok: false, reason: failures.join("; ") || "merged PR search unavailable", facts: null };
  }
  for (const item of mergedSearch.items) {
    const pull = requireJson(transport, `${repoPath}/pulls/${item.number}`, failures);
    if (!pull?.merged || !pull.merge_commit_sha) continue;
    const ticketId = parseTicketIdFromBody(pull.body);
    if (!ticketId || !tickets[ticketId]) continue;
    const runs = requireJson(
      transport,
      `${repoPath}/actions/runs?head_sha=${pull.merge_commit_sha}&event=push&per_page=20`,
      failures
    );
    if (!runs || !Array.isArray(runs.workflow_runs)) {
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
    if (!latest.ok || latest.run.conclusion !== "success" || latest.run.status !== "completed") continue;
    if (!verifiedTickets.includes(ticketId)) verifiedTickets.push(ticketId);
    implementationMerges.push({
      ticket_id: ticketId,
      merge_commit_sha: pull.merge_commit_sha,
      number: pull.number
    });
    postMergeCI.push({
      merge_commit_sha: pull.merge_commit_sha,
      head_sha: latest.run.head_sha,
      status: latest.run.status,
      conclusion: latest.run.conclusion,
      run_id: latest.run.run_id,
      run_attempt: latest.run.run_attempt
    });
  }
  if (failures.length) {
    return { ok: false, reason: failures.join("; "), facts: null };
  }

  // Detect D0-004C merge only when the operational-state workflow exists on live tip.
  const d0_004c_merged = Object.hasOwn(workflowBlobs, ".github/workflows/operational-state.yml");

  // Active ownership lanes: open linked candidates with catalog-derived owned paths/symbols.
  const activeOwnership = [];
  for (const pr of prs) {
    const ticketId = parseTicketIdFromBody(pr.body);
    if (!ticketId || !tickets[ticketId] || tickets[ticketId].kind === "superseded") continue;
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
    ancestry: {},
    exactBasePackets: [],
    registryStrings: {},
    collector: {
      transport: transport.kind,
      live_tip: liveTip,
      write_actions: 0,
      per_call_timeout_ms: transport.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS,
      total_timeout_ms: transport.totalTimeoutMs ?? DEFAULT_TOTAL_COLLECTION_TIMEOUT_MS
    }
  };

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
            head: facts?.currentHead ?? derived.head
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

  const result = {
    schema_version: 1,
    mode,
    repository: expectedRepo,
    target_branch: expectedBranch,
    current_head: runtimeIdentity.head ?? null,
    resolved_at: now,
    bootstrap: {
      active: facts.d0_004c_merged !== true,
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
          head: identity.head ?? null
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
    const lines = [
      `EXECUTION_STATE mode=${result.mode} repository=${result.repository} branch=${result.target_branch} head=${result.current_head ?? "unknown"}`,
      `readySet=${result.readySet.join(",") || "none"}`
    ];
    for (const [id, state] of Object.entries(result.tickets)) {
      if (args.ticket && id !== args.ticket) continue;
      const codes = state.blockers.map((entry) => entry.code).join(",") || "none";
      lines.push(`${id} phase=${state.phase} readiness=${state.readiness} blockers=${codes}`);
    }
    if (result.errors?.length) {
      lines.push(`errors=${result.errors.map((entry) => entry.code).join(",")}`);
    }
    console.log(lines.join("\n"));
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
  main();
}

// Silence unused import warning patterns for path helpers used by CLI consumers.
void isAbsolute;
void relative;
void PHASES;
void READINESS;
