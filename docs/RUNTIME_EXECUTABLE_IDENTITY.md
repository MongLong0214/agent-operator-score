# Runtime executable identity

A credential AOS finds for the operator — in their environment, in the macOS login Keychain, or
through a runtime's own configuration — is handed to one program: the exact executable that was
verified when the agent was registered.

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
| `owner_uid`, `mode` | Who can rewrite it without moving it |
| `parent_security` | Whether any directory on the way to it is world-writable, group-writable by an untrusted group, or owned by a third account |
| `platform_identity` | macOS `codesign` team and designated requirement, **when macOS will say**. Absent is recorded as absent, never as a pass |
| `adapter_id` | Which adapter's resolver this identity belongs to |
| `identity_status` | `VERIFIED` or `UNTRUSTED` |

## What is checked, and when

Immediately before the credential resolver is called — not after it. A check that runs after the
resolver has answered has already let AOS read the operator's credential store on behalf of a
program nobody identified, and refusing afterwards does not put the credential back. If the check
fails, the lookup and the child process are both abandoned.

The gate is about a credential, not about which programs may run. An agent with no resolver on its
adapter and no declared credential variable has nothing at stake and is not verified at all.

## Denied

- `/tmp/claude`, or any executable whose directory is world-writable
- a directory on the way to it that is group-writable by a group other than root's, or owned by a
  third account
- the registered binary replaced byte for byte at the same path
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

## What this does not do

- It binds the executable, not its arguments. An interpreter registered as the command with a script
  as an argument is verified as the interpreter; `aos agent doctor` reports fixture-backed agents
  separately for the same reason.
- Signing evidence exists only where the platform provides it. A runtime installed from npm on Linux
  carries none, and `platform_identity.recorded` is `false` — an absence of evidence, which is not
  evidence of a good signature.
- The gap between the check and `execve` is small, not zero. That is why a writable directory
  anywhere above the executable is refused outright rather than measured.
