# F9 tickets — Viral score UI and local share artifacts

> PRD: `docs/prd/PRD-F9-viral-score-ui.md` · ADR: 0004, 0006, 0007, 0008, 0011, 0012 · Milestone: M2.5

## T-901 Freeze presentation policy and registries (M)

- **Ownership:** `packages/reporter/src/presentation/policy.ts` — `PresentationPolicy`; `archetypes.ts` — `resolveArchetype`; `finishes.ts` — `resolveFinish`; `fixtures/presentation/policy/**`.
- **Preconditions/dependencies:** T-102, T-203, T-603; ADR-0011/0012 and PRD F9 accepted.
- **Forbidden:** alternate score name, metric/score/safety recomputation, percentile, environment rank, identity inference, ambiguous tie resolution, ordinary finish for withheld score.
- **RED:** overlap/tie, boundary, ESTIMATE, S2/S3, INVALID, missing-field, and unknown-enum fixtures either produce multiple presentations or leak a prohibited state.
- **Minimum GREEN:** version a total presentation policy with explicit archetype precedence/fallback, finish boundaries, Snapshot restrictions, Void behavior, short labels, and prohibited-copy tokens.
- **AC ↔ tests:** AC-F9-2 ↔ archetype permutation/tie table and finish boundary table; AC-F9-3/4 ↔ Void and Snapshot matrices; AC-F9-8 ↔ policy vocabulary negatives.
- **Verification:** focused property/table tests twice; registry snapshot digest; full/build; manual rule-table audit against ADR-0012 and PRD F9.
- **Invalidation/stop/evidence:** policy, canonical result enum, factor mapping, or copy-token change invalidates every F9 golden; stop on any non-total, ambiguous, or score-affecting derivation. Evidence includes exact head, fixture census, registry digest, focused/full/build logs, LIVE_NA rationale, review, and CI.

## T-902 Build the pure presentation view model (M)

- **Ownership:** `packages/reporter/src/presentation/view-model.ts` — `buildPresentationModel`; `share-fields.ts` — `buildLocalOpportunityView`; `fixtures/presentation/view-model/**`.
- **Preconditions/dependencies:** T-601, T-603, T-901.
- **Forbidden:** scorer import, result mutation, missing status/safety default, second lever, raw evidence in card fields, nondeterministic locale/time, hidden F6/M19 substitution.
- **RED:** canonical fixtures drift between report and view model, malformed required fields render anyway, or a scorer dependency is reachable from presentation code.
- **Minimum GREEN:** validate the canonical result, project exact display values, derive only registered presentation fields, preserve one lever/manual-review state, separate F6 from safety, and return stable ordered data.
- **AC ↔ tests:** AC-F9-1 ↔ cross-format value manifest and scorer-import boundary; AC-F9-3/4 ↔ withheld/Snapshot projections; AC-F9-9 ↔ evidence reference preservation.
- **Verification:** focused view-model goldens and dependency-boundary test; deterministic repeat; full/build; manual field-by-field comparison with canonical JSON.
- **Invalidation/stop/evidence:** canonical schema, reporter contract, diagnosis, or registry change invalidates all view-model evidence; stop on guessed/defaulted authority fields. Evidence includes input/output digests and equality manifest.

## T-903 Render accessible local HTML and six-factor radar (L)

- **Ownership:** `packages/reporter/src/ui/render-html.ts` — `renderHtmlReport`; `radar.ts` — `renderFactorRadar`; `packages/reporter/assets/report.css`; `fixtures/ui/html/**`.
- **Preconditions/dependencies:** T-602, T-902.
- **Forbidden:** network asset, inline executable third-party code, color-only safety, inaccessible accordion, radar without text equivalent, hidden broken evidence, HTML-only audit output.
- **RED:** keyboard, focus, reduced-motion, monochrome safety, broken-link, 200/320-pixel, missing-alt, and zero-network fixtures pass an incomplete report.
- **Minimum GREEN:** render honesty bar, card slot, radar plus factor list, constraint/lever, Opportunity details, evidence accordions, export controls, semantic landmarks, stable focus behavior, and reduced-motion CSS from local assets.
- **AC ↔ tests:** AC-F9-5 ↔ viewport, keyboard, semantics, monochrome, text-equivalent, and reduced-motion audits; AC-F9-9 ↔ broken evidence fail-closed and Markdown/JSON preservation; AC-F9-10 ↔ offline network census.
- **Verification:** focused HTML goldens; automated accessibility and link checks; full/build; manual keyboard, screen-reader, monochrome, 200/320-pixel, and no-network review.
- **Invalidation/stop/evidence:** HTML template, CSS, evidence-link, viewport, or accessibility-rule change invalidates HTML and manual evidence; stop on serious accessibility violation or network request. Evidence includes audit reports, screenshots with fixture digest, and LIVE_NA for Logic runtime.

## T-904 Render deterministic SVG and PNG Operator Cards (L)

