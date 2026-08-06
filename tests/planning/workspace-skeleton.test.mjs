import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const expectedWorkspaces = [
  ["packages/schema", "@aos/schema"],
  ["packages/scorer", "@aos/scorer"],
  ["packages/runner", "@aos/runner"],
  ["packages/reporter", "@aos/reporter"],
  ["adapters/codex", "@aos/adapter-codex"],
  ["adapters/claude-code", "@aos/adapter-claude-code"]
];
const ownerPaths = [
  "packages/schema/OWNERS.md",
  "packages/scorer/OWNERS.md",
  "packages/runner/OWNERS.md",
  "packages/reporter/OWNERS.md",
  "adapters/codex/OWNERS.md",
  "adapters/claude-code/OWNERS.md",
  "suites/coding-core-v0/OWNERS.md",
  "fixtures/OWNERS.md",
  "conformance/OWNERS.md"
];
const ownerMarker = "owner_ticket: D0-002\nowner_prd: PRD-D0-name-migration-and-repository-skeleton\n";
const expectedScripts = {
  test: "node --test",
  build: "node scripts/validate-planning.mjs --build",
  "docs:check": "node scripts/validate-planning.mjs"
};
const expectedScriptsText = [
  "  \"scripts\": {",
  "    \"test\": \"node --test\",",
  "    \"build\": \"node scripts/validate-planning.mjs --build\",",
  "    \"docs:check\": \"node scripts/validate-planning.mjs\"",
  "  }"
].join("\n");
const forbiddenManifestFields = [
  "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundledDependencies",
  "bin", "main", "module", "browser", "exports", "imports", "types", "typings", "files", "source"
];
const readJson = (relativePath) => JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
const asRepositoryRelative = (absolutePath) => relative(repositoryRoot, absolutePath).replaceAll("\\", "/");

const walkFiles = (relativeDirectory) => {
  const directory = resolve(repositoryRoot, relativeDirectory);
  assert.ok(existsSync(directory), `${relativeDirectory} is missing`);
  const directoryInfo = lstatSync(directory);
  assert.equal(directoryInfo.isSymbolicLink(), false, `${relativeDirectory} is a symbolic link`);
  assert.equal(directoryInfo.isDirectory(), true, `${relativeDirectory} is not a directory`);
  return readdirSync(directory).sort().flatMap((entry) => {
    const absolutePath = join(directory, entry);
    const fileInfo = lstatSync(absolutePath);
    assert.equal(fileInfo.isSymbolicLink(), false, `${asRepositoryRelative(absolutePath)} is a symbolic link`);
    if (fileInfo.isDirectory()) return walkFiles(asRepositoryRelative(absolutePath));
    assert.equal(fileInfo.isFile(), true, `${asRepositoryRelative(absolutePath)} is not a regular file`);
    return [absolutePath];
  });
};

