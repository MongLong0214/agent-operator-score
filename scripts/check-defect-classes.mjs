#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The defect classes this release's reviews kept finding, made cheap to find first.
//
// Ten pull requests went through an adversarial review gate, and across roughly twenty-five rounds
// the blocking findings clustered into a handful of *input and idiom classes* rather than novel
// design flaws: a digest taken over decoded text, a plain object used as a map for an
// attacker-chosen key, a regex compiled without unicode mode, a date validated by Date.parse, an
// array a schema forgot to bound, a test with a name and no assertion. Each class cost a full
// review round the first time a human thought of it. This scanner is those rounds, kept.
//
// Everything here is a heuristic over source text, so every rule carries an allowlist seeded to the
// code that existed when the rule landed. The point is not to judge old code -- it is that NEW code
// matching a known-bad shape forces a deliberate decision: fix it, or allowlist it with a reason in
// the diff where a reviewer sees it.

const root = new URL("..", import.meta.url).pathname;
const ALLOWLIST_PATH = join(root, "governance", "defect-class-allowlist.json");
const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));

const SKIP = new Set([".git", "node_modules", "fixtures"]);
const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(join(dir, entry.name));
      continue;
    }
    if (/\.mjs$/.test(entry.name)) sources.push(join(dir, entry.name));
  }
};
for (const top of ["lib", "bin", "scripts", "tests"]) walk(join(root, top));

const raw = [];
const report = (rule, file, line, detail) => raw.push({ rule, file, line, detail });

for (const path of sources) {
  const file = relative(root, path);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    const where = index + 1;

    // A digest over decoded text is not an identity. `readFileSync(p, "utf8")` folds encodings,
    // replaces invalid bytes and can normalise line endings before the hash ever runs -- two
    // different files, one digest. #567's core defect, and this rule flags the exact line dev
    // shipped it on (lib/core.mjs sha256Text over a decoded, CRLF-folded read).
    //
    // Known limit, stated rather than papered over: this is text matching, not an AST, so an
    // aliased import (`readFileSync as r`) walks past it. The scanner buys the common spelling
    // cheaply; the adjudication review still owns the rest.
    if (/readFileSync\([^)]*["']utf-?8["']/.test(line) && text.includes("createHash(")) {
      report("text-digest", file, where, line.trim());
    }

    // A regex compiled without unicode mode counts UTF-16 code units and mismatches astral input;
    // one emoji satisfied `^..$` and a length check of 2. Rounds 3 and 5 of #588.
    const regexCall = line.match(/new RegExp\(([^)]*)\)/);
    if (regexCall && !/["'][^"']*u[^"']*["']\s*\)/.test(line)) {
      report("regex-no-unicode", file, where, line.trim());
    }

    // Date.parse is not a validator: it accepts "0", rolls 2026-02-30 into March, and maps years
    // 0-99 into the 1900s through the constructor. Validation must check calendar fields.
    if (/Date\.parse\(/.test(line)) {
      report("date-parse-validator", file, where, line.trim());
    }
  });

  // A plain object used as a map whose keys arrive from outside inherits the `__proto__` setter:
  // a file named __proto__ wrote through to Object.prototype and vanished from a scope diff. Flag
  // files that build `x = {}` and later assign x[computed]; a Map or Object.create(null) is the
  // fix, an allowlist entry with a reason is the alternative.
  const plainMaps = [...text.matchAll(/const (\w+) = \{\};/g)].map((m) => m[1]);
  for (const name of plainMaps) {
    const computed = new RegExp(`${name}\\[(?!["'\`])[^\\]]+\\]\\s*=`);
    const hit = lines.findIndex((line) => computed.test(line));
    if (hit >= 0) report("plain-object-map", file, hit + 1, `const ${name} = {};`);
  }

  // A test with a name and no assertion passes forever. Several review rounds were spent on tests
  // whose names claimed more than their bodies checked; zero assertions is the mechanical floor of
  // that class.
  if (file.startsWith("tests/") && /\.test\.mjs$/.test(file)) {
    for (const match of text.matchAll(/^test\((["'`])((?:(?!\1).)*)\1[^]*?^\}\);$/gms)) {
      if (!/assert|expect|rejects|throws/.test(match[0])) {
        const line = text.slice(0, match.index).split("\n").length;
        report("assertless-test", file, line, match[2]);
      }
    }
  }
}

// A schema array without a bound is unbounded work for whatever validates against it: a
// canonical-sized plan carried a hundred thousand references because nothing said it could not.
const schemaDir = join(root, "schemas");
let schemaFiles = [];
try {
  schemaFiles = readdirSync(schemaDir).filter((one) => one.endsWith(".schema.json"));
} catch {
  // No schemas directory is fine.
}
for (const name of schemaFiles) {
  const file = `schemas/${name}`;
  const walkSchema = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "array" && node.maxItems === undefined) {
      report("unbounded-schema-array", file, 1, `"${path.split("/").filter((seg) => seg !== "properties" && seg !== "#" && seg !== "$defs").join(".")}"`);
    }
    for (const [key, child] of Object.entries(node)) walkSchema(child, `${path}/${key}`);
  };
  walkSchema(JSON.parse(readFileSync(join(schemaDir, name), "utf8")), "#");
}

// An allowlist entry either matches a finding that exists today or it is stale. Stale entries rot
// the same way stale status labels do: a hole kept open at an address where something new can land.
const matches = (entry, one) => entry.file === one.file && (entry.match === undefined || one.detail.includes(entry.match));
const findings = raw.filter((one) => !(allowlist[one.rule] ?? []).some((entry) => matches(entry, one)));
for (const [rule, entries] of Object.entries(allowlist)) {
  for (const entry of entries) {
    if (!raw.some((one) => one.rule === rule && matches(entry, one))) {
      findings.push({ rule: "stale-allowlist", file: entry.file, line: 1, detail: `${rule}: "${entry.match}" matches nothing any more — remove the entry` });
    }
  }
}

if (findings.length === 0) {
  console.log(`defect classes: clean (${sources.length} files, ${Object.keys(allowlist).length} rules)`);
  process.exit(0);
}
for (const one of findings) console.error(`FAIL  [${one.rule}] ${one.file}:${one.line}  ${one.detail}`);
console.error(`\n${findings.length} finding(s). Fix the shape, or allowlist it in governance/defect-class-allowlist.json with the match string -- the entry shows up in the diff, which is the point.`);
process.exit(1);
