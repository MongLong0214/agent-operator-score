import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resolverPath = resolve(root, "scripts/resolve-execution-state.mjs");
const baselineFactsPath = resolve(root, "fixtures/operational-state/current-baseline/facts.json");

const loadBaselineFacts = () => JSON.parse(readFileSync(baselineFactsPath, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

const CANONICAL_EXCLUDE = new Set(["current_head", "resolved_at", "runtime"]);

const stripRuntime = (value) => {
  if (Array.isArray(value)) return value.map(stripRuntime);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (CANONICAL_EXCLUDE.has(key)) continue;
      out[key] = stripRuntime(value[key]);
    }
    return out;
  }
  return value;
};

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const importResolver = async () => import(pathToFileURL(resolverPath).href);

const resolveOffline = async (facts, options = {}) => {
  const { resolveExecutionState, canonicalExecutionState } = await importResolver();
  const result = resolveExecutionState({
    mode: "offline",
    root,
    facts,
    runtimeIdentity: {
      repository: facts.repository,
      branch: facts.defaultBranch,
      head: facts.currentHead
    },
    ...options
  });
  return { result, canonicalExecutionState, resolveExecutionState };
};

const ticketState = (result, id) => {
  assert.ok(result.tickets?.[id], `missing ticket state ${id}`);
  return result.tickets[id];
};

const blockerCodes = (state) => (state.blockers ?? []).map((b) => b.code);

// ---------------------------------------------------------------------------
// RED staging contract: resolver module must exist for GREEN; named cases follow.
// ---------------------------------------------------------------------------

test("current-baseline-state", async () => {
  const facts = loadBaselineFacts();
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  const d0002 = ticketState(result, "D0-002");
  assert.equal(d0001.phase, "verified");
  assert.equal(d0001.readiness, "terminal");
  assert.equal(d0002.phase, "gate_preparation");
  assert.equal(d0002.readiness, "blocked");
  assert.deepEqual(result.readySet, []);
});

test("current-head-is-runtime-derived", async () => {
  const facts = loadBaselineFacts();
  const headA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const headB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  facts.currentHead = headA;
  const { result: first, resolveExecutionState } = await resolveOffline(facts);
  assert.equal(first.current_head, headA);
  const second = resolveExecutionState({
    mode: "offline",
    root,
    facts,
    runtimeIdentity: {
      repository: facts.repository,
      branch: facts.defaultBranch,
      head: headB
    }
  });
  assert.equal(second.current_head, headB);
  assert.notEqual(first.current_head, second.current_head);
});

test("closed-issue-is-not-verification", async () => {
  const facts = loadBaselineFacts();
  // D0-002 has a closed issue but no gate acceptance / post-merge CI.
  facts.issues = [
    ...(facts.issues ?? []),
    {
      number: 999,
      ticket_id: "D0-002",
      state: "closed",
      labels: ["status:done"]
    }
  ];
  // Ensure D0-002 is not in verifiedTickets via issue alone.
  facts.verifiedTickets = ["D0-001"];
  const { result } = await resolveOffline(facts);
  const d0002 = ticketState(result, "D0-002");
  assert.notEqual(d0002.phase, "verified");
  assert.notEqual(d0002.readiness, "terminal");
});

test("post-merge-ci-required", async () => {
  const facts = loadBaselineFacts();
  facts.postMergeCI = [];
  facts.verifiedTickets = [];
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.ok(blockerCodes(d0001).includes("POST_MERGE_CI_MISSING"));
});

test("stale-digest-removes-readiness", async () => {
  const facts = loadBaselineFacts();
  // Make D0-004 nearly ready then stale its ticket digest.
  facts.gateBatches.push({
    id: "batch-d0-004-ready",
    status: "ACCEPTED",
    required_artifacts: [
      {
        path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
        sha256: "6666666666666666666666666666666666666666666666666666666666666666",
        kind: "TICKET"
      },
      {
        path: "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        kind: "PRD"
      },
      {
        path: "docs/adr/ADR-0001-canonical-identity.md",
        sha256: "3333333333333333333333333333333333333333333333333333333333333333",
        kind: "ADR"
      }
    ]
  });
  facts.gatePRs.push({
    number: 101,
    base: "dev",
    head_sha: "dddddddddddddddddddddddddddddddddddddddd",
    body: "Gate-Batch: batch-d0-004-ready",
    merged: true,
    merged_by: "MongLong0214",
    merge_commit_sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    author: "MongLong0214",
    head_contains_batch: true
  });
  facts.postMergeCI.push({
    merge_commit_sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    status: "completed",
    conclusion: "success",
    head_sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  });
  // D0-002 still blocks dependency; force verified for dependency path in mutant.
  facts.verifiedTickets = ["D0-001", "D0-002"];
  facts.tickets["D0-002"].gate_accepted = true;
  // Stale live digest for D0-004 ticket.
  facts.liveDigests["docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"] =
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.notEqual(d0004.readiness, "ready");
  assert.ok(blockerCodes(d0004).includes("STALE_DIGEST"));
  assert.equal(result.readySet.includes("D0-004"), false);
});

test("ownership-overlap-fails-closed", async () => {
  const facts = loadBaselineFacts();
  facts.verifiedTickets = ["D0-001", "D0-002"];
  facts.activeOwnership = [
    {
      ticket_id: "D0-004",
      paths: ["scripts/resolve-execution-state.mjs"],
      symbols: ["resolveExecutionState"]
    },
    {
      ticket_id: "E0A-001",
      paths: ["scripts/resolve-execution-state.mjs"],
      symbols: ["other"]
    }
  ];
  // Accept gates for D0-004 so ownership is the deciding blocker.
  facts.gateBatches.push({
    id: "batch-d0-004-own",
    status: "ACCEPTED",
    required_artifacts: [
      {
        path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
        sha256: "6666666666666666666666666666666666666666666666666666666666666666",
        kind: "TICKET"
      },
      {
        path: "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        kind: "PRD"
      },
      {
        path: "docs/adr/ADR-0001-canonical-identity.md",
        sha256: "3333333333333333333333333333333333333333333333333333333333333333",
        kind: "ADR"
      }
    ]
  });
  facts.gatePRs.push({
    number: 102,
    base: "dev",
    head_sha: "ffffffffffffffffffffffffffffffffffffffff",
    body: "Gate-Batch: batch-d0-004-own",
    merged: true,
    merged_by: "MongLong0214",
    merge_commit_sha: "1111111111111111111111111111111111111111",
    author: "MongLong0214",
    head_contains_batch: true
  });
  facts.postMergeCI.push({
    merge_commit_sha: "1111111111111111111111111111111111111111",
    status: "completed",
    conclusion: "success",
    head_sha: "1111111111111111111111111111111111111111"
  });
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.equal(d0004.readiness, "blocked");
  assert.ok(blockerCodes(d0004).includes("OWNERSHIP_OVERLAP"));
  assert.equal(result.readySet.includes("D0-004"), false);
});

test("external-unavailable-yields-unknown", async () => {
  const facts = loadBaselineFacts();
  facts.externalAvailable = false;
  const { result } = await resolveOffline(facts);
  assert.deepEqual(result.readySet, []);
  const anyUnknown = Object.values(result.tickets).some((t) => t.readiness === "unknown");
  assert.equal(anyUnknown, true);
  const codes = Object.values(result.tickets).flatMap((t) => blockerCodes(t));
  assert.ok(codes.includes("EXTERNAL_STATE_UNAVAILABLE"));
});

test("wrong-repository-or-branch-fails-closed", async () => {
  const facts = loadBaselineFacts();
  const { resolveExecutionState } = await importResolver();
  const wrongRepo = resolveExecutionState({
    mode: "offline",
    root,
    facts,
    runtimeIdentity: {
      repository: "other/agent-operator-score",
      branch: "dev",
      head: facts.currentHead
    }
  });
  assert.ok(
    Object.values(wrongRepo.tickets).every((t) => blockerCodes(t).includes("WRONG_TARGET")) ||
      wrongRepo.errors?.some((e) => e.code === "WRONG_TARGET")
  );
  assert.deepEqual(wrongRepo.readySet, []);

  const wrongBranch = resolveExecutionState({
    mode: "offline",
    root,
    facts,
    runtimeIdentity: {
      repository: facts.repository,
      branch: "main",
      head: facts.currentHead
    }
  });
  assert.ok(
    Object.values(wrongBranch.tickets).every((t) => blockerCodes(t).includes("WRONG_TARGET")) ||
      wrongBranch.errors?.some((e) => e.code === "WRONG_TARGET")
  );
  assert.deepEqual(wrongBranch.readySet, []);
});

