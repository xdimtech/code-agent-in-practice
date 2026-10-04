# 4. 上下文工程

> 对照基准：[pi 第 4 章](../pi/04-context-engineering.md)。pi 的四条纪律——绝对预留、绝不切 toolResult、截断即失效、截断给续读路径——Step-Code 全部继承。本章写它在这之上动了哪三处。

## 4.1 system prompt：留了一道产品缝

pi 的 system prompt 是写死的产品文案。【代码事实】Step-Code 在 `packages/coding-agent/src/core/system-prompt.ts:10,29-42` 加了一个 `SystemPromptProduct` 类型，`:68-77` 用它取 `productName` / `role` / `introduction`。产品名与角色描述从内核里抽成了参数，具体文案放在 `step/system-prompt.ts`。

上下文文件的发现列表没动（`core/resource-loader.ts:71`，与 pi 的 `:72` 相同），`AGENTS.md` 的加载规则与 pi 一致；`/init`（`features/step.ts:293`）走的是「发一条用户消息让模型自己去读仓库再写文件」，注释写明文件写入仍归 pi 原生的写入与审批流管。

## 4.2 压缩：一个数字、一个上限、一份新格式、一层重试

压缩的触发方式仍是**绝对预留**，`findCutPoint` 还在原处（`agent-core/src/harness/compaction/compaction.ts:398`），「绝不切 toolResult」的规则没动，`<read-files>` / `<modified-files>` 的累积也在（`coding-agent/src/core/compaction/utils.ts:69-72`）。改动是四处：

```
// packages/agent-core/src/harness/compaction/compaction.ts
/**
 * Hard upper bound on summary output tokens, regardless of `reserveTokens`.
 * Chosen to sit under Anthropic's 32k-per-response cap while giving rich
 * long-horizon sessions enough room to emit a full 8-section handoff without
 * hitting the `stopReason:"length"` guard.
 */
export const SUMMARY_OUTPUT_TOKENS_CEILING = 32000;

/** Default compaction settings used by the harness. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	// Bumped from 16384: content-rich sessions were flirting with the
	// 0.8 * 16384 = 13107 maxTokens cap and getting rejected on length-stop.
	// 24576 gives ~19660-token headroom for the summary (or up to the ceiling
	// on models that expose a larger native output cap), while still leaving
	// ~keepRecentTokens for the retained tail.
	reserveTokens: 24576,
	keepRecentTokens: 20000,
};
```


| 改动 | pi | Step-Code | 理由（出自注释） |
| --- | --- | --- | --- |
| `reserveTokens` | 16384 | 24576 | 「content-rich sessions were flirting with the 0.8 × 16384 = 13107 maxTokens cap and getting rejected on length-stop」 |
| 摘要输出上限 | `0.8 × reserve` | `max(0.8 × reserve, min(model.maxTokens, 32000))` | `pickSummaryMaxTokens`，`:177-185`；大输出模型不被保守估计卡住 |
| 摘要格式 | 6 节 | 8 节 | 见下 |
| 摘要调用 | 单次 | `retryAssistantCall` 包一层 | `:111`；流中断这类瞬时错误重试 |

**摘要格式的差别是有判断的。** pi 的六节是 Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context。Step-Code 的八节（`compaction.ts:449-477`）是：

```text
User Goal · Current State（Done / In Progress / Blocked）· Files & Artifacts
Verification · Decisions & Constraints · Failed Approaches · Next Actions · References
```

多出来的三节——**Files & Artifacts、Verification、Failed Approaches**——都是长任务才需要的：改过哪些文件、哪些已经验证过、哪些路走不通。这和 README 里「long-horizon reliability」的定位是对得上的：摘要格式决定了压缩之后模型还记得什么，「试过但失败的方案」不写进摘要，压缩后就会再试一遍。

**摘要模型没换。** `agent-session.ts:2025-2036` 的 `_runDefaultCompaction` 传的仍是当前请求模型。pi 第 4 章说这是「最容易改也最值得改」的一处；Step-Code 只有一家 provider，没有动它。

`coding-agent/src/core/compaction/compaction.ts:147-154` 有同样的一份默认值——pi 的「两份 compaction」并行状态原样继承，于是同一个改动要写两遍。

## 4.3 请求期投影：新增，默认关闭

这是 Step-Code 在上下文工程上最大的一块新代码：`agent-core/src/harness/compaction/projection*.ts`，6 个文件 1,117 行。

