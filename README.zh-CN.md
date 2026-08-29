<div align="center">

<img src="docs/assets/aos-mark.svg" alt="" width="88" height="88">

# Agent Operator Score

**不测车，测驾驶者。**

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

评测 AI 编程 agent 的工具很多。AOS 关注的是**使用 agent 的人**。

这里说的人不是 agent，而是给它布置任务、在它卡住时介入、最后决定结果能不能接受的
**使用者，也就是操作者（operator）**。

即使把同一个任务交给同一个 agent，结果也可能完全不同。有的操作者会把目标说清楚，只提供需要的
资料，发现失败后调整指令，并亲自核对“已经完成”的说法；有的操作者则会让同一种失败不断重演，
或者把没有验证过的结果直接当成完成。

**AOS 是一个在本机检查这种差异的工具。**

<img src="docs/assets/aos-driver-vs-agent-zh-cn.svg" alt="agent 是车，使用者是驾驶者，评分表指向驾驶者" width="960">

> [!WARNING]
> AOS 目前仍是 `EXPERIMENTAL / PROVISIONAL`。结果只描述某个特定的 agent、模型、配置、机器和
> 任务组合，不得用于招聘、晋升、员工监控或资格认证。

## 先从 Claude Code 一键开始

使用 Claude Code 时，不需要克隆仓库，也不需要安装 npm 包。

```text
/plugin marketplace add MongLong0214/agent-operator-score
/plugin install aos@agent-operator-score

/aos-review
```

`/aos-review` 会复盘刚结束的会话。它只读取已经保存在本机的记录，不会再次调用模型，因此不消耗
模型额度。`/aos-assess` 会真正运行 agent，所以会消耗额度，并在开始前提醒你。

插件省掉了克隆仓库、手动注册 agent 和编写计划文件这些准备工作，但仍需要 Node
`>=22.18 <25`，以及已经安装并登录的 Claude Code 或 Codex CLI。

`/aos-assess` 也不能代替操作者回答中途的判断题。要得到正式分数，必须按照提示在自己的终端中运行
带 `--checkpoints` 的评估并亲自回答。由插件或另一个 agent 代答，测到的将是代答者的策略，而不是你。

想直接从仓库运行：

```bash
git clone --depth 1 --branch dev https://github.com/MongLong0214/agent-operator-score
cd agent-operator-score && npm ci

node bin/aos.mjs review
```

