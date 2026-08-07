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
  // Bootstrap contract: per-ADR/PRD/ticket Gate-Batch PR facts are not a readiness
  // condition while facts.d0_004c_merged !== true. D0-002 has no accepted gate batch of
  // its own in this fixture, but current-source consistency, dependencies, ownership, and
  // the RED contract are all satisfied, so it now resolves ready_for_red instead of
  // blocking on the (bootstrap-waived) gate chain.
  assert.equal(d0002.phase, "ready_for_red");
  assert.equal(d0002.readiness, "ready");
  assert.deepEqual(result.readySet, ["D0-002"]);
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
  // Gate-PR-linked post-merge CI is part of the Gate-Batch PR facts the bootstrap
  // contract waives; this requirement is exercised post-D0-004C.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
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
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["resolveExecutionState"]
    },
    {
      ticket_id: "E0A-001",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["other"]
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
  // D0-002 is now ready_for_red in bootstrap (see current-baseline-state); D0-004 is the
  // ticket that still blocks in the unmodified baseline (its dependency D0-002 is not in
  // verifiedTickets), so it remains the not-ready contrast case for this assertion.
  const d0004 = ticketState(result, "D0-004");
  assert.notEqual(d0004.readiness, "ready");
  assert.equal(d0004.packet, null);

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
  // Gate-Batch PR acceptance is a bootstrap-waived readiness condition (see
  // current-baseline-state), so this invariant is exercised post-D0-004C, where a
  // per-ticket gate is still required and a spoofed registry string must not substitute.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
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
  // Gate PR owner-actor binding is part of Gate-Batch PR acceptance, waived in bootstrap;
  // exercised post-D0-004C where the full gate chain still runs.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
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
  // Gate-batch artifact digest binding is part of Gate-Batch PR acceptance, waived in
  // bootstrap; exercised post-D0-004C where the full gate chain still runs.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
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
  // Gate PR post-merge CI authenticates gate acceptance, waived in bootstrap; exercised
  // post-D0-004C where the full gate chain still runs.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
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
  // Before D0-004C merges, review and authorization are out-of-band process gates and are
  // never resolver inputs, so this distinctness is only observable after D0-004C merges.
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: false,
    ci: true,
    d0_004c_merged: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"));
  assert.equal(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"), false);
});

test("current-review-without-authorization-is-blocked", async () => {
  // Same reasoning: this gate only exists once D0-004C merges.
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: false,
    ci: true,
    d0_004c_merged: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(["blocked", "active"].includes(state.readiness));
  assert.ok(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"));
  assert.equal(result.readySet.includes("D0-004"), false);
});

test("single-owner-spoof-is-not-authorization", async () => {
  // Post-C, a spoofed self-authored string still cannot substitute for the protected
  // exact-head-authorization check + formal ceo_production_pass fact.
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: false,
    ci: true,
    d0_004c_merged: true
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
  assert.equal(result.claims_merge_authorization, false);
});

test("single-owner-sequential-review-and-authorization", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
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
  // Post-C only: this gate does not exist during bootstrap.
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: true,
    ci: true,
    d0_004c_merged: true
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
  // CTO/CEO review and the owner merge decision are out-of-band process gates during
  // bootstrap, never resolver inputs. Simulate the future exact-head-review/
  // exact-head-authorization checks having run early (candidate CI happens to include
  // them) and prove the resolver does not use their mere presence to upgrade its own
  // claims: governance_mode stays the bootstrap mode and claims_merge_authorization
  // stays false, exactly as if those checks were absent.
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: false
  });
  facts.checkRuns.push(
    {
      name: "exact-head-review",
      head_sha: facts.prs[0].head_sha,
      status: "completed",
      conclusion: "success",
      app_slug: "github-actions",
      external_id: "aos-exact-head-review:1:1",
      event: "workflow_dispatch",
      workflow_path: ".github/workflows/operational-state.yml",
      workflow_sha: facts.currentHead,
      workflow_reachable_from_dev: true,
      workflow_blob_oid: "ops-blob-dev",
      dispatch_actor: "MongLong0214",
      run_id: 1,
      run_attempt: 1,
      ticket_id: "D0-004"
    },
    {
      name: "exact-head-authorization",
      head_sha: facts.prs[0].head_sha,
      status: "completed",
      conclusion: "success",
      app_slug: "github-actions",
      external_id: "aos-exact-head-authorization:2:1",
      event: "workflow_dispatch",
      workflow_path: ".github/workflows/operational-state.yml",
      workflow_sha: facts.currentHead,
      workflow_reachable_from_dev: true,
      workflow_blob_oid: "ops-blob-dev",
      dispatch_actor: "MongLong0214",
      run_id: 2,
      run_attempt: 1,
      ticket_id: "D0-004"
    }
  );
  const { result } = await resolveOffline(facts);
  assert.equal(result.governance_mode, "single_owner_bootstrap");
  assert.equal(result.claims_merge_authorization, false);
  const state = ticketState(result, "D0-004");
  assert.equal(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"), false);
  assert.equal(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"), false);
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

// ---------------------------------------------------------------------------
// Bootstrap governance simplification: CTO/CEO review and the owner merge
// decision are out-of-band process gates, never resolver inputs, while
// facts.d0_004c_merged === false. No authorization writer/collector (Deployment,
// Commit-Status, or renewed per-artifact Gate-Batch PR facts) is built as a
// substitute; the requirement is removed, not relocated.
// ---------------------------------------------------------------------------

test("bootstrap-omits-review-and-authorization-blockers", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: false,
    ci: true
  });
  const { result } = await resolveOffline(facts);
  assert.equal(result.governance_mode, "single_owner_bootstrap");
  const state = ticketState(result, "D0-004");
  assert.equal(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"), false);
  assert.equal(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"), false);
  assert.equal(state.phase, "implementing");
  assert.equal(state.readiness, "active");
});

test("bootstrap-omits-adr-prd-ticket-gate-missing-codes", async () => {
  // D0-002 in the unmodified baseline has no accepted gate batch of its own, but while
  // facts.d0_004c_merged !== true, per-ADR/PRD/ticket Gate-Batch PR facts are not a
  // readiness condition, so none of the three gate-missing codes may be emitted anywhere.
  const facts = loadBaselineFacts();
  const { result } = await resolveOffline(facts);
  const codes = Object.values(result.tickets).flatMap((t) => blockerCodes(t));
  assert.equal(codes.includes("ADR_GATE_MISSING"), false);
  assert.equal(codes.includes("PRD_GATE_MISSING"), false);
  assert.equal(codes.includes("TICKET_GATE_MISSING"), false);
});

test("post-d0-004c-still-emits-adr-prd-ticket-gate-missing-codes", async () => {
  // Once facts.d0_004c_merged === true the full gate chain runs again; D0-002 still has
  // no accepted gate batch of its own, so gate-missing codes must resurface.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
  const { result } = await resolveOffline(facts);
  const d0002 = ticketState(result, "D0-002");
  assert.ok(
    blockerCodes(d0002).some((code) =>
      ["ADR_GATE_MISSING", "PRD_GATE_MISSING", "TICKET_GATE_MISSING"].includes(code)
    )
  );
});

test("claims-merge-authorization-stays-false-under-spoofed-strings", async () => {
  // Injecting comment/registry/deployment/status/tag-shaped facts must never flip
  // claims_merge_authorization to true, in bootstrap or once fully ready.
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: false,
    ci: true
  });
  facts.registryStrings = {
    prepared_by: "MongLong0214",
    approved_by: "MongLong0214",
    authorization: "CEO production PASS",
    deployment_status: "success",
    commit_status: "success",
    tag: "v-production-pass"
  };
  facts.authorizations = [
    {
      ticket_id: "D0-004",
      kind: "self_authored_string",
      actor: "MongLong0214",
      commit_id: facts.prs[0].head_sha,
      text: "CEO production PASS"
    },
    {
      ticket_id: "D0-004",
      kind: "registry_string",
      actor: "MongLong0214",
      commit_id: facts.prs[0].head_sha,
      text: "approved_by=MongLong0214"
    },
    {
      ticket_id: "D0-004",
      kind: "deployment",
      actor: "MongLong0214",
      commit_id: facts.prs[0].head_sha,
      environment: "production",
      state: "success"
    },
    {
      ticket_id: "D0-004",
      kind: "commit_status",
      actor: "MongLong0214",
      commit_id: facts.prs[0].head_sha,
      state: "success",
      context: "ceo/production-pass"
    },
    {
      ticket_id: "D0-004",
      kind: "tag",
      actor: "MongLong0214",
      commit_id: facts.prs[0].head_sha,
      ref: "refs/tags/production-pass"
    }
  ];
  const { result } = await resolveOffline(facts);
  assert.equal(result.claims_merge_authorization, false);

  // Even a fully ready ticket (green technical readiness) never asserts authorization.
  const readyFacts = makeReadyD0004Facts(loadBaselineFacts());
  const { result: readyResult } = await resolveOffline(readyFacts);
  assert.ok(readyResult.readySet.includes("D0-004"));
  assert.equal(readyResult.claims_merge_authorization, false);
});

