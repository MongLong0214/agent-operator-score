<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**바꿀 수 있는 변수는 모델이 아니라 그것을 쓰는 사람입니다.**

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

같은 모델, 같은 저장소, 같은 과제. 한 사람은 배포까지 갑니다. 다른 한 사람은 예산을 태우고
돌아가지 않는 코드를 머지합니다. 이름이 알려진 벤치마크는 전부 **똑같았던 쪽**을 잽니다.

이 도구는 나머지 절반을 잽니다. 그리고 숫자를 내놓을 때마다 그 숫자가 어떤 조건에서 나온 것인지
같이 밝힙니다.

```bash
git clone https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review          # 방금 끝낸 세션에서 무엇이 잘못됐는가
```

점수도 없고 모델 사용량도 들지 않습니다. 몇 초면 끝나고, 대상은 실제로 한 작업입니다. 아무것도
바깥으로 나가지 않습니다. 텔레메트리는 꺼져 있고, 켜는 스위치도 없습니다.

---

## 원클릭

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score
```

그다음 아무 Claude Code 세션에서 `/aos-review`. 설치 단계도 없고 설정할 것도 없습니다. 이 저장소는
런타임 의존성이 없고, 에이전트는 `PATH`에서 스스로 등록되며, 런타임 자격증명은 그 런타임이 원래
찾았을 자리에서 찾아옵니다.

## 두 갈래

|  | `aos review` | `aos assess` |
|---|---|---|
| 읽는 것 | 이미 디스크에 있는 Codex·Claude Code 세션 기록 | 통제된 여섯 과제 묶음. 등록한 에이전트로 직접 실행 |
| 드는 비용 | 없음. 모델을 부르지 않음 | 모델 사용량. 격리된 워크스페이스에서 소모 |
| 나오는 것 | 어느 단계에서 나왔는지 짚어 주는 지적 | 100점 만점 점수, 또는 점수가 없는 이유 |
| 답하는 질문 | 나는 무엇을 반복하고 있는가 | 이 조건에서 나는 이 에이전트를 얼마나 잘 다루는가 |

### `aos review` — 돈이 안 드는 쪽

```bash
node bin/aos.mjs review --since 12   # 최근 열두 세션에서 되풀이되는 것
node bin/aos.mjs review --list       # 하나 골라서 보기
```

| 규칙 | 걸리는 상황 |
|---|---|
| `completion-claimed-without-verification` | 고쳐 놓고 아무것도 다시 안 돌린 채 성공을 보고 |
| `session-ended-on-stale-evidence` | 마지막 검증이 마지막 수정보다 앞섬 |
| `edits-outside-the-working-directory` | 작업하던 트리 밖으로 쓰기가 나감 |
| `destructive-command-executed` | 되돌릴 수 없는 명령 실행. 평범한 동기화는 제외 |
| `secret-material-in-session` | 키 자료 등장. 종류만 밝히고 값은 다시 적지 않음 |
| `long-uninterrupted-tool-run` | 입력 없이 길게 이어진 구간. 그 안에서 뭔가 실패했거나 되풀이됐을 때만 |

지적마다 어느 단계에서 나온 것인지 짚어 줍니다. 도구를 믿는 대신 기억과 맞춰 보라는 뜻입니다.
쓸모는 `--since` 쪽이 큽니다. 한 세션은 무슨 일이 있었는지 알려주고, 열두 세션은 무엇을
되풀이하는지 알려줍니다.

### `aos assess` — 숫자가 나오는 쪽

<img src="docs/assets/aos-families.svg" alt="여섯 개 코딩 과제 묶음: 의도, 맥락, 그래프, 루프와 상태, 거짓 완료, 복구·안전·효율." width="960" height="252">

```bash
node bin/aos.mjs assess --template aos-plan.json          # 계획서 틀 만들기
node bin/aos.mjs assess --plan aos-plan.json --checkpoints
```

과제 묶음마다 등록해 둔 에이전트 CLI를 격리된 워크스페이스에서 돌립니다. 채점은 숨은 검증기가
맡고, 대상은 에이전트가 **실제로 내놓은 결과물**입니다. 스스로 뭘 했다고 말한 내용이 아닙니다.

<img src="docs/assets/aos-pipeline.svg" alt="선언한 프로필과 고정한 시드로 통제된 실행을 만든다. 실행은 운영자 체크포인트에서 멈추고, 숨은 검증기가 에이전트 결과물을 채점한다. 스무 개 지표가 결정론적 채점기로 들어가고, 발급 게이트가 점수를 실을 수 있는지 정한다. 고정 시드 세 개가 하나의 Operator Score가 된다." width="960" height="392">

---

## 아무도 안 본 실행에는 점수가 없습니다

여섯 영역 중 하나는 **실행이 도는 동안 사람이 무엇을 했는가**를 묻습니다. 세션 기록만으로는
답이 안 나오는 질문입니다. `--checkpoints`를 붙이면 막힌 지점에 닿은 단계가 멈춰 서서 무엇을
봤는지 보여줍니다.

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

**고른 항목 자체는 점수가 아닙니다.** 채점 대상은 그 답이 실제로 바꿔 놓은 상태입니다. 지시가
바뀌었는지, 경로가 옮겨졌는지, 중단이 정말 중단으로 끝났는지. 그리고 그 뒤에 이어진 작업이 같은
일의 되풀이였는지까지 봅니다. 신중해 보이는 항목을 고른 다음 아무것도 안 바꾸고 다시 돌리는 것이
바로 체크포인트가 잡으려는 결함입니다. 라벨이 곧 지표였다면 그게 오히려 높은 점수를 받습니다.

터미널 앞에 있는지는 확인하지 않습니다. `expect`도 pty를 쥘 수 있고, pty를 쥔 채 자리를 뜨는
사람도 있습니다. 그래서 자리에 있다는 사실은 플래그로 밝힙니다. 플래그가 없으면 실행은 무인으로
끝나고 `INCOMPLETE`를 보고하며, 점수가 얼마였을지를 함께 적습니다.

자리를 지키면서 아무것도 안 바꾸기로 결정한 것도 하나의 답입니다. 그런 답은 기록에 남되 점수를
벌지는 않습니다. 값어치는 라벨이 아니라 그 뒤에 무슨 일이 일어났는지가 정합니다.

## 세 번 돌려서 숫자 하나

```bash
node bin/aos.mjs cycle start                                  # 시드 세 개, 이 시점에 고정
node bin/aos.mjs cycle run --plan aos-plan.json --checkpoints
node bin/aos.mjs cycle                                        # operator score
node bin/aos.mjs dashboard                                    # 읽기 전용, 루프백, 토큰 필요
```

시드는 한 번만 뽑고 다시 뽑지 않습니다. 다시 뽑을 수 있으면 *스무 번 돌려서 잘 나온 세 개만
남기기*까지 한 발짝입니다. Operator Score는 유효한 실행 전부의 중앙값이고, 낮게 나온 것도 그대로
들어갑니다. 빠지는 것은 아무것도 재지 못한 실행뿐이고, 그런 실행은 이유와 함께 출력됩니다. 한
기계에서 세 번 반복한 결과는 **local repeat evidence**로 적습니다. confidence라고는 부르지
않습니다.

사이클을 접어야 할 때는 접을 수 있습니다. 다만 조용히는 안 됩니다. `--force`에는 이유가 필요하고,
접힌 사이클은 시드와 점수를 그대로 달고 기록에 남아 다음 결과 옆에 함께 출력됩니다. 멈추는 것은
되지만, 없던 일로 만드는 것은 안 됩니다.

## 무엇이 숫자를 막고, 상한은 무슨 일을 하는가

<img src="docs/assets/aos-gates.svg" alt="발급 게이트에는 다섯 조건이 있고 모두 성립해야 점수가 나온다. 상한 네 개는 감점이 아니라 천장으로 걸리고 가장 낮은 것이 이긴다. 안전 39는 FRAGILE, 거짓 완료 49와 무시된 치명적 오류 59는 DEVELOPING, 정확한 리비전 누락 69는 OPERATIONAL." width="960" height="436">

상한은 감점이 아닙니다. 비밀을 복사한 실행은 나머지를 아무리 잘했어도 39에서 막힙니다. 그것을
평균으로 덮은 숫자는 다른 실행 이야기가 되기 때문입니다.

상한이 걸리려면 위반이 **관측돼야** 합니다. 아무것도 관측하지 못한 실행은 안전하지 않은 실행이
아니라 잴 수 없었던 실행입니다. 둘을 한 칸에 뭉개면 리포트가 스스로와 모순됩니다.

---

## 되기를 거부한 것들

설계의 대부분이 거부이고, 그게 핵심입니다.

| 아닌 것 | 이유 |
|---|---|
| 능력 측정 | 점수는 선언한 환경과 과제 묶음에 딸린 값이고, 나오는 자리마다 그렇게 밝힙니다 |
| 모델·하네스 벤치마크 | 모델은 고정합니다. 재는 단위는 사람입니다 |
| 백분위·순위·인증 | 줄 세울 모집단이 없고, 그런 주장도 하지 않습니다 |
| 채용·승진·감시 도구 | [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md)에 적어 뒀습니다. 암시로 남기지 않았습니다 |
| SaaS·텔레메트리 제품 | 전부 로컬 디스크에 남습니다. 코드베이스에 바깥으로 나가는 클라이언트가 없습니다 |
| 검증된 결과 | `EXPERIMENTAL / PROVISIONAL`. 교정 연구도, 독립 재현도, 자격 있는 검토도 없습니다 |

직접 쓰는 계획서는 **채점 입력이 아닙니다.** 한때는 그 계획서가 스무 개 중 열일곱 개 지표를
정했습니다. 자기 자신에 대해 쓴 JSON의 형식만 보고서 말입니다. 글자 그대로 쓰레기인 계획서가
17/17을 받았습니다. 지금은 지표가 실행에서 관측되거나 `NOT_OBSERVED`이고, `NOT_OBSERVED`는
0점이 아닙니다.

과제 묶음의 답은 `lib/suite.mjs`에 들어 있습니다. 연습용으로는 문제없고, 이게 시험이 아닌
이유이기도 합니다.

## 무엇을 쟀는가

실제 Codex, 기계 한 대, 사이클마다 고정 시드 세 개, 모든 실행에 사람이 붙었습니다.

| | 에이전트 샌드박스 | Operator Score | 실행별 | 편차 |
|---|---|---|---|---|
| 1 | 켬 | **69** | 69, 69, 83 | 14 |
| 2 | 끔 | *철회* | 49, 59, 89 | — |
| 3 | 끔 | **90** | 90, 87, 92 | 5 |

2번 집계는 보고하지 않고 철회했습니다. 한 실행의 점수를 시드 세 개 전부에 적어 버려서, 그
숫자는 한 실행을 세 번 센 것이었습니다. 개별 점수는 진짜입니다. 그리고 그 점수들이 결함 세 개를
찾아냈고, 셋 다 3번 사이클 전에 고쳤습니다.

`aos review`는 한 번 쟀습니다. 규칙을 만든 작업에서 떼어 놓은 세션 320개가 대상이었고, 결과는
**고위험 지적 10건 중 4건 적중**입니다. 틀린 여섯 건은 모두 고쳤지만 그것을 두 번째 측정이라고
부르지는 않습니다. 오류를 드러낸 세션으로 수정을 재면 튜닝 수치가 나옵니다.
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)에 그렇게 적어 뒀고, 다시 잴 미사용 세션이 코퍼스에
남지 않았다는 것도 적어 뒀습니다.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 수용 게이트 세 개
```

