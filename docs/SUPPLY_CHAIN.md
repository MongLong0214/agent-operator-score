# Supply chain: action pins

Every external GitHub Action this repository runs is pinned to a full commit SHA, and a required
check refuses the alternative.

## Why a tag is not a version

`actions/checkout@v5` is not a version. It is a name, and the owner of that name decides which
commit it means — at any time, retroactively, without a release. A job that says `@v5` while holding
this repository's credentials is a promise to execute whatever the tag points at on the day the job
runs.

Nobody has to compromise this repository for that to go wrong.

```yaml
- uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0   ← allowed
- uses: ./.github/actions/local                                              ← allowed
- uses: actions/checkout@v5                                                  ← refused
- uses: actions/checkout@main                                                ← refused
- uses: actions/checkout@fbc6f39                                             ← refused (short)
- uses: actions/checkout@FBC6F39…                                            ← refused (not lowercase)
```

Forty lowercase hexadecimal characters. Not thirty-nine, not forty-one.

## Four things that make the check real

**Discovery is by shape, not by a list of names.** Everything under `.github/workflows/` that ends
in `.yml` or `.yaml`, and every `action.yml`/`action.yaml` anywhere in the tree. `.git` is the only
directory skipped by name. A release workflow or an admin workflow added next month is scanned
without anyone remembering to add it.

Symlinks are skipped too — the walk descends into real directories and reads real files, and a
symlinked directory or a symlinked `action.yml` is neither. That is a decision rather than an
oversight, and it is safe because it fails closed rather than open: a symlink cannot bridge to
anything unscanned. `uses: ./linked` resolves to a file that is not in the scanned set, so the
reference is reported as unresolved and the check fails. Following symlinks would mean deciding
what to do about a link pointing out of the repository and about a link that points at itself;
refusing to resolve the reference needs neither decision and refuses more.

Skipping `node_modules`, `dist`, `.next` and `coverage` looked like an optimisation and was a hole:
a workflow saying `uses: ./dist` runs `dist/action.yml`, and a composite action there can name any
external action at any mutable tag. Skipping a directory by name is skipping the place someone
would put it.

**A local reference is a redirection, not a free pass.** `uses: ./path` is resolved to the action
file it actually runs, and that file has to be one this scan read. A local reference pointing at
nothing fails. `uses: $/path/to/action` — GitHub's other spelling for an action in this same
repository, resolved against the repository root — is held to the same rule; refusing it as
unreadable was fail-closed but wrong, and a check that fails on valid syntax is one people route
around.

**The spellings of `uses` that GitHub honours are seen.** Every one of these is a real key, and a
scanner matching one of them saw none of the others:

```yaml
- "uses": something@main           # a quoted key
- "\u0075ses": something@main       # the same key, written with an escape
- uses:                            # the value on the following line
    something@main
- { uses: something@main }         # a flow mapping
- &anchor { uses: something@main }  # the same, behind an anchor
```

The escaped one is the reason the key is read as YAML reads it rather than as the characters on the
line. YAML resolves `\uXXXX`, `\xNN` and the ordinary escapes inside a double-quoted key *before* it
is a key, so the bypass runs both ways: `"\u0075ses"` hid a live reference from the scanner, and
`"r\u0075n": |` disguised a block scalar so that the inert text inside it was reported instead.

An alias (`uses: *anchor`) and an expression (`uses: ${{ matrix.action }}`) cannot be resolved by a
scanner and are refusals, not passes. Content inside a block scalar — `run: |` followed by a line
reading `uses: …` — is text a shell prints, and reporting it would be a false positive that teaches
people to ignore this check.

Two things that look like references and are not. A `uses` under a step's `with:` or `env:` is an
input that happens to be called that, and reporting it as a mutable reference was a false positive
on valid YAML — so the scan tracks which key each `uses` sits under. And a file written with CRLF
line endings is read the same as one without; a carriage return left on the value made an ordinary
pinned reference unreadable.

Anything else that looks like a `uses` key and is not one of these spellings still fails. The
context rule narrows what is called a reference; it does not widen what is allowed to pass.