test("bootstrap-exact-head-ci-still-blocks", async () => {
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: false,
    ci: false
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.ok(blockerCodes(state).includes("EXACT_HEAD_CI_FAILED"));
  assert.equal(state.readiness, "blocked");
  assert.equal(result.readySet.includes("D0-004"), false);
});

test("bootstrap-external-outage-yields-unknown-or-blocked", async () => {
  const outage = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: false,
    ci: true
  });
  outage.externalAvailable = false;
  const { result: outageResult } = await resolveOffline(outage);
  assert.deepEqual(outageResult.readySet, []);
  const outageState = ticketState(outageResult, "D0-004");
  assert.equal(outageState.readiness, "unknown");
  assert.ok(blockerCodes(outageState).includes("EXTERNAL_STATE_UNAVAILABLE"));

  // Partial candidate-CI provenance (missing run attempt identity) fails closed too.
  const partial = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: false,
    ci: true
  });
  partial.checkRuns = partial.checkRuns.map((entry) => ({ ...entry, run_id: undefined, run_attempt: undefined }));
  partial.workflowRuns = partial.workflowRuns.map((entry) => ({ ...entry, run_id: undefined, run_attempt: undefined }));
  const { result: partialResult } = await resolveOffline(partial);
  const partialState = ticketState(partialResult, "D0-004");
  assert.ok(blockerCodes(partialState).includes("EXACT_HEAD_CI_FAILED"));
});

test("bootstrap-malformed-graph-and-ownership-collision-still-block", async () => {
  // A malformed binding of the current ticket's own planning graph still fails closed.
  const malformed = loadBaselineFacts();
  delete malformed.tickets["D0-004"].digests.ticket;
  const { result: malformedResult } = await resolveOffline(malformed);
  const malformedState = ticketState(malformedResult, "D0-004");
  assert.ok(blockerCodes(malformedState).includes("TICKET_CONTRACT_INCOMPLETE"));
  assert.notEqual(malformedState.readiness, "ready");

  // Ownership collision still blocks even with review/authorization removed from bootstrap.
  const collision = makeCandidateFacts(loadBaselineFacts(), {
    review: false,
    authorization: false,
    ci: true
  });
  collision.activeOwnership = [
    {
      ticket_id: "E0A-001",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["other"]
    }
  ];
  const { result: collisionResult } = await resolveOffline(collision);
  const collisionState = ticketState(collisionResult, "D0-004");
  assert.ok(blockerCodes(collisionState).includes("OWNERSHIP_OVERLAP"));
  assert.equal(collisionResult.readySet.includes("D0-004"), false);
});

test("historical-d0-002-linkage-satisfies-dependency-verification", async () => {
  // PR #143 is the real, already-merged D0-002 implementation into dev; its merge commit
  // and post-merge CI run are exact historical facts. PR #143's body correctly has no
  // `Ticket: D0-002` line (retroactively adding one is a separately-authorized metadata
  // correction, not performed here), so dependency verification must be satisfied by the
  // historical merge + post-merge CI facts alone, without a structured Ticket-field link.
  const facts = loadBaselineFacts();
  acceptGatesFor(facts, "D0-002", "batch-d0-002-historical");
  facts.implementationMerges = [
    { ticket_id: "D0-002", merge_commit_sha: "782946e96baa4a3f2734a2ad6b42210d289bebb7", number: 143 }
  ];
  facts.postMergeCI.push({
    merge_commit_sha: "782946e96baa4a3f2734a2ad6b42210d289bebb7",
    head_sha: "782946e96baa4a3f2734a2ad6b42210d289bebb7",
    status: "completed",
    conclusion: "success",
    run_id: 31084420124,
    run_attempt: 1
  });
  facts.verifiedTickets = ["D0-001", "D0-002"];
  const { result } = await resolveOffline(facts);
  const d0002 = ticketState(result, "D0-002");
  assert.equal(d0002.phase, "verified");
  assert.equal(d0002.readiness, "terminal");
  const d0004 = ticketState(result, "D0-004");
  assert.equal(blockerCodes(d0004).includes("DEPENDENCY_UNVERIFIED"), false);
});

test("partial-sub-ticket-merges-do-not-satisfy-whole-ticket-verification", async () => {
  // Real repro shape (D0-004 issue #57 lineage). D0-004's own ticket text splits execution
  // into declared in-ticket subtasks D0-004A/B/C, but neither docs/issues.json nor
  // TRACEABILITY.md's semantic catalog ever declare "D0-004A"/"D0-004B"/"D0-004C" as
  // separate ticket ids — only a single "D0-004" id exists anywhere in the catalog. Three
  // real merged PRs each carry the exact `Ticket: D0-004` structured field without being
  // the whole-ticket completion merge: #135 ("docs: define single operational state
  // author") and #136 ("docs: close D0-004 operational authority gap") are documentation
  // and contract corrections, and #146's own body states verbatim "D0-004A only: semantic
  // catalog and planning validator. No resolver, workflow/projection, gate-administration
  // change, product code, issue body/label mutation, or current-state projection." #150
  // (D0-004B) is still open; D0-004C does not exist yet. Nothing in the declared catalog
  // or the PR-body grammar (`Ticket:`, `Gate-Batch:`, `Superseded-By:`, `Supersedes:`)
  // identifies any one of these merges as THE completion merge, so this must fail closed
  // rather than trust an arbitrary receipt.
  const sha135 = "135a135a135a135a135a135a135a135a135a135a";
  const sha136 = "136b136b136b136b136b136b136b136b136b136b";
  const sha146 = "146c146c146c146c146c146c146c146c146c146c";

  const buildPartialMergeFacts = () => {
    const facts = makeReadyD0004Facts(loadBaselineFacts());
    // Collector-observed fact: any merged PR carrying the exact Ticket field with
    // successful post-merge CI adds the ticket id once (see mergedSearch loop) — the
    // real collector already produced this false verifiedTickets membership for D0-004.
    facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
    facts.implementationMerges = [
      { ticket_id: "D0-004", merge_commit_sha: sha135, number: 135 },
      { ticket_id: "D0-004", merge_commit_sha: sha136, number: 136 },
      { ticket_id: "D0-004", merge_commit_sha: sha146, number: 146 }
    ];
    facts.postMergeCI.push(
      { merge_commit_sha: sha135, head_sha: sha135, status: "completed", conclusion: "success", run_id: 135, run_attempt: 1 },
      { merge_commit_sha: sha136, head_sha: sha136, status: "completed", conclusion: "success", run_id: 136, run_attempt: 1 },
      { merge_commit_sha: sha146, head_sha: sha146, status: "completed", conclusion: "success", run_id: 146, run_attempt: 1 }
    );
    return facts;
  };

  // 1. With no open candidate in play, three ambiguous partial-merge receipts must never
  //    let D0-004 itself resolve as "verified".
  const soloFacts = buildPartialMergeFacts();
  const { result: soloResult } = await resolveOffline(soloFacts);
  const d0004Solo = ticketState(soloResult, "D0-004");
  assert.notEqual(
    d0004Solo.phase,
    "verified",
    `ambiguous partial merges must not read as whole-ticket completion, got phase=${d0004Solo.phase}`
  );

  // 2. Real shape: #150 (D0-004B) is still open, and a dependent ticket (E0A-001, whose
  //    only declared dependency is D0-004, exactly as docs/issues.json declares) must not
  //    read D0-004 as a satisfied dependency and must not enter readySet on that false
  //    premise.
  const facts = buildPartialMergeFacts();
  facts.prs = [
    {
      number: 150,
      ticket_id: "D0-004",
      base: "dev",
      base_sha: facts.currentHead,
      head_sha: "150d150d150d150d150d150d150d150d150d150d",
      author: "MongLong0214",
      body: "Ticket: D0-004\n\nD0-004B resolver core (still open).",
      merged: false,
      labels: ["ticket:D0-004"]
    }
  ];
  const e0a001Path = "docs/tickets/E0-A/E0A-001-freeze-m01-m20-metric-registry.md";
  const e0a001TicketSha = "e0a1e0a1e0a1e0a1e0a1e0a1e0a1e0a1e0a1e0a1";
  facts.tickets["E0A-001"] = {
    kind: "executable",
    dependencies: ["D0-004"],
    owned_paths: [e0a001Path],
    owned_symbols: [],
    red_command: "node --test tests/e0a-001.test.mjs",
    digests: { ticket: e0a001TicketSha }
  };
  facts.liveDigests[e0a001Path] = e0a001TicketSha;

  const { result } = await resolveOffline(facts);
  const e0a001 = ticketState(result, "E0A-001");
  assert.ok(
    blockerCodes(e0a001).includes("DEPENDENCY_UNVERIFIED"),
    `expected DEPENDENCY_UNVERIFIED on E0A-001 from unverified D0-004, got ${blockerCodes(e0a001).join(",")}`
  );
  assert.equal(e0a001.readiness, "blocked");
  assert.equal(result.readySet.includes("E0A-001"), false, "E0A-001 must not enter readySet on a false D0-004 completion");
});

