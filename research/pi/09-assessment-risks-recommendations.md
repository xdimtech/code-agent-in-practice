# 9. 评估、风险与建议

> 本章是前八章的综合。所有判断都可回溯到具体章节与文件行号，不引入新的未核实结论。

## 9.1 安全与透明度发现

八条，全部在前八章中已逐条核实。**先说性质**：pi 的问题没有一条是"数据已经泄露"或"凭据已经提交"，全部属于两类——**边界没说清**，和**纪律不一致**。这与同类拆解里见到的硬编码凭据、无鉴权接口是完全不同的量级。

| # | 级别 | 问题 | 位置 | 文档是否覆盖 |
| --- | --- | --- | --- | --- |
| **S1** | 🟠 高 | **用户安装的扩展包不禁 lifecycle script**。`pi install <ext>` 的 postinstall 可任意执行代码，唯一前置门是一次 project trust 确认 | `core/package-manager.ts:1785-1806` | 否 |
| **S2** | 🟠 高 | **`!` 用户命令绕过 `beforeToolCall`**，权限门扩展拦不住 | 见 [§5.5](./05-tools-permissions.md) | **零覆盖**（只能从 `containerization.md:12` 反推） |
| **S3** | 🟡 中 | **凭据对模型执行的命令全部可见**——`getShellEnv` 全量透传 `process.env`，`env` 一条命令读到全部 API key | 见 [§5.6](./05-tools-permissions.md) | 间接（`docs/security.md:41-51` 建议传最少 key，未点破后果） |
| **S4** | 🟡 中 | **`/share` 一并上传 system prompt 全文与全部工具 schema**，而 system prompt 含 AGENTS.md | `session-share.ts:24-42`（`visibility=organization` `:113`） | 否 |
| **S5** | 🟡 中 | **零防死循环**，且产品层没接唯一的宿主刹车 `shouldStopAfterTurn` | `agent-loop.ts:252`；grep 产品层零命中 | 否 |
| **S6** | 🟢 低 | **`/privacy` 命令被首启文案承诺但不存在**，且该 analytics 无任何消费者 | `first-time-setup.ts:74` | 文案本身即问题 |
| **S7** | 🟢 低 | **缺 `unhandledRejection` 处理器**，逃逸的 rejection 留下未恢复的终端 | `interactive-mode.ts:4062-4064` 只注册了 `uncaughtException` | 否 |
| **S8** | 🟢 低 | telemetry 的 **`sensitive` 字段是装饰性的**——声明了，无人使用，无人读取 | `packages/telemetry/src/index.ts:30` | 否（当前零埋点，属未来陷阱） |

### 最该先修的两条

**S1 是唯一一处与 pi 自己的工程纪律直接打架的地方。** 对比[第 2 章 §2.4](./02-architecture-and-guardrails.md) 那张表——pi 对自己的依赖做到了精确版本 + `npm ci --ignore-scripts` + lifecycle allowlist + 每日 audit + pre-commit 拒绝 lockfile 变更；而 `pi install some-extension` 走的是没有 `--ignore-scripts` 的路径。

pi 的威胁建模是正确的（自己是能执行 bash 的工具，供应链失守 = 用户机器 RCE），但这套建模**没有延伸到用户装的包**。技术上是一行改动。

> ⚠️ 需要同时说明的是：即便加上 `--ignore-scripts`，扩展本身仍是同进程全权限（[§7.3](./07-extensibility.md)），装一个恶意扩展依然等于 RCE。**所以 S1 的修复价值是消除"纪律不一致"，不是建立安全边界**——那个边界 pi 明确不提供。

**S2 是唯一一条文档与实现存在真实落差的。** 装了 `permission-gate.ts` 的用户会合理地以为自己被保护了，而手敲 `!rm -rf` 不经过那条路径。任何文档都没写这件事。修法有两种：把 `!` 纳入同一条事件路径，或者在文档里明说它不经过。后者成本为零。

