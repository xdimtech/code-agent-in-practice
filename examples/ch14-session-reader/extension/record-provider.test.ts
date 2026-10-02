import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import register, { FLAG } from "./record-provider.ts";

// 用一个假的 pi 对象：记下注册的旗标和事件处理器，测试里手动触发。没有对真实的 pi 跑过。
type Handler = (event: never, ctx?: unknown) => unknown;
function fakePi(flags: Record<string, string | boolean | undefined>) {
  const handlers = new Map<string, Handler>();
  const registered: string[] = [];
  const pi = {
    registerFlag: (name: string) => void registered.push(name),
    getFlag: (name: string) => flags[name],
    on: (event: string, handler: Handler) => void handlers.set(event, handler),
  };
  const fire = (event: string, payload: unknown, ctx?: unknown) => (handlers.get(event) as (e: unknown, c?: unknown) => unknown)(payload, ctx);
  return { pi, fire, registered };
}
const ctx = { sessionManager: { getSessionId: () => "s-1", getLeafId: () => "e9" } };

test("给了 --tape：三类事件都录，文件 0600，请求钩子返回 undefined", () => {
  const dir = mkdtempSync(join(tmpdir(), "ch14-ext-"));
  try {
    const file = join(dir, "tape.jsonl");
    const { pi, fire, registered } = fakePi({ [FLAG]: file });
    register(pi as never);
    assert.deepEqual(registered, [FLAG]);
    assert.equal(fire("before_provider_request", { payload: { model: "m" } }, ctx), undefined);
    fire("after_provider_response", { status: 200, headers: { "x-request-id": "q", "set-cookie": "a" } });
    fire("message_end", { message: { role: "user" } });
    fire("message_end", { message: { role: "assistant", content: [] } });
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => r.kind), ["request", "response", "message"]);
    assert.equal(rows[0].leafId, "e9");
    assert.deepEqual(rows[1].headers, { "x-request-id": "q" });
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("没给 --tape：什么都不写", () => {
  const { pi, fire } = fakePi({});
  register(pi as never);
  assert.equal(fire("before_provider_request", { payload: {} }, ctx), undefined);
  fire("after_provider_response", { status: 200, headers: {} });
  fire("message_end", { message: { role: "assistant" } });
});

test("写不进去就抛，交给 pi 的 runner 上报", () => {
  const { pi, fire } = fakePi({ [FLAG]: "/nonexistent-dir/ch14/tape.jsonl" });
  register(pi as never);
  assert.throws(() => fire("before_provider_request", { payload: {} }, ctx), /ENOENT/);
});
