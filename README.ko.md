<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**모델은 당신이 통제하는 변수가 아닙니다. 당신이 그 변수입니다.**

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

두 사람이 같은 모델로, 같은 저장소에서, 같은 과제를 합니다. 한 사람은 배포합니다. 다른 한 사람은
예산을 태우고 동작하지 않는 것을 머지합니다. 이름을 댈 수 있는 모든 벤치마크는 **동일했던 쪽**을
측정합니다.

이 도구는 나머지 절반을 측정하고, 내놓는 숫자마다 그것이 무엇에 묶여 있는지 함께 밝힙니다.

```bash
git clone https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review          # 방금 끝낸 세션에서 무엇이 잘못됐는지
```

점수 없음, 모델 사용량 없음, 몇 초면 끝. 실제로 한 작업을 대상으로 합니다. 아무것도 업로드하지
않고 텔레메트리는 꺼져 있으며, 켤 것도 없습니다.

---

## 두 개의 절반

|  | `aos review` | `aos assess` |
|---|---|---|
| 읽는 것 | 이미 디스크에 있는 Codex·Claude Code 트랜스크립트 | 통제된 여섯 과제 패밀리를 등록한 에이전트로 실행 |
| 비용 | 없음 — 모델을 부르지 않음 | 모델 사용량, 격리된 워크스페이스에서 |
| 내놓는 것 | 하나하나 어느 단계에서 나왔는지 밝히는 지적 | 100점 만점의 점수, 또는 점수가 없는 이유 |
| 답하는 질문 | *나는 무엇을 반복하고 있는가?* | *이 조건에서 나는 이 에이전트를 얼마나 잘 운용하는가?* |

### `aos review` — 비용이 들지 않는 절반

```bash
node bin/aos.mjs review --since 12   # 최근 열두 세션에서 반복되는 것
node bin/aos.mjs review --list       # 하나 고르기
```

| 규칙 | 언제 발화하는가 |
|---|---|
| `completion-claimed-without-verification` | 아무것도 다시 돌리지 않은 편집 뒤에 성공을 보고했을 때 |
| `session-ended-on-stale-evidence` | 마지막 검증이 마지막 편집보다 앞설 때 |
| `edits-outside-the-working-directory` | 작업 중이던 트리 밖으로 쓰기가 나갔을 때 |
| `destructive-command-executed` | 되돌릴 수 없는 명령이 실행됐을 때. 통상적인 동기화는 제외 |
| `secret-material-in-session` | 키 자료가 나타났을 때. 종류만 밝히고 값은 절대 다시 적지 않음 |
| `long-uninterrupted-tool-run` | 입력 없이 길게 이어진 구간. 그 안에서 무언가 실패했거나 반복됐을 때만 지적 |

모든 지적은 그것이 나온 단계를 지목합니다. 도구를 믿는 대신 세션에 남은 기억과 대조하라는
뜻입니다. `--since` 쪽이 더 쓸모 있습니다. 한 세션은 무슨 일이 있었는지 알려주고, 열두 세션은
무엇을 반복하는지 알려줍니다.

### `aos assess` — 숫자를 내놓는 절반

<img src="docs/assets/aos-families.svg" alt="여섯 개의 코딩 과제 패밀리: 의도, 맥락, 그래프, 루프와 상태, 거짓 완료, 복구·안전·효율." width="960" height="252">

```bash
node bin/aos.mjs assess --template aos-plan.json          # 계획 작성
node bin/aos.mjs assess --plan aos-plan.json --checkpoints
```

각 패밀리는 등록된 에이전트 CLI를 격리된 워크스페이스에서 실행하고 숨은 검증기가 에이전트가
**실제로 만들어낸 것**을 채점합니다. 만들었다고 말한 것이 아니라요.

<img src="docs/assets/aos-pipeline.svg" alt="선언된 프로필과 잠긴 시드가 통제된 실행을 만들고 실행은 운영자 체크포인트에서 멈추며, 숨은 검증기가 에이전트의 산출물을 채점한다. 20개 지표가 결정론적 채점기로 들어가고 발급 게이트가 점수를 실을 수 있는지 정하며, 잠긴 시드 세 개가 하나의 Operator Score가 된다." width="960" height="392">

---

## 아무도 보지 않은 실행은 점수를 받지 못합니다