### 关于 S3 的准确表述

S3 在"用 pi 跑不受信任的仓库"这个场景下是最实际的风险——**不需要绕过任何拦截，`env` 一条命令就够了**。但它严格处在 `docs/security.md:59` 声明的安全边界之外，pi 从未承诺过相反的东西。把它列为"中"而非"高"，是因为它是**已声明威胁模型内的已知后果**，而不是承诺与实现的落差。

---

## 9.2 核心判断

### 1. 这是一个真正的 agent 内核，不是套壳

判据是那些"只有踩过坑才会写"的代码。四个最有说服力的：

- **截断消息的工具调用必须整批失败**（`agent-loop.ts:226-235`）。流式 JSON 抢救解析器会尽力补全 JSON，于是一条被 max_tokens 截断的消息，其工具参数可能**解析成功、schema 校验通过、内容残缺**——`write` 的 `content` 截断一半直接执行就是静默截断用户文件。pi 一刀切整批失败，不做"部分可信"判断。CHANGELOG 记录了这是 issue #6285 的修复。
- **prepare 之后重拉 steering 的条件判断**（`agent-loop.ts:175`）。压缩要调 LLM 可能几十秒，期间用户很可能又补了话，所以要重拉；但无条件重拉会让 `one-at-a-time` 模式一轮送进两条消息。于是加了 `if (pendingMessages.length === 0)`。**同时处理"长耗时准备期间的新输入"和"队列语义不能破坏"两个约束。**
- **并行执行但按调用顺序 emit**（`agent.ts:487-552`）。transcript 里 tool result 的顺序必须与 tool call 一致，否则 provider 侧配对出错。完成顺序不确定，调用顺序确定。
- **截断时按 UTF-8 边界回切并把落单代理对替换成 U+FFFD**（`truncate.ts:89-110, 261-266`）。按字节截断一个 emoji 会产生非法 UTF-16，下游 JSON 序列化直接报错。

再加上[第 4 章 §4.6](./04-context-engineering.md) 那六个细节——**切模型后跳过 overflow 检查、压缩后的陈旧 usage、全零 usage 兜底**三条都在处理同一个根因（provider 给的 token 统计会过期、会缺失、会因换模型失去意义）。这种补丁只有运营过才会有。

### 2. 最值钱的设计决定是 L1/L2/L3 三层切分

`agent-loop.ts` **794 行里没有一处产品逻辑**（[§3.1](./03-agent-loop.md)）。L1 不知道会话树、不知道压缩、不知道扩展，只认 `AgentLoopConfig` 回调。

**这是三家中国厂商能在它上面做产品的直接原因。** 对照：step-cli 的 `agent-loop.ts` 是 2,141 行，L1/L3 没分开。分层不是为了好看，是为了让下游替换产品层时不必碰主循环。

### 3. 工程纪律高度集中在两处：供应链，和"源码能直接跑"

两者都付出了真实的 CI 成本并坚持住了（[§2.3](./02-architecture-and-guardrails.md)、[§2.4](./02-architecture-and-guardrails.md)）。

最值得抄的单点是两个**不检查"代码对不对"而检查"能力有没有被悄悄破坏"**的闸门：

- **`check:browser-smoke`** 用 esbuild 打包后对 **bundle 产物内容做断言**——禁止 `models.generated.ts` / `providers/all.ts` 进入包，目录 JSON 只能含 `anthropic.json`。防的是一次误加的 barrel import 静默把整个模型目录拖进来，"按需引入单个 provider"的能力就此消失。
- **`announce` 必须在 `publish-npm` 之后**（[§2.6](./02-architecture-and-guardrails.md)）。`publish-release-announcement.mjs:105-127` 会轮询 npm registry 逐包校验 `dist.integrity` 全部可用才写 R2 marker，而客户端版本检查读的正是这个 marker。**顺序倒置 = 客户端被告知一个装不了的版本。** R2 写入还用 ETag 条件写做 CAS 单调推进，绝不回退版本。

