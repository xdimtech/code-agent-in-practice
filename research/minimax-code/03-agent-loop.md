# 3. Agent Loop

> 对照基准：[pi 第 3 章](../pi/03-agent-loop.md)。pi 的循环是「L1 函数 → L2 `Agent` → L3 `AgentSession`」三层；minimax-code 留下前两层，把第三层换成自己的 turn-system，再往 L1 里开了四个口子。

## 3.1 三层结构：谁的代码

| 层 | pi v0.79.1 | minimax-code | 状态 |
| --- | --- | --- | --- |
| L1 循环函数 | `agent/src/agent-loop.ts`（742 行） | vendor 同名文件（877 行） | 在用，改了 +153 / −18 |
| L2 `Agent` 类 | `agent/src/agent.ts`（557 行） | vendor 同名文件（579 行） | 在用，改了 +26 / −4 |
| L3 产品会话 | `coding-agent/src/core/agent-session.ts`（3,135 行）+ `session-manager.ts`（1,567 行） | 不用 | 换成 `local-runtime-v2/src/service/turn-system`（41,359 行）和 `session-system`（33,463 行） |
| 组装 | 由 `AgentSession` 自己做 | `agent-core/src/pi-turn-runner/`（5,893 行） | 自有 |

【代码事实】每一轮新建一个 pi `Agent`：`agent-core/src/pi-turn-runner/agent.ts:33-91` 的 `newAgent(turn)` 把这一轮的系统提示、模型、思考档位、工具、初始消息塞进 `initialState`，`toolExecution: 'parallel'`，再按需挂上 `shouldStopAfterSteering`、`shouldStopAfterTurn`、`onPayload`、`onResponse`。`runAgent()`（`:93-137`）调 `agent.prompt()` 或 `agent.continue()`，等空闲，再调一次宿主的 `convergeAtIdle()`，再等空闲。

【推断】pi 的 `Agent` 在这里活不过一轮——它从一个长期对象变成了「执行一轮的工具」。历史、队列、持久化都在外面，`Agent` 只看到这一轮开始时宿主给它的消息数组。

`convertToLlm`（`agent.ts:42-76`）也换掉了：先跑 `projectAgentMessagesForModel()` 删掉孤立的工具结果、处理读不出尺寸的图片，再交给 provider。删了几条会打一条 warn 日志（`:44-53`）。

## 3.2 往 L1 里开的四个口子

【代码事实】`agent` 包与 v0.79.1 的完整差异就这几处：

| 接缝 | 位置 | 做什么 | 谁在用 |
| --- | --- | --- | --- |
| `shouldStopAfterSteering` | `agent-loop.ts:254-257`；`types.ts:212-218` | 拉完 steering 消息、发下一次请求之前问一次宿主：要不要就此停下 | 插件 `UserPromptSubmit` hook 判「stop」时置真（`local-runtime-v2/.../execution/user-input-control.ts:73-80,113`） |
| `terminateAgent` | `types.ts:59,84`；`agent-loop.ts:452-474`（串行）、`:513-530`（并行）、`:663-667` | `beforeToolCall` / `afterToolCall` 可以要求停掉整个 run | 宿主的工具策略闸门 |
| `onToolExecutionStart` | `types.ts:275`；`agent-loop.ts:762-767` | 工具**通过校验、被放行之后**、真正开始执行之前回调一次 | 计时、遥测 |
| `steerBatch` | `agent.ts:283-286`；队列从 `AgentMessage[]` 改成 `AgentMessage[][]` | 一批 steering 消息作为一个原子组，在同一个边界一起消费 | 本地用户连续提交的一批消息（`MINIMAX_CHANGES.md:328-332`） |

另外 `ThinkingLevel` 多了一档 `"max"`（`types.ts:297`）。

### 停下来时，历史仍然成对

`terminateAgent` 和 abort 两条路径共享一段收尾逻辑。【代码事实】`agent-loop.ts:452-474`：当前工具要求停或者信号已中止，剩下还没跑的每一个 tool call 都会被补一条事件和一条结果：

```ts
for (const skippedToolCall of toolCalls.slice(toolIndex + 1)) {
	await emit({ type: "tool_execution_start", toolCallId: skippedToolCall.id, ... });
	const skipped = {
		toolCall: skippedToolCall,
		result: createErrorToolResult(
			finalized.terminateAgent === true
				? "Tool execution skipped because the agent was stopped by a hook"
				: "Tool execution skipped because the operation was aborted",
		),
		isError: true,
	} satisfies FinalizedToolCallOutcome;
	...
	messages.push(skippedMessage);
}
```

并行模式下还要处理「已经准备好、还没开跑」的调用：`skipPreparedParallelToolCalls()` 把它们原地换成错误结果，`appendSkippedParallelToolCalls()` 再给后面的补上（`agent-loop.ts:623-660`）。为此 v0.79.1 里「一个返回 Promise 的闭包」被换成了可判别的 `{ kind: "prepared-entry", preparation }`（`:613-621`），这样收尾时才知道哪些还没执行。

