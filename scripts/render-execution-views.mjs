import { lstatSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
// The fixed wording as a line set: a roadmap header block may only hold lines that belong
// to this set, so captured prose is detected even when it contains no heading.
const ROADMAP_HEADER_LINES = new Set(ROADMAP_AUTHORITY_HEADER);

const checkMode = process.argv.includes("--check");
const errors = [];
const drifts = [];
// Authority conflicts: the catalog disagrees with a ticket contract about a field the
// board renders (id, epic, milestone, size, dependencies), or a ticket contract is
// missing, not a regular file, or unreadable. The ticket is the higher authority, so a
// conflict is an error in every mode. The line keeps the DRIFT output shape; only the
// tally moves to the error side, and nothing is written.
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
  // Marker lines are matched per line after trimming, never by substring or prefix: the
  // start line must equal the fixed marker string in full (no variable tail), and so must
  // the end line. Each marker must occur exactly once in the whole file, and the end
  // after the start.
  const startLine = startMarker(marker);
  const endLine = endMarker(marker);
  const starts = [];
  const ends = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === startLine) starts.push(index);
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
    // Split into lines while keeping each line's original terminator: on reassembly the
    // lines outside the generated block must reproduce their original bytes exactly, and
    // only the freshly rendered lines inside the block take the file's dominant line
    // ending. A repaired block must never rewrite unrelated bytes just because the line
    // ending differs.
    const parts = text.split(/(\r\n|\n|\r)/);
    const lines = [];
    const lineEols = [];
    for (let index = 0; index < parts.length; index += 2) {
      lines.push(parts[index]);
      lineEols.push(parts[index + 1] ?? "");
    }
    let crlfCount = 0;
    let lfCount = 0;
    for (const terminator of lineEols) {
      if (terminator === "\r\n") crlfCount += 1;
      else if (terminator !== "") lfCount += 1;
    }
    const eol = crlfCount > lfCount ? "\r\n" : "\n";
    const block = locateGeneratedBlock(surface.path, surface.marker, lines);
    if (!block) continue;
    // The generated block holds table rows and fixed wording; it never holds a heading.
    // A heading inside the block means the markers moved, and the authored prose between
    // them would be swallowed into the generated block on the next rewrite.
    if (lines.slice(block.start + 1, block.end).some((line) => /^#{1,6}\s/.test(line))) {
      pushError(`${surface.path} ${surface.marker} generated block contains a heading; markers are misplaced`);
      continue;
    }
    // The block may only hold content this renderer could have produced: Markdown table
    // rows for the board, lines of the fixed wording for the roadmap header. A marker
    // boundary that moved would capture outside prose and delete it on the rewrite, so
    // any line the renderer cannot produce fails every mode before anything is written.
    // Empty blocks are allowed: that is the state before the first render.
    const blockShape = surface.marker === "board-rows"
      ? (line) => /^\|.*\|$/.test(line)
      : (line) => ROADMAP_HEADER_LINES.has(line);
    const foreignLine = lines.slice(block.start + 1, block.end).find((line) => line !== "" && !blockShape(line));
    if (foreignLine !== undefined) {
      pushError(`${surface.path} ${surface.marker} generated block holds content this renderer could not have produced: ${foreignLine.slice(0, 60)}`);
      continue;
    }
    const expected = [startMarker(surface.marker), ...renderedContent.get(surface.marker), endMarker(surface.marker)];
    const drifted = lines.slice(block.start, block.end + 1).join("\n") !== expected.join("\n");
    if (drifted) pushDrift(`DRIFT ${surface.path} ${surface.marker} disk block differs from rendered block`);
    surfaceStates.push({ surface, lines, lineEols, block, expected, eol, drifted });
  }

  // Byte-for-byte catalog/ticket agreement on every field the board renders: id, epic,
  // milestone, size, and dependencies. The ticket contract is the higher authority, so a
  // disagreement is an authority conflict: an error in every mode, never repaired away
  // by a projection. The line keeps the DRIFT shape; only the tally changes.
  for (const record of catalog.tickets) {
    if (!isSafeTicketPath(record.ticket_path)) {
      pushError(`invalid ticket_path ${record.id} ${record.ticket_path}`);
      continue;
    }
    const resolved = resolve(root, record.ticket_path);
    const violation = physicalViolation(resolved);
    if (violation === "missing") {
      // A catalog entry whose ticket contract file does not exist would render a broken
      // link into the board, so a missing file is an authority conflict, not drift:
      // nothing is written in any mode.
      pushConflict(`ERROR missing ticket contract ${record.id} ${record.ticket_path}`);
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
    // A ticket contract must be a regular file the renderer can read: a directory or
    // device in its place would render a broken link into the board, and a read failure
    // hides the very contract the catalog claims. Both fail closed in every mode.
    let ticketStats;
    try {
      ticketStats = statSync(resolved);
    } catch {
      pushConflict(`ERROR cannot read ticket contract ${record.id} ${record.ticket_path}`);
      continue;
    }
    if (!ticketStats.isFile()) {
      pushConflict(`ERROR ticket contract is not a regular file ${record.id} ${record.ticket_path}`);
      continue;
    }
    let ticketText;
    try {
      ticketText = normalizeLf(readFileSync(resolved, "utf8"));
    } catch {
      pushConflict(`ERROR cannot read ticket contract ${record.id} ${record.ticket_path}`);
      continue;
    }
    // Exactly one space after the prefix is consumed, and the rest of the line is
    // compared byte-for-byte against the catalog value: leading or trailing whitespace
    // in the ticket line is a conflict, not something a trim silently heals. Every
    // declaration of a field is counted first: a field declared more than once is an
    // error even when the values agree, because the first line must not silently shadow
    // the rest; the value comparison runs only when there is exactly one declaration.
    const ticketLines = ticketText.split("\n");
    const sizeDeclarations = ticketLines.filter((line) => line.startsWith("- Size:"));
    if (sizeDeclarations.length === 0) {
      pushConflict(`DRIFT ${record.id} size catalog=${record.size} ticket=<missing line>`);
    } else if (sizeDeclarations.length > 1) {
      pushConflict(`ERROR duplicate size declaration ${record.id} count=${sizeDeclarations.length}`);
    } else {
      const sizeMatch = ticketText.match(/^- Size: (.*)$/m);
      if (!sizeMatch) {
        pushConflict(`DRIFT ${record.id} size catalog=${record.size} ticket=<missing line>`);
      } else {
        const ticketSize = sizeMatch[1].replace(/[\r\n]+$/, "");
        if (ticketSize !== record.size) {
          pushConflict(`DRIFT ${record.id} size catalog=${record.size} ticket=${ticketSize}`);
        }
      }
    }
    const dependencyDeclarations = ticketLines.filter((line) => line.startsWith("- Dependencies:"));
    if (dependencyDeclarations.length === 0) {
      pushConflict(`DRIFT ${record.id} dependencies catalog=${formatDependencies(record.dependencies)} ticket=<missing line>`);
    } else if (dependencyDeclarations.length > 1) {
      pushConflict(`ERROR duplicate dependencies declaration ${record.id} count=${dependencyDeclarations.length}`);
    } else {
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
    const epicDeclarations = ticketLines.filter((line) => line.startsWith("- Epic:"));
    if (epicDeclarations.length === 0) {
      pushConflict(`DRIFT ${record.id} epic catalog=${record.epic} ticket=<missing line>`);
    } else if (epicDeclarations.length > 1) {
      pushConflict(`ERROR duplicate epic declaration ${record.id} count=${epicDeclarations.length}`);
    } else {
      const epicMatch = ticketText.match(/^- Epic: (.*)$/m);
      if (!epicMatch) {
        pushConflict(`DRIFT ${record.id} epic catalog=${record.epic} ticket=<missing line>`);
      } else {
        const ticketEpic = epicMatch[1].replace(/[\r\n]+$/, "");
        if (ticketEpic !== record.epic) {
          pushConflict(`DRIFT ${record.id} epic catalog=${record.epic} ticket=${ticketEpic}`);
        }
      }
    }
    const milestoneDeclarations = ticketLines.filter((line) => line.startsWith("- Milestone:"));
    if (milestoneDeclarations.length === 0) {
      pushConflict(`DRIFT ${record.id} milestone catalog=${record.milestone} ticket=<missing line>`);
    } else if (milestoneDeclarations.length > 1) {
      pushConflict(`ERROR duplicate milestone declaration ${record.id} count=${milestoneDeclarations.length}`);
    } else {
      const milestoneMatch = ticketText.match(/^- Milestone: (.*)$/m);
      if (!milestoneMatch) {
        pushConflict(`DRIFT ${record.id} milestone catalog=${record.milestone} ticket=<missing line>`);
      } else {
        const ticketMilestone = milestoneMatch[1].replace(/[\r\n]+$/, "");
        if (ticketMilestone !== record.milestone) {
          pushConflict(`DRIFT ${record.id} milestone catalog=${record.milestone} ticket=${ticketMilestone}`);
        }
      }
    }
    // The board renders the id from the catalog, and the ticket document's title line
    // names the same id, so the two must agree like every other rendered field.
    const titleDeclarations = ticketLines.filter((line) => /^# /.test(line));
    if (titleDeclarations.length === 0) {
      pushConflict(`DRIFT ${record.id} id catalog=${record.id} ticket=<missing line>`);
    } else if (titleDeclarations.length > 1) {
      pushConflict(`ERROR duplicate id declaration ${record.id} count=${titleDeclarations.length}`);
    } else {
      const titleMatch = titleDeclarations[0].match(/^# (\S+) \u00b7 /);
      if (!titleMatch) {
        pushConflict(`DRIFT ${record.id} id catalog=${record.id} ticket=${titleDeclarations[0].slice(0, 60)}`);
      } else if (titleMatch[1] !== record.id) {
        pushConflict(`DRIFT ${record.id} id catalog=${record.id} ticket=${titleMatch[1]}`);
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
// writable before any file changes. Each write goes through a temp file in the target's
// own directory; all temp files are written first, then renamed one by one, and a failed
// rename rolls every already-renamed target back to the original bytes kept in memory.
if (!checkMode && surfaceStates.some((state) => state.drifted)) {
  for (const state of surfaceStates) {
    if (!state.drifted) continue;
    const blockLength = state.block.end - state.block.start + 1;
    state.lines.splice(state.block.start, blockLength, ...state.expected);
    // Lines outside the generated block keep their original terminators; only the fresh
    // lines inside the block take the file's dominant line ending.
    state.lineEols.splice(state.block.start, blockLength, ...state.expected.map(() => state.eol));
    state.newText = state.lines.map((line, index) => line + state.lineEols[index]).join("");
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
  // Keep each target's original bytes in memory before anything moves, so a failed
  // rename can be undone.
  const originals = new Map();
  for (const state of surfaceStates) {
    if (!state.drifted) continue;
    originals.set(state.surface.path, readFileSync(resolve(root, state.surface.path)));
  }
  const tempFiles = [];
  const tempBySurface = new Map();
  let writeFailed = false;
  for (const state of surfaceStates) {
    if (!state.drifted) continue;
    const target = resolve(root, state.surface.path);
    const temp = join(dirname(target), `.${basename(target)}.render-tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
    tempFiles.push(temp);
    tempBySurface.set(state.surface.path, temp);
    try {
      writeFileSync(temp, state.newText);
    } catch {
      pushError(`cannot write ${state.surface.path}`);
      writeFailed = true;
      break;
    }
  }
  if (!writeFailed) {
    const renamed = [];
    for (const state of surfaceStates) {
      if (!state.drifted) continue;
      const target = resolve(root, state.surface.path);
      try {
        renameSync(tempBySurface.get(state.surface.path), target);
        renamed.push(state.surface.path);
      } catch {
        pushError(`cannot write ${state.surface.path}`);
        // Roll back every target that was already renamed, using the original bytes kept
        // in memory; name any surface that cannot be restored.
        for (const renamedPath of renamed) {
          try {
            writeFileSync(resolve(root, renamedPath), originals.get(renamedPath));
          } catch {
            console.error(`ERROR rollback failed ${renamedPath} — this surface is left modified`);
          }
        }
        writeFailed = true;
        break;
      }
    }
  }
  for (const leftover of tempFiles) {
    try {
      unlinkSync(leftover);
    } catch {
      // Temp-file cleanup is best effort; successful renames consumed their temps.
    }
  }
  if (writeFailed) {
    for (const error of errors) console.error(`ERROR ${error}`);
    printSummary();
    process.exit(1);
  }
}

for (const drift of drifts) console.error(drift);
printSummary();
if (checkMode && drifts.length) process.exit(1);
