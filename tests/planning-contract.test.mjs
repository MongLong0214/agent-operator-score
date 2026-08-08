import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const acceptedValidatorOutput = /PLANNING_CONTRACT_PASS adr=13 prd=20 tickets=70 milestones=6 product_code_files=0 control_plane_code_files=9 control_plane_allowlist=9 ticket_owned_code_files=10 canonical_vectors=20 semantic_checks=static_catalog_enforced gates=invalidated product_code_paths=none ticket_owned_code_paths=packages\/schema\/src\/capability\.ts,packages\/schema\/src\/issuance-contract\.ts,packages\/schema\/src\/metric-registry\.ts,packages\/schema\/src\/scoring-contract\.ts,packages\/schema\/src\/session-class\.ts,packages\/schema\/test\/capability\.test\.ts,packages\/schema\/test\/issuance-contract\.test\.ts,packages\/schema\/test\/metric-registry\.test\.ts,packages\/schema\/test\/scoring-contract\.test\.ts,packages\/schema\/test\/session-class\.test\.ts/;
const pendingValidatorOutput = /PLANNING_CONTRACT_PASS adr=13 prd=20 tickets=70 milestones=6 product_code_files=0 control_plane_code_files=9 control_plane_allowlist=9 ticket_owned_code_files=10 canonical_vectors=20 semantic_checks=static_catalog_enforced gates=pending product_code_paths=none ticket_owned_code_paths=packages\/schema\/src\/capability\.ts,packages\/schema\/src\/issuance-contract\.ts,packages\/schema\/src\/metric-registry\.ts,packages\/schema\/src\/scoring-contract\.ts,packages\/schema\/src\/session-class\.ts,packages\/schema\/test\/capability\.test\.ts,packages\/schema\/test\/issuance-contract\.test\.ts,packages\/schema\/test\/metric-registry\.test\.ts,packages\/schema\/test\/scoring-contract\.test\.ts,packages\/schema\/test\/session-class\.test\.ts/;

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
  assert.match(readme, /the `aos` CLI, the trace and result schemas, the scorer, the runner/);
  assert.match(readme, /do \*\*not\*\* exist yet/);
  assert.equal(existsSync(resolve(root, "packages/scorer/src")), false);
  assert.match(readme, /Planned CLI — not available yet/);
  assert.match(readme, /70 atomic implementation tickets/);
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
  assert.equal(issues.tickets.length, 70);
  assert.equal(new Set(issues.tickets.map(({ id }) => id)).size, 70);
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
      .filter(({ id }) => ["D0-005", "D0-006", "D0-007", "D0-008", "D0-009"].includes(id))
      .map(({ id, issue }) => [id, issue]),
    [["D0-005", 173], ["D0-006", 174], ["D0-007", 175], ["D0-008", 176], ["D0-009", 177]]
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
    assert.match(error.stderr, /stale digest d0-002-prerequisites-red-census-contract-correction-renewal docs\/adr\/ADR-0001/);
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
