// #571: `scripts/build-release.mjs`, exercised as a subprocess so the test is honest about what
// ships -- an import of `lib/release-artifacts.mjs` would prove the library works and say nothing
// about whether the script wired around it actually calls it, on the actual output of a real `npm
// pack`, and actually refuses when it should.
//
// `lib/release-artifacts.mjs` and its own unit coverage (`tests/product/release-artifacts.test.mjs`)
// already prove `packageBoundary`, `versionConsistency` and `sourceAuthority` compute the right
// verdict from a given input. What is untested there, and is this script's own load-bearing logic,
// is whether a refusal from any one of those three ever fails to reach the exit code -- so each
// fixture here is built to trip exactly one of them, isolating the guard the way a probe has to.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION } from "../../lib/core.mjs";
import { fileByteDigest } from "../../lib/digest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(root, "scripts", "build-release.mjs");
const FAKE_COMMIT_A = "a".repeat(40);
const FAKE_COMMIT_B = "b".repeat(40);

/** A minimal, independent package directory this script can point `--dir` at. */
const makeFixture = ({ files = ["lib/"], extraPackageFields = {}, plugin = null, dropSourceFile = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "aos-571-build-release-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture-pkg", version: VERSION, files, ...extraPackageFields }));
  if (!dropSourceFile) {
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "a.js"), "module.exports = 1;\n");
  }
  if (plugin !== null) {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify(plugin));
  }
  return dir;
};

const runScript = (extraArgs, { cwd = root } = {}) =>
  spawnSync(process.execPath, [scriptPath, ...extraArgs], { encoding: "utf8", cwd, timeout: 300000 });

const cleanArgs = (dir) => ["--dir", dir, "--commit", FAKE_COMMIT_A, "--repo", "owner/repo"];

test("the build script produces a tarball, an install manifest and a provenance record for this repository", () => {
  const outDir = mkdtempSync(join(tmpdir(), "aos-571-build-release-out-"));
  try {
    const result = runScript(["--out", outDir, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.installManifest.schema_id, "aos-agent-install.v2");
    assert.equal(parsed.provenance.schema_id, "aos-release-provenance.v2");
    assert.equal(parsed.installManifest.version, VERSION);
    assert.equal(parsed.provenance.version, VERSION);
    assert.match(parsed.packageFileManifestDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(parsed.provenance.package_sha256, /^sha256:[0-9a-f]{64}$/u);

    // The three files this script claims to have written are the three files actually on disk, and
    // the tarball's own bytes are the ones the provenance record's `package_sha256` names -- not a
    // digest taken some other way that happens to look right.
    assert.ok(existsSync(parsed.out.tarball), "the tarball was not written");
    assert.ok(existsSync(parsed.out.installManifest), "the install manifest was not written");
    assert.ok(existsSync(parsed.out.provenance), "the provenance record was not written");
    assert.equal(fileByteDigest(parsed.out.tarball), parsed.provenance.package_sha256);
    assert.deepEqual(JSON.parse(readFileSync(parsed.out.installManifest, "utf8")), parsed.installManifest);
    assert.deepEqual(JSON.parse(readFileSync(parsed.out.provenance, "utf8")), parsed.provenance);

    // The core digest is the reproducible half of the provenance record; it must not have folded
    // in `built_at`, which release-artifacts.test.mjs already proves for the library function and
    // this proves for what the script actually sends it.
    const again = runScript(["--out", mkdtempSync(join(tmpdir(), "aos-571-build-release-out-")), "--json"]);
    assert.equal(again.status, 0, again.stderr);
    const rebuilt = JSON.parse(again.stdout);
    assert.equal(rebuilt.provenance.package_sha256, parsed.provenance.package_sha256, "the same source produced different package bytes");
    assert.notEqual(rebuilt.provenance.built_at, parsed.provenance.built_at);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("the build script refuses when the package boundary finds a forbidden or unexpected file", () => {
  const dir = makeFixture({ files: ["lib/", ".env"] });
  try {
    writeFileSync(join(dir, ".env"), "SECRET=x\n");
    const result = runScript(cleanArgs(dir));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AOS_BUILD_RELEASE_REFUSED: package boundary:.*credential material/u);
    // And nothing was produced -- a refused release must not leave a tarball behind for someone to
    // find and ship anyway.
    assert.equal(existsSync(join(dir, "dist", "release")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the build script refuses when a version surface disagrees with the release version", () => {
  const dir = makeFixture({ plugin: { name: "fixture", version: "0.0.1" } });
  try {
    const result = runScript(cleanArgs(dir));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AOS_BUILD_RELEASE_REFUSED: version: the plugin manifest says 0\.0\.1/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the build script refuses when main and the built commit are not the same source", () => {
  const dir = makeFixture();
  try {
    const result = runScript(["--dir", dir, "--commit", FAKE_COMMIT_A, "--main-commit", FAKE_COMMIT_B, "--repo", "owner/repo"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AOS_BUILD_RELEASE_REFUSED: source authority: the release names 2 different commits/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a refusal in --json mode reports every reason at once, not the first", () => {
  // Two independent defects, from two different checks, in the same fixture: the boundary and the
  // version surface. A script that stopped at the first would report only one.
  const dir = makeFixture({ files: ["lib/", ".env"], plugin: { name: "fixture", version: "0.0.1" } });
  try {
    writeFileSync(join(dir, ".env"), "SECRET=x\n");
    const result = runScript([...cleanArgs(dir), "--json"]);
    assert.notEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.problems.some((one) => one.includes("credential material")));
    assert.ok(parsed.problems.some((one) => one.includes("the plugin manifest says 0.0.1")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
