import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./helpers.mjs";

test("the shipped forms command produces the 20-seed variation report", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-forms-command-"));
  try {
    const result = run(cwd, ["forms", "--json"]);
    const report = JSON.parse(result.stdout);
    assert.equal(report.sample_size, 20);
    assert.equal(report.status, "PASS");
    for (const [family, row] of Object.entries(report.family_reports)) {
      assert.equal(row.status, "PASS", family);
      if (family === "FAM-5") {
        assert.equal(row.decision_status, "DESCRIPTIVE_ONLY");
        assert.equal(row.decision_axis_count, 0);
      } else {
        assert.equal(row.decision_status, "DECISION_BOUND");
        assert.ok(row.decision_axis_count > 0, `${family} declares no scoring axis`);
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