test("historical-linkage-collector-verifies-real-merge-before-trusting-it", async () => {
  const { applyHistoricalImplementationLinkage, createFixtureTransport } = await importResolver();
  const tickets = { "D0-002": { owned_paths: ["x"], owned_symbols: [] } };
  const repoPath = "repos/MongLong0214/agent-operator-score";
  const mergeSha = "782946e96baa4a3f2734a2ad6b42210d289bebb7";

  // Matching historical merge + successful post-merge CI is trusted.
  {
    const responses = {
      [`${repoPath}/pulls/143`]: {
        number: 143,
        merged: true,
        merge_commit_sha: mergeSha,
        base: { ref: "dev" }
      },
      [`${repoPath}/actions/runs?head_sha=${mergeSha}&event=push&per_page=20`]: {
        total_count: 1,
        workflow_runs: [
          {
            id: 31084420124,
            name: "CI",
            path: ".github/workflows/ci.yml",
            head_sha: mergeSha,
            status: "completed",
            conclusion: "success",
            run_attempt: 1
          }
        ]
      }
    };
    const transport = createFixtureTransport(responses);
    const failures = [];
    const implementationMerges = [];
    const postMergeCI = [];
    const verifiedTickets = [];
    const ok = applyHistoricalImplementationLinkage(transport, repoPath, tickets, failures, {
      implementationMerges,
      postMergeCI,
      verifiedTickets
    });
    assert.equal(ok, true);
    assert.deepEqual(failures, []);
    assert.deepEqual(implementationMerges, [{ ticket_id: "D0-002", merge_commit_sha: mergeSha, number: 143 }]);
    assert.ok(verifiedTickets.includes("D0-002"));
    assert.equal(postMergeCI[0].conclusion, "success");
  }

  // A mismatched merge SHA is a tamper/integrity signal and fails closed.
  {
    const responses = {
      [`${repoPath}/pulls/143`]: {
        number: 143,
        merged: true,
        merge_commit_sha: "0000000000000000000000000000000000000000",
        base: { ref: "dev" }
      }
    };
    const transport = createFixtureTransport(responses);
    const failures = [];
    const ok = applyHistoricalImplementationLinkage(transport, repoPath, tickets, failures, {
      implementationMerges: [],
      postMergeCI: [],
      verifiedTickets: []
    });
    assert.equal(ok, false);
    assert.ok(failures.length > 0);
  }

  // API outage fails closed.
  {
    const responses = { [`${repoPath}/pulls/143`]: null };
    const transport = createFixtureTransport(responses);
    const failures = [];
    const ok = applyHistoricalImplementationLinkage(transport, repoPath, tickets, failures, {
      implementationMerges: [],
      postMergeCI: [],
      verifiedTickets: []
    });
    assert.equal(ok, false);
    assert.ok(failures.length > 0);
  }
});

