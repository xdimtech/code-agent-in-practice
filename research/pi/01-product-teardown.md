# 1. 产品定位与能力盘点

## 1.1 它自己怎么说

两份 README 给出的定位措辞不同，合起来才完整。

根 `README.md:13-15` 用的是**项目名**：

> # Pi Agent Harness
> This is the home of the Pi agent harness project including our **self extensible coding agent**.

产品手册 `packages/coding-agent/README.md:15,17,19` 用的是**产品定位**：

> Pi is a **minimal terminal coding harness**. Adapt pi to your workflows, not the other way around, **without having to fork and modify pi internals**. […]
>
> Pi ships with powerful defaults but **skips features like sub agents and plan mode**. Instead, you can ask pi to build what you want or install a third party pi package that matches your workflow.
>
> Pi runs in **four modes**: interactive, print or JSON, RPC for process integration, and an SDK for embedding in your own apps.

三句话对应三个判断：

1. **"harness" 而非 "agent"** —— 它把自己定位成承载 agent 的骨架，而不是一个成品助手。仓库名 `pi-mono`、核心包名 `@earendil-works/pi-agent-core` 都在强化这一点。
2. **"without having to fork"** —— 这是整个项目的中心命题。扩展系统（[第 7 章](./07-extensibility.md)）不是加分项，是它存在的理由。
3. **"skips features like sub agents and plan mode"** —— 把"不做什么"写进第二段，这在同类产品里很罕见。完整的六条清单见[第 6 章 §6.1](./06-multi-agent.md)。

npm 包描述（`packages/coding-agent/package.json`）则朴素得多：

> Coding agent CLI with **read, bash, edit, write** tools and session management

**这四个工具名正好是默认激活集**（`agent-session.ts:2802`，见[第 5 章 §5.1](./05-tools-permissions.md)）。包描述与代码默认值一致，不是营销话术。

---

## 1.2 基本面

| 项 | 值 |
| --- | --- |
| 仓库 | `github.com/earendil-works/pi-mono` |
| 作者 | Mario Zechner（badlogic） |
| 许可 | MIT |
| 版本 | **0.84.4** |
| 语言 | TypeScript 全栈 |
| Node 要求 | `>=22.19.0`（`packages/coding-agent/package.json`） |
| 入口 | `bin: { "pi": "dist/bundle/cli.js" }` |
| 运行时依赖 | **20 个**（见下） |
| 官网 / 社区 | pi.dev / Discord |

### 依赖清单（20 个，全部可核）

```
@earendil-works/pi-agent-core  @earendil-works/pi-ai  @earendil-works/pi-client
@earendil-works/pi-protocol    @earendil-works/pi-tui
@silvia-odwyer/photon-node  chalk  cross-spawn  diff  grok-mermaid
highlight.js  hosted-git-info  ignore  jiti  minimatch
proper-lockfile  semver  typebox  undici  yaml
```

去掉 5 个自家包，**第三方依赖只有 15 个**。其中值得注意的：

- `jiti` —— 扩展系统的地基，在宿主进程内直接 import TS 模块（[第 7 章 §7.3](./07-extensibility.md)）
- `typebox` —— 全部工具 schema（[第 5 章 §5.1](./05-tools-permissions.md)）
- `@silvia-odwyer/photon-node` —— read 工具的图片缩放
- `proper-lockfile` —— 会话文件并发保护
- **没有 zod、没有 commander/yargs、没有 ink/blessed、没有 OpenTelemetry**

**CLI 参数解析、TUI 渲染、HTTP 客户端全部自己写**（`undici` 只是 fetch 实现）。15 个第三方依赖对一个 12 万行的项目来说非常克制，这与仓库自身严格的供应链纪律（[第 2 章 §2.4](./02-architecture-and-guardrails.md)）是同一套价值观。

---

## 1.3 代码规模分布

### 按包（源码，已排除 test）

