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
    const pr = (facts.gatePRs ?? []).find(
      (candidate) =>
        typeof candidate?.body === "string" &&
        candidate.body.includes(`Gate-Batch: ${batch.id}`) &&
        candidate.merged === true &&
        candidate.base === "dev" &&
        candidate.head_contains_batch === true
    );
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

const isValidCandidatePr = (pr, ticketId, targetBranch) => {
  if (!pr || pr.merged === true) return false;
  const field = extractExactTicketField(pr.body);
  if (!field.ok || field.ticketId !== ticketId) return false;
  if (pr.base !== targetBranch) return false;
  if (typeof pr.head_sha !== "string" || !/^[0-9a-f]{40}$/i.test(pr.head_sha)) return false;
  if (typeof pr.number !== "number" || !Number.isFinite(pr.number)) return false;
  return true;
};

/**
 * Link candidates only via exactly one structured Ticket field; never ticket_id alone.
 * Deterministically select the highest PR number as active; report all others as superseded.
 * Fact array order must not change the selected active head.
 */
const resolveCandidatePrs = (facts, ticketId) => {
  const targetBranch = facts.operationalAuthority?.target_branch ?? "dev";
  const linked = (Array.isArray(facts.prs) ? facts.prs : []).filter((pr) =>
    isValidCandidatePr(pr, ticketId, targetBranch)
  );
  if (!linked.length) return { active: null, superseded: [] };
  const sorted = [...linked].sort((left, right) => {
    if (left.number !== right.number) return left.number - right.number;
    return String(left.head_sha).localeCompare(String(right.head_sha));
  });
  const active = sorted[sorted.length - 1];
  const superseded = sorted.slice(0, -1).map((pr) => ({
    number: pr.number,
    head_sha: pr.head_sha,
    base: pr.base
  }));
  return { active, superseded };
};

const candidatePrFor = (facts, ticketId) => resolveCandidatePrs(facts, ticketId).active;

