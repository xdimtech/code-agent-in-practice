// 哪些工具进模型的工具列表、哪些出现在系统提示词里。照 pi 启动时的三段代码：
//   1. core/sdk.ts:256-263：由 --tools / --no-tools / --no-builtin-tools / --exclude-tools 和 defaultTools 设置算出允许表、排除表、初始激活表
//   2. core/agent-session.ts:2664-2755（_refreshToolRegistry）：内置工具先进表，扩展和 SDK 工具按名字覆盖；
//      启动时 includeAllExtensionTools 为 true（:407-410），所以扩展工具一注册就是激活的
//   3. core/system-prompt.ts:79-120：只有带 promptSnippet 的工具列在 Available tools；Guidelines 去重；
//      有 bash 而 grep / find / ls 都没有时，补一条「用 bash 做文件操作」
// 启动之后再注册的工具走 refreshTools()，不带选项（:2605）：之前激活的保留，新名字自动激活。

export const BUILTIN_SNIPPETS: Readonly<Record<string, string>> = {
  read: "Read file contents",
  bash: "Execute bash commands (ls, grep, find, etc.)",
  powershell: "Execute PowerShell commands",
  edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
  write: "Create or overwrite files",
  grep: "Search file contents for patterns (respects .gitignore)",
  find: "Find files by glob pattern (respects .gitignore)",
  ls: "List directory contents",
};

export const DEFAULT_ACTIVE = ["read", "bash", "edit", "write"] as const;

export type Source = "builtin" | "extension" | "sdk";

export interface ToolMeta {
  readonly name: string;
  readonly promptSnippet?: string;
  readonly promptGuidelines?: readonly string[];
}

export interface ToolFlags {
  /** --tools a,b：允许表，内置、扩展、SDK 工具一视同仁 */
  readonly tools?: readonly string[];
  /** --no-tools 是 all，--no-builtin-tools 是 builtin */
  readonly noTools?: "all" | "builtin";
  /** --exclude-tools a,b：在允许表之后再排除 */
  readonly excludeTools?: readonly string[];
  /** settings 里的 defaultTools：只替换默认的四个内置工具 */
  readonly defaultTools?: readonly string[];
}

export interface Activation {
  readonly active: readonly string[];
  readonly sources: Readonly<Record<string, Source>>;
  /** 被扩展或 SDK 工具按名字顶掉的内置工具 */
  readonly overridden: readonly string[];
  /** 系统提示词 Available tools 一节 */
  readonly listed: readonly string[];
  /** 激活了却没列出：模型只能从工具 schema 里认识它 */
  readonly unlisted: readonly string[];
  readonly guidelines: readonly string[];
}

interface Registry {
  readonly meta: ReadonlyMap<string, ToolMeta>;
  readonly sources: ReadonlyMap<string, Source>;
  readonly overridden: readonly string[];
  readonly allowed?: ReadonlySet<string>;
  readonly isAllowed: (name: string) => boolean;
}

const oneLine = (s: string | undefined): string | undefined => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
};

function buildRegistry(flags: ToolFlags, extensions: readonly ToolMeta[], sdk: readonly ToolMeta[]): Registry {
  const allowedList = flags.tools ?? (flags.noTools === "all" ? [] : undefined);
  const allowed = allowedList ? new Set(allowedList) : undefined;
  const excluded = new Set(flags.excludeTools ?? []);
  const isAllowed = (n: string): boolean => (!allowed || allowed.has(n)) && !excluded.has(n);
  const builtins = Object.entries(BUILTIN_SNIPPETS)
    .filter(([n]) => isAllowed(n))
    .map(([name, promptSnippet]): [string, ToolMeta, Source] => [name, { name, promptSnippet }, "builtin"]);
  const custom = [
    ...extensions.map((t): [string, ToolMeta, Source] => [t.name, t, "extension"]),
    ...sdk.map((t): [string, ToolMeta, Source] => [t.name, t, "sdk"]),
  ].filter(([n]) => isAllowed(n));
  const builtinNames = new Set(builtins.map(([n]) => n));
  const all = [...builtins, ...custom];
  return {
    meta: new Map(all.map(([n, m]) => [n, m])),
    sources: new Map(all.map(([n, , s]) => [n, s])),
    overridden: [...new Set(custom.map(([n]) => n).filter((n) => builtinNames.has(n)))],
    allowed,
    isAllowed,
  };
}

function describe(reg: Registry, names: readonly string[]): Activation {
  const active = [...new Set(names)].filter((n) => reg.meta.has(n));
  const snippet = (n: string): string | undefined => oneLine(reg.meta.get(n)?.promptSnippet);
  const has = (n: string): boolean => active.includes(n);
  const bashHint = has("bash") && !has("grep") && !has("find") && !has("ls") ? ["Use bash for file operations like ls, rg, find"] : [];
  const own = active.flatMap((n) => (reg.meta.get(n)?.promptGuidelines ?? []).map((g) => g.trim()).filter((g) => g !== ""));
  return {
    active,
    sources: Object.fromEntries(active.map((n) => [n, reg.sources.get(n) as Source])),
    overridden: reg.overridden,
    listed: active.filter((n) => snippet(n) !== undefined),
    unlisted: active.filter((n) => snippet(n) === undefined),
    guidelines: [...new Set([...bashHint, ...own])],
  };
}

/** 启动时的激活结果 */
export function activate(flags: ToolFlags, extensions: readonly ToolMeta[] = [], sdk: readonly ToolMeta[] = []): Activation {
  const reg = buildRegistry(flags, extensions, sdk);
  const excluded = new Set(flags.excludeTools ?? []);
  const initial = (flags.tools ?? (flags.noTools ? [] : (flags.defaultTools ?? DEFAULT_ACTIVE))).filter((n) => !excluded.has(n));
  const extra = reg.allowed
    ? [...reg.meta.keys()].filter((n) => reg.allowed?.has(n))
    : [...extensions, ...sdk].map((t) => t.name).filter(reg.isAllowed);
  return describe(reg, [...initial.filter(reg.isAllowed), ...extra]);
}

/** 启动之后（比如在 session_start 或命令里）又注册了工具：之前激活的保留，新名字自动激活 */
export function registerLater(
  flags: ToolFlags,
  before: Activation,
  extensions: readonly ToolMeta[],
  added: ToolMeta,
  sdk: readonly ToolMeta[] = [],
): Activation {
  const previous = new Set(buildRegistry(flags, extensions, sdk).meta.keys());
  const reg = buildRegistry(flags, [...extensions.filter((t) => t.name !== added.name), added], sdk);
  const kept = before.active.filter(reg.isAllowed);
  const fresh = reg.allowed
    ? [...reg.meta.keys()].filter((n) => reg.allowed?.has(n))
    : [...reg.meta.keys()].filter((n) => !previous.has(n));
  return describe(reg, [...kept, ...fresh]);
}
