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
  // The CoreCLR profiler is the same mechanism spelled for .NET: the runtime loads the named
  // assembly into the process at startup, and `COMPlus_` is the legacy prefix for the same knobs.
  loader_preload: {
    names: ["LD_PRELOAD", "LD_AUDIT", "LD_LIBRARY_PATH", "CORECLR_ENABLE_PROFILING", "CORECLR_PROFILER", "CORECLR_PROFILER_PATH", "CORECLR_PROFILER_PATH_32", "CORECLR_PROFILER_PATH_64"],
    prefixes: ["LD_", "DYLD_", "COMPLUS_"]
  },
  // A startup file is read before the command anybody recorded, so the command is not what ran.
  shell_startup: { names: ["BASH_ENV", "ENV", "ZDOTDIR", "SHELLOPTS", "PROMPT_COMMAND", "IFS"], prefixes: ["BASH_FUNC_"] },
  // `--require ./evil.cjs` is the node spelling of the same idea; every runtime has one.
  language_preload: {
    names: [
      "NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE",
      "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
      // Not a search path but a base for one: CPython enables its user site directory under
      // `$PYTHONUSERBASE/lib/python*/site-packages`, and a `.pth` file there may hold an `import`
      // line, which runs at interpreter start. Reviewed on this darwin host against
      // `/usr/bin/python3`, where a `.pth` under a pointed-at base executed before the assessed
      // script. It reads as a directory setting, which is why it was missing from this list.
      "PYTHONUSERBASE",
      "PERL5LIB", "PERL5OPT",
      "RUBYOPT", "RUBYLIB",
      "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH",
      "LUA_PATH", "LUA_CPATH", "R_PROFILE", "R_PROFILE_USER",
      // The same shape again in R: an environ file is read at startup, and `R_ENVIRON_USER` says
      // which one. Listed beside the profile names it belongs with.
      "R_ENVIRON", "R_ENVIRON_USER",
      // .NET's own pre-main hook: the host loads each assembly named here and runs its
      // `StartupHook.Initialize` before the application's `Main`. Documented by the runtime as a
      // supported feature, which is what makes it a supported way to change what ran.
      // https://github.com/dotnet/runtime/blob/main/docs/design/features/host-startup-hook.md
      "DOTNET_STARTUP_HOOKS",
      "GEM_HOME", "GEM_PATH"
    ],
    prefixes: []
  },
  // Git runs a command of the operator's choosing on fetch, on diff and on ssh. An agent that can
  // set one of these can run anything and have it look like version control doing its job.
  git_override: { names: [], prefixes: ["GIT_"] },
  // `npm_config_*` reaches into lifecycle scripts, registries and the binaries a build resolves.
  // The prefix is the bare `NPM_` rather than `NPM_CONFIG_` because npm also re-invokes node
  // through `npm_execpath` and `npm_node_execpath`, which are the same problem under another name.
  package_manager: { names: [], prefixes: ["NPM_", "YARN_", "PNPM_", "COREPACK_", "BUN_"] }
};

/**
 * The form a name is compared in.
 *
 * POSIX environment lookup is case-sensitive, so `NpM_cOnFiG_node_options` and `npm_config_node_options`
 * are two different variables and a case-sensitive rule matches neither the second nor the first.
 * The programs that read them are not so careful: npm lower-cases every environment key before it
 * looks for its own, so the mixed-case spelling above arrives at a lifecycle child as
 * `NODE_OPTIONS`. Reviewed against this build, that name was recorded as carried with no blocked
 * class, and the child node process then failed before its first instruction trying to require the
 * named file.
 *
 * So refusal compares case-insensitively and carrying still compares exactly: the allowlist grants
 * the name that was written down, and the denylist covers every spelling a consumer might fold it
 * into. A rule that is loose in the refusing direction and tight in the granting direction cannot
 * be walked around by choosing a different capitalisation.
 */
