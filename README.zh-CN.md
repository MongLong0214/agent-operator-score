<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**你能控制的变量不是模型，是你自己。**

[![CI](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MongLong0214/agent-operator-score/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/MongLong0214/agent-operator-score?sort=semver)](https://github.com/MongLong0214/agent-operator-score/releases)
[![node](https://img.shields.io/badge/node-22%20%7C%2024-informational)](package.json)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-informational)](package.json)
[![status](https://img.shields.io/badge/status-experimental%20%2F%20provisional-orange)](docs/LIMITATIONS.md)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>简体中文</strong>
</p>

</div>

---

两位操作者用同一个模型，在同一个仓库上，做同一个任务。一位交付了。另一位烧光预算，合入了跑不
起来的东西。你能叫得出名字的每一个基准，测的都是**完全相同的那一半**。

这个工具测另一半，并且它打印的每一个数字都会说明自己被绑定在什么条件上。

在 Claude Code 里，没有要克隆的，也没有要安装的。

```
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

没有分数，不消耗模型额度，几秒钟跑完，对象是你真正做过的工作。什么都不上传，遥测是关的，也没有
可以打开的开关。这个仓库没有运行时依赖，agent 会自己从 `PATH` 注册，运行时凭据也会到它本来会去
找的地方取。

想从仓库直接跑：

```bash
git clone https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review          # 你刚跑完的那次会话里出了什么问题
```

## 两个半边

|  | `aos review` | `aos assess` |
|---|---|---|
| 读什么 | 已经在你磁盘上的 Codex / Claude Code / Grok 会话记录 | 六个受控任务族，用你的 agent 跑 |
| 成本 | 无——不调用模型 | 模型额度，在隔离工作区中 |
| 产出 | 具体的问题，每一条都指名它来自哪一步 | 百分制的分数，或者一个没有分数的明确理由 |
| 回答 | *我在反复做什么？* | *在这些条件下，我把这个 agent 用得有多好？* |

### `aos review` —— 不花钱的那一半

```bash
node bin/aos.mjs review --since 12   # 最近十二次有工具活动的会话里反复出现的
node bin/aos.mjs review --list       # 挑一个
```

| 规则 | 什么时候触发 |
|---|---|
| `completion-claimed-without-verification` | 在一次没有任何东西重跑过的修改之后报告了成功 |
| `session-ended-on-stale-evidence` | 最后一次验证早于最后一次修改 |
| `edits-outside-the-working-directory` | 写入越出了你当时工作的目录树 |
| `destructive-command-executed` | 跑了不可逆的命令；例行同步不算 |
| `secret-material-in-session` | 出现了密钥材料，只报告种类，绝不重复其内容 |
| `long-uninterrupted-tool-run` | 一段没有你输入的长区间——只有当其中有东西失败或重复时才算问题 |
| `completion-claimed-over-a-failed-check` | 声称完成之前的那次校验已经报告失败，却仍然说完成了 |
| `verification-exit-status-discarded` | 检查跑在 `\|\| true` 下面，所以它报告了什么根本无从看见 |

每一条都指名产生它的那一步，好让你拿它和自己对那次会话的记忆去核对，而不是相信这个工具。
`--since` 更有用：一次会话告诉你发生了什么，十二次会话告诉你你在反复做什么。

### `aos assess` —— 产出数字的那一半

<img src="docs/assets/aos-families.svg" alt="六个编码任务族：意图、上下文、图、循环与状态、虚假完成、恢复与安全与效率。" width="960" height="252">

```bash
node bin/aos.mjs assess --template aos-plan.json          # 写一份计划
node bin/aos.mjs assess --plan aos-plan.json --checkpoints
```

每个任务族都会在隔离工作区里运行你注册的 agent CLI，由一个隐藏校验器给 agent **实际产出的东西**打分，而不是它对自己的描述。

<img src="docs/assets/aos-pipeline.svg" alt="声明的画像与锁定的种子产生一次受控运行；运行会在操作者检查点停下，隐藏校验器给 agent 的产物打分；二十项指标进入确定性评分器，签发闸门决定这次运行能否携带分数，三个锁定种子得出一个 Operator Score。" width="960" height="392">

---

## 没人看着的运行不会有分数

六个维度中有一个问的是：**运行进行时你做了什么**。这个问题无法从会话记录里回答。加上
`--checkpoints`，走到阻塞处的阶段会停下来，把它看到的东西给你看：

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

**选项本身从来不是分数。** 被评分的是你的回答造成的状态变化——改变了的指令、改道了的路径、
真正停下来的中止——以及随后的工作是不是同一件事的重复。选一个看起来谨慎的选项，然后什么都不改
地重试，正是检查点要抓的那个缺陷；如果标签就是指标，它反而会得高分。

这里不检查你是不是在终端前。`expect` 也能拿住一个 pty，人也可以拿着 pty 走开。你在场这件事由
参数来表明。不加这个参数，运行会以无人值守结束，报告 `INCOMPLETE`，并写明它本来会得多少分。

## 三次运行，一个数字

```bash
node bin/aos.mjs cycle start                                  # 三个种子，此刻锁定
node bin/aos.mjs cycle run --checkpoints
node bin/aos.mjs cycle                                        # operator score
node bin/aos.mjs dashboard                                    # 只读、回环、带令牌
```

种子只抽一次，之后再也不重抽——否则*跑二十次留最好的三次*只差一步。Operator Score 是所有有效
运行的中位数，低分也算在内。唯一被排除的是什么都没测到的运行，而且每一个都会连同理由一起打印
出来。同一台机器上三次重复的结果记为 **local repeat evidence**，绝不称作 confidence。

## 什么会扣住数字，天花板又做了什么

<img src="docs/assets/aos-gates.svg" alt="签发闸门有五个条件，必须全部成立才会给出分数。四个天花板以天花板而非扣分的方式生效，最低的那个胜出：安全 39 落在 FRAGILE，虚假完成 49 与被忽略的严重错误 59 落在 DEVELOPING，缺少确切修订 69 落在 OPERATIONAL。" width="960" height="436">

天花板不是扣分。一次复制了密钥的运行会被压在 39，无论其余部分做得多好——因为把这件事平均掉的
数字，描述的是另一次运行。

---

## 它拒绝成为什么

设计的大部分是拒绝，而这正是要点。

| 它不是 | 因为 |
|---|---|
| 对能力的测量 | 分数以声明的环境和任务包为条件，并在它出现的每一处这样说明 |
| 模型或框架的基准 | 模型是固定的，被测的单位是操作者 |
| 百分位、排名或认证 | 不存在可供排名的总体，也没有作出这种主张 |
| 招聘、晋升或监控工具 | 写在 [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) 里，而不是留给人去猜 |
| SaaS 或遥测产品 | 一切都留在你的磁盘上；代码库里没有任何外发客户端 |
| 已验证的结果 | `EXPERIMENTAL / PROVISIONAL` —— 没有校准研究、没有独立复现、没有合格评审 |

你写的计划**不是评分输入**。它曾经仅凭对你自己所写 JSON 的形状检查，就决定了二十项指标中的
十七项，而一份字面意义上的垃圾计划拿到了 17/17。现在指标要么从运行中被观测到，要么就是
`NOT_OBSERVED`，而 `NOT_OBSERVED` 绝不是零。

这些任务族的答案就在 `lib/suite.mjs` 里。作为练习没有问题，这也正是它不是一场考试的原因。

## 它测出了什么

真实的 Codex，一台机器，每个周期三个锁定种子，每次运行都有人在场：

| | agent 沙箱 | Operator Score | 各次运行 | 极差 |
|---|---|---|---|---|
| 1 | 开 | **69** | 69, 69, 83 | 14 |
| 2 | 关 | *撤回* | 49, 59, 89 | — |
| 3 | 关 | **90** | 90, 87, 92 | 5 |

周期 2 的汇总值被撤回而不是报告出来：它把一次运行的分数记到了全部三个种子上，所以那个数字描述
的是同一次运行被数了三遍。它各次运行的分数是真的，正是它们找出了三个缺陷——都在周期 3 之前
修好了。

`aos review` 只测过一次，用的是从写规则的工作中留出的 320 次会话：**10 条高严重度问题中有 4 条
是对的。** 六个错误都已修复，但那不是第二次测量——用暴露出错误的那批会话去测修复，得到的是调参
数字。[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) 这样写了，也写明语料里已经没有未使用的会话可以
重新测量。

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 三道验收闸门
```

台账保存的是每次会话的摘要、每条问题的标识、你的判定和你的理由——绝不保存会话记录本身。

## 报告

分数旁边的 HTML 报告按操作者自己的区域设置显示：韩语环境用韩语，其余一律英语。两种语言都写在同一
个文件里、由 CSS 隐去其一，所以发给同事的报告会以**对方**的语言打开，而不是生成它那台机器的语言。
切换用的是复选框而不是脚本——这个页面必须继续做到不向任何地方发出请求。

## 安全与隐私

| | |
|---|---|
| 网络 | 一个回环服务器，绑定 `127.0.0.1`，必须带令牌，只读，只接受 GET，没有任何路由会返回会话记录。代码库中不存在外发客户端 |
| 依赖 | 无。`npm ci` 不会安装任何东西 |
| 被评估的 agent | 以替换过的 `HOME` 和过滤后的环境运行，拿不到任何 `AOS_` 前缀的变量——它永远不知道你的运行记录放在哪里 |
| 运行时凭据 | 到该运行时本来会去找的地方取，经进程环境交给它，无需任何配置。记录名字与来源而不记录取值，也不把令牌写到磁盘上。`--no-auto-auth` 可以关掉 |
| 密钥 | 在读取输出的地方就被移除，只按种类报告，绝不写回到问题、结果或事件中 |
| 你的主目录 | `~/.aos` 为 `0700`，其中每个文件为 `0600` |

漏洞请通过 [`SECURITY.md`](SECURITY.md) 报告。

## 环境要求

Node `>=22.18 <25`，macOS 或 Linux。不会全局安装任何东西，也没有发布到任何 registry 的包；
`npm pack` 会构建一个可在本地安装的 tarball。

## 开发

```bash
npm ci
npm test                 # 测试套件
npm run verify:mvp       # 契约、天花板和档位是否仍如其所述
npm run test:mutation    # 逐个破坏具名守卫，检查被指名的测试会不会死
npm run smoke:package    # 打包、装到别处、像操作者那样用一遍
```

CI 在每次变更上运行七条泳道：Ubuntu 上的 Node 22 与 Node 24、macOS 上的 Node 24 跑测试套件，
mutation 与 `verify:mvp`，以及 Ubuntu 和 macOS 上的打包冒烟。分支遵循 git flow，模型写在
[`CONTRIBUTING.md`](CONTRIBUTING.md) 里。

## 文档

| | |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 哪些还没有被确立，以及每个数字被绑定在什么上 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 可以用来做什么，不可以用来做什么 |
| [`docs/what-this-measures.html`](docs/what-this-measures.html) | 用图讲清楚在给什么打分 — 韩语 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 分支模型、一次变更需要携带什么、DCO |
| [`SECURITY.md`](SECURITY.md) | 报告漏洞 |

## 许可

MIT —— 见 [`LICENSE`](LICENSE)。贡献遵循 [DCO](CONTRIBUTING.md)，请用 `git commit -s` 签名。
第三方声明在 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
