# STRICT workspace confinement: what this machine can actually enforce

This is Phase 0 feasibility evidence for issue #556 and nothing else. No production code was
changed, no isolation backend was implemented, and `lib/isolation.mjs` and the spawn path in
`lib/core.mjs` were not touched. The issue's `feasibility-proof` phase declares
`code_integration_allowed: false`, and #556 remains blocked on #554, #555 and #588.

The question is narrow and answerable: on this machine, and on Linux, can AOS enforce a workspace
boundary on a child agent process, and does a real agent CLI's authentication survive inside it?
Every row below is something a probe process attempted and something the operating system either
permitted or refused. Where nothing was attempted, the row says `not_observed`. It never says
`denied`, because a boundary that was not tested is not a boundary, and a support table that
cannot tell those apart is how an untested lane ends up marked OFFICIAL.

The machine-readable form of the same matrix is `fixtures/confinement/probe.json`, digest
`sha256:b6d183c0aa2926552a2809dc1aa11520fd8e0f1d12a3d50c0cb20f5a4bafd982`. `tests/product/confinement-probe.test.mjs` holds the two
documents to each other and refuses a record that claims a capability it did not observe.

## The finding

The two halves of STRICT exist on this stack. They are in different backends and no backend has
both.

- **Seatbelt closes the filesystem and leaves the process axis open.** `sandbox-exec` is
  documented DEPRECATED in its own man page and still enforces on macOS 26.3: reads and writes
  outside the workspace, absolute paths into the operator's home, `~/.ssh`, AOS_HOME, and a
  symlink planted inside the workspace all returned EPERM, and a child process inherited the same
  refusals. A detached descendant took its own session, outlived the run, and was not listed by
  `processGroupMembers` in `lib/core.mjs`. Denying `setsid` by name and by syscall number both
  compiled and neither stopped it.
- **The container lane closes the process axis and cannot run the runtime.** A Linux container
  reaped the same detached descendant with its PID namespace, and every host path was simply absent
  from its mount namespace. The operator's installed `codex` is a darwin-arm64 binary and refused
  to start there: `Missing optional dependency @openai/codex-linux-arm64`.
- **What AOS ships today enforces nothing and costs authentication.** Under the replaced HOME, the
  tilde-relative reads returned ENOENT, which reads like a boundary. The same directories read by
  absolute path all succeeded. The one thing the replaced HOME reliably breaks is the runtime's own
  credential lookup: `codex login status` reported `Not logged in`, and the login Keychain moved
  out from under `security`, which returned 44 instead of 0.
- **Authentication does survive real confinement, when the boundary names the credential.** Under
  the provider-lane profile, with the operator's real HOME and the filesystem confined by the
  kernel, `codex login status` reported `Logged in using ChatGPT`. This is the single most
  important observation here: STRICT and the temp-HOME approach are alternative designs, not
  layers. Confinement has to replace the replaced HOME, not sit on top of it.

Under the issue's own issuance gate -- `filesystem_enforced`, `process_enforced`,
`setup_verified`, `boundary_canary`, `cleanup_verified` and an authenticated runtime all true
-- **no backend on this stack is SUPPORTED today**, and none is a release-acceptable
SUPPORTED_WITH_CONSTRAINTS. That is the honest Phase 0 result, and it is a measurement, not a
failure to measure.

## Host

| Field | Value |
| --- | --- |
| platform / arch | darwin / arm64 |
| OS | macOS 26.3 (25D125) |
| kernel | Darwin 25.3.0 xnu-12377.81.4~5 RELEASE_ARM64_T6041 |
| node | v22.23.2 |
| Linux kernel reached | 7.0.11-orbstack-00360-gc9bc4d96ac70 via Docker server 29.4.0 (linux/arm64) |

## Properties

Each is phrased as a capability of the assessed agent, so `allowed` always means the agent could
do the thing. `strict_requirement` is what STRICT needs that answer to be; `either` marks the
ones that are a policy decision rather than a boundary failure.

| Property | Question | STRICT requires |
| --- | --- | --- |
| `read_inside_workspace` | Can the agent read a file inside the scenario workspace? | allowed |
| `write_inside_workspace` | Can the agent write a file inside the scenario workspace? | allowed |
| `read_workspace_parent` | Can the agent read a file in the workspace's parent directory? | denied |
| `write_outside_workspace` | Can the agent create a file outside the workspace? | denied |
| `delete_outside_workspace` | Can the agent delete a file outside the workspace? | denied |
| `read_operator_home_absolute` | Can the agent list the operator's real home by absolute path, ignoring $HOME? | denied |
| `read_operator_ssh_private_key` | Can the agent read bytes of a private key under the operator's ~/.ssh? | denied |
| `read_operator_agent_config_absolute` | Can the agent read the runtime's own credential file under the operator's home? | either |
| `read_aos_home_absolute` | Can the agent read AOS_HOME -- run records, results, holdout ledger -- by absolute path? | denied |
| `escape_via_symlink` | Can the agent read outside the workspace through a symlink planted inside it? | denied |
| `spawn_child_process` | Can the agent start a child process at all? | either |
| `act_outside_boundary_from_descendant` | Can a process the agent spawned read outside the boundary? | denied |
| `survive_cleanup_as_detached_descendant` | Can the agent leave a detached process running after AOS tears the run down? | denied |
| `open_outbound_network_socket` | Can the agent open an outbound TCP connection? | either |
| `read_operator_keychain_item` | Can the agent retrieve the operator's real Keychain credential item? | either |
| `authenticate_as_the_operator` | Does a real agent CLI report itself logged in inside this backend? | allowed |

