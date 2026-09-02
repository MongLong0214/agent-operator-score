#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import {
  CANONICAL_ISSUE_COUNT,
  auditCloseEvidence,
  auditSummary,
  checkGithubState,
  checkPlan,
  fileDigest,
  loadPlan,
  loadSchema
} from "../lib/execution-plan.mjs";
import { fetchGithubState } from "../lib/github-state.mjs";

// The required check.
//
// Static by default and offline: manifest against schema, manifest against itself, manifest against
// the committed snapshot of the issues. `--live` swaps the snapshot for a live read, which is what
// the release audit runs; `--write-snapshot` refreshes the fixture so the two cannot quietly
// diverge without someone noticing that the file changed.

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PLAN_PATH = new URL("../governance/v0.2.0-execution-plan.json", import.meta.url);
const SCHEMA_PATH = new URL("../schemas/aos-execution-plan.v1.schema.json", import.meta.url);
const SNAPSHOT_PATH = new URL("../fixtures/execution-plan/github-state.json", import.meta.url);

const plan = loadPlan(PLAN_PATH);
const live = has("--live") || has("--write-snapshot");

const snapshot = live
  ? await fetchGithubState(plan, { integrationBranch: valueOf("--branch", "dev") })
  : JSON.parse(readFileSync(valueOf("--snapshot", SNAPSHOT_PATH.pathname), "utf8"));

if (has("--write-snapshot")) {
  // Stamped as a snapshot on the way to disk. The committed file said `source: "live"`, so an
  // offline run printed "source live" and a month-old fixture was indistinguishable from an audit
  // that had just talked to GitHub.
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify({ ...snapshot, source: "snapshot" }, null, 2)}\n`);
  process.stderr.write(`wrote ${SNAPSHOT_PATH.pathname}\n`);
}

const reports = {
  plan: checkPlan(plan, { schema: loadSchema(SCHEMA_PATH) }),
  // The run says how it got the file; the file has to agree. A hand-written offline snapshot
  // stamped `live` would otherwise read, in the evidence bundle, as an audit that talked to GitHub.
  state: checkGithubState(plan, snapshot, { expectedSource: live ? "live" : "snapshot" }),
  evidence: auditCloseEvidence(plan, snapshot, { live })
};

const summary = auditSummary(plan, snapshot, reports, {
  plan_file_digest: fileDigest(PLAN_PATH),
  schema_file_digest: fileDigest(SCHEMA_PATH)
});

const detailed = [
  ...reports.plan.failures.map((one) => ({ lane: "plan", ...one })),
  ...reports.state.failures.map((one) => ({ lane: "github-state", ...one })),
  ...reports.evidence.failures.map((one) => ({ lane: "close-evidence", ...one }))
];

if (has("--json")) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
else {
  const line = (text) => process.stdout.write(`${text}\n`);
  line(`execution plan ${plan.release}  ${summary.plan_digest}`);
  line(`source ${summary.source}  captured ${summary.captured_at}  (${summary.captured_age_hours}h ago)`);
  line(`issues ${summary.canonical_issue_count}/${CANONICAL_ISSUE_COUNT}  ready ${summary.counts.ready}  blocked ${summary.counts.blocked}  done ${summary.counts.done}  tracking ${summary.counts.tracking}`);
  line(`ready now: ${summary.next_work.ready.map((n) => `#${n}`).join(" ") || "none"}`);
  for (const one of summary.next_work.ready_with_blocked_phases) {
    const withheld = one.withheld_phases.map((phase) => `${phase.phase} (waits on ${phase.blocked_by.map((n) => `#${n}`).join(", ")})`);
    line(`restricted: #${one.issue} — only ${one.open_phases.join(", ")}; withheld: ${withheld.join("; ")}`);
  }
  for (const phase of summary.next_work.phase_ready) {
    line(`phase ready: #${phase.issue} ${phase.phase} (code integration ${phase.code_integration_allowed ? "allowed" : "not allowed"})`);
  }
  line("");
  for (const one of reports.evidence.unestablished) line(`NOTE  #${one.issue}: ${one.reason}`);
  if (detailed.length > 0) {
    for (const one of detailed) line(`FAIL  [${one.lane}] ${one.check}${one.issue ? ` #${one.issue}` : ""}: ${one.detail}`);
    line("");
    line(`FAIL  ${detailed.length} problem${detailed.length === 1 ? "" : "s"}`);
  } else if (reports.evidence.established) {
    line("PASS  plan, GitHub state and close evidence agree");
  } else {
    // Deliberately not "PASS, everything agrees". Offline, the confirmations live in a file the
    // author of the change controls, so this run has not established them and must not say it has.
    line("PASS  plan and GitHub state agree — close evidence is not established offline");
  }
}

process.exitCode = detailed.length === 0 ? 0 : 1;
