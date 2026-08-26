from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"patch target not found: {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


# Runtime support is exact: macOS/Linux on x64/arm64, excluding WSL even though Node reports linux.
replace(
    "lib/core.mjs",
    '''export function assertSupportedPlatform() {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    throw new Error(`AOS_UNSUPPORTED_PLATFORM ${process.platform}; supported: macOS and Linux`);
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
''',
    '''export function assertSupportedPlatform() {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    throw new Error(`AOS_UNSUPPORTED_PLATFORM ${process.platform}; supported: macOS and Linux`);
  }
  if (!new Set(["x64", "arm64"]).has(process.arch)) {
    throw new Error(`AOS_UNSUPPORTED_ARCH ${process.arch}; supported: x64 and arm64`);
  }
  if (process.platform === "linux") {
    let version = "";
    try { version = readFileSync("/proc/version", "utf8"); } catch {}
    if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(version)) {
      throw new Error("AOS_UNSUPPORTED_PLATFORM WSL; use native macOS or Linux");
    }
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
'''
)

# A valid tail without its newline is repaired by appending the delimiter; otherwise the next append
# would concatenate two JSON documents. An invalid tail is truncated as before.
replace(
    "lib/store.mjs",
    '''      try {
        JSON.parse(tail);
      } catch {
        const repaired = boundary < 0 ? "" : text.slice(0, boundary + 1);
        truncateSync(full, Buffer.byteLength(repaired, "utf8"));
        text = repaired;
      }
''',
    '''      try {
        JSON.parse(tail);
        atomicWrite(full, `${text}\\n`);
        text = `${text}\\n`;
      } catch {
        const repaired = boundary < 0 ? "" : text.slice(0, boundary + 1);
        truncateSync(full, Buffer.byteLength(repaired, "utf8"));
        text = repaired;
      }
'''
)

# Collaboration surfaces are opportunity-profile inputs, not agents and not score bonuses.
replace(
    "lib/store.mjs",
    '''export function removeAgent(cwd, id) {
  const config = readConfig(cwd);
  if (!(id in config.agents)) return false;
  delete config.agents[id];
  writeConfig(cwd, config);
  return true;
}

export function runPaths(cwd, runId) {
''',
    '''export function removeAgent(cwd, id) {
  const config = readConfig(cwd);
  if (!(id in config.agents)) return false;
  delete config.agents[id];
  writeConfig(cwd, config);
  return true;
}

export function addSurface(cwd, surface) {
  requireId(surface.id, "surface id");
  const config = readConfig(cwd);
  config.collaboration_surfaces[surface.id] = {
    id: surface.id,
    display_name: surface.display_name ?? surface.id,
    kind: surface.kind ?? "other",
    transport: surface.transport ?? "ndjson",
    available: true
  };
  writeConfig(cwd, config);
  return config.collaboration_surfaces[surface.id];
}

export function removeSurface(cwd, id) {
  const config = readConfig(cwd);
  if (!(id in config.collaboration_surfaces)) return false;
  delete config.collaboration_surfaces[id];
  writeConfig(cwd, config);
  return true;
}

export function runPaths(cwd, runId) {
'''
)

# CLI imports and help.
replace(
    "lib/cli.mjs",
    '''import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
''',
    '''import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
'''
)
replace(
    "lib/cli.mjs",
    '''  addAgent,
  appendEvent,
''',
    '''  addAgent,
  addSurface,
  appendEvent,
'''
)
replace(
    "lib/cli.mjs",
    '''  recoverRun,
  removeAgent,
''',
    '''  recoverRun,
  removeAgent,
  removeSurface,
'''
)
replace(
    "lib/cli.mjs",
    '''  aos agent list | remove <id> | doctor [id] | run <id> --task <text> [--workspace <path>]
  aos assess [--route FAM-1=agent ...] [--timeout-ms 300000] [--json]
  aos observe --agent <id> --task <text> [--workspace <path>]
  aos import --run <id> --producer <id> --file <events.ndjson>
''',
    '''  aos agent list | remove <id> | doctor [id] | run <id> --task <text> [--workspace <path>]
  aos surface add <id> [--kind buzz|generic-event-log|other] | list | remove <id>
  aos assess [--route FAM-1=agent ...] [--timeout-ms 300000] [--json]
  aos observe --agent <id> --task <text> [--workspace <path>]
  aos import [--run <id>] --producer <id> --file <events.ndjson>
  aos bridge [--run <id>] --producer <id> < events.ndjson
'''
)

