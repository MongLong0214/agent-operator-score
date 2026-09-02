# STRICT workspace confinement: what this machine can actually enforce

The sections up to "Phase B" are the Phase 0 feasibility evidence for issue #556, kept as they were
measured: at that point no production code had been changed, no isolation backend had been
implemented, and `lib/isolation.mjs` and the spawn path in `lib/core.mjs` had not been touched.
"Phase B" below is the integration that followed once #554, #555 and #588 landed: the backend in
`lib/confinement.mjs`, the boundary canary, the issuance gate, and the one lane on which official
issuance was proven with the real runtime.

The question is narrow and answerable: on this machine, and on Linux, can AOS enforce a workspace
boundary on a child agent process, and does a real agent CLI's authentication survive inside it?

Every observed row below was produced by running a probe and keeping what came back; a row that
says `not_observed` names the reason no run exists instead. The raw output of each run is committed
under `fixtures/confinement/observations/`, one file per run, holding the command with the
machine-specific paths replaced by the placeholders the record lists, the exit status, excerpts of
the captured output and the parsed result; the `Raw` column names the file a row was read out of. The probes themselves are committed under
`fixtures/confinement/probes/` and printed at the end of this document, so a reader can run them
and disagree. The matrix is rendered from the record, and `tests/product/confinement-probe.test.mjs`
holds the three together: every observed row's outcome is re-read from its raw artefact, every
artefact whose captured stdout is JSON must parse to the result it recorded, and every rendered
cell -- outcome, enforcement, errno, command, raw file, note -- must be the record's.

Where nothing was run, the row says `not_observed`, carries the reason, and names no command and
no evidence. It never says `denied`, because a boundary that was not tested is not a boundary, and
a support table that cannot tell those apart is how an untested lane ends up marked OFFICIAL.

The machine-readable form is `fixtures/confinement/probe.json`, digest
`sha256:c3a4ff0eb363cd168f941be9374b98591ab2a1acf5ac710040f9a348012e58c5`.

## The finding

**A boundary that holds and a runtime that runs are available here, in different backends.**

- **The Linux container meets every boundary property that was measured, and cannot run the
  runtime.** Of its 12 properties with a strict requirement, 11 met it
  and 1 was not observed -- the orphan question, which did not arise because
  the teardown reaped the detached descendant with its pid namespace. The operator's installed
  `codex` carries only `@openai/codex-darwin-arm64` and refused to start there, which was
  measured rather than assumed.
- **The Seatbelt provider lane runs the runtime, authenticates it, and leaves the process axis
  open.** `sandbox-exec` is documented DEPRECATED in its own man page and still enforces on macOS
  26.3: the workspace parent, absolute paths into the operator's home, `~/.ssh` private-key bytes,
  AOS_HOME and a symlink planted inside the workspace were all EPERM, a spawned child inherited the
  same refusals, and `codex login status` reported `Logged in using ChatGPT` in the same profile.
  11 of its 12 strict-requirement properties are met; the one that is
  not is `survive_cleanup_as_detached_descendant`. What this backend cannot do is stop a child from
  leaving the process group AOS signals.
- **The process axis could not be closed by any profile tried.** Denying `setsid` by name and by
  syscall number both compiled and neither stopped the child from leading its own group; the profile
  compiler rejects `process-session` and `setsid` as unbound. Against AOS's own enumeration, a
  detached descendant was **not reported by `processGroupMembers`** and was **still alive after
  `kill(-pgid, SIGKILL)`** while the in-group child was gone. That is a defect in the shipped
  cleanup observation, independent of this issue. #553 has already acted on it: unable to close the
  escape, it made `cleanup_established` false by construction, with
  `DESCENDANT_SCAN_ESTABLISHES_CLEANUP` as the constant Phase B flips once an enumeration exists
  that does not depend on the process group.
- **A leak under Seatbelt is a process that outlives the run without gaining reach.** The orphan,
  reparented to pid 1, wrote `ORPHAN_STILL_CONFINED`; the unconfined control wrote
  `ORPHAN_READ_OK`. It still blocks `cleanup_verified`, and it should.

Under the issue's own issuance gate, **no backend here is SUPPORTED**, and none is a
release-acceptable SUPPORTED_WITH_CONSTRAINTS. That is a measurement, not a failure to measure.

## Authentication: what was actually measured

An earlier draft of this document claimed that what AOS ships today costs authentication, and that
confinement and a replaced HOME are therefore alternative designs. **That was wrong, and the error
was methodological**: the failing run used `env -i`, which removes the runtime's config directory
along with everything else, so it could not tell HOME replacement apart from config loss. The cells
below separate them. #555 measured the same thing independently and has since made `config_env`
part of the adapter env allow list.

| Cell | Runtime | Logged in | exit | Raw | Note |
| --- | --- | --- | --- | --- | --- |
| `none` | codex | allowed | 0 | `none.codex-auth.json` | The control every other cell is read against. |
| `none` | claude-code | allowed | 0 | `none.claude-auth.json` | Reduced to loggedIn and authMethod before recording; the command also prints the operator's account. |
| `best-effort-cli` | codex | denied | 1 | `best-effort-cli.codex-auth.json` | CODEX_HOME is in the adapter's allow list (lib/profile.mjs config_env, carried by the discovered agent at lib/cli.mjs) but was not set in the operator's environment on this machine, so nothing was there to carry and ~/.codex moved with HOME. |
| `best-effort-cli` | claude-code | denied | 1 | `best-effort-cli.claude-auth.json` | The login keychain is resolved from HOME. This cell does not exercise AOS's own resolver, which reads the keychain in the parent and injects CLAUDE_CODE_OAUTH_TOKEN. |
| `best-effort-cli-config-env` | codex | allowed | 0 | `best-effort-cli-config-env.codex-auth.json` | This is the cell that isolates the cause. HOME replacement alone loses the credential; HOME replacement with the adapter's config directory carried keeps it. #555 measured the same thing independently and has since made config_env part of the allow list. |
| `best-effort-cli-config-env` | claude-code | denied | 1 | `best-effort-cli-config-env.claude-auth.json` | A config directory does not carry this runtime's credential on macOS -- the adapter says so itself -- so carrying it changes nothing. What would restore this cell is AOS's keychain resolver, which was not exercised here. |
| `macos-seatbelt-deny-default` | codex | inconclusive | 71 | `macos-seatbelt-deny-default.codex-auth.json` | This cell measures exec, not authentication: the profile does not name the runtime's install tree, so sandbox-exec refused to exec the binary at all. It is recorded because an earlier draft read this exit as an authentication failure. |
| `macos-seatbelt-deny-default` | claude-code | inconclusive | 71 | `macos-seatbelt-deny-default.claude-auth.json` | Same exec refusal as the codex cell above. |
| `macos-seatbelt-provider-lane` | codex | allowed | 0 | `macos-seatbelt-provider-lane.codex-auth.json` | The result that matters: real confinement and a real login at the same time, with the operator's own HOME and the filesystem refused by the kernel. |
| `macos-seatbelt-provider-lane` | claude-code | denied | 1 | `macos-seatbelt-provider-lane.claude-auth.json` | Expected, and not a verdict on the runtime: nothing in this profile or this cell supplies the credential. AOS's resolver would inject it from the parent, and that path was not exercised. |
| `macos-seatbelt-keychain-lane` | codex | allowed | 0 | `macos-seatbelt-keychain-lane.codex-auth.json` | Unchanged from the provider lane. |
| `macos-seatbelt-keychain-lane` | claude-code | allowed | 0 | `macos-seatbelt-keychain-lane.claude-auth.json` | The keychain grant is what this runtime's authentication needed inside the boundary. It is measured to show what the grant buys, not to propose it: the same result should be reachable from the parent's resolver without opening the keychain to the child at all. |
| `linux-container-vm` | codex | inconclusive | 1 | `linux-container-vm.codex-auth.json` | This cell measures execution, not authentication. The install carries only the darwin-arm64 binary. |

What the cells support:

- **HOME replacement without the adapter's config directory loses the Codex credential; carrying
  `CODEX_HOME` restores it.** The adapter already declares `config_env: "CODEX_HOME"`
  (`lib/profile.mjs`) and the discovered agent already allows the name through (`lib/cli.mjs`). On
  this machine `CODEX_HOME` was simply not set in the operator's environment, so there was nothing
  for the allow list to carry. That HOME was the temporary directory in the restoring run comes from
  the environment having been built by `buildAgentEnv`, whose replacement of HOME
  `tests/product/isolation.test.mjs` covers; the cell's artefact records the login banner and the
  command, not the value of HOME, so it is not this cell that proves the replacement.
- **Confinement and authentication are not in conflict.** The provider lane confines the filesystem
  with the kernel, keeps the operator's real HOME, and logs in.
- **Nothing here shows that Claude Code cannot authenticate under confinement.** Its cells are not
  logged in wherever nothing supplies its credential, and logged in as soon as the keychain is
  granted. AOS does not need that grant: it resolves this credential in the *parent* and injects
  `CLAUDE_CODE_OAUTH_TOKEN` into the child (`lib/runtime-auth.mjs`), which a confined child reads
  before it would consult a keychain. **That path was not exercised here**, and no row claims it
  works; it is the obvious first thing for Phase B to measure.
- **Two cells measure execution, not authentication.** Under the deny-default profile both CLIs
  exit 71 because `sandbox-exec` refused to exec a binary the profile does not name. In the
  container, `codex` exits 1 because the install has no Linux binary. Neither is evidence about
  credentials, and both are recorded `inconclusive` rather than `denied`.

## The process axis

Whether a child can leave the process group AOS signals, measured four ways. `kill(-pid, 0)`
succeeds only for a process-group leader.

| Profile | Child leads own group | Probe errno | `ps` usable in child | Raw |
| --- | --- | --- | --- | --- |
| `none` | true | -- | true | `setsid.none.json` |
| `seatbelt-deny-default` | not_answerable | EPERM | false | `setsid.seatbelt-deny-default.json` |
| `deny-syscall-by-name` | true | -- | false | `setsid.deny-syscall-by-name.json` |
| `deny-syscall-by-number` | true | -- | false | `setsid.deny-syscall-by-number.json` |

The deny-default row is `not_answerable`, not `false`: once the child has left the group,
signalling it is no longer signalling one's own group and the profile refuses, so the reading is
EPERM from the probe rather than a fact about process groups. Asking from outside the boundary,
which is where AOS actually stands, answers it -- see the `survive_cleanup_as_detached_descendant`
rows in the matrix, every one of which observed a descendant with its own pgid, reparented to pid 1,
and alive after the group-kill attempt. In the Seatbelt and unconfined runs that attempt returned
ESRCH: by then the agent's own group had emptied, and the descendant was not in it to be signalled.
The AOS enumeration run below sent the kill to a group that still had members and the descendant
survived it all the same.

`/bin/ps` cannot be exec'd inside any profile here, including `(allow default)`, because it is
setgid. Anything that needs to enumerate processes from inside a boundary has to do it another way.

AOS's own cleanup enumeration, run against `processGroupMembers` in `lib/core.mjs`:

```text
node fixtures/confinement/probes/pg-check.mjs   # imports processGroupMembers from lib/core.mjs

in-group child reported by processGroupMembers        true
detached descendant reported by processGroupMembers   false
in-group child alive after kill(-pgid, SIGKILL)       false
detached descendant alive after kill(-pgid, SIGKILL)  true
```

Raw: `process-group.aos-enumeration.json`.

## Host

| Field | Value |
| --- | --- |
| platform / arch | darwin / arm64 |
| OS | macOS 26.3 (25D125) |
| kernel | Darwin 25.3.0 xnu-12377.81.4~5 RELEASE_ARM64_T6041 |
| node | v22.23.2 |
| Linux kernel reached | 7.0.11-orbstack-00360-gc9bc4d96ac70 via Docker server 29.4.0 (linux/arm64) |

Raw: `availability.darwin.host.json`.

## Properties

Each is phrased as a capability of the assessed agent, so `allowed` always means the agent could do
the thing. `STRICT requires` is what a strict boundary needs that answer to be; `either` marks the
ones that are a policy decision rather than a boundary failure.

