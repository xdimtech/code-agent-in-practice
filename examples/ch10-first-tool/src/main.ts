import { lstatSync, readFileSync } from "node:fs";
import { activate, type ToolFlags, type ToolMeta } from "./activation.ts";
import { demo } from "./demo.ts";
import { createFindTextTool } from "./find-text.ts";
import { runBatch } from "./host.ts";
import { truncateHead, truncateTail, truncationNotice } from "./truncate.ts";
import { InputError } from "./types.ts";
import { nodeFs } from "../extension/find-text.ts";

const USAGE = `用法：
  npm start                                           演示
  npm start -- search <文本> [目录] [-i] [--regex]       用 find_text 在当前目录里搜，走完整的宿主流程
  npm start -- tools [--tools a,b] [--no-tools] [--no-builtin-tools] [--exclude-tools a,b] [--ext 名字[=一句话]]...
                                                      看这些旗标下哪些工具激活、哪些写进系统提示词
  npm start -- truncate head|tail <文件> [--lines N] [--bytes N]   按 pi 的规则截断一个文件`;

const MAX_INPUT_BYTES = 64 * 1024 * 1024;

function readInput(path: string): string {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    throw new InputError(`找不到文件：${path}`);
  }
  if (!st.isFile()) throw new InputError(`不是普通文件（符号链接不跟随）：${path}`);
  if (st.size > MAX_INPUT_BYTES) throw new InputError(`文件超过上限 ${MAX_INPUT_BYTES} 字节：${path}`);
  return readFileSync(path, "utf8");
}

/** 取出「--名字 值」；值缺失就是用法错误 */
function takeValue(args: string[], i: number): string {
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new InputError(`${args[i]} 后面要跟一个值\n${USAGE}`);
  return v;
}

const list = (v: string): string[] => v.split(",").map((s) => s.trim()).filter((s) => s !== "");

function positiveInt(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new InputError(`${flag} 要一个正整数，收到 ${v}`);
  return n;
}

async function search(args: readonly string[]): Promise<number> {
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const unknown = [...flags].filter((f) => f !== "-i" && f !== "--regex");
  if (unknown.length > 0) throw new InputError(`不认识的选项：${unknown.join(" ")}\n${USAGE}`);
  const [pattern, path] = args.filter((a) => !a.startsWith("-"));
  if (!pattern) throw new InputError(USAGE);
  const r = await runBatch({
    tools: [createFindTextTool(nodeFs)],
    calls: [{ id: "cli", name: "find_text", arguments: { pattern, ...(path ? { path } : {}), ignoreCase: flags.has("-i"), regex: flags.has("--regex") } }],
    ctx: { cwd: process.cwd() },
  });
  const m = r.messages[0];
  console.log(m.content.map((c) => c.text).join("\n"));
  return m.isError ? 1 : 0;
}

function parseToolFlags(args: readonly string[]): { flags: ToolFlags; ext: ToolMeta[] } {
  const a = [...args];
  let flags: ToolFlags = {};
  const ext: ToolMeta[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--no-tools") flags = { ...flags, noTools: "all" };
    else if (a[i] === "--no-builtin-tools") flags = { ...flags, noTools: flags.noTools ?? "builtin" };
    else if (a[i] === "--tools") flags = { ...flags, tools: list(takeValue(a, i++)) };
    else if (a[i] === "--exclude-tools") flags = { ...flags, excludeTools: list(takeValue(a, i++)) };
    else if (a[i] === "--ext") {
      const [name, ...snippet] = takeValue(a, i++).split("=");
      if (!/^[a-z0-9_]+$/.test(name)) throw new InputError(`工具名只能用小写字母、数字和下划线：${name}`);
      ext.push(snippet.length > 0 ? { name, promptSnippet: snippet.join("=") } : { name });
    } else throw new InputError(`不认识的选项：${a[i]}\n${USAGE}`);
  }
  return { flags, ext };
}

function tools(args: readonly string[]): number {
  const { flags, ext } = parseToolFlags(args);
  const r = activate(flags, ext);
  console.log(`激活：${r.active.map((n) => `${n}(${r.sources[n]})`).join(" ") || "(无)"}`);
  console.log(`Available tools 里列出：${r.listed.join(", ") || "(none)"}`);
  console.log(`激活但没列出（没有 promptSnippet）：${r.unlisted.join(", ") || "(无)"}`);
  if (r.overridden.length > 0) console.log(`被同名工具顶掉的内置工具：${r.overridden.join(", ")}`);
  for (const g of r.guidelines) console.log(`Guideline：${g}`);
  return 0;
}

function truncate(args: readonly string[]): number {
  const [direction, path, ...rest] = args;
  if ((direction !== "head" && direction !== "tail") || !path) throw new InputError(USAGE);
  let limits: { maxLines?: number; maxBytes?: number } = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--lines") limits = { ...limits, maxLines: positiveInt(takeValue(rest, i++), "--lines") };
    else if (rest[i] === "--bytes") limits = { ...limits, maxBytes: positiveInt(takeValue(rest, i++), "--bytes") };
    else throw new InputError(`不认识的选项：${rest[i]}\n${USAGE}`);
  }
  const content = readInput(path);
  const t = direction === "head" ? truncateHead(content, limits) : truncateTail(content, limits);
  console.log(t.content);
  if (t.truncated) console.log(`\n${truncationNotice(t)}`);
  return 0;
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => number | Promise<number>>> = { search, tools, truncate };

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 0) {
    await demo();
    return 0;
  }
  const run = COMMANDS[args[0]];
  if (!run) throw new InputError(USAGE);
  return run(args.slice(1));
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e: unknown) {
  console.error(e instanceof InputError ? e.message : `内部错误：${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = e instanceof InputError ? 2 : 70;
}
