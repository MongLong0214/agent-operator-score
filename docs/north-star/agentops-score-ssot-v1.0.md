AgentOps Score (AOS)

개인 AI 에이전트 운영 환경·실행 역량 진단 — Slim OSS 최종 기획서 v1.0

• 문서 상태: FINAL / SINGLE SOURCE OF TRUTH / OSS BUILD BASELINE
• 기준일: 2026-08-05
• 브랜드: AgentOps Score (AOS)
• 공개 패키지: agentops-score
• CLI 바이너리: aos
• 로컬 작업 경로: .aos/
• 초기 도메인: Coding Agent Operations
• 초기 런타임: OpenAI Codex, Claude Code
• 평가 단위: 모델이나 하네스가 아니라 인간 사용자(operator)
• 평가 환경: 선언된 model·runtime·harness·tool·permission·budget의 Opportunity Profile
• 배포 원칙: 100% OSS, local-first, 계정·결제·중앙 수집 없음
• 현재 증거 상태: 측정 설계는 존재하지만 사람 대상 calibration evidence는 아직 없음
• 대외 라벨: Open assessment method / PROVISIONAL
• 금지 표현: 업계 표준, 공식 인증, 전 세계 순위, 채용 적합성, 검증된 백분위
• 개정 근거: 2026-08-05 객관 리뷰에서 지적된 시간·관측성·처방·표시 계약을 반영
• 기준본 관계: 이전 브랜드 문서는 docs/north-star/legacy/에 보관하고, 구현과 공개 의사결정은 이 문서를 따른다.

> **이 파일 하나가 AgentOps Score의 최종 기획 기준본이다.**  
> 별도 상품 기획, 유료화 문서, 엔터프라이즈 판매 계획은 존재하지 않는다.  
> 구현의 우선순위는 문서 확장이 아니라 `preflight contracts → schema → fixtures → scorer → runner → adapters → task pack → report`다.

────────

0. 최종 결정

0.1 한 줄 정의

> **AgentOps Score는 선언된 에이전트 실행 환경에서 사용자가 목표·컨텍스트·그래프·루프·검증·복구를 얼마나 효과적으로 운영하는지 실제 결과와 trace로 측정하고, 0~100의 잠정 점수와 가장 효과적인 개선 레버를 제공하는 오픈소스 진단 도구다.**

환경을 많이 설치했는지 평가하지 않는다. Opportunity Profile로 환경 조건을 분리하고, 그 조건에서 사용자가 만들어낸 운영 기여를 평가한다.

영문 메시지는 다음으로 고정한다.

> **We score how well you operate agents in a declared environment—not the model alone.**

0.2 해결하려는 고객 문제

|고객 인사이트                             |AOS의 응답                                                 |
|------------------------------------|--------------------------------------------------------|
|“남들은 AI를 훨씬 잘 쓰는 것 같은데 나는 뒤처진 것 같다.”|막연한 비교 불안을 실제 수행 기반의 점수·근거·다음 행동으로 바꾼다.                 |
|“내 AI 활용 수준을 객관적으로 알 수 없다.”         |설문이 아니라 표준 과제, 산출물, 도구 호출, 상태 전이, 인간 개입, 검증 trace로 평가한다.|
|“내가 잘한 건지 모델이 잘한 건지 모르겠다.”          |모델·런타임·하네스·도구·예산을 `Opportunity Profile`로 분리해 기록한다.      |
|“어디서 잘못 쓰는지 모르겠다.”                  |6개 요인과 20개 지표에서 점수를 잃은 실제 evidence를 보여준다.               |
|“조언을 따라 하면 진짜 좋아지는지 모르겠다.”          |한 가지 레버만 바꾼 뒤 다른 Form에서 개선이 전이되는지 다시 측정한다.              |

AI FOMO는 사용자가 진단을 시작하게 만드는 심리적 트리거일 뿐, 능력 점수의 입력값이 아니다. 자신감, 불안, 사용량, 프롬프트 길이, 에이전트 수는 실력으로 간주하지 않는다.

0.3 사용자가 얻어야 하는 다섯 답

1. 지금 내 수준은 몇 점인가?
2. 그 점수는 어떤 증거로 만들어졌는가?
3. 나는 어느 운영 단계에서 가장 많은 성능을 잃는가?
4. 무엇 하나를 바꾸면 가장 큰 개선이 가능한가?
5. 다른 과제에서도 실제로 좋아졌는가?

초기에는 충분한 norm이 없으므로 “남들 중 상위 몇 %”보다 절대 수행 수준·근거·개선 전이를 우선한다.

0.4 이번 버전에서 제거한 것

다음은 제품의 코어가 아니며 구현하지 않는다.

• 결제, 가격표, 유료 SKU
• SaaS multi-tenant 플랫폼
• 계정 생성과 중앙 사용자 DB
• Live Audit 구독
• 팀·엔터프라이즈 영업 퍼널
• 공개 개인 leaderboard
• 채용·승진·해고용 인증
• 124개 지표 전체 구현
• Measurement Board와 복수 위원회 선행 설치
• G5 이후 표준화 작업의 일정 강제
• 다도메인 AOS-General
• “업계 표준” 마케팅

0.5 유지하는 Slim Core

```text
인간 operator
+ declared & matched Opportunity Profile
+ 20개 핵심 지표
+ 6개 평가 family × Form A/B
+ pack-level 35~45분 Verified Core
+ AOS-P0 조화평균
+ M19 안전 hard gate
+ Codex·Claude Code adapter
+ adapter observability contract
+ public schema·fixtures·deterministic scorer
+ deterministic one-lever prescription v0
+ Form B 재검증
+ local-first OSS
```

Slim은 지표를 장난감 수준으로 줄이는 것이 아니다.
20개 지표와 6개 family는 결과·컨텍스트·그래프·루프·검증·안전을 함께 측정하기 위한 최소 코어로 동결한다. 다만 모든 지표를 모든 micro-scenario에서 억지로 관찰하지 않는다. 관찰 기회는 pack 전체에 분산한다.

1. 제품 위치

1.1 AOS가 차지하는 자리

```text
                         평가 단위
                 인간 사용자              AI 시스템

얕은 평가       AI literacy·fluency       지식·정답형 모델 시험
              설문·퀴즈·대화 분류

깊은 평가       ★ AOS ★                   SWE-bench·HarnessBench
              인간 operator               agent·skill·harness benchmark
              × controlled task
              × trace
              × matched opportunity
              × prescription
```

AOS가 측정하는 것은 다음이 아니다.

• 또 하나의 AI 리터러시 퀴즈
• 프롬프트 지식 시험
• 모델 leaderboard
• 하네스 자체 benchmark
• 코딩 산출량 dashboard
• 특정 도구 설치 검사

AOS가 측정하는 것은 주어진 에이전트 환경을 인간이 얼마나 잘 운영했는가다.

1.2 초기 사용자

• Codex·Claude Code 등 코딩 에이전트를 일상적으로 사용하는 개인 개발자
• 여러 모델·하네스를 쓰지만 자신의 운영 수준을 설명하지 못하는 파워유저
• 프롬프트를 넘어 context·graph·loop·orchestration·verification을 개선하려는 사용자
• 자신의 하네스가 실제 성과를 높였는지 확인하려는 OSS 개발자

초기 비대상:

• 일반 챗봇 입문자
• AI 상식 인증만 원하는 사용자
• 모델 성능 비교가 목적인 연구자
• 채용 필터나 직원 감시 도구를 원하는 조직

1.3 제품 카피

국문

> 내 에이전트 운영 환경과 사용 방식은 실제로 얼마나 좋은가?  
> AgentOps Score는 프롬프트 길이나 도구 개수가 아니라 실제 작업 설계·컨텍스트·위임·상태·검증·복구를 측정합니다.

영문

> An open assessment for human agent operations.  
> Declared environment. Real tasks. Traceable evidence. Actionable improvement.

카피 경계

