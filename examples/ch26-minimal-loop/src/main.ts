// 演示：两轮工具调用 + 一条 follow-up，以及一个「最多 5 轮」的停止策略。

import { runLoop, type LoopEvent, type Message, type Tool } from "./loop.ts";
import { scriptedModel } from "./scripted-model.ts";

const MAX_TURNS = 5;

const clock: Tool = {
  name: "clock",
  execute: async () => new Date(0).toISOString(),
};

const script: Message[] = [
  { role: "assistant", text: "先看一下时间。", toolCalls: [{ id: "c1", name: "clock", args: {} }], stopReason: "toolUse" },
  { role: "assistant", text: "现在是 1970-01-01T00:00:00.000Z。", stopReason: "stop" },
  { role: "assistant", text: "好的，已记下：明天再问。", stopReason: "stop" },
];

const followUps: Message[][] = [[{ role: "user", text: "明天再问我一次。" }]];

function render(event: LoopEvent): void {
  if (event.type === "message") {
    const calls = event.message.toolCalls?.map((c) => ` → 调用 ${c.name}`).join("") ?? "";
    console.log(`  [${event.message.role}] ${event.message.text}${calls}`);
    return;
  }
  console.log(`${event.type}${event.type === "agent_end" ? `（新增 ${event.messages.length} 条）` : ""}`);
}

const produced = await runLoop(
  [{ role: "user", text: "现在几点？" }],
  {
    callModel: scriptedModel(script),
    tools: [clock],
    getFollowUp: () => followUps.shift() ?? [],
    shouldStopAfterTurn: ({ turnIndex }) => turnIndex >= MAX_TURNS,
  },
  render,
);

if (produced.length !== 5) {
  console.error(`预期新增 5 条消息，实际 ${produced.length} 条`);
  process.exit(1);
}
