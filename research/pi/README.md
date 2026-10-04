# pi 产品拆解研究

> **这是研究底稿，不是本书正文。**
> 它是《Code Agent 实战》第三、五、六部分的证据层——正文里每一处行号引用都指向这里。
> 版本锁定见 [`../BASELINE.md`](../BASELINE.md)。正文目录见 [`../../SUMMARY.md`](../../SUMMARY.md)。

从 code agent 工程专家视角，对 `pi`（Pi Agent Harness）做的系统性拆解。

**pi 是这批研究底稿里最该先读的一份。** 它是三家中国厂商、三个下游仓库的公共上游：

| 下游 | 与 pi 的关系 |
| --- | --- |
| **Step-Code** | 重组式衍生 |
| **minimax-code** | 整包 vendor |
| **kimi-code** | 仅 TUI 层 |
| deepseek-harness | 无功能依赖（唯一接触点是默认休眠的可选 provider 适配器，见 [`BASELINE.md`](../BASELINE.md#血缘谁和-pi-是什么关系)） |
| ZCode | 完全独立，与 pi 无关 |

**读懂这份拆解，才能判断那些 diff 里哪些是他们自己的判断力。**

---

**研究基准**：

| 项 | 值 |
| --- | --- |
| 仓库 | `github.com/earendil-works/pi-mono` |
| HEAD | `b79e4cc8`（2026-08-28） |
| 版本 | `v0.84.4` |
| 许可 | MIT |
| 规模 | **123,629 行 TS / 540 个源文件 / 10 个 workspace 包**（不含 test） |
| 测试 | 472 个 test 文件，约 115,921 行 |

**研究方法**：读源码为主（`packages/agent`、`packages/coding-agent`、`packages/ai`、`packages/telemetry`），读仓库自带文档为辅并交叉验证。文中所有结论都可追到具体文件行号，并区分 **【代码事实】** 与 **【推断】**。

> ⚠️ 本地克隆最后一次提交是 2026-08-28。"近 30 天 0 提交"只是快照时间，**不代表上游停更**——月度曲线显示它稳定在每月 400–530 次提交。全部结论基于 v0.84.4 这个快照。

---

## ⚠️ 先读这个：8 项发现

完整分析见 [文档 9 §9.1](./09-assessment-risks-recommendations.md#91-安全与透明度发现)。

**先说性质**：pi 的问题没有一条是"数据已经泄露"或"凭据已经提交"，全部属于两类——**边界没说清**，和**纪律不一致**。

| # | 级别 | 问题 | 位置 | 文档覆盖 |
| --- | --- | --- | --- | --- |
| S1 | 🟠 高 | **用户安装的扩展包不禁 lifecycle script**，postinstall 可任意执行代码 | `core/package-manager.ts:1785-1806` | 否 |
| S2 | 🟠 高 | **`!` 用户命令绕过 `beforeToolCall`**，权限门扩展拦不住 | [§5.5](./05-tools-permissions.md) | **零覆盖** |
| S3 | 🟡 中 | **凭据对模型执行的命令全部可见**，`env` 一条命令读到全部 API key | [§5.6](./05-tools-permissions.md) | 间接 |
| S4 | 🟡 中 | **`/share` 一并上传 system prompt 全文与工具 schema** | `session-share.ts:24-42` | 否 |
| S5 | 🟡 中 | **零防死循环**，产品层连唯一的宿主刹车都没接 | `agent-loop.ts:252` | 否 |
| S6 | 🟢 低 | **`/privacy` 被首启文案承诺但不存在** | `first-time-setup.ts:74` | 文案本身即问题 |
| S7 | 🟢 低 | 缺 `unhandledRejection` 处理器 | `interactive-mode.ts:4062` | 否 |
| S8 | 🟢 低 | telemetry 的 `sensitive` 字段是**装饰性**的 | `telemetry/src/index.ts:30` | 否 |

**最该先修的两条**：

- **S1 是唯一一处与 pi 自己的工程纪律直接打架的地方。** 它对自己的依赖做到了精确版本 + `npm ci --ignore-scripts` + lifecycle allowlist + 每日 audit + pre-commit 拒绝 lockfile 变更；而 `pi install <ext>` 走的是没有 `--ignore-scripts` 的路径。一行改动。
- **S2 是唯一一条文档与实现存在真实落差的。** 装了 `permission-gate.ts` 的用户会合理地以为自己被保护了，而手敲 `!rm -rf` 不经过那条路径。

> **重要的反向说明**：S3（凭据可见）严格处在 `docs/security.md:59` 声明的安全边界**之外**——pi 从未承诺过相反的东西。pi 不是"忘了做权限"，是**论证过之后决定不做**。这个区别对下游至关重要。

---

## 阅读顺序

| # | 文档 | 一句话 |
| --- | --- | --- |
| 1 | [产品定位与能力盘点](./01-product-teardown.md) | 12 万行、15 个第三方依赖、40 个 provider（中国厂商占 4 成） |
| 2 | [架构分层与守卫体系](./02-architecture-and-guardrails.md) | 只有三层深；没有架构守卫，但供应链纪律罕见地严 |
| 3 | [Agent Loop 深度拆解](./03-agent-loop.md) | **全书核心**：794 行纯函数 L1，与下游 diff 的归因基线 |
| 4 | [上下文工程](./04-context-engineering.md) | 绝对预留 16K、绝不切 toolResult、截断给续读路径 |
| 5 | [工具面与权限](./05-tools-permissions.md) | 8 个工具默认只开 4 个；**没有权限系统，且论证过为什么** |
| 6 | [多 Agent 编排](./06-multi-agent.md) | 六个"No X"；subagent 是 spawn 子进程的示例扩展 |
| 7 | [扩展性与生态](./07-extensibility.md) | 36 个事件覆盖主循环每个接缝；最大权力 + 最小约束 |
| 8 | [可观测性](./08-observability.md) | 两条轨：span SPI **零埋点**，会话 JSONL 在生产 |
| 9 | [评估、风险与建议](./09-assessment-risks-recommendations.md) | 工程判断 + **全部下游探针汇总** |

---

## 执行摘要

### 这是什么

`pi` 是奥地利开发者 Mario Zechner（badlogic）的开源终端 coding agent，MIT 许可。它自称 "**minimal terminal coding harness**"，中心命题写在产品 README 第一句：

> Adapt pi to your workflows, not the other way around, **without having to fork and modify pi internals**.

它是一个 10 包的 TypeScript monorepo，运行在四种模式（interactive / print+JSON / RPC / SDK），适配 40 个 LLM provider，**只用 15 个第三方依赖**——CLI 参数解析、TUI 渲染、HTTP 客户端全部自己写。

### 核心判断

**1. 这是一个真正的 agent 内核，不是套壳。**

判据是那些"只有踩过坑才会写"的代码：

- **截断消息的工具调用必须整批失败**（`agent-loop.ts:226-235`）。流式 JSON 抢救解析器会尽力补全 JSON，于是一条被 max_tokens 截断的消息，其工具参数可能**解析成功、schema 校验通过、内容残缺**——`write` 的 `content` 截断一半直接执行就是静默截断用户文件。pi 一刀切整批失败，不做"部分可信"判断。
- **压缩之后重拉 steering 的那道条件**（`agent-loop.ts:175`）。压缩要调 LLM 可能几十秒，期间用户很可能又补了话所以要重拉；但无条件重拉会让 `one-at-a-time` 模式一轮送进两条消息。于是加了 `if (pendingMessages.length === 0)`。
- **并行执行工具但按调用顺序 emit 结果**（`agent.ts:487-552`）。完成顺序不确定，调用顺序确定，而 transcript 里 tool result 必须与 tool call 配对。
- **截断时按 UTF-8 边界回切、落单代理对替换成 U+FFFD**（`truncate.ts:89-110`）。按字节截断一个 emoji 会产生非法 UTF-16。

**2. 最值钱的设计决定是 L1/L2/L3 三层切分。**

`agent-loop.ts` **794 行里没有一处产品逻辑**。L1 不知道会话树、不知道压缩、不知道扩展，只认回调。对照：Step-Code 原样沿用了这份文件（833 行，只多一处工具调用标记泄漏的重采样，见 [Step-Code 第 3 章](../step-code/03-agent-loop.md)）。

**这是三家中国厂商能在它上面做产品的直接原因**，也是本书后续归因的物理基础。

**3. 复杂度留在了正确的地方。**

产品层 60,960 行，内核 794 行。它的自我定位"minimal"**只有一半准确**——agent 抽象确实 minimal，产品实现一点都不 minimal。真正贯穿始终的不是 minimal，而是**"提供机制，不提供策略"**：权限、沙箱、多 agent、编排、遥测后端，全部给接口不给实现。

**4. 威胁模型是清晰、自洽且写下来了的。**

`packages/coding-agent/docs/security.md:35` 是本次拆解里最值得引用的一段设计论证：

> A **partial in-process sandbox would be easy to misunderstand as a security boundary** while still depending on the host shell, filesystem, package managers, credentials, and extension code. Real isolation needs to come from the operating system or a virtualization/container boundary.

**这句话应当直接用作下游探针**：若某家在 pi 上加了进程内权限门却没同时加 OS 级隔离，那正是这段文档警告的"看起来像边界的东西"。

**5. 最大的缺口是零防死循环。**

内层循环退出条件只有三条，**没有迭代上限、没有重复调用检测**；而产品层连唯一的宿主刹车 `shouldStopAfterTurn` 都没接（grep 在 `packages/coding-agent/src/` 零命中）。模型反复调用同一个失败工具时，pi 会一直陪它转，直到用户 Ctrl-C。**每一圈都是真金白银的 token。**

"留给宿主"能解释 `packages/agent`，解释不了 `packages/coding-agent`——那是 pi 自己的产品 CLI。

**6. 第二代运行时正在写，四处 v1/v2 并行。**

压缩、truncate、工具层、会话存储各有一份 v2 实现在 `packages/agent/harness/` 下，**写好、导出、测过，产品一个都不用**。`AgentHarness` 40+ 方法几乎全是 `unavailable()` → reject `HarnessNotImplemented`。

v2 的技术核心是**单写者持久记录日志**，原则硬得罕见（`reducer.ts:16-21`）：

> Restore must **reject** such states rather than repair or continue it.

**对下游的意义**：三个衍生仓库 vendor 的全部是 v1。未来 pi 若切到 v2，它们的 diff 会集体失去上游基线。

### 数据速览

| 维度 | 值 |
| --- | --- |
| 源码 | 123,629 行 / 540 文件 / 10 包；coding-agent 占 49% |
| 最大文件 | `interactive-mode.ts` 6,575 行、`agent-session.ts` 3,516 行 |
| 内核 | `agent-loop.ts` **794 行纯函数** |
| 依赖 | 20 个运行时依赖，去掉 5 个自家包 = **15 个第三方** |
| Provider | **40 个**，其中**中国厂商 16 个条目 / 7 家**（阿里、小米、Moonshot、MiniMax、智谱、蚂蚁、DeepSeek） |
| 工具 | 8 个内置，**默认只激活 read / bash / edit / write 四个** |
| 扩展点 | 36 个事件 + 11 类注册 API，同进程零隔离 |
| 测试 | 472 文件 / 115,921 行；默认离网 + faux provider + 环境白名单重建 |
| Git | 5,825 commit / 297 贡献者；**前两人占 79%**；稳定每月 400–530 |
| 治理 | 新贡献者的 issue/PR **默认自动关闭**，维护者评论 `lgtm` 逐个放行 |

### 一句话结论

**pi 是一个把"不做什么"想得比"做什么"更清楚的项目。**

它的 agent 内核、上下文工程和供应链纪律都达到了可直接学习的水准；六个"No X"不是缺失而是写进 README 并给了论证的产品决策。短板高度集中：**零防死循环**（唯一会直接伤到用户的一条）、**无 provider 录制回放**（对适配 40 家的项目是最痛的缺失）、**两处纪律不一致**。全部可修，且都不在内核。

**对本书最重要的是这一条**：pi 把复杂度留在了产品层而非内核，这意味着三家中国厂商在它上面做的每一处改动，都能被干净地归因为"自己的判断力"而非"上游给的"。**接下来逐家拆解时，这就是那把尺子。**
