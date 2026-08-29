import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkpointEvidence } from "../../lib/checkpoint.mjs";
import { renderCheckpoint } from "../../lib/checkpoint-runtime.mjs";

// Each language may use its own natural prose, but the public product contract must not drift.
// These checks hold the four pages to the same structure, examples, measurements and visual story
// without freezing whole translations into brittle snapshots.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANGUAGES = [
  { file: "README.md", name: "English", asset: "en" },
  { file: "README.ko.md", name: "한국어", asset: "ko" },
  { file: "README.ja.md", name: "日本語", asset: "ja" },
  { file: "README.zh-CN.md", name: "简体中文", asset: "zh-cn" }
];
const VISUALS = [
  "aos-driver-vs-agent",
  "aos-benchmark-vs-operator",
  "aos-six-dimensions",
  "aos-not-observed",
  "aos-profile-bound"
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

test("the measured numbers and public boundaries match in every language", () => {
  const shared = [
    "69, 69, 83",
    "49, 59, 89",
    "90, 87, 92",
    "17/17",
    "320",
    "0.400",
    "`>=22.18 <25`",
    "Grok",
    "--session",
    "--dangerously-skip-permissions",
    "NOT_OBSERVED",
    "INCOMPLETE",
    "PROFILE-BOUND",
    "card.svg",
    "NO SCORE",
    "--no-auto-auth",
    "AOS_SESSION_ID",
    "AOS_FAMILY",
    "AOS_WORKSPACE",
    "AOS_TASK_FILE",
    "local repeat evidence"
  ];
  for (const { file } of LANGUAGES) {
    const text = read(file);
    for (const marker of shared) {
      assert.equal(text.includes(marker), true, `${file}: ${marker} is missing`);
    }
  }
});

// The original standalone explainer remains a useful source artifact. It must stay self-contained,
// but the READMEs now carry the pictures directly instead of making the reader follow an HTML link.
test("the standalone explainer asks for nothing from anywhere", () => {
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

test("every README embeds its own five localized explainer images", () => {
  for (const { file, asset } of LANGUAGES) {
    const text = read(file);
    assert.equal(text.includes("docs/what-this-measures.html"), false, `${file}: links to the HTML instead of showing the pictures`);
    for (const visual of VISUALS) {
      const path = `docs/assets/${visual}-${asset}.svg`;
      assert.match(text, new RegExp(`<img src="${path.replaceAll("/", "\\/")}"`), `${file}: does not embed ${path}`);
    }
  }
});

test("localized explainer SVGs are self-contained and accessible", () => {
  for (const { asset } of LANGUAGES) {
    for (const visual of VISUALS) {
      const path = join(root, "docs", "assets", `${visual}-${asset}.svg`);
      assert.equal(existsSync(path), true, `${path} is missing`);
      const svg = readFileSync(path, "utf8");
      assert.match(svg, /^<svg[^>]+viewBox=/, `${path}: no viewBox`);
      assert.match(svg, /<title(?:\s[^>]*)?>[^<]+<\/title>/, `${path}: no title`);
      assert.match(svg, /<desc(?:\s[^>]*)?>[^<]+<\/desc>/, `${path}: no description`);
      assert.equal(/<script|<image|<foreignObject/i.test(svg), false, `${path}: active or embedded content`);
      assert.equal(/(?:xlink:)?href\s*=/i.test(svg), false, `${path}: external reference attribute`);
      assert.deepEqual(
        (svg.match(/https?:\/\/[^"'\s>)]*/g) ?? []).filter((url) => url !== "http://www.w3.org/2000/svg"),
        [],
        `${path}: external URL`
      );
    }
  }
});

test("the package manifest ships all four README files", () => {
  const manifest = JSON.parse(read("package.json"));
  for (const { file } of LANGUAGES) {
    assert.equal(manifest.files.includes(file), true, `package.json: ${file} is not packaged`);
  }
});
