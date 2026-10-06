# 1. 产品定位与能力盘点

> 对照基准：[pi 第 1 章](../pi/01-product-teardown.md)。pi 把自己定位成「一个可以被别人搭在上面的最小 agent」；kimi-code 是一个有账号、有会员、有 Web 和 IDE 入口的完整产品，它和 pi 的关系只剩终端渲染这一层。

| | pi | kimi-code |
| --- | --- | --- |
| 自有代码 | 全部 | 360,713 行（全仓 379,393 行减去 `pi-tui` 的 18,680 行），占 95.1% |
| 来自 pi 的 | — | 只有 `packages/pi-tui`，pi `packages/tui` 的 fork |
| 引擎 | L1 循环 + L2 `Agent` + L3 `AgentSession` | 自研 `agent-core-v2`：DI × 三级 Scope，136,383 行 |
| provider 层 | `packages/ai` | 自研 `kosong`：Kimi、Anthropic、OpenAI（chat / responses / legacy）、Google GenAI |
| 执行环境 | 直接 `child_process` | 自研 `kaos`：本地进程与文件抽象 |
| 入口 | 交互 / print / rpc | CLI（TUI）、`kimi -p`（print）、`kimi web`、`kimi acp`、VS Code 扩展、Remote Control |
| 形态 | 单进程库 | 本地服务端 `kap-server`（REST + WebSocket），各入口是它的客户端 |

一句话：pi 是一个库；kimi-code 是一个**本地服务端加一组客户端**，pi 只在其中一个客户端（终端）的渲染层出现。

## 1.1 产品形态

【文档】`docs/en/guides/getting-started.md:5` 把它定位成「在终端里运行的 AI agent，帮你完成软件开发和日常终端操作」。命令名是 `kimi`。

【代码事实】`AGENTS.md:17-31` 的项目地图把形态写清楚了：

- `packages/kap-server` 是服务端，背后是 `agent-core-v2`，通过 `/api/v1` 与 `/api/v1/ws` 暴露会话；
- `packages/klient` 是客户端 SDK，`ipc` 和 `memory` 两种传输返回同一个 `Klient`；
- `apps/kimi-code` 是 CLI / TUI，**只能**通过 SDK 用引擎能力，「must not depend directly on engine packages」（`AGENTS.md:17`）；
- Web 界面的源码**不在这个仓库**：它在另一个仓库开发，以预构建产物 `apps/kimi-code/dist-web` 提交进来（`AGENTS.md:18`，524 个文件）。

【推断】这决定了本书能看到什么：引擎、服务端、终端、VS Code 扩展的源码都在；Web 界面只有构建产物。第 5–8 章的结论都以引擎为准，Web 界面里有没有额外的确认或上报，本书不知道。

### 入口

| 入口 | 命令 | 说明 |
| --- | --- | --- |
| 交互 TUI | `kimi` | 默认入口；终端渲染用 `pi-tui` |
| print | `kimi -p "<prompt>"` | 非交互；**强制 auto 权限模式**（第 5 章 5.5） |
| Web | `kimi web` | 本地起服务端 + 打开浏览器 |
| ACP | `kimi acp` | `packages/acp-server`，给编辑器用 |
| VS Code | `apps/vscode` | 18,390 行 |
| Remote Control | `kimi rc` / `/rc` | 经厂商中继把本机服务端暴露给手机或别的设备；要求付费会员（`docs/en/guides/remote-control.md`） |

## 1.2 基本面

【代码事实】

- 根 `LICENSE` 是 MIT（Moonshot AI，2026）；`packages/pi-tui/LICENSE` 保留了 pi 的原始署名。
- 1,590 个提交，最早的是 `842e699a`（2026-05-22）。
- 版本号有两个：`apps/kimi-code/package.json:3` 是 2.0.2，这是发布的版本；根 `package.json:3` 是 0.1.1，是 workspace 的版本，不对外。
- 2.0 是一次引擎换代：v2 引擎在 `ceb158dc`（#1441，2026-07-12）进仓，v1 在 `bb16383a`（#3542）删掉。现在仓库里只有 v2，`packages/migration-legacy` 负责把 v1 的会话数据搬过来。

【推断】和 minimax-code 的「公开投影、历史不可见」不同，kimi-code 的演化过程完整地在公开仓库里：本书可以用 `git log` 回答「这条规则是什么时候加的」。第 5 章的 git 仓库内写入自动批准，就是这样追到它从 v2 第一天起就在的。

## 1.3 代码规模分布

`.ts/.tsx`，去掉测试与 `.d.ts`：

