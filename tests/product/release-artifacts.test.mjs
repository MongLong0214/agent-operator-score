import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  PACKAGE_ALLOWLIST,
  buildInstallManifest,
  buildProvenance,
  packageBoundary,
  packageFileManifestDigest,
  sourceAuthority,
  versionConsistency
} from "../../lib/release-artifacts.mjs";

test("the boundary passes the package this repository actually produces", () => {
  // Measured against a real `npm pack`, not against invented paths. A denylist tested only on
  // paths its author made up agrees with its author: the first draft of the holdout rule matched
  // `holdout[^/]*.json` and rejected six shipped known-incident fixtures, and nothing but a real
  // pack was ever going to say so.
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8", timeout: 300000 });
  assert.equal(packed.status, 0, packed.stderr?.slice(0, 400));
  const files = JSON.parse(packed.stdout)[0].files;
  assert.ok(files.length > 100, "the pack manifest is suspiciously small");
  const boundary = packageBoundary(files);
  assert.deepEqual(
    { unsafe: boundary.unsafe, forbidden: boundary.forbidden, unexpected: boundary.unexpected },
    { unsafe: [], forbidden: [], unexpected: [] }
  );
});

test("private data, escaping paths and non-regular files are each refused, and every reason is reported at once", () => {
  // A boundary that reports the first forbidden file makes a release an iterative game of
  // discovery, and the person playing it starts looking for the flag that skips the check.
  const boundary = packageBoundary([
    { path: "lib/cli.mjs" },
    { path: ".aos/state.json" },
    { path: "runs/r-1/events" },
    { path: "holdout.json" },
    { path: "deploy.pem" },
    { path: "../escape" },
    { path: "weird", type: "Directory" },
    { path: "link", linkpath: "/etc/passwd" },
    { path: "stowaway.txt" }
  ]);
  assert.equal(boundary.ok, false);
  assert.equal(boundary.forbidden.length, 4, "a forbidden file was reported alone or missed");
  assert.equal(boundary.unsafe.length, 3);
  assert.ok(boundary.unexpected.includes("stowaway.txt"));
  for (const needle of ["operator home data", "recorded runs", "the holdout ledger", "credential material"]) {
    assert.ok(boundary.forbidden.some((one) => one.includes(needle)), needle);
  }

  // The narrowing that the real pack forced: the ledger is caught by name, the shipped corpus is not.
  assert.equal(packageBoundary(["holdout.json"]).ok, false);
  assert.equal(packageBoundary(["fixtures/known-incidents/holdout-320-anything.json"]).ok, true);
  // And the allowlist is prefixes and exact names only, so "is this allowed" has one answer.
  for (const entry of PACKAGE_ALLOWLIST) assert.ok(entry.endsWith("/") || !entry.includes("*"), entry);
});

test("a provenance core digest is reproducible and does not fold in the clock", () => {
  // Two builds of the same source produce the same core and different `built_at`. A
  // reproducibility claim that folded the clock in would be a claim nobody could check twice.
  const inputs = {
    version: "0.2.0", sourceCommit: "a".repeat(40), tag: "v0.2.0", mainCommit: "a".repeat(40),
    packageName: "agent-operator-score-0.2.0.tgz", packageSha256: `sha256:${"1".repeat(64)}`,
    packageFileManifestDigest: `sha256:${"2".repeat(64)}`, installManifestDigest: `sha256:${"3".repeat(64)}`,
    sbomDigest: `sha256:${"4".repeat(64)}`, workflowDigest: `sha256:${"5".repeat(64)}`,
    nodeVersion: "v22.23.2", measurementContractDigest: `sha256:${"6".repeat(64)}`
  };
  const early = buildProvenance({ ...inputs, builtAt: "2026-01-01T00:00:00.000Z" });
  const late = buildProvenance({ ...inputs, builtAt: "2030-12-31T23:59:59.000Z" });
  assert.equal(early.core_digest, late.core_digest, "the build clock reached the reproducible core");
  assert.notEqual(early.built_at, late.built_at);
  // A changed normative input is a changed core.
  assert.notEqual(early.core_digest, buildProvenance({ ...inputs, sourceCommit: "b".repeat(40), builtAt: early.built_at }).core_digest);
  // Order-insensitive where it should be: two runs that list the same actions and runs agree.
  assert.equal(
    buildProvenance({ ...inputs, pinnedActions: ["b", "a"], ciRunIds: [2, 1], builtAt: early.built_at }).core_digest,
    buildProvenance({ ...inputs, pinnedActions: ["a", "b"], ciRunIds: [1, 2], builtAt: early.built_at }).core_digest
  );
});

