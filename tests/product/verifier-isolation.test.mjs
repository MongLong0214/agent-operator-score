import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAM5_VERIFIER, gradeScenario, prepareScenario } from "../../lib/suite.mjs";
import { readVerdict, runVerifier } from "../../lib/verifier-run.mjs";
import { REFUSED, safeWalk } from "../../lib/safe-fs.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-isolation-"));

// A workspace prepared as FAM-5, with calculator.mjs replaced by whatever the assessed "agent"
// wrote. The correct answer is included so a hostile module can be a passing one too.
const CORRECT = `export function ratio(a, b) {
  if (typeof a !== "number" || typeof b !== "number") throw new TypeError("numbers required");
  if (b === 0) throw new RangeError("division by zero");
  return a / b;
}
`;

// `reads` is collected before the workspace is removed. Returning a reader closure instead let the
// cleanup run first, and every read came back null -- which looked exactly like a passing result.
const withAssessed = async (source, { extra = () => {}, reads = [] } = {}) => {
  const root = scratch();
  try {
    const prepared = prepareScenario("FAM-5", root);
    writeFileSync(join(root, "calculator.mjs"), source, "utf8");
    extra(root);
    const graded = await gradeScenario("FAM-5", root, { baseline: prepared.baseline, invocationCount: 1 });
    const files = {};
    for (const name of reads) {
      files[name] = existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null;
    }
    return { graded, files };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("the assessed module never executes in the AOS process", async () => {
  // The direct question, asked directly. If the grader imported this file, the parent's own
  // globalThis would carry the flag, because a module body runs with the permissions of whoever
  // imports it.
  delete globalThis.AOS_PARENT_WAS_TOUCHED;
  const { graded } = await withAssessed(`globalThis.AOS_PARENT_WAS_TOUCHED = true;\n${CORRECT}`);
  assert.equal(
    globalThis.AOS_PARENT_WAS_TOUCHED,
    undefined,
    "assessed code ran inside the AOS process"
  );
  assert.equal(graded.metrics.M15, 1, "a correct answer must still verify from the subprocess");
});

test("the verifier does not inherit the operator's environment", async () => {
  // Codex and Claude sessions are run from a shell that holds cloud credentials. Assessed code
  // that can read them can exfiltrate them, and the task prompt being harmless does not matter.
  process.env.ACME_FAKE_SECRET = "ghp_thisisafakevalueforthetest0000000";
  try {
    const { files } = await withAssessed(
      `import { writeFileSync } from "node:fs";
writeFileSync(new URL("./leak.txt", import.meta.url), JSON.stringify({
  secret: process.env.ACME_FAKE_SECRET ?? "absent",
  home: process.env.HOME ?? "absent",
  names: Object.keys(process.env).sort()
}));
${CORRECT}`,
      { reads: ["leak.txt"] }
    );
    assert.notEqual(files["leak.txt"], null, "the probe module did not run in the verifier at all");
    const leak = JSON.parse(files["leak.txt"]);
    assert.equal(leak.secret, "absent", "the operator's environment reached the assessed module");
    assert.notEqual(leak.home, process.env.HOME, "the assessed module was given the real HOME");
    assert.equal(leak.names.includes("AOS_VERIFIER_NONCE"), false, "the verdict nonce was readable");
  } finally {
    delete process.env.ACME_FAKE_SECRET;
  }
});

test("assessed code cannot forge a verdict", async () => {
  // It shares a stdout with the verifier, so it can print anything. It cannot print the nonce it
  // was never allowed to see, and the parent accepts no line without one.
  const { graded } = await withAssessed(
    `process.stdout.write('AOS_VERDICT ' + (process.env.AOS_VERIFIER_NONCE ?? 'guess') + ' {"hidden":true}\\n');
process.stdout.write('AOS_VERDICT guess {"hidden":true}\\n');
export function ratio() { return 0; }
`
  );
  assert.equal(graded.metrics.M15, 0, "a forged verdict line was accepted");
});

test("a verdict line is only read when the nonce matches", () => {
  const line = (nonce) => `AOS_VERDICT ${nonce} {"hidden":true}\n`;
  assert.deepEqual(readVerdict(line("real"), "real"), { hidden: true });
  assert.equal(readVerdict(line("forged"), "real"), null);
  assert.equal(readVerdict("no verdict here\n", "real"), null);
});

test("assessed code that exits the process is a verifier failure, not a pass", async () => {
  // The module is correct. It also kills the verifier before it can report, and a grader that read
  // silence as success would score it as verified.
  const { graded } = await withAssessed(`${CORRECT}\nprocess.exit(0);\n`);
  assert.equal(graded.metrics.M15, 0, "an exiting module was scored as verified");
  // The exit code is 0 and nothing timed out, so "the run succeeded" is true and useless here.
  assert.equal(graded.details.verifier.exit_code, 0);
  // This assertion used to read `reported === false`: the exit killed the one process that both
  // imported the module and wrote the verdict, so the whole verifier fell silent. That silence was
  // the old architecture's symptom, and it is gone -- the module can only exit the subject process
  // now, and the controller reports the probe it never got an answer from. The property under test
  // is unchanged and the evidence is stronger: an exit is still not a pass, and the report now says
  // which probes went unanswered instead of saying nothing at all.
  assert.equal(graded.details.verifier.reported, true, "assessed code silenced the trusted controller");
  assert.equal(graded.details.hidden, false, "silence was read as a verdict");
  for (const probe of Object.values(graded.details.verifier.probes)) {
    assert.equal(probe.passed, false, "a probe whose subject exited without answering was scored as passed");
    assert.equal(probe.refused, "no-result", "the refusal reason was not recorded");
  }
});

test("assessed code that never returns hits the timeout", async () => {
  const root = scratch();
  try {
    prepareScenario("FAM-5", root);
    writeFileSync(join(root, "calculator.mjs"), "while (true) {}\nexport function ratio() { return 1; }\n", "utf8");
    const run = await runVerifier(FAM5_VERIFIER, [root], { timeoutMs: 1500 });
    assert.equal(run.timed_out, true, "the verifier was not stopped");
    assert.equal(run.ok, false);
    assert.equal(run.verdict, null, "a timed-out run produced a verdict");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a process the assessed code spawns does not survive the verifier", async () => {
  const { graded } = await withAssessed(
    // unref, so the child does not hold the verifier's event loop open. That is the shape that
    // matters: the verifier exits 0 with a correct verdict and leaves a process running.
    `import { spawn } from "node:child_process";
spawn("sleep", ["30"], { stdio: "ignore" }).unref();
${CORRECT}`
  );
  // Whatever the verdict said, a verifier that left a process behind has not finished, so the
  // module is not verified even though its ratio() is correct.
  assert.equal(graded.details.verifier.leaked_descendants, true, "the spawned process was not seen");
  assert.equal(graded.details.verifier.survivors, false, "a spawned process outlived the cleanup");
  assert.equal(graded.metrics.M15, 0, "a run that leaked a process was scored as verified");
});

test("calculator.mjs as a symlink is refused rather than followed", async () => {
  // Following it would import a file outside the workspace and digest its bytes into the evidence.
  const { graded } = await withAssessed(CORRECT, { extra: (root) => {
    const outside = join(root, "..", `aos-outside-${process.pid}.mjs`);
    writeFileSync(outside, CORRECT, "utf8");
    rmSync(join(root, "calculator.mjs"));
    symlinkSync(outside, join(root, "calculator.mjs"));
  } });
  assert.equal(graded.metrics.M15, 0, "a symlinked module was verified");
  assert.equal(graded.details.verifier.refused, "symlink");
  assert.equal(graded.metrics.M16, 0, "replacing a file with a symlink read as an unchanged workspace");
});

test("safeWalk refuses what it cannot safely read, and says so in the snapshot", () => {
  const root = scratch();
  const outside = mkdtempSync(join(tmpdir(), "aos-outside-"));
  try {
    writeFileSync(join(outside, "private.txt"), "a secret this walk must never digest", "utf8");
    writeFileSync(join(root, "normal.txt"), "content", "utf8");
    symlinkSync(join(outside, "private.txt"), join(root, "link.txt"));
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "nested.txt"), "nested", "utf8");

    const { files, refusals } = safeWalk(root);
    assert.equal(files["link.txt"], `${REFUSED}symlink`);
    assert.equal(refusals.some((entry) => entry.path === "link.txt" && entry.reason === "symlink"), true);
    assert.match(files["normal.txt"], /^[a-f0-9]{64}$/);
    assert.match(files["sub/nested.txt"], /^[a-f0-9]{64}$/);
    // The refusal is recorded as an entry, not dropped: an omitted entry reads as an unchanged
    // workspace, which is how an agent would hide the edit.
    assert.equal(Object.hasOwn(files, "link.txt"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("safeWalk bounds file size and never reads a special file", () => {
  const root = scratch();
  try {
    writeFileSync(join(root, "huge.txt"), "x".repeat(2048), "utf8");
    const { files } = safeWalk(root, { maxFileBytes: 1024, maxTotalBytes: 1 << 20, maxEntries: 100, maxDepth: 8 });
    assert.equal(files["huge.txt"], `${REFUSED}file-too-large`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
