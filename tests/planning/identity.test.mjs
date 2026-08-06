import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scriptPath = resolve(repositoryRoot, "scripts/validate-identity.mjs");

const canonical = {
  productName: "Agent Operator Score",
  abbreviation: "AOS",
  instrument: "AOS-Coding",
  provisionalScore: "AOS-Coding P0",
  packageName: "agent-operator-score",
  cli: "aos",
  stateRoot: ".aos/",
  traceSchema: "aos-trace",
  resultSchema: "aos-result"
};

const forbidden = [
  { id: "old-agent-ops-score", parts: ["Agent", "Ops Score"], wordBoundary: false },
  { id: "old-agentops-package", parts: ["agent", "ops-score"], wordBoundary: false },
  { id: "old-agent-leverage-index", parts: ["Agent ", "Leverage Index"], wordBoundary: false },
  { id: "old-initialism", parts: ["A", "LI"], wordBoundary: true },
  { id: "old-benchmark-alias", parts: ["a", "li", "-", "bench"], wordBoundary: true },
  { id: "old-provisional-score-label", parts: ["AOS", "-", "P0"], wordBoundary: true }
];

const loadValidator = () => import("../../scripts/validate-identity.mjs");
const reconstruct = ({ parts }) => parts.join("");

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "aos-identity-"));
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs/identity.v1.json"), `${JSON.stringify({
    version: 1,
    canonical,
    forbidden: forbidden.map(({ id, parts, wordBoundary }) => ({
      id,
      parts,
      caseInsensitive: true,
      wordBoundary
    }))
  }, null, 2)}\n`);
  writeFileSync(join(root, "README.md"), `${canonical.productName}\n`);
  return root;
};

const withFixture = async (run) => {
  const root = createFixture();
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const runCli = (args, options = {}) => {
  let error;
  try {
    execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
  } catch (caught) {
    error = caught;
  }
  return error;
};

const mixedCase = (value) => [...value].map((character, index) => {
  if (!/[a-z]/i.test(character)) return character;
  return index % 2 === 0 ? character.toUpperCase() : character.toLowerCase();
}).join("");

test("canonical-pass", async () => {
  const { validateIdentity } = await loadValidator();
  await withFixture((root) => {
    const registry = JSON.parse(readFileSync(join(root, "specs/identity.v1.json"), "utf8"));
    assert.deepEqual(registry.canonical, canonical);
    assert.deepEqual(validateIdentity({ root }), { ok: true, hits: [] });
  });
});

test("each-forbidden-token", async () => {
  const { validateIdentity } = await loadValidator();
  for (const entry of forbidden) {
    await withFixture((root) => {
      writeFileSync(join(root, "content.txt"), reconstruct(entry));
      const result = validateIdentity({ root });
      assert.equal(result.ok, false);
      assert.ok(result.hits.some(({ id }) => id === entry.id), entry.id);
    });
  }
});

test("no-active-tree-exception", async () => {
  const { validateIdentity } = await loadValidator();
  await withFixture((root) => {
    const registry = JSON.parse(readFileSync(join(root, "specs/identity.v1.json"), "utf8"));
    assert.deepEqual(Object.keys(registry).sort(), ["canonical", "forbidden", "version"]);
    assert.doesNotMatch(JSON.stringify(registry), /allowlist|legacy.*root|root.*legacy/i);
    mkdirSync(join(root, "docs/generated-historical-path"), { recursive: true });
    writeFileSync(join(root, "docs/generated-historical-path/identifier.md"), reconstruct(forbidden[0]));
    const result = validateIdentity({ root });
    assert.equal(result.ok, false);
    assert.deepEqual(result.hits.map(({ id }) => id), [forbidden[0].id]);
  });
});

test("case-word-boundary-variants", async () => {
  const { validateIdentity } = await loadValidator();
  for (const entry of forbidden) {
    await withFixture((root) => {
      writeFileSync(join(root, "variant.txt"), mixedCase(reconstruct(entry)));
      const result = validateIdentity({ root });
      assert.equal(result.ok, false, entry.id);
      assert.ok(result.hits.some(({ id }) => id === entry.id), entry.id);
    });
  }
  for (const entry of forbidden.filter(({ wordBoundary }) => wordBoundary)) {
    await withFixture((root) => {
      writeFileSync(join(root, "benign.txt"), `x${reconstruct(entry)}suffix`);
      assert.deepEqual(validateIdentity({ root }), { ok: true, hits: [] });
    });
  }
});

test("wrong-target-no-silent-fallback", async () => {
  const { IdentityValidationError, validateIdentity } = await loadValidator();
  const missingRoot = join(tmpdir(), `aos-identity-missing-${process.pid}`);
  assert.throws(() => validateIdentity({ root: missingRoot }), (error) =>
    error instanceof IdentityValidationError && error.code === "IDENTITY_TARGET_INVALID");

  const fileRoot = join(tmpdir(), `aos-identity-file-${process.pid}`);
  writeFileSync(fileRoot, "not a directory\n");
  try {
    assert.throws(() => validateIdentity({ root: fileRoot }), (error) =>
      error instanceof IdentityValidationError && error.code === "IDENTITY_TARGET_INVALID");
  } finally {
    rmSync(fileRoot, { force: true });
  }

  const noRegistryRoot = mkdtempSync(join(tmpdir(), "aos-identity-no-registry-"));
  try {
    assert.throws(() => validateIdentity({ root: noRegistryRoot }), (error) =>
      error instanceof IdentityValidationError && error.code === "IDENTITY_REGISTRY_INVALID");
    const noRegistryError = runCli(["--root", noRegistryRoot]);
    assert.ok(noRegistryError);
    assert.notEqual(noRegistryError.status, 0);
    assert.match(noRegistryError.stderr, /IDENTITY_(TARGET|REGISTRY)_INVALID/);
  } finally {
    rmSync(noRegistryRoot, { recursive: true, force: true });
  }

  await withFixture(async (root) => {
    const sibling = createFixture();
    try {
      writeFileSync(join(root, "root-hit.txt"), reconstruct(forbidden[0]));
      assert.equal(validateIdentity({ root: sibling }).ok, true);
      writeFileSync(join(sibling, "sibling-hit.txt"), reconstruct(forbidden[1]));
      const result = validateIdentity({ root: sibling });
      assert.equal(result.ok, false);
      assert.ok(result.hits.some(({ id }) => id === forbidden[1].id));

      const missingArgumentError = runCli([], { cwd: root });
      assert.ok(missingArgumentError);
      assert.notEqual(missingArgumentError.status, 0);
      assert.match(missingArgumentError.stderr, /IDENTITY_TARGET_INVALID/);

      const wrongRootError = runCli(["--root", join(root, "absent")], { cwd: sibling });
      assert.ok(wrongRootError);
      assert.notEqual(wrongRootError.status, 0);
      assert.match(wrongRootError.stderr, /IDENTITY_TARGET_INVALID/);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});

test("git-worktree-metadata-is-not-active-content", async () => {
  const { validateIdentity } = await loadValidator();
  await withFixture((root) => {
    const historicalIdentifier = reconstruct(forbidden[0]);
    writeFileSync(join(root, ".git"), `gitdir: /tmp/${historicalIdentifier}/.git/worktrees/test\n`);
    assert.deepEqual(validateIdentity({ root }), { ok: true, hits: [] });
  });
});

test("npm-test-discovers-identity", () => {
  const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageManifest.scripts.test, "node --test");
});
