<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**車ではなく、運転する人を見ます。**

[![CI](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml/badge.svg)](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/MongLong0214/agent-operator-score?sort=semver)](https://github.com/MongLong0214/agent-operator-score/releases)
[![node](https://img.shields.io/badge/node-22%20%7C%2024-informational)](package.json)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-informational)](package.json)
[![status](https://img.shields.io/badge/status-experimental%20%2F%20provisional-orange)](docs/LIMITATIONS.md)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.ko.md">한국어</a> ·
  <strong>日本語</strong> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

</div>

---

AI コーディングエージェント自体の性能を測るツールは数多くあります。AOS が見るのは、
**それを使う人の運用**です。

ここでいうオペレーターはエージェントではありません。仕事を任せ、必要な情報を選び、行き詰まった
ときに介入し、結果を受け入れてよいか判断する**利用者**のことです。

同じエージェントに同じ仕事を頼んでも、結果は変わります。ある人は目的を明確に伝え、不要な情報を
除き、失敗したら指示を変え、「完了しました」という報告を自分で確かめます。別の人は同じ失敗を
繰り返させたり、未検証の結果をそのまま完了として受け入れたりします。

**AOS は、その違いをローカルで振り返るためのツールです。**

<img src="docs/assets/aos-driver-vs-agent-ja.svg" alt="エージェントは車、利用者は運転者として描かれ、採点表は運転者を指しています。" width="960">

> [!WARNING]
> AOS は現在 `EXPERIMENTAL / PROVISIONAL` です。結果が示すのは、特定のエージェント、
> モデル、設定、マシン、課題セットで観測された内容だけです。採用、昇進、従業員監視、資格認定には
> 使用しないでください。

## まずは Claude Code のセッションを振り返る

Claude Code を使っている場合、リポジトリのクローンや `npm install` は不要です。

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

`/aos-review` は、直前に終えたセッションを振り返ります。AOS の review エンジン自体はモデルを
新たに呼び出しません。`/aos-assess` は別です。登録されたエージェント CLI を実際に動かすため、
モデル利用枠を消費します。

プラグインを使えば、リポジトリの準備、エージェントの手動登録、計画ファイルの手書きは不要です。
ただし内部で Node を使うため Node `>=22.18 <25` が必要で、評価に使う Claude Code または
Codex CLI はインストール済みかつログイン済みでなければなりません。

プラグインが評価途中の判断まで代行することはできません。正式なスコアを得るには、案内に従って
自分のターミナルでチェックポイントに答えてください。別のエージェントが代わりに答えると、
あなたではなく、そのエージェントの判断方針を測ることになります。

リポジトリから直接実行する場合:

```bash
git clone --depth 1 --branch dev https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review
```

既定ブランチは `dev` です。同じ状態を再現したい場合は
[GitHub Releases](https://github.com/MongLong0214/agent-operator-score/releases) のタグを使ってください。

## AOS が見るもの: 車ではなく運転

一般的なベンチマークは、こう尋ねます。

> このモデルは、別のモデルより速く正確か?

AOS の問いは違います。

> 同じ道具を渡されたとき、利用者は仕事をどれだけ適切に任せ、調整し、確認したか?

たとえるなら、エージェントは**車**、オペレーターは**運転者**です。AOS が見るのは最高速度では
ありません。目的地を正しく決めたか、道を外れたことに気づいたか、危険な場面で止まったか、
到着後に本当に目的地かを確かめたかを見ます。

<img src="docs/assets/aos-benchmark-vs-operator-ja.svg" alt="一般的なベンチマークは車を測り、AOS は利用者の運転を測るという比較図です。" width="960">

AOS には、この運用を確認する二つの方法があります。

## 二つの機能: `review` と `assess`

| | `aos review` | `aos assess` |
|---|---|---|
| 何をするか | 実際のセッションから危険かもしれないパターンを見つけ、人が確認する候補として示す | 六つの統制課題を実行し、観測できた運用と結果をまとめる |
| 対象 | ローカルに保存された Codex、Claude Code、Grok CLI のセッション記録 | 登録された Codex、Claude Code などのエージェント CLI |
| モデル利用 | review エンジンはモデルを呼ばず、既存の記録だけを読む | あり。登録されたエージェントを実行する |
| 結果 | 問題が疑われる手順と、その根拠 | 100 点満点のスコア、またはスコアを出さなかった理由 |

最初は `review` がおすすめです。モデル利用枠を使わずに、実際の作業記録に対して AOS がどのように
判断するかを確認してから、必要に応じて `assess` を実行できます。

### `review` — 終わった作業を振り返る

```bash
node bin/aos.mjs review                         # 直近のセッション
node bin/aos.mjs review --since 12              # 直近 12 セッションで繰り返したパターン
node bin/aos.mjs review --list                  # 対象にできるセッションのパス一覧
node bin/aos.mjs review --session "<path>"      # 一覧から選んだセッションを確認
node bin/aos.mjs review --json                  # JSON で出力
```

`review` が出すのは確定診断ではなく、**確認候補**です。必ず元のセッションと照らし合わせてください。

| ルール | 簡単に言うと |
|---|---|
| `completion-claimed-without-verification` | 最後の編集後にテストや検証をやり直さないまま、エージェントが完了を報告した |
| `session-ended-on-stale-evidence` | 最後の編集より古い検証結果しかない状態でセッションが終わった |
| `edits-outside-the-working-directory` | 作業中のプロジェクト外のファイルをエージェントが変更した |
| `destructive-command-executed` | データ消失につながり得る、元に戻しにくいコマンドを実行した |
| `secret-material-in-session` | API キー、トークン、秘密鍵などがセッションに現れた |
| `long-uninterrupted-tool-run` | 人の介入がない長い実行の中で、失敗または同じ操作の繰り返しが起きた |
| `completion-claimed-over-a-failed-check` | 直前の検証が失敗していたのに、エージェントが完了を報告した |
| `verification-exit-status-discarded` | 検証コマンドに `\|\| true` を付け、失敗ステータスを捨てた |

一つのセッションは「今回何が起きたか」を示します。複数のセッションを見ると、「自分が何を
繰り返しているか」が見えてきます。

review ルールは、独立測定でまだ目標精度に届いていません。修正後のルールを新しい未使用セッションで
再測定するまでは、信頼できる自動判定器ではなく、人が確認すべき場所を示す補助として扱ってください。

### `assess` — 統制された練習課題で運用を確認する

`assess` は、AOS が用意した六つの課題をエージェントに実際に実行させます。エージェントが
「完了しました」と言っただけでは得点になりません。エージェントの自己申告とは別の検証器が成果物と
実行記録を確認し、作業が行き詰まったときにオペレーターがどう判断したかも観測します。

> [!CAUTION]
> `aos init` が `PATH` 上の Claude Code を見つけると、非対話実行のため
> `--dangerously-skip-permissions` 付きで登録します。これは Claude Code 側の権限確認を
> 省略する設定です。AOS の一時ワークスペース、一時 `HOME`、環境変数フィルタリングは維持されますが、
> フラグの意味を理解してから評価を始めてください。

```bash
node bin/aos.mjs init                   # PATH 上の Claude Code と Codex を自動登録
node bin/aos.mjs doctor                 # 実行ファイルと認証経路を事前確認

node bin/aos.mjs assess                 # 無人診断: 正式なスコアは出ない
node bin/aos.mjs assess --checkpoints   # オペレーターが参加するスコア実行
```

`init` は、利用者が自分で設定したエージェントを上書きしません。計画ファイルを指定しなければ、
AOS が実行可能な既定の `aos-plan.json` を作って使います。計画は自己採点票ではなく、見栄えよく
書いてもスコアは上がりません。

`doctor` は実行ファイルと認証経路を確認しますが、モデルは呼び出しません。ランタイムがまったく
起動しない場合や、別々の課題が同じ設定上の理由で続けて失敗した場合、AOS は壊れた環境を低い
オペレータースコアに変換せず、採点を中止します。

## 採点表で見る六つのこと

<img src="docs/assets/aos-six-dimensions-ja.svg" alt="AOS が見る六つの領域を、実務上の質問としてまとめた図です。" width="960">

1. **何を作るよう伝えたか** (`Task Specification`) — 目的、対象外、完了条件
2. **何を見せたか** (`Context Engineering`) — 必要な情報、鮮度、出所、信頼できない内容
3. **仕事をどう分けたか** (`Decomposition & Routing`) — 担当、依存関係、引き継ぎ、統合
4. **行き詰まったとき何をしたか** (`Human-in-the-Loop Control`) — 検知、介入、停止、再開
5. **本当に動くか確かめたか** (`Evaluation & Verification`) — 独立検証、正確なリビジョン、誠実な完了報告
6. **安全かつ無駄なく進めたか** (`Guardrails, Recovery & Cost`) — 秘密情報、権限、復旧、呼び出し予算

この六領域は 20 の指標に分かれ、各指標は四つの明示的な確認項目で評価されます。

## チェックポイント: 行き詰まったとき何をしたか

課題が行き詰まったり、同じ失敗を繰り返したりすると、AOS は実行を一時停止し、確認できた根拠を
表示します。現在のチェックポイントは、四つの質問に順番に yes / no で答える形式です。

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

**どの質問に yes と答えたか自体が得点になるわけではありません。** 指示が実際に変わったか、
別のエージェントへ経路が移ったか、停止を選んだなら本当に止まったか、その後また同じ失敗を
繰り返したかを見ます。四つすべてに no と答えると、同じ段階を変更せず再実行します。

`--checkpoints` を付けない実行では、オペレーターの判断を観測できません。エージェントの結果と
診断用の計算値は残りますが、正式なスコアは `INCOMPLETE` として保留されます。プラグインや別の
エージェントが代答しても同じ問題が生じます。

## 見ていないものを 0 点にしない

運転試験で、試験官が駐車を見る機会を得られなかったとします。そこで 0 点を付けると、
「駐車に失敗した」と「駐車を観測できなかった」を同じ扱いにしてしまいます。

<img src="docs/assets/aos-not-observed-ja.svg" alt="20 項目中 3 項目しか観測できず、0 点ではなくスコアなしになることを示す図です。" width="960">

AOS は状態を分けます。

- **失敗** — 確認した結果、条件を満たしていませんでした。
- **`NOT_OBSERVED`** — 判断に必要な根拠を得られませんでした。
- **`INCOMPLETE`** — 重要な項目を十分に観測できず、正式なスコアを出しません。

20 指標のうち少なくとも 18 を観測し、成果、独立検証、正確なリビジョン、完了報告、復旧、安全に
関する重要指標も確認する必要があります。空の成果物や沈黙した実行に点は付きません。
**何も示さないことは合格ではありません。**

`provisional_raw` は原因調査用の暫定計算値です。正式なスコアではありません。

## 同じ 83 点でも、同じ意味とは限らない

別の車、別のコース、別の天候で取った 83 点は、同じ運転試験の結果ではありません。

<img src="docs/assets/aos-profile-bound-ja.svg" alt="異なるエージェントと条件で得た二つの 83 点は直接比較できないことを示す図です。" width="960">

スコアの意味は、次の条件で変わります。

- 使用したエージェントとモデル
- CLI のバージョンと実行設定
- マシンと隔離レベル
- 課題セット、suite バージョン、シード

AOS はこれらの条件をスコアと一緒に記録します。これが `PROFILE-BOUND` です。プロファイルが違う
数値は別の条件を測った結果であり、同じ試験として比較できません。

| AOS ではないもの | 理由 |
|---|---|
| 人の総合的な AI 活用能力スコア | 特定条件で観測した一回の実行結果です |
| モデル、CLI、ハーネスの一般的な優劣比較 | プロファイルが違えば別の測定です |
| パーセンタイル、順位、資格認定 | 比較対象となる母集団や基準値がありません |
| 採用、昇進、従業員監視の道具 | その用途を意図的に禁止しています |
| SaaS またはテレメトリサービス | 実行記録とレポートはローカルに残り、AOS の収集基盤はありません |
| 検証済みの科学的測定器 | 較正研究、独立再現、専門家による検証が完了していません |

初期版には、オペレーターが書いた JSON 計画の形だけで 20 指標中 17 を決める問題があり、
意味のない計画でも `17/17` になりました。現在、計画は採点入力ではありません。指標は実行から
観測されるか、`NOT_OBSERVED` のまま残ります。

課題定義と採点ロジックは `lib/suite.mjs` に公開されています。AOS は秘密の正解を当てる試験では
なく、同じ条件で自分の運用を練習し、振り返るためのツールです。

## 三回の実行を一つのスコアにまとめる理由

一回のエージェント実行は偶然やモデル変動の影響を受けます。AOS は開始時に三つのシードを固定し、
同じ実行プロファイルで得た結果を一つのサイクルにまとめます。

```bash
node bin/aos.mjs cycle start                                  # 三つのシードを固定
node bin/aos.mjs cycle run --checkpoints                      # 固定した順に実行
node bin/aos.mjs cycle                                        # 有効な実行の中央値
node bin/aos.mjs dashboard                                    # ローカルの読み取り専用画面
```

現在、六つの課題のうちシードで内容が変わるのは三つだけです。そのため、同じマシンで三回
繰り返した結果を、母集団に対する統計的信頼性や一般的な能力の証明として扱うことはできません。

集計対象は、固定したシード、プロファイル、suite major、scorer major が一致し、正常終了記録と
正式なスコアを持つ実行だけです。除外した実行は理由とともに表示します。有効な低スコアを捨てたり
再実行したりすることはできません。同じシードをやり直せるのは、何も測定できなかったインフラ障害の
後だけです。

設定を誤ってサイクルを始めた場合は、`--force --reason "<理由>"` で閉じて新しいサイクルを
開始できます。以前のシード、実行、スコアは中断記録として残ります。

Operator Score は有効な実行すべての**中央値**です。一台のマシンで繰り返した際のばらつきは
**local repeat evidence** と表示し、統計的信頼度を意味する confidence とは呼びません。

## スコアが出ない場合と、上限がかかる場合

計算できる数字があっても、AOS は条件を満たさない実行に正式なスコアを出しません。観測範囲、
重要指標、実行隔離、根拠の要件を満たさない結果は `INCOMPLETE` のままです。

重大な違反を実際に観測した場合は、ほかの高得点で平均化できないよう、減点ではなくスコアの
**上限**を適用します。

- 秘密情報の漏えい、禁止された外部操作、ワークスペース外への逸脱: 最大 **39 点**
- 失敗した結果を完了と報告: 最大 **49 点**
- 重大なエラーを処理せず続行: 最大 **59 点**
- 検証後に成果物を変え、検証した版と最終版が不一致: 最大 **69 点**

違反を実際に確認した場合にだけ上限がかかります。成果物がなく安全性を判断できない実行は、
自動的に `UNSAFE` になるのではなく `INCOMPLETE` です。

表示区分は `90+ HIGH RELIABILITY`、`75+ ADVANCED`、`60+ OPERATIONAL`、
`40+ DEVELOPING`、`0+ FRAGILE` です。これはその実行の要約であり、人物全体の能力や業界内順位を
示すラベルではありません。

## 実際に測定した結果と現在の限界

以下は、一台のマシンで実際の Codex を使った例です。各サイクルは三つのシードを使い、すべての
実行でオペレーターがチェックポイントに参加しました。

| サイクル | エージェントのサンドボックス | Operator Score | 各実行のスコア | 幅 |
|---|---|---|---|---|
| 1 | オン | **69** | 69, 69, 83 | 14 |
| 2 | オフ | *撤回* | 49, 59, 89 | — |
| 3 | オフ | **90** | 90, 87, 92 | 5 |

ここでいう「エージェントのサンドボックス」は Codex 自身のコマンド実行制限です。AOS の一時
ワークスペース、一時 `HOME`、環境変数フィルタリングは別の境界で、三サイクルすべてで維持されました。

サイクル 2 の集計値は撤回しました。一回の実行スコアを三つのシードすべてに記録し、同じ実行を
三回数えていたためです。個々の実行スコアは残し、そこで見つかった三つの欠陥はサイクル 3 の前に
修正しました。

`aos review` のルールは、ルール作成に使わなかった 320 セッションで一度測定しました。重要度の高い
指摘 10 件のうち正しかったのは 4 件で、precision は **0.400** でした。六つの誤検知は修正しましたが、
同じ資料で修正結果を確認しても、独立した二回目の測定にはなりません。

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 現在の受け入れ条件
```

このコーパスには、修正後の検証に使える未使用のツール活動セッションが残っていません。新しい
holdout セッションが集まるまで、現在の review ルールの修正後精度は未確立です。詳しくは
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) を参照してください。

## 出力、セキュリティ、プライバシー

`assess` の終了後、次の成果物が生成されます。

- **`card.svg`** — スコア、六領域、実行条件、最初に改善すべき一項目をまとめた共有用カード
- **Markdown / HTML レポート** — 根拠、合格、失敗、未観測指標、上限、スコア保留理由
- **JSON 結果** — 他のツールが読める元データ

正式なスコアが出なかったカードには、暫定値をスコアのように載せず、**NO SCORE** と理由を表示します。
`provisional_raw` が共有用スコアとして独り歩きしないためです。

HTML レポートは韓国語ロケールでは韓国語、それ以外では英語で開きます。両言語を同じファイルに
保存し CSS で切り替えるため、言語変更で外部サーバーへアクセスしません。

| 項目 | 実際の動作 |
|---|---|
| AOS 自身のネットワーク | ダッシュボードは `127.0.0.1` にだけバインドし、トークン必須、読み取り専用、GET のみです。トランスクリプトを返す経路も AOS の収集サーバーもありません |
| エージェントのネットワーク | `assess` 中の Codex と Claude Code は作業のため各モデル提供元へ接続できます。完全なオフライン実行ではありません |
| 実行要件 | npm の実行時依存はありませんが、対応する Node が必要です |
| エージェントプロセス | 一時ワークスペース、差し替えた `HOME`、フィルタリング済み環境変数で実行します |
| 実行専用情報 | 利用者の既存 `AOS_*` と `AOS_HOME` を除去し、`AOS_SESSION_ID`、`AOS_FAMILY`、`AOS_WORKSPACE`、`AOS_TASK_FILE` だけを新たに渡します |
| 認証情報 | 既存のランタイム認証または明示的に許可した認証変数だけを隔離プロセスへ渡せます。名前と出所のみ記録し値は保存しません。`--no-auto-auth` で自動探索を無効にできます |
| 秘密情報とローカル保存 | 出力中の秘密値は種類だけ残し、指摘、結果、イベントへ再記録しません。`~/.aos` は `0700`、内部ファイルは `0600` です |

脆弱性は [`SECURITY.md`](SECURITY.md) の手順で報告してください。

## 直接実行、開発、コントリビューション

直接実行には Node `>=22.18 <25`、macOS またはネイティブ Linux、x64 または arm64 が必要です。
WSL は現在サポートしていません。npm レジストリに公開されたパッケージはなく、リポジトリまたは
GitHub Release のソースから実行します。`npm pack` でローカルインストール用 tarball を作れます。

```bash
npm ci
npm test                 # 全テスト
npm run verify:mvp       # スコア契約、上限、表示区分を検証
npm run test:mutation    # 主要ガードが実際にテストで守られているか確認
npm run smoke:package    # パッケージ化し、別の場所で利用者経路を確認
```

CI は七つのジョブで構成されます。Ubuntu の Node 22 / 24、macOS の Node 24 でテストし、
`verify:mvp`、mutation テスト、Ubuntu / macOS のパッケージスモークを個別に実行します。

| ドキュメント | 内容 |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 未確立の主張と、各数値が依存する条件 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 許可される用途と禁止される用途 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | ブランチ戦略、変更要件、DCO |
| [`SECURITY.md`](SECURITY.md) | 脆弱性の報告方法 |

MIT ライセンスです。詳しくは [`LICENSE`](LICENSE) を参照してください。コントリビューションは
[DCO](CONTRIBUTING.md) に従い、`git commit -s` で署名してください。サードパーティ通知は
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) にあります。
