#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import {
  CANONICAL_ISSUE_COUNT,
  auditCloseEvidence,
  checkGithubState,
  checkPlan,
  fileDigest,
  loadPlan,
  loadSchema,
  nextWork,
  planDigest
} from "../lib/execution-plan.mjs";
import { fetchGithubState } from "../lib/github-state.mjs";

// The required check.
//
// Static by default and offline: manifest against schema, manifest against itself, manifest against
// the committed snapshot of GitHub. `--live` swaps the snapshot for a live read, which is what the
// release audit runs; `--write-snapshot` refreshes the fixture from the live state so the two can
// never quietly diverge without someone noticing that the file changed.

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
  ? await fetchGithubState(plan)
  : JSON.parse(readFileSync(valueOf("--snapshot", SNAPSHOT_PATH.pathname), "utf8"));

if (has("--write-snapshot")) {
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stderr.write(`wrote ${SNAPSHOT_PATH.pathname}\n`);
}

const staticReport = checkPlan(plan, { schema: loadSchema(SCHEMA_PATH) });
const stateReport = checkGithubState(plan, snapshot);
const evidenceReport = auditCloseEvidence(plan, snapshot);

const failures = [
  ...staticReport.failures.map((one) => ({ lane: "plan", ...one })),
  ...stateReport.failures.map((one) => ({ lane: "github-state", ...one })),
  ...evidenceReport.failures.map((one) => ({ lane: "close-evidence", ...one }))
];

// Safe by construction: counts, digests and issue numbers. Nothing here carries a title, a body, a
// token or a path, because this object is what goes into the release evidence bundle.
const summary = {
  schema: "aos-execution-audit.v1",
  release: plan.release,
  repository: plan.repository,
  source: snapshot.source,
  captured_at: snapshot.captured_at,
  plan_digest: planDigest(plan),
  plan_file_digest: fileDigest(PLAN_PATH),
  schema_file_digest: fileDigest(SCHEMA_PATH),
  canonical_issue_count: plan.issues.length,
  canonical_issue_count_expected: CANONICAL_ISSUE_COUNT,
  counts: {
    ready: plan.issues.filter((one) => one.status === "ready").length,
    blocked: plan.issues.filter((one) => one.status === "blocked").length,
    in_progress: plan.issues.filter((one) => one.status === "in-progress").length,
    done: plan.issues.filter((one) => one.status === "done").length,
    tracking: plan.issues.filter((one) => one.status === "tracking").length
  },
  next_work: nextWork(plan),
  failures: failures.map((one) => ({ lane: one.lane, check: one.check, issue: one.issue ?? null })),
  ok: failures.length === 0
};

if (has("--json")) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
else {
  const line = (text) => process.stdout.write(`${text}\n`);
  line(`execution plan ${plan.release}  ${summary.plan_digest}`);
  line(`source ${snapshot.source}  captured ${snapshot.captured_at}`);
  line(`issues ${summary.canonical_issue_count}/${CANONICAL_ISSUE_COUNT}  ready ${summary.counts.ready}  blocked ${summary.counts.blocked}  done ${summary.counts.done}  tracking ${summary.counts.tracking}`);
  line(`ready now: ${summary.next_work.ready.map((n) => `#${n}`).join(" ") || "none"}`);
  for (const phase of summary.next_work.phase_ready) {
    line(`phase ready: #${phase.issue} ${phase.phase} (code integration ${phase.code_integration_allowed ? "allowed" : "not allowed"})`);
  }
  line("");
  if (failures.length === 0) line("PASS  plan, GitHub state and close evidence agree");
  else {
    for (const one of failures) line(`FAIL  [${one.lane}] ${one.check}${one.issue ? ` #${one.issue}` : ""}: ${one.detail}`);
    line("");
    line(`FAIL  ${failures.length} problem${failures.length === 1 ? "" : "s"}`);
  }
}

process.exitCode = failures.length === 0 ? 0 : 1;