### 4. 威胁模型是清晰、自洽且写下来了的

`packages/coding-agent/docs/security.md:35` 是本次拆解里最值得引用的一段设计论证：

> A **partial in-process sandbox would be easy to misunderstand as a security boundary** while still depending on the host shell, filesystem, package managers, credentials, and extension code. Real isolation needs to come from the operating system or a virtualization/container boundary.

`:37` 把 project trust 钉死为 "only an input-loading guard"，并明说 prompt injection 是 "**expected local-agent risk and cannot be reliably prevented by pi**"。`:59` 把无内置沙箱、prompt injection、用户装的扩展行为**显式划到安全边界之外**。

**pi 不是"忘了做权限"，是论证过之后决定不做。** 这个区别对下游至关重要——见 §9.5。

---

## 9.3 真实的债与缺口

按"会不会伤到人"排序，不按大小。

### 缺口 1：零防死循环（S5）

内层循环退出条件只有三条，**没有迭代上限、没有重复调用检测**（[§3.8](./03-agent-loop.md)）。而产品层连唯一的宿主刹车 `shouldStopAfterTurn` 都没接——grep 在整个 `packages/coding-agent/src/` 零命中。

模型反复调用同一个失败工具时，pi 会一直陪它转，直到用户 Ctrl-C 或撑爆 context window 触发压缩。**每一圈都是真金白银的 token。**

"留给宿主"能解释 `packages/agent`，解释不了 `packages/coding-agent`——那是 pi 自己的产品 CLI。**这是本次拆解发现的最大单点缺口。**

### 缺口 2：没有 provider 级录制回放

`packages/ai/src` 里没有任何请求/响应落盘（[§8.3](./08-observability.md)）。对一个要适配 **40 个 provider** 的项目，这是最痛的缺失——流式协议差异是最容易出 bug 也最难复现的地方，而唯一可用的复现材料是会话 JSONL（已截断、已归一化）。

### 缺口 3：两个巨型文件

`interactive-mode.ts` 6,575 行、`agent-session.ts` 3,516 行（[§1.3](./01-product-teardown.md)），超出常规上限 4–8 倍。

但要公平：它们是"胶水中心"，天然难拆，且每月 400–530 commit 的节奏说明没有在阻碍修改。**这是债，不是伤口。**

### 缺口 4：没有机器强制的架构守卫

grep `depcruise|dependency-cruiser|madge|eslint-plugin-boundaries` 全仓零命中（[§2.2](./02-architecture-and-guardrails.md)）。分层只靠 package.json 的 `dependencies` 字段和人。

10 包三层深的规模下这是合理取舍，但**这个保证方式不随规模扩展**——这正好解释了为什么下游厂商 fork 之后第一件事就是补这个（Step-Code 16 道闸门、step-cli 13 条 depcruise 规则），因为他们的包数都涨了。

### 缺口 5：v2 门面已公开导出但几乎全不可用

`AgentHarness` 40+ 方法几乎全是 `this.unavailable(...)` → reject `HarnessNotImplemented`（[§3.9](./03-agent-loop.md)）。消费 `@earendil-works/pi-agent-core` 的下游会在 IDE 里看到一大片**能编译、调用即抛**的 API。

CHANGELOG 明说这是有意的（"compile-complete scaffold … while durable execution is implemented"），但从 npm 消费者角度这是一个真实的踩坑面。

---

## 9.4 一条贯穿全书的线：v1/v2 四处并行

本次拆解共发现**四处** v1/v2 同源并行实现，模式完全一致——**v2 在 `packages/agent/harness/` 下写好、导出、测过，产品一个都不用**：