const parseClearanceRecords = (text) => {
  const matches = [...text.matchAll(/^## (?<heading>.+)\n\n```json\n(?<json>[\s\S]*?)\n```/gm)];
  const records = matches.map(({ groups }) => ({ heading: groups.heading, record: JSON.parse(groups.json) }));
  const sources = records.map(({ record }) => record.source);
  assert.equal(new Set(sources).size, sources.length, "duplicate clearance source");
  return { matches, records };
};

const statusSemantics = (status) => ({
  permitsPrivateUnpublishedIdentifier: status !== "CONFLICT",
  blocksPublicCanonicalBrandAdoption: status !== "CLEAR",
  blocksPublicPublication: status !== "CLEAR",
  blocksD0Exit: status !== "CLEAR",
  requiresIdentityCorrection: status === "CONFLICT"
});

test("workspace-census", () => {
  const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
  assert.equal(
    rootManifest.name,
    "agent-operator-score",
    "root workspace name mismatch: actual agent-operator-score-repository; required agent-operator-score"
  );
  assert.deepEqual(rootManifest.workspaces, ["packages/*", "adapters/*"]);
  const manifests = ["packages", "adapters"].flatMap((directory) => walkFiles(directory))
    .filter((absolutePath) => absolutePath.endsWith("/package.json"))
    .map(asRepositoryRelative)
    .sort();
  assert.deepEqual(manifests, expectedWorkspaces.map(([path]) => `${path}/package.json`).sort());
  for (const [path, name] of expectedWorkspaces) {
    assert.equal(readJson(`${path}/package.json`).name, name, `${path} workspace name`);
  }
});

test("root-private-and-internal-workspaces-private", () => {
  assert.equal(readJson("package.json").private, true);
  for (const [path] of expectedWorkspaces) {
    assert.equal(readJson(`${path}/package.json`).private, true, `${path} must be private`);
  }
});

test("one-owner-per-path", () => {
  assert.equal(ownerPaths.length, 9);
  for (const path of ownerPaths) {
    assert.equal(readFileSync(resolve(repositoryRoot, path), "utf8"), ownerMarker, path);
  }
  const actualOwnerPaths = ["packages", "adapters", "suites", "fixtures", "conformance"]
    .flatMap((directory) => walkFiles(directory))
    .filter((absolutePath) => absolutePath.endsWith("/OWNERS.md"))
    .map(asRepositoryRelative)
    .sort();
  assert.deepEqual(actualOwnerPaths, [...ownerPaths].sort());
});

test("root-private-scripts-and-runnable-surface", () => {
  const rootManifestText = readFileSync(resolve(repositoryRoot, "package.json"), "utf8");
  const rootManifest = JSON.parse(rootManifestText);
  const scriptsStart = rootManifestText.indexOf("  \"scripts\": {");
  const rootClosingBrace = rootManifestText.lastIndexOf("\n}");
  assert.ok(scriptsStart >= 0 && rootClosingBrace > scriptsStart, "root scripts block is missing");
  assert.equal(rootManifestText.slice(scriptsStart, rootClosingBrace), expectedScriptsText);
  assert.equal(rootManifest.private, true);
  assert.deepEqual(rootManifest.scripts, expectedScripts);
  for (const field of forbiddenManifestFields) {
    assert.equal(field in rootManifest, false, `root declares ${field}`);
  }
  for (const [path, name] of expectedWorkspaces) {
    const manifest = readJson(`${path}/package.json`);
    assert.deepEqual(manifest, { name, version: "0.0.0", private: true }, `${path} manifest`);
    for (const field of forbiddenManifestFields) {
      assert.equal(field in manifest, false, `${path} declares ${field}`);
    }
  }
  const actualSkeletonFiles = ["packages", "adapters", "suites", "fixtures", "conformance"]
    .flatMap((directory) => walkFiles(directory))
    .map(asRepositoryRelative)
    .sort();
  const allowedSkeletonFiles = [
    ...expectedWorkspaces.map(([path]) => `${path}/package.json`),
    ...ownerPaths
  ].sort();
  assert.deepEqual(actualSkeletonFiles, allowedSkeletonFiles);
});

test("engine-matrix", () => {
  assert.equal(readJson("package.json").engines.node, ">=20 <25");
  const ci = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /node: \[20, 22, 24\]/);
});

test("minimum-name-clearance", () => {
  const clearance = readFileSync(resolve(repositoryRoot, "docs/clearance/MINIMUM-NAME-CLEARANCE.md"), "utf8");
  const { matches, records } = parseClearanceRecords(clearance);
  assert.equal(records.length, 4);
  assert.deepEqual(records.map(({ heading }) => heading), ["GitHub", "npm", "Domain", "Basic trademark"]);
  for (const { record } of records) {
    assert.deepEqual(Object.keys(record).sort(), ["limits", "query", "result", "searched_at", "source", "status"]);
    for (const field of ["source", "query", "searched_at", "result", "limits"]) {
      assert.equal(typeof record[field], "string", field);
      assert.ok(record[field].length > 0, field);
    }
    assert.match(record.searched_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(["CLEAR", "UNRESOLVED", "CONFLICT"].includes(record.status), record.status);
  }
  assert.throws(() => parseClearanceRecords(`${clearance}\n${matches[0][0]}`), /duplicate clearance source/);
  const byHeading = new Map(records.map(({ heading, record }) => [heading, record]));
  assert.equal(byHeading.get("Basic trademark").status, "UNRESOLVED");
  assert.deepEqual(statusSemantics("UNRESOLVED"), {
    permitsPrivateUnpublishedIdentifier: true,
    blocksPublicCanonicalBrandAdoption: true,
    blocksPublicPublication: true,
    blocksD0Exit: true,
    requiresIdentityCorrection: false
  });
  assert.equal(statusSemantics("CONFLICT").requiresIdentityCorrection, true);
  assert.match(clearance, /An `UNRESOLVED` status permits the private unpublished root package identifier, but blocks public canonical-brand adoption, public publication, and D0 exit\./);
  assert.match(clearance, /A `CONFLICT` requires identity correction\./);
  assert.match(clearance, /do not establish legal or trademark clearance and do not decide LICENSE, contribution acceptance, redistribution, or publication\./);
});

test("workspace-lock-consistency", () => {
  const rootManifest = readJson("package.json");
  const lock = readJson("package-lock.json");
  assert.deepEqual(rootManifest.workspaces, ["packages/*", "adapters/*"]);
  assert.deepEqual(Object.keys(lock).sort(), ["lockfileVersion", "name", "packages", "requires", "version"]);
  assert.equal(lock.name, "agent-operator-score");
  assert.equal(lock.version, "0.0.0");
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.requires, true);
  const expectedPackages = {
    "": {
      name: "agent-operator-score",
      version: "0.0.0",
      workspaces: ["packages/*", "adapters/*"],
      engines: { node: ">=20 <25" }
    }
  };
  for (const [path, name] of expectedWorkspaces) {
    expectedPackages[path] = { name, version: "0.0.0" };
    expectedPackages[`node_modules/${name}`] = { resolved: path, link: true };
  }
  assert.deepEqual(lock.packages, expectedPackages);
});
