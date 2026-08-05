import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);

test("planning contract validator reports the exact AOS gated census", () => {
  const output = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(output, /PLANNING_CONTRACT_PASS adr=12 prd=19 tickets=65 milestones=6 product_code=0 gates=blocked/);
});

test("README distinguishes planning truth from every planned CLI surface", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.match(readme, /Current status: planning baseline\. Product not implemented\./);
  assert.match(readme, /Planned CLI — not available yet/);
  assert.match(readme, /65 atomic implementation tickets/);
  assert.match(readme, /EXPERIMENTAL \/ PROVISIONAL/);
});

test("issue registry is total and uses six evidence milestones", () => {
  const issues = JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8"));
  assert.equal(issues.milestones.length, 6);
  assert.equal(issues.tickets.length, 65);
  assert.equal(new Set(issues.tickets.map(({ id }) => id)).size, 65);
  assert.ok(issues.tickets.every(({ body }) => body.includes("ADR + PRD + TICKET CEO GATES REQUIRED")));
});
