# Issue-resolution ledger — 2026-08-06

**HISTORICAL SNAPSHOT — NEVER USE FOR CURRENT READINESS.** This dated reconciliation is excluded from operational-state inputs. Its issue states, branch SHA, and next actions describe only the captured baseline.

This is an audit record, not a product gate, execution packet, acceptance record, or current-state projection. Current readiness follows `AGENTS.md` and, after D0-004 is verified, `npm run ops:status -- --strict`.

## Verified baseline

- Repository: `MongLong0214/agent-operator-score`
- Default branch/base: `dev` at `abc73bae310d6469c810614ff787adebde3972a5`
- GitHub inventory: 64 open executable issues, #54–#55 and #57–#118. #56 / D0-003 is the documented superseded planning-migration record and is not executable.
- Authority state on the base: final SSOT present; 12 ADRs are `PROPOSED`; 19 PRDs are `PROPOSED`; 64 executable tickets are `BLOCKED`; the committed Maintainer Gate registry is `PENDING`.
- Control-plane review history: [PR #120](https://github.com/MongLong0214/agent-operator-score/pull/120) at `d1df2a93e98a3780ee4a0abbd721a39f1bcce308` received an independent exact-head `FAIL`; the required correction is recorded in [the review finding](https://github.com/MongLong0214/agent-operator-score/pull/120#issuecomment-5196709533). Its corrected candidate `bc72d5d4c23e989a634d0d6d230d84616ec6e7b7` received CEO exact-head `PASS` and merged as `abc73bae310d6469c810614ff787adebde3972a5`; post-merge `dev` CI [run 31044444400](https://github.com/MongLong0214/agent-operator-score/actions/runs/31044444400) passed 3/3. That control-plane merge does not accept an ADR, PRD, or ticket and grants no product execution authority.

## Blocking rule and next lawful action

Every row below is blocked by the same authority chain: accepted required ADR set, accepted owning PRD, accepted exact ticket, then an exact-base execution packet. A dependency may not be treated as complete until its own exact-head acceptance and authorized merge/closure evidence exists.

The next external actions are:

1. Obtain an independent exact-head production-readiness verdict for the current ledger candidate; no merge is permitted unless the CEO makes and executes an explicit merge decision.
2. After the control-plane merge and current evidence revalidation, record distinct Maintainer Gate acceptance for the exact ADR batch, owning PRD, and D0-001 ticket at their exact digests.
3. Only after those gates, create a clean exact-base execution packet for D0-001, capture its named RED failure, and proceed only while all gates remain current.

No issue closure, RED test, production edit, or implementation evidence is recorded in this ledger.

## Executable-issue dependency ledger

| Issue | Ticket | Title | Direct dependencies | State |
|---:|---|---|---|---|
| [#54](https://github.com/MongLong0214/agent-operator-score/issues/54) | D0-001 | Canonical identifier registry | None | BLOCKED |
| [#55](https://github.com/MongLong0214/agent-operator-score/issues/55) | D0-002 | Repository and npm-workspace skeleton | D0-001 | BLOCKED |
| [#57](https://github.com/MongLong0214/agent-operator-score/issues/57) | D0-004 | Semantic planning validator v2 and governance gate | D0-002 | BLOCKED |
| [#58](https://github.com/MongLong0214/agent-operator-score/issues/58) | E0A-001 | Freeze M01–M20 metric registry | D0-004 | BLOCKED |
| [#59](https://github.com/MongLong0214/agent-operator-score/issues/59) | E0A-002 | Freeze eligibility and score-issuance predicate | E0A-001 | BLOCKED |
| [#60](https://github.com/MongLong0214/agent-operator-score/issues/60) | E0A-003 | Freeze formula, factor, safety, and display precision contract | E0A-002 | BLOCKED |
| [#61](https://github.com/MongLong0214/agent-operator-score/issues/61) | E0B-001 | Define adapter capability schema and complete event matrix | None | BLOCKED |
| [#62](https://github.com/MongLong0214/agent-operator-score/issues/62) | E0B-002 | Define controlled and imported session classification | E0B-001 | BLOCKED |
| [#63](https://github.com/MongLong0214/agent-operator-score/issues/63) | E0B-003 | Specify capability doctor output and verdict fixtures | E0B-001, E0B-002 | BLOCKED |
| [#64](https://github.com/MongLong0214/agent-operator-score/issues/64) | E0C-001 | Preregister pack simulation inputs and invariants | None | BLOCKED |
| [#65](https://github.com/MongLong0214/agent-operator-score/issues/65) | E0C-002 | Implement deterministic pack budget and eligibility simulator | E0C-001 | BLOCKED |
| [#66](https://github.com/MongLong0214/agent-operator-score/issues/66) | E0C-003 | Emit preflight decision report and freeze gate | E0C-002 | BLOCKED |
| [#67](https://github.com/MongLong0214/agent-operator-score/issues/67) | E0D-001 | Define prescription input formulas and missing rules | None | BLOCKED |
| [#68](https://github.com/MongLong0214/agent-operator-score/issues/68) | E0D-002 | Freeze treatment registry and safety remediation | E0D-001 | BLOCKED |
| [#69](https://github.com/MongLong0214/agent-operator-score/issues/69) | E0D-003 | Implement deterministic one-lever selector contract | E0D-001, E0D-002 | BLOCKED |
| [#70](https://github.com/MongLong0214/agent-operator-score/issues/70) | E1-001 | Define aos-trace schema and canonical event registry | None | BLOCKED |
| [#71](https://github.com/MongLong0214/agent-operator-score/issues/71) | E1-002 | Define aos-result and Opportunity Profile schemas | E1-001 | BLOCKED |
| [#72](https://github.com/MongLong0214/agent-operator-score/issues/72) | E1-003 | Add schema conformance, compatibility, and digest gate | E1-001, E1-002 | BLOCKED |
| [#73](https://github.com/MongLong0214/agent-operator-score/issues/73) | E2-001 | Implement opportunity eligibility and evidence deduplication | E1-003 | BLOCKED |
| [#74](https://github.com/MongLong0214/agent-operator-score/issues/74) | E2-002 | Implement metric factor O/P and AOS-Coding P0 scoring | E2-001 | BLOCKED |
| [#75](https://github.com/MongLong0214/agent-operator-score/issues/75) | E2-003 | Implement ordered integrity safety and issuance gate | E2-002 | BLOCKED |
| [#76](https://github.com/MongLong0214/agent-operator-score/issues/76) | E2-004 | Build complete scorer conformance fixture corpus | E2-003 | BLOCKED |
| [#77](https://github.com/MongLong0214/agent-operator-score/issues/77) | E2-005 | Close G0 scorer truth reproducibility gate | E2-004 | BLOCKED |
| [#78](https://github.com/MongLong0214/agent-operator-score/issues/78) | E3-001 | Implement explicit-root fresh workspace lifecycle | E2-005 | BLOCKED |
| [#79](https://github.com/MongLong0214/agent-operator-score/issues/79) | E3-002 | Separate worker oracle secrets descriptors and IPC | E3-001 | BLOCKED |
| [#80](https://github.com/MongLong0214/agent-operator-score/issues/80) | E3-003 | Implement atomic budgets approvals and seeded fault replay | E3-002 | BLOCKED |
| [#81](https://github.com/MongLong0214/agent-operator-score/issues/81) | E3-004 | Implement watchdog process reconciliation and one terminal state | E3-003 | BLOCKED |
| [#82](https://github.com/MongLong0214/agent-operator-score/issues/82) | E4-001 | Define runtime adapter interface and controlled wrapper lifecycle | E3-004 | BLOCKED |
| [#83](https://github.com/MongLong0214/agent-operator-score/issues/83) | E4-002 | Implement Codex identity and capability discovery | E4-001 | BLOCKED |
| [#84](https://github.com/MongLong0214/agent-operator-score/issues/84) | E4-003 | Normalize Codex controlled events with bounded redaction | E4-002 | BLOCKED |
| [#85](https://github.com/MongLong0214/agent-operator-score/issues/85) | E4-004 | Prove Codex doctor conformance and session classification | E4-003 | BLOCKED |
| [#86](https://github.com/MongLong0214/agent-operator-score/issues/86) | E5-001 | Define sealed scenario registry and opportunity audit | E4-004 | BLOCKED |
| [#87](https://github.com/MongLong0214/agent-operator-score/issues/87) | E5-002 | Build FAM-4 continuity and resume scenario | E5-001 | BLOCKED |
| [#88](https://github.com/MongLong0214/agent-operator-score/issues/88) | E5-003 | Build FAM-4 retry transition and idempotency scenario | E5-001 | BLOCKED |
| [#89](https://github.com/MongLong0214/agent-operator-score/issues/89) | E5-004 | Build FAM-4 stall termination and budget scenario | E5-002, E5-003 | BLOCKED |
| [#90](https://github.com/MongLong0214/agent-operator-score/issues/90) | E6-001 | Build FAM-5 public-green hidden-fail scenario | E5-004 | BLOCKED |
| [#91](https://github.com/MongLong0214/agent-operator-score/issues/91) | E6-002 | Build FAM-5 stale-evidence and exact-revision scenario | E6-001 | BLOCKED |
| [#92](https://github.com/MongLong0214/agent-operator-score/issues/92) | E6-003 | Build FAM-5 scope regression and wrong-target scenario | E6-001 | BLOCKED |
| [#93](https://github.com/MongLong0214/agent-operator-score/issues/93) | E6-004 | Compose FAM-5 claim-evidence conformance gate | E6-001, E6-002, E6-003 | BLOCKED |
| [#94](https://github.com/MongLong0214/agent-operator-score/issues/94) | E7-001 | Build FAM-6 failure diagnosis and minimum recovery scenario | E6-004 | BLOCKED |
| [#95](https://github.com/MongLong0214/agent-operator-score/issues/95) | E7-002 | Build FAM-6 least-privilege and safety scenario | E7-001 | BLOCKED |
| [#96](https://github.com/MongLong0214/agent-operator-score/issues/96) | E7-003 | Build FAM-6 quality-constrained efficiency scenario | E7-001, E7-002 | BLOCKED |
| [#97](https://github.com/MongLong0214/agent-operator-score/issues/97) | E7-004 | Close differentiated wedge and G0 demo candidate | E7-001, E7-002, E7-003 | BLOCKED |
| [#98](https://github.com/MongLong0214/agent-operator-score/issues/98) | E8-001 | Build FAM-1 intent and contracting scenario | None | BLOCKED |
| [#99](https://github.com/MongLong0214/agent-operator-score/issues/99) | E8-002 | Build FAM-2 context RAG and decoy scenario | None | BLOCKED |
| [#100](https://github.com/MongLong0214/agent-operator-score/issues/100) | E8-003 | Build FAM-3 graph orchestration and join scenario | None | BLOCKED |
| [#101](https://github.com/MongLong0214/agent-operator-score/issues/101) | E8-004 | Compose and freeze six-family Form A | E8-001, E8-002, E8-003 | BLOCKED |
| [#102](https://github.com/MongLong0214/agent-operator-score/issues/102) | E9-001 | Implement Claude Code identity capability and wrapper lifecycle | E8-004 | BLOCKED |
| [#103](https://github.com/MongLong0214/agent-operator-score/issues/103) | E9-002 | Normalize Claude Code events with bounded redaction | E9-001 | BLOCKED |
| [#104](https://github.com/MongLong0214/agent-operator-score/issues/104) | E9-003 | Prove Codex Claude semantic parity and declared differences | E9-002 | BLOCKED |
| [#105](https://github.com/MongLong0214/agent-operator-score/issues/105) | E10-001 | Render canonical JSON and Markdown reports | E9-003, E8-004 | BLOCKED |
| [#106](https://github.com/MongLong0214/agent-operator-score/issues/106) | E10-002 | Implement metric event artifact evidence drill-down | E10-001 | BLOCKED |
| [#107](https://github.com/MongLong0214/agent-operator-score/issues/107) | E10-003 | Render deterministic primary constraint and one lever | E10-001, E10-002 | BLOCKED |
| [#108](https://github.com/MongLong0214/agent-operator-score/issues/108) | E11-001 | Build linked non-reused Form B and exposure gate | E10-003 | BLOCKED |
| [#109](https://github.com/MongLong0214/agent-operator-score/issues/109) | E11-002 | Implement one-lever seven-day sprint ledger | E11-001 | BLOCKED |
| [#110](https://github.com/MongLong0214/agent-operator-score/issues/110) | E11-003 | Classify retest attribution and transfer signal | E11-002 | BLOCKED |
| [#111](https://github.com/MongLong0214/agent-operator-score/issues/111) | E12-001 | Freeze alpha preregistration protocol and data dictionary | E11-003 | BLOCKED |
| [#112](https://github.com/MongLong0214/agent-operator-score/issues/112) | E12-002 | Execute reference and 20-person alpha with immutable provenance | E12-001 | BLOCKED |
| [#113](https://github.com/MongLong0214/agent-operator-score/issues/113) | E12-003 | Analyze alpha and publish feasibility verdict | E12-002 | BLOCKED |
| [#114](https://github.com/MongLong0214/agent-operator-score/issues/114) | E13-001 | Define and render Snapshot ESTIMATE output | None | BLOCKED |
| [#115](https://github.com/MongLong0214/agent-operator-score/issues/115) | E13-002 | Implement explicit privacy-allowlisted Snapshot share artifact | E13-001 | BLOCKED |
| [#116](https://github.com/MongLong0214/agent-operator-score/issues/116) | E14-001 | Complete license notices and security clearance | E13-002 | BLOCKED |
| [#117](https://github.com/MongLong0214/agent-operator-score/issues/117) | E14-002 | Build public documentation demo and contributor conformance surface | E14-001 | BLOCKED |
| [#118](https://github.com/MongLong0214/agent-operator-score/issues/118) | E14-003 | Obtain independent reproduction and close G4 publication gate | E14-002 | BLOCKED |

## Reconciliation sources

- `docs/decisions/MAINTAINER-GATE-STATUS.md`
- `docs/decisions/maintainer-gate-registry.v2.json`
- `docs/tickets/BOARD.md`
- `docs/GITHUB-ISSUE-MAP.md`
- GitHub open-issue inventory for `MongLong0214/agent-operator-score`