| Property | Question | STRICT requires |
| --- | --- | --- |
| `read_inside_workspace` | Can the agent read a file inside the scenario workspace? | allowed |
| `write_inside_workspace` | Can the agent write a file inside the scenario workspace? | allowed |
| `read_workspace_parent` | Can the agent read a file in the workspace's parent directory? | denied |
| `write_outside_workspace` | Can the agent create a file outside the workspace? | denied |
| `delete_outside_workspace` | Can the agent delete a file outside the workspace that already existed? | denied |
| `read_operator_home_absolute` | Can the agent list the operator's real home by absolute path, ignoring $HOME? | denied |
| `read_operator_ssh_private_key_absolute` | Can the agent read bytes of a private key under the operator's ~/.ssh by absolute path? | denied |
| `read_operator_agent_config_absolute` | Can the agent read the runtime's own credential file under the operator's home? | either |
| `read_aos_home_absolute` | Can the agent read AOS_HOME -- run records, results, holdout ledger -- by absolute path? | denied |
| `escape_via_symlink` | Can the agent read outside the workspace through a symlink planted inside it? | denied |
| `spawn_child_process` | Can the agent start a child process at all? | either |
| `act_outside_boundary_from_descendant` | Can a process the agent spawned read outside the boundary? | denied |
| `survive_cleanup_as_detached_descendant` | Can the agent leave a detached process running after AOS tears the run down? | denied |
| `act_outside_boundary_after_orphaning` | Can such a survivor still read outside the boundary once it has been orphaned? | denied |
| `open_outbound_network_socket` | Can the agent open an outbound TCP connection? | either |
| `read_operator_keychain_secret` | Can the agent retrieve the value of an item in the operator's login keychain? | either |

Commands are written with placeholders rather than the probing machine's paths.

| Placeholder | Stands for |
| --- | --- |
| `@WORKSPACE@` | the scenario workspace the probe treats as the only writable directory |
| `@BASE@` | the workspace's parent, holding the read, write and delete canaries outside the boundary |
| `@OPERATOR_HOME@` | the operator's real home directory |
| `@NODE_TREE@` | the install prefix of the node binary that runs the probes |
| `@RUNTIME_CLI_TREE@` | the install prefix of the agent CLIs |
| `@RUNTIME_FILES@` | fixtures/confinement/probes, mounted or allowed read-only |
| `@AGENT_TEMP_HOME@` | the temporary HOME a BEST_EFFORT_CLI run creates |
| `@HOSTNAME@` | the probing machine's network name, removed from recorded output |

## Phase B: the boundary in the spawn path, and what may be called official

Everything above this heading is Phase 0 evidence and is left as it was measured. This section is
the integration that evidence was collected for: `lib/confinement.mjs` now sits between
`buildAgentEnv` (#555) and the `spawn` in `lib/core.mjs`, and every result carries a confinement
record that the issuance gate reads. The support matrix at the end of this section is rendered
from `fixtures/confinement/support-matrix.json`, whose rows point at observations under
`fixtures/confinement/observations/strict-lane.*` that were produced by running
`fixtures/confinement/probes/strict-lane.mjs` on this machine. `tests/product/confinement.test.mjs`
holds the fixture, the observations and this document together the way the Phase 0 test holds
the probe record: the table printed here must be the one the fixture renders to, the fixture's
digest must describe its own content, and every official row must name a canary observation that
says `PASS` and a runtime observation that exited 0.

### The adapter

`prepareConfinement` is the one seam. It takes the level `buildAgentEnv` already decided, the
adapter, the workspace, `AOS_HOME`, the agent's private HOME and the run's scratch directory, and
returns a handle whose `spawnSpec` wraps the command, whose `track` starts the descendant scan,
whose `record` writes the confinement record and whose `cleanup` tears the profile down. Under
`BEST_EFFORT_CLI` and `NONE` the handle is a passthrough: the command is spawned as before, no
boundary is claimed, and the record says `filesystem_enforced: false`, `process_enforced: false`,
`boundary_canary.result: NOT_RUN`. Under `STRICT` on darwin the handle renders a Seatbelt profile
from the isolation policy and spawns through `/usr/bin/sandbox-exec -f <profile>`; on linux it
builds a `bwrap` argument vector, and where `bwrap` is not on the machine `prepareConfinement`
refuses with `AOS_ISOLATION_BACKEND_ABSENT` rather than running the agent unconfined under a
STRICT label. The backend's presence is probed on every run, not remembered.

The profile is rendered *from* the policy. Every grant the boundary carries is declared in
`policy.filesystem` -- the writable trees, the readable trees, the platform's own trees and files,
the devices, the executables and the denies -- and `renderSeatbeltProfile` emits those arrays and
nothing of its own. It used to keep a second list, which made the policy digest decorative: a
review set the declared readable set to empty and the rendered rules did not move. One mapping
means the digest governs the bytes, which is what `isolation_policy_digest` on the profile is for.

The Linux vector is rendered from the same declaration: `bubblewrapArgs` mounts the policy's own
trees and nothing of its own. It used to bind all of `/etc` and all of `/sbin` against a policy
declaring `/etc/ssl` and `/etc/resolv.conf`, which is the Seatbelt defect on the other side -- the
digest describing one boundary while the argument vector applied another, with `/etc/hostname` and
`/etc/machine-id` inside it.

The system grants are the narrowest set the runtime was measured to need on this machine:
`/usr/lib`, `/System/Library` and `/private/var/db/dyld` as trees, plus the individual symlinks a
path resolves through (`/tmp`, `/var`, `/etc`, `/Users`, `/usr`, `/bin`). `/Library`, `/usr/share`,
`/private/etc`, `/private/var/select` and `/private/var/db/timezone` were granted in Phase 0 and
are not needed: `codex login status` and `codex exec` both run without them, measured by removing
each in turn. Two canary cells hold the line -- `system_library_read` proves the granted tree is
readable, `host_etc_read` proves `/private/etc/hosts` is not -- so a policy that widens again fails
the canary rather than passing quietly. The run's own trees are granted *after* the denies, because
a later rule wins and a node or runtime installed under the operator's home has to stay readable
while the rest of that home does not.

The filesystem policy is the Phase 0 profile with the holes closed:

- the workspace is the only read-write subpath;
- the operator's home and the directory holding every other run's workspace are denied by name
  too, and the run's own workspace and trees are granted back after them;
- `AOS_HOME` is denied by name, and the rule comes *before* the workspace allow -- the later rule
  wins under Seatbelt, so a deny placed after the allow would be the one that lost. Run workspaces
  live outside the store now (see below), so the store is denied whole and nothing inside it is
  granted back; a workspace that *contains* the store is refused outright by `prepareConfinement`
  with `AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME`, and one *inside* it is refused by `runProcess`
  with `AOS_ISOLATION_WORKSPACE_INSIDE_STORE`, both before anything is rendered;
- the agent's private HOME is read-write and is where TMPDIR points, so a runtime that must write
  somewhere writes there and the directory goes with the run;
- the run's scratch directory (the prompt file), the node tree and the runtime CLI tree are
  read-only;
- the operator's home directory is never named. The Phase 0 profile allowed `~/.codex`
  read-only as a hole so that Codex could authenticate; under Phase B the operator's
  configuration directory does not appear in the profile at all. `stageRuntimeConfig` copies the
  adapter's declared files -- for `codex-cli.v1`, `auth.json` and `config.toml` -- into
  `<agent HOME>/.codex` (mode 0700, files 0600) before the spawn and points `CODEX_HOME` at the
  copy. A read-only hole was tried first and Codex 0.148.0 exits 1 under it (`failed to
  initialize in-process app-server client: Operation not permitted`: it writes its state database,
  `installation_id` and `tmp/arg0` into `CODEX_HOME` on start). A read-write hole would have let
  the agent rewrite the operator's `config.toml`, which is where `notify` hooks and MCP servers
  are declared, and that is persistence outside the boundary. The copy is neither: what Codex
  writes -- session logs, its state database, a refreshed token -- lands in the copy and is
  removed with the agent's HOME. The record lists the hole as
  `{ env: "CODEX_HOME", access: "staged-copy", staged: ["auth.json", "config.toml"] }`.

The policy is a value, and `isolationPolicyDigestOf(policy)` is its digest over the canonical
bytes; #561 folds it into the profile digest, and the canary observation and the confinement
record both carry it so a result can be tied to the exact boundary it ran under. The Phase 0
profiles printed below are unchanged and still digest to the values the probe record holds; the
Phase B profile is generated per run and is not printed here because its paths are the run's.

### The process axis

Phase 0 item 1 is bought. `descendantTracker` polls `ps -axo pid=,ppid=,pgid=,lstart=` (on
linux, `/proc`) every 200 ms while the agent runs, and a process is adopted when its parent chain
reaches the agent or its group is the agent's; identity is pid plus start time so a recycled pid
is not mistaken for a survivor. A descendant that `setsid`s out of the group is still adopted
through its parent, and if it double-forks it is adopted through the reparented `ppid` chain
provided it is alive at a poll. After the agent exits, `runProcess` kills the group as before and
then terminates everything the tracker still holds, and the record's `descendants` block carries
`leaked` (alive after the agent exited), `survivors` (alive after teardown), `tracked` and
`polls`. A process that double-forks *between* two polls and re-sessions before the next is
not seen by the poll, so the poll is not what the record rests on. `processAxisEnforced` writes
`process_enforced: true` only when four measured things hold together: the canary's own detached
descendant tried to write outside the boundary and the kernel refused it (`escapee_confined`), the
scan polled more than once while the agent was alive, the process group was swept at teardown --
which catches a descendant that forks away without taking its own session -- and `survivorSweep`
ran and found nothing.

**What holds a descendant, and what does not.** Three scanners cannot prove a process is absent. A
descendant that double-forks, calls `setsid`, clears its environment, closes every inherited
descriptor and changes directory is in none of them, and each round of hardening here ended with a
further stripping that evaded the new scanner. So the lane does not claim the scans are complete.
What it claims is the property that is actually enforced: on Seatbelt the profile is inherited
across fork and exec and cannot be shed with the markers, so a descendant AOS never sees is still
refused everything outside the workspace. The canary demonstrates it on every STRICT run --
`stripped_descendant` sheds all of it, writes inside the workspace (which is how the parent knows it
ran) and is refused the file it tries to create outside (which is the claim) -- and
`processAxisEnforced` reads that proof. The scans stay and anything they find still blocks, because
a descendant AOS can see is one it must terminate; they are detection, and the inherited profile is
containment. `process_containment` on the record says which of the two a lane has:
`inherited-profile` on Seatbelt, `pid-namespace` under bubblewrap's `--unshare-pid`, where
membership cannot be shed at all and the case does not arise.

The case is measured, not assumed away, and it is narrower than "a descendant nothing saw". A review reproduced it against an injected process table --
poll 1 holding root PID 100, poll 2 additionally holding PID 200 reparented to PID 1 and regrouped
to PGID 200 -- and `processAxisEnforced` returned true while PID 200 was still in the table. That is
the known-undetectable case, and it is accepted with the bound below rather than papered over: the
alternative would be to weaken the canary until the finding disappeared, which would remove the only
evidence the lane has.

**A leak with a pid is not a residual.** The canary's own escapee is AOS's child and its pid is in
hand at spawn, so the observation records that pid, AOS kills it at teardown and checks that it went
(`stripped.dead_after_cleanup`), and a live one fails the canary and blocks issuance by name. The
same is true of anything the three scans do find. What is accepted below is only the case where AOS
never had a pid at all.

**The residual, exactly.** A survivor with no marker, no handle and no pid AOS ever held can outlive
the run, and it can write
inside *that run's own workspace* after AOS has digested the evidence. It cannot read or write
anything else: not the store, not another run's workspace, not the operator's home, not the staged
credential copy once the agent HOME is gone. It cannot see another run, and it cannot outlive the
boundary's grant of anything but the one directory. macOS has no facility that makes membership
unsheddable -- no cgroup, no jail this tool can enter, and `ps` exposes no session id to a non-root
process -- so this is stated as a limitation of the lane rather than enforced away, and it is one of
the reasons the lane is `SUPPORTED_WITH_CONSTRAINTS`.

That sweep is what closes the double-fork-plus-`setsid` case. It looks for this run's marker
(`AOS_SESSION_ID=<session>`, unique to the run) in every process environment, and for the run's own
workspace, agent HOME and scratch among every process's open files and working directories: both
handles survive a reparent and a regroup, which is exactly what the process table does not. It runs
at teardown, kills what it finds, sweeps again, and the record carries the second result -- so a
run that caught its own escapee reads clean and one that could not kill it does not. A sweep that
could not run leaves the axis unenforced rather than unmentioned, and the sweep never treats itself
or any process above it as a survivor. The canary proves the mechanism on every STRICT run: beside
the descendant it leaves for the ancestry scan, it starts a child that spawns a grandchild and
exits at once, so the grandchild is reparented to init in a session and a group of its own, and the
run is official only if the sweep found it and it was gone afterwards.

What is left is a process that clears its own environment *and* closes every handle it inherited
before the sweep runs -- and such a process is still inside the same kernel-enforced profile, which
the escapee cell measures on every run. On a backend with a pid namespace (bubblewrap's
`--unshare-pid`) the case cannot arise at all. That residual is named on
`descendants.residual`, in the lane's constraints, and in the support table -- it is why the lane
is `SUPPORTED_WITH_CONSTRAINTS` and not `SUPPORTED`. `cleanup_verified` is true only when the profile, the agent HOME and the scratch
directory were removed and `survivors` is empty; it is set in `settleConfinement`, after the
`finally` in `runProcess` has done the removal, so a cleanup failure it cannot see is not one it
can vouch for.

### The boundary canary

Before the agent is spawned under `STRICT`, `runBoundaryCanary` runs a node program under the
same profile the agent will get. The program is embedded in `lib/confinement.mjs` rather than kept
in `fixtures/`, so it is present wherever the module is and its bytes are the bytes that ran; its
digest is `BOUNDARY_CANARY_PROGRAM_DIGEST`, and it exercises
eleven cells in the Phase 0 vocabulary: read and write inside the workspace (expected `allowed`),
read, write and delete outside it, read the store root, read another run's directory, follow a
symlink out, list the operator's home (all expected `denied`), connect outbound (expected
`allowed` for a provider-required policy -- an `ECONNREFUSED` against a closed local port is a
connection the kernel let through), and spawn a detached descendant (expected `spawned`, then
observed by the scan, proved confined, and dead after cleanup). The descendant is not a `sleep`:
before it sleeps it tries to write a file outside the boundary and leaves the shell's status where
the parent can read it inside the workspace. A descendant that outlives its parent is a lifetime
problem; one that outlives it *outside* the boundary is an access problem, and this cell is the
kernel's own answer to which of the two happened. `evaluateCanary` compares every observed cell to
the expectation this module declares for it -- `CANARY_CELLS` is the list, and it is fourteen cells
now that the read policy and the orphan are measured -- and the result is `PASS` only when all of
them agree and the planted files outside the boundary are intact afterwards; anything else is
`FAIL`, with the failed cells named. The
Every cell's verdict is derived from its own `expected`/`observed` pair, and the `result` a record
reports is never read: a review handed the gate the committed official record with `outside_read`
reporting that it had read what it expected to be denied, `result: "PASS"` left in place, and got
`official: true` with no reasons. A cell that contradicts its expectation is a failed boundary, a
cell that reports nothing is `NOT_RUN`, and the summary above them is a claim about observations
rather than one of them.