test("roadmap-is-not-an-input", async () => {
  const facts = loadBaselineFacts();
  const baseline = clone(facts);
  facts.projectionSurfaces = {
    ...facts.projectionSurfaces,
    roadmap: "TOTALLY DIFFERENT ROADMAP CLAIMING D0-002 READY"
  };
  const { result: a, canonicalExecutionState } = await resolveOffline(baseline);
  const { result: b } = await resolveOffline(facts);
  assert.equal(
    stableJson(canonicalExecutionState(a)),
    stableJson(canonicalExecutionState(b))
  );
});

test("board-is-not-an-input", async () => {
  const facts = loadBaselineFacts();
  const baseline = clone(facts);
  facts.projectionSurfaces = {
    ...facts.projectionSurfaces,
    board: "BOARD SAYS EVERYTHING VERIFIED"
  };
  const { result: a, canonicalExecutionState } = await resolveOffline(baseline);
  const { result: b } = await resolveOffline(facts);
  assert.equal(
    stableJson(canonicalExecutionState(a)),
    stableJson(canonicalExecutionState(b))
  );
});

test("issue-label-is-not-an-input", async () => {
  const facts = loadBaselineFacts();
  const baseline = clone(facts);
  facts.issues = facts.issues.map((issue) => ({
    ...issue,
    labels: [...(issue.labels ?? []), "status:ready", "status:verified"]
  }));
  const { result: a, canonicalExecutionState } = await resolveOffline(baseline);
  const { result: b } = await resolveOffline(facts);
  assert.equal(
    stableJson(canonicalExecutionState(a)),
    stableJson(canonicalExecutionState(b))
  );
});

test("historical-ledger-is-ignored", async () => {
  const facts = loadBaselineFacts();
  const baseline = clone(facts);
  facts.projectionSurfaces = {
    ...facts.projectionSurfaces,
    ledger: "ledger claims D0-004 verified at deadbeef"
  };
  const { result: a, canonicalExecutionState } = await resolveOffline(baseline);
  const { result: b } = await resolveOffline(facts);
  assert.equal(
    stableJson(canonicalExecutionState(a)),
    stableJson(canonicalExecutionState(b))
  );
});

test("canonical-json-is-byte-identical", async () => {
  const facts = loadBaselineFacts();
  const { result: a, canonicalExecutionState, resolveExecutionState } = await resolveOffline(facts);
  const b = resolveExecutionState({
    mode: "offline",
    root,
    facts: clone(facts),
    runtimeIdentity: {
      repository: facts.repository,
      branch: facts.defaultBranch,
      head: "cccccccccccccccccccccccccccccccccccccccc"
    },
    now: "2099-01-01T00:00:00.000Z"
  });
  assert.notEqual(a.current_head, b.current_head);
  assert.notEqual(a.resolved_at, b.resolved_at);
  assert.equal(
    stableJson(canonicalExecutionState(a)),
    stableJson(canonicalExecutionState(b))
  );
});

test("generated-views-are-deterministic", async () => {
  // Resolver-only: projection file content is ignored; state remains deterministic.
  const facts = loadBaselineFacts();
  facts.projectionSurfaces = {
    roadmap: "view-a",
    board: "view-a",
    ledger: "view-a",
    rendered: "hash-a"
  };
  const { result: a, canonicalExecutionState } = await resolveOffline(facts);
  facts.projectionSurfaces = {
    roadmap: "view-b",
    board: "view-b",
    ledger: "view-b",
    rendered: "hash-b"
  };
  const { result: b } = await resolveOffline(facts);
  assert.equal(
    stableJson(canonicalExecutionState(a)),
    stableJson(canonicalExecutionState(b))
  );
});

test("projection-drift-does-not-change-state", async () => {
  const facts = loadBaselineFacts();
  const { result: a, canonicalExecutionState } = await resolveOffline(facts);
  facts.projectionSurfaces = { drift: true, board: "drifted", roadmap: "drifted" };
  const { result: b } = await resolveOffline(facts);
  assert.equal(
    stableJson(canonicalExecutionState(a)),
    stableJson(canonicalExecutionState(b))
  );
  assert.deepEqual(a.readySet, b.readySet);
});

test("exact-base-packet-requires-ready", async () => {
  const facts = loadBaselineFacts();
  const { result } = await resolveOffline(facts);
  const d0002 = ticketState(result, "D0-002");
  assert.notEqual(d0002.readiness, "ready");
  assert.equal(d0002.packet, null);

  // Build a ready ticket surface for D0-004.
  const readyFacts = makeReadyD0004Facts(facts);
  const { result: ready } = await resolveOffline(readyFacts);
  assert.ok(ready.readySet.includes("D0-004"));
  const packet = ticketState(ready, "D0-004").packet;
  assert.ok(packet);
  assert.ok(packet.base);
  assert.ok(packet.authority_digests);
  assert.ok(Array.isArray(packet.owned_paths));
  assert.ok(Array.isArray(packet.owned_symbols));
  assert.ok(packet.red_command);
});

test("registry-string-is-not-gate-acceptance", async () => {
  const facts = loadBaselineFacts();
  // Only registry strings claim D0-002 accepted; no gate PR facts.
  facts.registryStrings = {
    prepared_by: "MongLong0214",
    approved_by: "MongLong0214",
    status: "ACCEPTED",
    ticket: "D0-002"
  };
  facts.gateBatches = facts.gateBatches.filter((b) => b.id === "batch-d0-001");
  const { result } = await resolveOffline(facts);
  const d0002 = ticketState(result, "D0-002");
  assert.notEqual(d0002.phase, "verified");
  assert.ok(
    blockerCodes(d0002).some((c) =>
      ["TICKET_GATE_MISSING", "ADR_GATE_MISSING", "PRD_GATE_MISSING", "MILESTONE_GATE_BLOCKED"].includes(c)
    )
  );
});

test("actor-policy-missing-or-malformed", async () => {
  const facts = loadBaselineFacts();
  delete facts.operationalAuthority;
  const { result } = await resolveOffline(facts);
  assert.deepEqual(result.readySet, []);
  const codes = Object.values(result.tickets).flatMap((t) => blockerCodes(t));
  assert.ok(codes.includes("TICKET_CONTRACT_CONFLICT"));
});

test("gate-pr-wrong-or-no-longer-owner-actor", async () => {
  const facts = loadBaselineFacts();
  facts.gatePRs = facts.gatePRs.map((pr) => ({ ...pr, merged_by: "not-the-owner" }));
  facts.verifiedTickets = [];
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.ok(
    blockerCodes(d0001).some((c) =>
      ["TICKET_GATE_MISSING", "ADR_GATE_MISSING", "PRD_GATE_MISSING"].includes(c)
    )
  );
});

test("gate-pr-stale-head-or-digest", async () => {
  const facts = loadBaselineFacts();
  facts.gateBatches = facts.gateBatches.map((batch) => ({
    ...batch,
    required_artifacts: batch.required_artifacts.map((a) =>
      a.kind === "TICKET"
        ? { ...a, sha256: "9999999999999999999999999999999999999999999999999999999999999999" }
        : a
    )
  }));
  facts.verifiedTickets = [];
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.ok(
    blockerCodes(d0001).some((c) =>
      ["STALE_DIGEST", "TICKET_GATE_MISSING", "ADR_GATE_MISSING", "PRD_GATE_MISSING"].includes(c)
    )
  );
});

