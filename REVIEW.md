```sh
export NpM_cOnFiG_node_options='--require=/tmp/evil.cjs'
aos agent add npm-agent --command npm --arg run --arg test \
  --allow-env NpM_cOnFiG_node_options
```

npm normalizes that key to `node-options` and supplies `NODE_OPTIONS` to its lifecycle child. I proved this through `buildAgentEnv`: the mixed-case name was recorded as carried with no blocked class, and npm’s child Node failed before its first instruction trying to require `/definitely/aos-mixed-case-preload.cjs`.

3. High: the hard-forbidden classes remain an incomplete denylist for explicitly allowed names. `PYTHONUSERBASE` is absent from [env-policy.mjs:56](/private/tmp/rv-599/lib/env-policy.mjs:56). On this Darwin host `/usr/bin/python3` enables its user site under `$PYTHONUSERBASE/lib/python/site-packages`, including executable `.pth` import lines. Therefore:

```sh
export PYTHONUSERBASE=/tmp/attacker
# /tmp/attacker/lib/python/site-packages/00evil.pth:
# import os; os.system("/tmp/evil-before-agent")
aos agent add py --command /usr/bin/python3 \
  --allow-env PYTHONUSERBASE
```

executes before the assessed script. Similar omissions include `R_ENVIRON_USER`. Separately, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`, `CURL_HOME`, and `CARGO_HTTP_PROXY` are not classified by [TRANSPORT_ENV](/private/tmp/rv-599/lib/env-policy.mjs:84), so they pass through ordinary `--allow-env`, bypassing the separate transport approval and being recorded as `explicit_env_names`, not transport.

4. High: a hand-edited config can give any credential to any adapter. The CLI cross-checks `--allow-runtime-auth` against `adapter.auth_env` at [cli.mjs:1235](/private/tmp/rv-599/lib/cli.mjs:1235), but `envPolicyFor` does not repeat that check at [env-policy.mjs:140](/private/tmp/rv-599/lib/env-policy.mjs:140). [readConfig](/private/tmp/rv-599/lib/store.mjs:74) validates only the top-level shape, and [core.mjs:329](/private/tmp/rv-599/lib/core.mjs:329) trusts the stored names. This config works:

```json
{
  "adapter": "generic-command.v1",
  "runtime_auth_env_names": ["GH_TOKEN"]
}
```

With `GH_TOKEN` in the parent, the builder copied its value into the generic child and classified it as runtime auth. The same problem exists for `allowed_env_names`: `--allow-env KUBECONFIG` or `CLOUDSDK_CONFIG` is accepted even though neither is declared by the adapter. Thus the implementation is operator-declared, not adapter-declared. The cycle-avoidance split has already drifted: sensitive-name validation lives only in `isolation.mjs`/the CLI, while the purported authoritative policy module does not enforce it.

5. High: the digest stored for scored assessments is not necessarily the policy applied. [profile.mjs:185](/private/tmp/rv-599/lib/profile.mjs:185) hashes only configured runtime-auth names. At execution, [core.mjs:328](/private/tmp/rv-599/lib/core.mjs:328) can discover `CLAUDE_CODE_OAUTH_TOKEN` from the environment or Keychain and builds a different policy. Toggling that credential changes the child environment without changing the precomputed profile digest. The accurate per-invocation isolation object is then discarded when final `family_results` retain only six process fields at [cli.mjs:1063](/private/tmp/rv-599/lib/cli.mjs:1063). Consequently, scored result files do not carry the newly claimed transport, explicit, blocked-class, home-source, or applied-policy records.

The digest also covers only hard-forbidden class names at [env-policy.mjs:173](/private/tmp/rv-599/lib/env-policy.mjs:173), not their names or prefixes. Adding or removing `PYTHONUSERBASE` from `language_preload` changes `envDecision` while leaving the digest unchanged. I demonstrated an existing policy switching from `carry: true` to `hard_forbidden:language_preload` without its digest moving.

6. Medium: `home_source` is not restricted to kinds. [buildAgentEnv](/private/tmp/rv-599/lib/isolation.mjs:70) accepts an arbitrary `homeSource`, and [isolationRecord](/private/tmp/rv-599/lib/isolation.mjs:210) emits it verbatim. Concrete input:

```js
buildAgentEnv("STRICT", { PATH: "/usr/bin" }, {
  home: "/tmp/agent",
  homeSource: "/Users/alice/private/home"
});
```

records that path. The current `core.mjs` call uses the safe default, so I found no path leak through the present CLI path, but “never by path on every branch” is not enforced.

Compatibility-wise, installed Codex 0.148.0 and Claude Code 2.1.258 both passed version probes without `SHELL`, `USER`, or `LOGNAME`; I found no startup break there. Real coding workflows do break: `SSH_AUTH_SOCK` is unconditionally refused at [isolation.mjs:42](/private/tmp/rv-599/lib/isolation.mjs:42), the replacement HOME hides Git/private-registry configuration, and project toolchain selectors such as `DEVELOPER_DIR`, `SDKROOT`, `JAVA_HOME`, and `ANDROID_HOME` disappear unless individually configured. Also, `adapter.config_env` is not automatically incorporated by `envPolicyFor`; manual Codex registration drops `CODEX_HOME` unless the operator repeats `--allow-env CODEX_HOME`.

The seven locale names at [env-policy.mjs:33](/private/tmp/rv-599/lib/env-policy.mjs:33) are the complete POSIX set—`LC_ALL` plus six categories—and no `LC_` prefix match remains. The comment at [env-policy.mjs:181](/private/tmp/rv-599/lib/env-policy.mjs:181) incorrectly claims prefix matching. Darwin adds `__CF_USER_TEXT_ENCODING` after exec; the parent’s supplied value is overwritten, so I found no injection there, but it is absent from the isolation record despite the “everything the child actually has” claim.

I could not reintroduce an ambient variable between `buildAgentEnv` and the direct spawn, nor through the verifier’s literal `baseEnv` at [verifier-run.mjs:24](/private/tmp/rv-599/lib/verifier-run.mjs:24). I also found no direct value leak through `transport_env_names`, `explicit_env_names`, `blocked_env_classes`, or the digest on the current core path.

The rewritten existing tests are not weaker for their former contracts, and the helper’s two fixture declarations preserve what old `BEST_EFFORT_CLI` already exposed. However, several new names overclaim:

- [adapter-env-policy.test.mjs:199](/private/tmp/rv-599/tests/product/adapter-env-policy.test.mjs:199) says “adapter’s declared config directory” but supplies `allowed_env_names` directly.
- [adapter-env-policy.test.mjs:253](/private/tmp/rv-599/tests/product/adapter-env-policy.test.mjs:253) says “any route” but does not test adapter `structural_env` or the unchecked post-policy `injected` merge at [isolation.mjs:136](/private/tmp/rv-599/lib/isolation.mjs:136).
- [adapter-env-policy.test.mjs:306](/private/tmp/rv-599/tests/product/adapter-env-policy.test.mjs:306) says it tests the isolation record, but never calls `isolationRecord`.
- The policy-digest test does not mutate forbidden-rule contents or compare the profile digest with an auto-auth execution digest.

All five new mutation replacements would break their named assertions; I found no surviving `to`. The full mutation/spawn suite could not execute in this read-only sandbox because Darwin temporary-directory creation returned `EPERM`; pure policy and manifest tests passed. Zero runtime dependencies remains satisfied—`env-policy.mjs` uses only `node:crypto`—but [README.md:368](/private/tmp/rv-599/README.md:368) still documents the removed behavior that `BEST_EFFORT_CLI` carries ordinary non-sensitive variables.

[exited with code 0]
