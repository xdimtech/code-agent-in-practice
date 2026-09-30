# 3. Agent Loop 深度拆解

> 本章是 pi 拆解的核心。`pi` 是 step-harness / Step-Code / minimax-code / kimi-code 的公共上游（三家厂商、四个仓库），**读懂本章才能判断那些 diff 里哪些是自己的判断力**。

## 3.1 三层结构

pi 把 agent 循环切成了三层，职责边界很干净：

| 层 | 文件 | 行数 | 性质 | 持有状态 |
| --- | --- | --- | --- | :---: |
| L1 主循环 | `packages/agent/src/agent-loop.ts` | 794 | 纯函数，全部行为由 `AgentLoopConfig` 回调注入 | ❌ |
| L2 有状态包装 | `packages/agent/src/agent.ts` | 592 | `Agent` 类，持有 transcript / 事件 / 两个队列 | ✅ |
| L3 产品会话 | `packages/coding-agent/src/core/agent-session.ts` | 3,516 | 装配压缩、扩展、会话树、设置 | ✅ |

L1 不知道会话树、不知道压缩、不知道扩展，只认回调。这个切分是 pi 最值钱的设计决定之一：**`agent-loop.ts` 794 行里没有一处产品逻辑**，所以下游厂商替换产品层时不必碰主循环。

对比：step-cli 的 `agent-loop.ts` 是 2,141 行，L1/L3 没有分开。

### L2 只是包装，不是引擎

`Agent` 类做四件事：把 `_state` 的 transcript 喂给 L1（`agent.ts:437-443` `createContextSnapshot()`，切片传入）、把 L1 的事件 reduce 回 `_state`（`:544-591` `processEvents`）、管两个消息队列、管 abort。

它**不**做：压缩、权限、工具注册、会话持久化。这些全在 L3。

---

## 3.2 双层循环

`runLoop` 的骨架（`agent-loop.ts:156-273`，去掉细节）：

```ts
let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];
while (true) {                                              // 外层：follow-up
  let hasMoreToolCalls = true;
  while (hasMoreToolCalls || pendingMessages.length > 0) {   // 内层：工具调用 + steering
    if (lastCompletedTurn) {
      const nextTurnSnapshot = await config.prepareNextTurn?.(lastCompletedTurn);
      // ...
      if (pendingMessages.length === 0) {
        pendingMessages = (await config.getSteeringMessages?.()) || [];
      }
      await emit({ type: "turn_start" });
    }
    // ... 流式请求 → 执行工具 → hasMoreToolCalls = !terminate
  }
  if (await config.shouldStopAfterTurn?.(lastCompletedTurn)) break;
  const followUps = await config.getFollowUpMessages?.();
  if (!followUps?.length) break;
  pendingMessages = followUps;
}
```

- **内层**跑到模型不再发工具调用为止。条件里带 `|| pendingMessages.length > 0`，所以即使模型本轮没有工具调用，只要队列里有 steering 消息就继续。
- **外层**只在内层彻底静止后才去问 follow-up 队列。

### 一个只有踩过坑才会写的细节

`:175` 那段注释：

> Preparation can be long-running (for example, compaction). Pick up steering queued while it ran. Only poll again if the earlier poll returned nothing; otherwise one-at-a-time mode would deliver two messages in this turn.

`prepareNextTurn` 里会跑压缩，压缩要调 LLM，可能几十秒。这期间用户很可能又补了话。所以循环在 prepare 之后要**重新拉一次队列**。但如果无条件重拉，`one-at-a-time` 模式下这一轮就会送进两条消息（prepare 前拉的 + prepare 后拉的），违反语义。于是加了 `if (pendingMessages.length === 0)` 这道条件。

这是本文件里最能说明"这不是套壳"的一处：它同时处理了"长耗时准备期间的新输入"和"队列模式语义不能被破坏"两个约束。

---

## 3.3 steering 与 follow-up：两个队列，两种语义

| | steering | follow-up |
| --- | --- | --- |
| 语义 | 当前 assistant turn 结束后**插入** | agent 本来要停了才执行 |
| 拉取点 | 内层循环每轮开头（`:175`） | 外层循环，内层静止后（`:265`） |
| 默认模式 | `one-at-a-time`（`agent.ts:231`） | `one-at-a-time`（`agent.ts:232`） |
| 产品层入口 | `session.steer()`（`agent-session.ts:1388`） | `session.followUp()`（`:1408`） |

