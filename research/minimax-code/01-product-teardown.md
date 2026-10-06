# 1. 产品定位与能力盘点

> 对照基准：[pi 第 1 章](../pi/01-product-teardown.md)。本章只写 minimax-code 相对 pi **变了什么**；没提到的默认与 pi 相同。

## 1.1 它自己怎么说

【文档】`README.md:10` 的一句话定位是「A terminal coding agent with MiniMax, your own models, and tools beyond code.」，`:24` 展开成：在终端里理解项目、改代码、跑测试；用 MiniMax 账号或自带模型；搜索、插件、多模态工具在同一个工作流里。

同一个仓库还有两句对本书很要紧的自我描述：

- `AGENTS.md:3`：「This repository is the reviewed public projection of an internal monorepo, not an ordinary workspace.」上游改动通过三方合并进来（`docs/source-sync.md`）。
- `docs/architecture.md:3` 给出整条调用链：`TUI / exec / ACP → CliService → local Applications → Session / Turn / Agent services → Pi / model providers / local tools`。

pi 的定位是「给会写扩展的人一个最小内核」；Step-Code 是「在 pi 的扩展点上装好策略的终端产品」；minimax-code 是第三种：**把 pi 当成一个库，自己写一整套运行时，pi 只出现在调用链的最末端。** 这句话决定了本稿后面所有 diff 的读法——它和 pi 的差异不是「改了 pi 的哪几行」，而是「pi 的哪几块还被用着」。

## 1.2 基本面

| 项 | pi | minimax-code |
| --- | --- | --- |
| 可执行文件 | `pi` | `mcode`，另有 `mcode-tools`（`README.md:48`） |
| 入口 | 交互 / print / json / rpc | 交互 TUI、`mcode exec`（headless）、`mcode acp`（`README.md:121-126`） |
| 包管理 | npm workspaces | pnpm workspaces，`node-linker=hoisted`（`.npmrc`） |
| Node 版本 | `>=22.19.0`（`package.json:63`） | `>=22.19 <23 \|\| >=24.2 <27`：多了上界，跳过 23（`package.json:8-10`） |
| 用户数据目录 | `~/.pi` | `~/.minimax`，可按 profile 分开（`README.md:83`） |
| 许可 | MIT | 自有代码 MIT；vendor 进来的两个上游各带各的许可（`LICENSE-STATUS.md`） |
| 安装 | `npm i -g` | 官方安装脚本，不需要 sudo，必要时自带一份 Node（`README.md:33`） |
| 历史 | 完整 | 69 个提交；首个 CLI 提交 `c59cf53`（2026-09-18）一次加入 4,168 个文件、+1,088,185 行，**内部历史没有带过来**（`docs/open-source-status.md` 末节） |

【代码事实】仓库最早的提交（2026-06-01 起）是 Desktop 产品的 issue 追踪仓库；CLI 源码是 9 月 18 日整体导入的一个「已审核快照」。所以本仓库的 git 历史只能告诉我们**导入之后**的三天，不能告诉我们 runtime 是怎么长出来的。

## 1.3 代码规模分布

统一口径（`.ts/.tsx`，去掉测试、`.d.ts`）：全仓 2,650 个文件 / 677,790 行，其中 `packages/` 下自有代码 2,350 / 556,959 行。

