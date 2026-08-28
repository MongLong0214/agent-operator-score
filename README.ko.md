<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**AI 코딩 에이전트의 성능이 아니라, 그것을 다루는 내 방식을 점검합니다.**

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

AOS는 Codex나 Claude Code가 **얼마나 똑똑한 모델인지** 재는 벤치마크가 아닙니다.

같은 모델에 같은 작업을 맡겨도 결과는 크게 달라집니다. 어떤 사람은 요구사항을 끝까지 지키고,
실패를 발견하면 방향을 바꾸며, 마지막 결과를 직접 검증합니다. 반대로 어떤 사람은 같은 실패를
반복하거나, 확인하지 않은 결과를 완료했다고 보고합니다.

AOS는 이 차이를 만드는 **사람의 운영 방식**을 살펴봅니다. 여기서 운영자(operator)는 에이전트에게
목표를 설명하고, 필요한 자료를 고르고, 작업을 나누고, 진행 중에 개입하고, 결과를 검증하는 사람을
뜻합니다. 즉, 이 도구를 실행하는 바로 당신입니다.

가장 먼저 써 볼 기능은 `review`입니다.

```bash
git clone https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score
npm ci

node bin/aos.mjs review
```

`review`는 이미 내 컴퓨터에 저장된 실제 작업 기록을 읽습니다. 모델을 새로 호출하지 않으므로
사용량이 들지 않고, 보통 몇 초 안에 끝납니다. 세션 원문은 외부로 전송되지 않으며 텔레메트리도
없습니다.

---

## 먼저 이것만 알면 됩니다

AOS에는 목적이 다른 두 기능이 있습니다.

| 구분 | `aos review` | `aos assess` |
|---|---|---|
| 하는 일 | 실제 AI 코딩 세션에서 반복되는 위험한 습관을 찾습니다 | 통제된 과제를 실행해 에이전트 운영 방식을 측정합니다 |
| 읽거나 실행하는 것 | 내 디스크에 이미 저장된 Codex·Claude Code 세션 | 등록한 에이전트 CLI가 수행하는 여섯 종류의 과제 |
| 모델 사용량 | 들지 않습니다. 새 모델 호출이 없습니다 | 듭니다. 등록한 에이전트의 사용량을 소비합니다 |
| 결과 | 문제가 발생한 단계와 이유를 보여 주는 구체적인 지적 | 100점 만점 점수 또는 점수를 낼 수 없는 이유 |

처음에는 `review`로 실제 습관을 확인하고, 도구의 방식이 납득된 뒤 `assess`를 실행하는 편이 좋습니다.

### `aos review` — 이미 끝난 작업을 복기하기

```bash
node bin/aos.mjs review              # 가장 최근 세션 검토
node bin/aos.mjs review --since 12   # 최근 12개 세션에서 반복되는 문제 확인
node bin/aos.mjs review --list       # 세션 목록에서 직접 선택
node bin/aos.mjs review --json       # 다른 도구에서 읽을 수 있는 JSON 출력
```

현재 `review`가 찾는 문제는 다음과 같습니다.

| 규칙 | 쉽게 말하면 |
|---|---|
| `completion-claimed-without-verification` | 파일을 고친 뒤 테스트나 검증을 다시 하지 않았는데 완료했다고 보고한 경우 |
| `session-ended-on-stale-evidence` | 마지막 수정 이후 새 검증 없이 세션이 끝난 경우 |
| `edits-outside-the-working-directory` | 현재 작업하던 프로젝트 폴더 밖의 파일을 변경한 경우 |
| `destructive-command-executed` | 데이터 손실 가능성이 있는 되돌리기 어려운 명령을 실행한 경우 |
| `secret-material-in-session` | API 키·토큰·개인 키 같은 비밀값이 세션에 나타난 경우 |
| `long-uninterrupted-tool-run` | 사람의 개입 없이 긴 실행이 이어졌고, 그 안에서 실패나 같은 행동의 반복이 발생한 경우 |

