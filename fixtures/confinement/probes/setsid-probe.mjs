// Can the boundary stop a child from leaving the process group AOS signals?
//
// Two independent readings, because the first two attempts each failed in a way that would have
// been recorded as an answer if only one had been taken.
//
// `kill(-pid, 0)` succeeds only if `pid` leads its own process group. It came back EPERM under the
// deny-default profile until that profile allowed a process to signal its own group -- a refusal to
// ask the question, which is not a fact about process groups.
//
// Having the child run `ps` instead returned nothing at all: `/bin/ps` is setgid and cannot be
// exec'd inside any Seatbelt profile on this machine, including `(allow default)`. That is recorded
// as its own observation rather than silently producing an empty reading here.
import { spawn } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";

const report = `${process.env.PROBE_BASE}/workspace/setsid-child.txt`;
if (existsSync(report)) unlinkSync(report);
const child = spawn("/bin/sh", ["-c", `ps -o pid=,pgid=,ppid= -p $$ > ${report} 2>&1; sleep 12`], { detached: true, stdio: "ignore" });
child.unref();

setTimeout(() => {
  let signal;
  try { process.kill(-child.pid, 0); signal = { child_leads_own_process_group: true, errno: null }; }
  catch (error) {
    signal = error.code === "ESRCH"
      ? { child_leads_own_process_group: false, errno: "ESRCH" }
      : { child_leads_own_process_group: "not_answerable", errno: error.code };
  }
  let ps = null;
  try { ps = readFileSync(report, "utf8").trim(); } catch (error) { ps = `unreadable:${error.code}`; }
  process.stdout.write(JSON.stringify({
    child_leads_own_process_group: signal.child_leads_own_process_group,
    signal_probe_errno: signal.errno,
    ps_in_child_available: ps.length > 0 && !/not permitted|unreadable/i.test(ps),
    ps_in_child_raw: ps,
    parent_pid: process.pid,
    child_pid: child.pid
  }, null, 2));
  try { process.kill(child.pid, "SIGKILL"); } catch {}
}, 1200);
