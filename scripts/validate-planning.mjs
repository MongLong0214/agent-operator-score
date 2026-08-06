import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGateAdministration } from "./validate-gate-administration.mjs";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
const errors = [];
const pushError = (message) => errors.push(message);
const sameArray = (left, right) => Array.isArray(left) && Array.isArray(right) &&
  left.length === right.length && left.every((value, index) => value === right[index]);
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const isInsideRoot = (path) => {
  const value = relative(root, path);
  return value && !value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value);
};
const resolveRepositoryPath = (path, label = path) => {
  if (typeof path !== "string" || !path || isAbsolute(path)) {
    pushError(`wrong target ${label}`);
    return null;
  }
  const resolved = resolve(root, path);
  if (!isInsideRoot(resolved)) {
    pushError(`wrong target ${label}`);
    return null;
  }
  if (!existsSync(resolved)) {
    pushError(`missing ${label}`);
    return null;
  }
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    pushError(`unreadable ${label}`);
    return null;
  }
  if (stat.isSymbolicLink()) {
    pushError(`symlink not allowed ${label}`);
    return null;
  }
  const actual = realpathSync(resolved);
  if (!isInsideRoot(actual)) {
    pushError(`wrong target ${label}`);
    return null;
  }
  return actual;
};
const readText = (path, label = path) => {
  const resolved = resolveRepositoryPath(path, label);
  if (!resolved) return "";
  try {
    return readFileSync(resolved, "utf8");
  } catch {
    pushError(`unreadable ${label}`);
    return "";
  }
};
const readJson = (path, label) => {
  const text = readText(path, label);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    pushError(`invalid JSON ${label}`);
    return null;
  }
};
const rel = (path) => relative(root, path).split(sep).join("/");
const ignoredTopLevel = new Set([".git", "node_modules", "media", "state"]);
const walk = (directory = root) => {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    pushError(`unreadable directory ${rel(directory) || "."}`);
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (directory === root && ignoredTopLevel.has(entry.name)) continue;
    const path = join(directory, entry.name);
    const label = rel(path);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      pushError(`unreadable ${label}`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      pushError(`symlink not allowed ${label}`);
      continue;
    }
    if (stat.isDirectory()) files.push(...walk(path));
    else if (stat.isFile()) files.push(path);
  }
  return files;
};
const section = (text, heading) => text.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)\\n## `, "m"))?.[1] ?? "";
const parseDelimitedList = (value) => value === "None" ? [] : value.split(",").map((entry) => entry.trim()).filter(Boolean);

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
  "docs/decisions/maintainer-gate-registry.v2.json",
  "scripts/validate-gate-administration.mjs"
];
for (const path of required) resolveRepositoryPath(path);

