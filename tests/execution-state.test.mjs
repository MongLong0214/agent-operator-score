import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resolverPath = resolve(root, "scripts/resolve-execution-state.mjs");
const baselineFactsPath = resolve(root, "fixtures/operational-state/current-baseline/facts.json");

const loadBaselineFacts = () => JSON.parse(readFileSync(baselineFactsPath, "utf8"));
const loadCommittedOperationalAuthority = () =>
  JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8")).operational_authority;
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

const sha256Utf8 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const withFakeGh = (options, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "aos-fake-gh-"));
  const ghPath = join(dir, "gh");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const apiPath = process.argv[2] === "api" ? process.argv[3] : process.argv[2];
if (process.env.AOS_FAKE_GH_MODE === "ratelimit" && apiPath === "repos/limited/second") {
  process.stderr.write("gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)\\n");
  process.exit(1);
}
if (process.env.AOS_FAKE_GH_MODE === "hang-second" && apiPath === "repos/timeout/second") {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const pad = "p".repeat(Number(process.env.AOS_FAKE_GH_PAD || "0"));
process.stdout.write(JSON.stringify({ path: apiPath, pad }));
`
  );
  chmodSync(ghPath, 0o755);
  const previous = {
    PATH: process.env.PATH,
    AOS_FAKE_GH_PAD: process.env.AOS_FAKE_GH_PAD,
    AOS_FAKE_GH_MODE: process.env.AOS_FAKE_GH_MODE
  };
  process.env.PATH = `${dir}${previous.PATH ? `:${previous.PATH}` : ""}`;
  if (options.pad != null) process.env.AOS_FAKE_GH_PAD = String(options.pad);
  else delete process.env.AOS_FAKE_GH_PAD;
  if (options.mode != null) process.env.AOS_FAKE_GH_MODE = options.mode;
  else delete process.env.AOS_FAKE_GH_MODE;
  try {
    return fn();
  } finally {
    process.env.PATH = previous.PATH;
    if (previous.AOS_FAKE_GH_PAD == null) delete process.env.AOS_FAKE_GH_PAD;
    else process.env.AOS_FAKE_GH_PAD = previous.AOS_FAKE_GH_PAD;
    if (previous.AOS_FAKE_GH_MODE == null) delete process.env.AOS_FAKE_GH_MODE;
    else process.env.AOS_FAKE_GH_MODE = previous.AOS_FAKE_GH_MODE;
    rmSync(dir, { recursive: true, force: true });
  }
};

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

/**
 * A completion merge now owes evidence that what it introduced is still in the live tree,
 * so a case whose real subject is something else (post-merge CI, reachability, marker
 * grammar) must supply a still-present introduced-path set or it fails on the newer
 * completion-effect check instead of the requirement it was written for. Records the paths
 * on the receipt and mirrors them into facts.liveTreePaths.
 */
const withPresentEffect = (facts, entry, paths) => {
  const introduced = paths ?? [`docs/effect/${entry.merge_commit_sha.slice(0, 8)}.md`];
  facts.liveTreePaths = [...(facts.liveTreePaths ?? []), ...introduced];
  // The removed set is the other half of the same evidence and is owed on the same terms: a
  // case about post-merge CI or marker grammar states "this merge deleted nothing" rather
  // than declining to say, because silence there is what the check exists to refuse.
  return { ...entry, added_paths: introduced, removed_paths: [] };
};

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

test("executable-ticket-still-requires-authority", async () => {
  const facts = loadBaselineFacts();
  const ticketPath = "docs/tickets/D0/D0-005-governance-mode-contract-and-advisory-boundary.md";
  const prdPath = "docs/prd/PRD-D0-GOV-authenticated-governance-repair.md";
  const adr0012Path = "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md";
  const adr0013Path = "docs/adr/ADR-0013-authenticated-governance-modes-and-legacy-quarantine.md";
  const ticketDigest = "d005d005d005d005d005d005d005d005d005d005d005d005d005d005d005d005";
  const prdDigest = "d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0d0a0";
  const adr0012Digest = "1212121212121212121212121212121212121212121212121212121212121212";
  const adr0013Digest = "1313131313131313131313131313131313131313131313131313131313131313";
  facts.d0_004c_merged = true;
  facts.liveDigests[ticketPath] = ticketDigest;
  facts.liveDigests[prdPath] = prdDigest;
  facts.liveDigests[adr0012Path] = adr0012Digest;
  facts.liveDigests[adr0013Path] = adr0013Digest;
  facts.tickets["D0-005"] = {
    kind: "executable",
    dependencies: [],
    owned_paths: ["tests/planning-contract.test.mjs"],
    owned_symbols: ["validateNumericBindings"],
    red_command: "node --test tests/planning-contract.test.mjs",
    digests: {
      ticket: ticketDigest,
      prd: prdDigest,
      adrs: { "ADR-0012": adr0012Digest, "ADR-0013": adr0013Digest },
      prd_path: prdPath,
      adr_paths: { "ADR-0012": adr0012Path, "ADR-0013": adr0013Path }
    },
    prd_path: prdPath,
    adr_paths: { "ADR-0012": adr0012Path, "ADR-0013": adr0013Path }
  };
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-005");
  assert.equal(state.phase, "gate_preparation");
  assert.equal(state.readiness, "blocked");
  assert.ok(blockerCodes(state).includes("PRD_GATE_MISSING"));
  assert.ok(blockerCodes(state).includes("TICKET_GATE_MISSING"));
  assert.equal(result.readySet.includes("D0-005"), false);
  assert.equal(state.red_authorized, false);
  assert.equal(state.packet, null);
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

const assertRequiredChecksMutationIsRejected = async (mutate) => {
  const facts = loadBaselineFacts();
  facts.operationalAuthority = clone(loadCommittedOperationalAuthority());

  const baseline = await resolveOffline(facts);
  assert.equal(
    baseline.result.errors.some((entry) => entry.code === "TICKET_CONTRACT_CONFLICT"),
    false,
    "the unmodified committed required_checks policy must agree with the resolver"
  );

  mutate(facts.operationalAuthority.candidate_ci.required_checks);
  const { result } = await resolveOffline(facts);
  assert.deepEqual(result.readySet, []);
  assert.ok(result.errors.some((entry) => entry.code === "TICKET_CONTRACT_CONFLICT"));
};

test("actor-policy-rejects-empty-required-checks", async () => {
  await assertRequiredChecksMutationIsRejected((requiredChecks) => {
    requiredChecks.length = 0;
  });
});

test("actor-policy-rejects-reordered-required-checks", async () => {
  await assertRequiredChecksMutationIsRejected((requiredChecks) => {
    requiredChecks.reverse();
  });
});

test("actor-policy-rejects-renamed-required-check", async () => {
  await assertRequiredChecksMutationIsRejected((requiredChecks) => {
    requiredChecks[0].name = "planning-contract (changed)";
  });
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
  // and post-merge CI run are exact historical facts, and D0-002 is one of the two
  // explicit legacy completion exceptions (see HISTORICAL_IMPLEMENTATION_LINKAGE). PR #143's
  // body correctly has no `Ticket: D0-002` line (retroactively adding one is a separately-
  // authorized metadata correction, not performed here), so dependency verification must be
  // satisfied by the legacy-bound historical merge + post-merge CI facts alone, without a
  // structured Ticket-field/Ticket-Completion-field link. The current-baseline fixture
  // already carries this exact legacy receipt (see legacy-completion-exception-* tests);
  // only gate acceptance is added here.
  const facts = loadBaselineFacts();
  acceptGatesFor(facts, "D0-002", "batch-d0-002-historical");
  assert.ok(
    facts.implementationMerges.some(
      (entry) => entry.ticket_id === "D0-002" && entry.number === 143 && entry.reachable === true
    ),
    "current-baseline fixture must already carry the D0-002 legacy completion receipt"
  );
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

// ---------------------------------------------------------------------------
// Universal Ticket-Completion marker semantics (approved D0-004 contract amendment):
// completion resolution is identical at every implementation-merge receipt count,
// including zero and one — there is no receipt-count-inferred exception anywhere. The
// sole exceptions are the two explicit legacy completion bindings (D0-001 PR #130,
// D0-002 PR #143), matched only on their exact PR number and merge commit SHA, and even
// those still require authenticated reachability and successful post-merge CI.
// ---------------------------------------------------------------------------

test("universal-marker-semantics-zero-receipts-is-unverified-not-error", async () => {
  // The rejected prior implementation treated zero implementation-merge receipts as an
  // automatic verification pass. Zero completion markers must never verify and must
  // never itself be a fail-closed error, at any receipt count including zero.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  // The baseline fixture already carries zero D0-004 implementation-merge receipts (only
  // D0-001's and D0-002's own legacy-bound receipts) — left untouched so D0-002's dependency
  // verification is unaffected by this D0-004-focused assertion.
  assert.equal(facts.implementationMerges.some((entry) => entry.ticket_id === "D0-004"), false);
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.notEqual(d0004.phase, "verified", `zero receipts must never auto-verify, got phase=${d0004.phase}`);
  // Zero completion markers is never itself a fail-closed error: with an accepted gate and
  // satisfied dependencies, an unimplemented D0-004 legitimately remains ready to start
  // (readiness is orthogonal to whole-ticket completion), never merged_pending_post_ci.
  assert.deepEqual(blockerCodes(d0004), []);
  assert.notEqual(d0004.phase, "merged_pending_post_ci");
});

test("legacy-ticket-without-a-recorded-legacy-entry-is-unverified-not-error", async () => {
  // Being a legacy-eligible ticket id is never itself sufficient — the exception only ever
  // applies to an actually recorded receipt matching the exact declared PR number and SHA.
  const facts = loadBaselineFacts();
  facts.implementationMerges = [];
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.deepEqual(blockerCodes(d0001), []);
});

test("universal-marker-semantics-single-receipt-without-marker-is-unverified-not-error", async () => {
  // The rejected prior implementation verified a ticket with exactly one implementation
  // merge whenever that single receipt's post-merge CI passed, regardless of any
  // completion marker. A lone receipt never bypasses the marker requirement.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const sha = "400a400a400a400a400a400a400a400a400a400a";
  // Append, never replace: D0-002's own baseline legacy receipt must survive so D0-002's
  // dependency verification is unaffected by this D0-004-focused assertion.
  facts.implementationMerges = [
    ...facts.implementationMerges,
    {
      ticket_id: "D0-004",
      merge_commit_sha: sha,
      number: 400,
      body: "Ticket: D0-004\n\nplain contributing merge, no completion marker.",
      reachable: true
    }
  ];
  facts.postMergeCI.push({
    merge_commit_sha: sha,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    run_id: 400,
    run_attempt: 1
  });
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.notEqual(
    d0004.phase,
    "verified",
    `a single receipt without a completion marker must never auto-verify regardless of passing CI, got phase=${d0004.phase}`
  );
  assert.deepEqual(blockerCodes(d0004), []);
});

test("universal-marker-semantics-single-receipt-with-valid-marker-verifies", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const sha = "401a401a401a401a401a401a401a401a401a401a";
  facts.implementationMerges = [
    withPresentEffect(facts, {
      ticket_id: "D0-004",
      merge_commit_sha: sha,
      number: 401,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      reachable: true
    })
  ];
  facts.postMergeCI.push({
    merge_commit_sha: sha,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    run_id: 401,
    run_attempt: 1
  });
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.equal(d0004.phase, "verified");
  assert.equal(d0004.readiness, "terminal");
  assert.deepEqual(blockerCodes(d0004), []);
});

test("classify-completion-merge-exact-single-field-grammar", async () => {
  const { classifyCompletionMerge } = await importResolver();

  // No Ticket-Completion line at all: plain contributing merge, never a failure.
  const absent = classifyCompletionMerge("Ticket: D0-004\n\nplain contributing merge.", "D0-004");
  assert.equal(absent.isCompletion, false);
  assert.equal(absent.failClosed, false);

  // Ticket-Completion present but no Ticket: line on the same body: not a completion
  // merge, and not a failure either — Ticket-Completion never links on its own.
  const noTicketLine = classifyCompletionMerge("Ticket-Completion: D0-004", "D0-004");
  assert.equal(noTicketLine.isCompletion, false);
  assert.equal(noTicketLine.failClosed, false);

  // Exact match on both fields: the unique completion merge.
  const matched = classifyCompletionMerge("Ticket: D0-004\nTicket-Completion: D0-004", "D0-004");
  assert.equal(matched.isCompletion, true);
  assert.equal(matched.failClosed, false);

  // Ticket-Completion value disagrees with this PR's own Ticket: value: fail closed.
  const mismatch = classifyCompletionMerge("Ticket: D0-004\nTicket-Completion: D0-005", "D0-004");
  assert.equal(mismatch.isCompletion, false);
  assert.equal(mismatch.failClosed, true);

  // Duplicated Ticket-Completion lines on one PR body: malformed, fail closed.
  const malformed = classifyCompletionMerge(
    "Ticket: D0-004\nTicket-Completion: D0-004\nTicket-Completion: D0-004",
    "D0-004"
  );
  assert.equal(malformed.isCompletion, false);
  assert.equal(malformed.failClosed, true);

  // Ticket: field links to a different ticket entirely: irrelevant to this ticketId.
  const otherTicket = classifyCompletionMerge("Ticket: D0-005\nTicket-Completion: D0-005", "D0-004");
  assert.equal(otherTicket.isCompletion, false);
  assert.equal(otherTicket.failClosed, false);
});

test("single-valid-completion-marker-verifies-ticket-despite-plain-contributing-merges", async () => {
  // Once a genuine completion merge (#146 here) carries a matching Ticket-Completion
  // marker with authenticated reachability and successful post-merge CI, D0-004 must
  // verify even though #135/#136 remain plain contributing merges with no marker.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const sha135 = "135a135a135a135a135a135a135a135a135a135a";
  const sha136 = "136b136b136b136b136b136b136b136b136b136b";
  const sha146 = "146c146c146c146c146c146c146c146c146c146c";
  facts.implementationMerges = [
    { ticket_id: "D0-004", merge_commit_sha: sha135, number: 135, body: "Ticket: D0-004\n\ndocs: define single operational state author." },
    { ticket_id: "D0-004", merge_commit_sha: sha136, number: 136, body: "Ticket: D0-004\n\ndocs: close D0-004 operational authority gap." },
    withPresentEffect(facts, {
      ticket_id: "D0-004",
      merge_commit_sha: sha146,
      number: 146,
      body: "Ticket: D0-004\nTicket-Completion: D0-004\n\nD0-004 whole-ticket completion merge.",
      reachable: true
    })
  ];
  facts.postMergeCI.push(
    { merge_commit_sha: sha135, head_sha: sha135, status: "completed", conclusion: "success", run_id: 135, run_attempt: 1 },
    { merge_commit_sha: sha136, head_sha: sha136, status: "completed", conclusion: "success", run_id: 136, run_attempt: 1 },
    { merge_commit_sha: sha146, head_sha: sha146, status: "completed", conclusion: "success", run_id: 146, run_attempt: 1 }
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(state.phase, "verified");
  assert.equal(state.readiness, "terminal");
  assert.deepEqual(blockerCodes(state), []);
});

test("duplicate-completion-markers-for-same-ticket-fail-closed", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const shaA = "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0";
  const shaB = "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
  facts.implementationMerges = [
    { ticket_id: "D0-004", merge_commit_sha: shaA, number: 301, body: "Ticket: D0-004\nTicket-Completion: D0-004", reachable: true },
    { ticket_id: "D0-004", merge_commit_sha: shaB, number: 302, body: "Ticket: D0-004\nTicket-Completion: D0-004", reachable: true }
  ];
  facts.postMergeCI.push(
    { merge_commit_sha: shaA, head_sha: shaA, status: "completed", conclusion: "success", run_id: 301, run_attempt: 1 },
    { merge_commit_sha: shaB, head_sha: shaB, status: "completed", conclusion: "success", run_id: 302, run_attempt: 1 }
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("TICKET_CONTRACT_CONFLICT"));
  assert.equal(result.readySet.includes("D0-004"), false);
});

test("completion-marker-value-mismatch-fails-closed-at-resolver-level", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const shaA = "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1";
  const shaB = "c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2";
  facts.implementationMerges = [
    // Ticket-Completion claims a different ticket than this PR's own Ticket: field.
    { ticket_id: "D0-004", merge_commit_sha: shaA, number: 303, body: "Ticket: D0-004\nTicket-Completion: D0-005" },
    { ticket_id: "D0-004", merge_commit_sha: shaB, number: 304, body: "Ticket: D0-004\n\nplain contributing merge." }
  ];
  facts.postMergeCI.push(
    { merge_commit_sha: shaA, head_sha: shaA, status: "completed", conclusion: "success", run_id: 303, run_attempt: 1 },
    { merge_commit_sha: shaB, head_sha: shaB, status: "completed", conclusion: "success", run_id: 304, run_attempt: 1 }
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("TICKET_CONTRACT_CONFLICT"));
});

test("malformed-duplicated-completion-field-fails-closed-at-resolver-level", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const shaA = "d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1";
  const shaB = "d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2";
  facts.implementationMerges = [
    {
      ticket_id: "D0-004",
      merge_commit_sha: shaA,
      number: 305,
      body: "Ticket: D0-004\nTicket-Completion: D0-004\nTicket-Completion: D0-004"
    },
    { ticket_id: "D0-004", merge_commit_sha: shaB, number: 306, body: "Ticket: D0-004\n\nplain contributing merge." }
  ];
  facts.postMergeCI.push(
    { merge_commit_sha: shaA, head_sha: shaA, status: "completed", conclusion: "success", run_id: 305, run_attempt: 1 },
    { merge_commit_sha: shaB, head_sha: shaB, status: "completed", conclusion: "success", run_id: 306, run_attempt: 1 }
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("TICKET_CONTRACT_CONFLICT"));
});

test("completion-merge-post-merge-ci-missing-fails-closed", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const shaPlain = "e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1";
  const shaCompletion = "e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2";
  facts.implementationMerges = [
    { ticket_id: "D0-004", merge_commit_sha: shaPlain, number: 307, body: "Ticket: D0-004\n\nplain contributing merge." },
    withPresentEffect(facts, {
      ticket_id: "D0-004",
      merge_commit_sha: shaCompletion,
      number: 308,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      reachable: true
    })
  ];
  // Only the plain merge gets a post-merge CI row; the completion merge's is missing.
  facts.postMergeCI.push({
    merge_commit_sha: shaPlain,
    head_sha: shaPlain,
    status: "completed",
    conclusion: "success",
    run_id: 307,
    run_attempt: 1
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("POST_MERGE_CI_MISSING"));
});

// ---------------------------------------------------------------------------
// Authenticated descendant CI as post-merge fallback (issue #283).
//
// Restoring Ticket-Completion: E8-004 onto PR #259 (merge 9f515bf) puts the
// receipt back on the Form A work. Exact-SHA CI on that merge is permanently
// queued, so the current exact-SHA-only rule would send the ticket back to
// POST_MERGE_CI_MISSING. A later successful CI run whose head is authenticated
// as merge <= head <= live tip is the accepted fallback. A sibling row that
// merely appears in the same fixture is not a descendant.
// ---------------------------------------------------------------------------

const WEDGED_E8004_MERGE_SHA = "9f515bfa3a5b284e323baed08de166d88a8d7c88";
const DESCENDANT_LIVE_TIP_SHA = "d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1";
const SIBLING_CI_SHA = "e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3";
const AHEAD_OF_TIP_SHA = "f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4";
const FORM_A_INTRODUCED_PATHS = [
  "conformance/form-a/form-a.test.ts",
  "packages/runner/src/assessment.ts",
  "suites/coding-core-v0/form-a/manifest.json"
];

const makeRestoredWedgedCompletionFacts = ({
  includeDescendantSuccess = true,
  authenticateDescendant = true,
  includeSiblingSuccess = false,
  authenticateSibling = false,
  descendantAheadOfTip = false,
  exactStatus = "queued",
  exactConclusion = null,
  descendantConclusion = "success"
} = {}) => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  facts.currentHead = DESCENDANT_LIVE_TIP_SHA;
  facts.implementationMerges = [
    withPresentEffect(
      facts,
      {
        ticket_id: "D0-004",
        merge_commit_sha: WEDGED_E8004_MERGE_SHA,
        number: 259,
        body: "Ticket: D0-004\nTicket-Completion: D0-004",
        reachable: true
      },
      FORM_A_INTRODUCED_PATHS
    )
  ];
  facts.postMergeCI.push({
    merge_commit_sha: WEDGED_E8004_MERGE_SHA,
    head_sha: WEDGED_E8004_MERGE_SHA,
    status: exactStatus,
    conclusion: exactConclusion,
    run_id: 32213166652,
    run_attempt: 1
  });
  facts.ancestry = {};
  if (authenticateDescendant) {
    facts.ancestry[`${DESCENDANT_LIVE_TIP_SHA}...${WEDGED_E8004_MERGE_SHA}`] = "behind";
  }
  if (includeDescendantSuccess) {
    const descendantHead = descendantAheadOfTip ? AHEAD_OF_TIP_SHA : DESCENDANT_LIVE_TIP_SHA;
    facts.postMergeCI.push({
      merge_commit_sha: descendantHead,
      head_sha: descendantHead,
      status: "completed",
      conclusion: descendantConclusion,
      run_id: 33000000001,
      run_attempt: 1
    });
    if (descendantAheadOfTip) {
      facts.ancestry[`${WEDGED_E8004_MERGE_SHA}...${AHEAD_OF_TIP_SHA}`] = "ahead";
      facts.ancestry[`${DESCENDANT_LIVE_TIP_SHA}...${AHEAD_OF_TIP_SHA}`] = "ahead";
    }
  }
  if (includeSiblingSuccess) {
    facts.postMergeCI.push({
      merge_commit_sha: SIBLING_CI_SHA,
      head_sha: SIBLING_CI_SHA,
      status: "completed",
      conclusion: "success",
      run_id: 33000000002,
      run_attempt: 1
    });
    if (authenticateSibling) {
      facts.ancestry[`${DESCENDANT_LIVE_TIP_SHA}...${SIBLING_CI_SHA}`] = "behind";
    }
  }
  return facts;
};

test("restored-completion-receipt-on-wedged-exact-sha-accepts-authenticated-descendant-ci", async () => {
  // Restoring Ticket-Completion onto #259 while leaving the wedged exact-SHA run in
  // place. A later CI success on the live tip, authenticated as merge <= tip, must
  // satisfy post-merge CI so the restore does not return POST_MERGE_CI_MISSING.
  const facts = makeRestoredWedgedCompletionFacts();
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(
    state.phase,
    "verified",
    `authenticated descendant CI must verify the restored receipt, got phase=${state.phase} blockers=${blockerCodes(state).join(",") || "none"}`
  );
  assert.equal(state.readiness, "terminal");
  assert.equal(blockerCodes(state).includes("POST_MERGE_CI_MISSING"), false);
  assert.deepEqual(blockerCodes(state), []);
});

test("descendant-ci-unauthenticated-sibling-fails-closed", async () => {
  // A successful CI row in the same fixture is not a descendant. Both SHAs can even
  // be ancestors of the tip; without merge <= sibling the fallback must not fire.
  const facts = makeRestoredWedgedCompletionFacts({
    includeDescendantSuccess: false,
    includeSiblingSuccess: true,
    authenticateSibling: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(
    blockerCodes(state).includes("POST_MERGE_CI_MISSING"),
    `unauthenticated sibling must stay POST_MERGE_CI_MISSING, got ${blockerCodes(state).join(",") || "none"}`
  );
});

test("descendant-ci-ahead-of-live-tip-fails-closed", async () => {
  // merge <= head is not enough. The run must also sit on the live line: head <= tip.
  const facts = makeRestoredWedgedCompletionFacts({
    descendantAheadOfTip: true
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(
    blockerCodes(state).includes("POST_MERGE_CI_MISSING"),
    `a head ahead of the live tip must stay POST_MERGE_CI_MISSING, got ${blockerCodes(state).join(",") || "none"}`
  );
});

test("exact-sha-post-merge-success-wins-over-descendant-failure", async () => {
  const facts = makeRestoredWedgedCompletionFacts({
    exactStatus: "completed",
    exactConclusion: "success",
    descendantConclusion: "failure"
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(state.phase, "verified");
  assert.equal(state.readiness, "terminal");
  assert.deepEqual(blockerCodes(state), []);
});

test("exact-sha-post-merge-failure-not-overridden-by-descendant-success", async () => {
  const facts = makeRestoredWedgedCompletionFacts({
    exactStatus: "completed",
    exactConclusion: "failure"
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("POST_MERGE_CI_FAILED"));
});

test("completion-merge-post-merge-ci-failed-fails-closed", async () => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const shaPlain = "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1";
  const shaCompletion = "f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2";
  facts.implementationMerges = [
    { ticket_id: "D0-004", merge_commit_sha: shaPlain, number: 309, body: "Ticket: D0-004\n\nplain contributing merge." },
    withPresentEffect(facts, {
      ticket_id: "D0-004",
      merge_commit_sha: shaCompletion,
      number: 310,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      reachable: true
    })
  ];
  facts.postMergeCI.push(
    { merge_commit_sha: shaPlain, head_sha: shaPlain, status: "completed", conclusion: "success", run_id: 309, run_attempt: 1 },
    { merge_commit_sha: shaCompletion, head_sha: shaCompletion, status: "completed", conclusion: "failure", run_id: 310, run_attempt: 1 }
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("POST_MERGE_CI_FAILED"));
});

test("completion-merge-explicitly-unreachable-commit-fails-closed", async () => {
  // Structural support for the "unreachable merge commit" fail-closed requirement: a
  // completion merge whose commit is explicitly recorded as not reachable from the live
  // target branch must never verify, even with successful post-merge CI.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const shaPlain = "071107110711071107110711071107110711aaaa";
  const shaCompletion = "071107110711071107110711071107110711bbbb";
  facts.implementationMerges = [
    { ticket_id: "D0-004", merge_commit_sha: shaPlain, number: 311, body: "Ticket: D0-004\n\nplain contributing merge." },
    {
      ticket_id: "D0-004",
      merge_commit_sha: shaCompletion,
      number: 312,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      reachable: false
    }
  ];
  facts.postMergeCI.push(
    { merge_commit_sha: shaPlain, head_sha: shaPlain, status: "completed", conclusion: "success", run_id: 311, run_attempt: 1 },
    { merge_commit_sha: shaCompletion, head_sha: shaCompletion, status: "completed", conclusion: "success", run_id: 312, run_attempt: 1 }
  );
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("TICKET_CONTRACT_CONFLICT"));
});

test("completion-merge-reachability-not-authenticated-fails-closed", async () => {
  // The specific fail-open defect this closes: the resolver previously rejected only
  // `reachable === false` while nothing populated `reachable` for a completion merge, so
  // an entry with no `reachable` field at all (undefined, the live-collector default
  // before this fix) silently passed. Reachability must be authenticated as exactly
  // `true`; it is never assumed from absence.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const sha = "9009900990099009900990099009900990099009";
  facts.implementationMerges = [
    {
      ticket_id: "D0-004",
      merge_commit_sha: sha,
      number: 500,
      body: "Ticket: D0-004\nTicket-Completion: D0-004"
      // `reachable` intentionally omitted — must fail closed, not pass open.
    }
  ];
  facts.postMergeCI.push({
    merge_commit_sha: sha,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    run_id: 500,
    run_attempt: 1
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified");
  assert.ok(blockerCodes(state).includes("TICKET_CONTRACT_CONFLICT"));
});

// ---------------------------------------------------------------------------
// Completion effect still present (the reverted-completion false green).
//
// Live defect this closes: `Ticket-Completion: D0-004` was carried by PR #155, which PR
// #156 then reverted in full. A revert adds a new commit; it does not remove the reverted
// merge from the ancestry, so #155 stayed an authenticated-reachable, CI-passing ancestor
// of dev forever. The resolver credited whole-ticket completion on that ancestry alone and
// D0-004 read verified/terminal while `.github/workflows/operational-state.yml` and
// `scripts/render-execution-views.mjs` — its entire deliverable — were absent from the
// tree. Five product tickets were opened against that false dependency.
//
// A completion is therefore only credited when the paths its merge introduced are still in
// the live target tree: absent → COMPLETION_EFFECT_REVERTED, introduced set unavailable →
// COMPLETION_EFFECT_UNKNOWN, tree listing unusable → EXTERNAL_STATE_UNAVAILABLE. Never a
// silent pass in any of the three.
// ---------------------------------------------------------------------------

const REVERTED_DELIVERABLE = [".github/workflows/operational-state.yml", "scripts/render-execution-views.mjs"];

/**
 * D0-004's real shape at the moment of the defect: an authenticated-reachable, CI-passing
 * completion merge carrying a valid marker. `presentPaths` decides whether the live tree
 * still carries what it introduced; everything else is held identical between the reverted
 * case and its control so the introduced-path check is the only variable.
 */
const makeCompletionEffectFacts = ({ addedPaths, changedPaths, removedPaths, presentPaths }) => {
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  const sha = "155a155a155a155a155a155a155a155a155a155a";
  const entry = {
    ticket_id: "D0-004",
    merge_commit_sha: sha,
    number: 155,
    body: "Ticket: D0-004\nTicket-Completion: D0-004\n\nD0-004 whole-ticket completion merge.",
    reachable: true
  };
  const withAdded = addedPaths === undefined ? entry : { ...entry, added_paths: addedPaths };
  const withChanged = changedPaths === undefined ? withAdded : { ...withAdded, changed_paths: changedPaths };
  // `removedPaths: null` is how a case asks for the unavailable shape; omitting it means "this
  // merge deleted nothing", which every case that is about something else needs to say.
  facts.implementationMerges = [
    removedPaths === null ? withChanged : { ...withChanged, removed_paths: removedPaths ?? [] }
  ];
  facts.postMergeCI.push({
    merge_commit_sha: sha,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    run_id: 155,
    run_attempt: 1
  });
  facts.liveTreePaths = [...(facts.liveTreePaths ?? []), ...(presentPaths ?? [])];
  return facts;
};

const blockerReason = (state, code) => (state.blockers ?? []).find((entry) => entry.code === code)?.reason ?? "";

test("completion-effect-reverted-when-introduced-path-is-absent-from-the-live-tree", async () => {
  // Ancestry says the completion merge is still there; the tree says its deliverable is not.
  const facts = makeCompletionEffectFacts({ addedPaths: REVERTED_DELIVERABLE, presentPaths: [] });
  for (const path of REVERTED_DELIVERABLE) {
    assert.equal(facts.liveTreePaths.includes(path), false, `${path} must be absent for this case to mean anything`);
  }
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(
    state.phase,
    "verified",
    `a completion whose deliverable was reverted must never verify, got phase=${state.phase}`
  );
  assert.notEqual(state.readiness, "terminal");
  assert.ok(
    blockerCodes(state).includes("COMPLETION_EFFECT_REVERTED"),
    `expected COMPLETION_EFFECT_REVERTED, got ${blockerCodes(state).join(",") || "none"}`
  );
  // The blocker has to say which path went missing, or the operator cannot tell a revert
  // from any other completion failure without re-deriving the whole check by hand.
  const reason = blockerReason(state, "COMPLETION_EFFECT_REVERTED");
  for (const path of REVERTED_DELIVERABLE) {
    assert.ok(reason.includes(path), `blocker reason must name the absent path ${path}: ${reason}`);
  }
});

test("completion-effect-present-introduced-path-verifies", async () => {
  // Control for the case above. Without it, a resolver that refused every completion would
  // pass the reverted case for entirely the wrong reason.
  const facts = makeCompletionEffectFacts({
    addedPaths: REVERTED_DELIVERABLE,
    presentPaths: REVERTED_DELIVERABLE
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(state.phase, "verified");
  assert.equal(state.readiness, "terminal");
  assert.deepEqual(blockerCodes(state), []);
});

test("completion-effect-unknown-when-introduced-path-set-is-unavailable", async () => {
  // No introduced-path set is not evidence of an intact effect. Both the absent-field shape
  // and the explicit null the collector writes on an unusable commit payload must block.
  for (const addedPaths of [undefined, null]) {
    const facts = makeCompletionEffectFacts({ addedPaths, presentPaths: REVERTED_DELIVERABLE });
    const { result } = await resolveOffline(facts);
    const state = ticketState(result, "D0-004");
    assert.notEqual(
      state.phase,
      "verified",
      `added_paths=${String(addedPaths)} must never be silently verified, got phase=${state.phase}`
    );
    assert.ok(
      blockerCodes(state).includes("COMPLETION_EFFECT_UNKNOWN"),
      `added_paths=${String(addedPaths)} expected COMPLETION_EFFECT_UNKNOWN, got ${blockerCodes(state).join(",") || "none"}`
    );
  }
});

test("completion-effect-missing-live-tree-listing-is-external-state-unavailable", async () => {
  // The check needs the live tree. An absent or wrongly-shaped listing is an outage, so it
  // is reported as one — never resolved as a pass because there was nothing to compare to.
  for (const [label, liveTreePaths] of [
    ["absent", undefined],
    ["null", null],
    ["object instead of array", { ".github/workflows/operational-state.yml": true }],
    ["string instead of array", ".github/workflows/operational-state.yml"]
  ]) {
    const facts = makeCompletionEffectFacts({
      addedPaths: REVERTED_DELIVERABLE,
      presentPaths: REVERTED_DELIVERABLE
    });
    if (liveTreePaths === undefined) delete facts.liveTreePaths;
    else facts.liveTreePaths = liveTreePaths;
    const { result } = await resolveOffline(facts);
    const state = ticketState(result, "D0-004");
    assert.notEqual(state.phase, "verified", `liveTreePaths ${label} must not verify, got phase=${state.phase}`);
    assert.ok(
      blockerCodes(state).includes("EXTERNAL_STATE_UNAVAILABLE"),
      `liveTreePaths ${label} expected EXTERNAL_STATE_UNAVAILABLE, got ${blockerCodes(state).join(",") || "none"}`
    );
  }
});

test("legacy-completion-binding-is-subject-to-the-same-completion-effect-check", async () => {
  // HISTORICAL_IMPLEMENTATION_LINKAGE (D0-001 PR #130, D0-002 PR #143) is a completion
  // exception for the *marker grammar* only. It buys no exemption from the effect check: a
  // legacy-bound merge whose deliverable was later reverted is exactly as false a green.
  //
  // Real bug hit while fixing this: the legacy collector fetched no commit payload, so it
  // recorded no added_paths at all and both D0-001 and D0-002 flipped to
  // COMPLETION_EFFECT_UNKNOWN. Parts B and C below pin the collector's side of it.
  const legacyPaths = {
    "D0-001": "scripts/validate-identity.mjs",
    "D0-002": "tests/planning/workspace-skeleton.test.mjs"
  };

  // A. An introduced path missing from the live tree blocks a legacy binding too.
  for (const [ticketId, path] of Object.entries(legacyPaths)) {
    const facts = loadBaselineFacts();
    const entry = facts.implementationMerges.find((row) => row.ticket_id === ticketId);
    assert.ok(entry?.added_paths?.includes(path), `${ticketId} legacy receipt must record ${path}`);
    facts.liveTreePaths = facts.liveTreePaths.filter((candidate) => candidate !== path);
    const { result } = await resolveOffline(facts);
    const state = ticketState(result, ticketId);
    assert.notEqual(state.phase, "verified", `${ticketId} legacy completion must not survive a revert`);
    assert.ok(
      blockerCodes(state).includes("COMPLETION_EFFECT_REVERTED"),
      `${ticketId} expected COMPLETION_EFFECT_REVERTED, got ${blockerCodes(state).join(",") || "none"}`
    );
    assert.ok(blockerReason(state, "COMPLETION_EFFECT_REVERTED").includes(path));
  }

  // B. Control: untouched, both legacy bindings still verify. A legacy receipt that records
  // no introduced set at all is COMPLETION_EFFECT_UNKNOWN, which is what a collector that
  // forgets to capture added_paths produces — correct as a blocker, wrong as a steady state.
  for (const ticketId of Object.keys(legacyPaths)) {
    const intact = loadBaselineFacts();
    const { result: intactResult } = await resolveOffline(intact);
    assert.deepEqual(blockerCodes(ticketState(intactResult, ticketId)), [], `${ticketId} must be clean when intact`);

    const stripped = loadBaselineFacts();
    stripped.implementationMerges = stripped.implementationMerges.map((row) => {
      if (row.ticket_id !== ticketId) return row;
      const { added_paths, ...rest } = row;
      void added_paths;
      return rest;
    });
    const { result } = await resolveOffline(stripped);
    assert.ok(
      blockerCodes(ticketState(result, ticketId)).includes("COMPLETION_EFFECT_UNKNOWN"),
      `${ticketId} without an introduced set must be UNKNOWN, never verified`
    );
  }

  // C. The legacy collector must actually record it, or B is the permanent live state.
  const { applyHistoricalImplementationLinkage, createFixtureTransport } = await importResolver();
  const repoPath = "repos/MongLong0214/agent-operator-score";
  const mergeSha = "6e872ccf2387067b49217a27a7c255343ad2eb8d";
  const liveTip = "c8937c6c31ef034535f7c2e8276514221a12fd55";
  const transport = createFixtureTransport({
    [`${repoPath}/pulls/130`]: { number: 130, merged: true, merge_commit_sha: mergeSha, base: { ref: "dev" } },
    [`${repoPath}/compare/${liveTip}...${mergeSha}`]: { status: "behind" },
    [`${repoPath}/commits/${mergeSha}`]: {
      sha: mergeSha,
      files: [
        { filename: "specs/identity.v1.json", status: "added" },
        { filename: "scripts/validate-identity.mjs", status: "added" },
        { filename: "docs/tickets/D0/D0-001-canonical-identifier-registry.md", status: "modified" },
        // A file the merge deleted. It is absent from the tip by construction, so counting it
        // as a changed path would make every deleting completion report a reverted effect.
        { filename: "scripts/legacy-identity-check.mjs", status: "removed" },
        // A file the merge moved. GitHub reports the new path under `renamed`, not `added` or
        // `modified`, and that path does exist at the tip — so a rule written as
        // added-or-modified would refuse a rename-only completion for having no effect.
        { filename: "specs/identity-registry.v1.json", status: "renamed", previous_filename: "specs/identity-old.v1.json" }
      ]
    },
    [`${repoPath}/actions/runs?head_sha=${mergeSha}&event=push&per_page=20`]: {
      total_count: 1,
      workflow_runs: [
        {
          id: 31063416513,
          name: "CI",
          path: ".github/workflows/ci.yml",
          head_sha: mergeSha,
          status: "completed",
          conclusion: "success",
          run_attempt: 1
        }
      ]
    }
  });
  const implementationMerges = [];
  const failures = [];
  const ok = applyHistoricalImplementationLinkage(
    transport,
    repoPath,
    { "D0-001": { owned_paths: ["x"], owned_symbols: [] } },
    failures,
    { implementationMerges, postMergeCI: [], verifiedTickets: [] },
    liveTip
  );
  assert.equal(ok, true, failures.join("; "));
  assert.deepEqual(
    implementationMerges[0].added_paths,
    ["scripts/validate-identity.mjs", "specs/identity.v1.json"],
    "the legacy collector must record the introduced paths, sorted, added-only"
  );
  // The changed set is what a completion with no added path is judged on, so the legacy
  // collector must record it too — the previous cut of this check missed this collector
  // entirely. The two sets differ by the modified ticket file, which is what makes this an
  // oracle rather than a restatement of the assertion above.
  assert.deepEqual(
    implementationMerges[0].changed_paths,
    [
      "docs/tickets/D0/D0-001-canonical-identifier-registry.md",
      "scripts/validate-identity.mjs",
      "specs/identity-registry.v1.json",
      "specs/identity.v1.json"
    ],
    "the legacy collector must record every path the merge leaves behind, sorted"
  );
  assert.deepEqual(
    implementationMerges[0].removed_paths,
    ["scripts/legacy-identity-check.mjs", "specs/identity-old.v1.json"],
    "the legacy collector must record deletions and a rename's old path, sorted"
  );
  // Named separately from the array above so the two rules fail apart: the removed path must
  // be gone because it cannot be at the tip, and the renamed path must be kept because it is.
  assert.ok(
    !implementationMerges[0].changed_paths.includes("scripts/legacy-identity-check.mjs"),
    "a path the merge deleted is absent from the tip and must not be counted as an effect"
  );
  assert.ok(
    implementationMerges[0].changed_paths.includes("specs/identity-registry.v1.json"),
    "a renamed path exists at the tip and must count as an effect, or a rename-only completion is refused"
  );
});

test("completion-that-introduced-nothing-verifies-on-its-surviving-changed-paths", async () => {
  // A completion merge that only modified files introduces no path, and 28 of this
  // repository's 76 completion receipts have exactly that shape — refactors, doc
  // corrections, census repins. They must still verify, so an empty introduced set is not an
  // absent effect. What it cannot be is unexamined: the effect such a merge does have is the
  // files it changed, and those must still be at the tip.
  const facts = makeCompletionEffectFacts({
    addedPaths: [],
    changedPaths: ["docs/effect/survivor.md"],
    presentPaths: ["docs/effect/survivor.md"]
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(
    state.phase,
    "verified",
    `an empty introduced set with a surviving changed path is not an absent effect, got phase=${state.phase} blockers=${blockerCodes(state).join(",")}`
  );
  assert.equal(state.readiness, "terminal");
  assert.deepEqual(blockerCodes(state), []);
});

// A merge's effect has two directions and each needs its own expectation. The pair below is
// the second one: a file a completion deliberately deleted must still be gone. Blind review
// named this — excluding removals from the presence check does not make deletion safe, it
// makes that half of the completion invisible.

test("completion-whose-deleted-path-is-restored-is-a-reverted-effect", async () => {
  const facts = makeCompletionEffectFacts({
    addedPaths: ["docs/effect/kept.md"],
    removedPaths: ["docs/effect/deleted-then-restored.md"],
    presentPaths: ["docs/effect/kept.md", "docs/effect/deleted-then-restored.md"]
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(
    state.phase,
    "verified",
    "restoring a file the completion removed reverts it as surely as deleting one it added"
  );
  assert.ok(
    blockerCodes(state).includes("COMPLETION_EFFECT_REVERTED"),
    `expected COMPLETION_EFFECT_REVERTED, got ${blockerCodes(state).join(",") || "none"}`
  );
  assert.match(blockerReason(state, "COMPLETION_EFFECT_REVERTED"), /present again/);
});

test("completion-whose-deleted-path-stayed-deleted-verifies", async () => {
  // The matching acceptance. Without it the case above is satisfied by refusing every
  // completion that deletes anything, which is a broken check rather than a closed hole. Only
  // the live tree differs between the two.
  const facts = makeCompletionEffectFacts({
    addedPaths: ["docs/effect/kept.md"],
    removedPaths: ["docs/effect/deleted-then-restored.md"],
    presentPaths: ["docs/effect/kept.md"]
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(
    state.phase,
    "verified",
    `a deletion that held is a surviving effect, got phase=${state.phase} blockers=${blockerCodes(state).join(",")}`
  );
  assert.deepEqual(blockerCodes(state), []);
});

test("completion-fails-closed-when-its-removed-set-is-unavailable", async () => {
  const facts = makeCompletionEffectFacts({
    addedPaths: ["docs/effect/kept.md"],
    removedPaths: null,
    presentPaths: ["docs/effect/kept.md"]
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified", "an unavailable removed set must never verify");
  assert.ok(
    blockerCodes(state).includes("COMPLETION_EFFECT_UNKNOWN"),
    `expected COMPLETION_EFFECT_UNKNOWN, got ${blockerCodes(state).join(",") || "none"}`
  );
  assert.match(blockerReason(state, "COMPLETION_EFFECT_UNKNOWN"), /removed-path set is unavailable/);
});

// The three cases below are the hole this pair of checks closes: before them, every one of
// these verified, because an empty introduced set has nothing that could be found absent and
// the check therefore passed on no evidence at all.

test("completion-that-introduced-nothing-and-changed-nothing-is-not-a-verified-effect", async () => {
  const facts = makeCompletionEffectFacts({ addedPaths: [], changedPaths: [], presentPaths: [] });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(
    state.phase,
    "verified",
    "a merge that added and modified no file has no effect and must never verify"
  );
  assert.ok(
    blockerCodes(state).includes("COMPLETION_EFFECT_UNKNOWN"),
    `expected COMPLETION_EFFECT_UNKNOWN, got ${blockerCodes(state).join(",") || "none"}`
  );
  assert.match(blockerReason(state, "COMPLETION_EFFECT_UNKNOWN"), /added and modified no file/);
});

test("completion-that-introduced-nothing-fails-closed-when-its-changed-set-is-unavailable", async () => {
  // `changed_paths` absent is the collector-outage shape. It must not read as "nothing
  // changed", which would be indistinguishable from the case above and would let an outage
  // decide a verdict.
  const facts = makeCompletionEffectFacts({ addedPaths: [], presentPaths: [] });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified", "an unavailable changed set must never verify");
  assert.ok(
    blockerCodes(state).includes("COMPLETION_EFFECT_UNKNOWN"),
    `expected COMPLETION_EFFECT_UNKNOWN, got ${blockerCodes(state).join(",") || "none"}`
  );
  assert.match(blockerReason(state, "COMPLETION_EFFECT_UNKNOWN"), /changed-path set is unavailable/);
});

test("completion-that-introduced-nothing-is-reverted-when-its-changed-paths-are-gone", async () => {
  const facts = makeCompletionEffectFacts({
    addedPaths: [],
    changedPaths: ["docs/effect/removed-later.md"],
    presentPaths: []
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.notEqual(state.phase, "verified", "a changed path deleted after the merge is a reverted effect");
  assert.ok(
    blockerCodes(state).includes("COMPLETION_EFFECT_REVERTED"),
    `expected COMPLETION_EFFECT_REVERTED, got ${blockerCodes(state).join(",") || "none"}`
  );
  assert.match(blockerReason(state, "COMPLETION_EFFECT_REVERTED"), /docs\/effect\/removed-later\.md/);
});

test("truncated-live-tree-listing-fails-closed-instead-of-being-treated-as-complete", async () => {
  // GitHub truncates a recursive tree listing past its size limit and says so in
  // `truncated`. A truncated listing is a partial view of the tree, so neither answer it
  // gives is evidence: present is unconfirmed and absent is unproven. It fails the whole
  // collection closed and produces no facts corpus for anything downstream to read.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = "9110911091109110911091109110911091109110";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 911,
      merge_commit_sha: sha,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha, 911001),
      added_paths: ["docs/effect/911.md"]
    }
  ]);
  const treeKey = `${COLLECTOR_REPO_PATH}/git/trees/${COLLECTOR_DEV_TIP}?recursive=1`;
  // Same tree as the passing case, only flagged truncated: the flag alone must be decisive.
  const untruncated = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(untruncated.ok, true, untruncated.reason);
  responses[treeKey] = { ...responses[treeKey], truncated: true };
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false, "a truncated tree listing must fail the collection closed");
  assert.match(collected.reason, /truncat/i);
  assert.equal(collected.facts, null, "a truncated listing must yield no facts corpus at all");
});

// ---------------------------------------------------------------------------
// Legacy completion exception (D0-001 PR #130, D0-002 PR #143 — see
// HISTORICAL_IMPLEMENTATION_LINKAGE and the D0-004 ticket's amended linkage clause).
// ---------------------------------------------------------------------------

test("legacy-completion-exception-d0-001-verifies-without-ticket-fields", async () => {
  const facts = loadBaselineFacts();
  const d0001Entries = facts.implementationMerges.filter((entry) => entry.ticket_id === "D0-001");
  assert.equal(d0001Entries.length, 1);
  assert.equal(d0001Entries[0].number, 130);
  assert.equal(d0001Entries[0].merge_commit_sha, "6e872ccf2387067b49217a27a7c255343ad2eb8d");
  assert.equal(d0001Entries[0].reachable, true);
  assert.equal(
    Object.hasOwn(d0001Entries[0], "body"),
    false,
    "the legacy binding requires no Ticket:/Ticket-Completion: body fields at all"
  );
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.equal(d0001.phase, "verified");
  assert.equal(d0001.readiness, "terminal");
  assert.deepEqual(blockerCodes(d0001), []);
});

test("legacy-completion-exception-requires-exact-pr-number-and-sha-match", async () => {
  // A D0-001 receipt with the right ticket_id but a wrong PR number/merge SHA is never the
  // legacy completion — it falls through to ordinary marker classification, and here
  // carries no Ticket-Completion field, so it is a plain, ignored receipt.
  const facts = loadBaselineFacts();
  facts.implementationMerges = [
    { ticket_id: "D0-001", merge_commit_sha: "0000000000000000000000000000000000000000", number: 999, reachable: true }
  ];
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.deepEqual(blockerCodes(d0001), []);
});

test("legacy-completion-exception-still-requires-authenticated-reachability", async () => {
  const facts = loadBaselineFacts();
  facts.implementationMerges = facts.implementationMerges.map((entry) =>
    entry.ticket_id === "D0-001" ? { ...entry, reachable: false } : entry
  );
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.ok(blockerCodes(d0001).includes("TICKET_CONTRACT_CONFLICT"));
});

test("legacy-completion-exception-still-requires-successful-post-merge-ci", async () => {
  const facts = loadBaselineFacts();
  facts.postMergeCI = facts.postMergeCI.map((row) =>
    row.merge_commit_sha === "6e872ccf2387067b49217a27a7c255343ad2eb8d" ? { ...row, conclusion: "failure" } : row
  );
  const { result } = await resolveOffline(facts);
  const d0001 = ticketState(result, "D0-001");
  assert.notEqual(d0001.phase, "verified");
  assert.ok(blockerCodes(d0001).includes("POST_MERGE_CI_FAILED"));
});

test("legacy-completion-exception-does-not-extend-to-other-tickets", async () => {
  // Matching PR number/merge SHA under a DIFFERENT ticket_id is never the legacy
  // exception — HISTORICAL_IMPLEMENTATION_LINKAGE is keyed on ticket id first, and no
  // other ticket, PR, or merge inherits it.
  const facts = makeReadyD0004Facts(loadBaselineFacts());
  facts.verifiedTickets = ["D0-001", "D0-002", "D0-004"];
  facts.implementationMerges = facts.implementationMerges ?? [];
  facts.implementationMerges = [
    ...facts.implementationMerges,
    {
      ticket_id: "D0-004",
      merge_commit_sha: "6e872ccf2387067b49217a27a7c255343ad2eb8d",
      number: 130,
      reachable: true
    }
  ];
  const { result } = await resolveOffline(facts);
  const d0004 = ticketState(result, "D0-004");
  assert.notEqual(d0004.phase, "verified");
  assert.deepEqual(blockerCodes(d0004), []);
});

test("historical-linkage-collector-verifies-real-merge-before-trusting-it", async () => {
  const { applyHistoricalImplementationLinkage, createFixtureTransport } = await importResolver();
  const tickets = { "D0-002": { owned_paths: ["x"], owned_symbols: [] } };
  const repoPath = "repos/MongLong0214/agent-operator-score";
  const mergeSha = "782946e96baa4a3f2734a2ad6b42210d289bebb7";
  const liveTip = "c8937c6c31ef034535f7c2e8276514221a12fd55";
  // A legacy binding is a completion, so the collector must record what it introduced;
  // the resolver then requires those paths to still be present.
  const legacyAdded = ["packages/schema/package.json", "tests/planning/workspace-skeleton.test.mjs"];
  const legacyCommitResponse = {
    sha: mergeSha,
    files: [
      ...legacyAdded.map((filename) => ({ filename, status: "added" })),
      { filename: "package.json", status: "modified" }
    ]
  };

  // Matching historical merge + authenticated reachability + successful post-merge CI is trusted.
  {
    const responses = {
      [`${repoPath}/commits/${mergeSha}`]: legacyCommitResponse,
      [`${repoPath}/pulls/143`]: {
        number: 143,
        merged: true,
        merge_commit_sha: mergeSha,
        base: { ref: "dev" }
      },
      [`${repoPath}/compare/${liveTip}...${mergeSha}`]: { status: "behind" },
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
    const ok = applyHistoricalImplementationLinkage(
      transport,
      repoPath,
      tickets,
      failures,
      { implementationMerges, postMergeCI, verifiedTickets },
      liveTip
    );
    assert.equal(ok, true);
    assert.deepEqual(failures, []);
    assert.deepEqual(implementationMerges, [
      {
        ticket_id: "D0-002",
        merge_commit_sha: mergeSha,
        number: 143,
        reachable: true,
        // Only `added` files, sorted; a modified file is not an introduced path.
        added_paths: ["packages/schema/package.json", "tests/planning/workspace-skeleton.test.mjs"],
        // ...but it is a changed one, and that is what a completion with no introduced path
        // is judged on. `package.json` appears here and nowhere above.
        changed_paths: [
          "package.json",
          "packages/schema/package.json",
          "tests/planning/workspace-skeleton.test.mjs"
        ],
        // This merge deleted nothing, and the collector must say so rather than omit the
        // field: the resolver refuses a receipt whose removed set is merely absent.
        removed_paths: []
      }
    ]);
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
    const ok = applyHistoricalImplementationLinkage(
      transport,
      repoPath,
      tickets,
      failures,
      { implementationMerges: [], postMergeCI: [], verifiedTickets: [] },
      liveTip
    );
    assert.equal(ok, false);
    assert.ok(failures.length > 0);
  }

  // API outage fails closed.
  {
    const responses = { [`${repoPath}/pulls/143`]: null };
    const transport = createFixtureTransport(responses);
    const failures = [];
    const ok = applyHistoricalImplementationLinkage(
      transport,
      repoPath,
      tickets,
      failures,
      { implementationMerges: [], postMergeCI: [], verifiedTickets: [] },
      liveTip
    );
    assert.equal(ok, false);
    assert.ok(failures.length > 0);
  }

  // Completion merge commit not reachable from live dev fails closed.
  {
    const responses = {
      [`${repoPath}/pulls/143`]: {
        number: 143,
        merged: true,
        merge_commit_sha: mergeSha,
        base: { ref: "dev" }
      },
      [`${repoPath}/commits/${mergeSha}`]: legacyCommitResponse,
      [`${repoPath}/compare/${liveTip}...${mergeSha}`]: { status: "diverged" },
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
    const ok = applyHistoricalImplementationLinkage(
      transport,
      repoPath,
      tickets,
      failures,
      { implementationMerges, postMergeCI: [], verifiedTickets: [] },
      liveTip
    );
    // Ancestry itself never outright fails the collector call (it is a fact, not an
    // outage); it is recorded as reachable:false for the resolver to fail closed on.
    assert.equal(ok, true);
    assert.deepEqual(failures, []);
    assert.equal(implementationMerges[0].reachable, false);
  }

  // Ancestry compare outage fails the whole collection closed.
  {
    const responses = {
      [`${repoPath}/pulls/143`]: {
        number: 143,
        merged: true,
        merge_commit_sha: mergeSha,
        base: { ref: "dev" }
      },
      [`${repoPath}/compare/${liveTip}...${mergeSha}`]: null
    };
    const transport = createFixtureTransport(responses);
    const failures = [];
    const ok = applyHistoricalImplementationLinkage(
      transport,
      repoPath,
      tickets,
      failures,
      { implementationMerges: [], postMergeCI: [], verifiedTickets: [] },
      liveTip
    );
    assert.equal(ok, false);
    assert.ok(failures.length > 0);
  }

  // Unrecognized ancestry compare status fails the whole collection closed.
  {
    const responses = {
      [`${repoPath}/pulls/143`]: {
        number: 143,
        merged: true,
        merge_commit_sha: mergeSha,
        base: { ref: "dev" }
      },
      [`${repoPath}/compare/${liveTip}...${mergeSha}`]: { status: "unexpected-status" }
    };
    const transport = createFixtureTransport(responses);
    const failures = [];
    const ok = applyHistoricalImplementationLinkage(
      transport,
      repoPath,
      tickets,
      failures,
      { implementationMerges: [], postMergeCI: [], verifiedTickets: [] },
      liveTip
    );
    assert.equal(ok, false);
    assert.ok(failures.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Collector-level REDs for the merged-PR-search implementation-completion pipeline
// (scripts/resolve-execution-state.mjs collectLiveExecutionFacts, the mergedSearch loop):
// these exercise the real collector against a mocked GitHub transport end to end, not
// fixture-injected facts.implementationMerges shortcuts.
// ---------------------------------------------------------------------------

const COLLECTOR_REPO_PATH = "repos/MongLong0214/agent-operator-score";
const COLLECTOR_DEV_TIP = "c8937c6c31ef034535f7c2e8276514221a12fd55";
const COLLECTOR_MERGED_SEARCH_QUERY =
  "search/issues?q=repo%3AMongLong0214%2Fagent-operator-score%20is%3Apr%20is%3Amerged%20base%3Adev%20%22Ticket%3A%22";
const COLLECTOR_GATE_BATCH_SEARCH_QUERY =
  "search/issues?q=repo%3AMongLong0214%2Fagent-operator-score%20is%3Apr%20is%3Amerged%20%22Gate-Batch%3A%22";
const COLLECTOR_SEARCH_PAGE_SIZE = 100;
const collectorSearchPageKey = (page) =>
  `${COLLECTOR_MERGED_SEARCH_QUERY}&per_page=${COLLECTOR_SEARCH_PAGE_SIZE}&page=${page}`;
const collectorGateBatchSearchPageKey = (page) =>
  `${COLLECTOR_GATE_BATCH_SEARCH_QUERY}&per_page=${COLLECTOR_SEARCH_PAGE_SIZE}&page=${page}`;

const wrapCountingTransport = (inner, searchCalls) => ({
  kind: inner.kind,
  getJson(apiPath) {
    if (typeof apiPath === "string" && apiPath.startsWith("search/issues")) {
      searchCalls.push(apiPath);
    }
    return inner.getJson(apiPath);
  },
  getRaw(apiPath) {
    return inner.getRaw(apiPath);
  }
});

const wrapCountingPulls = (inner, pullCalls) => ({
  kind: inner.kind,
  getJson(apiPath) {
    if (typeof apiPath === "string" && /\/pulls\/\d+$/.test(apiPath)) {
      pullCalls.push(apiPath);
    }
    return inner.getJson(apiPath);
  },
  getRaw(apiPath) {
    return inner.getRaw(apiPath);
  }
});

const installGateBatchCorpusFromFixture = (responses) => {
  const sourceKey =
    Object.keys(responses).find(
      (entry) =>
        entry.includes("search/issues") && entry.includes("Gate-Batch") && entry.includes("per_page=10")
    ) ??
    Object.keys(responses).find((entry) => entry.includes("search/issues") && entry.includes("Gate-Batch"));
  assert.ok(sourceKey, "fixture gate search key");
  const corpusKey = collectorGateBatchSearchPageKey(1);
  if (!Object.hasOwn(responses, corpusKey)) {
    responses[corpusKey] = clone(responses[sourceKey]);
  }
  return corpusKey;
};

const addUnmatchedAcceptedBatches = (responses, extraIds) => {
  const rawKey = `raw:${COLLECTOR_REPO_PATH}/contents/docs/decisions/maintainer-gate-registry.v2.json?ref=${COLLECTOR_DEV_TIP}`;
  assert.ok(Object.hasOwn(responses, rawKey), "fixture registry raw key");
  const registry = JSON.parse(responses[rawKey]);
  assert.ok(Array.isArray(registry.batches), "fixture registry batches");
  for (const id of extraIds) {
    registry.batches.push({
      id,
      status: "ACCEPTED",
      required_artifacts: []
    });
    const q = encodeURIComponent(
      `repo:MongLong0214/agent-operator-score is:pr is:merged "Gate-Batch: ${id}"`
    );
    responses[`search/issues?q=${q}&per_page=10`] = {
      total_count: 0,
      incomplete_results: false,
      items: []
    };
  }
  responses[rawKey] = JSON.stringify(registry);
};

function buildCollectorMergedSearchFixture(items) {
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  // GitHub's search payload carries the full body, verified against live data for every
  // merged receipt in this repository, and the collector pre-filters on it to avoid
  // spending one request per search hit. Model that here or the pre-filter skips every
  // fixture receipt before the per-PR response is ever consulted.
  const searchItems = items.map(({ number, body }) => ({ number, body }));
  const collectorTreePaths = [];
  const pageCount = Math.max(1, Math.ceil(searchItems.length / COLLECTOR_SEARCH_PAGE_SIZE));
  for (let page = 1; page <= pageCount; page += 1) {
    responses[collectorSearchPageKey(page)] = {
      items: searchItems.slice((page - 1) * COLLECTOR_SEARCH_PAGE_SIZE, page * COLLECTOR_SEARCH_PAGE_SIZE),
      total_count: searchItems.length,
      incomplete_results: false
    };
  }
  for (const item of items) {
    responses[`${COLLECTOR_REPO_PATH}/pulls/${item.number}`] = {
      number: item.number,
      merged: true,
      merge_commit_sha: item.merge_commit_sha,
      body: item.body,
      base: { ref: "dev" }
    };
    if (Object.hasOwn(item, "compare")) {
      responses[`${COLLECTOR_REPO_PATH}/compare/${COLLECTOR_DEV_TIP}...${item.merge_commit_sha}`] = item.compare;
    }
    if (Object.hasOwn(item, "runs")) {
      responses[`${COLLECTOR_REPO_PATH}/actions/runs?head_sha=${item.merge_commit_sha}&event=push&per_page=20`] = item.runs;
    }
    // A completion receipt costs one extra commit request so the resolver can require what
    // the merge introduced to still be in the live tree. `added_paths: null` models the
    // outage/unknown shape; `effect_present: false` models the reverted shape by recording
    // the introduced paths and deliberately leaving them out of the live tree listing.
    if (Object.hasOwn(item, "added_paths")) {
      const modified = item.modified_paths ?? [];
      responses[`${COLLECTOR_REPO_PATH}/commits/${item.merge_commit_sha}`] =
        item.added_paths === null
          ? { sha: item.merge_commit_sha }
          : {
              sha: item.merge_commit_sha,
              files: [
                ...item.added_paths.map((filename) => ({ filename, status: "added" })),
                ...modified.map((filename) => ({ filename, status: "modified" })),
                // A removed file is in the same response and must stay out of the changed set:
                // it is absent from the tip by construction, so counting it would refuse every
                // completion that deletes anything.
                ...(item.removed_paths ?? []).map((filename) => ({ filename, status: "removed" })),
                ...(item.renamed_paths ?? []).map(([filename, previous_filename]) => ({
                  filename,
                  previous_filename,
                  status: "renamed"
                }))
              ]
            };
      if (Array.isArray(item.added_paths) && item.effect_present !== false) {
        collectorTreePaths.push(
          ...item.added_paths,
          ...modified,
          ...(item.renamed_paths ?? []).map(([filename]) => filename)
        );
      }
    }
  }
  const treeKey = `${COLLECTOR_REPO_PATH}/git/trees/${COLLECTOR_DEV_TIP}?recursive=1`;
  responses[treeKey] = {
    ...responses[treeKey],
    tree: [
      ...(responses[treeKey]?.tree ?? []),
      ...collectorTreePaths.map((path) => ({ path, type: "blob", mode: "100644" }))
    ]
  };
  // Remove the open D0-004 candidate PR so implementation-completion blockers surface
  // through resolveOneTicket's pre-ready-set path (guarded by `!pr`), not swallowed by
  // an in-flight candidate.
  responses[`${COLLECTOR_REPO_PATH}/pulls?state=open&base=dev&per_page=50`] = [];
  // Completions without exact-SHA success now ask for live-tip CI. Default to an
  // authenticated empty set so tests that do not model a descendant run fail closed
  // at the resolver, not as a fixture-missing collection outage.
  const tipRunsKey = `${COLLECTOR_REPO_PATH}/actions/runs?head_sha=${COLLECTOR_DEV_TIP}&event=push&per_page=20`;
  if (!Object.hasOwn(responses, tipRunsKey)) {
    responses[tipRunsKey] = { total_count: 0, workflow_runs: [] };
  }
  return responses;
}

const collectorSuccessRuns = (sha, runId) => ({
  total_count: 1,
  workflow_runs: [
    {
      id: runId,
      name: "CI",
      path: ".github/workflows/ci.yml",
      head_sha: sha,
      status: "completed",
      conclusion: "success",
      run_attempt: 1
    }
  ]
});

async function resolveCollectedOnline(collected) {
  const { resolveExecutionState } = await importResolver();
  return resolveExecutionState({
    mode: "online-strict",
    root,
    facts: collected.facts,
    runtimeIdentity: {
      repository: collected.facts.repository,
      branch: collected.facts.defaultBranch,
      head: collected.facts.currentHead
    }
  });
}

// A body that OPENS a `Ticket:` line but fails to state a usable value is malformed, not
// unlinked. Skipping it would let a real receipt disappear behind a typo, so each of these
// must fail the whole collection closed. Distinguishing this from the unlinked case is the
// point: absence of any `Ticket:` line is a search false positive and is skipped.
for (const [label, body] of [
  ["empty-value", "Ticket:\n"],
  ["whitespace-only-value", "Ticket:   \n"],
  ["trailing-extra-token", "Ticket: D0-001 extra\n"]
]) {
  test(`collector-fails-closed-on-malformed-ticket-field-${label}`, async () => {
    const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
    const responses = buildCollectorMergedSearchFixture([
      { number: 903, merge_commit_sha: "9030903090309030903090309030903090309030", body }
    ]);
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(collected.ok, false, `${label} must fail closed, not be skipped as unlinked`);
    assert.match(collected.reason, /malformed Ticket field/i);
  });
}

test("collector-paginates-the-merged-receipt-search-past-one-page", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  // Live failure this reproduces: once this repository accumulated a full page of merged
  // PRs carrying a `Ticket:` field, the single-page search hit its own page size and the
  // collector failed closed with "possibly truncated at 30 items", which blocked every
  // ticket in the backlog. Failing closed was correct; never paging was the defect.
  const items = Array.from({ length: 34 }, (_, index) => {
    const number = 800 + index;
    const sha = String(number).repeat(20).slice(0, 40);
    return {
      number,
      merge_commit_sha: sha,
      body: "Ticket: D0-001\n\nplain contributing merge, no completion marker.",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha, 900000 + number)
    };
  });
  const responses = buildCollectorMergedSearchFixture(items);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(
    /possibly truncated/i.test(collected.reason ?? ""),
    false,
    `a full first page must be paged, not rejected: ${collected.reason}`
  );
  assert.equal(collected.ok, true, collected.reason);
  const seen = new Set((collected.facts?.implementationMerges ?? []).map((entry) => entry.number));
  for (const item of items) {
    assert.ok(seen.has(item.number), `receipt ${item.number} was never collected`);
  }
});

test("modern-collector-records-both-effect-directions-for-a-completion-receipt", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  // Blind review found this gap by the only probe that could: deleting the modern collector's
  // own `changed_paths` assignment left the whole suite green. The legacy assertions could not
  // see it because both collectors share `filesToChangedPaths`, so mutating the helper kills
  // legacy cases and says nothing about this path. This case names the modern collector.
  const sha = "9090909090909090909090909090909090909090";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 901,
      merge_commit_sha: sha,
      body: "Ticket: D0-001\nTicket-Completion: D0-001\n\nD0-001 completion merge.",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha, 901901),
      added_paths: ["docs/effect/new.md"],
      modified_paths: ["docs/effect/touched.md"],
      removed_paths: ["docs/effect/deleted.md"],
      renamed_paths: [["docs/effect/moved-to.md", "docs/effect/moved-from.md"]]
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const entry = (collected.facts?.implementationMerges ?? []).find((row) => row.number === 901);
  assert.ok(entry, "the completion receipt was never collected");

  // Three sets, three different answers from one commit response. Equal sets would make any
  // one of these assertions a restatement of the others.
  assert.deepEqual(entry.added_paths, ["docs/effect/new.md"], "added is `added` only");
  assert.deepEqual(
    entry.changed_paths,
    ["docs/effect/moved-to.md", "docs/effect/new.md", "docs/effect/touched.md"],
    "changed is everything the merge leaves behind, including a rename's new path"
  );
  assert.deepEqual(
    entry.removed_paths,
    ["docs/effect/deleted.md", "docs/effect/moved-from.md"],
    "removed is deletions and a rename's old path"
  );
  // The directions must not overlap: a path cannot both survive and be gone.
  for (const path of entry.removed_paths) {
    assert.ok(!entry.changed_paths.includes(path), `${path} is in both effect directions`);
  }
});

test("collector-refuses-a-commit-file-list-that-may-be-truncated", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts, filesToEffect } = await importResolver();
  // GitHub truncates a commit's file list at 300 and this collector does not page it. A deletion
  // past the cut would read as "not deleted", so a completion that deletes more than 300 files and
  // later has one restored would verify. Blind review reproduced exactly that.
  const files = Array.from({ length: 300 }, (_, index) => ({
    filename: `docs/effect/bulk-${index}.md`,
    status: "removed"
  }));
  assert.equal(filesToEffect(files), null, "a full page is possibly truncated and cannot be measured");
  assert.notEqual(
    filesToEffect(files.slice(0, 299)),
    null,
    "one under the limit is a complete list and must still be usable"
  );

  const sha = "3003003003003003003003003003003003003003";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 930,
      merge_commit_sha: sha,
      body: "Ticket: D0-001\nTicket-Completion: D0-001\n\nD0-001 completion merge.",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha, 930930),
      added_paths: []
    }
  ]);
  responses[`${COLLECTOR_REPO_PATH}/commits/${sha}`] = { sha, files };
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  const entry = (collected.facts?.implementationMerges ?? []).find((row) => row.number === 930);
  if (entry) {
    assert.equal(entry.changed_paths, null, "a truncated list must not be recorded as a measured set");
    assert.equal(entry.removed_paths, null, "a truncated list must not be recorded as no removals");
  }
});

test("collector-refuses-a-rename-whose-old-path-is-missing", async () => {
  const { filesToEffect } = await importResolver();
  // Silently skipping such an entry reports "this merge removed nothing" for a merge that removed
  // something. Unavailable and empty are different answers and only one of them is honest here.
  assert.equal(
    filesToEffect([{ filename: "docs/effect/new-name.md", status: "renamed" }]),
    null,
    "a rename with no previous_filename is incomplete evidence, not an empty removed set"
  );
  const complete = filesToEffect([
    { filename: "docs/effect/new-name.md", status: "renamed", previous_filename: "docs/effect/old-name.md" }
  ]);
  assert.deepEqual(complete, {
    changed: ["docs/effect/new-name.md"],
    removed: ["docs/effect/old-name.md"]
  });
  // An entry missing a status is the same class of gap.
  assert.equal(filesToEffect([{ filename: "docs/effect/x.md" }]), null, "a file with no status cannot be placed");
});

test("a-path-the-merge-both-removed-and-left-behind-counts-as-surviving", async () => {
  const { filesToEffect } = await importResolver();
  // A merge may rename `A` to `B` and add a replacement `A` in the same commit. GitHub then reports
  // `A` as added and as the rename's previous_filename. `A` is at the tip and belongs there, so
  // counting it as removed refuses a completion whose effect is entirely intact.
  const effect = filesToEffect([
    { filename: "docs/effect/B.md", status: "renamed", previous_filename: "docs/effect/A.md" },
    { filename: "docs/effect/A.md", status: "added" }
  ]);
  assert.deepEqual(effect.changed, ["docs/effect/A.md", "docs/effect/B.md"]);
  assert.deepEqual(effect.removed, [], "a path the merge left behind is not one it took away");
  // The control: without the replacement, the old path is genuinely removed.
  const withoutReplacement = filesToEffect([
    { filename: "docs/effect/B.md", status: "renamed", previous_filename: "docs/effect/A.md" }
  ]);
  assert.deepEqual(withoutReplacement.removed, ["docs/effect/A.md"]);
});

test("completion-whose-whole-effect-is-a-deletion-verifies", async () => {
  // Blind review: after the removed-path check passed, an empty added set fell into the changed
  // fallback, and since removals are excluded from the changed set it was rejected as UNKNOWN. That
  // makes "delete this" a kind of work that can never verify. My earlier positive test evaded it by
  // inventing an unrelated added file -- a check aimed at something the fixture itself minted.
  const facts = makeCompletionEffectFacts({
    addedPaths: [],
    changedPaths: [],
    removedPaths: ["docs/effect/retired.md"],
    presentPaths: []
  });
  const { result } = await resolveOffline(facts);
  const state = ticketState(result, "D0-004");
  assert.equal(
    state.phase,
    "verified",
    `a deletion that held is a confirmed effect, got phase=${state.phase} blockers=${blockerCodes(state).join(",")}`
  );
  assert.deepEqual(blockerCodes(state), []);

  // The matching refusal, differing only in whether the deletion held.
  const undone = makeCompletionEffectFacts({
    addedPaths: [],
    changedPaths: [],
    removedPaths: ["docs/effect/retired.md"],
    presentPaths: ["docs/effect/retired.md"]
  });
  const { result: undoneResult } = await resolveOffline(undone);
  assert.ok(
    blockerCodes(ticketState(undoneResult, "D0-004")).includes("COMPLETION_EFFECT_REVERTED"),
    "a deletion-only completion whose file came back must not verify"
  );
});

test("collector-fails-closed-when-the-merged-receipt-search-cannot-be-completed", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  // Pagination must not become a silent truncation: a payload that promises more results
  // than it ever returns is absence of evidence and fails the whole collection closed.
  const responses = buildCollectorMergedSearchFixture([
    { number: 880, merge_commit_sha: "8800880088008800880088008800880088008800", body: "Ticket: D0-001\n" }
  ]);
  for (const key of Object.keys(responses)) {
    if (key.startsWith("search/issues?q=") && key.includes("Ticket")) {
      responses[key] = { ...responses[key], total_count: 500 };
    }
  }
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false, "an incomplete merged-receipt search must fail closed");
  assert.match(collected.reason, /merged Ticket PR search/i);
});

test("collector-skips-search-false-positive-with-no-anchored-ticket-field", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  // GitHub full-text search matches the bare substring "Ticket:", so it returns merged PRs
  // whose bodies only mention it in prose. Zero anchored `Ticket: <ID>` lines is not a
  // malformed field — the PR is simply not linked — so it is skipped, not fail-closed.
  // Live proof this matters: merged PR #123 "docs: invalidate stale D0-001 gate evidence"
  // has zero anchored fields, and failing closed on it made online-strict permanently
  // unusable by aborting the whole collection before any ticket resolved.
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 901,
      merge_commit_sha: "9010901090109010901090109010901090109010",
      body: "See Ticket: D0-001 mentioned inline, not an anchored structured field."
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true);
  const receipts = (collected.facts?.implementationMerges ?? []).filter((entry) => entry.number === 901);
  assert.equal(receipts.length, 0, "an unlinked search false positive must not become a receipt");
});

test("collector-fails-closed-on-duplicated-ticket-field-on-searched-receipt", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 902,
      merge_commit_sha: "9020902090209020902090209020902090209020",
      body: "Ticket: D0-001\nTicket: D0-001\n"
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /duplicated Ticket field/i);
});

test("collector-records-unreachable-completion-merge-and-resolver-fails-closed", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = "9030903090309030903090309030903090309030";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 903,
      merge_commit_sha: sha,
      body: "Ticket: D0-001\nTicket-Completion: D0-001",
      compare: { status: "diverged" },
      runs: collectorSuccessRuns(sha, 903001),
      added_paths: ["docs/effect/903.md"]
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  // Ancestry itself is a fact, not an outage: the collection succeeds and records
  // reachable:false for the resolver to fail closed on.
  assert.equal(collected.ok, true, collected.reason);
  const entry = collected.facts.implementationMerges.find((row) => row.merge_commit_sha === sha);
  assert.ok(entry, "collector must record the implementation merge receipt");
  assert.equal(entry.reachable, false);
  const result = await resolveCollectedOnline(collected);
  const d0001 = result.tickets["D0-001"];
  assert.notEqual(d0001.phase, "verified");
  assert.ok((d0001.blockers ?? []).map((b) => b.code).includes("TICKET_CONTRACT_CONFLICT"));
});

test("collector-fails-closed-on-completion-merge-ancestry-api-outage", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = "9040904090409040904090409040904090409040";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 904,
      merge_commit_sha: sha,
      body: "Ticket: D0-001\nTicket-Completion: D0-001",
      compare: null, // fixture outage sentinel
      // A valid post-merge CI response is present so the ancestry outage — not a missing
      // downstream fixture — is what fails the collection closed.
      runs: collectorSuccessRuns(sha, 904001)
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
});

test("collector-fails-closed-on-unknown-ancestry-compare-status", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = "9045904590459045904590459045904590459045";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 9045,
      merge_commit_sha: sha,
      body: "Ticket: D0-001\nTicket-Completion: D0-001",
      compare: { status: "sideways-unexpected-status" },
      runs: collectorSuccessRuns(sha, 904501)
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
});

test("collector-level-zero-completion-markers-is-unverified-not-error", async () => {
  // A single plain contributing merge with passing CI and authenticated reachability but
  // no completion marker — the exact shape the rejected prior implementation auto-verified
  // (single receipt, passing CI, marker ignored). It must stay unverified and error-free.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const shaA = "9050905090509050905090509050905090509050";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 905,
      merge_commit_sha: shaA,
      body: "Ticket: D0-004\n\nplain contributing merge, no completion marker.",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(shaA, 905001)
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const result = await resolveCollectedOnline(collected);
  const d0004 = result.tickets["D0-004"];
  assert.notEqual(d0004.phase, "verified");
  assert.deepEqual((d0004.blockers ?? []).map((b) => b.code), []);
});

test("collector-level-duplicate-completion-markers-fails-closed", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const shaA = "9070907090709070907090709070907090709070";
  const shaB = "9080908090809080908090809080908090809080";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 907,
      merge_commit_sha: shaA,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(shaA, 907001),
      added_paths: ["docs/effect/907.md"]
    },
    {
      number: 908,
      merge_commit_sha: shaB,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(shaB, 908001),
      added_paths: ["docs/effect/908.md"]
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const result = await resolveCollectedOnline(collected);
  const d0004 = result.tickets["D0-004"];
  assert.notEqual(d0004.phase, "verified");
  assert.ok((d0004.blockers ?? []).map((b) => b.code).includes("TICKET_CONTRACT_CONFLICT"));
});

test("collector-level-latest-ci-attempt-failure-not-masked-by-earlier-success", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = "9090909090909090909090909090909090909090";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 909,
      merge_commit_sha: sha,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      compare: { status: "behind" },
      added_paths: ["docs/effect/909.md"],
      runs: {
        total_count: 2,
        workflow_runs: [
          {
            id: 909001,
            name: "CI",
            path: ".github/workflows/ci.yml",
            head_sha: sha,
            status: "completed",
            conclusion: "success",
            run_attempt: 1
          },
          {
            // Higher run id: the genuinely latest attempt, and it failed. It must control
            // classification — never masked by the earlier successful attempt above.
            id: 909002,
            name: "CI",
            path: ".github/workflows/ci.yml",
            head_sha: sha,
            status: "completed",
            conclusion: "failure",
            run_attempt: 1
          }
        ]
      }
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const result = await resolveCollectedOnline(collected);
  const d0004 = result.tickets["D0-004"];
  assert.notEqual(d0004.phase, "verified");
  assert.ok((d0004.blockers ?? []).map((b) => b.code).includes("POST_MERGE_CI_FAILED"));
});

test("collector-accepts-authenticated-live-tip-ci-when-exact-sha-is-wedged", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const mergeSha = WEDGED_E8004_MERGE_SHA;
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 259,
      merge_commit_sha: mergeSha,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      compare: { status: "behind" },
      added_paths: FORM_A_INTRODUCED_PATHS,
      runs: {
        total_count: 1,
        workflow_runs: [
          {
            id: 32213166652,
            name: "CI",
            path: ".github/workflows/ci.yml",
            head_sha: mergeSha,
            status: "queued",
            conclusion: null,
            run_attempt: 1
          }
        ]
      }
    }
  ]);
  responses[`${COLLECTOR_REPO_PATH}/actions/runs?head_sha=${COLLECTOR_DEV_TIP}&event=push&per_page=20`] =
    collectorSuccessRuns(COLLECTOR_DEV_TIP, 33000000001);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  assert.equal(
    collected.facts.ancestry?.[`${COLLECTOR_DEV_TIP}...${mergeSha}`],
    "behind",
    "collector must record the compare that authenticates merge <= live tip"
  );
  assert.ok(
    (collected.facts.postMergeCI ?? []).some(
      (row) =>
        row.head_sha === COLLECTOR_DEV_TIP &&
        row.status === "completed" &&
        row.conclusion === "success"
    ),
    "collector must keep the authenticated live-tip CI success for the descendant fallback"
  );
  const result = await resolveCollectedOnline(collected);
  const d0004 = result.tickets["D0-004"];
  assert.equal(
    d0004.phase,
    "verified",
    `live-tip descendant CI must verify the wedged completion, got phase=${d0004.phase} blockers=${(d0004.blockers ?? []).map((b) => b.code).join(",") || "none"}`
  );
});

test("collector-does-not-fetch-live-tip-ci-when-exact-sha-succeeds", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 261,
      merge_commit_sha: sha,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      compare: { status: "behind" },
      added_paths: ["docs/effect/261.md"],
      runs: collectorSuccessRuns(sha, 261001)
    }
  ]);
  delete responses[`${COLLECTOR_REPO_PATH}/actions/runs?head_sha=${COLLECTOR_DEV_TIP}&event=push&per_page=20`];
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(
    collected.ok,
    true,
    `exact-SHA success must not require a live-tip CI fetch: ${collected.reason}`
  );
});

test("collector-does-not-treat-unauthenticated-sibling-ci-as-descendant", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const mergeSha = WEDGED_E8004_MERGE_SHA;
  const siblingSha = SIBLING_CI_SHA;
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 259,
      merge_commit_sha: mergeSha,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      compare: { status: "behind" },
      added_paths: FORM_A_INTRODUCED_PATHS,
      runs: {
        total_count: 1,
        workflow_runs: [
          {
            id: 32213166652,
            name: "CI",
            path: ".github/workflows/ci.yml",
            head_sha: mergeSha,
            status: "queued",
            conclusion: null,
            run_attempt: 1
          }
        ]
      }
    },
    {
      number: 260,
      merge_commit_sha: siblingSha,
      body: "Ticket: D0-004\n\nplain contributing merge.",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(siblingSha, 33000000002)
    }
  ]);
  responses[`${COLLECTOR_REPO_PATH}/actions/runs?head_sha=${COLLECTOR_DEV_TIP}&event=push&per_page=20`] = {
    total_count: 0,
    workflow_runs: []
  };
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  const result = await resolveCollectedOnline(collected);
  const d0004 = result.tickets["D0-004"];
  assert.notEqual(d0004.phase, "verified");
  assert.ok(
    (d0004.blockers ?? []).map((b) => b.code).includes("POST_MERGE_CI_MISSING"),
    `sibling CI without merge<=sibling must stay missing, got ${(d0004.blockers ?? []).map((b) => b.code).join(",") || "none"}`
  );
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
    ...(facts.workflowRuns ?? []).filter((r) => r.name !== "planning-contract (22)"),
    {
      name: "planning-contract (22)",
      run_id: 1,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
      ...runMeta
    },
    {
      name: "planning-contract (22)",
      run_id: 1,
      run_attempt: 2,
      status: "completed",
      conclusion: "failure",
      ...runMeta
    }
  ];
  facts.checkRuns = (facts.checkRuns ?? []).map((c) =>
    c.name === "planning-contract (22)"
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

  // Two merged PRs that genuinely claim the same structured batch field remain
  // an abort. Search cardinality alone is not the signal: both bodies parse as
  // the expected id, so this stays fail-closed after exact-field selection.
  {
    const responses = { ...base };
    const key = Object.keys(responses).find((entry) => entry.startsWith("search/issues?q=") && entry.includes("Gate-Batch"));
    assert.ok(key);
    responses[key] = {
      total_count: 2,
      incomplete_results: false,
      items: [{ number: 200 }, { number: 201 }]
    };
    responses[`${repoPath}/pulls/201`] = {
      ...base[`${repoPath}/pulls/200`],
      number: 201,
      body: "Gate-Batch: batch-d0-004-fixture\n"
    };
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(collected.ok, false);
    assert.match(collected.reason, /ambiguous gate PR set for batch batch-d0-004-fixture/i);
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

const hyphenTokens = (id) => String(id).split("-").filter((token) => token.length > 0);

const isHyphenTokenPrefix = (shorter, longer) => {
  const prefix = hyphenTokens(shorter);
  const candidate = hyphenTokens(longer);
  if (prefix.length === 0 || prefix.length >= candidate.length) return false;
  return prefix.every((token, index) => token === candidate[index]);
};

// Hazard class: GitHub search for an ACCEPTED id also returns bodies whose
// hyphen-token sequence merely extends that id. Only the shorter id receives
// those false candidates, and only ACCEPTED rows are searched. An INVALIDATED
// shorter id next to a longer id is therefore out of scope.
const acceptedIdsThatAreTokenPrefixes = (batches) => {
  const rows = (Array.isArray(batches) ? batches : []).filter(
    (batch) => batch && typeof batch.id === "string" && batch.id.length > 0
  );
  const collisions = [];
  for (const accepted of rows.filter((batch) => batch.status === "ACCEPTED")) {
    for (const other of rows) {
      if (other.id === accepted.id) continue;
      if (isHyphenTokenPrefix(accepted.id, other.id)) {
        collisions.push({
          acceptedId: accepted.id,
          otherId: other.id,
          otherStatus: other.status ?? null
        });
      }
    }
  }
  return collisions;
};

test("gate-receipt-search-false-token-prefix-candidate-does-not-abort-collection", async () => {
  // Search returns the true receipt plus a longer-id false candidate first.
  // Today's collector aborts on search cardinality before the exact parser runs.
  // After the reorder, only the body whose structured field equals the expected
  // id is kept, and every downstream receipt check still runs on that pull.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = clone(
    JSON.parse(
      readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
    )
  );
  const repoPath = "repos/MongLong0214/agent-operator-score";
  const expectedId = "batch-d0-004-fixture";
  const falseId = "batch-d0-004-fixture-renewal";
  const key = Object.keys(responses).find(
    (entry) => entry.startsWith("search/issues?q=") && entry.includes("Gate-Batch")
  );
  assert.ok(key, "fixture gate search key");
  const trueNumber = 200;
  const falseNumber = 9201;
  responses[key] = {
    total_count: 2,
    incomplete_results: false,
    items: [{ number: falseNumber }, { number: trueNumber }]
  };
  responses[`${repoPath}/pulls/${falseNumber}`] = {
    number: falseNumber,
    body: `Gate-Batch: ${falseId}\n`,
    base: { ref: "dev" },
    head: { sha: "dddddddddddddddddddddddddddddddddddddddd" },
    merged: true,
    merged_by: { login: "MongLong0214" },
    merge_commit_sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    user: { login: "MongLong0214" }
  };

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(
    collected.ok,
    true,
    `false prefix candidate must not abort collection, got ${collected.reason}`
  );
  assert.ok(collected.facts, "exact-field selection must still produce a facts corpus");
  const gatePRs = collected.facts.gatePRs;
  assert.equal(gatePRs.length, 1, `expected one exact receipt, got ${gatePRs.map((pr) => pr.number).join(",")}`);
  assert.equal(gatePRs[0].number, trueNumber);
  assert.match(gatePRs[0].body, /^Gate-Batch: batch-d0-004-fixture\s*$/m);
  assert.equal(
    gatePRs.some((pr) => pr.number === falseNumber),
    false,
    "the longer-id false candidate must not be selected"
  );
});

test("gate-receipt-search-only-false-token-prefix-candidate-is-unmatched", async () => {
  // A search that returns only the longer-id false candidate must become the
  // same unmatched accepted-row outcome as a zero-result search, not a
  // whole-resolution abort and not a receipt for the false id.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = clone(
    JSON.parse(
      readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
    )
  );
  const repoPath = "repos/MongLong0214/agent-operator-score";
  const key = Object.keys(responses).find(
    (entry) => entry.startsWith("search/issues?q=") && entry.includes("Gate-Batch")
  );
  assert.ok(key, "fixture gate search key");
  const falseNumber = 9201;
  responses[key] = {
    total_count: 1,
    incomplete_results: false,
    items: [{ number: falseNumber }]
  };
  responses[`${repoPath}/pulls/${falseNumber}`] = {
    number: falseNumber,
    body: "Gate-Batch: batch-d0-004-fixture-renewal\n",
    base: { ref: "dev" },
    head: { sha: "dddddddddddddddddddddddddddddddddddddddd" },
    merged: true,
    merged_by: { login: "MongLong0214" },
    merge_commit_sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    user: { login: "MongLong0214" }
  };

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(
    collected.ok,
    true,
    `only-false-candidate search must not abort collection, got ${collected.reason}`
  );
  assert.deepEqual(collected.facts.gatePRs, []);
});

test("gate-batch-corpus-search-call-count-does-not-grow-with-accepted-batches", async () => {
  // One search/issues call per accepted batch grows with the registry and hits
  // GitHub's 30/min search ceiling. The corpus shape is one Gate-Batch search
  // plus one Ticket search, independent of how many ACCEPTED rows exist.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = clone(
    JSON.parse(
      readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
    )
  );
  const extraIds = [
    "batch-extra-unmatched-a",
    "batch-extra-unmatched-b",
    "batch-extra-unmatched-c",
    "batch-extra-unmatched-d",
    "batch-extra-unmatched-e",
    "batch-extra-unmatched-f",
    "batch-extra-unmatched-g",
    "batch-extra-unmatched-h"
  ];
  addUnmatchedAcceptedBatches(responses, extraIds);
  installGateBatchCorpusFromFixture(responses);

  const searchCalls = [];
  const collected = collectLiveExecutionFacts(root, {
    transport: wrapCountingTransport(createFixtureTransport(responses), searchCalls)
  });
  assert.equal(collected.ok, true, collected.reason);
  assert.ok(collected.facts, "corpus collection must still produce a facts corpus");
  assert.equal(collected.facts.gatePRs.length, 1, "the fixture receipt must still be selected");
  assert.equal(collected.facts.gatePRs[0].number, 200);
  assert.equal(
    searchCalls.length,
    2,
    `search/issues calls must stay at 2 (Gate-Batch corpus + Ticket corpus), got ${searchCalls.length}: ${searchCalls.join(" | ")}`
  );
  assert.equal(
    searchCalls.filter((path) => path.includes("Gate-Batch%3A%20")).length,
    0,
    `per-batch Gate-Batch searches must not be issued, got ${searchCalls.join(" | ")}`
  );
  assert.equal(searchCalls.filter((path) => path.includes("Gate-Batch")).length, 1);
  assert.equal(searchCalls.filter((path) => path.includes("Ticket")).length, 1);
});

test("truncated-gate-batch-corpus-fails-closed-not-as-unmatched-receipts", async () => {
  // An incomplete empty corpus looks like "no receipts". That is the fail-open
  // the resolver exists to refuse: absence of a complete corpus is not evidence
  // that every accepted batch is unmatched.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = clone(
    JSON.parse(
      readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
    )
  );
  const corpusKey = installGateBatchCorpusFromFixture(responses);
  responses[corpusKey] = {
    total_count: 0,
    incomplete_results: true,
    items: []
  };

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false, "a truncated Gate-Batch corpus must fail the collection closed");
  assert.equal(collected.facts, null, "a truncated corpus must not resolve as unmatched / no receipts");
  assert.match(collected.reason, /incomplete|truncat|corpus|gate PR/i);
});

// Search `body` is a snippet, not the pull resource. A present string that does
// not parse as exactly one field is not evidence that the field is absent on
// the PR. The load-bearing assertion is the selected receipt (or the ambiguous
// abort), not collected.ok: the current skip already returns ok=true.
const GATE_BATCH_SEARCH_SNIPPETS_THAT_ARE_NOT_ABSENCE = [
  ["empty-body", ""],
  ["prose-prefix", "This PR accepts the batch.\nThe structured field is further down."],
  ["truncated-field", "Notes\nGate-Batch:"]
];

for (const [label, searchBody] of GATE_BATCH_SEARCH_SNIPPETS_THAT_ARE_NOT_ABSENCE) {
  test(`gate-batch-corpus-search-snippet-is-not-absence-of-receipt-${label}`, async () => {
    const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
    const responses = clone(
      JSON.parse(
        readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
      )
    );
    const repoPath = "repos/MongLong0214/agent-operator-score";
    const corpusKey = collectorGateBatchSearchPageKey(1);
    assert.ok(Object.hasOwn(responses, corpusKey), "fixture must answer the paged Gate-Batch corpus key");
    assert.equal(
      typeof responses[`${repoPath}/pulls/200`]?.body,
      "string",
      "the pull resource must still carry the real receipt; otherwise this case cannot fail"
    );
    responses[corpusKey] = {
      total_count: 1,
      incomplete_results: false,
      items: [{ number: 200, body: searchBody }]
    };

    const pullCalls = [];
    const collected = collectLiveExecutionFacts(root, {
      transport: wrapCountingPulls(createFixtureTransport(responses), pullCalls)
    });
    assert.equal(
      collected.ok,
      true,
      `${label}: collection must still succeed once the pull body is read, got ${collected.reason}`
    );
    const gatePRs = collected.facts?.gatePRs ?? [];
    assert.equal(
      gatePRs.length,
      1,
      `${label}: a search snippet must not drop the real receipt, got ${gatePRs.map((pr) => pr.number).join(",")}`
    );
    assert.equal(gatePRs[0].number, 200);
    assert.match(gatePRs[0].body, /^Gate-Batch: batch-d0-004-fixture\s*$/m);
    assert.ok(
      pullCalls.includes(`${repoPath}/pulls/200`),
      `${label}: the authoritative pull must be fetched; search body is not the receipt`
    );
  });
}

test("gate-batch-corpus-search-snippet-does-not-collapse-ambiguous-receipts", async () => {
  // Two merged PRs that both claim the same batch must abort. The skip is the
  // only thing that changes that verdict: an empty search body on #200 drops
  // it and #201 becomes a unique accept. A case that only restated the
  // no-body control would already pass and would not pin this defect.
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const base = clone(
    JSON.parse(
      readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
    )
  );
  const repoPath = "repos/MongLong0214/agent-operator-score";
  const corpusKey = collectorGateBatchSearchPageKey(1);
  assert.ok(Object.hasOwn(base, corpusKey), "fixture must answer the paged Gate-Batch corpus key");
  const secondClaimant = {
    ...base[`${repoPath}/pulls/200`],
    number: 201,
    body: "Gate-Batch: batch-d0-004-fixture\n"
  };

  {
    const responses = clone(base);
    responses[corpusKey] = {
      total_count: 2,
      incomplete_results: false,
      items: [{ number: 200, body: "" }, { number: 201 }]
    };
    responses[`${repoPath}/pulls/201`] = secondClaimant;
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(
      collected.ok,
      false,
      `empty search body must not turn an ambiguous set into a unique accept, got ok=${collected.ok} gatePRs=${(collected.facts?.gatePRs ?? []).map((pr) => pr.number).join(",")}`
    );
    assert.equal(collected.facts, null);
    assert.match(collected.reason, /ambiguous gate PR set for batch batch-d0-004-fixture/i);
  }

  {
    const responses = clone(base);
    responses[corpusKey] = {
      total_count: 2,
      incomplete_results: false,
      items: [{ number: 200 }, { number: 201 }]
    };
    responses[`${repoPath}/pulls/201`] = secondClaimant;
    const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
    assert.equal(collected.ok, false, "control: two claimants with no search bodies must still abort");
    assert.match(collected.reason, /ambiguous gate PR set for batch batch-d0-004-fixture/i);
  }
});

test("accepted-batch-ids-must-not-be-hyphen-token-prefixes-of-any-registry-id", () => {
  const canary = acceptedIdsThatAreTokenPrefixes([
    { id: "accepted-short", status: "ACCEPTED" },
    { id: "accepted-short-extension", status: "INVALIDATED" },
    { id: "unrelated", status: "ACCEPTED" }
  ]);
  assert.deepEqual(
    canary,
    [
      {
        acceptedId: "accepted-short",
        otherId: "accepted-short-extension",
        otherStatus: "INVALIDATED"
      }
    ],
    "the predicate must detect an ACCEPTED id that is a hyphen-token prefix of another id"
  );
  assert.deepEqual(
    acceptedIdsThatAreTokenPrefixes([
      { id: "historical-short", status: "INVALIDATED" },
      { id: "historical-short-extension", status: "ACCEPTED" }
    ]),
    [],
    "an INVALIDATED shorter id is outside the searched hazard class"
  );

  const registry = JSON.parse(
    readFileSync(resolve(root, "docs/decisions/maintainer-gate-registry.v2.json"), "utf8")
  );
  const collisions = acceptedIdsThatAreTokenPrefixes(registry.batches);
  assert.deepEqual(
    collisions,
    [],
    `ACCEPTED batch ids must not be hyphen-token prefixes of any registry id, got ${JSON.stringify(collisions)}`
  );
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

  // Both required jobs point to the same check-run. The first name happens
  // to agree, but the remaining job must neither reuse its ID nor accept its name.
  for (const job of responses[jobsKey].jobs) {
    job.check_run_url = "https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/9001";
  }

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /check-run name|already mapped|already consumed|one-to-one/i);

  const reused = clone(base);
  for (const job of reused[jobsKey].jobs) {
    job.name = "planning-contract (22)";
    job.check_run_url = "https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/9001";
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

test("github-secondary-rate-limit-detector-requires-403-and-message", async () => {
  const { isGitHubSecondaryRateLimit } = await importResolver();
  assert.equal(typeof isGitHubSecondaryRateLimit, "function");
  const secondary403 = new Error("gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)");
  secondary403.status = 1;
  secondary403.stderr = "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)";
  assert.equal(isGitHubSecondaryRateLimit(secondary403), true);

  const forbidden403 = new Error("gh: Resource not accessible by integration (HTTP 403)");
  forbidden403.status = 1;
  forbidden403.stderr = "gh: Resource not accessible by integration (HTTP 403)";
  assert.equal(isGitHubSecondaryRateLimit(forbidden403), false);

  const spoofed200 = new Error("You have exceeded a secondary rate limit");
  spoofed200.status = 0;
  spoofed200.stderr = "You have exceeded a secondary rate limit";
  assert.equal(isGitHubSecondaryRateLimit(spoofed200), false);
});

test("collection-concurrency-mapper-preserves-order-and-caps-in-flight", async () => {
  const { mapWithBoundedConcurrency, DEFAULT_COLLECTION_CONCURRENCY } = await importResolver();
  assert.equal(DEFAULT_COLLECTION_CONCURRENCY, 8);
  assert.ok(DEFAULT_COLLECTION_CONCURRENCY > 1);

  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const results = await mapWithBoundedConcurrency(items, 4, async (value) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return value * 10;
  });
  assert.deepEqual(results, items.map((value) => value * 10));
  assert.equal(maxInFlight, 4);
});

test("collection-concurrency-mapper-fails-closed-on-secondary-rate-limit-without-retry", async () => {
  const { mapWithBoundedConcurrency, isGitHubSecondaryRateLimit } = await importResolver();
  const launched = [];
  const error = new Error("gh: You have exceeded a secondary rate limit. (HTTP 403)");
  error.status = 1;
  error.stderr = "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)";
  error.code = "SECONDARY_RATE_LIMIT";
  await assert.rejects(
    () =>
      mapWithBoundedConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async (value) => {
        launched.push(value);
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (value === 2) throw error;
        return value;
      }),
    (caught) => caught.code === "SECONDARY_RATE_LIMIT" && isGitHubSecondaryRateLimit(caught)
  );
  assert.ok(launched.includes(2), "the failing item must have been attempted once");
  assert.ok(!launched.includes(2) || launched.filter((value) => value === 2).length === 1, "must not retry the failing item");
  assert.equal(launched.filter((value) => value === 2).length, 1);
  assert.ok(
    launched.every((value) => value <= 4),
    `must stop launching after the secondary rate limit, launched=${launched.join(",")}`
  );
});

test("github-transport-getJsonMany-fails-closed-on-secondary-rate-limit-without-retry", async () => {
  const { createAuthenticatedGitHubTransport } = await importResolver();
  let runManyCalls = 0;
  const transport = createAuthenticatedGitHubTransport(root, {
    execFileSync() {
      throw new Error("single-call gh api path should not run for getJsonMany");
    },
    concurrency: 8,
    runMany() {
      runManyCalls += 1;
      const error = new Error("GitHub secondary rate limit on repos/example");
      error.code = "SECONDARY_RATE_LIMIT";
      throw error;
    }
  });
  assert.equal(typeof transport.getJsonMany, "function");
  assert.throws(
    () => transport.getJsonMany(["repos/MongLong0214/agent-operator-score", "rate_limit"]),
    (error) => error.code === "SECONDARY_RATE_LIMIT"
  );
  assert.equal(runManyCalls, 1, "a secondary rate limit must fail closed, not retry the batch");
});

test("github-transport-getJsonMany-accepts-pool-payloads-larger-than-pipe-buffer", async () => {
  const { createAuthenticatedGitHubTransport } = await importResolver();
  const paths = Array.from({ length: 12 }, (_, i) => `item/${i}`);
  const results = withFakeGh({ pad: 6000 }, () => {
    const transport = createAuthenticatedGitHubTransport(root, {
      totalTimeoutMs: 30_000,
      perCallTimeoutMs: 10_000
    });
    return transport.getJsonMany(paths);
  });
  assert.equal(results.length, 12);
  assert.equal(results.every((row) => row.ok === true), true, results.find((row) => !row.ok)?.reason);
  assert.equal(results[11].value.path, "item/11");
  const workerPayloadBytes = Buffer.byteLength(
    JSON.stringify(results.map((row, i) => ({ ok: true, raw: JSON.stringify({ path: paths[i], pad: "p".repeat(6000) }) })))
  );
  assert.ok(
    workerPayloadBytes > 65536,
    `spawned worker payload must exceed the 64KiB pipe buffer, got ${workerPayloadBytes}`
  );
});

test("live-collector-batches-independent-merged-pr-bodies", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = (nibble) => nibble.repeat(40);
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 901,
      merge_commit_sha: sha("1"),
      body: "Ticket: D0-004\n",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha("1"), 901)
    },
    {
      number: 902,
      merge_commit_sha: sha("2"),
      body: "Ticket: D0-004\nTicket-Completion: D0-004\n",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha("2"), 902),
      added_paths: ["docs/effect/902.md"]
    },
    {
      number: 904,
      merge_commit_sha: sha("4"),
      body: "Ticket: D0-004\n",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha("4"), 904)
    }
  ]);
  const inner = createFixtureTransport(responses);
  const batches = [];
  const transport = {
    kind: inner.kind,
    getJson: inner.getJson.bind(inner),
    getRaw: inner.getRaw.bind(inner),
    getJsonMany(apiPaths) {
      batches.push([...apiPaths]);
      return apiPaths.map((path) => {
        try {
          return { ok: true, value: inner.getJson(path) };
        } catch (error) {
          return { ok: false, reason: String(error?.message ?? error), error };
        }
      });
    }
  };
  const collected = collectLiveExecutionFacts(root, { transport });
  assert.equal(collected.ok, true, collected.reason);
  const pullBatch = batches.find(
    (batch) => batch.filter((path) => /\/pulls\/(901|902|904)$/.test(path)).length === 3
  );
  assert.ok(
    pullBatch,
    `independent merged PR bodies must be fetched as one batch, got ${JSON.stringify(batches)}`
  );
  const searchReceiptNumbers = collected.facts.implementationMerges
    .map((row) => row.number)
    .filter((number) => number === 901 || number === 902 || number === 904);
  assert.deepEqual(searchReceiptNumbers, [901, 902, 904]);
});

test("live-collector-batched-receipts-preserve-search-order", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const sha = (nibble) => nibble.repeat(40);
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 901,
      merge_commit_sha: sha("a"),
      body: "Ticket: D0-004\n",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha("a"), 901)
    },
    {
      number: 902,
      merge_commit_sha: sha("b"),
      body: "Ticket: D0-004\nTicket-Completion: D0-004\n",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha("b"), 902),
      added_paths: ["docs/effect/902-order.md"]
    },
    {
      number: 904,
      merge_commit_sha: sha("c"),
      body: "Ticket: D0-004\n",
      compare: { status: "behind" },
      runs: collectorSuccessRuns(sha("c"), 904)
    }
  ]);
  const inner = createFixtureTransport(responses);
  const batches = [];
  const transport = {
    kind: inner.kind,
    getJson: inner.getJson.bind(inner),
    getRaw: inner.getRaw.bind(inner),
    getJsonMany(apiPaths) {
      batches.push([...apiPaths]);
      const byPath = new Map();
      for (const path of [...apiPaths].reverse()) {
        try {
          byPath.set(path, { ok: true, value: inner.getJson(path) });
        } catch (error) {
          byPath.set(path, { ok: false, reason: String(error?.message ?? error), error });
        }
      }
      return apiPaths.map((path) => byPath.get(path));
    }
  };
  const sequential = collectLiveExecutionFacts(root, { transport: inner });
  const batched = collectLiveExecutionFacts(root, { transport });
  assert.equal(sequential.ok, true, sequential.reason);
  assert.equal(batched.ok, true, batched.reason);
  assert.ok(
    batches.some((batch) => batch.filter((path) => /\/pulls\/(901|902|904)$/.test(path)).length === 3),
    "order comparison is only meaningful once independent pulls are actually batched"
  );
  assert.deepEqual(
    batched.facts.implementationMerges.map((row) => ({
      number: row.number,
      merge_commit_sha: row.merge_commit_sha,
      ticket_id: row.ticket_id,
      added_paths: row.added_paths
    })),
    sequential.facts.implementationMerges.map((row) => ({
      number: row.number,
      merge_commit_sha: row.merge_commit_sha,
      ticket_id: row.ticket_id,
      added_paths: row.added_paths
    }))
  );
});

test("live-collector-fails-closed-on-secondary-rate-limit-without-retry", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const responses = JSON.parse(
    readFileSync(resolve(root, "fixtures/operational-state/live-adapter/transport-responses.json"), "utf8")
  );
  const inner = createFixtureTransport(responses);
  let manyCalls = 0;
  const transport = {
    kind: inner.kind,
    getJson: inner.getJson.bind(inner),
    getRaw: inner.getRaw.bind(inner),
    getJsonMany(apiPaths) {
      manyCalls += 1;
      const error = new Error(`GitHub secondary rate limit on ${apiPaths[0]}`);
      error.code = "SECONDARY_RATE_LIMIT";
      throw error;
    }
  };
  const collected = collectLiveExecutionFacts(root, { transport });
  assert.equal(collected.ok, false);
  assert.match(collected.reason, /secondary rate limit/i);
  assert.equal(manyCalls, 1, "must not retry or degrade concurrency after a secondary rate limit");
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
    ...["planning-contract (22)", "planning-contract (24)"].map((name, i) => ({
      id: 9100 + i,
      name,
      status: "completed",
      conclusion: "success",
      app: { id: 15368, slug: "github-actions" },
      run_id: 4001,
      run_attempt: 1
    })),
    ...["planning-contract (22)", "planning-contract (24)"].map((name, i) => ({
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
    ["planning-contract (22)", "planning-contract (24)"].map((name, i) => ({
      name,
      status: "completed",
      conclusion,
      run_id: runId,
      run_attempt: 1,
      check_run_url: `https://api.github.com/repos/MongLong0214/agent-operator-score/check-runs/${checkBase + i}`
    }));
  responses[`${repo}/actions/runs/4001/attempts/1/jobs?per_page=50`] = {
    total_count: 2,
    jobs: dualJobs(4001, "success", 9100)
  };
  responses[`${repo}/actions/runs/4002/attempts/1/jobs?per_page=50`] = {
    total_count: 2,
    jobs: dualJobs(4002, "failure", 9200)
  };

  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, true, collected.reason);
  assert.deepEqual(
    collected.facts.workflowRuns.map((entry) => [entry.run_id, entry.run_attempt, entry.conclusion]),
    [[4002, 1, "failure"], [4002, 1, "failure"]]
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
    [4001, 4001]
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
    withPresentEffect(facts, {
      ticket_id: "D0-004",
      merge_commit_sha: mergeSha,
      number: 999,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      reachable: true
    })
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
    withPresentEffect(facts, {
      ticket_id: "D0-004",
      merge_commit_sha: mergeSha,
      number: 998,
      body: "Ticket: D0-004\nTicket-Completion: D0-004",
      reachable: true
    })
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

  const searchKey = collectorGateBatchSearchPageKey(1);
  const existingCorpus = responses[searchKey] ?? { items: [], total_count: 0, incomplete_results: false };
  const corpusItems = [
    ...(Array.isArray(existingCorpus.items) ? existingCorpus.items : []).filter(
      (item) => item?.number !== GATE_PR_NUMBER
    ),
    { number: GATE_PR_NUMBER }
  ];
  responses[searchKey] = {
    total_count: corpusItems.length,
    incomplete_results: false,
    items: corpusItems
  };

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
        "planning-contract (22)",
        "planning-contract (24)",
        "operational-state-offline"
      ]
    : ["planning-contract (22)", "planning-contract (24)"];

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

