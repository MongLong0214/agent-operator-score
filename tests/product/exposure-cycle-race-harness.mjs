// Test-only IPC barriers put two cycle processes on the same unlocked snapshot, then allow
// each real locked reservation to commit. Every child is awaited by the parent test.
import { exposureLedgerTestHooks, runCli } from "../../lib/cli.mjs";

const barrier = (stage) => new Promise((resolve) => {
  process.once("message", resolve);
  process.send({ stage });
});
exposureLedgerTestHooks.afterCycleRunSnapshot = () => barrier("snapshot");
exposureLedgerTestHooks.afterReserve = () => barrier("reserved");

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    cwd: process.cwd(), stdin: process.stdin, stdout: process.stdout, stderr: process.stderr
  });
} finally {
  process.disconnect();
}
