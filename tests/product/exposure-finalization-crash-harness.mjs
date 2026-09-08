// Test-only entry point: stop real processes inside atomicWrite, including before rename.
// No production CLI flag or environment variable enables these interceptions.
import fs from "node:fs";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname } from "node:path";

const [stage, ...args] = process.argv.slice(2);
// A deterministic same-boot observation isolates journal recovery from the host's uptime API
// (which returns EPERM inside some test sandboxes). Real boot adjudication has its own home tests.
// Both the killed writer and the fresh recovery process use this fixture; no product path does.
os.uptime = () => Date.now() / 1000 - 1700000000;
const descriptors = new Map();
const original = { open: fs.openSync, write: fs.writeFileSync, rename: fs.renameSync, fsync: fs.fsyncSync, close: fs.closeSync };
let lastRename = null;
let pendingWritten = false;
let recordChanged = false;
const isPending = (file) => typeof file === "string" && basename(file).startsWith("exposure-pending-");
const die = () => process.kill(process.pid, "SIGKILL");
fs.openSync = (file, ...rest) => {
  if (stage === "before" && isPending(file) && file.includes(".tmp-")) die();
  const descriptor = original.open(file, ...rest);
  descriptors.set(descriptor, file);
  return descriptor;
};
fs.closeSync = (descriptor) => { descriptors.delete(descriptor); return original.close(descriptor); };
fs.writeFileSync = (file, ...rest) => {
  const result = original.write(file, ...rest);
  if (stage === "during" && isPending(descriptors.get(file))) die();
  return result;
};
fs.renameSync = (from, to) => {
  const result = original.rename(from, to);
  lastRename = to;
  if (isPending(to)) pendingWritten = true;
  return result;
};
fs.fsyncSync = (descriptor) => {
  const result = original.fsync(descriptor);
  if (lastRename !== null && descriptors.get(descriptor) === dirname(lastRename)) {
    const name = basename(lastRename);
    if (stage === "record-change" && name === "record.json" && !recordChanged) {
      recordChanged = true;
      const record = JSON.parse(fs.readFileSync(lastRename, "utf8"));
      original.write(lastRename, JSON.stringify({ ...record, run_id: "run-replaced-on-disk" }));
    }
    if ((stage === "pending" && isPending(lastRename))
        || (stage === "ledger" && pendingWritten && name === "exposure-ledger.json")
        || (stage === "result" && name === "result.json")
        || (stage === "event" && name === "aos.ndjson")
        || (stage === "terminal" && name === "terminal.json")) die();
    if (stage === "write-error" && isPending(lastRename)) throw new Error("injected pending directory fsync failure");
  }
  return result;
};
syncBuiltinESMExports();
const { runCli } = await import("../../lib/cli.mjs");
process.exitCode = await runCli(args, { cwd: process.cwd(), stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
