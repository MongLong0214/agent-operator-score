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

## Two things that make the check real

**Discovery is by shape, not by a list of names.** Everything under `.github/workflows/` that ends
in `.yml` or `.yaml`, and every `action.yml`/`action.yaml` anywhere in the tree. A release workflow
or an admin workflow added next month is scanned without anyone remembering to add it. Naming the
files would put exactly the two highest-permission workflows outside the check by default.

**A line the scanner cannot parse is a failure, not a skip.** A scanner that shrugs at what it does
not understand reports green on the one line that was written to be misunderstood.

## The pin needs a readable version

```yaml
- uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
```

Without the comment, a reviewer looking at a refreshed pin sees forty hex characters change into
forty different hex characters and cannot tell whether it moved from v5.0.0 to v5.0.1 or to
something else entirely. The comment is required, and so is a reviewed owner: a pinned commit from
an owner nobody looked at is still code nobody looked at.

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
npm run verify:action-pins          # required in CI
npm run verify:action-pins --json   # the pin table and the workflow digest
```

The workflow digest covers every scanned file by content, so the pin table and the digest can go
into release provenance and mean something.
