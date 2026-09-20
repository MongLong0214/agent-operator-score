// Confinement probe. Emits one JSON object on stdout describing what the process it runs as was
// actually able to do.
//
// No value of anything credential-bearing is emitted: the credential-adjacent checks report a
// length, a boolean or an exit status. Bytes of a private key and of auth.json are read into a
// buffer, because "could the agent read it" cannot be answered without attempting the read; what
// the buffer contained is never returned, printed or stored.
//
// The deletion check does not create its own target. An earlier version did, and under confinement
// it failed at creation and never reached the unlink -- a row named "delete outside" that only ever
// measured "write outside". The harness creates the target before the run.
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, symlinkSync, openSync, readSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";

const BASE = process.env.PROBE_BASE;
const WORKSPACE = `${BASE}/workspace`;
const REAL_HOME = process.env.PROBE_OPERATOR_HOME;
const results = {};

const attempt = (name, fn) => {
  try {
    const detail = fn();
    results[name] = { outcome: "allowed", errno: null, detail: detail === undefined ? null : detail };
  } catch (error) {
    results[name] = { outcome: "denied", errno: error?.code ?? null, detail: null };
  }
};

const needHome = () => {
  if (!REAL_HOME) throw Object.assign(new Error("PROBE_OPERATOR_HOME not supplied"), { code: "ENOHOME" });
  return REAL_HOME;
};

attempt("read_inside_workspace", () => readFileSync(`${WORKSPACE}/inside.txt`, "utf8").trim().length);
attempt("write_inside_workspace", () => {
  const path = `${WORKSPACE}/probe-write-${process.pid}`;
  writeFileSync(path, "x");
  unlinkSync(path);
  return true;
});
attempt("read_workspace_parent", () => readFileSync(`${BASE}/parent-canary.txt`, "utf8").trim().length);
attempt("write_outside_workspace", () => {
  const path = `${BASE}/outside/probe-write-${process.pid}`;
  writeFileSync(path, "x");
  unlinkSync(path);
  return true;
});
attempt("delete_outside_workspace", () => {
  // Created by the harness before this process started, so a denial here is a denial of unlink.
  const path = `${BASE}/outside/deletable.txt`;
  if (!existsSync(path)) throw Object.assign(new Error("target missing"), { code: "ENOTARGET" });
  unlinkSync(path);
  return true;
});
// Absolute and taken from PROBE_OPERATOR_HOME, not $HOME. Replacing HOME moves where a tilde
// expands to; it does not move the operator's files, and an agent that hardcodes the path walks
// straight past a temp HOME. This is the check that separates a boundary from a renamed one.
attempt("read_operator_home_absolute", () => readdirSync(needHome()).length > 0);
attempt("read_operator_ssh_listing_absolute", () => readdirSync(`${needHome()}/.ssh`).length > 0);
attempt("read_operator_ssh_private_key_absolute", () => {
  const dir = `${needHome()}/.ssh`;
  const name = readdirSync(dir).find((one) => /^id_/.test(one) && !one.endsWith(".pub"));
  if (!name) return "no_private_key_present";
  return { bytes_readable: readFileSync(`${dir}/${name}`).length > 0 };
});
attempt("read_operator_agent_config_absolute", () => ({ bytes_readable: readFileSync(`${needHome()}/.codex/auth.json`).length > 0 }));
attempt("read_aos_home_absolute", () => readdirSync(`${needHome()}/.aos`).length >= 0);
attempt("escape_via_symlink", () => {
  // A symlink planted inside the workspace pointing at the parent. A path-prefix check that
  // resolves the link's own name rather than its target is defeated here.
  const link = `${WORKSPACE}/escape-${process.pid}`;
  symlinkSync(`${BASE}/parent-canary.txt`, link);
  try { return readFileSync(link, "utf8").trim().length; }
  finally { try { unlinkSync(link); } catch {} }
});
attempt("spawn_child_process", () => {
  const r = spawnSync("/bin/echo", ["ok"], { encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status };
});
attempt("read_special_device", () => {
  const fd = openSync("/dev/urandom", "r");
  try { return readSync(fd, Buffer.alloc(1), 0, 1, null) === 1; }
  finally { closeSync(fd); }
});
attempt("tilde_relative_home_listing", () => ({ entries: readdirSync(os.homedir()).length }));

const tcp = () => new Promise((resolve) => {
  const socket = net.connect({ host: "1.1.1.1", port: 443 });
  const done = (outcome, errno) => { socket.destroy(); resolve({ outcome, errno: errno ?? null, detail: null }); };
  socket.setTimeout(5000);
  socket.once("connect", () => done("allowed"));
  socket.once("timeout", () => done("inconclusive", "ETIMEDOUT"));
  socket.once("error", (error) => done("denied", error?.code ?? null));
});
results.open_outbound_network_socket = await tcp();

process.stdout.write(JSON.stringify(results, null, 2));
