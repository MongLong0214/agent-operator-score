import { createHash } from "node:crypto";

// Which names an adapter is allowed to ask for, and which no flag can ever unlock.
//
// The child environment used to be the operator's own environment with the dangerous names
// subtracted. That is a denylist, and a denylist over environment variables cannot be finished:
// every language runtime, every loader and every package manager adds its own hook, and the ones
// that matter are the ones nobody has heard of yet. Measured on this machine before the change, a
// `DYLD_INSERT_LIBRARIES` sitting in the operator's shell reached the spawned agent and dyld
// terminated it trying to load the named library -- the assessed process never ran its own first
// line, and nothing in the run record said why.
//
// So the direction is inverted. An adapter declares what its runtime needs, AOS adds the few
// structural names a process needs to start at all, and everything else is absent because it was
// never named. A variable invented tomorrow is excluded by construction rather than by a patch.
//
// This module deliberately imports nothing from the rest of `lib/`. `core.mjs` already imports
// `isolation.mjs`, which imports this, and pulling `canonicalJson` back out of `core.mjs` would
// close that loop around a module whose whole job is to be the fixed point everything else is
// checked against. The digest below serialises a flat, declared shape, so it does not need one.

export const ENV_POLICY_SCHEMA = "aos-adapter-env-policy.v1";
export const ENV_POLICY_VERSION = 1;

/**
 * The names a process needs before it is the runtime anybody asked for.
 *
 * `HOME` and `TMPDIR` are absent on purpose: AOS makes those itself and injects them, so inheriting
 * them here would be the one thing isolation exists to prevent. `SHELL`, `USER` and `LOGNAME` are
 * absent too -- an adapter that genuinely needs one declares it, which is a sentence somebody has
 * to write down rather than a default nobody reviewed.
 */
export const STRUCTURAL_ENV = [
  "PATH", "LANG", "TERM", "TZ",
  // The POSIX locale categories, by name rather than by an `LC_` prefix. A prefix looks tidier and
  // is a hole: `LC_TERMINAL` and `LC_TERMINAL_VERSION` are iTerm2's, not the locale's, and they
  // travelled through the prefix rule on the machine this was written on. Anything a terminal, a
  // shell plugin or a future tool invents under that prefix would have travelled with them.
  "LC_ALL", "LC_COLLATE", "LC_CTYPE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME"
];

/**
 * Classes that change what a process *is* before its first instruction.
 *
 * Not a denylist that decides what travels -- nothing travels unless it is named -- but the rule
 * that no name can be declared into the allowlist. `--allow-env NODE_OPTIONS` is refused at the
 * CLI, and refused again here, because the two are different failures: one is an operator typing
 * something, the other is a hand-edited config file reaching a spawn. There is no flag for these.
 */
export const HARD_FORBIDDEN_CLASSES = {
  // An inserted library runs inside the assessed process with its permissions and before its code.
  loader_preload: { names: ["LD_PRELOAD", "LD_AUDIT", "LD_LIBRARY_PATH"], prefixes: ["LD_", "DYLD_"] },
  // A startup file is read before the command anybody recorded, so the command is not what ran.
  shell_startup: { names: ["BASH_ENV", "ENV", "ZDOTDIR", "SHELLOPTS", "PROMPT_COMMAND", "IFS"], prefixes: ["BASH_FUNC_"] },
  // `--require ./evil.cjs` is the node spelling of the same idea; every runtime has one.
  language_preload: {
    names: [
      "NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE",
      "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
      "PERL5LIB", "PERL5OPT",
      "RUBYOPT", "RUBYLIB",
      "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH",
      "LUA_PATH", "LUA_CPATH", "R_PROFILE", "R_PROFILE_USER",
      "GEM_HOME", "GEM_PATH"
    ],
    prefixes: []
  },
  // Git runs a command of the operator's choosing on fetch, on diff and on ssh. An agent that can
  // set one of these can run anything and have it look like version control doing its job.
  git_override: { names: [], prefixes: ["GIT_"] },
  // `npm_config_*` reaches into lifecycle scripts, registries and the binaries a build resolves.
  package_manager: { names: [], prefixes: ["npm_", "NPM_CONFIG_", "YARN_", "PNPM_", "COREPACK_", "BUN_"] }
};

/**
 * Proxy and certificate names, which are not the same problem.
 *
 * A loader hook has no legitimate reading. A proxy does: an operator behind a corporate egress
 * cannot reach the provider without one. But it also redirects and can terminate TLS for every call
 * the assessed run makes, so it travels only when the adapter says its runtime needs one *and* the
 * operator approves it by name -- and it moves the profile digest when it does, because a run whose
 * traffic went somewhere else is not the same measurement.
 */
export const TRANSPORT_ENV = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "FTP_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy", "ftp_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"
];

const TRANSPORT_SET = new Set(TRANSPORT_ENV);

