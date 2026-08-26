# G0 scorer truth

This document records the E2-005 fail-closed gate. It binds schema, scorer, and
fixture bytes and compares Node 22 and Node 24 evidence hashes. The only
successful verdict is `G0_FIXTURE_TRUTH`.

`G0_FIXTURE_TRUTH` means the pinned digest manifest matched the tree, the
published formula vectors reproduced, every registered mutant was killed, the
lockfile was the clean published install, and the Node 22 and Node 24 hashes
were identical. It does not authorize public evaluation, a percentile, an
end-to-end assessment, or any claim beyond that fixture truth.

Node 20 is refused. That runtime cannot execute this repository's TypeScript,
and its test runner skips `.ts` files silently instead of failing. The
supported range is the repository engines floor, `>=22.18 <25`.

Run the gate:

```bash
node scripts/verify-g0.mjs
node --test conformance/g0/g0.test.ts
```

The root package.json does not own a `verify:g0` script. The commands above
are the executable surface.

Any mismatch — a stale digest, a live mutant, byte drift, an empty corpus, a
dirty install, or an unsupported runtime — blocks the verdict.