Commands are written with placeholders rather than the probing machine's paths.

| Placeholder | Stands for |
| --- | --- |
| `@WORKSPACE@` | the scenario workspace the probe treats as the only writable directory |
| `@BASE@` | the workspace's parent, holding the read and write canaries outside the boundary |
| `@OPERATOR_HOME@` | the operator's real home directory |
| `@NODE_TREE@` | the install prefix of the node binary that runs the probe |
| `@RUNTIME_CLI_TREE@` | the install prefix of the agent CLI |
| `@RUNTIME_FILES@` | a read-only directory holding the probe scripts, standing in for the runtime's own files |

## Matrix

### none

No confinement -- the operator's own shell environment and cwd.

Available on the probing machine: yes. Support status: **BLOCKED**.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A |  |
| `write_inside_workspace` | allowed | none | -- | A |  |
| `read_workspace_parent` | allowed | none | -- | A |  |
| `write_outside_workspace` | allowed | none | -- | A |  |
| `delete_outside_workspace` | allowed | none | -- | A |  |
| `read_operator_home_absolute` | allowed | none | -- | A |  |
| `read_operator_ssh_private_key` | allowed | none | -- | A |  |
| `read_operator_agent_config_absolute` | allowed | none | -- | A |  |
| `read_aos_home_absolute` | allowed | none | -- | A |  |
| `escape_via_symlink` | allowed | none | -- | A |  |
| `spawn_child_process` | allowed | none | -- | A |  |
| `act_outside_boundary_from_descendant` | allowed | none | -- | B |  |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | The detached descendant took its own process group and was invisible to lib/core.mjs processGroupMembers; it was still alive after kill(-pgid, SIGKILL). |
| `open_outbound_network_socket` | allowed | none | -- | A |  |
| `read_operator_keychain_item` | allowed | none | -- | D | security exited 0. |
| `authenticate_as_the_operator` | allowed | none | -- | E | Reported: Logged in using ChatGPT. |

```text
A  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node probe.mjs
B  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node probe-descendant.mjs
C  node pg-check.mjs   # spawn detached, kill(-pgid), re-check with lib/core.mjs processGroupMembers
D  cd @WORKSPACE@ && node auth-probe.mjs   # security find-generic-password, stdio discarded, exit status only
E  cd @WORKSPACE@ && codex login status
```

Issuance gate: `filesystem_enforced=false  process_enforced=false  setup_verified=true  authenticated_runtime=true  boundary_canary=FAIL  cleanup_verified=false  network_policy=unrestricted`

Blocking: `filesystem_enforced`, `process_enforced`, `boundary_canary`, `cleanup_verified`.

- Nothing is enforced. Present as the control row: every other backend is only meaningful against it.

### best-effort-cli

Replaced HOME and TMPDIR, a temp cwd, and a detached process group killed on timeout (lib/core.mjs runProcess, lib/isolation.mjs buildAgentEnv).

Available on the probing machine: yes. Support status: **BLOCKED**.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A |  |
| `write_inside_workspace` | allowed | none | -- | A |  |
| `read_workspace_parent` | allowed | none | -- | A |  |
| `write_outside_workspace` | allowed | none | -- | A |  |
| `delete_outside_workspace` | allowed | none | -- | A |  |
| `read_operator_home_absolute` | allowed | none | -- | A | Reading through $HOME returned ENOENT, which reads like a boundary and is not one: the same directory read by absolute path succeeded. |
| `read_operator_ssh_private_key` | allowed | none | -- | A |  |
| `read_operator_agent_config_absolute` | allowed | none | -- | A |  |
| `read_aos_home_absolute` | allowed | none | -- | A | AOS_HOME is removed from the child environment, so the name is gone. The directory is not. |
| `escape_via_symlink` | allowed | none | -- | A |  |
| `spawn_child_process` | allowed | none | -- | A |  |
| `act_outside_boundary_from_descendant` | allowed | none | -- | B |  |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | processGroupMembers reported only the in-group child; the detached one led its own group, was not listed, and survived kill(-pgid, SIGKILL). |
| `open_outbound_network_socket` | allowed | none | -- | A |  |
| `read_operator_keychain_item` | denied | path_absent | -- | D | security exited 44 rather than 0. The login keychain lives under the replaced HOME, so this denial is a moved path, not an enforced boundary. |
| `authenticate_as_the_operator` | denied | path_absent | -- | E | Reported: Not logged in. The same command with the operator's real HOME reports Logged in using ChatGPT. |

