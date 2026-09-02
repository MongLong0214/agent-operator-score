There are also several fail-closed parsing errors:

- CRLF input leaves `\r` on each line, causing an ordinary pinned `uses:` at [lib/action-pins.mjs:130](/private/tmp/review-570b/lib/action-pins.mjs:130) to be reported as `unrecognised`.
- Context is ignored. A valid non-action input such as:

  ```yaml
  with:
    uses: harmless-input
  ```

  or `env: { uses: harmless }` is classified as an action reference.
- A version comment following a flow mapping is discarded:

  ```yaml
  - { uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 } # v5.1.0
  ```

  It reaches the scanner with `comment: null`.
- The block-scalar fix can itself be evaded with a valid escaped key:

  ```yaml
  - "r\u0075n": |
      uses: inert/text@main
  ```

  `actionlint` accepts this as `run: |`, while the scanner falsely reports the inert text.
- Job-level reusable workflows are recognized and classified correctly; GitHub documents them as `jobs.<id>.uses` with the same SHA recommendation. [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- Tabs used for indentation are invalid YAML, so that case is not a missed valid workflow.

2. I found no symlink, `../`, or case-insensitive-filesystem bridge that passes. Escaped paths cannot enter the `scanned` set; symlink entries are not traversed and therefore fail the scanned-target comparison; case aliases either do not exist on Ubuntu or differ from the case-sensitive set entry. The security property holds.

However, [docs/SUPPLY_CHAIN.md:29](/private/tmp/review-570b/docs/SUPPLY_CHAIN.md:29) is inaccurate when it says only `.git` is skipped: symlinked directories and symlinked `action.yml` files are silently ignored as non-files/non-directories. They cannot bridge successfully, but they are skipped.

Current GitHub.com documentation also supports the same-repository `$/path/to/action` syntax; [classify at line 183](/private/tmp/review-570b/lib/action-pins.mjs:183) rejects it as unparsable.

3. Docker classification is correct for the documented `NAME@DIGEST` form. It requires exactly lowercase `sha256:` plus 64 hexadecimal characters and compares the reviewed entry against `docker://` plus the complete image name before `@`. This matches Docker’s documented `NAME[:TAG|@DIGEST]` syntax. [Docker pull reference](https://docs.docker.com/reference/cli/docker/image/pull/)

4. Every current non-gate job has `needs: action-pins`, and the documentation correctly admits that this is a merge gate rather than an execution-prevention boundary. The gate’s own checkout/setup actions necessarily execute before it.

The test and documentation still overstate what `needs` alone proves. This passes [the assertion at line 489](/private/tmp/review-570b/tests/product/action-pins.test.mjs:489), but runs after the gate fails:

```yaml
debug:
  needs: action-pins
  if: always()
  steps:
    - uses: attacker/evil@main
```

GitHub explicitly documents `always()` as overriding failed dependency skipping. A newly added separate workflow also cannot have a cross-workflow `needs`; the merge-gate framing covers that limitation, but “a bad reference in another job never executes” does not.

5. `supply_chain_digest` does not cover everything deciding whether the check passes. It hashes scanned workflows/actions, the parsed policy, and `lib/action-pins.mjs`, but not:

- [scripts/verify-action-pins.mjs:29](/private/tmp/review-570b/scripts/verify-action-pins.mjs:29), which combines the results and decides `report.ok`;
- [scripts/verify-action-pins.mjs:51](/private/tmp/review-570b/scripts/verify-action-pins.mjs:51), which sets the exit status;
- [package.json:17](/private/tmp/review-570b/package.json:17), which decides what `npm run verify:action-pins` executes.

Changing line 29 to `ok: true` leaves `supply_chain_digest` unchanged while changing failure to success. Therefore the provenance recommendation at [docs/SUPPLY_CHAIN.md:112](/private/tmp/review-570b/docs/SUPPLY_CHAIN.md:112) is too strong.

6. There are 12 issue-570 mutation guards, not 13; the manifest contains 33 total. There is no mutation entry for CI ordering. By direct assertion trace, the 12 present substitutions are load-bearing against their named tests, and the manifest-integrity tests pass.

They are not all correctly labelled: “every yaml spelling of uses” at [tests/mutation/manifest.mjs:28](/private/tmp/review-570b/tests/mutation/manifest.mjs:28) is disproved by the escaped and explicit keys above. Its mutation also leaves the separate flow-mapping branch untouched, despite its reason claiming coverage of flow mappings.

7. Test names stronger than their assertions include:

- [“a mutable tag fails and a pinned SHA passes…”](/private/tmp/review-570b/tests/product/action-pins.test.mjs:58): it never asserts that the pinned reference passed.
- [“uses: is found however it is written…”](/private/tmp/review-570b/tests/product/action-pins.test.mjs:228) and [“every YAML spelling…”](/private/tmp/review-570b/tests/product/action-pins.test.mjs:331): both are contradicted by concrete accepted YAML.
- [“a bad reference in one never executes”](/private/tmp/review-570b/tests/product/action-pins.test.mjs:482): it asserts only the literal `needs` value, not the absence of an overriding job condition.

The current repository verifier and `actionlint` are green, but the escaped-key bypass is sufficient to block merge.

[exited with code 0]