The `evidence_digest` on the record is the digest of the canary's own report -- the bytes the program
wrote to stdout -- and the raw observation is kept beside the run. The digest of the *file* an
observation is committed as is a different value, and it is what the support matrix cites a row's
evidence by; the two are never the same number and the table names which is which.

The canary is what separates "the profile did not apply" from "the profile applied". Phase 0
item 4 asked for a setup-failure channel other than the exit code; this is it. A profile that
`sandbox-exec` rejects (exit 65) or a binary it cannot exec (exit 71) fails the canary before the
agent runs, `setup_verified` stays false, and nothing is issued.

### The network axis, stated rather than implied

The profile allows outbound network wholesale, because the provider transport needs it and this
layer cannot tell a request to the provider from a request the task made. The record therefore
says `network.provider_transport: allowed` and `network.task_external: NOT_OBSERVED`, the policy
name is `provider-required-unrestricted`, and the gate never reads `denied` into it. A future
`restricted` or `disabled` policy would have to be measured by a canary cell before the record
could say anything else.

### The gate

`issuanceGate(record)` returns `{ official, record_problems[], isolation_level, backend,
boundary_canary, reasons[], claim_stage_ceiling, platform_lane, network, policy_digest }` and #559
and #563 consume it.

Before any condition below is read, a `STRICT` record is authenticated: it must carry the schema
the builder stamps, a rendered-profile digest and a policy digest, a network observation with its
enforcement stated, a canary whose `program_digest` is the digest of the canary source shipped in
this package, every one of the eleven cells that program reports, the out-of-band checks made from
outside it, and a descendant block with the poll interval, more than one poll and the teardown
sweep. Anything missing is `AOS_ISOLATION_RECORD_INVALID` with the missing evidence named in
`record_problems`. This is the difference between judging a record and judging an object shaped
like one: a review handed the old gate a record with no schema, no cells, no polls and digests of
sixty-four zeroes, and got `official: true` with an empty reason list. Missing evidence closes the
gate; it never opens it.

`official` is true only when every one of these holds at once, and every one that fails is named
in `reasons`:

| Condition | Reason when it fails |
| --- | --- |
| level is `STRICT` | `AOS_ISOLATION_LEVEL_NOT_STRICT` |
| a real backend ran (`macos-seatbelt`, `linux-bubblewrap`, `linux-container`) | `AOS_ISOLATION_BACKEND_ABSENT` |
| filesystem and process axes enforced | `AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED`, `AOS_ISOLATION_PROCESS_NOT_ENFORCED` |
| the profile applied (canary ran under it) | `AOS_ISOLATION_SETUP_UNVERIFIED` |
| canary `PASS` with an evidence digest | `AOS_ISOLATION_CANARY_NOT_PASS` |
| no leaked descendant, no survivor | `AOS_ISOLATION_LEAKED_DESCENDANT` |
| profile, HOME and scratch removed | `AOS_ISOLATION_CLEANUP_UNVERIFIED` |
| policy digest present | `AOS_ISOLATION_POLICY_DIGEST_MISSING` |
| the lane's support status is releasable | `AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE` |
| the (platform, backend, adapter, level) lane has committed evidence | `AOS_ISOLATION_LANE_NOT_PROVEN` |
| the record carries the evidence the run produced | `AOS_ISOLATION_RECORD_INVALID` |
| a matrix row's cited observation matches the digest it declares | `AOS_ISOLATION_EVIDENCE_DIGEST_MISMATCH` |

A STRICT row must cite every kind of evidence by name -- canary, runtime, exec, cleanup, host --
and the requirement follows the row's *level*, never its own `official` label: keyed on the label it
composed away, because a row marked not-official was asked for no evidence while the decision the
gate derives separately still came out official and the renderer printed it. The label declares
which rows are expected to be official; it does not decide what they must show. Each cited
observation must record a run that succeeded *and* say it did the thing: a login
whose markers report no login and an execution that did not answer the prompt are refused with
`AOS_ISOLATION_EVIDENCE_EXECUTION_FAILED`, and a missing kind with
`AOS_ISOLATION_EVIDENCE_MISSING`. The identity a row claims comes from the observation of the
runtime that authenticated, not from the canary beside it, and the recorder resolves the binary
once so the identity describes the executable that produced the evidence. The network axis is
enumerated rather than typed: an unknown policy has no expectation for the network cell at all, and
`provider_transport` must be `allowed` or `denied` -- a record naming a policy nobody has measured,
or publishing a null transport, is refused rather than read as permission.

`claim_stage_ceiling` is `PROFILE_BOUND` when official and `RUN_DIAGNOSTIC` otherwise, and the
CLI applies it: the verdict is a scoring input, so `aos assess` on a lane that cannot be official
withholds the number (`issued: false`, `score: null`, `claim_stage: "RUN_DIAGNOSTIC"`, blocker
`ISOLATION_NOT_OFFICIAL` carrying the `AOS_ISOLATION_*` reasons) and exits non-zero, printing the
stage and the reasons where the score would have been. The arithmetic is still reported as
`provisional_raw`, because an operator fixing the gate needs to see what the run was worth. This
is what the level table above means in practice -- `BEST_EFFORT_CLI` is diagnostic only (SSOT §24)
-- and it is a behaviour change for every host that cannot run the proven lane: `aos cycle` has no
median to take there, and says so per run rather than printing a number that reads as official. `issuanceGateForRun(records)` folds a run's
invocations into one decision that is official only when every invocation is, on the same lane
and policy, and a run with no invocations is not official. `BEST_EFFORT_CLI` and `NONE` cannot
reach `official` by any path: the level check alone refuses them, and
`tests/product/confinement.test.mjs` walks every lane in the support matrix and every level to
show zero official cases outside `STRICT`.

### The lane that was proven

The real-lane recorder ran on this machine (`strict-lane.darwin.host.json`: Darwin 25.3.0
arm64, macOS 26.3, node v22.23.2, codex-cli 0.148.0, `/usr/bin/sandbox-exec` present). Under
the generated profile:

- the canary passed all eleven cells, the planted files were intact, and the detached descendant
  was seen by the scan and dead after cleanup (`strict-lane.darwin.seatbelt.canary.json`);
- `codex login status` exited 0 with `Logged in using ChatGPT` against the staged copy
  (`strict-lane.darwin.seatbelt.codex-auth.json`);
- `codex exec --skip-git-repo-check -C @WORKSPACE@ -o @WORKSPACE@/last-message.txt -` with the
  prompt on stdin exited 0 and answered `OK` in about five seconds
  (`strict-lane.darwin.seatbelt.codex-exec.json`).

What a runtime wrote is recorded as a summary -- bytes, lines, a digest over the bytes, and which
of a few markers the stream contained -- and never as text. `fixtures/confinement/` ships with the
package, SSOT excludes raw transcripts from committed evidence, and the recorder used to copy the
runtime's stdout and stderr verbatim: the prompt, the model's answer, the banner and a session id.
The digest is what makes the summary evidence, because it is over what the runtime actually wrote
and a re-run can be compared against it.

The probe stamps the lane official only if all three of its subprocesses succeeded -- the canary,
`codex login status` and `codex exec` -- and it records its own teardown as an observation
(`strict-lane.darwin.seatbelt.cleanup.json`: the staged credential copy, the agent HOME, the run
scratch and the base store, each gone or not). Its cleanup is unconditional, so a failing canary no
longer leaves the staged copy of the operator's credential on disk. The matrix reads
`cleanup_verified` from that observation and the process axis from the canary's recorded group
sweep through `processAxisEnforced` -- the same helper a run uses -- so the table has one formula
rather than two, and every observation a row cites must record an exit status of 0.

A guard that only one platform can measure is recorded where the other can require it:
`tests/mutation/measured.json` carries, per guard, the platform that measured it and a fingerprint
of the guard and the bytes of the file it mutates. The lane that cannot run it demands a record that
still describes the code in front of it, so a guard cannot be deferred on every lane and counted as
fine -- and a change to the guard or that file makes the record stale until the platform that owns
it has run again.

`npm run verify:real-runtime-strict` sets `AOS_REAL_STRICT_REQUIRED=1`, and under that variable a
skip is a failure: on a host without the backend, or without an authenticated Codex, the script
exits non-zero naming `AOS_REAL_STRICT_NOT_RUN` rather than reporting a suite that skipped
everything as a pass. `npm test` sets nothing, so the same file skips honestly there.

`tests/product/confinement-real-lane.test.mjs` (`npm run verify:real-runtime-strict`) repeats
this through `runProcess` rather than the recorder: a node agent that tries to leave the boundary
and leaves a detached `sleep` behind gets `EPERM` on every outside cell, sees no `AOS_HOME` in its
environment, is reported with `leaked_descendants: true` and the descendant's pid, and the
descendant is dead after teardown; the installed Codex runtime, run through the same path, exits
0, answers `OK`, and its record is `official: true` with an empty reason list. On a machine
without `sandbox-exec`, or one that is not darwin, the file skips with an explicit `NOT_OBSERVED`
reason and does not pass on nothing.

