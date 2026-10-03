import { lstatSync, readFileSync } from "node:fs";
import { API_GROUPS, eventInfo, EVENTS } from "./catalog.ts";
import { demo } from "./demo.ts";
import { checkOrder, hasErrors } from "./order.ts";
import { formatEvent, formatTask, printFindings } from "./report.ts";
import { findTasks } from "./tasks.ts";
import { InputError } from "./types.ts";

const USAGE = `用法：
  npm start                             演示
  npm start -- find <关键词>             我想做 X：按关键词找该用的事件或 API
  npm start -- event <事件名>            一个事件的卡片：能改什么、多个处理函数怎么合并、在哪里发
  npm start -- events                   36 个事件一览
  npm start -- apis                     注册类 API 的 11 组
  npm start -- order <trace.jsonl>      检查 extension/trace.ts 录下的事件顺序`;

const MAX_TRACE_BYTES = 64 * 1024 * 1024;

function readTrace(path: string): string {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    throw new InputError(`找不到文件：${path}`);
  }
  if (!st.isFile()) throw new InputError(`不是普通文件（符号链接不跟随）：${path}`);
  if (st.size > MAX_TRACE_BYTES) throw new InputError(`文件超过上限 ${MAX_TRACE_BYTES} 字节：${path}`);
  return readFileSync(path, "utf8");
}

function find(args: readonly string[]): number {
  const q = args.join(" ").trim();
  if (q === "") throw new InputError(USAGE);
  const hits = findTasks(q);
  if (hits.length === 0) {
    console.log(`没有和「${q}」相关的条目；试试 events 或 apis 看全表`);
    return 0;
  }
  console.log(hits.map(formatTask).join("\n\n"));
  return 0;
}

function event(args: readonly string[]): number {
  const info = eventInfo(args[0] ?? "");
  if (!info) throw new InputError(`不认识的事件：${String(args[0])}；npm start -- events 看全部 36 个`);
  console.log(formatEvent(info));
  return 0;
}

function events(): number {
  for (const e of EVENTS) console.log(`${e.name.padEnd(24)} ${e.merge.padEnd(14)} ${e.can}`);
  return 0;
}

function apis(): number {
  for (const g of API_GROUPS) console.log(`${g.group}：${g.methods.join(" / ")}\n  ${g.when}（types.ts 声明：${g.declaredAt}）`);
  return 0;
}

function order(args: readonly string[]): number {
  const [path] = args;
  if (!path) throw new InputError(USAGE);
  const r = checkOrder(readTrace(path));
  console.log(`${r.events} 个事件`);
  printFindings(r.findings, 40);
  return hasErrors(r) ? 1 : 0;
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => number>> = { find, event, events, apis, order };

function main(args: readonly string[]): number {
  if (args.length === 0) {
    demo();
    return 0;
  }
  const run = COMMANDS[args[0]];
  if (!run) throw new InputError(USAGE);
  return run(args.slice(1));
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e: unknown) {
  console.error(e instanceof InputError ? e.message : `内部错误：${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = e instanceof InputError ? 2 : 70;
}
