# 3. Agent Loop

> 对照基准：[pi 第 3 章](../pi/03-agent-loop.md)。pi 那一章说：「`agent-loop.ts` 794 行里没有一处产品逻辑，所以下游厂商替换产品层时不必碰主循环。」本章检验这句话。

## 3.1 三层结构：原样

| 层 | pi | Step-Code | 差异 |
| --- | --- | --- | --- |
| L1 主循环 | `packages/agent/src/agent-loop.ts` 794 行 | `packages/agent-core/src/agent-loop.ts` 833 行 | +39 行，一处改动 |
| L2 有状态包装 | `agent.ts` 592 行 | `agent.ts` 592 行 | 只有 import 的包名不同 |
| L3 产品会话 | `agent-session.ts` 3,516 行 | `agent-session.ts` 3,653 行 | 请求期投影的接线等 |

【代码事实】`diff` 两份 `agent-loop.ts`，只有三个 hunk：import 的包名、`:212-225` 的重采样循环、`:292-317` 的判定函数。**pi 的那句话成立。**

双层循环、steering / follow-up 两个队列、`drain()` 的语义、中断时合成 assistant 消息、会话树——全部没动。

## 3.2 唯一的改动：工具调用标记泄漏

```
// packages/agent-core/src/agent-loop.ts
			// Stream assistant response
			let message = await streamAssistantResponse(currentContext, config, signal, emit, streamFunction);

			// Serving-side tool parsers can fail and leak the model's tool-call
			// markup into plain text: the turn then carries no executable call
			// and the loop would end even though the model meant to act.
			// Resample the identical context a bounded number of times; the
			// leaked attempt is dropped from the request context while its
			// message events above remain for observability.
			const leakRetryLimit = config.toolCallLeakRetries ?? DEFAULT_TOOL_CALL_LEAK_RETRIES;
			for (let attempt = 0; attempt < leakRetryLimit && isToolCallMarkupLeak(message); attempt++) {
				if (currentContext.messages[currentContext.messages.length - 1] !== message) break;
				currentContext.messages.pop();
				message = await streamAssistantResponse(currentContext, config, signal, emit, streamFunction);
			}
			newMessages.push(message);
```


判定在 `:293-317`：

```
// packages/agent-core/src/agent-loop.ts
const DEFAULT_TOOL_CALL_LEAK_RETRIES = 2;

const TOOL_CALL_MARKUP_RE = /<tool_call>|<function=/u;

/**
 * True when an assistant turn carries no executable tool call but its text
 * contains raw tool-call markup — the signature of a serving-side tool-parser
 * failure. Error and aborted turns keep their own retry/exit semantics.
 */
function isToolCallMarkupLeak(message: AssistantMessage): boolean {
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		return false;
	}
	let sawMarkup = false;
	for (const block of message.content) {
		if (block.type === "toolCall") {
			return false;
		}
		if (block.type === "text" && TOOL_CALL_MARKUP_RE.test(block.text)) {
			sawMarkup = true;
		}
	}
	return sawMarkup;
}

```


逐条读：

- **问题来自服务端**：注释说的是「Serving-side tool parsers can fail」——模型吐出的工具调用标记没被推理服务解析成结构化的 tool call，而是当成普通文本漏了出来。循环看到的是一条 `stopReason: "stop"`、没有工具调用、正文里带着 `<tool_call>` 的 assistant 消息，于是任务就这么「正常结束」了。
- **处理是重采样同一份上下文**：把泄漏的那条从请求上下文里弹掉，再发一次。默认 2 次（`:293`），`AgentLoopConfig.toolCallLeakRetries` 可调，设 0 关闭（`types.ts:155-162`）。
- **观测与上下文分开**：注释写明泄漏那次的消息事件「remain for observability」——事件已经发出去了，不回收；只是不进下一次请求。
- **有界**：用完次数就放行，不会因此死循环。

【推断】这是一处典型的「自家模型 + 自家推理服务」才会长出来的补丁：pi 面对 40 家 provider，不会为某一家的解析器失误改主循环；Step-Code 只有一家，这个失误就是它的日常。改在 L1 而不是 provider 适配器里，是因为只有循环层能「重发一次」。

## 3.3 没补的：防死循环

pi 第 3 章把「零防死循环」列为唯一会直接伤到用户的缺口。Step-Code 的状态：

- **迭代上限**：没有。
- **调用指纹 / 重复检测**：没有。
- 【代码事实】`step/telemetry-events.ts:510-517` 定义了一个 `tool_call_repeat` 事件，描述是「identical tool call past its safety limit」。全仓搜索这个事件名，**没有任何地方发出它**——只有契约，没有检测。
- `shouldStopAfterTurn`（`agent-loop.ts:265`）和 pi 一样存在，产品层同样没接。
- `stopReason === "length"` 的整批失败处理在（`:240-246`），与 pi 的 `:227-231` 相同——说明衍生自较新的 pi 快照。

代替它的是两层更外侧的东西，都不在循环里：

1. **goal 的终止约定**（`features/step-schedule.ts:286-305`）：续跑提示里写明只有「achieved and verified」才算完成、连续 3 轮无进展才算 blocked。这是用提示词约束模型自己停。
2. **Autopilot 的续跑上限**（`step/permissions.ts:101-103`）：模型报错后的自动续跑最多 3 次，退避 5s / 15s / 45s / 2m / 5m；同一个错误重复出现就放弃（`:715-729`，注释「A deterministic repeated failure is not helped by an unattended loop」）。

注意第 2 条防的是「错误 → 续跑 → 同样的错误」这个外层环，**不是**模型反复调用同一个工具的内层环。

## 3.4 v1 还是 v2

pi 同时有 v1（`Agent` + `agentLoop`）和重写中的 v2（`AgentHarness`）。Step-Code 的产品路径仍是 v1；`packages/coding-agent/src/server/create-harness.ts`（143 行）作为 pi 的遗留文件留着，但配套的 `server` 包已经删了。新增的请求期投影写在 `agent-core/src/harness/compaction/` 下，通过 v1 的 `agent-session.ts` 接线（[第 4 章](./04-context-engineering.md)）。

## 3.5 本章结论

1. 主循环只改了一处，39 行，解决的是自家推理服务的解析失误。pi「内核里没有产品逻辑」的设计在这里兑现。
2. 这一处改动本身是个好样本：有界、可关、不污染上下文、事件保留。
3. pi 最大的缺口——防死循环——没有补。遥测契约里有事件名，循环里没有检测。
4. 长任务的收敛靠 goal 的提示词约定和 Autopilot 的续跑上限，两者都在循环之外。
