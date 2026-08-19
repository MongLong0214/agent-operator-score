import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

// Namespace import: resolve-execution-state already exists. A missing named
// export must stay undefined so each case can fail with its pinned message.
// A static named import would be a module-load SyntaxError, which the RED
// contract treats as an unrelated stop.
import * as resolver from "../scripts/resolve-execution-state.mjs";

const AUTHOR_ID = 110011;
const REVIEWER_ID = 220022;
const MERGER_ID = 330033;
const EXACT_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const INACTIVE_MESSAGE = "authenticated review activation is inactive";
const THREE_PRINCIPALS_MESSAGE =
  "authenticated review activation is inactive: three distinct principals were not revalidated";
const GITHUB_OUTAGE_MESSAGE = "authenticated review activation is inactive: github outage";
const PROTECTION_404_MESSAGE = "authenticated review activation is inactive: protection 404";
const PARTIAL_PROTECTION_MESSAGE = "authenticated review activation is inactive: partial protection";
const PERMISSION_LOSS_MESSAGE = "authenticated review activation is inactive: permission loss";
const ADMIN_ENFORCEMENT_MESSAGE =
  "authenticated review activation is inactive: administrator enforcement is required";
const LAST_PUSH_MESSAGE = "authenticated review activation is inactive: last-push approval is required";
const USER_BYPASS_MESSAGE = "authenticated review activation is inactive: user bypass";
const TEAM_BYPASS_MESSAGE = "authenticated review activation is inactive: team bypass";
const APP_BYPASS_MESSAGE = "authenticated review activation is inactive: app bypass";
const WRONG_TARGET_MESSAGE = "authenticated review activation is inactive: wrong target";
const IDENTITY_COLLISION_MESSAGE = "authenticated review activation is inactive: identity collision";
const ARTIFACT_MISMATCH_MESSAGE = "authenticated review activation is inactive: artifact mismatch";
const STALE_REVIEW_DISMISSAL_MESSAGE =
  "authenticated review activation is inactive: stale-review dismissal is required";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const assertExported = (value, message) => assert.equal(typeof value, "function", message);

const thrownMessage = (fn) => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const otherwiseValidManifest = (overrides = {}) => ({
  schema_version: 3,
  manifest_id: "d0-009-authenticated-review-activation",
  artifacts: [
    {
      path: "docs/adr/ADR-0013-authenticated-governance-modes-and-legacy-quarantine.md",
      sha256: HEX_A,
      kind: "ADR",
      source_record_id: "d0-009-activation-source-record",
      source_record_sha256: HEX_B,
      migration_provenance: "legacy-v2-migration"
    }
  ],
  ...overrides
});

const manifestDigestOf = (manifest) => sha256(Buffer.from(JSON.stringify(manifest), "utf8"));

const otherwiseValidActivationFacts = (overrides = {}) => {
  const manifest = Object.hasOwn(overrides, "manifest") ? overrides.manifest : otherwiseValidManifest();
  const digest = Object.hasOwn(overrides, "manifest_digest")
    ? overrides.manifest_digest
    : manifestDigestOf(manifest);
  return {
    github_outage: false,
    protection_status: 200,
    target_branch: "dev",
    candidate_base: "dev",
    exact_head_sha: EXACT_HEAD_SHA,
    review_head_sha: EXACT_HEAD_SHA,
    review_state: "APPROVED",
    author_id: AUTHOR_ID,
    reviewer_id: REVIEWER_ID,
    merger_id: MERGER_ID,
    reviewer_permission: "write",
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_last_push_approval: true,
    enforce_admins: true,
    user_bypass_allowances: [],
    team_bypass_allowances: [],
    app_bypass_allowances: [],
    manifest,
    manifest_digest: digest,
    manifest_in_head: true,
    ...overrides
  };
};

const assertEvaluateRejects = (facts, message) => {
  assertExported(resolver.evaluateAuthenticatedReviewActivation, message);
  assert.equal(
    thrownMessage(() => resolver.evaluateAuthenticatedReviewActivation(facts)),
    message,
    message
  );
};

