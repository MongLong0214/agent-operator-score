import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
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
  "docs:check": "node scripts/validate-planning.mjs",
  "ops:status": "node scripts/resolve-execution-state.mjs",
  "ops:check": "node scripts/resolve-execution-state.mjs --offline"
};
const expectedScriptsText = [
  "  \"scripts\": {",
  "    \"test\": \"node --test\",",
  "    \"build\": \"node scripts/validate-planning.mjs --build\",",
  "    \"docs:check\": \"node scripts/validate-planning.mjs\",",
  "    \"ops:status\": \"node scripts/resolve-execution-state.mjs\",",
  "    \"ops:check\": \"node scripts/resolve-execution-state.mjs --offline\"",
  "  }"
].join("\n");
const forbiddenManifestFields = [
  "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundledDependencies",
  "bin", "main", "module", "browser", "exports", "imports", "types", "typings", "files", "source"
];
const workspaceTestScript = "node --test --test-name-pattern";
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const asRepositoryRelative = (absolutePath) => relative(repositoryRoot, absolutePath).replaceAll("\\", "/");

// Independent re-derivation of the ticket-owned source claim the planning validator enforces.
// Only paths a ticket names exactly, and that exist on disk, may sit in the skeleton. This is
// a claim check, not an acceptance check; ticket readiness stays the resolver's job.
const ticketOwnedSkeletonPaths = () => {
  const ticketsRoot = resolve(repositoryRoot, "docs/tickets");
  const owned = new Set();
  for (const absolutePath of walkFiles(ticketsRoot)) {
    // Same ticket-file filter the planning validator applies, so this stays a
    // re-derivation of the same claim set and not a strictly larger one.
    if (!/^docs\/tickets\/(?:D0|E0-[ABCD]|E\d+)\/[A-Z0-9-]+-.+\.md$/.test(asRepositoryRelative(absolutePath))) continue;
    const text = readFileSync(absolutePath, "utf8");
    const ownership = /^## Exact ownership\s*$([\s\S]*?)^## /m.exec(text);
    for (const line of ownership ? ownership[1].split("\n") : []) {
      const bullet = /^- (.+)$/.exec(line.trim());
      if (!bullet) continue;
      for (const entry of bullet[1].split(/\s[—–-]\s/)[0].split(";")) {
        const candidate = entry.trim().replace(/^`|`$/g, "");
        if (sourceExtensions.has(extname(candidate))) owned.add(candidate);
      }
    }
    const redTest = /^- Test file: `([^`]+)`\s*$/m.exec(text);
    if (redTest && sourceExtensions.has(extname(redTest[1]))) owned.add(redTest[1]);
  }
  // Control-plane paths are also ticket-owned; this view is only the skeleton portion.
  return [...owned]
    .filter((path) => /^(packages|adapters|suites|fixtures|conformance)\//.test(path))
    .filter((path) => existsSync(resolve(repositoryRoot, path)))
    .sort();
};
const assertRegularFile = (relativePath) => {
  const absolutePath = resolve(repositoryRoot, relativePath);
  assert.ok(existsSync(absolutePath), `${relativePath} is missing`);
  const fileInfo = lstatSync(absolutePath);
  assert.equal(fileInfo.isSymbolicLink(), false, `${relativePath} is a symbolic link`);
  assert.equal(fileInfo.isFile(), true, `${relativePath} is not a regular file`);
  return absolutePath;
};
const readRegularFile = (relativePath) => readFileSync(assertRegularFile(relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(readRegularFile(relativePath));

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
  const rootManifest = readJson("package.json");
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
    assert.equal(readRegularFile(path), ownerMarker, path);
  }
  const actualOwnerPaths = ["packages", "adapters", "suites", "fixtures", "conformance"]
    .flatMap((directory) => walkFiles(directory))
    .filter((absolutePath) => absolutePath.endsWith("/OWNERS.md"))
    .map(asRepositoryRelative)
    .sort();
  assert.deepEqual(actualOwnerPaths, [...ownerPaths].sort());
});

test("root-private-scripts-and-runnable-surface", () => {
  const rootManifestText = readRegularFile("package.json");
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
    const { scripts, ...identity } = manifest;
    assert.deepEqual(identity, { name, version: "0.0.0", private: true }, `${path} manifest`);
    // A workspace may declare exactly one focused lane and nothing else; it never gains
    // a build, publish, or lifecycle hook without a ticket that owns its manifest.
    if (scripts !== undefined) {
      assert.deepEqual(scripts, { test: workspaceTestScript }, `${path} scripts`);
    }
    for (const field of forbiddenManifestFields) {
      assert.equal(field in manifest, false, `${path} declares ${field}`);
    }
  }
  const actualSkeletonFiles = ["packages", "adapters", "suites", "fixtures", "conformance"]
    .flatMap((directory) => walkFiles(directory))
    .map(asRepositoryRelative)
    .sort();
  const operationalStateFiles = walkFiles(resolve(repositoryRoot, "fixtures/operational-state"))
    .map(asRepositoryRelative)
    .sort();
  const allowedSkeletonFiles = [
    ...expectedWorkspaces.map(([path]) => `${path}/package.json`),
    ...ownerPaths,
    ...operationalStateFiles,
    ...ticketOwnedSkeletonPaths()
  ].sort();
  assert.deepEqual(actualSkeletonFiles, allowedSkeletonFiles);
});

test("skeleton-source-requires-an-owning-ticket", () => {
  const owned = ticketOwnedSkeletonPaths();
  assert.ok(owned.includes("packages/schema/src/metric-registry.ts"), "E0A-001 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/test/metric-registry.test.ts"), "E0A-001 RED file is unclaimed");
  for (const path of owned) {
    assert.match(path, /^(packages|adapters|suites|fixtures|conformance)\//, `${path} is outside the skeleton`);
  }
  assert.ok(owned.includes("packages/schema/src/issuance-contract.ts"), "E0A-002 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/src/scoring-contract.ts"), "E0A-003 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/test/scoring-contract.test.ts"), "E0A-003 RED file is unclaimed");
  assert.ok(owned.includes("packages/schema/test/issuance-contract.test.ts"), "E0A-002 RED file is unclaimed");

  // Bind the derivation to the validator's census; if the two parses ever diverge,
  // or the gate is removed on either side, this fails.
  const census = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  const reported = /ticket_owned_code_paths=(\S+)/.exec(census);
  assert.ok(reported, "census does not report ticket_owned_code_paths");
  assert.deepEqual(reported[1] === "none" ? [] : reported[1].split(","), owned);
  assert.match(census, / product_code_files=0 /);
  assert.match(census, / product_code_paths=none /);

  // Selectivity, proven against a real unclaimed sibling rather than a path no
  // implementation could ever return. This runs in a temp copy: writing the intruder into
  // the live tree would race with the fixture tests that copy this repository.
  const parent = mkdtempSync(join(tmpdir(), "aos ticket claim census "));
  const fixture = join(parent, "repository");
  try {
    cpSync(repositoryRoot, fixture, {
      recursive: true,
      // Sibling tests write transient fixtures into the live tree while this copy runs;
      // capturing one would fail the fixture validator for an unrelated reason.
      filter: (source) => basename(source) !== "node_modules" && !basename(source).startsWith(".planning-")
    });
    writeFileSync(resolve(fixture, "packages/schema/src/unclaimed-by-any-ticket.ts"), "export {};\n");
    let failed;
    try {
      execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
        cwd: fixture,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (caught) {
      failed = caught;
    }
    assert.ok(failed, "the census accepted source that no ticket claims");
    assert.match(failed.stderr, /unallowlisted product code: packages\/schema\/src\/unclaimed-by-any-ticket\.ts/);

    // And the converse: claiming that same path in a ticket admits it.
    const ticket = resolve(fixture, "docs/tickets/E0-A/E0A-001-freeze-m01-m20-metric-registry.md");
    writeFileSync(
      ticket,
      readFileSync(ticket, "utf8").replace(
        "- specs/metrics.v0.json; packages/schema/src/metric-registry.ts —",
        "- specs/metrics.v0.json; packages/schema/src/metric-registry.ts; packages/schema/src/unclaimed-by-any-ticket.ts —"
      )
    );
    const admitted = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
      cwd: fixture,
      encoding: "utf8"
    });
    assert.match(admitted, /unclaimed-by-any-ticket\.ts/);
    assert.match(admitted, / product_code_files=0 /);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// A focused lane that matches no test name exits 0 with zero tests, so a mistyped or
// stale pattern could be quoted as a passing receipt. Pin the real case count here so a
// silently empty focused run fails the repository suite.
test("focused-lane-is-not-silently-empty", () => {
  // The child must not inherit this runner's test context, or it switches reporters and
  // emits no summary counts for us to check.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const run = (pattern) => execFileSync("npm", ["test", "-w", "@aos/schema", "--", pattern], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  for (const [pattern, cases] of [["metric-registry", 16], ["issuance-contract", 10], ["capability", 12], ["scoring-contract", 13]]) {
    const output = run(pattern);
    const passed = /^\S* ?pass (\d+)\s*$/m.exec(output);
    const failed = /^\S* ?fail (\d+)\s*$/m.exec(output);
    assert.ok(passed && failed, `focused lane ${pattern} reported no counts`);
    assert.equal(Number(failed[1]), 0, `focused lane ${pattern} has failures`);
    assert.equal(
      Number(passed[1]),
      cases,
      `focused lane ${pattern} ran ${passed[1]} tests and not exactly ${cases}`
    );
  }
  // The hazard itself, pinned so it cannot be mistaken for a passing receipt: a pattern
  // matching no test name still exits 0, running only the test files themselves.
  const empty = run("pattern-that-matches-no-test-name");
  const emptyPassed = /^\S* ?pass (\d+)\s*$/m.exec(empty);
  assert.ok(emptyPassed, "non-matching focused lane reported no counts");
  assert.ok(
    Number(emptyPassed[1]) < 13,
    `a non-matching pattern ran ${emptyPassed[1]} tests, so the count check above proves nothing`
  );
});

test("engine-matrix", () => {
  // Node 20 cannot execute TypeScript. Its test runner does not even discover a .ts test
  // file, so the schema package's cases were silently skipped there rather than failing.
  // Unflagged type stripping starts at 22.18.0, which is the floor ADR-0003 requires.
  assert.equal(readJson("package.json").engines.node, ">=22.18 <25");
  const ci = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /node: \[22, 24\]/);
  assert.equal(/node: \[[^\]]*\b20\b/.test(ci), false, "Node 20 cannot run the TypeScript lanes");
});

test("minimum-name-clearance", () => {
  const clearance = readRegularFile("docs/clearance/MINIMUM-NAME-CLEARANCE.md");
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