여섯 차원 중 하나는 **실행이 진행되는 동안 운영자가 무엇을 했는가**를 묻습니다. 트랜스크립트로는
답할 수 없는 질문입니다. `--checkpoints`를 주면, 막힌 지점에 도달한 단계가 멈추고 무엇을 봤는지
보여줍니다:

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

**선택지 자체는 결코 점수가 아닙니다.** 채점되는 것은 그 답이 만든 상태 변화 — 바뀐 지시,
옮겨진 경로, 실제로 멈춘 중단 — 그리고 그 뒤에 이어진 작업이 같은 것의 반복이었는지입니다.
신중해 보이는 항목을 고르고 나서 아무것도 바꾸지 않은 채 재시도하는 것이야말로 체크포인트가
잡으려는 결함이고, 라벨이 지표였다면 그게 높은 점수를 받았을 겁니다.

터미널인지는 확인하지 않습니다. `expect`도 pty를 쥘 수 있고, pty를 쥔 채 자리를 뜨는 사람도
있습니다. 여기 있다는 건 플래그로 밝힙니다. 플래그가 없으면 실행은 무인으로 끝나고 `INCOMPLETE`를
보고하며, 점수가 얼마였을지를 함께 적습니다.

## 세 번의 실행, 하나의 숫자

```bash
node bin/aos.mjs cycle start                                  # 시드 세 개, 지금 고정
node bin/aos.mjs cycle run --plan aos-plan.json --checkpoints
node bin/aos.mjs cycle                                        # operator score
node bin/aos.mjs dashboard                                    # 읽기 전용, 루프백, 토큰
```

시드는 한 번 뽑고 다시는 뽑지 않습니다. 그러지 않으면 *스무 번 돌려서 좋은 세 개만 남기기*가
한 발짝 거리입니다. Operator Score는 유효한 모든 실행의 중앙값이고 낮은 것도 포함합니다.
제외되는 것은 아무것도 측정하지 못한 실행뿐이며, 각각 그 이유와 함께 인쇄됩니다. 한 대의 기계에서
세 번 반복한 것은 **local repeat evidence**로 보고하며, 결코 confidence라 부르지 않습니다.

## 무엇이 숫자를 막고, 천장은 무엇을 하는가

<img src="docs/assets/aos-gates.svg" alt="발급 게이트에는 다섯 조건이 있고 모두 성립해야 점수가 발급된다. 네 개의 천장은 감점이 아니라 천장으로 적용되고 가장 낮은 것이 이긴다. 안전 39는 FRAGILE, 거짓 완료 49와 무시된 치명적 오류 59는 DEVELOPING, 정확한 리비전 누락 69는 OPERATIONAL에 떨어진다." width="960" height="436">

천장은 감점이 아닙니다. 비밀을 복사한 실행은 나머지를 아무리 잘했어도 39에서 막힙니다. 그것을
평균으로 희석한 숫자는 다른 실행을 기술하는 숫자이기 때문입니다.

---

## 이 도구가 되기를 거부하는 것

설계의 대부분은 거부이고 그게 핵심입니다.

| 아닌 것 | 이유 |
|---|---|
| 능력의 측정 | 점수는 선언된 환경과 과제 묶음에 조건부이며, 나타나는 모든 곳에서 그렇게 말합니다 |
| 모델·하네스 벤치마크 | 모델은 고정하고 단위는 운영자입니다 |
| 백분위·순위·인증 | 줄 세울 모집단이 없고, 그런 주장도 하지 않습니다 |
| 채용·승진·감시 도구 | [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md)에 명시돼 있으며, 암시로 남기지 않았습니다 |
| SaaS·텔레메트리 제품 | 모든 것이 로컬 디스크에 남습니다. 코드베이스에 아웃바운드 클라이언트가 없습니다 |
| 검증된 결과 | `EXPERIMENTAL / PROVISIONAL` — 교정 연구도, 독립 재현도, 자격 있는 검토도 없습니다 |

직접 쓰는 계획은 **채점 입력이 아닙니다.** 한때 그 계획이 스무 개 중 열일곱 개 지표를 스스로에
대해 쓴 JSON의 형식 검사만으로 정했고, 글자 그대로 쓰레기인 계획이 17/17을 받았습니다. 지금은
지표가 실행에서 관측되거나 `NOT_OBSERVED`이며, `NOT_OBSERVED`는 결코 0이 아닙니다.