test("post-c-technical-check-is-not-independent-approval", async () => {
  // A fully passing post-C candidate (protected exact-head-review + exact-head-authorization
  // checks, both dispatched by the same authenticated owner principal) is trusted technical
  // automation evidence, never independent approval. The genuine external-independence gate
  // is a future E14-003/G4 ticket with a distinct principal, not this one.
  const facts = makeCandidateFacts(loadBaselineFacts(), {
    review: true,
    authorization: true,
    ci: true,
    d0_004c_merged: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(blockerCodes(state).includes("CUMULATIVE_REVIEW_MISSING"), false);
  assert.equal(blockerCodes(state).includes("MERGE_AUTHORIZATION_MISSING"), false);
  assert.equal(result.claims_merge_authorization, false);
});

test("no-machine-fact-asserts-independence-before-g4", async () => {
  const { loadExecutionStateSchema, validateAgainstSchema } = await importResolver();
  const schemaLoad = loadExecutionStateSchema(root);
  // The schema itself pins claims_merge_authorization to false: no accidental future flip.
  assert.equal(schemaLoad.schema.properties.claims_merge_authorization.const, false);

  const scenarios = [
    loadBaselineFacts(),
    makeReadyD0004Facts(loadBaselineFacts()),
    makeCandidateFacts(loadBaselineFacts(), { review: true, authorization: true, ci: true, d0_004c_merged: false }),
    makeCandidateFacts(loadBaselineFacts(), { review: true, authorization: true, ci: true, d0_004c_merged: true })
  ];
  for (const facts of scenarios) {
    const { result } = await resolveOffline(facts);
    assert.equal(result.claims_merge_authorization, false);
    assert.deepEqual(validateAgainstSchema(result, schemaLoad.schema), []);
  }
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
  // Current-source consistency for referenced PRD/ADR authority documents is never
  // waived, in bootstrap or post-D0-004C: a missing live digest for an authority document
  // the ticket itself declares still fails closed even though Gate-Batch PR acceptance
  // itself is a bootstrap-waived readiness condition.
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
  // The gate PR's post-merge CI (and its latest-attempt selection) is part of Gate-Batch
  // PR acceptance, waived in bootstrap; exercised post-D0-004C.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
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
  // Gate-Batch body field parsing is part of Gate-Batch PR acceptance, waived in
  // bootstrap; exercised post-D0-004C where the full gate chain still runs.
  const facts = loadBaselineFacts();
  facts.d0_004c_merged = true;
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
    responses[key] = {
      total_count: 2,
      incomplete_results: false,
      items: [{ number: 200 }, { number: 201 }]
    };
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
  const strippedChecks = (base[checkKey].check_runs ?? []).map((check) => {
    const copy = { ...check };
    delete copy.app;
    return copy;
  });
  responses[checkKey] = {
    total_count: strippedChecks.length,
    check_runs: strippedChecks
  };
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /app provenance|check-run mapping|provenance/i);

  const emptyChecks = clone(base);
  emptyChecks[checkKey] = { total_count: 0, check_runs: [] };
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
  assert.match(reusedCollected.reason, /already consumed|one-to-one|ambiguous.*required job/i);
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

// ---------------------------------------------------------------------------
// Trusted-workflow ancestry: workflow_reachable_from_dev must come from an authenticated
// ancestry compare against live dev, never from the run's self-reported head_branch label.
// ---------------------------------------------------------------------------

/**
 * Build a D0-004C-active collector fixture (operational-state.yml present on live dev)
 * whose single open PR (#300, head `cafecafe...`) carries a dispatched "exact-head-review"
 * check-run bound to `workflowSha`/`headBranch`, with the identical workflow blob at dev,
 * the PR head, and `workflowSha` itself — isolating ancestry as the only varying fact.
 * `compareResponse === undefined` omits the compare fixture entirely (outage/unavailable).
 */
function buildExactHeadReviewCollectorFacts({ workflowSha, headBranch = "dev", compareResponse }) {
  const repo = "repos/MongLong0214/agent-operator-score";
  const tip = "c8937c6c31ef034535f7c2e8276514221a12fd55";
  const prHead = "cafecafecafecafecafecafecafecafecafecafe";
  const opsBlobSha = "ops-blob-live-head-and-run-identical";

  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const responses = clone(base);

  // D0-004C's workflow now exists on live dev, and the candidate head + dispatched run's
  // own workflow commit all carry the byte-identical blob — the exact "identical blob,
  // ancestry differs" shape the defect describes.
  responses[`${repo}/contents/.github/workflows/operational-state.yml?ref=${tip}`] = {
    sha: opsBlobSha,
    path: ".github/workflows/operational-state.yml"
  };
  responses[`${repo}/contents/.github/workflows/operational-state.yml?ref=${prHead}`] = {
    sha: opsBlobSha,
    path: ".github/workflows/operational-state.yml"
  };
  if (typeof workflowSha === "string") {
    responses[`${repo}/contents/.github/workflows/operational-state.yml?ref=${workflowSha}`] = {
      sha: opsBlobSha,
      path: ".github/workflows/operational-state.yml"
    };
  }

  // Once D0-004C is active, candidate CI also requires "operational-state-offline" on the
  // PR head; wire a minimal passing run/job for it so only ancestry varies across cases.
  const runsKey = `${repo}/actions/runs?head_sha=${prHead}&event=pull_request&per_page=30`;
  const runs = clone(responses[runsKey]);
  runs.workflow_runs.push({
    id: 4002,
    name: "operational-state",
    path: ".github/workflows/operational-state.yml",
    head_sha: prHead,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    event: "pull_request"
  });
  runs.total_count = runs.workflow_runs.length;
  responses[runsKey] = runs;

  responses[`${repo}/actions/runs/4002/attempts/1/jobs?per_page=50`] = {
    jobs: [
      {
        name: "operational-state-offline",
        status: "completed",
        conclusion: "success",
        check_run_url: `https://api.github.com/${repo}/check-runs/9003`,
        run_id: 4002,
        run_attempt: 1
      }
    ],
    total_count: 1
  };

  const checksKey = `${repo}/commits/${prHead}/check-runs?per_page=50`;
  const checks = clone(responses[checksKey]);
  checks.check_runs.push(
    {
      name: "operational-state-offline",
      status: "completed",
      conclusion: "success",
      app: { id: 15368, slug: "github-actions" },
      external_id: null,
      id: 9003,
      run_id: 4002,
      run_attempt: 1
    },
    {
      name: "exact-head-review",
      status: "completed",
      conclusion: "success",
      app: { id: 15368, slug: "github-actions" },
      external_id: "aos-exact-head-review:5555:1",
      id: 9004
    }
  );
  checks.total_count = checks.check_runs.length;
  responses[checksKey] = checks;

  // The dispatched run: event/path/actor are all in contract; head_branch is the exact
  // field the pre-fix collector trusted, deliberately set to lie ("dev") in RED cases.
  responses[`${repo}/actions/runs/5555`] = {
    run_attempt: 1,
    event: "workflow_dispatch",
    path: ".github/workflows/operational-state.yml",
    triggering_actor: { login: "MongLong0214" },
    head_sha: workflowSha,
    head_branch: headBranch
  };

  if (compareResponse !== undefined && typeof workflowSha === "string") {
    responses[`${repo}/compare/${tip}...${workflowSha}`] = compareResponse;
  }

  return { responses, repo, tip, prHead };
}

test("orphan-non-ancestor-workflow-sha-with-identical-blob-fails-closed", async () => {
  // The exact defect shape: an orphan/detached historical commit whose head_branch claims
  // "dev" and whose workflow blob is byte-identical to live dev, but which is not actually
  // reachable from dev. Branch-name trust would pass this; ancestry must reject it.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const orphanSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const { responses } = buildExactHeadReviewCollectorFacts({
    workflowSha: orphanSha,
    headBranch: "dev",
    compareResponse: { status: "diverged", ahead_by: 3, behind_by: 0 }
  });

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const reviewCheck = collected.facts.checkRuns.find((check) => check.name === "exact-head-review");
  assert.ok(reviewCheck, "collector must emit the exact-head-review check fact");
  assert.equal(
    reviewCheck.workflow_reachable_from_dev,
    false,
    "a non-ancestor workflow SHA must never read as reachable from dev, even with a matching head_branch label and identical blob"
  );

  // The resolver-side consequence: this check can never satisfy review/authorization.
  const { resolveExecutionState } = await importResolver();
  const state = resolveExecutionState({ mode: "online-strict", root, facts: { ...collected.facts, d0_004c_merged: true } });
  const d0004 = state.tickets["D0-004"];
  assert.ok(d0004, "resolver must still emit D0-004 state");
  assert.notEqual(d0004.readiness, "ready");
});

test("workflow-ancestry-api-outage-fails-closed-not-a-pass", async () => {
  // An unavailable/erroring compare must never degrade to "reachable" (a silent pass);
  // the whole collection fails closed as unavailable, matching every other authenticated
  // fact outage in this collector.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const someSha = "1234567890abcdef1234567890abcdef12345678";
  const { responses } = buildExactHeadReviewCollectorFacts({
    workflowSha: someSha,
    headBranch: "dev",
    compareResponse: null // fixture outage sentinel: transport throws FIXTURE_OUTAGE
  });

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false, "an ancestry-compare outage must fail the whole collection closed");
  assert.match(collected.reason, /ancestry|compare|unavailable/i);
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
  const dualRuns = [
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
  ];
  responses[runsKey] = { total_count: dualRuns.length, workflow_runs: dualRuns };
  // Stale successful check-runs (would mask failure if bound only by name).
  const dualChecks = [
    ...["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"].map((name, i) => ({
      id: 9100 + i,
      name,
      status: "completed",
      conclusion: "success",
      app: { id: 15368, slug: "github-actions" },
      run_id: 4001,
      run_attempt: 1
    })),
    ...["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"].map((name, i) => ({
      id: 9200 + i,
      name,
      status: "completed",
      conclusion: "failure",
      app: { id: 15368, slug: "github-actions" },
      run_id: 4002,
      run_attempt: 1
    }))
  ];
  responses[checksKey] = { total_count: dualChecks.length, check_runs: dualChecks };
  const dualJobs = (runId, conclusion, checkBase) =>
    ["planning-contract (20)", "planning-contract (22)", "planning-contract (24)"].map((name, i) => ({
      name,
      status: "completed",
      conclusion,
      run_id: runId,
      run_attempt: 1,
      check_run_url: `https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/${checkBase + i}`
    }));
  responses[`${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`] = {
    total_count: 3,
    jobs: dualJobs(4001, "success", 9100)
  };
  responses[`${repo}/actions/runs/4002/attempts/1/jobs?per_page=50`] = {
    total_count: 3,
    jobs: dualJobs(4002, "failure", 9200)
  };

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  assert.deepEqual(
    collected.facts.workflowRuns.map((entry) => [entry.run_id, entry.run_attempt, entry.conclusion]),
    [[4002, 1, "failure"], [4002, 1, "failure"], [4002, 1, "failure"]]
  );

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

test("candidate-ci-selects-only-the-latest-attempt-for-each-required-workflow", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const head = "cafecafecafecafecafecafecafecafecafecafe";
  const repo = "repos/MongLong0214/agent-operator-score";
  const runsKey = `${repo}/actions/runs?head_sha=${head}&event=pull_request&per_page=30`;
  const responses = clone(base);

  // An older failed CI run and an unrelated workflow are audit-only; neither
  // may displace the selected latest CI attempt or its required jobs.
  responses[runsKey].workflow_runs.unshift({
    id: 3999,
    name: "CI",
    path: ".github/workflows/ci.yml",
    head_sha: head,
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    event: "pull_request"
  });
  responses[runsKey].workflow_runs.push({
    id: 4999,
    name: "unrelated",
    path: ".github/workflows/unrelated.yml",
    head_sha: head,
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
    event: "pull_request"
  });
  responses[runsKey].total_count = responses[runsKey].workflow_runs.length;

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  assert.deepEqual(
    collected.facts.workflowRuns.map((entry) => entry.run_id),
    [4001, 4001, 4001]
  );
});

test("candidate-ci-preserves-authenticated-terminal-failure-for-resolver-classification", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts, resolveExecutionState } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const head = "cafecafecafecafecafecafecafecafecafecafe";
  const repo = "repos/MongLong0214/agent-operator-score";
  const responses = clone(base);
  const jobsKey = `${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`;
  const checksKey = `${repo}/commits/${head}/check-runs?per_page=50`;
  for (const job of responses[jobsKey].jobs) job.conclusion = "failure";
  for (const check of responses[checksKey].check_runs) check.conclusion = "failure";

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const gateMergeSha = "dddddddddddddddddddddddddddddddddddddddd";
  const ticket = collected.facts.tickets["D0-004"];
  const ticketPath = Object.keys(collected.facts.liveDigests).find((path) => path.includes("/D0-004-"));
  const prdPath = "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md";
  const artifacts = [
    { path: ticketPath, sha256: ticket.digests.ticket, kind: "TICKET" },
    { path: prdPath, sha256: ticket.digests.prd, kind: "PRD" },
    ...Object.entries(ticket.digests.adrs).map(([id, sha256]) => ({
      path: Object.keys(collected.facts.liveDigests).find((path) => path.includes(`/${id}-`)),
      sha256,
      kind: "ADR"
    }))
  ];
  collected.facts.gateBatches = [{ id: "candidate-ci-terminal-fixture", status: "ACCEPTED", required_artifacts: artifacts }];
  collected.facts.gatePRs = [{
    number: 901,
    base: "dev",
    body: "Gate-Batch: candidate-ci-terminal-fixture\n",
    merged: true,
    merged_by: "MongLong0214",
    merge_commit_sha: gateMergeSha,
    head_contains_batch: true
  }];
  collected.facts.postMergeCI = [{
    merge_commit_sha: gateMergeSha,
    head_sha: gateMergeSha,
    status: "completed",
    conclusion: "success",
    run_id: 1,
    run_attempt: 1
  }];
  const state = resolveExecutionState({
    mode: "online-strict",
    root,
    facts: collected.facts,
    runtimeIdentity: {
      repository: collected.facts.repository,
      branch: collected.facts.defaultBranch,
      head: collected.facts.currentHead
    }
  });
  assert.ok(blockerCodes(ticketState(state, "D0-004")).includes("EXACT_HEAD_CI_FAILED"));
  assert.ok(!state.errors.some((entry) => entry.code === "EXTERNAL_STATE_UNAVAILABLE"));
});

