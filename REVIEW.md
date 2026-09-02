/safe/claude:
  #!/usr/bin/env node

PATH=/attacker/bin:/usr/bin
/attacker/bin/node:
  token-stealing executable
```

The `claude` script remains byte-identical and passes every check; the credential reaches the unverified `node`. An absolute shebang has the same problem if that interpreter is replaced.

A multi-call variant is `/safe/claude -> /usr/bin/env` with arguments selecting an unverified interpreter or script. The initial `/usr/bin/env` identity matches, but the credential is inherited across its next exec.

The PR’s reason for not spawning a resolved path—changing `argv[0]`—is also unsupported: Node’s `spawn` has an `argv0` option specifically for preserving it. [Node child-process documentation](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options) Spawning a pathname would not by itself close atomic replacement, however; a file-descriptor-bound execution mechanism is needed for that.

6. P1 — the TOCTOU is practical, and the parent walk is incomplete.

The relevant observation is not adjacent to spawn. Directory checks occur at [runtime-identity.mjs:225](/private/tmp/rv-596/lib/runtime-identity.mjs:225), hashing at [runtime-identity.mjs:242](/private/tmp/rv-596/lib/runtime-identity.mjs:242), then two synchronous `codesign` calls may each wait four seconds. Keychain resolution follows before [core.mjs:360](/private/tmp/rv-596/lib/core.mjs:360), with each `/usr/bin/security` call allowed four seconds. Seeing the `security` subprocess is an oracle that verification has finished and spawn has not happened. An attacker can then use `renameatx_np(..., RENAME_SWAP)`.

The “both chains” walk at [runtime-identity.mjs:223](/private/tmp/rv-596/lib/runtime-identity.mjs:223) misses intermediate symlink holders. Concrete layout:

```text
/safe/claude       -> /bridge/hop
/bridge/hop        -> /trusted/real-claude
/bridge            mode 0777
```

It walks `/safe` and the final `/trusted` chain, but never `/bridge`. Another account can repoint `/bridge/hop` after the check and before spawn. macOS ACLs are also ignored: a directory can remain mode `0755` while an ACL grants another account `delete_child`/`add_file`.

The “small, not zero” admission is therefore misleading. It can be seconds long, exposes a clear timing oracle, accepts same-UID writable namespaces, misses ACL writability, and misses intermediate symlink directories.

7. P1 — the broad “credential value is never stored” claim is false.

The direct resolver dataflow is otherwise clean: `resolvedAuth.value` is used only for environment injection at [core.mjs:341](/private/tmp/rv-596/lib/core.mjs:341); `runtimeIdentityRecord` stores only name/source at [runtime-auth.mjs:231](/private/tmp/rv-596/lib/runtime-auth.mjs:231).

But raw child `AOS_EVENT` objects are retained in `semantic_events` at [core.mjs:420](/private/tmp/rv-596/lib/core.mjs:420). `observe` embeds the complete process result at [cli.mjs:1529](/private/tmp/rv-596/lib/cli.mjs:1529), and [store.mjs:328](/private/tmp/rv-596/lib/store.mjs:328) writes it without redaction.

Concrete child output:

```text
AOS_EVENT	{"event_type":"completion.claimed","payload":{"claim":"<credential value>"}}
```

That value lands in `result.json`. The projected event path may filter it, but the raw `semantic_events` copy bypasses that filter. Agent-written workspace artifacts are another storage surface. The narrow test proves only that the identity/provenance constructor omits `resolved.value`.

8. P2 — tests and mutation claims overstate what is established.

At [runtime-identity.test.mjs:400](/private/tmp/rv-596/tests/product/runtime-identity.test.mjs:400), “the child never starts” is checked with `resolveExecutable(marker)`. The child creates the marker using `touch`, so it is non-executable; `resolveExecutable()` returns `null` whether the marker exists or not. The surrounding `assert.rejects` saves the current mutation, but that final assertion proves nothing.

The “binary replaced between registration and spawn” test replaces it before authorization at [runtime-identity.test.mjs:116](/private/tmp/rv-596/tests/product/runtime-identity.test.mjs:116); it does not exercise the check-to-spawn race. The PATH test uses only nonempty absolute entries, and the symlink test uses one hop. There are no tests for runtime config, explicit legacy credentials, unsigned/custom-wrapper approval, interpreter dispatch, ACLs, intermediate symlinks, or effective execute permission.

I found no literal survivor among the eight new mutation `to` replacements: each breaks its named test by inspection. Two are weaker than claimed:

- Removing “resolver ownership” is still blocked by `identityDrift` on `adapter_id`; the mutation dies only because the test expects a particular error code.
- Removing the legacy branch is still refused as `identity_record` drift; it dies on migration/error taxonomy, not because credential refusal disappeared.

Finally, `runProcess` creates a runtime-identity provenance block, but normal assessment persistence discards it when mapping invocations at [cli.mjs:1068](/private/tmp/rv-596/lib/cli.mjs:1068). The stored assessment therefore does not contain the issue’s promised identity evidence.

I could not turn a hardlink alone into different code: simultaneous identical `dev:ino` values are the same inode. Atomic rename to a different inode misses the fingerprint cache and different bytes are detected if present during the check. On ordinary APFS, forging `ctime` is not practical through `utimes`; inode reuse plus an exact size/mtime/ctime collision is theoretical, and more plausible only on coarse or unusual filesystems. A writable ancestor above an active mount point did not yield a separate unprivileged break; the covered vnode does not participate while mounted. The cache still has an independent `stat(path)`/`open(path)` pathname race.

The zero-runtime-dependency constraint is preserved: the change uses only `node:*` modules and `package.json` has no dependency block. It does not change the merge verdict.

[exited with code 0]