const canonical = (name) => name.toUpperCase();

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
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
  // The same decision spelled by four other runtimes. Each was reachable through an ordinary
  // `--allow-env` while the proxy names beside them needed a separate approval, which made the
  // approval a spelling test rather than a boundary: `CARGO_HTTP_PROXY` redirects exactly what
  // `HTTPS_PROXY` redirects, `CURL_HOME` points curl at an rc file that can set either, and
  // `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH` replaces the root store for anything built on grpc.
  "CARGO_HTTP_PROXY", "CARGO_HTTP_CAINFO", "CURL_HOME", "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH",
  // Not a redirection but the check that would have caught one. `NODE_TLS_REJECT_UNAUTHORIZED=0`
  // makes every certificate acceptable, so a run carrying it cannot claim its traffic reached the
  // provider it names. It belongs on the same approval as the proxy it usually accompanies.
  "NODE_TLS_REJECT_UNAUTHORIZED"
];

const TRANSPORT_SET = new Set(TRANSPORT_ENV.map(canonical));

/** Which hard-forbidden class a name belongs to, or null. Case-insensitive; see `canonical`. */
export function hardForbiddenClassOf(name) {
  const key = canonical(name);
  for (const [className, rule] of Object.entries(HARD_FORBIDDEN_CLASSES)) {
    if (rule.names.some((entry) => canonical(entry) === key)) return className;
    if (rule.prefixes.some((prefix) => key.startsWith(canonical(prefix)))) return className;
  }
  return null;
}

export const isTransportName = (name) => TRANSPORT_SET.has(canonical(name));

/**
 * The only names AOS adds to the child after the policy has decided.
 *
 * They are `AOS_*`, which is the one prefix withheld unconditionally, so they cannot arrive by
 * being carried and have to arrive by being added. That door was unchecked, which made it a way
 * past the allowlist; it is now this list and nothing else. `AOS_HOME` is deliberately absent --
 * an agent handed it can rewrite the run records, the results and the holdout ledger the score is
 * read from.
 *
 * Declared here rather than in `isolation.mjs` so that it reaches the digest. A rule the builder
 * applies and the digest does not describe is a rule a record cannot be checked against.
 *
 * Frozen, unlike `HARD_FORBIDDEN_CLASSES`, and the difference is not an oversight. A hard-forbidden
 * name is refused at three sites -- the CLI, policy construction and the carry decision -- and its
 * binding to the digest is provable by flipping a carry. This list is applied once and checked
 * nowhere else, so `RUN_METADATA_ENV.push("AOS_HOME")` was a one-line route to handing an agent the
 * directory holding the runs, the results and the holdout ledger its own score is read from. A rule
 * with no second reader gets a lock instead.
 */
export const RUN_METADATA_ENV = Object.freeze(["AOS_FAMILY", "AOS_SESSION_ID", "AOS_TASK_FILE", "AOS_WORKSPACE"]);

/**
 * Prefixes withheld from the operator's environment before the policy is consulted at all.
 *
 * `AOS_HOME` points at the operator's runs, results, holdout ledger and cycle, and every assessed
 * agent runs with the operator's own write permissions. No policy can grant these: the check runs
 * before the allowlist, and it is here rather than in the builder so the digest covers it.
 */
export const WITHHELD_ENV_PREFIXES = Object.freeze(["AOS_"]);

const isStructuralName = (name) => STRUCTURAL_ENV.includes(name);

// Named because they are known credential carriers. This list is no longer what keeps them out of
// the child -- nothing travels unless a policy names it -- but it is what refuses them at the
// point an operator tries to declare one with `--allow-env`, where the message can say why.
//
// It lives here rather than in `isolation.mjs` because this module is the one every other one
// checks against, and a name rule enforced from a module that imports this one is a rule the
// policy object itself does not know about. `isolation.mjs` re-exports it so existing callers are
// unchanged.
const DENIED_NAMES = new Set([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "SSH_AUTH_SOCK",
  "NPM_TOKEN",
  "NODE_OPTIONS"
]);

const DENIED_PREFIXES = ["AWS_", "GOOGLE_", "AZURE_", "GCP_", "GCLOUD_", "DIGITALOCEAN_", "CLOUDFLARE_", "AOS_"];

// A name-shape rule, so a variable nobody listed still cannot be declared. `ACME_FAKE_SECRET` and
// `ACME_PROD_DB_PASSWORD` are both caught here and neither is in any list.
const DENIED_SHAPE = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|APIKEY|PRIVATE)(?:_|$)/i;

