import { getCompat } from "./compat.ts";
import { isRecord, parsePartialJson, parseSSE } from "./sse.ts";
import type { Compat, Context, Model, StopReason, StreamEvent, StreamFn, Usage } from "./types.ts";

export interface HttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<string>;
}

/** 把网络抽出去：演示和测试注入假的，真用时换成 fetch。 */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

interface ToolBlock {
  readonly index?: number;
  readonly id: string;
  readonly name: string;
  readonly partial: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface StreamState {
  readonly toolCalls: readonly ToolBlock[];
  readonly finishReason?: string;
  readonly usage?: Usage;
}

export const INITIAL_STATE: StreamState = { toolCalls: [] };

/** 推理内容的字段名各家不一样；取第一个非空的，因为有的家（chutes.ai）两个字段都发同一段内容（pi：openai-completions.ts:592-606）。 */
const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

const str = (value: unknown) => (typeof value === "string" ? value : "");

function parseUsage(raw: unknown): Usage | undefined {
  if (!isRecord(raw)) return undefined;
  const input = typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : 0;
  const output = typeof raw.completion_tokens === "number" ? raw.completion_tokens : 0;
  return { input, output };
}

/** 一段工具调用增量落到哪个块：先按 index 找，再按 id 找，都找不到就开新块（pi：openai-completions.ts:485-542）。 */
function applyToolDelta(blocks: readonly ToolBlock[], raw: Record<string, unknown>): { blocks: readonly ToolBlock[]; block: ToolBlock } {
  const index = typeof raw.index === "number" ? raw.index : undefined;
  const id = str(raw.id);
  const fn = isRecord(raw.function) ? raw.function : {};
  let at = index === undefined ? -1 : blocks.findIndex((b) => b.index === index);
  if (at < 0 && id) at = blocks.findIndex((b) => b.id === id);
  const previous: ToolBlock = at >= 0 ? blocks[at]! : { index, id: "", name: "", partial: "", args: {} };
  const partial = previous.partial + str(fn.arguments);
  const block: ToolBlock = {
    index: previous.index ?? index,
    id: previous.id || id,
    name: previous.name || str(fn.name),
    partial,
    args: parsePartialJson(partial),
  };
  return { blocks: at >= 0 ? blocks.map((b, i) => (i === at ? block : b)) : [...blocks, block], block };
}

/**
 * 处理一个 chunk：纯函数，旧状态进、新状态和要发出的事件出。chunk 是外部数据，每个字段都先验类型。
 * usage 优先取 chunk.usage，没有再看 choice.usage——Moonshot 放在后者（pi：openai-completions.ts:560-564）。
 */
export function step(state: StreamState, chunk: unknown): { state: StreamState; events: readonly StreamEvent[] } {
  if (!isRecord(chunk)) return { state, events: [] };
  const choice = Array.isArray(chunk.choices) && isRecord(chunk.choices[0]) ? chunk.choices[0] : undefined;
  const usage = parseUsage(chunk.usage) ?? parseUsage(choice?.usage) ?? state.usage;
  if (!choice) return { state: { ...state, usage }, events: [] };

  const delta = isRecord(choice.delta) ? choice.delta : {};
  const events: StreamEvent[] = [];
  if (str(delta.content)) events.push({ type: "text_delta", delta: str(delta.content) });
  const field = REASONING_FIELDS.find((name) => str(delta[name]) !== "");
  if (field) events.push({ type: "thinking_delta", delta: str(delta[field]), field });

  let toolCalls = state.toolCalls;
  for (const raw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
    if (!isRecord(raw)) continue;
    const applied = applyToolDelta(toolCalls, raw);
    toolCalls = applied.blocks;
    events.push({ type: "toolcall_delta", id: applied.block.id, name: applied.block.name, arguments: applied.block.args });
  }
  const finishReason = str(choice.finish_reason) || state.finishReason;
  return { state: { toolCalls, finishReason, usage }, events };
}

const STOP_REASONS: Readonly<Record<string, StopReason>> = { stop: "stop", length: "length", tool_calls: "toolUse", function_call: "toolUse" };

/**
 * 流读完之后的收尾。没收到 finish_reason 时分两种（pi：openai-completions.ts:680-688）：
 * 这家声明了「不一定发」（compat.supportsFinishReason = false）就按有没有工具调用推断；否则当作流被截断，报错。
 */
export function finish(state: StreamState, compat: Compat): StreamEvent {
  const toolCalls = state.toolCalls.map(({ id, name, args }) => ({ id, name, arguments: args }));
  if (state.finishReason === undefined) {
    if (compat.supportsFinishReason) return { type: "error", message: "流结束了但没有 finish_reason" };
    return { type: "done", reason: toolCalls.length > 0 ? "toolUse" : "stop", inferred: true, usage: state.usage, toolCalls };
  }
  const reason = STOP_REASONS[state.finishReason];
  if (!reason) return { type: "error", message: `无法识别的 finish_reason：${state.finishReason}` };
  return { type: "done", reason, inferred: false, usage: state.usage, toolCalls };
}

/** compat 在这里起作用：同一份对话，发给不同的家，字段名和角色名不一样。 */
export function buildPayload(model: Model, context: Context, compat: Compat): Record<string, unknown> {
  const systemRole = compat.supportsDeveloperRole ? "developer" : "system";
  return {
    model: model.id,
    messages: context.messages.map((m) => ({ role: m.role === "system" ? systemRole : m.role, content: m.content })),
    stream: true,
    [compat.maxTokensField]: model.maxTokens,
    ...(compat.supportsStore ? { store: false } : {}),
  };
}

async function readAll(body: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of body) text += chunk;
  return text;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 一个「OpenAI 兼容」适配器。注意两个钩子点的位置（pi：openai-completions.ts:352-369）：
 * onPayload 在发送前，返回值替换 payload；onResponse 在拿到响应、读响应体之前。
 */
export function createOpenAILikeApi(transport: Transport): StreamFn {
  return async function* openAILike(model, context, options) {
    try {
      const compat = getCompat(model);
      const built = buildPayload(model, context, compat);
      const replaced = await options.onPayload?.(built, model);
      const body = replaced === undefined ? built : replaced;
      const headers: Record<string, string> = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};
      const response = await transport({ url: `${model.baseUrl}/chat/completions`, headers, body });
      await options.onResponse?.({ status: response.status, headers: response.headers }, model);
      if (response.status >= 400) {
        yield { type: "error", message: `HTTP ${response.status}：${(await readAll(response.body)).slice(0, 200)}` };
        return;
      }
      let state = INITIAL_STATE;
      for await (const chunk of parseSSE(response.body)) {
        const result = step(state, chunk);
        state = result.state;
        yield* result.events;
      }
      yield finish(state, compat);
    } catch (error) {
      yield { type: "error", message: messageOf(error) };
    }
  };
}
