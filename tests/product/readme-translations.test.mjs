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

// The picture explainer ships in the repository and is opened from a file:// path, so anything it
// reaches for is a request the reader did not ask for -- and it exists to explain a product whose
// report makes none. A page that fetched a webfont to say that would be contradicting itself on its
// own first screen.
test("the explainer asks for nothing from anywhere", () => {
  const file = join(root, "docs", "what-this-measures.html");
  assert.equal(existsSync(file), true);
  const html = readFileSync(file, "utf8");

  assert.equal(/<script/i.test(html), false, "a script");
  assert.equal(/<iframe|<img/i.test(html), false, "an embed");
  assert.equal(/@import/i.test(html), false, "an imported stylesheet");
  // `url(#id)` would point inside this document; anything else names somewhere to fetch from.
  assert.deepEqual(html.match(/url\((?!#)[^)]*\)/gi) ?? [], []);
  // The SVG namespace is an identifier the browser never resolves. Nothing else absolute may appear.
  assert.deepEqual(
    (html.match(/https?:\/\/[^"'\s>)]*/g) ?? []).filter((url) => url !== "http://www.w3.org/2000/svg"),
    []
  );

  // Every link it does carry has to resolve, or the page sends the reader nowhere.
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.equal(link.startsWith("http"), false, link);
    assert.equal(existsSync(join(root, "docs", link)), true, `${link} does not exist`);
  }

  // Both themes are defined, and the ground is painted rather than inherited from whatever is behind.
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /\[data-theme="dark"\]/);
  assert.match(html, /body\{[^}]*background:var\(--ground\)/);
});

// It is linked from every translation, so a reader who lands on any of the four can find it.
test("every README points at the explainer", () => {
  for (const { file } of LANGUAGES) {
    assert.match(read(file), /docs\/what-this-measures\.html/, `${file} does not link the explainer`);
  }
});
