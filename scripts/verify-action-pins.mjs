#!/usr/bin/env node
import { auditPermissions, loadPolicy, scanActionPins } from "../lib/action-pins.mjs";

// The required check. Offline, repository-wide, and it fails on anything it cannot read rather
// than skipping it.

const root = new URL("../", import.meta.url).pathname;
const policy = loadPolicy();

const pins = scanActionPins(root, policy);
const permissions = auditPermissions(root, policy);

const report = {
  schema: "aos-action-pins.v1",
  files_scanned: pins.files_scanned,
  external_uses: pins.external_uses,
  mutable_refs: pins.mutable_refs,
  unreviewed_owners: pins.unreviewed_owners,
  uncommented: pins.uncommented,
  unparsable: pins.unparsable,
  pinned_actions: pins.pinned_actions,
  workflow_digest: pins.workflow_digest,
  update_automation: policy.update_automation,
  permission_failures: permissions.failures,
  permissions: permissions.observed,
  ok: pins.ok && permissions.ok
};

if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  const line = (text) => process.stdout.write(`${text}\n`);
  line(`action pins  ${report.workflow_digest}`);
  line(`${report.files_scanned} file${report.files_scanned === 1 ? "" : "s"} scanned, ${report.external_uses} external reference${report.external_uses === 1 ? "" : "s"}, updates by ${report.update_automation}`);
  line("");
  for (const one of report.pinned_actions) line(`  ${one.action.padEnd(24)} ${one.sha}  ${one.version}  ${one.file}:${one.line}`);
  line("");
  for (const one of report.mutable_refs) line(`FAIL  mutable reference ${one.uses} at ${one.file}:${one.line}`);
  for (const one of report.unreviewed_owners) line(`FAIL  unreviewed owner "${one.owner}" at ${one.file}:${one.line}`);
  for (const one of report.uncommented) line(`FAIL  pin without a readable version comment at ${one.file}:${one.line}`);
  for (const one of report.unparsable) line(`FAIL  unreadable uses: "${one.uses}" at ${one.file}:${one.line}`);
  for (const one of report.permission_failures) line(`FAIL  ${one.check} ${one.file}: ${one.detail}`);
  line(report.ok ? "PASS  every external action is pinned, reviewed and readable" : "FAIL  see above");
}

process.exitCode = report.ok ? 0 : 1;