| # | v1（生效中） | v2（未接入） | 出处 |
| --- | --- | --- | --- |
| 1 | `coding-agent/core/compaction/` 1,012 行 | `agent/harness/compaction/` 848 行 | [§4.3](./04-context-engineering.md) |
| 2 | `coding-agent/core/tools/truncate.ts` | `agent/harness/.../truncate.ts`（+153 行） | [§4.4](./04-context-engineering.md) |
| 3 | v1 工具形态 | `AgentHarnessTool` + `ExecutionEnv` 依赖倒置 | [§5.8](./05-tools-permissions.md) |
| 4 | JSONL 会话树 v3 | sqlite-node 后端 + v4 JSONL，**两者都没人用** | [§8.4](./08-observability.md) |

**统一解释**：pi 正在做第二代运行时，策略是"先把完整目标 API 面编译通过并提升为默认导出，再逐个填实现"。v2 的技术核心是 `harness/reducer.ts` 的**单写者持久记录日志**，它定义了 12 类损坏并规定"**恢复时遇到协议不可能产生的状态，拒绝，不修复**"（`:16-21`）。

这条原则解释了 v2 的全部设计差异：压缩条目改用自洽的 `retainedTail` 而非指针 `firstKeptEntryId`，错误改用 `Result<_, CompactionError>` 而非抛异常，工具改走 `ExecutionEnv` 抽象——**一条记录必须能独立解释自己，恢复才能做到"拒绝而非修复"。**

**但 v2 目前丢了 v1 的两道摘要护栏**（`stopReason === "length"` 视为失败、摘要里出现 toolCall 直接报错，[§4.3](./04-context-engineering.md)）。第一条与"截断即整体失效"是同一原则的两个实例——工具调用那边确立了，v1 压缩遵守了，v2 重写时丢了。标为推断是因为 v2 尚未接入，有可能只是还没写到。

> **对下游的直接意义**：四个衍生仓库 vendor 的全部是 v1。他们 fork 的时间点上 v2 还是脚手架，所以他们的 diff 都建立在 `Agent` + `agentLoop` + JSONL 会话树之上。**未来如果 pi 切到 v2，它们的 diff 会集体失去上游基线。**

---

## 9.5 "机制而非策略"：一条一致的线，和它的三处例外

pi 的全部设计可以用一句话概括：**提供机制，策略归用户。**

一致的地方（六处，全部核实过）：

| 领域 | 给了什么机制 | 不给什么策略 |
| --- | --- | --- |
| 权限 | `beforeToolCall` 可 block | 任何内置判断（[§5.4](./05-tools-permissions.md)） |
| 沙箱 | 工具工厂化、ops 可注入 | 内置隔离（外包给 sandbox / gondolin 示例扩展） |
| 多 agent | `--mode json -p --no-session` | 内置 subagent（[§6.1](./06-multi-agent.md)） |
| 编排 | 三模式 + `{previous}` | workflow 引擎（编排写在 prompt 里） |
| 遥测 | span SPI 契约 | exporter / 后端（[§8.1](./08-observability.md)） |
| 工具发现 | bash | MCP（[§7.6](./07-extensibility.md)） |

**三处例外值得单独点名**，它们是这条线上的裂缝：

1. **`shouldStopAfterTurn` 是"机制"，但 pi 自己的产品 CLI 没接**（§9.3 缺口 1）。给了机制却自己不用策略，用户拿到的就是一个没有刹车的成品。
2. **`sensitive` 字段是"策略的声明"却无人执行**（S8）。它看起来像一个会被执行的策略，实际什么都不做——**这正是 `docs/security.md:35` 警告的"半吊子边界"那类陷阱，只是出现在遥测侧。**
3. **`--approve` / `--no-approve` 看起来像权限开关，实际只写 `projectTrustOverride`**（`args.ts:219-222`，help 文案 `:316` 是 "Trust project-local files for this run"）。机制是对的，命名会误导。

第 3 条对下游有直接意义：**如果某家把 `--approve` 改成了工具审批语义，那是一次语义劫持**——同名不同义是最容易误读的一类 diff。

---

## 9.6 给下游厂商的建议：在 pi 上做产品必须自己补的

