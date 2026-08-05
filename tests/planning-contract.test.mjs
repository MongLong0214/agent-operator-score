import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const validatorOutput = /PLANNING_CONTRACT_PASS adr=12 prd=19 tickets=65 milestones=6 product_code_files=0 control_plane_code_files=2 semantic_checks=not_yet_enforced gates=pending/;

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
  const registry = JSON.parse(readFileSync(resolve(root, "docs/decisions/maintainer-gate-registry.v1.json"), "utf8"));
  assert.equal(registry.version, 1);
  assert.equal(registry.status, "PENDING");
  assert.ok(registry.batches.every(({ status }) => status === "PENDING"));
  assert.equal(registry.invalidation.on_sha_or_digest_change, true);
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
