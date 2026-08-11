import { spawnSync } from "node:child_process";
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
const sameSet = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
};
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
const normalizeLf = (text) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const readText = (path, label = path) => {
  const resolved = resolveRepositoryPath(path, label);
  if (!resolved) return "";
  try {
    return normalizeLf(readFileSync(resolved, "utf8"));
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
// Only skip package/VCS trees. media/ and state/ are walked so source-extension
// files cannot hide from the product-code census via a top-level ignore.
const ignoredTopLevel = new Set([".git", "node_modules"]);
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
const isPositiveIssueNumber = (value) => typeof value === "number" && Number.isInteger(value) && value > 0;

const PLANNED_PATH_RE = /`((?:tests|packages|adapters|suites|conformance)\/[^`]+)`/g;
const isPlannedPathShape = (testPath) =>
  typeof testPath === "string" &&
  !testPath.startsWith("/") &&
  !testPath.split("/").includes("..") &&
  /^(tests|packages|adapters|suites|conformance)\//.test(testPath);

// Exact D0-003 historical-evidence contract. No other case-less/path-less edge may pass.
// Compare the entire normalized edge sentence, not a prefix.
const HISTORICAL_ACCEPTANCE_CONTRACT = Object.freeze({
  ticket_id: "D0-003",
  acceptance_id: "AC-D0-003-1",
  exact_edge: "historical evidence `PR #53`: active migration was completed before this planning baseline."
});
const normalizeAcceptanceEdge = (edge) =>
  typeof edge === "string" ? normalizeLf(edge).replace(/\s+/g, " ").trim() : "";
const isHistoricalAcceptanceContract = (ticketId, acceptanceId, edge) =>
  ticketId === HISTORICAL_ACCEPTANCE_CONTRACT.ticket_id &&
  acceptanceId === HISTORICAL_ACCEPTANCE_CONTRACT.acceptance_id &&
  normalizeAcceptanceEdge(edge) === HISTORICAL_ACCEPTANCE_CONTRACT.exact_edge;

