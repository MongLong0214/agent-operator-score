import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendNdjson, repairTornTrailingNdjson, runProcess } from "../../lib/core.mjs";

const temporary = (name) => mkdtempSync(join(tmpdir(), name));

test("a torn final NDJSON record is truncated before append", () => {
  const cwd = temporary("aos-ndjson-");
  try {
    const file = join(cwd, "events.ndjson");
    writeFileSync(file, '{"ok":1}\n{"torn":', { mode: 0o600 });
    appendNdjson(file, { next: 2 });
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ ok: 1 }, { next: 2 }]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("a complete final NDJSON record receives only its missing newline", () => {
  const cwd = temporary("aos-newline-");
  try {
    const file = join(cwd, "events.ndjson");
    writeFileSync(file, '{"ok":1}', { mode: 0o600 });
    assert.deepEqual(repairTornTrailingNdjson(file), { repaired: true, action: "newline" });
    appendNdjson(file, { next: 2 });
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ ok: 1 }, { next: 2 }]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("runProcess never overwrites a caller workspace prompt file", async () => {
  const cwd = temporary("aos-prompt-");
  try {
    const caller = join(cwd, "task.md");
    const observed = join(cwd, "observed.txt");
    writeFileSync(caller, "USER DATA", { mode: 0o600 });
    const script = [
      "const fs=require('node:fs')",
      "const prompt=process.argv[1]",
      "const observed=process.argv[2]",
      "if(fs.readFileSync(prompt,'utf8')!=='SAFE PROMPT') process.exit(9)",
      "fs.writeFileSync(observed,prompt)"
    ].join(";");
    const result = await runProcess(
      { command: process.execPath, args: ["-e", script, "{promptFile}", observed] },
      { workspace: cwd, prompt: "SAFE PROMPT", promptFile: caller, session: "session-test", family: "test", timeoutMs: 10_000 }
    );
    assert.equal(result.ok, true);
    assert.equal(readFileSync(caller, "utf8"), "USER DATA");
    const internal = readFileSync(observed, "utf8");
    assert.notEqual(internal, caller);
    assert.equal(existsSync(internal), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("an agent that leaves a descendant is killed and cannot report success", async () => {
  const cwd = temporary("aos-descendant-");
  try {
    const script = join(cwd, "leak.mjs");
    writeFileSync(script, "import { spawn } from 'node:child_process'; const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'}); child.unref();\n");
    const result = await runProcess(
      { command: process.execPath, args: [script] },
      { workspace: cwd, family: "TEST", stage: "test", prompt: "test", promptFile: join(cwd, "task.md"), session: "test", timeoutMs: 5000 }
    );
    assert.equal(result.ok, false);
    assert.equal(result.leaked_descendants, true);
    assert.equal(result.survivor, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
