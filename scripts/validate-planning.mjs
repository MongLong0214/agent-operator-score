import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, resolve } from "node:path";
import { validateGateAdministration } from "./validate-gate-administration.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const errors = [];
const required = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "docs/north-star/agent-operator-score-ssot-v1.0.md",
  "docs/contracts/metric-scoring-contract-v1.md",
  "docs/planning/pre-implementation-remediation-matrix-2026-08-05.md",
  "docs/adr/INDEX.md",
  "docs/prd/INDEX.md",
  "docs/tickets/BOARD.md",
  "docs/GITHUB-ISSUE-MAP.md",
  "docs/MILESTONES.md",
  "docs/TRACEABILITY.md",
  "docs/issues.json",
  "docs/decisions/SSOT-IMPORT-2026-08-05.md",
  "docs/decisions/PRE-IMPLEMENTATION-GATE-ADMINISTRATION.md",
  "docs/decisions/MAINTAINER-GATE-STATUS.md",
  "docs/decisions/maintainer-gate.schema.json",
  "docs/decisions/maintainer-gate-registry.v2.json",
  "scripts/validate-gate-administration.mjs"
];

for (const path of required) if (!existsSync(resolve(root, path))) errors.push(`missing ${path}`);

const walk = (directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
};

const rel = (path) => path.slice(root.length + 1);
const readJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    errors.push(`invalid JSON ${label}`);
    return null;
  }
};
const metricContract = readFileSync(resolve(root, "docs/contracts/metric-scoring-contract-v1.md"), "utf8");
const metricIds = Array.from({ length: 20 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);
for (const metricId of metricIds) {
  for (const state of ["pass", "partial", "fail", "no"]) {
    if (!metricContract.includes(`${metricId}-v1-${state}`)) errors.push(`missing canonical vector ${metricId}-v1-${state}`);
  }
}
if (!metricContract.includes("maximum_regret=0")) errors.push("missing M10 zero-regret vector");
if (!metricContract.includes("maximum_distance=0")) errors.push("missing M20 zero-distance vector");
const adrFiles = walk(resolve(root, "docs/adr")).filter((path) => /ADR-\d{4}-.+\.md$/.test(path));
const prdFiles = walk(resolve(root, "docs/prd")).filter((path) => /PRD-(?:D0|E0[ABCD]|E\d+)-.+\.md$/.test(path));
const ticketFiles = walk(resolve(root, "docs/tickets")).filter((path) => /\/(?:D0|E0-[ABCD]|E\d+)\/[A-Z0-9-]+-.+\.md$/.test(path));

if (adrFiles.length !== 12) errors.push(`ADR count ${adrFiles.length}, expected 12`);
if (prdFiles.length !== 19) errors.push(`PRD count ${prdFiles.length}, expected 19`);
if (ticketFiles.length !== 65) errors.push(`ticket count ${ticketFiles.length}, expected 65`);

for (const path of adrFiles) {
  const text = readFileSync(path, "utf8");
  if (!text.includes("PROPOSED — MAINTAINER GATE REQUIRED")) errors.push(`${rel(path)} lacks proposed gate`);
}
for (const path of prdFiles) {
  const text = readFileSync(path, "utf8");
  if (!text.includes("PROPOSED — MAINTAINER GATE REQUIRED")) errors.push(`${rel(path)} lacks proposed gate`);
}

const requiredTicketSections = [
  "## Goal", "## Exact ownership", "## Preconditions", "## Forbidden scope",
  "## RED contract", "## Minimum GREEN", "## Acceptance ↔ tests",
  "## Verification", "## Stop and escalation", "## Completion evidence", "## Invalidation"
];
const tickets = new Map();
for (const path of ticketFiles) {
  const text = readFileSync(path, "utf8");
  const id = text.match(/^# ([A-Z0-9-]+) · /m)?.[1];
  if (!id) {
    errors.push(`${rel(path)} lacks canonical ticket heading`);
    continue;
  }
  if (tickets.has(id)) errors.push(`duplicate ticket id ${id}`);
  tickets.set(id, { path, text });
  const expectedStatus = id === "D0-003"
    ? "SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION"
    : "BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED";
  if (!text.includes(expectedStatus)) errors.push(`${id} lacks expected gate state`);
  for (const section of requiredTicketSections) if (!text.includes(section)) errors.push(`${id} lacks ${section}`);
  if (!/Expected pre-GREEN failure: .+\./.test(text)) errors.push(`${id} lacks expected RED reason`);
  if (!/AC-[A-Z0-9-]+-\d+ ↔/.test(text)) errors.push(`${id} lacks AC-test mapping`);
}

const dependencyGraph = new Map();
for (const [id, ticket] of tickets) {
  const value = ticket.text.match(/^- Dependencies: (.+)$/m)?.[1];
  if (!value) {
    errors.push(`${id} lacks dependency declaration`);
    continue;
  }
  const deps = value === "None" ? [] : value.split(",").map((entry) => entry.trim());
  dependencyGraph.set(id, deps);
  for (const dep of deps) if (!tickets.has(dep)) errors.push(`${id} unknown dependency ${dep}`);
}
const visiting = new Set();
const visited = new Set();
const visit = (id) => {
  if (visiting.has(id)) {
    errors.push(`dependency cycle at ${id}`);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dep of dependencyGraph.get(id) ?? []) visit(dep);
  visiting.delete(id);
  visited.add(id);
};
for (const id of dependencyGraph.keys()) visit(id);

const manifest = readJson(resolve(root, "docs/issues.json"), "issue manifest");
if (manifest) {
  if (manifest.schema_version !== 2) errors.push("issue manifest schema_version must be 2");
  if (manifest.milestones?.length !== 6) errors.push(`milestone count ${manifest.milestones?.length}, expected 6`);
  if (manifest.tickets?.length !== 65) errors.push(`issue ticket count ${manifest.tickets?.length}, expected 65`);
  const manifestIds = new Set(manifest.tickets?.map((ticket) => ticket.id));
  for (const id of tickets.keys()) if (!manifestIds.has(id)) errors.push(`issue manifest missing ${id}`);
}

const gateRegistryArgument = process.argv.find((argument) => argument.startsWith("--gate-registry="));
const requestedGateRegistryPath = gateRegistryArgument?.slice("--gate-registry=".length);
const gateAdministration = validateGateAdministration({ root, registryPath: requestedGateRegistryPath });
for (const error of gateAdministration.errors) errors.push(`Gate Administration ${error}`);

const forbidden = [
  new RegExp(["Agent", "Ops Score"].join(""), "g"),
  new RegExp(["agent", "ops-score"].join(""), "g"),
  new RegExp(["Agent ", "Leverage Index"].join(""), "g"),
  new RegExp("\\b" + ["A", "LI"].join("") + "\\b", "g"),
  new RegExp(["a", "li"].join("") + "-" + "bench", "g"),
  new RegExp("\\b" + ["AOS", "P0"].join("-") + "\\b", "g")
];
const activeFiles = walk(root).filter((path) => {
  const value = rel(path);
  return !value.startsWith(".git/") &&
    !value.startsWith("node_modules/") &&
    !value.startsWith("media/") &&
    !value.startsWith("state/") &&
    !value.includes("package-lock.json") &&
    !value.endsWith(".png") &&
    !value.endsWith(".jpg") &&
    !value.endsWith(".gif");
});
for (const path of activeFiles) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  for (const pattern of forbidden) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) errors.push(`legacy identifier ${pattern} in ${rel(path)}`);
  }
}

