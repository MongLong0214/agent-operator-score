import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "acorn";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const testNames = (source) => {
  const names = [];
  const valueOf = (node, scope) => {
    if (node?.type === "Literal") return node.value;
    if (node?.type === "Identifier") return scope[node.name];
    if (node?.type === "ArrayExpression") return node.elements.map((item) => valueOf(item, scope));
    if (node?.type === "TemplateLiteral") {
      const values = node.expressions.map((item) => valueOf(item, scope));
      if (values.every((value) => value !== undefined)) return node.quasis.map((part, i) => part.value.cooked + (values[i] ?? "")).join("");
    }
    return undefined;
  };
  const bind = (pattern, value, scope) => {
    if (pattern.type === "Identifier") scope[pattern.name] = value;
    else if (pattern.type === "ArrayPattern") pattern.elements.forEach((part, i) => bind(part, value[i], scope));
  };
  const visit = (node, scope = Object.create(null)) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "ForOfStatement") {
      const values = valueOf(node.right, scope);
      if (Array.isArray(values)) {
        for (const value of values) {
          const inner = { ...scope };
          bind(node.left.declarations[0].id, value, inner);
          visit(node.body, inner);
        }
        return;
      }
    }
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "test") {
      const name = valueOf(node.arguments[0], scope);
      if (typeof name === "string") names.push(name);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child, scope));
      else if (value && typeof value === "object") visit(value, scope);
    }
  };
  visit(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
  return names;
};

test("every verification script pattern alternative selects an actual test in its own files", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  const selected = Object.entries(scripts).filter(([name, command]) => name.startsWith("verify:") && command.includes("--test-name-pattern"));
  assert.ok(selected.length > 0);
  const empty = [];
  for (const [name, command] of selected) {
    const pattern = command.match(/--test-name-pattern=(['"])(.*?)\1/u)?.[2];
    assert.equal(typeof pattern, "string", `${name}: unrecognised selector syntax`);
    const files = command.match(/tests\/[^\s'"]+\.test\.mjs/gu) ?? [];
    assert.ok(files.length > 0, `${name}: no explicit test files`);
    const names = files.flatMap((file) => testNames(read(file)));
    // The shipped selectors use top-level alternatives, without regex groups or character sets.
    assert.doesNotMatch(pattern, /[()[\]]/u, `${name}: extend the alternative parser before introducing groups`);
    for (const alternative of pattern.split("|")) {
      assert.ok(alternative.length > 0, `${name}: empty alternative`);
      if (!names.some((testName) => new RegExp(alternative, "u").test(testName))) empty.push(`${name}: ${alternative} selects zero tests in ${files.join(", ")}`);
    }
  }
  assert.deepEqual(empty, []);
});
