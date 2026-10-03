import { EVENTS, eventsByStage, STAGE_TITLES, canChange } from "./catalog.ts";
import { badTrace, docsOrderTrace, goodTrace, retryTrace } from "./fixtures.ts";
import { mutates, returns, simulate, throws } from "./merge.ts";
import { checkOrder } from "./order.ts";
import { formatMerge, formatTask, printFindings } from "./report.ts";
import { findTasks } from "./tasks.ts";
import type { Stage } from "./types.ts";

function lookup() {
  console.log("一、我想做 X，用哪个\n");
  for (const q of ["脱敏", "分支"]) {
    console.log(`  搜「${q}」：`);
    for (const t of findTasks(q)) console.log(formatTask(t).replace(/^/gm, "    "));
  }
}

function stages() {
  const changeable = EVENTS.filter(canChange).length;
  console.log(`\n二、36 个事件按阶段分组：${changeable} 个能改变点什么，${EVENTS.length - changeable} 个只读\n`);
  for (const stage of Object.keys(STAGE_TITLES) as Stage[]) {
    const names = eventsByStage(stage).map((e) => (canChange(e) ? `${e.name}*` : e.name));
    console.log(`  ${STAGE_TITLES[stage].padEnd(4, "　")} ${names.join("  ")}`);
  }
  console.log("  （* 表示返回值或就地修改会被宿主用上）");
}

function throwing() {
  console.log("\n三、处理函数抛错，四个事件四种下场\n");
  console.log("  tool_call（runner 不接，抛到 agent-loop 变成错误结果）：");
  console.log(formatMerge(simulate("block", [throws("audit", "日志写不进去")], { command: "rm -rf build" })));
  console.log("  before_provider_request（runner 接住，这一份改写丢失，请求照发）：");
  console.log(formatMerge(simulate("chain", [throws("redact", "正则写错了")], { messages: ["含密钥的原文"] })));
  console.log("  user_bash（runner 接住，没有扩展给结果，命令在本机照常执行）：");
  console.log(formatMerge(simulate("first-result", [throws("ssh", "连不上远端")])));
  console.log("  project_trust（返回 undefined 也算抛错：宿主读 .trusted 时 TypeError）：");
  console.log(formatMerge(simulate("first-decided", [returns("lazy", undefined), returns("policy", { trusted: "no" })])));
}

function chaining() {
  console.log("\n四、几个扩展一起订阅同一个事件\n");
  console.log("  input：第一个 transform，第二个 handled，第三个不会被调用");
  console.log(formatMerge(simulate("transform", [returns("prefix", { action: "transform", text: "[ticket-42] 修一下登录" }), returns("router", { action: "handled" }), returns("never", { action: "transform", text: "x" })], "修一下登录")));
  console.log("  before_agent_start：systemPrompt 串联，message 累加");
  console.log(formatMerge(simulate("prompt", [returns("rules", { systemPrompt: "BASE + 规则", message: { customType: "rules" } }), returns("persona", { systemPrompt: "BASE + 规则 + 人设" })], { systemPrompt: "BASE" })));
  console.log("  message_end：把助手消息换成 user 角色，被拒");
  console.log(formatMerge(simulate("same-role", [returns("swap", { message: { role: "user", content: "改写" } })], { role: "assistant", content: "原文" })));
  console.log("  before_provider_headers：返回值被忽略，只有就地修改算数；null 是删除");
  console.log(formatMerge(simulate("in-place", [returns("ignored", { "x-a": "1" }), mutates("proxy", { "x-proxy": "on", "x-title": null })], { "x-title": "pi" })));
  console.log("  session_before_compact：第一个 cancel 短路");
  console.log(formatMerge(simulate("cancel", [returns("guard", { cancel: true }), returns("summarizer", { compaction: { summary: "…" } })])));
}

function traces() {
  console.log("\n五、检查事件 trace 的顺序\n");
  const cases: readonly [string, string][] = [
    ["照代码顺序写的（一次正常调用 + 一次被拦下）", goodTrace()],
    ["照 docs/extensions.md 生命周期图写的", docsOrderTrace()],
    ["自己拼事件、顺序写错的", badTrace()],
    ["一次自动重试", retryTrace()],
  ];
  for (const [title, text] of cases) {
    const r = checkOrder(text);
    console.log(`  ${title}：${r.events} 个事件`);
    printFindings(r.findings, 8);
  }
}

export function demo(): void {
  lookup();
  stages();
  throwing();
  chaining();
  traces();
}