| 包 | 行数 | 文件数 | 职责 |
| --- | ---: | ---: | --- |
| **coding-agent** | **60,960** | 206 | 产品：CLI、TUI 模式、会话、扩展、包管理 |
| **ai** | **23,668** | 177 | 多 provider 统一 LLM API |
| **tui** | **17,000** | 40 | 终端 UI 库（差分渲染） |
| **agent** | 12,640 | 50 | agent 运行时（v1 loop + v2 harness） |
| server | 2,299 | 17 | |
| sqlite-node | 2,389 | 18 | 会话后端（**未被启用**，见[第 8 章 §8.4](./08-observability.md)） |
| evals | 1,277 | 8 | |
| protocol | 1,236 | 8 | |
| client | 1,225 | 10 | |
| telemetry | 935 | 6 | 遥测 SPI（**未接线**，见[第 8 章 §8.1](./08-observability.md)） |
| **合计** | **≈123,629** | **540** | |

三个数字直接给出了这个项目的重心：

1. **coding-agent 占一半（49%）** —— 产品层远比运行时层重。这与"minimal harness"的自我描述有张力：核心 loop（`agent-loop.ts` 794 行）确实极简，但把它变成一个能用的产品花了 6 万行。
2. **tui 17,000 行独立成包** —— 自己写终端 UI 库，不用 ink/blessed。这解释了为什么[第 8 章 §8.3](./08-observability.md) 里七个调试环境变量有三个是 TUI 渲染专用的。
3. **ai 23,668 行 / 177 文件** —— 单个包里文件数最多，因为要适配 40 个 provider。

### 最大的 12 个文件

| 文件 | 行数 |
| --- | ---: |
| `coding-agent/src/modes/interactive/interactive-mode.ts` | **6,575** |
| `coding-agent/src/core/agent-session.ts` | **3,516** |
| `coding-agent/src/core/package-manager.ts` | 2,699 |
| `tui/src/components/editor.ts` | 2,363 |
| `coding-agent/src/core/extensions/types.ts` | 1,791 |
| `coding-agent/src/core/session-manager.ts` | 1,716 |
| `ai/src/api/openai-completions.ts` | 1,707 |
| `ai/src/api/openai-codex-responses.ts` | 1,650 |
| `coding-agent/src/modes/interactive/components/tree-selector.ts` | 1,427 |
| `tui/src/keys.ts` | 1,401 |
| `ai/src/api/anthropic-messages.ts` | 1,391 |
| `tui/src/latex.ts` | 1,380 |

**两个 6,575 / 3,516 行的文件是这个仓库最明显的工程债。** 按用户全局规范（单文件 800 行上限），这两个文件超标 4–8 倍。

但要公平地说：`interactive-mode.ts` 承担的是 TUI 事件循环 + 23 个斜杠命令 + 扩展 UI 宿主 + 信号处理，`agent-session.ts` 是 L3 产品编排层（[第 3 章](./03-agent-loop.md)）。这类"胶水中心"天然难拆。**判断它是不是债，要看它有没有在阻碍修改——从每月 400–530 commit 的节奏看（§1.6），显然没有。**

`tui/src/latex.ts` 1,380 行值得单独一提：**为了在终端里渲染 LaTeX 写了 1,380 行**。这是"作者自己要用"驱动的功能，不是产品路线图驱动的。

---

## 1.4 四种运行模式

`README.md:19` 声明四种模式，代码分布：

| 模式 | 位置 | 行数 | 文件数 |
| --- | --- | ---: | ---: |
| **interactive** | `src/modes/interactive/` | **18,302** | 50 |
| **rpc** | `src/modes/rpc/` | 1,785 | 4 |
| print / json | `src/modes/print-mode.ts` + `json-event.ts` | — | 2 |
| SDK | `src/core/sdk.ts` | — | 1 |

**interactive 一个模式占了 18,302 行，是其余三种总和的 8 倍以上。** 这个比例说明 pi 首先是一个终端交互工具，其余三种模式是它的可编程出口。

但这三个出口不是附属品——[第 6 章 §6.3](./06-multi-agent.md) 显示 subagent 扩展正是靠 `--mode json -p --no-session` 实现多 agent 的。**"模式"在 pi 里是一等公民的组合原语**：同一套接口，扩展用得到、用户在 shell 里用得到、CI 里也用得到。