test("github-transport-strips-ambient-colour-variables", async () => {
  const { createAuthenticatedGitHubTransport } = await importResolver();
  const saved = {
    CLICOLOR_FORCE: process.env.CLICOLOR_FORCE,
    FORCE_COLOR: process.env.FORCE_COLOR,
    GH_FORCE_TTY: process.env.GH_FORCE_TTY,
    NO_COLOR: process.env.NO_COLOR
  };
  process.env.CLICOLOR_FORCE = "1";
  process.env.FORCE_COLOR = "1";
  process.env.GH_FORCE_TTY = "1";
  delete process.env.NO_COLOR;

  let captured;
  const execFileSync = (file, args, options) => {
    captured = { file, args, options };
    return '{"ok":true}';
  };

  try {
    const transport = createAuthenticatedGitHubTransport(root, { execFileSync });
    assert.deepEqual(transport.getJson("repos/MongLong0214/agent-operator-score"), { ok: true });
    assert.equal(captured?.file, "gh");
    // Inheriting the caller env is the defect: an assertion on missing keys of
    // `undefined` would pass today. The child must receive an explicit map.
    assert.equal(captured?.options?.env != null && typeof captured.options.env === "object", true);
    const env = captured.options.env;
    assert.equal(Object.hasOwn(env, "CLICOLOR_FORCE"), false);
    assert.equal(Object.hasOwn(env, "FORCE_COLOR"), false);
    assert.equal(Object.hasOwn(env, "GH_FORCE_TTY"), false);
    assert.equal(env.NO_COLOR, "1");
    assert.equal(typeof env.PATH, "string");
    assert.notEqual(env.PATH, "");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("unparseable-transport-response-is-not-reported-as-empty-ready-set", async () => {
  const {
    createFixtureTransport,
    acquireOnlineStrictFacts,
    emptyFailureState,
    formatExecutionState,
    resolveExecutionState
  } = await importResolver();

  assert.equal(typeof emptyFailureState, "function");
  assert.equal(typeof formatExecutionState, "function");

  const ansiJson = "\u001b[1;38m{\u001b[m\n  \u001b[1;34m\"id\"\u001b[m\u001b[1;38m:\u001b[m 1\n";
  const acquired = acquireOnlineStrictFacts(root, {
    transport: createFixtureTransport({
      "repos/MongLong0214/agent-operator-score": ansiJson
    })
  });
  assert.equal(acquired.ok, false);
  assert.match(acquired.reason, /unparseable transport response/i);

  const unresolved = emptyFailureState(
    "online-strict",
    "2026-08-19T00:00:00.000Z",
    {
      repository: "MongLong0214/agent-operator-score",
      branch: "dev",
      head: null
    },
    [{ code: "EXTERNAL_STATE_UNAVAILABLE", reason: acquired.reason }]
  );
  assert.deepEqual(unresolved.readySet, []);
  assert.equal(Object.keys(unresolved.tickets).length, 0);
  const unresolvedText = formatExecutionState(unresolved);
  assert.match(unresolvedText, /unparseable transport response/i);
  assert.equal(
    /^readySet=none$/m.test(unresolvedText),
    false,
    "an unparseable transport must not print the readySet=none token a resolved empty set uses"
  );

  const facts = loadBaselineFacts();
  facts.tickets["D0-002"].dependencies = ["D0-999"];
  const blocked = resolveExecutionState({
    mode: "offline",
    root,
    facts,
    runtimeIdentity: {
      repository: facts.repository,
      branch: facts.defaultBranch,
      head: facts.currentHead
    }
  });
  assert.deepEqual(blocked.readySet, []);
  assert.ok(Object.keys(blocked.tickets).length > 0);
  assert.equal(
    (blocked.errors ?? []).some((entry) => /unparseable/i.test(entry.reason ?? "")),
    false
  );
  const blockedText = formatExecutionState(blocked);
  assert.match(blockedText, /^readySet=none$/m);
  assert.doesNotMatch(blockedText, /unparseable transport response/i);
  assert.notEqual(unresolvedText, blockedText);
});

test("published-schema-enum-covers-every-emittable-blocker-code", async () => {
  const { BLOCKER_CODES } = await importResolver();
  const schema = JSON.parse(
    readFileSync(resolve(root, "specs/execution-state.schema.v1.json"), "utf8")
  );
  const enumerated = schema?.$defs?.blockerCode?.enum ?? schema?.definitions?.blockerCode?.enum;
  assert.ok(Array.isArray(enumerated), "the schema must enumerate blocker codes");

  const emittable = [...BLOCKER_CODES].sort();
  const published = [...enumerated].sort();
  // Drift in either direction is a defect: a code the resolver can emit but the schema
  // rejects makes every run fail its own output validation, and a code the schema allows
  // but the resolver cannot emit is dead vocabulary.
  assert.deepEqual(published, emittable);
});

// ---------------------------------------------------------------------------
// Activation collector: a reviewer's current state, not the newest APPROVED (#270 finding 2).
// ---------------------------------------------------------------------------

const ACTIVATION_FIXTURE_REPO = "MongLong0214/agent-operator-score";

const activationReviewFixture = (reviews) => ({
  [`repos/${ACTIVATION_FIXTURE_REPO}/pulls/9270`]: {
    base: { ref: "dev" },
    head: { sha: "c270c270c270c270c270c270c270c270c270c270" },
    user: { id: 4001 },
    merged_by: { id: 4002 }
  },
  [`repos/${ACTIVATION_FIXTURE_REPO}/pulls/9270/reviews`]: reviews
});

const collectActivationReviewState = async (reviews) => {
  const { createFixtureTransport, collectAuthenticatedReviewActivationFacts } = await importResolver();
  const collected = collectAuthenticatedReviewActivationFacts(root, {
    repository: ACTIVATION_FIXTURE_REPO,
    prNumber: 9270,
    transport: createFixtureTransport(activationReviewFixture(reviews))
  });
  return collected.facts;
};

test("a-later-non-approval-by-the-same-reviewer-withdraws-the-approval", async () => {
  // Scanning the list in reverse for any APPROVED kept a stale approval alive after the same
  // reviewer requested changes at the same SHA. GitHub's current state for that reviewer is
  // CHANGES_REQUESTED, so reporting APPROVED misstates a live fact on the wired live path.
  const sha = "c270c270c270c270c270c270c270c270c270c270";
  const facts = await collectActivationReviewState([
    { state: "APPROVED", commit_id: sha, user: { id: 220022 } },
    { state: "CHANGES_REQUESTED", commit_id: sha, user: { id: 220022 } }
  ]);
  assert.equal(facts.review_state, undefined, "a withdrawn approval must not report APPROVED");
  assert.equal(facts.reviewer_id, undefined);
});

test("a-dismissed-approval-by-the-same-reviewer-does-not-survive", async () => {
  const sha = "c270c270c270c270c270c270c270c270c270c270";
  const facts = await collectActivationReviewState([
    { state: "APPROVED", commit_id: sha, user: { id: 220022 } },
    { state: "DISMISSED", commit_id: sha, user: { id: 220022 } }
  ]);
  assert.equal(facts.review_state, undefined, "a dismissed approval must not report APPROVED");
});

test("a-comment-after-an-approval-does-not-withdraw-it", async () => {
  // COMMENTED and PENDING never replace a reviewer's approval on GitHub, so treating them as
  // state-changing would fail closed on a PR that is genuinely approved.
  const sha = "c270c270c270c270c270c270c270c270c270c270";
  const facts = await collectActivationReviewState([
    { state: "APPROVED", commit_id: sha, user: { id: 220022 } },
    { state: "COMMENTED", commit_id: sha, user: { id: 220022 } }
  ]);
  assert.equal(facts.review_state, "APPROVED");
  assert.equal(facts.reviewer_id, 220022);
  assert.equal(facts.review_head_sha, sha);
});

test("changes-requested-then-approved-by-the-same-reviewer-is-an-approval", async () => {
  const sha = "c270c270c270c270c270c270c270c270c270c270";
  const facts = await collectActivationReviewState([
    { state: "CHANGES_REQUESTED", commit_id: sha, user: { id: 220022 } },
    { state: "APPROVED", commit_id: sha, user: { id: 220022 } }
  ]);
  assert.equal(facts.review_state, "APPROVED");
  assert.equal(facts.reviewer_id, 220022);
});

test("one-reviewers-withdrawal-does-not-cancel-another-reviewers-approval", async () => {
  const sha = "c270c270c270c270c270c270c270c270c270c270";
  const facts = await collectActivationReviewState([
    { state: "APPROVED", commit_id: sha, user: { id: 220022 } },
    { state: "CHANGES_REQUESTED", commit_id: sha, user: { id: 220022 } },
    { state: "APPROVED", commit_id: sha, user: { id: 330033 } }
  ]);
  assert.equal(facts.review_state, "APPROVED");
  assert.equal(facts.reviewer_id, 330033, "the approval must come from the reviewer who still approves");
});

test("ancestry-batch-failure-names-the-sha-being-classified", async () => {
  const { createFixtureTransport, collectLiveExecutionFacts } = await importResolver();
  const shaA = "a1".repeat(20);
  const shaB = "b2".repeat(20);
  const responses = buildCollectorMergedSearchFixture([
    {
      number: 2901,
      merge_commit_sha: shaA,
      body: "Ticket: D0-004\n",
      compare: null,
      runs: collectorSuccessRuns(shaA, 2901001)
    },
    {
      number: 2902,
      merge_commit_sha: shaB,
      body: "Ticket: D0-004\n",
      compare: null,
      runs: collectorSuccessRuns(shaB, 2902001)
    }
  ]);
  const collected = collectLiveExecutionFacts(root, { transport: createFixtureTransport(responses) });
  assert.equal(collected.ok, false);
  assert.match(
    collected.reason,
    new RegExp(shaA),
    `first ancestry failure must name SHA ${shaA}, got ${collected.reason}`
  );
  assert.equal(
    collected.reason.includes(shaB),
    false,
    `first ancestry failure must not be attributed to later SHA ${shaB}, got ${collected.reason}`
  );
});

test("getJsonMany-per-item-timeout-does-not-discard-batch-successes", async () => {
  const { createAuthenticatedGitHubTransport } = await importResolver();
  const transport = createAuthenticatedGitHubTransport(root, {
    execFileSync() {
      throw new Error("single-call gh api path should not run for getJsonMany");
    },
    runMany() {
      return [
        { ok: true, raw: JSON.stringify({ id: "ok-first" }) },
        { ok: false, message: "per-call timeout for repos/timeout/second", code: "ETIMEDOUT", killed: true },
        { ok: true, raw: JSON.stringify({ id: "ok-third" }) }
      ];
    }
  });
  let thrown = null;
  let results;
  try {
    results = transport.getJsonMany([
      "repos/ok/first",
      "repos/timeout/second",
      "repos/ok/third"
    ]);
  } catch (error) {
    thrown = error;
  }
  assert.equal(
    thrown,
    null,
    `a per-item timeout must not throw for the whole batch, got ${thrown?.message}`
  );
  assert.equal(results[0]?.ok, true, "an earlier ok:true result must be kept");
  assert.equal(results[0].value.id, "ok-first");
  assert.equal(results[2]?.ok, true, "a later ok:true result must be kept");
  assert.equal(results[2].value.id, "ok-third");
  assert.equal(results[1]?.ok, false);
  assert.equal(results[1]?.timeout, true);
  assert.match(results[1].reason, /repos\/timeout\/second/);
  assert.equal(
    /repos\/ok\/first/.test(results[1].reason),
    false,
    `timeout must name the call that timed out, got ${results[1].reason}`
  );
});

test("pool-worker-per-item-timeout-keeps-sibling-successes", async () => {
  const { createAuthenticatedGitHubTransport } = await importResolver();
  const results = withFakeGh({ mode: "hang-second" }, () => {
    const transport = createAuthenticatedGitHubTransport(root, {
      concurrency: 3,
      totalTimeoutMs: 10_000,
      perCallTimeoutMs: 400
    });
    return transport.getJsonMany([
      "repos/ok/first",
      "repos/timeout/second",
      "repos/ok/third"
    ]);
  });
  assert.equal(results[0]?.ok, true, "the worker must keep an earlier success across a sibling timeout");
  assert.equal(results[0].value.path, "repos/ok/first");
  assert.equal(results[2]?.ok, true, "the worker must keep a later success across a sibling timeout");
  assert.equal(results[2].value.path, "repos/ok/third");
  assert.equal(results[1]?.ok, false);
  assert.equal(results[1]?.timeout, true);
  assert.match(results[1].reason, /repos\/timeout\/second/);
});

test("pool-worker-secondary-rate-limit-names-the-failing-call", async () => {
  const { createAuthenticatedGitHubTransport } = await importResolver();
  withFakeGh({ mode: "ratelimit" }, () => {
    const transport = createAuthenticatedGitHubTransport(root, {
      concurrency: 1,
      totalTimeoutMs: 30_000,
      perCallTimeoutMs: 10_000
    });
    assert.throws(
      () => transport.getJsonMany(["repos/ok/first", "repos/limited/second"]),
      (error) =>
        error.code === "SECONDARY_RATE_LIMIT" &&
        /repos\/limited\/second/.test(error.message) &&
        !/repos\/ok\/first/.test(error.message),
      "the named path must be the call that hit the secondary rate limit"
    );
  });
});

const loadPassingActivationFacts = () =>
  JSON.parse(
    readFileSync(resolve(root, "fixtures/governance/authenticated-review-activation/passing.json"), "utf8")
  );

const gitBlobUtf8 = (sha, path) =>
  execFileSync("git", ["cat-file", "blob", `${sha}:${path}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

test("activation-github-outage-fails-closed-unless-boolean-false", async () => {
  const { evaluateAuthenticatedReviewActivation } = await importResolver();
  const values = ["true", 0, null, "omitted"];
  for (const value of values) {
    const facts = loadPassingActivationFacts();
    if (value === "omitted") delete facts.github_outage;
    else facts.github_outage = value;
    let message;
    try {
      evaluateAuthenticatedReviewActivation(facts);
      message = undefined;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.equal(
      message,
      "authenticated review activation is inactive: github outage",
      `github_outage=${JSON.stringify(value)} must fail closed as an outage, got ${message}`
    );
  }
});

test("activation-permission-bound-to-approving-reviewer", async () => {
  const { createFixtureTransport, collectAuthenticatedReviewActivationFacts } = await importResolver();
  const sha = "c270c270c270c270c270c270c270c270c270c270";
  const collected = collectAuthenticatedReviewActivationFacts(root, {
    repository: ACTIVATION_FIXTURE_REPO,
    prNumber: 9270,
    reviewerLogin: "admin-user",
    transport: createFixtureTransport({
      [`repos/${ACTIVATION_FIXTURE_REPO}/branches/dev/protection`]: {
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
          require_last_push_approval: true,
          bypass_pull_request_allowances: { users: [], teams: [], apps: [] }
        },
        enforce_admins: { enabled: true }
      },
      [`repos/${ACTIVATION_FIXTURE_REPO}/collaborators/admin-user/permission`]: {
        permission: "admin",
        user: { id: 999001, login: "admin-user" }
      },
      [`repos/${ACTIVATION_FIXTURE_REPO}/collaborators/approver/permission`]: {
        permission: "write",
        user: { id: 220022, login: "approver" }
      },
      [`repos/${ACTIVATION_FIXTURE_REPO}/pulls/9270`]: {
        base: { ref: "dev" },
        head: { sha },
        user: { id: 4001 },
        merged_by: { id: 4002 }
      },
      [`repos/${ACTIVATION_FIXTURE_REPO}/pulls/9270/reviews`]: [
        { state: "APPROVED", commit_id: sha, user: { id: 220022, login: "approver" } }
      ]
    })
  });
  assert.equal(collected.facts.reviewer_id, 220022);
  assert.equal(
    collected.facts.reviewer_permission,
    "write",
    "permission must come from the approving reviewer, not from a separately supplied reviewerLogin"
  );
  assert.notEqual(collected.facts.reviewer_permission, "admin");
});

const activationMatchingHeadBlob = () => {
  const activation = loadPassingActivationFacts();
  const adrPath = activation.manifest.artifacts[0].path;
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  const blob = gitBlobUtf8(head, adrPath);
  activation.exact_head_sha = head;
  activation.review_head_sha = head;
  activation.manifest.artifacts[0].sha256 = sha256Utf8(blob);
  activation.manifest_digest = sha256Utf8(JSON.stringify(activation.manifest));
  activation.manifest_in_head = true;
  return activation;
};

test("injected-activation-facts-cannot-produce-artifact-freeze", async () => {
  // Caller-reachable keys only. A matching blob digest is the strongest injection:
  // if the gate still trusted any of these keys, freeze would be non-null.
  const plants = [
    {
      name: "authenticated_review_activation_facts",
      apply: (facts, activation) => {
        facts.authenticated_review_activation_facts = activation;
      }
    },
    {
      name: "Symbol.for(aos.liveCollectedActivationFacts)",
      apply: (facts, activation) => {
        facts[Symbol.for("aos.liveCollectedActivationFacts")] = activation;
      }
    },
    {
      name: "Symbol(aos.liveCollectedActivationFacts)",
      apply: (facts, activation) => {
        facts[Symbol("aos.liveCollectedActivationFacts")] = activation;
      }
    },
    {
      name: "string aos.liveCollectedActivationFacts",
      apply: (facts, activation) => {
        facts["aos.liveCollectedActivationFacts"] = activation;
      }
    }
  ];
  for (const plant of plants) {
    const facts = loadBaselineFacts();
    plant.apply(facts, activationMatchingHeadBlob());
    const { result } = await resolveOffline(facts);
    assert.equal(
      result.artifact_freeze,
      null,
      `${plant.name} is caller-reachable and must not freeze even when the blob digest would match`
    );
  }
});
