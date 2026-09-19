#!/usr/bin/env node
// The release build script (#571): what a release build actually produces on disk, and what it
// refuses to produce.
//
// This is the producer `lib/release-artifacts.mjs` names in its own header: that module decides
// whether a package, a version set or a set of commit identities may become a release, and decides
// nothing about how any of those things are obtained. This script is the "how" -- it runs `npm
// pack`, reads git and the plugin manifests, and hands what it measured to the lib. Same split as
// `scripts/verify-release-canary.mjs` and `scripts/verify-release-channel.mjs`, for the reason both
// give: a release decision that could only be checked by releasing is a decision nobody checks.
//
// It does not publish, tag or open a GitHub release. It packs the tarball this repository would
// ship, measures it, and writes the tarball plus the two records a release publishes --
// `aos-agent-install.v2` and `aos-release-provenance.v2` -- to `--out`. Uploading those three files
// to an actual release is a later, separate, human step.
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION, readJsonIfExists, sha256Value, writeJson } from "../lib/core.mjs";
import { fileByteDigest } from "../lib/digest.mjs";
import { loadPolicy, scanActionPins } from "../lib/action-pins.mjs";
import { measurementContract } from "../lib/contract-freeze.mjs";
import {
  buildInstallManifest,
  buildProvenance,
  packageBoundary,
  packageFileManifestDigest,
  sourceAuthority,
  versionConsistency
} from "../lib/release-artifacts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A tiny, local parser for this script's own flags. Not `lib/cli.mjs`'s `parseArgs` -- that reader
// carries a quirk specific to the `aos` command's own `arg` flag, and pulling it in here would mean
// this script's flags inherited a special case that has nothing to do with it. `--json` is the only
// bare flag; every other `--name` takes the next token as its value.
const args = process.argv.slice(2);
const flags = Object.create(null);
let json = false;
for (let index = 0; index < args.length; index += 1) {
  const token = args[index];
  if (token === "--json") {
    json = true;
    continue;
  }
  if (!token.startsWith("--")) continue;
  const key = token.slice(2);
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    process.stderr.write(`AOS_BUILD_RELEASE_BAD_FLAG: --${key} needs a value\n`);
    process.exit(2);
  }
  flags[key] = value;
  index += 1;
}

const fail = (message) => {
  process.stderr.write(`AOS_BUILD_RELEASE_ERROR: ${message}\n`);
  process.exit(1);
};

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", cwd: root, timeout: 300000, ...options });
  if (result.error) fail(`could not run ${command} ${commandArgs.join(" ")}: ${result.error.message}`);
  return result;
};

// The directory whose package is built. Defaults to this repository, and can be pointed at a
// fixture in a test -- the same reason `verify-release-canary.mjs` takes an evidence path on the
// command line instead of only ever reading its own fixture.
const dir = flags.dir ? resolve(process.cwd(), flags.dir) : root;

const gitValue = (commandArgs) => {
  const result = spawnSync("git", commandArgs, { encoding: "utf8", cwd: root });
  return result.status === 0 ? result.stdout.trim() : null;
};

const commit = flags.commit ?? gitValue(["rev-parse", "HEAD"]) ?? fail("no --commit given and `git rev-parse HEAD` failed; this is not a git checkout");
const mainCommit = flags["main-commit"] ?? commit;
const tag = flags.tag ?? `v${VERSION}`;

const repoFromRemote = () => {
  const remote = gitValue(["remote", "get-url", "origin"]);
  const match = remote?.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u);
  return match ? `${match[1]}/${match[2]}` : null;
};
const repository = flags.repo ?? repoFromRemote() ?? fail("no --repo given and the origin remote is not a github.com repository");

const outDir = flags.out ? resolve(process.cwd(), flags.out) : join(dir, "dist", "release");

// --- what package.json and the plugin manifests say the version is --------------------------------

const pkg = readJsonIfExists(join(dir, "package.json")) ?? fail(`no package.json at ${dir}`);
const plugin = readJsonIfExists(join(dir, ".claude-plugin", "plugin.json"));
const marketplace = readJsonIfExists(join(dir, ".claude-plugin", "marketplace.json"));
const tagVersion = tag.match(/^v(.+)$/u)?.[1] ?? null;

const versionSurfaces = { "package.json": pkg.version, "the release tag": tagVersion };
if (plugin !== null) versionSurfaces["the plugin manifest"] = plugin.version;
if (marketplace !== null) {
  versionSurfaces["the marketplace metadata"] = marketplace.metadata?.version ?? null;
  versionSurfaces["the marketplace listing"] = marketplace.plugins?.[0]?.version ?? null;
}
const versionCheck = versionConsistency(VERSION, versionSurfaces);

// --- whether this package may ship at all -----------------------------------------------------

