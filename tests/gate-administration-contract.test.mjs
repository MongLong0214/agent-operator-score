import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateGateAdministration } from "../scripts/validate-gate-administration.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const canonicalRegistry = "docs/decisions/maintainer-gate-registry.v2.json";

test("ADR-0003 limits npm workspaces to the SSOT six", () => {
  const adr = readFileSync(resolve(root, "docs/adr/ADR-0003-runtime-repository-and-distribution.md"), "utf8");
  const workspaceDecision = adr.split("\n").find((line) => line.startsWith("- Use npm workspaces"));

  assert.equal(
    workspaceDecision,
    "- Use npm workspaces for exactly the six internal workspaces at `packages/{schema,scorer,runner,reporter}` and `adapters/{codex,claude-code}`. `suites/`, `fixtures/`, and `conformance/` are repository surfaces, not npm workspaces. Every internal `@aos/*` workspace is `private: true`."
  );
});

test("pre-implementation Gate Administrator is independent of D0-004 and D0-002", () => {
  const decision = resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md");
  assert.equal(existsSync(decision), true);
  const decisionText = readFileSync(decision, "utf8");
  const gateValidator = readFileSync(resolve(root, "scripts/validate-gate-administration.mjs"), "utf8");
  assert.match(decisionText, /- Dependencies: None/);
  assert.match(decisionText, /\*\*CEO\*\* separately accepts this control-plane correction at its final exact candidate head/);
  assert.match(decisionText, /reads only `docs\/decisions\/maintainer-gate-registry\.v2\.json`/);
  assert.match(decisionText, /external gate evidence/);
  assert.match(decisionText, /never proof of independent authorization/);
  assert.doesNotMatch(gateValidator, /D0-004|D0-002/);
});

test("programmatic root or registry options fail closed", () => {
  const result = validateGateAdministration({ root: process.cwd() });
  assert.equal(result.status, "invalid");
  assert.match(result.errors.join("\n"), /does not accept programmatic overrides/);
  assert.deepEqual(result.currentAcceptedTickets, []);
});

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const writePendingFixtureRegistry = (fixtureRoot) => {
  const registryPath = join(fixtureRoot, canonicalRegistry);
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.status = "PENDING";
  registry.batches = [registry.batches[0]];
  for (const batch of registry.batches) {
    batch.status = "PENDING";
    delete batch.target.reviewed_head;
    batch.required_artifacts = batch.required_artifacts.map((artifact) => ({
      ...artifact,
      sha256: sha256(join(fixtureRoot, artifact.path))
    }));
    batch.artifacts = [];
    batch.transitions = [];
    batch.events = [];
    delete batch.preparation;
    delete batch.approval;
    delete batch.invalidation;
  }
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
};

const makeFixture = () => {
  const parent = mkdtempSync(join(tmpdir(), "aos gate administration "));
  const fixtureRoot = join(parent, "repository");
  cpSync(root, fixtureRoot, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(basename(source))
  });
  writePendingFixtureRegistry(fixtureRoot);
  execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.email", "gate@example.test"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.name", "Gate Test"], { cwd: fixtureRoot });
  execFileSync("git", ["checkout", "-qb", "dev"], { cwd: fixtureRoot });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:MongLong0214/agent-operator-score.git"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "planning control plane fixture"], { cwd: fixtureRoot });
  execFileSync("git", ["update-ref", "refs/remotes/origin/dev", "HEAD"], { cwd: fixtureRoot });
  return { parent, fixtureRoot };
};

const makeNoGitFixture = () => {
  const parent = mkdtempSync(join(tmpdir(), "aos gate administration no-git "));
  const fixtureRoot = join(parent, "repository");
  cpSync(root, fixtureRoot, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(basename(source))
  });
  writePendingFixtureRegistry(fixtureRoot);
  return { parent, fixtureRoot };
};

