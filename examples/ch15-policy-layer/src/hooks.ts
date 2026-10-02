// 把同一份策略接到两条执行路径上。两个适配器共用 decide，差别只在「怎么说不」：
// tool_call 返回 { block, reason }；user_bash 没有 block，要返回一个顶替执行的结果。

import { decide } from "./decide.ts";
import type { BashResult, ToolCallEvent, ToolCallHandler, UserBashEvent, UserBashHandler } from "./host.ts";
import type { Decision, Origin, Policy, Request } from "./types.ts";

export interface Ui {
  confirm(title: string, detail: string): Promise<boolean>;
}

export interface AuditRecord {
  readonly origin: Origin;
  readonly tool: string;
  readonly rule: string;
  readonly verdict: Decision["verdict"];
  readonly outcome: "allowed" | "blocked";
}

export interface GateOptions {
  readonly policy: Policy;
  readonly cwd: string;
  /** 没有 UI（-p、json、rpc 模式）时不给；那时「要问」一律按拒绝处理 */
  readonly ui?: Ui;
  readonly audit?: (record: AuditRecord) => void;
}

/** 126 是 shell 里「找到了命令但不许执行」的退出码 */
export const REFUSED_EXIT_CODE = 126;

const refusal = (reason: string): BashResult => ({ output: `策略拒绝：${reason}`, exitCode: REFUSED_EXIT_CODE, cancelled: false, truncated: false });

async function settle(options: GateOptions, request: Request): Promise<{ allowed: boolean; reason: string }> {
  const decision = decide(options.policy, request, options.cwd);
  const allowed =
    decision.verdict === "allow" ||
    (decision.verdict === "ask" && options.ui !== undefined && (await options.ui.confirm(`${request.tool}：${decision.reason}`, request.command ?? request.path ?? "")));
  options.audit?.({ origin: request.origin, tool: request.tool, rule: decision.rule, verdict: decision.verdict, outcome: allowed ? "allowed" : "blocked" });
  if (allowed) return { allowed, reason: decision.reason };
  const why = decision.verdict === "ask" ? (options.ui ? "用户没有同意" : "没有界面可以确认") : decision.reason;
  return { allowed, reason: `${why}（${decision.rule}）` };
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function toolCallGate(options: GateOptions): ToolCallHandler {
  return async (event: ToolCallEvent) => {
    const request: Request = { origin: "model", tool: event.toolName, command: text(event.input.command), path: text(event.input.path) };
    const { allowed, reason } = await settle(options, request);
    return allowed ? undefined : { block: true, reason };
  };
}

export function userBashGate(options: GateOptions): UserBashHandler {
  return async (event: UserBashEvent) => {
    // 宿主会吞掉这里抛出的错误然后照常执行，所以必须自己接住，把「策略出错」也变成一次拒绝
    try {
      const { allowed, reason } = await settle({ ...options, cwd: event.cwd }, { origin: "user", tool: "bash", command: event.command });
      return allowed ? undefined : { result: refusal(reason) };
    } catch (error) {
      return { result: refusal(`策略自己出错了，按拒绝处理：${error instanceof Error ? error.message : String(error)}`) };
    }
  };
}