• AI 리터러시 시험, 모델 벤치마크, 하네스 점수라고 부르지 않는다.
• “환경 테스트”는 설치 검사라는 뜻이 아니다. 환경을 Opportunity로 선언하고, 사용자가 그 환경을 얼마나 적합하게 구성·운영했는지 결과와 trace로 판단한다.

2. 사용자 경험

2.1 무료 로컬 실행 모드

|모드                    |시간    |라벨               |출력                        |현재 우선순위|
|----------------------|-----:|-----------------|--------------------------|-------|
|**Demo Fixtures**     |5분 이내 |없음               |scorer 재현과 failure demo   |G0 필수  |
|**Snapshot**          |3~5분  |`ESTIMATE`       |대략적 band, 추천 family, 다음 명령|G4 전후  |
|**Verified Core**     |35~45분|`PROVISIONAL`    |AOS-P0, 6요인, 근거, 레버 1개    |핵심     |
|**Improvement Sprint**|7일    |없음               |treatment log와 적용 지침      |G3 필수  |
|**Retest Form B**     |35~45분|`AOS-G P0`       |다른 과제에서의 개선 전이            |G3 필수  |
|**Live Diagnostics**  |수일    |`DIAGNOSTIC ONLY`|실제 업무 습관 분석               |90일 비목표|

모든 모드는 무료이고 로컬에서 실행한다. 계정이나 업로드를 요구하지 않는다.

2.2 기본 흐름

```text
5분 Demo 또는 Snapshot
→ Verified Core Form A
→ AOS-P0 + 6요인 + evidence
→ 가장 큰 개선 레버 1개
→ 7일 Improvement Sprint
→ Verified Core Form B
→ 개선 전이 확인
→ 익명 contribution bundle은 사용자가 원할 때만 export
```

2.3 결과 화면 계약

```text
AgentOps Score — Coding           78 / 100
상태                                      PROVISIONAL
평가 시간                                 41분
증거 충족도                               86%
안전                                      SAFE
Opportunity                              Codex / native / standard budget
비교 위치                                 제공 안 함 — matched norm 부족

강점                                      Verification & Recovery
핵심 제약                                 Loop & State
가장 큰 개선 레버                         Recovery Watchdog
다음 검증                                 Form B
```

반드시 함께 보여줄 것:

• 점수 version과 scorer digest
• Opportunity Profile
• 근거 충족도
• 안전 상태
• 6요인 결과
• 가장 큰 제약의 실제 trace
• 적용할 레버 하나
• 알려진 한계

보여주지 않을 것:

• calibration 전 정밀 백분위
• 수치심을 유도하는 순위
• “AI를 못 쓰는 사람” 낙인
• 근거 없는 미래 점수 예측
• 채용 적합성 해석

2.4 공유

Snapshot 공유 카드는 다음을 강제한다.

• ESTIMATE 워터마크
• “실제 수행 평가가 아님” 표시
• 강점 유형과 다음 과제 중심
• 개인 식별 정보 없음
• 사용자의 명시적 실행 없이는 생성하지 않음

Verified 결과의 기본 상태는 비공개다.

2.5 North Star

측정 진실성

1. 공개 fixture에서 bit-for-bit 동일한 scorer 결과
2. false completion·stale evidence·unsafe action 탐지
3. 외부 사용자의 독립 재채점 성공

사용자 가치

1. 다른 Form에서 확인된 개선 전이
2. 평가 완료 시간 45분 이내
3. 결과의 원인과 다음 행동 이해도
4. 제3자가 만든 adapter·scenario contribution

GitHub star는 보조 지표다. 매출·전환율은 이 프로젝트의 성공 기준이 아니다.

────────

3. 측정 대상

3.1 공식 구성개념

> **AgentOps 역량은 사용자가 자신의 목표와 도메인 책임을 유지하면서, 선언된 모델·도구·컨텍스트·검색·메모리·에이전트·하네스·권한 환경을 과제에 맞게 구성하고 운영하여 의도를 검증 가능하고 안전하며 반복 가능하고 비용 효율적인 결과로 전환하는 능력이다.**

AOS는 두 층을 구분한다.

1. Environment Opportunity: 사용자가 접근할 수 있었던 모델·런타임·하네스·도구·권한·예산
2. Human Operations Contribution: 그 환경에서 사용자가 내린 정의·선택·위임·검증·개입·복구 결정

환경 자체의 우열을 개인 실력으로 귀속하지 않으며, 설치 개수나 복잡성은 가점하지 않는다.

3.2 성과 귀속

```text
관찰된 결과
= 사용자 운영 능력
+ 과제 난이도·도메인 지식
+ 모델 능력·revision·추론 설정
+ 하네스·skill·도구 효과
+ 컨텍스트·권한·예산·시간
+ 런타임·환경
+ 세션 변동
+ 상호작용 효과
```

산출물 성공률을 그대로 사용자 능력으로 간주하지 않는다.

3.3 Opportunity Profile

모든 scored run은 최소 다음에 결박된다.

• assessment·suite·family·form version
• 언어
• runtime과 adapter version
• exact model ID, 가능한 경우 revision
• reasoning·sampling 설정
• harness profile과 digest
• skill·hook·MCP 목록과 digest
• tool surface
• permission·network profile
• context·token·time·tool-call budget
• 허용된 인간 개입 정책
• base repository와 environment digest

Opportunity Profile이 다르면 raw score를 직접 비교하지 않는다. 초기에는 보정된 백분위를 만들지 않고 조건을 투명하게 표시한다.

3.4 측정하지 않는 것

다음은 그 자체로 가점하지 않는다.

• 긴 프롬프트
• 많은 토큰과 긴 작업 시간
• RAG 문서 수
• memory 크기
• 그래프 노드·edge 수
• 서브에이전트·reviewer 수
• 특정 MCP·skill·하네스 설치
• 비싼 모델
• 생성 코드량
• 사용자가 직접 구현한 결과
• 자신감·FOMO·교육 수료

```text
기술의 가치
= 품질·복구·안전·시간 이득
- 토큰·지연·조정·유지보수 비용
- 새 실패와 권한 표면
```

3.5 인간 개입

좋은 operator는 무조건 손을 떼는 사람이 아니다.

긍정적으로 평가할 수 있는 개입:

• 인간만 결정할 수 있는 tradeoff를 명확히 함
• false completion을 차단함
• 위험한 외부 액션을 중지함
• blocker에 필요한 최소 정보만 제공함
• 실패 원인을 정확히 분류해 복구시킴

불리하게 평가하는 개입:

• 에이전트가 해결할 수 있는데 즉시 takeover
• 정답을 직접 구현해 agent success로 보고
• 방향을 반복 변경
• 검증 없이 “됐으니 끝내라”고 지시
• 불필요한 micromanagement

────────

4. 6개 요인과 20개 핵심 지표

4.1 요인

|Factor                        |핵심 질문                        |Metrics|
|------------------------------|-----------------------------|-------|
|**F1 Intent & Contract**      |목표·범위·성공조건을 실행 가능한 계약으로 만들었는가|M01–M04|
|**F2 Context & Information**  |필요한 정보를 정확하고 신선하게 공급했는가      |M05–M07|
|**F3 Graph & Orchestration**  |올바르게 분해·배치·위임·통합했는가          |M08–M11|
|**F4 Loop & State**           |장기 작업의 상태·전환·재개를 잃지 않았는가     |M12–M14|
|**F5 Verification & Recovery**|완료를 증명하고 실패를 적절히 복구했는가       |M15–M18|
|**F6 Governance & Value**     |필요한 자율성을 안전하고 경제적으로 사용했는가    |M19–M20|

4.2 지표 공통 규칙

• 사용자 행동 또는 행동 결과가 실제 trace에서 관찰돼야 한다.
• 과제에 관찰 기회가 있어야 한다.
• 기회가 없으면 NOT OBSERVED이며 0점이 아니다.
• 가능하면 결정론적 oracle을 사용한다.
• 사용량·복잡성이 아니라 적합성과 순효과를 평가한다.
• 점수를 위한 형식적 행동을 hidden trap으로 차단한다.
• 개선 처방으로 연결되지 않는 지표는 공식 점수에 추가하지 않는다.
• 20개 지표는 alpha가 끝날 때까지 추가하지 않는다. 삭제·병합은 데이터 근거가 있을 때만 한다.

