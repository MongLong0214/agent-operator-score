import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const errors = [];
const required = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "docs/north-star/agent-operator-score-ssot-v1.0.md",
  "docs/adr/INDEX.md",
  "docs/prd/INDEX.md",
  "docs/tickets/BOARD.md",
  "docs/GITHUB-ISSUE-MAP.md",
  "docs/MILESTONES.md",
  "docs/TRACEABILITY.md",
  "docs/issues.json",
  "docs/decisions/SSOT-IMPORT-2026-08-05.md",
  "docs/decisions/CEO-GATE-STATUS.md"
];

for (const path of required) {
  if (!existsSync(resolve(root, path))) errors.push(`missing ${path}`);
}

const walk = (directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
};

const rel = (path) => path.slice(root.length + 1);
const adrFiles = walk(resolve(root, "docs/adr")).filter((p) => /ADR-\d{4}-.+\.md$/.test(p));
const prdFiles = walk(resolve(root, "docs/prd")).filter((p) => /PRD-(?:D0|E0[ABCD]|E\d+)-.+\.md$/.test(p));
const ticketFiles = walk(resolve(root, "docs/tickets")).filter((p) => /\/(?:D0|E0-[ABCD]|E\d+)\/[A-Z0-9-]+-.+\.md$/.test(p));

if (adrFiles.length !== 12) errors.push(`ADR count ${adrFiles.length}, expected 12`);
if (prdFiles.length !== 19) errors.push(`PRD count ${prdFiles.length}, expected 19`);
if (ticketFiles.length !== 65) errors.push(`ticket count ${ticketFiles.length}, expected 65`);

for (const path of adrFiles) {
  const text = readFileSync(path, "utf8");
  if (!text.includes("PROPOSED — CEO GATE REQUIRED")) errors.push(`${rel(path)} lacks proposed gate`);
}
for (const path of prdFiles) {
  const text = readFileSync(path, "utf8");
  if (!text.includes("PROPOSED — CEO GATE REQUIRED")) errors.push(`${rel(path)} lacks proposed gate`);
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
  if (!text.includes("BLOCKED — ADR + PRD + TICKET CEO GATES REQUIRED")) {
    errors.push(`${id} lacks blocked gate state`);
  }
  for (const section of requiredTicketSections) {
    if (!text.includes(section)) errors.push(`${id} lacks ${section}`);
  }
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
  const deps = value === "None" ? [] : value.split(",").map((v) => v.trim());
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

if (existsSync(resolve(root, "docs/issues.json"))) {
  const manifest = JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8"));
  if (manifest.schema_version !== 2) errors.push("issue manifest schema_version must be 2");
  if (manifest.milestones?.length !== 6) errors.push(`milestone count ${manifest.milestones?.length}, expected 6`);
  if (manifest.tickets?.length !== 65) errors.push(`issue ticket count ${manifest.tickets?.length}, expected 65`);
  const manifestIds = new Set(manifest.tickets?.map((ticket) => ticket.id));
  for (const id of tickets.keys()) if (!manifestIds.has(id)) errors.push(`issue manifest missing ${id}`);
}

const forbidden = [
  /AgentOps Score/g,
  /agentops-score/g,
  /Agent Leverage Index/g,
  /\bALI\b/g,
  /ali-bench/g,
  /\bAOS-P0\b/g
];
const activeFiles = walk(root).filter((path) => {
  const p = rel(path);
  const controlDocuments = new Set([
    "docs/north-star/agent-operator-score-ssot-v1.0.md",
    "docs/adr/ADR-0001-product-identity-and-legacy-boundary.md",
    "scripts/validate-planning.mjs"
  ]);
  return !p.startsWith(".git/") &&
    !p.startsWith("node_modules/") &&
    !p.startsWith("docs/north-star/legacy/") &&
    !controlDocuments.has(p) &&
    !p.startsWith("media/") &&
    !p.startsWith("state/") &&
    !p.includes("package-lock.json") &&
    !p.endsWith(".png") &&
    !p.endsWith(".jpg") &&
    !p.endsWith(".gif");
});
for (const path of activeFiles) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  for (const pattern of forbidden) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) errors.push(`legacy identifier ${pattern} in ${rel(path)}`);
  }
}

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
console.log(`${mode}_PASS adr=12 prd=19 tickets=65 milestones=6 product_code=0 gates=blocked`);