`QueueMode` 只有两个值，实现在 `PendingMessageQueue.drain()`（`agent.ts:141-154`）：`"all"` 取空整个队列，`"one-at-a-time"` 只取队首一条。产品层把它暴露成用户设置（`agent-session.ts:1872-1873` 从 `settingsManager` 读，`:1881`/`:1890` 可运行时改）。

### `skipInitialSteeringPoll`：一个一次性标志位

`Agent.continue()`（`agent.ts:361-388`）在最后一条消息是 assistant 时，会**自己**先把 steering 队列 drain 出来，当作新 prompt 跑：

```ts
if (lastMessage.role === "assistant") {
  const queuedSteering = this.steeringQueue.drain();
  if (queuedSteering.length > 0) {
    await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
    return;
  }
  // ... 再试 followUpQueue，都没有才抛错
}
```

问题：L1 循环开头（`agent-loop.ts:156`）无条件拉一次 steering。如果不抑制，刚被 `continue()` 取出来当 prompt 的那条消息，会在循环里被**再取一次**（如果队列里还有第二条）——`one-at-a-time` 又一次被破坏。

所以 `createLoopConfig` 里用闭包做了个一次性开关（`agent.ts:446, 476-479`）：

```ts
getSteeringMessages: async () => {
  if (skipInitialSteeringPoll) {
    skipInitialSteeringPoll = false;   // 用完即焚
    return [];
  }
  return this.steeringQueue.drain();
},
```

**代码事实**：这是队列语义在两个入口（`prompt()` 与 `continue()`）之间对齐的补丁。**推断**：这种"一次性标志位 + 闭包"的形态通常是 bug 修复留下的痕迹，而非初始设计。

---

## 3.4 工具执行

### 截断消息的工具调用必须全部失败

`agent-loop.ts:226-235`：

```ts
const executedToolBatch =
  message.stopReason === "length"
    ? await failToolCallsFromTruncatedMessage(toolCalls, emit)
    : await executeToolCalls(currentContext, message, config, signal, emit);
```

`:372-378` 的注释解释了为什么：

> Streamed tool-call arguments are finalized with a best-effort JSON salvage parser, so a truncated message can yield tool calls whose arguments parse and validate but are silently incomplete. None of them are safe to execute.

这是**流式 JSON 抢救解析器的必然副作用**：为了能在流未结束时就展示工具调用，解析器会尽力补全 JSON。结果是一条因 max_tokens 被截断的消息，其工具参数可能**解析成功、schema 校验通过，但内容是残缺的**。典型危险案例：`write` 工具的 `content` 被截断一半却通过校验，直接执行就是静默截断用户文件。

pi 的处理是一刀切：整批失败，不做任何"部分可信"的判断。CHANGELOG 记录了这是修复而非初始设计（`packages/agent/CHANGELOG.md:136`，issue #6285，原症状是"等一个永远不会到的 tool result"）。

> 这条对四个衍生仓库都适用——**检查它们的 vendor 版本有没有这段**，是判断其 pi 基线新旧的一个快速探针。

### 批量 terminate 要求全体同意

`shouldTerminateToolBatch`（`:580-582`）：

```ts
finalizedCalls.length > 0 && finalizedCalls.every((f) => f.result.terminate === true)
```

一批并行工具里只要有一个没说 terminate，循环就继续。**推断**：这是保守的正确选择——terminate 意味着丢弃后续轮次，而并行批次里各工具彼此不知情，任一工具不打算结束就不该被别的工具代表。

### 并行执行，按调用顺序发事件

默认 `toolExecution: "parallel"`（`agent.ts:237`）。并行路径（`:487-552`）把每个调用包成闭包推进 `finalizedCalls`，`Promise.all` 之后**按调用顺序**而非完成顺序 emit 结果。

这点很重要：transcript 里的 tool result 顺序必须与 assistant 消息里的 tool call 顺序一致，否则 provider 侧的配对会错。完成顺序是不确定的，调用顺序是确定的。

### 唯一的执行前后接缝

L1 只开了两个钩子：

- `config.beforeToolCall`（`:617-645`）——可以 `block`，并可同时 `terminate`
- `config.afterToolCall`（`:722-749`）——可以改写 `content` / `details` / `usage` / `terminate` / `isError`

**产品层拿这两个接缝做了什么，是本章最需要点明的事实**（`agent-session.ts:487-541`）：

```ts
this.agent.beforeToolCall = async ({ toolCall, args }) => {
  const runner = this._extensionRunner;
  if (!runner.hasHandlers("tool_call")) {
    return undefined;                    // 没有扩展关心 → 直接放行
  }
  return await runner.emitToolCall({ /* ... */ });
};
```

