# 9. 评估、风险与建议

> 本章是前八章的综合。所有判断都可回溯到具体章节与文件行号，不引入新的未核实结论。对照基准：[pi 第 9 章](../pi/09-assessment-risks-recommendations.md)。

## 9.1 安全与透明度发现

七条。**先说性质**：和 pi 一样，没有一条是「数据已经泄露」或「凭据已经提交」。区别在于，pi 的问题多是「机制层没给策略」；Step-Code 已经给了策略，问题变成了**策略覆盖不全**——补了一扇门，旁边的门还开着。

| # | 级别 | 问题 | 位置 | 来自 pi？ |
| --- | --- | --- | --- | --- |
| **F1** | 🟠 高 | **`!` 用户命令不过权限判定**，Read Only 档下也照常执行；RPC 模式的 `user_bash` 命令同理 | `apps/cli/src/ui/interactive-mode.ts:6630-6640`、`modes/rpc/rpc-mode.ts:564`；控制器只挂 `tool_call`（`features/step.ts:242-244`） | 继承，**但落差变大** |
| **F2** | 🟠 高 | **用户安装的扩展包跑 npm 生命周期脚本** | `core/package-manager.ts:1770-1791` | 继承 |
| **F3** | 🟡 中 | **模型执行的命令能读到全部环境变量**（含 provider 密钥） | `utils/shell.ts:139-152` | 继承 |
| **F4** | 🟡 中 | **无沙箱、无路径边界**：autopilot / bypass 两档下一切直接落在宿主上 | `core/tools/path-utils.ts:48-50`；`step/stdio-host.ts:439-443` 明确拒绝沙箱请求 | 继承（但 Step 把它说出来了） |
| **F5** | 🟡 中 | **零防死循环**；`tool_call_repeat` 事件定义了但没人发，`shouldStopAfterTurn` 没接 | `agent-loop.ts:265`；`step/telemetry-events.ts:65,510` | 继承 |
| **F6** | 🟢 低 | **命令无默认超时** | `step/tool-profile.ts:1014-1018` | 继承 |
| **F7** | 🟢 低 | **请求期投影可能让前缀缓存失效**，代码里没有任何缓存相关处理 | `agent-core/src/harness/projection*.ts`（6 个文件无 cache 一词）；默认关闭 | 新增 |

### 为什么 F1 比在 pi 里更要紧

pi 里 `!` 绕过的是一个**示例**扩展（`permission-gate.ts`），装它的人是少数。Step-Code 里绕过的是**产品默认的权限系统**：

- `user_bash` 这个名字明明写进了「可写或可执行」集合（`step/permissions.ts:97`）——作者想到了它；
- 但 `!` 走的是 `user_bash` **扩展事件**，不是 `tool_call` 事件，这个集合永远查不到它；
- 而用户看到的档位名叫「Read Only」。

修法有两种：给 `user_bash` 事件也挂上同一个判定（一个 `pi.on("user_bash", …)`），或者在 Read Only 的说明里写明「不含 `!` 命令」。前者是几十行，后者零成本。

### F2 与 F4 的关系

和 pi 第 9 章的结论一样：即使加上 `--ignore-scripts`，扩展本身仍是进程内全权限（[§7.1](./07-extensibility.md)）。F2 的修复价值是**消除纪律不一致**——Step-Code 自己的 CI 用了 `--ignore-scripts`（`.github/workflows/ci.yml:35`），用户装扩展却没有。

