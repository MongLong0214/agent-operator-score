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
  facts.workflowRuns = [
    {
      name: "planning-contract (20)",
      head_sha: head,
      run_id: 1,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
      event: "pull_request",
      workflow_path: ".github/workflows/ci.yml"
    },
    {
      name: "planning-contract (20)",
      head_sha: head,
      run_id: 1,
      run_attempt: 2,
      status: "completed",
      conclusion: "failure",
      event: "pull_request",
      workflow_path: ".github/workflows/ci.yml"
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
  facts.prs = [
    {
      number: 300,
      ticket_id: "D0-004",
      base: "dev",
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
  if (ci) {
    for (const name of requiredNames) {
      const workflow_path = name === "operational-state-offline"
        ? ".github/workflows/operational-state.yml"
        : ".github/workflows/ci.yml";
      facts.checkRuns.push({
        name,
        head_sha: head,
        status: "completed",
        conclusion: "success",
        app_slug: "github-actions",
        app_id: 15368,
        event: "pull_request",
        base: "dev",
        workflow_path,
        run_id: 10,
        run_attempt: 1,
        ticket_id: "D0-004"
      });
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
