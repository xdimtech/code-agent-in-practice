// 本章的示例工具 find_text：在工作目录里按行搜文本。照 pi 示例 examples/extensions/truncated-tool.ts 的结构写，改了四处：
//   1. 不起 shell：那个示例把参数拼成字符串交给 execSync（:67），模式里带空格或 $() 就出事；本例纯 Node 实现，没有命令行
//   2. 路径先去掉开头的 @、再限制在工作目录里（docs/extensions.md:1921）
//   3. 出错一律抛：返回值永远不会被标成错误（docs/extensions.md:2015）
//   4. 截断提示里说清看到多少、少了多少、全文在哪（truncated-tool.ts:122-128），description 里写明上限（:52-53）
// 只读不写，不声明 executionMode，和别的工具并行跑。

import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { OnUpdate, Schema, ToolContext, ToolDef, ToolResult } from "./types.ts";
import { text } from "./types.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, truncateLine, truncationNotice, type Truncation } from "./truncate.ts";

export const TOOL_NAME = "find_text";
const SKIP_DIRS: ReadonlySet<string> = new Set([".git", "node_modules"]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 20_000;
const PROGRESS_EVERY = 200;

export interface Entry {
  readonly name: string;
  readonly kind: "file" | "dir" | "other";
}

/** 文件系统只留这几个操作，测试时换成内存里的假目录。stat 不跟随符号链接，不存在返回 undefined */
export interface Fs {
  readonly stat: (path: string) => { readonly kind: Entry["kind"]; readonly size: number } | undefined;
  readonly list: (dir: string) => readonly Entry[];
  readonly read: (file: string) => string;
  /** 截断时把全文存下来，返回路径；存不了就抛错 */
  readonly saveFull: (content: string) => string;
}

export interface Params {
  readonly pattern: string;
  readonly path?: string;
  readonly ignoreCase?: boolean;
  readonly regex?: boolean;
}

export interface Details {
  readonly pattern: string;
  readonly path: string;
  readonly matches: number;
  readonly filesScanned: number;
  readonly skippedLarge: number;
  readonly truncation?: Truncation;
  readonly fullOutputPath?: string;
  readonly progress?: number;
}

export const PARAMETERS: Schema = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Text to search for. Plain text unless regex is true." },
    path: { type: "string", description: "Directory or file to search, relative to the working directory. Defaults to the working directory." },
    ignoreCase: { type: "boolean", description: "Case-insensitive match. Defaults to false." },
    regex: { type: "boolean", description: "Treat pattern as a JavaScript regular expression. Defaults to false." },
  },
  required: ["pattern"],
  additionalProperties: false,
};

/** 旧版本用 query 做参数名：校验前改成 pattern，公开的 schema 不放宽（docs/extensions.md:2031-2076） */
export function prepareArguments(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const { query, ...rest } = raw as Record<string, unknown>;
  return query !== undefined && !("pattern" in rest) ? { ...rest, pattern: query } : raw;
}

/** 去掉开头的 @，解析成绝对路径；跑出工作目录就抛错 */
export function resolveInside(cwd: string, input: string | undefined): string {
  const cleaned = (input ?? ".").replace(/^@/, "");
  const target = resolve(cwd, cleaned);
  const rel = relative(cwd, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path is outside the working directory: ${cleaned}`);
  return target;
}

function matcher(p: Params): (line: string) => boolean {
  if (p.pattern === "") throw new Error("pattern must not be empty");
  if (!p.regex) {
    const needle = p.ignoreCase ? p.pattern.toLowerCase() : p.pattern;
    return (line) => (p.ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
  let re: RegExp;
  try {
    re = new RegExp(p.pattern, p.ignoreCase ? "i" : "");
  } catch (e) {
    throw new Error(`Invalid regex ${JSON.stringify(p.pattern)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return (line) => re.test(line);
}

/** 按名字排序的深度优先遍历，结果稳定；跳过 .git、node_modules 和符号链接 */
function* walk(fs: Fs, dir: string): Generator<string> {
  const entries = [...fs.list(dir)].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.kind === "file") yield join(dir, e.name);
    else if (e.kind === "dir" && !SKIP_DIRS.has(e.name)) yield* walk(fs, join(dir, e.name));
  }
}