A staged file must be the file it claims to be: `lstat`, not `stat`, so a `config.toml` that is a
link to anywhere on the host is refused by name rather than copied into the agent's private HOME.
Its bytes would not be credential-shaped -- plain host content walks straight through the redactor
-- so this is a fail-closed rule and not a redaction problem, and the record lists what was refused
so the operator sees why the runtime came up without it.

The staged copy is also what the run scrubs by value: `stageRuntimeConfig` hands the caller the
credential-shaped strings it copied, and `runProcess` rebuilds its exact-value scrubber from them
before the agent starts. The scrubber used to be built from the environment alone, so a task that
opened its own staged `auth.json` and printed an unfamiliar token shape published it; the shape
rules in `lib/redact.mjs` now also cover a JSON `refresh_token`-style field and vendor-prefixed
opaque tokens. The bytes of the staged `config.toml` are bound into the profile as
`runtime_config_digest` (the credential is deliberately excluded: a refreshed token is not a new
cohort), and the lane the CLI runs under is bound as `isolation_level` plus
`isolation_policy_digest`, so a run under `AOS_ISOLATION=STRICT` is a different cohort from one
under the default lane instead of an identical digest with a different boundary.

Nothing the child can read discloses the store. `AOS_WORKSPACE` is `.` against a cwd of the
workspace and `assertNoStorePathInEnv` refuses the spawn if any variable -- from any layer --
carries the store path; and the workspaces no longer live inside the store at all. `runPaths` puts
them under their own root beside it (`<store>-workspaces/<run>/<family>`, or `AOS_WORKSPACES`), so
the working directory an agent reads out of `getcwd` names its own workspace and nothing above it.
Every containment question is asked of canonical paths, in both directions: `workspacesRoot`
refuses an `AOS_WORKSPACES` that resolves inside the store, `checkBindings` refuses a workspace that
contains the store *or* sits inside it, and the spawn compares the resolved workspace as well as the
one it was handed. A symlinked workspaces root is outside the store to a string comparison and
inside it to the kernel, which is the only reader whose answer becomes the child's working
directory. `runProcess` refuses a workspace under `AOS_HOME` outright
(`AOS_ISOLATION_WORKSPACE_INSIDE_STORE`), because the layout is decided three files away from the
spawn. The store keeps AOS's own records: manifests, events, results, reports.

A cleanup failure is recorded by class and by digest of the path, never by the path: this record
is copied whole into the result the operator publishes, and the directories in it are absolute
paths under their home with the run's own id in them.

From the CLI, the lane is the operator's to name: `AOS_ISOLATION=STRICT aos agent run ...` (and
`aos assess`, `aos observe`) runs under the boundary and the record says so; unset, the CLI runs
`BEST_EFFORT_CLI`, which every host can run and which is never official. A value that is neither
lane is refused as `AOS_ISOLATION_LEVEL_UNKNOWN` before any command runs, because a misspelling
that quietly fell back to the weaker lane would look exactly like choosing it. A live
`aos agent run codex --task ... --json` under `AOS_ISOLATION=STRICT` on this machine returned a
record with `level: STRICT`, `backend: macos-seatbelt`, canary `PASS`, three tracked descendants
and none leaked, `cleanup_verified: true`, and `AOS_HOME` in the removed-variable list; the gate
over that record is `official: true` with no reasons.

That lane -- `darwin/macos-seatbelt/codex-cli.v1` at `STRICT` -- is the one row in the matrix
that is official, and it is `SUPPORTED_WITH_CONSTRAINTS` rather than `SUPPORTED` for the four
reasons the fixture lists: `sandbox-exec` is deprecated by Apple and still enforcing, so the
adapter re-checks it on every run; `CODEX_HOME` is a staged copy; task-initiated external
network is `NOT_OBSERVED`; and a descendant that double-forks between two polls is not tracked.
The darwin `claude-code.v1` and `generic-command.v1` rows share the boundary measurement but no
real runtime authenticated under it on those lanes, so they are `NOT_OBSERVED` and withheld. The
linux rows are `NOT_OBSERVED` because this machine cannot run `bwrap` and the Phase 0 container
could not run the darwin-only runtime; the argument vector is tested, the boundary is not
measured, and Phase 0 item 3 -- a Linux runner -- is still the coordinator's to add.

### Support matrix

Rendered by `renderSupportMatrix` from the decisions `supportMatrixDecisions` made -- it renders
what was decided rather than deciding again -- over `fixtures/confinement/support-matrix.json`,
digest
`sha256:e1d66f95354536f4ebd6f0059f42237cca3876062d4aadb526351b4cc75c21e2`. The `Official` column
is the gate's decision over the row's committed evidence, not the row's own label: the test forges
an official Linux row and shows the gate refuses it. Each row cites its observations by file *and
by digest*, and the digest is checked against the bytes before the observation is read -- a row
whose citation does not match what is on disk claims nothing
(`AOS_ISOLATION_EVIDENCE_DIGEST_MISMATCH`). Those observations ship with the package
(`fixtures/confinement/` is in `files`), so the shipped matrix can prove what it cites.

| Platform | Backend | Adapter | Level | Support | Official | Reason / evidence |
|---|---|---|---|---|---|---|
| darwin | macos-seatbelt | codex-cli.v1 | STRICT | SUPPORTED_WITH_CONSTRAINTS | OFFICIAL | canary `strict-lane.darwin.seatbelt.canary.json`; runtime `strict-lane.darwin.seatbelt.codex-auth.json`; exec `strict-lane.darwin.seatbelt.codex-exec.json`; cleanup `strict-lane.darwin.seatbelt.cleanup.json`; host `strict-lane.darwin.host.json` |
| darwin | macos-seatbelt | claude-code.v1 | STRICT | NOT_OBSERVED | withheld | AOS_ISOLATION_EVIDENCE_MISSING, AOS_ISOLATION_RECORD_INVALID, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_RUNTIME_IDENTITY_UNVERIFIED, AOS_ISOLATION_LANE_NOT_PROVEN -- boundary measured by the same canary, no real runtime authenticated under it on this lane |
| darwin | macos-seatbelt | generic-command.v1 | STRICT | NOT_OBSERVED | withheld | AOS_ISOLATION_EVIDENCE_MISSING, AOS_ISOLATION_RECORD_INVALID, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_LANE_NOT_PROVEN -- boundary measured by the same canary, no real runtime authenticated under it on this lane |
| darwin | none | * | BEST_EFFORT_CLI | BLOCKED | withheld | AOS_ISOLATION_LEVEL_NOT_STRICT, AOS_ISOLATION_BACKEND_ABSENT, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_LANE_NOT_PROVEN -- no OS boundary: a replaced HOME and a filtered environment are not a sandbox |
| darwin | none | * | NONE | BLOCKED | withheld | AOS_ISOLATION_LEVEL_NOT_STRICT, AOS_ISOLATION_BACKEND_ABSENT, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_LANE_NOT_PROVEN -- no OS boundary: a replaced HOME and a filtered environment are not a sandbox |
| linux | linux-bubblewrap | codex-cli.v1 | STRICT | NOT_OBSERVED | withheld | AOS_ISOLATION_EVIDENCE_MISSING, AOS_ISOLATION_RECORD_INVALID, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_RUNTIME_IDENTITY_UNVERIFIED, AOS_ISOLATION_LANE_NOT_PROVEN -- bwrap is not installed on the probing host; the argument vector is tested, the boundary is not measured |
| linux | linux-bubblewrap | claude-code.v1 | STRICT | NOT_OBSERVED | withheld | AOS_ISOLATION_EVIDENCE_MISSING, AOS_ISOLATION_RECORD_INVALID, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_RUNTIME_IDENTITY_UNVERIFIED, AOS_ISOLATION_LANE_NOT_PROVEN -- bwrap is not installed on the probing host; the argument vector is tested, the boundary is not measured |
| linux | linux-bubblewrap | generic-command.v1 | STRICT | NOT_OBSERVED | withheld | AOS_ISOLATION_EVIDENCE_MISSING, AOS_ISOLATION_RECORD_INVALID, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_LANE_NOT_PROVEN -- bwrap is not installed on the probing host; the argument vector is tested, the boundary is not measured |
| linux | linux-container | * | STRICT | NOT_OBSERVED | withheld | AOS_ISOLATION_EVIDENCE_MISSING, AOS_ISOLATION_RECORD_INVALID, AOS_ISOLATION_BACKEND_ABSENT, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_LANE_NOT_PROVEN -- Phase 0 measured the boundary in a container and could not run the darwin-only runtime inside it; no adapter targets it |
| linux | none | * | BEST_EFFORT_CLI | BLOCKED | withheld | AOS_ISOLATION_LEVEL_NOT_STRICT, AOS_ISOLATION_BACKEND_ABSENT, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_LANE_NOT_PROVEN -- no OS boundary: a replaced HOME and a filtered environment are not a sandbox |
| linux | none | * | NONE | BLOCKED | withheld | AOS_ISOLATION_LEVEL_NOT_STRICT, AOS_ISOLATION_BACKEND_ABSENT, AOS_ISOLATION_FILESYSTEM_NOT_ENFORCED, AOS_ISOLATION_PROCESS_NOT_ENFORCED, AOS_ISOLATION_SETUP_UNVERIFIED, AOS_ISOLATION_CANARY_NOT_PASS, AOS_ISOLATION_CLEANUP_UNVERIFIED, AOS_ISOLATION_POLICY_DIGEST_MISSING, AOS_ISOLATION_SUPPORT_STATUS_NOT_RELEASABLE, AOS_ISOLATION_LANE_NOT_PROVEN -- no OS boundary: a replaced HOME and a filtered environment are not a sandbox |

## Matrix

### none

No confinement -- the operator's own shell environment and cwd.

Available on the probing machine: yes. Support status: **BLOCKED**.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A | `none.filesystem.json` |  |
| `write_inside_workspace` | allowed | none | -- | A | `none.filesystem.json` |  |
| `read_workspace_parent` | allowed | none | -- | A | `none.filesystem.json` |  |
| `write_outside_workspace` | allowed | none | -- | A | `none.filesystem.json` |  |
| `delete_outside_workspace` | allowed | none | -- | A | `none.filesystem.json` |  |
| `read_operator_home_absolute` | allowed | none | -- | A | `none.filesystem.json` |  |
| `read_operator_ssh_private_key_absolute` | allowed | none | -- | A | `none.filesystem.json` |  |
| `read_operator_agent_config_absolute` | allowed | none | -- | A | `none.filesystem.json` |  |
| `read_aos_home_absolute` | allowed | none | -- | A | `none.filesystem.json` |  |
| `escape_via_symlink` | allowed | none | -- | A | `none.filesystem.json` |  |
| `spawn_child_process` | allowed | none | -- | A | `none.filesystem.json` |  |
| `act_outside_boundary_from_descendant` | allowed | none | -- | B | `none.descendant.json` |  |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | `none.leak-observed.json` | The detached descendant took its own process group, was reparented to pid 1, and was still alive after the parent's kill(-pgid, SIGKILL) -- which returned ESRCH, because the agent's own group had already emptied and the descendant was no longer in it to be signalled. |
| `act_outside_boundary_after_orphaning` | allowed | none | -- | C | `none.leak-observed.json` |  |
| `open_outbound_network_socket` | allowed | none | -- | A | `none.filesystem.json` |  |
| `read_operator_keychain_secret` | allowed | none | -- | D | `none.credentials.json` |  |

```text
A  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node fixtures/confinement/probes/probe.mjs
B  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ PROBE_RUNTIME=@RUNTIME_FILES@ node fixtures/confinement/probes/descendant-probe.mjs
C  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node fixtures/confinement/probes/leak-probe.mjs   # then, from the unconfined parent: ps -o pid=,pgid=,ppid= -p <descendant>; kill -KILL -<agent pgid>; ps -o pid= -p <descendant>
D  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node fixtures/confinement/probes/auth-probe.mjs
```

Issuance gate: `filesystem_enforced=false  process_enforced=false  setup_verified=true  authenticated_runtime=true  boundary_canary=FAIL  cleanup_verified=false  network_policy=unrestricted`

Blocking: `filesystem_enforced`, `process_enforced`, `boundary_canary`, `cleanup_verified`.

- Nothing is enforced. Present as the control row: every other backend is only meaningful read against it.