RPC 模式有一条容易踩的契约（`README.md:489`）：

> RPC mode uses strict **LF-delimited** JSONL framing. Clients must split records on `\n` only. **Do not use generic line readers like Node `readline`**, which also split on Unicode separators inside JSON payloads.

**这是被真实 bug 教育过才会写进 README 的一句话**——`readline` 会在 U+2028/U+2029 处断行，而这些字符可以合法出现在 JSON 字符串里。

---

## 1.5 Provider 生态：40 家，中国厂商占 4 成

`packages/ai/src/providers/` 下 41 个文件（排除 `.models.ts` 数据文件与 `all.ts`/`faux.ts`/`cloudflare-*`/`radius-config.ts`/`openrouter-images.ts`/`data-json.d.ts` 等非 provider 文件），其中 `images.ts` 不是厂商，**实际 40 个 provider**。

### 中国厂商 16 个条目 / 7 家

| 厂商 | provider 条目 |
| --- | --- |
| 阿里 Qwen | `qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual` |
| 小米 | `xiaomi`、`xiaomi-token-plan-cn`、`xiaomi-token-plan-ams`、`xiaomi-token-plan-sgp` |
| Moonshot | `moonshotai`、`moonshotai-cn`、`kimi-coding` |
| MiniMax | `minimax`、`minimax-cn` |
| 智谱 | `zai`、`zai-coding-cn` |
| 蚂蚁 | `ant-ling` |
| DeepSeek | `deepseek` |

**16 / 40 = 40%。** 对一个奥地利作者的项目来说，这个比例相当反直觉。

更值得注意的是**条目的形态**：`-cn` / `-token-plan` / `-individual` / `-ams` / `-sgp` 这些后缀说明 pi 不是简单加个 baseUrl，而是**把同一家厂商的国内/国际站、按量付费/包月套餐、不同地域机房分别建模**。小米一家就有四个条目（本体 + 国内包月 + 阿姆斯特丹 + 新加坡）。

**推断**：这种粒度只可能来自真实用户的报错与 PR，不可能是作者主动调研出来的。它是"中国厂商的开发者在用 pi"这一事实的代码痕迹——**这恰好也是本书关心的问题**：三家中国厂商基于 pi 做自己的 Code Agent（Step-Code / minimax-code / kimi-code），而 pi 反过来又内置了它们的 provider。

其余 24 个：`anthropic`、`openai`、`openai-codex`、`google`、`google-vertex`、`amazon-bedrock`、`azure-openai-responses`、`github-copilot`、`xai`、`mistral`、`groq`、`cerebras`、`fireworks`、`together`、`nvidia`、`huggingface`、`baseten`、`openrouter`、`vercel-ai-gateway`、`cloudflare-ai-gateway`、`cloudflare-workers-ai`、`radius`（pi 自家）、`opencode`、`opencode-go`。

### 适配层与模型目录

- **API 适配器 32 个文件**（`packages/ai/src/api/`），每个主要适配器配一个 `.lazy.ts` 变体——懒加载，避免启动时全量 import 40 家的代码。
- **模型目录构建期生成**：`models.generated.ts`（124 行）+ `image-models.generated.ts`（759 行），由 `packages/ai/scripts/generate-models.ts` 生成，该脚本拉取 `models.dev/api.json`。**运行时对 models.dev 零引用**（[第 8 章 §8.4](./08-observability.md)）。
- npm 脚本（`packages/ai/package.json:52-57`）：`generate-models --strict`、`hydrate-model-data --data-only`、`generate-model-catalog --json-only`；根 `package.json:24` 串起来。

---

## 1.6 工程治理：高速度、高集中度、严入口

### 提交速度

| 项 | 值 |
| --- | --- |
| 总提交 | **5,825** |
| 首次提交 | 2025-08-09 |
| 本地快照最后提交 | 2026-08-28 |
| 贡献者 | 297 |

月度分布：

```
2025-08   85
2025-09   53
2025-10  129
2025-11  280
2025-12  872
2026-01 1224   ← 峰值
2026-02  377
2026-03  418
2026-04  461
2026-05  481
2026-06  424
2026-07  494
2026-08  527
```