# Refuse symlink artifacts from parallel candidate workspaces.
replace(
    "lib/cli.mjs",
    '''        for (const name of outputNames(item.branch)) cpSync(join(item.branch, name), join(destination, name), { recursive: true });
''',
    '''        for (const name of outputNames(item.branch)) {
          const source = join(item.branch, name);
          if (lstatSync(source).isSymbolicLink()) throw new Error(`AOS_SYMLINK_ARTIFACT ${name}`);
          cpSync(source, join(destination, name), { recursive: true, dereference: false });
        }
'''
)

# Ad-hoc prompt files are always removed, including process errors and interrupts.
replace(
    "lib/cli.mjs",
    '''    writeFileSync(promptFile, `${task}\\n`, "utf8");
    const result = await runProcess(agent, { workspace, family: "ADHOC", stage: "adhoc", prompt: task, promptFile, session: makeId("adhoc"), timeoutMs: Number(getOption(args, "timeout-ms", 300000)) });
    rmSync(promptFile, { force: true });
    emit(io, json ? result : result.ok ? "Agent completed" : `Agent failed: ${result.exit_code ?? result.signal}`, json);
''',
    '''    writeFileSync(promptFile, `${task}\\n`, "utf8");
    let result;
    try {
      result = await runProcess(agent, { workspace, family: "ADHOC", stage: "adhoc", prompt: task, promptFile, session: makeId("adhoc"), timeoutMs: Number(getOption(args, "timeout-ms", 300000)) });
    } finally {
      rmSync(promptFile, { force: true });
    }
    emit(io, json ? result : result.ok ? "Agent completed" : `Agent failed: ${result.exit_code ?? result.signal}`, json);
'''
)

# Surface management.
replace(
    "lib/cli.mjs",
    '''async function doctor(cwd, options, io) {
''',
    '''function commandSurface(cwd, args, io) {
  const [action, id] = args._;
  const json = getOption(args, "json", false) === true;
  if (action === "add") {
    requireId(id, "surface id");
    const kind = String(getOption(args, "kind", "other"));
    if (!["buzz", "generic-event-log", "other"].includes(kind)) return fail(io, `AOS_INVALID_SURFACE_KIND ${kind}`, 2);
    const transport = String(getOption(args, "transport", "ndjson"));
    if (!["ndjson", "signed-events", "import"].includes(transport)) return fail(io, `AOS_INVALID_SURFACE_TRANSPORT ${transport}`, 2);
    const surface = addSurface(cwd, { id, kind, transport, display_name: getOption(args, "display", id) });
    emit(io, json ? surface : `Added surface ${id}`, json);
    return 0;
  }
  if (action === "list") {
    const surfaces = Object.values(readConfig(cwd).collaboration_surfaces);
    emit(io, json ? surfaces : surfaces.map((surface) => `${surface.id}\\t${surface.kind}\\t${surface.transport}`).join("\\n"), json);
    return 0;
  }
  if (action === "remove") {
    const removed = removeSurface(cwd, requireId(id, "surface id"));
    emit(io, json ? { removed } : removed ? `Removed surface ${id}` : `Not found: ${id}`, json);
    return removed ? 0 : 1;
  }
  return fail(io, usage, 2);
}

async function doctor(cwd, options, io) {
'''
)

