<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**あなたが制御している変数はモデルではありません。あなた自身です。**

[![CI](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml)
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

二人のオペレーターが、同じモデルで、同じリポジトリに対して、同じタスクを実行します。一人は
リリースします。もう一人は予算を使い切り、動かないものをマージします。名前を挙げられるどの
ベンチマークも、**同一だった側**を測っています。

これは残りの半分を測り、出力する数値ごとに、それが何に束縛されているのかを併せて示します。

Claude Code なら、クローンするものもインストールするものもありません。

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

スコアなし、モデルの消費なし、数秒で終わり、対象はあなたが実際に行った作業です。何もアップ
ロードされず、テレメトリはオフで、オンにするものもありません。このリポジトリには実行時依存が
なく、エージェントは `PATH` から自分で登録され、ランタイムの資格情報はそのランタイムが本来
見つけたはずの場所から解決されます。

リポジトリから直接動かすなら:

```bash
git clone https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review          # 今終えたセッションで何がまずかったのか
```

## 二つの半分

|  | `aos review` | `aos assess` |
|---|---|---|
| 読むもの | ディスクにすでにある Codex / Claude Code / Grok のトランスクリプト | 統制された六つの課題ファミリーを、あなたのエージェントで実行 |
| コスト | なし — モデルを呼ばない | モデル消費。隔離されたワークスペースで |
| 出すもの | どの手順から出たかを名指しする具体的な指摘 | 100 点満点のスコア、またはスコアが無い理由 |
| 答える問い | *自分は何を繰り返しているのか* | *この条件下で、自分はこのエージェントをどれだけうまく運用できているのか* |

### `aos review` — コストのかからない半分

```bash
node bin/aos.mjs review --since 12   # ツール実行のある直近十二セッションで繰り返されているもの
node bin/aos.mjs review --list       # 一つ選ぶ
```

| ルール | 発火する条件 |
|---|---|
| `completion-claimed-without-verification` | 何も再実行していない編集のあとに成功を報告した |
| `session-ended-on-stale-evidence` | 最後の検証が最後の編集より前にある |
| `edits-outside-the-working-directory` | 作業していたツリーの外に書き込みが出た |
| `destructive-command-executed` | 取り返しのつかないコマンドが走った。通常の同期はこれに当たらない |
| `secret-material-in-session` | 鍵の材料が現れた。種類だけを報告し、値は二度と書かない |
| `long-uninterrupted-tool-run` | あなたの入力がない長い区間。その中で何かが失敗したか繰り返された場合にのみ指摘 |
| `completion-claimed-over-a-failed-check` | 完了と言う直前の検証が失敗を報告していたのに、完了と述べた場合 |
| `verification-exit-status-discarded` | 検査を `\|\| true` の下で走らせ、その結果を見ることがそもそもできなかった場合 |

すべての指摘は、それが生まれた手順を名指しします。ツールを信じる代わりに、あなた自身のセッション
の記憶と突き合わせられるようにするためです。`--since` のほうが役に立ちます。一つのセッションは
何が起きたかを教え、十二のセッションはあなたが何を繰り返しているかを教えます。

### `aos assess` — 数値を出す半分

<img src="docs/assets/aos-families.svg" alt="六つのコーディング課題ファミリー: 意図、文脈、グラフ、ループと状態、偽の完了、復旧・安全・効率。" width="960" height="252">

```bash
node bin/aos.mjs assess --template aos-plan.json          # 計画を書く
node bin/aos.mjs assess --plan aos-plan.json --checkpoints
```

各ファミリーは、登録されたエージェント CLI を隔離ワークスペースで実行し、隠れた検証器が
エージェントが**実際に作ったもの**を採点します。作ったと述べたことではありません。

<img src="docs/assets/aos-pipeline.svg" alt="宣言されたプロファイルと固定されたシードが統制された実行を生み、実行はオペレーター・チェックポイントで停止し、隠れた検証器がエージェントの成果物を採点する。二十の指標が決定的スコアラーに入り、発行ゲートがスコアを担えるかを決め、固定シード三つが一つの Operator Score になる。" width="960" height="392">

---

## 誰も見ていなかった実行にスコアは出ません

六つの次元のうち一つは、**実行が進んでいるあいだにあなたが何をしたか**を問います。トランス
クリプトからは答えられない問いです。`--checkpoints` を付けると、行き詰まりに達した段階が停止し、
何を見たのかを示します。

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

**選択肢そのものは決してスコアではありません。** 採点されるのは、あなたの答えが生んだ状態の変化
— 変わった指示、移った経路、実際に止まった停止 — と、そのあとに続いた作業が同じことの繰り返し
だったかどうかです。慎重そうに見える項目を選んだうえで何も変えずに再試行することこそ、チェック
ポイントが捕まえようとしている欠陥であり、ラベルが指標だったならそれが高得点を取っていたはずです。

端末かどうかは確認しません。`expect` も pty を握れますし、人が pty を握ったまま席を外すこともでき
ます。あなたがここにいることはフラグで示します。フラグがなければ実行は無人で終わり、`INCOMPLETE`
を報告し、スコアがいくつになっていたかを併記します。

## 三回の実行、一つの数値

```bash
node bin/aos.mjs cycle start                                  # シード三つ、いま固定
node bin/aos.mjs cycle run --checkpoints
node bin/aos.mjs cycle                                        # operator score
node bin/aos.mjs dashboard                                    # 読み取り専用、ループバック、トークン
```

シードは一度引いたら二度と引き直しません。そうでなければ*二十回まわして良い三つだけ残す*が一歩
先にあります。Operator Score は有効なすべての実行の中央値で、低いものも含みます。除外されるのは
何も測れなかった実行だけで、それぞれ理由とともに出力されます。一台のマシンでの三回の反復は
**local repeat evidence** として報告し、confidence とは決して呼びません。

## 何が数値を差し止め、天井が何をするのか

<img src="docs/assets/aos-gates.svg" alt="発行ゲートは五つの条件を持ち、すべて成立しなければスコアは発行されない。四つの天井は減点ではなく天井として適用され、最も低いものが勝つ。安全 39 は FRAGILE、偽の完了 49 と無視された致命的エラー 59 は DEVELOPING、正確なリビジョンの欠落 69 は OPERATIONAL に落ちる。" width="960" height="436">

天井は減点ではありません。秘密を複製した実行は、ほかをどれだけうまくやっていても 39 で止まり
ます。それを平均で薄めた数値は、別の実行を記述する数値だからです。

---

## これが拒むもの

設計の大半は拒否であり、それが要点です。

| 違うもの | 理由 |
|---|---|
| 能力の測定 | スコアは宣言された環境と課題パックに条件付きであり、現れるすべての場所でそう述べます |
| モデル／ハーネスのベンチマーク | モデルは固定し、単位はオペレーターです |
| パーセンタイル・順位・認定 | 順位付けする母集団が存在せず、そのような主張もしません |
| 採用・昇進・監視の道具 | [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) に明記されており、含みに留めていません |
| SaaS／テレメトリ製品 | すべてがあなたのディスクに残ります。コードベースに送信クライアントはありません |
| 検証済みの結果 | `EXPERIMENTAL / PROVISIONAL` — 較正研究も、独立再現も、資格ある査読もありません |

あなたが書く計画は**採点の入力ではありません**。かつてはそれが、あなた自身について書いた JSON の
形だけを見て二十のうち十七の指標を決めており、文字どおりのでたらめな計画が 17/17 を取りました。
いま、指標は実行から観測されるか `NOT_OBSERVED` であり、`NOT_OBSERVED` は決してゼロでは
ありません。

これらのファミリーの答えは `lib/suite.mjs` の中にあります。練習にはそれで十分で、これが試験では
ない理由でもあります。

## 何を測ったのか

実際の Codex、一台のマシン、サイクルごとに固定シード三つ、すべての実行に人が付きました。

| | エージェントのサンドボックス | Operator Score | 各実行 | 幅 |
|---|---|---|---|---|
| 1 | オン | **69** | 69, 69, 83 | 14 |
| 2 | オフ | *撤回* | 49, 59, 89 | — |
| 3 | オフ | **90** | 90, 87, 92 | 5 |

サイクル 2 の集計は報告せず撤回しました。一つの実行のスコアを三つのシードすべてに記録していた
ため、その数値は一つの実行を三回数えたものでした。個々のスコアは本物で、それが三つの欠陥を
見つけました。すべてサイクル 3 の前に修正しています。

`aos review` は、ルールを書いた作業から取り分けた 320 セッションで一度だけ測定しました。
**高深刻度の指摘 10 件のうち 4 件が正しい**という結果です。六つの誤りはすべて修正しましたが、
それは二度目の測定ではありません。誤りを露呈させたセッションで測った修正はチューニングの数値です。
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) がそう述べ、再測定に使える未使用のセッションが
コーパスに残っていないことも述べています。

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 三つの受け入れゲート
```

台帳が保持するのは、各セッションのダイジェスト、各指摘の識別子、あなたの判定とその理由です。
トランスクリプトは決して保持しません。

## レポート

スコアに添えられる HTML レポートは、オペレーター自身のロケールで表示されます。韓国語なら韓国語、
それ以外はすべて英語です。両方の言語がファイルに入っていて片方を CSS が隠すので、同僚に送った
レポートは受け取った人の言語で開きます。切り替えはスクリプトではなくチェックボックスです。この
ページはどこにも何も要求しない、という性質をそのまま保つためです。

## セキュリティとプライバシー

| | |
|---|---|
| ネットワーク | ループバックサーバー一つ。`127.0.0.1` にバインド、トークン必須、読み取り専用、GET のみ、トランスクリプトを返す経路はありません。コードベースに送信クライアントはありません |
| 依存関係 | なし。`npm ci` は何もインストールしません |
| 評価されるエージェント | `HOME` を差し替え、環境を絞って実行され、`AOS_` で始まる変数は一つも受け取りません — あなたの実行記録の場所を決して知りません |
| ランタイム認証 | そのランタイムが本来見つけたはずの場所から見つけ、プロセス環境で渡します。設定するものはありません。名前と出所は記録し、値は記録せず、トークンをディスクに残しません。`--no-auto-auth` で切れます |
| 秘密 | 出力を読む地点で除去し、種類だけを報告し、指摘・結果・イベントに値を書き戻しません |
| あなたのホーム | `~/.aos` は `0700`、すべてのファイルは `0600` |

脆弱性の報告は [`SECURITY.md`](SECURITY.md) からお願いします。

## 要件

Node `>=22.18 <25`、macOS または Linux。グローバルにインストールされるものはなく、レジストリに
公開されたパッケージもありません。`npm pack` がローカルにインストール可能な tarball を作ります。

## 開発

```bash
npm ci
npm test                 # スイート
npm run verify:mvp       # 契約・天井・バンドが依然として述べたとおりか
npm run test:mutation    # 名前の付いたガードを一つずつ壊し、名指しのテストが死ぬか確かめる
npm run smoke:package    # パックして別の場所に入れ、オペレーターとして使ってみる
```

CI は変更のたびに七つのレーンを走らせます。Ubuntu の Node 22 と Node 24、macOS の Node 24 での
スイート、mutation と `verify:mvp`、Ubuntu と macOS でのパッケージスモークです。ブランチは git flow に
従い、そのモデルは [`CONTRIBUTING.md`](CONTRIBUTING.md) に書かれています。

## ドキュメント

| | |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 何が確立されていないか、すべての数値が何に束縛されているか |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 何に使ってよく、何に使ってはならないか |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | ブランチモデル、変更が備えるべきもの、DCO |
| [`SECURITY.md`](SECURITY.md) | 脆弱性の報告 |

## ライセンス

MIT — [`LICENSE`](LICENSE) を参照。コントリビューションは [DCO](CONTRIBUTING.md) に従い、
`git commit -s` で署名してください。サードパーティ告知は
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) にあります。