기록에 남는 것은 세션마다의 digest, 지적마다의 식별자, 그리고 판정과 이유입니다. 세션 기록 자체는
남기지 않습니다.

## 리포트

점수와 함께 나오는 HTML 리포트는 운영자의 로케일을 보고 한국어로 뜹니다. 한국어가 아니면
영어입니다. 두 언어가 한 파일에 들어 있고 CSS가 한쪽을 감추기 때문에, 동료에게 보낸 리포트는 받는
사람 언어로 열립니다. 전환은 스크립트 없이 체크박스로 합니다. 바깥으로 요청을 보내지 않는다는
성질을 그대로 지키기 위해서입니다.

## 보안과 프라이버시

| | |
|---|---|
| 네트워크 | 루프백 서버 하나. `127.0.0.1` 바인드, 토큰 필수, 읽기 전용, GET 전용. 세션 기록을 돌려주는 경로는 없습니다. 바깥으로 나가는 클라이언트가 코드베이스에 없습니다 |
| 의존성 | 없음. `npm ci`가 아무것도 설치하지 않습니다 |
| 평가받는 에이전트 | `HOME`을 갈아 끼우고 환경 변수를 걸러서 돌립니다. `AOS_` 접두 변수는 하나도 못 받습니다. 실행 기록이 어디 있는지 끝내 모릅니다 |
| 런타임 인증 | 그 런타임이 원래 찾았을 자리에서 찾아 프로세스 환경으로 넘깁니다. 설정할 것이 없습니다. 이름과 출처는 기록하고 값은 기록하지 않으며, 토큰을 디스크에 떨구지 않습니다. `--no-auto-auth`로 끌 수 있습니다 |
| 비밀 | 출력을 읽는 지점에서 지웁니다. 종류만 보고하고, 지적·결과·이벤트 어디에도 값이 다시 적히지 않습니다 |
| 홈 디렉터리 | `~/.aos`는 `0700`, 파일은 전부 `0600` |

