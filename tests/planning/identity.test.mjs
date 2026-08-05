import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
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

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "aos-identity-"));
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs/identity.v1.json"), JSON.stringify({
    version: 1,
    canonical,
    forbidden: forbidden.map(({ id, parts, wordBoundary }) => ({
      id,
      parts,
      caseInsensitive: true,
      wordBoundary
    }))
  }, null, 2));
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

test("canonical-pass", async () => {
  const { validateIdentity } = await loadValidator();
  await withFixture((root) => {
    const result = validateIdentity({ root });
    assert.deepEqual(result, { ok: true, hits: [] });
  });
});

test("each-forbidden-token", async () => {
  const { validateIdentity } = await loadValidator();
  for (const entry of forbidden) {
    await withFixture((root) => {
      writeFileSync(join(root, "content.txt"), entry.parts.join(""));
      const result = validateIdentity({ root });
      assert.equal(result.ok, false);
      assert.ok(result.hits.some(({ id }) => id === entry.id));
    });
  }
});

test("no-active-tree-exception", async () => {
  const { validateIdentity } = await loadValidator();
  await withFixture((root) => {
    const registry = JSON.parse(readFileSync(join(root, "specs/identity.v1.json"), "utf8"));
    assert.equal("legacyRoots" in registry, false);
    assert.equal("legacyAllowlist" in registry, false);
    mkdirSync(join(root, "docs/historical-not-allowed"), { recursive: true });
    writeFileSync(join(root, "docs/historical-not-allowed/identifier.md"), forbidden[0].parts.join(""));
    const result = validateIdentity({ root });
    assert.equal(result.ok, false);
    assert.deepEqual(result.hits.map(({ id }) => id), [forbidden[0].id]);
  });
});

test("case-word-boundary-variants", async () => {
  const { validateIdentity } = await loadValidator();
  for (const entry of forbidden) {
    await withFixture((root) => {
      writeFileSync(join(root, "variant.txt"), entry.parts.join("").toUpperCase());
      assert.equal(validateIdentity({ root }).ok, false);
    });
  }
  await withFixture((root) => {
    writeFileSync(join(root, "benign.txt"), ["A", "LI", "ased"].join(""));
    assert.deepEqual(validateIdentity({ root }), { ok: true, hits: [] });
  });
});

test("wrong-target-no-silent-fallback", async () => {
  const { IdentityValidationError, validateIdentity } = await loadValidator();
  const missingRoot = join(tmpdir(), "aos-identity-missing-root");
  assert.throws(() => validateIdentity({ root: missingRoot }), (error) =>
    error instanceof IdentityValidationError && error.code === "IDENTITY_TARGET_INVALID");

  await withFixture((root) => {
    const sibling = createFixture();
    try {
      writeFileSync(join(sibling, "sibling.txt"), forbidden[1].parts.join(""));
      assert.equal(validateIdentity({ root: sibling }).ok, false);
      let error;
      try {
        execFileSync(process.execPath, [scriptPath, "--root", join(root, "missing")], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error);
      assert.equal(error.status, 2);
      assert.match(error.stderr, /IDENTITY_TARGET_INVALID/);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});

test("npm-test-discovers-identity", () => {
  const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageManifest.scripts.test, "node --test");
});
