# Contributing to Agent Operator Score

AOS runs from a clone. There is no published package, and the score it produces is
`EXPERIMENTAL / PROVISIONAL` and bound to the environment it was produced in. Nothing here is a
validated assessment of anybody's ability, and a contribution should not make it read like one.

## The shape of the code

Plain ESM JavaScript, no build step, no runtime dependencies. Tests are `node --test`.

```bash
npm ci
npm test
```

Node `>=22.18 <25`, macOS or Linux.

```text
bin/aos.mjs     the command
lib/            the product: review, suite, scorer, runner, storage, report
tests/product/  the tests
fixtures/       scoring vectors and scenario corpora
docs/           what the product claims and does not claim
```

## What a change has to carry

A rule that reports a defect has to be measured against real sessions, not only against a fixture
written beside it. Every rule in `lib/review.mjs` that fires today was tuned by running the
reviewer over forty real transcripts and checking what it said, and several of them were wrong in
ways no unit test could have shown: a rule reporting the repository's own test fixtures as leaked
credentials, a shell parser reading JavaScript arrow functions as file writes, a verification check
satisfied by `echo "npm test"`.

So: run `node bin/aos.mjs review --since 40` before and after, and say in the commit what moved.

Guards are load-bearing or they are not there. If deleting a condition does not turn a test red,
either the test is checking the wrong thing or the condition is not doing anything — both are worth
finding out before the change lands.

## What the product may not say

Do not describe AOS as calibrated, certified, hiring-suitable, ranked, an industry standard, or
environment-independent. A score is PROFILE-BOUND. Imported sessions are DIAGNOSTIC ONLY.

## Branches

git flow, and the two long-lived branches mean what the model says they mean.

| branch | holds | receives from | protected |
|---|---|---|---|
| `main` | released versions, tagged | `release/*`, `hotfix/*` | yes |
| `dev` | the integration line, and the default branch | `feature/*`, and a back-merge from `main` | yes |

Short-lived branches are named for what they are, and there is only one change on each:

```text
feature/<what-it-does>     off dev  -> dev
release/<version>          off dev  -> main and dev, tagged on main
hotfix/<what-it-fixes>     off main -> main and dev, tagged on main
docs/<what-it-documents>   off dev  -> dev
```

Two rules earn their place by having been broken:

**A release goes back to `dev`.** v0.1.0 went to `main` and stopped there, so the default branch --
the page every visitor lands on -- showed the product as it was before the release for as long as
that took to notice. A `release/*` or `hotfix/*` is not finished until `dev` has it too.

**Protection names checks that exist.** `dev` required `test (22)` and `test (24)`. The CI matrix
grew a platform axis, the jobs became `test (ubuntu-latest, node 22)` and the two old contexts
could never report again, so every pull request into `dev` would have waited on them forever.
Renaming a CI job means updating both branches' required checks in the same change.

Branches are deleted when their pull request merges. Everything before v0.1.0 is a separate line
that forked on 2026-08-05 and was deliberately stripped from the product; those branches are kept
as history and are not part of this model.

## License and sign-off

MIT outbound. [LICENSE](LICENSE) carries the standard MIT grant: a redistribution permission, not
contributor terms and not a publication clearance.

Inbound contributions are accepted under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/), on the same MIT terms.
There is no contributor license agreement, no copyright assignment, and no separate paperwork.

Certify each commit with a sign-off line naming you:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it. It means you wrote the contribution or otherwise have the right to submit
it under MIT, and that the contribution and the sign-off are public and permanent.