interface Scan {
  readonly lines: readonly string[];
  readonly filesScanned: number;
  readonly skippedLarge: number;
}

function filesUnder(fs: Fs, cwd: string, root: string): Iterable<string> {
  const st = fs.stat(root);
  const shown = relative(cwd, root) || ".";
  if (!st) throw new Error(`Path not found: ${shown}`);
  if (st.kind === "file") return [root];
  if (st.kind === "dir") return walk(fs, root);
  throw new Error(`Not a file or directory (symlinks are not followed): ${shown}`);
}

function scan(fs: Fs, cwd: string, root: string, test: (line: string) => boolean, signal?: AbortSignal, onUpdate?: OnUpdate): Scan {
  const files = filesUnder(fs, cwd, root);
  const lines: string[] = [];
  let filesScanned = 0;
  let skippedLarge = 0;
  for (const file of files) {
    if (signal?.aborted) throw new Error("Search aborted");
    if (filesScanned >= MAX_FILES) throw new Error(`More than ${MAX_FILES} files under ${relative(cwd, root) || "."}; narrow the path`);
    if ((fs.stat(file)?.size ?? 0) > MAX_FILE_BYTES) {
      skippedLarge++;
      continue;
    }
    filesScanned++;
    fs.read(file).split("\n").forEach((line, i) => {
      if (test(line)) lines.push(`${relative(cwd, file)}:${i + 1}:${truncateLine(line).text}`);
    });
    if (filesScanned % PROGRESS_EVERY === 0) onUpdate?.({ content: text(`scanned ${filesScanned} files`), details: { progress: filesScanned } });
  }
  return { lines, filesScanned, skippedLarge };
}

export async function findText(fs: Fs, ctx: ToolContext, p: Params, signal?: AbortSignal, onUpdate?: OnUpdate): Promise<ToolResult> {
  const test = matcher(p);
  const root = resolveInside(ctx.cwd, p.path);
  const { lines, filesScanned, skippedLarge } = scan(fs, ctx.cwd, root, test, signal, onUpdate);
  const base: Details = { pattern: p.pattern, path: relative(ctx.cwd, root) || ".", matches: lines.length, filesScanned, skippedLarge };
  const skippedNote = skippedLarge > 0 ? `\n\n[${skippedLarge} files larger than ${formatSize(MAX_FILE_BYTES)} were skipped]` : "";
  if (lines.length === 0) return { content: text(`No matches found${skippedNote}`), details: base };
  const full = lines.join("\n");
  const t = truncateHead(full);
  if (!t.truncated) return { content: text(`${full}${skippedNote}`), details: base };
  const saved = trySave(fs, full);
  const notice = saved.path ? truncationNotice(t, saved.path) : `${truncationNotice(t)} [Full output could not be saved: ${saved.error}]`;
  return {
    content: text(`${t.content}\n\n${notice}${skippedNote}`),
    details: { ...base, truncation: t, ...(saved.path ? { fullOutputPath: saved.path } : {}) },
  };
}

/** 全文存不下来不算工具失败：截断后的结果照样有用，只是提示里换成存不下来的原因 */
function trySave(fs: Fs, full: string): { readonly path?: string; readonly error?: string } {
  try {
    return { path: fs.saveFull(full) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function createFindTextTool(fs: Fs): ToolDef {
  return {
    name: TOOL_NAME,
    label: "Find text",
    description:
      `Search files under the working directory line by line and print path:line:text for each match. ` +
      `Skips .git, node_modules and files over ${formatSize(MAX_FILE_BYTES)}. Lines longer than 500 characters are cut. ` +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}, whichever is hit first; ` +
      `when truncated, the full output is saved to a file whose path is given at the end. Use read on that file to see the rest.`,
    promptSnippet: "Search file contents line by line without a shell (plain text or regex)",
    promptGuidelines: ["Use find_text instead of bash grep when you only need to locate text in files"],
    parameters: PARAMETERS,
    prepareArguments,
    execute: (_id, params, signal, onUpdate, ctx) => findText(fs, ctx, params as Params, signal, onUpdate),
  };
}
