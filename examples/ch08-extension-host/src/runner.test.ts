import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "./bus.ts";
import { initializeExtension } from "./loader.ts";
import { beforeToolCall, emit, emitToolCall } from "./runner.ts";
import type { Extension, ExtensionFactory } from "./types.ts";

async function load(...factories: ExtensionFactory[]): Promise<Extension[]> {
  const bus = createEventBus();
  const loaded = [];
  for (const [i, factory] of factories.entries()) loaded.push((await initializeExtension(`ext${i}.ts`, factory, bus)).extension);
  return loaded;
}

const call = (toolName: string, input: Record<string, unknown> = {}) => ({ type: "tool_call" as const, toolName, input });

test("通知类事件：出错的处理函数被记下，同一扩展和后面扩展的处理函数照常调用", async () => {
  const seen: string[] = [];
  const extensions = await load(
    (pi) => {
      pi.on("session_start", () => {
        throw new Error("坏了");
      });
      pi.on("session_start", () => {
        seen.push("ext0#2");
      });
    },
    (pi) => pi.on("session_start", () => {
      seen.push("ext1");
    }),
  );
  const errors = await emit(extensions, { type: "session_start" });
  assert.deepEqual(seen, ["ext0#2", "ext1"]);
  assert.deepEqual(errors, [{ path: "ext0.ts", event: "session_start", message: "坏了" }]);
});

test("只调用订阅了这个事件的处理函数", async () => {
  const seen: string[] = [];
  const extensions = await load((pi) => {
    pi.on("tool_result", (e) => {
      seen.push(e.output);
    });
    pi.on("session_start", () => {
      seen.push("start");
    });
  });
  await emit(extensions, { type: "tool_result", toolName: "read", output: "42" });
  assert.deepEqual(seen, ["42"]);
});

test("tool_call：第一个 block 说了算，后面的不再调用", async () => {
  const seen: string[] = [];
  const extensions = await load(
    (pi) => pi.on("tool_call", () => {
      seen.push("a");
      return undefined;
    }),
    (pi) => pi.on("tool_call", () => {
      seen.push("b");
      return { block: true, reason: "b 拦的" };
    }),
    (pi) => pi.on("tool_call", () => {
      seen.push("c");
      return undefined;
    }),
  );
  assert.deepEqual(await emitToolCall(extensions, call("bash")), { block: true, reason: "b 拦的" });
  assert.deepEqual(seen, ["a", "b"]);
});

test("返回值是扩展给的外部数据：只有 block === true 才算拦截，缺 reason 就补上", async () => {
  const returning = (value: unknown) => load((pi) => pi.on("tool_call", (() => value) as never));
  assert.equal(await emitToolCall(await returning({ block: "yes" }), call("bash")), undefined);
  assert.equal(await emitToolCall(await returning("block"), call("bash")), undefined);
  assert.deepEqual(await emitToolCall(await returning({ block: true }), call("bash")), { block: true, reason: "被扩展拦截" });
});

test("没有人拦就放行", async () => {
  assert.equal(await beforeToolCall(await load(), call("bash")), undefined);
  assert.equal(await beforeToolCall(await load((pi) => pi.on("tool_call", () => undefined)), call("bash")), undefined);
});

test("拦截器自己抛错：emitToolCall 不吞，beforeToolCall 按拦下处理", async () => {
  const extensions = await load((pi) => pi.on("tool_call", (e) => {
    (e.input.command as string).includes("rm");
    return undefined;
  }));
  await assert.rejects(emitToolCall(extensions, call("bash")), TypeError);
  const verdict = await beforeToolCall(extensions, call("bash"));
  assert.equal(verdict?.block, true);
  assert.match(verdict!.reason, /^扩展出错，按拦截处理：/);
});

test("同进程：扩展能读宿主的环境变量，API 里没有任何东西挡着", async (t) => {
  process.env.CH08_TEST_KEY = "visible";
  t.after(() => delete process.env.CH08_TEST_KEY);
  let leaked: string | undefined;
  await emit(await load((pi) => pi.on("session_start", () => {
    leaked = process.env.CH08_TEST_KEY;
  })), { type: "session_start" });
  assert.equal(leaked, "visible");
});