- **Ownership:** `packages/reporter/src/card/render-svg.ts` — `renderCardSvg`; `render-png.ts` — `renderCardPng`; `manifest.ts` — `buildCardManifest`; `packages/reporter/assets/card/**`; `fixtures/ui/card/**`.
- **Preconditions/dependencies:** T-902.
- **Forbidden:** remote font/image, platform font fallback, raster-only authority, nondeterministic metadata, score shown for Void/Snapshot, cropped required status, copied third-party visual trade dress.
- **RED:** repeat-render, asset mutation, dimension, 200-pixel legibility, finish boundary, Void, Snapshot, missing-font, locale-length, and required-footer fixtures do not fail the empty renderer.
- **Minimum GREEN:** serialize deterministic SVG with pinned assets, render 1080 × 1648 PNG at at least 2× logical resolution, emit an input/output manifest, preserve required status/suite/presentation metadata, and fail closed when assets are missing.
- **AC ↔ tests:** AC-F9-1/6 ↔ repeated SVG bytes, approved PNG deterministic policy, dimensions, pinned asset manifest, and cross-format values; AC-F9-3/4/5 ↔ Void, Snapshot, monochrome, and legibility matrices.
- **Verification:** focused renderer goldens twice in the pinned toolchain; SVG parser/security scan; PNG pixel/dimension and perceptual-diff gate; full/build; manual visual review of every finish, Void, long locale, and 200-pixel output.
- **Invalidation/stop/evidence:** renderer, font, image, color token, serialization, rasterizer, locale, or viewport change invalidates all card goldens and visual QA; stop on fallback asset or hidden required label. Evidence includes toolchain/asset/output digests and visual matrix.

## T-905 Export the privacy-safe share bundle and caption (M)

- **Ownership:** `packages/reporter/src/share/project.ts` — `buildShareProjection`; `caption.ts` — `renderShareCaption`; `bundle.ts` — `writeShareBundle`; `packages/cli/src/commands/report.ts` — share/export flags only; `fixtures/ui/share/**`.
- **Preconditions/dependencies:** T-603, T-904.
- **Forbidden:** implicit upload, social API, exact model ID, prompt, path, secret, raw evidence, run ID, unrestricted object spread, unknown field pass-through, Snapshot score/safety-clear caption.
- **RED:** mutation corpus injects each excluded field and unknown nested keys; exporter leaks one, makes a network call, overwrites outside the explicit output root, or emits prohibited claims.
- **Minimum GREEN:** build an explicit allowlisted projection, write `card.svg`, `card.png`, `share.txt`, and a digest manifest atomically under the requested local root, use registered caption templates, and abort without a partial bundle on failure.
- **AC ↔ tests:** AC-F9-6/7 ↔ offline bundle, field-leak mutation set, containment, atomicity, permissions, and manifest; AC-F9-8 ↔ verified/Snapshot/unsafe caption claim scanner.
- **Verification:** focused privacy/containment/atomicity tests; packet capture or network-deny test; full/build; manual filesystem census and caption review for every status.
- **Invalidation/stop/evidence:** allowlist, canonical schema, caption, output layout, permission, or card digest change invalidates privacy and bundle evidence; stop on any unknown field or partial output. Evidence includes redaction census, zero-network record, output tree and digests.

## T-906 Enforce cross-format honesty, accessibility, and performance (L)

- **Ownership:** `conformance/ui/**`; `scripts/ui-conformance.mjs` — `checkUiConformance`; `.github/workflows/ci.yml` — UI conformance step only; `fixtures/ui/reference/**`.
- **Preconditions/dependencies:** T-903, T-904, T-905.
- **Forbidden:** weakening existing schema/scorer gates, snapshot update without reviewed diff, online test dependency, tolerance that hides numeric/status drift, sampled privacy fields, performance claim from warm cache only.
- **RED:** mutations for factor/status/safety drift, hidden label, claim token, leaked field, network request, missing asset, broken evidence, accessibility failure, and over-2-second cold render must each fail for the intended reason.
- **Minimum GREEN:** add a fail-closed matrix across JSON/Markdown/HTML/SVG/PNG/caption, exhaustive prohibited-field and claim scans, accessibility checks, zero-network assertion, cold/warm performance budgets, and immutable reference manifests in CI.
- **AC ↔ tests:** AC-F9-1 through AC-F9-10 ↔ named conformance cases with no shared assertion standing in for distinct acceptance criteria.
- **Verification:** RED mutation census; focused conformance twice; full/build/package; cold reference performance; manual accessibility/visual/privacy audit; CI at exact head.
- **Invalidation/stop/evidence:** any F9 source, asset, fixture, dependency, toolchain, schema, scorer, reporter, or workflow change invalidates affected conformance lanes; stop on unowned mutation, flaky digest, unsupported baseline, or waiver without owner approval. Evidence includes mutation matrix, manifests, timings, audits, exact-head review, and CI URL.