| 包 / 应用 | 文件 | 行 | 是什么 |
| --- | ---: | ---: | --- |
| `packages/agent-core-v2` | 1,038 | 136,383 | 引擎 |
| `apps/kimi-code` | 343 | 68,003 | CLI / TUI |
| `packages/kap-server` | 163 | 30,651 | 本地服务端 |
| `packages/minidb` | 81 | 23,215 | 自研嵌入式存储 |
| `packages/pi-tui` | 44 | 18,680 | **pi 的 TUI fork** |
| `apps/vscode` | 126 | 18,390 | VS Code 扩展 |
| `packages/node-sdk` | 65 | 12,774 | 公开 SDK 与 harness |
| `apps/vis` | 81 | 11,431 | 会话与回放的可视化调试 |
| `apps/kimi-inspect` | 57 | 11,322 | 服务端 debug RPC 的 Web 检查器 |
| `packages/kosong` | 28 | 9,240 | provider 抽象 |
| `packages/klient` | 60 | 8,107 | 客户端 SDK |
| `packages/oauth` | 29 | 6,490 | 登录与托管鉴权 |
| `packages/acp-server` | 28 | 5,648 | ACP |
| `packages/tree-sitter-bash` | 9 | 5,021 | bash 语法树（危险命令判定用） |
| `packages/migration-legacy` | 34 | 4,060 | v1 数据迁移 |
| `packages/transcript` | 27 | 3,758 | 会话记录的渲染数据层 |
| `packages/kaos` | 14 | 3,187 | 执行环境抽象 |
| `packages/remote-control` | 6 | 1,492 | 远程控制隧道客户端 |
| `packages/telemetry` | 11 | 1,289 | 遥测 |
| 全仓 | 2,247 | 379,393 | |

*引擎占 36%，自研存储 `minidb` 比 pi 的 TUI fork 还大。*

## 1.4 「No X」清单

| pi 的「No X」 | kimi-code | 位置 |
| --- | --- | --- |
| No MCP | stdio 与 http；用户级与项目级两份配置 | `mcpCore/`；`docs/en/customization/mcp.md` |
| No sub-agents | `Agent` 工具 + coder / explore / plan 三个角色；`AgentSwarm` 最多 128 个 | `session/agentLifecycle/profile/profiles.ts:46-125`、`features/plan/profile/plan.ts`；`features/swarm/` |
| No permission popups | Always Ask / Ask When Needed / Never Ask 三档，默认 Always Ask | `agent/permissionPolicy/`；`docs/en/guides/interaction.md:65-71` |
| No plan mode | `EnterPlanMode` / `ExitPlanMode` | `features/plan/` |
| No built-in to-dos | `TodoList` | `features/todo/` |
| No background bash | 后台任务 + `TaskList` / `TaskOutput` / `TaskStop` / `WaitFor` | `agent/tools/task/` |

清单之外：长任务目标 `/goal`（带 token 与墙钟预算）、定时任务 cron、技能、插件、20 个事件的外部 hook、实验性的多 agent 协作「Tower 模式」、Remote Control。

## 1.5 主 agent 的工具面

【代码事实】`session/agentLifecycle/profile/profiles.ts:11-44` 列出主 agent 的 32 项：

- 文件与搜索：`Read`、`Write`、`Edit`、`Grep`、`Glob`、`ReadMediaFile`
- 执行：`Bash`、`TaskList`、`TaskOutput`、`TaskStop`、`WaitFor`
- 调度：`CronCreate`、`CronList`、`CronDelete`
- 网络：`WebSearch`、`FetchURL`
- 协作：`Agent`、`AgentSwarm`、`AskUserQuestion`、`NotifyUser`、`Skill`、`TodoList`
- 模式：`EnterPlanMode`、`ExitPlanMode`、`CreateGoal`、`GetGoal`、`SetGoalBudget`、`UpdateGoal`
- Tower：`TowerInit`、`TowerStatus`、`TowerTeardown`（实验开关打开时才露出）
- `mcp__*`

另有 `select_tools`（`agent/tools/select-tools/`），用于按需展开延迟加载的工具（第 4 章 4.6）。

## 1.6 本章结论

- 自有代码 95%；来自 pi 的只有终端渲染一个包。
- 形态是本地服务端 + 多个客户端；CLI 被规定只能通过 SDK 用引擎。
- Web 界面源码不在仓库，只有构建产物。
- 历史完整可见，v1 → v2 的引擎换代在公开仓库里发生。
- 「No X」6 项全部补上，外加 goal、cron、Tower、Remote Control。