4.3 핵심 지표

F1 — Intent & Contract

|ID     |지표                          |평가 질문                             |핵심 증거                                  |대표 gaming 차단                     |
|-------|----------------------------|----------------------------------|---------------------------------------|---------------------------------|
|**M01**|Goal–Outcome Fidelity       |실제 목적과 원하는 최종 상태를 실행 가능한 형태로 보존했는가|최초 요청, 계획, acceptance map, 최종 산출물      |목표 문장 수가 아니라 hidden outcome 충족   |
|**M02**|Scope & Constraint Capture  |포함·제외·변경 금지·제약을 정확히 닫았는가          |scope, non-goal, permission, diff      |모든 것을 금지하면 M15에서 실패              |
|**M03**|Clarification Judgment      |조사할 사실과 인간에게 물을 결정을 구분했는가         |ask/no-ask label, 질문 시점, 사전 탐색         |질문 횟수 가점 없음; 불필요 질문은 precision 하락|
|**M04**|Acceptance–Evidence Contract|실행 전에 완료 기준과 증거를 연결했는가            |acceptance IDs, verifier, evidence refs|형식적 체크리스트가 아니라 실제 oracle 연결      |

F2 — Context & Information

|ID     |지표                                          |평가 질문                                    |핵심 증거                                           |대표 gaming 차단                       |
|-------|--------------------------------------------|-----------------------------------------|------------------------------------------------|-----------------------------------|
|**M05**|Context Selection Precision                 |필요한 정보를 충분히 제공하면서 decoy와 과잉 context를 줄였는가|선택 파일·블록, gold/decoy set, token share           |context 양이 아니라 recall·precision    |
|**M06**|Retrieval & Memory Grounding                |검색·RAG·memory를 실제 주장과 결정에 올바르게 사용했는가     |query, retrieved chunks, citation, memory events|호출 수 가점 없음; no-retrieval 정답 과제 포함  |
|**M07**|Freshness, Provenance & Injection Resistance|stale·저신뢰·악성 지시를 구분했는가                   |timestamp, origin, trust label, canary          |유명 도메인이 아니라 task-specific hierarchy|

F3 — Graph & Orchestration

|ID     |지표                                       |평가 질문                                             |핵심 증거                                      |대표 gaming 차단                    |
|-------|-----------------------------------------|--------------------------------------------------|-------------------------------------------|--------------------------------|
|**M08**|Task Atomicity                           |독립적으로 완료·검증·재시도 가능한 단위로 분해했는가                     |nodes, ownership, acceptance, changed files|task 수가 아니라 검증 가능성과 조정비용        |
|**M09**|Dependency Graph Accuracy                |선행관계·공유자원·join·병렬 가능성을 정확히 모델링했는가                 |predicted/gold DAG, order, collision       |복잡한 그래프보다 최소 정확 그래프             |
|**M10**|Delegation, Routing & Parallelization Fit|direct·tool·specialist·subagent·model을 과제에 맞게 골랐는가|route, counterfactual arm, quality/cost    |호출 수가 아니라 net benefit과 regret   |
|**M11**|Handoff, Role & Join Integrity           |책임·권한·입출력 계약과 결과 통합이 닫혔는가                         |packet, permissions, artifacts, join trace |역할 선언이 아니라 실제 diff·tool·adoption|

F4 — Loop & State

|ID     |지표                                       |평가 질문                                     |핵심 증거                                        |대표 gaming 차단           |
|-------|-----------------------------------------|------------------------------------------|---------------------------------------------|-----------------------|
|**M12**|State Freshness & Continuity             |목표·진행·blocker·evidence가 최신이며 세션 전환 뒤 복원됐는가|state events, checkpoints, resume            |상태 파일 존재가 아니라 truth와 복구|
|**M13**|Transition, Retry & Idempotency Integrity|전이·retry가 정확히 한 번의 의도된 효과를 만들었는가          |ledger, run IDs, duplicate traps, digests    |retry 횟수 가점 없음         |
|**M14**|Loop Termination & Stall Handling        |계속·완료·blocker·budget stop을 정직하게 판단했는가     |watchdog, stop reason, unfinished obligations|오래 일하거나 빨리 끝내는 것 자체는 무관|

F5 — Verification & Recovery

|ID     |지표                              |평가 질문                          |핵심 증거                                             |대표 gaming 차단              |
|-------|--------------------------------|-------------------------------|--------------------------------------------------|--------------------------|
|**M15**|Verified Outcome Success        |실제 요구 결과가 hidden oracle에서 통과했는가|hidden tests, invariants, artifact QA             |public test 과적합 방지        |
|**M16**|Scope & Regression Integrity    |요구 범위만 바꾸고 기존 동작을 보존했는가        |diff, allowed paths, regression, mutation         |변경량 최소화로 필수 구현 누락 시 M15 실패|
|**M17**|Completion Claim Integrity      |완료 주장과 최신 evidence가 정확히 일치하는가  |claim, exact revision, timestamp, acceptance map  |완료 회피는 M14·M15에서 불리       |
|**M18**|Intervention & Recovery Judgment|실패를 정확히 진단하고 적시에 최소 개입으로 복구했는가 |failure label, intervention, retry packet, outcome|개입 횟수가 아니라 필요성·정보가치·복구    |

F6 — Governance & Value

|ID     |지표                             |평가 질문                               |핵심 증거                                        |대표 gaming 차단                         |
|-------|-------------------------------|------------------------------------|---------------------------------------------|-------------------------------------|
|**M19**|Safe Autonomy & Least Privilege|필요한 자율성을 주되 권한·외부 액션·비밀·격리 경계를 지켰는가 |permissions, sandbox, approvals, canaries    |모든 권한 차단 시 M15·autonomy fit 실패       |
|**M20**|Verified Leverage Efficiency   |품질·안전 목표를 만족하는 가장 단순하고 저렴한 구성을 선택했는가|token, latency, calls, human minutes, quality|최저 비용이 아니라 quality-constrained Pareto|

────────

5. 평가 과제

5.1 공통 원칙

• 구현 경로를 강제하지 않고 결과와 invariant를 채점한다.
• 정상 사례와 trap 사례를 함께 둔다.
• direct execution이 최적인 과제와 multi-agent가 유리한 과제를 모두 포함한다.
• 검색이 필요한 과제와 검색하지 않는 것이 최적인 과제를 모두 포함한다.
• hidden oracle는 worker process에서 접근할 수 없다.
• Form A/B는 표면 내용과 repository가 다르지만 같은 construct와 opportunity를 측정한다.
• 기본 평가는 35~45분 안에 끝나야 한다.
• 같은 정답이나 동일 fixture를 재평가에 재사용하지 않는다.

5.2 6개 family

|Family                                   |측정 목적                  |대표 주입                                       |주요 Metrics           |우선 oracle                |
|-----------------------------------------|-----------------------|--------------------------------------------|---------------------|-------------------------|
|**FAM-1 Intent & Contracting**           |모호한 요구를 실행 계약으로 변환     |숨은 outcome, non-goal, ask/no-ask            |M01–M04, M15, M17    |outcome·constraint map   |
|**FAM-2 Context, RAG & Decoy**           |필요한 정보 선택과 출처 경계       |decoy, stale doc, injection, no-answer      |M05–M07, M17, M19    |gold context·canary      |
|**FAM-3 Graph & Orchestration**          |분해·DAG·routing·join    |false parallel, shared file, specialist task|M08–M11, M19–M20     |gold DAG·collision map   |
|**FAM-4 Loop, State & Continuity**       |상태·resume·retry·stall  |session loss, reviewer FAIL, duplicate run  |M12–M14, M17–M18     |state machine·idempotency|
|**FAM-5 Verification & False Completion**|결과·회귀·완료 정직성           |public green/hidden fail, stale evidence    |M04, M15–M18         |hidden test·mutation     |
|**FAM-6 Recovery, Safety & Efficiency**  |failure diagnosis·권한·비용|timeout, rate limit, secret, fallback drift |M10, M13–M14, M18–M20|fault·policy·Pareto      |

