// Whether the operator's credential material is reachable from inside the boundary.
//
// The Keychain check uses `-w`, which is the flag that makes `security` retrieve and print the
// secret itself rather than only its attributes. That difference matters: an exit of 0 without
// `-w` proves an item was found, not that its value could be read, and a boundary claim resting on
// the weaker of those two is an overclaim. stdio is discarded before this process can see it, so
// the secret is retrieved by `security` and read by nothing.
//
// A service name that does not exist is queried alongside it as a control, so a 0 can be told from
// a keychain that answers 0 to everything.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REAL_HOME = process.env.PROBE_OPERATOR_HOME;
const out = {};
// `outcome` is the answer to the row's question, not the answer to "did this function return".
// The keychain checks ran to completion under every profile -- `security` exists and exits -- and an
// earlier version recorded that as `allowed`, which said the secret was retrievable inside a
// boundary that had refused it. A check may declare its own outcome; only the ones that answer by
// succeeding or throwing fall back to that.
const check = (name, fn) => {
  try {
    const detail = fn();
    const outcome = detail && typeof detail === "object" && "outcome" in detail ? detail.outcome : "allowed";
    const { outcome: _ignored, ...rest } = detail && typeof detail === "object" ? detail : { value: detail };
    out[name] = { outcome, errno: null, detail: rest };
  } catch (error) {
    out[name] = { outcome: "denied", errno: error?.code ?? null, detail: null };
  }
};

check("codex_auth_file_readable", () => {
  const bytes = readFileSync(`${REAL_HOME}/.codex/auth.json`);
  // Parsed, so that "readable" means "usable by the runtime" rather than "the open syscall
  // returned". The parsed object is discarded on this line and only its key count survives.
  return { key_count: Object.keys(JSON.parse(bytes.toString("utf8"))).length };
});
check("codex_config_readable", () => ({ bytes_readable: readFileSync(`${REAL_HOME}/.codex/config.toml`).length > 0 }));
check("claude_config_readable", () => ({ bytes_readable: readFileSync(`${REAL_HOME}/.claude.json`).length > 0 }));

const security = (args) => {
  const r = spawnSync("/usr/bin/security", args, { stdio: "ignore" });
  if (r.error) throw r.error;
  return r.status;
};
check("keychain_secret_retrievable", () => {
  const status = security(["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
  return { outcome: status === 0 ? "allowed" : "denied", exit_status: status, secret_retrievable: status === 0 };
});
check("keychain_absent_item_control", () => {
  // Queried for a service that does not exist. If this ever comes back allowed, the item check
  // above is not discriminating and neither reading means anything.
  const status = security(["find-generic-password", "-s", "aos-confinement-probe-absent", "-w"]);
  return { outcome: status === 0 ? "allowed" : "denied", exit_status: status, secret_retrievable: status === 0 };
});

process.stdout.write(JSON.stringify(out, null, 2));
