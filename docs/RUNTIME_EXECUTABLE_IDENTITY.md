# Runtime executable identity

A credential AOS finds for the operator — in their environment or in the macOS login Keychain — is
handed to one program: the exact executable that was verified when the agent was registered.

The check this replaces compared basenames. An adapter declared that only `claude` may receive its
credential, the configured command ended in `/claude`, and that was the whole test. A name survives
the file behind it being rewritten, the path becoming a symlink to somewhere else, and a wrapper
appearing earlier on `PATH` — so all three received a real `CLAUDE_CODE_OAUTH_TOKEN` read out of the
operator's Keychain.

## What is recorded, and when

`aos init` and `aos agent add` record an identity for the command, and auto-discovery records one
for anything it registers. Nothing here reads a credential, so nothing here can store one.

| Field | Why |
| --- | --- |
| `resolved_realpath`, `realpath_digest` | Where the name resolves after symlinks, the way the child will resolve it |
| `file_fingerprint` | SHA-256 over the raw bytes, so a replacement in place is visible |
| `interpreter_digest`, `interpreter_chain` | What a `#!` line hands the file to. `#!/usr/bin/env node` runs whatever `node` resolves to, and that program gets the credential |
| `owner_uid`, `mode` | Who can rewrite it without moving it |
| `parent_security` | Whether any directory on the way to it — through **every** symlink hop, not only the two ends — is world-writable, group-writable by an untrusted group, owned by a third account, or carries a macOS ACL that lets somebody put a different file there |
| `platform_identity` | macOS `codesign` team and designated requirement, **when macOS will say**. Absent is recorded as absent, never as a pass |
| `adapter_id` | Which adapter's resolver this identity belongs to |
| `identity_status` | `VERIFIED` or `UNTRUSTED` |

Everything **about the file itself** is read through a single open descriptor: `open` once, `fstat`
that handle for owner and mode, hash through that handle, read the shebang through that handle.
Resolving the name a second time to stat it and a third time to read it is a race with itself — the
fingerprint of one file recorded against the permissions of another.

The rest is unavoidably about *names*, and uses pathname operations: resolving the command, walking
the symlink chain, and the parent-security walk over every directory above it — plus `codesign` and
`ls -lde`, which take no descriptor. Those are followed by a check that the name still reaches the
same inode (device, inode, size, modification time), so a swap during that work produces no identity
at all rather than a mixed one. It is a narrower claim than "one descriptor for everything", and it
is the one that is true.

## What is checked, and when

Immediately before the credential resolver is called — not after it. A check that runs after the
resolver has answered has already let AOS read the operator's credential store on behalf of a
program nobody identified, and refusing afterwards does not put the credential back. If the check
fails, the lookup and the child process are both abandoned.

The child is then spawned by the verified *path*. Spawning the name would put the PATH search and
the symlink chain back into the kernel's hands at a later moment; `execve` still resolves the
absolute pathname it is given, which is why atomic replacement of that pathname stays open below.

`argv0` is set to the command the operator configured, and it does what that is worth for a **native
executable**: the child reads the configured command in `argv[0]` and the verified file in its own
`execPath`. For a `#!` **script** the kernel discards it — it rebuilds the argument vector as
`[interpreter, script]` when it dispatches — so the script sees the *resolved* path in `$0`, not the
configured one. A script that dispatches on its invocation name, or locates resources relative to
`$0`, will see the realpath where it previously saw the symlink it was called through. Both are
pinned by tests, and neither is what the first version of this paragraph promised.

The gate is about a credential, not about which programs may run. An agent with no resolver on its
adapter and no declared credential variable has nothing at stake and is not verified at all.

## Denied

- `/tmp/claude`, or any executable whose directory is world-writable
- a directory on the way to it that is group-writable by a group other than root's, owned by a third
  account, or carrying a macOS ACL entry that allows another principal to add, delete or replace
  entries in it
- a symlink hop whose own holding directory is writable, even when the first link and the final
  target are both beyond reproach
