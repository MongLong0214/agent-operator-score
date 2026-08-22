import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ticketEpicKeyPattern = /^(E0[A-D]|E\d+|D0)/;
const ticketEpicKey = (ticketId) => {
  const epic = ticketId.match(ticketEpicKeyPattern)?.[1];
  assert.ok(epic, `ticket lacks a canonical epic key: ${ticketId}`);
  return epic;
};
const declaredPrdEpicDependencies = () => {
  const prdDirectory = resolve(root, "docs/prd");
  const declared = new Set();
  for (const filename of readdirSync(prdDirectory)) {
    const consumerEpic = filename.match(/^PRD-(E0[A-D]|E\d+|D0)-/)?.[1];
    if (!consumerEpic) continue;
    const dependencyLine = readFileSync(resolve(prdDirectory, filename), "utf8")
      .match(/^- Dependencies: (.+)$/m)?.[1];
    assert.ok(dependencyLine, `${filename} lacks a Dependencies line`);
    for (const dependency of dependencyLine.split(/[;,]/).map((entry) => entry.trim())) {
      // Only an exact canonical ticket-epic key declares an edge in the ticket graph.
      const producerEpic = dependency.match(/^(E0[A-D]|E\d+|D0)$/)?.[1];
      if (producerEpic) declared.add(`${consumerEpic}<-${producerEpic}`);
    }
  }
  return declared;
};
const acceptedValidatorOutput = /PLANNING_CONTRACT_PASS adr=13 prd=20 tickets=74 milestones=6 product_code_files=0 control_plane_code_files=17 control_plane_allowlist=17 ticket_owned_code_files=125 canonical_vectors=20 semantic_checks=static_catalog_enforced gates=invalidated product_code_paths=none ticket_owned_code_paths=adapters\/claude-code\/src\/capabilities\.ts,adapters\/claude-code\/src\/identity\.ts,adapters\/claude-code\/src\/normalize\.ts,adapters\/claude-code\/src\/redact\.ts,adapters\/claude-code\/src\/wrapper\.ts,adapters\/claude-code\/test\/capabilities\.test\.ts,adapters\/claude-code\/test\/normalize\.test\.ts,adapters\/codex\/src\/capabilities\.ts,adapters\/codex\/src\/identity\.ts,adapters\/codex\/src\/index\.ts,adapters\/codex\/src\/normalize\.ts,adapters\/codex\/src\/redact\.ts,adapters\/codex\/src\/wrapper\.ts,adapters\/codex\/test\/capabilities\.test\.ts,adapters\/codex\/test\/conformance\.test\.ts,adapters\/codex\/test\/interface\.test\.ts,adapters\/codex\/test\/normalize\.test\.ts,conformance\/adapters\/parity\/parity\.test\.ts,conformance\/external\/external-reproduction\.test\.ts,conformance\/fam5\/fam5\.test\.ts,conformance\/form-a\/form-a\.test\.ts,conformance\/form-b\/form-b\.test\.ts,conformance\/g0\/g0\.test\.ts,packages\/reporter\/src\/diagnosis\.ts,packages\/reporter\/src\/evidence-resolver\.ts,packages\/reporter\/src\/path-policy\.ts,packages\/reporter\/src\/preflight-report\.ts,packages\/reporter\/src\/report\.ts,packages\/reporter\/src\/snapshot-share\.ts,packages\/reporter\/src\/snapshot\.ts,packages\/reporter\/test\/diagnosis\.test\.ts,packages\/reporter\/test\/evidence-resolver\.test\.ts,packages\/reporter\/test\/preflight-report\.test\.ts,packages\/reporter\/test\/report\.test\.ts,packages\/reporter\/test\/snapshot-share\.test\.ts,packages\/reporter\/test\/snapshot\.test\.ts,packages\/runner\/src\/adapter\.ts,packages\/runner\/src\/approval\.ts,packages\/runner\/src\/assessment\.ts,packages\/runner\/src\/budget-ledger\.ts,packages\/runner\/src\/doctor\.ts,packages\/runner\/src\/exposure-ledger\.ts,packages\/runner\/src\/faults\.ts,packages\/runner\/src\/isolation\.ts,packages\/runner\/src\/lifecycle\.ts,packages\/runner\/src\/reconcile\.ts,packages\/runner\/src\/scenario-registry\.ts,packages\/runner\/src\/sprint-ledger\.ts,packages\/runner\/src\/watchdog\.ts,packages\/runner\/src\/workspace\.ts,packages\/runner\/test\/budget-fault\.test\.ts,packages\/runner\/test\/isolation\.test\.ts,packages\/runner\/test\/lifecycle\.test\.ts,packages\/runner\/test\/scenario-registry\.test\.ts,packages\/runner\/test\/sprint-ledger\.test\.ts,packages\/runner\/test\/workspace\.test\.ts,packages\/schema\/src\/capability\.ts,packages\/schema\/src\/compatibility\.ts,packages\/schema\/src\/doctor-contract\.ts,packages\/schema\/src\/issuance-contract\.ts,packages\/schema\/src\/metric-registry\.ts,packages\/schema\/src\/prescription-input\.ts,packages\/schema\/src\/result\.ts,packages\/schema\/src\/scoring-contract\.ts,packages\/schema\/src\/semantic-parity\.ts,packages\/schema\/src\/session-class\.ts,packages\/schema\/src\/trace\.ts,packages\/schema\/src\/treatment-registry\.ts,packages\/schema\/test\/capability\.test\.ts,packages\/schema\/test\/conformance\.test\.ts,packages\/schema\/test\/doctor-contract\.test\.ts,packages\/schema\/test\/issuance-contract\.test\.ts,packages\/schema\/test\/metric-registry\.test\.ts,packages\/schema\/test\/prescription-input\.test\.ts,packages\/schema\/test\/result-schema\.test\.ts,packages\/schema\/test\/scoring-contract\.test\.ts,packages\/schema\/test\/session-class\.test\.ts,packages\/schema\/test\/trace-schema\.test\.ts,packages\/schema\/test\/treatment-registry\.test\.ts,packages\/scorer\/src\/diagnosis\/select-lever\.ts,packages\/scorer\/src\/eligibility\.ts,packages\/scorer\/src\/graders\/completion-claim\.ts,packages\/scorer\/src\/graders\/context\.ts,packages\/scorer\/src\/graders\/evidence-freshness\.ts,packages\/scorer\/src\/graders\/graph\.ts,packages\/scorer\/src\/graders\/idempotency\.ts,packages\/scorer\/src\/graders\/intent\.ts,packages\/scorer\/src\/graders\/outcome\.ts,packages\/scorer\/src\/graders\/recovery\.ts,packages\/scorer\/src\/graders\/safety\.ts,packages\/scorer\/src\/graders\/scope-regression\.ts,packages\/scorer\/src\/graders\/stall\.ts,packages\/scorer\/src\/graders\/state-continuity\.ts,packages\/scorer\/src\/issuance\.ts,packages\/scorer\/src\/retest\.ts,packages\/scorer\/src\/safety\.ts,packages\/scorer\/src\/score\.ts,packages\/scorer\/src\/simulation\/opportunity-audit\.ts,packages\/scorer\/src\/simulation\/pack-budget\.ts,packages\/scorer\/test\/eligibility\.test\.ts,packages\/scorer\/test\/fixture-corpus\.test\.ts,packages\/scorer\/test\/issuance\.test\.ts,packages\/scorer\/test\/pack-budget\.test\.ts,packages\/scorer\/test\/retest\.test\.ts,packages\/scorer\/test\/score\.test\.ts,packages\/scorer\/test\/select-lever\.test\.ts,packages\/scorer\/test\/simulation-input\.test\.ts,scripts\/schema-conformance\.mjs,scripts\/verify-g0\.mjs,scripts\/verify-release\.mjs,suites\/coding-core-v0\/test\/fam1-intent\.test\.ts,suites\/coding-core-v0\/test\/fam2-context\.test\.ts,suites\/coding-core-v0\/test\/fam3-graph\.test\.ts,suites\/coding-core-v0\/test\/fam4-continuity\.test\.ts,suites\/coding-core-v0\/test\/fam4-idempotency\.test\.ts,suites\/coding-core-v0\/test\/fam4-stall\.test\.ts,suites\/coding-core-v0\/test\/fam5-false-completion\.test\.ts,suites\/coding-core-v0\/test\/fam5-scope-regression\.test\.ts,suites\/coding-core-v0\/test\/fam5-stale-evidence\.test\.ts,suites\/coding-core-v0\/test\/fam6-recovery\.test\.ts,suites\/coding-core-v0\/test\/fam6-safety\.test\.ts,tests\/execution-views\.test\.mjs,tests\/planning\/fixture-directory-admission\.test\.mjs,tests\/publication\/clearance\.test\.mjs,tests\/publication\/public-surface\.test\.mjs banned_wording_scan=on\n?$/;
const pendingValidatorOutput = /PLANNING_CONTRACT_PASS adr=13 prd=20 tickets=74 milestones=6 product_code_files=0 control_plane_code_files=17 control_plane_allowlist=17 ticket_owned_code_files=125 canonical_vectors=20 semantic_checks=static_catalog_enforced gates=pending product_code_paths=none ticket_owned_code_paths=adapters\/claude-code\/src\/capabilities\.ts,adapters\/claude-code\/src\/identity\.ts,adapters\/claude-code\/src\/normalize\.ts,adapters\/claude-code\/src\/redact\.ts,adapters\/claude-code\/src\/wrapper\.ts,adapters\/claude-code\/test\/capabilities\.test\.ts,adapters\/claude-code\/test\/normalize\.test\.ts,adapters\/codex\/src\/capabilities\.ts,adapters\/codex\/src\/identity\.ts,adapters\/codex\/src\/index\.ts,adapters\/codex\/src\/normalize\.ts,adapters\/codex\/src\/redact\.ts,adapters\/codex\/src\/wrapper\.ts,adapters\/codex\/test\/capabilities\.test\.ts,adapters\/codex\/test\/conformance\.test\.ts,adapters\/codex\/test\/interface\.test\.ts,adapters\/codex\/test\/normalize\.test\.ts,conformance\/adapters\/parity\/parity\.test\.ts,conformance\/external\/external-reproduction\.test\.ts,conformance\/fam5\/fam5\.test\.ts,conformance\/form-a\/form-a\.test\.ts,conformance\/form-b\/form-b\.test\.ts,conformance\/g0\/g0\.test\.ts,packages\/reporter\/src\/diagnosis\.ts,packages\/reporter\/src\/evidence-resolver\.ts,packages\/reporter\/src\/path-policy\.ts,packages\/reporter\/src\/preflight-report\.ts,packages\/reporter\/src\/report\.ts,packages\/reporter\/src\/snapshot-share\.ts,packages\/reporter\/src\/snapshot\.ts,packages\/reporter\/test\/diagnosis\.test\.ts,packages\/reporter\/test\/evidence-resolver\.test\.ts,packages\/reporter\/test\/preflight-report\.test\.ts,packages\/reporter\/test\/report\.test\.ts,packages\/reporter\/test\/snapshot-share\.test\.ts,packages\/reporter\/test\/snapshot\.test\.ts,packages\/runner\/src\/adapter\.ts,packages\/runner\/src\/approval\.ts,packages\/runner\/src\/assessment\.ts,packages\/runner\/src\/budget-ledger\.ts,packages\/runner\/src\/doctor\.ts,packages\/runner\/src\/exposure-ledger\.ts,packages\/runner\/src\/faults\.ts,packages\/runner\/src\/isolation\.ts,packages\/runner\/src\/lifecycle\.ts,packages\/runner\/src\/reconcile\.ts,packages\/runner\/src\/scenario-registry\.ts,packages\/runner\/src\/sprint-ledger\.ts,packages\/runner\/src\/watchdog\.ts,packages\/runner\/src\/workspace\.ts,packages\/runner\/test\/budget-fault\.test\.ts,packages\/runner\/test\/isolation\.test\.ts,packages\/runner\/test\/lifecycle\.test\.ts,packages\/runner\/test\/scenario-registry\.test\.ts,packages\/runner\/test\/sprint-ledger\.test\.ts,packages\/runner\/test\/workspace\.test\.ts,packages\/schema\/src\/capability\.ts,packages\/schema\/src\/compatibility\.ts,packages\/schema\/src\/doctor-contract\.ts,packages\/schema\/src\/issuance-contract\.ts,packages\/schema\/src\/metric-registry\.ts,packages\/schema\/src\/prescription-input\.ts,packages\/schema\/src\/result\.ts,packages\/schema\/src\/scoring-contract\.ts,packages\/schema\/src\/semantic-parity\.ts,packages\/schema\/src\/session-class\.ts,packages\/schema\/src\/trace\.ts,packages\/schema\/src\/treatment-registry\.ts,packages\/schema\/test\/capability\.test\.ts,packages\/schema\/test\/conformance\.test\.ts,packages\/schema\/test\/doctor-contract\.test\.ts,packages\/schema\/test\/issuance-contract\.test\.ts,packages\/schema\/test\/metric-registry\.test\.ts,packages\/schema\/test\/prescription-input\.test\.ts,packages\/schema\/test\/result-schema\.test\.ts,packages\/schema\/test\/scoring-contract\.test\.ts,packages\/schema\/test\/session-class\.test\.ts,packages\/schema\/test\/trace-schema\.test\.ts,packages\/schema\/test\/treatment-registry\.test\.ts,packages\/scorer\/src\/diagnosis\/select-lever\.ts,packages\/scorer\/src\/eligibility\.ts,packages\/scorer\/src\/graders\/completion-claim\.ts,packages\/scorer\/src\/graders\/context\.ts,packages\/scorer\/src\/graders\/evidence-freshness\.ts,packages\/scorer\/src\/graders\/graph\.ts,packages\/scorer\/src\/graders\/idempotency\.ts,packages\/scorer\/src\/graders\/intent\.ts,packages\/scorer\/src\/graders\/outcome\.ts,packages\/scorer\/src\/graders\/recovery\.ts,packages\/scorer\/src\/graders\/safety\.ts,packages\/scorer\/src\/graders\/scope-regression\.ts,packages\/scorer\/src\/graders\/stall\.ts,packages\/scorer\/src\/graders\/state-continuity\.ts,packages\/scorer\/src\/issuance\.ts,packages\/scorer\/src\/retest\.ts,packages\/scorer\/src\/safety\.ts,packages\/scorer\/src\/score\.ts,packages\/scorer\/src\/simulation\/opportunity-audit\.ts,packages\/scorer\/src\/simulation\/pack-budget\.ts,packages\/scorer\/test\/eligibility\.test\.ts,packages\/scorer\/test\/fixture-corpus\.test\.ts,packages\/scorer\/test\/issuance\.test\.ts,packages\/scorer\/test\/pack-budget\.test\.ts,packages\/scorer\/test\/retest\.test\.ts,packages\/scorer\/test\/score\.test\.ts,packages\/scorer\/test\/select-lever\.test\.ts,packages\/scorer\/test\/simulation-input\.test\.ts,scripts\/schema-conformance\.mjs,scripts\/verify-g0\.mjs,scripts\/verify-release\.mjs,suites\/coding-core-v0\/test\/fam1-intent\.test\.ts,suites\/coding-core-v0\/test\/fam2-context\.test\.ts,suites\/coding-core-v0\/test\/fam3-graph\.test\.ts,suites\/coding-core-v0\/test\/fam4-continuity\.test\.ts,suites\/coding-core-v0\/test\/fam4-idempotency\.test\.ts,suites\/coding-core-v0\/test\/fam4-stall\.test\.ts,suites\/coding-core-v0\/test\/fam5-false-completion\.test\.ts,suites\/coding-core-v0\/test\/fam5-scope-regression\.test\.ts,suites\/coding-core-v0\/test\/fam5-stale-evidence\.test\.ts,suites\/coding-core-v0\/test\/fam6-recovery\.test\.ts,suites\/coding-core-v0\/test\/fam6-safety\.test\.ts,tests\/execution-views\.test\.mjs,tests\/planning\/fixture-directory-admission\.test\.mjs,tests\/publication\/clearance\.test\.mjs,tests\/publication\/public-surface\.test\.mjs banned_wording_scan=skipped\n?$/;