test("gate-pr-post-merge-ci-required", async () => {
  const facts = loadBaselineFacts();
  facts.postMergeCI = [
    {
      merge_commit_sha: "cccccccccccccccccccccccccccccccccccccccc",
      status: "completed",
      conclusion: "failure",
      head_sha: "cccccccccccccccccccccccccccccccccccccccc"
    }
  ];
  facts.verifiedTickets = [];
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.ok(
    blockerCodes(d0001).some((c) =>
      ["POST_MERGE_CI_FAILED", "POST_MERGE_CI_MISSING"].includes(c)
    )
  );
});

test("review-and-authorization-are-distinct", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: false,
    ci: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"));
  assert.equal(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"), false);
});

test("current-review-without-authorization-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: false,
    ci: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(["blocked", "active"].includes(state.readiness));
  assert.ok(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"));
  assert.equal(result.readySet.includes("D0-004"), false);
});

test("single-owner-spoof-is-not-authorization", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: false,
    ci: true
  });
  facts.registryStrings = {
    prepared_by: "MongLong0214",
    approved_by: "MongLong0214",
    authorization: "CEO production PASS"
  };
  facts.authorizations = [
    {
      ticket_id: "D0-004",
      kind: "self_authored_string",
      actor: "MongLong0214",
      commit_id: facts.prs[0].head_sha,
      text: "CEO production PASS"
    }
  ];
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"));
});

test("single-owner-sequential-review-and-authorization", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true
  });
  // Same owner may review and authorize sequentially.
  assert.equal(facts.reviews[0].reviewer, "MongLong0214");
  assert.equal(facts.authorizations[0].actor, "MongLong0214");
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"), false);
  assert.equal(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"), false);
  assert.equal(blockerCodes(state).includes("EXACT_HEAD_CI_FAILED"), false);
});

test("candidate-controlled-or-non-ancestor-review-workflow-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  // Workflow commit not reachable from live dev.
  facts.reviews = facts.reviews.map((r) => ({
    ...r,
    workflow_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    workflow_reachable_from_dev: false
  }));
  facts.checkRuns = (facts.checkRuns ?? []).map((c) =>
    c.name === "exact-head-review"
      ? { ...c, workflow_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", workflow_reachable_from_dev: false }
      : c
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"));
});

test("wrong-workflow-blob-or-run-provenance-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  facts.workflowBlobs[".github/workflows/operational-state.yml"].heads = {
    [facts.prs[0].head_sha]: "candidate-controlled-blob"
  };
  facts.checkRuns = (facts.checkRuns ?? []).map((c) => ({
    ...c,
    workflow_blob_oid: "candidate-controlled-blob",
    event: "pull_request"
  }));
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(
    blockerCodes(state).some((c) =>
      ["CUMULATIVE_REVIEW_MISSING", "MERGE_AUTHORIZATION_MISSING"].includes(c)
    )
  );
});

test("wrong-check-creator-or-external-id-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  facts.checkRuns = (facts.checkRuns ?? []).map((c) => ({
    ...c,
    app_slug: "not-github-actions",
    external_id: "forged:1:1"
  }));
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(
    blockerCodes(state).some((c) =>
      ["CUMULATIVE_REVIEW_MISSING", "MERGE_AUTHORIZATION_MISSING"].includes(c)
    )
  );
});

test("wrong-dispatch-permission-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  facts.permissions = { MongLong0214: "read", attacker: "admin" };
  facts.checkRuns = (facts.checkRuns ?? []).map((c) => ({
    ...c,
    dispatch_actor: "MongLong0214"
  }));
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(
    blockerCodes(state).some((c) =>
      ["CUMULATIVE_REVIEW_MISSING", "MERGE_AUTHORIZATION_MISSING"].includes(c)
    )
  );
});

test("authorization-without-current-review-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: true,
    ci: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"));
  assert.ok(
    blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING") ||
      state.readiness !== "ready"
  );
});

test("future-check-premature", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: false
  });
  // Claiming future protected checks as required evidence while bootstrap is active is premature:
  // bootstrap should accept technical-review evidence without requiring the protected check name.
  const withOnlyProtected = clone(facts);
  withOnlyProtected.reviews = [];
  withOnlyProtected.checkRuns = [
    {
      name: "exact-head-review",
      head_sha: facts.prs[0].head_sha,
      status: "completed",
      conclusion: "success",
      app_slug: "github-actions",
      external_id: "aos-exact-head-review:1:1",
      event: "workflow_dispatch",
      workflow_path: ".github/workflows/operational-state.yml",
      workflow_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workflow_reachable_from_dev: true,
      workflow_blob_oid: "ops-blob-dev",
      dispatch_actor: "MongLong0214",
      ticket_id: "D0-004"
    }
  ];
  const { result } = await resolveOffline(withOnlyProtected);
  const state = ticketState(result, "D0-004");
  // Before D0-004C, protected check alone is premature / not a substitute for bootstrap review evidence.
  assert.ok(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"));
});

test("bootstrap-after-c-fails-closed", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  // Bootstrap-style review evidence without protected checks after C merges.
  facts.reviews = facts.reviews.map((r) => ({
    ...r,
    protected_check: null,
    bootstrap_evidence: true
  }));
  facts.authorizations = facts.authorizations.map((a) => ({
    ...a,
    protected_check: null,
    bootstrap_evidence: true
  }));
  facts.checkRuns = (facts.checkRuns ?? []).filter(
    (c) => c.name !== "exact-head-review" && c.name !== "exact-head-authorization"
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(
    blockerCodes(state).some((c) =>
      ["CUMULATIVE_REVIEW_MISSING", "MERGE_AUTHORIZATION_MISSING"].includes(c)
    )
  );
});

test("ready-authorizes-packet-not-red", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  const { result } = await resolveOffline(facts);
  assert.ok(result.readySet.includes("D0-004"));
  const state = ticketState(result, "D0-004");
  assert.equal(state.readiness, "ready");
  assert.ok(state.packet);
  assert.equal(state.red_authorized, false);
  assert.equal(state.requires_maintainer_exact_base_packet, true);
});

test("candidate-ci-required-set-is-exact", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  // Extra checks do not replace a required name; drop one required check.
  facts.checkRuns = (facts.checkRuns ?? []).filter((c) => c.name !== "planning-contract (22)");
  facts.checkRuns.push({
    name: "extra-unrelated-check",
    head_sha: facts.prs[0].head_sha,
    status: "completed",
    conclusion: "success",
    app_slug: "github-actions",
    event: "pull_request",
    workflow_path: ".github/workflows/ci.yml",
    ticket_id: "D0-004"
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("EXACT_HEAD_CI_FAILED"));
});

test("candidate-ci-missing-stale-or-wrong-head-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  facts.checkRuns = (facts.checkRuns ?? []).map((c) =>
    c.name?.startsWith("planning-contract")
      ? { ...c, head_sha: "staleheadstaleheadstaleheadstaleheadstal" }
      : c
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("EXACT_HEAD_CI_FAILED"));
});

test("candidate-ci-wrong-app-event-base-path-or-run-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  facts.checkRuns = (facts.checkRuns ?? []).map((c) =>
    c.name?.startsWith("planning-contract")
      ? { ...c, app_slug: "renovate", event: "push", base: "main" }
      : c
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("EXACT_HEAD_CI_FAILED"));
});

test("candidate-ci-candidate-workflow-differs-from-live-target-is-blocked", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  facts.workflowBlobs[".github/workflows/ci.yml"].heads = {
    [facts.prs[0].head_sha]: "different-ci-blob"
  };
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("EXACT_HEAD_CI_FAILED"));
});

test("candidate-ci-latest-failed-attempt-overrides-older-pass", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  const head = facts.prs[0].head_sha;
  const runMeta = {
    head_sha: head,
    app_slug: "github-actions",
    app_id: 15368,
    event: "pull_request",
    base: "dev",
    workflow_path: ".github/workflows/ci.yml"
  };
  facts.workflowRuns = [
    ...(facts.workflowRuns ?? []).filter((r) => r.name !== "planning-contract (20)"),
    {
      name: "planning-contract (20)",
      run_id: 1,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
      ...runMeta
    },
    {
      name: "planning-contract (20)",
      run_id: 1,
      run_attempt: 2,
      status: "completed",
      conclusion: "failure",
      ...runMeta
    }
  ];
  facts.checkRuns = (facts.checkRuns ?? []).map((c) =>
    c.name === "planning-contract (20)"
      ? { ...c, conclusion: "failure", run_id: 1, run_attempt: 2 }
      : c
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("EXACT_HEAD_CI_FAILED"));
});