/** Which hard-forbidden class a name belongs to, or null. */
export function hardForbiddenClassOf(name) {
  for (const [className, rule] of Object.entries(HARD_FORBIDDEN_CLASSES)) {
    if (rule.names.includes(name)) return className;
    if (rule.prefixes.some((prefix) => name.startsWith(prefix))) return className;
  }
  return null;
}

export const isTransportName = (name) => TRANSPORT_SET.has(name);

const isStructuralName = (name) => STRUCTURAL_ENV.includes(name);

const unique = (values) => [...new Set(values)].sort();

/**
 * A stable digest over the declared shape.
 *
 * Field order is written out rather than taken from `Object.keys`, so a policy that gains a field
 * later cannot silently change the digest of one that did not. Values never enter it: this is a
 * digest of what a run was permitted to carry, and it goes into an evidence bundle.
 */
function envPolicyDigest(policy) {
  const ordered = [
    ["schema_id", policy.schema_id],
    ["adapter_id", policy.adapter_id],
    ["policy_version", policy.policy_version],
    ["structural_env", policy.structural_env],
    ["config_env", policy.config_env],
    ["runtime_auth_env", policy.runtime_auth_env],
    ["transport_env", policy.transport_env],
    ["hard_forbidden_env", policy.hard_forbidden_env]
  ];
  return `sha256:${createHash("sha256").update(JSON.stringify(ordered), "utf8").digest("hex")}`;
}

/**
 * The policy in force for one run.
 *
 * `adapter` is a `profile.mjs` adapter or null. Null is the generic case and is treated as the
 * generic adapter deliberately: a runtime nobody described gets structural names and nothing else,
 * because naming a credential or a proxy for software this product has never seen would be guessing
 * which of the operator's secrets to hand over.
 *
 * Throws rather than filtering when something was declared that cannot be granted. A run that
 * quietly drops a name the operator asked for produces a result whose environment nobody can
 * reconstruct, and a run that quietly keeps one is the failure this file exists to prevent.
 */
export function envPolicyFor(adapter, { allow = [], runtimeAuth = [], transport = [] } = {}) {
  const adapterId = adapter?.id ?? "generic-command.v1";
  const declared = adapter?.env_policy ?? {};

  const forbidden = [...allow, ...runtimeAuth, ...transport].map((name) => [name, hardForbiddenClassOf(name)]).filter(([, className]) => className);
  if (forbidden.length > 0) {
    const detail = forbidden.map(([name, className]) => `${name} (${className})`).join(", ");
    throw new Error(`AOS_ENV_HARD_FORBIDDEN ${detail}; no flag and no adapter can carry these`);
  }

  const transportInAllow = allow.filter((name) => isTransportName(name));
  if (transportInAllow.length > 0) {
    throw new Error(
      `AOS_ENV_EXPLICIT_APPROVAL_REQUIRED ${unique(transportInAllow).join(", ")}; proxy and certificate names need --allow-transport-env`
    );
  }

  const declaredTransport = declared.transport_env ?? [];
  const unverified = transport.filter((name) => !isTransportName(name) || !declaredTransport.includes(name));
  if (unverified.length > 0) {
    throw new Error(
      `AOS_ENV_TRANSPORT_UNVERIFIED ${unique(unverified).join(", ")} for ${adapterId}; this adapter declares no need for them`
    );
  }

  const policy = {
    schema_id: ENV_POLICY_SCHEMA,
    adapter_id: adapterId,
    policy_version: ENV_POLICY_VERSION,
    structural_env: unique([...STRUCTURAL_ENV, ...(declared.structural_env ?? [])]),
    config_env: unique(allow),
    runtime_auth_env: unique(runtimeAuth),
    transport_env: unique(transport),
    hard_forbidden_env: Object.keys(HARD_FORBIDDEN_CLASSES).sort()
  };
  return { ...policy, policy_digest: envPolicyDigest(policy) };
}

/**
 * Whether one name may travel under this policy, and why.
 *
 * Structural names are matched by prefix as well as by list so that `LC_NUMERIC` is locale rather
 * than an unknown; everything else has to appear by name in something the adapter or the operator
 * declared. The hard-forbidden check runs first even though nothing here can reach it through the
 * allowlist, because `envPolicyFor` is not the only way a policy object arrives at a spawn.
 */
export function envDecision(policy, name) {
  const forbidden = hardForbiddenClassOf(name);
  if (forbidden) return { carry: false, reason: `hard_forbidden:${forbidden}` };
  if (policy.transport_env.includes(name)) return { carry: true, reason: "transport" };
  if (policy.runtime_auth_env.includes(name)) return { carry: true, reason: "runtime_auth" };
  if (policy.config_env.includes(name)) return { carry: true, reason: "config" };
  if (policy.structural_env.includes(name) || isStructuralName(name)) return { carry: true, reason: "structural" };
  return { carry: false, reason: "not_declared" };
}
