# Pre-implementation remediation matrix — 2026-08-05

- Status: **PENDING — MAINTAINER GATE REQUIRED**
- Scope: planning/control-plane only; product code remains zero and the 65-ticket/19-PRD/12-ADR census is unchanged.

|Finding|Remediating files|Acceptance and verification|
|---|---|---|
|P0-1 SSOT authority|SSOT, ADR-0012, D0-004|SSOT states sole product authority; ADR/PRD/ticket are implementation constraints and cannot override it; semantic-v2 test target checks authority chain.|
|P0-2 D0 truthful state|PRD-D0, D0-001…004, BOARD|D0-001 carries corrected missing-registry RED; D0-002 has real zero-code workspace contract; D0-003 is superseded with PR #53 evidence; D0-004 has current semantic-v2 RED.|
|P0-3 metric contract|Metric Scoring Contract v1, SSOT, PRD-E0A, E0A-001|M01–M20 each have deterministic observation/formula/state/vector fields; M03 F1 vectors are explicit; M10 route regret and M20 frontier distance/maximum are derived from frozen named contracts and reject caller-supplied derived values; E0A-001 freezes machine vectors before E1/E2.|
|P0-4 validation honesty|TRACEABILITY, D0-004, planning validator/tests|Current validator reports computed control-plane/product-code census and explicitly marks semantic traceability/gate digest/identity checks not yet enforced; D0-004 requires the semantic-v2 graph.|
|P1-5 oracle|ADR-0008, PRD-E3, E3-001…004|Post-termination grader-only materialization is selected; oracle-file/env/fd/temp/symlink/proc-fd/post-run fixtures are named.|
|P1-6 actor attribution|SSOT, PRD-E1/E3/E4/E9, E1/E3/E4/E9 tickets|Four attribution events and deterministic agent/human/external/unknown rules are trace/schema/adapter acceptance requirements.|
|P1-7 adapter sources|ADR-0007, PRD-E4/E9, E4/E9 tickets|Codex app-server JSON-RPC and installed generated-schema digest; Claude SDK query/SDKMessage + stream-json are primary. Forbidden sources and capability digest fields are tested.|
|P2-8 Maintainer Gate|ADR-0012, BOARD, decisions schema/registry, validator/tests|All public gate terms use Maintainer Gate; JSON schema/registry remain PENDING and schema/data tests pass.|
|P2-9 OSS truth|README, CONTRIBUTING, SSOT, PRD-E14, E14 tickets|Current state is public source-visible planning artifacts with zero product code; no license means external contribution acceptance remains blocked; target remains local-first OSS.|
|P2-10 name clearance|SSOT, PRD-D0, D0-002, PRD-E14, E14-001|D0 owns minimum GitHub/npm/domain/basic trademark evidence; E14 retains legal/notices/publication clearance only.|
|P2-11 E12 feasibility|SSOT, PRD-E12, E12 tickets|n=20 is feasibility only; exactly PASS_TO_CONTINUE/INCONCLUSIVE/PIVOT_REQUIRED are allowed and prohibited claims are tested.|
|P2-12 Node/workspaces|ADR-0003, D0-002, CI, validator/tests|CI matrix is 22/24 and engines are `>=22.18 <25`, the floor having moved off Node 20 because Node 20 cannot execute this repository's TypeScript and its test runner skips `.ts` files silently rather than failing; all future `@aos/*` manifests are private and root is the sole publish candidate.|
|T-13 encoded paths|planning validator/tests|`fileURLToPath()` replaces URL pathname; a copied fixture under a space-containing encoded path passes the focused regression.|