// ---------------------------------------------------------------------------
// Review regressions — fail-closed contract defects (PR #150 exact-head review)
// ---------------------------------------------------------------------------

test("duplicate-candidate-order-independent-active-and-superseded", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: false
  });
  const head149 = "1111111111111111111111111111111111111111";
  const head150 = "cafecafecafecafecafecafecafecafecafecafe";
  const liveBase = facts.liveBaseSha;
  // Two live open Ticket candidates without structured supersession must block
  // (PR number is not supersession authority).
  const pr149Live = {
    number: 149,
    base: "dev",
    base_sha: liveBase,
    head_sha: head149,
    author: "MongLong0214",
    body: "Ticket: D0-004\n\nDuplicate evidence only.",
    merged: false
  };
  const pr150Live = {
    number: 150,
    base: "dev",
    base_sha: liveBase,
    head_sha: head150,
    author: "MongLong0214",
    body: "Ticket: D0-004\n\nPacket-bound candidate.",
    merged: false
  };
  facts.prs = [pr149Live, pr150Live];
  const { result: ambiguous } = await resolveOffline(facts);
  const ambiguousState = ticketState(ambiguous, "D0-004");
  assert.equal(ambiguousState.candidate, null);
  assert.ok(blockerCodes(ambiguousState).includes("TICKET_CONTRACT_CONFLICT"));

  // Explicit structured supersession authorizes reporting superseded heads.
  const pr149 = {
    ...pr149Live,
    superseded: true,
    superseded_by: 150,
    body: "Ticket: D0-004\nSuperseded-By: 150"
  };
  const pr150 = {
    ...pr150Live,
    supersedes: 149,
    body: "Ticket: D0-004\nSupersedes: 149"
  };
  const ticketIdOnly = {
    number: 148,
    ticket_id: "D0-004",
    base: "dev",
    base_sha: liveBase,
    head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    author: "MongLong0214",
    body: "Related to #57 — no structured Ticket field",
    merged: false
  };
  const wrongBase = {
    number: 151,
    base: "main",
    base_sha: liveBase,
    head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    author: "MongLong0214",
    body: "Ticket: D0-004",
    merged: false
  };

  facts.workflowBlobs[".github/workflows/ci.yml"].heads[head150] = "ci-blob-dev";
  facts.workflowBlobs[".github/workflows/operational-state.yml"].heads[head150] = "ops-blob-dev";
  facts.checkRuns = (facts.checkRuns ?? []).map((c) => ({ ...c, head_sha: head150 }));
  facts.workflowRuns = (facts.workflowRuns ?? []).map((r) => ({ ...r, head_sha: head150 }));
  facts.reviews = (facts.reviews ?? []).map((r) => ({ ...r, commit_id: head150 }));
  facts.authorizations = (facts.authorizations ?? []).map((a) => ({ ...a, commit_id: head150 }));

  for (const order of [
    [pr149, pr150, ticketIdOnly, wrongBase],
    [wrongBase, pr150, ticketIdOnly, pr149]
  ]) {
    facts.prs = order;
    const { result } = await resolveOffline(facts);
    const state = ticketState(result, "D0-004");
    assert.equal(state.candidate?.number, 150);
    assert.equal(state.candidate?.head_sha, head150);
    assert.deepEqual(
      (state.candidate?.superseded_heads ?? []).map((entry) => entry.number),
      [149]
    );
    assert.notEqual(state.candidate.head_sha, head149);
  }

  facts.prs = [
    {
      number: 152,
      base: "dev",
      base_sha: liveBase,
      head_sha: head150,
      body: "Ticket: D0-004\nTicket: D0-004",
      merged: false
    }
  ];
  const { result: multi } = await resolveOffline(facts);
  assert.equal(ticketState(multi, "D0-004").candidate, null);
});

test("missing-live-authority-digests-fail-closed", async () => {
  const facts = loadBaselineFacts();
  delete facts.liveDigests["docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"];
  const { result: withoutPrd } = await resolveOffline(facts);
  const d0001a = ticketState(withoutPrd, "D0-001");
  assert.notEqual(d0001a.phase, "verified");
  assert.notEqual(d0001a.readiness, "terminal");
  assert.ok(
    blockerCodes(d0001a).some((code) =>
      ["PRD_GATE_MISSING", "ADR_GATE_MISSING", "TICKET_GATE_MISSING", "STALE_DIGEST"].includes(code)
    )
  );

  const factsAdr = loadBaselineFacts();
  delete factsAdr.liveDigests["docs/adr/ADR-0001-canonical-identity.md"];
  const { result: withoutAdr } = await resolveOffline(factsAdr);
  const d0001b = ticketState(withoutAdr, "D0-001");
  assert.notEqual(d0001b.phase, "verified");
  assert.notEqual(d0001b.readiness, "terminal");
  assert.ok(
    blockerCodes(d0001b).some((code) =>
      ["ADR_GATE_MISSING", "PRD_GATE_MISSING", "TICKET_GATE_MISSING", "STALE_DIGEST"].includes(code)
    )
  );

  const factsTicket = loadBaselineFacts();
  delete factsTicket.liveDigests["docs/tickets/D0/D0-001-canonical-identifier-registry.md"];
  const { result: withoutTicket } = await resolveOffline(factsTicket);
  const d0001c = ticketState(withoutTicket, "D0-001");
  assert.notEqual(d0001c.phase, "verified");
  assert.notEqual(d0001c.readiness, "terminal");
});

test("post-merge-latest-failed-attempt-controls-status", async () => {
  const facts = loadBaselineFacts();
  const mergeSha = facts.gatePRs[0].merge_commit_sha;
  facts.postMergeCI = [
    {
      merge_commit_sha: mergeSha,
      status: "completed",
      conclusion: "success",
      head_sha: mergeSha,
      run_id: 10,
      run_attempt: 1
    },
    {
      merge_commit_sha: mergeSha,
      status: "completed",
      conclusion: "failure",
      head_sha: mergeSha,
      run_id: 10,
      run_attempt: 2
    }
  ];
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.notEqual(d0001.readiness, "terminal");
  assert.ok(blockerCodes(d0001).includes("POST_MERGE_CI_FAILED"));
});