5.3 Form 구성

Verified Core Form A

• family별 micro-scenario 1개, 총 6개
• pack 전체 실행 시간 목표 35~45분
• full normalized trace
• 20개 지표 중 최소 14개를 pack 전체에서 관찰
• 각 scenario는 2~4개의 primary metric opportunity만 책임진다
• secondary metric은 실제 기회가 발생한 경우에만 채점한다
• 결과: AOS-P0 PROVISIONAL

14 metrics observed는 scenario별 요구가 아니다. 하나의 행동을 여러 지표에 중복 귀속해 숫자를 채우지 않으며, eligibility는 sealed scenario contract와 trace로 증명해야 한다.

Pack 시간·기회 예산 v0

|Family                               |목표 시간|primary opportunity 상한|대표 책임          |
|-------------------------------------|----:|---------------------:|---------------|
|FAM-1 Intent & Contracting           |5분   |4                     |M01–M04        |
|FAM-2 Context, RAG & Decoy           |6분   |3                     |M05–M07        |
|FAM-3 Graph & Orchestration          |8분   |4                     |M08–M11        |
|FAM-4 Loop, State & Continuity       |7분   |3                     |M12–M14        |
|FAM-5 Verification & False Completion|7분   |3                     |M15–M17        |
|FAM-6 Recovery, Safety & Efficiency  |7분   |3                     |M18–M20        |
|전환·로딩·보고 여유                          |최대 5분|—                     |runner overhead|

이 표는 구현 가설이다. E6 착수 전에 reference operator와 scripted policy로 budget simulation을 수행한다.

• median 목표: 40분 이하
• p90 목표: 45분 이하
• pack-level eligible metrics: 최소 14개
• scenario당 primary opportunity: 최대 4개
• 실패 시 지표를 삭제하지 않고 scenario의 기회 배치·표면 복잡도·오버헤드를 조정한다
• 위 조건이 동시에 성립하지 않으면 G1 전에 Form A를 동결하지 않는다

Retest Form B

• 같은 construct와 유사 난이도
• 다른 repository·표면 요구·trap
• Improvement Sprint 이후 사용
• 결과: AOS-G P0 또는 transfer signal

공개 Demo Fixtures

• scorer와 schema 재현용
• pass/fail/stale/duplicate/unsafe reference trace
• 실제 scored task의 정답이 아님

5.4 로컬 평가 보안의 정직한 한계

로컬 OSS 평가에서 machine owner는 패키지와 코드를 조사할 수 있다. 따라서 초기 AOS는 다음만 보장한다.

• hidden oracle가 worker process에 노출되지 않음
• accidental leakage와 일반적인 agent access 차단
• run·trace·artifact tampering 탐지
• task·scorer version과 digest 기록

다음은 보장하지 않는다.

• 악의적인 응시자의 완전한 부정행위 방지
• 원격 감독 수준의 시험 보안
• 채용·자격 인증에 필요한 고위험 신원 검증

그래서 초기 결과는 자기개선용 PROVISIONAL이며 인증이 아니다.

────────

6. 점수

6.1 AOS-P0

Calibration 전에는 복잡한 latent model을 흉내 내지 않는다.

```text
Outcome Index O
= 0.50 × M15
+ 0.25 × M16
+ 0.25 × M17

Operator Process Index P
= opportunity-weighted mean(
    M01..M14,
    M18,
    M20
  )

AOS-P0
= 100 × 2OP / (O + P)
```

규칙:

• 각 metric은 0~1
• M19는 평균에 넣지 않는 안전 hard gate
• NOT OBSERVED는 분모에서 제외
• evidence coverage가 70% 미만이면 종합 점수 미발급
• O 또는 P가 0이면 AOS-P0는 0
• 결과만 좋거나 절차만 화려한 경우 조화평균이 상쇄를 제한
• 가중치와 transform은 alpha 전 변경 금지

6.2 Factor 출력

• F1 = opportunity-weighted mean(M01–M04)
• F2 = opportunity-weighted mean(M05–M07)
• F3 = opportunity-weighted mean(M08–M11)
• F4 = opportunity-weighted mean(M12–M14)
• F5 = opportunity-weighted mean(M15–M18)
• F6 Efficiency & Value = M20
• Safety = M19 state (S0–S3) — 점수와 분리

리포트에서 F6 79 / SAFE처럼 한 셀에 섞지 않는다. 효율 점수와 안전 상태를 별도 행으로 표시한다. M19를 평균해 안전 위반을 가릴 수 없으며, S2 이상이면 종합 점수를 발급하지 않는다.

6.3 안전 gate

|수준    |예                                   |처리              |
|------|------------------------------------|----------------|
|**S0**|위반 없음                               |점수 발급           |
|**S1**|가역적 경미한 scope·approval 실수           |점수 가능, 경고       |
|**S2**|무단 외부 action, 중요 권한 위반, secret 노출 위험|공식 점수 미발급       |
|**S3**|실제 유출·파괴·비가역 action                 |`UNSAFE/INVALID`|

6.4 증거 상태

|상태                     |조건                                 |출력          |
|-----------------------|-----------------------------------|------------|
|`ESTIMATE`             |Snapshot                           |band와 다음 단계만|
|`PROVISIONAL`          |full trace, coverage ≥70%, S0/S1   |AOS-P0와 한계  |
|`INSUFFICIENT_EVIDENCE`|coverage <70% 또는 trace integrity 부족|점수 없음       |
|`UNSAFE`               |S2 이상                              |diagnostic만 |
|`INVALID`              |oracle 노출, identity 오류, tampering  |평가 제외       |
|`CALIBRATED`           |향후 reliability·linking 기준 통과       |현재 사용 금지    |

6.5 불확실성과 비교

• alpha 전에는 과도한 소수점 정밀도를 제공하지 않는다.
• 반복·scenario 데이터로 산출 가능한 경우에만 uncertainty interval을 표시한다.
• N<300이면 matched percentile을 제공하지 않는다.
• 조건이 다른 사용자끼리 raw score를 순위화하지 않는다.
• bridge study 없이 model/runtime 세대가 다른 점수를 직접 비교하지 않는다.

6.6 Manual Takeover

• 안전을 위한 takeover는 M18에서 긍정적일 수 있다.
• 사람이 직접 만든 부분은 agent-mediated outcome으로 귀속하지 않는다.
• report에 human-authored share와 takeover reason을 별도로 표시한다.

6.7 AOS-G P0

Form A와 B의 난이도 linking이 확보되기 전에는 정확한 성장점수 대신 transfer signal을 제공한다.

linking 이후 후보식:

```text
AOS-G P0
= Form B post-treatment AOS-P0
- Form B expected baseline
```

성장 판정은 다음을 동시에 확인한다.

• 처방 대상 metric 개선
• M15–M17 비악화
• M19 안전 유지
• 비용·인간 개입의 허용 범위
• 같은 정답 암기로 설명되지 않음

────────

7. 평가 객관성

7.1 판정 우선순위

```text
1. hidden deterministic oracle
2. invariant·property·policy test
3. mutation·metamorphic test
4. diff·state·permission·trace checker
5. calibrated model judge with abstention
6. blind human adjudication
7. self-report
```

상위 판정이 가능한 사실을 LLM judge가 뒤집을 수 없다.

7.2 LLM judge 제한

LLM judge는 다음에만 사용한다.

• 부분적으로 열린 요구 해석
• 설명과 근거의 연결
• 인간 개입의 정보가치
• 결정론화하기 어려운 산출물 품질

필수 통제:

• worker·vendor identity blind
• answer order swap
• verbosity·style padding test
• injection isolation
• confidence와 ABSTAIN
• blind human double coding 표본
• 공개 JUDGE_RELIABILITY.md

7.3 G0–G4 품질 게이트

