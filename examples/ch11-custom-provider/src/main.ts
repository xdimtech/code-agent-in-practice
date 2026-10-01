import { cachedExec, resolveConfigValue, resolveConfigValueOrThrow, type Exec, type ResolveDeps } from "./config-value.ts";
import { detectCompat, getCompat } from "./compat.ts";
import { checkHookContract, type ContractViolation } from "./contract.ts";
import { BUILTINS, delegatingStream, fakeTransport, selfSendingStream, sseChunks } from "./demo-providers.ts";
import { buildPayload, createOpenAILikeApi } from "./openai-like.ts";
import { createProviderApi, createRegistry, type Registry } from "./registry.ts";
import type { Context, Model, StreamEvent, StreamFn, StreamOptions, UserConfig } from "./types.ts";

const out = (line = "") => process.stdout.write(`${line}\n`);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** 演示里的「密钥」都是假的，但打印时照样只露前两位：日志里出现完整密钥是一种习惯，不是一次事故。 */
const mask = (value: string | undefined) => (value === undefined ? "（未解析）" : `${value.slice(0, 2)}…（${value.length} 字符）`);

const USER_CONFIG: UserConfig = {
  deepseek: {
    models: [{ id: "deepseek-distill-local", baseUrl: "http://localhost:8000/v1" }],
    modelOverrides: { "deepseek-chat": { contextWindow: 64_000 } },
  },
};

const CONTEXT: Context = {
  messages: [
    { role: "system", content: "你是代码助手" },
    { role: "user", content: "连上数据库看看，连接串是 postgres://app:password=hunter2@db" },
  ],
};

function listModels(registry: Registry, providerId: string) {
  for (const m of registry.getModels(providerId)) out(`    ${m.id.padEnd(24)} api=${m.api.padEnd(18)} ${m.baseUrl}  窗口 ${m.contextWindow}`);
}

function section1ConfigValues() {
  out("== 1. 配置值：模板、转义、命令");
  let runs = 0;
  const exec: Exec = (command) => {
    runs += 1;
    return command === "print-demo-key" ? "cmd-key-0001" : undefined;
  };
  const deps: ResolveDeps = { env: { DEMO_KEY: "env-key-0001", REGION: "cn" }, exec };
  for (const config of ["$DEMO_KEY", "${REGION}-gateway", "$$literal", "$!not-a-command", "!print-demo-key", "$MISSING_KEY", "!false"]) {
    try {
      const value = resolveConfigValueOrThrow(config, "演示 key", deps);
      out(`  ${config.padEnd(18)} → ${config.includes("KEY") || config.startsWith("!") ? mask(value) : value}`);
    } catch (error) {
      out(`  ${config.padEnd(18)} ✗ ${messageOf(error)}`);
    }
  }
  runs = 0;
  for (let i = 0; i < 3; i++) resolveConfigValue("!print-demo-key", deps);
  const uncached = runs;
  runs = 0;
  const cached: ResolveDeps = { ...deps, exec: cachedExec(exec) };
  for (let i = 0; i < 3; i++) resolveConfigValue("!print-demo-key", cached);
  out(`  同一条命令解析 3 次：不缓存跑了 ${uncached} 次，缓存后跑了 ${runs} 次`);
}

function section2Granularities(apis: Record<string, StreamFn>) {
  out("\n== 2. registerProvider 的四种粒度（内置 → 用户配置 → 扩展 → 用户覆盖）");
  const registry = createRegistry({ builtins: BUILTINS, userConfig: USER_CONFIG, apis, env: {}, exec: () => undefined });
  out("  起点：内置 2 个模型 + 用户配置追加 1 个；deepseek-chat 的窗口被用户覆盖成 64000");
  listModels(registry, "deepseek");

  out("  (a) 只给 baseUrl：所有模型改地址——连用户自己指向 localhost 的那个也改了");
  registry.registerProvider("deepseek", { baseUrl: "https://gateway.example.com/deepseek" });
  listModels(registry, "deepseek");

  out("  (b) 给 models：整体替换。用户追加的模型消失；baseUrl 沿用上一次注册；用户覆盖仍在最顶层生效");
  registry.registerProvider("deepseek", { models: [{ id: "deepseek-chat" }] });
  listModels(registry, "deepseek");
  registry.unregisterProvider("deepseek");
  out(`  unregister 之后回到起点：${registry.getModels("deepseek").map((m) => m.id).join(", ")}`);

  out("  (c) 给 oauth：不碰模型，只多一个登录方式；只有 OAuth 的 provider 不会凭空长出 API key 入口");
  registry.registerProvider("corp", { api: "openai-completions", baseUrl: "https://llm.corp.example", oauth: { name: "Corp SSO" }, models: [{ id: "corp-coder" }] });
  registry.registerProvider("deepseek", { oauth: { name: "DeepSeek 账号" } });
  out(`    corp 的登录方式：${registry.authMethods("corp").join(" + ")}；deepseek：${registry.authMethods("deepseek").join(" + ")}`);

  out("  (d) 给 api + streamSimple：只接管 api 对得上的模型，其余仍走内置适配器");
  const acme = fakeTransport(() => ({ chunks: sseChunks([{ text: "acme 自己的协议" }]) }));
  registry.registerProvider("acme", {
    api: "acme-v1",
    baseUrl: "https://api.acme.example",
    streamSimple: selfSendingStream(acme.transport),
    models: [{ id: "acme-1" }, { id: "acme-compatible", api: "openai-completions" }],
  });
  listModels(registry, "acme");
  return registry;
}

