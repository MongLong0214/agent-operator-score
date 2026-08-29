import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkpointEvidence } from "../../lib/checkpoint.mjs";
import { renderCheckpoint } from "../../lib/checkpoint-runtime.mjs";

// The four pages are one public product contract in four languages. The prose may be native to each
// language, but the shape, commands, measured facts and safety boundaries must not drift apart.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANGUAGES = [
  { file: "README.md", name: "English", suffix: "en" },
  { file: "README.ko.md", name: "한국어", suffix: "ko" },
  { file: "README.ja.md", name: "日本語", suffix: "ja" },
  { file: "README.zh-CN.md", name: "简体中文", suffix: "zh-cn" }
];
const read = (file) => readFileSync(join(root, file), "utf8");
const count = (text, pattern) => (text.match(pattern) ?? []).length;

const VISUALS = [
  "driver-vs-agent",
  "benchmark-vs-operator",
  "six-dimensions",
  "not-observed",
  "profile-bound"
];

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
      ...[...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]),
      ...[...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    ]);
    for (const target of targets) {
      if (target.startsWith("http")) continue;
      const path = target.split("#")[0];
      assert.equal(existsSync(join(root, path)), true, `${file}: ${target} does not exist`);
    }
  }
});

test("each README embeds the five explainer visuals in its own language", () => {
  for (const { file, suffix } of LANGUAGES) {
    const text = read(file);
    for (const visual of VISUALS) {
      const path = `docs/assets/aos-${visual}-${suffix}.svg`;
      assert.match(text, new RegExp(`<img src="${path}"`), `${file}: does not embed ${path}`);
      assert.equal(existsSync(join(root, path)), true, `${path} is missing`);
    }
    // The HTML page remains as the design source, but the README must show the pictures directly.
    assert.doesNotMatch(text, /\]\(docs\/what-this-measures\.html\)/, `${file}: links away instead of embedding the explanation`);
  }
});

test("the embedded explainer SVGs are self-contained and accessible", () => {
  for (const { suffix } of LANGUAGES) {
    for (const visual of VISUALS) {
      const path = join(root, "docs", "assets", `aos-${visual}-${suffix}.svg`);
      const svg = readFileSync(path, "utf8");
      assert.match(svg, /<title\b/, `${path}: no title`);
      assert.match(svg, /<desc\b/, `${path}: no description`);
      assert.equal(/<script|<foreignObject|<image\b|@import/i.test(svg), false, `${path}: active or embedded external content`);
      assert.deepEqual(svg.match(/url\((?!#)[^)]*\)/gi) ?? [], [], `${path}: external CSS URL`);
      assert.deepEqual(
        (svg.match(/https?:\/\/[^"'\s>)]*/g) ?? []).filter((url) => url !== "http://www.w3.org/2000/svg"),
        [],
        `${path}: external URL`
      );
      assert.equal(/(?:href|xlink:href)\s*=/.test(svg), false, `${path}: external-capable reference`);
    }
  }
});

test("the checkpoint every page shows is the one the product prints", () => {
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
  for (const { file } of LANGUAGES) {
    const text = read(file);
    for (const figure of ["69, 69, 83", "49, 59, 89", "90, 87, 92", "17/17", "320", "0.400", "`>=22.18 <25`"]) {
      assert.equal(text.includes(figure), true, `${file}: ${figure} is missing`);
    }
  }
});

test("every language carries the current product boundaries", () => {
  const literals = [
    "Grok CLI",
    "--dangerously-skip-permissions",
    "PROFILE-BOUND",
    "NOT_OBSERVED",
    "INCOMPLETE",
    "provisional_raw",
    "AOS_SESSION_ID",
    "AOS_FAMILY",
    "AOS_WORKSPACE",
    "AOS_TASK_FILE",
    "127.0.0.1",
    "--no-auto-auth",
    "card.svg",
    "EXPERIMENTAL / PROVISIONAL"
  ];
  for (const { file } of LANGUAGES) {
    const text = read(file);
    for (const literal of literals) assert.equal(text.includes(literal), true, `${file}: ${literal} is missing`);
  }
});

test("all four README files are included in the local package", () => {
  const manifest = JSON.parse(read("package.json"));
  const files = new Set(manifest.files ?? []);
  for (const { file } of LANGUAGES) assert.equal(files.has(file), true, `package.json omits ${file}`);
});

// The original visual explainer remains as an offline design reference. It must continue to make no
// request of any kind even though the READMEs now embed localized SVGs directly.
test("the original explainer asks for nothing from anywhere", () => {
  const file = join(root, "docs", "what-this-measures.html");
  assert.equal(existsSync(file), true);
  const html = readFileSync(file, "utf8");

  assert.equal(/<script/i.test(html), false, "a script");
  assert.equal(/<iframe|<img/i.test(html), false, "an embed");
  assert.equal(/@import/i.test(html), false, "an imported stylesheet");
  assert.deepEqual(html.match(/url\((?!#)[^)]*\)/gi) ?? [], []);
  assert.deepEqual(
    (html.match(/https?:\/\/[^"'\s>)]*/g) ?? []).filter((url) => url !== "http://www.w3.org/2000/svg"),
    []
  );

  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.equal(link.startsWith("http"), false, link);
    assert.equal(existsSync(join(root, "docs", link)), true, `${link} does not exist`);
  }

  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /\[data-theme="dark"\]/);
  assert.match(html, /body\{[^}]*background:var\(--ground\)/);
});
