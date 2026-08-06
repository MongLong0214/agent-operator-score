import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const acceptedValidatorOutput = /PLANNING_CONTRACT_PASS adr=12 prd=19 tickets=65 milestones=6 product_code_files=0 control_plane_code_files=4 control_plane_allowlist=6 canonical_vectors=20 semantic_checks=not_yet_enforced gates=invalidated/;
const pendingValidatorOutput = /PLANNING_CONTRACT_PASS adr=12 prd=19 tickets=65 milestones=6 product_code_files=0 control_plane_code_files=4 control_plane_allowlist=6 canonical_vectors=20 semantic_checks=not_yet_enforced gates=pending/;

test("planning contract validator reports the truthful structural census", () => {
  const output = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(output, acceptedValidatorOutput);
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
    const registryPath = join(fixture, "docs/decisions/maintainer-gate-registry.v2.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.status = "PENDING";
    for (const batch of registry.batches) {
      batch.status = "PENDING";
      delete batch.target.reviewed_head;
      batch.required_artifacts = batch.required_artifacts.map((artifact) => ({
        ...artifact,
        sha256: createHash("sha256").update(readFileSync(join(fixture, artifact.path))).digest("hex")
      }));
      batch.artifacts = [];
      batch.transitions = [];
      batch.events = [];
      delete batch.preparation;
      delete batch.approval;
      delete batch.invalidation;
    }
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    const script = join(fixture, "scripts/validate-planning.mjs");
    assert.match(pathToFileURL(script).href, /%20/);
    const output = execFileSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.match(output, pendingValidatorOutput);
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

test("planning validator delegates gate records to the independent administration checker", () => {
  const validator = readFileSync(resolve(root, "scripts/validate-planning.mjs"), "utf8");
  const gateDecision = readFileSync(resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md"), "utf8");
  assert.match(validator, /validateGateAdministration/);
  assert.match(validator, /Gate Administration/);
  assert.match(gateDecision, /only the `planning validator delegates gate records to the independent administration checker` test case with its direct delegation plumbing/);
  assert.match(gateDecision, /It explicitly excludes `acceptedValidatorOutput` and `pendingValidatorOutput`/);
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
  assert.match(escapedOverride.stderr, /registry override is not supported; canonical registry only/);
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
  const parent = mkdtempSync(join(tmpdir(), "aos identity allowlist "));
  const fixture = join(parent, "repository");
  cpSync(root, fixture, {
    recursive: true,
    filter: (source) => basename(source) !== "node_modules"
  });
  const allowed = resolve(fixture, "scripts/validate-identity.mjs");
  const unallowed = resolve(fixture, "scripts/unallowlisted-source.mjs");
  const validator = readFileSync(resolve(root, "scripts/validate-planning.mjs"), "utf8");
  assert.match(validator, /"scripts\/validate-identity\.mjs"/);
  assert.match(validator, /"tests\/planning\/identity\.test\.mjs"/);
  try {
    writeFileSync(allowed, "export {};\n");
    assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
      cwd: fixture,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }));

    writeFileSync(unallowed, "export {};\n");
    let error;
    try {
      execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
        cwd: fixture,
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
    rmSync(parent, { recursive: true, force: true });
  }
});

test("planning tests preserve the canonical D0 identity validator", () => {
  const canonical = resolve(root, "scripts/validate-identity.mjs");
  const before = existsSync(canonical) ? readFileSync(canonical) : null;
  execFileSync(process.execPath, ["--test", "--test-name-pattern", "D0 identity control-plane paths", "tests/planning-contract.test.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AOS_IDENTITY_PRESERVATION_PROBE: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(existsSync(canonical), before !== null);
  if (before !== null) assert.deepEqual(readFileSync(canonical), before);
});

test("D0-001 RED permits only its two bounded pre-GREEN staging failures", () => {
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-001-canonical-identifier-registry.md"), "utf8");
  assert.match(ticket, /case `canonical-pass` fails with `ERR_MODULE_NOT_FOUND` identifying `scripts\/validate-identity\.mjs`/);
  assert.match(ticket, /exactly two companion staging failures are expected and permitted/);
  assert.match(ticket, /control_plane_code_files=5` while its owned literal is still `4`/);
  assert.match(ticket, /base `scripts\.test` is not yet `node --test`/);
  assert.match(ticket, /Any failure outside the required missing-validator signal and these two bounded companion failures stops execution/);
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