const makeAcceptedFixture = (fixtureRoot, reviewedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim()) => {
  const registry = JSON.parse(readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
  const batch = registry.batches[0];
  batch.status = "ACCEPTED";
  batch.target.reviewed_head = reviewedHead;
  batch.artifacts = batch.required_artifacts.map((artifact) => ({
    ...artifact,
    sha256: sha256(join(fixtureRoot, artifact.path))
  }));
  batch.transitions = batch.required_transitions.map((type) => ({
    type,
    artifact_paths: batch.required_artifacts
      .filter(({ kind }) => kind === ({ ADR_ACCEPTED: "ADR", PRD_ACCEPTED: "PRD", TICKET_READY_FOR_RED: "TICKET" })[type])
      .map(({ path }) => path)
  }));
  batch.events = [{
    from: "PENDING",
    to: "ACCEPTED",
    recorded_at: "2026-08-05T00:00:00.000Z",
    recorded_by: "maintainer-02"
  }];
  batch.preparation = { prepared_by: "gate-admin-01" };
  batch.approval = {
    approved_by: "maintainer-02",
    approved_at: "2026-08-05T00:00:00.000Z",
    role: "MAINTAINER"
  };
  registry.status = "ACCEPTED";
  return registry;
};

const makeRejectedFixture = (fixtureRoot) => {
  const registry = JSON.parse(readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
  const batch = registry.batches[0];
  batch.status = "REJECTED";
  batch.events = [{
    from: "PENDING",
    to: "REJECTED",
    recorded_at: "2026-08-05T00:00:00.000Z",
    recorded_by: "maintainer-02"
  }];
  batch.preparation = { prepared_by: "gate-admin-01" };
  batch.approval = {
    approved_by: "maintainer-02",
    approved_at: "2026-08-05T00:00:00.000Z",
    role: "MAINTAINER"
  };
  registry.status = "REJECTED";
  return registry;
};

const makeInvalidatedFixture = (fixtureRoot, reviewedHead) => {
  const registry = makeAcceptedFixture(fixtureRoot, reviewedHead);
  const batch = registry.batches[0];
  batch.status = "INVALIDATED";
  batch.events.push({
    from: "ACCEPTED",
    to: "INVALIDATED",
    recorded_at: "2026-08-05T00:01:00.000Z",
    recorded_by: "gate-admin-01"
  });
  batch.invalidation = {
    invalidated_at: "2026-08-05T00:01:00.000Z",
    invalidated_by: "gate-admin-01",
    reason: "artifact changed after reviewed head"
  };
  registry.status = "INVALIDATED";
  return registry;
};

const runRegistry = (fixtureRoot, candidate) => {
  writeFileSync(join(fixtureRoot, canonicalRegistry), `${JSON.stringify(candidate, null, 2)}\n`);
  try {
    return {
      output: execFileSync(process.execPath, ["scripts/validate-gate-administration.mjs"], {
        cwd: fixtureRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    };
  } catch (error) {
    return { error };
  }
};

const commitRegistryCandidate = (fixtureRoot, candidate) => {
  writeFileSync(join(fixtureRoot, canonicalRegistry), `${JSON.stringify(candidate, null, 2)}\n`);
  execFileSync("git", ["add", canonicalRegistry], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "accepted gate candidate"], { cwd: fixtureRoot });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
};

const runCli = (fixtureRoot, args = []) => {
  try {
    return {
      output: execFileSync(process.execPath, ["scripts/validate-gate-administration.mjs", ...args], {
        cwd: fixtureRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    };
  } catch (error) {
    return { error };
  }
};

test("Gate Administrator validates a structurally complete future batch only through the canonical registry", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const accepted = makeAcceptedFixture(fixtureRoot);
    const uncommittedAccepted = runRegistry(fixtureRoot, accepted);
    assert.equal(uncommittedAccepted.error.status, 1);
    assert.match(uncommittedAccepted.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);

    const candidateHead = commitRegistryCandidate(fixtureRoot, accepted);
    const committedPositive = runCli(fixtureRoot);
    assert.equal(committedPositive.error, undefined);
    assert.match(committedPositive.output, new RegExp(`GATE_ADMINISTRATION_STRUCTURAL_PASS registry=accepted batches=1 accepted=1 rejected=0 invalidated=0 external_gate_evidence=required not_authorization candidate_head=${candidateHead}`));
    assert.doesNotMatch(committedPositive.output, /authorization=granted/);

    const selfApproved = structuredClone(accepted);
    selfApproved.batches[0].approval.approved_by = selfApproved.batches[0].preparation.prepared_by;
    const selfApprovedResult = runRegistry(fixtureRoot, selfApproved);
    assert.equal(selfApprovedResult.error.status, 1);
    assert.match(selfApprovedResult.error.stderr, /self-approved/);

    const missingOffset = structuredClone(accepted);
    missingOffset.batches[0].events[0].recorded_at = "2026-08-05T00:00:00";
    const missingOffsetResult = runRegistry(fixtureRoot, missingOffset);
    assert.equal(missingOffsetResult.error.status, 1);
    assert.match(missingOffsetResult.error.stderr, /malformed lifecycle evidence/);

    const invalidCalendar = structuredClone(accepted);
    invalidCalendar.batches[0].approval.approved_at = "2026-02-30T00:00:00Z";
    const invalidCalendarResult = runRegistry(fixtureRoot, invalidCalendar);
    assert.equal(invalidCalendarResult.error.status, 1);
    assert.match(invalidCalendarResult.error.stderr, /malformed preparation or Maintainer approval/);

    const malformed = structuredClone(accepted);
    malformed.batches[0].artifacts = {};
    const malformedResult = runRegistry(fixtureRoot, malformed);
    assert.equal(malformedResult.error.status, 1);
    assert.match(malformedResult.error.stderr, /malformed evidence arrays/);

    const partial = structuredClone(accepted);
    partial.batches[0].artifacts.pop();
    const partialResult = runRegistry(fixtureRoot, partial);
    assert.equal(partialResult.error.status, 1);
    assert.match(partialResult.error.stderr, /partial accepted artifacts|do not exactly close required scope/);

    const inconsistentGlobal = structuredClone(accepted);
    inconsistentGlobal.status = "PENDING";
    const inconsistentGlobalResult = runRegistry(fixtureRoot, inconsistentGlobal);
    assert.equal(inconsistentGlobalResult.error.status, 1);
    assert.match(inconsistentGlobalResult.error.stderr, /status is inconsistent with batches/);

    const wrongTarget = structuredClone(accepted);
    wrongTarget.batches[0].target.reviewed_head = "a".repeat(40);
    const wrongTargetResult = runRegistry(fixtureRoot, wrongTarget);
    assert.equal(wrongTargetResult.error.status, 1);
    assert.match(wrongTargetResult.error.stderr, /reviewed_head is not a resolvable commit/);

    const changedArtifact = accepted.batches[0].artifacts[0].path;
    writeFileSync(join(fixtureRoot, changedArtifact), `${readFileSync(join(fixtureRoot, changedArtifact), "utf8")}\n`);
    const staleResult = runRegistry(fixtureRoot, accepted);
    assert.equal(staleResult.error.status, 1);
    assert.match(staleResult.error.stderr, /artifact digest is stale/);

  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("PENDING registry is exact-head bound before structural PASS", () => {
  const pendingFixture = makeFixture();
  try {
    const pendingPath = join(pendingFixture.fixtureRoot, canonicalRegistry);
    const pendingBytes = readFileSync(pendingPath, "utf8");
    writeFileSync(pendingPath, `${pendingBytes}\n`);
    const uncommittedPending = runCli(pendingFixture.fixtureRoot);
    assert.equal(uncommittedPending.error.status, 1);
    assert.match(uncommittedPending.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);
    execFileSync("git", ["add", canonicalRegistry], { cwd: pendingFixture.fixtureRoot });
    execFileSync("git", ["commit", "-qm", "pending gate candidate"], { cwd: pendingFixture.fixtureRoot });
    const pendingHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pendingFixture.fixtureRoot, encoding: "utf8" }).trim();
    const committedPending = runCli(pendingFixture.fixtureRoot);
    assert.equal(committedPending.error, undefined);
    assert.match(committedPending.output, new RegExp(`registry=pending.*candidate_head=${pendingHead}`));
  } finally {
    rmSync(pendingFixture.parent, { recursive: true, force: true });
  }
});

test("PENDING required artifacts require valid SHA-256 digests", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const pending = JSON.parse(readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
    const missingDigest = structuredClone(pending);
    delete missingDigest.batches[0].required_artifacts[0].sha256;
    const missingDigestResult = runRegistry(fixtureRoot, missingDigest);
    assert.equal(missingDigestResult.error.status, 1);
    assert.match(missingDigestResult.error.stderr, /pending required artifact has missing or malformed sha256/);

    const malformedDigest = structuredClone(pending);
    malformedDigest.batches[0].required_artifacts[0].sha256 = "not-a-sha256";
    const malformedDigestResult = runRegistry(fixtureRoot, malformedDigest);
    assert.equal(malformedDigestResult.error.status, 1);
    assert.match(malformedDigestResult.error.stderr, /pending required artifact has missing or malformed sha256/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("REJECTED registry is exact-head bound before structural PASS", () => {
  const rejectedFixture = makeFixture();
  try {
    const rejected = makeRejectedFixture(rejectedFixture.fixtureRoot);
    const uncommittedRejected = runRegistry(rejectedFixture.fixtureRoot, rejected);
    assert.equal(uncommittedRejected.error.status, 1);
    assert.match(uncommittedRejected.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);
    const rejectedHead = commitRegistryCandidate(rejectedFixture.fixtureRoot, rejected);
    const committedRejected = runCli(rejectedFixture.fixtureRoot);
    assert.equal(committedRejected.error, undefined);
    assert.match(committedRejected.output, new RegExp(`registry=rejected.*candidate_head=${rejectedHead}`));
  } finally {
    rmSync(rejectedFixture.parent, { recursive: true, force: true });
  }
});

test("INVALIDATED registry is exact-head bound before structural PASS", () => {
  const invalidatedFixture = makeFixture();
  try {
    const invalidated = makeInvalidatedFixture(invalidatedFixture.fixtureRoot);
    const uncommittedInvalidated = runRegistry(invalidatedFixture.fixtureRoot, invalidated);
    assert.equal(uncommittedInvalidated.error.status, 1);
    assert.match(uncommittedInvalidated.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);
    const invalidatedHead = commitRegistryCandidate(invalidatedFixture.fixtureRoot, invalidated);
    const committedInvalidated = runCli(invalidatedFixture.fixtureRoot);
    assert.equal(committedInvalidated.error, undefined);
    assert.match(committedInvalidated.output, new RegExp(`registry=invalidated.*candidate_head=${invalidatedHead}`));
  } finally {
    rmSync(invalidatedFixture.parent, { recursive: true, force: true });
  }
});

test("no-Git fixture permits only all-PENDING structural output", () => {
  const { parent, fixtureRoot } = makeNoGitFixture();
  try {
    const originalRegistry = readFileSync(join(fixtureRoot, canonicalRegistry), "utf8");
    const pending = runCli(fixtureRoot);
    assert.equal(pending.error, undefined);
    assert.match(pending.output, /registry=pending.*not_authorization candidate_head=unavailable_pending/);

    const rejected = makeRejectedFixture(fixtureRoot);
    const rejectedResult = runRegistry(fixtureRoot, rejected);
    assert.equal(rejectedResult.error.status, 1);
    assert.match(rejectedResult.error.stderr, /cannot resolve exact candidate HEAD/);

    writeFileSync(join(fixtureRoot, canonicalRegistry), originalRegistry);
    const invalidated = makeInvalidatedFixture(fixtureRoot, "a".repeat(40));
    const invalidatedResult = runRegistry(fixtureRoot, invalidated);
    assert.equal(invalidatedResult.error.status, 1);
    assert.match(invalidatedResult.error.stderr, /cannot resolve exact candidate HEAD/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("canonical registry rejects a forged sibling registry and a canonical symlink to outside the repository", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const forgedRegistry = ".forged-gate-registry.json";
    writeFileSync(join(fixtureRoot, forgedRegistry), readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
    const forged = runCli(fixtureRoot, [`--gate-registry=${forgedRegistry}`]);
    assert.equal(forged.error.status, 1);
    assert.match(forged.error.stderr, /canonical registry only/);

    const outside = join(parent, "outside-registry.json");
    writeFileSync(outside, readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
    unlinkSync(join(fixtureRoot, canonicalRegistry));
    symlinkSync(outside, join(fixtureRoot, canonicalRegistry));
    const symlinked = runCli(fixtureRoot);
    assert.equal(symlinked.error.status, 1);
    assert.match(symlinked.error.stderr, /regular non-symlink file|realpath escapes repository root/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("accepted candidate permits a feature branch and detached CI head based on the target ref", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    execFileSync("git", ["checkout", "-qb", "feature-gate"], { cwd: fixtureRoot });
    const accepted = makeAcceptedFixture(fixtureRoot);
    const featureHead = commitRegistryCandidate(fixtureRoot, accepted);
    const feature = runCli(fixtureRoot);
    assert.equal(feature.error, undefined);
    assert.match(feature.output, new RegExp(`candidate_head=${featureHead}`));

    const detachedFixture = makeFixture();
    try {
      execFileSync("git", ["checkout", "-qb", "feature-ci"], { cwd: detachedFixture.fixtureRoot });
      const detachedAccepted = makeAcceptedFixture(detachedFixture.fixtureRoot);
      const candidateHead = commitRegistryCandidate(detachedFixture.fixtureRoot, detachedAccepted);
      execFileSync("git", ["checkout", "-q", "--detach", candidateHead], { cwd: detachedFixture.fixtureRoot });
      const detached = runCli(detachedFixture.fixtureRoot);
      assert.equal(detached.error, undefined);
      assert.match(detached.output, new RegExp(`candidate_head=${candidateHead}`));
    } finally {
      rmSync(detachedFixture.parent, { recursive: true, force: true });
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("accepted candidate fails closed when canonical schema or executed validator differs from exact HEAD", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    execFileSync("git", ["checkout", "-qb", "feature-exact-head"], { cwd: fixtureRoot });
    const accepted = makeAcceptedFixture(fixtureRoot);
    const candidateHead = commitRegistryCandidate(fixtureRoot, accepted);
    const schemaPath = join(fixtureRoot, "docs/decisions/maintainer-gate.schema.json");
    const schemaBytes = readFileSync(schemaPath, "utf8");
    writeFileSync(schemaPath, `${schemaBytes}\n`);
    const changedSchema = runCli(fixtureRoot);
    assert.equal(changedSchema.error.status, 1);
    assert.match(changedSchema.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate\.schema\.json/);
    writeFileSync(schemaPath, schemaBytes);

    const validatorPath = join(fixtureRoot, "scripts/validate-gate-administration.mjs");
    const validatorBytes = readFileSync(validatorPath, "utf8");
    writeFileSync(validatorPath, `${validatorBytes}\n// exact-head mutation\n`);
    const changedValidator = runCli(fixtureRoot);
    assert.equal(changedValidator.error.status, 1);
    assert.match(changedValidator.error.stderr, /exact-head mismatch scripts\/validate-gate-administration\.mjs/);
    writeFileSync(validatorPath, validatorBytes);

    const restored = runCli(fixtureRoot);
    assert.equal(restored.error, undefined);
    assert.match(restored.output, new RegExp(`candidate_head=${candidateHead}`));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("accepted candidate fails closed for unrelated target ancestry, wrong-owner remote, and reviewed-head candidate ancestry", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const accepted = makeAcceptedFixture(fixtureRoot);

    execFileSync("git", ["remote", "set-url", "origin", "git@github.com:wrong-owner/agent-operator-score.git"], { cwd: fixtureRoot });
    const wrongRepository = runRegistry(fixtureRoot, accepted);
    assert.equal(wrongRepository.error.status, 1);
    assert.match(wrongRepository.error.stderr, /actual repository/);

    execFileSync("git", ["remote", "set-url", "origin", "git@github.com:MongLong0214/agent-operator-score.git"], { cwd: fixtureRoot });
    const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
    const unrelatedHead = execFileSync("git", ["commit-tree", `${baseHead}^{tree}`], {
      cwd: fixtureRoot,
      encoding: "utf8"
    }).trim();
    execFileSync("git", ["update-ref", "refs/heads/unrelated", unrelatedHead], { cwd: fixtureRoot });
    execFileSync("git", ["checkout", "-q", "unrelated"], { cwd: fixtureRoot });
    const unrelated = runRegistry(fixtureRoot, accepted);
    assert.equal(unrelated.error.status, 1);
    assert.match(unrelated.error.stderr, /exact candidate HEAD is not based on target ref/);

    execFileSync("git", ["checkout", "-q", "dev"], { cwd: fixtureRoot });
    const existingButUnreviewedHead = execFileSync("git", ["commit-tree", `${baseHead}^{tree}`, "-p", baseHead], {
      cwd: fixtureRoot,
      encoding: "utf8"
    }).trim();
    const wrongCandidateAncestry = structuredClone(accepted);
    wrongCandidateAncestry.batches[0].target.reviewed_head = existingButUnreviewedHead;
    const wrongCandidateAncestryResult = runRegistry(fixtureRoot, wrongCandidateAncestry);
    assert.equal(wrongCandidateAncestryResult.error.status, 1);
    assert.match(wrongCandidateAncestryResult.error.stderr, /reviewed_head is not an ancestor of exact candidate HEAD/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a structural-only approval spoof is explicitly external gate evidence, never authorization", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const spoofed = makeAcceptedFixture(fixtureRoot);
    spoofed.batches[0].approval.approved_by = "ceo";
    spoofed.batches[0].events[0].recorded_by = "independent-reviewer";
    commitRegistryCandidate(fixtureRoot, spoofed);
    const result = runCli(fixtureRoot);
    assert.equal(result.error, undefined);
    assert.match(result.output, /external_gate_evidence=required/);
    assert.match(result.output, /not_authorization/);
    assert.doesNotMatch(result.output, /authorization=granted/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("current registry invalidates the stale D0-001 batch and requires renewed external review", () => {
  const registry = JSON.parse(readFileSync(resolve(root, "docs/decisions/maintainer-gate-registry.v2.json"), "utf8"));
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-001-canonical-identifier-registry.md"), "utf8");
  const d0004Ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"), "utf8");
  const gateStatus = readFileSync(resolve(root, "docs/decisions/MAINTAINER-GATE-STATUS.md"), "utf8");
  const gateDecision = readFileSync(resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md"), "utf8");
  const d0004Ownership = d0004Ticket.match(/^## Exact ownership\n\n([\s\S]*?)\n\n## Preconditions/m)?.[1];
  const batch = registry.batches[0];
  const result = validateGateAdministration();
  assert.equal(registry.version, 2);
  assert.equal(registry.status, "INVALIDATED");
  assert.equal(batch.status, "INVALIDATED");
  assert.equal(batch.target.repository, "github.com/MongLong0214/agent-operator-score");
  assert.equal(batch.target.branch, "dev");
  assert.equal(batch.target.reviewed_head, "dde8c29a592c35a37515645511e6da275ffb50f0");
  assert.deepEqual(batch.artifacts.map(({ path, kind }) => ({ path, kind })), batch.required_artifacts);
  const ticketArtifact = batch.artifacts.find(({ path }) => path === "docs/tickets/D0/D0-001-canonical-identifier-registry.md");
  const adr1Artifact = batch.artifacts.find(({ path }) => path === "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md");
  const adrArtifact = batch.artifacts.find(({ path }) => path === "docs/adr/ADR-0003-runtime-repository-and-distribution.md");
  assert.notEqual(adr1Artifact.sha256, sha256(resolve(root, adr1Artifact.path)));
  assert.notEqual(ticketArtifact.sha256, sha256(resolve(root, ticketArtifact.path)));
  assert.notEqual(adrArtifact.sha256, sha256(resolve(root, adrArtifact.path)));
  assert.deepEqual(batch.transitions, [
    { type: "ADR_ACCEPTED", artifact_paths: batch.required_artifacts.filter(({ kind }) => kind === "ADR").map(({ path }) => path) },
    { type: "PRD_ACCEPTED", artifact_paths: batch.required_artifacts.filter(({ kind }) => kind === "PRD").map(({ path }) => path) },
    { type: "TICKET_READY_FOR_RED", artifact_paths: batch.required_artifacts.filter(({ kind }) => kind === "TICKET").map(({ path }) => path) }
  ]);
  assert.deepEqual(batch.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(batch.invalidation.reason, /renewed independent external gate review/);
  assert.notEqual(batch.preparation.prepared_by, batch.approval.approved_by);
  assert.equal(batch.approval.role, "MAINTAINER");
  assert.equal(result.status, "invalidated");
  assert.equal(result.externalGateEvidence, "required");
  assert.match(ticket, /BLOCKED — ADR \+ PRD \+ TICKET MAINTAINER GATES REQUIRED/);
  assert.match(gateStatus, /four D0-001 batches `INVALIDATED`; only D0-002 contract-correction renewal structurally `ACCEPTED`/);
  assert.match(gateStatus, /c84185e99cffaa16ba66d49fb2c8676d4e18340c/);
  assert.doesNotMatch(gateStatus, /53abf77c724bffc785bc9820ef9bbe5ffece89d3/);
  assert.doesNotMatch(gateStatus, /three invalidated D0-001/);
  assert.doesNotMatch(gateStatus, /bounded-RED(?: digest)? renewal/);
  assert.match(gateDecision, /D0-001 history retains four `PENDING → ACCEPTED → INVALIDATED` batches/);
  assert.match(gateDecision, /D0-001 implementation completion remains historical post-merge evidence, not a current planning acceptance or execution authority/);
  assert.match(gateDecision, /only current structurally `ACCEPTED` batch is `d0-002-prerequisites-adr-0003-contract-correction-renewal`/);
  assert.match(ticket, /only the numeric `control_plane_code_files` literal within `acceptedValidatorOutput` and `pendingValidatorOutput`/);
  assert.match(ticket, /Gate Administration owns the `gates=<status>` portion and D0-004 owns every remaining portion/);
  assert.match(d0004Ticket, /except the numeric `control_plane_code_files` literal/);
  assert.match(d0004Ticket, /the `gates=<status>` portion, which Gate Administration owns/);
  assert.match(gateDecision, /Only the numeric `control_plane_code_files` literal in `acceptedValidatorOutput` and `pendingValidatorOutput`/);
  assert.match(gateDecision, /only the `gates=<status>` portion of `acceptedValidatorOutput` and `pendingValidatorOutput`/);
  assert.ok(d0004Ownership);
  assert.doesNotMatch(d0004Ownership, /MAINTAINER-GATE-STATUS\.md|maintainer-gate\.schema\.json/);
  assert.match(d0004Ownership, /historical v1 boundary only/);
  assert.match(d0004Ownership, /not an active control-plane ownership grant and must not be restored/);
  assert.match(gateDecision, /`docs\/decisions\/MAINTAINER-GATE-STATUS\.md`; `docs\/decisions\/maintainer-gate\.schema\.json`/);
  assert.match(gateDecision, /compatibility migration's exact delegation test case\/plumbing/);
});

test("ADR-0003 correction invalidates the D0-001 bounded-RED planning acceptance", () => {
  const registry = JSON.parse(readFileSync(resolve(root, canonicalRegistry), "utf8"));
  const historical = registry.batches.find(({ id }) => id === "d0-001-prerequisites");
  const supersededRenewal = registry.batches.find(({ id }) => id === "d0-001-prerequisites-renewal");
  const ownershipRenewal = registry.batches.find(({ id }) => id === "d0-001-prerequisites-contract-correction-renewal");
  const boundedRedRenewal = registry.batches.find(({ id }) => id === "d0-001-prerequisites-red-contract-renewal");
  const gateStatus = readFileSync(resolve(root, "docs/decisions/MAINTAINER-GATE-STATUS.md"), "utf8");
  const gateDecision = readFileSync(resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md"), "utf8");
  const result = validateGateAdministration();
  const requiredArtifacts = [
    { path: "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md", kind: "ADR" },
    { path: "docs/adr/ADR-0003-runtime-repository-and-distribution.md", kind: "ADR" },
    { path: "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md", kind: "ADR" },
    { path: "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md", kind: "PRD" },
    { path: "docs/tickets/D0/D0-001-canonical-identifier-registry.md", kind: "TICKET" }
  ];

  assert.equal(registry.status, "INVALIDATED");
  assert.equal(historical.status, "INVALIDATED");
  assert.equal(supersededRenewal.status, "INVALIDATED");
  assert.deepEqual(supersededRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(supersededRenewal.invalidation.reason, /census and planning-test isolation correction/);
  assert.equal(ownershipRenewal.status, "INVALIDATED");
  assert.deepEqual(ownershipRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(ownershipRenewal.invalidation.reason, /RED staging semantics correction/);
  assert.ok(boundedRedRenewal);
  assert.equal(boundedRedRenewal.status, "INVALIDATED");
  assert.deepEqual(boundedRedRenewal.target, {
    repository: "github.com/MongLong0214/agent-operator-score",
    branch: "dev",
    reviewed_head: "53abf77c724bffc785bc9820ef9bbe5ffece89d3"
  });
  assert.deepEqual(boundedRedRenewal.required_artifacts.map(({ path, kind }) => ({ path, kind })), requiredArtifacts);
  for (const path of [
    "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
    "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
    "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"
  ]) {
    const artifact = boundedRedRenewal.required_artifacts.find((candidate) => candidate.path === path);
    assert.notEqual(artifact.sha256, sha256(resolve(root, artifact.path)));
  }
  assert.deepEqual(boundedRedRenewal.required_transitions, ["ADR_ACCEPTED", "PRD_ACCEPTED", "TICKET_READY_FOR_RED"]);
  assert.deepEqual(boundedRedRenewal.artifacts, boundedRedRenewal.required_artifacts);
  assert.deepEqual(boundedRedRenewal.transitions, [
    { type: "ADR_ACCEPTED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "ADR").map(({ path }) => path) },
    { type: "PRD_ACCEPTED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "PRD").map(({ path }) => path) },
    { type: "TICKET_READY_FOR_RED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "TICKET").map(({ path }) => path) }
  ]);
  assert.deepEqual(boundedRedRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.notEqual(boundedRedRenewal.preparation.prepared_by, boundedRedRenewal.approval.approved_by);
  assert.equal(boundedRedRenewal.approval.role, "MAINTAINER");
  assert.match(boundedRedRenewal.invalidation.reason, /ADR-0003 workspace scope correction/);
  assert.equal(result.status, "invalidated");
  assert.equal(result.externalGateEvidence, "required");
  assert.match(gateStatus, /D0-002 contract-correction renewal is structurally ACCEPTED/);
  assert.match(gateStatus, /exact-head CEO review and CI are required/);
  assert.match(gateDecision, /All D0-001 prerequisite batches remain invalidated; none is a current planning acceptance or execution authority/);
  assert.match(gateDecision, /only current structurally `ACCEPTED` batch is `d0-002-prerequisites-adr-0003-contract-correction-renewal`/);
  assert.match(gateDecision, /not authorization to execute and requires external exact-head CEO review and CI/);
});

test("ADR-0003 correction invalidates the D0-002 planning acceptance and renews the corrected prerequisites", () => {
  const registry = JSON.parse(readFileSync(resolve(root, canonicalRegistry), "utf8"));
  const batch = registry.batches.find(({ id }) => id === "d0-002-prerequisites");
  const supersededRenewal = registry.batches.find(({ id }) => id === "d0-002-prerequisites-adr-0003-renewal");
  const renewal = registry.batches.find(({ id }) => id === "d0-002-prerequisites-adr-0003-contract-correction-renewal");
  const result = validateGateAdministration();
  const adr = readFileSync(resolve(root, "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md"), "utf8");
  const prd = readFileSync(resolve(root, "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"), "utf8");
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-002-repository-and-npm-workspace-skeleton.md"), "utf8");

  assert.ok(batch);
  assert.equal(batch.status, "INVALIDATED");
  assert.deepEqual(batch.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  for (const path of [
    "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
    "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
    "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
    "docs/tickets/D0/D0-002-repository-and-npm-workspace-skeleton.md"
  ]) {
    const artifact = batch.required_artifacts.find((candidate) => candidate.path === path);
    assert.notEqual(artifact.sha256, sha256(resolve(root, artifact.path)));
  }
  assert.match(batch.invalidation.reason, /ADR-0003 workspace scope correction/);
  assert.match(adr, /unresolved result blocks public canonical-brand adoption and public publication; it does not block the private, unpublished internal package identifier/);
  assert.match(prd, /unresolved evidence blocks public canonical-brand adoption, public publication, and D0 exit, but not the private unpublished internal package identifier/);
  assert.match(ticket, /explicitly allowed pre-RED harness insertion/);
  assert.match(ticket, /No companion failure is permitted; identity and preservation cases must pass/);
  assert.match(ticket, /case `root-private-scripts-and-runnable-surface`/);
  assert.match(ticket, /duplicate clearance source/);
  assert.match(ticket, /`UNRESOLVED` blocks public canonical-brand adoption, public publication, and D0 exit but does not block the private unpublished root package identifier/);

  assert.ok(supersededRenewal);
  assert.equal(supersededRenewal.status, "INVALIDATED");
  assert.deepEqual(supersededRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(supersededRenewal.invalidation.reason, /artifact scope changed before final external review/);

  assert.ok(renewal, "D0-002 requires a fresh digest-bound renewal after the ADR-0003 correction");
  assert.equal(renewal.status, "ACCEPTED");
  assert.deepEqual(renewal.target, {
    repository: "github.com/MongLong0214/agent-operator-score",
    branch: "dev",
    reviewed_head: "c84185e99cffaa16ba66d49fb2c8676d4e18340c"
  });
  assert.deepEqual(renewal.required_artifacts.map(({ path, kind }) => ({ path, kind })), batch.required_artifacts.map(({ path, kind }) => ({ path, kind })));
  for (const artifact of renewal.required_artifacts) {
    assert.equal(artifact.sha256, sha256(resolve(root, artifact.path)));
  }
  assert.deepEqual(renewal.artifacts, renewal.required_artifacts);
  assert.deepEqual(renewal.transitions, [
    { type: "ADR_ACCEPTED", artifact_paths: renewal.required_artifacts.filter(({ kind }) => kind === "ADR").map(({ path }) => path) },
    { type: "PRD_ACCEPTED", artifact_paths: renewal.required_artifacts.filter(({ kind }) => kind === "PRD").map(({ path }) => path) },
    { type: "TICKET_READY_FOR_RED", artifact_paths: renewal.required_artifacts.filter(({ kind }) => kind === "TICKET").map(({ path }) => path) }
  ]);
  assert.deepEqual(renewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" }
  ]);
  assert.notEqual(renewal.preparation.prepared_by, renewal.approval.approved_by);
  assert.equal(renewal.approval.role, "MAINTAINER");
  assert.equal(result.status, "invalidated");
  assert.deepEqual(result.currentAcceptedTickets, ["docs/tickets/D0/D0-002-repository-and-npm-workspace-skeleton.md"]);
  assert.equal(result.externalGateEvidence, "required");
});