默认分支是 `dev`。需要复现一个固定版本时，请使用
[GitHub Releases](https://github.com/MongLong0214/agent-operator-score/releases) 中的标签。

## AOS 测什么：不是车，而是驾驶

普通基准通常在问：

> 这个模型是不是比另一个模型更快、更准？

AOS 问的是另一件事：

> 给定同样的工具，使用者能不能把任务交代清楚、在出错时正确介入，并验证最终结果？

把它类比成开车：agent 是**车**，操作者是**驾驶者**。AOS 不测车辆的最高时速，而是看驾驶者有没有
设定正确目的地、有没有发现走错路、危险时有没有停车，以及到达后有没有确认确实到了该到的地方。

<img src="docs/assets/aos-benchmark-vs-operator-zh-cn.svg" alt="普通基准测 agent，AOS 测使用者如何驾驶 agent" width="960">

## 两种模式：`review` 与 `assess`

|  | `aos review` | `aos assess` |
|---|---|---|
| 做什么 | 从真实会话中找出可能有风险的模式，交给人确认 | 运行六类受控任务，把操作过程与结果汇总成条件分数 |
| 对象 | 本机已有的 Codex、Claude Code、Grok CLI 会话 | 已注册的 Codex、Claude Code 等 agent CLI |
| 模型额度 | 不消耗，只读现有记录 | 会消耗，因为会真正运行 agent |
| 结果 | 可疑步骤及其证据 | 百分制分数，或明确说明为什么没有出分 |

建议先用 `review`。它不会产生额外费用，可以先用自己的真实记录判断 AOS 的提示是否有价值，再决定
是否运行 `assess`。

### `review`：复盘已经完成的工作

```bash
node bin/aos.mjs review                         # 最近一次会话
node bin/aos.mjs review --since 12              # 最近 12 次会话中反复出现的模式
node bin/aos.mjs review --list                  # 列出可检查的会话路径
node bin/aos.mjs review --session "<路径>"       # 检查指定会话
node bin/aos.mjs review --json                  # 输出 JSON
```

`review` 给出的不是最终判决，而是**待确认项**。每条提示都会指出相关步骤，使用者应回到原始会话核对。

| 规则 | 简单来说 |
|---|---|
| `completion-claimed-without-verification` | agent 在最后一次修改后没有重新测试，却声称已经完成 |
| `session-ended-on-stale-evidence` | 最后一次修改之后没有新的验证证据，会话就结束了 |
| `edits-outside-the-working-directory` | agent 修改了当前项目目录之外的文件 |
| `destructive-command-executed` | 执行了可能造成数据损失、难以恢复的命令 |
| `secret-material-in-session` | 会话中出现了 API key、token 或私钥等秘密信息 |
| `long-uninterrupted-tool-run` | 很长一段时间没有人工介入，其间又发生失败或重复行为 |
| `completion-claimed-over-a-failed-check` | 紧邻完成声明之前的检查已经失败，agent 仍声称完成 |
| `verification-exit-status-discarded` | 验证命令后使用 `\|\| true`，把失败状态直接抹掉了 |

一次会话能告诉你“这次发生了什么”；多次会话更容易看出“我总在重复什么”。后者才是 `review` 更有
价值的用法。

目前这些规则还不能当作高可信自动裁判。它们曾在一组独立保留的会话上测试，但精度没有达到目标；
修复后的规则仍需要新的、未参与调参的会话再次验证。

### `assess`：用受控任务检查操作方式

`assess` 会把六类任务真正交给 agent。agent 说“完成了”并不会自动得分；独立验证器会检查实际产物
和运行记录，同时观察操作者在遇到阻塞时做了什么决定。

> [!CAUTION]
> `aos init` 在 `PATH` 中发现 Claude Code 时，会用 `--dangerously-skip-permissions` 注册它，
> 以便非交互运行。这会跳过 Claude Code 自己的权限确认。AOS 的临时工作区、临时 `HOME` 和环境变量
> 过滤仍然保留，但请理解这个参数的含义后再运行评估。

```bash
node bin/aos.mjs init                   # 自动发现并注册 Claude Code、Codex
node bin/aos.mjs doctor                 # 先检查命令和认证路径

node bin/aos.mjs assess                 # 无人值守诊断：不会得到正式分数
node bin/aos.mjs assess --checkpoints   # 操作者亲自参与的计分运行
```

`init` 不会覆盖你已经手动配置的 agent。没有指定计划文件时，AOS 会生成并使用一份可直接运行的
`aos-plan.json`。计划文件不是自评问卷，写得漂亮不会加分；分数只来自实际运行中观察到的行为和结果。

`doctor` 会检查可执行文件与认证路径，但不会真正调用模型。如果运行根本没有开始，或者不同任务连续以
完全相同的方式失败，AOS 应停止计分，而不是把环境配置错误算成操作者能力不足。

## 评分表上的六个方面

AOS 关注下面六件事。

<img src="docs/assets/aos-six-dimensions-zh-cn.svg" alt="AOS 用六个简单问题说明评分维度" width="960">

1. **任务说清楚了吗**（`Task Specification`）——目标、禁止事项、完成条件是否明确
2. **给了哪些上下文**（`Context Engineering`）——是否选对资料，并排除过期或可疑内容
3. **怎样拆分和分派**（`Decomposition & Routing`）——任务交给谁、依赖如何安排、结果如何合并
4. **卡住时做了什么**（`Human-in-the-Loop Control`）——是否发现失败、修改指令、改道或及时停止
5. **确认真的能用吗**（`Evaluation & Verification`）——是否用独立证据核对“已经完成”
6. **是否安全且不过度消耗**（`Guardrails, Recovery & Cost`）——秘密、权限、恢复方式和调用预算是否受控

这六个方面进一步拆成 20 项指标，每项指标包含四个明确检查点。

<img src="docs/assets/aos-pipeline.svg" alt="从固定运行条件和受控任务开始，经过操作者检查点与独立验证，最后得到二十项指标和条件分数" width="960" height="392">

## 检查点：卡住时你做了什么

当 agent 重复同一种失败，或进入无法继续的状态时，AOS 会暂停运行，把已有证据和可采取的动作交给
操作者判断。

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

**选项本身不是分数。** 选择“修改指令”不会自动得到高分。AOS 会检查指令是否真的改变、路径是否真的
切换、选择停止后是否真的停止，以及后续是否又原样重复了同一次失败。

不加 `--checkpoints`，AOS 就无法观察操作者的中途判断。agent 的结果和参考计算仍会保存，但正式分数
会以 `INCOMPLETE` 暂缓。让插件或另一个 agent 代答也不能解决这个问题。

## 没看到，不等于零分

假设一次驾驶考试里，考官根本没有机会观察倒车入库。把这一项直接记为零分，就会把“没有观察到”和
“确认做失败了”混为一谈。

AOS 会区分三种状态：

- **失败**：已经检查，确认没有满足条件。
- **`NOT_OBSERVED`**：没有获得足够证据，无法判断。
- **`INCOMPLETE`**：关键项目观察不足，因此不签发正式分数。

<img src="docs/assets/aos-not-observed-zh-cn.svg" alt="已观察三项、其余未观察，因此不出正式分数" width="960">

20 项指标中至少要观察到 18 项，功能结果、独立验证、最终版本、完成声明、恢复和安全等关键指标也
必须有证据。空文件、空回答或沉默不会因此得到好成绩：**沉默不算通过。**

`provisional_raw` 只是排查问题时使用的参考计算，不是正式分数。

## 同样是 83 分，也不一定能比较

在不同车辆、不同路线、不同天气下得到的两个 83 分，并不是同一场考试。AOS 分数也是如此。

<img src="docs/assets/aos-profile-bound-zh-cn.svg" alt="两个 83 分因为 agent、隔离设置和种子不同而不可直接比较" width="960">

分数的含义取决于：

- 使用了哪个 agent 和模型
- CLI 版本与运行配置
- 机器、操作系统和隔离级别
- 任务包、评分器版本和种子

AOS 会把这些条件与分数一起记录，称为 `PROFILE-BOUND`。条件不同的两个数字测量的是不同东西，
不能直接拿来排名。

| AOS 不是 | 原因 |
|---|---|
| 一个人综合的 AI 使用能力分 | 它只描述某次特定环境与任务中的表现 |
| 模型、CLI 或 agent 框架的通用排名 | profile 不同就不是同一场测量 |
| 百分位、排行榜或证书 | 没有可供排名的总体和常模 |
| 招聘、晋升或员工监控工具 | 项目明确禁止用于给个人造成不利后果 |
| SaaS 或遥测产品 | 运行记录和报告保留在本机，AOS 没有外部收集服务 |
| 已验证的科学测量工具 | 尚无校准研究、独立复现或合格专家评审 |

早期版本曾根据操作者自己填写的 JSON 形状，静态决定 20 项指标中的 17 项，甚至无意义的计划也能拿到
`17/17`。现在计划文件不再是评分输入；指标只能来自实际运行中的观察，否则保持 `NOT_OBSERVED`。

任务和评分逻辑公开在 `lib/suite.mjs` 中。AOS 不是靠保密答案筛人的考试，而是帮助你在相同条件下
反复练习和检查自己的操作方式。

## 三次运行，合成一个分数

单次运行很容易受偶然因素和模型波动影响。AOS 会在周期开始时锁定三个不同的种子，并在相同 profile
下执行三次。

```bash
node bin/aos.mjs cycle start                                  # 锁定三个种子
node bin/aos.mjs cycle run --checkpoints                      # 按顺序运行
node bin/aos.mjs cycle                                        # 查看有效运行的中位数
node bin/aos.mjs dashboard                                    # 本机只读仪表板
```

目前六类任务中只有三类会随种子改变细节，因此三次重复不能被扩大解释为总体统计置信度或普遍能力证明。

只有保持同一 seed、profile、suite major 和 scorer major，并且具有终止记录和正式签发分数的运行才会
进入汇总。有效的低分不能因为不好看而删除，也不能在同一种子上重跑。被排除的运行会列出原因。

如果一开始配置错误，可以用 `--force --reason "<原因>"` 中止当前周期并开启新周期。旧周期不会消失，
其种子与已经产生的分数都会留在中止记录中。

Operator Score 是所有有效运行分数的**中位数**。同一台机器上重复运行的波动只称为
**local repeat evidence**，不称为 `confidence`。

## 为什么有时没有分数，为什么会有上限

AOS 能算出一个数字，并不代表它一定会签发正式分数。关键内容观察不足时，结果保持 `INCOMPLETE`。

如果实际观察到严重问题，AOS 不是简单扣几分，而是限制最终分数的**最高值**：

- 泄露秘密、执行禁止的外部操作或逃出工作区：最高 39 分
- 把失败结果声称为完成：最高 49 分
- 忽略严重错误继续运行：最高 59 分
- 验证后又修改结果，导致验证版本与最终版本不同：最高 69 分

例如，一次运行泄露了秘密，无论其他方面做得多好都不能超过 39 分。这样做是为了避免把严重风险平均
掉。上限只在违规被实际观察到时生效；没有产物、无法判断安全性的运行是 `INCOMPLETE`，不是
`UNSAFE`。

等级为 `90+ HIGH RELIABILITY`、`75+ ADVANCED`、`60+ OPERATIONAL`、`40+ DEVELOPING`、
`0+ FRAGILE`。这些名称只概括当前运行，不代表一个人的整体能力或行业排名。

## 已测结果与当前限制

下面是使用真实 Codex、在同一台机器上完成的三个周期。每个周期使用三个锁定种子，所有运行都由
操作者参与检查点。

| 周期 | agent 沙箱 | Operator Score | 各次分数 | 极差 |
|---|---|---|---|---|
| 1 | 开 | **69** | 69, 69, 83 | 14 |
| 2 | 关 | *撤回* | 49, 59, 89 | — |
| 3 | 关 | **90** | 90, 87, 92 | 5 |

这里的“agent 沙箱”指 Codex 自己的命令执行限制。AOS 的临时工作区、临时 `HOME` 与环境过滤是另一层
边界，三个周期中始终保留。

周期 2 的汇总值被撤回，因为一次运行的分数被错误记录到三个种子上，等于把同一次运行算了三遍。
单次运行结果仍然保留，由此发现的三个缺陷已在周期 3 之前修复。

`aos review` 曾在 320 个未用于编写规则的会话上独立测量一次。10 条高严重度提示中只有 4 条正确，
精度为 0.400。六个误报已经修复，但在暴露出错误的同一批数据上再次运行只能算调参结果，不能算第二次
独立测量。

```bash
node bin/aos.mjs holdout --session <path> --use holdout
node bin/aos.mjs holdout --session <path> --finding <id> --verdict false-positive --reason "..."
node bin/aos.mjs holdout          # 查看当前验收闸门
```

在新的、未参与调参的会话积累起来之前，不能声称当前 `review` 规则的准确率已经建立。详细记录见
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)。