pi 的诚实是它的价值，也是它的代价。**每一个把 pi 拿去做产品的厂商，都必须自己补齐这些策略层。** 按优先级：

### 必补（不补就不能交付给非专家用户）

1. **防死循环** —— 迭代上限 / 重复调用指纹，或至少把 `shouldStopAfterTurn` 接上。这是 pi 唯一一个"缺了会直接烧钱"的缺口。
2. **某种形式的执行确认** —— 不是要造一个 pi 论证过不做的"进程内沙箱"，而是至少让用户知道即将 `rm -rf`。**关键约束：若加进程内权限门却不同时加 OS 级隔离，正是 `docs/security.md:35` 警告的伪边界**——要么配容器/虚机，要么明确告诉用户这只是提醒不是边界。
3. **`!` 命令纳入同一条路径**（S2）—— 否则权限门是漏的。
4. **`getShellEnv` 凭据剥离**（S3）—— 或至少在文档里点破。

### 强烈建议

5. **provider 级录制回放** —— 适配多家 provider 时这是最高杠杆的一项投入。
6. **架构守卫** —— fork 后包数会涨，pi 的"靠 package.json"方式不扩展。
7. **`--ignore-scripts` 补进 `getNpmInstallArgs`**（S1）。
8. **`unhandledRejection` 处理器**（S7）—— 十行代码换终端不被搞坏。

### 可选（取决于产品定位）

9. 摘要降级到小模型 —— [§4.2](./04-context-engineering.md) 指出 pi 用当前模型压缩，示例扩展的 scout 却显式降到 haiku。**按模型分工的想法在示例里有，在核心里没用上**，这是最容易改也最值得改的一处。
10. 会话记录的完整性校验 / 严格 append-only —— 受监管场景必需（[§8.4](./08-observability.md)）。
11. `pi doctor`。

---

## 9.7 给 pi 自己的建议

四条，全部是小改动、高收益：

1. **把 `!` 不经过 `beforeToolCall` 写进 `docs/security.md`**（成本为零，消除唯一一处文档-实现落差）；
2. **`getNpmInstallArgs` 加 `--ignore-scripts`**（一行，消除唯一一处纪律不一致）；
3. **删掉 `first-time-setup.ts:74` 里那句 `/privacy`**，或把命令实现出来（失效承诺）；
4. **接上 `shouldStopAfterTurn`，或在 README 明说 pi 没有循环上限**（让"留给宿主"这个解释在产品 CLI 上也成立）。

另有两条中期的：给 telemetry 的 `sensitive` 字段配上运行时行为、或删掉它；给 v2 的压缩补回 v1 那两道护栏。

---

## 9.8 一句话结论

**pi 是一个把"不做什么"想得比"做什么"更清楚的项目。**

它的 agent 内核（794 行纯函数 L1 + 三层切分）、上下文工程（绝对预留、绝不切 toolResult、截断即失效、截断给续读路径）和供应链纪律都达到了可直接学习的水准；它的六个"No X"不是缺失而是写进 README 并给了论证的产品决策；`docs/security.md:35` 那段"半吊子沙箱比没有更危险"的论证是本次拆解里最值得引用的一段设计文字。

它的短板高度集中：**零防死循环**（唯一会直接伤到用户的一条）、**无 provider 录制回放**（对适配 40 家的项目是最痛的缺失）、**两处纪律不一致**（扩展包 postinstall、`!` 命令绕过）。全部可修，且都不在内核。

**对本书最重要的判断是这一条**：pi 把复杂度留在了正确的地方——**产品层 6 万行、内核 794 行**。这意味着三家中国厂商在它上面做的每一处改动，都能被干净地归因为"自己的判断力"而非"上游给的"。**接下来逐家拆解时，这就是那把尺子。**

---

## 附：全部下游探针汇总

前八章给出的探针合并去重，按拆解顺序排列。**每一条都有明确的 pi 基线答案，diff 出来的就是各家自己的决策。**

