import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePrefix = "aos-execution-views-";
const rendererPath = "scripts/render-execution-views.mjs";
const boardPath = "docs/tickets/BOARD.md";
const roadmapPath = "docs/planning/AOS-EXECUTION-ROADMAP.md";
const ledgerPath = "docs/planning/issue-resolution-ledger-2026-08-06.md";
const expectedCheckSummary = "EXECUTION_VIEWS_CHECK surfaces=2 drift=0 conflicts=0\n";
const rendererTimeoutMs = 10_000;
const rendererEnvironment = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => !["NODE_DEBUG", "NODE_DEBUG_NATIVE", "NODE_OPTIONS"].includes(key))
);

const startMarker = (marker) => `<!-- generated:${marker} start — rendered by scripts/render-execution-views.mjs; do not edit by hand -->`;
const endMarker = (marker) => `<!-- generated:${marker} end -->`;

const clip = (value) => value.length <= 600 ? value : `${value.slice(0, 600)}…`;
const byteDigest = (value) => createHash("sha256").update(value).digest("hex");
const assertBytesEqual = (actual, expected, message) => {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  assert.equal(
    actualBytes.equals(expectedBytes),
    true,
    `${message}: actual_bytes=${actualBytes.length} actual_sha256=${byteDigest(actualBytes)} expected_bytes=${expectedBytes.length} expected_sha256=${byteDigest(expectedBytes)}`
  );
};
const resultSummary = (result) => [
  `status=${String(result.status)}`,
  `signal=${String(result.signal)}`,
  `timedOut=${String(result.timedOut)}`,
  `error=${String(result.error)}`,
  `errorCode=${String(result.errorCode)}`,
  `stdout=${JSON.stringify(clip(result.stdout))}`,
  `stderr=${JSON.stringify(clip(result.stderr))}`
].join(" ");

const isOwnedTempRoot = (target) => {
  const lexical = resolve(target);
  let entry;
  try {
    entry = lstatSync(lexical);
  } catch {
    return false;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) return false;

  let canonical;
  let canonicalTempRoot;
  try {
    canonical = realpathSync(lexical);
    canonicalTempRoot = realpathSync(resolve(tmpdir()));
  } catch {
    return false;
  }
  const relation = relative(canonicalTempRoot, canonical);
  return relation !== ""
    && relation !== ".."
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation)
    && basename(canonical).startsWith(fixturePrefix);
};