## 输出、安全与隐私

`assess` 完成后会生成：

- **`card.svg` 单页评分卡**：一屏显示分数、六个方面、运行条件和最值得先改的一件事
- **Markdown 与 HTML 报告**：逐项说明哪些被观察、通过、失败或未观察
- **JSON 结果**：供其他工具读取的结构化数据

没有签发正式分数时，评分卡会显示 **NO SCORE** 和原因，不会把 `provisional_raw` 放到可分享图片上
伪装成正式分数。

可以用 `node bin/aos.mjs report --run <id> --format markdown|html|json` 重新输出报告。HTML 报告在
韩语区域设置下显示韩语，其他环境显示英语；切换语言不需要访问外部服务器。

| 项目 | 实际行为 |
|---|---|
| AOS 自己的网络行为 | 仪表板只绑定 `127.0.0.1`，需要 token，只读且仅接受 GET；没有返回会话原文的路由，也没有把结果上传到 AOS 服务器的客户端 |
| agent 的网络行为 | `assess` 中运行的 Codex、Claude Code 可能需要连接各自的模型提供商，因此这不是完全离线执行 |
| 依赖 | 没有运行时 npm 依赖，但仍需要受支持的 Node 版本 |
| agent 执行环境 | 使用临时 `HOME` 并过滤敏感环境变量；用户原有的 `AOS_*` 与 `AOS_HOME` 会被移除 |
| 运行上下文 | 过滤后仅重新注入 `AOS_SESSION_ID`、`AOS_FAMILY`、`AOS_WORKSPACE`、`AOS_TASK_FILE` |
| 认证与秘密 | 只传递运行时需要的现有认证路径或明确允许的认证变量；可以记录变量名和来源，但绝不记录值，输出中的秘密也只保留类型 |