**A line the scanner cannot parse is a failure, not a skip**, and so is a directory it cannot read.
A scanner that shrugs at what it does not understand reports green on the one line that was written
to be misunderstood.

## Container actions

`docker://ghcr.io/someone/thing:latest` is external code on a runner holding this repository's
credentials, and `:latest` is a tag like any other. Container references are pinned by digest —
`docker://image@sha256:<64 hex>` — or they fail, and the image must be in the reviewed list.

## The pin needs a readable version

```yaml
- uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
```

Without the comment, a reviewer looking at a refreshed pin sees forty hex characters change into
forty different hex characters and cannot tell whether it moved from v5.0.0 to v5.0.1 or to
something else entirely. The comment must *look* like a version — `# definitely v99, trust me` is a
comment, not something anyone can check.

The allowlist is per action, not per owner. `actions` being reviewed says nothing about a repository
under that owner nobody has ever looked at.

## Updates arrive as proposals

Dependabot opens a pull request weekly with the old SHA, the new SHA and the release it corresponds
to. Nothing merges it automatically. A pin refresh is a proposal to run different code in CI with
this repository's credentials, which is precisely the decision the pinning exists to make
deliberate.

## Permissions

`least privilege` is not a property a scanner can decide — whether a job needs `contents: write`
depends on what the job is for. What a scanner can decide is whether the permissions *changed*.

So `governance/action-pin-policy.json` records the permissions of every workflow, and the check
fails when the file and the workflow disagree. Widening a permission then requires editing the
baseline in the same change, which is visible in review. The failure this watches for is a pin
refresh that quietly arrives with `contents: write` attached.

A workflow with no top-level `permissions:` fails: it would inherit the repository default, which is
not a decision anyone made in that file.

## The command

```bash
npm run verify:action-pins          # required in CI, and every other job waits for it
npm run verify:action-pins --json   # the pin table and the digests
```

Two digests. `workflow_digest` covers every scanned file by content. `supply_chain_digest` also
covers the policy — the reviewed list and the permission baseline — this scanner's own bytes,
`scripts/verify-action-pins.mjs`, and the `scripts` block of `package.json`. Each of those decides
the outcome while leaving the workflows untouched: a change to `reviewed_actions` changes what
passes, `ok: pins.ok && permissions.ok` in the verifier is one edit away from `ok: true`, and the
npm script decides which file `npm run verify:action-pins` runs at all. `supply_chain_digest` is the
one release provenance should quote.

It is a digest of what this repository decides, not of the environment the check runs in. Node
itself, the runner image and the actions the gate job checks out are outside it.

## What this does not do

**It is a merge gate, not an execution-prevention control.** The `action-pins` job runs first and
every other job in `ci.yml` waits for it, and none of them opts out of waiting — a test asserts
both, because `needs:` alone does not prove the second. GitHub documents `always()` as overriding
the skip a failed dependency causes, so `needs: action-pins` with `if: always()` names the gate and
runs after it goes red anyway. A job in a *separate* workflow cannot name it at all: there is no
cross-workflow `needs`.

So the ordering claim is bounded: an unpinned reference added to another job *in this workflow*
does not execute. It is not a statement about the repository. The workflow also runs from the pull
request's own head: anyone who can push a branch here can also edit `ci.yml`, and there is no way
for a file to prevent that from inside the repository. Branch protection and required checks are
configured on the repository, not established by this branch. #569 owns that.

**The permission baseline detects change, not privilege.** It cannot tell you that `contents: write`
is unnecessary — only that nobody wrote it down. And the baseline sits in the same pull request as
the workflow, so widening a permission is a *visible diff* rather than a code-enforced gate.
Reviewing that diff is a person's job; what this removes is the possibility of it being invisible.

**The version comment is not verified against the upstream release.** Nothing here confirms that
`fbc6f39…` really is what `v5.1.0` tagged. A reviewer or Dependabot establishes that; this check
establishes that a claim was made in a checkable form.