**`beforeToolCall` 在 pi 的产品形态里只是扩展事件分发器，不含任何权限判断。** 没有扩展注册 `tool_call` handler，它就立刻返回 `undefined`，工具直接执行。这与 README 自称"无内置权限系统"完全一致（详见[第 5 章](./05-tools-permissions.md)）。

`afterToolCall`（`:509-540`）做两件事：分发 `tool_result` 扩展事件，然后归一化工具结果里的图片。注释 `:525` 说明了顺序的理由——扩展注入或替换的图片也要被归一化，所以归一化必须在扩展钩子之后。

钩子的装配方式是**构造后赋值**而非构造参数（`:488`、`:509`），注释 `:482-483` 给了原因：回调在执行时才读 `this._extensionRunner`，所以扩展热重载只需换掉 runner，不必重装钩子。

---

## 3.5 `prepareNextTurn`：每轮刷新点

L3 在这里挂了两件事（`agent-session.ts:562-583`）：

1. **阈值压缩**：`_compactBeforeNextAssistantResponse`（`:543-560`），估算 token 超阈值就先压缩再进下一轮。
2. **每轮重读运行时状态**：返回的 snapshot 里 `systemPrompt`、`tools`、`model`、`thinkingLevel` 全部从 `this.agent.state` 现取（`:577-581`）。

第 2 点的含义：**用户中途切模型、开关工具、改 thinking level，都在下一个 turn 边界生效**，不需要重启会话，也不会打断当前 turn。

装配用了链式保留（`:563-570`）：先把已有的 `prepareNextTurnWithContext`（或退化的 `prepareNextTurn`）存下来，自己的逻辑跑完再调它。这样扩展可以叠加自己的 prepare 逻辑而不被产品层覆盖。

---

## 3.6 错误即 transcript 条目

`Agent.handleRunFailure`（`agent.ts:511-527`）在 executor 抛异常时，**合成一条 assistant 消息**写进历史：

```ts
stopReason: aborted ? "aborted" : "error",
errorMessage: error instanceof Error ? error.message : String(error),
```

然后依次 emit `message_start` → `message_end` → `turn_end` → `agent_end`。

设计含义：**中断与错误不是循环外的异常路径，而是 transcript 里的一等公民**。会话可以在一条 `stopReason: "aborted"` 的 assistant 消息之后继续（`continue()` 的分支就是为此存在），压缩逻辑也能识别并跳过它（`agent-session.ts:2131`：`if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;`）。

### `agent_end` ≠ 空闲

`agent.ts:537-543` 的注释值得一读：

> `agent_end` only means no further loop events will be emitted. The run is considered idle later, after all awaited listeners for `agent_end` finish and `finishRun()` clears runtime-owned state.

监听器是被 `await` 的（`:588-590` 顺序 await），且它们收到当前 run 的 abort signal。所以 `agent_end` 之后仍有一段"监听器还在跑"的窗口，`waitForIdle()`（`:328-330`）等的是 `activeRun.promise`，它在 `finishRun()` 里才 resolve。

这是一个容易写错的地方：把 `agent_end` 当成"可以开下一轮了"会导致 `prompt()` 抛 "Agent is already processing"。

---

## 3.7 会话是一棵树，rewind 免费

L3 的会话模型（`packages/coding-agent/src/core/session-manager.ts`，1,716 行）是理解压缩与分支的前提。

每条 entry 都带 `{ type, id, parentId, timestamp }`（`:46-51`），追加进 JSONL 文件。`SessionManager` 持有一个 `leafId` 游标（`:867`），所有 append 都以当前 leaf 为 parent（`:1062` 等六处），然后前移 leaf（`:1048`）。

**LLM 上下文 = 从 leaf 走到 root 的那条路径**（`buildSessionPath` → `buildContextEntries` → `buildSessionContext`，`:336-468`，`:356` 是 `current = current.parentId ? index.get(current.parentId) : undefined` 的回溯）。

由此得到三个性质：

1. **rewind / fork 是 O(1) 且无损的**——只改 `leafId`，文件只追加不改写，历史分支全部保留。
2. **压缩不重写历史**。`CompactionEntry` 是树上一个新节点，存 `firstKeptEntryId` 指针（见[第 4 章](./04-context-engineering.md)），被压掉的消息物理上还在文件里。
3. **`branch_summary` 必须存在**。切到另一个分支时，被放弃分支上模型看过的东西会静默消失，所以要把它总结成一条带进新分支（`packages/agent/src/harness/compaction/branch-summarization.ts`）。