可用 `--no-auto-auth` 关闭自动认证查找。`~/.aos` 目录权限为 `0700`，其中的文件为 `0600`。
安全问题请按 [`SECURITY.md`](SECURITY.md) 报告。

## 直接运行、开发与文档

直接运行需要 Node `>=22.18 <25`、macOS 或原生 Linux，支持 x64 与 arm64，目前不支持 WSL。
项目没有发布到 npm registry，也不需要全局安装；请从仓库或 GitHub Release 源码运行。

```bash
npm ci
npm test                 # 全部测试
npm run verify:mvp       # 验证评分契约、上限和等级
npm run test:mutation    # 破坏关键保护条件，确认相关测试会失败
npm run smoke:package    # 打包后在另一个位置按真实用户路径运行
```

CI 会在 Ubuntu 的 Node 22、Node 24 和 macOS 的 Node 24 上运行测试，并单独执行评分契约验证、mutation
测试以及 Ubuntu、macOS 的安装冒烟测试。

| 文档 | 内容 |
|---|---|
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | 尚未建立的结论，以及每个数字受哪些条件约束 |
| [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) | 可以使用和不得使用 AOS 的场景 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 分支策略、变更要求和 DCO 签名 |
| [`SECURITY.md`](SECURITY.md) | 安全漏洞报告方式 |

MIT 许可证，详见 [`LICENSE`](LICENSE)。贡献需遵循 DCO，并使用 `git commit -s` 签名。
第三方声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
