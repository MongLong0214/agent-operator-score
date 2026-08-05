# PRD F9 — Viral score UI and local share artifacts

- Milestone: M2.5 · Local Score UI · ADR: 0004, 0006, 0007, 0008, 0011, 0012
- Status: Approved for atomic implementation planning

## Goal

Turn a canonical AOS result into a fast, attractive, accessible local report and an honest share card without creating a second scoring authority, uploading private traces, or implying rank or certification.

## Product surfaces

### Local report UI — MVP

Planned command:

```bash
aos report --run ./.aos/runs/<id> --open
```

The local page contains:

1. honesty bar: status, safety, coverage, suite, form;
2. Operator Card hero;
3. six-factor radar plus text list;
4. primary constraint, authoritative evidence summary, and one lever;
5. Opportunity Profile detail with comparison warning;
6. factor-to-metric-to-evidence drill-down;
7. explicit local export actions.

### Share artifacts — MVP

- `card.svg`: deterministic, embeddable card.
- `card.png`: 1080 × 1648 default output, at least 2× logical resolution.
- `share.txt`: honest caption generated from an allowlisted projection.
- `result.json`: unchanged canonical local audit result.

`story.png`, copy-image convenience, Form A/B dual cards, and hosted share pages are post-MVP candidates. No hosted share issue enters the v0.1 implementation milestone.

## Users and jobs

- **Operator:** understand the score shape, evidence, constraint, and next lever quickly.
- **Sharer:** export a visually strong artifact without revealing private trace data.
- **Viewer:** understand that the artifact is an operator assessment in a declared environment, not a model rank.
- **Contributor:** add themes or archetype copy through conformance-tested registries.

## Non-goals

- Public leaderboard, percentile, head-to-head competition, certification, or hiring use.
- Social login, automatic posting, mandatory hosting, telemetry, or central trace storage.
- Full 3D runtime, copied sports/game visual identity, or card-only reporting.
- Replacing Markdown, canonical JSON, limitations, or evidence drill-down.
- Recomputing score, safety, factor values, coverage, or the deterministic lever in the UI.

## Operator Card contract

Required verified-result fields:

- product mark and integer AOS-P0 when issuance is allowed;
- `PROVISIONAL` or another canonical status;
- text-and-icon safety state separate from F6;
- local display name or `Operator`;
- deterministic archetype and cosmetic finish;
- F1–F6 using `INT`, `CTX`, `GRF`, `LOP`, `VER`, `GOV`;
- Opportunity chips using redacted display values;
- exactly one registered lever or `MANUAL_REVIEW_REQUIRED`;
- suite, form, scorer digest, and presentation version.

`GOV` is M20 Efficiency & Value. M19 is never a number in the six-stat row.

## Presentation registries

### Archetype v0

Archetypes use relative factor shape only and do not alter the score:

| ID | Label | Deterministic condition |
|---|---|---|
| `generalist` | Balanced Operator | max minus min is at most 12; evaluated first |
| `verifier` | Evidence Operator | VER is uniquely highest |
| `firefighter` | Incident Operator | LOP is lowest and VER is above the factor median |
| `contractor` | Contract-First | INT and VER are the top two factors |
| `orchestrator` | Graph Conductor | GRF is highest and GOV is at or above the factor median |
| `minimalist` | Lean Operator | GOV is highest and the canonical efficiency evidence marks a lean path |
| `drafter` | Spec Drafter | INT is lowest |

The registry must define precedence and a neutral fallback so overlapping or tied shapes remain deterministic. Labels are descriptive, non-shaming, and always paired with the one lever.

### Finish v0

| Finish | Verified overall | Constraint |
|---|---:|---|
| `Draft` | 0–39 | muted |
| `Stable` | 40–54 | cool gray-blue |
| `Reliable` | 55–69 | teal edge |
| `Sharp` | 70–84 | cyan accent |
| `Elite` | 85–100 | issuable S0/S1 result only |
| `Void` | any | S2/S3, `UNSAFE`, or `INVALID`; overall hidden |

Every verified finish is labeled “provisional band, not global rank.” Snapshot has no numeric AOS-P0, is watermarked `ESTIMATE`, and cannot exceed `Stable`.

## Data and trust contract

The renderer accepts only the validated canonical result plus a versioned presentation registry. It must not infer a missing status or safety state.

The local view may display the exact Opportunity Profile subject to the report privacy policy. The share projection uses an allowlist:

