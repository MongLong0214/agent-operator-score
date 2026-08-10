import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));

const CATALOG_PATH = "docs/issues.json";
const RENDERER_PATH = "scripts/render-execution-views.mjs";
// Projections are rendered output, never state inputs: every surface keeps an explicit
// non-authority marker pair. The renderer rewrites the pair but never inserts it, so a
// missing marker is an error a human must resolve, not a silent scaffold.
const SURFACES = [
  { path: "docs/tickets/BOARD.md", marker: "board-rows" },
  { path: "docs/planning/AOS-EXECUTION-ROADMAP.md", marker: "roadmap-authority-header" }
];
// Fixed by contract: the roadmap header carries no branch SHA, ready set, or readiness
// verdict, so its rendered content is constant text rather than derived state.
const ROADMAP_AUTHORITY_HEADER = [
  "**STATIC SEQUENCING VIEW — NOT OPERATIONAL AUTHORITY.** This file carries no branch SHA, no ready",
  "set, and no readiness verdict. Before D0-004 is verified on `dev`, only a maintainer-approved",
  "exact-base execution packet authorizes work; after it is verified, only",
  "`npm run ops:status -- --strict --ticket <ID>` returning `readiness=ready` does. When a required",
  "external fact is unavailable the ready set is empty, and there is no fallback to this file."
];

const checkMode = process.argv.includes("--check");
const errors = [];
const drifts = [];
const pushError = (message) => errors.push(message);
const pushDrift = (message) => drifts.push(message);

const normalizeLf = (text) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const isInsideRoot = (path) => {
  const value = relative(root, path);
  return value !== "" && !value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value);
};
const readRepositoryText = (relativePath, label = relativePath) => {
  const resolved = resolve(root, relativePath);
  if (!isInsideRoot(resolved)) {
    pushError(`wrong target ${label}`);
    return null;
  }
  if (!existsSync(resolved)) {
    pushError(`missing ${label}`);
    return null;
  }
  try {
    return normalizeLf(readFileSync(resolved, "utf8"));
  } catch {
    pushError(`unreadable ${label}`);
    return null;
  }
};
const sameOrderedArray = (left, right) =>
  Array.isArray(left) && Array.isArray(right) &&
  left.length === right.length && left.every((value, index) => value === right[index]);
const formatDependencies = (dependencies) => (dependencies.length ? dependencies.join(",") : "None");
const parseTicketDependencyLine = (value) =>
  value.trim() === "None" ? [] : value.split(",").map((entry) => entry.trim()).filter(Boolean);

const startMarker = (marker) => `<!-- generated:${marker} start — rendered by ${RENDERER_PATH}; do not edit by hand -->`;
const endMarker = (marker) => `<!-- generated:${marker} end -->`;

const renderBoardRows = (tickets) => {
  const rows = [
    "| Ticket | Epic | Milestone | Size | Dependencies |",
    "|---|---|---|---:|---|"
  ];
  const ordered = [...tickets].sort((left, right) => left.issue - right.issue);
  const prefix = "docs/tickets/";
  for (const ticket of ordered) {
    const linkPath = ticket.ticket_path.startsWith(prefix) ? ticket.ticket_path.slice(prefix.length) : ticket.ticket_path;
    rows.push(`| [${ticket.id}](${linkPath}) | ${ticket.epic} | ${ticket.milestone} | ${ticket.size} | ${formatDependencies(ticket.dependencies)} |`);
  }
  return rows;
};

const locateGeneratedBlock = (relativePath, marker, lines) => {
  // The start line is located leniently so a hand-edited marker wording still counts as
  // drift instead of hiding the block; the end line is exact.
  const startPattern = new RegExp(`^<!-- generated:${marker} start.*-->$`);
  const endPattern = new RegExp(`^<!-- generated:${marker} end -->$`);
  const starts = [];
  const ends = [];
  lines.forEach((line, index) => {
    if (startPattern.test(line)) starts.push(index);
    if (endPattern.test(line)) ends.push(index);
  });
  if (starts.length === 0 || ends.length === 0 || starts[0] > ends[0]) {
    pushError(`missing generated marker ${marker} in ${relativePath}`);
    return null;
  }
  if (starts.length > 1 || ends.length > 1) {
    pushError(`ambiguous generated marker ${marker} in ${relativePath}`);
    return null;
  }
  return { start: starts[0], end: ends[0] };
};