각 지적에는 문제가 발생한 단계가 함께 표시됩니다. 도구의 판정을 그대로 믿기보다 원래 세션과
대조해 실제로 맞는지 확인할 수 있습니다.

한 세션만 보면 “이번에 무엇이 잘못됐는가”를 알 수 있습니다. 여러 세션을 `--since`로 함께 보면
“나는 어떤 실수를 계속 반복하는가”를 알 수 있습니다. AOS가 실제로 도움이 되는 지점은 후자입니다.

### `aos assess` — 통제된 과제로 운영 방식을 측정하기

`assess`는 AOS가 준비한 여섯 종류의 과제를 등록한 에이전트에게 맡기고, 실행 중 운영자가 어떻게
판단하고 개입하는지까지 관찰합니다. 에이전트가 “완료했습니다”라고 말한 내용은 점수가 아닙니다.
별도의 검증기가 실제 결과물과 실행 기록을 확인합니다.

<img src="docs/assets/aos-families.svg" alt="AOS가 측정하는 여섯 영역: 목표와 계약, 맥락과 근거, 작업 분해와 위임, 모니터링과 개입, 검증과 완료, 복구·안전·효율." width="960" height="252">

Codex와 Claude Code의 대표적인 등록 예시는 아래와 같습니다. 둘 중 실제로 사용할 에이전트만
등록하면 됩니다. Codex의 기존 로그인 정보를 사용하려면 격리된 실행에서도 찾을 수 있도록
`CODEX_HOME` 경로를 명시해야 합니다.

```bash
node bin/aos.mjs init

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
node bin/aos.mjs agent add codex \
  --command codex \
  --arg exec \
  --arg --skip-git-repo-check \
  --arg -s \
  --arg workspace-write \
  --allow-env CODEX_HOME \
  --adapter codex-cli.v1

node bin/aos.mjs agent add claude \
  --command claude \
  --arg -p \
  --arg --dangerously-skip-permissions \
  --adapter claude-code.v1

node bin/aos.mjs agent doctor
node bin/aos.mjs assess --template aos-plan.json
node bin/aos.mjs assess --plan aos-plan.json --checkpoints
```

CLI 버전에 따라 사용할 수 있는 옵션은 달라질 수 있습니다. `agent doctor`는 실행 파일을 찾을 수
있는지와 인증 정보를 전달할 경로가 준비됐는지를 확인하지만, 실제 모델을 호출해 로그인까지
검증하지는 않습니다. 등록한 명령 자체를 시험하려면 `aos agent run <id> --task <text>`로 작은
작업을 먼저 실행할 수 있으며, 이때는 모델 사용량이 듭니다.

`aos-plan.json`은 자기평가 설문지가 아니라 **실행 계획서**입니다. 전체 목표와 제약, 완료 조건,
그리고 여섯 과제마다 사용할 에이전트와 지시문을 적습니다. 계획서를 그럴듯하게 쓴 것 자체는 점수에
들어가지 않습니다. 점수는 실행에서 실제로 관찰된 행동과 결과만으로 계산됩니다.

AOS는 운영 방식을 다음 여섯 영역으로 나눠 봅니다.

1. **목표와 계약** — 요구사항, 금지 사항, 완료 조건을 놓치지 않았는가
2. **맥락과 근거** — 필요한 자료만 고르고, 오래됐거나 신뢰할 수 없는 자료를 걸러냈는가
3. **작업 분해와 위임** — 일을 적절히 나누고, 의존성과 충돌을 관리하며, 맞는 에이전트에 맡겼는가
4. **모니터링과 개입** — 실패를 알아차리고, 같은 재시도 대신 지시 수정·경로 변경·중단을 선택했는가
5. **검증과 완료** — 실제 기능을 독립적으로 검증하고, 검증한 최종 버전만 완료라고 보고했는가
6. **복구·안전·효율** — 실패 원인을 진단하고, 최소 권한과 제한된 비용 안에서 안전하게 복구했는가

이 여섯 영역은 다시 20개 지표로 나뉘며, 각 지표는 네 개의 구체적인 확인 항목으로 평가됩니다.