function section3Errors(apis: Record<string, StreamFn>) {
  out("\n== 3. 出错的三条路");
  const registry = createRegistry({ builtins: BUILTINS, userConfig: USER_CONFIG, apis, env: {}, exec: () => undefined });
  const api = createProviderApi();
  api.registerProvider("good", { api: "openai-completions", baseUrl: "https://good.example", models: [{ id: "good-1" }] });
  api.registerProvider("half-done", { streamSimple: selfSendingStream(fakeTransport(() => ({ chunks: [] })).transport) });
  api.registerProvider("no-api", { baseUrl: "https://x.example", models: [{ id: "x-1" }] });
  const errors = api.bind(registry);
  out(`  (a) 加载期排队、绑定时逐个注册：${errors.length} 个失败只报错，good 照常可用（${registry.getModels("good").length} 个模型）`);
  for (const e of errors) out(`      ✗ ${e.providerId}：${e.message}`);

  try {
    api.registerProvider("good", { models: [{ id: "good-2" }] });
  } catch (error) {
    out("  (b) 绑定后重新注册，只给 models、没再写 api：校验只看这一次的配置，上一次写过的 api 不算数");
    out(`      ✗ ${messageOf(error)}；存储没动：${registry.getModels("good").map((m) => m.id).join(", ")}`);
  }

  registry.reloadUserConfig({ deepseek: { models: [{ id: "deepseek-chat", contextWindow: -1 }] }, lab: { models: [{ id: "lab-1" }] } });
  out("  (c) 用户把 models.json 改坏了：不抛错，坏掉的 provider 退回内置版本（或整个拿掉），错误攒到 getError()");
  listModels(registry, "deepseek");
  out(`    lab 的模型数：${registry.getModels("lab").length}`);
  for (const line of registry.getError()?.split("\n") ?? []) out(`    ! ${line}`);
}

function section4Compat() {
  out("\n== 4. 一个适配器服务许多家：detectCompat 猜，显式 compat 补");
  const base = BUILTINS[0]!.models[0]!;
  const cases: readonly [string, Model][] = [
    ["官方地址", base],
    ["挂到自家网关后", { ...base, provider: "my-gateway", baseUrl: "https://llm.internal.example/v1" }],
    ["网关 + 显式 compat", { ...base, provider: "my-gateway", baseUrl: "https://llm.internal.example/v1", compat: { maxTokensField: "max_tokens", supportsStore: false, supportsDeveloperRole: false } }],
  ];
  for (const [label, model] of cases) {
    const payload = buildPayload(model, CONTEXT, getCompat(model));
    const keys = Object.keys(payload).filter((k) => k !== "messages" && k !== "model" && k !== "stream");
    const role = (payload.messages as { role: string }[])[0]!.role;
    out(`  ${label.padEnd(14)} 猜测 thinkingFormat=${detectCompat(model).thinkingFormat.padEnd(8)} 请求字段 ${keys.join("+").padEnd(26)} 系统消息角色 ${role}`);
  }
}

async function collect(stream: AsyncIterable<StreamEvent>): Promise<readonly StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function describe(event: StreamEvent): string {
  switch (event.type) {
    case "text_delta":
      return `text      ${JSON.stringify(event.delta)}`;
    case "thinking_delta":
      return `thinking  ${JSON.stringify(event.delta)}（字段 ${event.field}）`;
    case "toolcall_delta":
      return `toolcall  ${event.id || "?"} ${event.name} ${JSON.stringify(event.arguments)}`;
    case "done":
      return `done      ${event.reason}${event.inferred ? "（推断）" : ""} usage=${JSON.stringify(event.usage ?? null)} 工具调用 ${event.toolCalls.length} 个`;
    case "error":
      return `error     ${event.message}`;
  }
}