```text
A  cd @WORKSPACE@ && env -i PATH=... LANG=en_US.UTF-8 HOME=$(mktemp -d) TMPDIR=$HOME PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node probe.mjs
B  cd @WORKSPACE@ && env -i PATH=... HOME=$(mktemp -d) PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node probe-descendant.mjs
C  node pg-check.mjs   # spawn detached, kill(-pgid), re-check with lib/core.mjs processGroupMembers
D  cd @WORKSPACE@ && env -i HOME=$(mktemp -d) node auth-probe.mjs
E  cd @WORKSPACE@ && env -i PATH=... HOME=$(mktemp -d) TMPDIR=$HOME codex login status
```

Issuance gate: `filesystem_enforced=false  process_enforced=false  setup_verified=true  authenticated_runtime=false  boundary_canary=FAIL  cleanup_verified=false  network_policy=unrestricted`

Blocking: `filesystem_enforced`, `process_enforced`, `boundary_canary`, `cleanup_verified`, `authenticated_runtime`.

- Every filesystem denial observed here is a path that moved, not a permission that was refused. Absolute paths into the operator's home, ~/.ssh and AOS_HOME all succeeded.
- The two things it does stop are the runtime's own credential lookups, so it costs authentication and buys no confinement.

### macos-seatbelt-deny-default

sandbox-exec(1) with a (deny default) Seatbelt profile allowing only the system tree, the runtime's own files read-only, and the workspace.

Available on the probing machine: yes. Deprecated interface. Support status: **BLOCKED**. Policy digest `sha256:5f06552ed608d555d937e5115a595a927fcbaf23faeb23c2f2616e65b29948cd`.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A |  |
| `write_inside_workspace` | allowed | none | -- | A |  |
| `read_workspace_parent` | denied | kernel | EPERM | A |  |
| `write_outside_workspace` | denied | kernel | EPERM | A |  |
| `delete_outside_workspace` | denied | kernel | EPERM | A |  |
| `read_operator_home_absolute` | denied | kernel | EPERM | A |  |
| `read_operator_ssh_private_key` | denied | kernel | EPERM | A |  |
| `read_operator_agent_config_absolute` | denied | kernel | EPERM | A |  |
| `read_aos_home_absolute` | denied | kernel | EPERM | A |  |
| `escape_via_symlink` | denied | kernel | EPERM | A | The kernel resolves the link before it checks the policy, so a link planted inside the workspace does not carry the workspace's permissions to its target. |
| `spawn_child_process` | allowed | none | -- | A |  |
| `act_outside_boundary_from_descendant` | denied | kernel | EPERM | B | The profile is inherited across exec. The same probe unconfined reached the path. |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | Seatbelt confines what a process may touch, not how long it lives. The descendant took its own session and outlived the run. |
| `open_outbound_network_socket` | denied | kernel | EPERM | A |  |
| `read_operator_keychain_item` | denied | kernel | -- | D | security exited 44 rather than 0: the item was not retrievable. |
| `authenticate_as_the_operator` | denied | kernel | EPERM | D | codex could not read its own config: Error loading configuration ... Operation not permitted. |

```text
A  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f deny-default.sb node probe.mjs
B  cd @WORKSPACE@ && PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f deny-default.sb node probe-descendant.mjs
C  cd @WORKSPACE@ && sandbox-exec -f deny-default.sb node leaker.mjs; ps -o pid=,pgid=,ppid= -p <descendant>
D  cd @WORKSPACE@ && sandbox-exec -f deny-default.sb node auth-probe.mjs
```

Issuance gate: `filesystem_enforced=true  process_enforced=false  setup_verified=true  authenticated_runtime=false  boundary_canary=FAIL  cleanup_verified=false  network_policy=disabled`

Blocking: `process_enforced`, `boundary_canary`, `cleanup_verified`, `authenticated_runtime`.

- sandbox-exec(1) is documented DEPRECATED in its own man page on macOS 26.3 and still enforces. Apple can withdraw it in a point release with no deprecation period left to spend.
- No agent CLI can authenticate under it, so it confines a runtime that cannot do the work.
- sandbox-exec's own failure codes 65 (profile) and 71 (exec) collide with ordinary runtime exit codes, so a setup failure cannot be told from a run that exited 71.

### macos-seatbelt-provider-lane

The deny-default profile plus named read-only holes for the runtime's credential material and install tree, and outbound network for the provider transport.

Available on the probing machine: yes. Deprecated interface. Support status: **BLOCKED**. Policy digest `sha256:3ccff75053a842e25ee2de641853f9e9602f97dfc50fdedb52e336cd1e17aa01`.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A |  |
| `write_inside_workspace` | allowed | none | -- | A |  |
| `read_workspace_parent` | denied | kernel | EPERM | A |  |
| `write_outside_workspace` | denied | kernel | EPERM | A |  |
| `delete_outside_workspace` | denied | kernel | EPERM | A |  |
| `read_operator_home_absolute` | denied | kernel | EPERM | A |  |
| `read_operator_ssh_private_key` | denied | kernel | EPERM | A |  |
| `read_operator_agent_config_absolute` | allowed | none | -- | A | Allowed on purpose and by name. ~/.claude.json, which the profile does not name, stayed EPERM in the same run -- the hole is the named path and nothing more. |
| `read_aos_home_absolute` | denied | kernel | EPERM | A |  |
| `escape_via_symlink` | denied | kernel | EPERM | A |  |
| `spawn_child_process` | allowed | none | -- | A |  |
| `act_outside_boundary_from_descendant` | denied | kernel | EPERM | B | Checked after the parent exited and the orphan was reparented to pid 1: it wrote ORPHAN_STILL_CONFINED. The same probe unconfined wrote ORPHAN_READ_OK. |
| `survive_cleanup_as_detached_descendant` | allowed | none | -- | C | It survives, and it stays inside the boundary while it does. Denying SYS_setsid by name and by number both compiled and neither stopped the child from leading its own session. |
| `open_outbound_network_socket` | allowed | none | -- | A | Allowed on purpose. The same probe under the deny-default profile was EPERM, so the network axis is separately controllable. |
| `read_operator_keychain_item` | allowed | none | -- | D | security exited 0. This is the hole that lets Claude Code authenticate and it also reaches every other item in the login keychain. |
| `authenticate_as_the_operator` | allowed | none | -- | E | Reported: Logged in using ChatGPT, with the operator's real HOME and the filesystem confined by the kernel. |

