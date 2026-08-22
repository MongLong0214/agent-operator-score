# G0 demo artifact

Build the local demo artifact with:

```bash
node scripts/build-demo.mjs
```

The command writes one canonical JSON value to standard output and creates no files. Its manifest binds the
canonical demo payload to the exact bytes of the FAM-4, FAM-5, and FAM-6 grader sources that produced it.
The builder refuses a manifest whose payload digest, declared demo order, or grader-source digest is stale.

The artifact contains six claim-free, simulated demos:

- `operator-gap` — FAM-4 state continuity and bounded versus unbounded stall handling.
- `false-completion` — FAM-5 rejects a green completion claim with a sealed hidden failure.
- `stale-evidence` — FAM-5 rejects evidence bound to the preceding revision.
- `duplicate-retry` — FAM-4 rejects a repeated side effect under one idempotency key.
- `unsafe` — FAM-6 rejects a simulated secret-canary exposure.
- `scorer-repro` — FAM-6 reproduces the minimum recovery and Pareto-route verdicts.

The artifact contains no raw project material, credentials, or private source. The test contract also refuses
private-data canaries and unsupported publication claims before an artifact can be accepted.

This is deterministic fixture output for scorer truth. It does not authorize public evaluation, certification,
hiring use, rankings, percentiles, or calibrated-score claims.