| 包 | 文件 | 行 | 管什么 |
| --- | ---: | ---: | --- |
| `local-runtime-v2` | 871 | 195,133 | **当前**的进程内运行时：Session / Turn / Agent 服务 |
| `local-runtime` | 598 | 138,172 | 上一代运行时；v2 复用它的数据库、文件工具、权限、存储 |
| `tui` | 407 | 105,334 | 终端界面、headless、ACP 适配；含一份 pi-tui 的 fork |
| `agent-modules/*` | 136 | 39,482 | 12 个领域模块（见下表），多数不碰 IO |
| `agent-tools` | 97 | 22,551 | 内置工具定义与实现 |
| `shared` | 80 | 13,605 | 跨包常量与类型 |
| `browser-core` | 31 | 12,682 | 浏览器能力 |
| `agent-core` | 41 | 10,120 | **把 pi 组装成每一轮的执行器**（`pi-turn-runner/`） |
| `config` | 34 | 7,168 | 配置 schema 与默认值 |
| `agent-extension` | 17 | 5,395 | 9-hook SPI 上的适配器 |
| `protocol` | 3 | 2,168 | CLI 数据结构与运行时事件 |
| `oauth-core` | 15 | 2,020 | 登录、刷新、登出 |
| `agent-runtime` | 9 | 1,417 | hook SPI 的类型 |
| `oauth-lease-protocol` | 6 | 896 | 本地 token 租约协议 |
| `mcode-tools-host` | 5 | 816 | 给工具子进程发短期 token |

对照：vendor 进来的 pi 四个包（`third_party/pi-mono/packages/{agent,ai,coding-agent,tui}`）一共 263 个文件 / 102,623 行；沙箱 fork（`third_party/sandbox-runtime`）37 / 18,208 行。**自有代码是 vendor 的 pi 的 5.4 倍。**

`agent-modules` 的 12 个模块：

| 模块 | 文件 | 行 | 一句话 |
| --- | ---: | ---: | --- |
| `permission` | 45 | 16,672 | 权限引擎、规则、云端分类器客户端 |
| `plugin-hooks` | 9 | 5,194 | 11 个插件 hook 事件，兼容三种来源格式 |
| `system-reminder` | 12 | 3,407 | `<system-reminder>` 的组装与调度 |
| `goal` | 17 | 3,090 | 长任务目标：6 种状态、三种验证方式 |
| `cron` | 10 | 2,921 | 定时任务 |
| `mcp` | 8 | 1,644 | MCP 客户端（stdio / http） |
| `context-manager` | 8 | 1,537 | 上下文预算与 token 估算 |
| `runaway-guard` | 9 | 1,438 | 防跑飞：同一动作 / 同一错误 / 无进展的检测与提醒 |
| `skills` | 4 | 1,292 | Skill 注册与目录监视 |
| `background-task` | 8 | 916 | 后台任务状态机 |
| `conversation-contract` | 2 | 751 | 会话契约类型 |
| `session-report` | 4 | 620 | 会话报告的本地收集 |

【代码事实】12 个模块里有 7 个（background-task、context-manager、conversation-contract、cron、goal、runaway-guard、system-reminder）源码里没有 `node:fs` / `node:child_process` / `node:net` 的 import，是「不碰 IO」的纯领域模块；另外 5 个直接做 IO（`plugin-hooks` 要起子进程跑 hook 命令，`skills` 要读目录、监视文件）。纯模块的约定写在文件头：`system-reminder/src/index.ts:10-13` 写「This package stays IO-free … so it never imports a runtime host package」；`runaway-guard/src/guard.ts:19-22` 写「No Agent, lifecycle registration, host IO, Memory writes, or persistence belongs to this module.」IO 全部由 `local-runtime-v2` 注入。

## 1.4 运行模式：三个入口，一条链

【文档】`docs/architecture.md:5-10`：

- `packages/tui` 管终端交互，也管 headless 和 ACP 适配；
- `local-runtime-v2/src/local` 是进程内的产品入口；
- `local-runtime-v2/src/application` 管会话、队列、交互，**不起 HTTP 前门，不做云端交接**；
- `local-runtime` 提供被复用的宿主设施；
- `third_party/pi-mono` 提供 agent、模型协议、终端基础设施。

pi 的四种模式里，`print` / `json` 对应 `mcode exec`，`rpc` 的位置被 ACP 取代。pi 的 `AgentSession`（L3 产品会话）**一处都没被 import**：全仓 import `@earendil-works/pi-coding-agent` 的 19 个文件，拿的是 `convertToLlm`、`AuthStorage`、`DEFAULT_COMPACTION_SETTINGS`、`createBashTool`、`BashOperations` 这类零件（第 2 章）。

