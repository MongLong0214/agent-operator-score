<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**AI 코딩 에이전트 자체가 아니라, 에이전트를 운영한 방식을 점검합니다.**

[![CI](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml)
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

운영자 두 사람이 같은 모델로, 같은 저장소에서, 같은 과제를 합니다. 한 사람은 배포합니다.
다른 한 사람은 예산을 태우고 동작하지 않는 것을 머지합니다. 이름을 댈 수 있는 모든 벤치마크는
**둘 사이에서 똑같았던 절반**을 잽니다.

AOS는 나머지 절반을 잽니다. 채점표는 차가 아니라 운전자를 향합니다.

`review`는 이미 끝난 세션을 복기하고, `assess`는 정해진 실습 과제에서 운영 과정을 관찰합니다.
그리고 이 도구가 내놓는 모든 숫자는 **그 숫자가 무엇에 묶여 있는지**를 함께 말합니다.

> [!WARNING]
> AOS는 현재 `EXPERIMENTAL / PROVISIONAL` 상태입니다. 결과는 특정 에이전트·모델·설정·
> 머신·과제에 한정되며, 채용·승진·직원 감시·자격 인증에 사용하면 안 됩니다.

Claude Code를 쓴다면 복제할 것도, 설치할 것도 없습니다.

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

`/aos-review`는 최근 세션을 바로 검토합니다. `/aos-assess`는 모델 사용량이 발생한다는 사실을
먼저 알리고, `PATH`에서 Claude Code와 Codex를 찾아 등록한 뒤 실행 환경을 점검합니다. 저장소
복제, `npm install`, 에이전트 수동 등록, 계획서 작성은 필요하지 않습니다.

플러그인도 내부적으로 Node를 사용하므로 Node `>=22.18 <25`가 필요하며, 사용할 에이전트 CLI가
설치되고 로그인돼 있어야 합니다. 또한 `/aos-assess`가 운영자 대신 체크포인트에 답할 수는
없습니다. 공식 점수를 내려면 안내에 따라 본인 터미널에서 `--checkpoints` 실행에 직접 참여해야
합니다.

`review`는 이미 디스크에 있는 세션 기록만 읽습니다. 모델을 새로 부르지 않으니 비용이 들지 않고,
몇 초면 끝나며, 대상은 당신이 실제로 한 작업입니다. 업로드하는 것도 텔레메트리도 없고, 켤 것도
없습니다. 다만 `assess`가 실행하는 Codex나 Claude Code는 일을 하려고 각 제공업체와 통신합니다.

저장소에서 직접 돌리려면:

```bash
git clone --depth 1 --branch dev https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review
```

## 두 기능의 차이

| 구분 | `aos review` | `aos assess` |
|---|---|---|
| 하는 일 | 실제 세션에서 위험할 가능성이 있는 패턴을 찾아 검토 후보로 보여 줍니다 | 통제된 여섯 과제에서 운영 과정과 결과를 조건부 점수로 요약합니다 |
| 읽거나 실행하는 것 | 로컬의 Codex·Claude Code·Grok CLI 세션 기록 | 등록된 Codex·Claude Code 등 에이전트 CLI |
| 모델 사용량 | 들지 않습니다. 새 모델 호출이 없습니다 | 듭니다. 등록한 에이전트의 사용량을 소비합니다 |
| 결과 | 문제가 의심되는 단계와 근거 | 100점 만점 점수 또는 점수를 발급하지 못한 이유 |

처음에는 `review`부터 권장합니다. 비용 없이 실제 작업 기록으로 AOS의 판정 방식을 확인한 뒤,
필요할 때 `assess`를 실행하는 편이 안전합니다.

### `aos review` — 이미 끝난 작업을 복기하기

```bash
node bin/aos.mjs review                         # 가장 최근 세션
node bin/aos.mjs review --since 12              # 도구 활동이 있는 최근 12개 세션의 반복 패턴
node bin/aos.mjs review --list                  # 검토할 수 있는 세션 경로 보기
node bin/aos.mjs review --session "<경로>"      # 목록에서 고른 세션 검토
node bin/aos.mjs review --json                  # 기계가 읽을 수 있는 JSON
```

현재 `review`가 찾는 패턴은 다음과 같습니다.

| 규칙 | 사람이 확인해야 할 상황 |
|---|---|
| `completion-claimed-without-verification` | 에이전트가 완료를 주장했지만 마지막 수정 뒤 테스트나 검증이 다시 실행되지 않은 경우 |
| `session-ended-on-stale-evidence` | 마지막 수정 이후 새 검증 근거 없이 세션이 끝난 경우 |
| `edits-outside-the-working-directory` | 에이전트가 현재 작업하던 프로젝트 밖의 파일을 변경한 경우 |
| `destructive-command-executed` | 데이터 손실 가능성이 있는 되돌리기 어려운 명령이 실행된 경우 |
| `secret-material-in-session` | API 키·토큰·개인 키 같은 비밀값이 세션에 나타난 경우 |
| `long-uninterrupted-tool-run` | 운영자의 개입 없이 긴 실행이 이어졌고, 그 안에서 실패나 같은 행동의 반복이 발생한 경우 |
| `completion-claimed-over-a-failed-check` | 완료를 주장하기 직전의 검증이 실패를 보고했는데도 완료라고 말한 경우 |
| `verification-exit-status-discarded` | 검사를 `\|\| true` 아래에서 실행해 그 결과를 애초에 볼 수 없었던 경우 |

각 지적은 문제가 의심되는 단계를 함께 표시합니다. 판정을 그대로 믿기보다 원래 세션과 대조해
실제로 맞는지 확인해야 합니다. 현재 규칙은 과거 독립 측정에서 목표 정확도에 미치지 못했으며,
수정된 규칙도 새 미사용 세션으로 다시 측정되기 전까지는 확정 탐지기로 볼 수 없습니다.

한 세션은 “이번에 무슨 일이 있었는가”를 보여 주고, 여러 세션은 “어떤 패턴이 반복되는가”를
보여 줍니다. AOS가 더 유용해지는 지점은 후자입니다.

### `aos assess` — 통제된 과제로 운영 방식을 측정하기

`assess`는 AOS가 준비한 여섯 과제를 등록된 에이전트에게 맡깁니다. 에이전트가 스스로
“완료했습니다”라고 말한 내용은 점수가 아닙니다. 별도 검증기가 실제 산출물과 실행 기록을
확인하고, 운영자가 막힌 상황에서 어떻게 개입했는지도 함께 관찰합니다.

<img src="docs/assets/aos-families.svg" alt="여섯 가지 코딩 과제 묶음: 의도, 맥락, 그래프, 루프와 상태, 거짓 완료, 복구·안전·효율." width="960" height="252">

가장 간단한 직접 실행 순서는 다음과 같습니다.

> [!CAUTION]
> `aos init`은 `PATH`에서 Claude Code를 찾으면 비대화형 실행을 위해
> `--dangerously-skip-permissions`로 등록합니다. 이 설정은 Claude Code 자체의 권한 확인을
> 건너뜁니다. AOS의 임시 워크스페이스·임시 `HOME`·환경 변수 필터링은 유지되지만, 플래그의
> 의미를 이해한 뒤 평가를 실행해야 합니다.

```bash
node bin/aos.mjs init                   # PATH의 Claude Code·Codex를 자동 등록
node bin/aos.mjs doctor                 # 실행 파일과 인증 경로를 사전 점검

node bin/aos.mjs assess                 # 무인 진단: 공식 점수는 반드시 보류됨
node bin/aos.mjs assess --checkpoints   # 운영자가 참여하는 점수 실행
```

`init`은 이미 직접 설정한 에이전트를 덮어쓰지 않습니다. `assess`에 계획서를 지정하지 않으면
저장소가 제공하는 실행 가능한 `aos-plan.json`을 생성해 사용합니다. 계획서는 자기평가 설문지가
아니며, 그럴듯하게 작성한 모양 자체는 점수에 들어가지 않습니다. 점수는 실행에서 실제로 관찰된
행동과 결과로 계산됩니다.

`doctor`는 실행 파일과 선언된 인증 경로를 확인하지만 실제 모델 호출까지 수행하지는 않습니다.
CLI 버전이나 로그인 상태 때문에 실행이 시작되지 않으면 AOS는 그 실패를 운영자의 낮은 점수로
바꾸지 않고 중단해야 합니다.

AOS는 실행을 다음 여섯 영역으로 나눠 봅니다.

1. **과제 명세** — 뭘 만들지 말했는가. 목표, 하지 말 것, 다 됐다고 할 조건
2. **컨텍스트 엔지니어링** — 뭘 보여줬는가. 맞는 자료를 골랐고, 낡거나 수상한 것은 걸렀는가
3. **분해와 라우팅** — 일을 어떻게 쪼갰는가. 누구에게 뭘 맡기고, 결과를 어떻게 합쳤는가
4. **휴먼인더루프 제어** — 막혔을 때 뭘 했는가. 알아챘고, 지시를 바꿨고, 멈춰야 할 때 멈췄는가
5. **평가와 검증** — 진짜 되는지 봤는가. “다 됐습니다”를 별도 근거로 확인했는가
6. **가드레일·복구·비용** — 안전하고 싸게 했는가. 비밀은 새지 않았고, 권한은 최소였고, 호출 예산 안이었는가

이 여섯 영역은 20개 지표로 나뉘며, 각 지표는 네 개의 구체적인 확인 항목으로 평가됩니다.

<img src="docs/assets/aos-pipeline.svg" alt="등록한 실행 환경과 고정된 과제로 평가를 시작하고, 운영자 체크포인트와 실제 결과 검증을 거쳐 20개 지표와 최종 점수를 만드는 흐름." width="960" height="392">

---

## 체크포인트가 필요한 이유

에이전트가 같은 실패를 반복하거나 더 진행하기 어려운 상태에 도달하면 AOS가 실행을 멈추고,
현재까지의 근거와 운영자가 선택할 수 있는 대응을 보여 줍니다.

```text
AOS checkpoint (1 of 3) — repeated-failure
blocked before this stage: the migration step times out
  repeated unchanged  retry-tests:retry-7

  | goal: cut the report over
  | latest evidence: sha256:67a666c03d22
  | event: retry-tests (retry-7)
  | event: retry-tests (retry-7)
  evidence 16368376f56a83d9

  1. retry unchanged
  2. modify instruction <text>
  3. reroute to another agent <agent>
  4. inspect evidence
  5. stop blocked
  agents: codex
```

**어떤 선택지를 골랐는지만으로 점수가 정해지지는 않습니다.** AOS는 실제 지시가 의미 있게
달라졌는지, 다른 에이전트로 경로가 바뀌었는지, 중단을 골랐다면 정말 멈췄는지, 그 뒤에 같은
실패를 그대로 반복했는지를 봅니다.

`--checkpoints` 없이 실행하면 운영자가 중간에 무엇을 판단했는지 관찰할 수 없습니다. 실행 결과와
참고용 계산값은 남지만 공식 점수는 `INCOMPLETE`로 보류됩니다. 플러그인이나 다른 에이전트가
운영자 대신 답하면 그 결과는 사용자가 아니라 대신 답한 주체의 정책을 반영하므로 공식 점수로
해석할 수 없습니다.

체크포인트에서 당장 바꾸지 않기로 한 판단도 기록할 수 있습니다. 다만 운영자가 자리에 있었다는
사실 자체가 아니라, 그 판단이 실제 실행 상태를 어떻게 바꿨는지가 평가 대상입니다.

## 세 번 측정해 하나의 점수로 만드는 이유

한 번의 실행은 우연과 모델 변동의 영향을 크게 받습니다. AOS는 시드(seed) 세 개를 시작할 때
한 번 고정하고, 같은 실행 프로필에서 얻은 결과를 하나의 사이클로 묶습니다. 현재 여섯 과제 중
세 과제만 시드에 따라 세부 조건이 달라지므로, 이 반복을 전체 모집단에 대한 신뢰도로 확대해서는
안 됩니다.

```bash
node bin/aos.mjs cycle start                                  # 시드 3개 고정
node bin/aos.mjs cycle run --checkpoints                      # 고정된 시드로 차례대로 실행
node bin/aos.mjs cycle                                        # 유효한 실행의 중앙값
node bin/aos.mjs dashboard                                    # 로컬 읽기 전용 대시보드
```

집계에는 고정된 시드·프로필·suite·scorer 조건을 유지하고, 종료 기록과 공식 점수를 갖춘 실행만
들어갑니다. 점수가 낮다는 이유로 유효한 실행을 제외하거나 같은 시드를 다시 돌릴 수는 없습니다.
제외된 실행은 이유와 함께 표시됩니다.

사이클을 잘못 시작했다면 `--force --reason "<이유>"`로 중단하고 새로 시작할 수 있습니다. 이전
사이클은 삭제되지 않으며, 고정했던 시드와 이미 나온 실행·점수를 가진 중단 기록으로 남습니다.

최종 Operator Score는 유효한 실행들의 **중앙값**입니다. 한 컴퓨터에서 반복했을 때 얼마나
흔들렸는지는 **local repeat evidence**로 표시하며, 통계적 신뢰도나 보편적인 실력 증명을 뜻하는
`confidence`라고 부르지 않습니다.

## 점수가 나오지 않거나 상한이 걸리는 경우

<img src="docs/assets/aos-gates.svg" alt="공식 점수를 표시하기 위한 조건과, 치명적인 문제에 적용되는 점수 상한." width="960" height="436">

AOS는 숫자를 계산할 수 있다는 이유만으로 모든 실행에 공식 점수를 붙이지 않습니다. 20개 지표 중
최소 18개가 관찰돼야 하며, 기능 결과·독립 검증·최종 버전 일치·정직한 완료 보고·복구·안전에
해당하는 핵심 지표는 반드시 관찰돼야 합니다. 실행 격리와 근거 기록도 완전해야 합니다.

조건을 충족하지 못하면 `score`는 비워 두고 상태를 `INCOMPLETE`로 표시합니다.
`provisional_raw`는 문제를 고칠 때 참고하는 계산값일 뿐 공식 점수가 아닙니다.
`NOT_OBSERVED`는 실패나 0점이 아니라, 해당 항목을 판단할 근거를 얻지 못했다는 뜻입니다.

치명적인 문제가 실제로 관찰되면 단순 감점이 아니라 **상한**이 적용됩니다. 비밀 유출·금지된 외부
행동·작업 공간 이탈은 최대 39점, 실패한 결과를 완료라고 주장한 경우는 최대 49점, 치명적 오류를
무시하고 진행한 경우는 최대 59점, 검증 뒤 결과를 바꿔 최종 버전과 검증 버전이 달라진 경우는
최대 69점입니다. 다른 영역을 아무리 잘해도 이 한도를 넘을 수 없습니다.

상한은 위반이 실제로 관찰된 경우에만 적용됩니다. 결과물이 없어서 안전 여부를 판단하지 못한 실행은
`UNSAFE`가 아니라 `INCOMPLETE`입니다. “확인하지 못했다”와 “위반했다”를 같은 상태로 취급하지
않습니다.

등급은 최종 점수를 기준으로 `90+ HIGH RELIABILITY`, `75+ ADVANCED`, `60+ OPERATIONAL`,
`40+ DEVELOPING`, `0+ FRAGILE`로 표시됩니다. 이 이름은 해당 실행을 요약할 뿐 사람 전체의
능력이나 업계 내 순위를 뜻하지 않습니다.

---

## 이 점수를 이렇게 해석하면 안 됩니다

| AOS가 아닌 것 | 이유 |
|---|---|
| 사람의 종합적인 AI 활용 능력 점수 | 특정 에이전트·모델·설정·머신·과제에서 관찰한 한정된 결과입니다 |
| 모델·CLI·하네스의 일반적인 우열 비교 | 프로필이 다른 두 점수는 서로 다른 것을 측정한 값이라 직접 비교할 수 없습니다 |
| 백분위·순위·자격증 | 비교할 모집단과 규준이 없으며 그런 주장을 하지 않습니다 |
| 채용·승진·직원 감시 도구 | 개인에게 불이익을 주는 용도로 사용하지 않도록 명시하고 있습니다 |
| SaaS 또는 텔레메트리 서비스 | 실행 기록과 리포트는 로컬에 남고 AOS 자체의 외부 수집 기능이 없습니다 |
| 검증이 끝난 과학적 측정 도구 | 교정 연구·독립 재현·전문가 검토가 완료되지 않았습니다 |

초기 버전에는 운영자가 작성한 계획서의 JSON 모양만 보고 20개 지표 중 17개를 정하는 문제가
있었습니다. 내용이 사실상 무의미한 계획서도 `17/17`을 받을 수 있었습니다. 지금은 계획서가
점수 입력이 아니며, 지표는 실제 실행에서 관찰되거나 `NOT_OBSERVED`로 남습니다.

과제의 구성과 채점 로직은 `lib/suite.mjs`에 공개돼 있습니다. 따라서 AOS는 비밀 정답을 맞히는
시험이 아니라, 같은 조건에서 자신의 운영 방식을 반복해서 연습하고 점검하는 도구입니다.

## 현재까지 실제로 측정한 결과

아래는 실제 Codex를 사용해 한 컴퓨터에서 수행한 사례입니다. 각 사이클은 고정 시드 세 개로
실행했고, 모든 실행에 운영자가 체크포인트로 참여했습니다.

| 사이클 | 에이전트 샌드박스 | Operator Score | 실행별 점수 | 범위 |
|---|---|---|---|---|
| 1 | 켬 | **69** | 69, 69, 83 | 14 |
| 2 | 끔 | *철회* | 49, 59, 89 | — |
| 3 | 끔 | **90** | 90, 87, 92 | 5 |

여기서 “에이전트 샌드박스”는 Codex 자체의 명령 실행 제한을 뜻합니다. AOS의 임시 워크스페이스,
임시 `HOME`, 환경 변수 필터링은 별도의 경계이며 세 사이클 모두 유지됐습니다.

2번 사이클의 종합 점수는 철회했습니다. 한 번의 실행 점수가 시드 세 개 모두에 중복 기록돼 실제로는
한 실행을 세 번 센 값이었기 때문입니다. 개별 실행 점수 자체는 남겼고, 여기서 발견한 결함 세 개는
3번 사이클 전에 수정했습니다.

`aos review` 규칙은 규칙 작성에 쓰지 않은 세션 320개로 한 번 평가했습니다. 고위험 지적
10건 중 실제로 맞은 것은 4건으로, 정밀도는 0.400이었습니다. 틀린 여섯 건은 수정했지만 같은
자료로 다시 확인한 값은 독립적인 두 번째 측정이 아니라 튜닝 결과입니다. 새 미사용 세션으로 다시
측정하기 전까지 현재 규칙의 정확도가 확립됐다고 주장하지 않습니다.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 현재 수용 조건 확인
```

holdout 기록에는 세션 원문이 아니라 세션 해시, 지적 식별자, 판정과 이유만 저장됩니다. 자세한
측정 한계와 실험 기록은 [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)에 있습니다.

## 결과 리포트

`assess`가 끝나면 어떤 지표가 관찰됐고, 어떤 근거로 통과하거나 실패했으며, 어떤 상한이나 보류
조건이 적용됐는지를 담은 Markdown·HTML 리포트가 만들어집니다.

리포트는 `node bin/aos.mjs report --run <id> --format markdown|html|json`으로 다시
출력할 수 있습니다.

HTML 리포트는 한국어 로케일에서 한국어로, 그 밖의 환경에서는 영어로 열립니다. 두 언어를 한
파일에 넣고 CSS로 전환하므로 언어 변경을 위해 스크립트를 실행하거나 외부 서버에 요청하지
않습니다.

## 보안과 개인정보 보호

| 항목 | 실제 동작 |
|---|---|
| AOS 자체 네트워크 | 대시보드는 `127.0.0.1`에만 열리고 토큰이 필요하며 읽기 전용·GET 전용입니다. 세션 원문을 반환하는 경로와 AOS의 외부 수집 클라이언트는 없습니다 |
| 등록한 에이전트의 네트워크 | `assess`에서 실행되는 Codex·Claude Code는 작업 수행을 위해 각 모델 제공업체와 통신할 수 있습니다. AOS는 이를 오프라인 실행이라고 주장하지 않습니다 |
| 의존성 | 런타임 패키지 의존성은 없습니다. `npm ci`가 새 패키지를 설치하지 않지만 지원 범위의 Node는 필요합니다 |
| 에이전트 실행 환경 | 임시 `HOME`에서 실행하고 민감한 환경 변수를 걸러냅니다. 사용자의 기존 `AOS_*`와 `AOS_HOME`은 제거한 뒤 현재 실행에 필요한 `AOS_SESSION_ID`, `AOS_FAMILY`, `AOS_WORKSPACE`, `AOS_TASK_FILE`만 새로 넣습니다 |
| 인증 정보 | 런타임에 필요한 기존 인증 경로나 허용한 인증 변수만 전달합니다. 이름과 출처는 기록할 수 있지만 값은 저장하지 않으며, 자동 탐색은 `--no-auto-auth`로 끌 수 있습니다 |
| 비밀값·로컬 저장 | 출력에서 발견한 비밀값은 종류만 남기고 실제 값을 지적·결과·이벤트에 다시 쓰지 않습니다. `~/.aos`는 `0700`, 그 안의 파일은 `0600`으로 저장합니다 |

보안 취약점은 [`SECURITY.md`](SECURITY.md)의 절차에 따라 알려 주세요.

## 실행 환경과 설치 조건

Node `>=22.18 <25`, macOS 또는 네이티브 Linux가 필요합니다. 지원 아키텍처는 x64와 arm64이며,
WSL은 현재 지원하지 않습니다.

Claude Code 플러그인은 저장소 복제와 에이전트 수동 등록을 없애 주지만, 지원되는 Node와
설치·로그인된 Claude Code가 필요합니다. 직접 실행할 때도 npm 레지스트리에 공개된 패키지를
설치하는 방식이 아니라 저장소 또는 GitHub Release의 소스에서 실행합니다.

이 저장소의 기본 브랜치는 `dev`입니다. 재현 가능한 배포본을 사용하려면
[GitHub Releases](https://github.com/MongLong0214/agent-operator-score/releases)의 태그를
선택하세요. 전역 설치는 필요하지 않으며, `npm pack`으로 로컬 설치용 tarball을 만들 수 있습니다.

## 개발 및 검증

```bash
npm ci
npm test                 # 전체 테스트
npm run verify:mvp       # 점수 계약·상한·등급 검증
npm run test:mutation    # 보호 조건을 깨뜨렸을 때 관련 테스트가 실패하는지 확인
npm run smoke:package    # 패키징 후 다른 위치에서 실제 사용자 흐름 점검
```

CI는 Ubuntu에서 Node 22와 Node 24로, macOS에서 Node 24로 테스트를 실행하고, 점수 계약 검증·변이
테스트·패키지 스모크 테스트도 별도 작업으로 확인합니다. 브랜치 운영 방식과 기여 규칙은
[`CONTRIBUTING.md`](CONTRIBUTING.md)에 있습니다.

## 관련 문서

| 문서 | 내용 |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 아직 확립되지 않은 주장과 각 숫자에 붙는 조건 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 허용되는 사용 방식과 사용하면 안 되는 방식 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 브랜치 전략, 변경 조건, DCO 서명 방법 |
| [`SECURITY.md`](SECURITY.md) | 보안 취약점 신고 방법 |

## 라이선스

MIT 라이선스입니다. 자세한 내용은 [`LICENSE`](LICENSE)를 확인하세요. 기여할 때는
[DCO](CONTRIBUTING.md)를 따르고 `git commit -s`로 서명해야 합니다. 서드파티 고지는
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 있습니다.