<img src="docs/assets/aos-pipeline.svg" alt="등록한 실행 환경과 고정된 과제로 평가를 시작하고, 운영자 체크포인트와 실제 결과 검증을 거쳐 20개 지표와 최종 점수를 만드는 흐름." width="960" height="392">

---

## 체크포인트가 필요한 이유

에이전트가 같은 실패를 반복하거나 더 진행하기 어려운 상황에 도달하면, AOS는 실행을 잠시 멈추고
현재까지 확인한 근거와 선택지를 보여 줍니다.

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

**몇 번을 골랐는지가 점수는 아닙니다.** 예를 들어 “지시 수정”을 선택했다고 자동으로 좋은 점수를
받지 않습니다. 실제 지시가 의미 있게 달라졌는지, 다른 에이전트로 경로가 바뀌었는지, 중단을
선택했다면 정말 멈췄는지, 그 뒤에 똑같은 실패를 다시 반복했는지를 봅니다.

`--checkpoints` 없이 실행하면 사람이 중간에 무엇을 판단했는지 관찰할 수 없습니다. 이 경우 실행
자체와 임시 계산값은 남지만, 공식 점수는 `INCOMPLETE`로 보류됩니다. 터미널 앞에 있는 척하는
자동화보다, 측정하지 못한 영역을 측정하지 못했다고 밝히는 편을 택한 설계입니다.

## 세 번 측정해 하나의 점수로 만드는 이유

한 번의 실행은 우연의 영향을 크게 받습니다. AOS는 세부 조건을 만드는 값인 **시드(seed)** 세 개를
처음에 한 번 뽑아 고정하고, 같은 환경에서 세 번 실행한 결과를 하나로 묶습니다.

```bash
node bin/aos.mjs cycle start                                  # 시드 3개를 지금 고정
node bin/aos.mjs cycle run --plan aos-plan.json --checkpoints # 고정된 시드로 차례대로 실행
node bin/aos.mjs cycle                                        # 세 실행의 중앙값 확인
node bin/aos.mjs dashboard                                    # 로컬 읽기 전용 대시보드
```

시드를 실행할 때마다 다시 뽑을 수 있으면, 여러 번 돌린 뒤 잘 나온 결과만 남길 수 있습니다. 그래서
사이클이 시작된 뒤에는 낮은 점수도 버리지 않고 모든 유효한 실행을 포함합니다. 최종 Operator
Score는 유효한 실행들의 **중앙값**입니다.

아무것도 측정하지 못한 실행만 제외하며, 제외된 이유도 함께 표시합니다. 한 컴퓨터에서 세 번
반복해 비슷한 결과가 나왔다는 사실은 **local repeat evidence**라고 부릅니다. 표본 전체에 대한
통계적 신뢰도나 보편적인 실력 증명으로 확대해서 말하지 않습니다.

## 점수가 나오지 않거나 상한이 걸리는 경우

<img src="docs/assets/aos-gates.svg" alt="공식 점수를 표시하기 위한 조건과, 치명적인 문제에 적용되는 점수 상한." width="960" height="436">

AOS는 계산할 수 있다는 이유만으로 모든 실행에 공식 점수를 붙이지 않습니다. 20개 지표 중 최소
18개가 관찰돼야 하고, 기능 결과·독립 검증·최종 버전 일치·정직한 완료 보고·복구·안전에 해당하는
핵심 지표는 반드시 관찰돼야 합니다. 실행 격리 경계와 완전한 근거도 필요합니다.

조건을 충족하지 못하면 `score`는 비워 두고 상태를 `INCOMPLETE`로 표시합니다. 참고용 계산값인
`provisional_raw`는 보여 주지만, 공식 결과와 같은 값처럼 다루지 않습니다.