const controlPlaneAllowlist = new Set([
  "scripts/validate-planning.mjs",
  "tests/planning-contract.test.mjs",
  "scripts/validate-gate-administration.mjs",
  "tests/gate-administration-contract.test.mjs",
  "scripts/validate-identity.mjs",
  "tests/planning/identity.test.mjs"
]);
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const codeFiles = activeFiles.filter((path) => sourceExtensions.has(extname(path)));
const controlPlaneCodeFiles = codeFiles.filter((path) => controlPlaneAllowlist.has(rel(path)));
const productCodeFiles = codeFiles.filter((path) => !controlPlaneAllowlist.has(rel(path)));
if (productCodeFiles.length) errors.push(`unallowlisted product code: ${productCodeFiles.map(rel).join(", ")}`);

const readme = readFileSync(resolve(root, "README.md"), "utf8");
if (!readme.includes("Current status: planning baseline. Product not implemented.")) errors.push("README lacks exact planning truth");
if (!readme.includes("Planned CLI — not available yet")) errors.push("README blurs planned CLI status");
if (!readme.includes("65 atomic implementation tickets")) errors.push("README ticket census stale");

if (errors.length) {
  console.error(`PLANNING_CONTRACT_FAIL ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const mode = process.argv.includes("--build") ? "BUILD_SCAFFOLD" : "PLANNING_CONTRACT";
console.log(`${mode}_PASS adr=12 prd=19 tickets=65 milestones=6 product_code_files=${productCodeFiles.length} control_plane_code_files=${controlPlaneCodeFiles.length} control_plane_allowlist=${controlPlaneAllowlist.size} canonical_vectors=${metricIds.length} semantic_checks=not_yet_enforced gates=${gateAdministration.status}`);
