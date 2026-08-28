import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkpointEvidence } from "../../lib/checkpoint.mjs";
import { renderCheckpoint } from "../../lib/checkpoint-runtime.mjs";

// Four README files drift apart silently: one gets a new section, the others keep the old shape,
// and a reader in the wrong language is told about a product that no longer exists. These hold the
// four to the same skeleton without pretending to check the prose.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANGUAGES = [
  { file: "README.md", name: "English" },
  { file: "README.ko.md", name: "한국어" },
  { file: "README.ja.md", name: "日本語" },
  { file: "README.zh-CN.md", name: "简体中文" }
];
const read = (file) => readFileSync(join(root, file), "utf8");
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test("every translation exists and keeps the same skeleton", () => {
  const shapes = LANGUAGES.map(({ file }) => {
    assert.equal(existsSync(join(root, file)), true, `${file} is missing`);
    const text = read(file);
    return {
      file,
      headings: count(text, /^#{1,3} /gm),
      tableRows: count(text, /^\|/gm),
      fences: count(text, /^```/gm)
    };
  });
  const [english, ...rest] = shapes;
  for (const shape of rest) {
    assert.equal(shape.headings, english.headings, `${shape.file}: ${shape.headings} headings vs ${english.headings}`);
    assert.equal(shape.tableRows, english.tableRows, `${shape.file}: ${shape.tableRows} table rows vs ${english.tableRows}`);
    assert.equal(shape.fences, english.fences, `${shape.file}: ${shape.fences} code fences vs ${english.fences}`);
  }
});

test("each page marks its own language and links to the other three", () => {
  for (const { file, name } of LANGUAGES) {
    const text = read(file);
    assert.match(text, new RegExp(`<strong>${name}</strong>`), `${file}: does not mark itself as current`);
    for (const other of LANGUAGES.filter((entry) => entry.file !== file)) {
      assert.match(text, new RegExp(`<a href="${other.file}">${other.name}</a>`), `${file}: no link to ${other.file}`);
    }
  }
});

test("every local link and image in every language resolves", () => {
  for (const { file } of LANGUAGES) {
    const text = read(file);
    const targets = new Set([
      ...[...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    ]);
    for (const target of targets) {
      if (target.startsWith("http")) continue;
      const path = target.split("#")[0];
      assert.equal(existsSync(join(root, path)), true, `${file}: ${target} does not exist`);
    }
  }
});

test("the checkpoint every page shows is the one the product prints", () => {
  // A page about refusing to overclaim must not show output the tool does not emit -- in any
  // language. The sample is the same bytes everywhere because it is literal terminal output.
  const evidence = checkpointEvidence({
    kind: "repeated-failure",
    family: "FAM-4",
    detail: "blocked before this stage: the migration step times out",
    output: [
      "goal: cut the report over",
      "latest evidence: sha256:67a666c03d22",
      "event: retry-tests (retry-7)",
      "event: retry-tests (retry-7)"
    ].join("\n"),
    calls: [{ signature: "retry-tests:retry-7", outcome: "repeated unchanged" }]
  });
  const rendered = renderCheckpoint(evidence, { agents: ["codex"] }).trim();

  for (const { file } of LANGUAGES) {
    const shown = /```text\n(AOS checkpoint[\s\S]*?)```/.exec(read(file));
    assert.notEqual(shown, null, `${file}: the checkpoint sample is gone`);
    assert.equal(shown[1].trim(), rendered, `${file}: the sample is not what the renderer produces`);
  }
});

test("the measured numbers say the same thing in every language", () => {
  // Prose is not checked, but a number that disagrees across translations is a different claim,
  // and this repository's numbers are the part it is most careful about.
  for (const { file } of LANGUAGES) {
    const text = read(file);
    for (const figure of ["69, 69, 83", "49, 59, 89", "90, 87, 92", "17/17", "320", "`>=22.18 <25`"]) {
      assert.equal(text.includes(figure), true, `${file}: ${figure} is missing`);
    }
  }
});
