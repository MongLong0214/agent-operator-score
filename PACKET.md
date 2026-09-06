Issue #585. Read it in full first: `gh issue view 585`. It is the specification. Branch `task/issue-585` is checked out here, based on dev at 472fd72. PR targets `dev`.

## Operating constraints — these cost real time when ignored, every one of them today

- **Do NOT rebase this branch.** Merge `dev` in if you need it. A rebase makes the sealed review head
  unreachable and voids the merge gate; it cost a full round-1 restart today.
- **Commit after each item**, not at the end. Two agents lost work today by batching.
- **Run verification in the FOREGROUND** with an explicit `timeout` (the Bash tool allows up to
  600000 ms). Every agent that "went background to avoid the 120s window" today stopped reporting and
  left jobs running that corrupted someone else's run.
- **Do NOT run `npm run test:mutation`.** The orchestrator runs it. Two concurrent mutation runs
  corrupt each other — one died at 798/838 that way today. Verify the manifest instead with
  `node --test tests/product/mutation-manifest.test.mjs`.
- If a mutation run refreshes `tests/mutation/measured.json`, it must be committed — pushing code
  without its refreshed ledger failed CI twice today.
- Report numbers you read off the terminal. Round 1 re-derives every number independently and has
  caught, in this repository, a metric that counted seeds while named for branches, a counter that
  could not be non-zero, a self-declared denominator, five rounds of guards attached to a function
  production never called, and a test that passed for a reason unrelated to its name.

## The one structural requirement

Anchor on the real issuance/consumption entry point and design backward from it. Exporting a new
module is not enough: on #638 five rounds of withholding logic lived in `gradeScenario` while the
published observations came from `observeRun`, which took no binding argument at all. Before writing
code, name the counterfactual at that entry point — remove or mismatch the prerequisite and say the
exact public consequence. Verification must re-derive the decision from the evidence, never read a
stored verdict.

Also: whatever paths you end up owning, check them against the issue's `owned_paths` in
`governance/v0.2.0-execution-plan.json`. If the design puts the work somewhere else, say so — a plan
that names a file nobody created blocks the issue's close evidence, which happened on #584 today.

## Defect classes this repository actually produces — self-check against each by name

absence scored as a value; a stored artifact that authorizes itself; a three-state answer collapsing
into a boolean or an exit code (use `lib/decision.mjs`, do not invent a new representation); a field
moving without a new schema id; a claim stronger than its test; a test that cannot fail; a test
rewritten to match a regression; a guard witnessed against a path production does not take.

If a required property genuinely cannot be established, say so and leave the field null with a
reason. An honest null is the correct output here and is release-permitted: this release ships
PROFILE_BOUND with generalizability UNESTABLISHED.

Commit trailer: X-Claude-Session: https://claude.ai/code/session_013aLmTzMn9yj9FD7MjrjgxH
Never write a close/fix/resolve keyword next to an issue number unless the PR genuinely completes it
— GitHub's parser ignores negation. When it does complete it, the PR BODY must say `Closes #N`, or
the live audit cannot confirm the linkage.
Do not merge, do not close, do not run any review script.
