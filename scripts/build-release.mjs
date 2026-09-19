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
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
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

// The SBOM describes the artifact, not the checkout, so it lists what the tarball carries: this
// package and its runtime dependencies. A devDependency is excluded because it is not in the
// tarball -- claiming otherwise would describe a supply chain the consumer does not receive. This
// repository currently ships no runtime dependency at all, so `components` is legitimately empty,
// and an empty list is a statement rather than a gap.
//
// Generated from `package-lock.json` rather than by a generator dependency: adding a third-party
// tool to the build in order to describe the build's third-party surface is a trade this issue
// should not make silently. `--sbom <path>` still overrides with one produced elsewhere.
const buildSbom = () => {
  const lock = readJsonIfExists(join(dir, "package-lock.json")) ?? {};
  const components = Object.entries(lock.packages ?? {})
    .filter(([path, entry]) => path !== "" && entry.dev !== true && entry.optional !== true)
    .map(([path, entry]) => {
      const name = path.replace(/^(?:.*\/)?node_modules\//u, "");
      const component = {
        type: "library",
        name,
        version: entry.version ?? null,
        purl: `pkg:npm/${name.replace(/^@/u, "%40")}@${entry.version ?? ""}`
      };
      // `integrity` is the registry's own digest of the tarball npm installed. It is the only
      // per-dependency hash this lockfile actually carries; deriving one any other way would be
      // asserting something nobody measured.
      if (typeof entry.integrity === "string") {
        const [algorithm, value] = entry.integrity.split("-");
        if (algorithm === "sha512" || algorithm === "sha256") {
          component.hashes = [{ alg: algorithm === "sha512" ? "SHA-512" : "SHA-256", content: Buffer.from(value, "base64").toString("hex") }];
        }
      }
      return component;
    })
    .sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: generatedAt,
      component: {
        type: "application",
        name: pkg.name,
        version: VERSION,
        purl: `pkg:npm/${pkg.name}@${VERSION}`,
        // Bare hex: CycloneDX types `hashes[].content` as the digest itself, while `fileByteDigest`
        // returns it `sha256:`-prefixed for this repository's own records.
        hashes: [{ alg: "SHA-256", content: packageSha256.replace(/^sha256:/u, "") }]
      },
      properties: [
        { name: "aos:source_commit", value: commit },
        { name: "aos:release_tag", value: tag },
        { name: "aos:scope", value: "runtime dependencies of the published tarball; devDependencies are excluded because they are not in it" }
      ]
    },
    components
  };
};

const sbomPath = join(outDir, "sbom.cyclonedx.json");
if (!flags.sbom) writeJson(sbomPath, buildSbom());
const sbomFile = flags.sbom ? resolve(process.cwd(), flags.sbom) : sbomPath;
const sbomDigest = fileByteDigest(sbomFile);
const sbomUrl = releaseUrl(flags.sbom ? "sbom.spdx.json" : "sbom.cyclonedx.json");

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

// Written last, because it hashes the files above. `checksumsUrl` in the install manifest has always
// named this file; until now nothing wrote it, so the manifest pointed a consumer at a URL that
// would 404. Plain `shasum -c` format, so verifying needs no tool this project ships.
const checksumsPath = join(outDir, "SHA256SUMS");
const checksumLines = [tarballPath, sbomFile, installManifestPath, provenancePath]
  .map((path) => `${fileByteDigest(path).replace(/^sha256:/u, "")}  ${basename(path)}`);
writeFileSync(checksumsPath, `${checksumLines.join("\n")}\n`, "utf8");

const result = {
  ok: true,
  tag,
  commit,
  mainCommit,
  repository,
  packageFileManifestDigest: fileManifestDigest,
  installManifest,
  provenance,
  out: { dir: outDir, tarball: tarballPath, sbom: sbomFile, checksums: checksumsPath, installManifest: installManifestPath, provenance: provenancePath }
};

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`built ${packedMeta.filename}  ${packageSha256}\n`);
  process.stdout.write(`file manifest  ${fileManifestDigest}\n`);
  process.stdout.write(`install manifest  ${installManifest.manifest_digest}  ${installManifestPath}\n`);
  process.stdout.write(`provenance  ${provenance.core_digest}  ${provenancePath}\n`);
  process.stdout.write(`sbom  ${sbomDigest}  ${sbomFile}\n`);
  process.stdout.write(`checksums  ${checksumsPath}\n`);
  process.stdout.write(`wrote to ${outDir}\n`);
}