```text
A  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f provider-lane.sb node probe.mjs
B  cd @WORKSPACE@ && PROBE_BASE=@BASE@ PROBE_OPERATOR_HOME=@OPERATOR_HOME@ sandbox-exec -f provider-lane.sb node leak-and-test.mjs
C  cd @WORKSPACE@ && sandbox-exec -f provider-lane.sb node leak-and-test.mjs; ps -o pid=,pgid=,ppid= -p <descendant>
D  cd @WORKSPACE@ && sandbox-exec -f provider-lane.sb node auth-probe.mjs
E  cd @WORKSPACE@ && sandbox-exec -f provider-lane.sb codex login status
```

Issuance gate: `filesystem_enforced=true  process_enforced=false  setup_verified=true  authenticated_runtime=true  boundary_canary=FAIL  cleanup_verified=false  network_policy=provider-required-unrestricted`

Blocking: `process_enforced`, `boundary_canary`, `cleanup_verified`.

- The process axis is open and cannot be closed by this backend: a detached descendant takes its own session, escapes the process group AOS signals, and is not listed by lib/core.mjs processGroupMembers.
- Granting the Keychain grants the whole login keychain, not one item. A file-scoped credential such as ~/.codex/auth.json can be granted narrowly; a Keychain-backed one cannot.
- Deprecated interface, see the deny-default row.
- Network is allowed wholesale. Provider transport and task-initiated external calls are not distinguishable at this layer, so a claim that rests on that distinction has to be recorded NOT_OBSERVED.

### linux-container-vm

OCI container on a Linux VM reachable from this darwin host (Docker 29.4.0 server, OrbStack kernel 7.0.11), workspace bind-mounted, --network none.

Available on the probing machine: yes. Support status: **BLOCKED**.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | allowed | none | -- | A |  |
| `write_inside_workspace` | allowed | none | -- | A |  |
| `read_workspace_parent` | denied | namespace | ENOENT | A | ENOENT rather than EPERM: the host path is not in the mount namespace at all. |
| `write_outside_workspace` | denied | namespace | ENOENT | A |  |
| `delete_outside_workspace` | denied | namespace | ENOENT | A |  |
| `read_operator_home_absolute` | denied | namespace | ENOENT | A |  |
| `read_operator_ssh_private_key` | denied | namespace | ENOENT | A |  |
| `read_operator_agent_config_absolute` | denied | namespace | ENOENT | A | Denied by default. A read-only bind mount does deliver it: mounted at /root/.codex it parsed, and a write to the same mount returned EROFS. |
| `read_aos_home_absolute` | denied | namespace | ENOENT | A |  |
| `escape_via_symlink` | denied | namespace | ENOENT | A |  |
| `spawn_child_process` | allowed | none | -- | A |  |
| `act_outside_boundary_from_descendant` | denied | namespace | ENOENT | A | The mount namespace is the boundary and every process in it shares the namespace. |
| `survive_cleanup_as_detached_descendant` | denied | namespace | -- | B | The descendant led its own process group inside the container and was gone with it: teardown reaps the PID namespace, not a process group. |
| `open_outbound_network_socket` | denied | namespace | ENETUNREACH | A | Under --network none. The flag is the policy, so provider access is a per-run decision rather than a property of the backend. |
| `read_operator_keychain_item` | denied | namespace | ENOENT | A | There is no macOS Keychain and no /usr/bin/security inside a Linux namespace. |
| `authenticate_as_the_operator` | denied | runtime_absent | -- | C | The operator's installed codex is darwin-arm64 and refused to start: Missing optional dependency @openai/codex-linux-arm64. |

```text
A  docker run --rm --network none -v @WORKSPACE@:@WORKSPACE@ -v @RUNTIME_FILES@:@RUNTIME_FILES@:ro -w @WORKSPACE@ -e PROBE_BASE=@BASE@ -e PROBE_OPERATOR_HOME=@OPERATOR_HOME@ node:22.23.2-bookworm node probe.mjs
B  CID=$(docker run -d --rm --network none node:22.23.2-bookworm node -e '<spawn detached>'); docker stop -t 1 $CID; docker ps -a --filter id=$CID
C  docker run --rm --platform linux/arm64 --network none -v @OPERATOR_HOME@/.local/lib/node_modules/@openai/codex:/codex:ro node:22-bookworm node /codex/bin/codex.js login status
```

