import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import {
  DEFAULT_LIMITS,
  describeBreach,
  resolveLimits,
  type ResourceLimits
} from "../src/runner/resource-limits.ts";
import { createRunWorkspace, verifyWorkspace } from "../src/runner/workspace.ts";

const roots: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "aos-limits-"));
  roots.push(dir);
  return dir;
};
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe("resource limits", () => {
  test("the defaults are the contracted table", () => {
    assert.deepEqual(DEFAULT_LIMITS, {
      maxFiles: 100_000,
      maxWorkspaceBytes: 2 * 1024 * 1024 * 1024,
      maxFileBytes: 256 * 1024 * 1024,
      maxDirectoryDepth: 64,
      maxEventLogBytes: 50 * 1024 * 1024,
      maxStdoutBytes: 10 * 1024 * 1024,
      maxStderrBytes: 10 * 1024 * 1024,
      maxJsonRecordBytes: 64 * 1024
    });
  });

  test("a manifest may lower a limit", () => {
    const { limits, rejected } = resolveLimits({ maxFiles: 10, maxDirectoryDepth: 4 });
    assert.equal(limits.maxFiles, 10);
    assert.equal(limits.maxDirectoryDepth, 4);
    assert.deepEqual(rejected, []);
    // Untouched fields keep the default rather than becoming undefined.
    assert.equal(limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes);
  });

  test("a manifest may not raise a limit, and the attempt is reported", () => {
    // A suite travels with the task being measured. Letting it raise a limit would let the thing
    // under measurement decide how much of the machine it gets.
    const { limits, rejected } = resolveLimits({ maxFiles: DEFAULT_LIMITS.maxFiles + 1 });
    assert.equal(limits.maxFiles, DEFAULT_LIMITS.maxFiles);
    assert.deepEqual(rejected, ["maxFiles"]);
  });

  test("a rejected field is named, never silently ignored", () => {
    // A suite author who wrote a higher limit believed it applied; silence makes their scenario
    // behave differently from what they intended with nothing to explain it.
    const { rejected } = resolveLimits({
      maxFiles: 0,
      maxFileBytes: -1,
      maxDirectoryDepth: 1.5,
      maxStdoutBytes: "10MiB",
      notALimit: 5
    } as never);
    assert.deepEqual(rejected, ["maxDirectoryDepth", "maxFileBytes", "maxFiles", "maxStdoutBytes", "notALimit"]);
  });

  test("no override leaves the defaults exactly", () => {
    for (const input of [null, undefined]) {
      const { limits, rejected } = resolveLimits(input);
      assert.deepEqual(limits, DEFAULT_LIMITS);
      assert.deepEqual(rejected, []);
    }
  });

  test("every breach kind describes itself with its numbers", () => {
    const breaches = [
      { kind: "files", count: 5, limit: 4 },
      { kind: "workspace_bytes", bytes: 9, limit: 8 },
      { kind: "file_bytes", path: "a.bin", bytes: 3, limit: 2 },
      { kind: "depth", path: "a/b", depth: 7, limit: 6 }
    ] as const;
    for (const breach of breaches) {
      const text = describeBreach(breach);
      assert.match(text, /\d/, `${breach.kind} does not report a number`);
      assert.match(text, /limit/, `${breach.kind} does not name the limit`);
    }
  });

  test("the resolved limits object cannot be mutated afterwards", () => {
    const { limits } = resolveLimits({ maxFiles: 10 });
    assert.throws(() => {
      (limits as { maxFiles: number }).maxFiles = 999;
    }, "a caller could raise a limit after resolution");
  });
});

describe("workspace traversal", () => {
  const seedSuite = (): string => {
    const suite = join(scratch(), "suite");
    mkdirSync(suite, { recursive: true });
    writeFileSync(join(suite, "a.txt"), "hello");
    return suite;
  };

  const environment = { runtime: "fake", version: "0" };
  const create = (sourceRoot: string) => {
    const parentRoot = scratch();
    return { parentRoot, result: createRunWorkspace({ parentRoot, sourceRoot, environment }) };
  };

  test("a workspace is created from a suite and verifies against its own digest", () => {
    const { parentRoot, result } = create(seedSuite());
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    if (!result.ok) return;
    // Verification re-reads the tree and needs the same parent and environment the creation was
    // pinned to; the created record deliberately does not carry them, so a caller cannot verify a
    // workspace against a parent it was never created under.
    assert.equal(verifyWorkspace({ ...result, parentRoot, environment }).ok, true);
  });

  test("a symlink is refused whether it points at a directory or a regular file", () => {
    // A symlink is how a workspace reaches outside itself, so the scored final state would describe
    // files the run never owned. The file case is the dangerous one and the easy one to miss: a
    // link to a directory also fails when something tries to read it, which can look like coverage
    // it is not.
    const toDirectory = seedSuite();
    symlinkSync("/etc", join(toDirectory, "escape"));
    assert.equal(create(toDirectory).result.ok, false, "a link to a directory was accepted");

    const outside = scratch();
    writeFileSync(join(outside, "outside.txt"), "content the run never owned");
    const toFile = seedSuite();
    symlinkSync(join(outside, "outside.txt"), join(toFile, "escape"));
    assert.equal(create(toFile).result.ok, false, "a link to a regular file was accepted");
  });

  test("a symlink that appears inside the workspace during a run fails verification", () => {
    // The creation path refuses a symlinked source for its own reasons, so refusing there does not
    // prove the tree walk checks. This is the case that isolates it: a clean workspace that grows a
    // symlink mid-run, which is how a scored final state would come to describe files outside it.
    const { parentRoot, result } = create(seedSuite());
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    if (!result.ok) return;
    symlinkSync("/etc", join(result.root, "escape"));
    assert.equal(
      verifyWorkspace({ ...result, parentRoot, environment }).ok,
      false,
      "a symlink inside the workspace passed verification"
    );
  });

  test("a tree past the depth limit is refused as a decision, not a crash", () => {
    // PRD 14.3 asks for an explicit stack so depth is a limit rather than a stack overflow. A tree
    // deep enough to actually exhaust a call stack cannot be built -- the filesystem refuses the
    // path first, at roughly 1,800 components here -- so what is asserted is the reachable half:
    // past the 64-level limit the answer is a refusal that names itself.
    const suite = join(scratch(), "deep");
    let path = suite;
    for (let i = 0; i < DEFAULT_LIMITS.maxDirectoryDepth + 5; i += 1) path = join(path, `d${i}`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "leaf.txt"), "x");
    assert.equal(create(suite).result.ok, false, "a tree past the depth limit was accepted");
  });

  test("a tree just inside the depth limit is accepted", () => {
    // Without this the depth test would pass against a traversal that refuses everything.
    const suite = join(scratch(), "shallow");
    let path = suite;
    for (let i = 0; i < 8; i += 1) path = join(path, `d${i}`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "leaf.txt"), "x");
    assert.equal(create(suite).result.ok, true);
  });
});