|Gate  |이름                   |통과 조건                                                        |실패 시             |
|------|---------------------|-------------------------------------------------------------|-----------------|
|**G0**|Scorer Truth         |fixture bit-repro, false completion·stale·duplicate·unsafe 탐지|공개 평가 금지         |
|**G1**|Measurement Exists   |n≥20 alpha, person signal > task/session noise, median ≤45m  |construct·task 수정|
|**G2**|Facet Sanity         |model/harness 변경 뒤에도 사용자 귀속이 합리적                             |점수 주장 축소         |
|**G3**|Prescription Transfer|한 레버가 Form B에서 개선 신호                                         |처방 엔진 재설계        |
|**G4**|Open Surface         |public schema·fixtures·scorer, 외부 재현 1건 이상                   |설치·문서·계약 수정      |

G5 이후의 multi-runtime calibration·norm·공개 표준화는 증거가 생겼을 때만 검토한다. 일정에 넣지 않는다.

7.4 Alpha 기준

• 20명 known groups
• novice / intermediate / expert 균형
• 일부 Form A/B counterbalance
• blind expert review
• runner reference runs 48~96회
• 목적은 norm이 아니라 “측정이 존재하는가” 확인

공개 전 최소 라벨:

• PROVISIONAL
• no percentile
• no certification
• no hiring claim
• limitations 공개

────────

8. 개선 엔진

8.1 출력 계약

점수는 반드시 다음 처방으로 끝난다.

```text
1. 가장 큰 제약 1개
2. 그 제약을 보여주는 trace·artifact
3. 바꿀 treatment 1개
4. 예상 이득과 비용
5. 적용 방법
6. Form B 재검증 조건
```

8.2 Primary Constraint 선택 규칙 v0

MVP의 레버 선택은 LLM의 자유 생성이 아니라 다음 결정론적 규칙을 따른다.

1. S2/S3이면 점수와 일반 처방을 중단하고 안전 remediation만 출력한다.
2. NOT OBSERVED, evidence confidence <0.70, 유효 opportunity 2개 미만인 metric은 후보에서 제외한다.
3. eligible factor 중 normalized gap이 가장 큰 factor를 고른다.
4. 동률 또는 3점 이내이면 우선순위는 F5 → F4 → F1 → F2 → F3 → F6이다. 검증·복구와 상태 실패를 먼저 닫기 위함이다.
5. 선택 factor 안에서 가장 낮은 metric을 고르되, authoritative evidence가 있는 metric만 허용한다.
6. metric별 사전 등록된 treatment map에서 하나만 선택한다.
7. 동일 효과의 후보가 둘이면 구현 비용·권한 표면·토큰 증가가 더 작은 treatment를 선택한다.
8. 결정론적으로 선택할 수 없으면 MANUAL_REVIEW_REQUIRED를 출력하며 임의 처방을 생성하지 않는다.

이 규칙은 G3에서 처방 전이가 실패했을 때 측정 실패와 레버 선택 실패를 분리할 수 있게 한다.

8.3 Metric → Treatment 기본 매핑

|Metric |기본 treatment v0                             |
|-------|--------------------------------------------|
|M01–M02|goal/scope contract template                |
|M03    |fact-vs-decision clarification gate         |
|M04    |acceptance–evidence contract                |
|M05    |context selection budget                    |
|M06–M07|retrieval provenance·freshness gate         |
|M08–M09|atomic task + dependency map                |
|M10    |direct/tool/subagent routing rule           |
|M11    |handoff minimum contract                    |
|M12    |durable checkpoint + resume packet          |
|M13    |idempotency key + transition ledger         |
|M14    |stall watchdog + terminal-state rule        |
|M15–M17|evidence-bound completion gate              |
|M18    |intervention trigger + recovery packet      |
|M19    |least-privilege remediation; 재평가 전 필수       |
|M20    |remove redundant layer 또는 model/tool tier 조정|

8.4 Expected Improvement Value

후보 레버의 설명과 tie-break에는 다음 식을 사용한다. P0에서는 learned model이 아니라 고정된 rule table을 사용한다.

```text
Expected Improvement Value
= 예상 품질·복구·안전 uplift
× 전이 가능성
× 근거 신뢰도
- 구현 시간
- token·latency
- 유지보수
- 새 실패·권한 표면
```

8.5 One-Lever 원칙

```text
Form A baseline
→ treatment 하나
→ 7일 실제 적용
→ Form B
→ 품질·안전·비용·인간 개입 재측정
```

여러 조언을 동시에 적용하지 않는다. 개선되지 않으면 diagnosis, lever selection, treatment execution, form linking 중 어느 단계가 틀렸는지 분리해 기록한다.

9. 시스템과 OSS 표면

9.1 구성

```text
Scenario Registry
      ↓
Runtime Adapter + Opportunity Profile
      ↓
Isolated Runner
      ↓
Normalized Trace Recorder
      ↓
Oracle & Policy Graders
      ↓
20-Metric Scorer
      ↓
AOS-P0 + Diagnosis
      ↓
Markdown / JSON Report
```

9.2 Adapter Observability Contract

AOS는 Codex나 Claude Code가 “완전한 공식 trace export”를 제공한다고 가정하지 않는다. 각 adapter는 native event, wrapper instrumentation, workspace-derived evidence를 조합해 capability를 선언한다.

상태 정의

• REQUIRED: scored run에 반드시 필요. 누락 시 관련 metric 또는 전체 점수 차단
• CONDITIONAL: 해당 기능을 사용했거나 scenario가 opportunity를 부여한 경우 필수
• DERIVED: workspace·runner·artifact에서 결정론적으로 재구성 가능
• BEST_EFFORT: 있으면 진단에 사용하되 누락을 사용자 실패로 처리하지 않음
• UNAVAILABLE: adapter가 관찰할 수 없음. 관련 metric은 NOT OBSERVED

v0 event coverage matrix

|Event group                                  |계약                  |Codex adapter v0                   |Claude Code adapter v0             |누락 처리                                              |
|---------------------------------------------|--------------------|-----------------------------------|-----------------------------------|---------------------------------------------------|
|run/task lifecycle, timestamps               |REQUIRED            |wrapper capture                    |wrapper capture                    |run invalid                                        |
|runtime·model·harness identity               |REQUIRED            |runtime query + config digest      |runtime query + config digest      |score blocked                                      |
|user instruction·clarification               |REQUIRED            |wrapper/session log                |wrapper/session log                |M01–M04 blocked                                    |
|tool call·result·error                       |REQUIRED            |supported event/log 또는 wrapper     |hook/log 또는 wrapper                |affected metrics blocked                           |
|workspace diff·artifact digest               |DERIVED             |runner filesystem                  |runner filesystem                  |run invalid if derivation fails                    |
|evidence created·invalidated·completion claim|REQUIRED            |wrapper + scorer events            |wrapper + scorer events            |M15–M17 blocked                                    |
|approval·permission·safety event             |REQUIRED            |sandbox/approval wrapper           |permission hook/wrapper            |M19 blocked; score may be withheld                 |
|context selection·injection·compaction       |CONDITIONAL         |config/log + wrapper               |hook/log + wrapper                 |M05/M07 NOT OBSERVED                               |
|retrieval·memory read/write                  |CONDITIONAL         |intercepted tool/MCP events        |intercepted tool/MCP events        |M06/M07 NOT OBSERVED                               |
|delegation·return·handoff·join               |CONDITIONAL         |spawn/subagent wrapper             |subagent hook/log                  |M10/M11 NOT OBSERVED                               |
|plan·state·checkpoint·stall                  |DERIVED/CONDITIONAL |state artifacts + runner watchdog  |state artifacts + runner watchdog  |M12–M14 blocked or NOT OBSERVED                    |
|token usage·provider cost                    |BEST_EFFORT         |provider/runtime metadata          |provider/runtime metadata          |M20 uses calls·wall·human time only or NOT OBSERVED|
|human active time·takeover                   |REQUIRED for M18/M20|explicit intervention event + timer|explicit intervention event + timer|M18/M20 NOT OBSERVED                               |

Adapter acceptance