【推断】这个设计在乎的是**持久历史本身就成对**：每个 `tool_use` 都有一个 `tool_result`，哪怕结果只是一句「没跑」，而且宿主和 UI 都收到了对应的事件。pi v0.79.1 在 abort 时直接 `break`（`agent-loop.ts:440-442`），剩下的 tool call 在历史里没有结果，要等下一次发请求时由 `ai/src/providers/transform-messages.ts:155-168` 临时补一条「No result provided」——补在请求视图里，不进历史，也没有事件。

## 3.3 组装层：一轮里发生什么

【代码事实】`agent-runtime/src/types.ts:162-172` 定义宿主这一侧的 9 个 hook：

```text
turn_start → before_llm_call → on_llm_call_prepared → after_llm_call
          → before_tool_call → after_tool_call → on_step_end → … → turn_end
on_history_changed（任意时刻）
```

`pi-turn-runner/hooks.ts:23-60` 的 `PiBeforeLlmCallHookInput` 说明了这一层持有什么：两份消息（`messages` 是本次请求视图，`canonicalMessages` 是持久历史，`:29-32`）、`maxSerializedInputBytes`（「Host-owned serialized request cap used by final context admission」，`:37-38`）、自动压缩用的辅助 `streamFn`（`:40-41`）、要求 hook 计 token 前先套一遍 `payloadTransform` 的注释（`:42-48`）。

【推断】「请求视图」和「持久历史」分开，是这一层最重要的决定：hook 可以只为这一次请求改消息（裁剪、注入提醒），不碰写进会话的那一份。pi 的 `transformContext` 也是只改请求视图，但它没有第二份「规范历史」可以被 hook 显式替换。

组装层各文件的分量：

| 文件 | 行 | 管什么 |
| --- | ---: | --- |
| `metrics.ts` | 1,230 | 每次调用的耗时、吞吐、失败归类 |
| `llm-retry.ts` | 963 | 重试策略 |
| `llm.ts` | 614 | 模型与 provider 选择 |
| `events.ts` | 425 | pi 事件 → 宿主事件 |
| `turn.ts` | 393 | 一轮的状态 |
| `outbound-message-normalizer.ts` | 296 | 发出前的历史投影 |
| `hooks.ts` | 268 | hook 输入输出类型 |

### 重试

【代码事实】`llm-retry.ts:43-48`：

```ts
export const DEFAULT_LLM_RETRY_POLICY: Readonly<LLMRetryPolicy> = {
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxRetryElapsedMs: 120_000,
};
```

除了次数和单次退避上限，还有一个**总耗时**上限：两分钟内重试不完就放弃。pi v0.79.1 的 `AgentSession` 重试默认 3 次、基础延迟 2 秒指数退避（`coding-agent/src/core/settings-manager.ts:28-29,796-800`），没有总耗时上限。

## 3.4 防跑飞：runaway-guard

pi 没有任何防死循环（[pi 第 9 章 S5](../pi/09-assessment-risks-recommendations.md)）。minimax 写了一个模块，但它的设计目标不是「拦住」，而是「提醒一次」。

### 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 领域 | `agent-modules/runaway-guard/src/`（9 个文件 / 1,438 行） | 纯检测与提醒文案；`guard.ts:19-22`「No Agent, lifecycle registration, host IO, Memory writes, or persistence belongs to this module.」 |
| 适配 | `agent-extension/src/runaway-guard.ts` | 挂到 `before_tool_call` / `on_step_end` / `turn_end` |
| 宿主 | `local-runtime-v2/src/service/turn-system/runaway-guard/` | 读本地与远端配置、工具策略、遥测 |

### 检测什么

【代码事实】`signals.ts:19-70` 的 `observeStep()` 每一步更新五组「连击」：

| 信号 | 含义 | 能触发提醒？ |
| --- | --- | --- |
| `exact_action_repeat` | 参数完全相同的工具调用连续出现 | ✅ |
| `polling_repeat` | `task_query` / `task_output` 读同一个任务、状态和游标都没变 | ✅ |
| `exact_result_repeat` | 结果完全相同 | ❌ 只观测 |
| `same_error_family` | 同一类错误连续出现（超时、限流、网络、鉴权、权限、找不到、参数错、进程退出；`step-view.ts:400-409`） | ✅ |
| `unchanged_progress_repeat` | 宿主报告的「已验证进度」对同一目标没有变化 | ✅ |
| ABAB | 两个动作交替出现 | ❌ 只观测 |

指纹不存原文：`fingerprint.ts:21-23` 用 `createHmac('sha256', secret)`，`secret` 是每一轮新生成的 32 字节随机数（`state.ts:101`）。【推断】指纹只在一轮内有意义，也没法从遥测里反推参数。

宿主给出工具策略（`tool-policy.ts:7-32`）：`bash` / `sh` / `shell` / `zsh` / `grep` 归为 `detect`，且「搜索没找到」算预期结果，不算错误；`task_query` / `task_output` 归为 `polling`。

### 怎么提醒

