# kimi-code 拆解

> **这是研究底稿，不是本书正文。**
> 它是[第 33 章](../../book/06-vendors/ch33-kimi.md)和第三部分「各家的选择」的证据层。版本锁定见 [`../BASELINE.md`](../BASELINE.md)。

**状态**：✅ 完成（基准 `65ae3e36`，对照 pi `b79e4cc8`；`pi-tui` 的同步点是 pi `53816d7d`）

| 项 | 值 |
| --- | --- |
| 厂商 | 月之暗面（Moonshot AI） |
| 基准 commit | `65ae3e36`（2026-09-20） |
| 版本 | `apps/kimi-code` 2.0.2（CHANGELOG 2026-09-19）；根 `package.json` 0.1.1 是 workspace 版本 |
| 许可 | MIT（根 `LICENSE`）；`packages/pi-tui` 保留 pi 的 MIT 署名 |
| 与 pi 的关系 | **仅 TUI**：`packages/pi-tui`（发布名是自家 scope 下的 `pi-tui` 0.84.5）是 pi `packages/tui` 的 fork；引擎、provider、会话、扩展**一行都不来自 pi**。见 [血缘图谱](../BASELINE.md#血缘谁和-pi-是什么关系) |
| 历史 | 1,590 个提交，最早一个是 2026-05-22；v2 引擎在 `ceb158dc`（#1441，2026-07-12）进仓，v1 在 `bb16383a`（#3542）删除——**演化过程完整可见** |

本书关于月之暗面的分析**只以这个公开仓库为准**；安装脚本与服务端地址、搜索与抓取服务的地址、遥测接收端、OAuth 客户端标识一律不写出。

---

## 规模（统一口径）

`.ts/.tsx`，去掉测试与 `.d.ts`：

| 范围 | 文件 | 行 |
| --- | ---: | ---: |
| 全仓 | 2,247 | 379,393 |
| `packages/agent-core-v2`（引擎） | 1,038 | 136,383 |
| `apps/kimi-code`（CLI + TUI） | 343 | 68,003 |
| `packages/kap-server`（本地服务端） | 163 | 30,651 |
| `packages/minidb`（自研存储） | 81 | 23,215 |
| `packages/pi-tui`（pi 的 TUI fork） | 44 | 18,680 |
| `apps/vscode` | 126 | 18,390 |
| 其余 13 个包 / 应用与根目录脚本 | 452 | 84,071 |

**来自 pi 的只有 `pi-tui` 这 18,680 行，占全仓 4.9%。** 包级明细见 [§1.3](./01-product-teardown.md#13-代码规模分布)。

## 与 pi 的 diff（只有 TUI 一个包）

| 对照 | 同路径 | 字节相同 | 改过 | 只在 kimi | 只在 pi |
| --- | ---: | ---: | ---: | ---: | ---: |
| `pi-tui/src` vs pi `b79e4cc8` 的 `packages/tui/src` | 40 | 12 | 28 | 3 | 0 |

逐行合计 +1,962 / −452。注意基准差：kimi 的同步点是 pi `53816d7d`（v0.85.1 之后），比本书的 pi 基准新，所以这 28 个文件里有一部分是上游自己的变化。`UPSTREAM.md` 用 18 张「意图卡」记录每一处本地改动**为什么存在**，不记录它在哪一行（[§2.5](./02-architecture-and-guardrails.md#25-pi-tui按意图跟随上游)）。

**一句话**：kimi-code 只从 pi 拿了终端渲染，引擎是自己从零写的 DI × Scope 架构；它把「会跑飞」「会溢出」「会断对」都做成了真停、真恢复、真修复的机制，但把自主度给得很足——无头模式和 auto 模式几乎什么都放行，子进程继承完整环境，没有沙箱。

## 9 章

| # | 文档 | 一句话结论 |
| --- | --- | --- |
| 1 | [产品定位与能力盘点](./01-product-teardown.md) | 自有代码占 95%；CLI / Web / VS Code / ACP 四个入口共用一个本地服务端 |
| 2 | [架构分层与守卫体系](./02-architecture-and-guardrails.md) | DI × 三级 Scope；无注释区与厂商名闸门每次都跑；导入边界的全量检查没接进 CI（实机 4 处违规），Windows CI 关着 |
| 3 | [Agent Loop](./03-agent-loop.md) | 重复调用断路器会真停，并给一步只许文字的交接；默认没有步数上限；截断的 tool call 不显式拦 |
| 4 | [上下文工程](./04-context-engineering.md) | 85% 触发压缩；provider 报溢出后压缩重试，并记住这个模型真实的窗口；成对性写时补、读时修 |
| 5 | [工具与权限](./05-tools-permissions.md) | 13 条策略的首个命中链；危险命令用语法树判；auto 与无头模式几乎全放行；git 仓库内的写入在手动模式也自动批准 |
| 6 | [多 Agent 与任务](./06-multi-agent.md) | 子 agent 深度 1，靠去掉工具实现；explore 的只读明说是提示；Tower 模式用 worktree 隔离，但只拦 Write / Edit |
| 7 | [扩展性与生态](./07-extensibility.md) | 20 个 hook 事件、失败即放行且文档明说；MCP 与 hook 都继承完整环境；工作区信任只管 MCP |
| 8 | [可观测性与运维](./08-observability.md) | 遥测默认开，登录后附账号 token；两条管线只有一条脱敏；本地日志、回放、检查器很全；反馈「日志」档是整个会话记录，「代码库」档 ≤ 500 MiB、按路径排除 |
| 9 | [评估、风险与建议](./09-assessment-risks-recommendations.md) | 19 项发现（🟠 6 / 🟡 9 / 🟢 4）；文档与代码四处分歧都偏宽松；`local.toml` → `$HOME` 写入不问的实机探针；探针 A–H 全部答案 |

## 阻塞了哪些正文

- [第 33 章 月之暗面：kimi-code](../../book/06-vendors/ch33-kimi.md) —— 已解除
- 第三部分（第 16–21 章）的 `X.2 各家的选择` 中 kimi-code 一栏
- [第 6 章 成本与投入](../../book/01-choosing/ch06-cost-and-effort.md) 的 diff 规模 —— 已解除

## 引用约定

- 路径默认相对 `kimi-code/packages/agent-core-v2/src/`；`apps/`、`packages/`、`docs/`、`scripts/`、`.github/`、`AGENTS.md` 相对仓库根。行号对应基准 commit。
- 证据标签：**【代码事实】** 读源码得出；**【推断】** 由代码推出但没有直接陈述；**【文档】** 仓库自带文档（`docs/en/`）或 `CHANGELOG` 的原话；**【实机】** 在 macOS arm64、Node v22 上跑出来的结果（只在 `/tmp` 的副本里跑，不动原仓库）。
- 不写出：安装脚本与服务端地址、搜索 / 抓取服务地址、遥测接收端、OAuth 客户端标识、提交者姓名。