- the registered binary replaced byte for byte at the same path
- a `#!` interpreter that has changed, or that cannot be resolved, or that is itself reached through
  a directory somebody else can write — including one hidden behind `env` options (`env -u FOO node`
  runs `node`, and `FOO` is a variable being unset), and including `env` arguments this cannot parse
- the path turned into a symlink pointing somewhere else
- owner or mode changed since registration
- the name now resolving to a wrapper earlier on `PATH`
- an identity recorded for one adapter with a different adapter's resolver asking for a credential
- an agent registered before identities were recorded: `MIGRATION_REQUIRED`, never promoted
- a token already in the operator's environment, when the binary is any of the above

## Allowed

- a runtime unchanged since it was registered
- an explicitly approved wrapper carrying a variable the operator named with `--allow-runtime-auth`,
  whose exact identity is still recorded and still compared
- `--no-auto-auth`, which declines the credential store entirely
- a fixture or any other agent with no credential at stake

## Trusted groups

Only root's. The temptation is the operator's own login group, which on macOS is `staff` — and
`staff` holds every local account on the machine, so trusting it would let any other account swap
the binary between the check and the spawn. A Homebrew prefix under `/usr/local` is group-writable
by `admin` for the same reason and gets the same answer: not trusted for an automatic credential.
An operator who has looked at their own install and disagrees sets the variable themselves and
re-adds the agent with `--allow-runtime-auth`.

An ACL is read the same way. Only `allow` entries count — a `deny` entry takes permission away, and
`group:everyone deny delete` sits on half the directories in a home folder — but every allow entry
that could put a different file there is a finding, including one naming the operator's own account.
This module does not get to decide which ACL somebody added on purpose is the harmless kind.

A listing that does not come back, or that never mentions a path it was asked about, is
`acl_unreadable` and refuses. Silence is not absence: the alternative is a check that passes hardest
exactly when it has stopped working. Symlinks are not asked about — `ls` prints a link as
`name -> target`, and macOS does not consult a link's own ACL anyway; what decides who can repoint a
link is the directory holding it, which is on the list.

## What credential material a run keeps

The identity record has no field for a value. Beyond that, the child *is* given the credential and
may print it, so what a run retains from the child is filtered twice: by the shape-matching redactor
every output in this product passes through, and by removing the exact values this run put in the
child's environment. That second pass is what covers a token whose shape the redactor has never
seen. It applies to both output excerpts and to the raw `AOS_EVENT` objects kept in
`semantic_events`, which reach `result.json` without passing through the event store's projection.

What it does not cover: files the agent writes into its own workspace. An agent that has been handed
a credential can write it to disk, and no filter on AOS's side of the pipe changes that.

## What this does not do

- It binds the executable and its `#!` chain, not its arguments. An operator who registers
  `/usr/bin/env` or a shell as the command, with the real program in `args`, has chosen the program
  by argument — undecidable in general (`sh -c "…"` is arbitrary), and it is the operator's own
  configuration rather than something an attacker changes underneath them. `aos agent doctor`
  reports fixture-backed agents separately for the same reason.
- Signing evidence exists only where the platform provides it. A runtime installed from npm on Linux
  carries none, and `platform_identity.recorded` is `false` — an absence of evidence, which is not
  evidence of a good signature.
- The gap between the check and `execve` is small, not zero, and it is not one instruction: the
  keychain lookup between them may wait up to four seconds, and the `security` subprocess appearing
  is itself a signal to anyone watching that verification has finished. Spawning the verified path
  removes the second name resolution; atomic replacement of that path is not closed by anything
  short of executing a held descriptor, and Node exposes no `fexecve`. That is why a writable
  directory anywhere above the executable — through every symlink hop, by mode or by ACL — is
  refused outright rather than measured.
- A same-UID attacker is out of scope and always was. Anything running as the operator can rewrite
  the agent config, so no check this file makes constrains it.
- Which rights count in an ACL and what an unreadable listing means are pure functions of captured
  text and are mutation-tested everywhere. The walk that calls `ls` is macOS-only and is deferred by
  the mutation runner on other platforms rather than reported as unbroken.
