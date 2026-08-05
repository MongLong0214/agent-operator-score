import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";

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
  { id: "old-agent-ops-score", parts: ["Agent", "Ops Score"], caseInsensitive: true, wordBoundary: false },
  { id: "old-agentops-package", parts: ["agent", "ops-score"], caseInsensitive: true, wordBoundary: false },
  { id: "old-agent-leverage-index", parts: ["Agent ", "Leverage Index"], caseInsensitive: true, wordBoundary: false },
  { id: "old-initialism", parts: ["A", "LI"], caseInsensitive: true, wordBoundary: true },
  { id: "old-benchmark-alias", parts: ["a", "li", "-", "bench"], caseInsensitive: true, wordBoundary: true },
  { id: "old-provisional-score-label", parts: ["AOS", "-", "P0"], caseInsensitive: true, wordBoundary: true }
];

const decoder = new TextDecoder("utf-8", { fatal: true });
const ignoredDirectories = new Set([".git", "node_modules"]);

export class IdentityValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IdentityValidationError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new IdentityValidationError(code, message);
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => isPlainObject(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

const readRegularFile = (path, code, description) => {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail(code, `${description} is missing: ${path}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code, `${description} must be a regular file: ${path}`);
  try {
    return readFileSync(path);
  } catch {
    fail(code, `${description} cannot be read: ${path}`);
  }
};

const validateRegistry = (registry, registryPath) => {
  if (!exactKeys(registry, ["version", "canonical", "forbidden"]) || registry.version !== 1) {
    fail("IDENTITY_REGISTRY_INVALID", `registry has an invalid version or shape: ${registryPath}`);
  }
  if (JSON.stringify(registry.canonical) !== JSON.stringify(canonical)) {
    fail("IDENTITY_REGISTRY_INVALID", `registry canonical values do not match: ${registryPath}`);
  }
  if (!Array.isArray(registry.forbidden) || registry.forbidden.length !== forbidden.length ||
    registry.forbidden.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(forbidden[index]))) {
    fail("IDENTITY_REGISTRY_INVALID", `registry deny corpus does not match: ${registryPath}`);
  }
};

const readRegistry = (root) => {
  const registryPath = join(root, "specs", "identity.v1.json");
  const bytes = readRegularFile(registryPath, "IDENTITY_REGISTRY_INVALID", "identity registry");
  let registry;
  try {
    registry = JSON.parse(decoder.decode(bytes));
  } catch {
    fail("IDENTITY_REGISTRY_INVALID", `identity registry is malformed: ${registryPath}`);
  }
  validateRegistry(registry, registryPath);
  return registry;
};

const validateRoot = (root) => {
  if (typeof root !== "string" || root.length === 0) fail("IDENTITY_TARGET_INVALID", "--root must name a directory");
  const absoluteRoot = resolve(root);
  let stat;
  try {
    stat = lstatSync(absoluteRoot);
  } catch {
    fail("IDENTITY_TARGET_INVALID", `target root is missing: ${absoluteRoot}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("IDENTITY_TARGET_INVALID", `target root must be a non-symlink directory: ${absoluteRoot}`);
  }
  return absoluteRoot;
};

const listActiveTextFiles = (root) => {
  const files = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    } catch {
      fail("IDENTITY_TARGET_INVALID", `target directory cannot be read: ${directory}`);
    }
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const path = join(directory, entry.name);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        fail("IDENTITY_TARGET_INVALID", `target entry cannot be inspected: ${path}`);
      }
      if (stat.isSymbolicLink()) fail("IDENTITY_TARGET_INVALID", `symlink is not allowed in target: ${path}`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(path);
    }
  };
  walk(root);
  return files;
};

const textOrNull = (path) => {
  const bytes = readRegularFile(path, "IDENTITY_TARGET_INVALID", "target file");
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    fail("IDENTITY_TARGET_INVALID", `target file is not valid UTF-8 text: ${path}`);
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hitLocation = (text, index) => {
  const before = text.slice(0, index);
  return {
    line: before.split("\n").length,
    column: index - before.lastIndexOf("\n")
  };
};

export const validateIdentity = ({ root } = {}) => {
  const targetRoot = validateRoot(root);
  const registry = readRegistry(targetRoot);
  const hits = [];
  for (const path of listActiveTextFiles(targetRoot)) {
    const text = textOrNull(path);
    if (text === null) continue;
    for (const entry of registry.forbidden) {
      const value = entry.parts.join("");
      const source = entry.wordBoundary ? `\\b${escapeRegex(value)}\\b` : escapeRegex(value);
      const pattern = new RegExp(source, entry.caseInsensitive ? "gi" : "g");
      for (const match of text.matchAll(pattern)) {
        hits.push({ id: entry.id, path: relative(targetRoot, path), ...hitLocation(text, match.index) });
      }
    }
  }
  return { ok: hits.length === 0, hits };
};

const cli = () => {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--root") fail("IDENTITY_TARGET_INVALID", "usage: validate-identity.mjs --root <path>");
  const result = validateIdentity({ root: args[1] });
  if (result.ok) {
    console.log("IDENTITY_VALIDATION_PASS hits=0");
    return;
  }
  console.error(`IDENTITY_VALIDATION_FAIL ${result.hits.length}`);
  for (const hit of result.hits) console.error(`- ${hit.id} ${hit.path}:${hit.line}:${hit.column}`);
  process.exitCode = 1;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli();
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      console.error(`IDENTITY_VALIDATION_ERROR ${error.code}: ${error.message}`);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
