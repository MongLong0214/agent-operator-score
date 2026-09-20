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
nothing fails. `uses: $/path/to/action` — GitHub's other spelling for an action in the *same
repository at the running commit*, which needs no checkout step and cannot carry an `@ref` — is
held to the same rule; refusing it as unreadable was fail-closed but wrong, and a check that fails
on valid syntax is one people route around. (It is a GitHub.com syntax; GitHub Enterprise Server
does not have it.)

**The workflow is parsed, not pattern-matched.** This began as a line-and-indentation scan, and
three independent reviews found three ways past it. Every one was valid YAML that `actionlint`
accepts and GitHub runs:

```yaml
- "\u0075ses": attacker/evil@main   # an escaped key. YAML resolves the escape before the key is a
                                  # key, so matching the characters matches something YAML has
                                  # stopped calling that key — and "r\u0075n": | hid a block
                                  # scalar the same way, in the other direction

- if: |                           # a block scalar on a dashed line. Its siblings are two columns
    github.event_name == 'push'   # inside the dash, so a block measured from the line swallowed
  uses: attacker/evil@main        # the reference sitting next to it

- ? >-                            # an explicit key, written as a folded scalar. Nothing that reads
    uses                          # one line at a time can see this at all
  : attacker/evil@main
```

Each fix was right and the next spelling was one nobody had thought of. That is the argument for
what is here now: a reader that resolves the structure — keys are the keys YAML resolves, a block
scalar ends where YAML ends it, an explicit key is a key — rather than a pattern that has to
anticipate how somebody will write a mapping. Quoted keys, escaped keys, continued values, flow
mappings, anchors, aliases and folded scalars are all simply read.

An alias is the node it names, and `<<: *defaults` brings its keys with it. That one is not from a
review: it came from reading this reader against an established one on a corpus of workflow-shaped
documents, and an alias that resolved to nothing meant a mapping's inherited keys silently vanished
— which is where a step's action reference and a job's permissions can both live. Answering wrongly
is worse than refusing.

It is not a complete YAML implementation and does not try to be. It covers what a workflow is
written in and **refuses the rest by name** — a tag, a second document, a tab used as indentation —
and a refusal fails the check. "I could not read this file" and "this file is clean" are the two
answers that must never look the same.

An alias (`uses: *anchor`) and an expression (`uses: ${{ matrix.action }}`) name something this
check cannot resolve offline, so they are refusals rather than passes. Content inside a block
scalar — `run: |` followed by a line reading `uses: …` — is text a shell prints, and reporting it
would be a false positive that teaches people to ignore this check. A `uses` under a step's `with:`
or `env:` is an input that happens to be called that, and is not a reference either. The context
rule narrows what counts as a reference; it does not widen what is allowed to pass.

**A file the reader cannot read is a failure, not a skip**, and so is a directory it cannot read.
A check that shrugs at what it does not understand reports green on the one file that was written
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
fails when the file and the workflow disagree. The audit reads the same parsed document as the pin
scan, which is what makes that comparison mean anything: a job-level `"permissions"` in quotes is
the same key as `permissions`, and while the audit read the characters instead of the key it
observed no job permissions at all and matched a baseline that recorded none. Widening a permission then requires editing the
baseline in the same change, which is visible in review. The failure this watches for is a pin
refresh that quietly arrives with `contents: write` attached.

A workflow with no top-level `permissions:` fails: it would inherit the repository default, which is
not a decision anyone made in that file.

## The command

```bash
node scripts/verify-action-pins.mjs          # what CI runs, and every other job waits for it
node scripts/verify-action-pins.mjs --json   # the pin table and the digests
npm run verify:action-pins                   # the same thing, for a person at a terminal
```

CI invokes node directly rather than through npm. A repository-level `.npmrc` saying
`script-shell=/usr/bin/true` makes every `npm run` exit zero without executing anything, and this
is the one job whose exit status is the entire point.

Two digests. `workflow_digest` covers every scanned file by content. `supply_chain_digest` also
covers the policy — the reviewed list, the permission baseline and the version-comment pattern —
this scanner's own bytes, `scripts/verify-action-pins.mjs`, the `scripts` block of `package.json`,
and `.npmrc` (including its absence). Each of those decides the outcome while leaving the workflows
untouched: a change to `reviewed_actions` changes what passes, `ok: pins.ok && permissions.ok` in
the verifier is one edit away from `ok: true`, the npm script decides which file
`npm run verify:action-pins` runs, and an `.npmrc` decides whether it runs anything at all.
`supply_chain_digest` is the one release provenance should quote.

It is a digest of what this repository decides, not of everything that could change the answer.
Node itself, the runner image, the actions the gate job checks out and the workflow file that
invokes the check are outside it — the last of those because `ci.yml` is scanned content, and the
job that reads it is the job an editor of `ci.yml` could remove.

## What this does not do