test("candidate-ci-missing-provenance-fields-fail-closed", async () => {
  const base = () =>
    makeCandidateFacts(loadBaselineFacts(), {
      review: true,
      authorization: true,
      ci: true,
      d0_004c_merged: true
    });

  const missingDevBlob = base();
  delete missingDevBlob.workflowBlobs[".github/workflows/ci.yml"].dev;
  {
    const { result } = await resolveOffline(missingDevBlob);
    assert.ok(blockerCodes(ticketState(result, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  }

  const missingHeadBlob = base();
  missingHeadBlob.workflowBlobs[".github/workflows/ci.yml"].heads = {};
  {
    const { result } = await resolveOffline(missingHeadBlob);
    assert.ok(blockerCodes(ticketState(result, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  }

  const missingApp = base();
  missingApp.checkRuns = (missingApp.checkRuns ?? []).map((c) => {
    if (!String(c.name).startsWith("planning-contract")) return c;
    const next = { ...c };
    delete next.app_slug;
    delete next.app_id;
    return next;
  });
  {
    const { result } = await resolveOffline(missingApp);
    assert.ok(blockerCodes(ticketState(result, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  }

  const missingEventBasePath = base();
  missingEventBasePath.checkRuns = (missingEventBasePath.checkRuns ?? []).map((c) => {
    if (!String(c.name).startsWith("planning-contract")) return c;
    const next = { ...c };
    delete next.event;
    delete next.base;
    delete next.workflow_path;
    return next;
  });
  {
    const { result } = await resolveOffline(missingEventBasePath);
    assert.ok(blockerCodes(ticketState(result, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  }
});

// ---------------------------------------------------------------------------
// Review regressions — round 2 fail-closed defects
// ---------------------------------------------------------------------------

test("multiple-live-ticket-candidates-require-structured-supersession", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: false
  });
  const headA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const headB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const liveBase = facts.liveBaseSha;
  facts.prs = [
    {
      number: 149,
      base: "dev",
      base_sha: liveBase,
      head_sha: headA,
      body: "Ticket: D0-004",
      merged: false
    },
    {
      number: 150,
      base: "dev",
      base_sha: liveBase,
      head_sha: headB,
      body: "Ticket: D0-004",
      merged: false
    }
  ];
  // Larger PR number must not silently win.
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(state.candidate, null);
  assert.ok(blockerCodes(state).includes("TICKET_CONTRACT_CONFLICT"));
  assert.notEqual(state.readiness, "active");
});

test("gate-batch-requires-exactly-one-structured-field", async () => {
  const facts = loadBaselineFacts();
  facts.gatePRs = facts.gatePRs.map((pr) => ({
    ...pr,
    body: `${pr.body}\nGate-Batch: batch-d0-001-extra`
  }));
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.notEqual(d0001.readiness, "terminal");
  assert.ok(blockerCodes(d0001).includes("TICKET_GATE_MISSING"));
});

test("candidate-ci-requires-run-attempt-mapping-and-live-base-sha", async () => {
  const base = () =>
    makeCandidateFacts(loadBaselineFacts(), {
      review: true,
      authorization: true,
      ci: true,
      d0_004c_merged: true
    });

  // Checks without run_id/run_attempt (and no workflow runs) fail closed.
  const noRunIds = base();
  noRunIds.workflowRuns = [];
  noRunIds.checkRuns = (noRunIds.checkRuns ?? []).map((c) => {
    const next = { ...c };
    delete next.run_id;
    delete next.run_attempt;
    return next;
  });
  {
    const { result } = await resolveOffline(noRunIds);
    assert.ok(blockerCodes(ticketState(result, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  }

  // Workflow runs alone without mapped check/job facts fail closed.
  const runsOnly = base();
  runsOnly.checkRuns = (runsOnly.checkRuns ?? []).filter((c) => !String(c.name).startsWith("planning-contract") && c.name !== "operational-state-offline");
  {
    const { result } = await resolveOffline(runsOnly);
    assert.ok(blockerCodes(ticketState(result, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  }

  // Stale candidate base_sha fails closed.
  const staleBase = base();
  staleBase.prs = staleBase.prs.map((pr) => ({
    ...pr,
    base_sha: "dddddddddddddddddddddddddddddddddddddddd"
  }));
  {
    const { result } = await resolveOffline(staleBase);
    assert.ok(blockerCodes(ticketState(result, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  }
});

test("facts-corpus-and-output-schema-validation-fail-closed", async () => {
  const { runOfflineCheck, validateAgainstSchema, loadExecutionStateSchema, resolveExecutionState } =
    await importResolver();

  const schemaLoad = loadExecutionStateSchema(root);
  assert.equal(schemaLoad.ok, true);
  assert.ok(schemaLoad.schema);

  const malformed = runOfflineCheck({
    facts: {
      ...loadBaselineFacts(),
      tickets: null
    }
  });
  assert.equal(malformed.ok, false);
  assert.ok(malformed.failures.length > 0);

  const missingExternal = runOfflineCheck({
    facts: {
      ...loadBaselineFacts(),
      externalAvailable: undefined
    }
  });
  assert.equal(missingExternal.ok, false);

  const emptyTickets = runOfflineCheck({
    facts: {
      ...loadBaselineFacts(),
      tickets: {}
    }
  });
  assert.equal(emptyTickets.ok, false);

  const good = await resolveOffline(loadBaselineFacts());
  const schemaErrors = validateAgainstSchema(good.result, schemaLoad.schema);
  assert.deepEqual(schemaErrors, []);

  // Direct schema-use: deliberately invalid output fails schema validation.
  const invalidOutput = { schema_version: 2 };
  assert.ok(validateAgainstSchema(invalidOutput, schemaLoad.schema).length > 0);

  // resolveExecutionState surfaces schema/corpus failures as contract blockers.
  const broken = resolveExecutionState({
    mode: "offline",
    root,
    facts: { tickets: null }
  });
  assert.ok(broken.errors.some((entry) => entry.code === "TICKET_CONTRACT_INCOMPLETE"));
});

test("live-adapter-fixture-e2e-collects-and-resolves", async () => {
  const {
    createFixtureTransport,
    collectLiveExecutionFacts,
    acquireOnlineStrictFacts,
    resolveExecutionState
  } = await importResolver();
  const responsesPath = resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json");
  assert.equal(existsSync(responsesPath), true);
  const responses = JSON.parse(readFileSync(responsesPath, "utf8"));
  const transport = createFixtureTransport(responses);

  const collected = collectLiveExecutionFacts(root, { transport });
  assert.equal(collected.ok, true, collected.reason);
  assert.equal(collected.facts.externalAvailable, true);
  assert.equal(collected.facts.collector.write_actions, 0);
  assert.equal(collected.facts.collector.transport, "fixture-authenticated");
  assert.ok(Object.keys(collected.facts.tickets).length >= 1);
  assert.ok(Array.isArray(collected.facts.gatePRs));
  assert.ok(Array.isArray(collected.facts.prs));
  assert.ok(collected.facts.liveBaseSha);

  const acquired = acquireOnlineStrictFacts(root, { transport });
  assert.equal(acquired.ok, true);

  const result = resolveExecutionState({
    mode: "online-strict",
    root,
    facts: acquired.facts,
    runtimeIdentity: {
      repository: acquired.facts.repository,
      branch: acquired.facts.defaultBranch,
      head: acquired.facts.currentHead
    }
  });
  assert.equal(result.mode, "online-strict");
  assert.ok(!result.errors.some((entry) => entry.code === "EXTERNAL_STATE_UNAVAILABLE"));
  // Schema-valid output for the live-adapter path.
  const { loadExecutionStateSchema, validateAgainstSchema } = await importResolver();
  const schemaLoad = loadExecutionStateSchema(root);
  assert.deepEqual(validateAgainstSchema(result, schemaLoad.schema), []);
});

test("live-adapter-outage-partial-ambiguous-fail-closed", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts, resolveExecutionState } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const repoPath = "repos/MongLong0214/agent-operator-score";

  // Total outage on repository probe.
  {
    const responses = { ...base, [repoPath]: null };
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(collected.ok, false);
    assert.match(collected.reason, /unavailable|outage/i);
  }

  // Partial: repo works, tip ref missing.
  {
    const responses = { ...base };
    delete responses[`${repoPath}/git/ref/heads/dev`];
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(collected.ok, false);
    assert.match(collected.reason, /unavailable|tip/i);
  }

  // Ambiguous gate PR search (two items for one batch).
  {
    const responses = { ...base };
    const key = Object.keys(responses).find((entry) => entry.startsWith("search/issues?q=") && entry.includes("Gate-Batch"));
    assert.ok(key);
    responses[key] = { items: [{ number: 200 }, { number: 201 }] };
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(collected.ok, false);
    assert.match(collected.reason, /ambiguous/i);
  }

  // Ambiguous transport signal via fixture marker.
  {
    const responses = { ...base, [repoPath]: { __ambiguous: true } };
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(collected.ok, false);
    assert.match(collected.reason, /ambiguous/i);
  }

  // resolveExecutionState without facts still fails closed online (no silent empty corpus).
  const online = resolveExecutionState({ mode: "online-strict", root, facts: null });
  assert.ok(online.errors.some((entry) => entry.code === "EXTERNAL_STATE_UNAVAILABLE"));
});

test("online-strict-exits-nonzero-on-ticket-contract-conflict", async () => {
  const { resolveExecutionState, onlineStrictProcessShouldFail } = await importResolver();
  const facts = loadBaselineFacts();
  // Two open live Ticket candidates without structured supersession → ticket-level conflict.
  facts.prs = [
    {
      number: 149,
      base: "dev",
      base_sha: facts.currentHead,
      head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      author: "MongLong0214",
      body: "Ticket: D0-004",
      merged: false,
      state: "open"
    },
    {
      number: 150,
      base: "dev",
      base_sha: facts.currentHead,
      head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      author: "MongLong0214",
      body: "Ticket: D0-004",
      merged: false,
      state: "open"
    }
  ];
  const result = resolveExecutionState({
    mode: "online-strict",
    root,
    facts,
    runtimeIdentity: {
      repository: facts.repository,
      branch: facts.defaultBranch,
      head: facts.currentHead
    }
  });
  const d0004 = ticketState(result, "D0-004");
  assert.ok(blockerCodes(d0004).includes("TICKET_CONTRACT_CONFLICT"));
  assert.ok(
    result.errors.some((entry) => entry.code === "TICKET_CONTRACT_CONFLICT"),
    "ticket-level contract conflict must surface on the result errors"
  );
  assert.equal(onlineStrictProcessShouldFail(result), true);
});

test("live-collector-does-not-synthesize-check-app-provenance", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const head = "cafecafecafecafecafecafecafecafecafecafe";
  const checkKey = `repos/MongLong0214/agent-operator-score/commits/${head}/check-runs?per_page=50`;
  // Mutant: jobs remain, but check-run app identity is stripped (or check-runs empty).
  const responses = clone(base);
  responses[checkKey] = {
    check_runs: (base[checkKey].check_runs ?? []).map((check) => {
      const copy = { ...check };
      delete copy.app;
      return copy;
    })
  };
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /app provenance|check-run mapping|provenance/i);

  const emptyChecks = clone(base);
  emptyChecks[checkKey] = { check_runs: [] };
  const collectedEmpty = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(emptyChecks)
  });
  assert.equal(collectedEmpty.ok, false);
  assert.match(collectedEmpty.reason, /check-run mapping|app provenance|missing live/i);
});

test("candidate-ci-requires-exact-job-check-name-and-one-to-one-check-consumption", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const repo = "repos/MongLong0214/agent-operator-score";
  const responses = clone(base);
  const jobsKey = `${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`;

  // All three required jobs point to the same check-run. The first name happens
  // to agree, but the remaining two must neither reuse its ID nor accept its name.
  for (const job of responses[jobsKey].jobs) {
    job.check_run_url = "https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/9000";
  }

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /check-run name|already mapped|already consumed|one-to-one/i);

  const reused = clone(base);
  for (const job of reused[jobsKey].jobs) {
    job.name = "planning-contract (20)";
    job.check_run_url = "https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/9000";
  }
  const reusedCollected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(reused) });
  assert.equal(reusedCollected.ok, false);
  assert.match(reusedCollected.reason, /already consumed|one-to-one/i);
});

test("candidate-ci-requires-mapped-job-and-check-terminals-to-agree-and-succeed", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const head = "cafecafecafecafecafecafecafecafecafecafe";
  const repo = "repos/MongLong0214/agent-operator-score";
  const responses = clone(base);
  const checksKey = `${repo}/commits/${head}/check-runs?per_page=50`;

  // The jobs report success, but their exact authenticated check-runs failed.
  // A collector must not discard the failed check terminal fields.
  for (const check of responses[checksKey].check_runs) {
    check.status = "completed";
    check.conclusion = "failure";
  }

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /terminal|conclusion|not successful|mismatch/i);

  const partial = clone(base);
  delete partial[checksKey].check_runs[0].conclusion;
  const partialCollected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(partial) });
  assert.equal(partialCollected.ok, false);
  assert.match(partialCollected.reason, /missing live check-run terminal fields/i);
});

test("optional-operational-workflow-only-allows-authenticated-not-found", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts, resolveExecutionState } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const repo = "repos/MongLong0214/agent-operator-score";
  const tip = "c8937c6c31ef034535f7c2e8276514221a12fd55";
  const path = `${repo}/contents/.github/workflows/operational-state.yml?ref=${tip}`;

  // A real authenticated 404 is the sole allowed pre-C absence signal.
  const absent = clone(base);
  absent[path] = { __not_found: true };
  const absentCollected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(absent) });
  assert.equal(absentCollected.ok, true, absentCollected.reason);

  // A timeout/outage is not absence during either the early lane probe or the
  // later blob collection, so online strict state must be unavailable.
  const unavailable = clone(base);
  unavailable[path] = null;
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(unavailable) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /EXTERNAL_STATE_UNAVAILABLE|unavailable|timeout/i);

  // The same rule applies after early selection, when the workflow-blob
  // collector sees an outage after an authenticated absence probe.
  const fixture = createFixtureTransport(absent);
  let probes = 0;
  const absentThenOutage = {
    kind: "fixture-authenticated",
    getJson(apiPath) {
      if (apiPath === path && ++probes > 1) {
        const error = new Error("workflow blob outage");
        error.code = "FIXTURE_OUTAGE";
        throw error;
      }
      return fixture.getJson(apiPath);
    },
    getRaw(apiPath) {
      return fixture.getRaw(apiPath);
    }
  };
  const laterOutage = collectLiveExecutionFacts(root, { transport: absentThenOutage });
  assert.equal(laterOutage.ok, false);
  assert.match(laterOutage.reason, /EXTERNAL_STATE_UNAVAILABLE|unavailable|timeout/i);

  const state = resolveExecutionState({ mode: "online-strict", root, facts: collected.facts });
  assert.ok(state.errors.some((entry) => entry.code === "EXTERNAL_STATE_UNAVAILABLE"));
  assert.deepEqual(state.readySet, []);
});

