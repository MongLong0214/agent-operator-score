import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(resolve(fileURLToPath(new URL("..", import.meta.url))));
// Lexical containment cannot see through symlinks, so every path that is read or written is
// also resolved to its canonical location, which must stay under the repository root's
// canonical location. The root's canonical location is computed once and reused.
const rootRealPath = realpathSync(root);

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
// Authority conflicts: the catalog disagrees with a ticket contract about size or
// dependencies. The ticket is the higher authority, so a conflict is an error in every
// mode. The line keeps the DRIFT output shape; only the tally moves to the error side,
// and nothing is written.
const conflicts = [];
const pushError = (message) => errors.push(message);
const pushDrift = (message) => drifts.push(message);
const pushConflict = (message) => conflicts.push(message);

const normalizeLf = (text) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const isInsideRoot = (path) => {
  const value = relative(root, path);
  return value !== "" && !value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value);
};
// Physical guard for every path the renderer reads or writes. A symlink is rejected
// outright, and a path whose canonical location lands outside the repository root's
// canonical location is rejected as an escape. "missing" is returned when the target
// does not exist so callers keep their existing missing-target handling.
const physicalViolation = (resolved) => {
  let stats;
  try {
    stats = lstatSync(resolved);
  } catch {
    return "missing";
  }
  if (stats.isSymbolicLink()) return "symlink";
  let real;
  try {
    real = realpathSync(resolved);
  } catch {
    return "missing";
  }
  const value = relative(rootRealPath, real);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) return "escapes";
  return null;
};
const readRepositoryFile = (relativePath, label = relativePath) => {
  const resolved = resolve(root, relativePath);
  if (!isInsideRoot(resolved)) {
    pushError(`wrong target ${label}`);
    return null;
  }
  const violation = physicalViolation(resolved);
  if (violation === "missing") {
    pushError(`missing ${label}`);
    return null;
  }
  if (violation === "symlink") {
    pushError(`symlink not allowed ${label}`);
    return null;
  }
  if (violation === "escapes") {
    pushError(`path escapes repository ${label}`);
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
    // The generated block holds table rows and fixed wording; it never holds a heading.
    // A heading inside the block means the markers moved, and the authored prose between
    // them would be swallowed into the generated block on the next rewrite.
    if (lines.slice(block.start + 1, block.end).some((line) => /^#{1,6}\s/.test(line))) {
      pushError(`${surface.path} ${surface.marker} generated block contains a heading; markers are misplaced`);
      continue;
    }
    const expected = [startMarker(surface.marker), ...renderedContent.get(surface.marker), endMarker(surface.marker)];
    const drifted = lines.slice(block.start, block.end + 1).join("\n") !== expected.join("\n");
    if (drifted) pushDrift(`DRIFT ${surface.path} ${surface.marker} disk block differs from rendered block`);
    surfaceStates.push({ surface, lines, block, expected, eol, drifted });
  }

  // Byte-for-byte catalog/ticket agreement on size and dependency values. The ticket
  // contract is the higher authority, so a disagreement is an authority conflict: an
  // error in every mode, never repaired away by a projection. The line keeps the DRIFT
  // shape; only the tally changes.
  for (const record of catalog.tickets) {
    if (!isSafeTicketPath(record.ticket_path)) {
      pushError(`invalid ticket_path ${record.id} ${record.ticket_path}`);
      continue;
    }
    const resolved = resolve(root, record.ticket_path);
    const violation = physicalViolation(resolved);
    if (violation === "missing") {
      pushDrift(`DRIFT ${record.id} ticket_path catalog=${record.ticket_path} ticket=<missing file>`);
      continue;
    }
    if (violation === "symlink") {
      pushError(`symlink not allowed ${record.ticket_path}`);
      continue;
    }
    if (violation === "escapes") {
      pushError(`path escapes repository ${record.ticket_path}`);
      continue;
    }
    let ticketText;
    try {
      ticketText = normalizeLf(readFileSync(resolved, "utf8"));
    } catch {
      pushDrift(`DRIFT ${record.id} ticket_path catalog=${record.ticket_path} ticket=<unreadable file>`);
      continue;
    }
    // Exactly one space after the prefix is consumed, and the rest of the line is
    // compared byte-for-byte against the catalog value: leading or trailing whitespace
    // in the ticket line is a conflict, not something a trim silently heals.
    const sizeMatch = ticketText.match(/^- Size: (.*)$/m);
    if (!sizeMatch) {
      pushConflict(`DRIFT ${record.id} size catalog=${record.size} ticket=<missing line>`);
    } else {
      const ticketSize = sizeMatch[1].replace(/[\r\n]+$/, "");
      if (ticketSize !== record.size) {
        pushConflict(`DRIFT ${record.id} size catalog=${record.size} ticket=${ticketSize}`);
      }
    }
    const dependencyMatch = ticketText.match(/^- Dependencies: (.*)$/m);
    if (!dependencyMatch) {
      pushConflict(`DRIFT ${record.id} dependencies catalog=${formatDependencies(record.dependencies)} ticket=<missing line>`);
    } else {
      const ticketDependencies = dependencyMatch[1].replace(/[\r\n]+$/, "");
      if (ticketDependencies !== formatDependencies(record.dependencies)) {
        pushConflict(`DRIFT ${record.id} dependencies catalog=${formatDependencies(record.dependencies)} ticket=${ticketDependencies}`);
      }
    }
  }
}

// The summary names what was actually processed and verified: surfaces counts the
// surfaces that were read and validated, drift counts surface drift only, and conflicts
// counts authority conflicts between the catalog and the ticket contracts.
const printSummary = () => {
  const label = checkMode ? "EXECUTION_VIEWS_CHECK" : "EXECUTION_VIEWS_RENDERED";
  console.log(`${label} surfaces=${surfaceStates.length} drift=${drifts.length} conflicts=${conflicts.length}`);
};

// Authority conflicts and structural errors fail closed in every mode: everything found
// is reported, the summary still appears, and nothing is written.
if (errors.length || conflicts.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  for (const conflict of conflicts) console.error(conflict);
  for (const drift of drifts) console.error(drift);
  printSummary();
  process.exit(1);
}

// Phase 2 — write, only when phase 1 found nothing wrong and writing is requested. Every
// new content is computed in memory first, and every target directory proves it is
// writable before any file changes, so a failed second write can never leave the first
// surface already rewritten. Each write goes through a temp file in the target's own
// directory and a rename.
if (!checkMode && surfaceStates.some((state) => state.drifted)) {
  for (const state of surfaceStates) {
    state.lines.splice(state.block.start, state.block.end - state.block.start + 1, ...state.expected);
    state.newText = state.lines.join(state.eol);
  }
  const probes = [];
  for (const state of surfaceStates) {
    const target = resolve(root, state.surface.path);
    const probe = join(dirname(target), `.render-probe-${process.pid}-${probes.length}-${Math.random().toString(36).slice(2)}`);
    try {
      writeFileSync(probe, "");
      probes.push(probe);
    } catch {
      pushError(`cannot write ${state.surface.path}`);
    }
  }
  for (const probe of probes) {
    try {
      unlinkSync(probe);
    } catch {
      // Probe cleanup is best effort; a leftover probe does not hide the failure above.
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    printSummary();
    process.exit(1);
  }
  const tempFiles = [];
  for (const state of surfaceStates) {
    if (!state.drifted) continue;
    const target = resolve(root, state.surface.path);
    const temp = join(dirname(target), `.${basename(target)}.render-tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
    tempFiles.push(temp);
    try {
      writeFileSync(temp, state.newText);
      renameSync(temp, target);
    } catch {
      for (const leftover of tempFiles) {
        try {
          unlinkSync(leftover);
        } catch {
          // Temp-file cleanup is best effort; successful renames consumed their temps.
        }
      }
      console.error(`ERROR cannot write ${state.surface.path}`);
      printSummary();
      process.exit(1);
    }
    tempFiles.pop();
  }
}

for (const drift of drifts) console.error(drift);
printSummary();
if (checkMode && drifts.length) process.exit(1);
