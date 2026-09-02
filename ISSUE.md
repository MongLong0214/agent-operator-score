<!-- FINAL_EXECUTION_CONTRACT_2026-09-01_V3 -->
> [!IMPORTANT]
> 이 본문은 #582의 유일한 실행 정본이다. 문서 PR #587은 연구 기반을 제공했지만 이 구현 이슈를 완료하지 않는다.

# 실행 상태

```text
Status       READY — Batch 0에서 즉시 착수
Blocked by   없음
Blocks       #559 #560 #558 #583 #564 #584 #568 #585 #586 #562
Owner        Construct / Evidence / Task / Interpretation Contract
PR target    dev
```

# 목표

AOS가 무엇을 측정하고 어떤 범위의 해석만 허용하는지 Evidence-Centered Design과 argument-based validity 구조로 **machine-readable하게 구현**한다.

```text
observed event/effect
→ observable cell
→ construct claim
→ task opportunity
→ permitted interpretation/use
```

# 허용 claim 단계

```text
RUN_DIAGNOSTIC
- 한 실행에서 관찰된 행동·결과
- 능력, 등급, percentile, rank 금지

PROFILE_BOUND
- 동일 exact profile + measurement contract
- 잠근 operational forms 전부 완료
- 선언된 환경·표집 과제에서 관찰된 수행 프로필

GENERALIZABILITY_SUPPORTED
- 정의된 universe
- prospective facet/form/invariance/uncertainty/validity evidence
- 별도 release gate
```

v0.2.0 기본 최고 claim은 `PROFILE_BOUND`다.

# Construct map

```text
C1 Framing & Contracting
C2 Context, Decomposition & Delegation
C3 Monitoring & Reliance Calibration
C4 Steering, Intervention & Recovery
C5 Verification & Epistemic Governance
C6 Safety, Boundary & Resource Governance
C7 Learning & Transfer — 별도 longitudinal lane
```

C7은 단기 Process/Outcome/Composite에 자동 합산하지 않는다.

# 필수 contract artifacts

```text
aos-construct-map.v1
aos-evidence-model.v1
aos-task-model.v1
aos-interpretation-use-argument.v1
aos-observable-cell.v1
```

각 scored cell은 최소 다음을 가진다.

```json
{
  "cell_id": "C3.RA.01",
  "construct_id": "C3",
  "axis": "operator_process",
  "claim": "incorrect AI advice를 증거에 근거해 거부한다",
  "observable": "initial → advice → inspection → final",
  "task_features": ["known-advice-correctness", "independent-initial-judgment"],
  "authority": "canonical-event+oracle",
  "rival_explanations": ["domain-knowledge-gap", "interface-friction"],
  "minimum_opportunities": 4,
  "required_for_construct": true,
  "scoring_rule_id": "reliance-cell.v1",
  "missing_policy": "NOT_OBSERVED"
}
```

# 최종 aggregation / issuance 계약

## Opportunity

각 opportunity는 categorical 판정과, scoring rule이 정의한 경우에만 `value_0_1`을 저장한다. Prompt 길이·turn 수·verbosity·typing speed·wall-clock speed·confidence 자체는 value를 만들지 않는다.

## Cell estimate

```text
observed opportunities < minimum_opportunities
→ estimate = null
→ status = INSUFFICIENT_OPPORTUNITIES

그 외
→ 같은 cell의 value_0_1 단순 평균
→ opportunity count와 분포를 함께 표시
```

Opportunity가 많은 cell이 자동으로 더 큰 비중을 갖지 않는다.

## Construct estimate

각 construct는 `required_cell_ids`와 `optional_cell_ids`를 선언한다.

```text
required cell 하나라도 미발급
→ construct estimate withheld

모든 required cell 발급
→ required cell estimate의 equal-weight mean
→ optional cell은 별도 표시하며 기본 index 가중치에 넣지 않음
```

## Process descriptive index

C1–C6가 모두 발급된 경우에만 equal-weight mean으로 계산한다.

