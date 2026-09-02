- **(a) DEFECT — ordinary allowlisting still carries credentials.** The matcher at [lib/env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:210) does not recognize `PGPASSWORD`, while known names are case-sensitive. Concrete inputs `--allow-env PGPASSWORD` or `--allow-env database_url` are accepted at [env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:318) and carried at [env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:390). I reproduced both reaching the built child environment.

- **(a) DEFECT — a mutated supplied policy can still forge runtime-auth or transport authorization.** [lib/isolation.mjs](/private/tmp/rv-599c/lib/isolation.mjs:84) rehashes a supplied policy but never revalidates its adapter bindings; [env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:383) then trusts its transport and runtime-auth arrays. Concrete input:

```js
const policy = envPolicyFor(ADAPTERS["generic-command.v1"], {});
policy.runtime_auth_env.push("GH_TOKEN");
buildAgentEnv("STRICT", { PATH: "/usr/bin", GH_TOKEN: "secret" }, { policy });
```

The generic child receives `GH_TOKEN`. Replacing that mutation with `policy.transport_env.push("HTTPS_PROXY")` likewise bypasses adapter declaration and separate transport approval. The exact prior `config_env` mutation is closed; these sibling routes are not.
tokens used
351,229
# BLOCK

The specific ROUND2 findings are closed as described, including the ordinary `config_env` credential route, .NET hooks, required Codex config check, digest recomputation, metadata freezing, and scratch cleanup. Three new (a)-grade defects remain:

- **(a) DEFECT — inherited `PATH` permits a forgeable assessed binary.** [lib/isolation.mjs](/private/tmp/rv-599c/lib/isolation.mjs:103) copies the ambient `PATH` unchanged, then [lib/core.mjs](/private/tmp/rv-599c/lib/core.mjs:369) resolves a bare command from it with the workspace as `cwd`. Concrete input: `PATH=.:/usr/bin`, `spec.command="codex"`, and an executable `<workspace>/codex`. The workspace binary runs and is scored as the configured Codex adapter. This violates the required verified/minimized PATH boundary.

- **(a) DEFECT — ordinary allowlisting still carries credentials.** The matcher at [lib/env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:210) does not recognize `PGPASSWORD`, while known names are case-sensitive. Concrete inputs `--allow-env PGPASSWORD` or `--allow-env database_url` are accepted at [env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:318) and carried at [env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:390). I reproduced both reaching the built child environment.

- **(a) DEFECT — a mutated supplied policy can still forge runtime-auth or transport authorization.** [lib/isolation.mjs](/private/tmp/rv-599c/lib/isolation.mjs:84) rehashes a supplied policy but never revalidates its adapter bindings; [env-policy.mjs](/private/tmp/rv-599c/lib/env-policy.mjs:383) then trusts its transport and runtime-auth arrays. Concrete input:

```js
const policy = envPolicyFor(ADAPTERS["generic-command.v1"], {});
policy.runtime_auth_env.push("GH_TOKEN");
buildAgentEnv("STRICT", { PATH: "/usr/bin", GH_TOKEN: "secret" }, { policy });
```

The generic child receives `GH_TOKEN`. Replacing that mutation with `policy.transport_env.push("HTTPS_PROXY")` likewise bypasses adapter declaration and separate transport approval. The exact prior `config_env` mutation is closed; these sibling routes are not.

[exited with code 0]