const allFiles = walk();
const metricContract = readText("docs/contracts/metric-scoring-contract-v1.md");
const metricIds = Array.from({ length: 20 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);
for (const metricId of metricIds) {
  for (const state of ["pass", "partial", "fail", "no"]) {
    if (!metricContract.includes(`${metricId}-v1-${state}`)) pushError(`missing canonical vector ${metricId}-v1-${state}`);
  }
}
if (!metricContract.includes("maximum_regret=0")) pushError("missing M10 zero-regret vector");
if (!metricContract.includes("maximum_distance=0")) pushError("missing M20 zero-distance vector");

const adrFiles = allFiles.filter((path) => /^docs\/adr\/ADR-\d{4}-.+\.md$/.test(rel(path)));
const prdFiles = allFiles.filter((path) => /^docs\/prd\/PRD-(?:D0|E0[ABCD]|E\d+)-.+\.md$/.test(rel(path)));
const ticketFiles = allFiles.filter((path) => /^docs\/tickets\/(?:D0|E0-[ABCD]|E\d+)\/[A-Z0-9-]+-.+\.md$/.test(rel(path)));
if (adrFiles.length !== 12) pushError(`ADR count ${adrFiles.length}, expected 12`);
if (prdFiles.length !== 19) pushError(`PRD count ${prdFiles.length}, expected 19`);
if (ticketFiles.length !== 65) pushError(`ticket count ${ticketFiles.length}, expected 65`);

const adrs = new Map();
for (const path of adrFiles) {
  const text = readFileSync(path, "utf8");
  const id = text.match(/^# (ADR-\d{4}):/m)?.[1];
  if (!id) {
    pushError(`${rel(path)} lacks ADR heading`);
    continue;
  }
  if (adrs.has(id)) pushError(`duplicate ADR ${id}`);
  adrs.set(id, { path: rel(path), text });
  if (!text.includes("PROPOSED — MAINTAINER GATE REQUIRED")) pushError(`${rel(path)} lacks proposed gate`);
}

const prds = new Map();
for (const path of prdFiles) {
  const text = readFileSync(path, "utf8");
  const id = text.match(/^# PRD ([A-Z0-9-]+) /m)?.[1];
  if (!id) {
    pushError(`${rel(path)} lacks PRD heading`);
    continue;
  }
  if (prds.has(id)) pushError(`duplicate PRD ${id}`);
  const dependencies = text.match(/^- Dependencies: (.+)$/m)?.[1];
  const requirements = section(text, "Functional and contract requirements").match(/^\d+\. .+$/gm) ?? [];
  const acceptanceIds = [...text.matchAll(/^- (AC-[A-Z0-9-]+): /gm)].map((match) => match[1]);
  const adrIds = [...(dependencies ?? "").matchAll(/(?:ADR-)?(\d{4})/g)].map((match) => `ADR-${match[1]}`);
  prds.set(id, { id, path: rel(path), text, dependencies, requirements, acceptanceIds, adrIds });
  if (!text.includes("PROPOSED — MAINTAINER GATE REQUIRED")) pushError(`${rel(path)} lacks proposed gate`);
  if (!dependencies || !requirements.length || !acceptanceIds.length) pushError(`semantic graph ${id} lacks required PRD edges`);
  if (new Set(acceptanceIds).size !== acceptanceIds.length) pushError(`semantic graph ${id} has duplicate acceptance IDs`);
  for (const adrId of adrIds) if (!adrs.has(adrId)) pushError(`semantic graph ${id} unknown ADR ${adrId}`);
  if (!text.includes("docs/north-star/agent-operator-score-ssot-v1.0.md")) pushError(`semantic graph ${id} lacks SSOT authority`);
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
    pushError(`${rel(path)} lacks canonical ticket heading`);
    continue;
  }
  if (tickets.has(id)) pushError(`duplicate ticket id ${id}`);
  const expectedStatus = id === "D0-003"
    ? "SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION"
    : "BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED";
  const prdHref = text.match(/^- Owning PRD: \[[^\]]+\]\(([^)]+)\)$/m)?.[1];
  const linkedPrdPath = prdHref ? rel(resolve(dirname(path), prdHref)) : null;
  const prd = [...prds.values()].find((candidate) => candidate.path === linkedPrdPath);
  const epic = text.match(/^- Epic: (.+)$/m)?.[1];
  const milestone = text.match(/^- Milestone: (.+)$/m)?.[1];
  const size = text.match(/^- Size: (.+)$/m)?.[1];
  const dependencyText = text.match(/^- Dependencies: (.+)$/m)?.[1];
  const acceptanceLines = [...text.matchAll(/^- (AC-[A-Z0-9-]+) ↔ (.+)$/gm)].map((match) => ({ id: match[1], edge: match[2] }));
  tickets.set(id, {
    id,
    path: rel(path),
    text,
    prd,
    epic,
    milestone,
    size,
    dependencies: dependencyText ? parseDelimitedList(dependencyText) : [],
    acceptanceLines
  });
  if (!text.includes(expectedStatus)) pushError(`${id} lacks expected gate state`);
  for (const value of requiredTicketSections) if (!text.includes(value)) pushError(`${id} lacks ${value}`);
  if (!/Expected pre-GREEN failure: .+\./.test(text)) pushError(`${id} lacks expected RED reason`);
  if (!prd) pushError(`semantic graph ${id} lacks exact owning PRD link`);
  if (!epic || !milestone || !size || !dependencyText) pushError(`semantic graph ${id} lacks static ticket metadata`);
  if (!acceptanceLines.length) pushError(`semantic graph ${id} lacks ticket acceptance edges`);
  if (new Set(acceptanceLines.map(({ id: value }) => value)).size !== acceptanceLines.length) pushError(`semantic graph ${id} has duplicate ticket acceptance edges`);
  if (id !== "D0-003") {
    for (const { id: acceptanceId, edge } of acceptanceLines) {
      if (!acceptanceId.startsWith(`AC-${id}-`)) pushError(`semantic graph ${id} has foreign acceptance ${acceptanceId}`);
      if (!/case(?:s)? `[^`]+`/.test(edge)) pushError(`semantic graph ${id} acceptance ${acceptanceId} lacks named test case`);
    }
  }
}

const dependencyGraph = new Map();
for (const ticket of tickets.values()) {
  dependencyGraph.set(ticket.id, ticket.dependencies);
  for (const dependency of ticket.dependencies) if (!tickets.has(dependency)) pushError(`${ticket.id} unknown dependency ${dependency}`);
}
const visiting = new Set();
const visited = new Set();
const visit = (id) => {
  if (visiting.has(id)) {
    pushError(`dependency cycle at ${id}`);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of dependencyGraph.get(id) ?? []) visit(dependency);
  visiting.delete(id);
  visited.add(id);
};
for (const id of dependencyGraph.keys()) visit(id);

const traceability = readText("docs/TRACEABILITY.md");
const catalogText = traceability.match(/<!-- AOS_SEMANTIC_CATALOG_V2_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- AOS_SEMANTIC_CATALOG_V2_END -->/m)?.[1];
let catalog;
try {
  catalog = catalogText ? JSON.parse(catalogText) : null;
} catch {
  pushError("semantic graph invalid traceability catalog JSON");
}
if (!catalog || catalog.schema_version !== 1 || catalog.ssot !== "docs/north-star/agent-operator-score-ssot-v1.0.md" || !Array.isArray(catalog.prds)) {
  pushError("semantic graph missing canonical traceability catalog");
} else {
  if (catalog.prds.length !== prds.size) pushError(`semantic graph PRD catalog count ${catalog.prds.length}, expected ${prds.size}`);
  const catalogIds = new Set();
  const catalogTicketIds = new Set();
  const catalogAdrIds = new Set();
  for (const entry of catalog.prds) {
    if (!entry || typeof entry.id !== "string" || catalogIds.has(entry.id)) {
      pushError("semantic graph duplicate or malformed PRD catalog entry");
      continue;
    }
    catalogIds.add(entry.id);
    const prd = prds.get(entry.id);
    if (!prd) {
      pushError(`semantic graph catalog references unknown PRD ${entry.id}`);
      continue;
    }
    if (entry.path !== prd.path) pushError(`semantic graph ${entry.id} path diverges from catalog`);
    if (!sameArray(entry.adr_ids, prd.adrIds)) pushError(`semantic graph ${entry.id} ADR ownership diverges from catalog`);
    if (entry.requirement_count !== prd.requirements.length) pushError(`semantic graph ${entry.id} requirement count diverges from catalog`);
    if (!sameArray(entry.acceptance_ids, prd.acceptanceIds)) pushError(`semantic graph ${entry.id} acceptance IDs diverge from catalog: expected ${(entry.acceptance_ids ?? []).join(",")} actual ${prd.acceptanceIds.join(",")}`);
    const ownedTickets = [...tickets.values()].filter((ticket) => ticket.prd?.id === entry.id).map((ticket) => ticket.id).sort();
    const expectedTickets = Array.isArray(entry.ticket_ids) ? [...entry.ticket_ids].sort() : [];
    if (!sameArray(expectedTickets, ownedTickets)) pushError(`semantic graph ${entry.id} ticket ownership diverges from catalog`);
    for (const adrId of entry.adr_ids ?? []) catalogAdrIds.add(adrId);
    for (const ticketId of entry.ticket_ids ?? []) {
      if (catalogTicketIds.has(ticketId)) pushError(`semantic graph duplicate ticket ownership ${ticketId}`);
      catalogTicketIds.add(ticketId);
    }
  }
  for (const id of prds.keys()) if (!catalogIds.has(id)) pushError(`semantic graph orphan PRD ${id}`);
  for (const id of tickets.keys()) if (!catalogTicketIds.has(id)) pushError(`semantic graph orphan ticket ${id}`);
  for (const id of adrs.keys()) if (!catalogAdrIds.has(id)) pushError(`semantic graph orphan ADR ${id}`);
}

const issueMapText = readText("docs/GITHUB-ISSUE-MAP.md");
const issueMap = new Map();
for (const line of issueMapText.split("\n")) {
  const match = line.match(/^\|\s*([A-Z0-9-]+)\s*\|\s*\[#(\d+)\]/);
  if (!match) continue;
  if (issueMap.has(match[1])) pushError(`issue map duplicate ticket ${match[1]}`);
  issueMap.set(match[1], Number(match[2]));
}
if (issueMap.size !== tickets.size) pushError(`issue map count ${issueMap.size}, expected ${tickets.size}`);
for (const id of tickets.keys()) if (!issueMap.has(id)) pushError(`issue map missing ${id}`);

const manifest = readJson("docs/issues.json", "issue manifest");
if (manifest) {
  if (manifest.schema_version !== 2) pushError("issue manifest schema_version must be 2");
  if (manifest.authority !== "docs/north-star/agent-operator-score-ssot-v1.0.md") pushError("issue manifest has wrong SSOT authority");
  if (manifest.repository !== "MongLong0214/agent-operator-score") pushError("issue manifest has wrong repository identity");
  if (manifest.milestones?.length !== 6) pushError(`milestone count ${manifest.milestones?.length}, expected 6`);
  if (manifest.tickets?.length !== tickets.size) pushError(`issue ticket count ${manifest.tickets?.length}, expected ${tickets.size}`);
  const operationalPolicyText = tickets.get("D0-004")?.text.match(/## Single-owner actor policy[\s\S]*?```json\n([\s\S]*?)\n```/)?.[1];
  let operationalPolicy;
  try {
    operationalPolicy = operationalPolicyText ? JSON.parse(operationalPolicyText) : null;
  } catch {
    pushError("D0-004 operational authority is malformed");
  }
  if (!operationalPolicy || stableJson(manifest.operational_authority) !== stableJson(operationalPolicy)) {
    pushError("issue manifest operational_authority diverges from D0-004 ticket");
  }
  const definedLabels = new Set(manifest.labels?.map(({ name }) => name));
  const manifestIds = new Set();
  for (const record of manifest.tickets ?? []) {
    if (!record || typeof record.id !== "string" || manifestIds.has(record.id)) {
      pushError("issue manifest duplicate or malformed ticket");
      continue;
    }
    manifestIds.add(record.id);
    const ticket = tickets.get(record.id);
    if (!ticket) {
      pushError(`issue manifest unknown ${record.id}`);
      continue;
    }
    const expectedKeys = ["id", "title", "issue", "ticket_path", "milestone", "dependencies", "size", "epic", "kind", "initial_labels", "body_template"];
    if (!sameArray(Object.keys(record), expectedKeys)) pushError(`issue manifest ${record.id} is not a static catalog record`);
    if (record.issue !== issueMap.get(record.id)) pushError(`issue map and manifest disagree for ${record.id}`);
    if (record.ticket_path !== ticket.path) pushError(`issue manifest ${record.id} has wrong ticket_path`);
    if (record.milestone !== ticket.milestone || !sameArray(record.dependencies, ticket.dependencies) || record.size !== ticket.size || record.epic !== ticket.epic) {
      pushError(`issue manifest ${record.id} diverges from exact ticket metadata`);
    }
    const expectedKind = record.id === "D0-003" ? "superseded" : "executable";
    if (record.kind !== expectedKind) pushError(`issue manifest ${record.id} has wrong kind`);
    if (typeof record.body_template !== "string" || !record.body_template.trim()) pushError(`issue manifest ${record.id} lacks body_template`);
    if (!Array.isArray(record.initial_labels) || record.initial_labels.some((label) => label.startsWith("status:"))) pushError(`issue manifest ${record.id} has dynamic status label`);
    for (const label of record.initial_labels ?? []) if (!definedLabels.has(label)) pushError(`issue manifest ${record.id} unknown initial label ${label}`);
    const phase = record.milestone.match(/^(S\d)/)?.[1];
    for (const label of [`epic:${record.epic}`, `phase:${phase}`, `size:${record.size}`]) {
      if (!record.initial_labels?.includes(label)) pushError(`issue manifest ${record.id} missing initial label ${label}`);
    }
  }
  for (const id of tickets.keys()) if (!manifestIds.has(id)) pushError(`issue manifest missing ${id}`);
}

const board = readText("docs/tickets/BOARD.md");
const boardRows = new Map();
for (const line of board.split("\n")) {
  const match = line.match(/^\| \[([A-Z0-9-]+)\]\(([^)]+)\) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
  if (!match) continue;
  const [, id, path, epic, milestone, size, dependencies] = match.map((value) => value?.trim());
  if (boardRows.has(id)) pushError(`board duplicate ticket ${id}`);
  boardRows.set(id, { path: `docs/tickets/${path}`, epic, milestone, size, dependencies: parseDelimitedList(dependencies) });
}
if (boardRows.size !== tickets.size) pushError(`board ticket count ${boardRows.size}, expected ${tickets.size}`);
for (const ticket of tickets.values()) {
  const row = boardRows.get(ticket.id);
  if (!row) {
    pushError(`board missing ${ticket.id}`);
    continue;
  }
  if (row.path !== ticket.path || row.epic !== ticket.epic || row.milestone !== ticket.milestone || row.size !== ticket.size || !sameArray(row.dependencies, ticket.dependencies)) {
    pushError(`board and exact ticket disagree for ${ticket.id}`);
  }
}

const gateRegistryArgument = process.argv.find((argument) => argument.startsWith("--gate-registry="));
if (gateRegistryArgument) pushError("Gate Administration registry override is not supported; canonical registry only");
const gateRegistry = readJson("docs/decisions/maintainer-gate-registry.v2.json", "gate registry");
if (gateRegistry?.batches) {
  for (const batch of gateRegistry.batches.filter((candidate) => candidate.status === "ACCEPTED")) {
    const artifacts = [...(batch.required_artifacts ?? []), ...(batch.artifacts ?? [])];
    if (!artifacts.length) pushError(`accepted gate batch ${batch.id} has no digest artifacts`);
    for (const artifact of artifacts) {
      const path = resolveRepositoryPath(artifact.path, `gate digest ${batch.id}`);
      if (!path) continue;
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "") || digest !== artifact.sha256) {
        pushError(`stale digest ${batch.id} ${artifact.path}`);
      }
    }
  }
}
const gateAdministration = validateGateAdministration();
for (const error of gateAdministration.errors) pushError(`Gate Administration ${error}`);

const forbidden = [
  new RegExp(["Agent", "Ops Score"].join(""), "g"),
  new RegExp(["agent", "ops-score"].join(""), "g"),
  new RegExp(["Agent ", "Leverage Index"].join(""), "g"),
  new RegExp("\\b" + ["A", "LI"].join("") + "\\b", "g"),
  new RegExp(["a", "li"].join("") + "-" + "bench", "g"),
  new RegExp("\\b" + ["AOS", "P0"].join("-") + "\\b", "g")
];
for (const path of allFiles) {
  const value = rel(path);
  if (value.includes("package-lock.json") || /\.(png|jpg|gif)$/.test(value)) continue;
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  for (const pattern of forbidden) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) pushError(`legacy identifier ${pattern} in ${value}`);
  }
}

const controlPlaneAllowlist = new Set([
  "scripts/validate-planning.mjs",
  "tests/planning-contract.test.mjs",
  "scripts/validate-gate-administration.mjs",
  "tests/gate-administration-contract.test.mjs",
  "scripts/validate-identity.mjs",
  "tests/planning/identity.test.mjs",
  "tests/planning/workspace-skeleton.test.mjs"
]);
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const codeFiles = allFiles.filter((path) => sourceExtensions.has(extname(path)));
const controlPlaneCodeFiles = codeFiles.filter((path) => controlPlaneAllowlist.has(rel(path)));
const productCodeFiles = codeFiles.filter((path) => !controlPlaneAllowlist.has(rel(path)));
if (productCodeFiles.length) pushError(`unallowlisted product code: ${productCodeFiles.map(rel).sort().join(", ")}`);

const packageManifest = readJson("package.json", "root package manifest");
const readme = readText("README.md");
if (packageManifest?.name !== "agent-operator-score") pushError("root package has wrong canonical identity");
if (manifest?.repository !== "MongLong0214/agent-operator-score") pushError("issue manifest has wrong canonical identity");
if (!readme.includes("# Agent Operator Score (AOS)") || !readme.includes("`agent-operator-score`") || !readme.includes("`aos`")) {
  pushError("README lacks canonical identity consistency");
}
if (!readme.includes("Current status: planning baseline. Product not implemented.")) pushError("README lacks exact planning truth");
if (!readme.includes("Planned CLI — not available yet")) pushError("README blurs planned CLI status");
if (!readme.includes("65 atomic implementation tickets")) pushError("README ticket census stale");
if (existsSync(resolve(root, "docs/north-star/legacy"))) pushError("legacy planning path is active");

if (errors.length) {
  console.error(`PLANNING_CONTRACT_FAIL ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const mode = process.argv.includes("--build") ? "BUILD_SCAFFOLD" : "PLANNING_CONTRACT";
const productPaths = productCodeFiles.length ? productCodeFiles.map(rel).sort().join(",") : "none";
console.log(`${mode}_PASS adr=${adrFiles.length} prd=${prdFiles.length} tickets=${ticketFiles.length} milestones=${manifest?.milestones?.length ?? 0} product_code_files=${productCodeFiles.length} control_plane_code_files=${controlPlaneCodeFiles.length} control_plane_allowlist=${controlPlaneAllowlist.size} canonical_vectors=${metricIds.length} semantic_checks=static_catalog_enforced gates=${gateAdministration.status} product_code_paths=${productPaths}`);
