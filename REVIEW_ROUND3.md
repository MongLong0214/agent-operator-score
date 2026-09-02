
The reasoning is correct only when the reference itself is detected.

For:

```text
aliased/action.yml -> ../real/action.yml
uses: ./aliased
```

`localActionFile()` returns the lexical path `aliased/action.yml`, while the scanned set contains `real/action.yml`; [the comparison](/private/tmp/rv-590b/lib/action-pins.mjs:325) fails with “the action it runs was not scanned.” The same applies to a symlinked directory.

A symlink alone does not cause failure; an unreferenced symlink is silently skipped. Also, [the test](/private/tmp/rv-590b/tests/product/action-pins.test.mjs:721) creates both kinds of symlink but references only the directory symlink, so its title overstates what it proves.

3. `$/path`

The classification is correct for GitHub.com. `$/` resolves to the repository containing the workflow or composite action at the running commit, requires no checkout, and cannot include `@ref`; it is unavailable on GitHub Enterprise Server. [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

For a `$/` encountered in this repository’s scanned files, requiring its `action.yml` to belong to the scanned set is appropriate. The documentation should ideally say “same repository at the running commit,” rather than merely “against the repository root.”

4. Supply-chain digest

The two ROUND2 omissions are covered at [lib/action-pins.mjs:380](/private/tmp/rv-590b/lib/action-pins.mjs:380), but repository-level `.npmrc` still decides whether the verifier runs and is not covered:

```ini
script-shell=/usr/bin/true
```

The CI’s `npm run verify:action-pins` then exits zero without executing Node. I confirmed the equivalent `npm --script-shell=/usr/bin/true run verify:action-pins` exits successfully with no verifier output. npm explicitly documents that project `.npmrc` configures `script-shell`. [npm configuration](https://docs.npmjs.com/cli/using-npm/config/)

This also disproves the repository-decision coverage claim at [docs/SUPPLY_CHAIN.md:135](/private/tmp/rv-590b/docs/SUPPLY_CHAIN.md:135). Directly invoking `node scripts/verify-action-pins.mjs` in CI would remove this bypass.

5. Gate predicate

The predicate at [tests/product/action-pins.test.mjs:497](/private/tmp/rv-590b/tests/product/action-pins.test.mjs:497) is not correct:

```yaml
debug:
  needs: action-pins
  if: ${{ !success() }}
```

It does not match the regex, but `success()` is itself a status-check function, so GitHub does not add the implicit `success()` condition; after the gate fails, `!success()` is true and the job runs. [GitHub status-check semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)

`Always()` also bypasses the case-sensitive regex because GitHub’s expression-function lookup is case-insensitive. A folded `if: >-\n  always()` bypasses the subset parser as well.

6. Mutation guards

All 18 entries naming `lib/action-pins.mjs` are load-bearing by direct substitution trace, and their guard names/reasons now match their mutations. The manifest itself is clean.

7. Remaining test/document overclaims

- [“discovery … skips only .git”](/private/tmp/rv-590b/tests/product/action-pins.test.mjs:157) is literally false because symlinks are skipped, and it asserts discovery of nested workflow files GitHub does not run.
- [The symlink test](/private/tmp/rv-590b/tests/product/action-pins.test.mjs:721) does not reference the symlinked `action.yml`.
- [The gate test](/private/tmp/rv-590b/tests/product/action-pins.test.mjs:492) claims no job opts out, but accepts `!success()`, `Always()`, and folded conditions.
- [The policy-digest test](/private/tmp/rv-590b/tests/product/action-pins.test.mjs:481) changes only `reviewed_actions`, not the permission baseline or version pattern named by its broader claim.
- [The scanner fail-closed claim](/private/tmp/rv-590b/docs/SUPPLY_CHAIN.md:81), [permission-drift claim](/private/tmp/rv-590b/docs/SUPPLY_CHAIN.md:120), [digest claim](/private/tmp/rv-590b/docs/SUPPLY_CHAIN.md:135), and [ordering claim](/private/tmp/rv-590b/docs/SUPPLY_CHAIN.md:148) are all disproved by the concrete inputs above.
- The permission audit has its own escaped/quoted-key bypass: a job-level `"permissions": { contents: write }` is accepted by `actionlint`, but [parseYamlSubset](/private/tmp/rv-590b/lib/action-pins.mjs:466) retains the quotes, so [auditPermissions](/private/tmp/rv-590b/lib/action-pins.mjs:508) observes no job permission and the `{ jobs: {} }` baseline still matches.

The block-scalar sibling and folded-key examples alone are sufficient merge blockers. This is not ready to merge.

[exited with code 0]
