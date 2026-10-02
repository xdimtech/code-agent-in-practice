// 十一段演示。前七段读会话文件，8–10 段回答「模型实际收到了什么」，第 11 段是自检。

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentDir, checkEnv } from "./debug-vars.ts";
import { demoRequests, demoTape, DEMO_SYSTEM } from "./demo-tape.ts";
import { diagnose } from "./diagnose.ts";
import { runChecks, type Probe } from "./doctor.ts";
import { parseSession, type ParsedSession } from "./jsonl.ts";
import { readSessionFile } from "./load.ts";
import { redactEntries } from "./redact.ts";
import { replayAll } from "./replay.ts";
import { costs, printChecks, printFindings, printTape, printWire, replayLine, section, summarize } from "./report.ts";
import { exchanges, parseTape } from "./tape.ts";
import { tapeFindings } from "./tape-check.ts";
import { timeline } from "./timeline.ts";
import { buildTree, type SessionTree } from "./tree.ts";
import { isAssistant, isUser, type Entry } from "./types.ts";
import { toWire } from "./wire.ts";

const DEMO_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "session.jsonl");
const EDITED_ID = "6d39e7fb";

/** 演示用的环境快照：一台「跑不起来」的机器 */
const DEMO_PROBE: Probe = {
  platform: "linux",
  nodeVersion: "v22.12.0",
  env: { PI_CODING_AGENT_DIR: "~/work/.pi-agent", PI_TIMING: "true" },
  agentDir: agentDir({ PI_CODING_AGENT_DIR: "~/work/.pi-agent" }, "~"),
  agentDirExists: true,
  auth: { exists: true, mode: 0o644, size: 412 },
  models: { exists: true, mode: 0o644, size: 96, text: '{\n  // 内网网关\n  "providers": { "corp": { "baseUrl": "https://llm.example.internal/v1" } },\n}\n' },
  settings: { exists: true, mode: 0o644, size: 64, text: '{\n  // 默认模型\n  "defaultModel": "corp/sonnet"\n}\n' },
  sessionsDir: { exists: true, mode: 0o755, size: 4096 },
  debugLog: { exists: true, mode: 0o644, size: 18234 },
  crashLog: { exists: false },
};

function readingSections(parsed: ParsedSession, tree: SessionTree): void {
  section("1. 读文件：坏行要报出来，不能静默跳过");
  summarize(parsed, tree);
  for (const p of parsed.problems) console.log(`  第 ${p.line} 行：${p.detail}`);

  section("2. 文件是流水，会话是树");
  console.log(`  叶子 = 文件最后一条 = ${tree.leafId}`);
  console.log(`  不在当前对话上：${tree.offPath.map((e) => e.id).join(" ")}`);
  console.log(`  上下文：${tree.context.map((e) => e.id).join(" ")}`);

  section("3. 当前对话的时间线（░ = 已被压缩，模型看不到原文）");
  for (const line of timeline(tree.activePath, { inContext: new Set(tree.context.map((e) => e.id)) })) console.log(`  ${line}`);

  section("4. 花费：/session 显示的是全部条目之和");
  costs(tree, parsed.entries);

  section("5. 诊断");
  printFindings(diagnose(parsed, tree));
}

function hygieneSections(parsed: ParsedSession): void {
  section("6. 调试变量：同样写 true，有的生效有的不生效");
  const sample = { PI_TIMING: "true", PI_STARTUP_BENCHMARK: "true", PI_DEBUG_REDRAW: "1", PI_TUI_WRITE_LOG: "/tmp/pi-tty" };
  for (const c of checkEnv(sample)) {
    console.log(`  ${c.name}=${c.value} → ${c.active ? "生效" : "不生效"}`);
    for (const n of c.notes) console.log(`    · ${n}`);
  }
  console.log(`  日志目录：${agentDir({}, "~")}`);

  section("7. 发给别人之前先脱敏");
  const { entries, stats } = redactEntries(parsed.entries);
  const args = (e: Entry | undefined) => (isAssistant(e?.message) ? JSON.stringify(e.message.content.find((c) => c.type === "toolCall")) : "");
  console.log(`  之前：${args(parsed.entries.find((e) => e.id === "8f5b091d"))}`);
  console.log(`  之后：${args(entries.find((e) => e.id === "8f5b091d"))}`);
  console.log(`  遮掉密钥 ${stats.secrets} 处 · 移除图片 ${stats.images} 张（${stats.imageBytes} 字节 base64）`);
}

/** 把一条用户消息改几个字，其余不动：模拟「同样的对话，这次换了个说法」 */
const editUser = (entries: readonly Entry[], id: string): Entry[] =>
  entries.map((e) => (e.id === id && isUser(e.message) ? { ...e, message: { ...e.message, content: "只跑 discount 那一个用例" } } : e));

function wireSections(parsed: ParsedSession, tree: SessionTree): void {
  section("8. 会话里写的，和模型收到的（假设接着问下一句，当前模型不支持图片）");
  const wire = toWire(tree.context, { vision: false });
  printWire(wire.messages, wire.dropped);

  section("9. 录制：一次请求一条，落盘前脱敏");
  const requests = demoRequests(parsed.entries, tree);
  const tape = exchanges(parseTape(demoTape(requests, parsed.header.id)));
  printTape(tape);
  printFindings(tapeFindings(tape, parsed.entries, parsed.header.id));

  section("10. 回放：从第几个请求开始和录的不一样");
  const payloads = (entries: readonly Entry[], system?: string) => demoRequests(entries, buildTree(entries), system).map((r) => r.payload);
  console.log(`  原样重跑：${replayLine(replayAll(tape, payloads(parsed.entries)), tape.length)}`);
  console.log(`  改了系统提示词：${replayLine(replayAll(tape, payloads(parsed.entries, `${DEMO_SYSTEM} Be terse.`)), tape.length)}`);
  console.log(`  改了 ${EDITED_ID} 那句话：${replayLine(replayAll(tape, payloads(editUser(parsed.entries, EDITED_ID))), tape.length)}`);
}

export function demo(): void {
  const parsed = parseSession(readSessionFile(DEMO_FILE));
  const tree = buildTree(parsed.entries);
  readingSections(parsed, tree);
  hygieneSections(parsed);
  wireSections(parsed, tree);

  section("11. 自检：先排除环境，再怀疑模型");
  printChecks(runChecks(DEMO_PROBE));
}