치명적인 문제가 실제로 관찰되면 단순 감점이 아니라 **상한**이 적용됩니다. 비밀 유출·금지된 외부
행동·작업 공간 이탈은 최대 39점, 실패한 결과를 완료라고 보고한 경우는 최대 49점, 치명적 오류를
무시하고 계속 진행한 경우는 최대 59점, 검증 뒤 파일을 다시 바꿔 최종 버전과 검증 버전이 달라진
경우는 최대 69점입니다. 다른 영역을 아무리 잘해도 이 한도를 넘을 수 없습니다.

등급은 최종 점수를 기준으로 `90+ HIGH RELIABILITY`, `75+ ADVANCED`, `60+ OPERATIONAL`,
`40+ DEVELOPING`, `0+ FRAGILE`로 표시됩니다. 이 이름은 해당 실행의 상태를 요약할 뿐,
사람 전체의 능력이나 업계 내 순위를 뜻하지 않습니다.

---

## 이 점수를 이렇게 해석하면 안 됩니다

| AOS가 아닌 것 | 이유 |
|---|---|
| 사람의 종합적인 AI 활용 능력 점수 | 특정 환경·모델·과제 묶음에서 관찰된 한정된 결과입니다 |
| 모델 또는 에이전트 하네스 벤치마크 | 모델을 고정하고, 그것을 운영한 사람의 행동을 관찰합니다 |
| 백분위·순위·자격증 | 비교할 모집단과 규준이 없으며 그런 주장을 하지 않습니다 |
| 채용·승진·직원 감시 도구 | 개인에게 불이익을 주는 용도로 사용하지 않도록 명시하고 있습니다 |
| SaaS 또는 텔레메트리 서비스 | 결과와 세션은 로컬 디스크에 남고 외부 수집 기능이 없습니다 |
| 검증이 끝난 과학적 측정 도구 | 현재 상태는 `EXPERIMENTAL / PROVISIONAL`이며 교정 연구·독립 재현·전문가 검토가 없습니다 |

초기 버전에는 사용자가 작성한 계획서의 JSON 모양만 보고 20개 지표 중 17개를 결정하는 문제가
있었습니다. 내용이 사실상 무의미한 계획서도 `17/17`을 받을 수 있었습니다. 현재는 이 방식을
제거했습니다. 지표는 실제 실행에서 관찰되거나 `NOT_OBSERVED`로 남으며, 관찰하지 못한 값을
실패를 뜻하는 0점으로 바꾸지 않습니다.

과제의 구성과 채점 로직은 `lib/suite.mjs`에 공개돼 있습니다. 따라서 AOS는 비밀 정답을 맞히는
시험이 아니라, 자신의 운영 방식을 반복해서 연습하고 점검하기 위한 도구입니다.

## 현재까지 실제로 측정한 결과

아래 결과는 실제 Codex를 사용해 한 컴퓨터에서 측정한 사례입니다. 각 사이클은 고정된 시드 세 개로
실행했고, 모든 실행에 사람이 체크포인트로 참여했습니다.

| 사이클 | 에이전트 샌드박스 | Operator Score | 실행별 점수 | 범위 |
|---|---|---|---|---|
| 1 | 켬 | **69** | 69, 69, 83 | 14 |
| 2 | 끔 | *철회* | 49, 59, 89 | — |
| 3 | 끔 | **90** | 90, 87, 92 | 5 |

2번 사이클의 종합 점수는 철회했습니다. 한 번의 실행 점수가 시드 세 개 모두에 중복 기록돼, 실제로는
한 실행을 세 번 센 값이었기 때문입니다. 개별 실행 점수 자체는 남겼고, 여기서 발견한 결함 세 개는
3번 사이클 전에 수정했습니다.