test("activation-requires-second-principal-and-protected-dev", () => {
  assertExported(resolver.evaluateAuthenticatedReviewActivation, INACTIVE_MESSAGE);
  assertExported(resolver.selectActiveGovernanceMode, INACTIVE_MESSAGE);
  const facts = otherwiseValidActivationFacts();
  const result = resolver.evaluateAuthenticatedReviewActivation(facts);
  assert.equal(result.active, true, INACTIVE_MESSAGE);
  assert.equal(resolver.selectActiveGovernanceMode(result), "AUTHENTICATED_REVIEW", INACTIVE_MESSAGE);
  assert.notEqual(result.author_id, result.reviewer_id, INACTIVE_MESSAGE);
  assert.equal(facts.required_approving_review_count >= 1, true, INACTIVE_MESSAGE);
  assert.equal(facts.dismiss_stale_reviews, true, INACTIVE_MESSAGE);
  assert.equal(facts.require_last_push_approval, true, INACTIVE_MESSAGE);
  assert.equal(facts.enforce_admins, true, INACTIVE_MESSAGE);
  assert.deepEqual(facts.user_bypass_allowances, [], INACTIVE_MESSAGE);
  assert.deepEqual(facts.team_bypass_allowances, [], INACTIVE_MESSAGE);
  assert.deepEqual(facts.app_bypass_allowances, [], INACTIVE_MESSAGE);
  assert.equal(result.artifact_freeze === null, false, INACTIVE_MESSAGE);
  assert.equal(result.artifact_freeze.manifest_id, facts.manifest.manifest_id, INACTIVE_MESSAGE);
  assert.equal(result.artifact_freeze.path, facts.manifest.artifacts[0].path, INACTIVE_MESSAGE);
  assert.equal(result.artifact_freeze.sha256, facts.manifest.artifacts[0].sha256, INACTIVE_MESSAGE);
  assert.equal(result.artifact_freeze.kind, facts.manifest.artifacts[0].kind, INACTIVE_MESSAGE);
  assert.equal(result.artifact_freeze.exact_head_sha, EXACT_HEAD_SHA, INACTIVE_MESSAGE);
});

test("activation-revalidates-three-distinct-principals", () => {
  assertExported(resolver.evaluateAuthenticatedReviewActivation, THREE_PRINCIPALS_MESSAGE);
  const facts = otherwiseValidActivationFacts({
    inherited_github_acceptance: {
      author_id: 1,
      reviewer_id: 1,
      merger_id: 1,
      activation: false
    }
  });
  const result = resolver.evaluateAuthenticatedReviewActivation(facts);
  assert.equal(result.active, true, THREE_PRINCIPALS_MESSAGE);
  assert.equal(result.author_id, AUTHOR_ID, THREE_PRINCIPALS_MESSAGE);
  assert.equal(result.reviewer_id, REVIEWER_ID, THREE_PRINCIPALS_MESSAGE);
  assert.equal(result.merger_id, MERGER_ID, THREE_PRINCIPALS_MESSAGE);
  assert.notEqual(result.author_id, result.reviewer_id, THREE_PRINCIPALS_MESSAGE);
  assert.notEqual(result.author_id, result.merger_id, THREE_PRINCIPALS_MESSAGE);
  assert.notEqual(result.reviewer_id, result.merger_id, THREE_PRINCIPALS_MESSAGE);
});

test("activation-github-outage-fails-closed", () => {
  assertEvaluateRejects(otherwiseValidActivationFacts({ github_outage: true }), GITHUB_OUTAGE_MESSAGE);
});

test("activation-protection-404-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ protection_status: 404 }),
    PROTECTION_404_MESSAGE
  );
});

test("activation-partial-protection-fails-closed", () => {
  const { required_approving_review_count: _omitted, ...partial } = otherwiseValidActivationFacts();
  void _omitted;
  assertEvaluateRejects(partial, PARTIAL_PROTECTION_MESSAGE);
});

test("activation-permission-loss-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ reviewer_permission: "none" }),
    PERMISSION_LOSS_MESSAGE
  );
});

test("activation-admin-enforcement-required", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ enforce_admins: false }),
    ADMIN_ENFORCEMENT_MESSAGE
  );
});

test("activation-last-push-approval-required", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ require_last_push_approval: false }),
    LAST_PUSH_MESSAGE
  );
});

test("activation-user-bypass-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ user_bypass_allowances: [{ login: "bypass-user" }] }),
    USER_BYPASS_MESSAGE
  );
});

test("activation-team-bypass-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ team_bypass_allowances: [{ slug: "bypass-team" }] }),
    TEAM_BYPASS_MESSAGE
  );
});

test("activation-app-bypass-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ app_bypass_allowances: [{ slug: "bypass-app" }] }),
    APP_BYPASS_MESSAGE
  );
});

test("activation-wrong-target-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ target_branch: "main", candidate_base: "main" }),
    WRONG_TARGET_MESSAGE
  );
});

test("activation-identity-collision-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ author_id: REVIEWER_ID }),
    IDENTITY_COLLISION_MESSAGE
  );
});

test("activation-artifact-mismatch-fails-closed", () => {
  assertEvaluateRejects(
    otherwiseValidActivationFacts({ manifest_digest: HEX_B, manifest_in_head: false }),
    ARTIFACT_MISMATCH_MESSAGE
  );
});

test("activation-stale-review-dismissal-required", () => {
  const facts = otherwiseValidActivationFacts({ dismiss_stale_reviews: false });
  assertEvaluateRejects(facts, STALE_REVIEW_DISMISSAL_MESSAGE);
});
