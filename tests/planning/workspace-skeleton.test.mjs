import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  "ops:check": "node scripts/resolve-execution-state.mjs --offline && node scripts/render-execution-views.mjs --check",
  "ops:render": "node scripts/render-execution-views.mjs"
};
const expectedScriptsText = [
  "  \"scripts\": {",
  "    \"test\": \"node --test\",",
  "    \"build\": \"node scripts/validate-planning.mjs --build\",",
  "    \"docs:check\": \"node scripts/validate-planning.mjs\",",
  "    \"ops:status\": \"node scripts/resolve-execution-state.mjs\",",
  "    \"ops:check\": \"node scripts/resolve-execution-state.mjs --offline && node scripts/render-execution-views.mjs --check\",",
  "    \"ops:render\": \"node scripts/render-execution-views.mjs\"",
  "  }"
].join("\n");
const forbiddenManifestFields = [
  "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundledDependencies",
  "bin", "main", "module", "browser", "exports", "imports", "types", "typings", "files", "source"
];
const workspaceTestScript = "node --test --test-name-pattern";
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const asRepositoryRelative = (absolutePath) => relative(repositoryRoot, absolutePath).replaceAll("\\", "/");

// One ownership bullet, parsed into the source paths it declares. The grammar is
// `path — symbol; path — symbol`: the semicolon separates pairs, the em dash separates a path
// from its symbol. Only the head of each pair is a declaration, so the symbol side never
// becomes a path and prose written after a dash is never claimed.
export const ownershipBulletPaths = (bullet) => bullet
  .split(";")
  .map((pair) => pair.split(/\s[—–-]\s/)[0].trim().replace(/^`|`$/g, ""))
  .filter((candidate) => sourceExtensions.has(extname(candidate)));

