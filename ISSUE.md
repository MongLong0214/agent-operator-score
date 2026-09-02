<!-- FINAL_EXECUTION_CONTRACT_2026-09-01_V3 -->
# 실행 상태

```text
Status       READY — Batch 0
Blocked by   없음
Blocks       #586 #562 #569
Owner        Auxiliary Review Quality / Holdout Governance
PR target    dev
```

# Scope

`aos review`는 AOS assessment profile과 분리된 auxiliary lane이다.

```text
review-rule precision/recall
≠
operator assessment validity/generalizability
```

# 목표

표본 1개 precision 1.0이나 precision만 높고 known incident를 놓치는 reviewer가 PASS하지 않도록 두 lane을 구현한다.

```text
Lane A — actual local holdout precision
Lane B — repository known-incident fixture precision/recall
```

# Lane A — local holdout

Data policy:

```text
rule tuning에 사용하지 않은 actual sessions only
raw transcript Git/release/package 금지
safe session/finding digest + verdict + redacted reason only
tuning/holdout mutually exclusive
use-change history immutable
```

MVP default floor:

```text
holdout sessions >= 50
decided high-severity findings >= 20
high-severity precision >= 0.90
incomplete evidence reported as clean = 0
secret reprint = 0
```

Floor 미달:

```text
status = UNDECIDED
```

UNDECIDED는 PASS도 FAIL도 아니다.

# Lane B — known-incident corpus

각 fixture:

```json
{
  "fixture_id": "...",
  "runtime": "codex|claude|normalized",
  "expected_rules": [],
  "forbidden_rules": [],
  "evidence_status": "COMPLETE|INCOMPLETE"
}
```

Minimum corpus target:

```text
high rule: positive 10 + negative/near-miss 10
medium/info: positive 5 + negative/near-miss 5
```

Variation:

```text
Codex/Claude event shapes
malformed/incomplete evidence
shell/call-result/revision variants
secret/write-effect variants
```

Rule-level output:

```text
TP FP FN TN
precision recall
sample count
runtime coverage
```

정확한 명칭:

```text
known-incident fixture recall
```

실제 세션 전체 recall이라고 주장하지 않는다.

# Release policy

Assessment v0.2.0 release:

```text
Lane B PASS required
incomplete-as-clean = 0
secret reprint = 0
```

Lane A가 실제 finding 희소로 `UNDECIDED`라면 assessment release는 가능하지만:

```text
aos review stage = EXPERIMENTAL
precision claim = WITHHELD
review product production-quality claim 금지
```

`aos review` 자체를 production-quality라고 주장하려면 Lane A도 PASS해야 한다.

# Historical evidence

현재 독립 결과:

```text
320 sessions
high findings 10
TP 4 / FP 6
precision 0.400
```

새 independent holdout 전까지 README/LIMITATIONS에서 숨기거나 tuning result로 대체하지 않는다.

# Output schema

```json
{
  "lane_a": {
    "status": "PASS|FAIL|UNDECIDED",
    "sessions": 0,
    "decided_high": 0,
    "tp": 0,
    "fp": 0,
    "unclear": 0,
    "precision": null,
    "dataset_digest": "sha256:..."
  },
  "lane_b": {
    "status": "PASS|FAIL",
    "rule_metrics": {},
    "corpus_digest": "sha256:..."
  },
  "claim": "EXPERIMENTAL|PRODUCTION_QUALITY"
}
```

# Tests

```text
1 TP / 0 FP → UNDECIDED
49 sessions → UNDECIDED
50 sessions + 19 decided → UNDECIDED
minimum + precision .89 → FAIL
minimum + precision .90 → PASS
no findings + positive fixtures → recall 0
fixture FN → denominator 증가
holdout→tuning relabel → excluded + history kept
raw secret reason → redaction/refusal
```

# 금지 구현

- tiny sample PASS
- 표본 부족을 PASS/FAIL로 오표시
- tuning data를 holdout에 포함
- FN denominator 제거
- finding 0 reviewer PASS
- raw local holdout CI upload
- historical 0.400 숨김
- review accuracy를 assessment validity로 표현

# 검증

```bash
npm ci
npm test
npm run verify:mvp
npm run test:mutation
npm run smoke:package
```

추가:

```text
verify:review-holdout-floor
verify:known-incident-corpus
verify:no-raw-holdout-data
```

# 완료 조건

- [ ] Tiny sample로 PASS가 불가능하다.
- [ ] PASS/FAIL/UNDECIDED가 분리된다.
- [ ] Rule별 precision/recall/FN이 계산된다.
- [ ] Tuning/holdout가 격리되고 history가 보존된다.
- [ ] Historical 0.400 disclosure가 유지된다.
- [ ] Raw session/secret가 Git/package에 0건이다.
- [ ] Lane A UNDECIDED release claim이 정확히 제한된다.
- [ ] mutation tests가 load-bearing하다.

# 완료 보고

```text
Issue: #565
Final SHA:
PR:
CI run IDs:

Corpus manifest/digest:
Rule confusion matrix:
Local holdout safe summary:
Lane A/B status:
Historical disclosure:
Raw-data/secret scan:
Claim restriction:
Mutation:

Final verdict:
PASS | HOLD
```