entry 类型共九种（`:144-155`）：message / thinking_level_change / model_change / compaction / branch_summary / custom / custom_message / label / session_info。**注意 thinking level 与 model 的变更也是 entry**——它们在树上有位置，所以"当时用的是哪个模型"可以从路径重建，而不是全局设置。

`CURRENT_SESSION_VERSION = 3`（`:30`），且有迁移函数。`:230` 的注释记录了历史：`Migrate v1 → v2: add id/parentId tree structure`——v1 是线性列表，迁移时把前一条的 id 当作 parentId（`:242`），线性历史变成一棵退化的树。**树是后加的。**

---

## 3.8 pi 没有的东西（重要）

这一节是下游厂商 diff 的对照基线。以下机制**在 pi 中完全不存在**，全仓 grep 零命中：

| 机制 | 验证方式 | 结论 |
| --- | --- | --- |
| 防死循环 | grep `maxIterations\|maxTurns\|maxSteps\|iterationLimit\|loopGuard\|maxToolCalls\|fingerprint\|repeatedCall\|duplicateCall`，排除 test | **无** |
| steering 两阶段认领 | grep `onSteered\|claimSteer\|steeringClaim` | **无** |
| un-send / transcript 回撤 | grep `unsend\|un-send\|revertTranscript\|rollbackTurn\|discardTurn` | **无** |

### 防死循环：完全委托给宿主

内层循环的退出条件只有三条（`agent-loop.ts`）：

- `:225` 模型本轮没有工具调用 → `hasMoreToolCalls = false`
- `:235` 整批工具都说 `terminate` → `hasMoreToolCalls = !executedToolBatch.terminate`
- `:252` 宿主的 `config.shouldStopAfterTurn?.()` 返回 true

**没有迭代上限，没有重复调用检测。** 而且产品层也没补：grep `shouldStopAfterTurn` 在整个 `packages/coding-agent/src/` 里零命中（排除 test）——**`pi` 这个 CLI 跑起来时，那个唯一的宿主级刹车根本没接**。

一个模型如果反复调用同一个失败的工具，pi 会一直陪它转，直到用户 Ctrl-C 或 context window 撑爆触发压缩。

**推断**：这与 pi 的整体取向一致——它把自己定位成底层 harness，把策略判断留给宿主。但 `packages/coding-agent` 是 pi 自己的产品 CLI，它不接这个刹车不好用"留给宿主"解释。这是一个真实的缺口。

### 对下游归因的意义

step-cli 拆解中记为阶跃自研的三项机制，现已确认**均非 pi 上游设计**：

| 机制 | step-cli 位置 | pi 是否有 |
| --- | --- | :---: |
| turn steering 两阶段认领（`drain()` 只暂借，写进 transcript 后回调 `onSteered` 才算认领） | `agent-loop.ts:869-908` | ❌ |
| un-send 语义（本 turn 零持久化进展则整体回撤 transcript） | `agent-loop.ts:821-843` | ❌ |
| 重复调用指纹带 workspace mutation revision | `agent-loop.ts:2078-2086` | ❌ |

pi 在这三处的对应实现分别是：destructive-immediate 的 `drain()`（`agent.ts:141-154`）、把中断合成为一条 `stopReason: "aborted"` 的 assistant 消息（`agent.ts:511-527`）、以及什么都没有。

**这三项是阶跃在 pi 基座上真正加的东西**，且都指向同一类问题：pi 的中断语义偏"记录事实"，阶跃改成了"保护用户意图"。

---

## 3.9 v1 在服役，v2 在重写

`packages/agent/src/harness/` 这个目录容易被误读成"coding agent 用的 harness"。**它不是。它是 pi 第二代 agent 运行时，尚未接入产品。**

### 证据

`AgentHarness` 类（`harness/agent-harness.ts`，508 行）声明了 40+ 方法的门面——含 `navigateTree`、`nextRun`、`cancelQueued`、`recordUsage`、`runWhenIdle`、`peekAction`/`executeAction`、`watch(): Promise<WatchHandle<LaneSnapshot>>` 等 v1 完全没有的能力（`:273-302`）。但实现几乎全是：

```
:366  prompt              → this.unavailable("prompt")
:369  skill               → this.unavailable("skill")
:375  compact             → this.unavailable("compact")
:378  navigateTree        → this.unavailable("navigateTree")
:381  resume              → this.unavailable("resume")
:384  abort               → this.unavailable("abort")
:389  steer               → this.unavailable("steer")
:394  followUp            → this.unavailable("followUp")
...
```

`unavailable()`（`:355-357`）reject 一个 `HarnessNotImplemented`。

引用方只有两处：`packages/agent/src/index.ts:46`（公开导出）和 `packages/agent/test/harness/agent-harness-scaffold.test.ts`（**文件名自带 scaffold**）。