// Extract path/case tokens from ticket prose only. Path is never reverse-looked-up from cases.
const parseTicketAcceptanceProse = (edge, { ticketId, acceptanceId } = {}) => {
  if (typeof edge !== "string" || !edge.trim()) {
    return { ok: false, reason: "malformed ticket acceptance edge" };
  }
  const pathTokens = [...edge.matchAll(PLANNED_PATH_RE)].map((match) => match[1]);
  if (pathTokens.length > 1) {
    if (new Set(pathTokens).size !== pathTokens.length) {
      return { ok: false, reason: "duplicate planned test path" };
    }
    return { ok: false, reason: "multiple planned test paths" };
  }
  const caseMatches = [...edge.matchAll(/\bcase(?:s)?\s+((?:`[^`]+`(?:\s*,\s*|\s+and\s+)?)+)/g)];
  const cases = [];
  for (const match of caseMatches) {
    for (const name of match[1].matchAll(/`([^`]+)`/g)) {
      const value = name[1].trim();
      if (!value || value.includes("/") || /\.(mjs|cjs|js|ts|tsx|jsx)$/.test(value)) {
        return { ok: false, reason: "malformed named test case" };
      }
      cases.push(value);
    }
  }
  if (cases.length && new Set(cases).size !== cases.length) {
    return { ok: false, reason: "duplicate named test case" };
  }
  const testPath = pathTokens[0] ?? null;
  if (testPath && !isPlannedPathShape(testPath)) {
    return { ok: false, reason: "malformed planned test path" };
  }
  // A stated planned path must name at least one case.
  if (testPath && !cases.length) {
    return { ok: false, reason: "malformed named test case" };
  }
  // Generic case-less/path-less prose fails closed. Only the exact historical contract may omit cases.
  if (!testPath && !cases.length) {
    if (isHistoricalAcceptanceContract(ticketId, acceptanceId, edge)) {
      return {
        ok: true,
        testPath: null,
        cases: [],
        proseHasPath: false,
        proseHasCases: false,
        historicalContract: true
      };
    }
    return { ok: false, reason: "malformed named test case" };
  }
  return {
    ok: true,
    testPath,
    cases,
    proseHasPath: Boolean(testPath),
    proseHasCases: cases.length > 0,
    historicalContract: false
  };
};

const collectTestCaseNames = (fileText) => {
  const names = new Set();
  for (const match of normalizeLf(fileText).matchAll(/\btest\(\s*(["'`])([^"'`]+)\1/g)) {
    names.add(match[2]);
  }
  return names;
};

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
if (adrFiles.length !== 13) pushError(`ADR count ${adrFiles.length}, expected 13`);
if (prdFiles.length !== 20) pushError(`PRD count ${prdFiles.length}, expected 20`);
if (ticketFiles.length !== 71) pushError(`ticket count ${ticketFiles.length}, expected 71`);

const adrs = new Map();
for (const path of adrFiles) {
  const text = normalizeLf(readFileSync(path, "utf8"));
  const id = text.match(/^# (ADR-\d{4}):/m)?.[1];
  if (!id) {
    pushError(`${rel(path)} lacks ADR heading`);
    continue;
  }
  if (adrs.has(id)) pushError(`duplicate ADR ${id}`);
  adrs.set(id, { path: rel(path), text });
  const expectedGate = id === "ADR-0013"
    ? "PROPOSED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED"
    : "PROPOSED — MAINTAINER GATE REQUIRED";
  if (!text.includes(expectedGate)) pushError(`${rel(path)} lacks expected proposed gate`);
}

const prds = new Map();
for (const path of prdFiles) {
  const text = normalizeLf(readFileSync(path, "utf8"));
  const id = text.match(/^# PRD ([A-Z0-9-]+) /m)?.[1];
  if (!id) {
    pushError(`${rel(path)} lacks PRD heading`);
    continue;
  }
  if (prds.has(id)) pushError(`duplicate PRD ${id}`);
  const dependencies = text.match(/^- Dependencies: (.+)$/m)?.[1];
  const requirements = section(text, "Functional and contract requirements").match(/^\d+\. .+$/gm) ?? [];
  const requirementKeys = (section(text, "Functional and contract requirements").match(/^(\d+)\. /gm) ?? [])
    .map((line) => line.match(/^(\d+)\./)?.[1])
    .filter(Boolean);
  const acceptanceIds = [...text.matchAll(/^- (AC-[A-Z0-9-]+): /gm)].map((match) => match[1]);
  const adrIds = [...(dependencies ?? "").matchAll(/(?:ADR-)?(\d{4})/g)].map((match) => `ADR-${match[1]}`);
  prds.set(id, { id, path: rel(path), text, dependencies, requirements, requirementKeys, acceptanceIds, adrIds });
  const expectedGate = id === "D0-GOV"
    ? "PROPOSED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED"
    : "PROPOSED — MAINTAINER GATE REQUIRED";
  if (!text.includes(expectedGate)) pushError(`${rel(path)} lacks expected proposed gate`);
  if (!dependencies || !requirements.length || !acceptanceIds.length) pushError(`semantic graph ${id} lacks required PRD edges`);
  if (new Set(acceptanceIds).size !== acceptanceIds.length) pushError(`semantic graph ${id} has duplicate acceptance IDs`);
  if (new Set(requirementKeys).size !== requirementKeys.length) pushError(`semantic graph ${id} has duplicate requirements`);
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
  const text = normalizeLf(readFileSync(path, "utf8"));
  const id = text.match(/^# ([A-Z0-9-]+) · /m)?.[1];
  if (!id) {
    pushError(`${rel(path)} lacks canonical ticket heading`);
    continue;
  }
  if (tickets.has(id)) pushError(`duplicate ticket id ${id}`);
  const prdHref = text.match(/^- Owning PRD: \[[^\]]+\]\(([^)]+)\)$/m)?.[1];
  const linkedPrdPath = prdHref ? rel(resolve(dirname(path), prdHref)) : null;
  const prd = [...prds.values()].find((candidate) => candidate.path === linkedPrdPath);
  const expectedStatus = id === "D0-003"
    ? "SUPERSEDED_BY_PLANNING_MIGRATION — NO IMPLEMENTATION"
    : prd?.id === "D0-GOV"
      ? "BLOCKED — OWNER-RATIFIED ONE-TIME GOVERNANCE REPAIR + CEO GATE REQUIRED"
      : "BLOCKED — ADR + PRD + TICKET MAINTAINER GATES REQUIRED";
  const epic = text.match(/^- Epic: (.+)$/m)?.[1];
  const milestone = text.match(/^- Milestone: (.+)$/m)?.[1];
  const size = text.match(/^- Size: (.+)$/m)?.[1];
  const dependencyText = text.match(/^- Dependencies: (.+)$/m)?.[1];
  const acceptanceLines = [...text.matchAll(/^- (AC-[A-Z0-9-]+) ↔ (.+)$/gm)].map((match) => ({
    id: match[1],
    edge: match[2],
    parsed: null
  }));
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
  if (new Set(acceptanceLines.map(({ id: value }) => value)).size !== acceptanceLines.length) {
    pushError(`semantic graph ${id} has duplicate ticket acceptance edges`);
  }
  for (const line of acceptanceLines) {
    if (id !== "D0-003" && !line.id.startsWith(`AC-${id}-`)) {
      pushError(`semantic graph ${id} has foreign acceptance ${line.id}`);
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

const plannedTestsByPath = new Map();
const referencedPlannedPairs = new Set(); // path\0case
const ticketAcceptanceBindings = new Map(); // ticket_id\0acceptance_id -> binding

if (!catalog || catalog.schema_version !== 2 || catalog.ssot !== "docs/north-star/agent-operator-score-ssot-v1.0.md" || !Array.isArray(catalog.prds)) {
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
    if (!sameSet(entry.adr_ids ?? [], prd.adrIds)) pushError(`semantic graph ${entry.id} ADR ownership diverges from catalog`);
    if (entry.requirement_count !== prd.requirements.length) pushError(`semantic graph ${entry.id} requirement count diverges from catalog`);
    if (!sameSet(entry.acceptance_ids ?? [], prd.acceptanceIds)) {
      pushError(`semantic graph ${entry.id} acceptance IDs diverge from catalog: expected ${(entry.acceptance_ids ?? []).join(",")} actual ${prd.acceptanceIds.join(",")}`);
    }
    const ownedTickets = [...tickets.values()].filter((ticket) => ticket.prd?.id === entry.id).map((ticket) => ticket.id).sort();
    const expectedTickets = Array.isArray(entry.ticket_ids) ? [...entry.ticket_ids].sort() : [];
    if (!sameArray(expectedTickets, ownedTickets)) pushError(`semantic graph ${entry.id} ticket ownership diverges from catalog`);

    // requirement → PRD AC edges
    if (!Array.isArray(entry.requirement_to_acceptance) || entry.requirement_to_acceptance.length !== prd.requirementKeys.length) {
      pushError(`semantic graph ${entry.id} missing requirement → acceptance edges`);
    } else {
      const coveredAcs = new Set();
      const seenReq = new Set();
      for (const edge of entry.requirement_to_acceptance) {
        if (!edge || typeof edge.requirement_key !== "string" || !Array.isArray(edge.acceptance_ids)) {
          pushError(`semantic graph ${entry.id} malformed requirement → acceptance edge`);
          continue;
        }
        if (seenReq.has(edge.requirement_key)) pushError(`semantic graph ${entry.id} duplicate requirement edge ${edge.requirement_key}`);
        seenReq.add(edge.requirement_key);
        if (!prd.requirementKeys.includes(edge.requirement_key)) {
          pushError(`semantic graph ${entry.id} orphan requirement edge ${edge.requirement_key}`);
        }
        if (!edge.acceptance_ids.length) pushError(`semantic graph ${entry.id} requirement ${edge.requirement_key} has empty acceptance binding`);
        if (new Set(edge.acceptance_ids).size !== edge.acceptance_ids.length) {
          pushError(`semantic graph ${entry.id} requirement ${edge.requirement_key} has duplicate acceptance binding`);
        }
        for (const ac of edge.acceptance_ids) {
          if (!prd.acceptanceIds.includes(ac)) pushError(`semantic graph ${entry.id} requirement edge references unknown acceptance ${ac}`);
          coveredAcs.add(ac);
        }
      }
      for (const key of prd.requirementKeys) {
        if (!seenReq.has(key)) pushError(`semantic graph ${entry.id} orphan requirement ${key}`);
      }
      for (const ac of prd.acceptanceIds) {
        if (!coveredAcs.has(ac)) pushError(`semantic graph ${entry.id} orphan PRD acceptance ${ac}`);
      }
    }

    // PRD AC → ticket edges
    if (!Array.isArray(entry.acceptance_to_tickets) || entry.acceptance_to_tickets.length !== prd.acceptanceIds.length) {
      pushError(`semantic graph ${entry.id} missing acceptance → ticket edges`);
    } else {
      const coveredTickets = new Set();
      const seenAc = new Set();
      for (const edge of entry.acceptance_to_tickets) {
        if (!edge || typeof edge.acceptance_id !== "string" || !Array.isArray(edge.ticket_ids)) {
          pushError(`semantic graph ${entry.id} malformed acceptance → ticket edge`);
          continue;
        }
        if (seenAc.has(edge.acceptance_id)) pushError(`semantic graph ${entry.id} duplicate acceptance edge ${edge.acceptance_id}`);
        seenAc.add(edge.acceptance_id);
        if (!prd.acceptanceIds.includes(edge.acceptance_id)) {
          pushError(`semantic graph ${entry.id} orphan acceptance edge ${edge.acceptance_id}`);
        }
        if (!edge.ticket_ids.length) pushError(`semantic graph ${entry.id} acceptance ${edge.acceptance_id} has empty ticket binding`);
        if (new Set(edge.ticket_ids).size !== edge.ticket_ids.length) {
          pushError(`semantic graph ${entry.id} acceptance ${edge.acceptance_id} has duplicate ticket binding`);
        }
        for (const ticketId of edge.ticket_ids) {
          if (!ownedTickets.includes(ticketId)) pushError(`semantic graph ${entry.id} acceptance edge references foreign ticket ${ticketId}`);
          coveredTickets.add(ticketId);
        }
      }
      for (const ac of prd.acceptanceIds) {
        if (!seenAc.has(ac)) pushError(`semantic graph ${entry.id} orphan PRD acceptance binding ${ac}`);
      }
      for (const ticketId of ownedTickets) {
        if (!coveredTickets.has(ticketId)) pushError(`semantic graph ${entry.id} orphan ticket ${ticketId} in acceptance bindings`);
      }
    }

    for (const adrId of entry.adr_ids ?? []) catalogAdrIds.add(adrId);
    for (const ticketId of entry.ticket_ids ?? []) {
      if (catalogTicketIds.has(ticketId)) pushError(`semantic graph duplicate ticket ownership ${ticketId}`);
      catalogTicketIds.add(ticketId);
    }
  }
  for (const id of prds.keys()) if (!catalogIds.has(id)) pushError(`semantic graph orphan PRD ${id}`);
  for (const id of tickets.keys()) if (!catalogTicketIds.has(id)) pushError(`semantic graph orphan ticket ${id}`);
  for (const id of adrs.keys()) if (!catalogAdrIds.has(id)) pushError(`semantic graph orphan ADR ${id}`);

  // Independent planned-test structure: unique path → exact named cases.
  if (!Array.isArray(catalog.planned_tests) || !catalog.planned_tests.length) {
    pushError("semantic graph missing planned_tests catalog");
  } else {
    for (const entry of catalog.planned_tests) {
      if (!entry || typeof entry.path !== "string" || !Array.isArray(entry.cases) || !entry.cases.length) {
        pushError("semantic graph malformed planned_tests entry");
        continue;
      }
      if (!isPlannedPathShape(entry.path)) {
        pushError(`semantic graph malformed planned test path ${entry.path}`);
        continue;
      }
      if (plannedTestsByPath.has(entry.path)) {
        pushError(`semantic graph duplicate planned test path ${entry.path}`);
        continue;
      }
      if (entry.cases.some((name) => typeof name !== "string" || !name || name.includes("/") || /\.(mjs|cjs|js|ts|tsx|jsx)$/.test(name))) {
        pushError(`semantic graph malformed named test case under ${entry.path}`);
        continue;
      }
      if (new Set(entry.cases).size !== entry.cases.length) {
        pushError(`semantic graph duplicate named test case under ${entry.path}`);
        continue;
      }
      plannedTestsByPath.set(entry.path, new Set(entry.cases));
    }
  }

  // Explicit ticket_id + acceptance_id → path + cases. No reverse case-name authority.
  // Each planned path + named case pair has exactly one owner binding.
  const plannedPairOwners = new Map(); // path\0case -> "ticket_id acceptance_id"
  if (!Array.isArray(catalog.ticket_acceptance_bindings)) {
    pushError("semantic graph missing ticket_acceptance_bindings");
  } else {
    for (const binding of catalog.ticket_acceptance_bindings) {
      if (
        !binding ||
        typeof binding.ticket_id !== "string" ||
        typeof binding.acceptance_id !== "string" ||
        typeof binding.test_path !== "string" ||
        !Array.isArray(binding.cases) ||
        !binding.cases.length
      ) {
        pushError("semantic graph malformed ticket acceptance binding");
        continue;
      }
      const key = `${binding.ticket_id}\0${binding.acceptance_id}`;
      if (ticketAcceptanceBindings.has(key)) {
        pushError(`semantic graph duplicate ticket acceptance binding ${binding.ticket_id} ${binding.acceptance_id}`);
        continue;
      }
      if (!isPlannedPathShape(binding.test_path)) {
        pushError(`semantic graph ${binding.ticket_id} acceptance ${binding.acceptance_id} malformed planned test path`);
        continue;
      }
      if (binding.cases.some((name) => typeof name !== "string" || !name || name.includes("/") || /\.(mjs|cjs|js|ts|tsx|jsx)$/.test(name))) {
        pushError(`semantic graph ${binding.ticket_id} acceptance ${binding.acceptance_id} malformed named test case`);
        continue;
      }
      if (new Set(binding.cases).size !== binding.cases.length) {
        pushError(`semantic graph ${binding.ticket_id} acceptance ${binding.acceptance_id} duplicate named test case`);
        continue;
      }
      for (const caseName of binding.cases) {
        const pairKey = `${binding.test_path}\0${caseName}`;
        if (plannedPairOwners.has(pairKey)) {
          pushError(
            `semantic graph duplicate planned test path/case ownership ${binding.test_path} :: ${caseName} ` +
            `(${plannedPairOwners.get(pairKey)} and ${binding.ticket_id} ${binding.acceptance_id})`
          );
          continue;
        }
        plannedPairOwners.set(pairKey, `${binding.ticket_id} ${binding.acceptance_id}`);
      }
      ticketAcceptanceBindings.set(key, binding);
    }
  }
}

// Exact ticket AC census + path/case equality with prose when prose states them.
const expectedTicketAcceptanceKeys = [];
for (const ticket of tickets.values()) {
  for (const line of ticket.acceptanceLines) {
    expectedTicketAcceptanceKeys.push(`${ticket.id}\0${line.id}`);
    const prose = parseTicketAcceptanceProse(line.edge, { ticketId: ticket.id, acceptanceId: line.id });
    line.prose = prose;
    if (!prose.ok) {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} ${prose.reason}`);
      continue;
    }
    const binding = ticketAcceptanceBindings.get(`${ticket.id}\0${line.id}`);
    if (!binding) {
      pushError(`semantic graph orphan ticket acceptance edge ${ticket.id} ${line.id}`);
      continue;
    }
    // Stated path/cases must equal the explicit binding. Case-only edges still require cases in prose.
    if (prose.proseHasPath && prose.testPath !== binding.test_path) {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} planned test path diverges from catalog binding`);
    }
    if (prose.proseHasCases && !sameSet(prose.cases, binding.cases)) {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} named test cases diverge from catalog binding`);
    }
    if (!prose.proseHasCases && !prose.historicalContract) {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} malformed named test case`);
      continue;
    }
    // Binding supplies path + cases; historical contract relies on the binding alone for path/cases.
    const plannedCases = plannedTestsByPath.get(binding.test_path);
    if (!plannedCases) {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} unknown planned test path ${binding.test_path}`);
      continue;
    }
    for (const caseName of binding.cases) {
      if (!plannedCases.has(caseName)) {
        pushError(`semantic graph ${ticket.id} acceptance ${line.id} named test case not in planned_tests: ${binding.test_path} :: ${caseName}`);
        continue;
      }
      referencedPlannedPairs.add(`${binding.test_path}\0${caseName}`);
    }
    const absolute = resolve(root, binding.test_path);
    if (!existsSync(absolute)) continue;
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} unreadable planned test path ${binding.test_path}`);
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} malformed planned test path ${binding.test_path}`);
      continue;
    }
    let names;
    try {
      names = collectTestCaseNames(readFileSync(absolute, "utf8"));
    } catch {
      pushError(`semantic graph ${ticket.id} acceptance ${line.id} unreadable planned test path ${binding.test_path}`);
      continue;
    }
    for (const caseName of binding.cases) {
      if (!names.has(caseName)) {
        pushError(`semantic graph ${ticket.id} acceptance ${line.id} named test case not found: ${binding.test_path} :: ${caseName}`);
      }
    }
  }
}

if (ticketAcceptanceBindings.size !== expectedTicketAcceptanceKeys.length) {
  pushError(`semantic graph ticket acceptance binding census ${ticketAcceptanceBindings.size}, expected ${expectedTicketAcceptanceKeys.length}`);
}
for (const key of ticketAcceptanceBindings.keys()) {
  if (!expectedTicketAcceptanceKeys.includes(key)) {
    const [ticketId, acceptanceId] = key.split("\0");
    pushError(`semantic graph orphan ticket acceptance binding ${ticketId} ${acceptanceId}`);
  }
}

// Orphan planned path/case: catalog entries never referenced by a ticket AC binding.
if (plannedTestsByPath.size) {
  for (const [path, cases] of plannedTestsByPath.entries()) {
    let pathReferenced = false;
    for (const caseName of cases) {
      if (referencedPlannedPairs.has(`${path}\0${caseName}`)) pathReferenced = true;
      else pushError(`semantic graph orphan planned test case ${path} :: ${caseName}`);
    }
    if (!pathReferenced) pushError(`semantic graph orphan planned test path ${path}`);
  }
}

const issueMapText = readText("docs/GITHUB-ISSUE-MAP.md");
const issueMap = new Map();
for (const line of issueMapText.split("\n")) {
  const match = line.match(/^\|\s*([A-Z0-9-]+)\s*\|\s*([^|]+?)\s*\|/);
  if (!match) continue;
  if (match[1] === "---") continue;
  if (issueMap.has(match[1])) pushError(`issue map duplicate ticket ${match[1]}`);
  const numeric = match[2].trim().match(/^\[#([1-9]\d*)\]\([^)]*\)$/);
  issueMap.set(match[1], numeric ? Number(numeric[1]) : match[2].trim());
}
if (issueMap.size !== tickets.size) pushError(`issue map count ${issueMap.size}, expected ${tickets.size}`);
for (const id of tickets.keys()) if (!issueMap.has(id)) pushError(`issue map missing ${id}`);

const manifest = readJson("docs/issues.json", "issue manifest");
const manifestRecordsById = new Map();
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
  const ticketPaths = new Set();
  const expectedKeys = new Set(["id", "title", "issue", "ticket_path", "milestone", "dependencies", "size", "epic", "kind", "initial_labels", "body_template"]);
  for (const record of manifest.tickets ?? []) {
    if (!record || typeof record.id !== "string" || manifestIds.has(record.id)) {
      pushError("issue manifest duplicate or malformed ticket");
      continue;
    }
    manifestIds.add(record.id);
    manifestRecordsById.set(record.id, record);
    const ticket = tickets.get(record.id);
    if (!ticket) {
      pushError(`issue manifest unknown ${record.id}`);
      continue;
    }
    const keys = Object.keys(record);
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
      pushError(`issue manifest ${record.id} is not a static catalog record`);
    }
    if (typeof record.ticket_path !== "string" || !record.ticket_path) {
      pushError(`issue manifest ${record.id} has malformed ticket_path`);
    } else if (ticketPaths.has(record.ticket_path)) {
      pushError(`issue manifest duplicate ticket_path ${record.ticket_path}`);
    } else {
      ticketPaths.add(record.ticket_path);
    }
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

const validateNumericBindings = (surface, getIssue) => {
  const numbers = new Set();
  for (const id of tickets.keys()) {
    const issue = getIssue(id);
    if (!isPositiveIssueNumber(issue)) {
      pushError(`${surface} ${id} has non-positive or malformed issue binding ${String(issue)}`);
      continue;
    }
    if (numbers.has(issue)) pushError(`${surface} duplicate issue number ${issue}`);
    numbers.add(issue);
  }
  if (numbers.size !== tickets.size) {
    pushError(`${surface} numeric binding count ${numbers.size}, expected ${tickets.size}`);
  }
};
validateNumericBindings("issue map", (id) => issueMap.get(id));
validateNumericBindings("issue manifest", (id) => manifestRecordsById.get(id)?.issue);

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
  "tests/planning/workspace-skeleton.test.mjs",
  "scripts/resolve-execution-state.mjs",
  "scripts/render-execution-views.mjs",
  "tests/execution-state.test.mjs"
]);
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

// Product code is admitted only where an atomic ticket claims it by exact path, either as
// owned scope or as its named RED test file. This is a claim check, not an acceptance
// check: it proves some ticket owns the file, not that the ticket has passed its gates.
// Readiness remains the resolver's job. There is no standing product-code allowlist to
// edit, and unowned source still fails closed.
const ticketOwnedPaths = new Set();
for (const path of ticketFiles) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  const ownership = /^## Exact ownership\s*$([\s\S]*?)^## /m.exec(text);
  for (const line of ownership ? ownership[1].split("\n") : []) {
    const bullet = /^- (.+)$/.exec(line.trim());
    if (!bullet) continue;
    for (const entry of bullet[1].split(/\s[—–-]\s/)[0].split(";")) {
      const candidate = entry.trim().replace(/^`|`$/g, "");
      if (sourceExtensions.has(extname(candidate))) ticketOwnedPaths.add(candidate);
    }
  }
  // A trailing period is ordinary prose and six of the sixty-eight tickets carry one, so a
  // pattern that stops at the backtick silently drops their RED file from the owned census.
  const redTest = /^- Test file: `([^`]+)`\.?\s*$/m.exec(text);
  if (redTest && sourceExtensions.has(extname(redTest[1]))) ticketOwnedPaths.add(redTest[1]);
}

const codeFiles = allFiles.filter((path) => sourceExtensions.has(extname(path)));
const controlPlaneCodeFiles = codeFiles.filter((path) => controlPlaneAllowlist.has(rel(path)));
const ticketOwnedCodeFiles = codeFiles.filter(
  (path) => !controlPlaneAllowlist.has(rel(path)) && ticketOwnedPaths.has(rel(path))
);
const productCodeFiles = codeFiles.filter(
  (path) => !controlPlaneAllowlist.has(rel(path)) && !ticketOwnedPaths.has(rel(path))
);
if (productCodeFiles.length) pushError(`unallowlisted product code: ${productCodeFiles.map(rel).sort().join(", ")}`);

const packageManifest = readJson("package.json", "root package manifest");
const readme = readText("README.md");
if (packageManifest?.name !== "agent-operator-score") pushError("root package has wrong canonical identity");
if (manifest?.repository !== "MongLong0214/agent-operator-score") pushError("issue manifest has wrong canonical identity");
if (!readme.includes("# Agent Operator Score (AOS)") || !readme.includes("`agent-operator-score`") || !readme.includes("`aos`")) {
  pushError("README lacks canonical identity consistency");
}
// The status line is pinned by exact text so the README cannot drift away from what is
// actually built. "Planning baseline. Product not implemented." stopped being true once
// packages/schema/src landed the metric registry and the scoring/issuance/capability/
// session-class contracts; the claim it is replaced by must stay equally exact.
if (!readme.includes("Current status: foundation contracts implemented in `@aos/schema`; no public CLI and no end-to-end assessment.")) {
  pushError("README lacks exact implementation-state truth");
}
if (!readme.includes("Planned CLI — not available yet")) pushError("README blurs planned CLI status");
if (!readme.includes("71 atomic implementation tickets")) pushError("README ticket census stale");
if (existsSync(resolve(root, "docs/north-star/legacy"))) pushError("legacy planning path is active");

// Banned wording. Two phrasings are prohibited: one asserting the absence of code, and one
// framing the repository as a mere planning exercise. Both have been used to conceal
// control-plane changes from review. The rule existed in prose with no enforcement and was
// violated four times in one day, including by the change that removed the earlier violations.
// The patterns below are assembled from fragments so this file does not itself contain either
// literal phrase and therefore does not trip its own guard.
const BANNED_WORDING = [
  new RegExp(["planning", "only"].join("[\\s-]+"), "i"),
  new RegExp(`\\b${["no", "code"].join("[\\s-]+")}\\b`, "i")
];
// Enumerate from git rather than walking the filesystem. An extension allowlist kept leaking —
// each round of review found another tracked artifact it skipped — and walking the tree also
// scanned untracked local scratch files, which would make this gate fail nondeterministically on
// a developer machine. `git ls-files` is exactly the set of tracked artifacts and needs no
// allowlist. Every tracked artifact is scanned as text; the repository tracks no binary blob, and
// admitting one would need this decision revisited rather than a silent skip that hides its bytes.
const trackedFiles = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
// Prefer git enumeration in a real checkout. Sibling tests copy this repository into a temporary
// fixture without its git metadata and run the validator there, so a filesystem walk is the correct
// behaviour when this is not a repository at all. It is NOT correct when git is present but the
// enumeration fails: that would silently swap a deterministic scan for a nondeterministic one, so
// it is an error. The two cases are distinguished rather than collapsed.
const insideRepository = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" }).status === 0;
// When git is unavailable the file set is not deterministic — sibling tests copy this repository
// into a fixture and a developer's untracked scratch file rides along — so the scan is skipped
// explicitly and says so, rather than scanning an unpredictable set. Enforcement happens in every
// real checkout, which is where it matters; silently scanning something different would be worse
// than not scanning.
let bannedWordingFiles = [];
let bannedWordingScanned = true;
if (!insideRepository) {
  // Not silent: the run states that the scan did not happen, so a passing gate never implies the
  // artifacts were checked. Enforcement binds in every real checkout.
  bannedWordingScanned = false;
  console.error("BANNED_WORDING_SCAN_SKIPPED no git metadata; tracked-file set is not determinable here");
} else if (trackedFiles.status === 0) {
  bannedWordingFiles = (trackedFiles.stdout ?? "").split("\u0000").filter(Boolean);
} else {
  pushError("git is present but tracked-file enumeration failed; the wording scan will not silently degrade");
}
for (const relativePath of bannedWordingFiles.sort()) {
  let text;
  try {
    text = readFileSync(resolve(root, relativePath), "utf8");
  } catch (error) {
    // Fail closed. A tracked artifact that cannot be read is not evidence of compliance.
    pushError(`cannot read tracked file for the wording scan: ${relativePath}`);
    continue;
  }
  for (const pattern of BANNED_WORDING) {
    const match = pattern.exec(text);
    if (!match) continue;
    const line = text.slice(0, match.index).split("\n").length;
    pushError(`banned wording in ${relativePath}:${line}`);
  }
}

if (errors.length) {
  console.error(`PLANNING_CONTRACT_FAIL ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const mode = process.argv.includes("--build") ? "BUILD_SCAFFOLD" : "PLANNING_CONTRACT";
const productPaths = productCodeFiles.length ? productCodeFiles.map(rel).sort().join(",") : "none";
const ticketOwnedPathsCensus = ticketOwnedCodeFiles.length ? ticketOwnedCodeFiles.map(rel).sort().join(",") : "none";
console.log(`${mode}_PASS adr=${adrFiles.length} prd=${prdFiles.length} tickets=${ticketFiles.length} milestones=${manifest?.milestones?.length ?? 0} product_code_files=${productCodeFiles.length} control_plane_code_files=${controlPlaneCodeFiles.length} control_plane_allowlist=${controlPlaneAllowlist.size} ticket_owned_code_files=${ticketOwnedCodeFiles.length} canonical_vectors=${metricIds.length} semantic_checks=static_catalog_enforced gates=${gateAdministration.status} product_code_paths=${productPaths} ticket_owned_code_paths=${ticketOwnedPathsCensus} banned_wording_scan=${bannedWordingScanned ? "on" : "skipped"}`);