• aos doctor --capabilities --runtime <runtime>는 위 matrix의 실제 상태와 근거 source를 출력해야 한다.
• run 시작 시 capability snapshot과 adapter digest를 저장한다.
• parity fixture는 동일한 semantic event가 두 runtime에서 같은 normalized trace를 만드는지 검사한다.
• native event가 없다는 이유로 조용히 추정하지 않는다. DERIVED 근거가 없으면 UNAVAILABLE이다.
• adapter coverage 부족을 사용자 능력 부족으로 해석하지 않는다.

9.3 CLI

```bash
npx agentops-score doctor
# 설치 후 동일 명령: aos doctor
npx agentops-score fixtures verify
npx agentops-score doctor --capabilities --runtime codex

npx agentops-score snapshot \
  --runtime codex

npx agentops-score assess \
  --runtime codex \
  --suite coding-core-v0 \
  --form A

npx agentops-score score \
  --run ./runs/<id>

npx agentops-score report \
  --run ./runs/<id>

npx agentops-score retest \
  --runtime codex \
  --form B \
  --baseline ./runs/<id>

npx agentops-score export \
  --run ./runs/<id> \
  --anonymous
```

export --anonymous만 선택적 외부 공유 경로다. 기본 telemetry는 OFF다.

9.4 공개 repository

```text
agentops-score/
├─ packages/
│  ├─ schema/
│  ├─ scorer/
│  ├─ runner/
│  └─ reporter/
├─ adapters/
│  ├─ codex/
│  └─ claude-code/
├─ suites/
│  └─ coding-core-v0/
├─ fixtures/
│  ├─ reference-pass/
│  ├─ reference-fail/
│  ├─ false-completion/
│  ├─ stale-evidence/
│  ├─ duplicate-run/
│  └─ unsafe-action/
├─ specs/
│  ├─ aos-trace.schema.json
│  └─ aos-result.schema.json
├─ conformance/
├─ examples/
├─ .aos/                    # local runs; gitignored
├─ docs/
│  ├─ VALIDATION.md
│  ├─ LIMITATIONS.md
│  ├─ INTENDED_USE.md
│  └─ north-star/
├─ CONTRIBUTING.md
├─ CODEOWNERS
└─ README.md
```

구체적 OSS 라이선스는 S4 공개 전 결정한다. 특정 라이선스는 현재 근거만으로 임의 고정하지 않지만, 라이선스·기여자 계약·third-party notice가 결정되지 않으면 G4 공개를 차단한다.

9.5 표준 trace event

최소 event:

```text
assessment.started / ended
adapter.capability_declared
task.started / ended
user.instruction / clarification
context.selected / injected / compacted
retrieval.query / result
memory.read / written / invalidated
tool.call / result / error
agent.delegated / returned
handoff.created / consumed
plan.created / revised
state.transition / checkpoint
intervention.occurred
approval.requested / granted / denied
evidence.created / invalidated
completion.claimed
safety.event
budget.updated
run.stalled / resumed / cancelled
```

공통 필드:

• event ID, run ID, task ID
• timestamp
• actor와 event type
• parent/correlation ID
• model·runtime·harness identity
• artifact/evidence digest
• redaction state
• bounded payload

hidden chain-of-thought는 저장하지 않는다.

9.6 로컬 데이터 원칙

필수:

• 모든 run·trace·report는 로컬
• raw code·prompt·terminal 전체의 중앙 업로드 없음
• secret value 저장 금지
• artifact digest와 최소 bounded excerpt 우선
• 사용자가 삭제·수정·재채점 가능

선택:

• export --anonymous로 aggregate contribution bundle
• 한시적인 alpha 캠페인 데이터셋
• PR fixture와 conformance 결과

금지:

• 중앙 상시 사용자 DB
• 기본 telemetry
• 사용자 동의 없는 project trace 수집
• 평가 데이터의 모델 학습 전용
• cross-project memory 합성

9.7 공개 데모

1. Operator Gap: 같은 모델·도구에서 다른 운영 정책의 차이
2. False Completion: green claim과 hidden failure의 불일치
3. Stale Evidence: 수정 전 증거를 완료 근거로 쓰는 오류
4. Duplicate Retry: retry가 side effect를 중복시키는 오류
5. Harness Gap: 하네스 차이는 Opportunity facet임을 교육하는 데모
6. Scorer Repro: 같은 fixture가 같은 JSON을 내는 asciinema/GIF

Harness Gap 데모는 인간 점수가 아니라 facet 설명용이라고 명시한다.

────────

10. 근거를 지표로 흡수하는 방식

공식 문서나 인기 OSS를 그대로 정답으로 취급하지 않는다.

```text
공식 원칙·실제 구현
→ 도구 중립적 불변식
→ 관찰 가능한 행동
→ 평가 기회
→ oracle·metric
→ 사람 데이터 검증
```

|출처군          |실제로 흡수하는 로직                                                                                                            |연결 지표                     |
|-------------|-----------------------------------------------------------------------------------------------------------------------|--------------------------|
|**OpenAI**   |목표·환경·feedback loop, agent-readable repo knowledge, mechanical invariant, workspace isolation                          |M01–M07, M15–M19          |
|**Anthropic**|context budget, task/trial/grader 분리, deterministic-first, repeated evaluation, subagent cost, containment             |M05–M07, M10–M12, M15–M20 |
|**OmO**      |planning/execution 분리, orchestrator role boundary, continuation, changed-file→test→hands-on QA gate                    |M08–M18                   |
|**OMX**      |ambiguity gating, fact vs human decision, acceptance-first, dependency-aware lanes, durable state, stop rule           |M03–M04, M09–M14          |
|**LazyCodex**|hierarchical project memory, durable checklist, verified completion loop, role·model routing                           |M05–M06, M10–M14, M17, M20|
|**OpenClaw** |scheduler persistence, duplicate suppression, watchdog, task reconciliation, stale acknowledgement, permission boundary|M12–M14, M17, M19–M20     |
|**Hermes**   |provider fallback, persistent memory, isolated subagents, worktree/backend isolation, cross-session continuity         |M06–M07, M10–M13, M19–M20 |
|**최신 연구**    |human intervention timing, false completion, multi-agent failure, judge reliability, harness opportunity               |M03, M09–M11, M17–M20     |

어떤 도구가 특정 기능을 제공한다는 이유만으로 사용자에게 가점을 주지 않는다. 다른 방식으로 같은 invariant를 더 단순하고 안전하게 달성하면 동일하거나 더 높은 평가를 받을 수 있다.

────────

11. 구현 범위

11.1 포함

• AOS-Coding
• adapter observability contract
• pack budget·eligibility simulation
• deterministic lever rule v0
• 20개 scored metrics
• 6 families
• Form A/B
• Codex·Claude Code adapter
• local isolated runner
• deterministic oracle와 M19 hard gate
• normalized trace schema
• Markdown/JSON report
• public fixtures와 scorer
• Snapshot ESTIMATE
• Verified Core PROVISIONAL
• one-lever Improvement Sprint
• opt-in anonymous export

11.2 90일 비목표

• SaaS
• payments
• account
• central user database
• team dashboard
• Live cloud audit
• public leaderboard
• percentile
• hiring·credential
• AOS-General
• 124 metrics
• third runtime
• 복수 governance board
• “industry standard” claim

11.3 기능 요구사항

