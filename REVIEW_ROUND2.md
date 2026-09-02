(eval):1: command not found: args
3. A pre-main injection variable is still allowed: `DOTNET_STARTUP_HOOKS` is absent from the hard-forbidden rules at [env-policy.mjs](/private/tmp/rv-599b/lib/env-policy.mjs:50). This input is accepted and carried:

```sh
DOTNET_STARTUP_HOOKS=/tmp/Hook.dll \
  aos agent add dotnet \
  --command dotnet \
  --arg app.dll \
  --allow-env DOTNET_STARTUP_HOOKS
```

A valid hook assembly runs before the application’s `Main`, exactly the class this policy claims cannot be allowed. [.NET runtime design documentation](https://github.com/dotnet/runtime/blob/main/docs/design/features/host-startup-hook.md)

4. Codex’s real default configuration is still missing unless the caller already exports `CODEX_HOME`. Folding the adapter’s `config_env` at [env-policy.mjs](/private/tmp/rv-599b/lib/env-policy.mjs:236) carries an existing variable; it does not derive it. A normal Codex installation uses `$HOME/.codex`, but AOS creates a fresh home at [core.mjs](/private/tmp/rv-599b/lib/core.mjs:315) and installs it at [isolation.mjs](/private/tmp/rv-599b/lib/isolation.mjs:131).

I reproduced:

```text
codex login status
Logged in using ChatGPT.

env -i PATH=<same-path> HOME=/private/tmp/aos-review-no-home-555 codex login status
Not logged in.
```

That is the effective AOS case when `CODEX_HOME` was originally unset. The new test supplies an ambient `CODEX_HOME`, so it misses the ordinary installation. Worse, readiness treats the mere declaration as proof that it is carried without checking that a value exists: [cli.mjs](/private/tmp/rv-599b/lib/cli.mjs:1445) and [cli.mjs](/private/tmp/rv-599b/lib/cli.mjs:1459). Codex needs an effective value such as the original `$HOME/.codex`, while keeping the child’s HOME isolated.

5. `env_policy_digest` is correctly propagated on the normal successful core path: the same freshly created policy object is used by the builder and record, automatic runtime-auth state changes its digest, and scored results now carry a per-invocation value. It is not yet genuinely bound to every applied policy rule.

`RUN_METADATA_ENV` at [isolation.mjs](/private/tmp/rv-599b/lib/isolation.mjs:59) is neither hashed nor frozen. For example:

```js
RUN_METADATA_ENV.push("AOS_HOME");
```

After that, `buildAgentEnv()` accepts injected `AOS_HOME` while the policy digest remains unchanged. The unconditional `AOS_*` removal rule is likewise absent from the digest inputs. Also, the builder trusts a mutable supplied policy at [isolation.mjs](/private/tmp/rv-599b/lib/isolation.mjs:93), while the record merely copies its precomputed digest at [isolation.mjs](/private/tmp/rv-599b/lib/isolation.mjs:220). Appending `GH_TOKEN` to `policy.config_env` after `envPolicyFor()` makes the child receive it under the stale digest.

Thus the successful CLI path is internally consistent, but the digest does not cryptographically describe all environment rules that were applied, and finding 1 means it cannot describe everything the child can observe.

6. The new mismatch throw introduces a resource leak. `runProcess()` creates the prompt and agent-home temporary directories at [core.mjs](/private/tmp/rv-599b/lib/core.mjs:315), calls `envPolicyFor()` and the builder, and only enters its cleanup-protected `try` at [core.mjs](/private/tmp/rv-599b/lib/core.mjs:361). A hand-edited runtime-auth mismatch throws before the `finally` at [core.mjs](/private/tmp/rv-599b/lib/core.mjs:484), leaving both directories behind.

The specific closures otherwise check out: case folding is fixed; the listed Python/R preload and transport names were added; `auto_runtime_auth` participates in profile identity; `home_source` is closed in both builder and record; and the production injected merge currently accepts only the four run-metadata names and refuses `AOS_HOME`.

Several test names still overclaim their assertions:

- “a stored configuration cannot hand a credential…” tests only `runtime_auth_env_names`; the ordinary `allowed_env_names` route above succeeds: [adapter-env-policy.test.mjs](/private/tmp/rv-599b/tests/product/adapter-env-policy.test.mjs:350).
- “doctor says which names a run will carry…” explicitly adds `CODEX_HOME`, never tests an absent value, and does not exercise automatic auth: [adapter-env-policy.test.mjs](/private/tmp/rv-599b/tests/product/adapter-env-policy.test.mjs:554).
- “profile digest cannot cover automatic credential resolution, and the run says so” manually builds a policy and record; it never runs the core or assessor: [adapter-env-policy.test.mjs](/private/tmp/rv-599b/tests/product/adapter-env-policy.test.mjs:446).
- The isolation claim that credential-shaped names are removed “at both levels” is contradicted by the direct builder test that intentionally carries `ANTHROPIC_API_KEY`: [isolation.test.mjs](/private/tmp/rv-599b/tests/product/isolation.test.mjs:79).

I found no newly added mutation replacement whose `to` value would leave its specifically named test passing, but those guards cover the narrow assertions above and do not guard the ordinary-allow credential bypass. The focused policy, isolation, and mutation-manifest tests I could run all passed; the read-only workspace prevented running the write-based mutation harness.

[exited with code 0]
