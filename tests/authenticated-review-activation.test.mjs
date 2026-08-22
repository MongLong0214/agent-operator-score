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

// The digest's preimage is the manifest file's bytes, so a fixture must carry the exact
// text it hashed. Reserializing the object here would reproduce the two-preimage defect
// this suite exists to keep closed (#306).
const manifestTextOf = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;
const manifestDigestOf = (manifest) => sha256(Buffer.from(manifestTextOf(manifest), "utf8"));

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
    manifest_text: Object.hasOwn(overrides, "manifest_text") ? overrides.manifest_text : manifestTextOf(manifest),
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

// ---------------------------------------------------------------------------
// manifest_digest has one preimage: the file's bytes (#306).
//
// The producers hashed the file bytes and the consumers re-hashed the parsed object.
// JSON round-tripping preserves key order but not whitespace or the trailing newline, so
// every digest the producers emitted was one the consumers always refused. Measured on the
// live manifest: file bytes a820e0e9..., reserialized a017596f....
//
// It had not surfaced because the live collector never supplied these fields, so the two
// halves were never asked to agree on a live path. These cases ask.
// ---------------------------------------------------------------------------

test("manifest-digest-preimage-is-the-file-bytes-not-a-reserialization", async () => {
  const { manifestDigestMatches } = await import("../scripts/validate-artifact-manifest.mjs");
  const manifest = otherwiseValidManifest();
  const text = manifestTextOf(manifest);
  const bytesDigest = sha256(Buffer.from(text, "utf8"));
  const reserializedDigest = sha256(Buffer.from(JSON.stringify(manifest), "utf8"));

  assert.notEqual(bytesDigest, reserializedDigest, "the two preimages must actually differ, or this case proves nothing");
  assert.equal(manifestDigestMatches(text, manifest, bytesDigest), true, "the digest a producer emits must be accepted");
  assert.equal(
    manifestDigestMatches(text, manifest, reserializedDigest),
    false,
    "a digest over a reserialization is not this manifest's digest"
  );
});

test("manifest-text-that-disagrees-with-the-parsed-manifest-is-refused", async () => {
  const { manifestDigestMatches } = await import("../scripts/validate-artifact-manifest.mjs");
  const manifest = otherwiseValidManifest();
  const text = manifestTextOf(manifest);
  const digest = sha256(Buffer.from(text, "utf8"));
  // Bytes that hash correctly beside a different object would pin something the structural
  // validation never saw.
  assert.equal(manifestDigestMatches(text, { ...manifest, injected: true }, digest), false);
  assert.equal(manifestDigestMatches("{not json", manifest, sha256(Buffer.from("{not json", "utf8"))), false);
  assert.equal(manifestDigestMatches("", manifest, digest), false);
  // An absent preimage must be a refusal, not a crash: without the type guard
  // Buffer.from(undefined, "utf8") throws a TypeError out of a fail-closed check, and a
  // check that throws is not a check that refuses.
  assert.equal(manifestDigestMatches(undefined, manifest, digest), false);
  assert.equal(manifestDigestMatches(null, manifest, digest), false);
  assert.equal(manifestDigestMatches(42, manifest, digest), false);
  // The control, differing only in that the text and object agree.
  assert.equal(manifestDigestMatches(text, manifest, digest), true);
});

test("a-whitespace-only-edit-changes-the-manifest-digest", async () => {
  const { manifestDigestMatches } = await import("../scripts/validate-artifact-manifest.mjs");
  const manifest = otherwiseValidManifest();
  const compact = JSON.stringify(manifest);
  const spaced = `${JSON.stringify(manifest, null, 4)}\n`;
  // Byte-pinning is the point of an artifact freeze: two files that parse identically but are
  // not the same bytes must not share a digest. Hashing the parsed object loses exactly this.
  assert.notEqual(sha256(Buffer.from(compact, "utf8")), sha256(Buffer.from(spaced, "utf8")));
  assert.equal(manifestDigestMatches(spaced, manifest, sha256(Buffer.from(spaced, "utf8"))), true);
  assert.equal(manifestDigestMatches(spaced, manifest, sha256(Buffer.from(compact, "utf8"))), false);
});

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