Issuance gate: `filesystem_enforced=true  process_enforced=true  setup_verified=true  authenticated_runtime=false  boundary_canary=PASS  cleanup_verified=true  network_policy=disabled`

Blocking: `authenticated_runtime`.

- The boundary holds on every axis. What fails is the runtime: the operator's agent CLI is a darwin binary and does not execute here, so the container would have to carry its own Linux install of the CLI and its own copy of the credential.
- Delivering the credential means placing live auth material inside the namespace the assessed agent writes to. That is a worse posture than a kernel-denied read of a path outside it, and it is the price of this lane.
- The Linux kernel reached from this host is a VM. A result produced here describes the VM, not the operator's macOS machine, and a profile-bound score should say so.
- A macOS Keychain credential cannot be delivered into a Linux namespace at all, so Claude Code has no path into this lane on this host.

### linux-bubblewrap

bwrap(1) unprivileged user-namespace sandbox -- the first Linux backend the issue names.

Nothing was measured here. bwrap is not installed on this darwin host and is not present in the Linux image reached from it. Establishing this lane needs a Linux runner with bubblewrap installed, which this machine cannot provide.

Available on the probing machine: no. Support status: **NOT_OBSERVED**.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | not_observed | -- | -- | -- | -- |
| `write_inside_workspace` | not_observed | -- | -- | -- | -- |
| `read_workspace_parent` | not_observed | -- | -- | -- | -- |
| `write_outside_workspace` | not_observed | -- | -- | -- | -- |
| `delete_outside_workspace` | not_observed | -- | -- | -- | -- |
| `read_operator_home_absolute` | not_observed | -- | -- | -- | -- |
| `read_operator_ssh_private_key` | not_observed | -- | -- | -- | -- |
| `read_operator_agent_config_absolute` | not_observed | -- | -- | -- | -- |
| `read_aos_home_absolute` | not_observed | -- | -- | -- | -- |
| `escape_via_symlink` | not_observed | -- | -- | -- | -- |
| `spawn_child_process` | not_observed | -- | -- | -- | -- |
| `act_outside_boundary_from_descendant` | not_observed | -- | -- | -- | -- |
| `survive_cleanup_as_detached_descendant` | not_observed | -- | -- | -- | -- |
| `open_outbound_network_socket` | not_observed | -- | -- | -- | -- |
| `read_operator_keychain_item` | not_observed | -- | -- | -- | -- |
| `authenticate_as_the_operator` | not_observed | -- | -- | -- | -- |

Issuance gate: `filesystem_enforced=not_observed  process_enforced=not_observed  setup_verified=not_observed  authenticated_runtime=not_observed  boundary_canary=NOT_OBSERVED  cleanup_verified=not_observed  network_policy=not_observed`


- No row here is a claim. The backend was not reachable from the probing machine and nothing about it was measured.

### linux-user-namespace

unshare(1) / setpriv(1) over the kernel's own namespaces -- the second Linux backend the issue names.

Nothing was measured here. The facilities exist -- unshare, nsenter and setpriv are present and the kernel reached from this host exposes cgroup, ipc, mnt, net, pid, time, user and uts namespaces with a seccomp filter already active -- but AOS's host here is darwin, so no confinement probe was run against a Linux host AOS would actually assess on. Availability is not enforcement and is not recorded as one.

Available on the probing machine: yes. Support status: **NOT_OBSERVED**.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | not_observed | -- | -- | -- | -- |
| `write_inside_workspace` | not_observed | -- | -- | -- | -- |
| `read_workspace_parent` | not_observed | -- | -- | -- | -- |
| `write_outside_workspace` | not_observed | -- | -- | -- | -- |
| `delete_outside_workspace` | not_observed | -- | -- | -- | -- |
| `read_operator_home_absolute` | not_observed | -- | -- | -- | -- |
| `read_operator_ssh_private_key` | not_observed | -- | -- | -- | -- |
| `read_operator_agent_config_absolute` | not_observed | -- | -- | -- | -- |
| `read_aos_home_absolute` | not_observed | -- | -- | -- | -- |
| `escape_via_symlink` | not_observed | -- | -- | -- | -- |
| `spawn_child_process` | not_observed | -- | -- | -- | -- |
| `act_outside_boundary_from_descendant` | not_observed | -- | -- | -- | -- |
| `survive_cleanup_as_detached_descendant` | not_observed | -- | -- | -- | -- |
| `open_outbound_network_socket` | not_observed | -- | -- | -- | -- |
| `read_operator_keychain_item` | not_observed | -- | -- | -- | -- |
| `authenticate_as_the_operator` | not_observed | -- | -- | -- | -- |

Issuance gate: `filesystem_enforced=not_observed  process_enforced=not_observed  setup_verified=not_observed  authenticated_runtime=not_observed  boundary_canary=NOT_OBSERVED  cleanup_verified=not_observed  network_policy=not_observed`


- Availability was observed; confinement was not. The two are recorded separately on purpose -- a support table that promotes the first into the second is how an unsupported lane ends up marked OFFICIAL.

### linux-landlock