### best-effort-cli

Replaced HOME and TMPDIR, a temp cwd, and a detached process group killed on timeout (lib/isolation.mjs buildAgentEnv, lib/core.mjs runProcess).

Available on the probing machine: yes. Support status: **BLOCKED**.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `write_inside_workspace` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `read_workspace_parent` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `write_outside_workspace` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `delete_outside_workspace` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `read_operator_home_absolute` | allowed | none | -- | A | `best-effort-cli.filesystem.json` | The same directory read through $HOME reported one entry, the temp home's own. Read by absolute path it is fully readable: the replacement moves where a tilde expands to, not the operator's files. |
| `read_operator_ssh_private_key_absolute` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `read_operator_agent_config_absolute` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `read_aos_home_absolute` | allowed | none | -- | A | `best-effort-cli.filesystem.json` | AOS_HOME is stripped from the child environment, so the name is gone. The directory is not. |
| `escape_via_symlink` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `spawn_child_process` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `act_outside_boundary_from_descendant` | allowed | none | -- | B | `best-effort-cli.descendant.json` |  |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | `best-effort-cli.leak-observed.json` |  |
| `act_outside_boundary_after_orphaning` | allowed | none | -- | C | `best-effort-cli.leak-observed.json` |  |
| `open_outbound_network_socket` | allowed | none | -- | A | `best-effort-cli.filesystem.json` |  |
| `read_operator_keychain_secret` | denied | path_absent | -- | D | `best-effort-cli.credentials.json` | Recorded as a denial and it is one, but the enforcement is a moved path, not a refusal: the login keychain is resolved from HOME, and HOME was replaced. The absent-item control returned 44 in every run, so a 44 here does not distinguish the two on its own -- what does is that the unconfined control returned 0 for the same item. |

```text
A  cd @WORKSPACE@ && <env built by lib/isolation.mjs buildAgentEnv("BEST_EFFORT_CLI", process.env, { home: <temp> })> node fixtures/confinement/probes/probe.mjs
B  cd @WORKSPACE@ && <env built by lib/isolation.mjs buildAgentEnv("BEST_EFFORT_CLI", process.env, { home: <temp> })> node fixtures/confinement/probes/descendant-probe.mjs
C  cd @WORKSPACE@ && <env from buildAgentEnv("BEST_EFFORT_CLI", process.env, { home: <temp> })> node fixtures/confinement/probes/leak-probe.mjs   # then, from the unconfined parent: ps -o pid=,pgid=,ppid= -p <descendant>; kill -KILL -<agent pgid>; ps -o pid= -p <descendant>
D  cd @WORKSPACE@ && <env built by lib/isolation.mjs buildAgentEnv("BEST_EFFORT_CLI", process.env, { home: <temp> })> node fixtures/confinement/probes/auth-probe.mjs
```

Issuance gate: `filesystem_enforced=false  process_enforced=false  setup_verified=true  authenticated_runtime=false  boundary_canary=FAIL  cleanup_verified=false  network_policy=unrestricted`

Blocking: `filesystem_enforced`, `process_enforced`, `boundary_canary`, `cleanup_verified`, `authenticated_runtime`.

- Every filesystem row here is `allowed`. Reading through $HOME finds an empty temp directory, which reads like a boundary; the same paths read absolutely are fully reachable.
- The environment was built by the product's own buildAgentEnv rather than by an approximation, so these rows describe the shipped behaviour and not a harness.
- The authentication rows are about a missing config directory, not about confinement. See the authentication cells: carrying CODEX_HOME restores the Codex login under the same buildAgentEnv environment.

### macos-seatbelt-deny-default

sandbox-exec(1) with a (deny default) Seatbelt profile allowing only the system tree, the probe files read-only, and the workspace.

Available on the probing machine: yes. Deprecated interface. Support status: **BLOCKED**. Policy digest `sha256:a3c454c5217e75d3affccff387978afbbb98b39b9f30d48a39199f61ec7d3f66`.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `write_inside_workspace` | allowed | none | -- | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `read_workspace_parent` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `write_outside_workspace` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `delete_outside_workspace` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `read_operator_home_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `read_operator_ssh_private_key_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `read_operator_agent_config_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `read_aos_home_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `escape_via_symlink` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` | The kernel resolves the link before it checks the policy, so a link planted inside the workspace does not carry the workspace's permissions to its target. |
| `spawn_child_process` | allowed | none | -- | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `act_outside_boundary_from_descendant` | denied | kernel | EPERM | B | `macos-seatbelt-deny-default.descendant.json` | The profile is inherited across exec. The same probe unconfined read the directory. |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | `macos-seatbelt-deny-default.leak-observed.json` | Seatbelt confines what a process may touch, not how long it lives. |
| `act_outside_boundary_after_orphaning` | denied | kernel | -- | C | `macos-seatbelt-deny-default.leak-observed.json` | The survivor wrote ORPHAN_STILL_CONFINED after being reparented to pid 1. The unconfined control wrote ORPHAN_READ_OK. A leak here is a process that outlives the run without gaining any reach. |
| `open_outbound_network_socket` | denied | kernel | EPERM | A | `macos-seatbelt-deny-default.filesystem.json` |  |
| `read_operator_keychain_secret` | denied | kernel | -- | D | `macos-seatbelt-deny-default.credentials.json` | Measured with `security -w`, which retrieves the secret rather than only locating the item. The absent-item control returned 44 in the same run, and the unconfined control returned 0 for this item, so the 44 here is a refusal and not an empty keychain. |

```text
A  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f deny-default.sb node fixtures/confinement/probes/probe.mjs
B  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ PROBE_RUNTIME=@RUNTIME_FILES@ sandbox-exec -f deny-default.sb node fixtures/confinement/probes/descendant-probe.mjs
C  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f deny-default.sb node fixtures/confinement/probes/leak-probe.mjs   # then, from the unconfined parent: ps -o pid=,pgid=,ppid= -p <descendant>; kill -KILL -<agent pgid>; ps -o pid= -p <descendant>
D  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f deny-default.sb node fixtures/confinement/probes/auth-probe.mjs
```

Issuance gate: `filesystem_enforced=true  process_enforced=false  setup_verified=true  authenticated_runtime=false  boundary_canary=FAIL  cleanup_verified=false  network_policy=disabled`

Blocking: `process_enforced`, `boundary_canary`, `cleanup_verified`, `authenticated_runtime`.

- sandbox-exec(1) is documented DEPRECATED in its own man page on macOS 26.3 and still enforces. Apple can withdraw it with no deprecation period left to spend.
- The profile names no runtime install tree, so no agent CLI can be exec'd under it. Its authentication cells measure exec and say nothing about credentials.
- sandbox-exec's own failure codes -- 65 for a missing or invalid profile, 71 when it cannot exec -- collide with ordinary runtime exit codes, which was measured directly.
- /bin/ps cannot be exec'd inside any profile on this machine, including (allow default), because it is setgid. Anything inside the boundary that needs to enumerate processes has to do it another way.

### macos-seatbelt-provider-lane

The deny-default profile plus named read-only holes for the runtime's credential directory and install tree, and outbound network for the provider transport. The login keychain is deliberately not named.

Available on the probing machine: yes. Deprecated interface. Support status: **BLOCKED**. Policy digest `sha256:3a84eed074d292f4951767f08ced0c0fcad4b50eed0c503d9f87cb1fc27a71dc`.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `write_inside_workspace` | allowed | none | -- | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `read_workspace_parent` | denied | kernel | EPERM | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `write_outside_workspace` | denied | kernel | EPERM | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `delete_outside_workspace` | denied | kernel | EPERM | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `read_operator_home_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `read_operator_ssh_private_key_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `read_operator_agent_config_absolute` | allowed | none | -- | A | `macos-seatbelt-provider-lane.filesystem.json` | Allowed on purpose and by name. ~/.claude.json, which the profile does not name, stayed EPERM in the same run: the hole is the named path and nothing more. |
| `read_aos_home_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `escape_via_symlink` | denied | kernel | EPERM | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `spawn_child_process` | allowed | none | -- | A | `macos-seatbelt-provider-lane.filesystem.json` |  |
| `act_outside_boundary_from_descendant` | denied | kernel | EPERM | B | `macos-seatbelt-provider-lane.descendant.json` |  |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | `macos-seatbelt-provider-lane.leak-observed.json` | Unchanged from the deny-default profile. Nothing in the provider lane touches the process axis. |
| `act_outside_boundary_after_orphaning` | denied | kernel | -- | C | `macos-seatbelt-provider-lane.leak-observed.json` |  |
| `open_outbound_network_socket` | allowed | none | -- | A | `macos-seatbelt-provider-lane.filesystem.json` | Allowed on purpose. The same probe under the deny-default profile was EPERM, so the network axis is separately controllable. |
| `read_operator_keychain_secret` | denied | kernel | -- | D | `macos-seatbelt-provider-lane.credentials.json` | Denied, and this profile is the reason: it deliberately does not name the keychain. AOS resolves the Claude Code credential in the parent and injects it into the child environment (lib/runtime-auth.mjs), so a confined child does not need keychain access to authenticate. |

```text
A  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f provider-lane.sb node fixtures/confinement/probes/probe.mjs
B  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ PROBE_RUNTIME=@RUNTIME_FILES@ sandbox-exec -f provider-lane.sb node fixtures/confinement/probes/descendant-probe.mjs
C  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f provider-lane.sb node fixtures/confinement/probes/leak-probe.mjs   # then, from the unconfined parent: ps -o pid=,pgid=,ppid= -p <descendant>; kill -KILL -<agent pgid>; ps -o pid= -p <descendant>
D  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f provider-lane.sb node fixtures/confinement/probes/auth-probe.mjs
```

Issuance gate: `filesystem_enforced=true  process_enforced=false  setup_verified=true  authenticated_runtime=true  boundary_canary=FAIL  cleanup_verified=false  network_policy=provider-required-unrestricted`

Blocking: `process_enforced`, `boundary_canary`, `cleanup_verified`.

- The process axis is open. A detached descendant takes its own session, escapes the process group AOS signals, and is not listed by lib/core.mjs processGroupMembers -- measured against that function directly.
- `authenticated_runtime` is true on the strength of the Codex cell. The Claude Code cell under this profile is not logged in, because nothing here supplies its credential; AOS's own resolver would, and that path was not exercised.
- Deprecated interface, as the deny-default row.
- Network is allowed wholesale. Provider transport and task-initiated external calls are not distinguishable at this layer, so a claim resting on that distinction has to be recorded NOT_OBSERVED.

### macos-seatbelt-keychain-lane

The provider lane with the login keychain additionally granted, run to measure what such a grant buys rather than to propose it.

Available on the probing machine: yes. Deprecated interface. Support status: **BLOCKED**. Policy digest `sha256:95df612c5e969b006fcda96c39f4a65ad162769ffd4c258f81283fabfd76394f`.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `write_inside_workspace` | allowed | none | -- | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `read_workspace_parent` | denied | kernel | EPERM | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `write_outside_workspace` | denied | kernel | EPERM | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `delete_outside_workspace` | denied | kernel | EPERM | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `read_operator_home_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `read_operator_ssh_private_key_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `read_operator_agent_config_absolute` | allowed | none | -- | A | `macos-seatbelt-keychain-lane.filesystem.json` | Inherited from the provider lane this profile extends. |
| `read_aos_home_absolute` | denied | kernel | EPERM | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `escape_via_symlink` | denied | kernel | EPERM | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `spawn_child_process` | allowed | none | -- | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `act_outside_boundary_from_descendant` | denied | kernel | EPERM | B | `macos-seatbelt-keychain-lane.descendant.json` |  |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | `macos-seatbelt-keychain-lane.leak-observed.json` |  |
| `act_outside_boundary_after_orphaning` | denied | kernel | -- | C | `macos-seatbelt-keychain-lane.leak-observed.json` |  |
| `open_outbound_network_socket` | allowed | none | -- | A | `macos-seatbelt-keychain-lane.filesystem.json` |  |
| `read_operator_keychain_secret` | allowed | none | -- | D | `macos-seatbelt-keychain-lane.credentials.json` | Retrieved with `security -w`, exit 0. What this establishes is that granting the keychain files makes this item's secret readable inside the boundary. Only this one item was queried; the grant is on the keychain database rather than on an item, so it is not narrowable, but no claim is made here about what else it reaches. |

