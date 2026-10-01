import { resolveConfigValueOrThrow, type ResolveDeps } from "./config-value.ts";
import { composeModels, validateRegistration } from "./compose.ts";
import type { BuiltinProvider, Context, Model, ProviderConfig, StreamEvent, StreamFn, StreamOptions, UserConfig } from "./types.ts";

export interface RegistryDeps extends ResolveDeps {
  readonly builtins: readonly BuiltinProvider[];
  readonly userConfig: UserConfig;
  /** 按 API 名注册的内置适配器（pi：ai/src/providers/all.ts 背后的 api/*.ts）。 */
  readonly apis: Readonly<Record<string, StreamFn>>;
}

export interface Registry {
  registerProvider(providerId: string, config: ProviderConfig): void;
  unregisterProvider(providerId: string): void;
  /** 用户改了 models.json 之后重新组合所有 provider。 */
  reloadUserConfig(userConfig: UserConfig): void;
  getModels(providerId?: string): readonly Model[];
  /** 组合失败的 provider 不会让整个注册表报废：它退回内置版本，错误攒在这里。 */
  getError(): string | undefined;
  /** 这个 provider 能用哪些方式登录。只配了 OAuth 的，不凭空造一个 API key 入口（pi：provider-composer.ts:310-311）。 */
  authMethods(providerId: string): readonly ("apiKey" | "oauth")[];
  resolveApiKey(providerId: string): string;
  stream(model: Model, context: Context, options: StreamOptions): AsyncIterable<StreamEvent>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 「上一次注册」和「这一次注册」浅合并：这次没给（undefined）的字段保留上次的（pi：model-runtime.ts:749-754）。 */
export function mergeRegistration(previous: ProviderConfig | undefined, next: ProviderConfig): ProviderConfig {
  const defined = Object.entries(next).filter(([, value]) => value !== undefined);
  return { ...previous, ...Object.fromEntries(defined) };
}

/** pi 的 ModelRuntime 中和 provider 相关的那一半（coding-agent/src/core/model-runtime.ts:245-267、:742-786）。 */
export function createRegistry(deps: RegistryDeps): Registry {
  const builtins = new Map(deps.builtins.map((provider) => [provider.id, provider]));
  let userConfig = deps.userConfig;
  const extensions = new Map<string, ProviderConfig>();
  const composed = new Map<string, readonly Model[]>();
  const compositionErrors = new Map<string, string>();

  const recompose = (providerId: string) => {
    const builtin = builtins.get(providerId);
    const user = userConfig[providerId];
    const extension = extensions.get(providerId);
    compositionErrors.delete(providerId);
    if (!builtin && !user && !extension) {
      composed.delete(providerId);
      return;
    }
    try {
      composed.set(providerId, composeModels(providerId, builtin, user, extension));
    } catch (error) {
      // 组合失败：记下错误，退回内置版本；连内置都没有就整个拿掉（pi：model-runtime.ts:259-266）。
      compositionErrors.set(providerId, messageOf(error));
      if (builtin) composed.set(providerId, builtin.models);
      else composed.delete(providerId);
    }
  };
  const allIds = () => new Set([...builtins.keys(), ...Object.keys(userConfig), ...extensions.keys()]);
  for (const id of allIds()) recompose(id);

  /** 派发：扩展的 streamSimple 只接管 api 对得上的模型，其余交给内置适配器（pi：provider-composer.ts:454-474）。 */
  const pickStream = (model: Model): StreamFn => {
    const extension = extensions.get(model.provider);
    if (extension?.streamSimple && model.api === extension.api) return extension.streamSimple;
    const api = deps.apis[model.api];
    if (!api) throw new Error(`没有注册 api 为 ${model.api} 的适配器`);
    return api;
  };

  /** 扩展 → 用户配置 → 内置的环境变量名，第一个给了的算数（pi：provider-composer.ts:272-277）。 */
  const apiKeyReference = (providerId: string): string | undefined => {
    const configured = extensions.get(providerId)?.apiKey ?? userConfig[providerId]?.apiKey;
    const builtinEnv = builtins.get(providerId)?.apiKeyEnv;
    return configured ?? (builtinEnv ? `$${builtinEnv}` : undefined);
  };

  return {
    registerProvider(providerId, config) {
      if (!providerId) throw new Error("provider id 不能为空");
      validateRegistration(providerId, builtins.get(providerId), userConfig[providerId], config);
      extensions.set(providerId, mergeRegistration(extensions.get(providerId), config));
      recompose(providerId);
    },
    unregisterProvider(providerId) {
      extensions.delete(providerId);
      recompose(providerId);
    },
    reloadUserConfig(next) {
      const ids = new Set([...allIds(), ...Object.keys(next)]);
      userConfig = next;
      for (const id of ids) recompose(id);
    },
    getModels(providerId) {
      if (providerId !== undefined) return composed.get(providerId) ?? [];
      return [...composed.values()].flat();
    },
    getError() {
      const lines = [...compositionErrors].map(([id, message]) => `Provider "${id}": ${message}`);
      return lines.length > 0 ? lines.join("\n") : undefined;
    },
    authMethods(providerId) {
      const apiKey = apiKeyReference(providerId) !== undefined ? (["apiKey"] as const) : [];
      const oauth = extensions.get(providerId)?.oauth ? (["oauth"] as const) : [];
      return [...apiKey, ...oauth];
    },
    resolveApiKey(providerId) {
      const reference = apiKeyReference(providerId);
      if (!reference) throw new Error(`Provider ${providerId}：没有配置 API key`);
      return resolveConfigValueOrThrow(reference, `${providerId} 的 API key`, deps);
    },
    /** 和 pi 的 lazyStream（ai/src/api/lazy.ts:46-61）一样：派发和准备阶段的异常也变成 error 事件，调用方只需要处理一种失败。 */
    async *stream(model, context, options) {
      let fn: StreamFn;
      try {
        fn = pickStream(model);
      } catch (error) {
        yield { type: "error", message: messageOf(error) };
        return;
      }
      yield* fn(model, context, options);
    },
  };
}

export interface RegistrationError {
  readonly providerId: string;
  readonly message: string;
}

/**
 * 扩展加载期间注册表还没就绪：registerProvider 先排队，绑定时逐个冲刷，每一个单独 try/catch。
 * 一个扩展的 provider 配错了，报一条错误，别的照常注册（fail-open；pi：loader.ts:231-243、runner.ts:356-390）。
 * 绑定之后再调用，立即生效、错误直接抛给调用者。
 */
export function createProviderApi() {
  let registry: Registry | undefined;
  let queue: readonly { readonly providerId: string; readonly config: ProviderConfig }[] = [];
  return {
    registerProvider(providerId: string, config: ProviderConfig): void {
      if (registry) registry.registerProvider(providerId, config);
      else queue = [...queue, { providerId, config }];
    },
    unregisterProvider(providerId: string): void {
      if (registry) registry.unregisterProvider(providerId);
      else queue = queue.filter((entry) => entry.providerId !== providerId);
    },
    bind(target: Registry): readonly RegistrationError[] {
      registry = target;
      const errors = queue.flatMap(({ providerId, config }) => {
        try {
          target.registerProvider(providerId, config);
          return [];
        } catch (error) {
          return [{ providerId, message: messageOf(error) }];
        }
      });
      queue = [];
      return errors;
    },
  };
}
