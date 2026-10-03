// 五段演示，每段对应本章一节。全部在内存里跑，不碰磁盘。

import { activate, registerLater, type ToolFlags, type ToolMeta } from "./activation.ts";
import { createFindTextTool } from "./find-text.ts";
import { runBatch, type HostEvent } from "./host.ts";
import { memFs } from "./memfs.ts";
import { truncateHead, truncateTail, truncationNotice } from "./truncate.ts";
import { text, type ToolDef } from "./types.ts";

const CWD = "/work";
const fs = memFs({
  "/work/src/a.ts": "export const a = 1;\n// TODO: rename\n",
  "/work/src/b.ts": "import { a } from './a';\n// todo later\n",
  "/work/node_modules/x/index.js": "// TODO: vendored, skipped\n",
});
const findText = createFindTextTool(fs);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slow = (name: string, ms: number, mode?: "sequential"): ToolDef => ({
  name,
  label: name,
  description: `sleeps ${ms}ms`,
  parameters: { type: "object", properties: {} },
  ...(mode ? { executionMode: mode } : {}),
  execute: async () => {
    await wait(ms);
    return { content: text(`${name} done`), details: {} };
  },
});
const failing: ToolDef = {
  ...slow("check", 0),
  execute: async () => ({ content: text("Error: file not found"), details: { ok: false } }),
};
const throwing: ToolDef = {
  ...slow("check_throw", 0),
  execute: async () => {
    throw new Error("file not found");
  },
};

/** 第一行；校验错误再带上第一条问题 */
const headline = (s: string) => s.split("\n").filter((l) => l !== "").slice(0, s.startsWith("Validation") ? 2 : 1).join(" ").replace(/\s+/g, " ");
const short = (e: HostEvent) => `${e.type}(${e.id})`;

async function lifecycle(): Promise<void> {
  console.log("一、一次工具调用的一生（find_text，参数用了旧名 query、ignoreCase 写成字符串）");
  const events: string[] = [];
  const r = await runBatch({
    tools: [findText],
    calls: [{ id: "c1", name: "find_text", arguments: { query: "todo", ignoreCase: "true", path: "@src" } }],
    ctx: { cwd: CWD },
    emit: (e) => void events.push(short(e)),
  });
  console.log(`  事件：${events.join(" → ")}`);
  console.log(`  isError=${r.messages[0].isError}，结果：`);
  for (const line of r.messages[0].content[0].text.split("\n")) console.log(`    ${line}`);
}

async function errors(): Promise<void> {
  console.log("\n二、六次调用：五次失败，模型看到的都是一条工具结果；只有抛错和宿主拦下的才标 isError");
  const r = await runBatch({
    tools: [findText, failing, throwing],
    calls: [
      { id: "e1", name: "grep_text", arguments: {} },
      { id: "e2", name: "find_text", arguments: { extra: 1 } },
      { id: "e3", name: "find_text", arguments: { pattern: "x", path: "../etc" } },
      { id: "e4", name: "check", arguments: {} },
      { id: "e5", name: "check_throw", arguments: {} },
      { id: "e6", name: "find_text", arguments: { pattern: "rm -rf" } },
    ],
    ctx: { cwd: CWD },
    hooks: { beforeToolCall: (c, a) => ((a as { pattern?: string }).pattern === "rm -rf" ? { block: true, reason: "blocked by policy" } : undefined) },
  });
  for (const m of r.messages) console.log(`  ${m.toolCallId} isError=${String(m.isError).padEnd(5)} ${headline(m.content[0].text)}`);
  console.log("  e4 返回了一段错误文字和 details.ok=false，isError 仍是 false：pi 只认抛错");
}

async function batches(): Promise<void> {
  console.log("\n三、批次：默认并行；有一个 sequential，整批串行");
  for (const tools of [[slow("fast", 10), slow("slow", 40)], [slow("fast", 10), slow("slow", 40, "sequential")]]) {
    const order: string[] = [];
    const t0 = Date.now();
    const r = await runBatch({
      tools,
      calls: [{ id: "slow", name: "slow", arguments: {} }, { id: "fast", name: "fast", arguments: {} }],
      emit: (e) => void (e.type !== "tool_execution_update" && order.push(short(e))),
    });
    console.log(`  ${r.mode.padEnd(10)} ${Date.now() - t0}ms  ${order.join(" ")}`);
  }
}

function truncation(): void {
  console.log("\n四、截断：两条上限，先碰到哪条算哪条；只交整行");
  const log = Array.from({ length: 10 }, (_, i) => `line ${i + 1} ${"x".repeat(20)}`).join("\n");
  const head = truncateHead(log, { maxLines: 3 });
  const tail = truncateTail(log, { maxBytes: 70 });
  console.log(`  head 3 行：${head.content.split("\n").map((l) => l.split(" ").slice(0, 2).join(" ")).join(" | ")}  ${truncationNotice(head)}`);
  console.log(`  tail 70B ：${tail.content.split("\n").map((l) => l.split(" ").slice(0, 2).join(" ")).join(" | ")}  truncatedBy=${tail.truncatedBy}`);
  const wide = truncateHead(`${"y".repeat(100)}\nshort`, { maxBytes: 50 });
  console.log(`  第一行就超 50B：content=${JSON.stringify(wide.content)} firstLineExceedsLimit=${wide.firstLineExceedsLimit}`);
}

function activation(): void {
  console.log("\n五、激活：哪些工具给模型、哪些写进系统提示词");
  const ext: ToolMeta[] = [
    { name: "find_text", promptSnippet: "Search file contents line by line", promptGuidelines: ["Use find_text instead of bash grep"] },
    { name: "deploy" },
  ];
  const cases: [string, ToolFlags][] = [
    ["（默认）", {}],
    ["--no-builtin-tools", { noTools: "builtin" }],
    ["--tools read,find_text", { tools: ["read", "find_text"] }],
    ["--no-tools", { noTools: "all" }],
    ["--exclude-tools bash", { excludeTools: ["bash"] }],
  ];
  for (const [label, flags] of cases) {
    const a = activate(flags, ext);
    console.log(`  ${label.padEnd(24)} 激活 ${a.active.join(",") || "(无)"}；未列入提示词 ${a.unlisted.join(",") || "(无)"}`);
  }
  const later = registerLater({ tools: ["read"] }, activate({ tools: ["read"] }, ext), ext, { name: "echo", promptSnippet: "Echo" });
  console.log(`  --tools read 之后再注册 echo：激活 ${later.active.join(",")}（允许表里没有它）`);
  const over = activate({}, [{ name: "read" }]);
  console.log(`  扩展注册同名 read：顶掉 ${over.overridden.join(",")}，未列入提示词 ${over.unlisted.join(",")}（promptSnippet 不继承）`);
}

export async function demo(): Promise<void> {
  await lifecycle();
  await errors();
  await batches();
  truncation();
  activation();
}