이 패밀리들의 답은 `lib/suite.mjs` 안에 있습니다. 연습용으로는 괜찮고, 이것이 시험이 아닌 이유이기도
합니다.

## 무엇을 측정했는가

실제 Codex, 한 대의 기계, 사이클마다 잠긴 시드 세 개, 모든 실행에 사람이 붙었습니다:

| | 에이전트 샌드박스 | Operator Score | 실행별 | 편차 |
|---|---|---|---|---|
| 1 | 켬 | **69** | 69, 69, 83 | 14 |
| 2 | 끔 | *철회* | 49, 59, 89 | — |
| 3 | 끔 | **90** | 90, 87, 92 | 5 |

2번의 집계는 보고하지 않고 철회했습니다. 한 실행의 점수를 세 시드 전부에 기록해서, 그 숫자는 한
실행을 세 번 센 것이었습니다. 개별 점수는 진짜이고 그것이 결함 세 개를 찾아냈습니다. 셋 다 3번 사이클 전에 고쳤습니다.

`aos review`는 규칙을 만든 작업에서 떼어놓은 320개 세션으로 한 번 측정했습니다: **고위험 지적
10건 중 4건이 옳았습니다.** 여섯 건의 오류는 모두 고쳤지만 그것은 두 번째 측정이 아닙니다.
오류를 드러낸 세션으로 잰 수정은 튜닝 수치입니다. [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)가
그렇게 적고 있고, 다시 잴 미사용 세션이 코퍼스에 남지 않았다는 것도 적고 있습니다.

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 세 개의 수용 게이트
```

원장은 각 세션의 digest, 각 지적의 식별자, 판정과 이유를 담습니다. 트랜스크립트는 결코 담지
않습니다.

## 보안과 프라이버시

| | |
|---|---|
| 네트워크 | 루프백 서버 하나. `127.0.0.1` 바인드, 토큰 필수, 읽기 전용, GET 전용, 트랜스크립트를 반환하는 경로 없음. 코드베이스에 아웃바운드 클라이언트가 없습니다 |
| 의존성 | 없음. `npm ci`가 아무것도 설치하지 않습니다 |
| 평가받는 에이전트 | `HOME`을 교체하고 환경을 걸러 실행되며 `AOS_` 접두 변수는 하나도 받지 않습니다. 실행 기록이 어디 있는지 결코 알지 못합니다 |
| 비밀 | 출력을 읽는 지점에서 제거되고 종류로만 보고되며, 지적·결과·이벤트에 값이 다시 적히지 않습니다 |
| 홈 디렉토리 | `~/.aos`는 `0700`, 모든 파일은 `0600` |

취약점은 [`SECURITY.md`](SECURITY.md)로 제보해 주세요.

## 요구사항

Node `>=22.18 <25`, macOS 또는 Linux. 전역으로 설치되는 것은 없고 레지스트리에 발행된 패키지도
없습니다. `npm pack`이 로컬에 설치 가능한 tarball을 만듭니다.

## 개발

```bash
npm ci
npm test                 # 스위트
npm run verify:mvp       # 계약·천장·밴드가 여전히 말한 대로인지
npm run test:mutation    # 이름 붙은 가드를 하나씩 부수고, 지목된 테스트가 죽는지 확인
npm run smoke:package    # 패킹해서 다른 곳에 설치하고 운영자처럼 써보기
```

CI는 변경마다 일곱 레인을 돌립니다. Ubuntu 22·Ubuntu 24·macOS 24에서 스위트, mutation과
`verify:mvp`, Ubuntu와 macOS에서 패키지 스모크. 브랜치는 git flow를 따르며, 모델은
[`CONTRIBUTING.md`](CONTRIBUTING.md)에 적혀 있습니다.

## 문서

| | |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 무엇이 확립되지 않았는지, 모든 숫자가 무엇에 묶여 있는지 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 무엇에 써도 되고 무엇에 쓰면 안 되는지 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 브랜치 모델, 변경이 갖춰야 할 것, DCO |
| [`SECURITY.md`](SECURITY.md) | 취약점 제보 |

## 라이선스

MIT — [`LICENSE`](LICENSE) 참조. 기여는 [DCO](CONTRIBUTING.md)에 따르며 `git commit -s`로 서명해
주세요. 서드파티 고지는 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 있습니다.