test("gate-head-requires-identical-accepted-registry-record", async () => {
  const {
    createFixtureTransport,
    collectLiveExecutionFacts,
    registryHeadBindsAcceptedBatch
  } = await importResolver();
  const batch = {
    id: "batch-d0-004-fixture",
    status: "ACCEPTED",
    required_artifacts: [
      {
        path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
        sha256: "deadbeef",
        kind: "TICKET"
      }
    ]
  };
  // String presence of batch id with PENDING status must not bind.
  const pendingOnly = JSON.stringify({
    version: 2,
    batches: [{ id: "batch-d0-004-fixture", status: "PENDING", required_artifacts: batch.required_artifacts }]
  });
  assert.equal(registryHeadBindsAcceptedBatch(pendingOnly, batch), false);
  // ACCEPTED with incomplete/wrong digests must not bind.
  const wrongDigest = JSON.stringify({
    version: 2,
    batches: [
      {
        id: "batch-d0-004-fixture",
        status: "ACCEPTED",
        required_artifacts: [
          {
            path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            kind: "TICKET"
          }
        ]
      }
    ]
  });
  assert.equal(registryHeadBindsAcceptedBatch(wrongDigest, batch), false);

  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const gateHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const regKey = `raw:repos/MongLong0214/agent-operator-score/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${gateHead}`;
  const responses = clone(base);
  responses[regKey] = pendingOnly;
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /identical ACCEPTED batch|head registry/i);
});

test("live-collector-populates-owned-paths-symbols-and-red-command", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const d0004 = collected.facts.tickets["D0-004"];
  assert.ok(Array.isArray(d0004.owned_paths) && d0004.owned_paths.length > 0);
  assert.ok(d0004.owned_paths.includes("scripts/resolve-execution-state.mjs"));
  assert.ok(Array.isArray(d0004.owned_symbols));
  assert.ok(d0004.owned_symbols.includes("resolveExecutionState"));
  assert.equal(d0004.red_command, "node --test tests/execution-state.test.mjs");
  assert.ok(Array.isArray(collected.facts.activeOwnership));
  assert.ok(
    collected.facts.activeOwnership.some(
      (entry) =>
        entry.ticket_id === "D0-004" &&
        Array.isArray(entry.owned_paths) &&
        entry.owned_paths.includes("scripts/resolve-execution-state.mjs")
    )
  );

  // Ambiguous/missing ownership in ticket body fails closed.
  const broken = clone(responses);
  const tip = "c8937c6c31ef034535f7c2e8276514221a12fd55";
  broken[
    `raw:repos/MongLong0214/agent-operator-score/contents/docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md?ref=${tip}`
  ] = "# D0-004\n\n## Exact ownership\n\n- none declared\n";
  const failed = collectLiveExecutionFacts(root, { transport: createFixtureTransport(broken) });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /ownership|red_command|owned_paths/i);
});