test("candidate-ci-attempt-jobs-outage-is-not-masked-by-generic-jobs-fallback", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const repo = "repos/MongLong0214/agent-operator-score";
  const responses = clone(base);
  const attemptKey = `${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`;
  const genericKey = `${repo}/actions/runs/4001/jobs?per_page=50`;
  responses[attemptKey] = null;
  responses[genericKey] = clone(base[attemptKey]);

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /attempt.*jobs|unavailable|timeout/i);
});

test("candidate-ci-requires-authenticated-pull-base-sha", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const repo = "repos/MongLong0214/agent-operator-score";
  const pullsKey = `${repo}/pulls?state=open&base=dev&per_page=50`;
  const responses = clone(base);
  delete responses[pullsKey][0].base.sha;

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /base.*sha/i);
});

test("online-acquisition-failure-never-relabels-local-feature-head-as-dev", async () => {
  const { resolveExecutionState } = await importResolver();
  const state = resolveExecutionState({ mode: "online-strict", root, facts: null });
  assert.equal(state.target_branch, "dev");
  assert.equal(state.current_head, null);
  assert.ok(state.errors.some((entry) => entry.code === "EXTERNAL_STATE_UNAVAILABLE"));
});

test("ticket-authority-binds-owning-prd-and-adrs-from-traceability-not-hardcoded-d0", async () => {
  const {
    buildTicketAuthorityIndex,
    parseOwningPrdPathFromTicket,
    createFixtureTransport,
    collectLiveExecutionFacts
  } = await importResolver();
  const trace = readFileSync(resolve(root, "docs/TRACEABILITY.md"), "utf8");
  const index = buildTicketAuthorityIndex(trace);
  assert.equal(index.ok, true, index.reason);
  assert.equal(
    index.index["E0A-001"].prd_path,
    "docs/prd/PRD-E0A-metric-and-score-issuance-contract.md"
  );
  assert.ok(index.index["E0A-001"].adr_ids.includes("ADR-0005"));
  assert.notEqual(
    index.index["E0A-001"].prd_path,
    "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"
  );
  const e0aBody = readFileSync(
    resolve(root, "docs/tickets/E0-A/E0A-001-freeze-m01-m20-metric-registry.md"),
    "utf8"
  );
  assert.equal(
    parseOwningPrdPathFromTicket(e0aBody),
    "docs/prd/PRD-E0A-metric-and-score-issuance-contract.md"
  );

  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const d0004 = collected.facts.tickets["D0-004"];
  assert.equal(d0004.prd_path, "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md");
  assert.deepEqual(Object.keys(d0004.digests.adrs).sort(), ["ADR-0001", "ADR-0003", "ADR-0012"]);
  // Live digests must include non-D0 PRD authority files from TRACEABILITY, not only D0.
  assert.ok(
    Object.keys(collected.facts.liveDigests).some((path) =>
      path.includes("PRD-E0A-metric-and-score-issuance-contract.md")
    )
  );
});

test("implementation-post-merge-failure-emits-post-merge-ci-failed", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  const mergeSha = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  facts.implementationMerges = [
    { ticket_id: "D0-004", merge_commit_sha: mergeSha, number: 999 }
  ];
  // Keep gate post-merge rows; append implementation failure receipt.
  facts.verifiedTickets = ["D0-001", "D0-002"]; // D0-004 not verified; failure still classifies
  facts.postMergeCI = [
    ...facts.postMergeCI,
    {
      merge_commit_sha: mergeSha,
      head_sha: mergeSha,
      status: "completed",
      conclusion: "failure",
      run_id: 77,
      run_attempt: 1
    }
  ];
  facts.prs = [];
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.equal(d0004.phase, "merged_pending_post_ci");
  assert.ok(blockerCodes(d0004).includes("POST_MERGE_CI_FAILED"));
});

test("implementation-post-merge-nonterminal-emits-post-merge-ci-missing", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  const mergeSha = "ffffffffffffffffffffffffffffffffffffffff";
  facts.implementationMerges = [
    { ticket_id: "D0-004", merge_commit_sha: mergeSha, number: 998 }
  ];
  facts.verifiedTickets = ["D0-001", "D0-002"];
  facts.postMergeCI = [
    ...facts.postMergeCI,
    {
      merge_commit_sha: mergeSha,
      head_sha: mergeSha,
      status: "in_progress",
      conclusion: null,
      run_id: 78,
      run_attempt: 1
    }
  ];
  facts.prs = [];
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.ok(blockerCodes(d0004).includes("POST_MERGE_CI_MISSING"));
});

test("authoritative-search-incomplete-results-flag-required-fails-closed", async () => {
  // R14: incomplete_results must be a present boolean on gate and merged Ticket searches.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const gateKey = Object.keys(responses).find(
    (entry) => entry.includes("search/issues") && entry.includes("Gate-Batch")
  );
  const mergedKey = Object.keys(responses).find(
    (entry) => entry.includes("search/issues") && entry.includes("Ticket") && entry.includes("base")
  );
  assert.ok(gateKey && mergedKey);

  const missingGate = clone(responses);
  delete missingGate[gateKey].incomplete_results;
  const missingGateResult = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(missingGate)
  });
  assert.equal(missingGateResult.ok, false);
  assert.match(missingGateResult.reason, /incomplete_results|malformed/i);

  const stringFlag = clone(responses);
  stringFlag[mergedKey] = {
    ...clone(stringFlag[mergedKey]),
    incomplete_results: "false"
  };
  const stringResult = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(stringFlag)
  });
  assert.equal(stringResult.ok, false);
  assert.match(stringResult.reason, /incomplete_results|malformed/i);
});

test("authoritative-total-count-missing-or-under-reported-fails-closed", async () => {
  // R13: total_count is required and must equal returned array length (not optional, not under-count).
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const gateKey = Object.keys(responses).find((entry) => entry.includes("search/issues") && entry.includes("Gate-Batch"));
  const runKey = Object.keys(responses).find(
    (entry) => entry.includes("actions/runs?head_sha=cafecafe") && entry.includes("pull_request")
  );
  const checkKey = Object.keys(responses).find((entry) => entry.includes("check-runs?per_page=50"));
  const jobsKey = Object.keys(responses).find((entry) => entry.includes("/attempts/") && entry.includes("/jobs"));
  assert.ok(gateKey && runKey && checkKey && jobsKey);

  const missingGate = clone(responses);
  delete missingGate[gateKey].total_count;
  const missingGateResult = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(missingGate)
  });
  assert.equal(missingGateResult.ok, false);
  assert.match(missingGateResult.reason, /total_count|missing/i);

  const underRun = clone(responses);
  underRun[runKey] = {
    ...clone(underRun[runKey]),
    total_count: Math.max(0, (underRun[runKey].workflow_runs?.length ?? 1) - 1)
  };
  const underRunResult = collectLiveExecutionFacts(root, { transport: createFixtureTransport(underRun) });
  assert.equal(underRunResult.ok, false);
  assert.match(underRunResult.reason, /total_count|disagrees|workflow runs/i);

  const underCheck = clone(responses);
  underCheck[checkKey] = {
    ...clone(underCheck[checkKey]),
    total_count: Math.max(0, (underCheck[checkKey].check_runs?.length ?? 1) - 1)
  };
  const underCheckResult = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(underCheck)
  });
  assert.equal(underCheckResult.ok, false);
  assert.match(underCheckResult.reason, /total_count|disagrees|check runs/i);

  const missingJobs = clone(responses);
  delete missingJobs[jobsKey].total_count;
  const missingJobsResult = collectLiveExecutionFacts(root, {
    transport: createFixtureTransport(missingJobs)
  });
  assert.equal(missingJobsResult.ok, false);
  assert.match(missingJobsResult.reason, /total_count|missing|jobs/i);
});

test("gate-search-total-count-mismatch-fails-closed", async () => {
  // R12: gate PR search must honor total_count (not only items.length / incomplete_results).
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const key = Object.keys(responses).find((entry) => entry.includes("search/issues") && entry.includes("Gate-Batch"));
  assert.ok(key, "fixture gate search key");
  const mutant = clone(responses);
  mutant[key] = {
    total_count: 11,
    incomplete_results: false,
    items: [{ number: 200 }]
  };
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(mutant) });
  assert.equal(collected.ok, false, "elevated total_count must not collect as ok=true");
  assert.match(collected.reason, /total_count|truncat|gate PR|ambiguous|incomplete/i);
});

