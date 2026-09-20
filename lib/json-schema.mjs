/**
 * A validator for the subset of JSON Schema this repository writes, and no more.
 *
 * It lives on its own because two different things are checked against a schema now: the execution
 * plan, and every stored result on the way to being rendered. Pulling in a general validator would
 * be the first runtime dependency in a product whose whole claim is that it runs from a clone with
 * nothing else installed; writing the subset keeps that true and keeps the failure messages in the
 * vocabulary of the document rather than of a library.
 */

import { canonicalJson } from "./core.mjs";

const KEYWORDS = new Set([
  "$schema", "$id", "title", "description", "$defs", "$ref", "type", "const", "enum",
  "properties", "required", "additionalProperties", "minProperties", "items", "minItems",
  "maxItems", "uniqueItems", "minimum", "maximum", "minLength", "maxLength", "maxProperties", "pattern",
  // Two fields that have to agree are one state, and a schema that cannot say so leaves the
  // agreement to whoever writes the file. `oneOf` is how "issued with a number and no reasons, or
  // withheld with null and its reasons" is written down where the reader of a stored result can
  // check it, rather than only where this repository's code happens to look.
  "oneOf"
]);

const typeOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "number" ? "number" : typeof value;
};

const typeMatches = (value, expected) =>
  expected === "number" ? typeOf(value) === "integer" || typeOf(value) === "number" : typeOf(value) === expected;

const resolveRef = (root, ref) => {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
  let node = root;
  for (const segment of ref.slice(2).split("/")) {
    node = node?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  }
  return node;
};

const validateNode = (value, schema, root, path, errors) => {
  // A boolean is a schema in its own right: `true` accepts everything, `false` rejects everything.
  // Treating `false` as "no schema here" is the direction that silently accepts, so it is spelled
  // out rather than left to a truthiness test.
  if (schema === true) return;
  if (schema === false) {
    errors.push({ path, message: "no value is allowed here" });
    return;
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push({ path, message: "the schema at this position is not a schema" });
    return;
  }
  for (const keyword of Object.keys(schema)) {
    // An unsupported keyword is reported, not thrown. A throw here would crash the verifier
    // instead of failing it, and a crashed required check reads to a human like infrastructure
    // trouble rather than like the schema saying something this validator cannot promise to honour.
    if (!KEYWORDS.has(keyword)) errors.push({ path, message: `unsupported schema keyword "${keyword}"` });
  }
  if (schema.$ref) {
    let target;
    try {
      target = resolveRef(root, schema.$ref);
    } catch (error) {
      errors.push({ path, message: error.message });
      return;
    }
    // Draft 2020-12 applies $ref's siblings too. Returning early here accepted 3 against
    // `{$ref: …, minimum: 5}`, which is the shape a schema grows into the first time someone
    // narrows a reused definition at one use site.
    validateNode(value, target, root, path, errors);
    const siblings = { ...schema };
    delete siblings.$ref;
    if (Object.keys(siblings).length > 0) validateNode(value, siblings, root, path, errors);
    return;
  }

  const fail = (message) => errors.push({ path, message });

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((one) => typeMatches(value, one))) {
      fail(`expected ${allowed.join(" or ")}, got ${typeOf(value)}`);
      return;
    }
  }
  if (schema.oneOf !== undefined) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) fail("oneOf takes a non-empty list of alternatives");
    else {
      // Exactly one, not at least one: the alternatives here describe states that exclude each
      // other, and a value matching two of them is a value whose state nobody can name.
      const matched = schema.oneOf.filter((branch) => {
        const branchErrors = [];
        validateNode(value, branch, root, path, branchErrors);
        return branchErrors.length === 0;
      });
      if (matched.length !== 1) fail(`must match exactly one of the ${schema.oneOf.length} alternatives here, and matched ${matched.length}`);
    }
  }
  if (schema.const !== undefined && value !== schema.const) fail(`expected the constant ${JSON.stringify(schema.const)}`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    fail(`${JSON.stringify(value)} is not one of ${schema.enum.map((one) => JSON.stringify(one)).join(", ")}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be <= ${schema.maximum}`);
  }
  if (typeof value === "string") {
    // Characters, not UTF-16 code units, and `u` on the pattern. A single emoji is one character
    // and two code units, so the previous version called "\u{1F600}" long enough for minLength 2
    // and matched it against `^..$`.
    const characters = [...value].length;
    if (schema.minLength !== undefined && characters < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && characters > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined) {
      // No fallback to a non-unicode regex. `\\8` is invalid under `u` and legal without it, so the
      // fallback quietly evaluated a *different* pattern from the one the schema wrote down.
      let pattern = null;
      try {
        pattern = new RegExp(schema.pattern, "u");
      } catch {
        fail(`the pattern ${schema.pattern} is not a valid unicode regular expression`);
      }
      if (pattern && !pattern.test(value)) fail(`does not match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
    if (schema.uniqueItems === true) {
      // Key order is not part of a JSON value's identity, so the comparison canonicalises first.
      // `JSON.stringify` alone called {a:1,b:2} and {b:2,a:1} distinct, which is the opposite of
      // what uniqueItems means.
      const seen = new Set(value.map((one) => canonicalJson(one)));
      if (seen.size !== value.length) fail("items must be unique");
    }
    if (schema.items !== undefined) value.forEach((item, index) => validateNode(item, schema.items, root, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) fail(`must have at least ${schema.minProperties} properties`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) fail(`must have at most ${schema.maxProperties} properties`);
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail(`missing required property "${key}"`);
    }
    for (const key of keys) {
      // `Object.hasOwn`, not truthiness: `{properties: {x: false}}` says x is forbidden, and
      // `if (child)` read that as "x has no schema" and let it through.
      if (Object.hasOwn(schema.properties ?? {}, key)) {
        validateNode(value[key], schema.properties[key], root, `${path}.${key}`, errors);
        continue;
      }
      if (schema.additionalProperties === undefined) continue;
      if (schema.additionalProperties === false) fail(`unexpected property "${key}"`);
      else validateNode(value[key], schema.additionalProperties, root, `${path}.${key}`, errors);
    }
  }
};

export function validateAgainstSchema(document, schema) {
  const errors = [];
  try {
    validateNode(document, schema, schema, "$", errors);
  } catch (error) {
    errors.push({ path: "$", message: `the validator could not finish: ${error.message}` });
  }
  return { ok: errors.length === 0, errors };
}