Step-Code 已经给出了更好的方向：声明式插件把市场分发的东西从「代码」变成「清单 + MCP 子进程」（[§7.3](./07-extensibility.md#73-声明式插件市场)）。但 pi 的旧路径还开着。

### F4 的另一面

「没有沙箱」本身是 pi 的立场；Step-Code 的贡献是**把这件事变成了错误而不是沉默**——SDK 宿主请求 `sandbox.enabled` 时直接返回 `SANDBOX_UNAVAILABLE`，没有权限回调时默认 `dontAsk` 失败关闭（`step/stdio-host.ts:430-443`）。这是全仓最值得照抄的一处错误处理。

## 9.2 核心判断

### 1. 这是「在 pi 的扩展点上做产品」的完整样本

产品层全部是内联扩展：权限、能力、cron、goal、provider，一共四个工厂加一个 provider 扩展（[§2.2](./02-architecture-and-guardrails.md#22-产品层是怎么挂上去的)）。循环本身只改了一处（工具调用标记泄漏重采样，[第 3 章](./03-agent-loop.md)），扩展事件一个没加（[§7.1](./07-extensibility.md#71-扩展-api一个字没改)）。

【推断】这说明 pi 的扩展 API 足以承载一个商业产品的策略层。反过来，Step-Code 改不了的地方——`!` 走另一个事件、循环里没有计数器——也正是 pi 扩展 API 的边界。

### 2. 补策略层时，选的都是「失败关闭」

| 场景 | 选择 | 位置 |
| --- | --- | --- |
| 无人值守时遇到要确认的工具 | 拒绝 | `step/permissions.ts:535-546` |
| 未知工具 | 按可写处理 | `:391` |
| shell 静态分析没分析完 | 要显式批准，无人值守时拒绝 | `:374-381` |
| SDK 请求沙箱 | 报错 | `step/stdio-host.ts:439-443` |
| 追踪头字段列表缺省 | 一个不发 | `step/trace-headers.ts:74-76` |
| 快捷键切换权限 | 不持久化 | `features/step.ts:308-323` |
| autopilot 同一个错误重复出现 | 停 | `step/permissions.ts:715-729` |

### 3. 工程纪律：从「源码能跑」走到「架构能守」

pi 第 9 章说它缺「机器强制的架构守卫」。Step-Code 补了 14 道，而且做了 pi 没做的那一步：**让守卫自己的自检进 CI**（`scripts/guard-self-tests.test.mjs:6-11`）——守卫逻辑坏了会悄悄报「通过」，这件事被当成一个独立的风险处理。

### 4. 「改请求，不改记录」

请求期投影（[§4.3](./04-context-engineering.md)）和流中断恢复（[§4.4](./04-context-engineering.md)）都遵循同一条规则：只改发给模型的那一份，会话文件原样。这让两项实验性能力都可以无损回退。

## 9.3 真实的债

| 债 | 位置 |
| --- | --- |
| 历史被压成一个初始提交，与 pi 的上游关系只能靠 blob 对比还原 | `4fdb781`（[README](./README.md)） |
| 两个巨型文件继续长：`agent-session.ts` 3,516 → 3,653 行；交互模式搬到 `apps/cli` 后仍是一个 6,753 行的文件（`apps/cli/src/ui/interactive-mode.ts`） | [第 2 章](./02-architecture-and-guardrails.md) |
| 过时注释：subagent 头注释说「JSON mode」，实际是 rpc；层级闸门有一行描述旧结构 | `features/step-subagent.ts:1-8`；`scripts/check-layer-direction.mjs:14` |
| 工作区清单列了一个不存在的目录 `packages/extensions/*` | `pnpm-workspace.yaml` |
| `tui` 包仍沿用 pi 的包名；MCP 握手的 `clientInfo.name` 是内部旧名 | `step/mcp.ts:29` |
| 压缩默认值在两个包里各有一份 | `agent-core/src/harness/compaction/` 与 `coding-agent/src/core/compaction/` |
| 首启对话框（含「anonymous usage analytics」和不存在的 `/privacy`）注入了但**没有调用方** | `apps/cli/src/ui/view/dialogs/first-time-setup.ts:71`；`modes/interactive-contract.ts:170` 只有声明 |
| v2 `AgentHarness` 只剩一个用户 | `server/create-harness.ts`（143 行） |

## 9.4 pi 的缺口，Step-Code 补了哪些

对照 pi 第 9 章的八条发现和五个缺口：

| pi 的发现 / 缺口 | Step-Code |
| --- | --- |
| S1 扩展安装不禁脚本 | ❌ 未改（F2） |
| S2 `!` 绕过权限门 | ❌ 未改，且因为有了默认权限系统而更显眼（F1） |
| S3 凭据对命令可见 | ❌ 未改（F3） |
| S4 `/share` 上传 system prompt | ✅ 消失：服务端与分享功能整包删除 |
| S5 零防死循环 | ❌ 未改（F5）；autopilot 的重复失败检测只针对模型错误 |
| S6 `/privacy` 不存在 | ⚪ 文案还在，但对话框不再被调用 |
| S7 缺 `unhandledRejection` | ❌ 未改 |
| S8 telemetry 的 `sensitive` 字段是装饰 | ⚪ `packages/telemetry` 原样；Step 自己的遥测走另一套契约 |
| 缺口：无 provider 录制回放 | ❌ 未改 |
| 缺口：巨型文件 | ❌ 继续长 |
| 缺口：无架构守卫 | ✅ 14 道 + 自检进 CI |
| 缺口：v2 门面不可用 | ⚪ 产品路径走 v1，v2 只留一个用户 |
| 「No X」清单 6 项 | ✅ 全部补上（MCP / subagent / 权限 / plan / todo / 后台任务） |

## 9.5 给下游的建议：从 Step-Code 可以抄什么

### 直接抄

1. **请求了没有的安全能力就报错**（`stdio-host.ts:439-443`）。
2. **无人值守 = 失败关闭**，并且把「无人值守」做成一个显式参数（`nonInteractiveApproval`），而不是从 UI 是否存在推出来。
3. **快捷操作不持久化权限**（`features/step.ts:313-318` 的注释值得整段读）。
4. **守卫要有自检，自检要进 CI**。
5. **读别人配置的三条规则**：不抛错、报告丢弃、不内联密钥（`step/mcp-import.ts:10-28`）。
6. **改请求，不改记录**。

### 抄之前先补

1. 给 `user_bash` 也挂上权限判定。
2. `getShellEnv` 改成白名单。
3. 循环里加一个按调用指纹计数的刹车——事件契约 `tool_call_repeat` 已经替你设计好了字段。
4. 启用投影之前，先量一下它对前缀缓存命中率的影响。

## 9.6 一句话结论

Step-Code 证明了 pi 的扩展 API 撑得起一个完整产品的策略层；它补上的部分几乎都选择了失败关闭，没补上的部分几乎都是 pi 的扩展 API 本身够不着的地方。

## 附：探针 A–H 的答案

pi 第 9 章附录列了一组「下游必须回答的问题」。Step-Code 的答案：

### A. 规模与定位（第 1 章）

- 行数 +18.8%（127,546 → 151,503），增长集中在 `coding-agent` 的 `step/` + `features/` 和新增的 `apps/cli`。
- provider 40 → 1，适配层保留。
- 四种运行模式全留，加一个 `sdk-stdio`。
- pi 的「No X」6 项全部补上。
- 巨型文件没拆，两个都变大了。
- 没有回流上游：历史被压平，继承来的 issue 自动关闭闸门也删了（`58df39d`）。

### B. 架构与守卫（第 2 章）

- 加了基于 TypeScript AST 的分层闸门（`scripts/check-layer-direction.mjs`），共 14 道新闸门，15 道带 `--self-test`。
- 供应链纪律保留：精确版本、冻结 lockfile、Action 钉 SHA、每日 audit。
- 浏览器冒烟测试保留。

### C. Agent Loop（第 3 章）

- 长度截断处理已在（基线更新）。
- `drain()` 与中断语义不变。
- 没有迭代上限、没有调用指纹。
- `shouldStopAfterTurn` 没接。
- 产品路径走 v1。
- 唯一改动：工具调用标记泄漏到文本时重采样，默认 2 次。

### D. 上下文工程（第 4 章）

- 预留改成绝对值 24,576。
- `findCutPoint` 规则不变；摘要用同一个模型。
- `<read-files>` / `<modified-files>` 保留。
- 摘要格式 6 段 → 8 段，加了重试和按模型的输出上限。
- 没有记忆子系统。
- 新增默认关闭的请求期投影和流中断恢复投影。

### E. 工具与权限（第 5 章）

- 在 `tool_call` 扩展事件上加了真正的权限门：四档预设 + shell 静态分析三态。
- `--approve` 保持 pi 的原意，没有挪用。
- 没有进程内工具沙箱；QuickJS 沙箱只管 workflow 脚本。
- `!` 不受管（F1）；不剥离凭据（F3）；没有 cwd / `.git` / `.env` 保护（F4）；没有默认超时（F6）。
- 没有 code mode。

### F. 多 Agent（第 6 章）

- subagent 是内置工具。
- 子进程模型不变，但改为长驻 rpc 子进程，可选 git worktree，深度限制为 1。
- agent 定义沿用 markdown + frontmatter。
- 新增真正的 workflow 引擎：QuickJS/WASM 里跑模型写的脚本，带 journal 与预算。
- 数据跨 VM 边界只走 JSON。

### G. 扩展性（第 7 章）

- 扩展无隔离。
- 扩展安装没有 `--ignore-scripts`。
- 声明式插件清单给市场插件加了一层能力声明（如 `requiresEnv`），只覆盖市场插件。
- MCP 补上。
- `registerProvider` 保留，Step 自己就在用。
- 内联扩展工厂保留，是整个产品层的挂载方式。

### H. 可观测性（第 8 章）

- 遥测契约定义了 50 个事件，公开构建接的是 no-op。
- 脱敏在出口（开发日志、反馈），不在会话存储。
- `enableInstallTelemetry` 删除；公开构建没有新的上报端点，唯一的主动出站是更新检查。
- `x-step-client` 每次都发，敏感追踪头失败关闭。
- 会话存储不变，没有 provider 录制回放，没有 SQLite。
- 没有 `doctor`，没有 `unhandledRejection` 兜底。