产品侧零接入：在 `packages/coding-agent/src/` 里 grep `SessionRepo|LaneRecord|RecordLog|harness/session` 零命中。

### 这是有意为之，不是烂尾

`packages/agent/CHANGELOG.md` 把意图写得很清楚：

- `:49` — "Added a **compile-complete** `AgentHarness` v2 scaffold; unfinished operation paths reject with `HarnessNotImplemented` **while durable execution is implemented**."
- `:41` — "**Promoted** the v2 session and `AgentHarness` API **from the experimental entrypoint to the default package export** and removed the experimental subpaths."
- `:40` — "Replaced the legacy harness session model with the **v4 lane-based** `Session`, `SessionStorage`, and `SessionRepo` APIs, including **durable operation records**, global facts, shared sequence numbers, and tree-scoped lane views."

所以：他们先把完整的目标 API 面**编译通过**并提升为默认导出，再逐个填实现。会话模型在 harness 内部已经迭代到 v4。

### v2 的技术核心：单写者持久记录日志

`harness/reducer.ts`（667 行）是这套东西的关键。它在 lane 的持久记录切片上做恢复，并定义了 12 类损坏（`:22-33`）：

```
multiple_open_operations / unknown_operation / record_after_finish /
non_consecutive_attempt / invalid_compaction_reason / queue_after_abort /
invalid_queue_cancellation / inconsistent_step / tool_call_mismatch /
duplicate_tool_invocation / provisioned_entry_mismatch / invalid_deferred_handle
```

`:16-21` 的注释定义了这些的性质，是本仓库里态度最硬的一段：

> These indicate states the single-writer record protocol cannot produce, not ordinary operation failures or incomplete-but-recoverable intent/result prefixes. **Restore must reject such states rather than repair or continue it.**

即：**恢复时遇到协议不可能产生的状态，拒绝，不修复。** 配合 `RecordLogCorruption` 带机器可读的 `reason`。这是把"崩溃后恢复"当作形式化问题处理的写法——v1 的 JSONL 树没有这一层，坏行只能靠 `parseSessionEntries` 尽力解析。

### 对拆解的直接影响

1. **`harness/compaction/compaction.ts`（848 行）与 `coding-agent/src/core/compaction/compaction.ts`（1,012 行）不是重复代码，是 v2 与 v1。** 生效的是后者（`agent-session.ts:65-66` 从 `./compaction/index.ts` 导入）。两者的差异（`retainedTail` 自洽条目 vs `firstKeptEntryId` 指针、`Result<_, CompactionError>` vs 抛异常、`Models` 抽象 vs 手传 apiKey）全部是 v2 设计选择，且与"条目必须自洽以支持持久记录恢复"一致。详见[第 4 章 §4.3](./04-context-engineering.md)。
2. **四个衍生仓库 vendor 的都是 v1。** 他们 fork 的时间点上 v2 还是脚手架，所以他们的 diff 都建立在 `Agent` + `agentLoop` + JSONL 会话树之上。
3. **`packages/agent` 有独立的 harness 测试配置**（`vitest.harness.config.ts`），只跑 `test/harness/**` 并单独统计覆盖率，覆盖范围是 `src/harness/**` + `src/agent.ts` + `src/agent-loop.ts`。v2 有自己的质量门。

---

## 3.10 本章结论

**pi 的 agent loop 是一个刻意做薄的底座。**

值得学的：L1/L2/L3 的三层切分；截断消息整批失败；prepare 后重拉 steering 的条件判断；并行执行按调用顺序 emit；错误即 transcript 条目；会话树让 rewind 免费。

需要警惕的：**没有任何防死循环机制，且产品层连唯一的宿主钩子 `shouldStopAfterTurn` 都没接**；`skipInitialSteeringPoll` 这类一次性标志位说明队列语义在两个入口间是补出来的一致性，不是设计出来的；v2 门面已公开导出但几乎全不可用，消费 `@earendil-works/pi-agent-core` 的下游会在 IDE 里看到一大片能编译、调用即抛的 API。

给下游拆解的探针清单：

- 有没有 `stopReason === "length"` 的整批失败 → 判断 pi 基线新旧
- `drain()` 是不是 destructive-immediate → 判断有没有加两阶段认领
- 中断是合成 assistant 消息还是回撤 transcript → 判断有没有加 un-send
- 有没有迭代上限或调用指纹 → 判断有没有补防死循环
- `shouldStopAfterTurn` 有没有被产品层接上 → 判断有没有注意到这个缺口
