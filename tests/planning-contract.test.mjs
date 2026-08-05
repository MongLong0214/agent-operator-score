import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);

test("planning contract validator reports the exact gated census", () => {
  const output = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(output, /PLANNING_CONTRACT_PASS adr=12 prd=10 tickets=41 product_code=0/);
});

test("README distinguishes current planning state from the planned CLI", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.match(readme, /Current status: planning baseline/);
  assert.match(readme, /Planned CLI — not available yet/);
});