test("candidate-run-and-check-total-count-partial-fails-closed", async () => {
  // R12: workflow_runs / check_runs total_count above returned arrays must fail closed.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const runKey = Object.keys(responses).find(
    (entry) => entry.includes("actions/runs?head_sha=cafecafe") && entry.includes("pull_request")
  );
  const checkKey = Object.keys(responses).find((entry) => entry.includes("check-runs?per_page=50"));
  assert.ok(runKey && checkKey, "fixture candidate run/check keys");

  const runMutant = clone(responses);
  const runPayload = clone(runMutant[runKey]);
  runPayload.total_count = (runPayload.workflow_runs?.length ?? 0) + 5;
  runMutant[runKey] = runPayload;
  const runCollected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(runMutant) });
  assert.equal(runCollected.ok, false, "workflow_runs total_count mismatch must fail closed");
  assert.match(runCollected.reason, /total_count|truncat|workflow runs|partial/i);

  const checkMutant = clone(responses);
  const checkPayload = clone(checkMutant[checkKey]);
  checkPayload.total_count = (checkPayload.check_runs?.length ?? 0) + 3;
  checkMutant[checkKey] = checkPayload;
  const checkCollected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(checkMutant) });
  assert.equal(checkCollected.ok, false, "check_runs total_count mismatch must fail closed");
  assert.match(checkCollected.reason, /total_count|truncat|check runs|partial/i);
});

test("formal-pr-reviews-paginate-or-fail-closed-on-full-page", async () => {
  // R12: formal reviews must not silently stop at the first full page.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const reviewKey = "repos/MongLong0214/agent-operator-score/pulls/300/reviews";
  assert.ok(Object.hasOwn(responses, reviewKey));
  const fullPage = [];
  for (let i = 0; i < 30; i += 1) {
    fullPage.push({
      id: 5000 + i,
      state: "COMMENTED",
      commit_id: "cafecafecafecafecafecafecafecafecafecafe",
      user: { login: "MongLong0214" }
    });
  }
  const truncated = clone(responses);
  truncated[reviewKey] = fullPage;
  const failed = collectLiveExecutionFacts(root, { transport: createFixtureTransport(truncated) });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /review|truncat|page|unavailable/i);

  const page2 = [
    {
      id: 6001,
      state: "APPROVED",
      commit_id: "cafecafecafecafecafecafecafecafecafecafe",
      user: { login: "MongLong0214" }
    }
  ];
  const multipage = clone(responses);
  multipage[reviewKey] = fullPage;
  multipage[`${reviewKey}?page=2`] = page2;
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(multipage) });
  assert.equal(collected.ok, true, collected.reason);
  assert.ok(
    collected.facts.reviews.some(
      (entry) => entry.ticket_id === "D0-004" && entry.decision === "approved"
    ),
    "page-2 APPROVED review must be collected"
  );
});

test("executable-ticket-missing-or-malformed-declared-ownership-fails-closed", async () => {
  // R11: missing/malformed declared owned_paths/owned_symbols must not authorize RED packet.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  delete facts.tickets["D0-004"].owned_paths;
  delete facts.tickets["D0-004"].owned_symbols;
  facts.activeOwnership = [];
  const { result } = await resolveOffline(facts);
  assert.equal(result.readySet.includes("D0-004"), false);
  const d0004 = result.tickets?.["D0-004"];
  if (d0004) {
    assert.notEqual(d0004.readiness, "ready");
    assert.equal(d0004.packet, null);
  }
  const codes = [
    ...(d0004 ? blockerCodes(d0004) : []),
    ...(result.errors ?? []).map((entry) => entry.code)
  ];
  assert.ok(
    codes.includes("TICKET_CONTRACT_INCOMPLETE") || codes.includes("RED_CONTRACT_INVALID"),
    `expected ownership contract blocker, got ${codes.join(",")}`
  );

  const emptyPaths = makeReadyD0004Facts(loadBaselineFacts());
  emptyPaths.tickets["D0-004"].owned_paths = [];
  emptyPaths.tickets["D0-004"].owned_symbols = [];
  emptyPaths.activeOwnership = [];
  const { result: emptyResult } = await resolveOffline(emptyPaths);
  assert.equal(emptyResult.readySet.includes("D0-004"), false);
  const emptyTicket = emptyResult.tickets?.["D0-004"];
  if (emptyTicket) assert.notEqual(emptyTicket.readiness, "ready");
  const emptyCodes = [
    ...(emptyTicket ? blockerCodes(emptyTicket) : []),
    ...(emptyResult.errors ?? []).map((entry) => entry.code)
  ];
  assert.ok(
    emptyCodes.includes("TICKET_CONTRACT_INCOMPLETE") || emptyCodes.includes("RED_CONTRACT_INVALID"),
    `expected empty-path ownership contract blocker, got ${emptyCodes.join(",")}`
  );
});

test("live-collector-paginates-or-fails-closed-on-truncated-open-pulls", async () => {
  // R11: first-page-only open PR collection must not omit later ownership lanes.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const baseKey = "repos/MongLong0214/agent-operator-score/pulls?state=open&base=dev&per_page=50";
  const tip = "c8937c6c31ef034535f7c2e8276514221a12fd55";
  const originalOpen = responses[baseKey];
  assert.ok(Array.isArray(originalOpen) && originalOpen.length >= 1);
  const sharedHead = originalOpen[0].head.sha;
  // Page 1 is full of non-ticket PRs so candidate CI is not required for them.
  // Shared head SHA keeps workflow-blob probes within fixture coverage.
  const page1 = [];
  for (let i = 1; i <= 50; i += 1) {
    page1.push({
      number: 1000 + i,
      body: "chore: no ticket field",
      base: { ref: "dev", sha: tip },
      head: { sha: sharedHead },
      state: "open",
      user: { login: "MongLong0214" },
      labels: []
    });
  }
  // Canonical ticket candidate lives on page 2 — must not be dropped.
  const page2 = originalOpen;
  const multipage = clone(responses);
  multipage[baseKey] = page1;
  multipage[`${baseKey}&page=2`] = page2;
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(multipage) });
  assert.equal(collected.ok, true, collected.reason);
  assert.ok(
    collected.facts.prs.some((pr) => pr.number === originalOpen[0].number),
    "collector must include open PRs beyond the first page"
  );
  assert.ok(
    collected.facts.activeOwnership.some((entry) => entry.ticket_id === "D0-004"),
    "collector must surface page-2 ownership lanes"
  );

  // Truncation without a subsequent page must fail closed.
  const truncated = clone(responses);
  truncated[baseKey] = page1;
  const failed = collectLiveExecutionFacts(root, { transport: createFixtureTransport(truncated) });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /truncat|page|pull list|open pull|pagination|unavailable/i);
});

test("ready-ticket-no-self-active-ownership-declared-path-and-symbol-overlap-fails-closed", async () => {
  // R10: declared owned_paths/owned_symbols must collide against active lanes even without a self row.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  assert.ok((facts.tickets["D0-004"].owned_paths ?? []).includes("scripts/resolve-execution-state.mjs"));
  assert.ok((facts.tickets["D0-004"].owned_symbols ?? []).includes("resolveExecutionState"));
  // Mutant: D0-004 has no self activeOwnership row; another active lane owns its declared path+symbol.
  facts.activeOwnership = [
    {
      ticket_id: "E0A-001",
      pr_number: 999,
      head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["resolveExecutionState"]
    }
  ];
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.equal(d0004.readiness, "blocked");
  assert.ok(
    blockerCodes(d0004).includes("OWNERSHIP_OVERLAP"),
    `expected OWNERSHIP_OVERLAP without self row, got ${blockerCodes(d0004).join(",")}`
  );
  assert.equal(result.readySet.includes("D0-004"), false);

  // Duplicate/ambiguous self rows also fail closed.
  const dup = clone(facts);
  dup.activeOwnership = [
    {
      ticket_id: "D0-004",
      pr_number: 150,
      head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["resolveExecutionState"]
    },
    {
      ticket_id: "D0-004",
      pr_number: 151,
      head_sha: "cccccccccccccccccccccccccccccccccccccccc",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["resolveExecutionState"]
    }
  ];
  const { result: dupResult } = await resolveOffline(dup);
  assert.ok(blockerCodes(ticketState(dupResult, "D0-004")).includes("OWNERSHIP_OVERLAP"));
  assert.equal(dupResult.readySet.includes("D0-004"), false);
});

