# Contributing

Use Node.js >=22.18 and <25 on native macOS or Linux.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run verify
npm run pack:check
```

Changes to scoring, privacy projection, process cleanup, terminal semantics, handoff integrity, or issuance require a regression test. Do not add provider-specific score weights or direct bonuses for agent count, model price, prompt length, tokens, or graph size.
