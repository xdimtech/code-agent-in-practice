import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOrder, hasErrors } from "../src/order.ts";
import { EVENT_NAMES } from "../src/types.ts";
import { createTraceExtension, FLAG } from "./trace.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

/** 一个假的 pi：记下注册的处理函数，按需要触发。没有对真实的 pi 跑过 */
function setup(opts: { flag?: string; failAppend?: boolean; hasUI?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const notes: string[] = [];
  let flagReadsInFactory = 0;
  let loading = true;
  const pi = {
    registerFlag: () => undefined,
    getFlag: (name: string) => {
      if (loading) flagReadsInFactory++;
      return name === FLAG ? opts.flag : undefined;
    },
    on: (event: string, handler: Handler) => void handlers.set(event, handler),
  };
  createTraceExtension({
    append: (path, line) => {
      if (opts.failAppend) throw new Error("磁盘满了");
      files.set(path, (files.get(path) ?? "") + line);
    },
    warn: (m) => void warnings.push(m),
  })(pi as never);
  loading = false;
  const ctx = { hasUI: opts.hasUI ?? false, ui: { notify: (m: string) => void notes.push(m) } };
  const fire = (event: string, payload: unknown = {}) => handlers.get(event)?.({ type: event, ...(payload as object) }, ctx);
  return { handlers, files, warnings, notes, fire, flagReadsInFactory: () => flagReadsInFactory };
}

test("36 个事件都订阅了", () => {
  const { handlers } = setup();
  assert.deepEqual([...handlers.keys()].sort(), [...EVENT_NAMES].sort());
});

test("工厂函数里不读旗标：那时只有默认值", () => {
  assert.equal(setup({ flag: "/t.jsonl" }).flagReadsInFactory(), 0);
});

test("没给 --trace：什么都不写", () => {
  const { files, fire } = setup();
  fire("agent_start");
  assert.equal(files.size, 0);
});

test("project_trust 必须返回 { trusted }，否则宿主读 .trusted 时抛 TypeError", () => {
  const { fire } = setup({ flag: "/t.jsonl" });
  assert.deepEqual(fire("project_trust", { cwd: "/w" }), { trusted: "undecided" });
});

test("其余处理函数都返回 undefined：不改任何东西", () => {
  const { handlers, fire } = setup({ flag: "/t.jsonl" });
  for (const name of handlers.keys()) if (name !== "project_trust") assert.equal(fire(name), undefined, name);
});

test("按顺序写 trace，录下的东西能直接交给 order 检查", () => {
  const { files, fire } = setup({ flag: "/t.jsonl" });
  fire("agent_start");
  fire("turn_start", { turnIndex: 0 });
  fire("context", { messages: [] });
  fire("before_provider_request", { payload: {} });
  fire("message_start", { message: { role: "assistant" } });
  fire("message_update", { message: { role: "assistant" } });
  fire("message_update", { message: { role: "assistant" } });
  fire("message_end", { message: { role: "assistant", stopReason: "toolUse" } });
  fire("tool_execution_start", { toolCallId: "c1", toolName: "bash", args: {} });
  fire("tool_call", { toolCallId: "c1", toolName: "bash", input: {} });
  fire("tool_result", { toolCallId: "c1", toolName: "bash", isError: false });
  fire("tool_execution_end", { toolCallId: "c1", toolName: "bash", isError: false });
  fire("turn_end", { turnIndex: 0 });
  fire("agent_end");
  fire("agent_settled");
  const text = files.get("/t.jsonl") ?? "";
  const r = checkOrder(text);
  assert.equal(r.events, 14, "两条 message_update 只录一条");
  assert.ok(!hasErrors(r));
  assert.deepEqual(r.findings, []);
  assert.deepEqual(JSON.parse(text.split("\n")[0]), { seq: 1, type: "agent_start" });
});

test("写不进去：tool_call 不抛错（抛错等于拦下），只提醒一次，之后不再写", () => {
  const { fire, warnings } = setup({ flag: "/t.jsonl", failAppend: true });
  assert.doesNotThrow(() => fire("tool_call", { toolCallId: "c1", toolName: "bash" }));
  fire("tool_result", { toolCallId: "c1" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /磁盘满了/);
});

test("有界面时用 ui.notify 提醒", () => {
  const { fire, notes, warnings } = setup({ flag: "/t.jsonl", failAppend: true, hasUI: true });
  fire("agent_start");
  assert.equal(notes.length, 1);
  assert.equal(warnings.length, 0);
});
