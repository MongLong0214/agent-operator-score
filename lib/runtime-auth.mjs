import { execFileSync } from "node:child_process";

// Finding the runtime's own credential so the operator does not have to.
//
// A run replaces HOME, and on macOS the login keychain is resolved from HOME. A Claude Code route
// therefore could not log in: the binary looked for a keychain that was not there, raised a system
// dialog per invocation, wrote a junk item under the account name "unknown", and every family
// exited 1 with `Not logged in`.
//
// Telling the operator to mint a token by hand fixes it and is not seamless. So AOS resolves the
// credential the same way the runtime would have if HOME had not moved, and hands it over in the
// process environment under the name the binary reads *first*. Nothing is written to disk, the name
// is recorded and the value never is, and -- because that variable outranks the keychain in the
// runtime's own lookup order -- the isolated process never touches the keychain at all. That is
// what stops the dialogs, not a workaround for them.
//
// The resolver is a declaration, not a hook: an adapter names a service, an account and a path
// through the stored JSON. There is nowhere for a resolver to run arbitrary code, which matters for
// something whose whole job is reaching into the operator's credential store.

/** Never longer than this. A credential store that hangs must not hang the run. */
const TIMEOUT_MS = 4000;

const readKeychain = (service, account) => {
  const args = ["find-generic-password", "-s", service];
  if (account) args.push("-a", account);
  args.push("-w");
  try {
    return execFileSync("/usr/bin/security", args, {
      encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    // Not found, no access, or no keychain. All three mean the same thing here: nothing to carry.
    return null;
  }
};

const walk = (value, path) => path.reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), value);

/**
 * The runtime's credential, or null.
 *
 * Returns `{ name, value, source }`. Callers put the value in an environment and nowhere else: it
 * must not reach a log line, an event, a result or an error message.
 */
export function resolveRuntimeAuth(adapter, { platform = process.platform, env = process.env } = {}) {
  const resolver = adapter?.auth_resolver;
  if (!resolver) return null;

  // Already set by the operator. Theirs wins: resolving over an explicit choice would silently
  // swap the credential a run was meant to use.
  if (typeof env[resolver.env] === "string" && env[resolver.env].length > 0) {
    return { name: resolver.env, value: env[resolver.env], source: "environment" };
  }
  if (resolver.platform && resolver.platform !== platform) return null;
  if (!resolver.keychain) return null;

  // The account first, because a failed isolated run leaves a second item under "unknown" that
  // holds no login. Taking the first match found that one and concluded there was no credential.
  const accounts = [env.USER, env.LOGNAME, null].filter((value, index, all) => value !== undefined && all.indexOf(value) === index);
  for (const account of accounts) {
    const raw = readKeychain(resolver.keychain.service, account);
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const token = walk(parsed, resolver.keychain.path);
    if (typeof token === "string" && token.length > 0) {
      return { name: resolver.env, value: token, source: "keychain" };
    }
  }
  return null;
}

/** What a result may say about it. The name and where it came from, never the value. */
export const runtimeAuthRecord = (resolved) =>
  resolved === null ? null : { name: resolved.name, source: resolved.source };