```text
A  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f keychain-lane.sb node fixtures/confinement/probes/probe.mjs
B  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ PROBE_RUNTIME=@RUNTIME_FILES@ sandbox-exec -f keychain-lane.sb node fixtures/confinement/probes/descendant-probe.mjs
C  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f keychain-lane.sb node fixtures/confinement/probes/leak-probe.mjs   # then, from the unconfined parent: ps -o pid=,pgid=,ppid= -p <descendant>; kill -KILL -<agent pgid>; ps -o pid= -p <descendant>
D  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f keychain-lane.sb node fixtures/confinement/probes/auth-probe.mjs
```

Issuance gate: `filesystem_enforced=true  process_enforced=false  setup_verified=true  authenticated_runtime=true  boundary_canary=FAIL  cleanup_verified=false  network_policy=provider-required-unrestricted`

Blocking: `process_enforced`, `boundary_canary`, `cleanup_verified`.

- Not a proposed profile. It exists so that the cost of a keychain grant is a measurement rather than an assumption, and because the provider lane's Claude Code cell needed something to be read against.
- The grant is on the keychain files, not on an item. One item was queried and its secret was retrievable; nothing was measured about any other item, and nothing here should be read as a claim about the rest of the keychain.
- Shares every process-axis limitation of the provider lane.

### linux-container-vm

OCI container on the Linux VM reachable from this darwin host (Docker 29.4.0 server, OrbStack kernel 7.0.11, linux/arm64), workspace bind-mounted, --network none.

Available on the probing machine: yes. Support status: **BLOCKED**.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A | `linux-container-vm.filesystem.json` |  |
| `write_inside_workspace` | allowed | none | -- | A | `linux-container-vm.filesystem.json` |  |
| `read_workspace_parent` | denied | namespace | ENOENT | A | `linux-container-vm.filesystem.json` | ENOENT rather than EPERM: the host path is not in the mount namespace at all. |
| `write_outside_workspace` | denied | namespace | ENOENT | A | `linux-container-vm.filesystem.json` |  |
| `delete_outside_workspace` | denied | namespace | ENOTARGET | A | `linux-container-vm.filesystem.json` | The target the harness created outside the workspace is not in the namespace, so what is established is that it was unreachable, not that an unlink was refused. |
| `read_operator_home_absolute` | denied | namespace | ENOENT | A | `linux-container-vm.filesystem.json` |  |
| `read_operator_ssh_private_key_absolute` | denied | namespace | ENOENT | A | `linux-container-vm.filesystem.json` |  |
| `read_operator_agent_config_absolute` | denied | namespace | ENOENT | A | `linux-container-vm.filesystem.json` | Denied by default. A read-only bind mount does deliver it, and a write to that mount returned EROFS. |
| `read_aos_home_absolute` | denied | namespace | ENOENT | A | `linux-container-vm.filesystem.json` |  |
| `escape_via_symlink` | denied | namespace | ENOENT | A | `linux-container-vm.filesystem.json` |  |
| `spawn_child_process` | allowed | none | -- | A | `linux-container-vm.filesystem.json` |  |
| `act_outside_boundary_from_descendant` | denied | namespace | ENOENT | B | `linux-container-vm.descendant.json` |  |
| `survive_cleanup_as_detached_descendant` | denied | namespace | -- | C | `linux-container-vm.cleanup.json` | The descendant led its own process group inside the container and went with it: teardown reaps a pid namespace, not a process group. |
| `act_outside_boundary_after_orphaning` | not_observed | -- | -- | -- | -- | The descendant did not outlive the run in this backend, so there was no orphan to test. Nothing is claimed about a survivor that did not occur. |
| `open_outbound_network_socket` | denied | namespace | ENETUNREACH | A | `linux-container-vm.filesystem.json` |  |
| `read_operator_keychain_secret` | denied | namespace | ENOENT | D | `linux-container-vm.credentials.json` | There is no macOS keychain and no /usr/bin/security inside a Linux namespace, so this is a denial by absence of the whole mechanism. |

```text
A  docker run --rm --platform linux/arm64 --network none -v @WORKSPACE@:@WORKSPACE@ -v fixtures/confinement/probes:fixtures/confinement/probes:ro -w @WORKSPACE@ -e PROBE_BASE=@BASE@ -e PROBE_OPERATOR_HOME=@OPERATOR_HOME@ -e PROBE_RUNTIME=fixtures/confinement/probes node:22-bookworm node fixtures/confinement/probes/probe.mjs
B  docker run --rm --platform linux/arm64 --network none -v @WORKSPACE@:@WORKSPACE@ -v fixtures/confinement/probes:fixtures/confinement/probes:ro -w @WORKSPACE@ -e PROBE_BASE=@BASE@ -e PROBE_OPERATOR_HOME=@OPERATOR_HOME@ -e PROBE_RUNTIME=fixtures/confinement/probes node:22-bookworm node fixtures/confinement/probes/descendant-probe.mjs
C  CID=$(docker run -d --rm --platform linux/arm64 --network none node:22-bookworm node -e '<spawn a detached sh -c "sleep 300", print its pid, then idle>') && docker logs $CID && docker exec $CID ps -eo pid,ppid,pgid,comm && docker stop -t 1 $CID && docker ps -a --filter id=$CID
D  docker run --rm --platform linux/arm64 --network none -v @WORKSPACE@:@WORKSPACE@ -v fixtures/confinement/probes:fixtures/confinement/probes:ro -w @WORKSPACE@ -e PROBE_BASE=@BASE@ -e PROBE_OPERATOR_HOME=@OPERATOR_HOME@ -e PROBE_RUNTIME=fixtures/confinement/probes node:22-bookworm node fixtures/confinement/probes/auth-probe.mjs
```

Issuance gate: `filesystem_enforced=true  process_enforced=true  setup_verified=true  authenticated_runtime=false  boundary_canary=PASS  cleanup_verified=true  network_policy=disabled`

Blocking: `authenticated_runtime`.

- Every measured boundary row holds and the teardown reaps the descendant. What fails is the runtime: the operator's installed codex carries only @openai/codex-darwin-arm64 and refused to start, which was measured rather than inferred.
- `boundary_canary: PASS` covers the fifteen properties that were observed here. The orphan row is not_observed, because no orphan survived to test.
- Running an agent here means the container carries its own Linux install of the CLI and its own copy of the credential -- live credential material inside the namespace the assessed agent writes to.
- The Linux kernel reached from this host is a VM. A result produced here describes the VM, not the operator's macOS machine.
- Nothing inside the Linux namespace can read the macOS keychain. What the parent injects into
  the container's environment or mounts into it is what the agent gets -- a copy AOS chose to hand
  over, which is the same exposure as the environment injection on macOS, now on a second host.

### linux-bubblewrap

bwrap(1) unprivileged user-namespace sandbox -- the first Linux backend the issue names.

Nothing was measured here. Not probed. bwrap is absent from this darwin host and from the Linux image reached from it, and establishing this lane needs a Linux runner with bubblewrap installed, which this machine cannot provide.

Availability evidence `availability.linux.tooling.json`: bwrap reported MISSING in the Linux image reached from this host, and MISSING on the darwin host itself in observations/availability.darwin.tooling.json.

Available on the probing machine: no. Support status: **NOT_OBSERVED**.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `write_inside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `read_workspace_parent` | not_observed | -- | -- | -- | -- | -- |
| `write_outside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `delete_outside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_home_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_ssh_private_key_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_agent_config_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_aos_home_absolute` | not_observed | -- | -- | -- | -- | -- |
| `escape_via_symlink` | not_observed | -- | -- | -- | -- | -- |
| `spawn_child_process` | not_observed | -- | -- | -- | -- | -- |
| `act_outside_boundary_from_descendant` | not_observed | -- | -- | -- | -- | -- |
| `survive_cleanup_as_detached_descendant` | not_observed | -- | -- | -- | -- | -- |
| `act_outside_boundary_after_orphaning` | not_observed | -- | -- | -- | -- | -- |
| `open_outbound_network_socket` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_keychain_secret` | not_observed | -- | -- | -- | -- | -- |

Issuance gate: `filesystem_enforced=not_observed  process_enforced=not_observed  setup_verified=not_observed  authenticated_runtime=not_observed  boundary_canary=NOT_OBSERVED  cleanup_verified=not_observed  network_policy=not_observed`

- No confinement row here is a claim. Its absence was measured; its behaviour was not.

### linux-user-namespace

unshare(1) / setpriv(1) over the kernel's own namespaces -- the second Linux backend the issue names.

Nothing was measured here. Not probed. The tools and namespaces exist -- see the availability evidence -- but AOS's host here is darwin, so no confinement was measured against a Linux host AOS would assess on. Availability is not enforcement and is not recorded as one.

Availability evidence `availability.linux.tooling.json`: unshare, nsenter and setpriv resolved, the kernel exposed cgroup, ipc, mnt, net, pid, time, user and uts namespaces, and Seccomp: 2 with one filter was already active.

Available on the probing machine: yes. Support status: **NOT_OBSERVED**.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `write_inside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `read_workspace_parent` | not_observed | -- | -- | -- | -- | -- |
| `write_outside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `delete_outside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_home_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_ssh_private_key_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_agent_config_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_aos_home_absolute` | not_observed | -- | -- | -- | -- | -- |
| `escape_via_symlink` | not_observed | -- | -- | -- | -- | -- |
| `spawn_child_process` | not_observed | -- | -- | -- | -- | -- |
| `act_outside_boundary_from_descendant` | not_observed | -- | -- | -- | -- | -- |
| `survive_cleanup_as_detached_descendant` | not_observed | -- | -- | -- | -- | -- |
| `act_outside_boundary_after_orphaning` | not_observed | -- | -- | -- | -- | -- |
| `open_outbound_network_socket` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_keychain_secret` | not_observed | -- | -- | -- | -- | -- |

Issuance gate: `filesystem_enforced=not_observed  process_enforced=not_observed  setup_verified=not_observed  authenticated_runtime=not_observed  boundary_canary=NOT_OBSERVED  cleanup_verified=not_observed  network_policy=not_observed`

- Availability was measured; confinement was not. The two are kept apart on purpose -- promoting the first into the second is how an untested lane ends up marked OFFICIAL.

### linux-landlock

Landlock LSM path-based filesystem restriction applied by a process to itself.

Nothing was measured here. Not probed, and not even its availability established: /sys/kernel/security/lsm was unreadable in the kernel reached from this host. Applying Landlock also needs a helper this phase is not permitted to add.

Availability evidence `availability.linux.tooling.json`: /sys/kernel/security/lsm was unreadable in the Linux kernel reached from this host, so not even the ABI's presence was established.

Available on the probing machine: not established. Support status: **NOT_OBSERVED**.

| Property | Observed | Enforced by | errno | Cmd | Raw | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `write_inside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `read_workspace_parent` | not_observed | -- | -- | -- | -- | -- |
| `write_outside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `delete_outside_workspace` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_home_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_ssh_private_key_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_agent_config_absolute` | not_observed | -- | -- | -- | -- | -- |
| `read_aos_home_absolute` | not_observed | -- | -- | -- | -- | -- |
| `escape_via_symlink` | not_observed | -- | -- | -- | -- | -- |
| `spawn_child_process` | not_observed | -- | -- | -- | -- | -- |
| `act_outside_boundary_from_descendant` | not_observed | -- | -- | -- | -- | -- |
| `survive_cleanup_as_detached_descendant` | not_observed | -- | -- | -- | -- | -- |
| `act_outside_boundary_after_orphaning` | not_observed | -- | -- | -- | -- | -- |
| `open_outbound_network_socket` | not_observed | -- | -- | -- | -- | -- |
| `read_operator_keychain_secret` | not_observed | -- | -- | -- | -- | -- |

Issuance gate: `filesystem_enforced=not_observed  process_enforced=not_observed  setup_verified=not_observed  authenticated_runtime=not_observed  boundary_canary=NOT_OBSERVED  cleanup_verified=not_observed  network_policy=not_observed`

- Listed because the issue names it. Nothing about it was measured, including whether it is present.

## The Seatbelt profiles

The profiles that produced the macOS rows, with the machine's own paths replaced by the placeholders
above. Their digests are the `policy_digest` values in the matrix and the test recomputes all three
from this file.

```scheme
(version 1)
(deny default)

