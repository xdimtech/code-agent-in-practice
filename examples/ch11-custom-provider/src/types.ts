/** 一份「兼容开关」：同一个 API 形状下，各家实现的细节差异（pi：ai/src/types.ts:557-626，那里有 25 个字段，这里留 5 个）。 */
export interface Compat {
  supportsStore: boolean;
  supportsDeveloperRole: boolean;
  /** 流结束时一定带 finish_reason 吗？不带的家，结束原因只能推断。 */
  supportsFinishReason: boolean;
  maxTokensField: "max_tokens" | "max_completion_tokens";
  thinkingFormat: "openai" | "deepseek" | "zai" | "openrouter";
}

/** 组合完成、可以直接拿去发请求的模型。 */
export interface Model {
  readonly id: string;
  readonly provider: string;
  readonly api: string;
  readonly baseUrl: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly compat?: Partial<Compat>;
}

/** 配置里写的模型：只有 id 必填，缺的字段从同名内置模型（或该 provider 的第一个模型）继承。 */
export interface ModelDefinition {
  readonly id: string;
  readonly api?: string;
  readonly baseUrl?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly compat?: Partial<Compat>;
}

export interface Message {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface Context {
  readonly messages: readonly Message[];
}

export interface ResponseInfo {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * 宿主交给流函数的选项。onPayload / onResponse 是宿主的两个钩子点：
 * 扩展的 before_provider_request / after_provider_response 就挂在这里（pi：sdk.ts:343-360）。
 */
export interface StreamOptions {
  readonly apiKey?: string;
  /** 发请求之前调用；返回值不是 undefined 就用它替换 payload。 */
  readonly onPayload?: (payload: unknown, model: Model) => unknown;
  /** 拿到响应头之后、读响应体之前调用。 */
  readonly onResponse?: (response: ResponseInfo, model: Model) => void | Promise<void>;
}

export type StopReason = "stop" | "length" | "toolUse";

export interface Usage {
  readonly input: number;
  readonly output: number;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type StreamEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "thinking_delta"; readonly delta: string; readonly field: string }
  | { readonly type: "toolcall_delta"; readonly id: string; readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }
  | { readonly type: "done"; readonly reason: StopReason; readonly inferred: boolean; readonly usage?: Usage; readonly toolCalls: readonly ToolCall[] }
  | { readonly type: "error"; readonly message: string };

/** 流函数：不抛错，一切失败都以 error 事件收尾。 */
export type StreamFn = (model: Model, context: Context, options: StreamOptions) => AsyncIterable<StreamEvent>;

/** 扩展调用 registerProvider 时给的配置（pi：coding-agent/src/core/extensions/types.ts:1500-1550）。 */
export interface ProviderConfig {
  readonly baseUrl?: string;
  /** 字面量、`$ENV` / `${ENV}` 模板，或以 `!` 开头的命令。 */
  readonly apiKey?: string;
  readonly api?: string;
  /** 给了就**整体替换**这个 provider 的模型列表。 */
  readonly models?: readonly ModelDefinition[];
  readonly oauth?: { readonly name: string };
  /** 自定义流函数，只接管 `api` 等于本配置 `api` 的模型。 */
  readonly streamSimple?: StreamFn;
}

export interface BuiltinProvider {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly models: readonly Model[];
}

/** 用户配置层（pi 的 models.json）。 */
export interface UserProviderConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly api?: string;
  readonly models?: readonly ModelDefinition[];
  readonly modelOverrides?: Readonly<Record<string, { readonly contextWindow?: number; readonly maxTokens?: number }>>;
}

export type UserConfig = Readonly<Record<string, UserProviderConfig>>;