```
// packages/agent-core/src/harness/compaction/projection.ts
/**
 * Lightweight request-time context projection.
 *
 * `projectContextForRequest` deterministically rewrites the LLM-facing message
 * array right before a model request to reclaim context window from redundant
 * content. It is a pure function: no I/O, no model calls, and no session
 * mutation. The session transcript and compaction entries are never touched --
 * only the projected copy handed to the provider changes.
 *
 * Structural guarantee: projection only rewrites message *content* in place.
 * It never removes, inserts, or reorders messages, never changes roles, and
 * never touches tool-call blocks, so assistant `toolCall` / `toolResult`
 * pairing is preserved by construction and re-verified afterwards.
 *
 * Invariants (any violation returns the original messages unchanged):
 *   1. The current user turn (last user message) is never modified.
 *   2. The active tool-call group (last assistant message and everything
 *      after it) is never modified.
 *   3. The most recent `keepRecentTokens` worth of tail messages are never
 *      modified.
```


它和压缩的区别：

| | 压缩（compaction） | 投影（projection） |
| --- | --- | --- |
| 改什么 | 会话记录：写入一条摘要条目 | 只改发给模型的那一份副本 |
| 要不要调模型 | 要 | 不要，纯函数 |
| 能不能撤销 | 不能（原文还在树上，但默认路径不再带） | 天然可撤销：关掉开关即恢复 |
| 何时触发 | 逼近上下文上限 | 每次请求前，过软阈值（窗口的 0.6）才动手，上限 0.75 |

五条规则（`projection-rules.ts`）：

| 规则 | 行 | 做什么 |
| --- | --- | --- |
| a | `:33` | 大的 toolResult / bash 输出：留头 800 字符、尾 800 字符、中间最多 20 条「显著行」 |
| b | `:70` | 重复的工具输出：留第一次和最近一次，中间的折叠 |
| c | `:118` | 历史 thinking 块：只留最近 2 个 |
| d | `:185` | 重复的分支 / 压缩摘要：只留最新一份 |
| e | `:225` | 大的代码 / patch / JSON：按代码的显著行裁 |

三条不变量写在文件头：当前用户轮不动、活跃的工具调用组不动、最近 `keepRecentTokens`（20000）不动；并且投影「never removes, inserts, or reorders messages」，所以 toolCall / toolResult 的配对在构造上保持，改完再验一遍，**任何一条不满足就整个退回原消息**。

接线在 `agent-session.ts:617-650`：包住 `agent.convertToLlm`，只有设置为 `"lightweight-v1"` 才生效；`core/settings-manager.ts:863-868` 的默认值是 `"off"`。整个函数包在 try 里，注释是「fail-safe: never throws」。每次真的改了东西（或不变量没过）都会发一个 `context_projection` 事件，带上改前改后的 token 数、每条规则裁了几处、不变量是否通过（`:639-649`）——**瘦身这件事本身是可观测的**。

【推断】默认关闭说明它还在试验期。但设计上值得抄：**把「省 token」做成一个可以随时关掉的纯函数**，而不是一次不可逆的摘要。与 pi 的「截断即失效」思路一脉相承——宁可不优化，也不破坏配对。

**代价**：投影改的是历史消息的内容，这会让 prompt cache 的前缀在被改写的那个位置之后全部失效。`keepRecentTokens` 保护的是尾部，缓存依赖的却是头部。六个 `projection*.ts` 里搜不到 `cache` 一词——这可能也是它默认关闭的原因之一【推断】。

## 4.4 流中断恢复：也是投影

`features/step-stream-recovery.ts`（40 行）：当上一条 assistant 消息是可重试错误、且错误信息匹配 `stream ended before|without` 时，在 `context` 事件里往请求**追加**一条隐藏的 `custom` 消息，内容是让模型「用更小的响应继续」——一次一个工具调用、生成内容控制在约 50 行。

关键是最后一行注释：

> Projection only: no synthetic user message or recovery note is persisted.

这条提示不进会话记录。pi 的重试是原样重发；Step-Code 的判断是「流被掐断多半是因为一次输出太大，原样重发还会断」，所以重发时换了要求。这同样只可能来自自家推理服务的运行经验。

## 4.5 没有加的

- **memory 子系统**：没有。pi 明确不做，Step-Code 也没补。
- **摘要用小模型**：没有。
- **`sensitive` 字段的运行时脱敏**：会话记录仍是原始 JSON；脱敏只发生在反馈包与开发日志出口（[第 8 章](./08-observability.md)）。

## 4.6 本章结论

1. pi 的四条纪律全部保留。
2. 压缩上的四处改动都指向同一件事：**长任务的摘要更长、更结构化、更不容易失败**。
3. 请求期投影是新东西：纯函数、三条不变量、不满足就退回、默认关闭。设计可抄，缓存代价要自己量。
4. 两处「投影」（上下文瘦身、流中断恢复）共用一个原则：**改请求，不改记录**。