const dryRun = run("npm", ["pack", "--dry-run", "--json"], { cwd: dir });
if (dryRun.status !== 0) fail(`npm pack --dry-run failed: ${dryRun.stderr?.slice(0, 400) ?? "no stderr"}`);
let files;
try {
  files = JSON.parse(dryRun.stdout)[0].files;
} catch (error) {
  fail(`npm pack --dry-run did not print the expected JSON: ${error.message}`);
}
const boundary = packageBoundary(files);

const authority = sourceAuthority({
  mainCommit,
  tagCommit: commit,
  releaseTargetCommit: commit,
  provenanceSourceCommit: commit,
  installManifestSourceCommit: commit
});

// Every reason at once, the same rule `packageBoundary` and `sourceAuthority` hold themselves to.
// Each array is independently load-bearing: dropping any one of the three back to `[]` would let a
// release with that specific defect through silently while the other two still refused.
const boundaryProblems = [...boundary.unsafe, ...boundary.forbidden, ...boundary.unexpected].map((one) => `package boundary: ${one}`);
const versionProblems = versionCheck.mismatched.map((one) => `version: ${one}`);
const authorityProblems = authority.problems.map((one) => `source authority: ${one}`);
const problems = [...boundaryProblems, ...versionProblems, ...authorityProblems];

if (problems.length > 0) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, problems }, null, 2)}\n`);
  else for (const problem of problems) process.stderr.write(`AOS_BUILD_RELEASE_REFUSED: ${problem}\n`);
  process.exit(1);
}

// --- the package may ship: produce it, and measure what was produced ---------------------------

mkdirSync(outDir, { recursive: true });
const packed = run("npm", ["pack", "--json", "--pack-destination", outDir], { cwd: dir });
if (packed.status !== 0) fail(`npm pack failed: ${packed.stderr?.slice(0, 400) ?? "no stderr"}`);
let packedMeta;
try {
  packedMeta = JSON.parse(packed.stdout)[0];
} catch (error) {
  fail(`npm pack did not print the expected JSON: ${error.message}`);
}
const tarballPath = join(outDir, packedMeta.filename);
const packageSha256 = fileByteDigest(tarballPath);
const fileManifestDigest = packageFileManifestDigest(files);

const generatedAt = new Date().toISOString();
const releaseUrl = (name) => `https://github.com/${repository}/releases/download/${tag}/${name}`;

const artifacts = [{ kind: "npm-tarball", name: packedMeta.filename, sha256: packageSha256, url: releaseUrl(packedMeta.filename) }];
const sbomDigest = flags.sbom ? fileByteDigest(flags.sbom) : null;
const sbomUrl = flags.sbom ? releaseUrl("sbom.spdx.json") : null;

const installManifest = buildInstallManifest({
  repository,
  version: VERSION,
  sourceCommit: commit,
  releaseTag: tag,
  artifacts,
  checksumsUrl: releaseUrl("SHA256SUMS"),
  sbomUrl,
  provenanceUrl: releaseUrl("provenance.json"),
  node: pkg.engines?.node ?? null,
  generatedAt
});

// `workflow_digest` is read as `supply_chain_digest` on purpose -- `docs/SUPPLY_CHAIN.md` names
// that digest, not `workflow_digest` alone, as "the one release provenance should quote", because
// it is the one that also covers the pin policy and the scanner's own bytes rather than only the
// workflow files.
const pins = scanActionPins(root, loadPolicy());
const pinnedActions = pins.pinned_actions.map((one) => `${one.action}@${one.sha}`);

const provenance = buildProvenance({
  version: VERSION,
  sourceCommit: commit,
  tag,
  mainCommit,
  packageName: packedMeta.filename,
  packageSha256,
  packageFileManifestDigest: fileManifestDigest,
  installManifestDigest: installManifest.manifest_digest,
  sbomDigest,
  workflowDigest: pins.supply_chain_digest,
  pinnedActions,
  ciRunIds: process.env.GITHUB_RUN_ID ? [process.env.GITHUB_RUN_ID] : [],
  nodeVersion: process.version,
  measurementContractDigest: `sha256:${sha256Value(measurementContract())}`,
  builtAt: generatedAt
});

const installManifestPath = join(outDir, "install-manifest.json");
const provenancePath = join(outDir, "provenance.json");
writeJson(installManifestPath, installManifest);
writeJson(provenancePath, provenance);

const result = {
  ok: true,
  tag,
  commit,
  mainCommit,
  repository,
  packageFileManifestDigest: fileManifestDigest,
  installManifest,
  provenance,
  out: { dir: outDir, tarball: tarballPath, installManifest: installManifestPath, provenance: provenancePath }
};

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`built ${packedMeta.filename}  ${packageSha256}\n`);
  process.stdout.write(`file manifest  ${fileManifestDigest}\n`);
  process.stdout.write(`install manifest  ${installManifest.manifest_digest}  ${installManifestPath}\n`);
  process.stdout.write(`provenance  ${provenance.core_digest}  ${provenancePath}\n`);
  process.stdout.write(`wrote to ${outDir}\n`);
}