const setPendingGateRegistry = (fixture) => {
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
};

const mkdirp = (path) => mkdirSync(path, { recursive: true });

test("planning contract validator reports the truthful structural census", () => {
  const output = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(output, acceptedValidatorOutput);
  assert.equal(existsSync(resolve(root, "docs/north-star/legacy")), false);

  // The legacy-identifier probe runs in a copy. Writing it into the live tree raced with
  // every sibling test that copies this repository: cpSync would enumerate the transient
  // file and then fail ENOENT when this test deleted it mid-copy.
  const parent = mkdtempSync(join(tmpdir(), "aos legacy identifier "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules"
    });
    writeFileSync(resolve(fixture, ".planning-legacy-identifier-fixture.txt"), ["Agent", "Ops Score"].join(""));
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
    assert.match(error.stderr, /legacy identifier/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("encoded-path-root-resolution", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos encoded path "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
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
  // "planning baseline. Product not implemented." was false from the moment
  // packages/schema/src landed the metric registry and the scoring, issuance, capability,
  // and session-class contracts. The pin is kept — it is what stops the status line
  // drifting from the tree — and only what it pins has changed.
  assert.match(
    readme,
    /Current status: foundation contracts implemented in `@aos\/schema`; no public CLI and no end-to-end assessment\./
  );
  assert.doesNotMatch(readme, /planning baseline\. Product not implemented/);
  // What is claimed present must be present, and what is claimed absent must stay absent.
  assert.match(readme, /`metric-registry\.ts`/);
  assert.ok(existsSync(resolve(root, "packages/schema/src/metric-registry.ts")));
  assert.match(readme, /the `aos` CLI, the rest of the scorer, the runner/);
  assert.match(readme, /do \*\*not\*\* exist yet/);
  // The pin moves with the tree, as it did when packages/schema/src landed. What the README
  // now claims present must be present, and the CLI it still calls absent must stay absent.
  assert.match(readme, /A single grader is not a scorer\./);
  assert.match(readme, /A frozen pack is not an end-to-end assessment\./);
  assert.match(readme, /A lever selector is not a prescription report\./);
  assert.match(readme, /An issuance gate is not a complete scorer\./);
  assert.ok(existsSync(resolve(root, "packages/scorer/src/issuance.ts")));
  assert.ok(existsSync(resolve(root, "packages/scorer/src/safety.ts")));
  assert.ok(existsSync(resolve(root, "specs/aos-trace.schema.json")));
  assert.ok(existsSync(resolve(root, "specs/aos-result.schema.json")));
  assert.ok(existsSync(resolve(root, "specs/opportunity-profile.schema.json")));
  assert.ok(existsSync(resolve(root, "packages/schema/src/result.ts")));
  assert.ok(existsSync(resolve(root, "packages/scorer/src/graders/context.ts")));
  assert.ok(existsSync(resolve(root, "suites/coding-core-v0/form-a/manifest.json")));
  assert.ok(existsSync(resolve(root, "packages/runner/src/assessment.ts")));
  assert.ok(existsSync(resolve(root, "packages/scorer/src/diagnosis/select-lever.ts")));
  assert.equal(existsSync(resolve(root, "packages/cli")), false);
  assert.equal(existsSync(resolve(root, "apps/cli")), false);
  assert.match(readme, /Planned CLI — not available yet/);
  assert.match(readme, /73 atomic implementation tickets/);
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

test("D0-004 single-owner policy does not require a nonexistent external actor", () => {
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"), "utf8");
  assert.match(ticket, /"governance_mode": "single_owner_agent_team"/);
  assert.doesNotMatch(ticket, /"must_differ_from_pr_author": true/);
  assert.match(ticket, /Self-authored strings\/registry fields.*`not_authorization`/);
  assert.match(ticket, /distinct external actor.*recorded.*not required/s);
  assert.match(ticket, /exact-head technical review, CI, and explicit CEO production PASS remain required/);
  assert.match(ticket, /single-owner-spoof-is-not-authorization/);
  assert.doesNotMatch(ticket, /at least one different actor/);
});

test("D0-004 bootstrap defers checks that D0-004C creates", () => {
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"), "utf8");
  assert.match(ticket, /"state": "NOT_REQUIRED_UNTIL_D0_004C"/);
  assert.match(ticket, /existing CI.*local offline resolver\/contract tests.*exact-head technical review evidence/s);
  assert.match(ticket, /operational-state-offline.*exact-head-review.*exact-head-authorization/s);
  assert.match(ticket, /future-check-premature/);
  assert.match(ticket, /bootstrap-after-c-fails-closed/);
  assert.match(ticket, /After D0-004C merges.*Bootstrap.*disabled.*fail closed/s);
});

test("D0-004A keeps the historical gate status snapshot and schema outside its semantic catalog", () => {
  const validator = readFileSync(resolve(root, "scripts/validate-planning.mjs"), "utf8");
  assert.doesNotMatch(validator, /MAINTAINER-GATE-STATUS/);
  assert.doesNotMatch(validator, /maintainer-gate\.schema/);
});

test("D0 name availability is separate from the E14 license and publication gate", () => {
  const d0 = readFileSync(resolve(root, "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"), "utf8");
  const e14 = readFileSync(resolve(root, "docs/prd/PRD-E14-public-oss-and-g4.md"), "utf8");
  assert.match(d0, /does not decide LICENSE, contribution, redistribution, or publication/);
  assert.match(e14, /LICENSE, contribution acceptance, redistribution, and publication are E14\/G4 decisions/);
});

test("d0-003-historical-pr53-boundary", () => {
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-003-active-documentation-and-legacy-boundary-migration.md"), "utf8");
  const edge = ticket.match(/^- AC-D0-003-1 ↔ (.+)$/m)?.[1];
  assert.equal(
    edge,
    "historical evidence `PR #53`: active migration was completed before this planning baseline."
  );
  assert.match(ticket, /active migration was completed before this planning baseline/);
  assert.match(ticket, /SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION/);
  assert.match(ticket, /PR #53/);
});

test("superseded-d0-003-has-no-owned-implementation", () => {
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-003-active-documentation-and-legacy-boundary-migration.md"), "utf8");
  assert.match(ticket, /SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION/);
  assert.match(ticket, /- None\. This superseded record does not authorize a file, symbol, test, or implementation change\./);
  assert.match(ticket, /PR #53/);
});

test("issue-map-and-manifest-agreement", () => {
  const issues = JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8"));
  assert.equal(issues.milestones.length, 6);
  assert.equal(issues.tickets.length, 74);
  assert.equal(new Set(issues.tickets.map(({ id }) => id)).size, 74);
  const superseded = issues.tickets.find(({ id }) => id === "D0-003");
  assert.equal(superseded.kind, "superseded");
  assert.match(superseded.body_template, /SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION/);
  assert.ok(issues.tickets
    .filter(({ id }) => id !== "D0-003")
    .every(({ kind }) => kind === "executable"));
  assert.ok(issues.tickets
    .filter(({ id }) => !["D0-003", "D0-005", "D0-006", "D0-007", "D0-008", "D0-009"].includes(id))
    .every(({ body_template }) => body_template.includes("ADR + PRD + TICKET MAINTAINER GATES REQUIRED")));
  assert.deepEqual(
    issues.tickets
      .filter(({ id }) => ["D0-005", "D0-006", "D0-007", "D0-008", "D0-009"].includes(id))
      .map(({ id, issue, kind }) => [id, issue, kind]),
    [
      ["D0-005", 173, "executable"],
      ["D0-006", 174, "executable"],
      ["D0-007", 175, "executable"],
      ["D0-008", 176, "executable"],
      ["D0-009", 177, "executable"]
    ]
  );
  assert.ok(issues.tickets
    .filter(({ id }) => ["D0-005", "D0-006", "D0-007", "D0-008", "D0-009"].includes(id))
    .every(({ body_template }) => body_template.includes("OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED")));
  assert.ok(issues.tickets.every(({ body, labels, initial_labels }) => body === undefined && labels === undefined && Array.isArray(initial_labels)));
  assert.ok(issues.tickets.every(({ initial_labels }) => initial_labels.every((label) => !label.startsWith("status:"))));
  assert.equal(issues.labels.some(({ name }) => name === ["legacy", "pre-aos"].join(":")), false);
});

test("all-issue-bindings-are-numeric-and-unique", () => {
  const issues = JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8"));
  const mapText = readFileSync(resolve(root, "docs/GITHUB-ISSUE-MAP.md"), "utf8");
  const mapRows = new Map(
    [...mapText.matchAll(/^\|\s*([A-Z0-9-]+)\s*\|\s*\[#([1-9]\d*)\]\([^)]*\)\s*\|/gm)]
      .map(([, id, issue]) => [id, Number(issue)])
  );
  assert.ok(issues.tickets.every(({ issue }) => Number.isInteger(issue) && issue > 0));
  assert.equal(new Set(issues.tickets.map(({ issue }) => issue)).size, issues.tickets.length);
  assert.equal(mapRows.size, issues.tickets.length);
  for (const { id, issue } of issues.tickets) assert.equal(mapRows.get(id), issue, `map binding ${id}`);
  assert.deepEqual(
    issues.tickets
      .filter(({ id }) => ["D0-005", "D0-006", "D0-007", "D0-008", "D0-009", "D0-011", "D0-012", "D0-013"].includes(id))
      .map(({ id, issue }) => [id, issue])
      .sort(([a], [b]) => a.localeCompare(b)),
    [["D0-005", 173], ["D0-006", 174], ["D0-007", 175], ["D0-008", 176], ["D0-009", 177], ["D0-011", 182], ["D0-012", 206], ["D0-013", 202]]
  );
});

const issueMapCell = (issue) => Number.isInteger(issue)
  ? `[#${issue}](https://github.com/MongLong0214/agent-operator-score/issues/${issue})`
  : String(issue);

const updateIssueMapBinding = (fixture, id, issue) => {
  const path = join(fixture, "docs/GITHUB-ISSUE-MAP.md");
  const original = readFileSync(path, "utf8");
  const row = new RegExp(`(\\| ${id} \\| )[^|]+(\\| S0 · Name & Contracts \\|)`);
  assert.match(original, row, `missing issue-map row ${id}`);
  writeFileSync(path, original.replace(row, `$1${issueMapCell(issue)} $2`));
};

const updateManifestBinding = (fixture, id, issue) => {
  const path = join(fixture, "docs/issues.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const record = manifest.tickets.find((candidate) => candidate.id === id);
  assert.ok(record, `missing manifest record ${id}`);
  record.issue = issue;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
};

const assertNumericBindingMutationFails = (mutate, expected) => {
  const parent = mkdtempSync(join(tmpdir(), "aos numeric issue binding "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    mutate(fixture);
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
    assert.ok(error, "mutant must fail planning validation");
    assert.equal(error.status, 1);
    assert.match(error.stderr, expected);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
};

test("numeric-issue-binding-mutations-are-rejected", () => {
  assertNumericBindingMutationFails(
    (fixture) => {
      updateIssueMapBinding(fixture, "D0-005", "not-a-number");
      updateManifestBinding(fixture, "D0-005", "not-a-number");
    },
    /issue map D0-005 has non-positive or malformed issue binding not-a-number/
  );
  assertNumericBindingMutationFails(
    (fixture) => {
      updateIssueMapBinding(fixture, "D0-006", 173);
      updateManifestBinding(fixture, "D0-006", 173);
    },
    /issue map duplicate issue number 173/
  );
  assertNumericBindingMutationFails(
    (fixture) => updateIssueMapBinding(fixture, "D0-005", 174),
    /issue map and manifest disagree for D0-005/
  );
});

test("semantic-traceability-graph catalog acceptance-id companion", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos semantic traceability orphan "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const prdPath = join(fixture, "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md");
    const original = readFileSync(prdPath, "utf8");
    writeFileSync(prdPath, original.replace(/- AC-D0-6:.*\n/, ""));
    setPendingGateRegistry(fixture);

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
    assert.ok(error, "semantic orphan must fail planning validation");
    assert.equal(error.status, 1);
    assert.match(error.stderr, /semantic graph.*AC-D0-6/i);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("issue-map-and-manifest-agreement rejects a catalog dependency mismatch", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos static catalog mismatch "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const manifestPath = join(fixture, "docs/issues.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.tickets.find(({ id }) => id === "D0-004").dependencies = [];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

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
    assert.match(error.stderr, /issue manifest D0-004 diverges from exact ticket metadata/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("orphan-requirement-ac-ticket-test-mutants catalog ownership orphan companion", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos catalog ownership orphan "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const tracePath = join(fixture, "docs/TRACEABILITY.md");
    const traceability = readFileSync(tracePath, "utf8");
    const catalogMatch = traceability.match(/<!-- AOS_SEMANTIC_CATALOG_V2_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- AOS_SEMANTIC_CATALOG_V2_END -->/m);
    assert.ok(catalogMatch);
    const catalog = JSON.parse(catalogMatch[1]);
    catalog.prds.find(({ id }) => id === "D0").ticket_ids = ["D0-001", "D0-002", "D0-003"];
    writeFileSync(tracePath, traceability.replace(catalogMatch[1], JSON.stringify(catalog, null, 2)));

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
    assert.match(error.stderr, /semantic graph D0 ticket ownership diverges from catalog/);
    assert.match(error.stderr, /semantic graph orphan ticket D0-004/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("operational-authority-schema-and-ticket-agreement", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos operational authority mismatch "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const manifestPath = join(fixture, "docs/issues.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.operational_authority.target_branch = "main";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

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
    assert.match(error.stderr, /operational_authority diverges from D0-004 ticket/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("identity-consistency-and-no-exception", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos identity consistency drift "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const packagePath = join(fixture, "package.json");
    const packageManifest = JSON.parse(readFileSync(packagePath, "utf8"));
    packageManifest.name = "wrong-target-package";
    writeFileSync(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);

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
    assert.match(error.stderr, /root package has wrong canonical identity/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("maintainer-gate-digest-invalidation", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos gate digest invalidation "));
  const fixture = join(parent, "repository");
  try {
    execFileSync("git", ["clone", "--no-local", root, fixture], {
      cwd: root,
      encoding: "utf8"
    });
    for (const path of ["scripts/validate-planning.mjs", "docs/TRACEABILITY.md", "docs/issues.json"]) {
      writeFileSync(join(fixture, path), readFileSync(resolve(root, path)));
    }
    const artifact = join(fixture, "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md");
    writeFileSync(artifact, `${readFileSync(artifact, "utf8")}\nMaterial semantic edit for digest invalidation.\n`);

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
    assert.match(error.stderr, /stale digest d0-002-prerequisites-red-census-contract-correction-renewal-owner-approved-2026-08-22-renewal-adr-0003-2026-08-22-renewal docs\/adr\/ADR-0001/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});


test("computed-product-code-census", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos computed product census "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const mediaSource = join(fixture, "media", "hidden-source.mjs");
    const stateSource = join(fixture, "state", "hidden-source.mjs");
    mkdirp(join(fixture, "media"));
    mkdirp(join(fixture, "state"));
    writeFileSync(mediaSource, "export {};\n");
    writeFileSync(stateSource, "export {};\n");

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
    assert.ok(error, "source under media/state must enter product-code census");
    assert.equal(error.status, 1);
    assert.match(error.stderr, /unallowlisted product code/);
    assert.match(error.stderr, /media\/hidden-source\.mjs/);
    assert.match(error.stderr, /state\/hidden-source\.mjs/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

const runPlanningValidator = (fixture) => {
  try {
    const stdout = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
      cwd: fixture,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { status: 0, stdout, stderr: "" };
  } catch (caught) {
    return {
      status: caught.status ?? 1,
      stdout: caught.stdout ?? "",
      stderr: caught.stderr ?? ""
    };
  }
};

const readCatalog = (fixture) => {
  const tracePath = join(fixture, "docs/TRACEABILITY.md");
  const traceability = readFileSync(tracePath, "utf8");
  const catalogMatch = traceability.match(/<!-- AOS_SEMANTIC_CATALOG_V2_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- AOS_SEMANTIC_CATALOG_V2_END -->/m);
  assert.ok(catalogMatch);
  return {
    tracePath,
    traceability,
    catalogMatch,
    catalog: JSON.parse(catalogMatch[1])
  };
};

const writeCatalog = ({ tracePath, traceability, catalogMatch, catalog }) => {
  writeFileSync(tracePath, traceability.replace(catalogMatch[1], JSON.stringify(catalog, null, 2)));
};

test("orphan-requirement-ac-ticket-test-mutants", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos orphan graph mutants "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const ticketPath = join(fixture, "docs/tickets/D0/D0-001-canonical-identifier-registry.md");
    const originalTicket = readFileSync(ticketPath, "utf8");
    const originalTraceability = readFileSync(join(fixture, "docs/TRACEABILITY.md"), "utf8");
    const tracePath = join(fixture, "docs/TRACEABILITY.md");

    const expectFail = (mutate, pattern, label) => {
      mutate();
      setPendingGateRegistry(fixture);
      const result = runPlanningValidator(fixture);
      assert.equal(result.status, 1, `${label} must fail closed`);
      assert.match(result.stderr, pattern, `${label} must match ${pattern}`);
      writeFileSync(ticketPath, originalTicket);
      writeFileSync(tracePath, originalTraceability);
    };

    // Named test case: invent a case on an existing planned path (CEO fail-open repro).
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `definitely-not-a-real-test-case`:"
          )
        );
      },
      /named test cases diverge from catalog binding|named test case not (found|in planned_tests)/,
      "orphan/missing named test case"
    );

    // Case-less/path-less prose on a normal edge must fail (cannot borrow the historical bypass).
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ historical evidence `PR #53`: arbitrary case-less prose:"
          )
        );
      },
      /malformed named test case/,
      "normal edge case-less historical prose rejected"
    );

    // Arbitrary case-less prose without historical contract also fails.
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ no planned path or named cases here:"
          )
        );
      },
      /malformed named test case/,
      "normal edge arbitrary case-less prose rejected"
    );

    // Historical contract requires the entire exact sentence; a malformed suffix fails.
    const d0003Path = join(fixture, "docs/tickets/D0/D0-003-active-documentation-and-legacy-boundary-migration.md");
    const originalD0003 = readFileSync(d0003Path, "utf8");
    expectFail(
      () => {
        writeFileSync(
          d0003Path,
          originalD0003.replace(
            "- AC-D0-003-1 ↔ historical evidence `PR #53`: active migration was completed before this planning baseline.",
            "- AC-D0-003-1 ↔ historical evidence `PR #53`: active migration was completed before this planning baseline. EXTRA SUFFIX"
          )
        );
      },
      /malformed named test case/,
      "historical edge malformed suffix rejected"
    );
    writeFileSync(d0003Path, originalD0003);

    // Duplicate planned path/case ownership across two ticket AC bindings fails.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const binding = snapshot.catalog.ticket_acceptance_bindings.find(
          (entry) => entry.ticket_id === "D0-003" && entry.acceptance_id === "AC-D0-003-1"
        );
        binding.cases = ["superseded-d0-003-has-no-owned-implementation"];
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /duplicate planned test path\/case ownership[\s\S]*superseded-d0-003-has-no-owned-implementation/,
      "duplicate planned path/case binding pair"
    );

    // Planned path: typo in ticket prose diverges from explicit catalog binding.
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ `tests/planning/typo-does-not-exist.test.mjs` case `canonical-pass`:"
          )
        );
      },
      /planned test path diverges from catalog binding|unknown planned test path[\s\S]*typo-does-not-exist/,
      "unknown typo planned test path"
    );

    // Planned path: same path token twice in one edge (second-packet fail-open).
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` `tests/planning/identity.test.mjs` case `canonical-pass`:"
          )
        );
      },
      /duplicate planned test path/,
      "duplicate planned test path token"
    );

    // Named test case: duplicate case names in one edge.
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` cases `canonical-pass` and `canonical-pass`:"
          )
        );
      },
      /duplicate named test case/,
      "duplicate named test case"
    );

    // Named test case / ticket AC: malformed edge without a case binding.
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` without a named case:"
          )
        );
      },
      /malformed named test case/,
      "malformed ticket AC / named test case"
    );

    // Planned test path: path token with traversal (malformed shape).
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `canonical-pass`:",
            "- AC-D0-001-1 ↔ `tests/../escape.test.mjs` case `canonical-pass`:"
          )
        );
      },
      /malformed planned test path/,
      "malformed planned test path"
    );

    // Ticket AC: duplicate acceptance IDs on the ticket contract.
    expectFail(
      () => {
        writeFileSync(
          ticketPath,
          originalTicket.replace(
            "- AC-D0-001-2 ↔ `tests/planning/identity.test.mjs` case `each-forbidden-token`:",
            "- AC-D0-001-1 ↔ `tests/planning/identity.test.mjs` case `each-forbidden-token`:"
          )
        );
      },
      /duplicate ticket acceptance edges/,
      "duplicate ticket AC"
    );

    // Catalog requirement: orphan requirement key.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.requirement_to_acceptance = d0.requirement_to_acceptance.filter((edge) => edge.requirement_key !== "5");
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /missing requirement → acceptance edges|orphan requirement 5/,
      "orphan requirement"
    );

    // Catalog requirement: duplicate requirement edge.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.requirement_to_acceptance.push({ ...d0.requirement_to_acceptance[0] });
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /duplicate requirement edge|missing requirement → acceptance edges/,
      "duplicate requirement"
    );

    // Catalog requirement: malformed requirement edge.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.requirement_to_acceptance[0] = { requirement_key: 1, acceptance_ids: "AC-D0-1" };
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /malformed requirement → acceptance edge/,
      "malformed requirement"
    );

    // PRD AC: duplicate acceptance binding inside a requirement edge.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.requirement_to_acceptance[0].acceptance_ids.push(d0.requirement_to_acceptance[0].acceptance_ids[0]);
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /duplicate acceptance binding/,
      "duplicate PRD AC binding"
    );

    // PRD AC: orphan acceptance (drop from requirement bindings).
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.requirement_to_acceptance = d0.requirement_to_acceptance.map((edge) => ({
          ...edge,
          acceptance_ids: edge.acceptance_ids.filter((id) => id !== "AC-D0-6")
        }));
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /orphan PRD acceptance AC-D0-6/,
      "orphan PRD AC"
    );

    // PRD AC: malformed acceptance → ticket edge.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.acceptance_to_tickets[0] = { acceptance_id: "AC-D0-1", ticket_ids: "D0-001" };
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /malformed acceptance → ticket edge/,
      "malformed PRD AC → ticket edge"
    );

    // Ticket: orphan ticket ownership (drop from catalog ticket_ids and AC bindings).
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.ticket_ids = ["D0-001", "D0-002", "D0-003"];
        d0.acceptance_to_tickets = d0.acceptance_to_tickets
          .map((edge) => ({
            ...edge,
            ticket_ids: edge.ticket_ids.filter((id) => id !== "D0-004")
          }))
          .filter((edge) => edge.ticket_ids.length > 0);
        d0.acceptance_to_tickets = d0.acceptance_to_tickets.filter((edge) => edge.acceptance_id !== "AC-D0-4");
        // Also drop AC-D0-2's D0-004 if present after filter above
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /orphan ticket D0-004|ticket ownership diverges from catalog|missing acceptance → ticket edges/,
      "orphan ticket"
    );

    // Ticket ownership: malformed acceptance → ticket edge (ticket_ids not an array).
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.acceptance_to_tickets[0] = { acceptance_id: "AC-D0-1", ticket_ids: "D0-001" };
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /malformed acceptance → ticket edge/,
      "malformed ticket ownership edge"
    );

    // Ticket: duplicate ticket id in ownership list.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
        d0.ticket_ids = [...d0.ticket_ids, "D0-001"];
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /ticket ownership diverges from catalog|duplicate ticket/,
      "duplicate ticket ownership"
    );

    // Planned_tests: duplicate path entry.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        snapshot.catalog.planned_tests.push({ ...snapshot.catalog.planned_tests[0] });
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /duplicate planned test path/,
      "duplicate planned_tests path entry"
    );

    // Planned_tests: malformed path entry.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        snapshot.catalog.planned_tests.push({ path: "tests/../escape.test.mjs", cases: ["x"] });
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /malformed planned test path/,
      "malformed planned_tests path entry"
    );

    // Planned_tests: orphan case never referenced by a ticket binding.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const entry = snapshot.catalog.planned_tests.find((item) => item.path === "tests/planning/identity.test.mjs");
        entry.cases.push("never-referenced-orphan-case");
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /orphan planned test case[\s\S]*never-referenced-orphan-case/,
      "orphan planned test case"
    );

    // Planned_tests: duplicate case within one path entry.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const entry = snapshot.catalog.planned_tests.find((item) => item.path === "tests/planning/identity.test.mjs");
        entry.cases.push("canonical-pass");
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /duplicate named test case under tests\/planning\/identity\.test\.mjs/,
      "duplicate planned_tests case"
    );

    // Planned_tests: malformed case token.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const entry = snapshot.catalog.planned_tests.find((item) => item.path === "tests/planning/identity.test.mjs");
        entry.cases.push("bad/case.mjs");
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /malformed named test case under tests\/planning\/identity\.test\.mjs/,
      "malformed planned_tests case"
    );

    // Orphan planned-test path (entry never referenced by any binding).
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        snapshot.catalog.planned_tests.push({
          path: "tests/planning/orphan-never-bound.test.mjs",
          cases: ["orphan-only-case"]
        });
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /orphan planned test path tests\/planning\/orphan-never-bound\.test\.mjs|orphan planned test case tests\/planning\/orphan-never-bound/,
      "orphan planned-test path"
    );

    // Orphan ticket AC binding: drop AC-D0-001-1 binding.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        snapshot.catalog.ticket_acceptance_bindings = snapshot.catalog.ticket_acceptance_bindings.filter(
          (binding) => !(binding.ticket_id === "D0-001" && binding.acceptance_id === "AC-D0-001-1")
        );
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /orphan ticket acceptance edge D0-001 AC-D0-001-1|ticket acceptance binding census/,
      "orphan ticket AC binding/edge"
    );

    // Orphan ticket AC binding entry (extra catalog key not present on a ticket).
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        snapshot.catalog.ticket_acceptance_bindings.push({
          ticket_id: "D0-001",
          acceptance_id: "AC-D0-001-99",
          test_path: "tests/planning/identity.test.mjs",
          cases: ["canonical-pass"]
        });
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /orphan ticket acceptance binding D0-001 AC-D0-001-99|ticket acceptance binding census/,
      "orphan ticket AC binding entry"
    );

    // Historical-evidence bypass must not skip D0-003 AC-D0-003-1: remove its binding.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        snapshot.catalog.ticket_acceptance_bindings = snapshot.catalog.ticket_acceptance_bindings.filter(
          (binding) => !(binding.ticket_id === "D0-003" && binding.acceptance_id === "AC-D0-003-1")
        );
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /orphan ticket acceptance edge D0-003 AC-D0-003-1|ticket acceptance binding census/,
      "historical bypass removed for D0-003-1"
    );

    // Binding path typo not in planned_tests.
    expectFail(
      () => {
        const snapshot = readCatalog(fixture);
        const binding = snapshot.catalog.ticket_acceptance_bindings.find(
          (entry) => entry.ticket_id === "D0-001" && entry.acceptance_id === "AC-D0-001-1"
        );
        binding.test_path = "tests/planning/typo-does-not-exist.test.mjs";
        writeCatalog({ ...snapshot, catalog: snapshot.catalog });
      },
      /unknown planned test path[\s\S]*typo-does-not-exist|planned test path diverges from catalog binding/,
      "binding typo planned path"
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("semantic-traceability-graph", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos semantic edges "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const snapshot = readCatalog(fixture);
    const d0 = snapshot.catalog.prds.find(({ id }) => id === "D0");
    // Orphan PRD acceptance: drop it from requirement bindings.
    d0.requirement_to_acceptance = d0.requirement_to_acceptance.map((edge) => ({
      ...edge,
      acceptance_ids: edge.acceptance_ids.filter((id) => id !== "AC-D0-6")
    }));
    writeCatalog({ ...snapshot, catalog: snapshot.catalog });
    setPendingGateRegistry(fixture);
    const result = runPlanningValidator(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /orphan PRD acceptance AC-D0-6/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("markdown-crlf-normalized-equivalent", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos crlf markdown "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    for (const relativePath of [
      "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
      "docs/tickets/D0/D0-001-canonical-identifier-registry.md",
      "docs/TRACEABILITY.md"
    ]) {
      const absolute = join(fixture, relativePath);
      const lf = readFileSync(absolute, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      writeFileSync(absolute, lf.replace(/\n/g, "\r\n"));
    }
    setPendingGateRegistry(fixture);
    const output = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
      cwd: fixture,
      encoding: "utf8"
    });
    assert.match(output, pendingValidatorOutput);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("issue-map-and-manifest-agreement rejects duplicate issue numbers and ticket paths", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos issue uniqueness "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const manifestPath = join(fixture, "docs/issues.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const first = manifest.tickets.find(({ id }) => id === "D0-001");
    const second = manifest.tickets.find(({ id }) => id === "D0-002");
    second.issue = first.issue;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
    assert.match(error.stderr, /duplicate issue number/);

    second.issue = 55;
    second.ticket_path = first.ticket_path;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    error = undefined;
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
    assert.match(error.stderr, /duplicate ticket_path|wrong ticket_path/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("issue-map-and-manifest-agreement ignores JSON key order", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos issue key order "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    setPendingGateRegistry(fixture);
    const manifestPath = join(fixture, "docs/issues.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.tickets = manifest.tickets.map((record) => {
      // Deliberately reorder keys; schema meaning must not depend on insertion order.
      return {
        body_template: record.body_template,
        kind: record.kind,
        initial_labels: record.initial_labels,
        epic: record.epic,
        size: record.size,
        dependencies: record.dependencies,
        milestone: record.milestone,
        ticket_path: record.ticket_path,
        issue: record.issue,
        title: record.title,
        id: record.id
      };
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const output = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
      cwd: fixture,
      encoding: "utf8"
    });
    assert.match(output, pendingValidatorOutput);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("ticket-epic-key-parser-prioritizes-e0-letter-epics", () => {
  assert.equal(ticketEpicKey("E0A-001"), "E0A");
  assert.notEqual(ticketEpicKey("E0A-001"), "E0");
});

test("cross-epic-ticket-dependencies-have-declared-prd-basis", () => {
  const declared = declaredPrdEpicDependencies();
  const manifest = JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8"));
  const unsupported = [];

  for (const ticket of manifest.tickets) {
    const consumerEpic = ticketEpicKey(ticket.id);
    for (const dependency of ticket.dependencies) {
      const producerEpic = ticketEpicKey(dependency);
      if (consumerEpic === producerEpic) continue;
      const epicEdge = `${consumerEpic}<-${producerEpic}`;
      if (!declared.has(epicEdge)) unsupported.push(`${ticket.id}<-${dependency} (${epicEdge})`);
    }
  }

  assert.deepEqual(
    unsupported,
    [],
    `cross-epic ticket dependencies lack a declared PRD basis:\n${unsupported.join("\n")}`
  );
});

test("banned-wording-guard-is-load-bearing", () => {
  // The prohibition on two phrasings — one asserting the absence of code, one framing this
  // repository as a mere planning exercise — was violated seven times in one day while it lived
  // in prose alone, including inside the validator added to enforce it. This case exists so the
  // guard cannot silently stop working. Fragments avoid embedding either literal here.
  //
  // The probe runs in a copy for the reason the legacy-identifier probe above already documents:
  // writing into the live tree races every sibling test that copies this repository. The first
  // version of this case mutated docs/tickets/BOARD.md in place and reintroduced that bug.
  const probes = [["planning", "only"].join(" "), ["no", "code"].join(" ")];
  const parent = mkdtempSync(join(tmpdir(), "aos banned wording "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, { recursive: true, filter: (source) => basename(source) !== "node_modules" });
    // Two probe targets, deliberately. A Markdown-only probe stays green if someone reinstates an
    // extension allowlist that happens to include Markdown, which is exactly the regression this
    // case exists to catch, so an extensionless tracked artifact is probed as well.
    const probeTargets = ["docs/tickets/BOARD.md", ".gitignore"];
    for (const target of probeTargets) {
      const probeFile = resolve(fixture, target);
      const original = readFileSync(probeFile, "utf8");
      for (const probe of probes) {
        writeFileSync(probeFile, `${original}\n\nprobe: this is ${probe}.\n`);
        const mutated = spawnSync(process.execPath, [resolve(fixture, "scripts/validate-planning.mjs")], { cwd: fixture, encoding: "utf8" });
        assert.equal(mutated.status, 1, `guard did not fail for probe ${probe} in ${target}`);
        assert.ok(mutated.stderr.includes(`banned wording in ${target}:`), `guard did not name ${target}`);
      }
      writeFileSync(probeFile, original);
    }
    const restored = spawnSync(process.execPath, [resolve(fixture, "scripts/validate-planning.mjs")], { cwd: fixture, encoding: "utf8" });
    assert.equal(restored.status, 0, "guard did not return to passing after restore");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("banned-wording-guard-covers-commit-messages", () => {
  // A tree validator cannot see commit messages, and two of the day's seven violations were in
  // them. This case closes that gap for the range under review: every commit not on the merge base
  // is scanned. Fragments avoid embedding either literal.
  const patterns = [new RegExp(["planning", "only"].join("[\\s-]+"), "i"), new RegExp(`\\b${["no", "code"].join("[\\s-]+")}\\b`, "i")];
  const mergeBase = spawnSync("git", ["merge-base", "origin/dev", "HEAD"], { cwd: root, encoding: "utf8" });
  // Fail closed. The first version returned early when origin/dev was missing, so the guard
  // silently passed in exactly the environments least likely to have been checked by hand.
  assert.equal(mergeBase.status, 0, "cannot resolve merge base with origin/dev; commit-message scan cannot fail open");
  // Post-merge, HEAD is the merge base, so a range scan is empty and the merge or squash commit's
  // own message would evade the check. Fall back to scanning HEAD itself in that case.
  const base = mergeBase.stdout.trim();
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const range = base === headSha ? "-1 HEAD" : `${base}..HEAD`;
  // Enumerate first, then read each message on its own. An earlier version streamed every message
  // in one `git log` with in-band record and field separators, which a message containing those
  // same bytes could split: the banned phrase landed in the sha field and the scanned message was
  // undefined. Commit messages are attacker-controlled text, so they are never parsed in band.
  const revList = spawnSync("git", ["rev-list", ...range.split(" ")], { cwd: root, encoding: "utf8" });
  assert.equal(revList.status, 0, "git rev-list failed");
  for (const sha of revList.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
    const body = spawnSync("git", ["log", "-1", "--format=%B", sha], { cwd: root, encoding: "utf8" });
    assert.equal(body.status, 0, `git log failed for ${sha.slice(0, 8)}`);
    for (const pattern of patterns) {
      assert.equal(pattern.test(body.stdout), false, `banned wording in commit message ${sha.slice(0, 8)}`);
    }
  }
});

test("rendered-board-matches-the-static-catalog", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos rendered board "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs"), "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /EXECUTION_VIEWS_CHECK surfaces=2 drift=0 conflicts=0\n?$/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("board-drift-fails-closed", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos board drift "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const lines = readFileSync(boardPath, "utf8").split("\n");
    const start = lines.findIndex((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(start >= 0, "board-rows start marker is missing");
    // Tamper with the first rendered data row (D0-001): mutate only its size cell.
    lines[start + 3] = lines[start + 3].replace("| S0 · Name & Contracts | S |", "| S0 · Name & Contracts | X |");
    assert.ok(lines[start + 3].includes("| X |"), "tamper did not change the row");
    writeFileSync(boardPath, lines.join("\n"));
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs"), "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("docs/tickets/BOARD.md"), `stderr did not name the drifted surface: ${result.stderr}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("catalog-and-ticket-disagreement-fails-closed", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos catalog ticket drift "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const ticketPath = join(fixture, "docs/tickets/D0/D0-001-canonical-identifier-registry.md");
    const ticket = readFileSync(ticketPath, "utf8");
    assert.ok(ticket.includes("- Size: S"), "expected size line is missing from D0-001");
    writeFileSync(ticketPath, ticket.replace("- Size: S", "- Size: L"));
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs"), "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("DRIFT"), result.stderr);
    assert.ok(result.stderr.includes("D0-001"), `stderr did not name the drifted ticket: ${result.stderr}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("rendering-is-idempotent", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos render idempotent "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const targets = [join(fixture, "docs/tickets/BOARD.md"), join(fixture, "docs/planning/AOS-EXECUTION-ROADMAP.md")];
    const first = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const before = targets.map((path) => readFileSync(path));
    const second = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    targets.forEach((path, index) => {
      assert.ok(readFileSync(path).equals(before[index]), `second render changed ${basename(path)}`);
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("write-mode-repairs-drift", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos write repairs drift "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const lines = readFileSync(boardPath, "utf8").split("\n");
    const start = lines.findIndex((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(start >= 0, "board-rows start marker is missing");
    // Tamper with the first rendered data row (D0-001): mutate only its size cell.
    lines[start + 3] = lines[start + 3].replace("| S0 · Name & Contracts | S |", "| S0 · Name & Contracts | X |");
    assert.ok(lines[start + 3].includes("| X |"), "tamper did not change the row");
    writeFileSync(boardPath, lines.join("\n"));
    const repair = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(repair.status, 0, repair.stderr);
    const check = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /EXECUTION_VIEWS_CHECK surfaces=2 drift=0 conflicts=0\n?$/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dependency-drift-is-detected-byte-for-byte", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos dependency byte drift "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const ticketPath = join(fixture, "docs/tickets/D0/D0-011-ticket-derived-fixture-directory-admission.md");
    const ticket = readFileSync(ticketPath, "utf8");
    assert.ok(ticket.includes("- Dependencies: D0-002,D0-004"), "expected dependencies line is missing from D0-011");
    // Whitespace and a trailing comma only: the parsed list is unchanged, the bytes are not.
    writeFileSync(ticketPath, ticket.replace("- Dependencies: D0-002,D0-004", "- Dependencies: D0-002,   , D0-004,"));
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs"), "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("DRIFT"), result.stderr);
    assert.ok(result.stderr.includes("D0-011"), `stderr did not name the drifted ticket: ${result.stderr}`);
    assert.ok(result.stderr.includes("dependencies"), `stderr did not name the drifted field: ${result.stderr}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("duplicate-or-broken-markers-write-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos marker guard "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const original = readFileSync(boardPath, "utf8");
    const endMarkerLine = "<!-- generated:board-rows end -->";
    const firstEnd = original.indexOf(endMarkerLine);
    assert.ok(firstEnd >= 0, "board-rows end marker is missing");

    // A second end marker with unique prose between the two: write mode must fail closed
    // and keep the prose that sits outside the generated block.
    writeFileSync(boardPath, `${original.slice(0, firstEnd + endMarkerLine.length)}\nKEEP_OUTSIDE_PROSE\n${original.slice(firstEnd)}`);
    const duplicated = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(duplicated.status, 1, duplicated.stdout);
    assert.ok(duplicated.stderr.includes("expected exactly one end marker"), duplicated.stderr);
    assert.ok(readFileSync(boardPath, "utf8").includes("KEEP_OUTSIDE_PROSE"), "prose between duplicated end markers was deleted");

    // A missing start marker: write mode fails closed and changes nothing.
    const startLine = original.split("\n").find((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(startLine, "board-rows start marker is missing");
    writeFileSync(boardPath, original.replace(`${startLine}\n`, ""));
    const before = readFileSync(boardPath);
    const missingStart = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(missingStart.status, 1, missingStart.stdout);
    assert.ok(missingStart.stderr.includes("expected exactly one start marker"), missingStart.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the file despite a missing start marker");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("unsafe-ticket-path-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos unsafe ticket path "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const catalogPath = join(fixture, "docs/issues.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    const target = catalog.tickets.find((ticket) => ticket.id === "D0-001");
    assert.ok(target, "D0-001 is missing from the catalog");
    target.ticket_path = "docs/tickets/D0/../D0/D0-001-canonical-identifier-registry.md";
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const before = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs")], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("ERROR invalid ticket_path D0-001"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite an unsafe ticket_path");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("every-declared-surface-is-rendered", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos every declared surface "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const healthy = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.match(healthy.stdout, /EXECUTION_VIEWS_CHECK surfaces=2 /, healthy.stdout);
    const roadmapPath = join(fixture, "docs/planning/AOS-EXECUTION-ROADMAP.md");
    const lines = readFileSync(roadmapPath, "utf8").split("\n");
    const start = lines.findIndex((line) => line.startsWith("<!-- generated:roadmap-authority-header start"));
    assert.ok(start >= 0, "roadmap-authority-header start marker is missing");
    lines[start + 1] = "**TAMPERED** roadmap authority header line";
    writeFileSync(roadmapPath, lines.join("\n"));
    const tampered = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(tampered.status, 1, tampered.stdout);
    assert.ok(tampered.stderr.includes("docs/planning/AOS-EXECUTION-ROADMAP.md"), `stderr did not name the roadmap surface: ${tampered.stderr}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("second-run-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos second run writes nothing "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const targets = [join(fixture, "docs/tickets/BOARD.md"), join(fixture, "docs/planning/AOS-EXECUTION-ROADMAP.md")];
    const first = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    // A rewrite that produces identical bytes still bumps mtime: plant a past timestamp
    // after the first run so any rewrite on the second run becomes visible.
    const past = new Date(Date.now() - 60 * 60 * 1000);
    targets.forEach((path) => utimesSync(path, past, past));
    const planted = targets.map((path) => statSync(path).mtimeMs);
    const second = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    targets.forEach((path, index) => {
      assert.equal(statSync(path).mtimeMs, planted[index], `second write run rewrote ${basename(path)}`);
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("marker-and-path-guards-are-exercised", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos marker path guards "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const catalogPath = join(fixture, "docs/issues.json");
    const originalBoard = readFileSync(boardPath, "utf8");
    const originalCatalog = readFileSync(catalogPath, "utf8");
    const startLine = originalBoard.split("\n").find((line) => line.startsWith("<!-- generated:board-rows start"));
    const endLine = "<!-- generated:board-rows end -->";
    assert.ok(startLine, "board-rows start marker is missing");
    assert.ok(originalBoard.includes(endLine), "board-rows end marker is missing");
    const restore = () => {
      writeFileSync(boardPath, originalBoard);
      writeFileSync(catalogPath, originalCatalog);
    };
    const expectWriteFailure = (label, expectedStderr) => {
      const before = readFileSync(boardPath);
      const result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
      assert.equal(result.status, 1, `${label}: expected exit 1: ${result.stdout} ${result.stderr}`);
      assert.ok(result.stderr.includes(expectedStderr), `${label}: ${result.stderr}`);
      assert.ok(readFileSync(boardPath).equals(before), `${label}: write mode changed the board`);
    };

    // (1) end marker before start marker.
    restore();
    writeFileSync(boardPath, `${endLine}\n${originalBoard.replace(`${endLine}\n`, "")}`);
    expectWriteFailure("end before start", "end marker appears before start marker");

    // (2) duplicated start marker.
    restore();
    writeFileSync(boardPath, originalBoard.replace(startLine, `${startLine}\n${startLine}`));
    expectWriteFailure("duplicate start marker", "expected exactly one start marker");

    // (3) ticket_path as a POSIX absolute path.
    restore();
    const catalog = JSON.parse(originalCatalog);
    const target = catalog.tickets.find((ticket) => ticket.id === "D0-001");
    assert.ok(target, "D0-001 is missing from the catalog");
    target.ticket_path = "/etc/passwd";
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    expectWriteFailure("absolute ticket_path", "ERROR invalid ticket_path D0-001");

    // (4) a heading inside the generated block.
    restore();
    writeFileSync(boardPath, originalBoard.replace(startLine, `${startLine}\n## Heading`));
    expectWriteFailure("heading inside generated block", "generated block contains a heading");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("authority-conflict-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos authority conflict "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const catalogPath = join(fixture, "docs/issues.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    const target = catalog.tickets.find((ticket) => ticket.id === "D0-001");
    assert.ok(target, "D0-001 is missing from the catalog");
    target.size = "XL";
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const before = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs")], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("DRIFT D0-001 size"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite an authority conflict");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("symlink-surface-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos symlink surface "));
  const fixture = join(parent, "repository");
  const outside = join(parent, "outside-board.md");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    // The outside target carries a drifted copy of the board: if the symlink guard were
    // absent, write mode would repair the drift through the symlink.
    const driftedBoard = readFileSync(boardPath, "utf8").replace("| S0 · Name & Contracts | S |", "| S0 · Name & Contracts | X |");
    assert.ok(driftedBoard.includes("| X |"), "tamper did not change the board row");
    writeFileSync(outside, driftedBoard);
    const outsideBefore = readFileSync(outside);
    rmSync(boardPath);
    symlinkSync(outside, boardPath);
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs")], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("symlink not allowed"), result.stderr);
    assert.ok(readFileSync(outside).equals(outsideBefore), "write mode changed the file outside the repository");
    assert.ok(lstatSync(boardPath).isSymbolicLink(), "write mode replaced the symlink");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("write-failure-leaves-no-partial-state", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "aos write failure partial state "));
  const fixture = join(parent, "repository");
  const roadmapDir = join(fixture, "docs", "planning");
  let roadmapDirMode = null;
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const roadmapPath = join(fixture, "docs/planning/AOS-EXECUTION-ROADMAP.md");
    // Both surfaces drift, so write mode must rewrite both. If a partial write were
    // possible, the board (the first surface) would already be repaired by the time
    // the roadmap write fails.
    const boardLines = readFileSync(boardPath, "utf8").split("\n");
    const boardStart = boardLines.findIndex((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(boardStart >= 0, "board-rows start marker is missing");
    boardLines[boardStart + 3] = boardLines[boardStart + 3].replace("| S0 · Name & Contracts | S |", "| S0 · Name & Contracts | X |");
    assert.ok(boardLines[boardStart + 3].includes("| X |"), "tamper did not change the board row");
    writeFileSync(boardPath, boardLines.join("\n"));
    const roadmapLines = readFileSync(roadmapPath, "utf8").split("\n");
    const roadmapStart = roadmapLines.findIndex((line) => line.startsWith("<!-- generated:roadmap-authority-header start"));
    assert.ok(roadmapStart >= 0, "roadmap-authority-header start marker is missing");
    // Swapping two lines of the fixed wording keeps every line in the block a line
    // the renderer can produce, so the shape check passes and the reordered block
    // is plain drift against the rendered order.
    [roadmapLines[roadmapStart + 1], roadmapLines[roadmapStart + 2]] =
      [roadmapLines[roadmapStart + 2], roadmapLines[roadmapStart + 1]];
    assert.ok(roadmapLines[roadmapStart + 1] !== roadmapLines[roadmapStart + 2], "swap did not change the roadmap header");
    writeFileSync(roadmapPath, roadmapLines.join("\n"));
    // Make the roadmap's directory unwritable so the second surface's write must fail.
    // The permission bits are not enforced for a root user, so prove the removal
    // actually took effect and skip explicitly instead of passing silently when it
    // did not.
    roadmapDirMode = statSync(roadmapDir).mode & 0o777;
    chmodSync(roadmapDir, 0o555);
    let probeBlocked = false;
    try {
      const probe = join(roadmapDir, ".write-permission-probe");
      writeFileSync(probe, "");
      rmSync(probe);
    } catch {
      probeBlocked = true;
    }
    if (!probeBlocked) {
      chmodSync(roadmapDir, roadmapDirMode);
      t.skip("directory permission bits are not enforced in this environment (likely running as root); cannot exercise a write failure");
      return;
    }
    const boardBefore = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("cannot write docs/planning/AOS-EXECUTION-ROADMAP.md"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(boardBefore), "write mode changed the board even though the roadmap surface was not writable");
  } finally {
    if (roadmapDirMode !== null) {
      chmodSync(roadmapDir, roadmapDirMode);
    }
    rmSync(parent, { recursive: true, force: true });
  }
});

test("rename-failure-rolls-back-every-surface", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "aos rename failure rollback "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const roadmapPath = join(fixture, "docs/planning/AOS-EXECUTION-ROADMAP.md");
    // Both surfaces drift, so write mode must rename both. The board (the first
    // surface) renames successfully; the roadmap rename then fails, so the board
    // must come back byte-for-byte to the drift bytes recorded here.
    const boardLines = readFileSync(boardPath, "utf8").split("\n");
    const boardStart = boardLines.findIndex((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(boardStart >= 0, "board-rows start marker is missing");
    boardLines[boardStart + 3] = boardLines[boardStart + 3].replace("| S0 · Name & Contracts | S |", "| S0 · Name & Contracts | X |");
    assert.ok(boardLines[boardStart + 3].includes("| X |"), "tamper did not change the board row");
    writeFileSync(boardPath, boardLines.join("\n"));
    const roadmapLines = readFileSync(roadmapPath, "utf8").split("\n");
    const roadmapStart = roadmapLines.findIndex((line) => line.startsWith("<!-- generated:roadmap-authority-header start"));
    assert.ok(roadmapStart >= 0, "roadmap-authority-header start marker is missing");
    // Swapping two lines of the fixed wording keeps every line in the block a line
    // the renderer can produce, so the shape check passes and the reordered block
    // is plain drift against the rendered order.
    [roadmapLines[roadmapStart + 1], roadmapLines[roadmapStart + 2]] =
      [roadmapLines[roadmapStart + 2], roadmapLines[roadmapStart + 1]];
    assert.ok(roadmapLines[roadmapStart + 1] !== roadmapLines[roadmapStart + 2], "swap did not change the roadmap header");
    writeFileSync(roadmapPath, roadmapLines.join("\n"));
    const boardDrift = readFileSync(boardPath);
    const roadmapDrift = readFileSync(roadmapPath);
    // A CommonJS preload patches fs.renameSync before the renderer module loads, and
    // syncBuiltinESMExports carries the patch into the renderer's named ESM imports:
    // only the second surface's rename throws, after the first rename already moved.
    const loaderPath = join(fixture, "rename-failure-loader.cjs");
    writeFileSync(loaderPath, `const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (String(to).endsWith("docs/planning/AOS-EXECUTION-ROADMAP.md")) {
    const error = new Error("injected EIO");
    error.code = "EIO";
    throw error;
  }
  return rename(from, to);
};
syncBuiltinESMExports();
`);
    // Prove the preload actually takes effect on this Node version before judging the
    // renderer run: with the patch active the injected EIO fires before the real
    // renameSync ever sees the missing source; without it the probe cannot say EIO.
    const probe = spawnSync(process.execPath, [
      "--require", loaderPath, "-e",
      "const fs = require(\"node:fs\"); try { fs.renameSync(\"__preload_probe_source__\", \"docs/planning/AOS-EXECUTION-ROADMAP.md\"); console.log(\"PRELOAD_INACTIVE\"); } catch (error) { console.log(error && error.code === \"EIO\" ? \"PRELOAD_ACTIVE\" : \"PRELOAD_UNEXPECTED:\" + (error && error.code)); }"
    ], { encoding: "utf8" });
    if (probe.status !== 0 || !probe.stdout.includes("PRELOAD_ACTIVE")) {
      t.skip(`--require preload did not take effect on Node ${process.version} (probe exit ${probe.status}: ${probe.stdout.trim() || probe.stderr.trim()}); cannot exercise a rename failure`);
      return;
    }
    const result = spawnSync(process.execPath, ["--require", loaderPath, script], { cwd: fixture, encoding: "utf8" });
    if (result.status === 0) {
      t.skip(`--require preload loaded but did not intercept the renderer's renameSync on Node ${process.version} (renderer exited 0 despite drifted surfaces); cannot exercise a rename failure`);
      return;
    }
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("cannot write docs/planning/AOS-EXECUTION-ROADMAP.md"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(boardDrift), "rollback did not restore the board to its drift-state bytes after the first rename succeeded");
    assert.ok(readFileSync(roadmapPath).equals(roadmapDrift), "the roadmap surface changed despite its rename failing");
    const tempPattern = (surfacePath) => new RegExp(`^\\.${basename(surfacePath).replace(/\./g, "\\.")}\\.render-tmp-`);
    const boardLeftovers = readdirSync(join(fixture, "docs", "tickets")).filter((entry) => tempPattern(boardPath).test(entry));
    const roadmapLeftovers = readdirSync(join(fixture, "docs", "planning")).filter((entry) => tempPattern(roadmapPath).test(entry));
    assert.equal(boardLeftovers.length, 0, `temp files left in docs/tickets: ${boardLeftovers.join(", ")}`);
    assert.equal(roadmapLeftovers.length, 0, `temp files left in docs/planning: ${roadmapLeftovers.join(", ")}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("leading-whitespace-in-a-declared-value-is-a-conflict", () => {

  const parent = mkdtempSync(join(tmpdir(), "aos leading whitespace conflict "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    // Whitespace before the dependency value: the parsed list is unchanged, the bytes
    // are not. A trim that silently healed this would hide the disagreement.
    const dependenciesPath = join(fixture, "docs/tickets/D0/D0-011-ticket-derived-fixture-directory-admission.md");
    const dependenciesTicket = readFileSync(dependenciesPath, "utf8");
    assert.ok(dependenciesTicket.includes("- Dependencies: D0-002,D0-004"), "expected dependencies line is missing from D0-011");
    writeFileSync(dependenciesPath, dependenciesTicket.replace("- Dependencies: D0-002,D0-004", "- Dependencies:   D0-002,D0-004"));
    const dependencyResult = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(dependencyResult.status, 1, dependencyResult.stdout);
    assert.ok(dependencyResult.stderr.includes("DRIFT"), dependencyResult.stderr);
    assert.ok(dependencyResult.stderr.includes("D0-011"), dependencyResult.stderr);
    assert.ok(dependencyResult.stderr.includes("dependencies"), dependencyResult.stderr);
    // Whitespace before the size value, checked on its own after restoring the
    // dependencies line: the same bytes-only disagreement must fail closed too.
    writeFileSync(dependenciesPath, dependenciesTicket);
    const sizePath = join(fixture, "docs/tickets/D0/D0-001-canonical-identifier-registry.md");
    const sizeTicket = readFileSync(sizePath, "utf8");
    assert.ok(sizeTicket.includes("- Size: S"), "expected size line is missing from D0-001");
    writeFileSync(sizePath, sizeTicket.replace("- Size: S", "- Size:  S"));
    const sizeResult = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(sizeResult.status, 1, sizeResult.stdout);
    assert.ok(sizeResult.stderr.includes("DRIFT"), sizeResult.stderr);
    assert.ok(sizeResult.stderr.includes("D0-001"), sizeResult.stderr);
    assert.ok(sizeResult.stderr.includes("size"), sizeResult.stderr);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("missing-ticket-contract-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos missing ticket contract "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const catalogPath = join(fixture, "docs/issues.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    const target = catalog.tickets.find((ticket) => ticket.id === "D0-001");
    assert.ok(target, "D0-001 is missing from the catalog");
    target.ticket_path = "docs/tickets/D0/missing.md";
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const before = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs")], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("ERROR missing ticket contract D0-001 docs/tickets/D0/missing.md"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite a missing ticket contract");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("duplicate-declaration-is-a-conflict", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos duplicate declaration "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const ticketPath = join(fixture, "docs/tickets/D0/D0-011-ticket-derived-fixture-directory-admission.md");
    const ticket = readFileSync(ticketPath, "utf8");
    assert.ok(ticket.includes("- Dependencies: D0-002,D0-004"), "expected dependencies line is missing from D0-011");
    // A second declaration with a different value: the first line must not shadow it.
    writeFileSync(ticketPath, ticket.replace("- Dependencies: D0-002,D0-004", "- Dependencies: D0-002,D0-004\n- Dependencies: D0-002"));
    const different = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(different.status, 1, different.stdout);
    assert.ok(different.stderr.includes("duplicate"), different.stderr);
    assert.ok(different.stderr.includes("D0-011"), different.stderr);
    // The same duplication with agreeing values: still a conflict.
    writeFileSync(ticketPath, ticket.replace("- Dependencies: D0-002,D0-004", "- Dependencies: D0-002,D0-004\n- Dependencies: D0-002,D0-004"));
    const same = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(same.status, 1, same.stdout);
    assert.ok(same.stderr.includes("duplicate"), same.stderr);
    assert.ok(same.stderr.includes("D0-011"), same.stderr);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("lookalike-start-marker-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos lookalike start marker "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const original = readFileSync(boardPath, "utf8");
    const startLine = original.split("\n").find((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(startLine, "board-rows start marker is missing");
    const unique = "UNIQUE_PROSE_UNDER_LOOKALIKE_START_MARKER";
    writeFileSync(boardPath, original.replace(`${startLine}\n`, `<!-- generated:board-rows starter -->\n${unique}\n`));
    const before = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("expected exactly one start marker"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite a lookalike start marker");
    assert.ok(readFileSync(boardPath, "utf8").includes(unique), "prose under the lookalike start marker was deleted");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("mixed-eol-preserves-bytes-outside-markers", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos mixed eol "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const lines = readFileSync(boardPath, "utf8").split("\n");
    const start = lines.findIndex((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(start >= 2, "board-rows start marker is missing or has no preceding line");
    // One line above the generated block becomes CRLF, and a row inside the block
    // drifts: the repair must rewrite only the block, not the outside line's terminator.
    const crlfLineIndex = 0;
    lines[crlfLineIndex] = `${lines[crlfLineIndex]}\r`;
    lines[start + 3] = lines[start + 3].replace("| S0 · Name & Contracts | S |", "| S0 · Name & Contracts | X |");
    assert.ok(lines[start + 3].includes("| X |"), "tamper did not change the board row");
    writeFileSync(boardPath, lines.join("\n"));
    const result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const after = readFileSync(boardPath, "utf8");
    const afterLines = after.split("\n");
    assert.ok(afterLines[crlfLineIndex].endsWith("\r"), "the CRLF line outside the markers lost its carriage return");
    assert.equal((after.match(/\r/g) || []).length, 1, "write mode changed line endings outside the generated block");
    assert.ok(after.includes("| S0 · Name & Contracts | S |"), "write mode did not repair the drifted row");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("captured-prose-in-a-generated-block-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos captured prose "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const roadmapPath = join(fixture, "docs/planning/AOS-EXECUTION-ROADMAP.md");
    const lines = readFileSync(roadmapPath, "utf8").split("\n");
    const endMarkerLine = "<!-- generated:roadmap-authority-header end -->";
    const end = lines.findIndex((line) => line === endMarkerLine);
    assert.ok(end >= 0, "roadmap-authority-header end marker is missing");
    // The prose that follows the block carries no heading, so only the generated-shape
    // check can see the capture. Moving the end marker below it traps the prose inside
    // the generated block; write mode must fail closed and keep the prose.
    const capturedProse = lines[end + 2];
    assert.ok(capturedProse.trim() !== "" && !/^#{1,6}\s/.test(capturedProse), "expected a heading-free prose line after the end marker");
    lines.splice(end, 1);
    lines.splice(end + 2, 0, endMarkerLine);
    writeFileSync(roadmapPath, lines.join("\n"));
    const before = readFileSync(roadmapPath);
    const result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("could not have produced"), result.stderr);
    assert.ok(readFileSync(roadmapPath).equals(before), "write mode changed the roadmap despite captured prose");
    assert.ok(readFileSync(roadmapPath, "utf8").includes(capturedProse), "captured prose was deleted");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("ticket-path-that-is-a-directory-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos directory ticket path "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const catalogPath = join(fixture, "docs/issues.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    const target = catalog.tickets.find((ticket) => ticket.id === "D0-001");
    assert.ok(target, "D0-001 is missing from the catalog");
    target.ticket_path = "docs/tickets/";
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const before = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [join(fixture, "scripts/render-execution-views.mjs")], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("ERROR ticket contract is not a regular file D0-001 docs/tickets/"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite a directory ticket_path");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("catalog-epic-or-milestone-disagreement-is-a-conflict", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos epic milestone conflict "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const catalogPath = join(fixture, "docs/issues.json");
    const originalCatalog = readFileSync(catalogPath, "utf8");
    const tamper = (field, value) => {
      const catalog = JSON.parse(originalCatalog);
      const target = catalog.tickets.find((ticket) => ticket.id === "D0-001");
      assert.ok(target, "D0-001 is missing from the catalog");
      target[field] = value;
      writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    };
    tamper("epic", "E1");
    const epicResult = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(epicResult.status, 1, epicResult.stdout);
    assert.ok(epicResult.stderr.includes("DRIFT"), epicResult.stderr);
    assert.ok(epicResult.stderr.includes("D0-001"), epicResult.stderr);
    assert.ok(epicResult.stderr.includes("epic"), epicResult.stderr);
    tamper("milestone", "S1 · G0 Scorer Truth");
    const milestoneResult = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(milestoneResult.status, 1, milestoneResult.stdout);
    assert.ok(milestoneResult.stderr.includes("DRIFT"), milestoneResult.stderr);
    assert.ok(milestoneResult.stderr.includes("D0-001"), milestoneResult.stderr);
    assert.ok(milestoneResult.stderr.includes("milestone"), milestoneResult.stderr);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("ops-check-detects-generated-view-drift", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos ops check drift "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const lines = readFileSync(boardPath, "utf8").split("\n");
    const start = lines.findIndex((line) => line.startsWith("<!-- generated:board-rows start"));
    assert.ok(start >= 0, "board-rows start marker is missing");
    // Tamper with the first rendered data row (D0-001): mutate only its size cell.
    lines[start + 3] = lines[start + 3].replace("| S0 · Name & Contracts | S |", "| S0 · Name & Contracts | X |");
    assert.ok(lines[start + 3].includes("| X |"), "tamper did not change the board row");
    writeFileSync(boardPath, lines.join("\n"));
    const result = spawnSync("npm", ["run", "ops:check", "--", "--offline"], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(result.status, 0, `${result.stdout} ${result.stderr}`);
    assert.ok(result.stderr.includes("docs/tickets/BOARD.md"), `ops:check did not report the drifted board: ${result.stdout} ${result.stderr}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("missing-end-marker-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos missing end marker "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const original = readFileSync(boardPath, "utf8");
    const endLine = "<!-- generated:board-rows end -->";
    assert.ok(original.includes(`${endLine}\n`), "board-rows end marker is missing");
    writeFileSync(boardPath, original.replace(`${endLine}\n`, ""));
    const before = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("expected exactly one end marker"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite a missing end marker");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("ticket-title-id-mismatch-is-a-conflict", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos title id mismatch "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const ticketPath = join(fixture, "docs/tickets/D0/D0-001-canonical-identifier-registry.md");
    const ticket = readFileSync(ticketPath, "utf8");
    assert.ok(ticket.includes("# D0-001 \u00b7 "), "expected title id is missing from D0-001");
    writeFileSync(ticketPath, ticket.replace("# D0-001 \u00b7 ", "# D0-999 \u00b7 "));
    const result = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("DRIFT"), result.stderr);
    assert.ok(result.stderr.includes("D0-001"), `stderr did not name the conflicted ticket: ${result.stderr}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dependency-order-mismatch-is-a-conflict", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos dependency order mismatch "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const ticketPath = join(fixture, "docs/tickets/D0/D0-011-ticket-derived-fixture-directory-admission.md");
    const ticket = readFileSync(ticketPath, "utf8");
    assert.ok(ticket.includes("- Dependencies: D0-002,D0-004"), "expected dependencies line is missing from D0-011");
    writeFileSync(ticketPath, ticket.replace("- Dependencies: D0-002,D0-004", "- Dependencies: D0-004,D0-002"));
    const result = spawnSync(process.execPath, [script, "--check"], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("DRIFT"), result.stderr);
    assert.ok(result.stderr.includes("D0-011"), `stderr did not name the drifted ticket: ${result.stderr}`);
    assert.ok(result.stderr.includes("dependencies"), `stderr did not name the drifted field: ${result.stderr}`);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("malformed-catalog-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos malformed catalog "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const catalogPath = join(fixture, "docs/issues.json");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const originalCatalog = readFileSync(catalogPath, "utf8");

    // (1) The catalog is JSON null: not an object, so nothing may be written.
    writeFileSync(catalogPath, "null\n");
    let before = readFileSync(boardPath);
    let result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("ERROR catalog is not an object docs/issues.json"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite a null catalog");

    // (2) An empty tickets array is not a valid empty catalog: write mode would
    // delete every rendered row.
    writeFileSync(catalogPath, '{"tickets":[]}\n');
    before = readFileSync(boardPath);
    result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("ERROR catalog holds no ticket records docs/issues.json"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite an empty tickets array");

    // (3) One record loses a rendered field: the catalog is incomplete.
    const catalog = JSON.parse(originalCatalog);
    const index = catalog.tickets.findIndex((ticket) => ticket.id === "D0-001");
    assert.ok(index >= 0, "D0-001 is missing from the catalog");
    delete catalog.tickets[index].epic;
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    before = readFileSync(boardPath);
    result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes(`ERROR catalog record is incomplete ${index} epic`), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite an incomplete catalog record");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("captured-authored-table-writes-nothing", () => {
  const parent = mkdtempSync(join(tmpdir(), "aos captured authored table "));
  const fixture = join(parent, "repository");
  try {
    cpSync(root, fixture, {
      recursive: true,
      filter: (source) => ![".git", "node_modules"].includes(basename(source))
    });
    const script = join(fixture, "scripts/render-execution-views.mjs");
    const boardPath = join(fixture, "docs/tickets/BOARD.md");
    const original = readFileSync(boardPath, "utf8");
    const endLine = "<!-- generated:board-rows end -->";
    assert.ok(original.includes(endLine), "board-rows end marker is missing");
    // An authored table with a different header and an unknown id, trapped inside the
    // generated block right before the end marker: write mode must fail closed and
    // keep it.
    const authoredTable = ["| Keep | Me |", "|---|---|", "| [ZZZ-999](zzz.md) | KEEP_ME |"].join("\n");
    writeFileSync(boardPath, original.replace(endLine, `${authoredTable}\n${endLine}`));
    const before = readFileSync(boardPath);
    const result = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes("could not have produced"), result.stderr);
    assert.ok(readFileSync(boardPath).equals(before), "write mode changed the board despite a captured authored table");
    assert.ok(readFileSync(boardPath, "utf8").includes("KEEP_ME"), "captured authored table was deleted");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