취약점은 [`SECURITY.md`](SECURITY.md)로 알려 주세요.

## 요구 사항

Node `>=22.18 <25`, macOS 또는 Linux. 전역으로 설치되는 것은 없고 레지스트리에 올린 패키지도
없습니다. `npm pack`으로 로컬 설치용 tarball을 만들 수 있습니다.

## 개발

```bash
npm ci
npm test                 # 테스트 스위트
npm run verify:mvp       # 계약·상한·등급이 여전히 말한 대로인지
npm run test:mutation    # 이름 붙은 가드를 하나씩 부수고, 지목된 테스트가 죽는지 확인
npm run smoke:package    # 패키징해서 다른 데 설치하고 운영자처럼 써 보기
```

CI는 변경마다 레인 일곱 개를 돌립니다. Ubuntu 22·Ubuntu 24·macOS 24에서 스위트, mutation과
`verify:mvp`, 그리고 Ubuntu와 macOS에서 패키지 스모크입니다. 브랜치는 git flow를 따르고, 그 모델은
[`CONTRIBUTING.md`](CONTRIBUTING.md)에 적혀 있습니다.

## 문서

| | |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 아직 확립되지 않은 것, 그리고 숫자마다 무엇에 딸려 있는지 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 무엇에 써도 되고 무엇에 쓰면 안 되는지 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 브랜치 모델, 변경이 갖춰야 할 것, DCO |
| [`SECURITY.md`](SECURITY.md) | 취약점 제보 |

## 라이선스

MIT. [`LICENSE`](LICENSE)를 보세요. 기여는 [DCO](CONTRIBUTING.md)를 따르고 `git commit -s`로
서명해 주세요. 서드파티 고지는 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 있습니다.