export function isSensitiveName(name) {
  if (DENIED_NAMES.has(name)) return true;
  if (DENIED_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return DENIED_SHAPE.test(name);
}

const unique = (values) => [...new Set(values)].sort();

/**
 * The hard-forbidden ruleset as the digest sees it.
 *
 * The digest used to cover the class *names*, which are a constant of this build and therefore say
 * nothing. Adding `PYTHONUSERBASE` to `language_preload` flips an existing policy from carrying that
 * name to refusing it, and under the old input the digest of that policy did not move -- so an
 * evidence bundle quoted the same number for two runs whose allowlists differed. The contents are
 * what the policy actually is, so the contents are what is hashed.
 */
const hardForbiddenRules = () =>
  Object.entries(HARD_FORBIDDEN_CLASSES)
    .map(([className, rule]) => [className, unique(rule.names), unique(rule.prefixes)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

/**
 * A stable digest over the declared shape.
 *
 * Field order is written out rather than taken from `Object.keys`, so a policy that gains a field
 * later cannot silently change the digest of one that did not. Values never enter it: this is a
 * digest of what a run was permitted to carry, and it goes into an evidence bundle.
 */
export function envPolicyDigestOf(policy) {
  const ordered = [
    ["schema_id", policy.schema_id],
    ["adapter_id", policy.adapter_id],
    ["policy_version", policy.policy_version],
    ["structural_env", policy.structural_env],
    ["config_env", policy.config_env],
    ["required_env", policy.required_env ?? []],
    ["runtime_auth_env", policy.runtime_auth_env],
    ["transport_env", policy.transport_env],
    ["hard_forbidden_env", policy.hard_forbidden_env],
    ["hard_forbidden_rules", hardForbiddenRules()],
    // The two rules the builder applies without consulting the allowlist. Neither was hashed, so
    // adding `AOS_HOME` to the run-metadata list changed what the child received while the digest
    // stayed where it was -- and a digest that does not describe what was applied is the thing a
    // digest exists to prevent.
    ["run_metadata_env", unique(policy.run_metadata_env ?? RUN_METADATA_ENV)],
    ["withheld_env_prefixes", unique(policy.withheld_env_prefixes ?? WITHHELD_ENV_PREFIXES)]
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

  // The adapter's own configuration directory, without the operator having to repeat it. It is the
  // one name the runtime cannot start without finding, the adapter is where that fact is written
  // down, and requiring `--allow-env CODEX_HOME` on top of `--adapter codex-cli.v1` meant a hand
  // registration silently produced a Codex that could not see its own login.
  const declaredConfig = [...(declared.config_env ?? []), ...(adapter?.config_env ? [adapter.config_env] : [])];

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

  // A credential-shaped name is not a config name, whichever list it arrives in.
  //
  // `aos agent add` refused `--allow-env GH_TOKEN` and this did not, so the ordinary route was a
  // working credential bypass from a hand-edited config: the CLI's message named the boundary and
  // nothing enforced it where a spawn could see it. The previous round argued that a config file is
  // not a boundary because whoever edits it already controls `command` -- true, and beside the
  // point, because the product's own claim is that a credential never travels this way. Either the
  // claim goes or the check does; the check is cheaper and the claim is worth keeping.
  //
  // `runtimeAuth` is exempt by construction: those names are credential-shaped by nature, they are
  // bound to the adapter that reads them a few lines below, and that is the door this one exists to
  // make people use.
  const credentialShaped = allow.filter((name) => isSensitiveName(name));
  if (credentialShaped.length > 0) {
    const remedy = (adapter?.auth_env ?? []).some((name) => credentialShaped.includes(name))
      ? `use the runtime auth declaration for this adapter's own credential (${adapter.auth_env.join(", ")})`
      : "point the runtime at a config directory instead";
    throw new Error(
      `AOS_ENV_POLICY_MISMATCH ${unique(credentialShaped).join(", ")} is credential-shaped and cannot be an ordinary allowed name; ${remedy}`
    );
  }

  // The credential gate, repeated where the spawn can see it.
  //
  // `aos agent add` already refuses `--allow-runtime-auth` for a name the adapter does not read,
  // and that check is not reachable from a configuration file somebody edited by hand. Reviewed on
  // this build: a stored agent of `{"adapter": "generic-command.v1", "runtime_auth_env_names":
  // ["GH_TOKEN"]}` had the operator's GitHub token copied into a child running an arbitrary
  // command, classified in the record as runtime auth. Carrying a credential is AOS acting on the
  // operator's store rather than the operator handing over something of theirs, so the adapter
  // that owns the credential has to be the adapter receiving it -- and the generic adapter, which
  // declares none, receives none. This is the same rule `runtime-auth.mjs` applies to the binary.
  const declaredAuth = adapter?.auth_env ?? [];
  const undeclaredAuth = runtimeAuth.filter((name) => !declaredAuth.includes(name));
  if (undeclaredAuth.length > 0) {
    const known = declaredAuth.length > 0 ? declaredAuth.join(", ") : "none: this adapter has no credential of its own";
    throw new Error(
      `AOS_ENV_POLICY_MISMATCH ${unique(undeclaredAuth).join(", ")} for ${adapterId}; this adapter reads ${known}`
    );
  }

  const policy = {
    schema_id: ENV_POLICY_SCHEMA,
    adapter_id: adapterId,
    policy_version: ENV_POLICY_VERSION,
    structural_env: unique([...STRUCTURAL_ENV, ...(declared.structural_env ?? [])]),
    config_env: unique([...declaredConfig, ...allow]),
    // The names the adapter says its runtime cannot start without, kept apart from the rest of the
    // config set. Declared is not the same as required: Claude Code names a config directory it
    // does not need, because its credential is in the Keychain. An absent required name is a
    // blocker `agent doctor` can state before a quota is spent; an absent declared one is reported.
    required_env: unique(declared.required_env ?? []),
    runtime_auth_env: unique(runtimeAuth),
    transport_env: unique(transport),
    hard_forbidden_env: Object.keys(HARD_FORBIDDEN_CLASSES).sort(),
    run_metadata_env: unique(RUN_METADATA_ENV),
    withheld_env_prefixes: unique(WITHHELD_ENV_PREFIXES)
  };
  return { ...policy, policy_digest: envPolicyDigestOf(policy) };
}

/**
 * Whether one name may travel under this policy, and why.
 *
 * Every branch matches by name. There is no prefix rule here, and the comment that used to say
 * there was described `STRUCTURAL_ENV` before the `LC_` prefix came out of it -- `LC_TERMINAL` is
 * iTerm2's, not the locale's, and it travelled through that rule on the machine this was written
 * on. The seven locale names are listed individually for that reason.
 *
 * `STRUCTURAL_ENV` is consulted as well as `policy.structural_env` because a policy object that
 * arrived without being built here may not carry the structural set, and a process with no `PATH`
 * cannot run at all. The hard-forbidden check runs first for the same reason: `envPolicyFor` is not
 * the only way a policy object reaches a spawn.
 */
export function envDecision(policy, name) {
  const forbidden = hardForbiddenClassOf(name);
  if (forbidden) return { carry: false, reason: `hard_forbidden:${forbidden}` };
  if (policy.transport_env.includes(name)) return { carry: true, reason: "transport" };
  if (policy.runtime_auth_env.includes(name)) return { carry: true, reason: "runtime_auth" };
  // Checked again here, and after `runtime_auth` so that a runtime's own credential still travels
  // through the door built for it. `envPolicyFor` refuses these when the policy is constructed, but
  // a policy object does not have to arrive from there: appending `GH_TOKEN` to `config_env` after
  // construction handed the child that variable, and the record quoted the digest of the untampered
  // object. The carry decision is the last place that can still say no.
  if (policy.config_env.includes(name)) {
    return isSensitiveName(name)
      ? { carry: false, reason: "credential_shaped" }
      : { carry: true, reason: "config" };
  }
  if (policy.structural_env.includes(name) || isStructuralName(name)) return { carry: true, reason: "structural" };
  return { carry: false, reason: "not_declared" };
}
