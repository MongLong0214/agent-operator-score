import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const validatorOutput = /PLANNING_CONTRACT_PASS adr=12 prd=19 tickets=65 milestones=6 product_code_files=0 control_plane_code_files=2 control_plane_allowlist=4 canonical_vectors=20 semantic_checks=not_yet_enforced gates=pending/;

test("planning contract validator reports the truthful structural census", () => {
  const output = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(output, validatorOutput);
  assert.equal(existsSync(resolve(root, "docs/north-star/legacy")), false);

  const fixture = resolve(root, ".planning-legacy-identifier-fixture.txt");
  writeFileSync(fixture, ["Agent", "Ops Score"].join(""));
  try {
    let error;
    try {
      execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    assert.equal(error.status, 1);
    assert.match(error.stderr, /legacy identifier/);
  } finally {
    unlinkSync(fixture);
  }
});

test("planning validator preserves encoded paths with spaces", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos encoded path "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/validate-planning.mjs");
    assert.match(pathToFileURL(script).href, /%20/);
    const output = execFileSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.match(output, validatorOutput);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("README distinguishes planning truth from every planned CLI surface", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.match(readme, /Current status: planning baseline\. Product not implemented\./);
  assert.match(readme, /Planned CLI — not available yet/);
  assert.match(readme, /65 atomic implementation tickets/);
  assert.match(readme, /EXPERIMENTAL \/ PROVISIONAL/);
  assert.match(readme, /Historical planning material was removed from the active tree and is recoverable only through Git history\./);
  assert.doesNotMatch(readme, /docs\/north-star\/legacy/);
});

test("Maintainer Gate registry remains pending and self-approval-free", () => {
  const schema = JSON.parse(readFileSync(resolve(root, "docs/decisions/maintainer-gate.schema.json"), "utf8"));
  const registry = JSON.parse(readFileSync(resolve(root, "docs/decisions/maintainer-gate-registry.v1.json"), "utf8"));
  const statuses = ["PENDING", "ACCEPTED", "REJECTED", "INVALIDATED"];
  assert.deepEqual(schema.properties.status.enum, statuses);
  assert.deepEqual(schema.properties.batches.items.properties.status.enum, statuses);
  for (const status of statuses.slice(1)) {
    const topCondition = schema.allOf.find(({ if: condition }) => condition?.properties?.status?.const === status);
    const batchCondition = schema.properties.batches.items.allOf
      .find(({ if: condition }) => condition?.properties?.status?.const === status);
    for (const condition of [topCondition, batchCondition]) {
      assert.deepEqual(condition.then.required, ["verdict", "approved_at", "approved_by"]);
      assert.equal(condition.then.properties.verdict.const, status);
    }
  }
  assert.equal(registry.version, 1);
  assert.equal(registry.status, "PENDING");
  assert.ok(registry.batches.every(({ status }) => status === "PENDING"));
  assert.equal(registry.invalidation.on_sha_or_digest_change, true);
});