`aos review` 규칙은 규칙 작성에 사용하지 않은 세션 320개로 한 번 평가했습니다. 고위험 지적
10건 중 실제로 맞은 것은 4건이었습니다. 틀린 여섯 건은 수정했지만, 같은 자료로 다시 확인한 값은
독립적인 두 번째 측정이 아니라 튜닝 결과이므로 새 정확도라고 주장하지 않습니다. 자세한 한계는
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)에 기록돼 있습니다.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 현재 수용 조건 확인
```

이 기록에는 세션 원문 대신 세션의 해시, 지적 식별자, 사용자의 판정과 이유만 저장됩니다.

## 결과 리포트

`assess`가 끝나면 점수뿐 아니라 어떤 지표가 관찰됐고, 어떤 근거로 통과하거나 실패했으며, 어떤
상한이나 보류 조건이 적용됐는지를 담은 Markdown·HTML 리포트가 만들어집니다.
`aos report --run <id> --format html`로 다시 출력할 수도 있습니다.

HTML 리포트는 한국어 로케일에서 한국어로, 그 밖의 환경에서는 영어로 열립니다. 두 언어를 한
파일에 넣고 CSS로 전환하므로, 언어 변경을 위해 스크립트를 실행하거나 외부 서버에 요청하지
않습니다.

## 보안과 개인정보 보호

| 항목 | 동작 방식 |
|---|---|
| 네트워크 | 대시보드는 `127.0.0.1`에만 열리고 토큰이 필요하며 읽기 전용·GET 전용입니다. 세션 원문을 반환하는 경로와 외부 전송 클라이언트는 없습니다 |
| 외부 의존성 | 없습니다. `npm ci`가 설치할 패키지도 없습니다 |
| 평가 대상 에이전트 | 임시 `HOME`과 필터링된 환경 변수 안에서 실행되며, AOS 실행 기록의 위치를 전달받지 않습니다 |
| 실행 인증 정보 | 필요한 경우 허용한 인증 환경 변수 하나만 이름으로 전달합니다. 변수 이름은 기록할 수 있지만 값은 기록하거나 디스크에 저장하지 않습니다 |
| 비밀값 처리 | 출력이 들어오는 지점에서 제거하고 종류만 보고합니다. 실제 값은 지적·결과·이벤트에 다시 쓰지 않습니다 |
| 로컬 파일 권한 | `~/.aos` 디렉터리는 `0700`, 그 안의 파일은 `0600` 권한으로 저장합니다 |

보안 취약점은 [`SECURITY.md`](SECURITY.md)의 절차에 따라 알려 주세요.

## 실행 환경과 설치 조건

Node `>=22.18 <25`, macOS 또는 네이티브 Linux가 필요합니다. 지원 아키텍처는 x64와 arm64이며,
WSL은 현재 지원하지 않습니다.

npm 레지스트리에 공개된 패키지가 아니므로 저장소를 복제해 `node bin/aos.mjs`로 실행합니다.
전역 설치는 필요하지 않습니다. 로컬 설치용 파일이 필요하면 `npm pack`으로 tarball을 만들 수
있습니다.

## 개발 및 검증

```bash
npm ci
npm test                 # 전체 테스트
npm run verify:mvp       # 점수 계산 규칙·상한·등급 계약 확인
npm run test:mutation    # 주요 보호 로직을 일부러 깨뜨려 관련 테스트가 실패하는지 확인
npm run smoke:package    # 패키징 후 다른 위치에 설치해 실제 사용자 흐름 점검
```

CI는 Ubuntu 22, Ubuntu 24, macOS에서 테스트를 실행하고, 점수 계약 검증·변이 테스트·패키지
스모크 테스트도 별도 작업으로 확인합니다. 브랜치 운영 방식과 기여 규칙은
[`CONTRIBUTING.md`](CONTRIBUTING.md)에 있습니다.

## 관련 문서

| 문서 | 내용 |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 아직 검증되지 않은 주장과 현재 측정의 한계 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 허용되는 사용 방식과 사용하면 안 되는 방식 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 브랜치 전략, 변경 조건, DCO 서명 방법 |
| [`SECURITY.md`](SECURITY.md) | 보안 취약점 신고 방법 |

## 라이선스

MIT 라이선스입니다. 자세한 내용은 [`LICENSE`](LICENSE)를 확인하세요. 기여할 때는
[DCO](CONTRIBUTING.md)를 따르고 `git commit -s`로 서명해야 합니다. 서드파티 고지는
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 있습니다.
