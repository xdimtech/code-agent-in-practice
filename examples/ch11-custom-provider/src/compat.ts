import type { Compat, Model } from "./types.ts";

/**
 * 同一个「OpenAI 兼容」API 形状，各家细节不同。pi 的做法分两步（ai/src/api/openai-completions.ts:1572-1707）：
 * 1. detectCompat：按 provider id 和 baseUrl 子串猜这是哪一家，给一套默认开关
 * 2. getCompat：模型上显式写的 compat 逐字段盖在猜测结果上
 *
 * 好处是内置的 26 家不用每家写一份配置；代价是「猜」依赖 URL 长相——
 * 你用一个新的 provider id 把 DeepSeek 挂在自家网关域名后面，id 和 URL 两头都对不上，猜测就失效了，
 * 只能靠显式 compat 补回来。（沿用 "deepseek" 这个 id 只改 baseUrl 的话，按 id 还能猜中。）
 */
export function detectCompat(model: Pick<Model, "provider" | "baseUrl" | "id">): Compat {
  const { provider, baseUrl } = model;
  const isDeepSeek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com");
  const isMoonshot = provider === "moonshotai" || baseUrl.includes("api.moonshot.");
  const isZai = provider === "zai" || baseUrl.includes("api.z.ai") || baseUrl.includes("open.bigmodel.cn");
  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");
  const isNonStandard = isDeepSeek || isMoonshot || isZai;
  return {
    supportsStore: !isNonStandard,
    supportsDeveloperRole: (isOpenRouter && /^(anthropic|openai)\//.test(model.id)) || (!isNonStandard && !isOpenRouter),
    supportsFinishReason: true,
    maxTokensField: isDeepSeek || isMoonshot || isZai ? "max_tokens" : "max_completion_tokens",
    thinkingFormat: isDeepSeek ? "deepseek" : isZai ? "zai" : isOpenRouter ? "openrouter" : "openai",
  };
}

/** 显式配置逐字段覆盖猜测。用 `??` 而不是对象展开：配置里一个值为 undefined 的键不该把猜测结果冲掉。 */
export function getCompat(model: Model): Compat {
  const detected = detectCompat(model);
  const explicit = model.compat ?? {};
  return {
    supportsStore: explicit.supportsStore ?? detected.supportsStore,
    supportsDeveloperRole: explicit.supportsDeveloperRole ?? detected.supportsDeveloperRole,
    supportsFinishReason: explicit.supportsFinishReason ?? detected.supportsFinishReason,
    maxTokensField: explicit.maxTokensField ?? detected.maxTokensField,
    thinkingFormat: explicit.thinkingFormat ?? detected.thinkingFormat,
  };
}