test("Maintainer Gate schema validates non-vacuous accepted batches", () => {
  const fixture = resolve(root, ".maintainer-gate-registry.fixture.json");
  const accepted = {
    version: 1,
    status: "ACCEPTED",
    verdict: "ACCEPTED",
    approved_at: "2026-08-05T00:00:00.000Z",
    approved_by: "maintainer",
    batches: [{
      id: "accepted-adr-batch",
      status: "ACCEPTED",
      scope: "Exact ADR acceptance evidence.",
      verdict: "ACCEPTED",
      approved_at: "2026-08-05T00:00:00.000Z",
      approved_by: "maintainer",
      artifacts: [{
        path: "docs/adr/ADR-0001-product-mission-and-claims.md",
        sha256: "a".repeat(64),
        kind: "ADR_BATCH"
      }],
      transitions: ["ADR_ACCEPTED"]
    }],
    invalidation: {
      on_sha_or_digest_change: true,
      effect: "return_to_pending_and_invalidate_affected_evidence"
    }
  };
  const runFixture = (candidate) => {
    writeFileSync(fixture, `${JSON.stringify(candidate, null, 2)}\n`);
    try {
      return {
        output: execFileSync(process.execPath, ["scripts/validate-planning.mjs", "--gate-registry=.maintainer-gate-registry.fixture.json"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        })
      };
    } catch (error) {
      return { error };
    }
  };
  try {
    for (const [transition, kind] of [
      ["ADR_ACCEPTED", "ADR_BATCH"],
      ["PRD_ACCEPTED", "EPIC_PRD"],
      ["TICKET_READY_FOR_RED", "EXACT_TICKET"]
    ]) {
      const positive = structuredClone(accepted);
      positive.batches[0].transitions = [transition];
      positive.batches[0].artifacts[0].kind = kind;
      const result = runFixture(positive);
      assert.equal(result.error, undefined);
      assert.match(result.output, /PLANNING_CONTRACT_PASS/);
    }

    const emptyArtifacts = structuredClone(accepted);
    emptyArtifacts.batches[0].artifacts = [];
    const emptyResult = runFixture(emptyArtifacts);
    assert.ok(emptyResult.error);
    assert.equal(emptyResult.error.status, 1);
    assert.match(emptyResult.error.stderr, /minItems/);

    for (const [transition, kind] of [
      ["ADR_ACCEPTED", "EPIC_PRD"],
      ["PRD_ACCEPTED", "EXACT_TICKET"],
      ["TICKET_READY_FOR_RED", "ADR_BATCH"]
    ]) {
      const mismatchedKind = structuredClone(accepted);
      mismatchedKind.batches[0].transitions = [transition];
      mismatchedKind.batches[0].artifacts[0].kind = kind;
      const result = runFixture(mismatchedKind);
      assert.ok(result.error);
      assert.equal(result.error.status, 1);
      assert.match(result.error.stderr, /contains/);
    }

    let escapedOverride;
    try {
      execFileSync(process.execPath, ["scripts/validate-planning.mjs", "--gate-registry=../outside-registry.json"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      escapedOverride = error;
    }
    assert.ok(escapedOverride);
    assert.equal(escapedOverride.status, 1);
    assert.match(escapedOverride.stderr, /override escapes repository root/);
  } finally {
    if (existsSync(fixture)) unlinkSync(fixture);
  }
});

test("SSOT makes accepted ADR, PRD, and exact ticket mandatory implementation authority", () => {
  const ssot = readFileSync(resolve(root, "docs/north-star/agent-operator-score-ssot-v1.0.md"), "utf8");
  assert.match(ssot, /accepted ADR → accepted owning PRD → accepted exact ticket/);
  assert.doesNotMatch(ssot, /개발자는 이 파일 하나만 따른다/);
  assert.doesNotMatch(ssot, /다른 문서를 선택하거나 함께 읽을 필요가 없다/);
});

test("metric contract has concrete deterministic vectors for M01 through M20", () => {
  const contract = readFileSync(resolve(root, "docs/contracts/metric-scoring-contract-v1.md"), "utf8");
  for (const id of Array.from({ length: 20 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`)) {
    for (const state of ["pass", "partial", "fail", "no"]) assert.match(contract, new RegExp(`${id}-v1-${state}`));
  }
  assert.match(contract, /maximum_regret=0/);
  assert.match(contract, /maximum_distance=0/);
  assert.match(contract, /eligible=true.*denominator=0.*INVALID/s);
  assert.match(contract, /M10 route-table derivation.*frozen eligible route table.*route_table_id.*selected_route_id/s);
  assert.match(contract, /M10 input that contains caller-supplied `selected_regret` or `maximum_regret`.*INVALID/s);
  assert.match(contract, /M20 frontier derivation.*coordinate bounds.*weighted-L1 norm.*weights.*frontier_id/s);
  assert.match(contract, /M20 input that contains caller-supplied `distance_to_frontier` or `maximum_distance`.*INVALID/s);
});

test("D0 identity control-plane paths are allowed while unrelated source is rejected", () => {
  const allowed = resolve(root, "scripts/validate-identity.mjs");
  const unallowed = resolve(root, "scripts/unallowlisted-source.mjs");
  const validator = readFileSync(resolve(root, "scripts/validate-planning.mjs"), "utf8");
  assert.match(validator, /"scripts\/validate-identity\.mjs"/);
  assert.match(validator, /"tests\/planning\/identity\.test\.mjs"/);
  try {
    writeFileSync(allowed, "export {};\n");
    assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }));

    writeFileSync(unallowed, "export {};\n");
    let error;
    try {
      execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    assert.equal(error.status, 1);
    assert.match(error.stderr, /unallowlisted product code/);
  } finally {
    if (existsSync(allowed)) unlinkSync(allowed);
    if (existsSync(unallowed)) unlinkSync(unallowed);
  }
});

test("status ledger separates blocked executable tickets from superseded D0-003", () => {
  const ledger = readFileSync(resolve(root, "docs/decisions/MAINTAINER-GATE-STATUS.md"), "utf8");
  assert.match(ledger, /\| Atomic tickets \| 64 executable \| BLOCKED \|/);
  assert.match(ledger, /\| Superseded record \| 1 \(D0-003\) \| SUPERSEDED \|/);
});

test("D0 name availability is separate from the E14 license and publication gate", () => {
  const d0 = readFileSync(resolve(root, "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"), "utf8");
  const e14 = readFileSync(resolve(root, "docs/prd/PRD-E14-public-oss-and-g4.md"), "utf8");
  assert.match(d0, /does not decide LICENSE, contribution, redistribution, or publication/);
  assert.match(e14, /LICENSE, contribution acceptance, redistribution, and publication are E14\/G4 decisions/);
});

test("superseded D0-003 has no owned implementation", () => {
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-003-active-documentation-and-legacy-boundary-migration.md"), "utf8");
  assert.match(ticket, /SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION/);
  assert.match(ticket, /- None\. This superseded record does not authorize a file, symbol, test, or implementation change\./);
  assert.match(ticket, /PR #53/);
});

test("issue registry is total and uses six evidence milestones", () => {
  const issues = JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8"));
  assert.equal(issues.milestones.length, 6);
  assert.equal(issues.tickets.length, 65);
  assert.equal(new Set(issues.tickets.map(({ id }) => id)).size, 65);
  const superseded = issues.tickets.find(({ id }) => id === "D0-003");
  assert.match(superseded.body, /SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION/);
  assert.ok(issues.tickets
    .filter(({ id }) => id !== "D0-003")
    .every(({ body }) => body.includes("ADR + PRD + TICKET MAINTAINER GATES REQUIRED")));
  assert.equal(issues.labels.some(({ name }) => name === ["legacy", "pre-aos"].join(":")), false);
});