【代码事实】`reminder.ts:10-15` 的优先级：无进展 > 同类错误 > 重复动作 > 轮询。`takePreferredReminder()`（`:17-44`）**一轮最多提醒一次**，而且在调用 `steer` **之前**就占位：

```ts
if (!content || state.reminderAttempted) return undefined;
// Reserve before the adapter calls steer: a failed attempt must not retry.
state.reminderAttempted = true;
```

阈值默认 3，最小也只能配到 3（`guard.ts:28-31`、`agent-extension/src/runaway-guard.ts:68-70`）；观测从第 2 次开始记（`signals.ts:121,174`）。

文案每一条都以同一句话收尾（`reminder.ts:56-58`）：

> This is a temporary runtime reminder for the current Turn only, not a user preference or a durable rule; do not save this reminder or generalize it into Memory, Skills, or other persistent instruction files for future Turns or sessions.

【推断】这句话针对的是一个只有「有记忆的 agent」才会有的问题：模型把一次运行时纠偏当成用户偏好写进记忆，以后每次都按它来。

### 失败时放行

【代码事实】适配器的 `on_step_end` 处理整个包在 `try { … } catch { // Detection, host facts, steering and observers must all fail open. }` 里（`agent-extension/src/runaway-guard.ts:101-128`）；头注释写「At most one Steer attempt per Turn; never rejects a tool or aborts a Turn.」（`:67`）。另有一个只观测不提醒的 shadow 版本（`:61-65`）。

### 开关

【代码事实】`config/src/runaway-guard-config.ts:10-22`：

```ts
/** Missing/invalid remote values mean no override, not enabled=true. */
export function parseRunawayGuardOverride(raw: unknown): RunawayGuardOverride { ... }

export function resolveRunawayGuardConfig(local: unknown, remote?: unknown): RunawayGuardSettings {
  return {
    enabled:
      parseRunawayGuardOverride(remote).enabled ?? parseRunawayGuardOverride(local).enabled ?? true,
  };
}
```

远端配置优先于本地，两边都没有就默认开。远端的值坏了不算「开」，算「没覆盖」。宿主还规定 goal 的验收轮不提醒（`turn-system/runaway-guard/extension.ts:21`：`shouldRemind: (ctx) => ctx.turnIntent?.kind !== 'goal-verifier'`）。

## 3.5 什么时候停

| 停止条件 | 谁产生 | 位置 |
| --- | --- | --- |
| 模型不再调工具 | pi L1 | `agent-loop.ts` 主循环 |
| 用户中止 | 宿主 → `AbortSignal` | `pi-turn-runner/agent.ts:111-113` |
| hook 要求停（`terminateAgent`） | 工具策略闸门 | `agent-loop.ts:452,513,665` |
| 插件 `UserPromptSubmit` 判停 | `shouldStopAfterSteering` | `user-input-control.ts:73-80` |
| 插件 `Stop` hook 要求继续 | 最多续 8 次 | `user-input-control.ts:25,297-300` |
| headless `--max-steps` | `TuiRunCoordinator` | `tui/src/application/run-coordinator.ts:231-237`；退出码 7（`tui/src/headless/exit-policy.ts:4-14`） |
| headless 超时 | 同上 | 退出码 6 |
| 交互模式的步数上限 | **没有** | `local-runtime-v2/src`、`agent-core/src` 里找不到任何步数上限 |

【代码事实】`--max-steps` 的判定在「下一条完成的助手消息到达时」做：`completedAssistantSteps >= maxSteps` 先判，再 `+= 1`（`run-coordinator.ts:232-239`）。测试 `tui/test/unit/run-coordinator.test.ts:225-237` 用 `maxSteps: 1`、两条助手消息，期望结果是 `limit_exceeded` 且答案是 `first`。【推断】这意味着第 N+1 次模型调用会发生，只是它的结果被丢弃。

### 截断的 tool call 没有拦

【代码事实】pi 后来在 L1 里加了一道：`pi/packages/agent/src/agent-loop.ts:226-232`，`stopReason === "length"` 时把这条消息里的所有 tool call 判失败（`failToolCallsFromTruncatedMessage`，`:379`），不去执行被截断的参数。vendor 的 v0.79.1 循环里没有这道判断，`agent-core` 和 `local-runtime-v2` 里也没有补；`'length'` 只出现在压缩的契约里。

## 3.6 本章结论

- pi 的 `Agent` 被降成「每轮新建、执行一轮」的工具；会话、历史、队列全在外面。
- 四个接缝（`shouldStopAfterSteering`、`terminateAgent`、`onToolExecutionStart`、`steerBatch`）都在给宿主更细的控制权；停下时给每个未执行的 tool call 补一个错误结果，保证历史成对。
- runaway-guard：五类信号、HMAC 指纹、一轮最多提醒一次、先占位再 steer、全部 fail-open、远端可关。它**不拦**任何东西。
- 交互模式没有步数上限；headless 有 `--max-steps`。
- 截断 tool call 的保护是 pi 之后才加的，minimax 的 vendor 版本没有，也没自己补。