const cleanupFixture = (tempRoot) => {
  try {
    if (!isOwnedTempRoot(tempRoot)) {
      process.emitWarning("execution-view fixture cleanup skipped because its temporary root could not be verified");
      return;
    }
    // Remove the already-verified lexical path: another realpath lookup here could follow a
    // swapped symlink, while rmSync unlinks a substituted symlink instead of walking it.
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (error) {
    // Cleanup must not hide the assertion that established the test result.
    process.emitWarning(`execution-view fixture cleanup failed: ${clip(String(error?.message ?? error))}`);
  }
};

const copyIntoFixture = (fixture, sourcePath) => {
  const destination = resolve(fixture, sourcePath);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(resolve(root, sourcePath), destination, { recursive: true });
};

const createFixture = () => {
  const tempRoot = mkdtempSync(join(tmpdir(), fixturePrefix));
  try {
    assert.ok(isOwnedTempRoot(tempRoot), `fixture root is not a verified temp root: ${tempRoot}`);
    const fixture = join(tempRoot, "repository");
    mkdirSync(fixture);
    copyIntoFixture(fixture, rendererPath);
    copyIntoFixture(fixture, "docs/issues.json");
    copyIntoFixture(fixture, "docs/tickets");
    copyIntoFixture(fixture, roadmapPath);
    copyIntoFixture(fixture, ledgerPath);
    return { fixture, tempRoot };
  } catch (error) {
    cleanupFixture(tempRoot);
    throw error;
  }
};

const withFixture = (operation) => {
  const { fixture, tempRoot } = createFixture();
  try {
    return operation(fixture);
  } finally {
    cleanupFixture(tempRoot);
  }
};

const runRenderer = (fixture, check = false) => {
  const rendererArguments = [resolve(fixture, rendererPath)];
  if (check) rendererArguments.push("--check");
  const result = spawnSync(process.execPath, rendererArguments, {
    cwd: fixture,
    env: rendererEnvironment,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: rendererTimeoutMs
  });
  return {
    status: result.status,
    signal: result.signal,
    timedOut: result.error?.code === "ETIMEDOUT",
    error: result.error?.message ?? null,
    errorCode: result.error?.code ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
};

const assertRendererSuccess = (result) => {
  assert.equal(result.timedOut, false, `renderer exceeded ${rendererTimeoutMs}ms: ${resultSummary(result)}`);
  assert.equal(result.error, null, resultSummary(result));
  assert.equal(result.signal, null, resultSummary(result));
  assert.equal(result.status, 0, resultSummary(result));
};

const assertCheckSuccess = (result) => {
  assertRendererSuccess(result);
  assert.equal(result.stdout, expectedCheckSummary, resultSummary(result));
  assert.equal(result.stderr, "", resultSummary(result));
};

const count = (text, needle) => text.split(needle).length - 1;

const generatedBlockRange = (text, marker) => {
  const start = startMarker(marker);
  const end = endMarker(marker);
  assert.equal(count(text, start), 1, `${marker} must have exactly one start marker`);
  assert.equal(count(text, end), 1, `${marker} must have exactly one end marker`);
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `${marker} end marker must follow its start marker`);
  return { end: endIndex + end.length, start: startIndex };
};

const generatedBlock = (fixture, relativePath, marker) => {
  const text = readFileSync(resolve(fixture, relativePath), "utf8");
  const range = generatedBlockRange(text, marker);
  return Buffer.from(text.slice(range.start, range.end));
};

const generatedBlocks = (fixture) => ({
  board: generatedBlock(fixture, boardPath, "board-rows"),
  roadmap: generatedBlock(fixture, roadmapPath, "roadmap-authority-header")
});

const assertGeneratedBlocksEqual = (actual, expected) => {
  assertBytesEqual(actual.board, expected.board, "Board generated bytes changed");
  assertBytesEqual(actual.roadmap, expected.roadmap, "Roadmap generated bytes changed");
};

const assertGeneratedBlocksDiffer = (actual, expected, context) => {
  assert.equal(actual.board.equals(expected.board), false, `${context}: board drift was not seeded`);
  assert.equal(actual.roadmap.equals(expected.roadmap), false, `${context}: roadmap drift was not seeded`);
};

const boardTicketIds = (block) => block.toString("utf8")
  .split(/\r\n|\n|\r/)
  .flatMap((line) => line.match(/^\| \[([^\]]+)\]\([^)]+\) \|/)?.[1] ?? []);

const assertBoardMatchesCatalog = (fixture) => {
  const catalog = JSON.parse(readFileSync(resolve(fixture, "docs/issues.json"), "utf8"));
  assert.ok(Array.isArray(catalog.tickets) && catalog.tickets.length >= 2, "catalog must contain at least two ticket records");
  const actualIds = boardTicketIds(generatedBlocks(fixture).board);
  const expectedIds = [...catalog.tickets]
    .sort((left, right) => left.issue - right.issue)
    .map((ticket) => ticket.id);
  assert.equal(actualIds.length, expectedIds.length, "Board must render one row per catalog ticket");
  assert.equal(new Set(actualIds).size, actualIds.length, "Board must not render duplicate ticket rows");
  assert.deepEqual(actualIds, expectedIds, "Board ticket rows must use canonical numeric issue order");
};

const lineEndingAt = (text, index) => {
  if (text.startsWith("\r\n", index)) return "\r\n";
  if (text.startsWith("\n", index)) return "\n";
  if (text.startsWith("\r", index)) return "\r";
  assert.fail("generated end marker must be followed by authored content");
};

