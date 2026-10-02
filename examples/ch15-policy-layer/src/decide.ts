// 策略的全部判断都在这一个纯函数里：给一份策略、一个请求，返回放行 / 要问 / 拒绝，外加是哪条规则定的。
// 它不知道 pi 的钩子长什么样，也不弹窗、不读盘；接钩子的事在 hooks.ts。

import { analyzeCommand } from "./command.ts";
import { checkWrite } from "./paths.ts";
import type { Decision, Policy, Request } from "./types.ts";

const READ_ONLY_TOOLS = new Set(["read", "ls", "grep", "find"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
/** 重定向到这些地方不算写文件 */
const SINKS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);

const allow = (rule: string, reason: string): Decision => ({ verdict: "allow", rule, reason });
const ask = (rule: string, reason: string): Decision => ({ verdict: "ask", rule, reason });
const deny = (rule: string, reason: string): Decision => ({ verdict: "deny", rule, reason });

function decideWrite(policy: Policy, cwd: string, path: string | undefined): Decision {
  if (path === undefined || path === "") return deny("malformed", "写入请求里没有路径");
  const check = checkWrite(policy, cwd, path);
  if (!check.ok) return deny(check.rule, check.detail);
  return policy.mode === "auto" ? allow("mode-auto", "auto 模式下工作区内的写入不问") : ask("mode-ask", `要写 ${path}`);
}

function decideRedirects(policy: Policy, cwd: string, redirects: readonly string[]): Decision | undefined {
  for (const target of redirects) {
    if (SINKS.has(target)) continue;
    if (target.includes("$")) return ask("redirect-dynamic", `重定向目标 ${target} 要展开才知道`);
    const check = checkWrite(policy, cwd, target);
    if (!check.ok) return deny(check.rule, `重定向：${check.detail}`);
  }
  return undefined;
}

function decideCommand(policy: Policy, cwd: string, command: string | undefined): Decision {
  if (command === undefined || command.trim() === "") return deny("malformed", "执行请求里没有命令");
  const { analysis, redirects } = analyzeCommand(command);
  const blocked = decideRedirects(policy, cwd, redirects);
  if (blocked?.verdict === "deny") return blocked;
  // 危险命令和看不全的命令在任何模式下都要问，auto 也不例外
  if (analysis.kind === "matched") return ask(analysis.rule, `危险命令（${analysis.rule}）`);
  if (analysis.kind === "unresolved") return ask("unresolved", `命令看不全（${analysis.why}），不能当成普通命令放行`);
  if (blocked) return blocked;
  return policy.mode === "auto" ? allow("mode-auto", "没有规则命中；这不代表命令安全") : ask("mode-ask", "要执行命令");
}

export function decide(policy: Policy, request: Request, cwd: string): Decision {
  if (request.origin === "user" && !policy.gateUserCommands) return allow("user-exempt", "策略不管用户亲手敲的命令");
  const tool = request.tool.trim().toLowerCase();
  if (READ_ONLY_TOOLS.has(tool)) return allow("read-only-tool", "只读工具");
  // 走到这里的都按「会改东西」处理，包括不认识的工具
  if (policy.mode === "read-only") return deny("mode-read-only", `只读模式不许用 ${request.tool}`);
  if (WRITE_TOOLS.has(tool)) return decideWrite(policy, cwd, request.path);
  if (tool === "bash") return decideCommand(policy, cwd, request.command);
  return ask("unknown-tool", `不认识的工具 ${request.tool}，按会改东西处理`);
}