const latestAttempt = (runs, name, headSha) => {
  const matches = runs.filter((run) => run.name === name && run.head_sha === headSha);
  const selected = selectLatestRunAttempt(matches);
  if (selected.ambiguous || selected.missing || !selected.run) return null;
  return selected.run;
};

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
    const checkMatches = checks.filter(
      (entry) =>
        entry.name === requiredCheck.name &&
        entry.head_sha === head &&
        (entry.ticket_id === ticketId || !entry.ticket_id)
    );
    // Prefer workflow-run attempts when present; otherwise use check-run facts.
    const pool = runMatches.length ? runMatches : checkMatches;
    const selected = selectLatestRunAttempt(pool);
    if (selected.ambiguous) {
      failures.push(`ambiguous run attempt for ${requiredCheck.name}`);
      continue;
    }
    const subject = selected.run ?? null;
    if (!subject) {
      failures.push(`missing required check ${requiredCheck.name}`);
      continue;
    }
    if (subject.head_sha !== head) {
      failures.push(`stale or wrong head for ${requiredCheck.name}`);
      continue;
    }
    // Every required provenance mapping fact must be present and exact.
    if (subject.app_slug == null || subject.app_slug === "") {
      failures.push(`missing app slug for ${requiredCheck.name}`);
      continue;
    }
    if (subject.app_slug !== requiredAppSlug) {
      failures.push(`wrong app for ${requiredCheck.name}`);
      continue;
    }
    if (subject.app_id == null || subject.app_id === "") {
      failures.push(`missing app id for ${requiredCheck.name}`);
      continue;
    }
    if (subject.app_id !== requiredAppId) {
      failures.push(`wrong app id for ${requiredCheck.name}`);
      continue;
    }
    if (subject.event == null || subject.event === "") {
      failures.push(`missing event for ${requiredCheck.name}`);
      continue;
    }
    if (subject.event !== requiredEvent) {
      failures.push(`wrong event for ${requiredCheck.name}`);
      continue;
    }
    if (subject.base == null || subject.base === "") {
      failures.push(`missing base for ${requiredCheck.name}`);
      continue;
    }
    if (subject.base !== requiredBase) {
      failures.push(`wrong base for ${requiredCheck.name}`);
      continue;
    }
    if (subject.workflow_path == null || subject.workflow_path === "") {
      failures.push(`missing workflow path for ${requiredCheck.name}`);
      continue;
    }
    if (subject.workflow_path !== requiredCheck.workflow_path) {
      failures.push(`wrong workflow path for ${requiredCheck.name}`);
      continue;
    }
    if (subject.status !== "completed" || subject.conclusion !== "success") {
      failures.push(`required check ${requiredCheck.name} not successful`);
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

export const resolveExecutionState = (options = {}) => {
  const mode = options.mode === "online-strict" ? "online-strict" : "offline";
  const root = options.root ? resolve(options.root) : DEFAULT_ROOT;
  const now = typeof options.now === "string" ? options.now : new Date().toISOString();

  let facts = options.facts ?? null;
  if (!facts && mode === "offline") {
    const fixturePath = options.fixturePath
      ? resolve(options.fixturePath)
      : resolve(root, "fixtures/operational-state/current-baseline/facts.json");
    facts = loadJsonIfExists(fixturePath);
  }
  if (!facts) {
    facts = {
      repository: "MongLong0214/agent-operator-score",
      defaultBranch: "dev",
      owner: { login: "MongLong0214", type: "User" },
      currentHead: null,
      d0_004c_merged: false,
      externalAvailable: mode === "offline",
      operationalAuthority: expectedActorPolicyFromTicket(),
      tickets: {},
      gateBatches: [],
      gatePRs: [],
      postMergeCI: [],
      verifiedTickets: [],
      issues: [],
      prs: [],
      reviews: [],
      authorizations: [],
      checkRuns: [],
      workflowRuns: [],
      permissions: {},
      workflowBlobs: {},
      liveDigests: {},
      activeOwnership: [],
      projectionSurfaces: {}
    };
  }

  // Projection surfaces are intentionally never read for readiness.
  void facts.projectionSurfaces;
  void facts.issues;
  void facts.registryStrings;

  const runtimeIdentity = options.runtimeIdentity ?? (
    mode === "online-strict" ? deriveRuntimeIdentity(root) : {
      repository: facts.repository,
      branch: facts.defaultBranch,
      head: facts.currentHead
    }
  );

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

  const externalUnavailable = facts.externalAvailable === false;

  const context = { wrongTarget, policyConflict, externalUnavailable };
  const ticketIds = Object.keys(facts.tickets ?? {}).sort();
  const tickets = {};
  for (const ticketId of ticketIds) {
    tickets[ticketId] = resolveOneTicket(facts, ticketId, facts.tickets[ticketId], policy ?? expectedActorPolicyFromTicket(), context);
  }

  if (options.ticket) {
    // Keep full map for determinism; filter readySet/report later if needed.
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

  return {
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
};

export const runOfflineCheck = (options = {}) => {
  const root = options.root ? resolve(options.root) : DEFAULT_ROOT;
  const fixturePath = resolve(root, "fixtures/operational-state/current-baseline/facts.json");
  const result = resolveExecutionState({
    mode: "offline",
    root,
    fixturePath,
    facts: options.facts,
    runtimeIdentity: options.runtimeIdentity
  });
  const failures = [];
  if (!existsSync(fixturePath) && !options.facts) {
    failures.push("missing current-baseline fixture");
  }
  if (result.errors.some((entry) => entry.code === "WRONG_TARGET")) {
    failures.push("wrong target");
  }
  // Offline check does not claim online readiness.
  return {
    ok: failures.length === 0 && !result.errors.some((e) => e.code === "TICKET_CONTRACT_CONFLICT"),
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
    result = resolveExecutionState({
      mode: "online-strict",
      ticket: args.ticket
    });
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
    console.log(lines.join("\n"));
  }

  const failed =
    result.errors.some((entry) => ["WRONG_TARGET", "TICKET_CONTRACT_CONFLICT"].includes(entry.code)) ||
    (args.strict && result.readySet === undefined);
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