|ID   |요구사항                                |MVP acceptance              |
|-----|------------------------------------|----------------------------|
|FR-01|runtime·model identity를 기록          |unknown이면 report에 제한 표시     |
|FR-02|fresh immutable workspace           |base digest 일치              |
|FR-03|worker와 oracle 분리                   |worker access 실패            |
|FR-04|Codex·Claude event를 표준 trace로 변환    |parity fixture 통과           |
|FR-05|Opportunity Profile 생성              |필수 필드 누락 시 점수 차단            |
|FR-06|time·token·tool·permission budget 강제|명확한 terminal reason         |
|FR-07|fault injection version·replay      |동일 seed에서 동일 기회             |
|FR-08|20 metrics eligibility              |기회 없음은 `NOT OBSERVED`       |
|FR-09|deterministic grader 우선             |judge가 verdict를 뒤집지 못함      |
|FR-10|completion claim을 exact evidence와 결박|stale evidence 무효화          |
|FR-11|S2/S3 hard gate                     |품질과 무관하게 점수 미발급             |
|FR-12|AOS-P0·6요인·coverage·safety 표시       |report contract 통과          |
|FR-13|metric→event→artifact drill-down    |추적 링크 제공                    |
|FR-14|개선 레버 1개                            |evidence·비용·retest 포함       |
|FR-15|A/B exposure 추적                     |동일 form 반복 시 growth 금지      |
|FR-16|Snapshot 구분                         |모든 출력에 `ESTIMATE`           |
|FR-17|local-only 기본                       |업로드 없이 평가 가능                |
|FR-18|scorer 결정론                          |conformance bit-repro       |
|FR-19|judge confidence·abstain            |threshold 미만 secondary route|
|FR-20|score version·digest                |없는 export 금지                |

11.4 비기능 요구사항

|ID    |요구사항                |목표                                         |
|------|--------------------|-------------------------------------------|
|NFR-01|재현성                 |동일 fixture에서 bit-for-bit 동일                |
|NFR-02|trace integrity     |필수 event 누락 시 score 차단                     |
|NFR-03|격리                  |run 간 workspace·secret·process 분리          |
|NFR-04|개인정보 최소화            |metadata·digest 우선                         |
|NFR-05|portability         |macOS/Linux, runtime-neutral schema        |
|NFR-06|observability       |phase·budget·stall·grader 기록               |
|NFR-07|failure transparency|silent fallback 금지                         |
|NFR-08|auditability        |score→metric→event→artifact                |
|NFR-09|performance         |orchestration overhead ≤ task budget 10% 목표|
|NFR-10|versioning          |schema·suite·scorer semver                 |
|NFR-11|vendor neutrality   |vendor 내부 파일을 능력 조건으로 요구 금지                |
|NFR-12|accessibility       |keyboard·screen-reader·시간 accommodation 고려 |

11.5 실패 의미론

|상태                     |의미                          |처리              |
|-----------------------|----------------------------|----------------|
|`PASSED`               |acceptance와 safety 충족       |정상              |
|`FAILED`               |평가 가능한 실패                   |점수·진단 포함        |
|`BLOCKED`              |인간·외부 결정 필요                 |판단 정확성 평가       |
|`TIMED_OUT`            |budget 초과                   |실패 또는 진단        |
|`STALLED`              |non-terminal, no progress   |M14 실패 후보       |
|`CANCELLED`            |사용자·시스템 취소                  |coverage에 따라 미발급|
|`UNSAFE`               |S2 이상                       |점수 미발급          |
|`INVALID`              |oracle 노출·tamper·identity 문제|평가 제외           |
|`INSUFFICIENT_EVIDENCE`|coverage·integrity 부족       |능력 부족으로 해석 금지   |

────────

12. 구현 순서

12.1 강제 순서

```text
M01–M20 freeze
→ adapter observability matrix
→ pack time·eligibility simulation
→ deterministic lever rule v0
→ trace/result schema
→ deterministic scorer
→ conformance fixtures
→ isolated runner
→ Codex adapter
→ Claude Code adapter
→ 6-family Form A
→ report + one lever
→ Snapshot
→ Form B + sprint
→ human alpha
→ public release
```

UI, 웹 대시보드, third runtime, 복잡한 통계 모형은 이 순서를 앞설 수 없다. 특히 adapter 관측성·45분 pack 예산·lever rule을 닫지 않은 채 schema와 scenario를 동결하지 않는다.

12.2 에픽

|#      |Epic                                              |Done when                                                                |
|-------|--------------------------------------------------|-------------------------------------------------------------------------|
|**E0** |M01–M20 freeze + preflight contracts              |metric version pin, adapter matrix, pack budget simulation, lever rule v0|
|**E1** |`aos-trace` / `aos-result` schema                 |JSON Schema CI, capability snapshot 포함                                   |
|**E2** |scorer + pass/fail/stale/duplicate/unsafe fixtures|G0                                                                       |
|**E3** |isolated runner + budget + oracle isolation       |FR-02/03/06/07                                                           |
|**E4** |Codex adapter                                     |capability report + parity fixture                                       |
|**E5** |Claude Code adapter                               |capability report + parity fixture                                       |
|**E6** |FAM-1..6 Form A                                   |pack-level ≥14 eligible metrics, reference p90 ≤45m, hidden oracle       |
|**E7** |Markdown/JSON report                              |AOS-P0, F1–F5, F6 Efficiency, Safety state, 1 deterministic lever        |
|**E8** |Snapshot                                          |`ESTIMATE` contract                                                      |
|**E9** |Form B + sprint protocol                          |G3 path                                                                  |
|**E10**|README·demo·CONTRIBUTING                          |외부 설치 가능                                                                 |
|**E11**|20명 alpha + `VALIDATION.md`                       |G1·G2                                                                    |
|**E12**|외부 재현과 첫 contribution                             |G4, 라이선스 결정 완료                                                           |

E0–E12 사이에 새 metric이나 도메인 에픽을 삽입하지 않는다.

13. 90일 실행 계획

S0 — Freeze

• 이전 브랜드 기획을 docs/north-star/legacy/에 보관
• 이 문서를 AOS 기준본으로 선언
• 20×6×P0 계약 동결
• 브랜드 AgentOps Score, 약칭 AOS, 패키지 agentops-score, CLI aos 고정
• adapter observability matrix v0 작성
• 45분×pack-level 14 metrics budget simulation
• deterministic primary constraint·lever rule v0 동결
• 유료화·SaaS·enterprise 섹션 재도입 금지

S1 — G0 Scorer Truth

• trace/result schema
• 20-metric scorer
• pass/fail/stale/duplicate/unsafe fixtures
• bit-repro CI
• doctor, fixtures verify
• false-completion 공개 데모

S2 — Runner·Adapters·Form A

• isolated runner
• aos doctor --capabilities
• Codex adapter
• Claude Code adapter
• runtime별 required/conditional event coverage 공개
• 6 families Form A
• reference p90 ≤45m 검증
• Markdown/JSON report
• F6 Efficiency와 Safety 분리 표시
• deterministic one-lever diagnosis

S3 — Human Alpha·Form B

• known-groups 20명
• blind expert review
• 일부 model/harness crossover
• Form B subset
• treatment 1개
• VALIDATION.md, LIMITATIONS.md

S4 — Public OSS

• GitHub 공개
• one-command demo
• operator-gap·false-completion demo
• contribution bundle
• metric RFC issue template
• OSS 라이선스·third-party notice 확정
• 외부 fixture 재현 1건 이상

S5 — 증거가 있을 때만

• third runtime
• 50~100명 추가 alpha
• G-study·form linking
• beta score model
• matched N≥300 이후 percentile 검토

────────

14. 성공과 중단 기준

14.1 성공

1. 같은 fixture에서 누구나 같은 scorer 결과를 얻는다.
2. false completion·stale evidence·unsafe action을 놓치지 않는다.
3. 기본 평가 median이 45분 이내다.
4. 사용자 간 차이가 task·session noise보다 크다.
5. 점수가 model strength나 token spend만 반영하지 않는다.
6. expert와 novice가 단순 사용량이 아닌 운영 행동으로 구분된다.
7. 자동 metric과 blind expert 판단이 설명 가능한 수준으로 합의한다.
8. 사용자가 낮은 점수에서도 다음 행동을 이해한다.
9. 한 가지 처방이 Form B에서 개선 신호를 만든다.
10. 외부 사용자가 adapter·fixture·scenario를 기여한다.

14.2 중단 또는 재설계

다음 중 하나가 확인되면 0~100 점수 확장을 멈춘다.

• person variance가 task/session noise보다 작음
• score가 거의 전적으로 model·harness로 설명됨
• known group이 분리되지 않음
• automatic metric과 expert agreement가 지속적으로 낮음
• 45분 안에 평가가 닫히지 않음
• Form A/B 관계가 없음
• 처방이 다른 Form에서 전혀 전이되지 않음
• safety false negative가 높음
• 사용자 결과 이해도가 낮고 FOMO만 증가함

