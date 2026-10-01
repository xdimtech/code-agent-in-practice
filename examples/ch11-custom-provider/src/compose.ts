import type { BuiltinProvider, Model, ModelDefinition, ProviderConfig, UserProviderConfig } from "./types.ts";

/**
 * 模型列表的分层组合，全是纯函数（pi：coding-agent/src/core/provider-composer.ts）。
 *
 *   内置目录 → 用户配置（models.json）→ 扩展（registerProvider）→ 用户 modelOverrides
 *
 * 最后一层又回到用户手里：扩展可以换掉模型列表，但改不了用户给某个模型定的上下文窗口。
 */

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

/** 从定义 + 默认值造一个完整模型。api、baseUrl 三处都没给、窗口不是正数，都是结构错误（pi：provider-composer.ts:130-166、:216-226）。 */
function modelFrom(
  providerId: string,
  definition: ModelDefinition,
  layer: { readonly api?: string; readonly baseUrl?: string },
  defaults: Model | undefined,
): Model {
  const api = definition.api ?? layer.api ?? defaults?.api;
  if (!api) throw new Error(`Provider ${providerId}, model ${definition.id}：没有指定 "api"，在 provider 或模型上写一个`);
  const baseUrl = definition.baseUrl ?? layer.baseUrl ?? defaults?.baseUrl;
  if (!baseUrl) throw new Error(`Provider ${providerId}：定义自定义模型时必须给 "baseUrl"`);
  for (const field of ["contextWindow", "maxTokens"] as const) {
    const value = definition[field];
    if (value !== undefined && value <= 0) throw new Error(`Provider ${providerId}, model ${definition.id}：${field} 必须是正数`);
  }
  return {
    id: definition.id,
    provider: providerId,
    api,
    baseUrl,
    contextWindow: definition.contextWindow ?? defaults?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: definition.maxTokens ?? defaults?.maxTokens ?? DEFAULT_MAX_TOKENS,
    compat: definition.compat ?? defaults?.compat,
  };
}

/** 用户配置层：baseUrl 改全部模型；models 按 id **upsert**——同名覆盖，新名追加（pi：provider-composer.ts:168-206）。 */
export function applyUserConfig(providerId: string, base: readonly Model[], config: UserProviderConfig | undefined): Model[] {
  if (!config) return [...base];
  const rebased = base.map((model) => ({ ...model, baseUrl: config.baseUrl ?? model.baseUrl }));
  return (config.models ?? []).reduce<Model[]>((models, definition) => {
    const index = models.findIndex((model) => model.id === definition.id);
    const model = modelFrom(providerId, definition, config, index >= 0 ? models[index] : models[0]);
    return index >= 0 ? models.map((m, i) => (i === index ? model : m)) : [...models, model];
  }, rebased);
}

/**
 * 扩展层，四种粒度里有两种在这里体现（pi：provider-composer.ts:208-235）：
 * - 没给 models：只给了 baseUrl 就改地址，否则模型列表原样通过（oauth / streamSimple 不碰模型）
 * - 给了 models：**整体替换**。下层的模型只当默认值来源——用户在 models.json 里加的自定义模型就此消失
 *
 * pi 的扩展模型定义（ProviderModelConfig，types.ts:1553-1579）要求把 contextWindow 等字段写全，
 * 只有 api / baseUrl 从下层继承；这里为了少写几行，放宽成所有字段都能继承。
 */
export function applyExtension(providerId: string, models: readonly Model[], config: ProviderConfig | undefined): Model[] {
  if (!config) return [...models];
  if (!config.models) return config.baseUrl ? models.map((model) => ({ ...model, baseUrl: config.baseUrl! })) : [...models];
  return config.models.map((definition) =>
    modelFrom(providerId, definition, config, models.find((model) => model.id === definition.id) ?? models[0]),
  );
}

/** 最顶层：用户对单个模型的覆盖（pi：provider-composer.ts:440-445）。 */
export function applyOverrides(models: readonly Model[], config: UserProviderConfig | undefined): Model[] {
  return models.map((model) => {
    const override = config?.modelOverrides?.[model.id];
    if (!override) return model;
    return { ...model, contextWindow: override.contextWindow ?? model.contextWindow, maxTokens: override.maxTokens ?? model.maxTokens };
  });
}

export function composeModels(
  providerId: string,
  builtin: BuiltinProvider | undefined,
  user: UserProviderConfig | undefined,
  extension: ProviderConfig | undefined,
): Model[] {
  const withUser = applyUserConfig(providerId, builtin?.models ?? [], user);
  return applyOverrides(applyExtension(providerId, withUser, extension), user);
}

/**
 * 注册前的校验：只看**这一次**传进来的配置，不和上一次注册合并（pi：provider-composer.ts:407-417、model-runtime.ts:745-748）。
 * 校验不过就抛错，存储一个字节都不动。
 */
export function validateRegistration(
  providerId: string,
  builtin: BuiltinProvider | undefined,
  user: UserProviderConfig | undefined,
  config: ProviderConfig,
): void {
  if (config.streamSimple && !config.api) throw new Error(`Provider ${providerId}：注册 streamSimple 时必须给 "api"`);
  composeModels(providerId, builtin, user, config);
}
