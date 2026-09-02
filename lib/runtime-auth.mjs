import { execFileSync } from "node:child_process";

import { describeExecutable, identityDrift } from "./runtime-identity.mjs";

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
/**
 * Whether this command is the runtime the adapter names.
 *
 * `--adapter` is the operator's claim about what they registered, and nothing checked it. A blind
 * session registered an arbitrary script as `claude-code.v1` and AOS read the macOS keychain and
 * handed that script a real 108-character `CLAUDE_CODE_OAUTH_TOKEN` -- a credential the operator
 * granted to Claude Code, passed to a different program because a flag said so.
 *
 * Basename, because the runtime lives at whatever path the installer chose. This is not a defence
 * against an operator who names their own script `claude`; it is the difference between AOS reading
 * a keychain on behalf of the runtime that owns the entry and doing it for anything at all.
 */
const commandMayReceive = (resolver, command) => {
  if (!resolver.binary || typeof command !== "string" || command.length === 0) return true;
  const name = command.split("/").at(-1);
  return name === resolver.binary || name === `${resolver.binary}.exe`;
};

export function resolveRuntimeAuth(adapter, { platform = process.platform, env = process.env, command = null } = {}) {
  const resolver = adapter?.auth_resolver;
  if (!resolver) return null;

  // Already set by the operator. Theirs wins: resolving over an explicit choice would silently
  // swap the credential a run was meant to use.
  if (typeof env[resolver.env] === "string" && env[resolver.env].length > 0) {
    return { name: resolver.env, value: env[resolver.env], source: "environment" };
  }
  if (resolver.platform && resolver.platform !== platform) return null;
  if (!resolver.keychain) return null;
  // The operator's own environment variable above is theirs to set for whatever they like. Reading
  // their keychain is AOS acting on its own, and it does that only for the runtime that owns the
  // entry. `--allow-runtime-auth <NAME>` remains the deliberate way to carry one anywhere else.
  if (!commandMayReceive(resolver, command)) return null;

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

/**
 * Whether a credential may be looked up for this agent at all, and for which program.
 *
 * #554. `commandMayReceive` above compares a basename, and a basename is not an identity: the file
 * it names can be rewritten between the registration that verified it and the spawn that receives
 * the credential, the path can become a symlink to somewhere else, a wrapper can appear earlier on
 * PATH under the same name, and the directory holding any of them can be writable by another
 * account. All four leave the basename untouched, so all four passed.
 *
 * This runs *before* the resolver, which is the whole point. A check placed after it has already
 * let AOS read the operator's Keychain on behalf of a program it had not identified, and refusing
 * afterwards does not put the credential back.
 *
 * It gates a credential, not a command. An agent with nothing at stake -- no resolver on its
 * adapter and no declared credential variable -- is not verified and not refused, because this is
 * not a policy about which programs may run and turning it into one would refuse every
 * fixture-backed agent in this repository's own suite.
 */
export function authorizeRuntimeAuth(agent, adapter, { env = process.env, platform = process.platform, uid } = {}) {
  const declared = agent?.runtime_auth_env_names ?? [];
  const resolver = adapter?.auth_resolver ?? null;
  const autoRequested = agent?.auto_runtime_auth !== false && resolver !== null;
  const verdict = (fields) => ({ ok: true, auto: false, code: null, detail: "", identity: null, identity_status: null, ...fields });
  if (!autoRequested && declared.length === 0) {
    return verdict({ detail: "no credential is at stake for this agent" });
  }

  const current = describeExecutable(agent?.command, { env, platform, adapterId: adapter?.id ?? null, uid });
  if (current === null) {
    return verdict({
      ok: false,
      code: "AOS_RUNTIME_IDENTITY_MISSING",
      detail: `${agent?.id ?? "agent"}: ${agent?.command ?? "(no command)"} does not resolve to a regular executable file on this PATH, so there is no identity to hand a credential to`
    });
  }

  const registered = agent?.runtime_identity ?? null;
  if (registered === null || typeof registered !== "object") {
    // Registered before identities were recorded. Promoting it here would make the migration a
    // formality and the check decorative, so the credential stops and the way out is named.
    if (!autoRequested) {
      return verdict({
        identity: current,
        identity_status: "MIGRATION_REQUIRED",
        detail: `${agent?.id ?? "agent"} carries ${declared.join(", ")} by explicit approval and has no recorded executable identity`
      });
    }
    return verdict({
      ok: false,
      code: "AOS_RUNTIME_IDENTITY_MISSING",
      identity: current,
      identity_status: "MIGRATION_REQUIRED",
      detail: `${agent?.id ?? "agent"} has no recorded executable identity, so an automatic credential cannot be bound to the program that would receive it; re-run 'aos agent add ${agent?.id ?? "<id>"} --command ${agent?.command ?? "<binary>"}' to record one, or add --no-auto-auth`
    });
  }

  // The resolver belongs to the adapter, not to the command. A credential the operator granted to
  // one runtime must not be produced for an agent registered as another.
  if ((registered.adapter_id ?? null) !== (adapter?.id ?? null)) {
    return verdict({
      ok: false,
      code: "AOS_RUNTIME_AUTH_RESOLVER_MISMATCH",
      identity: current,
      detail: `${agent?.id ?? "agent"}: identity was recorded for ${registered.adapter_id ?? "no adapter"} and the credential resolver belongs to ${adapter?.id ?? "no adapter"}`
    });
  }

  const drift = identityDrift(registered, current);
  if (drift.length > 0) {
    return verdict({
      ok: false,
      code: "AOS_RUNTIME_IDENTITY_DRIFT",
      identity: current,
      identity_status: "DRIFT",
      detail: `${agent?.id ?? "agent"}: ${drift.join(", ")} changed since ${agent?.command ?? "the command"} was registered; re-run 'aos agent add ${agent?.id ?? "<id>"} --command ${agent?.command ?? "<binary>"}' if the change was yours`
    });
  }

  if (autoRequested && current.identity_status !== "VERIFIED") {
    return verdict({
      ok: false,
      code: "AOS_RUNTIME_IDENTITY_UNTRUSTED",
      identity: current,
      identity_status: current.identity_status,
      detail: `${agent?.id ?? "agent"}: ${current.untrusted_reasons.join("; ")}; anyone who can write there can replace the program between this check and the spawn. Move the runtime somewhere only you can write, or set the credential yourself and re-add with --allow-runtime-auth ${(adapter?.auth_env ?? [resolver.env])[0]}`
    });
  }

  // Not a refusal. The adapter's resolver simply has nothing to say about a command that is not the
  // runtime it describes, which is what it answered before this gate existed and still answers now.
  if (autoRequested && !commandMayReceive(resolver, agent?.command)) {
    return verdict({
      identity: current,
      identity_status: current.identity_status,
      code: "AOS_RUNTIME_AUTH_WRONG_BINARY",
      detail: `${agent?.command} is not ${resolver.binary}, so ${adapter?.id} resolves no credential for it`
    });
  }

  return verdict({
    auto: autoRequested,
    identity: current,
    identity_status: current.identity_status,
    detail: `${agent?.command} matches the identity recorded at registration`
  });
}

/**
 * The credential for this agent, with the identity check ahead of it.
 *
 * Callers use this rather than `resolveRuntimeAuth` directly: the ordering is the guarantee, and a
 * caller that has to remember to check first is a caller that will one day forget. A refusal throws
 * by its error code, because the run must stop -- carrying on without the credential would spend
 * the operator's quota on six families that each fail to log in, which is the failure #459 already
 * paid for.
 */
export function resolveRuntimeAuthForAgent(agent, adapter, { env = process.env, platform = process.platform, resolve = resolveRuntimeAuth } = {}) {
  const verdict = authorizeRuntimeAuth(agent, adapter, { env, platform });
  if (!verdict.ok) throw new Error(`${verdict.code} ${verdict.detail}`);
  if (!verdict.auto) return { resolved: null, verdict };
  return { resolved: resolve(adapter, { platform, env, command: agent?.command }), verdict };
}

/**
 * What a run may record about the identity a credential was bound to.
 *
 * Digests and status, never a value and never the operator's own paths beyond the one they
 * configured. #561 reuses this rather than growing a second runtime identity of its own.
 */
export const runtimeIdentityRecord = (verdict, resolved, explicit = []) => ({
  identity_status: verdict.identity_status ?? (verdict.identity?.identity_status ?? null),
  identity_digest: verdict.identity?.identity_digest ?? null,
  realpath_digest: verdict.identity?.realpath_digest ?? null,
  file_fingerprint: verdict.identity?.file_fingerprint ?? null,
  adapter_id: verdict.identity?.adapter_id ?? null,
  platform_identity_recorded: verdict.identity?.platform_identity?.recorded ?? false,
  verified_at: verdict.identity?.verified_at ?? null,
  credential_env_name: resolved?.name ?? null,
  // `explicit` is the operator having named the variable themselves with `--allow-runtime-auth`.
  // It is a different statement about a run than AOS having gone and found the credential, and the
  // wrapper policy turns on exactly that difference, so the two are not flattened into one word.
  credential_source: resolved?.source ?? (explicit.length > 0 ? "explicit" : null),
  explicit_env_names: [...explicit].sort()
});
