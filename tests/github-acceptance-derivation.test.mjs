import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

// Namespace import: resolve-execution-state already exists. A missing named
// export must stay undefined so inactive-derivation-never-authorizes-or-freezes
// can fail with its pinned message. A static named import would be a
// module-load SyntaxError, which the RED contract treats as an unrelated stop.
import * as resolver from "../scripts/resolve-execution-state.mjs";

const AUTHOR_ID = 110011;
const REVIEWER_ID = 220022;
const MERGER_ID = 330033;
const EXACT_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MERGE_COMMIT_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const STALE_HEAD_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const BATCH_ID = "d0-008-inactive-derivation";
const GATE_PR = 176;
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const INACTIVE_STATUS = "INACTIVE_AUTHENTICATED_REVIEW_CANDIDATE";
const INACTIVE_AUTH_MESSAGE = "inactive derivation unexpectedly authorized RED or froze an artifact";
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const loadDeriver = async () => {
  try {
    return await import("../scripts/derive-github-acceptance.mjs");
  } catch {
    return {};
  }
};

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
  manifest_id: "d0-008-inactive-github-acceptance",
  artifacts: [
    {
      path: "docs/adr/ADR-0013-authenticated-governance-modes-and-legacy-quarantine.md",
      sha256: HEX_A,
      kind: "ADR",
      source_record_id: "d0-008-inactive-source-record",
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

const otherwiseValidFacts = (overrides = {}) => {
  const manifest = Object.hasOwn(overrides, "manifest") ? overrides.manifest : otherwiseValidManifest();
  const digest = Object.hasOwn(overrides, "manifest_digest")
    ? overrides.manifest_digest
    : manifestDigestOf(manifest);
  return {
    schema_version: 1,
    activation: false,
    gate_pr: GATE_PR,
    batch_id: BATCH_ID,
    exact_head_sha: EXACT_HEAD_SHA,
    target_branch: "dev",
    base: "dev",
    merge_commit_sha: MERGE_COMMIT_SHA,
    merge_commit_reachable_from_target: true,
    merged: true,
    manifest,
    manifest_text: Object.hasOwn(overrides, "manifest_text") ? overrides.manifest_text : manifestTextOf(manifest),
    manifest_digest: digest,
    manifest_in_head: true,
    author_id: AUTHOR_ID,
    reviewer_id: REVIEWER_ID,
    merger_id: MERGER_ID,
    review_state: "APPROVED",
    review_head_sha: EXACT_HEAD_SHA,
    reviewer_permission: "write",
    github_outage: false,
    body: `Ticket: D0-008\nTicket-Completion: D0-008\nGate-Batch: ${BATCH_ID}\n`,
    ...overrides
  };
};

const authorizedOrFroze = (result) =>
  result?.red_authorized === true ||
  result?.gate_accepted === true ||
  result?.artifact_freeze != null ||
  (Array.isArray(result?.readySet) && result.readySet.length > 0) ||
  result?.status === "READY_FOR_RED" ||
  result?.phase === "ready_for_red";

test("exact-head-authenticated-review-derives-pending-while-inactive", async () => {
  const { deriveGitHubAcceptance, validateGitHubAcceptanceFacts } = await import(
    "../scripts/derive-github-acceptance.mjs"
  );
  assert.equal(typeof deriveGitHubAcceptance, "function");
  assert.equal(typeof validateGitHubAcceptanceFacts, "function");

  const facts = otherwiseValidFacts();
  const validated = validateGitHubAcceptanceFacts(facts);
  assert.equal(validated.ok, true);
  assert.equal(validated.activation, false);

  const result = deriveGitHubAcceptance(facts);
  assert.equal(result.status, INACTIVE_STATUS);
  assert.equal(result.activation, false);
  assert.equal(result.schema_version, 1);
  assert.equal(result.gate_pr, GATE_PR);
  assert.equal(result.batch_id, BATCH_ID);
  assert.equal(result.exact_head_sha, EXACT_HEAD_SHA);
  assert.equal(result.target_branch, "dev");
  assert.equal(result.merge_commit_sha, MERGE_COMMIT_SHA);
  assert.equal(result.manifest_digest, facts.manifest_digest);
  assert.equal(result.manifest_in_head, true);
  assert.equal(result.author_id, AUTHOR_ID);
  assert.equal(result.reviewer_id, REVIEWER_ID);
  assert.equal(result.merger_id, MERGER_ID);
  assert.equal(result.review_state, "APPROVED");
  assert.equal(result.reviewer_permission, "write");
  assert.notEqual(result.author_id, result.reviewer_id);
  assert.notEqual(result.author_id, result.merger_id);
  assert.notEqual(result.reviewer_id, result.merger_id);
  assert.equal(result.red_authorized, false);
  assert.equal(result.gate_accepted, false);
  assert.equal(result.artifact_freeze, null);
  assert.deepEqual(result.readySet, []);
});

test("inactive-derivation-never-authorizes-or-freezes", () => {
  let result = {
    red_authorized: true,
    gate_accepted: true,
    artifact_freeze: { unexpected: true },
    readySet: ["D0-008"],
    status: "READY_FOR_RED",
    phase: "ready_for_red"
  };
  if (typeof resolver.resolveInactiveGitHubAcceptanceCandidate === "function") {
    result = resolver.resolveInactiveGitHubAcceptanceCandidate(otherwiseValidFacts());
  }
  assert.equal(authorizedOrFroze(result), false, INACTIVE_AUTH_MESSAGE);
  assert.equal(result.red_authorized, false, INACTIVE_AUTH_MESSAGE);
  assert.equal(result.gate_accepted, false, INACTIVE_AUTH_MESSAGE);
  assert.equal(result.artifact_freeze, null, INACTIVE_AUTH_MESSAGE);
  assert.deepEqual(result.readySet, [], INACTIVE_AUTH_MESSAGE);
  assert.equal(result.status, INACTIVE_STATUS, INACTIVE_AUTH_MESSAGE);
  assert.equal(result.activation, false, INACTIVE_AUTH_MESSAGE);
});

test("author-reviewer-collision-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", AUTHOR_REVIEWER_MESSAGE);
  assert.equal(
    thrownMessage(() => deriver.deriveGitHubAcceptance(otherwiseValidFacts({ author_id: REVIEWER_ID }))),
    AUTHOR_REVIEWER_MESSAGE,
    AUTHOR_REVIEWER_MESSAGE
  );
});

