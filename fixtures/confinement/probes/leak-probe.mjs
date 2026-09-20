// Leaves behind a descendant that outlives the run, the way an assessed agent starting a dev server
// does. Two separate questions: does it survive the teardown, and is it still confined once it has
// been orphaned. The second decides how bad a leak is, and the verdict is written inside the
// workspace because writing anywhere else is itself denied under a boundary.
import { spawn } from "node:child_process";
const marker = `${process.env.PROBE_BASE}/workspace/leak-verdict.txt`;
const target = `${process.env.PROBE_OPERATOR_HOME}/.ssh`;
const child = spawn("/bin/sh", ["-c",
  `sleep 3; if ls ${target} > /dev/null 2>&1; then echo ORPHAN_READ_OK > ${marker}; else echo ORPHAN_STILL_CONFINED > ${marker}; fi; sleep 25`
], { detached: true, stdio: "ignore" });
child.unref();
process.stdout.write(JSON.stringify({ parent_pid: process.pid, descendant_pid: child.pid, marker }, null, 2));
