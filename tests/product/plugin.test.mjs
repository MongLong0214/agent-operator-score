import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

// One-click installation only works if the manifests are true. A version that drifted from
// package.json, or a command pointing at a file that moved, fails at the operator's machine rather
// than here -- which is the worst place for a packaging mistake to surface.
test("the plugin manifests say what this repository is", () => {
  const pkg = json("package.json");
  const plugin = json(".claude-plugin/plugin.json");
  const market = json(".claude-plugin/marketplace.json");

  assert.equal(plugin.version, pkg.version, "plugin.json drifted from package.json");
  assert.equal(market.metadata.version, pkg.version, "marketplace.json drifted from package.json");
  assert.equal(market.plugins[0].version, pkg.version);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(plugin.license, "MIT");
});

test("every command and skill points at a file that exists", () => {
  for (const file of ["commands/aos-review.md", "commands/aos-assess.md", "skills/aos/SKILL.md"]) {
    const body = read(file);
    // Frontmatter, or the command does not register at all.
    assert.match(body, /^---\n[\s\S]*?\n---\n/, `${file} has no frontmatter`);
    assert.match(body, /^(name|description):/m, `${file} declares neither name nor description`);
    for (const [, path] of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      assert.ok(existsSync(join(root, path)), `${file} points at ${path}, which does not exist`);
    }
  }
});

test("the plugin needs no install step, which is what makes it one click", () => {
  // A plugin that has to be built or npm-installed after cloning is not one click. This repository
  // can only stay installable-by-clone while it has no runtime dependencies.
  const pkg = json("package.json");
  assert.deepEqual(pkg.dependencies ?? {}, {}, "a runtime dependency would require an install step");
  assert.ok(existsSync(join(root, "bin", "aos.mjs")));
});

test("the assess command refuses to answer checkpoints for the operator", () => {
  // The one thing that cannot be automated: a dimension that measures what the operator did while
  // the run was happening is not measurable by an agent answering on their behalf, and driving it
  // with `expect` is the exact defect the checkpoint exists to catch.
  for (const file of ["commands/aos-assess.md", "skills/aos/SKILL.md"]) {
    const body = read(file);
    assert.match(body, /expect/, `${file} does not warn against faking presence with a pty`);
    assert.match(body, /--checkpoints/, `${file} does not mention the flag it must not run`);
  }
});

test("the skill carries the rules a score must be reported under", () => {
  const skill = read("skills/aos/SKILL.md");
  for (const rule of [/NOT_OBSERVED/, /ceiling is not a deduction/i, /profile-bound/i, /local repeat evidence/i]) {
    assert.match(skill, rule, `the skill omits ${rule}`);
  }
  // And it must not invite the comparison the product refuses.
  assert.match(skill, /never compare them/i);
});