# Shared diagnostic ingestion plus stdin bridge.
replace(
    "lib/cli.mjs",
    '''function importEvents(cwd, options, io) {
  let runId = getOption(options, "run");
  const producer = getOption(options, "producer");
  const file = getOption(options, "file");
  if (typeof producer !== "string" || typeof file !== "string") return fail(io, "AOS_IMPORT_FIELDS_REQUIRED", 2);
  if (typeof runId !== "string") runId = createRun(cwd, { mode: "IMPORTED", source: producer }).runId;
  else if (!existsSync(runPaths(cwd, runId).manifest)) createRun(cwd, { run_id: runId, mode: "IMPORTED", source: producer });
  let count = 0;
  for (const line of readFileSync(resolve(cwd, file), "utf8").split(/\\r?\\n/)) {
    if (!line) continue;
    const parsed = JSON.parse(line);
    if (typeof parsed.event_type !== "string") throw new Error("AOS_INVALID_IMPORTED_EVENT");
    appendEvent(cwd, runId, producer, parsed);
    count += 1;
  }
  appendEvent(cwd, runId, "aos", { event_type: "import.received", payload: { source: producer, count } });
  emit(io, getOption(options, "json", false) === true ? { run_id: runId, producer, count, status: "DIAGNOSTIC_ONLY" } : `Imported ${count} events as diagnostic evidence`, getOption(options, "json", false) === true);
  return 0;
}
''',
    '''function ingestDiagnostic(cwd, options, io, text, sourceKind) {
  let runId = getOption(options, "run");
  const producer = getOption(options, "producer");
  if (typeof producer !== "string") return fail(io, "AOS_PRODUCER_REQUIRED", 2);
  if (typeof runId !== "string") runId = createRun(cwd, { mode: "IMPORTED", source: producer, source_kind: sourceKind }).runId;
  else if (!existsSync(runPaths(cwd, runId).manifest)) createRun(cwd, { run_id: runId, mode: "IMPORTED", source: producer, source_kind: sourceKind });
  let count = 0;
  for (const line of text.split(/\\r?\\n/)) {
    if (!line) continue;
    const parsed = JSON.parse(line);
    if (typeof parsed.event_type !== "string") throw new Error("AOS_INVALID_IMPORTED_EVENT");
    appendEvent(cwd, runId, producer, parsed);
    count += 1;
  }
  appendEvent(cwd, runId, "aos", { event_type: "import.received", payload: { source: producer, count } });
  const output = { run_id: runId, producer, count, status: "DIAGNOSTIC_ONLY" };
  emit(io, getOption(options, "json", false) === true ? output : `Imported ${count} ${sourceKind} events as diagnostic evidence`, getOption(options, "json", false) === true);
  return 0;
}

function importEvents(cwd, options, io) {
  const file = getOption(options, "file");
  if (typeof file !== "string") return fail(io, "AOS_IMPORT_FILE_REQUIRED", 2);
  return ingestDiagnostic(cwd, options, io, readFileSync(resolve(cwd, file), "utf8"), "file");
}

async function bridgeEvents(cwd, options, io) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  if (bytes.length > 16 * 1024 * 1024) throw new Error("AOS_BRIDGE_INPUT_TOO_LARGE");
  return ingestDiagnostic(cwd, options, io, bytes.toString("utf8"), "bridge");
}
'''
)

replace(
    "lib/cli.mjs",
    '''    if (command === "agent") return commandAgent(io.cwd, options, io);
    if (command === "assess") return assess(io.cwd, options, io);
''',
    '''    if (command === "agent") return commandAgent(io.cwd, options, io);
    if (command === "surface") return commandSurface(io.cwd, options, io);
    if (command === "assess") return assess(io.cwd, options, io);
'''
)
replace(
    "lib/cli.mjs",
    '''    if (command === "import") return importEvents(io.cwd, options, io);
    if (command === "report") return report(io.cwd, options, io);
''',
    '''    if (command === "import") return importEvents(io.cwd, options, io);
    if (command === "bridge") return bridgeEvents(io.cwd, options, io);
    if (command === "report") return report(io.cwd, options, io);
'''
)

# README surfaces and bridge example.
readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8")
insert = '''
## Collaboration surfaces

Buzz and other coordination systems are recorded as collaboration surfaces, not as agent skill or an agent-count bonus.

```bash
aos surface add buzz --kind buzz --transport ndjson
aos surface list

# Import an existing export
aos import --producer buzz --file ./buzz-events.ndjson

# Or stream a local NDJSON bridge
aos bridge --producer buzz < ./buzz-events.ndjson
```

Imported and bridged surface events are projected into secret-safe metadata and remain `DIAGNOSTIC ONLY`; they never silently manufacture a verified score.

'''
readme = readme.replace("## Run a controlled multi-agent assessment\n", insert + "## Run a controlled multi-agent assessment\n")
readme_path.write_text(readme, encoding="utf-8")

# Surface and bridge E2E.
(ROOT / "test-product" / "surface.test.mjs").write_text(r'''import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const cli = new URL("../bin/aos.mjs", import.meta.url).pathname;
function run(cwd, args, input = undefined, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, input, encoding: "utf8" });
  assert.equal(result.status, expected, `${args.join(" ")}\\n${result.stdout}\\n${result.stderr}`);
  return result.stdout;
}

test("Buzz can be registered as a collaboration surface and bridged diagnostically", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-surface-"));
  try {
    run(cwd, ["init"]);
    run(cwd, ["surface", "add", "buzz", "--kind", "buzz", "--transport", "ndjson"]);
    const surfaces = JSON.parse(run(cwd, ["surface", "list", "--json"]));
    assert.equal(surfaces[0].kind, "buzz");
    const line = `${JSON.stringify({ event_type: "handoff.created", payload: { from: "hermes", to: "codex", family: "FAM-3", artifact_digests: ["sha256:abc"] } })}\\n`;
    const result = JSON.parse(run(cwd, ["bridge", "--producer", "buzz", "--json"], line));
    assert.equal(result.status, "DIAGNOSTIC_ONLY");
    assert.equal(result.count, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
''', encoding="utf-8")

print("Collaboration surface, bridge, platform and symlink hardening applied")