```text
label = PROFILE-BOUND OPERATOR PROCESS INDEX
interpretation = descriptive only
```

순수·보편적 human ability score가 아니다.

## Missing evidence

```text
NOT_OBSERVED
INSUFFICIENT_OPPORTUNITIES
WITHHELD
```

중 하나로 보존하며 0·FAIL·PASS로 임의 치환하지 않는다.

# Evidence model

- operator evidence와 agent/system evidence를 분리한다.
- 자기신고 alone으로 outcome/safety/reliance credit을 주지 않는다.
- actual event/effect/oracle이 primary authority다.
- evidence authority가 없는 cell은 contract invalid다.
- raw private data는 restricted local store에 두고 public projection은 digest/safe summary만 사용한다.

# Task model

각 form은 다음을 선언한다.

```text
construct opportunity
required perturbation/oracle
family/domain/difficulty/language/interface facet
shortcut prohibition
minimum opportunity count
required/optional cell coverage
```

# Interpretation/use argument

Machine-readable inference chain:

```text
scoring
→ within-cycle generalization
→ extrapolation
→ use
```

각 단계에 assumption, evidence, rebuttal, status를 저장한다.

# M01–M20 migration

- 모든 current subcheck를 정확히 한 observable cell과 한 axis에 mapping한다.
- unmapped, double-owned, authority 없는 subcheck는 CI failure다.
- 기존 metric title은 presentation label일 뿐 construct 정의가 아니다.
- legacy result는 새 contract로 재계산하지 않고 historical/provisional로 렌더링한다.

# Counterfactual tests

```text
same operator process + stronger model
→ Process cell 불변

same outcome + worse operator decision
→ 해당 Process construct만 하락

longer prompt / more turns / faster completion only
→ Process credit 변화 없음

perfect agent artifact + operator evidence 없음
→ Process NOT_OBSERVED

language/interface만 변경
→ invariance evidence 전 직접 비교 금지

required cell 하나 누락
→ construct/index withheld
```

# 금지 구현

- dimension 이름만 바꾸고 완료 처리
- 모든 metric을 하나의 latent ability로 가정
- opportunity 수로 implicit weighting
- missing evidence를 0/PASS/FAIL로 자동 변환
- literature citation을 AOS 자체 validity evidence로 오인
- active ability band/cut score 유지
- v0.2.0을 universal ability test로 표기

# 검증

```bash
npm ci
npm test
npm run verify:mvp
npm run test:mutation
npm run smoke:package
```

추가 required checks:

```text
verify:construct-map
verify:evidence-model
verify:task-opportunities
verify:interpretation-use-argument
verify:observable-cell-aggregation
verify:no-construct-shortcuts
```

# 완료 조건

- [ ] 위 5개 versioned contract artifact가 구현된다.
- [ ] 모든 M01–M20 subcheck가 정확히 한 cell/axis에 mapping된다.
- [ ] required/optional cell과 minimum opportunity가 machine-readable하다.
- [ ] cell→construct→Process index 계산과 withholding이 결정적이다.
- [ ] rival explanation과 claim-stage inference chain이 존재한다.
- [ ] prompt/turn/time/verbosity shortcut이 0건이다.
- [ ] counterfactual·mutation test가 load-bearing하다.
- [ ] #559가 소비할 canonical digest가 존재한다.

# 완료 보고

```text
Issue: #582
Final SHA:
PR:
CI run IDs:

Construct map digest:
Evidence model digest:
Task model digest:
Interpretation/use digest:
Observable-cell digest:

Mapped subchecks:
Unmapped/double-owned:
Required/optional cells:
Aggregation fixtures:
Claim-stage matrix:
Counterfactual:
Mutation:

Final verdict:
PASS | HOLD
```

# 연구 기반

- AERA/APA/NCME, Standards for Educational and Psychological Testing (2014)
- Mislevy, Almond & Lukas, Evidence-Centered Design (2003)
- Kane, argument-based validity (2013)
- Shavelson, competency/task sampling and generalizability