**It is a merge gate, not an execution-prevention control.** The `action-pins` job runs first and
every other job in `ci.yml` waits for it, and none of them opts out of waiting — a test asserts
both, because `needs:` alone does not prove the second. GitHub adds the implicit `success()` that
makes a job skip after a failed dependency *only* when the condition names no status-check function
of its own, so all of `if: always()`, `if: Always()` — the lookup is case-insensitive — and
`if: ${{ !success() }}` name the gate and then run after it goes red, and a folded condition is the
same condition written over two lines. The test rejects any status-check function, in any case,
however the condition is written. A job in a *separate* workflow cannot name the gate at all: there
is no cross-workflow `needs`.

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

# Release artifacts (#571)

Everything above is about the pipeline that builds this repository. This section is about the one
thing that pipeline eventually produces: the tarball a stranger downloads, and the two records that
say what is in it and where it came from. `.npmignore` behaving as expected is not a contract; it is
a default that silently changes when a dependency, a config file or an editor adds a new dotfile.
`lib/release-artifacts.mjs` is the contract, `scripts/build-release.mjs` is what runs it, and neither
publishes anything — this is the producing and verifying half of a release, not the shipping half.

## What the script does, and does not do

    node scripts/build-release.mjs                       # builds this repository's own package
    node scripts/build-release.mjs --json                # the same, machine-readable
    node scripts/build-release.mjs --out <dir>            # writes all five release assets there
    node scripts/build-release.mjs --sbom <path>          # binds an SBOM produced elsewhere instead

It runs `npm pack --dry-run --json` first and hands the file list straight to `packageBoundary` —
the same allow/deny contract `tests/product/release-artifacts.test.mjs` measures against a real pack
of this repository, not against invented paths. Any finding there — a forbidden file, a path outside
the allowlist, an escaping or non-regular entry — refuses the release before anything is written to
disk. Only once the package, the version surfaces (`package.json`, the plugin manifest, the
marketplace listing, the release tag) and the five commit identities (`sourceAuthority`) all agree
does it run a real `npm pack`, hash the tarball it produced, and write the four files that go
beside it: an `aos-agent-install.v2` install manifest, an `aos-release-provenance.v2` provenance
record, a CycloneDX SBOM, and `SHA256SUMS` over all four. All three refusal checks report every reason at once, for the same reason `packageBoundary`
itself does — a release that only ever hears about the first defect turns fixing it into a search
for the next one.

The SBOM is generated from the lockfile rather than by a generator dependency: adding a third-party
tool to the build in order to describe the build's third-party surface is a trade this repository
should not make silently. It describes the *artifact*, so it lists the tarball's runtime dependencies
and excludes devDependencies, which are not in it — this package currently ships none at all, so
`components` is legitimately empty, and an empty list is a statement rather than a gap. `SHA256SUMS`
is written last, in plain `shasum -c` format, because it hashes the other four; until it existed the
install manifest's `checksums_url` named a file nothing wrote.

**It does not tag, publish or open a GitHub release.** Attaching these five files to an actual
release, pushing the tag, and running `npm publish` (which this `private: true` package refuses
regardless) are later, separate, human steps — the same split `docs/RELEASE.md` already describes
between cutting a release branch and merging it through required checks.

## What `core_digest` is, and is not, a promise about

`buildProvenance` excludes `built_at` from `core_digest` on purpose: two builds of the same source
must not disagree only because the clock moved. What it does *not* exclude is
`install_manifest_digest`, and that digest is not clock-free — `buildInstallManifest`'s own digest
covers `generated_at`, because an install manifest is a consumer-facing artifact whose whole job is
letting an installer verify it received the exact bytes it was pointed at, timestamp included. So
`core_digest` will differ between two independent runs of `build-release.mjs` against the identical
commit, even though `package_sha256` and `package_file_manifest_digest` — the fields that actually
describe the shipped content — will not. Measured, not assumed: packing this repository twice a
second apart produces the same tarball byte for byte (`npm`'s own pack step is deterministic given
identical input), and two runs of `build-release.mjs` against it produce the same `package_sha256`
and a different `core_digest`, because each run mints its own install manifest instance. That is the
correct reading, not a bug to route around: a provenance record vouches for *the specific install
manifest it was generated alongside*, and two runs genuinely produce two different manifest
instances, however identical their content. A reproducibility check across rebuilds compares
`package_sha256` and `package_file_manifest_digest`, not `core_digest`.

## The five verify scripts

    npm run verify:release-assets          # the full pipeline, against this repository's own package
    npm run verify:stable-install-manifest # an install manifest's digest covers everything but itself
    npm run verify:package-boundary        # the allow/deny contract, against a real pack and by hand
    npm run verify:release-provenance      # the provenance core is reproducible and excludes built_at
    npm run verify:version-consistency     # every surface that states a version is compared, by name

Each selects real tests in `tests/product/release-artifacts.test.mjs` and
`tests/product/build-release.test.mjs` by name — `tests/product/verification-scripts.test.mjs`
refuses a verify script whose pattern selects nothing, which is what keeps this list from silently
drifting into five names that all happen to run the same one test.
