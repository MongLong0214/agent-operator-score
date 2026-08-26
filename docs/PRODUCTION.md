# Production support

Agent Operator Score `0.1.0` is a local-first CLI for macOS and Linux on Node.js `>=22.18 <25`.

## Supported product surface

- vendor-neutral agent profiles backed by trusted local CLI commands;
- one-agent and multi-agent controlled assessments;
- family routing, isolated parallel branches, explicit join stages, handoff evidence;
- deterministic six-family grading mapped to M01–M20;
- exact-rational AOS-Coding P0 scoring and M19 safety hard gate;
- local JSON, Markdown, HTML, projected NDJSON evidence, and exactly-once terminal records;
- project observations and imported sessions labelled `DIAGNOSTIC ONLY`;
- clean npm tarball installation and macOS/Linux CI.

## Explicitly unsupported

- Windows and WSL;
- SaaS, accounts, payments, telemetry, or central storage;
- hostile-code containment guarantees—the generic command adapter is for trusted local agent CLIs;
- raw prompt, response, tool I/O, environment value, secret, or hidden-reasoning persistence;
- model ranking, percentile, certification, hiring, promotion, surveillance, or global-rank claims.

## Release gate

A candidate is releasable only when these commands all pass from a clean checkout:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run verify
npm run pack:check
```

The protected `dev` branch retains the historical `planning-contract (22)` and `planning-contract (24)` check names, but those jobs now execute the complete production quality lane rather than planning validation.