Landlock LSM path-based filesystem restriction applied by the process to itself.

Nothing was measured here. Not probed. /sys/kernel/security/lsm was unreadable in the Linux kernel reached from this host, so even the ABI's presence is unknown, and Landlock needs a compiled helper that this phase is not permitted to add to the product.

Available on the probing machine: no. Support status: **NOT_OBSERVED**.

| Property | Observed | Enforced by | errno | Cmd | Note |
| --- | --- | --- | --- | --- | --- |
| `read_inside_workspace` | not_observed | -- | -- | -- | -- |
| `write_inside_workspace` | not_observed | -- | -- | -- | -- |
| `read_workspace_parent` | not_observed | -- | -- | -- | -- |
| `write_outside_workspace` | not_observed | -- | -- | -- | -- |
| `delete_outside_workspace` | not_observed | -- | -- | -- | -- |
| `read_operator_home_absolute` | not_observed | -- | -- | -- | -- |
| `read_operator_ssh_private_key` | not_observed | -- | -- | -- | -- |
| `read_operator_agent_config_absolute` | not_observed | -- | -- | -- | -- |
| `read_aos_home_absolute` | not_observed | -- | -- | -- | -- |
| `escape_via_symlink` | not_observed | -- | -- | -- | -- |
| `spawn_child_process` | not_observed | -- | -- | -- | -- |
| `act_outside_boundary_from_descendant` | not_observed | -- | -- | -- | -- |
| `survive_cleanup_as_detached_descendant` | not_observed | -- | -- | -- | -- |
| `open_outbound_network_socket` | not_observed | -- | -- | -- | -- |
| `read_operator_keychain_item` | not_observed | -- | -- | -- | -- |
| `authenticate_as_the_operator` | not_observed | -- | -- | -- | -- |

Issuance gate: `filesystem_enforced=not_observed  process_enforced=not_observed  setup_verified=not_observed  authenticated_runtime=not_observed  boundary_canary=NOT_OBSERVED  cleanup_verified=not_observed  network_policy=not_observed`


- Landlock also has no process-lifetime containment, so on its own it would land where Seatbelt did. It is listed because the issue names it, not because it was measured.

## The two Seatbelt profiles

These are the profiles that produced the macOS rows, with the machine's own paths replaced by the
placeholders above. Their digests are the `policy_digest` values in the matrix, and the test
recomputes both from this file.

```scheme
(version 1)
(deny default)

; Everything the runtime needs in order to exist at all. Node resolves its own binary, the dyld
; shared cache and the system frameworks before a single line of agent code runs, so a profile that
; omits these is not testing confinement, it is testing whether node can start.
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self))
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
; outside the system tree that can be read. Nothing here mentions the operator's home, so every
; path into it -- tilde-relative or absolute -- falls to (deny default).
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
(allow signal (target self))
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
; outside the system tree that can be read. Nothing here mentions the operator's home, so every
; path into it -- tilde-relative or absolute -- falls to (deny default).
(allow file-read* file-write* (subpath "@WORKSPACE@"))

; Provider lane. Exactly what a real agent run needs and nothing beyond it: the runtime's own
; credential material read-only, its install tree read-only, and outbound network for the provider
; transport. Each of these is a named hole in the boundary, which is why they are listed one by one
; rather than covered by a wildcard -- a hole nobody can name is a hole nobody can review.
(allow file-read* (subpath "@OPERATOR_HOME@/.codex"))
(allow file-read* (subpath "@OPERATOR_HOME@/Library/Keychains") (subpath "/Library/Keychains"))
(allow file-write* (subpath "@OPERATOR_HOME@/Library/Keychains"))
(allow file-read* process-exec (subpath "@RUNTIME_CLI_TREE@"))
(allow network-outbound)
(allow network-bind)
(allow system-socket)
(allow ipc-posix-shm)
```

## The probe programs

Each row's command runs one of these. They are printed in full rather than referenced, because the
value of an evidence matrix is that someone else can run it and disagree with the result.

`probe.mjs` -- the filesystem, process and network checks:

```javascript
// Confinement probe. Emits one JSON object on stdout describing what the process it runs as was
// actually able to do. Never prints the content of anything it reads: every credential-adjacent
// check reports a boolean and an errno, so the record can be committed.
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, symlinkSync, openSync, readSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";

const BASE = process.env.PROBE_BASE;
const WORKSPACE = `${BASE}/workspace`;
const results = {};

const attempt = (name, fn) => {
  try {
    const value = fn();
    results[name] = { outcome: "allowed", detail: value === undefined ? null : value };
  } catch (error) {
    results[name] = { outcome: "denied", errno: error?.code ?? null, detail: null };
  }
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
  const path = `${BASE}/outside/deletable-${process.pid}`;
  writeFileSync(path, "x");
  unlinkSync(path);
  return true;
});
attempt("read_operator_home_listing", () => readdirSync(os.homedir()).length > 0);
attempt("read_ssh_directory", () => {
  // Entry count only. The names and contents of the operator's keys are never emitted.
  const entries = readdirSync(`${os.homedir()}/.ssh`);
  return entries.length > 0;
});
attempt("read_ssh_private_key_bytes", () => {
  // Reads the first bytes of any file whose name looks like a private key and reports only whether
  // the read succeeded. No byte of the key leaves this function.
  const dir = `${os.homedir()}/.ssh`;
  const candidate = readdirSync(dir).find((n) => /^id_/.test(n) && !n.endsWith(".pub"));
  if (!candidate) return "no_private_key_present";
  const bytes = readFileSync(`${dir}/${candidate}`);
  return bytes.length > 0;
});
attempt("read_aos_home", () => {
  const aos = process.env.AOS_HOME ?? `${os.homedir()}/.aos`;
  return existsSync(aos) ? readdirSync(aos).length >= 0 : "aos_home_absent";
});
attempt("read_agent_config_codex", () => existsSync(`${os.homedir()}/.codex/auth.json`)
  ? readFileSync(`${os.homedir()}/.codex/auth.json`).length > 0
  : "absent");
attempt("read_agent_config_claude", () => existsSync(`${os.homedir()}/.claude.json`)
  ? readFileSync(`${os.homedir()}/.claude.json`).length > 0
  : "absent");
attempt("spawn_child_process", () => {
  const r = spawnSync("/bin/echo", ["ok"], { encoding: "utf8" });
  if (r.error) throw r.error;
  return r.status === 0;
});
attempt("keychain_query", () => {
  // Queries a service name that does not exist. Exit 44 is "item not found" and proves the security
  // binary ran and reached the keychain; a spawn failure or a different status is recorded as-is.
  // No account, no service of the operator's, and no secret value is passed or printed.
  const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", "aos-confinement-probe-absent"], { encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status };
});
// Deliberately absolute, and read from PROBE_OPERATOR_HOME rather than $HOME. Replacing HOME moves
// where a tilde expands to; it does not move the operator's files. An agent that hardcodes the path
// walks straight past a temp HOME, so this is the check that separates a real boundary from a
// renamed one.
attempt("read_operator_home_absolute", () => {
  const real = process.env.PROBE_OPERATOR_HOME;
  if (!real) return "operator_home_not_supplied";
  return readdirSync(real).length > 0;
});
attempt("read_operator_ssh_absolute", () => {
  const real = process.env.PROBE_OPERATOR_HOME;
  if (!real) return "operator_home_not_supplied";
  return readdirSync(`${real}/.ssh`).length > 0;
});
attempt("read_agent_config_codex_absolute", () => {
  const real = process.env.PROBE_OPERATOR_HOME;
  if (!real) return "operator_home_not_supplied";
  return readFileSync(`${real}/.codex/auth.json`).length > 0;
});
attempt("read_aos_home_absolute", () => {
  const real = process.env.PROBE_OPERATOR_HOME;
  if (!real) return "operator_home_not_supplied";
  return readdirSync(`${real}/.aos`).length >= 0;
});
attempt("symlink_escape", () => {
  // A symlink planted inside the workspace pointing at the parent. Path-prefix checks that resolve
  // the link name rather than its target are defeated here; a kernel-level boundary is not.
  const link = `${WORKSPACE}/escape-${process.pid}`;
  symlinkSync(`${BASE}/parent-canary.txt`, link);
  try {
    return readFileSync(link, "utf8").trim().length;
  } finally {
    try { unlinkSync(link); } catch {}
  }
});
attempt("read_special_device", () => {
  const fd = openSync("/dev/urandom", "r");
  try {
    return readSync(fd, Buffer.alloc(1), 0, 1, null) === 1;
  } finally { closeSync(fd); }
});

attempt("network_tcp_connect", () => "async");

const tcp = () => new Promise((resolve) => {
  const socket = net.connect({ host: "1.1.1.1", port: 443 });
  const done = (outcome, errno) => {
    socket.destroy();
    resolve({ outcome, errno: errno ?? null, detail: null });
  };
  socket.setTimeout(4000);
  socket.once("connect", () => done("allowed"));
  socket.once("timeout", () => done("inconclusive", "ETIMEDOUT"));
  socket.once("error", (error) => done("denied", error?.code ?? null));
});

const dns = () => new Promise((resolve) => {
  const r = spawnSync("/usr/bin/dscacheutil", ["-q", "host", "-a", "name", "api.openai.com"], { encoding: "utf8" });
  if (r.error) return resolve({ outcome: "denied", errno: r.error.code ?? null, detail: null });
  resolve({ outcome: /ip_address/.test(r.stdout ?? "") ? "allowed" : "inconclusive", errno: null, detail: null });
});

results.network_tcp_connect = await tcp();
results.network_dns_resolve = await dns();

process.stdout.write(JSON.stringify({ pid: process.pid, cwd: process.cwd(), results }, null, 2));
```

`auth-probe.mjs` -- the credential checks. Every one of them reports a boolean or an exit status,
and the Keychain query discards the command's output before this process can see it:

```javascript
// Does an agent CLI's authentication survive inside the boundary?
//
// Every check here reports a boolean and, for the keychain, an exit status. No output of any
// credential-bearing command is read, kept or printed: stdio is discarded before this process sees
// it, so the record can be committed without redaction.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const HOME_REAL = process.env.PROBE_OPERATOR_HOME;
const out = {};

const check = (name, fn) => {
  try { out[name] = { outcome: "allowed", detail: fn() }; }
  catch (error) { out[name] = { outcome: "denied", errno: error?.code ?? null, detail: null }; }
};

check("codex_auth_file_readable", () => {
  const bytes = readFileSync(`${HOME_REAL}/.codex/auth.json`);
  // Length and shape only. Parsed so that "readable" means "usable by the runtime", not "the open
  // syscall returned"; the parsed object itself is discarded on this line.
  const keys = Object.keys(JSON.parse(bytes.toString("utf8"))).length;
  return { parsed: true, key_count: keys };
});
check("codex_config_readable", () => existsSync(`${HOME_REAL}/.codex/config.toml`) && readFileSync(`${HOME_REAL}/.codex/config.toml`).length > 0);
check("keychain_real_item_reachable", () => {
  // The service name of the Claude Code credential. stdio is discarded: only the exit status is
  // kept, and 0 means the sandboxed process could have retrieved the secret.
  const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials"], { stdio: "ignore" });
  if (r.error) throw r.error;
  return { status: r.status, reachable: r.status === 0 };
});
check("claude_config_readable", () => readFileSync(`${HOME_REAL}/.claude.json`).length > 0);

process.stdout.write(JSON.stringify(out, null, 2));
```

`probe-descendant.mjs` and `leak-and-test.mjs` -- the two process-boundary checks. The first asks
whether a spawned child inherits the boundary; the second asks whether a detached one outlives the
run and whether it is still confined once it has been reparented to pid 1:

```javascript
import { spawnSync } from "node:child_process";
const r = spawnSync(process.execPath, ["@RUNTIME_FILES@/child-probe.mjs"], { encoding: "utf8" });
process.stdout.write(JSON.stringify({ status: r.status, stdout: r.stdout, error: r.error?.code ?? null }));
```

```javascript
// Leaves behind a descendant that outlives the run and, once orphaned, tries to read a path the
// profile denies. Whether it survives and whether it is still confined are two different questions,
// and only the second one decides how bad a leak is.
import { spawn } from "node:child_process";
const marker = `${process.env.PROBE_BASE}/workspace/leak-result.txt`;
const child = spawn("/bin/sh", ["-c", `sleep 2; if ls ${process.env.PROBE_OPERATOR_HOME}/.ssh > /dev/null 2>&1; then echo ORPHAN_READ_OK > ${marker}; else echo ORPHAN_STILL_CONFINED > ${marker}; fi; sleep 30`], { detached: true, stdio: "ignore" });
child.unref();
process.stdout.write(JSON.stringify({ descendant: child.pid, marker }));
```

## What was deliberately not done

No credential value was read into a variable, printed, or written anywhere. The credential checks
report a boolean and, for the Keychain, an exit status with the command's output discarded before
this process could see it. One probe copied `~/.codex/auth.json` into a temporary directory to
test whether `CODEX_HOME` could redirect the runtime away from the operator's home; the copy was
removed and the question was then answered with an empty directory instead. `CODEX_HOME` is
honoured -- the runtime reported `Not logged in` cleanly rather than erroring -- so the redirect
works, at the cost of placing live credential material inside the directory tree the assessed agent
can write to.

No Linux host was probed. The Linux kernel reachable from this machine is a VM, and a result
produced in it describes the VM. `bwrap` is absent from both. Landlock was not probed at all:
`/sys/kernel/security/lsm` was unreadable, and applying Landlock needs a helper this phase is not
permitted to add.

## What Phase B has to buy

1. **A process boundary that Seatbelt cannot provide.** The cheapest correct fix is to stop
   enumerating by process group. A descendant that calls `setsid` is invisible to
   `processGroupMembers`, and that is true today, with or without this issue -- the current
   `leaked_descendants` observation in `lib/core.mjs` under-reports. Replacing it with an
   enumeration that does not depend on the group is a prerequisite for `cleanup_verified` on any
   macOS backend.
2. **A decision about the Keychain.** A file-scoped credential can be granted by name and nothing
   else; `~/.codex/auth.json` was readable while `~/.claude.json`, which the profile does not
   name, stayed EPERM in the same run. A Keychain-backed credential cannot be granted narrowly:
   allowing Claude Code's item allows the whole login keychain. Either that is accepted and recorded
   as a named limitation on the result, or Claude Code has no STRICT lane on macOS.
3. **A Linux CI runner.** Three of the eight backends here are `not_observed` because this machine
   cannot reach a Linux host AOS would assess on. bubblewrap is the issue's first-choice backend and
   nothing about it has been measured. The coordinator adds the runner; this issue cannot.
4. **A setup-failure channel that is not the exit code.** `sandbox-exec` exits 65 on a profile
   problem and 71 when it cannot exec, and both collide with ordinary runtime exit codes. A boundary
   canary that runs inside the profile before the agent does is the only way to tell a confined run
   from a run that was never confined -- which is exactly the failure the issue forbids.
5. **A replacement for the temp HOME, not an addition to it.** Confinement needs the operator's real
   HOME to be visible for the runtime's credential lookup to work, with the kernel refusing
   everything in it that the profile does not name. Keeping both would produce a run that is
   confined and unauthenticated, which is the deny-default row.