const catalogText = readRepositoryText(CATALOG_PATH);
let catalog = null;
if (catalogText !== null) {
  try {
    catalog = JSON.parse(catalogText);
  } catch {
    pushError(`invalid JSON ${CATALOG_PATH}`);
  }
  if (catalog && !Array.isArray(catalog.tickets)) {
    pushError(`missing tickets array ${CATALOG_PATH}`);
    catalog = null;
  }
}

const renderedContent = catalog
  ? new Map([
    ["board-rows", renderBoardRows(catalog.tickets)],
    ["roadmap-authority-header", ROADMAP_AUTHORITY_HEADER]
  ])
  : null;

const surfaceStates = [];
if (renderedContent) {
  for (const surface of SURFACES) {
    const text = readRepositoryText(surface.path);
    if (text === null) continue;
    const lines = text.split("\n");
    const block = locateGeneratedBlock(surface.path, surface.marker, lines);
    if (!block) continue;
    const expected = [startMarker(surface.marker), ...renderedContent.get(surface.marker), endMarker(surface.marker)];
    surfaceStates.push({ surface, lines, block, expected });
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}

for (const state of surfaceStates) {
  const disk = state.lines.slice(state.block.start, state.block.end + 1);
  if (disk.join("\n") !== state.expected.join("\n")) {
    pushDrift(`DRIFT ${state.surface.path} ${state.surface.marker} disk block differs from rendered block`);
  }
}

// Byte-for-byte catalog/ticket agreement on size and dependency values. A projection can
// never repair a disagreement: both modes fail closed on it, and the write mode still
// renders so the drift stays visible rather than being masked by a stale surface.
for (const record of catalog.tickets) {
  const resolved = resolve(root, record.ticket_path);
  if (!isInsideRoot(resolved) || !existsSync(resolved)) {
    pushDrift(`DRIFT ${record.id} ticket_path catalog=${record.ticket_path} ticket=<missing file>`);
    continue;
  }
  let ticketText;
  try {
    ticketText = normalizeLf(readFileSync(resolved, "utf8"));
  } catch {
    pushDrift(`DRIFT ${record.id} ticket_path catalog=${record.ticket_path} ticket=<unreadable file>`);
    continue;
  }
  const sizeMatch = ticketText.match(/^- Size: (.+)$/m);
  if (!sizeMatch) {
    pushDrift(`DRIFT ${record.id} size catalog=${record.size} ticket=<missing line>`);
  } else if (sizeMatch[1] !== record.size) {
    pushDrift(`DRIFT ${record.id} size catalog=${record.size} ticket=${sizeMatch[1]}`);
  }
  const dependencyMatch = ticketText.match(/^- Dependencies: (.+)$/m);
  if (!dependencyMatch) {
    pushDrift(`DRIFT ${record.id} dependencies catalog=${formatDependencies(record.dependencies)} ticket=<missing line>`);
  } else {
    const ticketDependencies = parseTicketDependencyLine(dependencyMatch[1]);
    if (!sameOrderedArray(ticketDependencies, record.dependencies)) {
      pushDrift(`DRIFT ${record.id} dependencies catalog=${formatDependencies(record.dependencies)} ticket=${formatDependencies(ticketDependencies)}`);
    }
  }
}

if (!checkMode) {
  for (const state of surfaceStates) {
    const disk = state.lines.slice(state.block.start, state.block.end + 1);
    if (disk.join("\n") === state.expected.join("\n")) continue;
    state.lines.splice(state.block.start, state.block.end - state.block.start + 1, ...state.expected);
    writeFileSync(resolve(root, state.surface.path), state.lines.join("\n"));
  }
}

for (const drift of drifts) console.error(drift);
const label = checkMode ? "EXECUTION_VIEWS_CHECK" : "EXECUTION_VIEWS_RENDERED";
console.log(`${label} surfaces=${SURFACES.length} drift=${drifts.length}`);
if (drifts.length) process.exit(1);
