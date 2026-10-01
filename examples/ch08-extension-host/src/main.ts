import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventBus } from "./bus.ts";
import { loadExtensions, messageOf } from "./loader.ts";
import { beforeToolCall, emit } from "./runner.ts";
import { resolveShortcuts, type Builtin } from "./shortcuts.ts";
import type { EventOf } from "./types.ts";

const DEMO_DIR = resolve(fileURLToPath(import.meta.url), "../../demo-extensions");

const BUILTINS: readonly Builtin[] = [
  { key: "ctrl+c", action: "interrupt", reserved: true },
  { key: "enter", action: "submit", reserved: true },
  { key: "ctrl+r", action: "history.search", reserved: false },
];

const TOOL_CALLS: readonly EventOf<"tool_call">[] = [
  { type: "tool_call", toolName: "write", input: { path: ".env" } },
  { type: "tool_call", toolName: "write", input: { path: "src/app.ts" } },
  { type: "tool_call", toolName: "bash", input: {} },
  { type: "tool_call", toolName: "bash", input: { command: "rm -rf build" } },
];

const out = (line = "") => process.stdout.write(`${line}\n`);

function demoPaths(): string[] {
  return readdirSync(DEMO_DIR)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => relative(process.cwd(), join(DEMO_DIR, name)));
}

async function run(paths: readonly string[]): Promise<number> {
  const bus = createEventBus();
  bus.on("log", (line) => out(`  ${String(line)}`));

  out(`== 1. 加载 ${paths.length} 个扩展（工厂成功才提交，抛错就回滚）`);
  const { extensions, flags, errors } = await loadExtensions(paths, bus);
  for (const ext of extensions) out(`  ✓ ${ext.path}  处理函数 ${ext.handlers.length} · 工具 ${ext.tools.size} · 快捷键 ${ext.shortcuts.length}`);
  for (const error of errors) out(`  ✗ ${error.message}`);
  out(`  回滚检查：demo:ping 订阅者 ${bus.listenerCount("demo:ping")} 个；flag：${[...flags.keys()].join(", ") || "（无）"}`);
  bus.emit("demo:ping", null);

  out("\n== 2. session_start（通知类：处理函数出错只记一笔，后面的照常调用）");
  for (const error of await emit(extensions, { type: "session_start" })) out(`  ! ${error.path}：${error.message}`);

  out("\n== 3. tool_call（拦截类：第一个 block 说了算；拦截器自己出错，按拦下处理）");
  for (const call of TOOL_CALLS) {
    const verdict = await beforeToolCall(extensions, call);
    out(`  ${call.toolName} ${JSON.stringify(call.input)} → ${verdict ? `拦下：${verdict.reason}` : "放行"}`);
  }

  out("\n== 4. 快捷键（保留键宿主说了算，其余后来者赢）");
  const { shortcuts, warnings } = resolveShortcuts(BUILTINS, extensions);
  for (const warning of warnings) out(`  ! ${warning}`);
  for (const [key, owner] of shortcuts) out(`  ${key} → ${owner.path}（${owner.description}）`);

  out("\n== 5. 调用扩展注册的工具");
  for (const tool of extensions.flatMap((ext) => [...ext.tools.values()])) {
    out(`  ${tool.name}({ name: "pi" }) → ${await tool.execute({ name: "pi" })}`);
  }
  return errors.length;
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.length > 0) return (await run(argv)) > 0 ? 1 : 0;
  // 演示用的假凭据，让 snoop.ts 有东西可读。真实场景里它读到的是你的 API key。
  process.env.DEMO_API_KEY ??= "demo-not-a-real-key";
  await run(demoPaths());
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`ch08-extension-host：${messageOf(error)}\n`);
    process.exit(2);
  },
);
