import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateGateAdministration } from "../scripts/validate-gate-administration.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const canonicalRegistry = "docs/decisions/maintainer-gate-registry.v2.json";
const fixtureTempPrefix = "aos gate administration";

const stripCensusMarkup = (value) => value
  .replace(/<!--[\s\S]*?-->/g, () => "")
  .replace(/<(?:(?:"[^"]*")|(?:'[^']*')|[^'"<>])*>/g, () => "");

const decodeCensusEntities = (value) => stripCensusMarkup(value)
  .replace(/&amp;/gi, () => "&")
  .replace(/&#(\d+);/g, (reference, decimal) => {
    const codePoint = Number(decimal);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : reference;
  });

const normalizeCensusText = (value) => decodeCensusEntities(value)
  .replace(/\\/g, () => "")
  .normalize("NFKC")
  .replace(/[\p{Cf}\u00ad]/gu, () => "")
  .replace(/[\p{Dash}_*`]/gu, () => "-")
  .replace(/-+/g, () => "-")
  .toLowerCase()
  .replace(/\s+/g, () => "");

const collectTicketSlugs = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const entryPath = join(directory, entry.name);
  if (entry.isDirectory()) return collectTicketSlugs(entryPath);
  return entry.isFile() && entry.name.endsWith(".md")
    ? [entry.name.slice(0, -".md".length).toLowerCase()]
    : [];
});

const normalizeStatusCell = (value) => decodeCensusEntities(value)
  .normalize("NFKC")
  .replace(/[\p{Cf}\u00ad]/gu, () => "")
  .replace(/[*_`]/g, () => "")
  .replace(/\p{Dash}/gu, () => " ")
  .replace(/\s+/g, () => " ")
  .trim()
  .toUpperCase();

/**
 * Bounded cleanup for exact temporary gate fixtures only (Node 22 ENOTEMPTY on .git).
 *
 * Containment is decided on the CANONICAL path, not the lexical one. `resolve()` and
 * `relative()` only normalise `.`/`..` text; they never read the filesystem, so a symlink
 * anywhere along the path — including the target itself — satisfies both checks while the
 * bytes on disk live somewhere else entirely. A directory under tmpdir() named with the
 * fixture prefix but symlinked to $HOME passes a lexical guard and would hand a recursive
 * delete to $HOME. realpath resolves every component, so the comparison is made against
 * what would actually be removed.
 *
 * The temp root is itself canonicalised before comparison: on macOS /var is a symlink to
 * /private/var, so a lexical tmpdir() and a realpath'd target never share a prefix and the
 * guard would reject every legitimate fixture.
 *
 * Node 22's rmSync({ maxRetries }) retries only rmdir after a single child walk
 * (lib/internal/fs/rimraf.js _rmdirSync). A writer that recreates entries under .git
 * therefore keeps throwing ENOTEMPTY from the same rmdir. Re-enter rmSync so each
 * attempt walks children again.
 *
 * A verified-path removal that still fails after that budget is emitted as a warning.
 * Throwing from finally would fail a case whose assertions already passed, which is
 * how this flake withheld a gate receipt. A path-safety refusal still throws.
 */
const cleanupRetryBudget = { attempts: 8, delayMs: 50 };
const transientCleanupCodes = new Set(["ENOTEMPTY", "EBUSY", "EEXIST", "EPERM", "EMFILE", "ENFILE", "EAGAIN"]);

const sleepSync = (ms) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const resolveRemovableTempFixture = (targetPath) => {
  const lexical = resolve(targetPath);

  // The final component must itself be a real directory, never a link. Canonical
  // containment alone is not enough: a symlink pointing at a legitimate in-temp fixture
  // resolves to a path that passes every containment check, and deleting through it
  // destroys the real fixture while the caller believes it removed only its own alias.
  // lstat does not follow the last component, so this is the one check that can see it.
  let entry;
  try {
    entry = lstatSync(lexical);
  } catch {
    throw new Error(`refusing to remove unresolvable fixture path: ${lexical}`);
  }
  if (entry.isSymbolicLink()) {
    throw new Error(`refusing to remove symlinked fixture path: ${lexical}`);
  }
  if (!entry.isDirectory()) {
    throw new Error(`refusing to remove non-directory fixture path: ${lexical}`);
  }

  // Containment is decided on the CANONICAL path, not the lexical one. resolve() and
  // relative() only normalise `.`/`..` as text and never read the filesystem, so an
  // intermediate symlink satisfies both name checks while the bytes live elsewhere.
  let canonical;
  try {
    canonical = realpathSync(lexical);
  } catch {
    throw new Error(`refusing to remove unresolvable fixture path: ${lexical}`);
  }

  // The temp root is canonicalised too: on macOS /var is a symlink to /private/var, so a
  // lexical tmpdir() and a realpath'd target share no prefix and every legitimate fixture
  // would be rejected.
  const tempRoot = realpathSync(resolve(tmpdir()));
  const relToTemp = relative(tempRoot, canonical);
  if (relToTemp === "" || relToTemp.startsWith("..") || isAbsolute(relToTemp)) {
    throw new Error(`refusing to remove non-temp fixture path: ${canonical}`);
  }
  if (!basename(canonical).startsWith(fixtureTempPrefix)) {
    throw new Error(`refusing to remove unexpected fixture path: ${canonical}`);
  }
  return canonical;
};

const removeVerifiedTempFixture = (canonical) => {
  let lastError;
  for (let attempt = 1; attempt <= cleanupRetryBudget.attempts; attempt += 1) {
    try {
      rmSync(canonical, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code === "ENOENT") return;
      lastError = error;
      if (!transientCleanupCodes.has(error?.code) || attempt === cleanupRetryBudget.attempts) {
        throw error;
      }
      sleepSync(attempt * cleanupRetryBudget.delayMs);
    }
  }
  throw lastError;
};

const removeTempFixture = (targetPath) => {
  const canonical = resolveRemovableTempFixture(targetPath);
  try {
    removeVerifiedTempFixture(canonical);
  } catch (error) {
    process.emitWarning(
      `gate-administration fixture cleanup failed after bounded retries: ${canonical}: ${error?.code ?? "ERR"} ${error?.message ?? error}`
    );
  }
};

// removeTempFixture performs a recursive delete, so its two refusal branches are the only
// thing standing between a mistaken or manipulated path and an arbitrary directory being
// removed. Both are asserted here; without these the guards could be deleted or inverted
// and every other test in this file would still pass.
test("removeTempFixture refuses a path outside the OS temp root", () => {
  for (const outside of [resolve(root), resolve(root, "docs"), resolve(tmpdir(), "..")]) {
    assert.throws(
      () => removeTempFixture(outside),
      /refusing to remove non-temp fixture path/,
      `expected refusal for ${outside}`
    );
    assert.ok(existsSync(outside), `${outside} must still exist after the refusal`);
  }
});

test("removeTempFixture refuses the temp root itself", () => {
  assert.throws(() => removeTempFixture(tmpdir()), /refusing to remove non-temp fixture path/);
  assert.ok(existsSync(tmpdir()));
});

