import type { StreamEvent, StreamFn, StreamOptions } from "./types.ts";

/**
 * streamSimple 的钩子契约（pi：coding-agent/src/core/extensions/types.ts:1516-1521）：
 *   必须在发送前调用 options.onPayload，并使用它返回的替换 payload；
 *   必须在拿到响应、读响应体之前调用 options.onResponse。
 *
 * 这份契约只写在注释里，类型系统不检查，运行时也不检查。一个自定义 streamSimple 不调它们，
 * 挂在 before_provider_request 上的扩展（比如脱敏）就被静默绕过——没有报错，没有日志。
 *
 * 这个包装器只能**发现**违约，不能**阻止**：等它看到第一个事件，请求早已发出去了。
 * 真要保证钩子生效，得让宿主掌握发请求的那一步——要么自定义流复用内置适配器，要么宿主提供 transport。
 */

export type Hook = "onPayload" | "onResponse";

export interface ContractViolation {
  readonly provider: string;
  readonly model: string;
  readonly missing: readonly Hook[];
}

export type ContractMode = "observe" | "enforce";

export function checkHookContract(fn: StreamFn, mode: ContractMode, report: (violation: ContractViolation) => void): StreamFn {
  return async function* checked(model, context, options): AsyncIterable<StreamEvent> {
    const called = new Set<Hook>();
    const tracked: StreamOptions = {
      ...options,
      onPayload: (payload, m) => {
        called.add("onPayload");
        return options.onPayload?.(payload, m);
      },
      onResponse: (response, m) => {
        called.add("onResponse");
        return options.onResponse?.(response, m);
      },
    };
    let verified = false;
    for await (const event of fn(model, context, tracked)) {
      // 发请求之前就失败（比如没有 API key）时两个钩子本来就不会被调用，不算违约
      if (!verified && event.type !== "error") {
        verified = true;
        const missing = (["onPayload", "onResponse"] as const).filter((hook) => !called.has(hook));
        if (missing.length > 0) {
          report({ provider: model.provider, model: model.id, missing });
          if (mode === "enforce") {
            yield { type: "error", message: `${model.provider} 的 streamSimple 没有调用 ${missing.join("、")}，扩展钩子被绕过` };
            return;
          }
        }
      }
      yield event;
    }
  };
}
