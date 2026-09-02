import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

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
    // The other half of the name. Three failures and nothing about the pinned one would be equally
    // true of a scanner that failed everything, which is not what this claims.
    const passed = report.pinned_actions.filter((one) => one.file === ".github/workflows/release.yml");
    assert.equal(passed.length, 1, "the pinned reference did not pass");
    assert.equal(passed[0].sha, sha);
    assert.equal(passed[0].version, "v5.1.0");
    assert.equal(mutable.some((one) => one.includes("release.yml")), false);
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a local action needs no pin and is not counted as external", () => {
  const dir = sandbox({
    ".github/workflows/ci.yml": workflow("./.github/actions/setup"),
    ".github/actions/setup/action.yml": "name: setup\nruns:\n  using: composite\n  steps:\n    - run: true\n"
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.mutable_refs, []);
    assert.deepEqual(report.local_action_unresolved, []);
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
    assert.equal(report.unreviewed_owners[0].owner, "some-stranger/do-things");
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

test("discovery finds workflows by shape, and skips .git and symlinks", () => {
  const dir = sandbox({
    ".github/workflows/a.yml": workflow("./x"),
    ".github/workflows/nested/b.yaml": workflow("./x"),
    "sub/action.yaml": "runs:\n  using: composite\n",
    // Not excluded. A workflow saying `uses: ./dist` runs dist/action.yml, and skipping a directory
    // by name is skipping the place someone would put it.
    //
    // The nested file is scanned even though GitHub only runs workflows sitting directly in
    // `.github/workflows`. Scanning one GitHub ignores costs nothing; missing one it runs is the
    // failure this exists to prevent, and the same shape is a composite action's home too.
    "dist/action.yml": "runs:\n  using: composite\n",
    "node_modules/pkg/action.yml": "runs:\n  using: composite\n",
    ".git/hooks/action.yml": "runs:\n  using: composite\n",
    ".github/workflows/notes.md": "# not a workflow"
  });
  try {
    const found = discoverWorkflowFiles(dir).map((one) => one.replace(`${dir}/`, "")).sort();
    assert.deepEqual(found, [
      ".github/workflows/a.yml",
      ".github/workflows/nested/b.yaml",
      "dist/action.yml",
      "node_modules/pkg/action.yml",
      "sub/action.yaml"
    ]);
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

test("each uses: spelling the scanner resolves keeps its ref and its comment apart", () => {
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

// --- what the final review broke, and what stops it now ---------------------------------------

test("the uses spellings GitHub honours are seen, escapes included, and inert text is not", () => {
  // Every one of these is a real `uses` key GitHub honours, and a scanner that matched one
  // spelling saw none of the others. Not a claim about every spelling YAML permits: that claim
  // was made before and an escaped key disproved it, so what is named here is what is checked.
  const found = usesInText([
    '      - "uses": attacker/evil@main',
    '      - "\\u0075ses": attacker/escaped@main',
    "      - uses:",
    "          attacker/continued@main",
    "      - { uses: attacker/flow@main }",
    "      - &anchored { uses: attacker/anchored@main }",
    "      - uses: *anchored",
    "      - uses: ${{ matrix.action }}",
    "      - run: |",
    "          cat <<EOF",
    "          uses: attacker/inert@main",
    "          EOF",
    '      - run: echo "uses: attacker/inline@main"'
  ].join("\n"));

  const refs = found.map((one) => one.raw);
  for (const seen of ["attacker/evil@main", "attacker/escaped@main", "attacker/continued@main", "attacker/flow@main", "attacker/anchored@main"]) {
    assert.ok(refs.includes(seen), `${seen} was invisible to the scanner`);
  }
  // An alias is the node it names, so `uses: *anchored` here points at a mapping -- which is not an
  // action reference GitHub would run, and is refused rather than passed. An expression names an
  // action chosen at run time, which no offline check can resolve, and is refused too.
  assert.equal(found.filter((one) => one.form === "unrecognised").length, 1);
  assert.equal(found.filter((one) => one.form === "expression").length, 1);
  assert.equal(found.filter((one) => one.raw === null).length, 2);
  // Neither of the two inert ones is an action anyone runs, and reporting them would teach people
  // to ignore this check.
  assert.equal(refs.includes("attacker/inert@main"), false);
  assert.equal(refs.includes("attacker/inline@main"), false);
});

test("an expression or an alias in a uses: fails rather than passing", () => {
  for (const value of ["${{ matrix.action }}", "*anchored"]) {
    const dir = sandbox({ ".github/workflows/ci.yml": workflow(value) });
    try {
      assert.equal(scanActionPins(dir, loadPolicy()).unparsable.length, 1, `${value} was not refused`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a local action is a redirection, not a free pass", () => {
  const dir = sandbox({
    ".github/workflows/ci.yml": workflow("./dist"),
    // The bridge: a workflow points at a local composite action, and that action names an external
    // one at a mutable tag. Skipping `dist` by name would leave this entirely unchecked.
    "dist/action.yml": "name: build\nruns:\n  using: composite\n  steps:\n    - uses: attacker/evil@main\n"
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.local_action_unresolved, []);
    assert.equal(report.mutable_refs.length, 1, "the action the local reference runs was not scanned");
    assert.equal(report.mutable_refs[0].file, "dist/action.yml");
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a local reference pointing at nothing fails", () => {
  const dir = sandbox({ ".github/workflows/ci.yml": workflow("./not-here") });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.local_action_unresolved.length, 1);
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a container action is external code and needs a digest too", () => {
  const dir = sandbox({ ".github/workflows/ci.yml": workflow("docker://ghcr.io/someone/thing:latest") });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.external_uses, 1, "a container action was not counted as external");
    assert.equal(report.mutable_refs.length, 1);
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Digest-pinned, but from an image nobody reviewed.
  const digest = `docker://ghcr.io/someone/thing@sha256:${"a".repeat(64)}`;
  const reviewedDir = sandbox({ ".github/workflows/ci.yml": workflow(digest) });
  try {
    const report = scanActionPins(reviewedDir, loadPolicy());
    assert.deepEqual(report.mutable_refs, []);
    assert.equal(report.unreviewed_owners.length, 1);
  } finally {
    rmSync(reviewedDir, { recursive: true, force: true });
  }
});

test("the allowlist is per action, not per owner", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  // `actions` being reviewed says nothing about a repository under that owner nobody has looked at.
  const dir = sandbox({ ".github/workflows/ci.yml": workflow(`actions/nobody-reviewed-this@${sha} # v1.0.0`) });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.unreviewed_owners.length, 1);
    assert.equal(report.unreviewed_owners[0].owner, "actions/nobody-reviewed-this");
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a comment that is not a version is not a version", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  for (const comment of ["definitely v99, trust me", "latest", "see the PR", "updated"]) {
    const dir = sandbox({ ".github/workflows/ci.yml": workflow(`actions/checkout@${sha} # ${comment}`) });
    try {
      assert.equal(scanActionPins(dir, loadPolicy()).uncommented.length, 1, `"${comment}" was accepted as a version`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const dir = sandbox({ ".github/workflows/ci.yml": workflow(`actions/checkout@${sha} # v5.1.0`) });
  try {
    assert.deepEqual(scanActionPins(dir, loadPolicy()).uncommented, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory the scan cannot read is reported, not skipped", () => {
  const dir = sandbox({ ".github/workflows/ci.yml": workflow("./x"), "locked/keep": "" });
  try {
    chmodSync(join(dir, "locked"), 0o000);
    const report = scanActionPins(dir, loadPolicy());
    // "Unknown contents" has to reach the report rather than being swallowed by a bare catch.
    assert.equal(report.unreadable_directories.length, 1);
    assert.equal(report.ok, false);
  } finally {
    chmodSync(join(dir, "locked"), 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the supply-chain digest covers the policy that decides what passes", () => {
  const policy = loadPolicy();
  const before = scanActionPins(root, policy);
  // Every part of the policy, not one of them: the claim is that the digest covers what decides
  // the outcome, and the reviewed list, the permission baseline and the pattern a version comment
  // has to match all decide it.
  const changed = [
    { ...policy, reviewed_actions: [...policy.reviewed_actions, "someone/else"] },
    { ...policy, workflow_permissions: { ...policy.workflow_permissions, ".github/workflows/other.yml": { workflow: null, jobs: {} } } },
    { ...policy, version_comment_pattern: "^.*$" }
  ];
  for (const one of changed) {
    const after = scanActionPins(root, one);
    // Hashing only the workflows left all three free to change while the digest stayed identical.
    assert.equal(before.workflow_digest, after.workflow_digest);
    assert.notEqual(before.supply_chain_digest, after.supply_chain_digest, JSON.stringify(Object.keys(one)));
  }
});

test("every other job in this workflow waits for the pin check, and none overrides it", () => {
  // `needs` alone does not mean "never executes". GitHub documents `always()` as overriding the
  // skip a failed dependency would otherwise cause, so a job can name the gate and still run after
  // it goes red -- and a job in a *separate* workflow cannot name it at all. What is checkable here
  // is a property of this file: every job waits, and none of them opts out of waiting.
  // Any status-check function, spelled in any case. GitHub adds the implicit `success()` that
  // makes a job skip after a failed dependency *only* when the condition contains none of them, so
  // `always()`, `Always()` and `!success()` all opt out, and a folded condition is the same
  // condition. Naming three of them in one case was a predicate that let the fourth through.
  const STATUS_FUNCTION = /(?:always|success|failure|cancelled)\s*\(/i;
  const bypassing = (document, gate) =>
    Object.entries(document.jobs)
      .filter(([id]) => id !== gate)
      .filter(([, job]) => {
        const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
        return !needs.includes(gate) || STATUS_FUNCTION.test(String(job.if ?? ""));
      })
      .map(([id]) => id);

  const ci = parseYamlSubset(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8"));
  assert.ok(Object.keys(ci.jobs).includes("action-pins"));
  assert.ok(Object.keys(ci.jobs).length > 1);
  assert.deepEqual(bypassing(ci, "action-pins"), [], "a job does not wait for the pin check, or opts out of waiting");

  // The counterfactual: without it, the assertion above would pass on a workflow written to slip
  // past exactly this check, and the earlier version of this test did.
  const evasion = parseYamlSubset(`name: t
on: [push]
permissions:
  contents: read
jobs:
  action-pins:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/verify-action-pins.mjs
  waits:
    needs: action-pins
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - run: true
  documented:
    needs: action-pins
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: true
  capitalised:
    needs: action-pins
    if: Always()
    runs-on: ubuntu-latest
    steps:
      - run: true
  negated:
    needs: action-pins
    if: \${{ !success() }}
    runs-on: ubuntu-latest
    steps:
      - run: true
  folded:
    needs: action-pins
    if: >-
      always()
    runs-on: ubuntu-latest
    steps:
      - run: true
`);
  // `waits` is not in the list: a condition with no status-check function still carries the
  // implicit success() and still skips when the gate fails.
  assert.deepEqual(bypassing(evasion, "action-pins"), ["documented", "capitalised", "negated", "folded"]);
});

// --- what the second review broke, and what stops it now ---------------------------------------

test("a uses key spelled with an escape is seen, and an escaped run key stays inert", () => {
  // YAML resolves a double-quoted key's escapes before it is a key, so both of these are the key
  // they spell rather than the characters on the line. One hid a live reference from the scanner;
  // the other disguised a `run:` block scalar, which made the scanner report the inert text inside
  // it and miss nothing quietly at the same time.
  const found = usesInText([
    '      - "\\u0075ses": attacker/escaped@main',
    '      - "r\\u0075n": |',
    "          uses: attacker/inert@main",
    '      - "uses": attacker/quoted@main'
  ].join("\n"));

  const refs = found.map((one) => one.raw);
  assert.ok(refs.includes("attacker/escaped@main"), "an escaped uses key hid a live reference");
  assert.ok(refs.includes("attacker/quoted@main"));
  assert.equal(refs.includes("attacker/inert@main"), false, "an escaped run key was not read as a block scalar");
  assert.equal(found.length, 2, JSON.stringify(found));

  // End to end, because this was the bypass: a workflow actionlint reads as a live reference has to
  // reach the report as one.
  const dir = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - "\\u0075ses": attacker/evil@main
`
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.mutable_refs.length, 1, JSON.stringify(report, null, 2));
    assert.equal(report.mutable_refs[0].ref, "main");
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a workflow with CRLF line endings reads the same as one without", () => {
  const sha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
  // A carriage return left on the end of the value made an ordinary pinned reference unreadable,
  // and a check that fails on a file Windows wrote is a check people turn off.
  const dir = sandbox({ ".github/workflows/ci.yml": workflow(`actions/checkout@${sha} # v5.1.0`).replace(/\n/g, "\r\n") });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.unparsable, [], JSON.stringify(report.unparsable));
    assert.deepEqual(report.mutable_refs, []);
    assert.equal(report.pinned_actions.length, 1);
    assert.equal(report.pinned_actions[0].sha, sha);
    assert.equal(report.pinned_actions[0].version, "v5.1.0");
    assert.equal(report.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // "Reads the same" is the claim, so read both and compare. A carriage return survives inside a
  // block scalar, where nothing trims it away, and a value that differs by a byte nobody typed is
  // a value the permission audit compares against a baseline.
  const both = `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${sha} # v5.1.0
      - if: |
          github.event_name == 'push'
        run: |
          echo hi
`;
  assert.deepEqual(parseYamlSubset(both.replace(/\n/g, "\r\n")), parseYamlSubset(both));
  assert.deepEqual(usesInText(both.replace(/\n/g, "\r\n")), usesInText(both));
});

test("a uses under with: or env: is an input, not an action reference", () => {
  const found = usesInText([
    "jobs:",
    "  one:",
    "    env:",
    "      uses: harmless-env",
    "    steps:",
    "      - uses: actions/checkout@abc # v1.0.0",
    "        with:",
    "          uses: harmless-input",
    "      - name: flow",
    "        env: { uses: harmless-flow }",
    "      - uses: actions/setup-node@def # v2.0.0"
  ].join("\n"));
  assert.deepEqual(found.map((one) => one.raw), ["actions/checkout@abc", "actions/setup-node@def"], JSON.stringify(found));

  const sha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
  const dir = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${sha} # v5.1.0
        with:
          uses: harmless-input
        env: { uses: harmless-flow }
`
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.mutable_refs, [], JSON.stringify(report.mutable_refs));
    assert.deepEqual(report.unparsable, []);
    assert.equal(report.external_uses, 1);
    assert.equal(report.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The context rule narrows what counts as a reference; it does not widen what may pass. A
  // `key: value` inside a flow sequence is a mapping of one pair, so the reader resolves this one
  // rather than refusing it -- and it fails, by name, as the mutable reference it is.
  const strange = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - [uses: attacker/evil@main]
`
  });
  try {
    const report = scanActionPins(strange, loadPolicy());
    assert.deepEqual(report.unparsable, []);
    assert.equal(report.mutable_refs.length, 1, JSON.stringify(report.mutable_refs));
    assert.equal(report.mutable_refs[0].ref, "main");
    assert.equal(report.ok, false);
  } finally {
    rmSync(strange, { recursive: true, force: true });
  }
});

test("a version comment after a flow mapping is kept", () => {
  const sha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
  // The comment sits outside the braces, so the flow match cannot contain it. Losing it turned a
  // correctly pinned reference into a pin with no readable version.
  const found = usesInText(`      - { uses: actions/checkout@${sha} } # v5.1.0`);
  assert.equal(found.length, 1);
  assert.equal(found[0].raw, `actions/checkout@${sha}`);
  assert.equal(found[0].comment, "v5.1.0");

  const dir = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - { uses: actions/checkout@${sha} } # v5.1.0
`
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.uncommented, [], JSON.stringify(report.uncommented));
    assert.equal(report.pinned_actions.length, 1);
    assert.equal(report.pinned_actions[0].version, "v5.1.0");
    assert.equal(report.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the same-repository $/path syntax is a local reference, not an unreadable one", () => {
  // GitHub's other spelling for an action in this repository, resolved against the repository root.
  // Refusing it as unparsable was fail-closed but wrong: it is valid, documented syntax, and a
  // check that fails on valid syntax is one people route around.
  const dir = sandbox({
    ".github/workflows/ci.yml": workflow("$/.github/actions/setup"),
    ".github/actions/setup/action.yml": "name: setup\nruns:\n  using: composite\n  steps:\n    - run: true\n"
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.unparsable, [], JSON.stringify(report.unparsable));
    assert.deepEqual(report.local_action_unresolved, []);
    assert.equal(report.external_uses, 0);
    assert.equal(report.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // It is a redirection like `./path`, held to the same rule: the file it names has to be one this
  // scan read.
  const missing = sandbox({ ".github/workflows/ci.yml": workflow("$/not-here") });
  try {
    const report = scanActionPins(missing, loadPolicy());
    assert.deepEqual(report.unparsable, []);
    assert.equal(report.local_action_unresolved.length, 1);
    assert.equal(report.ok, false);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
});

test("a symlinked directory or action file is skipped, and a reference to either fails closed", () => {
  const dir = sandbox({
    ".github/workflows/ci.yml": workflow("./linked"),
    ".github/workflows/two.yml": workflow("./aliased"),
    "real/action.yml": "name: real\nruns:\n  using: composite\n  steps:\n    - run: true\n"
  });
  try {
    symlinkSync(join(dir, "real"), join(dir, "linked"), "dir");
    mkdirSync(join(dir, "aliased"));
    symlinkSync(join(dir, "real", "action.yml"), join(dir, "aliased", "action.yml"));

    // Skipped, and documented as skipped: the walk enters directories and reads files, and a
    // symlink is neither.
    const found = discoverWorkflowFiles(dir).map((one) => one.replace(`${dir}/`, "")).sort();
    assert.deepEqual(found, [".github/workflows/ci.yml", ".github/workflows/two.yml", "real/action.yml"]);

    // Which is safe because skipping fails closed rather than open. Both kinds are referenced here,
    // because a skip nobody points at proves nothing: `./linked` is the symlinked directory and
    // `./aliased` the symlinked `action.yml`, and each resolves to a path that is not in the
    // scanned set, so each is unresolved and the report is not ok.
    const report = scanActionPins(dir, loadPolicy());
    assert.deepEqual(report.mutable_refs, []);
    assert.equal(report.local_action_unresolved.length, 2, JSON.stringify(report.local_action_unresolved));
    for (const one of report.local_action_unresolved) assert.equal(one.reason, "the action it runs was not scanned");
    assert.deepEqual(report.local_action_unresolved.map((one) => one.uses).sort(), ["./aliased", "./linked"]);
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the supply-chain digest covers the verifier, the npm script and the .npmrc that run the check", async () => {
  const sha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
  // The scanner is not the whole check. `scripts/verify-action-pins.mjs` combines the pin scan with
  // the permission audit and sets the exit status, and `package.json` decides which file the npm
  // script runs -- so a digest over the workflows, the policy and the scanner leaves the two places
  // that turn failure into success outside what provenance quotes.
  const distribution = (edit, extra = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "aos-action-pins-dist-"));
    for (const part of ["lib", "scripts", "governance", ".github/workflows"]) mkdirSync(join(dir, part), { recursive: true });
    copyFileSync(join(root, "lib", "action-pins.mjs"), join(dir, "lib", "action-pins.mjs"));
    copyFileSync(join(root, "governance", "action-pin-policy.json"), join(dir, "governance", "action-pin-policy.json"));
    for (const [from, to] of [["scripts/verify-action-pins.mjs", "scripts/verify-action-pins.mjs"], ["package.json", "package.json"]]) {
      writeFileSync(join(dir, to), edit(to, readFileSync(join(root, from), "utf8")));
    }
    writeFileSync(join(dir, ".github/workflows/ci.yml"), workflow(`actions/checkout@${sha} # v5.1.0`));
    for (const [path, body] of Object.entries(extra)) writeFileSync(join(dir, path), body);
    return dir;
  };
  const digests = async (dir) => {
    const module = await import(pathToFileURL(join(dir, "lib", "action-pins.mjs")).href);
    const report = module.scanActionPins(dir, module.loadPolicy());
    return { workflow: report.workflow_digest, supply: report.supply_chain_digest };
  };

  const unchanged = distribution((path, body) => body);
  // The one-line edit the review found: the verifier stops combining the two results and always
  // reports success, while every file the digest covered stays byte-identical.
  const forged = distribution((path, body) =>
    path.endsWith("verify-action-pins.mjs") ? body.replace("ok: pins.ok && permissions.ok", "ok: true") : body);
  // And the other one: the npm script runs something else entirely.
  const rerouted = distribution((path, body) =>
    path.endsWith("package.json") ? body.replace('"verify:action-pins": "node scripts/verify-action-pins.mjs"', '"verify:action-pins": "true"') : body);
  // And the third: an `.npmrc` that makes every npm script exit zero without running anything.
  const muffled = distribution((path, body) => body, { ".npmrc": "script-shell=/usr/bin/true\n" });

  try {
    const before = await digests(unchanged);
    const after = await digests(forged);
    const elsewhere = await digests(rerouted);
    const quiet = await digests(muffled);
    assert.equal(before.workflow, after.workflow);
    assert.equal(before.workflow, elsewhere.workflow);
    assert.equal(before.workflow, quiet.workflow);
    assert.notEqual(before.supply, after.supply, "changing the verifier left the supply-chain digest identical");
    assert.notEqual(before.supply, elsewhere.supply, "changing the npm script left the supply-chain digest identical");
    assert.notEqual(before.supply, quiet.supply, "adding an .npmrc left the supply-chain digest identical");
  } finally {
    for (const dir of [unchanged, forged, rerouted, muffled]) rmSync(dir, { recursive: true, force: true });
  }
});

// --- what the third review broke, and what stops it now ----------------------------------------

test("a uses beside a block scalar in the same step is not swallowed by it", () => {
  // Valid YAML, accepted by actionlint, run by GitHub: a step whose `if:` is a literal block, with
  // the action reference after it. The block was measured from the dash rather than from the key,
  // so every sibling of that key was two columns inside the block and invisible.
  const found = usesInText([
    "jobs:",
    "  one:",
    "    steps:",
    "      - if: |",
    "          github.event_name == 'push'",
    "        uses: attacker/evil@main",
    "      - name: after",
    "        run: |",
    "          uses: attacker/inert@main",
    "      - uses: attacker/second@main"
  ].join("\n"));
  // The reference beside the block is seen; the text inside it still is not.
  assert.deepEqual(found.map((one) => one.raw), ["attacker/evil@main", "attacker/second@main"], JSON.stringify(found));

  const dir = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - if: |
          github.event_name == 'push'
        uses: attacker/evil@main
`
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.mutable_refs.length, 1, JSON.stringify(report, null, 2));
    assert.equal(report.mutable_refs[0].ref, "main");
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit key, folded over lines, is still the key it spells", () => {
  // `? key` / `: value` with the key written as a folded scalar. It resolves to `uses`, actionlint
  // accepts it and GitHub runs it, and nothing that reads one line at a time can see it at all --
  // which is why what reads this file now is a parser rather than a pattern.
  const found = usesInText([
    "jobs:",
    "  one:",
    "    steps:",
    "      - ? >-",
    "          uses",
    "        : attacker/evil@main"
  ].join("\n"));
  assert.deepEqual(found.map((one) => one.raw), ["attacker/evil@main"], JSON.stringify(found));

  // And the folded *value*, which used to be refused as unreadable rather than read.
  const folded = usesInText("      - uses: >-\n          attacker/folded@main\n");
  assert.deepEqual(folded.map((one) => one.raw), ["attacker/folded@main"]);

  const dir = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  one:
    runs-on: ubuntu-latest
    steps:
      - ? >-
          uses
        : attacker/evil@main
`
  });
  try {
    const report = scanActionPins(dir, loadPolicy());
    assert.equal(report.mutable_refs.length, 1, JSON.stringify(report, null, 2));
    assert.equal(report.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a quoted permissions key is the same key, so a job cannot gain write access behind quotes", () => {
  // The same class of bypass as the escaped `uses`, in the other reader: the permission audit read
  // the characters rather than the key, observed no job permissions at all, and matched a baseline
  // that recorded none.
  const dir = sandbox({
    ".github/workflows/ci.yml": `name: t
on: [push]
permissions:
  contents: read
jobs:
  release:
    "permissions":
      contents: write
    runs-on: ubuntu-latest
    steps:
      - run: true
`
  });
  try {
    const baseline = { reviewed_actions: [], update_automation: "dependabot", workflow_permissions: { ".github/workflows/ci.yml": { workflow: { contents: "read" }, jobs: {} } } };
    const report = auditPermissions(dir, baseline);
    assert.deepEqual(report.observed[".github/workflows/ci.yml"].jobs, { release: { contents: "write" } });
    assert.ok(report.failures.some((one) => one.check === "permission-drift"), JSON.stringify(report.failures));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file the reader cannot read fails the check rather than passing it", () => {
  // The reader covers the YAML a workflow is written in and refuses the rest by name. Refusing has
  // to fail: "I could not read this file" and "this file is clean" are the two answers that must
  // never look the same.
  for (const body of ["jobs:\n\tone:\n", "steps:\n  - uses: !!custom thing\n", "a: 1\n---\nb: 2\n"]) {
    const dir = sandbox({ ".github/workflows/ci.yml": body });
    try {
      const report = scanActionPins(dir, loadPolicy());
      assert.equal(report.unparsable.length, 1, `${JSON.stringify(body)} was not refused`);
      assert.equal(report.ok, false);
      // And the permission audit says so too, rather than reporting a workflow it could not read.
      assert.ok(auditPermissions(dir, loadPolicy()).failures.some((one) => one.check === "workflow-unreadable"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("the required check runs the verifier directly, so an .npmrc cannot switch it off", () => {
  // `script-shell=/usr/bin/true` in a repository-level `.npmrc` makes every `npm run` exit zero
  // without executing anything. The gate job is the one place where the exit status is the whole
  // point, so it invokes node with no shell in between.
  const document = parseYamlSubset(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8"));
  const commands = document.jobs["action-pins"].steps.map((one) => one.run).filter(Boolean);
  assert.ok(commands.some((one) => /node\s+scripts\/verify-action-pins\.mjs/.test(one)), JSON.stringify(commands));
  assert.equal(commands.some((one) => /npm run verify:action-pins/.test(one)), false, "an .npmrc could make this exit zero without running the check");
});

test("an alias is the node it names, so a merge key cannot hide a reference or a permission", () => {
  // Found by reading this reader against another one rather than by review: an alias that resolved
  // to nothing meant a mapping's inherited keys simply vanished, and `<<: *defaults` is exactly
  // where a step's action reference and a job's permissions can both live.
  const found = usesInText([
    "defaults: &step",
    "  uses: attacker/evil@main",
    "jobs:",
    "  one:",
    "    steps:",
    "      - <<: *step",
    "        name: innocent"
  ].join("\n"));
  assert.ok(found.some((one) => one.raw === "attacker/evil@main"), JSON.stringify(found));

  const parsed = parseYamlSubset([
    "defaults: &perms",
    "  contents: write",
    "jobs:",
    "  one:",
    "    permissions:",
    "      <<: *perms"
  ].join("\n"));
  assert.deepEqual(parsed.jobs.one.permissions, { contents: "write" });
});

test("a block sequence at its key's own indentation is the key's value, not a second document", () => {
  // Found by differential-testing this reader against PyYAML rather than by review: `on:` over
  // `- push` and `steps:` over `- uses:` is the commonest way a workflow is written, and the reader
  // refused it. Fail-closed, but a check that fails on a valid workflow is a check that gets
  // switched off, which is the one way a pin scan stops scanning.
  const parsed = parseYamlSubset([
    "on:",
    "- push",
    "- pull_request",
    "jobs:",
    "  one:",
    "    steps:",
    "    - name: first",
    "      uses: actions/checkout@v4",
    "      with:",
    "        fetch-depth: 0",
    "    - run: echo",
    "  two:",
    "    steps:",
    "      - uses: actions/other@v1"
  ].join("\n"));
  assert.deepEqual(parsed.on, ["push", "pull_request"]);
  assert.equal(parsed.jobs.one.steps.length, 2);
  assert.deepEqual(parsed.jobs.one.steps[0], { name: "first", uses: "actions/checkout@v4", with: { "fetch-depth": 0 } });
  assert.equal(parsed.jobs.two.steps[0].uses, "actions/other@v1");

  const found = usesInText(["jobs:", "  one:", "    steps:", "    - uses: attacker/evil@main"].join("\n"));
  assert.ok(found.some((one) => one.raw === "attacker/evil@main"), JSON.stringify(found));
});

test("a byte-order mark and a %YAML directive are read past, not refused", () => {
  const body = ["jobs:", "  one:", "    steps:", "      - uses: actions/checkout@v4"].join("\n");
  assert.deepEqual(parseYamlSubset(`﻿${body}`), parseYamlSubset(body));
  assert.deepEqual(parseYamlSubset(`%YAML 1.2\n---\n${body}`), parseYamlSubset(body));
});

test("a key named __proto__ is an entry of the mapping, not its prototype", () => {
  const parsed = parseYamlSubset(["__proto__:", "  permissions:", "    contents: write", "jobs: {}"].join("\n"));
  assert.ok(Object.hasOwn(parsed, "__proto__"));
  assert.equal(parsed.permissions, undefined);
});