- allowed: issuable overall, F1–F6, canonical status, allowed safety label, coverage, redacted runtime/model class, network class, duration band, suite/form, archetype, finish, lever title, scorer and presentation digests;
- excluded by default: exact model ID, harness digest, prompt, path, user instruction, raw evidence, bounded excerpts, secret, account identity, run ID, and timestamps precise enough to identify a run.

Renderer output is a pure function of canonical JSON, registry version, assets, viewport, and locale. Pinned assets and deterministic serialization are required for fixture reproducibility.

## Visual and interaction requirements

- Dark card-first layout with one finish accent and readable output at 320 CSS px.
- Overall uses tabular/lining numerals; labels have stable short forms.
- Radar exposes all six full factor names in text as well as graphics.
- Card hover tilt is at most 8 degrees and disabled by `prefers-reduced-motion`.
- Status and safety use icon, text, and visual treatment; never color alone.
- Minimum image alt text includes product, allowed score or withheld state, status, archetype, and safety.
- HTML report is keyboard navigable; evidence accordions expose proper state and focus behavior.
- Local card readiness target is at most 2 seconds on the reference fixture and supported baseline hardware.

## Caption contract

The default verified caption is structurally equivalent to:

```text
AgentOps Score {overall} · {archetype}
{finish} · {safety}
Not a model rank — ops in my declared coding-agent environment.
Lever: {lever}
PROVISIONAL · self-improvement only
```

Snapshot captions omit overall and safety-clear language. All captions prohibit percentile, certification, industry-standard, hiring, shame, and “falling behind” claims.

## Requirements

1. UI-F9-01: render the local report from a schema-valid canonical result without scoring recomputation.
2. UI-F9-02: display status, issuable overall, F1–F6, separate safety, coverage, Opportunity, constraint, evidence, and exactly one lever.
3. UI-F9-03: derive archetype and finish through versioned deterministic registries with total tie/fallback behavior.
4. UI-F9-04: render accessible HTML, radar plus text alternative, and the Operator Card at 320 px and wider.
5. UI-F9-05: export byte-stable SVG and deterministic PNG at at least 2× resolution using pinned local assets.
6. UI-F9-06: export a privacy-allowlisted caption and artifact manifest without network access.
7. UI-F9-07: enforce ESTIMATE, withheld-score, unsafe/invalid, no-percentile, no-hiring, and no-rank presentation rules in every format.
8. UI-F9-08: preserve Markdown/JSON audit outputs and exact metric-to-event-to-artifact drill-down.
9. UI-F9-09: disable nonessential motion when requested and preserve keyboard/screen-reader operation.
10. UI-F9-10: complete the reference report and card locally within 2 seconds excluding explicit file-open latency.

## Acceptance

- AC-F9-1: canonical fixture values bit-match across JSON, Markdown, HTML, SVG metadata, and PNG visual manifest; the UI never calls scorer logic.
- AC-F9-2: all archetype overlap/tie permutations and every finish boundary produce one stable registered result.
- AC-F9-3: S2/S3/UNSAFE/INVALID fixtures hide overall, use `Void`, expose text safety, and export no ordinary score claim.
- AC-F9-4: Snapshot fixtures show `ESTIMATE`, no numeric AOS-P0, no `PROVISIONAL`, no `SAFE`, and no finish above `Stable`.
- AC-F9-5: card remains legible at 200 px audit width, safety is understandable in monochrome, radar has a text equivalent, and reduced-motion disables tilt.
- AC-F9-6: SVG/PNG are generated offline at required dimensions; repeated runs with identical pinned inputs match the approved deterministic digest policy.
- AC-F9-7: share projection mutation tests reject prompt, path, secret, exact model ID, raw evidence, run ID, and unknown fields.
- AC-F9-8: caption and visible-copy scanners reject percentile, certification, hiring, industry-standard, model-rank, shame, and unsupported comparison claims.
- AC-F9-9: broken evidence links fail the HTML report instead of hiding the evidence section; Markdown/JSON remain available.
- AC-F9-10: the reference fixture reaches local card-ready state within 2 seconds and performs zero network requests.

## Delivery order

```text
canonical report contract
→ presentation policy and registries
→ pure view model
→ accessible local HTML/radar
→ deterministic SVG/PNG
→ privacy-safe caption and bundle
→ cross-format honesty/accessibility/performance gate
```

MVP completion does not authorize hosting, public upload, social posting, or a leaderboard.
