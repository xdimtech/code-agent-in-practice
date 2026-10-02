import assert from "node:assert/strict";
import { test } from "node:test";
import { type AuditRecord, REFUSED_EXIT_CODE, toolCallGate, type Ui, userBashGate } from "./hooks.ts";
import { dispatchToolCall, dispatchUserBash } from "./host.ts";
import { DEFAULT_POLICY, type Policy } from "./types.ts";

const CWD = "/work/repo";
const yes: Ui = { confirm: async () => true };
const no: Ui = { confirm: async () => false };
const AUTO: Policy = { ...DEFAULT_POLICY, mode: "auto" };

test("放行：两个适配器都返回 undefined，不弹窗", async () => {
  let asked = 0;
  const ui: Ui = { confirm: async () => (asked++, true) };
  assert.equal(await toolCallGate({ policy: AUTO, cwd: CWD, ui })({ toolName: "bash", input: { command: "npm test" } }), undefined);
  assert.equal(await userBashGate({ policy: AUTO, cwd: CWD, ui })({ command: "npm test", cwd: CWD }), undefined);
  assert.equal(asked, 0);
});

test("要问：有界面听用户的", async () => {
  const event = { toolName: "bash", input: { command: "rm -rf build" } };
  assert.equal(await toolCallGate({ policy: AUTO, cwd: CWD, ui: yes })(event), undefined);
  assert.deepEqual(await toolCallGate({ policy: AUTO, cwd: CWD, ui: no })(event), { block: true, reason: "用户没有同意（recursive-delete）" });
});

test("要问：没有界面一律按拒绝处理", async () => {
  const blocked = await toolCallGate({ policy: AUTO, cwd: CWD })({ toolName: "bash", input: { command: "rm -rf build" } });
  assert.deepEqual(blocked, { block: true, reason: "没有界面可以确认（recursive-delete）" });
});

test("拒绝：不弹窗，直接拦", async () => {
  let asked = false;
  const ui: Ui = { confirm: async () => ((asked = true), true) };
  const blocked = await toolCallGate({ policy: AUTO, cwd: CWD, ui })({ toolName: "write", input: { path: ".env", content: "x" } });
  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? "", /protected-path/);
  assert.equal(asked, false);
});

test("user_bash 的拒绝是一个顶替结果，退出码 126", async () => {
  const replaced = await userBashGate({ policy: AUTO, cwd: CWD })({ command: "sudo ls", cwd: CWD });
  assert.equal(replaced?.result.exitCode, REFUSED_EXIT_CODE);
  assert.match(replaced?.result.output ?? "", /^策略拒绝：没有界面可以确认（privilege）/);
});

test("user_bash 用事件里的 cwd 判断路径", async () => {
  const replaced = await userBashGate({ policy: AUTO, cwd: "/elsewhere" })({ command: "echo x > .env", cwd: CWD });
  assert.match(replaced?.result.output ?? "", /protected-path/);
});

test("确认框抛错：user_bash 也不执行（适配器自己接住了）", async () => {
  const explode: Ui = { confirm: async () => Promise.reject(new Error("确认框崩了")) };
  const outcome = await dispatchUserBash([userBashGate({ policy: AUTO, cwd: CWD, ui: explode })], { command: "rm -rf build", cwd: CWD });
  assert.equal(outcome.ran, false);
  assert.match(outcome.reason ?? "", /策略自己出错了，按拒绝处理：确认框崩了/);
  assert.deepEqual(outcome.swallowed, []);
});

test("一份策略接两条路：没有界面时同一条命令两边都拦", async () => {
  const options = { policy: DEFAULT_POLICY, cwd: CWD };
  assert.equal((await dispatchToolCall([toolCallGate(options)], { toolName: "bash", input: { command: "rm -rf build" } })).ran, false);
  assert.equal((await dispatchUserBash([userBashGate(options)], { command: "rm -rf build", cwd: CWD })).ran, false);
});

test("每次判断都留一条审计记录", async () => {
  const records: AuditRecord[] = [];
  const options = { policy: AUTO, cwd: CWD, ui: no, audit: (r: AuditRecord) => records.push(r) };
  await toolCallGate(options)({ toolName: "bash", input: { command: "ls" } });
  await userBashGate(options)({ command: "rm -rf x", cwd: CWD });
  assert.deepEqual(records, [
    { origin: "model", tool: "bash", rule: "mode-auto", verdict: "allow", outcome: "allowed" },
    { origin: "user", tool: "bash", rule: "recursive-delete", verdict: "ask", outcome: "blocked" },
  ]);
});

test("事件里的字段不是字符串：当成缺字段，拒绝", async () => {
  const blocked = await toolCallGate({ policy: AUTO, cwd: CWD, ui: yes })({ toolName: "bash", input: { command: ["rm", "-rf"] } });
  assert.match(blocked?.reason ?? "", /malformed/);
});
