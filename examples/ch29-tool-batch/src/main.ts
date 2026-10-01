// 演示：三个工具调用一起执行，观察「事件顺序」和「结果顺序」的区别，
// 以及末行超长时按字节安全截断。

import { runBatch, type BatchEvent, type Tool } from "./batch.ts";
import { tailBytes, utf8Length } from "./truncate.ts";

const MAX_OUTPUT_BYTES = 16;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const grep: Tool = {
  name: "grep",
  execute: async () => {
    await sleep(40);
    return { text: "src/a.ts:12 TODO" };
  },
};

const bash: Tool = {
  name: "bash",
  execute: async () => {
    await sleep(10);
    const output = "构建日志……全部通过 ✅😀";
    const tail = tailBytes(output, MAX_OUTPUT_BYTES);
    return { text: `[仅保留末尾 ${utf8Length(tail)} 字节] ${tail}` };
  },
};

function render(event: BatchEvent): void {
  const flag = event.type === "end" && event.isError ? "（错误）" : "";
  console.log(`  事件 ${event.type.padEnd(5)} ${event.toolCallId}${flag}`);
}

console.log("事件（完成顺序）：");
const outcome = await runBatch(
  [
    { id: "t1", name: "grep", args: {} },
    { id: "t2", name: "bash", args: {} },
    { id: "t3", name: "lint", args: {} },
  ],
  [grep, bash],
  { emit: render },
);

console.log("落盘的结果（调用顺序）：");
for (const r of outcome.results) console.log(`  ${r.toolCallId} ${r.isError ? "✗" : "✓"} ${r.text}`);

if (outcome.results.map((r) => r.toolCallId).join() !== "t1,t2,t3") {
  console.error("结果顺序与调用顺序不一致");
  process.exit(1);
}
