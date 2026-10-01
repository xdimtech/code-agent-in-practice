import { execSync } from "node:child_process";

/**
 * 配置值解析：apiKey、header 都走这一套（pi：coding-agent/src/core/resolve-config-value.ts）。
 *
 * - 以 `!` 开头：把剩下的部分当 shell 命令执行，取 stdout（去掉首尾空白）
 * - 否则当模板：`$NAME` / `${NAME}` 换成环境变量，`$$` → `$`，`$!` → `!`
 * - 模板里有任何一个变量没设（或是空串），整个值就算没解析出来
 *
 * env 和 exec 都由调用方注入，测试和演示不必真的改环境、真的开子进程。
 */
export type Env = Readonly<Record<string, string | undefined>>;
export type Exec = (command: string) => string | undefined;

export interface ResolveDeps {
  readonly env: Env;
  readonly exec: Exec;
}

type Part = { readonly type: "literal"; readonly value: string } | { readonly type: "env"; readonly name: string };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*/;
const COMMAND_TIMEOUT_MS = 10_000;

/** 把模板切成「字面量 / 环境变量」两种片段。写不成变量名的 `$` 原样保留。 */
export function parseTemplate(config: string): readonly Part[] {
  const parts: Part[] = [];
  const literal = (value: string) => {
    const last = parts.at(-1);
    if (!value) return;
    if (last?.type === "literal") parts[parts.length - 1] = { type: "literal", value: last.value + value };
    else parts.push({ type: "literal", value });
  };
  let i = 0;
  while (i < config.length) {
    const dollar = config.indexOf("$", i);
    if (dollar < 0) {
      literal(config.slice(i));
      break;
    }
    literal(config.slice(i, dollar));
    const next = config[dollar + 1];
    if (next === "$" || next === "!") {
      literal(next);
      i = dollar + 2;
    } else if (next === "{" && config.indexOf("}", dollar + 2) >= 0) {
      const end = config.indexOf("}", dollar + 2);
      const name = config.slice(dollar + 2, end);
      if (NAME.test(name)) parts.push({ type: "env", name });
      else literal(config.slice(dollar, end + 1));
      i = end + 1;
    } else {
      const match = config.slice(dollar + 1).match(NAME_PREFIX);
      if (match) parts.push({ type: "env", name: match[0] });
      else literal("$");
      i = dollar + 1 + (match ? match[0].length : 0);
    }
  }
  return parts;
}

const isCommand = (config: string) => config.startsWith("!");
const lookup = (env: Env, name: string) => env[name] || undefined;

/** 模板里引用了、但环境里没有的变量名。 */
export function missingEnvNames(config: string, env: Env): readonly string[] {
  if (isCommand(config)) return [];
  const names = parseTemplate(config).flatMap((part) => (part.type === "env" ? [part.name] : []));
  return [...new Set(names)].filter((name) => lookup(env, name) === undefined);
}

export function resolveConfigValue(config: string, deps: ResolveDeps): string | undefined {
  if (isCommand(config)) return deps.exec(config.slice(1));
  let resolved = "";
  for (const part of parseTemplate(config)) {
    const value = part.type === "literal" ? part.value : lookup(deps.env, part.name);
    if (value === undefined) return undefined;
    resolved += value;
  }
  return resolved;
}

/**
 * 解析不出来就抛错。错误信息只说「哪个变量 / 哪条命令」，从不带值——
 * 这条错误会进日志、进 UI，值一旦是半截密钥就泄露了。
 */
export function resolveConfigValueOrThrow(config: string, description: string, deps: ResolveDeps): string {
  const value = resolveConfigValue(config, deps);
  if (value !== undefined) return value;
  if (isCommand(config)) throw new Error(`解析 ${description} 失败：命令没有输出（${config.slice(1)}）`);
  const missing = missingEnvNames(config, deps.env);
  if (missing.length > 0) throw new Error(`解析 ${description} 失败：环境变量未设置（${missing.join(", ")}）`);
  throw new Error(`解析 ${description} 失败`);
}

/**
 * 真实的命令执行：10 秒超时，stdin 和 stderr 丢掉，失败或空输出都当「没解析出来」（pi：resolve-config-value.ts:185-196）。
 * 这里吞掉异常是刻意的——调用方拿到 undefined 后由 resolveConfigValueOrThrow 报出带命令名的错误。
 */
export const shellExec: Exec = (command) => {
  try {
    const output = execSync(command, { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
};

/**
 * 进程级缓存：同一条命令只跑一次（pi：resolve-config-value.ts:10、:207-216）。
 * 注意 pi 的 provider 解析走的是**不带缓存**的那条路（resolveConfigValueOrThrow → resolveConfigValueUncached，:221-230），
 * 每次请求都重跑 `!op read …` 这种命令。这是有意的：docs/models.md:172 说不同命令要的缓存和失败策略不同，pi 猜不出来。
 */
export function cachedExec(exec: Exec): Exec {
  const cache = new Map<string, string | undefined>();
  return (command) => {
    if (!cache.has(command)) cache.set(command, exec(command));
    return cache.get(command);
  };
}
