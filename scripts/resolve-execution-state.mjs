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

/**
 * Bounded online-strict fact acquisition. Accepts injected facts (tests) or an
 * explicit facts path; otherwise probes live git/GitHub identity and fails closed
 * when a complete operational corpus is unavailable (no empty-corpus fallback).
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

  const factsPath =
    options.factsPath ??
    process.env.AOS_EXECUTION_STATE_FACTS ??
    null;
  if (factsPath) {
    const absolute = isAbsolute(factsPath) ? factsPath : resolve(root, factsPath);
    const loaded = loadJsonIfExists(absolute);
    if (!loaded) return { ok: false, reason: `facts path unavailable: ${factsPath}`, facts: null };
    const corpus = validateFactsCorpus(loaded);
    if (!corpus.ok) return { ok: false, reason: corpus.failures.join("; "), facts: null };
    if (loaded.externalAvailable !== true) {
      return { ok: false, reason: "facts path marks externalAvailable=false", facts: null };
    }
    return { ok: true, facts: loaded };
  }

  const identity = deriveRuntimeIdentity(root);
  if (!identity.repository || !identity.branch || !identity.head) {
    return { ok: false, reason: "runtime git identity unavailable", facts: null };
  }

  let repoJson = null;
  try {
    const raw = execFileSync(
      "gh",
      ["api", `repos/${identity.repository}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    repoJson = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "github repository facts unavailable", facts: null };
  }

  if (!repoJson?.owner?.login || !repoJson?.default_branch) {
    return { ok: false, reason: "github repository owner/default_branch unavailable", facts: null };
  }

  // Bounded probe succeeded for identity, but a complete operational gate/PR/CI
  // corpus is not inventable from identity alone. Fail closed without fallback.
  return {
    ok: false,
    reason: "complete live operational fact corpus unavailable",
    facts: null,
    identity: {
      repository: identity.repository,
      branch: identity.branch,
      head: identity.head,
      owner: { login: repoJson.owner.login, type: repoJson.owner.type },
      defaultBranch: repoJson.default_branch
    }
  };
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
      ? deriveRuntimeIdentity(root)
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
    errors
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
      const identity = acquired.identity ?? deriveRuntimeIdentity(DEFAULT_ROOT);
      result = emptyFailureState(
        "online-strict",
        new Date().toISOString(),
        {
          repository: identity.repository ?? expectedActorPolicyFromTicket().repository,
          branch: identity.defaultBranch ?? identity.branch ?? expectedActorPolicyFromTicket().target_branch,
          head: identity.head ?? null
        },
        [blocker("EXTERNAL_STATE_UNAVAILABLE", acquired.reason ?? "external facts unavailable")]
      );
    } else {
      result = resolveExecutionState({
        mode: "online-strict",
        facts: acquired.facts,
        ticket: args.ticket
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

  const unresolvedExternal = result.errors.some((entry) =>
    ["EXTERNAL_STATE_UNAVAILABLE", "WRONG_TARGET", "TICKET_CONTRACT_CONFLICT", "TICKET_CONTRACT_INCOMPLETE"].includes(
      entry.code
    )
  );
  const failed =
    unresolvedExternal ||
    (args.strict && (result.errors.length > 0 || result.readySet === undefined));
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
