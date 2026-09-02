// Does the cleanup AOS actually performs reach everything the agent started?
//
// Uses the product's own enumeration rather than a re-implementation of it: `processGroupMembers`
// in lib/core.mjs is what decides `leaked_descendants`, and the question is whether that function
// can see a descendant which left the group. Spawns a parent detached, so the parent leads its own
// group exactly as `runProcess` spawns an agent, then gives it one ordinary child and one detached
// child before signalling the group.
import { spawn, execSync } from "node:child_process";
import { processGroupMembers } from "../../../lib/core.mjs";

const alive = (pid) => execSync(`ps -o pid= -p ${pid} || true`).toString().trim() !== "";
const psLine = (pid) => execSync(`ps -o pid=,pgid=,ppid= -p ${pid} || true`).toString().trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parent = spawn(process.execPath, ["-e", `
  const { spawn } = require("node:child_process");
  const inGroup = spawn("/bin/sh", ["-c", "sleep 40"], { stdio: "ignore" });
  const escaped = spawn("/bin/sh", ["-c", "sleep 41"], { detached: true, stdio: "ignore" });
  escaped.unref();
  console.log(JSON.stringify({ in_group: inGroup.pid, escaped: escaped.pid }));
  setTimeout(() => process.exit(0), 300);
`], { detached: true, stdio: ["ignore", "pipe", "ignore"] });

const pgid = parent.pid;
let out = "";
parent.stdout.on("data", (chunk) => { out += chunk; });
await new Promise((resolve) => parent.once("exit", resolve));
await pause(400);

const pids = JSON.parse(out);
const members = processGroupMembers(pgid);
const before = {
  aos_pgid: pgid,
  members_processGroupMembers_reports: members,
  in_group_child: { pid: pids.in_group, ps: psLine(pids.in_group), reported: members.includes(pids.in_group) },
  detached_descendant: { pid: pids.escaped, ps: psLine(pids.escaped), reported: members.includes(pids.escaped) }
};

let groupKill = "sent";
try { process.kill(-pgid, "SIGKILL"); }
catch (error) { groupKill = `error:${error.code}`; }
await pause(500);

process.stdout.write(JSON.stringify({
  before_cleanup: before,
  group_kill: groupKill,
  after_cleanup: {
    in_group_child_alive: alive(pids.in_group),
    detached_descendant_alive: alive(pids.escaped)
  }
}, null, 2));
try { process.kill(pids.escaped, "SIGKILL"); } catch {}
try { process.kill(pids.in_group, "SIGKILL"); } catch {}
