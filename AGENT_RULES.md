# Coordinator rules — AOS v0.2.0 Batch 0 (read this first)

You implement **exactly one issue**. A coordinator owns dependency order, hot-file ownership,
schema integration, PR order, release and evidence. You do not.

## Your workspace

Your git worktree and branch are already created and checked out. Work **only** there.
Never `cd` into `/Users/isaac/projects/agent-operator-score` — another agent is using it.

## The repository

`MongLong0214/agent-operator-score`. A local assessment instrument that scores how well a human
operates AI coding agents. Node ESM, **zero runtime dependencies — this is a hard product
constraint**, never add one. Tests are `node --test`. Style: plain modules in `lib/`, thin `bin/`,
prose comments that explain *why* a guard exists and what went wrong without it — read two or three
existing files in `lib/` before you write anything and match them. Comments explain reasoning, not
mechanics. No emoji, no marketing language, no "TODO".

Run the suite as `LANG=en_US.UTF-8 npm test`. (A known pre-existing test reads the ambient locale;
#555 owns that fix. Do not fix it unless you are #555.)

## Hot-file ownership — do not touch another issue's surface

**Never edit** any of these; they belong to the coordinator or another agent:

```
.github/workflows/**          governance/**            schemas/**
fixtures/execution-plan/**    lib/execution-plan.mjs   lib/github-state.mjs
lib/action-pins.mjs           scripts/**               docs/V0.2.0_EXECUTION_GOVERNANCE.md
```

If your issue needs a CI job, say so in your final report and the coordinator adds it.

**You may edit**: the `lib/` files your issue owns, your own test files, `docs/` files you create,
`package.json` (to add one npm script if your issue's contract names one), and
`tests/mutation/manifest.mjs` — insert your guards immediately after `export const GUARDS = [`.
Conflicts there are expected and the coordinator resolves them.

**Never** weaken, delete or skip an existing test to make yours pass. If an existing test genuinely
encodes the wrong behaviour, say so in your report and leave it.

## The protocol, in order

1. **Re-measure.** Read the issue contract, then read the code it is about. Establish what is
   already implemented and what is actually missing. Do not re-implement what exists.
2. **RED.** Write named failing tests that reproduce the defect the issue describes. Run them and
   confirm they fail for the right reason before writing any implementation.
3. **Minimum correct architecture.** Only what the issue owns. Follow existing repository patterns.
   No speculative abstraction.
4. **Positive / negative / counterfactual tests.** The negative cases are the point: every attack
   or malformed input the issue names must have a test proving it fails closed.
5. **Mutation guards.** Add entries to `tests/mutation/manifest.mjs` for each load-bearing guard you
   introduce: `{guard, reason, file, from, to, test, name}`. The `from` string must appear **exactly
   once** in its file, and `name` must be a real test in the named file. Verify with
   `node --test tests/product/mutation-manifest.test.mjs`. Do **not** run `npm run test:mutation`
   (it takes many minutes and CI runs it).
6. **Verify.** `LANG=en_US.UTF-8 npm test` must be fully green, plus `npm run verify:mvp` and
   `npm run smoke:package`.
7. **Commit.** Conventional commit. The repo's commit-msg hook rejects a `Claude-Session:` trailer —
   use `X-Claude-Session: https://claude.ai/code/session_013aLmTzMn9yj9FD7MjrjgxH` instead.
   Body: what was broken, why this fixes it, what is now load-bearing.
8. **Push and open a PR to `dev`** with `gh pr create --repo MongLong0214/agent-operator-score
   --base dev`. The body must contain, with real values:

   ```
   Closes #N
   Problem reproduced / Architecture / Changed files
   Security or measurement effect
   Positive, negative and counterfactual tests
   Mutation
   Live or platform canary (or why none applies)
   Migration and compatibility
   Known limitation
   Final verdict: PASS | HOLD
   ```

9. **DO NOT MERGE.** The coordinator runs an independent adversarial review before any merge.
   Do not close the issue. Do not touch labels or milestones.

## HOLD rather than fake it

If the issue cannot be honestly completed — a platform capability is absent, a contract conflicts
with another issue, you cannot verify something the issue requires — then do the bounded safe work,
record the reproduction, and report **HOLD** with exactly what blocked you. A green test over a
weakened assertion is worse than a HOLD. Missing evidence is never a PASS.

## Your final report to the coordinator

Keep it under 60 lines. Include: branch, PR number and URL, what was actually broken (with file and
line), what you built, the named negative tests, the mutation guards added, anything you had to
leave alone, any file you touched outside your own surface, and `Final verdict: PASS | HOLD`.