// Independent re-derivation of the ticket-owned source claim the planning validator enforces.
// Only paths a ticket names exactly, and that exist on disk, are claimed. This is a claim check,
// not an acceptance check; ticket readiness stays the resolver's job.
//
// The comparison below reaches only materialized paths, because both sides drop declarations that
// have no file on disk. It therefore checks the two independent parsers where their claims can be
// observed; it does not claim to exercise every unmaterialized declaration branch.
const ticketOwnedPaths = () => {
  // The validator counts these separately from ticket-owned code. Keep an independent local copy:
  // importing validator parsing or its allowlist would make the comparison agree by construction.
  const controlPlanePaths = new Set([
    "scripts/validate-planning.mjs",
    "tests/planning-contract.test.mjs",
    "scripts/validate-gate-administration.mjs",
    "tests/gate-administration-contract.test.mjs",
    "scripts/validate-identity.mjs",
    "tests/planning/identity.test.mjs",
    "tests/planning/workspace-skeleton.test.mjs",
    "scripts/resolve-execution-state.mjs",
    "scripts/render-execution-views.mjs",
    "tests/execution-state.test.mjs",
    "tests/governance-mode-contract.test.mjs",
    "tests/gate-effective-state.test.mjs",
    "scripts/validate-artifact-manifest.mjs",
    "tests/artifact-manifest-v3.test.mjs",
    "scripts/derive-github-acceptance.mjs",
    "tests/github-acceptance-derivation.test.mjs",
    "tests/authenticated-review-activation.test.mjs"
  ]);
  const isMaterializedTicketOwnedSource = (path) => {
    const absolutePath = resolve(repositoryRoot, path);
    // The validator compares ticket declarations with paths emitted by its in-root regular-file walk.
    // Do not normalize a declaration into a different path or admit an ignored tree, symlink,
    // directory, or escape.
    const relation = relative(repositoryRoot, absolutePath);
    if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) return false;
    if (asRepositoryRelative(absolutePath) !== path) return false;
    const segments = path.split("/");
    if ([".git", "node_modules"].includes(segments[0])) return false;
    let cursor = repositoryRoot;
    for (let index = 0; index < segments.length; index += 1) {
      cursor = join(cursor, segments[index]);
      try {
        const entry = lstatSync(cursor);
        if (entry.isSymbolicLink()) return false;
        if (index < segments.length - 1 && !entry.isDirectory()) return false;
        if (index === segments.length - 1) return entry.isFile();
      } catch {
        return false;
      }
    }
    return false;
  };
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
      for (const candidate of ownershipBulletPaths(bullet[1])) owned.add(candidate);
    }
    // A final period is ordinary prose and must not remove the RED file from this census.
    const redTest = /^- Test file: `([^`]+)`\.?\s*$/m.exec(text);
    if (redTest && sourceExtensions.has(extname(redTest[1]))) owned.add(redTest[1]);
  }
  return [...owned]
    .filter((path) => !controlPlanePaths.has(path))
    .filter(isMaterializedTicketOwnedSource)
    .sort();
};

// Skeleton narrowing is a projection of the whole re-derivation, never the comparator's input.
const ticketOwnedSkeletonPaths = () => ticketOwnedPaths()
  .filter((path) => /^(packages|adapters|suites|fixtures|conformance)\//.test(path));

// `.` and `..` are refused as segments of the declaration text. Normalising first would
// turn `fixtures/./audit/**` into a real glob and would read `fixtures/../etc/*` as `etc/*`,
// a directory the declaration never names.
export const fixtureAdmissionSegment = (segment) => segment !== "" && segment !== "." && segment !== "..";

export const fixtureAdmissionGlob = (declaration) => {
  if (typeof declaration !== "string") return null;
  const segments = declaration.split("/");
  if (!segments.every((segment) => fixtureAdmissionSegment(segment))) return null;
  if (segments[0] !== "fixtures") return null;
  const predicate = { "**": "subtree", "*.json": "json" }[segments.at(-1)];
  if (!predicate) return null;
  const directory = segments.slice(0, -1).join("/");
  if (directory === "fixtures" || directory === "") return null;
  return { directory, predicate };
};

// A declaration heads its ownership item, after at most a leading "and" and before at most
// a closing sentence. A glob quoted later in the same item is a reference, which is why
// D0-011's mention of D0-004's grant admits nothing.
const fixtureDeclarationCandidate = (item) => {
  const head = item.trim().replace(/^and\s+/, "");
  if (!head.startsWith("`")) return head;
  const quoted = /^`([^`]+)`([\s\S]*)$/.exec(head);
  if (!quoted) return null;
  return quoted[2] === "" || quoted[2].startsWith(".") ? quoted[1] : null;
};

const ticketFixtureDeclarations = (text) => {
  const ownership = /^## Exact ownership\s*$([\s\S]*?)^## /m.exec(text);
  if (!ownership) return null;
  const declarations = [];
  for (const line of ownership[1].split("\n")) {
    const bullet = /^- (.+)$/.exec(line.trim());
    if (!bullet) continue;
    // Keep every side of both separators. Dropping the dash tail loses E0D-003's final glob.
    for (const item of bullet[1].split(/\s[—–-]\s|;/)) {
      const candidate = fixtureDeclarationCandidate(item);
      if (candidate !== null) declarations.push(candidate);
    }
  }
  return declarations;
};

const admittedFixtureFiles = (root, { directory, predicate }) => {
  const segments = directory.split("/");
  let cursor = root;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    let info;
    try {
      info = lstatSync(cursor);
    } catch {
      return [];
    }
    // lstat, not existsSync/realpath: those follow a prefix link before this guard runs.
    if (info.isSymbolicLink() || !info.isDirectory()) return [];
  }
  const admit = (current) => readdirSync(current).sort().flatMap((entry) => {
    const absolutePath = join(current, entry);
    let info;
    try {
      info = lstatSync(absolutePath);
    } catch {
      return [];
    }
    if (info.isSymbolicLink()) return [];
    if (info.isDirectory()) return predicate === "subtree" ? admit(absolutePath) : [];
    if (!info.isFile()) return [];
    if (predicate === "json" && extname(entry) !== ".json") return [];
    return [relative(root, absolutePath).replaceAll("\\", "/")];
  });
  return admit(cursor);
};

export const ticketDeclaredFixtureDirectories = ({ root, catalogTicketPaths, readTicket }) => {
  const admitted = new Set();
  const malformed = [];
  for (const path of catalogTicketPaths) {
    let text;
    try {
      text = readTicket(path);
    } catch {
      text = null;
    }
    if (typeof text !== "string") {
      malformed.push({ path, reason: "unreadable" });
      continue;
    }
    const declarations = ticketFixtureDeclarations(text);
    if (declarations === null) {
      malformed.push({ path, reason: "ownership-section-missing" });
      continue;
    }
    for (const declaration of declarations) {
      const glob = fixtureAdmissionGlob(declaration);
      if (!glob) continue;
      for (const file of admittedFixtureFiles(root, glob)) admitted.add(file);
    }
  }
  return { admitted: [...admitted].sort(), malformed };
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

// Fixture copies rewrite a now-gated ticket; accepted batches fail on that digest
// before the census assertions run. Local copy of the planning-contract helper —
// a shared module would be a new control-plane path.
const setPendingGateRegistry = (fixture) => {
  const registryPath = join(fixture, "docs/decisions/maintainer-gate-registry.v2.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.status = "PENDING";
  for (const batch of registry.batches) {
    batch.status = "PENDING";
    delete batch.target.reviewed_head;
    batch.required_artifacts = batch.required_artifacts.map((artifact) => ({
      ...artifact,
      sha256: createHash("sha256").update(readFileSync(join(fixture, artifact.path))).digest("hex")
    }));
    batch.artifacts = [];
    batch.transitions = [];
    batch.events = [];
    delete batch.preparation;
    delete batch.approval;
    delete batch.invalidation;
  }
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
};

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
  const fixtureCensus = ticketDeclaredFixtureDirectories({
    root: repositoryRoot,
    catalogTicketPaths: readJson("docs/issues.json").tickets.map(({ ticket_path: path }) => path),
    readTicket: (path) => readFileSync(resolve(repositoryRoot, path), "utf8")
  });
  assert.deepEqual(fixtureCensus.malformed, [], "live catalog produced a malformed ticket");
  const allowedSkeletonFiles = [
    ...expectedWorkspaces.map(([path]) => `${path}/package.json`),
    ...ownerPaths,
    ...fixtureCensus.admitted,
    ...ticketOwnedSkeletonPaths(),
    // Exact ownership names this JSON pack file; it is not a source-extension census path.
    "suites/coding-core-v0/form-a/manifest.json"
  ].sort();
  assert.deepEqual(actualSkeletonFiles, allowedSkeletonFiles);
});

// The ownership grammar is `path — symbol; path — symbol`. Splitting the em dash before the
// semicolon kept only the head pair, so every path declared after the first symbol was discarded
// before the semicolon split ever ran and the file failed closed as unallowlisted product code
// once an implementation materialized it.
test("ownership-bullet-claims-every-declared-pair", () => {
  // E0C-002, the first ticket to reach implementation and hit this.
  assert.deepEqual(
    ownershipBulletPaths(
      "packages/scorer/src/simulation/pack-budget.ts — simulatePackBudget; "
      + "packages/scorer/src/simulation/opportunity-audit.ts — auditOpportunities"
    ),
    [
      "packages/scorer/src/simulation/pack-budget.ts",
      "packages/scorer/src/simulation/opportunity-audit.ts"
    ]
  );
  // Three pairs behind a leading non-source declaration, as E3-004 writes it.
  assert.deepEqual(
    ownershipBulletPaths(
      "specs/metrics.v0.json; packages/runner/src/lifecycle.ts — RunStateMachine; "
      + "packages/runner/src/watchdog.ts — Watchdog; packages/runner/src/reconcile.ts — reconcileProcesses"
    ),
    [
      "packages/runner/src/lifecycle.ts",
      "packages/runner/src/watchdog.ts",
      "packages/runner/src/reconcile.ts"
    ]
  );
  // The single-pair case is what the repository already relied on; it must not move.
  assert.deepEqual(
    ownershipBulletPaths("specs/metrics.v0.json; packages/schema/src/metric-registry.ts — MetricDefinition,validateMetricRegistry"),
    ["packages/schema/src/metric-registry.ts"]
  );
  // Admission must not widen past the grammar: the symbol side is not a declaration, even when
  // it is spelled exactly like a path.
  assert.deepEqual(
    ownershipBulletPaths("packages/schema/src/result.ts — packages/schema/src/never-declared.ts"),
    ["packages/schema/src/result.ts"]
  );
  // Nor is prose that follows a dash and happens to end in a source extension.
  assert.deepEqual(
    ownershipBulletPaths("packages/scorer/src/safety.ts — classifySafety, superseding packages/scorer/src/legacy-safety.ts"),
    ["packages/scorer/src/safety.ts"]
  );
  // Backticked declarations, and the en dash and hyphen spellings the separator also accepts.
  assert.deepEqual(
    ownershipBulletPaths("`adapters/codex/src/index.ts` – CodexAdapter; `adapters/codex/src/wrapper.ts` - runCodexControlled"),
    ["adapters/codex/src/index.ts", "adapters/codex/src/wrapper.ts"]
  );
  // A bullet that declares nothing with a source extension still claims nothing.
  assert.deepEqual(
    ownershipBulletPaths("No other file or symbol may be edited without a replacement ticket and renewed gate."),
    []
  );
});

test("skeleton-source-requires-an-owning-ticket", () => {
  const owned = ticketOwnedSkeletonPaths();
  const wholeOwned = ticketOwnedPaths();
  assert.ok(owned.includes("packages/schema/src/metric-registry.ts"), "E0A-001 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/test/metric-registry.test.ts"), "E0A-001 RED file is unclaimed");
  for (const path of owned) {
    assert.match(path, /^(packages|adapters|suites|fixtures|conformance)\//, `${path} is outside the skeleton`);
  }
  assert.ok(owned.includes("packages/schema/src/issuance-contract.ts"), "E0A-002 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/src/scoring-contract.ts"), "E0A-003 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/test/scoring-contract.test.ts"), "E0A-003 RED file is unclaimed");
  assert.ok(owned.includes("packages/schema/test/issuance-contract.test.ts"), "E0A-002 RED file is unclaimed");
  assert.ok(owned.includes("packages/schema/src/session-class.ts"), "E0B-002 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/src/doctor-contract.ts"), "E0B-003 owned source is unclaimed");
  assert.ok(owned.includes("packages/schema/test/doctor-contract.test.ts"), "E0B-003 RED file is unclaimed");
  assert.ok(owned.includes("packages/schema/test/session-class.test.ts"), "E0B-002 RED file is unclaimed");

  // Bind the derivation to the validator's census; if the two parses ever diverge,
  // or the gate is removed on either side, this fails.
  const census = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  const reported = /ticket_owned_code_paths=(\S+)/.exec(census);
  assert.ok(reported, "census does not report ticket_owned_code_paths");
  const reportedPaths = reported[1] === "none" ? [] : reported[1].split(",");
  const reportedCount = / ticket_owned_code_files=(\d+) /.exec(census);
  assert.ok(reportedCount, "census does not report ticket_owned_code_files");
  assert.equal(Number(reportedCount[1]), reportedPaths.length, "census count does not match its reported paths");
  // The validator reports its whole materialized non-control-plane census. Comparing it with a
  // skeleton projection would discard precisely the outside-skeleton path this guard must see.
  assert.deepEqual(
    reportedPaths,
    wholeOwned,
    "catalog-declared outside-skeleton source leaves the validator census unequal to the skeleton-only re-derivation."
  );
  assert.match(census, / product_code_files=0 /);
  assert.match(census, / product_code_paths=none /);

  const fixtureMarker = "AOS_D0012_CENSUS_FIXTURE_ROOT";
  const fixturePrefix = "aos-d0012-census-";
  const outsideSkeletonPath = "tests/planning/catalog-declared-outside-skeleton.mjs";
  const clip = (value) => {
    const text = String(value ?? "");
    return text.length <= 4096 ? text : `${text.slice(0, 4096)}…`;
  };
  const fixtureParentIsOwned = (candidate) => {
    const lexical = resolve(candidate);
    let entry;
    try {
      entry = lstatSync(lexical);
    } catch {
      return false;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) return false;

    let canonical;
    let canonicalTempRoot;
    try {
      canonical = realpathSync(lexical);
      canonicalTempRoot = realpathSync(resolve(tmpdir()));
    } catch {
      return false;
    }
    const relation = relative(canonicalTempRoot, canonical);
    return relation !== ""
      && relation !== ".."
      && !relation.startsWith(`..${sep}`)
      && !isAbsolute(relation)
      && basename(canonical).startsWith(fixturePrefix);
  };
  const cleanupFixtureParent = (candidate) => {
    try {
      if (!fixtureParentIsOwned(candidate)) {
        process.emitWarning("D0-012 census fixture cleanup skipped because its parent could not be verified");
        return;
      }
      // Remove the already-verified lexical parent. A new realpath lookup here could resolve a
      // path swapped after verification; rmSync unlinks a substituted symlink rather than walking it.
      rmSync(candidate, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch (error) {
      process.emitWarning(`D0-012 census fixture cleanup failed: ${clip(error?.message)}`);
    }
  };
  const markerRoot = process.env[fixtureMarker];
  let fixtureMode = false;
  if (markerRoot !== undefined) {
    const canonicalRoot = realpathSync(repositoryRoot);
    assert.equal(markerRoot, canonicalRoot, "fixture marker does not name this copied repository root");
    assert.equal(basename(canonicalRoot), "repository", "fixture marker cannot suppress setup outside a copied repository");
    assert.ok(fixtureParentIsOwned(dirname(canonicalRoot)), "fixture marker parent is not a verified temporary root");
    fixtureMode = true;
  }
  if (fixtureMode) {
    assert.ok(wholeOwned.includes(outsideSkeletonPath), "fixture whole census omits the outside-skeleton source");
    assert.equal(owned.includes(outsideSkeletonPath), false, "fixture skeleton projection includes the outside-skeleton source");
  }
  if (!fixtureMode) {
    const parent = mkdtempSync(join(tmpdir(), fixturePrefix));
    const fixture = join(parent, "repository");
    const selectivityProbeSource = resolve(repositoryRoot, "packages/schema/src/unclaimed-by-any-ticket.ts");
    try {
      assert.ok(fixtureParentIsOwned(parent), `fixture parent is not a verified temporary root: ${parent}`);
      cpSync(repositoryRoot, fixture, {
        recursive: true,
        // Sibling tests can create transient planning fixtures while this test copies the tree.
        filter: (source) => {
          const entry = basename(source);
          return resolve(source) !== selectivityProbeSource
            && entry !== "node_modules"
            && entry !== ".git"
            && !entry.startsWith(".planning-");
        }
      });
      const ticket = resolve(fixture, "docs/tickets/E0-A/E0A-001-freeze-m01-m20-metric-registry.md");
      const ownershipAnchor = "- specs/metrics.v0.json; packages/schema/src/metric-registry.ts —";
      const originalTicket = readFileSync(ticket, "utf8");
      assert.equal(originalTicket.split(ownershipAnchor).length, 2, "fixture ownership anchor is not unique");
      writeFileSync(
        ticket,
        originalTicket.replace(
          ownershipAnchor,
          // Declared as the second `path — symbol` pair, not before the first dash: this is the
          // shape the old split order discarded, so the validator's own parser is under test here.
          () => "- specs/metrics.v0.json; packages/schema/src/metric-registry.ts — MetricDefinition; tests/planning/catalog-declared-outside-skeleton.mjs —"
        )
      );
      writeFileSync(resolve(fixture, outsideSkeletonPath), "export {};\n");
      setPendingGateRegistry(fixture);

      const fixtureCensus = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
        cwd: fixture,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      const fixtureReported = /ticket_owned_code_paths=(\S+)/.exec(fixtureCensus);
      assert.ok(fixtureReported, "fixture census does not report ticket_owned_code_paths");
      const fixturePaths = fixtureReported[1] === "none" ? [] : fixtureReported[1].split(",");
      const fixtureCount = / ticket_owned_code_files=(\d+) /.exec(fixtureCensus);
      assert.ok(fixtureCount, "fixture census does not report ticket_owned_code_files");
      assert.deepEqual(fixturePaths, [...reportedPaths, outsideSkeletonPath].sort());
      assert.equal(fixturePaths.length, reportedPaths.length + 1, "fixture census did not add exactly one path");
      assert.equal(Number(fixtureCount[1]), fixturePaths.length, "fixture census count does not match its reported paths");

      const childEnv = { ...process.env };
      delete childEnv[fixtureMarker];
      delete childEnv.NODE_TEST_CONTEXT;
      delete childEnv.NODE_OPTIONS;
      childEnv[fixtureMarker] = realpathSync(fixture);
      let child;
      try {
        child = execFileSync(process.execPath, [
          "--test",
          "--test-reporter=tap",
          "--test-name-pattern", "^skeleton-source-requires-an-owning-ticket$",
          "tests/planning/workspace-skeleton.test.mjs"
        ], {
          cwd: fixture,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: childEnv
        });
      } catch (error) {
        assert.fail(`fixture focused child failed: ${clip(`${error?.stdout ?? ""}${error?.stderr ?? ""}`)}`);
      }
      assert.match(child, /ok 1 - skeleton-source-requires-an-owning-ticket/);
      assert.match(child, /# tests 1/);
      assert.match(child, /# pass 1/);
      assert.match(child, /# fail 0/);
    } finally {
      cleanupFixtureParent(parent);
    }
  }

  // The copied child above must run the same parser and comparator, but never recursively create
  // either temporary fixture. The parent still executes this independent selectivity probe.
  if (!fixtureMode) {
    // Selectivity, proven against a real unclaimed sibling rather than a path no
    // implementation could ever return. This runs in a temp copy: writing the intruder into
    // the live tree would race with the fixture tests that copy this repository.
    const parent = mkdtempSync(join(tmpdir(), `${fixturePrefix}selectivity-`));
    const fixture = join(parent, "repository");
    try {
      cpSync(repositoryRoot, fixture, {
        recursive: true,
        // Sibling tests write transient fixtures into the live tree while this copy runs;
        // capturing one would fail the fixture validator for an unrelated reason.
        filter: (source) => ![".git", "node_modules"].includes(basename(source)) && !basename(source).startsWith(".planning-")
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
      const ownershipAnchor = "- specs/metrics.v0.json; packages/schema/src/metric-registry.ts —";
      const originalTicket = readFileSync(ticket, "utf8");
      assert.equal(originalTicket.split(ownershipAnchor).length, 2, "selectivity ownership anchor is not unique");
      writeFileSync(
        ticket,
        originalTicket.replace(
          ownershipAnchor,
          () => "- specs/metrics.v0.json; packages/schema/src/metric-registry.ts; packages/schema/src/unclaimed-by-any-ticket.ts —"
        )
      );
      setPendingGateRegistry(fixture);
      const admitted = execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
        cwd: fixture,
        encoding: "utf8"
      });
      assert.match(admitted, /unclaimed-by-any-ticket\.ts/);
      assert.match(admitted, / product_code_files=0 /);

      // And the boundary of that admission: only the head of a pair declares a path. The same
      // intruder written on the symbol side of a pair must stay unclaimed, or reading every pair
      // would have widened admission past the grammar rather than restoring it.
      writeFileSync(
        ticket,
        originalTicket.replace(
          ownershipAnchor,
          () => "- specs/metrics.v0.json; packages/schema/src/metric-registry.ts — packages/schema/src/unclaimed-by-any-ticket.ts —"
        )
      );
      setPendingGateRegistry(fixture);
      let symbolPositionRefused;
      try {
        execFileSync(process.execPath, ["scripts/validate-planning.mjs"], {
          cwd: fixture,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (caught) {
        symbolPositionRefused = caught;
      }
      assert.ok(symbolPositionRefused, "the census accepted a path named only on the symbol side of a pair");
      assert.match(
        symbolPositionRefused.stderr,
        /unallowlisted product code: packages\/schema\/src\/unclaimed-by-any-ticket\.ts/
      );
    } finally {
      cleanupFixtureParent(parent);
    }
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
  // Exact, not a floor: a lane that loses a case must fail here. Every count includes the
  // per-file results the runner emits, so adding a test file shifts all of them at once.
  const lanes = [
    ["metric-registry", 23], ["issuance-contract", 17], ["capability", 19], ["scoring-contract", 20], ["session-class", 28], ["doctor-contract", 41], ["prescription-input", 15], ["trace-schema", 19], ["result-schema", 19], ["treatment-registry", 15]
  ];
  for (const [pattern, cases] of lanes) {
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
  const smallestLane = Math.min(...lanes.map(([, cases]) => cases));
  assert.ok(
    Number(emptyPassed[1]) < smallestLane,
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
      engines: { node: ">=22.18 <25" }
    }
  };
  for (const [path, name] of expectedWorkspaces) {
    expectedPackages[path] = { name, version: "0.0.0" };
    expectedPackages[`node_modules/${name}`] = { resolved: path, link: true };
  }
  assert.deepEqual(lock.packages, expectedPackages);
});

test("doctor-fixture-admission-honours-the-declared-file-predicate", () => {
  // The declaration is `fixtures/doctor/*.json`. The filter that actually admits those
  // files lives on doctorFixtureFiles inside root-private-scripts-and-runnable-surface.
  // A second walk that re-applies the same literal cannot fail when that filter is deleted
  // or widened, and removing the probe in finally hid it from the comparison. Stage the
  // non-matching file in an isolated copy and assert the real census rejects it.
  const parent = mkdtempSync(join(tmpdir(), "aos-doctor-admission-"));
  const fixture = join(parent, "repository");
  const probeRelative = "fixtures/doctor/not-declared-by-the-glob.txt";
  try {
    cpSync(repositoryRoot, fixture, {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules" && !basename(source).startsWith(".planning-")
    });
    writeFileSync(join(fixture, probeRelative), "probe\n");

    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    let failed;
    try {
      execFileSync(process.execPath, [
        "--test",
        "--test-reporter=tap",
        "--test-name-pattern", "^root-private-scripts-and-runnable-surface$",
        "tests/planning/workspace-skeleton.test.mjs"
      ], {
        cwd: fixture,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env
      });
    } catch (caught) {
      failed = caught;
    }
    assert.ok(failed, "skeleton comparison admitted a file the declared glob excludes");
    assert.match(
      `${failed.stdout ?? ""}${failed.stderr ?? ""}`,
      /fixtures\/doctor\/not-declared-by-the-glob\.txt/,
      "skeleton comparison did not name the unexplained non-JSON probe"
    );
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