2025-12 到 2026-01 是爆发期，此后**稳定在每月 400–530 次提交**，约每天 15 次。**这不是一个降温中的项目。**

> ⚠️ 研究基准说明：本地克隆最后一次提交是 2026-08-28，"近 30 天 0 提交"只是快照时间，**不代表上游停更**。本次拆解的所有结论都基于 v0.84.4 这个快照。

### 贡献者集中度

| 贡献者 | 提交数 | 占比 |
| --- | ---: | ---: |
| Mario Zechner | 3,804 | 65% |
| Armin Ronacher | 781 | 13% |
| David Brailovsky | 243 | 4% |
| Christian Klotz | 224 | 4% |
| Cristina Poncela Cubeiro | 219 | 4% |
| github-actions[bot] | 185 | 3% |
| Vegard Stikbakke | 144 | 2% |
| 其余 ~290 人 | 225 | 4% |

**前两人占 79%，前五人占 89%。** 297 个贡献者里绝大多数只提交过一两次。

第二位 Armin Ronacher（Flask / Jinja / Sentry）以 781 次提交深度参与，这在个人项目里不常见。

### 严格的入口政策

两份 README 的第一行（根 `README.md:11`、产品 `README.md:11`）都是同一句话：

> **New issues and PRs from new contributors are auto-closed by default.** Maintainers review auto-closed issues daily.

CI 里有配套实现：`.github/workflows/issue-gate.yml` 与 `pr-gate.yml`，其中 `TRUSTED_BOT_AUTHORS` 白名单含 `sentry[bot]`（[第 8 章 §8.5](./08-observability.md) 核实过这 5 处 sentry 命中全是 CI 配置，与运行时无关）。

**判定：这是一个"高速度 + 高集中度 + 主动限流"的项目。** 三者互为因果——每天 15 次提交的节奏下，开放的 issue 队列会立刻淹没维护者；而 65% 的提交来自一个人，意味着设计一致性由单一心智保证，这也是为什么前面几章能反复看到"同一套哲学贯穿到底"（机制而非策略、进程编排而非框架调度、外包给 rg/fd 而非自己实现）。

**代价同样明确**：巴士系数极低，且外部贡献门槛高。对下游厂商而言这意味着 **fork 之后很难回流，只能长期自己维护 diff**——这正是 Step-Code 重组式衍生、minimax-code 整包 vendor 并在 `MINIMAX_CHANGES.md` 里自己记补丁台账的现实背景。

---

## 1.7 能力盘点

把前面各章的核实结论汇总成一张能力表：

