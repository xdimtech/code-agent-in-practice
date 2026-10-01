import { isRecord, parseSSE } from "./sse.ts";
import type { HttpRequest, HttpResponse, Transport } from "./openai-like.ts";
import type { BuiltinProvider, StreamFn } from "./types.ts";

/** 演示用的内置目录：一家 OpenAI 兼容的 provider，两个模型（pi 的同类文件 ai/src/providers/deepseek.ts 一共 15 行）。 */
export const BUILTINS: readonly BuiltinProvider[] = [
  {
    id: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat", provider: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com", contextWindow: 128_000, maxTokens: 8_192 },
      { id: "deepseek-reasoner", provider: "deepseek", api: "openai-completions", baseUrl: "https://api.deepseek.com", contextWindow: 128_000, maxTokens: 32_768 },
    ],
  },
];

/** 把若干个 JSON 对象编成 SSE，再按固定字节数切块——网络分块从不和行边界对齐。 */
export function sseChunks(objects: readonly unknown[], chunkSize = 23): readonly string[] {
  const text = [...objects.map((o) => `data: ${JSON.stringify(o)}\n\n`), "data: [DONE]\n\n"].join("");
  return Array.from({ length: Math.ceil(text.length / chunkSize) }, (_, i) => text.slice(i * chunkSize, (i + 1) * chunkSize));
}

async function* fromArray(chunks: readonly string[]): AsyncIterable<string> {
  for (const chunk of chunks) yield chunk;
}

export interface FakeTransport {
  readonly transport: Transport;
  /** 服务端「收到」的请求，按顺序。 */
  readonly received: () => readonly HttpRequest[];
}

/** 假的服务端：记下收到的每个请求，按脚本回一串 SSE 块。 */
export function fakeTransport(reply: (request: HttpRequest) => { status?: number; chunks: readonly string[] }): FakeTransport {
  let received: readonly HttpRequest[] = [];
  return {
    transport: async (request): Promise<HttpResponse> => {
      received = [...received, request];
      const { status = 200, chunks } = reply(request);
      return { status, headers: { "content-type": "text/event-stream" }, body: fromArray(chunks) };
    },
    received: () => received,
  };
}

/**
 * 一个「自己发请求」的自定义 streamSimple：自己拼 payload、自己调 transport、自己解析。
 * 它能用，但从头到尾没碰 onPayload / onResponse——pi 自带的 examples/extensions/custom-provider-anthropic/index.ts
 * 就是这种写法（:335-569 的 streamCustomAnthropic 直接用 @anthropic-ai/sdk 发请求，全文件没有一处调用这两个钩子）。
 */
export function selfSendingStream(transport: Transport): StreamFn {
  return async function* selfSending(model, context, options) {
    try {
      const body = { model: model.id, prompt: context.messages.map((m) => m.content).join("\n") };
      const headers: Record<string, string> = options.apiKey ? { "x-api-key": options.apiKey } : {};
      const response = await transport({ url: `${model.baseUrl}/v1/generate`, headers, body });
      for await (const chunk of parseSSE(response.body)) {
        if (isRecord(chunk) && typeof chunk.text === "string") yield { type: "text_delta", delta: chunk.text };
      }
      yield { type: "done", reason: "stop", inferred: true, toolCalls: [] };
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  };
}

/**
 * 另一种写法：自定义流只做「换凭证、改模型」，真正发请求交给内置适配器，options 原样往下传。
 * 钩子由内置适配器负责调用，自定义部分想漏也漏不掉——
 * pi 的 examples/extensions/custom-provider-gitlab-duo/index.ts:307-376 就是这么做的。
 */
export function delegatingStream(inner: StreamFn, exchangeToken: (apiKey: string | undefined) => string): StreamFn {
  return (model, context, options) =>
    inner({ ...model, api: "openai-completions" }, context, { ...options, apiKey: exchangeToken(options.apiKey) });
}