test("removeTempFixture refuses a temp path whose basename lacks the fixture prefix", () => {
  const stranger = mkdtempSync(join(tmpdir(), "unrelated-not-a-gate-fixture"));
  try {
    assert.throws(
      () => removeTempFixture(stranger),
      /refusing to remove unexpected fixture path/
    );
    assert.ok(existsSync(stranger), "a non-fixture temp directory must survive the refusal");
  } finally {
    rmSync(stranger, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("removeTempFixture removes a correctly prefixed temp fixture", () => {
  const fixture = mkdtempSync(join(tmpdir(), fixtureTempPrefix));
  writeFileSync(join(fixture, "payload.txt"), "x");
  removeTempFixture(fixture);
  assert.equal(existsSync(fixture), false);
});

// A lexical guard is not a containment boundary. resolve()/relative() never touch the
// filesystem, so a symlink that sits under tmpdir() and carries the fixture prefix passes
// both name checks while pointing anywhere on disk. These assert the victim outside the
// temp root still exists afterwards — the only thing that actually proves the recursive
// delete did not follow the link.
test("removeTempFixture refuses a prefixed temp symlink whose target escapes the temp root", () => {
  const box = mkdtempSync(join(tmpdir(), "aos-symlink-escape-box"));
  const outsideVictim = mkdtempSync(join(root, ".aos-escape-victim-"));
  const payload = join(outsideVictim, "payload.txt");
  const link = join(box, `${fixtureTempPrefix}-escape`);
  try {
    writeFileSync(payload, "must survive");
    symlinkSync(outsideVictim, link);
    assert.throws(() => removeTempFixture(link), /refusing to remove symlinked fixture path/);
    // Assert the victim ITSELF and its payload, not some ancestor that would survive
    // regardless. An ancestor-only assertion passes even when the leaf is destroyed.
    assert.ok(existsSync(outsideVictim), "the victim directory itself must survive");
    assert.ok(existsSync(payload), "the victim payload must survive");
    assert.equal(readFileSync(payload, "utf8"), "must survive");
  } finally {
    rmSync(box, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(outsideVictim, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("removeTempFixture refuses a symlink that aliases a legitimate in-temp fixture", () => {
  // Canonical containment alone accepts this: the link resolves to a real prefixed fixture
  // inside tmpdir(). Deleting through it destroys the real fixture while the caller
  // believes it removed only its own alias. Only the lstat check can see the difference.
  const realFixture = mkdtempSync(join(tmpdir(), fixtureTempPrefix));
  const payload = join(realFixture, "payload.txt");
  const box = mkdtempSync(join(tmpdir(), "aos-alias-box"));
  const alias = join(box, `${fixtureTempPrefix}-alias`);
  try {
    writeFileSync(payload, "must survive");
    symlinkSync(realFixture, alias);
    assert.throws(() => removeTempFixture(alias), /refusing to remove symlinked fixture path/);
    assert.ok(existsSync(realFixture), "the aliased fixture itself must survive");
    assert.ok(existsSync(payload), "its payload must survive");
  } finally {
    rmSync(box, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(realFixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("removeTempFixture refuses when an INTERMEDIATE component symlinks out of the temp root", () => {
  const box = mkdtempSync(join(tmpdir(), "aos-symlink-mid-box"));
  const outsideDir = mkdtempSync(join(root, ".aos-mid-victim-"));
  const midLink = join(box, "mid");
  try {
    // box/mid -> <outside>, so box/mid/<prefixed> is lexically inside tmpdir() and carries
    // the prefix, while canonically it lives outside.
    symlinkSync(outsideDir, midLink);
    const leafName = `${fixtureTempPrefix}-nested`;
    const viaMid = join(midLink, leafName);
    const realLeaf = join(outsideDir, leafName);
    const payload = join(realLeaf, "payload.txt");
    mkdirSync(realLeaf, { recursive: true });
    writeFileSync(payload, "must survive");

    assert.throws(() => removeTempFixture(viaMid), /refusing to remove non-temp fixture path/);
    // Assert the LEAF and its payload, not the parent. A parent-only assertion passes even
    // when the leaf is deleted, which is exactly what it is meant to detect.
    assert.ok(existsSync(realLeaf), "the leaf directory itself must survive");
    assert.ok(existsSync(payload), "the leaf payload must survive");
    assert.equal(readFileSync(payload, "utf8"), "must survive");
  } finally {
    rmSync(box, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(outsideDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("removeTempFixture refuses a non-directory target", () => {
  const box = mkdtempSync(join(tmpdir(), "aos-file-target-box"));
  const file = join(box, `${fixtureTempPrefix}-file`);
  try {
    writeFileSync(file, "not a directory");
    assert.throws(() => removeTempFixture(file), /refusing to remove non-directory fixture path/);
    assert.ok(existsSync(file));
  } finally {
    rmSync(box, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("removeTempFixture refuses a path that cannot be canonicalised", () => {
  const missing = join(tmpdir(), `${fixtureTempPrefix}-does-not-exist-${process.pid}`);
  assert.throws(() => removeTempFixture(missing), /refusing to remove unresolvable fixture path/);
});

test("ADR-0003 limits npm workspaces to the SSOT six", () => {
  const adr = readFileSync(resolve(root, "docs/adr/ADR-0003-runtime-repository-and-distribution.md"), "utf8");
  const workspaceDecision = adr.split("\n").find((line) => line.startsWith("- Use npm workspaces"));

  assert.equal(
    workspaceDecision,
    "- Use npm workspaces for exactly the six internal workspaces at `packages/{schema,scorer,runner,reporter}` and `adapters/{codex,claude-code}`. `suites/`, `fixtures/`, and `conformance/` are repository surfaces, not npm workspaces. Every internal `@aos/*` workspace is `private: true`."
  );
});

test("pre-implementation Gate Administrator is independent of D0-004 and D0-002", () => {
  const decision = resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md");
  assert.equal(existsSync(decision), true);
  const decisionText = readFileSync(decision, "utf8");
  const gateValidator = readFileSync(resolve(root, "scripts/validate-gate-administration.mjs"), "utf8");
  assert.match(decisionText, /- Dependencies: None/);
  assert.match(decisionText, /\*\*CEO\*\* separately provides explicit production PASS at the final exact candidate head/);
  assert.match(decisionText, /reads only `docs\/decisions\/maintainer-gate-registry\.v2\.json`/);
  assert.match(decisionText, /external gate evidence/);
  assert.match(decisionText, /never proof of independent authorization/);
  assert.doesNotMatch(gateValidator, /D0-004|D0-002/);
});

test("current registry census is byte-exact and exclusive", () => {
  const decision = readFileSync(resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md"), "utf8");
  const registry = JSON.parse(readFileSync(resolve(root, canonicalRegistry), "utf8"));
  const generatedCensus = [
    "| Batch | Registry status |",
    "| --- | --- |",
    ...registry.batches.map(({ id, status }) => `| \`${id}\` | ${status} |`),
    ""
  ].join("\n");

  // Measured from the corrected document: U+2192 RIGHTWARDS ARROW occurs once.
  const allowedNonAscii = new Set(["→"]);
  const unsupportedCharacters = [...decision].filter((character) =>
    character.codePointAt(0) > 127 && !allowedNonAscii.has(character)
  );
  assert.equal(
    unsupportedCharacters.length,
    0,
    `unexpected non-ASCII code points: ${unsupportedCharacters.map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase()}`).join(", ")}`
  );

  const censusParts = decision.split(generatedCensus);
  assert.equal(
    censusParts.length,
    2,
    "the control plane must contain the generated registry census block exactly once, including its terminal newline"
  );

  const outsideCensus = normalizeCensusText(censusParts.join("\n"));
  const ticketSlugs = new Set(collectTicketSlugs(resolve(root, "docs", "tickets")));
  const registryIdsOutsideCensus = registry.batches
    .map(({ id }) => id)
    .filter((id) => outsideCensus.includes(id));
  const idShapedOutsideCensus = [...outsideCensus.matchAll(/d0-\d+-(?:[a-z0-9]+(?:-[a-z0-9]+)*)/gi)]
    .map(([match]) => match);
  const unapprovedIdShapes = idShapedOutsideCensus.filter((id) => !ticketSlugs.has(id.toLowerCase()));
  assert.equal(normalizeCensusText("d0-011\\-prerequisites"), "d0-011-prerequisites");
  assert.equal(normalizeCensusText("d0-011&#45;prerequisites"), "d0-011-prerequisites");
  assert.equal(
    registryIdsOutsideCensus.length === 0 && unapprovedIdShapes.length === 0,
    true,
    `registry IDs outside census: ${registryIdsOutsideCensus.join(", ")}; unapproved ID-shaped text: ${unapprovedIdShapes.join(", ")}`
  );

  const censusStatuses = ["PENDING", "PARTIAL", "ACCEPTED", "REJECTED", "INVALIDATED"];
  const containsCensusStatus = (cell) => {
    const normalizedCell = normalizeStatusCell(cell);
    return censusStatuses.some((status) => new RegExp(`(?:^|[^A-Z])${status}(?:$|[^A-Z])`).test(normalizedCell));
  };
  const outsideCensusText = censusParts.join("\n");
  const pipeCells = outsideCensusText
    .split(/\r?\n/)
    .filter((line) => line.includes("|"))
    .flatMap((line) => line.trim().replace(/^\|/, () => "").replace(/\|$/, () => "").split("|"));
  const htmlCells = [...outsideCensusText.matchAll(/<td\b(?:(?:"[^"]*")|(?:'[^']*')|[^'"<>])*>([\s\S]*?)<\/td\s*>/gi)]
    .map(([, cell]) => cell);
  const statusHeaders = outsideCensusText
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s+Status\s*:/i.test(line));
  const outsideStatusCells = [...pipeCells, ...htmlCells, ...statusHeaders].filter(containsCensusStatus);
  // Status cells are scanned instead of pinning a fixed header; the obsolete Status line is
  // removed, so a reintroduced header fails within this same non-duplicative assertion.
  assert.equal(
    outsideStatusCells.length === 0 && statusHeaders.length === 0,
    true,
    `census-status cells outside census: ${outsideStatusCells.join(" | ")}; Status headers: ${statusHeaders.join(" | ")}`
  );
});

test("programmatic root or registry options fail closed", () => {
  const result = validateGateAdministration({ root: process.cwd() });
  assert.equal(result.status, "invalid");
  assert.match(result.errors.join("\n"), /does not accept programmatic overrides/);
  assert.deepEqual(result.currentAcceptedTickets, []);
});

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const writePendingFixtureRegistry = (fixtureRoot) => {
  const registryPath = join(fixtureRoot, canonicalRegistry);
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.status = "PENDING";
  registry.batches = [registry.batches[0]];
  for (const batch of registry.batches) {
    batch.status = "PENDING";
    delete batch.target.reviewed_head;
    batch.required_artifacts = batch.required_artifacts.map((artifact) => ({
      ...artifact,
      sha256: sha256(join(fixtureRoot, artifact.path))
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

const makeFixture = () => {
  const parent = mkdtempSync(join(tmpdir(), "aos gate administration "));
  const fixtureRoot = join(parent, "repository");
  cpSync(root, fixtureRoot, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(basename(source))
  });
  writePendingFixtureRegistry(fixtureRoot);
  execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.email", "gate@example.test"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.name", "Gate Test"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "gc.auto", "0"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd: fixtureRoot });
  execFileSync("git", ["checkout", "-qb", "dev"], { cwd: fixtureRoot });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:MongLong0214/agent-operator-score.git"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "planning control plane fixture"], { cwd: fixtureRoot });
  execFileSync("git", ["update-ref", "refs/remotes/origin/dev", "HEAD"], { cwd: fixtureRoot });
  return { parent, fixtureRoot };
};

const makeNoGitFixture = () => {
  const parent = mkdtempSync(join(tmpdir(), "aos gate administration no-git "));
  const fixtureRoot = join(parent, "repository");
  cpSync(root, fixtureRoot, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(basename(source))
  });
  writePendingFixtureRegistry(fixtureRoot);
  return { parent, fixtureRoot };
};

const makeAcceptedFixture = (fixtureRoot, reviewedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim()) => {
  const registry = JSON.parse(readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
  const batch = registry.batches[0];
  batch.status = "ACCEPTED";
  batch.target.reviewed_head = reviewedHead;
  batch.artifacts = batch.required_artifacts.map((artifact) => ({
    ...artifact,
    sha256: sha256(join(fixtureRoot, artifact.path))
  }));
  batch.transitions = batch.required_transitions.map((type) => ({
    type,
    artifact_paths: batch.required_artifacts
      .filter(({ kind }) => kind === ({ ADR_ACCEPTED: "ADR", PRD_ACCEPTED: "PRD", TICKET_READY_FOR_RED: "TICKET" })[type])
      .map(({ path }) => path)
  }));
  batch.events = [{
    from: "PENDING",
    to: "ACCEPTED",
    recorded_at: "2026-08-05T00:00:00.000Z",
    recorded_by: "maintainer-02"
  }];
  batch.preparation = { prepared_by: "gate-admin-01" };
  batch.approval = {
    approved_by: "maintainer-02",
    approved_at: "2026-08-05T00:00:00.000Z",
    role: "MAINTAINER"
  };
  registry.status = "ACCEPTED";
  return registry;
};

const createSquashIncorporatedFixture = (fixtureRoot) => {
  const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
  const artifactPath = "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md";
  execFileSync("git", ["checkout", "-qb", "reviewed-batch"], { cwd: fixtureRoot });
  writeFileSync(join(fixtureRoot, artifactPath), `${readFileSync(join(fixtureRoot, artifactPath), "utf8")}\nReviewed batch artifact.\n`);
  execFileSync("git", ["add", artifactPath], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "reviewed batch artifact"], { cwd: fixtureRoot });
  const reviewedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
  const accepted = makeAcceptedFixture(fixtureRoot, reviewedHead);
  writeFileSync(join(fixtureRoot, canonicalRegistry), `${JSON.stringify(accepted, null, 2)}\n`);
  execFileSync("git", ["add", canonicalRegistry], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "reviewed accepted gate record"], { cwd: fixtureRoot });
  const reviewedCandidateHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
  const targetHead = execFileSync("git", ["commit-tree", `${reviewedCandidateHead}^{tree}`, "-p", baseHead], {
    cwd: fixtureRoot,
    encoding: "utf8"
  }).trim();
  execFileSync("git", ["update-ref", "refs/heads/dev", targetHead], { cwd: fixtureRoot });
  execFileSync("git", ["update-ref", "refs/remotes/origin/dev", targetHead], { cwd: fixtureRoot });
  execFileSync("git", ["checkout", "-q", "dev"], { cwd: fixtureRoot });
  return { artifactPath, baseHead, reviewedHead, reviewedCandidateHead, targetHead };
};

const createFeatureOnlyAcceptedRegistryFixture = (fixtureRoot) => {
  const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
  const artifactPath = "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md";
  execFileSync("git", ["checkout", "-qb", "reviewed-feature-only-registry"], { cwd: fixtureRoot });
  writeFileSync(join(fixtureRoot, artifactPath), `${readFileSync(join(fixtureRoot, artifactPath), "utf8")}\nReviewed batch artifact.\n`);
  execFileSync("git", ["add", artifactPath], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "reviewed batch artifact"], { cwd: fixtureRoot });
  const reviewedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
  const targetHead = execFileSync("git", ["commit-tree", `${reviewedHead}^{tree}`, "-p", baseHead], {
    cwd: fixtureRoot,
    encoding: "utf8"
  }).trim();
  execFileSync("git", ["update-ref", "refs/heads/dev", targetHead], { cwd: fixtureRoot });
  execFileSync("git", ["update-ref", "refs/remotes/origin/dev", targetHead], { cwd: fixtureRoot });
  execFileSync("git", ["checkout", "-q", "dev"], { cwd: fixtureRoot });
  return { reviewedHead, targetHead };
};

const makeRejectedFixture = (fixtureRoot) => {
  const registry = JSON.parse(readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
  const batch = registry.batches[0];
  batch.status = "REJECTED";
  batch.events = [{
    from: "PENDING",
    to: "REJECTED",
    recorded_at: "2026-08-05T00:00:00.000Z",
    recorded_by: "maintainer-02"
  }];
  batch.preparation = { prepared_by: "gate-admin-01" };
  batch.approval = {
    approved_by: "maintainer-02",
    approved_at: "2026-08-05T00:00:00.000Z",
    role: "MAINTAINER"
  };
  registry.status = "REJECTED";
  return registry;
};

const makeInvalidatedFixture = (fixtureRoot, reviewedHead) => {
  const registry = makeAcceptedFixture(fixtureRoot, reviewedHead);
  const batch = registry.batches[0];
  batch.status = "INVALIDATED";
  batch.events.push({
    from: "ACCEPTED",
    to: "INVALIDATED",
    recorded_at: "2026-08-05T00:01:00.000Z",
    recorded_by: "gate-admin-01"
  });
  batch.invalidation = {
    invalidated_at: "2026-08-05T00:01:00.000Z",
    invalidated_by: "gate-admin-01",
    reason: "artifact changed after reviewed head"
  };
  registry.status = "INVALIDATED";
  return registry;
};

const runRegistry = (fixtureRoot, candidate) => {
  writeFileSync(join(fixtureRoot, canonicalRegistry), `${JSON.stringify(candidate, null, 2)}\n`);
  try {
    return {
      output: execFileSync(process.execPath, ["scripts/validate-gate-administration.mjs"], {
        cwd: fixtureRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    };
  } catch (error) {
    return { error };
  }
};

const commitRegistryCandidate = (fixtureRoot, candidate) => {
  writeFileSync(join(fixtureRoot, canonicalRegistry), `${JSON.stringify(candidate, null, 2)}\n`);
  execFileSync("git", ["add", canonicalRegistry], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "accepted gate candidate"], { cwd: fixtureRoot });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
};

const runCli = (fixtureRoot, args = []) => {
  try {
    return {
      output: execFileSync(process.execPath, ["scripts/validate-gate-administration.mjs", ...args], {
        cwd: fixtureRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    };
  } catch (error) {
    return { error };
  }
};

test("Gate Administrator validates a structurally complete future batch only through the canonical registry", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const accepted = makeAcceptedFixture(fixtureRoot);
    const uncommittedAccepted = runRegistry(fixtureRoot, accepted);
    assert.equal(uncommittedAccepted.error.status, 1);
    assert.match(uncommittedAccepted.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);

    const candidateHead = commitRegistryCandidate(fixtureRoot, accepted);
    const committedPositive = runCli(fixtureRoot);
    assert.equal(committedPositive.error, undefined);
    assert.match(committedPositive.output, new RegExp(`GATE_ADMINISTRATION_STRUCTURAL_PASS registry=accepted batches=1 accepted=1 rejected=0 invalidated=0 external_gate_evidence=required not_authorization candidate_head=${candidateHead}`));
    assert.doesNotMatch(committedPositive.output, /authorization=granted/);

    const selfApproved = structuredClone(accepted);
    selfApproved.batches[0].approval.approved_by = selfApproved.batches[0].preparation.prepared_by;
    const selfApprovedResult = runRegistry(fixtureRoot, selfApproved);
    assert.equal(selfApprovedResult.error.status, 1);
    assert.match(selfApprovedResult.error.stderr, /self-approved/);

    const missingOffset = structuredClone(accepted);
    missingOffset.batches[0].events[0].recorded_at = "2026-08-05T00:00:00";
    const missingOffsetResult = runRegistry(fixtureRoot, missingOffset);
    assert.equal(missingOffsetResult.error.status, 1);
    assert.match(missingOffsetResult.error.stderr, /malformed lifecycle evidence/);

    const invalidCalendar = structuredClone(accepted);
    invalidCalendar.batches[0].approval.approved_at = "2026-02-30T00:00:00Z";
    const invalidCalendarResult = runRegistry(fixtureRoot, invalidCalendar);
    assert.equal(invalidCalendarResult.error.status, 1);
    assert.match(invalidCalendarResult.error.stderr, /malformed preparation or Maintainer approval/);

    const malformed = structuredClone(accepted);
    malformed.batches[0].artifacts = {};
    const malformedResult = runRegistry(fixtureRoot, malformed);
    assert.equal(malformedResult.error.status, 1);
    assert.match(malformedResult.error.stderr, /malformed evidence arrays/);

    const partial = structuredClone(accepted);
    partial.batches[0].artifacts.pop();
    const partialResult = runRegistry(fixtureRoot, partial);
    assert.equal(partialResult.error.status, 1);
    assert.match(partialResult.error.stderr, /partial accepted artifacts|do not exactly close required scope/);

    const inconsistentGlobal = structuredClone(accepted);
    inconsistentGlobal.status = "PENDING";
    const inconsistentGlobalResult = runRegistry(fixtureRoot, inconsistentGlobal);
    assert.equal(inconsistentGlobalResult.error.status, 1);
    assert.match(inconsistentGlobalResult.error.stderr, /status is inconsistent with batches/);

    const wrongTarget = structuredClone(accepted);
    wrongTarget.batches[0].target.reviewed_head = "a".repeat(40);
    const wrongTargetResult = runRegistry(fixtureRoot, wrongTarget);
    assert.equal(wrongTargetResult.error.status, 1);
    assert.match(wrongTargetResult.error.stderr, /reviewed_head is not a resolvable commit/);

    const changedArtifact = accepted.batches[0].artifacts[0].path;
    writeFileSync(join(fixtureRoot, changedArtifact), `${readFileSync(join(fixtureRoot, changedArtifact), "utf8")}\n`);
    const staleResult = runRegistry(fixtureRoot, accepted);
    assert.equal(staleResult.error.status, 1);
    assert.match(staleResult.error.stderr, /artifact digest is stale/);

  } finally {
    removeTempFixture(parent);
  }
});

test("PENDING registry is exact-head bound before structural PASS", () => {
  const pendingFixture = makeFixture();
  try {
    const pendingPath = join(pendingFixture.fixtureRoot, canonicalRegistry);
    const pendingBytes = readFileSync(pendingPath, "utf8");
    writeFileSync(pendingPath, `${pendingBytes}\n`);
    const uncommittedPending = runCli(pendingFixture.fixtureRoot);
    assert.equal(uncommittedPending.error.status, 1);
    assert.match(uncommittedPending.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);
    execFileSync("git", ["add", canonicalRegistry], { cwd: pendingFixture.fixtureRoot });
    execFileSync("git", ["commit", "-qm", "pending gate candidate"], { cwd: pendingFixture.fixtureRoot });
    const pendingHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pendingFixture.fixtureRoot, encoding: "utf8" }).trim();
    const committedPending = runCli(pendingFixture.fixtureRoot);
    assert.equal(committedPending.error, undefined);
    assert.match(committedPending.output, new RegExp(`registry=pending.*candidate_head=${pendingHead}`));
  } finally {
    removeTempFixture(pendingFixture.parent);
  }
});

test("PENDING required artifacts require valid SHA-256 digests", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const pending = JSON.parse(readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
    const missingDigest = structuredClone(pending);
    delete missingDigest.batches[0].required_artifacts[0].sha256;
    const missingDigestResult = runRegistry(fixtureRoot, missingDigest);
    assert.equal(missingDigestResult.error.status, 1);
    assert.match(missingDigestResult.error.stderr, /pending required artifact has missing or malformed sha256/);

    const malformedDigest = structuredClone(pending);
    malformedDigest.batches[0].required_artifacts[0].sha256 = "not-a-sha256";
    const malformedDigestResult = runRegistry(fixtureRoot, malformedDigest);
    assert.equal(malformedDigestResult.error.status, 1);
    assert.match(malformedDigestResult.error.stderr, /pending required artifact has missing or malformed sha256/);
  } finally {
    removeTempFixture(parent);
  }
});

test("REJECTED registry is exact-head bound before structural PASS", () => {
  const rejectedFixture = makeFixture();
  try {
    const rejected = makeRejectedFixture(rejectedFixture.fixtureRoot);
    const uncommittedRejected = runRegistry(rejectedFixture.fixtureRoot, rejected);
    assert.equal(uncommittedRejected.error.status, 1);
    assert.match(uncommittedRejected.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);
    const rejectedHead = commitRegistryCandidate(rejectedFixture.fixtureRoot, rejected);
    const committedRejected = runCli(rejectedFixture.fixtureRoot);
    assert.equal(committedRejected.error, undefined);
    assert.match(committedRejected.output, new RegExp(`registry=rejected.*candidate_head=${rejectedHead}`));
  } finally {
    removeTempFixture(rejectedFixture.parent);
  }
});

test("INVALIDATED registry is exact-head bound before structural PASS", () => {
  const invalidatedFixture = makeFixture();
  try {
    const invalidated = makeInvalidatedFixture(invalidatedFixture.fixtureRoot);
    const uncommittedInvalidated = runRegistry(invalidatedFixture.fixtureRoot, invalidated);
    assert.equal(uncommittedInvalidated.error.status, 1);
    assert.match(uncommittedInvalidated.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate-registry\.v2\.json/);
    const invalidatedHead = commitRegistryCandidate(invalidatedFixture.fixtureRoot, invalidated);
    const committedInvalidated = runCli(invalidatedFixture.fixtureRoot);
    assert.equal(committedInvalidated.error, undefined);
    assert.match(committedInvalidated.output, new RegExp(`registry=invalidated.*candidate_head=${invalidatedHead}`));
  } finally {
    removeTempFixture(invalidatedFixture.parent);
  }
});

test("no-Git fixture permits only all-PENDING structural output", () => {
  const { parent, fixtureRoot } = makeNoGitFixture();
  try {
    const originalRegistry = readFileSync(join(fixtureRoot, canonicalRegistry), "utf8");
    const pending = runCli(fixtureRoot);
    assert.equal(pending.error, undefined);
    assert.match(pending.output, /registry=pending.*not_authorization candidate_head=unavailable_pending/);

    const rejected = makeRejectedFixture(fixtureRoot);
    const rejectedResult = runRegistry(fixtureRoot, rejected);
    assert.equal(rejectedResult.error.status, 1);
    assert.match(rejectedResult.error.stderr, /cannot resolve exact candidate HEAD/);

    writeFileSync(join(fixtureRoot, canonicalRegistry), originalRegistry);
    const invalidated = makeInvalidatedFixture(fixtureRoot, "a".repeat(40));
    const invalidatedResult = runRegistry(fixtureRoot, invalidated);
    assert.equal(invalidatedResult.error.status, 1);
    assert.match(invalidatedResult.error.stderr, /cannot resolve exact candidate HEAD/);
  } finally {
    removeTempFixture(parent);
  }
});

test("canonical registry rejects a forged sibling registry and a canonical symlink to outside the repository", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const forgedRegistry = ".forged-gate-registry.json";
    writeFileSync(join(fixtureRoot, forgedRegistry), readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
    const forged = runCli(fixtureRoot, [`--gate-registry=${forgedRegistry}`]);
    assert.equal(forged.error.status, 1);
    assert.match(forged.error.stderr, /canonical registry only/);

    const outside = join(parent, "outside-registry.json");
    writeFileSync(outside, readFileSync(join(fixtureRoot, canonicalRegistry), "utf8"));
    unlinkSync(join(fixtureRoot, canonicalRegistry));
    symlinkSync(outside, join(fixtureRoot, canonicalRegistry));
    const symlinked = runCli(fixtureRoot);
    assert.equal(symlinked.error.status, 1);
    assert.match(symlinked.error.stderr, /regular non-symlink file|realpath escapes repository root/);
  } finally {
    removeTempFixture(parent);
  }
});

test("accepted candidate permits a feature branch and detached CI head based on the target ref", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    execFileSync("git", ["checkout", "-qb", "feature-gate"], { cwd: fixtureRoot });
    const accepted = makeAcceptedFixture(fixtureRoot);
    const featureHead = commitRegistryCandidate(fixtureRoot, accepted);
    const feature = runCli(fixtureRoot);
    assert.equal(feature.error, undefined);
    assert.match(feature.output, new RegExp(`candidate_head=${featureHead}`));

    const detachedFixture = makeFixture();
    try {
      execFileSync("git", ["checkout", "-qb", "feature-ci"], { cwd: detachedFixture.fixtureRoot });
      const detachedAccepted = makeAcceptedFixture(detachedFixture.fixtureRoot);
      const candidateHead = commitRegistryCandidate(detachedFixture.fixtureRoot, detachedAccepted);
      execFileSync("git", ["checkout", "-q", "--detach", candidateHead], { cwd: detachedFixture.fixtureRoot });
      const detached = runCli(detachedFixture.fixtureRoot);
      assert.equal(detached.error, undefined);
      assert.match(detached.output, new RegExp(`candidate_head=${candidateHead}`));
    } finally {
      removeTempFixture(detachedFixture.parent);
    }
  } finally {
    removeTempFixture(parent);
  }
});

test("accepted candidate fails closed when canonical schema or executed validator differs from exact HEAD", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    execFileSync("git", ["checkout", "-qb", "feature-exact-head"], { cwd: fixtureRoot });
    const accepted = makeAcceptedFixture(fixtureRoot);
    const candidateHead = commitRegistryCandidate(fixtureRoot, accepted);
    const schemaPath = join(fixtureRoot, "docs/decisions/maintainer-gate.schema.json");
    const schemaBytes = readFileSync(schemaPath, "utf8");
    writeFileSync(schemaPath, `${schemaBytes}\n`);
    const changedSchema = runCli(fixtureRoot);
    assert.equal(changedSchema.error.status, 1);
    assert.match(changedSchema.error.stderr, /exact-head mismatch docs\/decisions\/maintainer-gate\.schema\.json/);
    writeFileSync(schemaPath, schemaBytes);

    const validatorPath = join(fixtureRoot, "scripts/validate-gate-administration.mjs");
    const validatorBytes = readFileSync(validatorPath, "utf8");
    writeFileSync(validatorPath, `${validatorBytes}\n// exact-head mutation\n`);
    const changedValidator = runCli(fixtureRoot);
    assert.equal(changedValidator.error.status, 1);
    assert.match(changedValidator.error.stderr, /exact-head mismatch scripts\/validate-gate-administration\.mjs/);
    writeFileSync(validatorPath, validatorBytes);

    const restored = runCli(fixtureRoot);
    assert.equal(restored.error, undefined);
    assert.match(restored.output, new RegExp(`candidate_head=${candidateHead}`));
  } finally {
    removeTempFixture(parent);
  }
});

test("accepted candidate fails closed for unrelated target ancestry, wrong-owner remote, and an unincorporated feature reviewed head", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const accepted = makeAcceptedFixture(fixtureRoot);

    execFileSync("git", ["remote", "set-url", "origin", "git@github.com:wrong-owner/agent-operator-score.git"], { cwd: fixtureRoot });
    const wrongRepository = runRegistry(fixtureRoot, accepted);
    assert.equal(wrongRepository.error.status, 1);
    assert.match(wrongRepository.error.stderr, /actual repository/);

    execFileSync("git", ["remote", "set-url", "origin", "git@github.com:MongLong0214/agent-operator-score.git"], { cwd: fixtureRoot });
    const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
    const unrelatedHead = execFileSync("git", ["commit-tree", `${baseHead}^{tree}`], {
      cwd: fixtureRoot,
      encoding: "utf8"
    }).trim();
    execFileSync("git", ["update-ref", "refs/heads/unrelated", unrelatedHead], { cwd: fixtureRoot });
    execFileSync("git", ["checkout", "-q", "unrelated"], { cwd: fixtureRoot });
    const unrelated = runRegistry(fixtureRoot, accepted);
    assert.equal(unrelated.error.status, 1);
    assert.match(unrelated.error.stderr, /exact candidate HEAD is not based on target ref/);

    execFileSync("git", ["checkout", "-q", "dev"], { cwd: fixtureRoot });
    const featureArtifactPath = "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md";
    execFileSync("git", ["checkout", "-qb", "unincorporated-review-feature"], { cwd: fixtureRoot });
    writeFileSync(join(fixtureRoot, featureArtifactPath), `${readFileSync(join(fixtureRoot, featureArtifactPath), "utf8")}\nUnincorporated feature artifact.\n`);
    execFileSync("git", ["add", featureArtifactPath], { cwd: fixtureRoot });
    execFileSync("git", ["commit", "-qm", "unincorporated feature artifact"], { cwd: fixtureRoot });
    const existingButUnreviewedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "-q", "dev"], { cwd: fixtureRoot });
    const wrongCandidateAncestry = structuredClone(accepted);
    wrongCandidateAncestry.batches[0].target.reviewed_head = existingButUnreviewedHead;
    const wrongCandidateAncestryResult = runRegistry(fixtureRoot, wrongCandidateAncestry);
    assert.equal(wrongCandidateAncestryResult.error.status, 1);
    assert.match(wrongCandidateAncestryResult.error.stderr, /artifact does not match reviewed head/);
  } finally {
    removeTempFixture(parent);
  }
});

test("accepted batch accepts a squash-incorporated reviewed batch only with target-tip digest proof", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const { reviewedHead, reviewedCandidateHead, targetHead } = createSquashIncorporatedFixture(fixtureRoot);
    const candidateHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();

    assert.throws(() => execFileSync("git", ["merge-base", "--is-ancestor", reviewedHead, candidateHead], { cwd: fixtureRoot }));
    assert.doesNotThrow(() => execFileSync("git", ["merge-base", "--is-ancestor", targetHead, candidateHead], { cwd: fixtureRoot }));
    assert.doesNotThrow(() => execFileSync("git", ["diff", "--quiet", reviewedCandidateHead, targetHead], { cwd: fixtureRoot }));

    const result = runCli(fixtureRoot);
    assert.equal(result.error, undefined);
    assert.match(result.output, /external_gate_evidence=required/);
    assert.match(result.output, /not_authorization/);
  } finally {
    removeTempFixture(parent);
  }
});

test("squash incorporation rejects a non-ancestor target ref and a target-tip artifact digest mismatch", () => {
  const unrelatedFixture = makeFixture();
  try {
    const accepted = makeAcceptedFixture(unrelatedFixture.fixtureRoot);
    const candidateHead = commitRegistryCandidate(unrelatedFixture.fixtureRoot, accepted);
    const unrelatedTarget = execFileSync("git", ["commit-tree", `${candidateHead}^{tree}`], {
      cwd: unrelatedFixture.fixtureRoot,
      encoding: "utf8"
    }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/dev", unrelatedTarget], { cwd: unrelatedFixture.fixtureRoot });
    const result = runCli(unrelatedFixture.fixtureRoot);
    assert.equal(result.error.status, 1);
    assert.match(result.error.stderr, /exact candidate HEAD is not based on target ref origin\/dev/);
  } finally {
    removeTempFixture(unrelatedFixture.parent);
  }

  const mismatchFixture = makeFixture();
  try {
    const { artifactPath, reviewedHead, targetHead } = createSquashIncorporatedFixture(mismatchFixture.fixtureRoot);
    const reviewedBytes = readFileSync(join(mismatchFixture.fixtureRoot, artifactPath), "utf8");
    writeFileSync(join(mismatchFixture.fixtureRoot, artifactPath), `${reviewedBytes}\nTarget-tip mismatch.\n`);
    execFileSync("git", ["add", artifactPath], { cwd: mismatchFixture.fixtureRoot });
    execFileSync("git", ["commit", "-qm", "target tip changes reviewed artifact"], { cwd: mismatchFixture.fixtureRoot });
    const mismatchedTarget = execFileSync("git", ["rev-parse", "HEAD"], { cwd: mismatchFixture.fixtureRoot, encoding: "utf8" }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/dev", mismatchedTarget], { cwd: mismatchFixture.fixtureRoot });
    writeFileSync(join(mismatchFixture.fixtureRoot, artifactPath), reviewedBytes);
    execFileSync("git", ["add", artifactPath], { cwd: mismatchFixture.fixtureRoot });
    execFileSync("git", ["commit", "-qm", "restore reviewed artifact for candidate"], { cwd: mismatchFixture.fixtureRoot });
    assert.notEqual(targetHead, mismatchedTarget);
    const result = runCli(mismatchFixture.fixtureRoot);
    assert.equal(result.error.status, 1);
    assert.match(result.error.stderr, /target branch tip artifact digest is stale/);
  } finally {
    removeTempFixture(mismatchFixture.parent);
  }
});

test("squash fallback rejects an accepted registry introduced only by a feature candidate", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const { reviewedHead, targetHead } = createFeatureOnlyAcceptedRegistryFixture(fixtureRoot);
    const accepted = makeAcceptedFixture(fixtureRoot, reviewedHead);
    const candidateHead = commitRegistryCandidate(fixtureRoot, accepted);

    assert.throws(() => execFileSync("git", ["merge-base", "--is-ancestor", reviewedHead, candidateHead], { cwd: fixtureRoot }));
    assert.doesNotThrow(() => execFileSync("git", ["merge-base", "--is-ancestor", targetHead, candidateHead], { cwd: fixtureRoot }));
    const result = runCli(fixtureRoot);
    assert.equal(result.error.status, 1);
    assert.match(result.error.stderr, /target branch tip canonical registry does not match exact candidate registry/);
  } finally {
    removeTempFixture(parent);
  }
});

test("squash incorporation rejects wrong owner or branch, missing target refs, and feature-target spoofing", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const accepted = makeAcceptedFixture(fixtureRoot);

    execFileSync("git", ["remote", "set-url", "origin", "git@github.com:wrong-owner/agent-operator-score.git"], { cwd: fixtureRoot });
    const wrongOwner = runRegistry(fixtureRoot, accepted);
    assert.equal(wrongOwner.error.status, 1);
    assert.match(wrongOwner.error.stderr, /wrong actual repository target/);

    execFileSync("git", ["remote", "set-url", "origin", "git@github.com:MongLong0214/agent-operator-score.git"], { cwd: fixtureRoot });
    execFileSync("git", ["update-ref", "-d", "refs/remotes/origin/dev"], { cwd: fixtureRoot });
    const missingTarget = runRegistry(fixtureRoot, accepted);
    assert.equal(missingTarget.error.status, 1);
    assert.match(missingTarget.error.stderr, /target ref origin\/dev is unavailable/);

    const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot, encoding: "utf8" }).trim();
    const featureHead = execFileSync("git", ["commit-tree", `${baseHead}^{tree}`, "-p", baseHead], { cwd: fixtureRoot, encoding: "utf8" }).trim();
    execFileSync("git", ["update-ref", "refs/heads/feature-squash-spoof", featureHead], { cwd: fixtureRoot });
    execFileSync("git", ["update-ref", "refs/remotes/origin/feature-squash-spoof", featureHead], { cwd: fixtureRoot });
    execFileSync("git", ["checkout", "-q", "feature-squash-spoof"], { cwd: fixtureRoot });
    const spoofed = structuredClone(accepted);
    spoofed.batches[0].target.branch = "feature-squash-spoof";
    const featureSpoof = runRegistry(fixtureRoot, spoofed);
    assert.equal(featureSpoof.error.status, 1);
    assert.match(featureSpoof.error.stderr, /wrong repository target/);
  } finally {
    removeTempFixture(parent);
  }
});

test("a structural-only approval spoof is explicitly external gate evidence, never authorization", () => {
  const { parent, fixtureRoot } = makeFixture();
  try {
    const spoofed = makeAcceptedFixture(fixtureRoot);
    spoofed.batches[0].approval.approved_by = "ceo";
    spoofed.batches[0].events[0].recorded_by = "independent-reviewer";
    commitRegistryCandidate(fixtureRoot, spoofed);
    const result = runCli(fixtureRoot);
    assert.equal(result.error, undefined);
    assert.match(result.output, /external_gate_evidence=required/);
    assert.match(result.output, /not_authorization/);
    assert.doesNotMatch(result.output, /authorization=granted/);
  } finally {
    removeTempFixture(parent);
  }
});

test("current registry invalidates the stale D0-001 batch and requires renewed external review", () => {
  const registry = JSON.parse(readFileSync(resolve(root, "docs/decisions/maintainer-gate-registry.v2.json"), "utf8"));
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-001-canonical-identifier-registry.md"), "utf8");
  const d0004Ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"), "utf8");
  const gateStatus = readFileSync(resolve(root, "docs/decisions/MAINTAINER-GATE-STATUS.md"), "utf8");
  const gateDecision = readFileSync(resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md"), "utf8");
  const d0004Ownership = d0004Ticket.match(/^## Exact ownership\n\n([\s\S]*?)\n\n## Preconditions/m)?.[1];
  const batch = registry.batches[0];
  const result = validateGateAdministration();
  assert.equal(registry.version, 2);
  assert.equal(registry.status, "INVALIDATED");
  assert.equal(batch.status, "INVALIDATED");
  assert.equal(batch.target.repository, "github.com/MongLong0214/agent-operator-score");
  assert.equal(batch.target.branch, "dev");
  assert.equal(batch.target.reviewed_head, "dde8c29a592c35a37515645511e6da275ffb50f0");
  assert.deepEqual(batch.artifacts.map(({ path, kind }) => ({ path, kind })), batch.required_artifacts);
  const ticketArtifact = batch.artifacts.find(({ path }) => path === "docs/tickets/D0/D0-001-canonical-identifier-registry.md");
  const adr1Artifact = batch.artifacts.find(({ path }) => path === "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md");
  const adrArtifact = batch.artifacts.find(({ path }) => path === "docs/adr/ADR-0003-runtime-repository-and-distribution.md");
  assert.notEqual(adr1Artifact.sha256, sha256(resolve(root, adr1Artifact.path)));
  assert.notEqual(ticketArtifact.sha256, sha256(resolve(root, ticketArtifact.path)));
  assert.notEqual(adrArtifact.sha256, sha256(resolve(root, adrArtifact.path)));
  assert.deepEqual(batch.transitions, [
    { type: "ADR_ACCEPTED", artifact_paths: batch.required_artifacts.filter(({ kind }) => kind === "ADR").map(({ path }) => path) },
    { type: "PRD_ACCEPTED", artifact_paths: batch.required_artifacts.filter(({ kind }) => kind === "PRD").map(({ path }) => path) },
    { type: "TICKET_READY_FOR_RED", artifact_paths: batch.required_artifacts.filter(({ kind }) => kind === "TICKET").map(({ path }) => path) }
  ]);
  assert.deepEqual(batch.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(batch.invalidation.reason, /renewed independent external gate review/);
  assert.notEqual(batch.preparation.prepared_by, batch.approval.approved_by);
  assert.equal(batch.approval.role, "MAINTAINER");
  assert.equal(result.status, "invalidated");
  assert.equal(result.externalGateEvidence, "required");
  assert.match(ticket, /BLOCKED — ADR \+ PRD \+ TICKET MAINTAINER GATES REQUIRED/);
  assert.match(gateStatus, /HISTORICAL SNAPSHOT — NEVER USE FOR CURRENT READINESS/);
  assert.match(gateStatus, /D0-002 RED-census contract-correction renewal/);
  assert.match(gateStatus, /2713d5e8646ff69c979aa1114d6f6ae78d804c7f/);
  assert.doesNotMatch(gateStatus, /c84185e99cffaa16ba66d49fb2c8676d4e18340c/);
  assert.doesNotMatch(gateStatus, /53abf77c724bffc785bc9820ef9bbe5ffece89d3/);
  assert.doesNotMatch(gateStatus, /three invalidated D0-001/);
  assert.doesNotMatch(gateStatus, /bounded-RED(?: digest)? renewal/);
  assert.match(ticket, /only the numeric `control_plane_code_files` literal within `acceptedValidatorOutput` and `pendingValidatorOutput`/);
  assert.match(ticket, /Gate Administration owns the `gates=<status>` portion and D0-004 owns every remaining portion/);
  assert.match(d0004Ticket, /except the numeric `control_plane_code_files` literal/);
  assert.match(d0004Ticket, /the `gates=<status>` portion, which Gate Administration owns/);
  assert.match(gateDecision, /Only the numeric `control_plane_code_files` literal in `acceptedValidatorOutput` and `pendingValidatorOutput`/);
  assert.match(gateDecision, /only the `gates=<status>` portion of `acceptedValidatorOutput` and `pendingValidatorOutput`/);
  assert.ok(d0004Ownership);
  assert.doesNotMatch(d0004Ownership, /MAINTAINER-GATE-STATUS\.md|maintainer-gate\.schema\.json/);
  assert.match(d0004Ownership, /historical v1 boundary only/);
  assert.match(d0004Ownership, /not an active control-plane ownership grant and must not be restored/);
  assert.match(gateDecision, /`docs\/decisions\/MAINTAINER-GATE-STATUS\.md`; `docs\/decisions\/maintainer-gate\.schema\.json`/);
  assert.match(gateDecision, /compatibility migration's exact delegation test case\/plumbing/);
});

test("ADR-0003 correction invalidates the D0-001 bounded-RED planning acceptance", () => {
  const registry = JSON.parse(readFileSync(resolve(root, canonicalRegistry), "utf8"));
  const historical = registry.batches.find(({ id }) => id === "d0-001-prerequisites");
  const supersededRenewal = registry.batches.find(({ id }) => id === "d0-001-prerequisites-renewal");
  const ownershipRenewal = registry.batches.find(({ id }) => id === "d0-001-prerequisites-contract-correction-renewal");
  const boundedRedRenewal = registry.batches.find(({ id }) => id === "d0-001-prerequisites-red-contract-renewal");
  const gateDecision = readFileSync(resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md"), "utf8");
  const result = validateGateAdministration();
  const requiredArtifacts = [
    { path: "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md", kind: "ADR" },
    { path: "docs/adr/ADR-0003-runtime-repository-and-distribution.md", kind: "ADR" },
    { path: "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md", kind: "ADR" },
    { path: "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md", kind: "PRD" },
    { path: "docs/tickets/D0/D0-001-canonical-identifier-registry.md", kind: "TICKET" }
  ];

  assert.equal(registry.status, "INVALIDATED");
  assert.equal(historical.status, "INVALIDATED");
  assert.equal(supersededRenewal.status, "INVALIDATED");
  assert.deepEqual(supersededRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(supersededRenewal.invalidation.reason, /census and planning-test isolation correction/);
  assert.equal(ownershipRenewal.status, "INVALIDATED");
  assert.deepEqual(ownershipRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(ownershipRenewal.invalidation.reason, /RED staging semantics correction/);
  assert.ok(boundedRedRenewal);
  assert.equal(boundedRedRenewal.status, "INVALIDATED");
  assert.deepEqual(boundedRedRenewal.target, {
    repository: "github.com/MongLong0214/agent-operator-score",
    branch: "dev",
    reviewed_head: "53abf77c724bffc785bc9820ef9bbe5ffece89d3"
  });
  assert.deepEqual(boundedRedRenewal.required_artifacts.map(({ path, kind }) => ({ path, kind })), requiredArtifacts);
  for (const path of [
    "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
    "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
    "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"
  ]) {
    const artifact = boundedRedRenewal.required_artifacts.find((candidate) => candidate.path === path);
    assert.notEqual(artifact.sha256, sha256(resolve(root, artifact.path)));
  }
  assert.deepEqual(boundedRedRenewal.required_transitions, ["ADR_ACCEPTED", "PRD_ACCEPTED", "TICKET_READY_FOR_RED"]);
  assert.deepEqual(boundedRedRenewal.artifacts, boundedRedRenewal.required_artifacts);
  assert.deepEqual(boundedRedRenewal.transitions, [
    { type: "ADR_ACCEPTED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "ADR").map(({ path }) => path) },
    { type: "PRD_ACCEPTED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "PRD").map(({ path }) => path) },
    { type: "TICKET_READY_FOR_RED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "TICKET").map(({ path }) => path) }
  ]);
  assert.deepEqual(boundedRedRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.notEqual(boundedRedRenewal.preparation.prepared_by, boundedRedRenewal.approval.approved_by);
  assert.equal(boundedRedRenewal.approval.role, "MAINTAINER");
  assert.match(boundedRedRenewal.invalidation.reason, /ADR-0003 workspace scope correction/);
  assert.equal(result.status, "invalidated");
  assert.equal(result.externalGateEvidence, "required");
  assert.match(gateDecision, /All D0-001 prerequisite batches remain invalidated; none is a current planning acceptance or execution authority/);
  assert.match(gateDecision, /current structurally `ACCEPTED` D0-002 renewal and D0-004 B-harness carve-out renewal/);
  assert.match(gateDecision, /exact-head technical review, existing CI, and explicit CEO production PASS remain required/);
});

test("D0-002 RED census correction invalidates the prior acceptance and renews exact prerequisites", () => {
  const registry = JSON.parse(readFileSync(resolve(root, canonicalRegistry), "utf8"));
  const batch = registry.batches.find(({ id }) => id === "d0-002-prerequisites");
  const supersededRenewal = registry.batches.find(({ id }) => id === "d0-002-prerequisites-adr-0003-renewal");
  const priorRenewal = registry.batches.find(({ id }) => id === "d0-002-prerequisites-adr-0003-contract-correction-renewal");
  const renewal = registry.batches.find(({ id }) => id === "d0-002-prerequisites-red-census-contract-correction-renewal");
  const result = validateGateAdministration();
  const adr = readFileSync(resolve(root, "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md"), "utf8");
  const prd = readFileSync(resolve(root, "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"), "utf8");
  const ticket = readFileSync(resolve(root, "docs/tickets/D0/D0-002-repository-and-npm-workspace-skeleton.md"), "utf8");

  assert.ok(batch);
  assert.equal(batch.status, "INVALIDATED");
  assert.deepEqual(batch.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  for (const path of [
    "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
    "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
    "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
    "docs/tickets/D0/D0-002-repository-and-npm-workspace-skeleton.md"
  ]) {
    const artifact = batch.required_artifacts.find((candidate) => candidate.path === path);
    assert.notEqual(artifact.sha256, sha256(resolve(root, artifact.path)));
  }
  assert.match(batch.invalidation.reason, /ADR-0003 workspace scope correction/);
  assert.match(adr, /unresolved result blocks public canonical-brand adoption and public publication; it does not block the private, unpublished internal package identifier/);
  assert.match(prd, /unresolved evidence blocks public canonical-brand adoption, public publication, and D0 exit, but not the private unpublished internal package identifier/);
  assert.match(ticket, /explicitly allowed pre-RED harness insertion/);
  assert.match(ticket, /No companion failure is permitted; identity and preservation cases must pass/);
  assert.match(ticket, /case `root-private-scripts-and-runnable-surface`/);
  assert.match(ticket, /duplicate clearance source/);
  assert.match(ticket, /`UNRESOLVED` blocks public canonical-brand adoption, public publication, and D0 exit but does not block the private unpublished root package identifier/);

  assert.ok(supersededRenewal);
  assert.equal(supersededRenewal.status, "INVALIDATED");
  assert.deepEqual(supersededRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(supersededRenewal.invalidation.reason, /artifact scope changed before final external review/);

  assert.ok(priorRenewal, "the prior D0-002 acceptance must remain as an invalidated historical batch");
  assert.equal(priorRenewal.status, "INVALIDATED");
  assert.deepEqual(priorRenewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.match(priorRenewal.invalidation.reason, /D0-002 RED census contract correction/);
  assert.equal(
    priorRenewal.artifacts.find(({ path }) => path === "docs/tickets/D0/D0-002-repository-and-npm-workspace-skeleton.md").sha256,
    "a64e2f24f4c4e2b9c00d415d652ca6254cc4a07198026fc950d2953171892c98"
  );

  assert.ok(renewal, "D0-002 requires a fresh digest-bound renewal after the RED census correction");
  assert.equal(renewal.status, "ACCEPTED");
  assert.deepEqual(renewal.target, {
    repository: "github.com/MongLong0214/agent-operator-score",
    branch: "dev",
    reviewed_head: "2713d5e8646ff69c979aa1114d6f6ae78d804c7f"
  });
  assert.doesNotThrow(() => execFileSync("git", ["merge-base", "--is-ancestor", renewal.target.reviewed_head, "HEAD"], {
    cwd: root,
    stdio: "ignore"
  }));
  assert.deepEqual(renewal.required_artifacts.map(({ path, kind }) => ({ path, kind })), batch.required_artifacts.map(({ path, kind }) => ({ path, kind })));
  for (const artifact of renewal.required_artifacts) {
    assert.equal(artifact.sha256, sha256(resolve(root, artifact.path)));
  }
  assert.deepEqual(renewal.artifacts, renewal.required_artifacts);
  assert.deepEqual(renewal.transitions, [
    { type: "ADR_ACCEPTED", artifact_paths: renewal.required_artifacts.filter(({ kind }) => kind === "ADR").map(({ path }) => path) },
    { type: "PRD_ACCEPTED", artifact_paths: renewal.required_artifacts.filter(({ kind }) => kind === "PRD").map(({ path }) => path) },
    { type: "TICKET_READY_FOR_RED", artifact_paths: renewal.required_artifacts.filter(({ kind }) => kind === "TICKET").map(({ path }) => path) }
  ]);
  assert.deepEqual(renewal.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" }
  ]);
  assert.notEqual(renewal.preparation.prepared_by, renewal.approval.approved_by);
  assert.equal(renewal.approval.role, "MAINTAINER");
  assert.equal(result.status, "invalidated");
  // Registry-wide counts, so recording any batch moves them. Any change here
  // must be made because the registry changed, never to make this case pass:
  // read the values the validator reports and pin exactly those. The set stays
  // pinned exactly, not loosened to a floor, and currentAcceptedTickets is the
  // distinct accepted ticket paths, which is not the accepted-batch count once
  // a renewal replaces an invalidated batch for a ticket already in the list.
  assert.equal(result.batches, 18);
  assert.equal(result.counts.accepted, 8);
  assert.equal(result.counts.invalidated, 10);
  assert.deepEqual(result.currentAcceptedTickets, [
    "docs/tickets/D0/D0-002-repository-and-npm-workspace-skeleton.md",
    "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
    "docs/tickets/D0/D0-005-governance-mode-contract-and-advisory-boundary.md",
    "docs/tickets/D0/D0-006-effective-state-quarantine-and-legacy-reclassification.md",
    "docs/tickets/D0/D0-007-artifact-manifest-v3-and-legacy-migration.md",
    "docs/tickets/D0/D0-011-ticket-derived-fixture-directory-admission.md",
    "docs/tickets/D0/D0-012-ticket-owned-census-rederivation.md",
    "docs/tickets/D0/D0-013-restore-execution-view-regression-coverage.md"
  ]);
  assert.equal(result.externalGateEvidence, "required");
});

test("D0-004 completion-marker contract amendment retains the B-harness record as invalidated history and requires exactly one fresh post-Bootstrap accepted renewal", () => {
  const registry = JSON.parse(readFileSync(resolve(root, canonicalRegistry), "utf8"));
  const gateDecision = readFileSync(resolve(root, "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md"), "utf8");
  const prior = registry.batches.find(({ id }) => id === "d0-004-prerequisites-single-owner-bootstrap");
  const batch = registry.batches.find(({ id }) => id === "d0-004-prerequisites-b-harness-carveout-renewal");
  const requiredArtifacts = [
    { path: "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md", sha256: "88c84ba1db660d2630be4d3203c20a32c81915f1b8485a61eb5f4bc28293a108", kind: "ADR" },
    { path: "docs/adr/ADR-0003-runtime-repository-and-distribution.md", sha256: "8dc3e44df832d6a33813420ecd5f544af14d52c308faf956fbf82f0ab10a72c4", kind: "ADR" },
    { path: "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md", sha256: "02ae85f74bf4c1e572c17e1f1832194df710d736dc56a6b3b7dc1c14c68b8459", kind: "ADR" },
    { path: "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md", sha256: "54176e5e87b72e27069ddd277291982019a96621218860e8546e0259e32e9115", kind: "PRD" },
    { path: "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md", sha256: "5598dbadc908bac78f0686759865f770f5cef790985bd8edd91202813fe7c474", kind: "TICKET" }
  ];

  assert.ok(prior);
  assert.equal(prior.status, "INVALIDATED");
  assert.match(prior.invalidation.reason, /D0-004B pre-RED harness carve-out/);
  assert.ok(batch, "the D0-004B harness carve-out renewal must remain as historical invalidated evidence");
  assert.equal(batch.status, "INVALIDATED");
  assert.deepEqual(batch.target, {
    repository: "github.com/MongLong0214/agent-operator-score",
    branch: "dev",
    reviewed_head: "550af19b655b788774861c30edaba0c4d4cea209"
  });
  assert.deepEqual(batch.required_artifacts, requiredArtifacts);
  assert.deepEqual(batch.artifacts, requiredArtifacts);
  const ticketArtifact = batch.artifacts.find(({ path }) => path === "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md");
  assert.equal(ticketArtifact.sha256, "5598dbadc908bac78f0686759865f770f5cef790985bd8edd91202813fe7c474");
  assert.notEqual(ticketArtifact.sha256, sha256(resolve(root, ticketArtifact.path)));
  assert.deepEqual(batch.transitions, [
    { type: "ADR_ACCEPTED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "ADR").map(({ path }) => path) },
    { type: "PRD_ACCEPTED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "PRD").map(({ path }) => path) },
    { type: "TICKET_READY_FOR_RED", artifact_paths: requiredArtifacts.filter(({ kind }) => kind === "TICKET").map(({ path }) => path) }
  ]);
  assert.deepEqual(batch.events.map(({ from, to }) => ({ from, to })), [
    { from: "PENDING", to: "ACCEPTED" },
    { from: "ACCEPTED", to: "INVALIDATED" }
  ]);
  assert.notEqual(batch.preparation.prepared_by, batch.approval.approved_by);
  assert.equal(batch.approval.role, "MAINTAINER");
  assert.match(batch.invalidation.reason, /D0-004 completion-marker contract amendment changed the accepted ticket digest/);
  assert.match(
    batch.invalidation.reason,
    /Bootstrap preserves the prior batch as historical evidence and does not require a renewal batch before D0-004C/,
    "the immutable historical invalidation evidence must retain its pre-D0-004C Bootstrap rule"
  );
  assert.equal(batch.invalidation.invalidated_by, "d0-004-completion-contract-amendment");
  const expectedCurrentD0004Renewal = {
    "id": "d0-004-prerequisites-completion-marker-receipt-renewal",
    "status": "ACCEPTED",
    "scope": "Accept the D0-004 prerequisite set — ADR-0001/0003/0012, PRD-D0, and the exact D0-004 ticket at the digests below — so its semantic planning validator and governance-gate work may advance only through separately required exact-head technical review, CI, explicit CEO production PASS, and an exact-base execution-packet gate. Recorded by the repository owner, who is its sole maintainer. Technical review is delegated to an adversarial reviewer whose pass is required before merge; this record is not that review and is not merge authorization.",
    "target": {
      "repository": "github.com/MongLong0214/agent-operator-score",
      "branch": "dev",
      "reviewed_head": "05f17438d56a54d9df577a089a328ea00113fc48"
    },
    "required_artifacts": [
      {
        "path": "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
        "sha256": "88c84ba1db660d2630be4d3203c20a32c81915f1b8485a61eb5f4bc28293a108",
        "kind": "ADR"
      },
      {
        "path": "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
        "sha256": "8dc3e44df832d6a33813420ecd5f544af14d52c308faf956fbf82f0ab10a72c4",
        "kind": "ADR"
      },
      {
        "path": "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md",
        "sha256": "02ae85f74bf4c1e572c17e1f1832194df710d736dc56a6b3b7dc1c14c68b8459",
        "kind": "ADR"
      },
      {
        "path": "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
        "sha256": "54176e5e87b72e27069ddd277291982019a96621218860e8546e0259e32e9115",
        "kind": "PRD"
      },
      {
        "path": "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
        "sha256": "1fa7ff15df45de27d26c087e5641af20ed10f4887b0f8b9b359845bba51e3b9d",
        "kind": "TICKET"
      }
    ],
    "required_transitions": [
      "ADR_ACCEPTED",
      "PRD_ACCEPTED",
      "TICKET_READY_FOR_RED"
    ],
    "artifacts": [
      {
        "path": "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
        "sha256": "88c84ba1db660d2630be4d3203c20a32c81915f1b8485a61eb5f4bc28293a108",
        "kind": "ADR"
      },
      {
        "path": "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
        "sha256": "8dc3e44df832d6a33813420ecd5f544af14d52c308faf956fbf82f0ab10a72c4",
        "kind": "ADR"
      },
      {
        "path": "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md",
        "sha256": "02ae85f74bf4c1e572c17e1f1832194df710d736dc56a6b3b7dc1c14c68b8459",
        "kind": "ADR"
      },
      {
        "path": "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md",
        "sha256": "54176e5e87b72e27069ddd277291982019a96621218860e8546e0259e32e9115",
        "kind": "PRD"
      },
      {
        "path": "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md",
        "sha256": "1fa7ff15df45de27d26c087e5641af20ed10f4887b0f8b9b359845bba51e3b9d",
        "kind": "TICKET"
      }
    ],
    "transitions": [
      {
        "type": "ADR_ACCEPTED",
        "artifact_paths": [
          "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
          "docs/adr/ADR-0003-runtime-repository-and-distribution.md",
          "docs/adr/ADR-0012-planning-tdd-and-exact-head-governance.md"
        ]
      },
      {
        "type": "PRD_ACCEPTED",
        "artifact_paths": [
          "docs/prd/PRD-D0-name-migration-and-repository-skeleton.md"
        ]
      },
      {
        "type": "TICKET_READY_FOR_RED",
        "artifact_paths": [
          "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"
        ]
      }
    ],
    "events": [
      {
        "from": "PENDING",
        "to": "ACCEPTED",
        "recorded_at": "2026-08-13T00:00:00Z",
        "recorded_by": "d0-004-completion-marker-receipt-renewal-candidate"
      }
    ],
    "preparation": {
      "prepared_by": "d0-004-completion-marker-receipt-renewal-candidate"
    },
    "approval": {
      "approved_by": "MongLong0214",
      "approved_at": "2026-08-13T00:00:00Z",
      "role": "MAINTAINER"
    }
  };
  const currentAcceptedD0004Batches = registry.batches.filter(({ status, artifacts }) => status === "ACCEPTED" &&
    Array.isArray(artifacts) &&
    artifacts.some(({ path }) => path === "docs/tickets/D0/D0-004-planning-contract-validator-and-governance-gate.md"));
  assert.deepEqual(
    currentAcceptedD0004Batches,
    [expectedCurrentD0004Renewal],
    "after D0-004C, Bootstrap is inactive: exactly one fresh D0-004 accepted record must bind the current five artifacts while both historical D0-004 rows remain INVALIDATED"
  );
  assert.match(gateDecision, /D0-004 B-harness carve-out renewal/);
  assert.match(gateDecision, /mutable structural fields.*`not_authorization`/s);
});