14.3 허용되는 피벗

개인 latent score가 성립하지 않아도 다음은 남길 수 있다.

• agent workflow diagnostics
• false-completion·recovery suite
• harness regression tool
• open trace/scorer specification
• operator coaching lab

이 경우 AOS 개인 종합 점수 주장은 축소하거나 폐기한다.

────────

15. 리스크

|리스크                                |심각도|대응                                                     |
|-----------------------------------|--:|-------------------------------------------------------|
|일반 AI fluency quiz로 인식             |치명 |human agent operations 메시지 고정                          |
|모델·하네스 benchmark로 오인               |치명 |human operator가 평가 단위임을 반복                             |
|문서만 크고 코드가 없음                      |치명 |G0 scorer를 유일한 진실로                                     |
|20 metrics도 구현 과중                  |높음 |family별 최소 eligibility, metric 추가 금지                   |
|45분과 pack-level 14 metrics가 동시에 불성립|치명 |E0 budget simulation, scenario당 primary opportunity ≤4 |
|runtime trace 관측성 부족               |치명 |adapter capability matrix, 누락은 NOT OBSERVED/score block|
|처방 선택이 임의적                         |높음 |deterministic constraint·treatment map v0              |
|calibration 전 가짜 정밀도               |치명 |PROVISIONAL, no percentile                             |
|LLM judge 불신                       |높음 |deterministic-first, abstain, reliability file         |
|FOMO dark pattern                  |높음 |agency framing, no shame rank                          |
|특정 하네스 편향                          |높음 |observable invariant와 multi-runtime                    |
|local task leakage                 |높음 |자기개선용 한계 명시, no credential                             |
|중앙 수집 유혹                           |높음 |telemetry OFF, opt-in export only                      |
|상용 섹션이 범위를 다시 키움                   |높음 |문서에서 완전 제거                                             |
|GitHub 바이럴 실패                      |높음 |5분 demo, false-completion fixture, contributor path    |
|채용·감시 오용                           |높음 |`INTENDED_USE.md`, 결과 라벨                               |
|metric gaming                      |중간 |opportunity denominator, hidden traps                  |
|model drift                        |중간 |exact identity, versioning, bridge 필요                  |

────────

16. 최종 고정 결정

1. 프로젝트명은 AgentOps Score, 약칭은 AOS다.
2. 공개 패키지는 agentops-score, CLI 바이너리는 aos, 로컬 경로는 .aos/다.
3. 제품은 100% OSS·local-first다.
4. 유료화·SaaS·엔터프라이즈 판매 계획은 없다.
5. 평가 단위는 인간 operator다.
6. 환경은 Opportunity Profile로 선언하고, 환경의 성능과 사용자의 운영 기여를 구분한다.
7. 초기 도메인은 코딩 에이전트 운영 하나다.
8. AI FOMO는 진입 동기이며 점수 입력이 아니다.
9. 공식 점수는 실제 과제와 full trace가 있어야 한다.
10. Snapshot은 ESTIMATE, Verified Core는 PROVISIONAL이다.
11. 20개 지표와 6개 family를 alpha 전까지 동결한다.
12. 14 metrics observed는 pack-level 요구이며 scenario별 요구가 아니다.
13. Codex와 Claude Code를 먼저 지원하되 capability matrix로 관측 범위를 공개한다.
14. 기술 사용량과 복잡성은 가점하지 않는다.
15. M19 S2 이상은 hard fail이다.
16. coverage 70% 미만이면 점수를 발급하지 않는다.
17. matched N<300에서는 percentile을 제공하지 않는다.
18. one-lever treatment와 Form B 전이를 제품의 핵심으로 둔다.
19. primary constraint와 treatment 선택은 P0에서 결정론적 규칙을 따른다.
20. F6 Efficiency(M20)와 Safety(M19 state)를 별도 표시한다.
21. 중앙 DB와 기본 telemetry는 만들지 않는다.
22. 공개 schema·fixtures·scorer가 신뢰의 시작이다.
23. stars보다 bit-repro와 external reproduction을 우선한다.
24. 채용·인증·감시 용도를 허용하지 않는다.
25. 현재 업계 표준이라고 주장하지 않는다.
26. S4 공개 전 OSS 라이선스와 third-party notice를 확정한다.
27. 다음 작업은 새 기획 확장이 아니라 E0 preflight contracts와 E1–E2 구현이다.

부록 A. Metric–Family 추적성

|Metric|FAM-1|FAM-2|FAM-3|FAM-4|FAM-5|FAM-6|
|------|:---:|:---:|:---:|:---:|:---:|:---:|
|M01   |●    |     |     |     |●    |     |
|M02   |●    |     |●    |     |●    |●    |
|M03   |●    |     |     |     |     |●    |
|M04   |●    |     |     |     |●    |     |
|M05   |     |●    |●    |●    |     |     |
|M06   |     |●    |     |●    |     |     |
|M07   |     |●    |     |●    |●    |●    |
|M08   |     |     |●    |     |     |     |
|M09   |     |     |●    |●    |     |     |
|M10   |     |●    |●    |     |     |●    |
|M11   |     |     |●    |●    |     |     |
|M12   |     |     |     |●    |●    |     |
|M13   |     |     |     |●    |     |●    |
|M14   |     |     |     |●    |●    |●    |
|M15   |●    |●    |●    |●    |●    |●    |
|M16   |●    |     |●    |     |●    |     |
|M17   |●    |●    |     |●    |●    |●    |
|M18   |     |     |     |●    |●    |●    |
|M19   |     |●    |●    |     |     |●    |
|M20   |     |     |●    |     |     |●    |

이 표의 ●는 해당 family의 pack 설계에서 그 metric opportunity가 발생할 수 있음을 뜻한다. 모든 micro-scenario가 해당 metric을 완전하게 관찰한다는 뜻이 아니다. 특히 M15는 pack의 여러 outcome unit을 합산해 산출하며, scenario 하나의 성공·실패만으로 개인 능력을 확정하지 않는다.

단일 scenario의 행동 하나로 개인 능력을 확정하지 않는다.

부록 B. 최소 결과 예시

```text
AOS-Coding-P0.1                       78 / 100
상태                                   PROVISIONAL
Evidence coverage                      86%
Safety                                 SAFE (S0)
Opportunity                            Codex / native / standard
Matched percentile                     NOT AVAILABLE

F1 Intent & Contract                   82
F2 Context & Information               77
F3 Graph & Orchestration               73
F4 Loop & State                        61
F5 Verification & Recovery             88
F6 Efficiency & Value                  79
Safety                                 SAFE (S0)

Primary constraint
- reviewer FAIL 이후 active worker 0 상태가 지속됨
- 새 세션 handoff에 blocker와 latest evidence digest 누락

One lever
- Recovery Watchdog

Retest
- 7일 후 Form B
- M14·M18 개선
- M15–M17 비악화
- M19 SAFE 유지
```

부록 C. 공개 전 체크

☐ M01–M20 version freeze
☐ adapter observability matrix
☐ aos doctor --capabilities
☐ pack-level 14 metrics budget simulation
☐ deterministic lever rule v0
☐ trace/result schema CI
☐ fixture bit-repro
☐ false-completion catch
☐ stale-evidence invalidation
☐ duplicate-run suppression
☐ unsafe hard gate
☐ Codex adapter parity
☐ Claude Code adapter parity
☐ Form A median ≤40m and p90 ≤45m
☐ local-only default
☐ telemetry OFF
☐ PROVISIONAL label
☐ no percentile
☐ LIMITATIONS.md
☐ INTENDED_USE.md
☐ OSS license and third-party notices
☐ external fixture reproduction

────────

> **AOS의 목표는 거대한 평가 산업을 만드는 것이 아니다.**  
> **“내 에이전트 운영 환경과 사용 방식은 실제로 얼마나 좋은가?”라는 질문에 재현 가능한 수치와 다음 행동으로 답하는, 작고 정직한 공개 측정기를 만드는 것이다.**