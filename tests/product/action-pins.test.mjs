import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ACTION_REF,
  auditPermissions,
  discoverWorkflowFiles,
  loadPolicy,
  parseYamlSubset,
  scanActionPins,
  usesInText
} from "../../lib/action-pins.mjs";

const root = new URL("../../", import.meta.url).pathname;

const sandbox = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "aos-action-pins-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
};

const workflow = (uses) => `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - uses: ${uses}
`;

// --- the reference policy -------------------------------------------------------------------

test("a full lowercase forty-character SHA is the only external reference that passes", () => {
  const good = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(ACTION_REF.test(good), true);
  for (const bad of [
    "v5",
    "main",
    "release-branch",
    good.slice(0, 39),
    `${good}8`,
    good.toUpperCase(),
    good.replace("a", "g"),
    "v5.1.0"
  ]) {
    assert.equal(ACTION_REF.test(bad), false, `${bad} should not pass`);
  }
});

test("a mutable tag fails and a pinned SHA passes, wherever the workflow lives", () => {
  const sha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
  const dir = sandbox({
    ".github/workflows/ci.yml": workflow("actions/checkout@v5"),
    // A release workflow is not an exception. Naming files is how a scan misses the one that
    // matters, so discovery is by shape, not by an allowlist of names.
    ".github/workflows/release.yml": workflow(`actions/checkout@${sha} # v5.1.0`),
    ".github/workflows/admin.yaml": workflow("actions/checkout@main"),
    "packages/thing/action.yml": `name: local\nruns:\n  using: composite\n  steps:\n    - uses: actions/setup-node@v5\n`
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    const mutable = report.mutable_refs.map((one) => `${one.file}:${one.ref}`).sort();
    assert.equal(report.files_scanned, 4);
    assert.equal(mutable.length, 3, JSON.stringify(report.mutable_refs, null, 2));
    assert.ok(mutable.some((one) => one.includes("ci.yml") && one.endsWith("v5")));
    assert.ok(mutable.some((one) => one.includes("admin.yaml") && one.endsWith("main")));
    assert.ok(mutable.some((one) => one.includes("action.yml") && one.endsWith("v5")));
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a local action needs no pin and is not counted as external", () => {
  const dir = sandbox({ ".github/workflows/ci.yml": workflow("./.github/actions/setup") });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.mutable_refs, []);
    assert.equal(report.external_uses, 0);
    assert.equal(report.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pinned action from an owner nobody reviewed fails", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const dir = sandbox({ ".github/workflows/ci.yml": workflow(`some-stranger/do-things@${sha} # v1.0.0`) });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.mutable_refs, []);
    assert.equal(report.unreviewed_owners.length, 1);
    assert.equal(report.unreviewed_owners[0].owner, "some-stranger");
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pin with no human-readable version comment fails", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const dir = sandbox({ ".github/workflows/ci.yml": workflow(`actions/checkout@${sha}`) });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.uncommented.length, 1);
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a uses: line the scanner cannot parse fails rather than being skipped", () => {
  const dir = sandbox({ ".github/workflows/ci.yml": workflow("${{ matrix.action }}") });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.unparsable.length, 1);
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the repository itself ------------------------------------------------------------------

test("this repository has no mutable action reference anywhere", () => {
  const report = scanActionPins(root, loadPolicy());
  assert.deepEqual(report.mutable_refs, []);
  assert.deepEqual(report.unreviewed_owners, []);
  assert.deepEqual(report.uncommented, []);
  assert.deepEqual(report.unparsable, []);
  assert.ok(report.files_scanned >= 1);
  assert.ok(report.external_uses >= 2);
  assert.match(report.workflow_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(report.ok, true);
});

test("discovery finds workflows by shape, not by a list of names", () => {
  const dir = sandbox({
    ".github/workflows/a.yml": workflow("./x"),
    ".github/workflows/nested/b.yaml": workflow("./x"),
    "sub/action.yaml": "runs:\n  using: composite\n",
    "node_modules/pkg/.github/workflows/c.yml": workflow("./x"),
    ".github/workflows/notes.md": "# not a workflow"
  });
  try {
    const found = discoverWorkflowFiles(dir).map((one) => one.replace(`${dir}/`, "")).sort();
    // node_modules is excluded; everything else that has the shape is in.
    assert.deepEqual(found, [".github/workflows/a.yml", ".github/workflows/nested/b.yaml", "sub/action.yaml"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- permissions ----------------------------------------------------------------------------

test("a workflow's permissions must match the recorded baseline exactly", () => {
  const policy = loadPolicy();
  const report = auditPermissions(root, policy);
  assert.deepEqual(report.failures, [], JSON.stringify(report.failures, null, 2));

  // Widening a permission without editing the baseline in the same change is the review failure
  // this exists for -- a pin refresh that quietly comes with contents: write.
  const widened = {
    ...policy,
    workflow_permissions: { ...policy.workflow_permissions, ".github/workflows/ci.yml": { workflow: { contents: "write" }, jobs: {} } }
  };
  assert.ok(auditPermissions(root, widened).failures.some((one) => one.check === "permission-drift"));
});

test("a workflow with no declared permissions fails", () => {
  const dir = sandbox({
    ".github/workflows/loose.yml": "name: t\non: [push]\njobs:\n  one:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n"
  });
  try {
    const report = auditPermissions(dir, { ...loadPolicy(), workflow_permissions: {} });
    assert.ok(report.failures.some((one) => one.check === "permissions-undeclared"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the small YAML reader --------------------------------------------------------------------

test("the yaml subset reads what a workflow actually contains", () => {
  const parsed = parseYamlSubset(`name: t
on:
  pull_request:
    branches: [dev, main]
permissions:
  contents: read
  id-token: write
jobs:
  build:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@abc # v1
      - run: echo "hi: there"
`);
  assert.equal(parsed.name, "t");
  assert.deepEqual(parsed.permissions, { contents: "read", "id-token": "write" });
  assert.deepEqual(parsed.jobs.build.permissions, { contents: "write" });
  assert.deepEqual(parsed.on.pull_request.branches, ["dev", "main"]);
  assert.equal(parsed.jobs.build.steps.length, 2);
});

test("uses: is found however it is written, and a comment is separated from the ref", () => {
  const found = usesInText([
    "      - uses: actions/checkout@abc # v1.2.3",
    '      - uses: "actions/setup-node@def"',
    "      - uses: ./local",
    "      # - uses: actions/commented-out@v9",
    "        uses: docker://alpine:3"
  ].join("\n"));
  assert.deepEqual(found.map((one) => one.raw), [
    "actions/checkout@abc",
    "actions/setup-node@def",
    "./local",
    "docker://alpine:3"
  ]);
  assert.equal(found[0].comment, "v1.2.3");
  assert.equal(found[1].comment, null);
});

// --- the workflow this repository actually runs ------------------------------------------------

test("the CI workflow keeps a readable version beside every pin", () => {
  const report = scanActionPins(root, loadPolicy());
  assert.ok(report.pinned_actions.length >= 2);
  for (const one of report.pinned_actions) {
    assert.match(one.sha, ACTION_REF);
    assert.match(one.version, /^v\d+\.\d+\.\d+$/, `${one.action} at ${one.file}:${one.line}`);
  }
  // Every reference to the same action resolves to the same commit: a workflow that pins one job
  // to an old SHA and another to a new one is running two versions and saying it runs one.
  const byAction = new Map();
  for (const one of report.pinned_actions) {
    const seen = byAction.get(one.action);
    if (seen) assert.equal(one.sha, seen, `${one.action} is pinned to two different commits`);
    else byAction.set(one.action, one.sha);
  }
});

test("update automation is configured, and does not merge on its own", () => {
  const policy = loadPolicy();
  assert.ok(["dependabot", "renovate"].includes(policy.update_automation));
  const config = readFileSync(join(root, ".github", policy.update_automation === "dependabot" ? "dependabot.yml" : "renovate.json"), "utf8");
  assert.match(config, /github-actions/);
  // Nothing that would merge a proposal to run different code with this repository's credentials.
  assert.equal(/automerge|auto-merge/i.test(config), false);
});

test("the workflow digest changes when a workflow changes and not otherwise", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const one = sandbox({ ".github/workflows/ci.yml": workflow(`actions/checkout@${sha} # v1.0.0`) });
  const same = sandbox({ ".github/workflows/ci.yml": workflow(`actions/checkout@${sha} # v1.0.0`) });
  const other = sandbox({ ".github/workflows/ci.yml": workflow(`actions/checkout@${sha.replace("0123", "4567")} # v1.0.1`) });
  try {
    const digest = (dir) => scanActionPins(dir, loadPolicy()).workflow_digest;
    assert.equal(digest(one), digest(same));
    assert.notEqual(digest(one), digest(other));
    assert.match(digest(one), /^sha256:[0-9a-f]{64}$/);
  } finally {
    for (const dir of [one, same, other]) rmSync(dir, { recursive: true, force: true });
  }
});

test("a workflow with no recorded permission baseline fails", () => {
  const dir = sandbox({ ".github/workflows/new.yml": workflow("./x") });
  try {
    assert.ok(auditPermissions(dir, loadPolicy()).failures.some((one) => one.check === "permissions-unrecorded"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a baseline naming a workflow that no longer exists fails", () => {
  const policy = loadPolicy();
  const widened = { ...policy, workflow_permissions: { ...policy.workflow_permissions, ".github/workflows/gone.yml": { workflow: null, jobs: {} } } };
  assert.ok(auditPermissions(root, widened).failures.some((one) => one.check === "permissions-baseline-orphan"));
});

test("a job that quietly gains write access fails", () => {
  const dir = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  release:
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - run: true
`
  });
  try {
    const baseline = { reviewed_owners: ["actions"], update_automation: "dependabot", workflow_permissions: { ".github/workflows/ci.yml": { workflow: { contents: "read" }, jobs: {} } } };
    const report = auditPermissions(dir, baseline);
    assert.ok(report.failures.some((one) => one.check === "permission-drift"));
    assert.deepEqual(report.observed[".github/workflows/ci.yml"].jobs, { release: { contents: "write" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
