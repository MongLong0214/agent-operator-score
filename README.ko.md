<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**차가 아니라, 운전자를 봅니다.**

[![CI](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml/badge.svg)](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/MongLong0214/agent-operator-score?sort=semver)](https://github.com/MongLong0214/agent-operator-score/releases)
[![node](https://img.shields.io/badge/node-22%20%7C%2024-informational)](package.json)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-informational)](package.json)
[![status](https://img.shields.io/badge/status-experimental%20%2F%20provisional-orange)](docs/LIMITATIONS.md)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

<p align="center">
  <a href="README.md">English</a> ·
  <strong>한국어</strong> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

</div>

---

AI 코딩 에이전트 자체를 시험하는 도구는 많습니다. AOS는 **그걸 시키는 사람**을 봅니다.

여기서 사람은 에이전트가 아닙니다. 에이전트에게 일을 맡기고, 필요한 자료를 골라 주고, 막히면
개입하고, 결과를 받아들일지 결정하는 **사용자**, 즉 운영자(operator)입니다.

같은 에이전트에게 같은 일을 시켜도 결과는 달라집니다. 어떤 운영자는 무엇을 만들지 정확히 말하고,
불필요한 자료를 걸러 내고, 실패하면 지시를 바꾸며, “다 됐습니다”라는 말을 직접 확인합니다. 다른
운영자는 같은 실패를 계속 반복하게 두거나, 검증하지 않은 결과를 그대로 완료로 받아들입니다.

**AOS는 이 차이를 확인하는 로컬 도구입니다.**

<img src="docs/assets/aos-driver-vs-agent-ko.svg" alt="에이전트는 차, 사용자는 운전자이며 채점표가 운전자를 가리키는 그림" width="960">

> [!WARNING]
> AOS는 현재 `EXPERIMENTAL / PROVISIONAL` 상태입니다. 결과는 특정 에이전트·모델·설정·머신·
> 과제에서 나온 값일 뿐이며, 채용·승진·직원 감시·자격 인증에 사용하면 안 됩니다.

## 가장 먼저: Claude Code 세션 복기하기

Claude Code를 사용한다면 저장소를 복제하거나 `npm install`을 실행할 필요가 없습니다.

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

`/aos-review`는 방금 끝난 세션을 복기합니다. AOS의 review 엔진 자체는 모델을 새로 호출하지
않습니다. `/aos-assess`는 다릅니다. 등록된 에이전트 CLI를 실제로 실행하므로 모델 사용량이
발생합니다.

플러그인은 저장소 설정, 에이전트 수동 등록, 계획서 직접 작성을 대신합니다. 다만 내부에서 Node를
사용하므로 Node `>=22.18 <25`가 필요하고, 평가에 사용할 Claude Code 또는 Codex CLI가 설치되고
로그인돼 있어야 합니다.

플러그인이 평가 중간의 판단까지 대신해 주지는 않습니다. 공식 점수를 받으려면 안내에 따라 본인
터미널에서 체크포인트에 직접 답해야 합니다. 다른 에이전트가 대신 답하면 사용자 점수가 아니라 그
에이전트의 판단 방식을 재게 됩니다.

저장소에서 직접 실행하려면 다음과 같이 시작합니다.

```bash
git clone --depth 1 --branch dev https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review
```

기본 브랜치는 `dev`입니다. 특정 버전을 그대로 재현하려면
[GitHub Releases](https://github.com/MongLong0214/agent-operator-score/releases)의 태그를 사용하세요.

## AOS가 보는 것: 차가 아니라 운전

일반적인 벤치마크는 이렇게 묻습니다.

> 이 모델이 저 모델보다 더 빠르고 정확한가?

AOS가 묻는 질문은 다릅니다.

> 같은 도구를 주었을 때, 사용자는 일을 얼마나 잘 맡기고 조정하고 확인했는가?

자동차로 비유하면 에이전트는 **차**, 운영자는 **운전자**입니다. AOS가 보는 것은 차의 최고속도가
아닙니다. 운전자가 목적지를 제대로 정했는지, 잘못된 길을 알아챘는지, 위험한 상황에서 멈췄는지,
도착한 뒤 정말 맞는 곳인지 확인했는지를 봅니다.

<img src="docs/assets/aos-benchmark-vs-operator-ko.svg" alt="일반 벤치마크는 차를 재고 AOS는 운전을 잰다는 비교 그림" width="960">

AOS에는 이를 확인하는 두 가지 기능이 있습니다.

## 두 기능: `review`와 `assess`

| | `aos review` | `aos assess` |
|---|---|---|
| 하는 일 | 실제 세션에서 위험할 수 있는 패턴을 찾아 사람이 확인할 후보로 보여 줍니다 | 정해진 여섯 과제를 실행해 운영 과정과 결과를 요약합니다 |
| 대상 | 로컬에 저장된 Codex·Claude Code·Grok CLI 세션 기록 | 등록된 Codex·Claude Code 등 에이전트 CLI |
| 모델 사용량 | review 엔진은 모델을 부르지 않고 기존 기록만 읽습니다 | 있습니다. 에이전트를 실제로 실행합니다 |
| 결과 | 문제가 의심되는 단계와 그 근거 | 100점 만점 점수 또는 점수를 내지 않은 이유 |

처음에는 `review`부터 사용하는 편이 좋습니다. 비용 없이 내 실제 작업 기록으로 AOS가 어떤 식으로
판단하는지 확인한 뒤, 필요할 때 `assess`를 실행하세요.

### `review` — 이미 끝난 작업을 복기합니다

```bash
node bin/aos.mjs review                         # 가장 최근 세션
node bin/aos.mjs review --since 12              # 최근 12개 세션에서 반복된 패턴
node bin/aos.mjs review --list                  # 검토할 수 있는 세션 경로 보기
node bin/aos.mjs review --session "<경로>"      # 목록에서 고른 세션 검토
node bin/aos.mjs review --json                  # JSON으로 출력
```

`review`가 내놓는 것은 확정 진단이 아니라 **검토 후보**입니다. 반드시 원래 세션과 대조해 실제로
맞는지 확인해야 합니다.

| 규칙 | 쉽게 말하면 |
|---|---|
| `completion-claimed-without-verification` | 에이전트가 완료를 주장했지만 마지막 수정 뒤 테스트나 검증을 다시 하지 않았습니다 |
| `session-ended-on-stale-evidence` | 마지막 수정 이후 새로운 검증 근거 없이 세션이 끝났습니다 |
| `edits-outside-the-working-directory` | 에이전트가 현재 작업 중인 프로젝트 밖의 파일을 바꿨습니다 |
| `destructive-command-executed` | 데이터 손실 가능성이 있는 되돌리기 어려운 명령을 실행했습니다 |
| `secret-material-in-session` | API 키·토큰·개인 키 같은 비밀값이 세션에 나타났습니다 |
| `long-uninterrupted-tool-run` | 사람의 개입 없이 긴 실행이 이어졌고, 그 안에서 실패나 같은 행동이 반복됐습니다 |
| `completion-claimed-over-a-failed-check` | 바로 앞 검증이 실패했는데도 완료했다고 말했습니다 |
| `verification-exit-status-discarded` | 검증 명령 뒤에 `\|\| true`를 붙여 실패 상태를 없애 버렸습니다 |

한 세션은 “이번에 무슨 일이 있었나”를 보여 줍니다. 여러 세션을 함께 보면 “나는 어떤 문제를 계속
반복하나”가 보입니다.

현재 `review` 규칙은 독립 측정에서 목표 정확도에 미치지 못했습니다. 수정된 규칙을 새로운 미사용
세션으로 다시 측정하기 전까지는 신뢰도 높은 자동 판정기가 아니라, 사람이 살펴볼 지점을 알려 주는
도구로 봐야 합니다.

### `assess` — 실습 과제로 운영 방식을 점검합니다

`assess`는 AOS가 준비한 여섯 과제를 에이전트에게 실제로 맡깁니다. 에이전트가 “완료했습니다”라고
말했다고 점수를 주지는 않습니다. 에이전트의 자기 보고와 별개인 검증기가 실제 산출물과 실행 기록을
확인하고, 운영자가 막힌 상황에서 어떻게 판단했는지도 함께 봅니다.

> [!CAUTION]
> `aos init`이 `PATH`에서 Claude Code를 찾으면 비대화형 실행을 위해
> `--dangerously-skip-permissions`로 등록합니다. 이 설정은 Claude Code 자체의 권한 확인을
> 건너뜁니다. AOS의 임시 작업 공간·임시 `HOME`·환경 변수 필터링은 유지되지만, 플래그의 의미를
> 이해한 뒤 평가를 실행하세요.

```bash
node bin/aos.mjs init                   # PATH에서 Claude Code·Codex를 찾아 자동 등록
node bin/aos.mjs doctor                 # 실행 파일과 인증 경로를 먼저 점검

node bin/aos.mjs assess                 # 무인 진단: 공식 점수는 나오지 않음
node bin/aos.mjs assess --checkpoints   # 운영자가 직접 참여하는 점수 실행
```

`init`은 사용자가 이미 설정한 에이전트를 덮어쓰지 않습니다. 계획서를 따로 지정하지 않으면 AOS가
실행 가능한 기본 `aos-plan.json`을 만들어 사용합니다. 계획서는 자기평가 설문지가 아니며, 문서를
그럴듯하게 작성한 것 자체는 점수에 들어가지 않습니다.

`doctor`는 실행 파일과 인증 경로를 확인하지만 모델을 실제로 부르지는 않습니다. 실행이 아예
시작되지 않았거나 서로 다른 과제가 같은 설정 문제로 연달아 실패하면, AOS는 이를 운영자의 낮은
점수로 계산하지 않고 점수화를 중단합니다.

## 채점표에 적히는 여섯 가지

<img src="docs/assets/aos-six-dimensions-ko.svg" alt="AOS가 보는 여섯 영역을 쉬운 질문으로 정리한 그림" width="960">

1. **뭘 만들지 말했나** (`Task Specification`) — 목표, 하지 말아야 할 것, 완료라고 할 조건
2. **뭘 보여 줬나** (`Context Engineering`) — 맞는 자료를 골랐는지, 낡거나 수상한 자료를 걸렀는지
3. **일을 어떻게 쪼갰나** (`Decomposition & Routing`) — 누구에게 무엇을 맡기고 결과를 어떻게 합쳤는지
4. **막혔을 때 뭘 했나** (`Human-in-the-Loop Control`) — 실패를 알아차리고 지시를 바꾸거나 멈췄는지
5. **진짜 되는지 봤나** (`Evaluation & Verification`) — “다 됐습니다”를 별도 근거로 확인했는지
6. **안전하고 싸게 했나** (`Guardrails, Recovery & Cost`) — 비밀, 권한, 복구 방법, 호출 예산을 지켰는지

이 여섯 영역은 다시 20개 지표로 나뉘며, 각 지표는 네 개의 구체적인 확인 항목으로 평가됩니다.

## 체크포인트: 막혔을 때 무엇을 했는가

과제가 막히거나 같은 실패가 반복되면 AOS가 실행을 잠시 멈추고 지금까지 확인한 근거를 보여 줍니다.
현재 체크포인트는 네 가지를 차례로 예·아니요로 묻습니다.

```text
AOS checkpoint (1 of 3) — repeated-failure
blocked before this stage: the migration step times out
  repeated unchanged  retry-tests:retry-7

  | goal: cut the report over
  | latest evidence: sha256:67a666c03d22
  | event: retry-tests (retry-7)
  | event: retry-tests (retry-7)
  evidence 16368376f56a83d9

  y or Enter:
    Show the full evidence?
    Send it to another agent?
    Stop here?
    Change the instruction?
  answering no to all four retries the stage unchanged
  agents: codex
```

**어떤 질문에 예라고 답했는지가 점수는 아닙니다.** 실제 지시가 달라졌는지, 다른 에이전트로 경로가
바뀌었는지, 중단을 골랐다면 정말 멈췄는지, 그 뒤에 같은 실패를 또 반복했는지를 봅니다. 네 질문에
모두 아니요라고 답하면 같은 단계를 바꾸지 않고 다시 시도합니다.

`--checkpoints` 없이 실행하면 운영자의 판단을 관찰할 수 없습니다. 에이전트 결과와 참고용 계산값은
남지만 공식 점수는 `INCOMPLETE`로 보류됩니다. 플러그인이나 다른 에이전트가 대신 답해도 같은
문제가 생깁니다.

## 못 본 것은 0점이 아닙니다

운전 시험에서 시험관이 주차를 볼 기회가 없었다고 해 보겠습니다. 이때 주차를 0점 처리하면 “주차를
못했다”와 “주차를 보지 못했다”를 같은 일로 취급하게 됩니다.

<img src="docs/assets/aos-not-observed-ko.svg" alt="20개 중 3개만 관찰해 AOS가 0점을 주지 않고 점수를 보류하는 그림" width="960">

AOS는 상태를 구분합니다.

- **실패** — 확인해 보니 조건을 지키지 못했습니다.
- **`NOT_OBSERVED`** — 판단할 근거를 얻지 못했습니다.
- **`INCOMPLETE`** — 중요한 항목을 충분히 보지 못해 공식 점수를 내지 않습니다.

20개 지표 중 최소 18개를 관찰해야 하며, 기능 결과·독립 검증·최종 버전·완료 주장·복구·안전에
해당하는 핵심 지표도 반드시 확인돼야 합니다. 빈 결과물이나 아무 말도 하지 않은 실행이 좋은 점수를
받지는 않습니다. **침묵은 통과가 아닙니다.**

`provisional_raw`는 문제를 고칠 때 참고하는 임시 계산값일 뿐 공식 점수가 아닙니다.

## 같은 83점도 같은 점수가 아닙니다

다른 차, 다른 코스, 다른 날씨에서 받은 두 개의 83점은 같은 운전 시험 결과가 아닙니다.

<img src="docs/assets/aos-profile-bound-ko.svg" alt="서로 다른 에이전트와 조건에서 나온 83점 두 개는 직접 비교할 수 없다는 그림" width="960">

점수의 의미는 다음 조건에 따라 달라집니다.

- 어떤 에이전트와 모델을 썼는가
- CLI 버전과 실행 설정은 무엇인가
- 어떤 머신과 격리 수준에서 돌렸는가
- 어떤 과제 묶음·suite 버전·시드를 사용했는가

AOS는 이런 조건을 점수와 함께 기록합니다. 이를 `PROFILE-BOUND`라고 부릅니다. 프로필이 다른 두
숫자는 서로 다른 조건을 잰 값이므로 같은 시험 결과처럼 비교하면 안 됩니다.

| AOS가 아닌 것 | 이유 |
|---|---|
| 사람의 종합적인 AI 활용 능력 점수 | 특정 조건에서 관찰한 한 번의 실행 결과입니다 |
| 모델·CLI·하네스의 일반적인 우열 비교 | 프로필이 다른 두 점수는 서로 다른 것을 잰 값입니다 |
| 백분위·순위·자격증 | 비교할 모집단과 기준 점수가 없습니다 |
| 채용·승진·직원 감시 도구 | 사람에게 불이익을 주는 용도로 사용하지 않도록 명시돼 있습니다 |
| SaaS 또는 텔레메트리 서비스 | 실행 기록과 리포트는 로컬에 남고 AOS 자체 수집 서버가 없습니다 |
| 검증이 끝난 과학적 측정 도구 | 교정 연구·독립 재현·전문가 검토가 아직 완료되지 않았습니다 |

초기 버전에는 운영자가 작성한 JSON 계획서의 모양만 보고 20개 지표 중 17개를 정하는 문제가
있었습니다. 내용이 사실상 무의미한 계획서도 `17/17`을 받을 수 있었습니다. 현재는 계획서가 점수
입력이 아니며, 지표는 실제 실행에서 관찰되거나 `NOT_OBSERVED`로 남습니다.

과제와 채점 로직은 `lib/suite.mjs`에 공개돼 있습니다. AOS는 비밀 정답을 맞히는 시험이 아니라,
같은 조건에서 자신의 운영 방식을 반복해서 연습하고 점검하는 도구입니다.

## 세 번 실행해 한 점수로 묶는 이유

한 번의 실행은 우연과 모델 변동의 영향을 많이 받습니다. AOS는 시작할 때 시드(seed) 세 개를
고정하고 같은 실행 프로필에서 나온 결과를 하나의 사이클로 묶습니다.

```bash
node bin/aos.mjs cycle start                                  # 시드 3개 고정
node bin/aos.mjs cycle run --checkpoints                      # 고정된 시드로 차례대로 실행
node bin/aos.mjs cycle                                        # 유효한 실행의 중앙값
node bin/aos.mjs dashboard                                    # 로컬 읽기 전용 대시보드
```

현재 여섯 과제 중 세 과제만 시드에 따라 세부 조건이 달라집니다. 따라서 세 번의 반복을 전체
모집단에 대한 통계적 신뢰도나 보편적인 실력 증명으로 확대해서는 안 됩니다.

집계에는 고정된 시드·프로필·suite major·scorer major 조건을 유지하고, 정상 종료 기록과 공식
점수를 가진 실행만 들어갑니다. 제외된 실행은 이유와 함께 표시됩니다. 점수가 낮다는 이유로 유효한
실행을 버리거나 다시 돌릴 수는 없으며, 같은 시드는 아무것도 측정하지 못한 인프라 실패 뒤에만
재실행할 수 있습니다.

사이클을 잘못 시작했다면 `--force --reason "<이유>"`로 닫고 새로 시작할 수 있습니다. 이전
사이클의 시드·실행·점수는 중단 기록으로 그대로 남습니다.

최종 Operator Score는 유효한 실행들의 **중앙값**입니다. 같은 컴퓨터에서 반복했을 때 얼마나
흔들렸는지는 **local repeat evidence**라고 표시합니다. 통계적 신뢰도를 뜻하는 `confidence`라는
말은 쓰지 않습니다.

## 점수가 없거나 상한이 걸리는 경우

AOS는 숫자를 계산할 수 있다고 해서 무조건 공식 점수를 주지 않습니다. 관찰 범위, 핵심 지표,
실행 격리, 근거 조건을 충족하지 못하면 결과는 `INCOMPLETE`로 남습니다.

반대로 치명적인 문제를 실제로 확인했다면 단순히 몇 점을 깎는 대신 점수의 **최대치**를 제한합니다.

- 비밀 유출·금지된 외부 행동·작업 공간 이탈: 최대 **39점**
- 실패한 결과를 완료라고 주장함: 최대 **49점**
- 치명적인 오류를 처리하지 않고 계속 진행함: 최대 **59점**
- 검증 뒤 결과를 바꿔 검증 버전과 최종 버전이 달라짐: 최대 **69점**

다른 항목을 아무리 잘해도 해당 최대치를 넘을 수 없습니다. 위험한 실패가 평균 속에 묻히지 않게 하기
위해서입니다.

상한은 위반을 실제로 확인했을 때만 적용합니다. 결과물이 없어서 안전 여부를 판단하지 못한 실행은
자동으로 `UNSAFE`가 되는 것이 아니라 `INCOMPLETE`입니다.

등급은 `90+ HIGH RELIABILITY`, `75+ ADVANCED`, `60+ OPERATIONAL`, `40+ DEVELOPING`,
`0+ FRAGILE`로 표시됩니다. 이 이름은 해당 실행을 요약할 뿐 사람 전체의 능력이나 업계 순위를
뜻하지 않습니다.

## 실제로 측정한 결과와 현재 한계

아래는 실제 Codex를 한 컴퓨터에서 실행한 사례입니다. 각 사이클은 시드 세 개로 실행했고, 모든
실행에 운영자가 체크포인트로 참여했습니다.

| 사이클 | 에이전트 샌드박스 | Operator Score | 실행별 점수 | 범위 |
|---|---|---|---|---|
| 1 | 켬 | **69** | 69, 69, 83 | 14 |
| 2 | 끔 | *철회* | 49, 59, 89 | — |
| 3 | 끔 | **90** | 90, 87, 92 | 5 |

여기서 “에이전트 샌드박스”는 Codex 자체의 명령 실행 제한입니다. AOS가 제공하는 임시 작업 공간,
임시 `HOME`, 환경 변수 필터링은 별개의 경계이며 세 사이클 모두 유지됐습니다.

2번 사이클의 종합 점수는 철회했습니다. 한 번의 실행 점수를 시드 세 개에 중복 기록해 실제로는
한 실행을 세 번 센 값이었기 때문입니다. 개별 실행 점수는 남겼고, 여기서 발견한 결함 세 개는
3번 사이클 전에 수정했습니다.

`aos review` 규칙은 규칙 작성에 쓰지 않은 세션 320개로 한 번 평가했습니다. 고위험 지적 10건 중
실제로 맞은 것은 4건으로, 정밀도는 **0.400**이었습니다. 틀린 여섯 건은 수정했지만 같은 자료로
수정 결과를 확인한 값은 독립적인 두 번째 측정이 아니라 튜닝 결과입니다.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 현재 수용 조건 확인
```

해당 자료에는 새 검증에 쓸 수 있는 미사용 도구 세션이 남아 있지 않습니다. 새로운 holdout 세션이
쌓이기 전까지 현재 review 규칙의 수정 후 정확도는 확립되지 않았습니다. 자세한 내용은
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)에 있습니다.

## 결과물·보안·개인정보 보호

`assess`가 끝나면 다음 결과물이 만들어집니다.

- **`card.svg`** — 점수, 여섯 영역, 실행 조건, 가장 먼저 고칠 한 가지를 담은 한 장짜리 채점표
- **Markdown·HTML 리포트** — 근거, 통과·실패·미관찰 지표, 상한, 점수 보류 이유
- **JSON 결과** — 다른 도구가 읽을 수 있는 원본 데이터

공식 점수를 발급하지 않은 실행의 카드에는 참고용 숫자를 점수처럼 넣지 않고 **NO SCORE**와 이유를
표시합니다. `provisional_raw`가 공유용 점수로 혼자 돌아다니지 않게 하기 위해서입니다.

HTML 리포트는 한국어 환경에서는 한국어로, 그 밖에서는 영어로 열립니다. 두 언어가 파일 안에 함께
들어 있고 CSS로 전환되므로 언어를 바꿀 때 외부 서버에 요청하지 않습니다.

| 항목 | 실제 동작 |
|---|---|
| AOS 자체 네트워크 | 대시보드는 `127.0.0.1`에만 열리고 토큰이 필요하며 읽기 전용·GET 전용입니다. 세션 원문을 반환하는 경로와 AOS 자체 수집 서버는 없습니다 |
| 에이전트 네트워크 | `assess`에서 실행되는 Codex·Claude Code는 작업을 수행하려고 각 모델 제공업체와 통신할 수 있습니다. 완전한 오프라인 실행은 아닙니다 |
| 실행 조건 | npm 런타임 의존성은 없지만 지원 범위의 Node가 필요합니다 |
| 에이전트 프로세스 | 임시 작업 공간과 교체된 `HOME`, 필터링된 환경 변수 안에서 실행됩니다 |
| 실행 전용 정보 | 사용자의 기존 `AOS_*`와 `AOS_HOME`은 제거하고, `AOS_SESSION_ID`, `AOS_FAMILY`, `AOS_WORKSPACE`, `AOS_TASK_FILE`만 새로 넣습니다 |
| 인증 정보 | 기존 런타임 인증 정보나 명시적으로 허용한 인증 변수만 격리 프로세스에 전달할 수 있습니다. 이름과 출처만 기록하고 값은 저장하지 않으며, `--no-auto-auth`로 자동 탐색을 끌 수 있습니다 |
| 비밀값·로컬 저장 | 출력의 비밀값은 종류만 남기고 지적·결과·이벤트에 실제 값을 다시 쓰지 않습니다. `~/.aos`는 `0700`, 그 안의 파일은 `0600`으로 저장합니다 |

보안 취약점은 [`SECURITY.md`](SECURITY.md)의 절차에 따라 알려 주세요.

## 직접 실행·개발·기여

직접 실행하려면 Node `>=22.18 <25`, macOS 또는 네이티브 Linux, x64 또는 arm64가 필요합니다.
WSL은 현재 지원하지 않습니다. npm 레지스트리에 공개된 패키지는 없으며 저장소나 GitHub Release의
소스에서 실행합니다. `npm pack`으로 로컬 설치용 tarball을 만들 수 있습니다.

```bash
npm ci
npm test                 # 전체 테스트
npm run verify:mvp       # 점수 계약·상한·등급 검증
npm run test:mutation    # 주요 보호 조건이 실제로 테스트에 걸리는지 확인
npm run smoke:package    # 패키징 후 다른 위치에서 사용자 흐름 점검
```

CI는 일곱 작업으로 구성됩니다. Ubuntu의 Node 22·24, macOS의 Node 24에서 테스트하고,
`verify:mvp`, 변이 테스트, Ubuntu·macOS 패키지 스모크를 각각 실행합니다.

| 문서 | 내용 |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 아직 확립되지 않은 주장과 각 숫자에 붙는 조건 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 사용해도 되는 곳과 사용하면 안 되는 곳 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 브랜치 전략, 변경 조건, DCO 서명 방법 |
| [`SECURITY.md`](SECURITY.md) | 보안 취약점 신고 방법 |

MIT 라이선스이며 자세한 내용은 [`LICENSE`](LICENSE)를 확인하세요. 기여할 때는
[DCO](CONTRIBUTING.md)에 따라 `git commit -s`로 서명해야 합니다. 서드파티 고지는
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 있습니다.
