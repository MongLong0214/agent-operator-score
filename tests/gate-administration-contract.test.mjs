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
});

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const makeFixture = () => {
  const parent = mkdtempSync(join(tmpdir(), "aos gate administration "));
  const fixtureRoot = join(parent, "repository");
  cpSync(root, fixtureRoot, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(basename(source))
  });
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

test("current registry remains pending and grants no D0-001 execution authority", () => {
  const registry = JSON.parse(readFileSync(resolve(root, "docs/decisions/maintainer-gate-registry.v2.json"), "utf8"));
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-001-canonical-identifier-registry.md"), "utf8");
  assert.equal(registry.version, 2);
  assert.equal(registry.status, "PENDING");
  assert.equal(registry.batches[0].target.repository, "github.com/MongLong0214/agent-operator-score");
  assert.equal(registry.batches[0].target.branch, "dev");
  assert.ok(registry.batches.every(({ status, artifacts, transitions, events }) =>
    status === "PENDING" && artifacts.length === 0 && transitions.length === 0 && events.length === 0));
  assert.match(ticket, /BLOCKED — ADR \+ PRD \+ TICKET MAINTAINER GATES REQUIRED/);
});