; Everything the runtime needs in order to exist at all. Node resolves its own binary, the dyld
; shared cache and the system frameworks before a single line of agent code runs, so a profile that
; omits these is not testing confinement, it is testing whether node can start.
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self) (target pgrp))
(allow file-read-metadata)
(allow file-write* (literal "/dev/null"))
(allow process-exec
  (subpath "/usr/bin") (subpath "/bin") (subpath "/usr/lib") (subpath "/System")
  (subpath "@NODE_TREE@"))
(allow file-read*
  (subpath "/usr/lib") (subpath "/usr/share") (subpath "/System") (subpath "/Library")
  (subpath "/bin") (subpath "/usr/bin")
  (subpath "/private/var/db/dyld") (subpath "/private/var/select")
  (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/null")
  (literal "/dev/dtracehelper")
  (literal "/") (literal "/private") (literal "/private/tmp") (literal "/Users")
  (subpath "@NODE_TREE@"))

; Read-only, the way an adapter admits the runtime's own files without making them writable.
(allow file-read* (subpath "@RUNTIME_FILES@"))

; The boundary under test: the scenario workspace is the only writable place, and the only place
; outside the system tree that can be read. Nothing here names the operator's home, so every path
; into it -- tilde-relative or absolute -- falls to (deny default).
(allow file-read* file-write* (subpath "@WORKSPACE@"))
```

```scheme
(version 1)
(deny default)

; Everything the runtime needs in order to exist at all. Node resolves its own binary, the dyld
; shared cache and the system frameworks before a single line of agent code runs, so a profile that
; omits these is not testing confinement, it is testing whether node can start.
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self) (target pgrp))
(allow file-read-metadata)
(allow file-write* (literal "/dev/null"))
(allow process-exec
  (subpath "/usr/bin") (subpath "/bin") (subpath "/usr/lib") (subpath "/System")
  (subpath "@NODE_TREE@"))
(allow file-read*
  (subpath "/usr/lib") (subpath "/usr/share") (subpath "/System") (subpath "/Library")
  (subpath "/bin") (subpath "/usr/bin")
  (subpath "/private/var/db/dyld") (subpath "/private/var/select")
  (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/null")
  (literal "/dev/dtracehelper")
  (literal "/") (literal "/private") (literal "/private/tmp") (literal "/Users")
  (subpath "@NODE_TREE@"))

; Read-only, the way an adapter admits the runtime's own files without making them writable.
(allow file-read* (subpath "@RUNTIME_FILES@"))

; The boundary under test: the scenario workspace is the only writable place, and the only place
; outside the system tree that can be read. Nothing here names the operator's home, so every path
; into it -- tilde-relative or absolute -- falls to (deny default).
(allow file-read* file-write* (subpath "@WORKSPACE@"))

; Provider lane. Each of these is a named hole in the boundary, listed one at a time rather than
; covered by a wildcard, because a hole nobody can name is a hole nobody can review.
;
; The macOS login keychain is deliberately NOT named here. AOS resolves the Claude Code credential
; in the parent process and injects it into the child's environment (lib/runtime-auth.mjs), so a
; confined child never needs to reach the keychain, and granting it would have opened the whole
; keychain database to buy nothing.
(allow file-read* (subpath "@OPERATOR_HOME@/.codex"))
(allow file-read* process-exec (subpath "@RUNTIME_CLI_TREE@"))
(allow network-outbound)
(allow network-bind)
(allow system-socket)
(allow ipc-posix-shm)
```

```scheme
; A variant of the provider lane that additionally grants the login keychain, used only to measure
; what such a grant would buy. It is not the proposed STRICT profile: AOS resolves this credential
; in the parent, so the boundary does not need the hole.
(version 1)
(deny default)

; Everything the runtime needs in order to exist at all. Node resolves its own binary, the dyld
; shared cache and the system frameworks before a single line of agent code runs, so a profile that
; omits these is not testing confinement, it is testing whether node can start.
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self) (target pgrp))
(allow file-read-metadata)
(allow file-write* (literal "/dev/null"))
(allow process-exec
  (subpath "/usr/bin") (subpath "/bin") (subpath "/usr/lib") (subpath "/System")
  (subpath "@NODE_TREE@"))
(allow file-read*
  (subpath "/usr/lib") (subpath "/usr/share") (subpath "/System") (subpath "/Library")
  (subpath "/bin") (subpath "/usr/bin")
  (subpath "/private/var/db/dyld") (subpath "/private/var/select")
  (literal "/dev/urandom") (literal "/dev/random") (literal "/dev/null")
  (literal "/dev/dtracehelper")
  (literal "/") (literal "/private") (literal "/private/tmp") (literal "/Users")
  (subpath "@NODE_TREE@"))

; Read-only, the way an adapter admits the runtime's own files without making them writable.
(allow file-read* (subpath "@RUNTIME_FILES@"))

; The boundary under test: the scenario workspace is the only writable place, and the only place
; outside the system tree that can be read. Nothing here names the operator's home, so every path
; into it -- tilde-relative or absolute -- falls to (deny default).
(allow file-read* file-write* (subpath "@WORKSPACE@"))

; Provider lane. Each of these is a named hole in the boundary, listed one at a time rather than
; covered by a wildcard, because a hole nobody can name is a hole nobody can review.
;
; The macOS login keychain is deliberately NOT named here. AOS resolves the Claude Code credential
; in the parent process and injects it into the child's environment (lib/runtime-auth.mjs), so a
; confined child never needs to reach the keychain, and granting it would have opened the whole
; keychain database to buy nothing.
(allow file-read* (subpath "@OPERATOR_HOME@/.codex"))
(allow file-read* process-exec (subpath "@RUNTIME_CLI_TREE@"))
(allow network-outbound)
(allow network-bind)
(allow system-socket)
(allow ipc-posix-shm)
(allow file-read* (subpath "@OPERATOR_HOME@/Library/Keychains") (subpath "/Library/Keychains"))
(allow file-write* (subpath "@OPERATOR_HOME@/Library/Keychains"))
```

## The probe programs

Committed under `fixtures/confinement/probes/` and printed here in full. The test compares each
printed block against the committed file, so the document cannot describe a probe other than the one
that ran.

`probe.mjs`:

```javascript
// Confinement probe. Emits one JSON object on stdout describing what the process it runs as was
// actually able to do.
//
// No value of anything credential-bearing is emitted: the credential-adjacent checks report a
// length, a boolean or an exit status. Bytes of a private key and of auth.json are read into a
// buffer, because "could the agent read it" cannot be answered without attempting the read; what
// the buffer contained is never returned, printed or stored.
//
// The deletion check does not create its own target. An earlier version did, and under confinement
// it failed at creation and never reached the unlink -- a row named "delete outside" that only ever
// measured "write outside". The harness creates the target before the run.
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, symlinkSync, openSync, readSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";

const BASE = process.env.PROBE_BASE;
const WORKSPACE = `${BASE}/workspace`;
const REAL_HOME = process.env.PROBE_OPERATOR_HOME;
const results = {};

const attempt = (name, fn) => {
  try {
    const detail = fn();
    results[name] = { outcome: "allowed", errno: null, detail: detail === undefined ? null : detail };
  } catch (error) {
    results[name] = { outcome: "denied", errno: error?.code ?? null, detail: null };
  }
};

const needHome = () => {
  if (!REAL_HOME) throw Object.assign(new Error("PROBE_OPERATOR_HOME not supplied"), { code: "ENOHOME" });
  return REAL_HOME;
};

