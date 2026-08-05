# ADR-0011: Render the score UI locally from canonical results

- Status: Accepted (2026-08-05, PRD F9)
- Owner: CEO

## Context

The canonical Markdown and JSON report is auditable but is not a fast visual summary. A visual report and share card can improve comprehension and OSS discovery, but a second scoring path or hosted-only renderer would break determinism, local-first operation, and privacy.

## Decision

- Add a local report surface that consumes a schema-valid canonical result and never recomputes metrics, AOS-P0, evidence coverage, safety, or the selected lever.
- A versioned pure presentation model may derive only display fields such as finish, archetype, short labels, layout, and redacted share fields. Those values never feed back into scoring.
- Use an SVG-first card with pinned local fonts/assets. Produce deterministic `card.svg`, `card.png`, `share.txt`, and a local HTML report without a network dependency.
- Keep Markdown and canonical JSON as first-class audit outputs. A visual rendering failure cannot invalidate or replace them.
- The HTML report provides evidence drill-down, keyboard navigation, text equivalents, and reduced-motion behavior. The image is a bounded summary, not the evidence record.

## Rejected

- Recomputing score or safety in the browser: creates two authorities and allows display drift.
- Cloud rendering as the MVP path: violates local-first operation and creates an implicit upload surface.
- Canvas-only or screenshot-only output: weakens deterministic testing and accessibility.
- Removing Markdown/JSON after the visual UI ships: trades auditability for presentation.

## Consequences

The renderer must bit-match canonical fixture values across JSON, Markdown, HTML, SVG, and PNG. Fonts and assets are versioned inputs, and any renderer or asset change invalidates visual goldens.
