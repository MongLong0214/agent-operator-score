
The code sets `argv0` at [core.mjs:395](/private/tmp/rv-596b/lib/core.mjs:395), and the documentation promises the configured command at [RUNTIME_EXECUTABLE_IDENTITY.md:41](/private/tmp/rv-596b/docs/RUNTIME_EXECUTABLE_IDENTITY.md:41). That works for a native executable, but the kernel reconstructs arguments when dispatching a script.

Using the repository’s executable `#!/usr/bin/env node` script with `argv0: "configured-claude"` produced:

```json
{"argv0":"node","argv1":"/private/tmp/rv-596b/bin/aos.mjs"}
```

The test actually pins this contrary behavior: its reporter prints `$0`, and [runtime-identity.test.mjs:795](/private/tmp/rv-596b/tests/product/runtime-identity.test.mjs:795) expects the resolved realpath, not the configured command. This may break scripts that dispatch or locate resources from their invocation path. Either implement interpreter-aware spawning or narrow the claim and assess the compatibility change explicitly.

## The six pushbacks

1. Arguments selecting a program: sound for operator-supplied `agent.args`; arbitrary shell argument semantics are not a tractable security boundary. It does not excuse the `env -S -u` bug, because the patch affirmatively claims to describe the shebang dispatch and parses it incorrectly.

2. Same-UID namespaces: sound. A same-UID process can rewrite `agents.json`, so excluding it is a coherent boundary.

3. Workspace artifacts: sound. Once an authorized runtime receives a credential, AOS cannot prevent that runtime from writing it as the operator. AOS-controlled results and events still must be scrubbed correctly.

4. Runtime-config credential source: sound. I found only environment and macOS Keychain resolution; `config_env` merely carries a directory.

5. Atomic replacement and timing oracle: sound as an explicitly documented residual risk. The wording that spawning the realpath “removes the second name resolution” is still inaccurate—`execve` resolves that absolute pathname again; it only removes PATH search and the original symlink chain.

6. Retargeted resolver-ownership and legacy guards: sound. Resolver ownership is now honestly a taxonomy guard because `adapter_id` drift already refuses the credential. The legacy mutation now genuinely promotes the current file and therefore exercises the intended failure.

## Closures and guards

The single-descriptor implementation at [runtime-identity.mjs:426](/private/tmp/rv-596b/lib/runtime-identity.mjs:426) correctly binds `fstat`, the fingerprint, and shebang reads to one opened inode. The intermediate-symlink walk covers the supplied `/safe -> /bridge -> /trusted` example. Spawning the recorded realpath closes PATH re-search absent atomic replacement. Stored invocation provenance is now retained at [cli.mjs:1068](/private/tmp/rv-596b/lib/cli.mjs:1068).

The two missing mutation guards are not acceptable alongside the commit’s “load-bearing” claim:

- ACL: add platform metadata/filtering to the mutation runner and run the ACL mutant in a small macOS mutation lane. Also extract the `ls -lde` parser so rights and failure behavior can be mutated on Ubuntu using captured output.
- Descriptor binding: add a deterministic test seam after `open` and before/after descriptor reads. The test can atomically replace the pathname after the descriptor is held, restore it before the final pathname check, and distinguish descriptor hashing from reopening by name without a probabilistic race.

I found no literal survivor among the fifteen new substitutions by source inspection, but three give misleading evidence:

- The ordering mutant at [manifest.mjs:82](/private/tmp/rv-596b/tests/mutation/manifest.mjs:82) suppresses the throw; because failed verdicts have `auto:false`, the resolver still is not called. The named test dies on `assert.throws`, not because resolver-before-refusal occurred.
- The operator-environment mutant at [manifest.mjs:91](/private/tmp/rv-596b/tests/mutation/manifest.mjs:91) starts the child but sets `resolvedAuth:null`, so isolation removes the token. It kills only the “child never starts” half of the name.
- The spawn mutant at [manifest.mjs:100](/private/tmp/rv-596b/tests/mutation/manifest.mjs:100) is killed by `$0` changing between a symlink and its target even without a race. It does not guard check-to-spawn binding.

One additional overnamed test is [runtime-identity.test.mjs:724](/private/tmp/rv-596b/tests/product/runtime-identity.test.mjs:724): “says to migrate” asserts only `MIGRATION_REQUIRED` and the words “explicit approval”; the actual detail at [runtime-auth.mjs:146](/private/tmp/rv-596b/lib/runtime-auth.mjs:146) gives no migration instruction.

Finally, the documentation’s “every field is read through a single descriptor” at [RUNTIME_EXECUTABLE_IDENTITY.md:28](/private/tmp/rv-596b/docs/RUNTIME_EXECUTABLE_IDENTITY.md:28) is false: realpath, symlink-chain and parent-security fields use pathname operations, in addition to the acknowledged `codesign` and `ls`.

Syntax, imports, `git diff --check`, and the four mutation-manifest structural tests passed. The full Darwin product test could not execute in this read-only review sandbox because every `mkdtemp` failed with `EPERM`; the Darwin `env`, argv dispatch, and scrubber failures above were exercised without filesystem mutation.

[exited with code 0]
