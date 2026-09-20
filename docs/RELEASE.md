# Releasing: promoting `dev` to the stable channel

`main` is the stable channel — the repository's default branch, the source a clone gets, the
commit a tag names, and what a plugin or install manifest describes. `dev` is where work
integrates. The whole point of separating them is that somebody cloning this repository should not
receive whatever was merged an hour ago.

This document is the procedure. `npm run verify:release-channel` is the part of it a machine can
check, and it refuses rather than warns.

## What must be true first

Every gate, not most of them. `near-green` is not a promotion condition, and the reason that
sentence is here rather than assumed is that every release that shipped something unfinished had a
plausible story about why the last gate did not count.

| gate | what it covers | issues |
|---|---|---|
| X | execution governance — the machine-readable DAG and state audit | #588 |
| S | security — confinement, isolation, and at least one real STRICT lane | #553 #554 #555 #556 #557 |
| C | construct and process — the ECD contract and its scoring | #582 #559 #560 #558 #583 |
| G | profile and generalizability integrity | #561 #564 #584 #585 #568 #586 #562 #563 |
| E/Q/U | evidence, quality and UX | #566 #567 #565 #574 #575 #576 |

`GENERALIZABILITY UNESTABLISHED` is an honest non-claiming state and does not block a release. What
must pass is the withholding and forbidden-use contract that keeps it honest.

    npm run verify:release-channel          # against the committed fixture
    npm run verify:release-channel:live     # against the repository, needs gh auth

The gate matrix is computed from `governance/v0.2.0-execution-plan.json`, not from a list kept
beside it. A hand-kept list drifts from the plan and then the release is gated on the drift.

## The procedure

1. Re-read the latest `dev`, its open pull requests, branch protection and the release-candidate
   CI. Do not work from what was true yesterday.
2. Cut the release branch from the exact approved `dev` SHA.
3. Run the release-channel verifier and the version, projection and static scans.
4. Open the release pull request against protected `main`.
5. Merge it through the required checks and review. Do not bypass them, and do not temporarily
   relax protection to get a merge through — the evidence that protection was enforced is part of
   what a release claims.
6. Change the repository default branch to `main`. **Not before this point**: a default branch
   pointing at a `main` that does not yet carry stable content is worse than one pointing at `dev`,
   because it looks finished.
7. Create the tag, assets and provenance from the exact `main` SHA (#571).
8. Run the stable plugin, clone and install canary.
9. Back-merge `main` into `dev` and verify containment.
10. Remove the temporary release branch after its evidence is preserved.

## Protection is read, never assumed

Both `main` and `dev` must actually enforce required checks, no force push and no deletion. The
verifier asks the API what is enforced and decides from that. It does not ask whether a particular
GitHub feature is switched on, because classic branch protection and a ruleset answer the same
three questions differently and a check written against one name reports nothing about the other.

## What a stable release may claim

    PROFILE_BOUND is the maximum default claim
    GENERALIZABILITY UNESTABLISHED where the evidence is absent
    no ability band, rank or certification
    Composite is secondary

A new result's ability band is `null`. That is not a placeholder to be filled in later; it is the
claim this instrument does not make.

## What will refuse a promotion

Each of these is a check, not a convention:

- any gate issue not `done` in the execution plan
- a default branch that is not `main`
- `main` or `dev` without observed enforcement of the three protections
- a tag unreachable from `main`, or whose release targets a different commit, or whose tree differs
  from `main`'s
- any surface whose stated version differs from the tag
- a dev-only marker present in the stable tree
- `dev` not containing `main` after the back-merge

## Rollback

A promotion that has to be undone is undone by releasing again from a corrected `main`, never by
force-pushing `main` into shape. The protections above forbid the force push, and that is the
intended answer rather than an obstacle to work around: a stable channel whose history can be
rewritten is not one a clone can trust.
