import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("pre-implementation Gate Administrator is independent of D0-004 and D0-002", () => {
  const d0004 = readFileSync(resolve(root, "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"), "utf8");
  const ownership = d0004.match(/## Exact ownership\n\n([\s\S]*?)\n## Gate Administration boundary/)[1];
  assert.doesNotMatch(ownership, /docs\/decisions\/maintainer-gate\.schema\.json/);
  assert.doesNotMatch(ownership, /docs\/decisions\/maintainer-gate-registry\.v2\.json/);
  assert.doesNotMatch(ownership, /docs\/decisions\/MAINTAINER-GATE-STATUS\.md/);
  const decision = resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md");
  assert.equal(existsSync(decision), true);
  const decisionText = readFileSync(decision, "utf8");
  const gateValidator = readFileSync(resolve(root, "scripts/validate-gate-administration.mjs"), "utf8");
  assert.match(decisionText, /- Dependencies: None/);
  assert.match(decisionText, /\*\*CEO\*\* separately accepts this control-plane correction at its final exact candidate head/);
  assert.match(d0004, /must not edit, own, or approve/);
  assert.doesNotMatch(gateValidator, /D0-004|D0-002/);
});

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const makeAcceptedFixture = (fixtureRoot) => {
  const registry = JSON.parse(readFileSync(join(fixtureRoot, "docs/decisions/maintainer-gate-registry.v2.json"), "utf8"));
  const reviewedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
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

const runRegistry = (fixtureRoot, candidate) => {
  const name = ".gate-administration.fixture.json";
  writeFileSync(join(fixtureRoot, name), `${JSON.stringify(candidate, null, 2)}\n`);
  try {
    return {
      output: execFileSync(process.execPath, ["scripts/validate-gate-administration.mjs", `--gate-registry=${name}`], {
        cwd: fixtureRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    };
  } catch (error) {
    return { error };
  }
};

test("Gate Administrator can validate a future complete batch without D0-004 or D0-002", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos gate administration "));
  const fixtureRoot = join(parent, "repository");
  try {
    cpSync(root, fixtureRoot, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
    execFileSync("git", ["config", "user.email", "gate@example.test"], { cwd: fixtureRoot });
    execFileSync("git", ["config", "user.name", "Gate Test"], { cwd: fixtureRoot });
    execFileSync("git", ["add", "."], { cwd: fixtureRoot });
    execFileSync("git", ["commit", "-qm", "planning control plane fixture"], { cwd: fixtureRoot });

    const accepted = makeAcceptedFixture(fixtureRoot);
    const positive = runRegistry(fixtureRoot, accepted);
    assert.equal(positive.error, undefined);
    assert.match(positive.output, /GATE_ADMINISTRATION_PASS registry=accepted batches=1 accepted=1 rejected=0 invalidated=0/);

    const selfApproved = structuredClone(accepted);
    selfApproved.batches[0].approval.approved_by = selfApproved.batches[0].preparation.prepared_by;
    const selfApprovedResult = runRegistry(fixtureRoot, selfApproved);
    assert.equal(selfApprovedResult.error.status, 1);
    assert.match(selfApprovedResult.error.stderr, /self-approved/);

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

    const invalidated = structuredClone(accepted);
    invalidated.status = "INVALIDATED";
    invalidated.batches[0].status = "INVALIDATED";
    invalidated.batches[0].events.push({
      from: "ACCEPTED",
      to: "INVALIDATED",
      recorded_at: "2026-08-05T00:01:00.000Z",
      recorded_by: "gate-admin-01"
    });
    invalidated.batches[0].invalidation = {
      invalidated_at: "2026-08-05T00:01:00.000Z",
      invalidated_by: "gate-admin-01",
      reason: "artifact changed after reviewed head"
    };
    const invalidatedResult = runRegistry(fixtureRoot, invalidated);
    assert.equal(invalidatedResult.error, undefined);
    assert.match(invalidatedResult.output, /GATE_ADMINISTRATION_PASS registry=invalidated batches=1 accepted=0 rejected=0 invalidated=1/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("current registry remains pending and grants no D0-001 execution authority", () => {
  const registry = JSON.parse(readFileSync(resolve(root, "docs/decisions/maintainer-gate-registry.v2.json"), "utf8"));
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-001-canonical-identifier-registry.md"), "utf8");
  assert.equal(registry.version, 2);
  assert.equal(registry.status, "PENDING");
  assert.ok(registry.batches.every(({ status, artifacts, transitions, events }) =>
    status === "PENDING" && artifacts.length === 0 && transitions.length === 0 && events.length === 0));
  assert.match(ticket, /BLOCKED — ADR \+ PRD \+ TICKET MAINTAINER GATES REQUIRED/);
  assert.match(ticket, /does not satisfy any prerequisite below or authorize RED/);
});