test("an install manifest's digest covers everything except itself", () => {
  // A record cannot contain its own digest and still be checkable; the consumer recomputes it from
  // the bytes it received rather than trusting the field beside them.
  const base = {
    repository: "MongLong0214/agent-operator-score", version: "0.2.0",
    sourceCommit: "a".repeat(40), releaseTag: "v0.2.0",
    artifacts: [{ kind: "npm-tarball", name: "x.tgz", sha256: `sha256:${"1".repeat(64)}`, url: "https://example/x.tgz" }],
    checksumsUrl: "https://example/SHA256SUMS", sbomUrl: "https://example/sbom.spdx.json",
    provenanceUrl: "https://example/provenance.json", node: ">=22.18 <25",
    generatedAt: "2026-01-01T00:00:00.000Z"
  };
  const manifest = buildInstallManifest(base);
  assert.equal(manifest.schema_id, "aos-agent-install.v2");
  assert.equal(manifest.channel, "stable");
  assert.match(manifest.manifest_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(buildInstallManifest(base).manifest_digest, manifest.manifest_digest);
  // One changed byte anywhere else moves it.
  assert.notEqual(buildInstallManifest({ ...base, version: "0.2.1" }).manifest_digest, manifest.manifest_digest);
});

test("a release that names more than one commit is refused, and so is one that names none", () => {
  const same = "a".repeat(40);
  assert.equal(sourceAuthority({
    mainCommit: same, tagCommit: same, releaseTargetCommit: same,
    provenanceSourceCommit: same, installManifestSourceCommit: same
  }).ok, true);

  const drifted = sourceAuthority({
    mainCommit: same, tagCommit: "b".repeat(40), releaseTargetCommit: same,
    provenanceSourceCommit: same, installManifestSourceCommit: same
  });
  assert.equal(drifted.ok, false);
  assert.ok(drifted.problems[0].includes("tag="), "the refusal does not name which identity differs");

  // Absent is not agreement. A field nobody recorded cannot be compared to anything, and treating
  // it as matching is how a release cut from dev passes a check about main.
  const missing = sourceAuthority({ mainCommit: same, tagCommit: same, releaseTargetCommit: same, provenanceSourceCommit: same });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((one) => one.includes("install_manifest commit is not recorded")));
});

test("every surface that states a version is compared, by name", () => {
  const ok = versionConsistency("0.2.0", { "package.json": "0.2.0", "the CLI": "0.2.0", "the tag": "0.2.0" });
  assert.deepEqual(ok, { ok: true, expected: "0.2.0", mismatched: [] });
  const lagging = versionConsistency("0.2.0", { "package.json": "0.2.0", "the plugin manifest": "0.1.17", "the tag": null });
  assert.equal(lagging.ok, false);
  assert.equal(lagging.mismatched.length, 2);
  assert.ok(lagging.mismatched.some((one) => one.startsWith("the plugin manifest says 0.1.17")));
  assert.ok(lagging.mismatched.some((one) => one.includes("the tag says nothing")));
});

test("the packed file list has its own digest, so a changed set of files is a changed release", () => {
  const a = packageFileManifestDigest(["lib/a.mjs", "lib/b.mjs"]);
  assert.equal(a, packageFileManifestDigest(["lib/b.mjs", "lib/a.mjs"]), "file order changed the release identity");
  assert.notEqual(a, packageFileManifestDigest(["lib/a.mjs"]));
  assert.equal(a, packageFileManifestDigest([{ path: "lib/a.mjs" }, { path: "lib/b.mjs" }]));
});