const MOONSHOT_LIKE = [
  { choices: [{ delta: { reasoning_content: "先读配置文件" } }] },
  { choices: [{ delta: { content: "我来看看。" } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: '{"path":"src/db' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '.ts","limit' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '":40}' } }] } }] },
  { choices: [{ delta: {}, finish_reason: "tool_calls", usage: { prompt_tokens: 812, completion_tokens: 37 } }] },
];

async function section5Streaming() {
  out("\n== 5. 流式差异：推理字段、choice.usage、按 index 拼工具参数、缺 finish_reason");
  const server = fakeTransport(() => ({ chunks: sseChunks(MOONSHOT_LIKE) }));
  const api = createOpenAILikeApi(server.transport);
  const model: Model = { id: "kimi-k2", provider: "moonshotai", api: "openai-completions", baseUrl: "https://api.moonshot.cn/v1", contextWindow: 256_000, maxTokens: 16_384 };
  out(`  （服务端回的 ${MOONSHOT_LIKE.length} 个 chunk 被切成 ${sseChunks(MOONSHOT_LIKE).length} 个网络块，行边界全被切断）`);
  for (const event of await collect(api(model, CONTEXT, {}))) out(`  ${describe(event)}`);

  const noFinish = [{ choices: [{ delta: { content: "好的" } }] }];
  const quiet = createOpenAILikeApi(fakeTransport(() => ({ chunks: sseChunks(noFinish) })).transport);
  const strict = await collect(quiet(model, CONTEXT, {}));
  const lenient = await collect(quiet({ ...model, compat: { supportsFinishReason: false } }, CONTEXT, {}));
  out(`  没有 finish_reason，默认：${describe(strict.at(-1)!)}`);
  out(`  没有 finish_reason，compat.supportsFinishReason=false：${describe(lenient.at(-1)!)}`);
}

const REDACT: StreamOptions["onPayload"] = (payload) => JSON.parse(JSON.stringify(payload).replaceAll("password=hunter2", "password=[已脱敏]"));

async function section6Contract() {
  out("\n== 6. 钩子契约：before_provider_request 上挂了一个脱敏扩展");
  const server = fakeTransport(() => ({ chunks: sseChunks([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, { text: "ok" }]) }));
  const builtin = createOpenAILikeApi(server.transport);
  const violations: ContractViolation[] = [];
  const audit = (fn: StreamFn) => checkHookContract(fn, "observe", (v) => violations.push(v));
  const model: Model = { id: "m", provider: "", api: "", baseUrl: "https://llm.example", contextWindow: 8_000, maxTokens: 1_000 };
  const variants: readonly [string, StreamFn][] = [
    ["内置适配器", builtin],
    ["自己发请求的 streamSimple", selfSendingStream(server.transport)],
    ["委托内置适配器的 streamSimple", delegatingStream(builtin, () => "exchanged-token")],
  ];
  for (const [label, fn] of variants) {
    const target = { ...model, provider: label, api: "openai-completions" };
    await collect(audit(fn)(target, CONTEXT, { apiKey: "demo-key", onPayload: REDACT, onResponse: () => undefined }));
    const sent = JSON.stringify(server.received().at(-1)?.body);
    out(`  ${label.padEnd(18)} 服务端收到：${sent.includes("hunter2") ? "✗ 明文 password=hunter2" : "✓ password=[已脱敏]"}`);
  }
  for (const v of violations) out(`  ! 契约检查：${v.provider} 没有调用 ${v.missing.join("、")}`);
  const enforced = await collect(checkHookContract(selfSendingStream(server.transport), "enforce", () => undefined)({ ...model, provider: "acme" }, CONTEXT, { onPayload: REDACT }));
  out(`  enforce 模式：${describe(enforced.at(-1)!)}——但请求已经发出去了，服务端一共收到 ${server.received().length} 个请求`);
}

async function main() {
  const reply = sseChunks([{ choices: [{ delta: { content: "内置适配器的回答" }, finish_reason: "stop" }] }]);
  const apis: Record<string, StreamFn> = { "openai-completions": createOpenAILikeApi(fakeTransport(() => ({ chunks: reply })).transport) };
  section1ConfigValues();
  const registry = section2Granularities(apis);
  const acme = registry.getModels("acme");
  for (const m of acme) {
    const last = (await collect(registry.stream(m, CONTEXT, {}))).at(-1)!;
    out(`    派发 ${m.id.padEnd(16)} → ${m.api === "acme-v1" ? "扩展的 streamSimple" : "内置适配器"}，${describe(last)}`);
  }
  section3Errors(apis);
  section4Compat();
  await section5Streaming();
  await section6Contract();
}

main().catch((error: unknown) => {
  process.stderr.write(`演示失败：${messageOf(error)}\n`);
  process.exitCode = 1;
});
