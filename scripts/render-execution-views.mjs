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
const readRepositoryFile = (relativePath, label = relativePath) => {
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
    return readFileSync(resolved, "utf8");
  } catch {
    pushError(`unreadable ${label}`);
    return null;
  }
};
const formatDependencies = (dependencies) => (dependencies.length ? dependencies.join(",") : "None");
// A ticket_path is rejected on its raw string, before resolve() ever interprets it:
// absolute paths, `.`/`..` segments, backslashes, and paths outside docs/tickets/ are
// never normalized into acceptance.
const isSafeTicketPath = (raw) => {
  if (typeof raw !== "string") return false;
  if (raw.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(raw)) return false;
  if (raw.includes("\\")) return false;
  if (!raw.startsWith("docs/tickets/")) return false;
  return !raw.split("/").some((segment) => segment === "." || segment === "..");
};

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
  // Marker lines are matched per line after trimming, never by substring: the start line
  // by its fixed prefix (the comment tail may vary), the end line by exact equality. Each
  // marker must occur exactly once in the whole file, and the end after the start.
  const startPrefix = `<!-- generated:${marker} start`;
  const endLine = endMarker(marker);
  const starts = [];
  const ends = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(startPrefix)) starts.push(index);
    if (trimmed === endLine) ends.push(index);
  });
  if (starts.length !== 1) {
    pushError(`${relativePath} ${marker} expected exactly one start marker, found ${starts.length}`);
  }
  if (ends.length !== 1) {
    pushError(`${relativePath} ${marker} expected exactly one end marker, found ${ends.length}`);
  }
  if (starts.length !== 1 || ends.length !== 1) return null;
  if (ends[0] <= starts[0]) {
    pushError(`${relativePath} ${marker} end marker appears before start marker`);
    return null;
  }
  return { start: starts[0], end: ends[0] };
};

// Phase 1 — validate and compute; nothing is written here. Any error fails closed before
// a single file changes, so a surface can never be left partially rewritten.
const catalogText = readRepositoryFile(CATALOG_PATH);
let catalog = null;
if (catalogText !== null) {
  try {
    catalog = JSON.parse(normalizeLf(catalogText));
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
    const text = readRepositoryFile(surface.path);
    if (text === null) continue;
    // Remember the file's dominant line ending and restore it on write; a repaired block
    // must never rewrite unrelated bytes just because the line ending differs.
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r\n|\n|\r/);
    const block = locateGeneratedBlock(surface.path, surface.marker, lines);
    if (!block) continue;
    const expected = [startMarker(surface.marker), ...renderedContent.get(surface.marker), endMarker(surface.marker)];
    const drifted = lines.slice(block.start, block.end + 1).join("\n") !== expected.join("\n");
    if (drifted) pushDrift(`DRIFT ${surface.path} ${surface.marker} disk block differs from rendered block`);
    surfaceStates.push({ surface, lines, block, expected, eol, drifted });
  }

  // Byte-for-byte catalog/ticket agreement on size and dependency values. A projection can
  // never repair a disagreement: both modes fail closed on it.
  for (const record of catalog.tickets) {
    if (!isSafeTicketPath(record.ticket_path)) {
      pushError(`invalid ticket_path ${record.id} ${record.ticket_path}`);
      continue;
    }
    const resolved = resolve(root, record.ticket_path);
    if (!existsSync(resolved)) {
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
    } else if (sizeMatch[1].trim() !== record.size) {
      pushDrift(`DRIFT ${record.id} size catalog=${record.size} ticket=${sizeMatch[1].trim()}`);
    }
    const dependencyMatch = ticketText.match(/^- Dependencies: (.+)$/m);
    if (!dependencyMatch) {
      pushDrift(`DRIFT ${record.id} dependencies catalog=${formatDependencies(record.dependencies)} ticket=<missing line>`);
    } else {
      const ticketDependencies = dependencyMatch[1].trim();
      if (ticketDependencies !== formatDependencies(record.dependencies)) {
        pushDrift(`DRIFT ${record.id} dependencies catalog=${formatDependencies(record.dependencies)} ticket=${ticketDependencies}`);
      }
    }
  }
}

// Phase 2 — write, only when phase 1 found no error and writing is requested. Repairing
// drift is the purpose of the write mode, so a successful repair exits 0.
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}

if (!checkMode) {
  for (const state of surfaceStates) {
    if (!state.drifted) continue;
    state.lines.splice(state.block.start, state.block.end - state.block.start + 1, ...state.expected);
    writeFileSync(resolve(root, state.surface.path), state.lines.join(state.eol));
  }
}

for (const drift of drifts) console.error(drift);
const label = checkMode ? "EXECUTION_VIEWS_CHECK" : "EXECUTION_VIEWS_RENDERED";
console.log(`${label} surfaces=${SURFACES.length} drift=${drifts.length}`);
if (checkMode && drifts.length) process.exit(1);