test("author-merger-collision-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", AUTHOR_MERGER_MESSAGE);
  assert.equal(
    thrownMessage(() => deriver.deriveGitHubAcceptance(otherwiseValidFacts({ author_id: MERGER_ID }))),
    AUTHOR_MERGER_MESSAGE,
    AUTHOR_MERGER_MESSAGE
  );
});

test("reviewer-merger-collision-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", REVIEWER_MERGER_MESSAGE);
  assert.equal(
    thrownMessage(() => deriver.deriveGitHubAcceptance(otherwiseValidFacts({ reviewer_id: MERGER_ID }))),
    REVIEWER_MERGER_MESSAGE,
    REVIEWER_MERGER_MESSAGE
  );
});

test("wrong-base-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", WRONG_BASE_MESSAGE);
  assert.equal(
    thrownMessage(() => deriver.deriveGitHubAcceptance(otherwiseValidFacts({ base: "main" }))),
    WRONG_BASE_MESSAGE,
    WRONG_BASE_MESSAGE
  );
});

test("malformed-manifest-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", MALFORMED_MANIFEST_MESSAGE);
  assert.equal(
    thrownMessage(() =>
      deriver.deriveGitHubAcceptance(
        otherwiseValidFacts({
          manifest: { schema_version: 2, manifest_id: "not-v3", artifacts: [] }
        })
      )
    ),
    MALFORMED_MANIFEST_MESSAGE,
    MALFORMED_MANIFEST_MESSAGE
  );
});

test("stale-review-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", STALE_REVIEW_MESSAGE);
  assert.equal(
    thrownMessage(() =>
      deriver.deriveGitHubAcceptance(otherwiseValidFacts({ review_head_sha: STALE_HEAD_SHA }))
    ),
    STALE_REVIEW_MESSAGE,
    STALE_REVIEW_MESSAGE
  );
});

test("dismissed-review-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", DISMISSED_REVIEW_MESSAGE);
  assert.equal(
    thrownMessage(() =>
      deriver.deriveGitHubAcceptance(otherwiseValidFacts({ review_state: "DISMISSED" }))
    ),
    DISMISSED_REVIEW_MESSAGE,
    DISMISSED_REVIEW_MESSAGE
  );
});

test("wrong-target-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", WRONG_TARGET_MESSAGE);
  assert.equal(
    thrownMessage(() => deriver.deriveGitHubAcceptance(otherwiseValidFacts({ target_branch: "main" }))),
    WRONG_TARGET_MESSAGE,
    WRONG_TARGET_MESSAGE
  );
});

test("github-outage-fails-closed", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", GITHUB_OUTAGE_MESSAGE);
  assert.equal(
    thrownMessage(() => deriver.deriveGitHubAcceptance(otherwiseValidFacts({ github_outage: true }))),
    GITHUB_OUTAGE_MESSAGE,
    GITHUB_OUTAGE_MESSAGE
  );
});

test("reviewer-permission-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", REVIEWER_PERMISSION_MESSAGE);
  assert.equal(
    thrownMessage(() =>
      deriver.deriveGitHubAcceptance(otherwiseValidFacts({ reviewer_permission: "read" }))
    ),
    REVIEWER_PERMISSION_MESSAGE,
    REVIEWER_PERMISSION_MESSAGE
  );
});

test("duplicate-gate-facts-are-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", DUPLICATE_FACTS_MESSAGE);
  assert.equal(
    thrownMessage(() =>
      deriver.deriveGitHubAcceptance(
        otherwiseValidFacts({
          body: `Gate-Batch: ${BATCH_ID}\nGate-Batch: ${BATCH_ID}\n`
        })
      )
    ),
    DUPLICATE_FACTS_MESSAGE,
    DUPLICATE_FACTS_MESSAGE
  );
});

test("ambiguous-principal-is-rejected", async () => {
  const deriver = await loadDeriver();
  assert.equal(typeof deriver.deriveGitHubAcceptance, "function", AMBIGUOUS_PRINCIPAL_MESSAGE);
  assert.equal(
    thrownMessage(() =>
      deriver.deriveGitHubAcceptance(otherwiseValidFacts({ author_id: "local-owner-role" }))
    ),
    AMBIGUOUS_PRINCIPAL_MESSAGE,
    AMBIGUOUS_PRINCIPAL_MESSAGE
  );
});
