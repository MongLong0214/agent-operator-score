import { createHash } from "node:crypto";
import { validateArtifactManifestV3 } from "./validate-artifact-manifest.mjs";

const SCHEMA_VERSION = 1;
const TARGET_BRANCH = "dev";
const INACTIVE_STATUS = "INACTIVE_AUTHENTICATED_REVIEW_CANDIDATE";
const ELIGIBLE_PERMISSIONS = new Set(["write", "maintain", "admin"]);
const GIT_SHA = /^[0-9a-f]{40}$/i;
const MANIFEST_DIGEST = /^[a-f0-9]{64}$/;

const AUTHOR_REVIEWER_MESSAGE = "github acceptance rejected: author-reviewer collision";
const AUTHOR_MERGER_MESSAGE = "github acceptance rejected: author-merger collision";
const REVIEWER_MERGER_MESSAGE = "github acceptance rejected: reviewer-merger collision";
const WRONG_BASE_MESSAGE = "github acceptance rejected: wrong base";
const MALFORMED_MANIFEST_MESSAGE = "github acceptance rejected: malformed manifest";
const STALE_REVIEW_MESSAGE = "github acceptance rejected: stale review";
const DISMISSED_REVIEW_MESSAGE = "github acceptance rejected: dismissed review";
const WRONG_TARGET_MESSAGE = "github acceptance rejected: wrong target";
const GITHUB_OUTAGE_MESSAGE = "github acceptance rejected: github outage";
const REVIEWER_PERMISSION_MESSAGE = "github acceptance rejected: reviewer permission";
const DUPLICATE_FACTS_MESSAGE = "github acceptance rejected: duplicate gate facts";
const AMBIGUOUS_PRINCIPAL_MESSAGE = "github acceptance rejected: ambiguous principal";

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const reject = (message) => {
  throw new Error(message);
};
const stableGitHubId = (value) => Number.isInteger(value) && value > 0;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const extractGateBatchFields = (body) => {
  if (typeof body !== "string") return [];
  return [...body.matchAll(/^Gate-Batch:\s*(\S+)\s*$/gm)].map((match) => match[1]);
};

const inspectManifest = (facts) => {
  if (!plainObject(facts.manifest) || facts.manifest_in_head !== true) {
    reject(MALFORMED_MANIFEST_MESSAGE);
  }
  if (typeof facts.manifest_digest !== "string" || !MANIFEST_DIGEST.test(facts.manifest_digest)) {
    reject(MALFORMED_MANIFEST_MESSAGE);
  }
  const digest = sha256(Buffer.from(JSON.stringify(facts.manifest), "utf8"));
  if (digest !== facts.manifest_digest) reject(MALFORMED_MANIFEST_MESSAGE);
  try {
    validateArtifactManifestV3({ manifest: facts.manifest });
  } catch {
    reject(MALFORMED_MANIFEST_MESSAGE);
  }
};

const inspectFacts = (facts) => {
  if (!plainObject(facts)) reject(AMBIGUOUS_PRINCIPAL_MESSAGE);
  if (facts.github_outage === true) reject(GITHUB_OUTAGE_MESSAGE);

  if (!stableGitHubId(facts.author_id) || !stableGitHubId(facts.reviewer_id) || !stableGitHubId(facts.merger_id)) {
    reject(AMBIGUOUS_PRINCIPAL_MESSAGE);
  }
  if (facts.author_id === facts.reviewer_id) reject(AUTHOR_REVIEWER_MESSAGE);
  if (facts.author_id === facts.merger_id) reject(AUTHOR_MERGER_MESSAGE);
  if (facts.reviewer_id === facts.merger_id) reject(REVIEWER_MERGER_MESSAGE);

  if (facts.base !== TARGET_BRANCH) reject(WRONG_BASE_MESSAGE);
  if (facts.target_branch !== TARGET_BRANCH) reject(WRONG_TARGET_MESSAGE);
  if (facts.merged !== true) reject(WRONG_TARGET_MESSAGE);
  if (facts.merge_commit_reachable_from_target !== true) reject(WRONG_TARGET_MESSAGE);
  if (typeof facts.exact_head_sha !== "string" || !GIT_SHA.test(facts.exact_head_sha)) {
    reject(WRONG_TARGET_MESSAGE);
  }
  if (typeof facts.merge_commit_sha !== "string" || !GIT_SHA.test(facts.merge_commit_sha)) {
    reject(WRONG_TARGET_MESSAGE);
  }
  if (!Number.isInteger(facts.gate_pr) || facts.gate_pr < 1) reject(DUPLICATE_FACTS_MESSAGE);
  if (typeof facts.batch_id !== "string" || facts.batch_id.length === 0) reject(DUPLICATE_FACTS_MESSAGE);

  const batches = extractGateBatchFields(facts.body);
  if (batches.length !== 1 || batches[0] !== facts.batch_id) reject(DUPLICATE_FACTS_MESSAGE);

  if (!ELIGIBLE_PERMISSIONS.has(facts.reviewer_permission)) reject(REVIEWER_PERMISSION_MESSAGE);
  if (facts.review_state === "DISMISSED") reject(DISMISSED_REVIEW_MESSAGE);
  if (typeof facts.review_head_sha !== "string" || !GIT_SHA.test(facts.review_head_sha)) {
    reject(STALE_REVIEW_MESSAGE);
  }
  if (facts.review_head_sha.toLowerCase() !== facts.exact_head_sha.toLowerCase()) {
    reject(STALE_REVIEW_MESSAGE);
  }
  if (facts.review_state !== "APPROVED") reject(STALE_REVIEW_MESSAGE);

  inspectManifest(facts);
};

const candidateFields = (facts) => ({
  schema_version: SCHEMA_VERSION,
  activation: false,
  gate_pr: facts.gate_pr,
  batch_id: facts.batch_id,
  exact_head_sha: facts.exact_head_sha.toLowerCase(),
  target_branch: TARGET_BRANCH,
  merge_commit_sha: facts.merge_commit_sha.toLowerCase(),
  manifest_digest: facts.manifest_digest,
  manifest_in_head: true,
  author_id: facts.author_id,
  reviewer_id: facts.reviewer_id,
  merger_id: facts.merger_id,
  review_state: "APPROVED",
  reviewer_permission: facts.reviewer_permission
});

export const validateGitHubAcceptanceFacts = (facts) => {
  inspectFacts(facts);
  return {
    ok: true,
    ...candidateFields(facts)
  };
};

export const deriveGitHubAcceptance = (facts) => {
  const validated = validateGitHubAcceptanceFacts(facts);
  return {
    ...validated,
    status: INACTIVE_STATUS,
    red_authorized: false,
    gate_accepted: false,
    artifact_freeze: null,
    readySet: []
  };
};