### A. 规模与定位（第 1 章）

- [ ] 代码规模对比，变大的部分在哪一层
- [ ] provider 列表裁剪幅度（pi: 40 家 / 16 个中国厂商条目）
- [ ] 四种模式保留了几种（RPC / SDK 最易被砍）
- [ ] 六个 "No X" 被实现了几个
- [ ] 两个巨型文件有没有被拆
- [ ] 有没有回流 upstream（pi 有 auto-close 政策，大概率没有）

### B. 架构与守卫（第 2 章）

- [ ] 有没有补 depcruise / 导入边界 lint（pi: 无）
- [ ] 供应链纪律保留了几条
- [ ] `check:browser-smoke` 那种产物断言闸门有没有保留

### C. Agent Loop（第 3 章）

- [ ] 有没有 `stopReason === "length"` 整批失败 → **判断 pi 基线新旧**
- [ ] `drain()` 是不是 destructive-immediate → 有没有加两阶段认领
- [ ] 中断是合成 assistant 消息还是回撤 transcript → 有没有加 un-send
- [ ] **有没有迭代上限或调用指纹** → 有没有补防死循环
- [ ] `shouldStopAfterTurn` 有没有被产品层接上
- [ ] 是 v1（`Agent` + `agentLoop`）还是已切 v2（`AgentHarness`）

### D. 上下文工程（第 4 章）

- [ ] 压缩触发是绝对预留还是比例
- [ ] `findCutPoint` 有没有保留"绝不切 toolResult"
- [ ] **摘要模型有没有换成小模型** → 最容易改也最值得改
- [ ] 有没有 `<read-files>` / `<modified-files>` 累积
- [ ] 有没有加 memory 子系统（pi 明确没有）

### E. 工具与权限（第 5 章）

- [ ] 有没有加真正的 permission gate，加在哪
- [ ] **`--approve` 的语义有没有被劫持**
- [ ] **有没有加"进程内沙箱"却不配 OS 级隔离**
- [ ] `!` 命令有没有纳入同一条权限路径
- [ ] `getShellEnv` 有没有凭据剥离
- [ ] write/edit 有没有加 cwd 边界或 `.git`/`.env` 保护
- [ ] bash 有没有默认超时
- [ ] 有没有 code mode（pi 没有）

### F. 多 Agent（第 6 章）

- [ ] subagent 有没有变成**内置工具**
- [ ] **spawn 子进程还是进程内复用 agentLoop** → 架构分水岭
- [ ] agent 定义有没有沿用 markdown + frontmatter
- [ ] 有没有引入真正的 workflow/DAG 引擎替代 prompt 编排
- [ ] chain 数据传递有没有从纯文本升级为结构化

### G. 扩展性（第 7 章）

- [ ] 扩展加载有没有加隔离（Worker / 子进程 / vm）
- [ ] `getNpmInstallArgs` 有没有补 `--ignore-scripts`
- [ ] 有没有加能力声明 / 权限清单
- [ ] **有没有接 MCP**（pi 明确没有，接了就是本家决策）
- [ ] `registerProvider` 四种粒度有没有被裁剪
- [ ] 内置工具的工厂化注入有没有保留

### H. 可观测性（第 8 章）

- [ ] **`packages/telemetry` 有没有被真正接线** → 最能区分"照抄"与"做过工程"
- [ ] `sensitive` 字段有没有变成运行时脱敏
- [ ] **`enableInstallTelemetry` 默认值有没有改，有没有新增上报端点** → 厂商最可能动手的地方
- [ ] 归因 header 有没有从遥测开关里拆出来
- [ ] 会话记录有没有加完整性校验 / 严格 append-only
- [ ] 有没有补 provider 级录制回放
- [ ] sqlite-node 后端有没有被启用（pi 自己没用）
- [ ] 有没有加 `pi doctor` / `unhandledRejection` 处理器
