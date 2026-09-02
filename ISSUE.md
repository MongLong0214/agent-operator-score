<!-- FINAL_EXECUTION_CONTRACT_2026-09-01_V3 -->
# 실행 상태

```text
Status       READY — Batch 0 read-only audit only
Deletion     #578 PASS evidence 보존 후
Blocked by   read-only audit 없음 / final deletion은 #578 #588
Blocks       final repository cleanup only
Owner        Remote Branch Audit / Evidence-preserving Cleanup
```

# 목표

Stable/integration 외의 원격 branch를 먼저 분류·보존한 뒤, final release/E2E evidence가 보존된 시점에 삭제한다.

```text
audit first
→ preserve unique work/evidence
→ delete only verified stale refs
```

# Current candidates

작업 시작 시 최신 목록을 재조회한다. 최소 현재 후보:

```text
fix/a-fixture-backed-agent-is-not-a-runtime
tmp/read-claude-artifact
```

추가 `fix/*`, `tmp/*`, merged feature/task/release branch도 동일 절차로 포함한다.

# Per-branch audit

```text
current SHA
open/closed/merged PR
unique commits vs dev
unique commits vs main
release-tag containment
superseding PR/issue/SHA
code/test/evidence/doc to preserve
workflow/plugin/docs/issue references
protection/ruleset status
last update/owner
```

# Classification

```text
MERGED
SUPERSEDED
UNIQUE_WORK
EVIDENCE_ONLY
ACTIVE
UNKNOWN_HOLD
```

## MERGED / SUPERSEDED

Superseding evidence를 기록하고 final cleanup window에 삭제한다.

## UNIQUE_WORK

```text
unique intent/files/commits 기록
canonical issue에 연결
latest dev에서 새 task branch
필요 logic만 cherry-pick 또는 재구현
new PR/CI
old stale branch는 이후 삭제
```

Stale branch 자체를 active lane으로 계속 사용하지 않는다.

## EVIDENCE_ONLY

Evidence를 issue comment/doc/fixture/commit reference로 옮긴 뒤 삭제한다. Branch를 archive로 사용하지 않는다.

## ACTIVE

Open PR/active owner가 있으면 삭제하지 않고 owner/PR/status를 기록한다.

# Two-phase execution

## Phase A — Batch 0 read-only

```text
branch/PR/tag inventory
classification
unique-work/evidence plan
reference scan
no ref mutation
```

## Phase B — after #578 PASS

```text
final evidence bundle에 needed refs 보존 확인
delete eligible stale refs
post-delete state re-read
```

# Invariants

삭제 전후:

```text
main SHA unchanged
dev SHA unchanged
release tags unchanged
open PR heads valid
branch protection unchanged
stable plugin/install source unchanged
```

# Repository policy

문서화:

```text
feature/task/fix → merge 후 삭제
tmp/* → 최대 7일 또는 task 종료
release/hotfix → release + back-merge 후 삭제
merged-branch auto-delete setting
branches are not evidence archives
```

# 금지 작업

- unique work audit 없이 삭제
- Phase A에서 ref 삭제
- stale branch에서 신규 개발 계속
- main/dev force update
- tag 이동/삭제
- open PR head 삭제
- evidence 미보존 삭제
- branch를 장기 archive로 유지

# Verification

```text
verify:branch-audit
verify:branch-cleanup-invariants
verify:no-open-pr-head-deletion
```

# 완료 조건

- [ ] 모든 stale 후보에 classification이 있다.
- [ ] Unique work/evidence 보존 계획이 있다.
- [ ] Phase A는 main/dev/tag를 변경하지 않는다.
- [ ] #578 후 삭제 가능한 branch만 제거된다.
- [ ] Open PR/active branch가 오삭제되지 않는다.
- [ ] Post-delete main/dev/tag/protection invariants가 PASS한다.
- [ ] Cleanup policy가 문서화된다.

# 완료 보고

```text
Issue: #572
Audit date:

Branch audit table:
Preserved work/evidence:
Deleted branches:
Retained active branches:
Superseding issues/PRs:

Before/after main/dev/tags:
Open PR heads:
Protection/channel invariants:
Policy docs:

Final verdict:
PASS | HOLD
```
