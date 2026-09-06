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
    assert.equal(report.status, "PASS_FIVE_FAMILY_VARIATION");
    assert.equal(report.meaningful_variation_required_family_count, 5);
    assert.equal(report.task_oracle_evidence_binding_required_family_count, 6);
    for (const [family, row] of Object.entries(report.family_reports)) {
      assert.equal(row.task_oracle_evidence_binding_status, "BOUND", family);
      if (family === "FAM-5") {
        assert.equal(row.status, "FIXED_FORM");
        assert.equal(row.assessment_identity, "aos-fam-5-fixed-v0.2.0");
        assert.equal(row.unique_assessment_form_count, 1);
        assert.equal(row.decision_status, "DESCRIPTIVE_ONLY");
        assert.equal(row.implemented_decision_axis_count, 0);
      } else {
        assert.equal(row.status, "PASS", family);
        assert.equal(row.decision_status, "DECISION_BOUND");
        assert.ok(row.implemented_decision_axis_count > 0, `${family} implements no scoring axis`);
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