test("collector-to-resolver-live-owned-paths-symbols-overlap-fails-closed", async () => {
  // R9: live collector emits owned_paths/owned_symbols; ownershipCollisions must consume them.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const liveSelf = collected.facts.activeOwnership.find((entry) => entry.ticket_id === "D0-004");
  assert.ok(liveSelf, "collector must emit activeOwnership for D0-004");
  assert.ok(Array.isArray(liveSelf.owned_paths) && liveSelf.owned_paths.includes("scripts/resolve-execution-state.mjs"));
  assert.ok(Array.isArray(liveSelf.owned_symbols));
  assert.equal(Object.hasOwn(liveSelf, "paths"), false, "collector must not emit legacy paths key");
  assert.equal(Object.hasOwn(liveSelf, "symbols"), false, "collector must not emit legacy symbols key");

  // Mutant second active ticket overlaps collector-shaped owned_paths (not legacy paths/symbols).
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.activeOwnership = [
    {
      ticket_id: "D0-004",
      pr_number: 150,
      head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["resolveExecutionState"]
    },
    {
      ticket_id: "E0A-001",
      pr_number: 999,
      head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["not-the-same"]
    }
  ];
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.equal(d0004.readiness, "blocked");
  assert.ok(
    blockerCodes(d0004).includes("OWNERSHIP_OVERLAP"),
    `expected OWNERSHIP_OVERLAP from owned_paths contract, got ${blockerCodes(d0004).join(",")}`
  );

  // Symbol-only overlap on the same canonical fields also fails closed.
  const symbolFacts = clone(facts);
  symbolFacts.activeOwnership = [
    {
      ticket_id: "D0-004",
      pr_number: 150,
      head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      owned_paths: ["scripts/resolve-execution-state.mjs"],
      owned_symbols: ["resolveExecutionState"]
    },
    {
      ticket_id: "E0A-001",
      pr_number: 999,
      head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      owned_paths: ["unrelated/other.mjs"],
      owned_symbols: ["resolveExecutionState"]
    }
  ];
  const { result: symbolResult } = await resolveOffline(symbolFacts);
  assert.ok(blockerCodes(ticketState(symbolResult, "D0-004")).includes("OWNERSHIP_OVERLAP"));

  // Legacy paths/symbols without owned_* must not validate as a silent no-op contract.
  const legacy = clone(facts);
  legacy.activeOwnership = [
    {
      ticket_id: "D0-004",
      pr_number: 150,
      head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      paths: ["scripts/resolve-execution-state.mjs"],
      symbols: ["resolveExecutionState"]
    },
    {
      ticket_id: "E0A-001",
      pr_number: 999,
      head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      paths: ["scripts/resolve-execution-state.mjs"],
      symbols: ["other"]
    }
  ];
  const { result: legacyResult } = await resolveOffline(legacy);
  const legacyCodes = [
    ...(legacyResult.tickets?.["D0-004"] ? blockerCodes(legacyResult.tickets["D0-004"]) : []),
    ...(legacyResult.errors ?? []).map((e) => e.code)
  ];
  assert.ok(
    legacyCodes.includes("OWNERSHIP_OVERLAP") || legacyCodes.includes("TICKET_CONTRACT_INCOMPLETE"),
    `legacy paths/symbols must fail closed, got ${legacyCodes.join(",")}`
  );
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
// Post-C live-collector proof: valid protected exact-head-review /
// exact-head-authorization technical checks must clear CUMULATIVE_REVIEW_MISSING
// and MERGE_AUTHORIZATION_MISSING using facts a real collector would produce —
// no review or authorization fact is ever injected into these fixtures.
// ---------------------------------------------------------------------------

const POST_C_REPO_PATH = "repos/MongLong0214/agent-operator-score";
const POST_C_DEV_TIP = "c8937c6c31ef034535f7c2e8276514221a12fd55";
const POST_C_HEAD = "cafecafecafecafecafecafecafecafecafecafe";
const POST_C_OPS_WORKFLOW_PATH = ".github/workflows/operational-state.yml";

// D0-004's owning PRD/ADR gates are waived pre-C but required once d0_004c_merged is
// true (ADR-0012's own bootstrap-ends contract). The shared live fixture's existing
// "batch-d0-004-fixture" registry row is stale against current live digests (it predates
// later content edits), so reaching the review/authorization evaluation post-C requires
// a freshly accepted batch bound to the fixture's actual current live digests below.
const GATE_BATCH_ID = "batch-d0-004-post-c-live-review";
const GATE_PR_NUMBER = 250;
const GATE_HEAD_SHA = `${"1".repeat(36)}aaaa`;
const GATE_MERGE_SHA = `${"2".repeat(36)}bbbb`;

function withPostCGateAcceptance(responses) {
  const p = POST_C_REPO_PATH;
  const registryRawKey = `raw:${p}/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${POST_C_DEV_TIP}`;
  const registry = JSON.parse(responses[registryRawKey]);

  const artifacts = [
    {
      path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
      sha256: "fd7189fbb8beb4264b9ef75b2be254d0a13f8aaaa41f5fdc70efa869de222c71",
      kind: "TICKET"
    },
    {
      path: "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
      sha256: "54176e5e87b72e27069ddd277291982019a96621218860e8546e0259e32e9115",
      kind: "PRD"
    },
    {
      path: "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
      sha256: "88c84ba1db660d2630be4d3203c20a32c81915f1b8485a61eb5f4bc28293a108",
      kind: "ADR"
    },
    {
      path: "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
      sha256: "8dc3e44df832d6a33813420ecd5f544af14d52c308faf956fbf82f0ab10a72c4",
      kind: "ADR"
    },
    {
      path: "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md",
      sha256: "02ae85f74bf4c1e572c17e1f1832194df710d736dc56a6b3b7dc1c14c68b8459",
      kind: "ADR"
    }
  ];
  const newBatch = {
    id: GATE_BATCH_ID,
    status: "ACCEPTED",
    required_artifacts: artifacts,
    scope: "post-c-live-review-fixture",
    target: {
      repository: "github.com/MongLong0214/agent-operator-score",
      branch: "dev",
      reviewed_head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    required_transitions: ["ADR_ACCEPTED", "PRD_ACCEPTED", "TICKET_READY_FOR_RED"],
    transitions: [{ name: "ADR_ACCEPTED" }, { name: "PRD_ACCEPTED" }, { name: "TICKET_READY_FOR_RED" }],
    artifacts
  };
  registry.batches = [...registry.batches, newBatch];
  const registryText = JSON.stringify(registry);

  responses[registryRawKey] = registryText;
  responses[`${p}/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${POST_C_DEV_TIP}`] = {
    sha: "registry-blob-postc-devtip",
    path: "docs/decisions/maintainer-gate-registry.v2.json"
  };

  const searchKey = `search/issues?q=${encodeURIComponent(
    `repo:MongLong0214/agent-operator-score is:pr is:merged "Gate-Batch: ${GATE_BATCH_ID}"`
  )}&per_page=10`;
  responses[searchKey] = { total_count: 1, incomplete_results: false, items: [{ number: GATE_PR_NUMBER }] };

  responses[`${p}/pulls/${GATE_PR_NUMBER}`] = {
    number: GATE_PR_NUMBER,
    body: `Gate-Batch: ${GATE_BATCH_ID}\n`,
    base: { ref: "dev" },
    head: { sha: GATE_HEAD_SHA },
    merged: true,
    merged_by: { login: "MongLong0214" },
    merge_commit_sha: GATE_MERGE_SHA,
    user: { login: "MongLong0214" }
  };

  // The gate PR's head registry must bind the identical ACCEPTED batch record.
  responses[`raw:${p}/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${GATE_HEAD_SHA}`] = registryText;
  responses[`${p}/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${GATE_HEAD_SHA}`] = {
    sha: "registry-blob-postc-gatehead",
    path: "docs/decisions/maintainer-gate-registry.v2.json"
  };

  responses[`${p}/actions/runs?head_sha=${GATE_MERGE_SHA}&event=push&per_page=20`] = {
    workflow_runs: [
      {
        id: 6001,
        name: "CI",
        path: ".github/workflows/ci.yml",
        head_sha: GATE_MERGE_SHA,
        status: "completed",
        conclusion: "success",
        run_attempt: 1,
        event: "push"
      }
    ],
    total_count: 1
  };

  return responses;
}

function loadPostCLiveResponses(mutate) {
  const base = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const p = POST_C_REPO_PATH;
  const responses = { ...base };

  // D0-004C merged: operational-state.yml now exists at the live dev tip and is
  // unchanged on the candidate head (bootstrap ends).
  responses[`${p}/contents/${POST_C_OPS_WORKFLOW_PATH}?ref=${POST_C_DEV_TIP}`] = {
    sha: "ops-workflow-blob-dev",
    path: POST_C_OPS_WORKFLOW_PATH
  };
  responses[`${p}/contents/${POST_C_OPS_WORKFLOW_PATH}?ref=${POST_C_HEAD}`] = {
    sha: "ops-workflow-blob-dev",
    path: POST_C_OPS_WORKFLOW_PATH
  };

  // Candidate CI now also carries the ordinary pull_request-triggered
  // operational-state-offline check (distinct from the two protected checks below).
  const ciRunsKey = `${p}/actions/runs?head_sha=${POST_C_HEAD}&event=pull_request&per_page=30`;
  const ciRuns = base[ciRunsKey];
  responses[ciRunsKey] = {
    workflow_runs: [
      ...ciRuns.workflow_runs,
      {
        id: 4002,
        name: "operational-state-offline",
        path: POST_C_OPS_WORKFLOW_PATH,
        head_sha: POST_C_HEAD,
        status: "completed",
        conclusion: "success",
        run_attempt: 1,
        event: "pull_request"
      }
    ],
    total_count: ciRuns.workflow_runs.length + 1
  };
  responses[`${p}/actions/runs/4002/attempts/1/jobs?per_page=50`] = {
    jobs: [
      {
        name: "operational-state-offline",
        status: "completed",
        conclusion: "success",
        check_run_url: `https://api.github.com/${p}/check-runs/9003`,
        run_id: 4002,
        run_attempt: 1
      }
    ],
    total_count: 1
  };

  const checksKey = `${p}/commits/${POST_C_HEAD}/check-runs?per_page=50`;
  const existingChecks = base[checksKey];
  responses[checksKey] = {
    check_runs: [
      ...existingChecks.check_runs,
      {
        name: "operational-state-offline",
        status: "completed",
        conclusion: "success",
        app: { id: 15368, slug: "github-actions" },
        external_id: null,
        id: 9003,
        run_id: 4002,
        run_attempt: 1
      },
      {
        name: "exact-head-review",
        status: "completed",
        conclusion: "success",
        app: { id: 15368, slug: "github-actions" },
        external_id: "aos-exact-head-review:5001:1",
        id: 9100,
        head_sha: POST_C_HEAD
      },
      {
        name: "exact-head-authorization",
        status: "completed",
        conclusion: "success",
        app: { id: 15368, slug: "github-actions" },
        external_id: "aos-exact-head-authorization:5002:1",
        id: 9101,
        head_sha: POST_C_HEAD
      }
    ],
    total_count: existingChecks.check_runs.length + 3
  };

  // The two protected checks are custom Checks-API rows minted by a maintainer-dispatched
  // workflow_dispatch run against trusted_ref refs/heads/dev; run_id/attempt come from the
  // check's own external_id (GitHub does not otherwise link a custom check to its creating
  // run), so the collector must fetch the run itself for event/path/actor provenance.
  responses[`${p}/actions/runs/5001`] = {
    id: 5001,
    event: "workflow_dispatch",
    path: POST_C_OPS_WORKFLOW_PATH,
    head_sha: POST_C_DEV_TIP,
    head_branch: "dev",
    run_attempt: 1,
    triggering_actor: { login: "MongLong0214" }
  };
  responses[`${p}/actions/runs/5002`] = {
    id: 5002,
    event: "workflow_dispatch",
    path: POST_C_OPS_WORKFLOW_PATH,
    head_sha: POST_C_DEV_TIP,
    head_branch: "dev",
    run_attempt: 1,
    triggering_actor: { login: "MongLong0214" }
  };

  withPostCGateAcceptance(responses);

  return mutate ? mutate(responses) ?? responses : responses;
}

async function resolvePostC(responses) {
  const { createFixtureTransport, acquireOnlineStrictFacts, resolveExecutionState } = await importResolver();
  const transport = createFixtureTransport(responses);
  const acquired = acquireOnlineStrictFacts(root, { transport });
  if (!acquired.ok) return { acquired, result: null };
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
  return { acquired, result };
}

test("live-collector-post-c-protected-checks-clear-review-and-authorization", async () => {
  const responses = loadPostCLiveResponses();
  const { acquired, result } = await resolvePostC(responses);
  assert.equal(acquired.ok, true, acquired.reason);
  assert.equal(acquired.facts.d0_004c_merged, true);
  // There is no `facts.authorizations` producer at all (none is built — see evaluateAuthorization);
  // the live collector never populates it, injected or otherwise.
  assert.deepEqual(acquired.facts.authorizations, []);
  // The candidate's GitHub PR review data (a self-review, since the sole collaborator is
  // the PR author) is real, unmodified live-collector output — not test-injected — and is
  // simply irrelevant now: evaluateReview never reads facts.reviews.

  const state = result.tickets["D0-004"];
  assert.ok(state, "missing D0-004 ticket state");
  const codes = (state.blockers ?? []).map((b) => b.code);
  assert.equal(codes.includes("CUMULATIVE_REVIEW_MISSING"), false);
  assert.equal(codes.includes("MERGE_AUTHORIZATION_MISSING"), false);
  assert.equal(result.claims_merge_authorization, false);
});

test("live-collector-post-c-wrong-dispatch-actor-is-blocked", async () => {
  const responses = loadPostCLiveResponses((r) => {
    r[`${POST_C_REPO_PATH}/actions/runs/5001`] = {
      ...r[`${POST_C_REPO_PATH}/actions/runs/5001`],
      triggering_actor: { login: "outside-contributor" }
    };
    r[`${POST_C_REPO_PATH}/collaborators/outside-contributor/permission`] = { permission: "read" };
  });
  const { acquired, result } = await resolvePostC(responses);
  assert.equal(acquired.ok, true, acquired.reason);
  const codes = (result.tickets["D0-004"].blockers ?? []).map((b) => b.code);
  assert.ok(codes.includes("CUMULATIVE_REVIEW_MISSING"));
});

test("live-collector-post-c-wrong-head-sha-is-blocked", async () => {
  const responses = loadPostCLiveResponses((r) => {
    const key = `${POST_C_REPO_PATH}/commits/${POST_C_HEAD}/check-runs?per_page=50`;
    r[key] = {
      ...r[key],
      check_runs: r[key].check_runs.map((check) =>
        check.name === "exact-head-review"
          ? { ...check, head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }
          : check
      )
    };
  });
  const { acquired, result } = await resolvePostC(responses);
  assert.equal(acquired.ok, true, acquired.reason);
  const codes = (result.tickets["D0-004"].blockers ?? []).map((b) => b.code);
  assert.ok(codes.includes("CUMULATIVE_REVIEW_MISSING"));
});

test("live-collector-post-c-wrong-workflow-blob-oid-versus-dev-is-blocked", async () => {
  const responses = loadPostCLiveResponses((r) => {
    const oldDevSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    r[`${POST_C_REPO_PATH}/actions/runs/5001`] = {
      ...r[`${POST_C_REPO_PATH}/actions/runs/5001`],
      head_sha: oldDevSha
    };
    r[`${POST_C_REPO_PATH}/contents/${POST_C_OPS_WORKFLOW_PATH}?ref=${oldDevSha}`] = {
      sha: "ops-workflow-blob-OLD",
      path: POST_C_OPS_WORKFLOW_PATH
    };
    // Isolate the blob-OID mismatch: oldDevSha is a genuine ancestor of live dev (an older,
    // still-reachable commit), so ancestry itself is not the reason this must block.
    r[`${POST_C_REPO_PATH}/compare/${POST_C_DEV_TIP}...${oldDevSha}`] = { status: "behind" };
  });
  const { acquired, result } = await resolvePostC(responses);
  assert.equal(acquired.ok, true, acquired.reason);
  const codes = (result.tickets["D0-004"].blockers ?? []).map((b) => b.code);
  assert.ok(codes.includes("CUMULATIVE_REVIEW_MISSING"));
});

test("live-collector-post-c-wrong-event-is-blocked", async () => {
  const responses = loadPostCLiveResponses((r) => {
    r[`${POST_C_REPO_PATH}/actions/runs/5001`] = {
      ...r[`${POST_C_REPO_PATH}/actions/runs/5001`],
      event: "push"
    };
  });
  const { acquired, result } = await resolvePostC(responses);
  assert.equal(acquired.ok, true, acquired.reason);
  const codes = (result.tickets["D0-004"].blockers ?? []).map((b) => b.code);
  assert.ok(codes.includes("CUMULATIVE_REVIEW_MISSING"));
});

test("live-collector-post-c-outage-or-ambiguous-protected-check-fails-closed", async () => {
  // Outage on the run-detail fetch that provides check provenance.
  {
    const responses = loadPostCLiveResponses((r) => {
      r[`${POST_C_REPO_PATH}/actions/runs/5001`] = null;
    });
    const { acquired } = await resolvePostC(responses);
    assert.equal(acquired.ok, false);
  }
  // Ambiguous: two check-runs sharing the same protected check name on one head.
  {
    const responses = loadPostCLiveResponses((r) => {
      const key = `${POST_C_REPO_PATH}/commits/${POST_C_HEAD}/check-runs?per_page=50`;
      const duplicate = { ...r[key].check_runs.find((c) => c.name === "exact-head-review"), id: 9102 };
      r[key] = {
        check_runs: [...r[key].check_runs, duplicate],
        total_count: r[key].check_runs.length + 1
      };
    });
    const { acquired } = await resolvePostC(responses);
    assert.equal(acquired.ok, false);
  }
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
      path:
        ticket.prd_path ??
        ticket.digests?.prd_path ??
        "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
      sha256: ticket.digests.prd,
      kind: "PRD"
    }
  ];
  for (const [adr, sha] of Object.entries(ticket.digests.adrs ?? {})) {
    artifacts.push({
      path:
        ticket.adr_paths?.[adr] ??
        ticket.digests?.adr_paths?.[adr] ??
        `docs/adr/${adr}-canonical-identity.md`,
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