## 1.5 Provider：MiniMax 托管 + 三种 BYOK 格式

【文档】`README.md:86-99`：不登录也能用，设好 `MCODE_PROVIDER_API_KEY` 再加一个 provider，支持 `openai-completions`、`openai-responses`、`anthropic-messages` 三种 API 格式。登录 MiniMax 账号则走托管模型与 Token Plan。

【代码事实】这三种格式全部是 pi `ai` 包的协议适配器（vendor 进来的 `packages/ai`，54 个同路径文件里 23 个有改动，多是 provider 兼容补丁，见第 2 章）。provider 层是 pi 的；**选哪个、怎么鉴权、额度怎么算**是 minimax 的。

## 1.6 pi 的「No X」清单

| pi 不做的 | minimax-code |
| --- | --- |
| No MCP | ✅ `agent-modules/mcp`，stdio 与 http 两种传输 |
| No sub-agents | ✅ `task` 工具，三个内置角色 explore / worker / verifier，外加通用的 `mavis`（`shared/src/subagent-roles.ts:1-40`） |
| No permission popups | ✅ 三档：Ask / Auto / Full access，`Alt+M` 切换（`docs/installation.md:95`）；默认 `auto`（`config/src/config.ts:1709`） |
| No plan mode | ✅ `Shift+Tab`（`README.md:146`）；`service/plan/initialize.ts` |
| No built-in to-dos | ✅ `todowrite` 工具（`agent-tools/src/desktop/builtin-defs.ts:240`） |
| No background bash | ✅ `service/background-bash/`，加 `task_query` / `task_output` / `task_stop` |

和 Step-Code 一样，六项全部补上。区别在补法：Step-Code 是在 pi 的扩展事件上挂；minimax 是在自己的运行时里写，pi 的扩展系统根本没被启动。

## 1.7 pi 之外它多出来的东西

| 能力 | 位置 | 备注 |
| --- | --- | --- |
| 长任务目标 `/goal` | `agent-modules/goal` | 6 种状态，可以让 subagent 或评估器来验收（第 6 章） |
| 定时任务 | `agent-modules/cron` | |
| 防跑飞 | `agent-modules/runaway-guard` | 生产默认开启（第 3 章） |
| 记忆 | `memory` 工具；`shared/src/memory-limits.ts` | 软上限 15 KB、硬上限 20 KB（第 4 章） |
| 插件 | 官方市场 + 本地包；插件 hook 兼容三种格式 | 任意市场注册、GitHub URL 导入在 CLI/TUI 里**不暴露**（`docs/tui-capabilities.md`） |
| 沙箱 | `third_party/sandbox-runtime` | **默认关闭**，只有 macOS 后端（第 5 章） |
| 删除走回收站 | `local-runtime/src/infra/ensure-rm-shim.ts` | PATH 上放一个 `rm` 垫片（第 5 章） |
| 凭据租约 | `oauth-lease-protocol` + `mcode-tools-host` | 工具子进程只拿短期 token（第 5 章） |
| 浏览器、多模态 | `browser-core`；Matrix MCP | 不在本书范围 |

## 1.8 本章结论

- 规模：自有 556,959 行，是 vendor 的 pi（102,623 行）的 5.4 倍；**两代运行时并存**（v1 138,172 行、v2 195,133 行）。
- 与 pi 的关系：pi 是库，不是框架。L1 主循环和 L2 `Agent` 在用；L3 `AgentSession`、`SessionManager`、扩展系统都不在产品路径上。
- 六个「No X」全部补上，外加 goal、cron、防跑飞、记忆、沙箱、凭据租约。
- 历史：内部 monorepo 的公开投影，导入之前的演化不可见。