const addAuthoredLineAfterEndMarker = (text, marker, line) => {
  assert.equal(text.includes(line), false, "authored sentinel already exists");
  const range = generatedBlockRange(text, marker);
  const eol = lineEndingAt(text, range.end);
  return `${text.slice(0, range.end + eol.length)}${line}${eol}${text.slice(range.end + eol.length)}`;
};

const assertLineImmediatelyOutsideGeneratedBlock = (text, marker, line) => {
  const range = generatedBlockRange(text, marker);
  const eol = lineEndingAt(text, range.end);
  assert.equal(text.indexOf(line), range.end + eol.length, "authored sentinel is not immediately outside the generated block");
  assert.ok(text.startsWith(`${eol}${line}${eol}`, range.end), "authored sentinel must be the next line after the end marker");
};

const replaceGeneratedBlock = (text, marker, transform) => {
  const range = generatedBlockRange(text, marker);
  const original = text.slice(range.start, range.end);
  const replacement = transform(original);
  return `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
};

const blockLineEnding = (block) => block.includes("\r\n") ? "\r\n" : block.includes("\n") ? "\n" : "\r";

const swapRoadmapHeaderLines = (text) => replaceGeneratedBlock(text, "roadmap-authority-header", (block) => {
  const eol = blockLineEnding(block);
  const lines = block.split(eol);
  assert.equal(lines[0], startMarker("roadmap-authority-header"));
  assert.equal(lines.at(-1), endMarker("roadmap-authority-header"));
  assert.notEqual(lines[1], lines[2], "roadmap header requires two distinct rendered lines");
  [lines[1], lines[2]] = [lines[2], lines[1]];
  return lines.join(eol);
});

const swapBoardRows = (text) => replaceGeneratedBlock(text, "board-rows", (block) => {
  const eol = blockLineEnding(block);
  const lines = block.split(eol);
  const rowIndexes = lines.flatMap((line, index) => line.startsWith("| [") ? [index] : []);
  assert.ok(rowIndexes.length >= 2, "Board requires at least two rendered ticket rows");
  assert.notEqual(lines[rowIndexes[0]], lines[rowIndexes[1]], "Board requires two distinct rendered ticket rows");
  [lines[rowIndexes[0]], lines[rowIndexes[1]]] = [lines[rowIndexes[1]], lines[rowIndexes[0]]];
  return lines.join(eol);
});

const seedGeneratedDrift = (fixture) => {
  for (const [relativePath, drift] of [
    [boardPath, swapBoardRows],
    [roadmapPath, swapRoadmapHeaderLines]
  ]) {
    const path = resolve(fixture, relativePath);
    const original = readFileSync(path, "utf8");
    const altered = drift(original);
    assert.notEqual(altered, original, `${relativePath} drift must change generated bytes`);
    writeFileSync(path, altered);
  }
};

const assertSurfaceProseIsNotAnInput = ({ marker, relativePath, sentinel, drift }) => withFixture((fixture) => {
  assertCheckSuccess(runRenderer(fixture, true));
  const baselineBlocks = generatedBlocks(fixture);
  assertBoardMatchesCatalog(fixture);

  const path = resolve(fixture, relativePath);
  const authored = addAuthoredLineAfterEndMarker(readFileSync(path, "utf8"), marker, sentinel);
  assertLineImmediatelyOutsideGeneratedBlock(authored, marker, sentinel);
  writeFileSync(path, authored);

  const proseOnlyCheck = runRenderer(fixture, true);
  assertCheckSuccess(proseOnlyCheck);
  assertBytesEqual(readFileSync(path), Buffer.from(authored), "--check must not rewrite authored prose");
  assertLineImmediatelyOutsideGeneratedBlock(readFileSync(path, "utf8"), marker, sentinel);
  assertGeneratedBlocksEqual(generatedBlocks(fixture), baselineBlocks);
  assertBoardMatchesCatalog(fixture);

  const drifted = drift(authored);
  writeFileSync(path, drifted);
  const render = runRenderer(fixture);
  assertRendererSuccess(render);
  assertBytesEqual(readFileSync(path), Buffer.from(authored), "render must repair only the generated block");
  assertLineImmediatelyOutsideGeneratedBlock(readFileSync(path, "utf8"), marker, sentinel);
  assertGeneratedBlocksEqual(generatedBlocks(fixture), baselineBlocks);
  assertBoardMatchesCatalog(fixture);

  const afterCheck = runRenderer(fixture, true);
  assertCheckSuccess(afterCheck);
});

test("roadmap-is-not-an-input", () => {
  assertSurfaceProseIsNotAnInput({
    marker: "roadmap-authority-header",
    relativePath: roadmapPath,
    sentinel: "AUTHORED_ROADMAP_PROSE_OUTSIDE_GENERATED_MARKER",
    drift: swapRoadmapHeaderLines
  });
});

test("board-is-not-an-input", () => {
  assertSurfaceProseIsNotAnInput({
    marker: "board-rows",
    relativePath: boardPath,
    sentinel: "AUTHORED_BOARD_PROSE_OUTSIDE_GENERATED_MARKER",
    drift: swapBoardRows
  });
});

test("historical-ledger-is-ignored", () => withFixture((fixture) => {
  assertCheckSuccess(runRenderer(fixture, true));
  const baselineBlocks = generatedBlocks(fixture);
  assertBoardMatchesCatalog(fixture);

  seedGeneratedDrift(fixture);
  assertGeneratedBlocksDiffer(generatedBlocks(fixture), baselineBlocks, "historical-ledger case");

  const path = resolve(fixture, ledgerPath);
  const historicalSentinel = "HISTORICAL_LEDGER_PROSE_MUST_NOT_BECOME_RENDERER_INPUT";
  const original = readFileSync(path, "utf8");
  assert.equal(original.includes(historicalSentinel), false, "historical sentinel already exists");
  const altered = `${original.endsWith("\n") ? original : `${original}\n`}${historicalSentinel}\n`;
  writeFileSync(path, altered);

  const render = runRenderer(fixture);
  assertRendererSuccess(render);
  assertBytesEqual(readFileSync(path), Buffer.from(altered), "renderer changed historical ledger prose");
  assertGeneratedBlocksEqual(generatedBlocks(fixture), baselineBlocks);
  assertBoardMatchesCatalog(fixture);

  const afterCheck = runRenderer(fixture, true);
  assertCheckSuccess(afterCheck);
}));

test("generated-views-are-deterministic", () => withFixture((fixture) => {
  assertCheckSuccess(runRenderer(fixture, true));
  const baselineBlocks = generatedBlocks(fixture);
  assertBoardMatchesCatalog(fixture);

  const catalogPath = resolve(fixture, "docs/issues.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  assert.ok(Array.isArray(catalog.tickets) && catalog.tickets.length >= 2, "catalog must contain at least two ticket records");
  seedGeneratedDrift(fixture);
  assertGeneratedBlocksDiffer(generatedBlocks(fixture), baselineBlocks, "deterministic case before first render");
  catalog.tickets.reverse();
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

  const firstRender = runRenderer(fixture);
  assertRendererSuccess(firstRender);
  const firstBlocks = generatedBlocks(fixture);
  assertGeneratedBlocksEqual(firstBlocks, baselineBlocks);
  assertBoardMatchesCatalog(fixture);

  seedGeneratedDrift(fixture);
  assertGeneratedBlocksDiffer(generatedBlocks(fixture), firstBlocks, "deterministic case before second render");
  const secondRender = runRenderer(fixture);
  assertRendererSuccess(secondRender);
  const secondBlocks = generatedBlocks(fixture);
  assertGeneratedBlocksEqual(secondBlocks, firstBlocks);
  assertGeneratedBlocksEqual(secondBlocks, baselineBlocks);
  assertBoardMatchesCatalog(fixture);

  const afterCheck = runRenderer(fixture, true);
  assertCheckSuccess(afterCheck);
}));