| 能力 | 有无 | 形态 | 详见 |
| --- | :---: | --- | --- |
| 交互式 TUI | ✅ | 自研 tui 包，差分渲染 | §1.3 |
| print / JSON / RPC / SDK | ✅ | 四种模式，一等公民 | §1.4 |
| 会话持久化 | ✅ | JSONL，**树形**（可分支） | [8.4](./08-observability.md) |
| 上下文压缩 | ✅ | 绝对预留 16K，切点不落 toolResult | [4.2](./04-context-engineering.md) |
| AGENTS.md / CLAUDE.md | ✅ | 祖先在前，兼容 CLAUDE.md | [4.1](./04-context-engineering.md) |
| Skills | ✅ | 两段式注入（清单 → 全文） | [4.5](./04-context-engineering.md) |
| 工具 | ✅ | 8 个内置，**默认只开 4 个** | [5.1](./05-tools-permissions.md) |
| 扩展系统 | ✅ | TS 模块，45 个事件，同进程 | [7.1](./07-extensibility.md) |
| Provider 可注册 | ✅ | 运行时注册，四种粒度 | [7.5](./07-extensibility.md) |
| 包分发 | ✅ | npm / git / 本地，四类资源 | [7.4](./07-extensibility.md) |
| 主题 | ✅ | 可通过包分发 | — |
| **权限系统** | ❌ | 只有机制（`beforeToolCall`），无策略 | [5.4](./05-tools-permissions.md) |
| **沙箱** | ❌ | 明确外包给 OS / 容器 | [5.4](./05-tools-permissions.md) |
| **MCP** | ❌ | 明确不做 | [7.6](./07-extensibility.md) |
| **子 Agent** | ❌ | 示例扩展，spawn 子进程 | [6.2](./06-multi-agent.md) |
| **Plan mode** | ❌ | 明确不做，示例扩展里有 | [6.1](./06-multi-agent.md) |
| **To-do** | ❌ | 明确不做（"They confuse models."） | [6.1](./06-multi-agent.md) |
| **后台 bash** | ❌ | 明确不做，让用 tmux | [6.1](./06-multi-agent.md) |
| **Code Mode** | ❌ | 全仓零命中 | [5.9](./05-tools-permissions.md) |
| **跨会话记忆** | ❌ | 只有 AGENTS.md + 摘要 | [4.5](./04-context-engineering.md) |
| **span 遥测** | ⚠️ | 契约完整，**零埋点** | [8.1](./08-observability.md) |
| **结构化日志** | ❌ | 130 处裸 `console.*`（`coding-agent/src`，`git grep -E 'console\.(log\|error\|warn\|info\|debug\|trace)\('`） | [8.3](./08-observability.md) |
| **录制回放** | ❌ | 无 provider 级 trace | [8.3](./08-observability.md) |
| **`pi doctor`** | ❌ | 最接近的是 `pi auth check` | [8.5](./08-observability.md) |

**十二个 ❌ 里有七个是写进文档的主动声明**（权限、沙箱、MCP、子 agent、plan mode、to-do、后台 bash；沙箱写在 `docs/security.md:31-35`，其余六个在 README 的 "No X" 段），不是缺失。剩下的（Code Mode、跨会话记忆、结构化日志、录制回放、doctor）没有公开表态，其中**录制回放是最实际的短板**（[第 8 章 §8.6](./08-observability.md)）。

---

## 1.8 本章结论

**pi 是一个"核心极简、产品层厚重、边界写得很清楚"的项目。**

三组数字概括它：

1. **123,629 行 / 540 文件 / 10 个包**，但核心 agent loop 只有 794 行（[第 3 章](./03-agent-loop.md)）——**复杂度几乎全在产品层与 provider 适配层，不在 agent 抽象里**。
2. **15 个第三方依赖**撑起 12 万行，CLI 解析、TUI、HTTP 全自研——克制到近乎固执。
3. **40 个 provider，中国厂商占 16 个（40%）**，且按国内站/套餐/机房分别建模。

它的自我定位"minimal terminal coding harness"**只有一半准确**：agent 抽象确实 minimal，产品实现一点都不 minimal。真正贯穿始终的不是 minimal，而是**"提供机制、不提供策略"**——权限、沙箱、多 agent、编排、遥测后端，全部给接口不给实现，把决定权交给用户和扩展。

这个立场的价值在于诚实：它不假装有安全边界（[第 5 章](./05-tools-permissions.md) 的 `docs/security.md:35`），不假装有遥测（[第 8 章](./08-observability.md)），不假装有编排保证（[第 6 章 §6.7](./06-multi-agent.md)）。**代价是每一个把 pi 拿去做产品的厂商，都必须自己补齐这些策略层——这正是接下来拆解各个 pi 衍生实现时最值得盯的地方。**

给下游拆解的探针：

- **代码规模对比** —— 衍生版是变大还是变小？变大的部分在哪一层（产品层 / provider 层 / 新增策略层）？
- **provider 列表被裁剪成什么样** —— 多数厂商只需要自家，裁剪幅度反映了 fork 的彻底程度
- **四种模式保留了几种** —— RPC / SDK 是最容易被砍掉的
- **README 那六个"No X"被实现了几个** —— 每实现一个都是一次明确的产品分歧
- **`interactive-mode.ts` / `agent-session.ts` 这两个巨型文件有没有被拆** —— 反映了 fork 方的工程投入深度
- **有没有回流 upstream** —— 考虑到 pi 的 auto-close 政策，大概率没有
