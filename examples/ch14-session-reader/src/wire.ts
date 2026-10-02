// 会话里写的，和模型实际收到的，中间隔着两道转换：
// 1. core/messages.ts:148-195 的 convertToLlm：! 命令、压缩摘要、分支摘要都变成 user 消息；
// 2. packages/ai/src/api/transform-messages.ts:64-223：出错或中断的助手消息整条丢掉（:189-197），
//    没有结果的工具调用补一条假的错误结果（:158-180、:219-220），模型不支持图片时换成占位文本（:12-36）。
// 之后各 provider 还要再序列化一次，那一步因 API 而异，本例不模拟；要看最终形态只能靠录制（recorder.ts）。

import { isAssistant, isBashExecution, isToolResult, isUser, type ContentPart, type Entry, type ToolCallPart } from "./types.ts";

export type WireRole = "user" | "assistant" | "toolResult";

export interface WireMessage {
  readonly role: WireRole;
  /** 来自哪个条目；补出来的假结果没有出处 */
  readonly from: string | null;
  readonly text: string;
  /** 助手消息里的工具调用，参数原样 */
  readonly calls?: readonly ToolCallPart[];
  /** 和会话文件里写的不一样的地方 */
  readonly note?: string;
}

export interface Dropped {
  readonly from: string;
  readonly reason: string;
}

export interface WireOptions {
  /** 当前模型支不支持图片（pi 看 model.input.includes("image")） */
  readonly vision: boolean;
}

export const COMPACTION_PREFIX = "The conversation history before this point was compacted into the following summary:";
export const BRANCH_PREFIX = "The following is a summary of a branch that this conversation came back from:";
export const NO_RESULT = "No result provided";
export const IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";

type Step = { readonly kind: "send"; readonly message: WireMessage; readonly calls: readonly ToolCallPart[] } | { readonly kind: "drop"; readonly dropped: Dropped };

const send = (role: WireRole, from: string, text: string, note?: string, calls: readonly ToolCallPart[] = []): Step => ({
  kind: "send",
  message: { role, from, text, ...(calls.length ? { calls } : {}), ...(note ? { note } : {}) },
  calls,
});
const drop = (from: string, reason: string): Step => ({ kind: "drop", dropped: { from, reason } });

function partsText(content: string | readonly ContentPart[], vision: boolean): { text: string; swapped: number } {
  if (typeof content === "string") return { text: content, swapped: 0 };
  const images = content.filter((c) => c.type === "image").length;
  const text = content
    .flatMap((c) => (c.type === "text" ? [c.text] : c.type === "image" ? [vision ? "[图片]" : IMAGE_PLACEHOLDER] : []))
    .join(" ");
  return { text, swapped: vision ? 0 : images };
}

function bashText(command: string, output: string, exitCode: number | undefined): string {
  const body = output ? `\`\`\`\n${output}\n\`\`\`` : "(no output)";
  return `Ran \`${command}\`\n${body}${exitCode ? `\n\nCommand exited with code ${exitCode}` : ""}`;
}

function messageStep(e: Entry, options: WireOptions): Step {
  const m = e.message;
  if (isUser(m)) {
    const { text, swapped } = partsText(m.content, options.vision);
    return send("user", e.id, text, swapped ? `${swapped} 张图片换成了占位文本` : undefined);
  }
  if (isAssistant(m)) {
    if (m.stopReason === "error" || m.stopReason === "aborted") return drop(e.id, `助手消息 stopReason=${m.stopReason}，整条不发`);
    const calls = m.content.filter((c): c is ToolCallPart => c.type === "toolCall");
    return send("assistant", e.id, partsText(m.content, true).text, undefined, calls);
  }
  if (isToolResult(m)) {
    const { text, swapped } = partsText(m.content, options.vision);
    return send("toolResult", e.id, text, swapped ? `${swapped} 张图片换成了占位文本` : undefined);
  }
  if (isBashExecution(m)) {
    if (m.excludeFromContext === true) return drop(e.id, "!! 命令，不进上下文");
    return send("user", e.id, bashText(m.command, m.output, m.exitCode), "! 命令变成一条 user 消息");
  }
  return drop(e.id, `角色 ${m?.role ?? "?"} 不发给模型`);
}

function entryStep(e: Entry, options: WireOptions): Step {
  if (e.type === "message") return messageStep(e, options);
  if (e.type === "compaction") return send("user", e.id, `${COMPACTION_PREFIX}\n${e.summary ?? ""}`, "压缩摘要变成一条 user 消息");
  if (e.type === "branch_summary" && e.summary) return send("user", e.id, `${BRANCH_PREFIX}\n${e.summary}`, "分支摘要变成一条 user 消息");
  if (e.type === "custom_message") return send("user", e.id, typeof e.content === "string" ? e.content : "[扩展消息]", "扩展插入的消息变成 user 消息");
  return drop(e.id, `${e.type} 条目只是记录，不发给模型`);
}

const synthetic = (call: ToolCallPart): WireMessage => ({
  role: "toolResult",
  from: null,
  text: NO_RESULT,
  note: `补给 ${call.name}(${call.id}) 的假结果，isError=true，会话文件里没有这一条`,
});

interface Acc {
  readonly messages: readonly WireMessage[];
  readonly dropped: readonly Dropped[];
  readonly pending: readonly ToolCallPart[];
  readonly answered: ReadonlySet<string>;
}

const flush = (acc: Acc): Acc => ({
  ...acc,
  messages: [...acc.messages, ...acc.pending.filter((c) => !acc.answered.has(c.id)).map(synthetic)],
  pending: [],
  answered: new Set(),
});

function apply(acc: Acc, step: Step): Acc {
  if (step.kind === "drop") return { ...acc, dropped: [...acc.dropped, step.dropped] };
  const { message, calls } = step;
  if (message.role === "toolResult") return { ...acc, messages: [...acc.messages, message] };
  // user 或 assistant 出现时，前一个助手留下的没结果的调用要先补齐
  const flushed = flush(acc);
  return { ...flushed, messages: [...flushed.messages, message], pending: message.role === "assistant" ? calls : [] };
}

/** 把上下文条目（tree.context）投影成模型收到的消息序列；不改入参 */
export function toWire(context: readonly Entry[], options: WireOptions): { messages: WireMessage[]; dropped: Dropped[] } {
  const start: Acc = { messages: [], dropped: [], pending: [], answered: new Set() };
  const end = context.reduce((acc, e) => {
    const next = apply(acc, entryStep(e, options));
    const m = e.message;
    return isToolResult(m) && next !== acc ? { ...next, answered: new Set([...next.answered, m.toolCallId]) } : next;
  }, start);
  const done = flush(end);
  return { messages: [...done.messages], dropped: [...done.dropped] };
}
