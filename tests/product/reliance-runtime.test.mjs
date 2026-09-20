import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRelianceTrace, deriveRelianceProfile } from "../../lib/reliance.mjs";
import { mintOperatorEvent } from "../../lib/operator-events.mjs";
import { createRun, instrumentRunKey, operatorRunKey, relianceJournal, runPaths } from "../../lib/store.mjs";
import { routeOracleDigest } from "../../lib/routing-oracle.mjs";

test("the assessment store constructs a reliance trace through the real operator authority", () => {
  const root = mkdtempSync(join(tmpdir(), "aos-reliance-runtime-"));
  try {
    const runId = "run-reliance-runtime";
    createRun(root, { run_id: runId, mode: "TEST" });
    const operatorSecret = operatorRunKey(root, runId);
    const instrumentSecret = instrumentRunKey(root, runId);
    assert.notEqual(operatorSecret, instrumentSecret, "the production run keeps operator and instrument capabilities separate");
    const trace = createRelianceTrace({
      run_id: runId,
      operator_secret: operatorSecret,
      instrument_secret: instrumentSecret,
      journal: relianceJournal(root, runId)
    });
    const route = { route_id: "runtime" };
    const initial = mintOperatorEvent({
      run_id: runId,
      source: "interactive-tty",
      decision_type: "initial.judgment",
      construct_cell_id: "C3.RA.01",
      opportunity_id: "opp-runtime",
      challenge: { prompt: "initial" },
      value: { answer: "before advice" },
      named_evidence_ids: ["initial-runtime"],
      reported_confidence: 0.4,
      state_revision: 1,
      proactive_delegation: "DELEGATE"
    }, { secret: operatorSecret, now: new Date("2026-09-05T00:00:00Z") });
    trace.commitInitial({
      opportunity_id: "rel-runtime",
      operator_opportunity_id: "opp-runtime",
      task_form_id: "form-fam-3",
      operator_event: initial,
      delegation: { chosen: true, oracle_expected_value: "BENEFICIAL", route_oracle: { ...route, route_oracle_digest: routeOracleDigest(route) } },
      forcing: {
        forcing_protocol_id: "initial-judgment-before-advice.v1",
        burden_interaction_count: 1,
        skip_or_refusal: "NONE",
        timeout: false,
        interface: "interactive-tty"
      }
    });
    const journal = relianceJournal(root, runId);
    assert.equal(journal.read().length, 1);
    assert.equal(journal.readHead().entry_count, 1, "the atomically stored head commits the actual entry count");
    assert.equal(runPaths(root, runId).relianceTrace.endsWith("reliance-trace.json"), true);
    assert.throws(
      () => deriveRelianceProfile({ run_id: runId, operator_secret: operatorSecret, instrument_secret: `${instrumentSecret}-wrong`, journal }),
      /AOS_RELIANCE_TRACE_(?:BINDING|HEAD_BINDING)/,
      "a process without the instrument key cannot turn the stored journal into a profile"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