test("live-collector-enforces-per-call-and-total-timeouts", async () => {
  const { createAuthenticatedGitHubTransport, collectLiveExecutionFacts } = await importResolver();
  const execFileSync = () => {
    const error = new Error("gh api timed out");
    error.code = "ETIMEDOUT";
    error.killed = true;
    throw error;
  };
  const transport = createAuthenticatedGitHubTransport(root, {
    execFileSync,
    perCallTimeoutMs: 25,
    totalTimeoutMs: 80
  });
  const collected = collectLiveExecutionFacts(root, {
    transport,
    perCallTimeoutMs: 25,
    totalTimeoutMs: 80
  });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /timeout|EXTERNAL_STATE_UNAVAILABLE|unavailable/i);

  // Total budget exhausted before call.
  let calls = 0;
  const slowTransport = {
    kind: "fixture-authenticated",
    getJson() {
      calls += 1;
      if (calls === 1) {
        // Exhaust total budget on first call path via wall clock sleep beyond budget.
        const end = Date.now() + 30;
        while (Date.now() < end) {
          /* busy wait */
        }
        return {
          owner: { login: "MongLong0214", type: "User" },
          default_branch: "dev"
        };
      }
      const error = new Error("should have been blocked by total timeout");
      error.code = "COLLECTION_TIMEOUT";
      throw error;
    },
    getRaw() {
      const error = new Error("collection total timeout exceeded");
      error.code = "COLLECTION_TIMEOUT";
      throw error;
    }
  };
  const total = collectLiveExecutionFacts(root, {
    transport: slowTransport,
    totalTimeoutMs: 10,
    perCallTimeoutMs: 5
  });
  assert.equal(total.ok, false);
  assert.match(total.reason, /timeout|unavailable/i);
});

test("candidate-ci-latest-failed-attempt-not-masked-by-stale-check-runs", async () => {
  const {
    createFixtureTransport,
    collectLiveExecutionFacts,
    resolveExecutionState
  } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const head = "cafecafecafecafecafecafecafecafecafecafe";
  const repo = "repos/MongLong0214/agent-operator-score";
  const runsKey = `${repo}/actions/runs?head_sha=${head}&event=pull_request&per_page=30`;
  const checksKey = `${repo}/commits/${head}/check-runs?per_page=50`;
  const responses = clone(base);

  // Older successful attempt 1 + newer failed attempt 2 for the same job names.
  responses[runsKey] = {
    workflow_runs: [
      {
        id: 4001,
        name: "CI",
        path: ".github/workflows/ci.yml",
        head_sha: head,
        status: "completed",
        conclusion: "success",
        run_attempt: 1,
        event: "pull_request"
      },
      {
        id: 4002,
        name: "CI",
        path: ".github/workflows/ci.yml",
        head_sha: head,
        status: "completed",
        conclusion: "failure",
        run_attempt: 1,
        event: "pull_request"
      }
    ]
  };
  // Stale successful check-runs (would mask failure if bound only by name).
  responses[checksKey] = {
    check_runs: ["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"].map(
      (name, i) => ({
        id: 9100 + i,
        name,
        status: "completed",
        conclusion: "success",
        app: { id: 15368, slug: "github-actions" },
        run_id: 4001,
        run_attempt: 1
      })
    )
  };
  responses[`${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`] = {
    jobs: ["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"].map(
      (name, i) => ({
        name,
        status: "completed",
        conclusion: "success",
        run_id: 4001,
        run_attempt: 1,
        check_run_url: `https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/${9100 + i}`
      })
    )
  };
  responses[`${repo}/actions/runs/4002/attempts/1/jobs?per_page=50`] = {
    jobs: ["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"].map(
      (name, i) => ({
        name,
        status: "completed",
        conclusion: "failure",
        run_id: 4002,
        run_attempt: 1,
        check_run_url: `https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/${9200 + i}`
      })
    )
  };
  // Failed attempt has its own check-runs (or missing) — do not let older success win by name.
  responses[checksKey].check_runs.push(
    ...["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"].map((name, i) => ({
      id: 9200 + i,
      name,
      status: "completed",
      conclusion: "failure",
      app: { id: 15368, slug: "github-actions" },
      run_id: 4002,
      run_attempt: 1
    }))
  );

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /terminal state not successful|not successful/i);

  // A unique name on a single run is still not exact provenance when neither
  // the job nor the check identifies the run/attempt mapping.
  const unbound = clone(base);
  for (const job of unbound[`${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`].jobs) {
    delete job.check_run_url;
    delete job.check_run_id;
    delete job.run_id;
    delete job.run_attempt;
  }
  for (const check of unbound[checksKey].check_runs) {
    delete check.run_id;
    delete check.run_attempt;
  }
  const unboundResult = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(unbound)
  });
  assert.equal(unboundResult.ok, false);
  assert.match(unboundResult.reason, /missing live check-run mapping/);

  // A declared job-to-check reference must resolve exactly; it cannot fall
  // back to a same-name check even when that check claims the same attempt.
  const danglingReference = clone(base);
  danglingReference[`${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`].jobs[0].check_run_url =
    "https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/999999";
  const danglingResult = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(danglingReference)
  });
  assert.equal(danglingResult.ok, false);
  assert.match(danglingResult.reason, /declared check-run unavailable/);
});

