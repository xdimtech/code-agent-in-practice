import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "./bus.ts";
import { importFactory, initializeExtension, loadExtensions, LoadError, resolveEntry } from "./loader.ts";
import type { ExtensionAPI } from "./types.ts";

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ext-host-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const rejectsWith = (message: RegExp) => (e: unknown) => e instanceof LoadError && message.test(e.message);

test("工厂成功：注册的东西进入冻结的扩展记录，flag 单独交出", async () => {
  const { extension, flags } = await initializeExtension("a.ts", (pi) => {
    pi.on("session_start", () => {});
    pi.registerTool({ name: "t", description: "", execute: () => "ok" });
    pi.registerShortcut("Ctrl+G", "g");
    pi.registerFlag("verbose", false);
  }, createEventBus());
  assert.equal(extension.handlers.length, 1);
  assert.deepEqual([...extension.tools.keys()], ["t"]);
  assert.deepEqual(extension.shortcuts, [{ key: "ctrl+g", description: "g" }]);
  assert.deepEqual([...flags], [["verbose", false]]);
  assert.ok(Object.isFrozen(extension));
});

test("异步工厂也等它跑完再提交", async () => {
  const { extension } = await initializeExtension("a.ts", async (pi) => {
    await new Promise((r) => setTimeout(r, 1));
    pi.on("session_start", () => {});
  }, createEventBus());
  assert.equal(extension.handlers.length, 1);
});

test("工厂抛错：总线订阅被退掉，错误带着扩展路径和原因", async () => {
  const bus = createEventBus();
  await assert.rejects(
    initializeExtension("broken.ts", (pi) => {
      pi.events.on("ping", () => {});
      pi.registerFlag("x", true);
      throw new Error("缺配置");
    }, bus),
    rejectsWith(/^broken\.ts：工厂函数抛错：缺配置$/),
  );
  assert.equal(bus.listenerCount("ping"), 0);
});

test("加载失败后，扩展私藏的 API 引用也失效", async () => {
  let stash: ExtensionAPI | undefined;
  await assert.rejects(
    initializeExtension("a.ts", (pi) => {
      stash = pi;
      throw new Error("boom");
    }, createEventBus()),
  );
  assert.throws(() => stash!.events.emit("ping", 1), /加载失败，它的 API 已失效/);
});

test("加载完成后不能再注册，事件总线仍可用", async () => {
  let stash: ExtensionAPI | undefined;
  const bus = createEventBus();
  await initializeExtension("a.ts", (pi) => {
    stash = pi;
  }, bus);
  assert.throws(() => stash!.registerTool({ name: "late", description: "", execute: () => "" }), /只能在工厂函数执行期间调用/);
  const seen: unknown[] = [];
  bus.on("ping", (d) => seen.push(d));
  stash!.events.emit("ping", 1);
  assert.deepEqual(seen, [1]);
});

test("从文件加载：文件、目录 index、拒绝非扩展文件和非函数默认导出", async (t) => {
  const dir = fixtureDir({
    "a.js": "export default function (pi) { pi.registerFlag('a', 1); }\n",
    "pkg/index.js": "export default function () {}\n",
    "notes.md": "# hi\n",
    "manifest.js": "export default { tools: ['x'] };\n",
    "bad.js": "throw new Error('求值就炸');\n",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(typeof (await importFactory(join(dir, "a.js"))), "function");
  assert.equal(resolveEntry(join(dir, "pkg")), join(dir, "pkg", "index.js"));
  assert.throws(() => resolveEntry(join(dir, "notes.md")), rejectsWith(/只接受 \.ts 或 \.js/));
  assert.throws(() => resolveEntry(join(dir, "missing.ts")), rejectsWith(/不存在/));
  assert.throws(() => resolveEntry(dir), rejectsWith(/没有 index\.ts 或 index\.js/));
  await assert.rejects(importFactory(join(dir, "manifest.js")), rejectsWith(/默认导出不是工厂函数/));
  await assert.rejects(importFactory(join(dir, "bad.js")), rejectsWith(/模块求值失败：求值就炸/));
});

test("批量加载：一个失败不连累其他，flag 先到先得", async (t) => {
  const dir = fixtureDir({
    "1.js": "export default function (pi) { pi.registerFlag('mode', 'first'); }\n",
    "2.js": "export default function () { throw new Error('x'); }\n",
    "3.js": "export default function (pi) { pi.registerFlag('mode', 'third'); pi.registerFlag('extra', true); }\n",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = await loadExtensions(["1.js", "2.js", "3.js"].map((f) => join(dir, f)), createEventBus());
  assert.equal(result.extensions.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.flags.get("mode"), "first");
  assert.equal(result.flags.get("extra"), true);
});