attempt("read_inside_workspace", () => readFileSync(`${WORKSPACE}/inside.txt`, "utf8").trim().length);
attempt("write_inside_workspace", () => {
  const path = `${WORKSPACE}/probe-write-${process.pid}`;
  writeFileSync(path, "x");
  unlinkSync(path);
  return true;
});
attempt("read_workspace_parent", () => readFileSync(`${BASE}/parent-canary.txt`, "utf8").trim().length);
attempt("write_outside_workspace", () => {
  const path = `${BASE}/outside/probe-write-${process.pid}`;
  writeFileSync(path, "x");
  unlinkSync(path);
  return true;
});
attempt("delete_outside_workspace", () => {
  // Created by the harness before this process started, so a denial here is a denial of unlink.
  const path = `${BASE}/outside/deletable.txt`;
  if (!existsSync(path)) throw Object.assign(new Error("target missing"), { code: "ENOTARGET" });
  unlinkSync(path);
  return true;
});
// Absolute and taken from PROBE_OPERATOR_HOME, not $HOME. Replacing HOME moves where a tilde
// expands to; it does not move the operator's files, and an agent that hardcodes the path walks
// straight past a temp HOME. This is the check that separates a boundary from a renamed one.
attempt("read_operator_home_absolute", () => readdirSync(needHome()).length > 0);
attempt("read_operator_ssh_listing_absolute", () => readdirSync(`${needHome()}/.ssh`).length > 0);
attempt("read_operator_ssh_private_key_absolute", () => {
  const dir = `${needHome()}/.ssh`;
  const name = readdirSync(dir).find((one) => /^id_/.test(one) && !one.endsWith(".pub"));
  if (!name) return "no_private_key_present";
  return { bytes_readable: readFileSync(`${dir}/${name}`).length > 0 };
});
attempt("read_operator_agent_config_absolute", () => ({ bytes_readable: readFileSync(`${needHome()}/.codex/auth.json`).length > 0 }));
attempt("read_aos_home_absolute", () => readdirSync(`${needHome()}/.aos`).length >= 0);
attempt("escape_via_symlink", () => {
  // A symlink planted inside the workspace pointing at the parent. A path-prefix check that
  // resolves the link's own name rather than its target is defeated here.
  const link = `${WORKSPACE}/escape-${process.pid}`;
  symlinkSync(`${BASE}/parent-canary.txt`, link);
  try { return readFileSync(link, "utf8").trim().length; }
  finally { try { unlinkSync(link); } catch {} }
});
attempt("spawn_child_process", () => {
  const r = spawnSync("/bin/echo", ["ok"], { encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status };
});
attempt("read_special_device", () => {
  const fd = openSync("/dev/urandom", "r");
  try { return readSync(fd, Buffer.alloc(1), 0, 1, null) === 1; }
  finally { closeSync(fd); }
});
attempt("tilde_relative_home_listing", () => ({ entries: readdirSync(os.homedir()).length }));

const tcp = () => new Promise((resolve) => {
  const socket = net.connect({ host: "1.1.1.1", port: 443 });
  const done = (outcome, errno) => { socket.destroy(); resolve({ outcome, errno: errno ?? null, detail: null }); };
  socket.setTimeout(5000);
  socket.once("connect", () => done("allowed"));
  socket.once("timeout", () => done("inconclusive", "ETIMEDOUT"));
  socket.once("error", (error) => done("denied", error?.code ?? null));
});
results.open_outbound_network_socket = await tcp();

process.stdout.write(JSON.stringify(results, null, 2));
```

`auth-probe.mjs`:

```javascript
// Whether the operator's credential material is reachable from inside the boundary.
//
// The Keychain check uses `-w`, which is the flag that makes `security` retrieve and print the
// secret itself rather than only its attributes. That difference matters: an exit of 0 without
// `-w` proves an item was found, not that its value could be read, and a boundary claim resting on
// the weaker of those two is an overclaim. stdio is discarded before this process can see it, so
// the secret is retrieved by `security` and read by nothing.
//
// A service name that does not exist is queried alongside it as a control, so a 0 can be told from
// a keychain that answers 0 to everything.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REAL_HOME = process.env.PROBE_OPERATOR_HOME;
const out = {};
// `outcome` is the answer to the row's question, not the answer to "did this function return".
// The keychain checks ran to completion under every profile -- `security` exists and exits -- and an
// earlier version recorded that as `allowed`, which said the secret was retrievable inside a
// boundary that had refused it. A check may declare its own outcome; only the ones that answer by
// succeeding or throwing fall back to that.
const check = (name, fn) => {
  try {
    const detail = fn();
    const outcome = detail && typeof detail === "object" && "outcome" in detail ? detail.outcome : "allowed";
    const { outcome: _ignored, ...rest } = detail && typeof detail === "object" ? detail : { value: detail };
    out[name] = { outcome, errno: null, detail: rest };
  } catch (error) {
    out[name] = { outcome: "denied", errno: error?.code ?? null, detail: null };
  }
};

check("codex_auth_file_readable", () => {
  const bytes = readFileSync(`${REAL_HOME}/.codex/auth.json`);
  // Parsed, so that "readable" means "usable by the runtime" rather than "the open syscall
  // returned". The parsed object is discarded on this line and only its key count survives.
  return { key_count: Object.keys(JSON.parse(bytes.toString("utf8"))).length };
});
check("codex_config_readable", () => ({ bytes_readable: readFileSync(`${REAL_HOME}/.codex/config.toml`).length > 0 }));
check("claude_config_readable", () => ({ bytes_readable: readFileSync(`${REAL_HOME}/.claude.json`).length > 0 }));

const security = (args) => {
  const r = spawnSync("/usr/bin/security", args, { stdio: "ignore" });
  if (r.error) throw r.error;
  return r.status;
};
check("keychain_secret_retrievable", () => {
  const status = security(["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
  return { outcome: status === 0 ? "allowed" : "denied", exit_status: status, secret_retrievable: status === 0 };
});
check("keychain_absent_item_control", () => {
  // Queried for a service that does not exist. If this ever comes back allowed, the item check
  // above is not discriminating and neither reading means anything.
  const status = security(["find-generic-password", "-s", "aos-confinement-probe-absent", "-w"]);
  return { outcome: status === 0 ? "allowed" : "denied", exit_status: status, secret_retrievable: status === 0 };
});

process.stdout.write(JSON.stringify(out, null, 2));
```

`descendant-probe.mjs` and `child-probe.mjs`:

```javascript
import { spawnSync } from "node:child_process";
const r = spawnSync(process.execPath, [`${process.env.PROBE_RUNTIME}/child-probe.mjs`], { encoding: "utf8" });
const child = r.stdout ? JSON.parse(r.stdout) : { outcome: "inconclusive", errno: r.error?.code ?? null, detail: null };
process.stdout.write(JSON.stringify({ act_outside_boundary_from_descendant: child, child_exit_status: r.status }, null, 2));
```

```javascript
// Spawned by descendant-probe.mjs. One question: does a process the agent creates inherit the
// boundary, or does the boundary stop at the process AOS launched?
import { readdirSync } from "node:fs";
try {
  const entries = readdirSync(`${process.env.PROBE_OPERATOR_HOME}/.ssh`).length;
  process.stdout.write(JSON.stringify({ outcome: "allowed", errno: null, detail: { entries_visible: entries > 0 } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ outcome: "denied", errno: error?.code ?? null, detail: null }));
}
```

`leak-probe.mjs`:

```javascript
// Leaves behind a descendant that outlives the run, the way an assessed agent starting a dev server
// does. Two separate questions: does it survive the teardown, and is it still confined once it has
// been orphaned. The second decides how bad a leak is, and the verdict is written inside the
// workspace because writing anywhere else is itself denied under a boundary.
import { spawn } from "node:child_process";
const marker = `${process.env.PROBE_BASE}/workspace/leak-verdict.txt`;
const target = `${process.env.PROBE_OPERATOR_HOME}/.ssh`;
const child = spawn("/bin/sh", ["-c",
  `sleep 3; if ls ${target} > /dev/null 2>&1; then echo ORPHAN_READ_OK > ${marker}; else echo ORPHAN_STILL_CONFINED > ${marker}; fi; sleep 25`
], { detached: true, stdio: "ignore" });
child.unref();
process.stdout.write(JSON.stringify({ parent_pid: process.pid, descendant_pid: child.pid, marker }, null, 2));
```

`setsid-probe.mjs`:

```javascript
// Can the boundary stop a child from leaving the process group AOS signals?
//
// Two independent readings, because the first two attempts each failed in a way that would have
// been recorded as an answer if only one had been taken.
//
// `kill(-pid, 0)` succeeds only if `pid` leads its own process group. It came back EPERM under the
// deny-default profile until that profile allowed a process to signal its own group -- a refusal to
// ask the question, which is not a fact about process groups.
//
// Having the child run `ps` instead returned nothing at all: `/bin/ps` is setgid and cannot be
// exec'd inside any Seatbelt profile on this machine, including `(allow default)`. That is recorded
// as its own observation rather than silently producing an empty reading here.
import { spawn } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";

const report = `${process.env.PROBE_BASE}/workspace/setsid-child.txt`;
if (existsSync(report)) unlinkSync(report);
const child = spawn("/bin/sh", ["-c", `ps -o pid=,pgid=,ppid= -p $$ > ${report} 2>&1; sleep 12`], { detached: true, stdio: "ignore" });
child.unref();

setTimeout(() => {
  let signal;
  try { process.kill(-child.pid, 0); signal = { child_leads_own_process_group: true, errno: null }; }
  catch (error) {
    signal = error.code === "ESRCH"
      ? { child_leads_own_process_group: false, errno: "ESRCH" }
      : { child_leads_own_process_group: "not_answerable", errno: error.code };
  }
  let ps = null;
  try { ps = readFileSync(report, "utf8").trim(); } catch (error) { ps = `unreadable:${error.code}`; }
  process.stdout.write(JSON.stringify({
    child_leads_own_process_group: signal.child_leads_own_process_group,
    signal_probe_errno: signal.errno,
    ps_in_child_available: ps.length > 0 && !/not permitted|unreadable/i.test(ps),
    ps_in_child_raw: ps,
    parent_pid: process.pid,
    child_pid: child.pid
  }, null, 2));
  try { process.kill(child.pid, "SIGKILL"); } catch {}
}, 1200);
```

`pg-check.mjs`:

```javascript
// Does the cleanup AOS actually performs reach everything the agent started?
//
// Uses the product's own enumeration rather than a re-implementation of it: `processGroupMembers`
// in lib/core.mjs is what decides `leaked_descendants`, and the question is whether that function
// can see a descendant which left the group. Spawns a parent detached, so the parent leads its own
// group exactly as `runProcess` spawns an agent, then gives it one ordinary child and one detached
// child before signalling the group.
import { spawn, execSync } from "node:child_process";
import { processGroupMembers } from "../../../lib/core.mjs";

const alive = (pid) => execSync(`ps -o pid= -p ${pid} || true`).toString().trim() !== "";
const psLine = (pid) => execSync(`ps -o pid=,pgid=,ppid= -p ${pid} || true`).toString().trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parent = spawn(process.execPath, ["-e", `
  const { spawn } = require("node:child_process");
  const inGroup = spawn("/bin/sh", ["-c", "sleep 40"], { stdio: "ignore" });
  const escaped = spawn("/bin/sh", ["-c", "sleep 41"], { detached: true, stdio: "ignore" });
  escaped.unref();
  console.log(JSON.stringify({ in_group: inGroup.pid, escaped: escaped.pid }));
  setTimeout(() => process.exit(0), 300);
`], { detached: true, stdio: ["ignore", "pipe", "ignore"] });

const pgid = parent.pid;
let out = "";
parent.stdout.on("data", (chunk) => { out += chunk; });
await new Promise((resolve) => parent.once("exit", resolve));
await pause(400);

const pids = JSON.parse(out);
const members = processGroupMembers(pgid);
const before = {
  aos_pgid: pgid,
  members_processGroupMembers_reports: members,
  in_group_child: { pid: pids.in_group, ps: psLine(pids.in_group), reported: members.includes(pids.in_group) },
  detached_descendant: { pid: pids.escaped, ps: psLine(pids.escaped), reported: members.includes(pids.escaped) }
};

let groupKill = "sent";
try { process.kill(-pgid, "SIGKILL"); }
catch (error) { groupKill = `error:${error.code}`; }
await pause(500);

process.stdout.write(JSON.stringify({
  before_cleanup: before,
  group_kill: groupKill,
  after_cleanup: {
    in_group_child_alive: alive(pids.in_group),
    detached_descendant_alive: alive(pids.escaped)
  }
}, null, 2));
try { process.kill(pids.escaped, "SIGKILL"); } catch {}
try { process.kill(pids.in_group, "SIGKILL"); } catch {}
```

## Handling of credential material

**No credential value was emitted, recorded or committed.** That is the accurate claim, and it is
narrower than the one an earlier draft made. Values were necessarily *touched*: answering "can the
agent read this" requires attempting the read, so the probes read private-key bytes and
`auth.json` into a buffer and parse the latter. What is returned from those functions is a length,
a key count or a boolean, and the buffer goes out of scope. The keychain check runs `security -w`,
which is the flag that retrieves the secret rather than only locating the item -- the weaker query
proves an item exists and an earlier draft rested a claim on it -- with the command's stdio
discarded before this process could read it, so only the exit status survives. `claude auth
status` answers in JSON that also carries the operator's account; it is reduced to `loggedIn` and
`authMethod` before anything is written. One earlier probe copied `~/.codex/auth.json` to a
temporary directory to test a `CODEX_HOME` redirect; that copy stored the value, it was deleted,
and the question was re-answered with an empty directory. Recorded output is scrubbed of the
operator's home, temp directory and hostname before it is written.

Phase B makes a copy of that kind deliberately, and the difference is its scope. `stageRuntimeConfig`
copies `auth.json` and `config.toml` into the agent's private HOME (0700, files 0600) for the
duration of one run and removes the directory with the run; the bytes are never read into this
process as anything but a buffer handed straight to `writeFileSync`, nothing about their content
is recorded, and the observation files record the staged file *names* and the source
(`default_dir` or `operator_env`) only. The real-lane recorder and the tests were checked for the
operator's account name, home path and hostname before the observations were committed.

## What was not measured

- **No Linux host was probed.** The Linux kernel reachable from this machine is a VM, and a result
  produced in it describes the VM.
- **bubblewrap, Linux user namespaces and Landlock have no confinement rows.** Their availability
  was measured and is recorded with its command and output; their behaviour was not, and nothing in
  this document describes how they would behave. Landlock's availability was not established either:
  `/sys/kernel/security/lsm` was unreadable in the kernel reached from here.
- **AOS's own keychain resolver was not exercised under confinement.** It is the path by which
  Claude Code would authenticate inside a boundary without the boundary granting the keychain.
- **The keychain grant was measured against one item.** The grant is on the keychain database rather
  than on an item, so it is not narrowable; what else it reaches was not measured and is not claimed.
- **Provider transport and task-initiated external network are not distinguishable** at this layer.
  Any claim that rests on that distinction has to be recorded NOT_OBSERVED.

## What Phase B has to buy

This list was written at the end of Phase 0. Items 1, 4 and 5 are bought by the Phase B section
above; item 2 is still open (the darwin `claude-code.v1` row is `NOT_OBSERVED`); item 3 is the
coordinator's.

1. **A descendant enumeration that does not depend on the process group.** The cheapest correct
   item, and it fixes a defect that exists today: `processGroupMembers` did not report the detached
   descendant and the group kill did not reach it. #553 has already made `cleanup_established`
   false by construction rather than claim otherwise; `DESCENDANT_SCAN_ESTABLISHES_CLEANUP` is the
   constant to flip. Until it flips, `cleanup_verified` cannot be true on any macOS backend here.
2. **Measure AOS's keychain resolver under confinement.** If the injected
   `CLAUDE_CODE_OAUTH_TOKEN` authenticates a confined Claude Code, then the STRICT profile never
   needs to name the keychain and the keychain-lane row can be retired. This is one run.
3. **A Linux CI runner.** Three of the nine backends have no confinement rows because this machine
   cannot reach a Linux host AOS would assess on, and bubblewrap is the issue's first-choice backend.
   The coordinator adds the runner; this issue cannot.
4. **A setup-failure channel that is not the exit code.** `sandbox-exec` exits 65 on a missing or
   invalid profile and 71 when it cannot exec, and a runtime exiting 71 is indistinguishable from
   the second -- all four measured. A boundary canary that runs inside the profile before the agent
   does is the only way to tell a confined run from one that was never confined.
5. **A decision on `config_env` under STRICT.** Codex authenticates inside the boundary because the
   profile names `~/.codex` read-only. That is a named hole in the boundary and it should be
   recorded on the result as one, not left implicit.