test("gate-head-requires-full-identical-accepted-registry-record", async () => {
  const { registryHeadBindsAcceptedBatch, canonicalizeAcceptedBatchRecord } = await importResolver();
  const accepted = {
    id: "batch-d0-004-fixture",
    status: "ACCEPTED",
    scope: "fixture-accepted-batch",
    target: {
      repository: "github.com/MongLong0214/agent-operator-score",
      branch: "dev",
      reviewed_head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    required_artifacts: [
      {
        path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
        sha256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        kind: "TICKET"
      }
    ],
    required_transitions: ["ADR_ACCEPTED", "PRD_ACCEPTED", "TICKET_READY_FOR_RED"],
    transitions: [{ name: "ADR_ACCEPTED" }, { name: "PRD_ACCEPTED" }, { name: "TICKET_READY_FOR_RED" }],
    artifacts: [
      {
        path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
        sha256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        kind: "TICKET"
      }
    ],
    events: [
      {
        from: "PENDING",
        to: "ACCEPTED",
        recorded_at: "2026-08-06T12:10:01Z",
        recorded_by: "gate-review"
      }
    ],
    approval: {
      approved_by: "gate-review",
      approved_at: "2026-08-06T12:10:01Z",
      role: "MAINTAINER"
    }
  };
  assert.ok(canonicalizeAcceptedBatchRecord(accepted));
  assert.equal(
    registryHeadBindsAcceptedBatch(JSON.stringify({ version: 2, batches: [accepted] }), accepted),
    true
  );

  // Same digests but wrong target/empty transitions must not bind.
  const mutant = {
    ...accepted,
    target: {
      repository: "github.com/evil/other",
      branch: "main",
      reviewed_head: "0000000000000000000000000000000000000000"
    },
    required_transitions: [],
    transitions: []
  };
  assert.equal(
    registryHeadBindsAcceptedBatch(JSON.stringify({ version: 2, batches: [mutant] }), accepted),
    false
  );

  // Fields outside the old target/artifact subset are part of the identical row.
  const approvalMutant = {
    ...accepted,
    approval: { ...accepted.approval, approved_by: "different-review" }
  };
  assert.equal(
    registryHeadBindsAcceptedBatch(JSON.stringify({ version: 2, batches: [approvalMutant] }), accepted),
    false
  );

  // A byte-identical but structurally incomplete row is not an accepted record.
  const malformed = { ...accepted, target: null };
  assert.equal(canonicalizeAcceptedBatchRecord(malformed), null);
  assert.equal(
    registryHeadBindsAcceptedBatch(JSON.stringify({ version: 2, batches: [malformed] }), malformed),
    false
  );

  // Duplicate batch ids fail closed.
  assert.equal(
    registryHeadBindsAcceptedBatch(
      JSON.stringify({ version: 2, batches: [accepted, { ...accepted, scope: "dup" }] }),
      accepted
    ),
    false
  );
});

test("d0-004b-ownership-and-red-from-canonical-ticket", async () => {
  const { parseTicketOwnershipAndRed } = await importResolver();
  const ticketPath = resolve(
    root,
    "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"
  );
  assert.equal(existsSync(ticketPath), true);
  const body = readFileSync(ticketPath, "utf8");
  const parsed = parseTicketOwnershipAndRed(body, { ticketId: "D0-004", d0_004c_merged: false });
  assert.equal(parsed.ok, true, parsed.reason);
  assert.equal(parsed.subtask, "D0-004B");
  assert.equal(parsed.red_command, "node --test tests/execution-state.test.mjs");
  assert.notEqual(parsed.red_command, "npm test -- tests/planning-contract.test.mjs");
  assert.ok(parsed.owned_paths.includes("scripts/resolve-execution-state.mjs"));
  assert.ok(parsed.owned_paths.includes("specs/execution-state.schema.v1.json"));
  assert.ok(parsed.owned_paths.includes("tests/execution-state.test.mjs"));
  assert.ok(parsed.owned_paths.some((path) => path.startsWith("fixtures/operational-state")));
  // Must not pull C-only surfaces or whole-ticket A+B+C union blindly.
  assert.ok(!parsed.owned_paths.includes("scripts/render-execution-views.mjs"));
  assert.ok(!parsed.owned_paths.includes(".github/workflows/operational-state.yml"));
  // Must not treat arbitrary prose tokens as owned symbols.
  assert.ok(!parsed.owned_symbols.includes("Exact"));
  assert.ok(!parsed.owned_symbols.includes("Narrow"));
});

// ---------------------------------------------------------------------------
// Helpers — candidate / ready fact builders
// ---------------------------------------------------------------------------

function acceptGatesFor(facts, ticketId, batchId) {
  const ticket = facts.tickets[ticketId];
  const ticketPath = Object.keys(facts.liveDigests).find((p) => p.includes(`/${ticketId}-`));
  const artifacts = [
    {
      path: ticketPath,
      sha256: ticket.digests.ticket,
      kind: "TICKET"
    },
    {
      path: "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
      sha256: ticket.digests.prd,
      kind: "PRD"
    }
  ];
  for (const [adr, sha] of Object.entries(ticket.digests.adrs ?? {})) {
    artifacts.push({
      path: `docs/adr/${adr}-canonical-identity.md`,
      sha256: sha,
      kind: "ADR"
    });
  }
  facts.gateBatches.push({ id: batchId, status: "ACCEPTED", required_artifacts: artifacts });
  const mergeSha = batchId.replace(/[^a-f0-9]/g, "").padEnd(40, "0").slice(0, 40);
  const headSha = batchId.replace(/[^a-f0-9]/g, "").padEnd(40, "1").slice(0, 40);
  facts.gatePRs.push({
    number: Math.abs(hashCode(batchId)) % 10000 + 200,
    base: "dev",
    head_sha: headSha,
    body: `Gate-Batch: ${batchId}`,
    merged: true,
    merged_by: "MongLong0214",
    merge_commit_sha: mergeSha,
    author: "MongLong0214",
    head_contains_batch: true
  });
  facts.postMergeCI.push({
    merge_commit_sha: mergeSha,
    status: "completed",
    conclusion: "success",
    head_sha: mergeSha
  });
}

function makeReadyD0004Facts(base) {
  const facts = clone(base);
  facts.verifiedTickets = ["D0-001", "D0-002"];
  acceptGatesFor(facts, "D0-002", "batch-d0-002-ready");
  acceptGatesFor(facts, "D0-004", "batch-d0-004-ready-set");
  facts.activeOwnership = [];
  facts.prs = [];
  return facts;
}

function makeCandidateFacts(base, { review, authorization, ci, d0_004c_merged = false }) {
  const facts = makeReadyD0004Facts(base);
  facts.d0_004c_merged = d0_004c_merged;
  const head = "cafecafecafecafecafecafecafecafecafecafe";
  const liveBaseSha = facts.currentHead;
  facts.liveBaseSha = liveBaseSha;
  facts.prs = [
    {
      number: 300,
      ticket_id: "D0-004",
      base: "dev",
      base_sha: liveBaseSha,
      head_sha: head,
      author: "MongLong0214",
      body: "Ticket: D0-004",
      merged: false,
      labels: ["ticket:D0-004"]
    }
  ];
  facts.workflowBlobs[".github/workflows/ci.yml"].heads = { [head]: "ci-blob-dev" };
  facts.workflowBlobs[".github/workflows/operational-state.yml"].heads = { [head]: "ops-blob-dev" };

  const requiredNames = d0_004c_merged
    ? [
        "planning-contract (20)",
        "planning-contract (22)",
        "planning-contract (24)",
        "operational-state-offline"
      ]
    : ["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"];

  facts.checkRuns = [];
  facts.workflowRuns = [];
  if (ci) {
    let runId = 10;
    for (const name of requiredNames) {
      const workflow_path = name === "operational-state-offline"
        ? ".github/workflows/operational-state.yml"
        : ".github/workflows/ci.yml";
      const attempt = {
        name,
        head_sha: head,
        status: "completed",
        conclusion: "success",
        app_slug: "github-actions",
        app_id: 15368,
        event: "pull_request",
        base: "dev",
        workflow_path,
        run_id: runId,
        run_attempt: 1,
        ticket_id: "D0-004"
      };
      facts.checkRuns.push({ ...attempt });
      facts.workflowRuns.push({ ...attempt });
      runId += 1;
    }
  }

  facts.reviews = [];
  if (review) {
    facts.reviews.push({
      ticket_id: "D0-004",
      reviewer: "MongLong0214",
      commit_id: head,
      decision: "approved",
      permission: "admin",
      bootstrap_evidence: !d0_004c_merged,
      protected_check: d0_004c_merged ? "exact-head-review" : null,
      workflow_sha: facts.currentHead,
      workflow_reachable_from_dev: true
    });
    if (d0_004c_merged) {
      facts.checkRuns.push({
        name: "exact-head-review",
        head_sha: head,
        status: "completed",
        conclusion: "success",
        app_slug: "github-actions",
        external_id: "aos-exact-head-review:99:1",
        event: "workflow_dispatch",
        workflow_path: ".github/workflows/operational-state.yml",
        workflow_sha: facts.currentHead,
        workflow_reachable_from_dev: true,
        workflow_blob_oid: "ops-blob-dev",
        dispatch_actor: "MongLong0214",
        run_id: 99,
        run_attempt: 1,
        ticket_id: "D0-004"
      });
    }
  }

  facts.authorizations = [];
  if (authorization) {
    facts.authorizations.push({
      ticket_id: "D0-004",
      kind: "ceo_production_pass",
      actor: "MongLong0214",
      commit_id: head,
      permission: "admin",
      bootstrap_evidence: !d0_004c_merged,
      protected_check: d0_004c_merged ? "exact-head-authorization" : null
    });
    if (d0_004c_merged) {
      facts.checkRuns.push({
        name: "exact-head-authorization",
        head_sha: head,
        status: "completed",
        conclusion: "success",
        app_slug: "github-actions",
        external_id: "aos-exact-head-authorization:100:1",
        event: "workflow_dispatch",
        workflow_path: ".github/workflows/operational-state.yml",
        workflow_sha: facts.currentHead,
        workflow_reachable_from_dev: true,
        workflow_blob_oid: "ops-blob-dev",
        dispatch_actor: "MongLong0214",
        run_id: 100,
        run_attempt: 1,
        ticket_id: "D0-004"
      });
    }
  }

  return facts;
}

function hashCode(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}

// Keep helpers referenced for static analysis of unused in some runners.
void existsSync;
void mkdtempSync;
void rmSync;
void writeFileSync;
void cpSync;
void basename;
void dirname;
void execFileSync;
void stripRuntime;
void tmpdir;
void join;
