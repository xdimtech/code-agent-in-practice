import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTINS, fakeTransport, selfSendingStream, sseChunks } from "./demo-providers.ts";
import { createOpenAILikeApi } from "./openai-like.ts";
import { createProviderApi, createRegistry, mergeRegistration } from "./registry.ts";
import type { StreamEvent, StreamFn, UserConfig } from "./types.ts";

const USER: UserConfig = {
  deepseek: {
    models: [{ id: "local", baseUrl: "http://localhost:8000/v1" }],
    modelOverrides: { "deepseek-chat": { contextWindow: 64_000 } },
  },
};

const noop: StreamFn = async function* () {};
const make = (userConfig: UserConfig = USER, env: Record<string, string> = {}) =>
  createRegistry({ builtins: BUILTINS, userConfig, apis: { "openai-completions": noop }, env, exec: () => undefined });
const ids = (registry: ReturnType<typeof make>, provider: string) => registry.getModels(provider).map((m) => m.id);

async function collect(stream: AsyncIterable<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("分层：用户配置按 id upsert，modelOverrides 在最顶层", () => {
  const registry = make();
  assert.deepEqual(ids(registry, "deepseek"), ["deepseek-chat", "deepseek-reasoner", "local"]);
  assert.equal(registry.getModels("deepseek")[0]!.contextWindow, 64_000);
  assert.equal(registry.getModels("deepseek")[2]!.api, "openai-completions", "api 从第一个内置模型继承");
});

test("粒度一：只给 baseUrl，所有模型改地址，模型列表不变", () => {
  const registry = make();
  registry.registerProvider("deepseek", { baseUrl: "https://gw.example" });
  assert.deepEqual(ids(registry, "deepseek"), ["deepseek-chat", "deepseek-reasoner", "local"]);
  assert.ok(registry.getModels("deepseek").every((m) => m.baseUrl === "https://gw.example"));
});

test("粒度二：给 models 就整体替换——用户追加的模型被丢掉，但用户覆盖仍生效", () => {
  const registry = make();
  registry.registerProvider("deepseek", { models: [{ id: "deepseek-chat" }, { id: "new-one", maxTokens: 4_096 }] });
  assert.deepEqual(ids(registry, "deepseek"), ["deepseek-chat", "new-one"]);
  assert.equal(registry.getModels("deepseek")[0]!.contextWindow, 64_000);
  assert.equal(registry.getModels("deepseek")[1]!.baseUrl, "https://api.deepseek.com", "新模型从第一个下层模型继承地址");
});

test("粒度三：只有 oauth 的新 provider 没有 API key 入口；内置 provider 加 oauth 后两种都有", () => {
  const registry = make();
  registry.registerProvider("corp", { api: "openai-completions", baseUrl: "https://corp.example", oauth: { name: "SSO" }, models: [{ id: "c" }] });
  registry.registerProvider("deepseek", { oauth: { name: "账号" } });
  assert.deepEqual(registry.authMethods("corp"), ["oauth"]);
  assert.deepEqual(registry.authMethods("deepseek"), ["apiKey", "oauth"]);
  assert.deepEqual(ids(registry, "deepseek"), ["deepseek-chat", "deepseek-reasoner", "local"], "oauth 不碰模型");
});

test("粒度四：streamSimple 只接管 api 对得上的模型", async () => {
  const server = fakeTransport(() => ({ chunks: sseChunks([{ text: "custom" }]) }));
  const registry = make();
  registry.registerProvider("acme", {
    api: "acme-v1",
    baseUrl: "https://acme.example",
    streamSimple: selfSendingStream(server.transport),
    models: [{ id: "a" }, { id: "b", api: "openai-completions" }],
  });
  const [a, b] = registry.getModels("acme");
  assert.deepEqual((await collect(registry.stream(a!, { messages: [] }, {})))[0], { type: "text_delta", delta: "custom" });
  assert.deepEqual(await collect(registry.stream(b!, { messages: [] }, {})), [], "b 走内置适配器（这里是什么也不发的 noop）");
  assert.equal(server.received().length, 1);
});

test("没有对应适配器：stream 不抛错，给一个 error 事件", async () => {
  const registry = make();
  const model = { ...registry.getModels("deepseek")[0]!, api: "nobody-v1" };
  assert.deepEqual(await collect(registry.stream(model, { messages: [] }, {})), [{ type: "error", message: "没有注册 api 为 nobody-v1 的适配器" }]);
});

test("streamSimple 不带 api：注册时就报错", () => {
  assert.throws(() => make().registerProvider("x", { baseUrl: "https://x", streamSimple: noop }), /注册 streamSimple 时必须给 "api"/);
});

test("重新注册：浅合并，undefined 不覆盖；models 整个换掉", () => {
  const merged = mergeRegistration({ baseUrl: "https://a", api: "v1", models: [{ id: "m1" }, { id: "m2" }] }, { baseUrl: undefined, models: [{ id: "m3" }] });
  assert.deepEqual(merged, { baseUrl: "https://a", api: "v1", models: [{ id: "m3" }] });
});

test("重新注册的校验只看这一次：上次写过的 api、baseUrl 都不算，坏配置抛错且存储不变", () => {
  const registry = make();
  registry.registerProvider("p", { api: "openai-completions", baseUrl: "https://p", models: [{ id: "p1" }] });
  assert.throws(() => registry.registerProvider("p", { models: [{ id: "p2" }] }), /没有指定 "api"/);
  assert.throws(() => registry.registerProvider("p", { api: "openai-completions", models: [{ id: "p2" }] }), /必须给 "baseUrl"/);
  assert.deepEqual(ids(registry, "p"), ["p1"]);
  registry.registerProvider("p", { api: "openai-completions", baseUrl: "https://p2", models: [{ id: "p2" }] });
  assert.deepEqual(ids(registry, "p"), ["p2"]);
});

test("重新注册通过校验后是浅合并：这次没写的 oauth 沿用上一次", () => {
  const registry = make();
  registry.registerProvider("deepseek", { oauth: { name: "账号" } });
  registry.registerProvider("deepseek", { baseUrl: "https://gw.example" });
  assert.deepEqual(registry.authMethods("deepseek"), ["apiKey", "oauth"]);
  assert.ok(registry.getModels("deepseek").every((m) => m.baseUrl === "https://gw.example"));
});

test("unregister：回到内置 + 用户配置", () => {
  const registry = make();
  registry.registerProvider("deepseek", { models: [{ id: "only" }] });
  registry.unregisterProvider("deepseek");
  assert.deepEqual(ids(registry, "deepseek"), ["deepseek-chat", "deepseek-reasoner", "local"]);
});

test("用户配置改坏：内置 provider 退回内置版本，新 provider 被拿掉，错误攒在 getError", () => {
  const registry = make();
  registry.reloadUserConfig({ deepseek: { models: [{ id: "deepseek-chat", maxTokens: 0 }] }, lab: { models: [{ id: "l" }] } });
  assert.deepEqual(ids(registry, "deepseek"), ["deepseek-chat", "deepseek-reasoner"]);
  assert.equal(registry.getModels("deepseek")[0]!.contextWindow, 128_000);
  assert.deepEqual(ids(registry, "lab"), []);
  const error = registry.getError() ?? "";
  assert.match(error, /Provider "deepseek": .*maxTokens 必须是正数/);
  assert.match(error, /Provider "lab": .*没有指定 "api"/);
  registry.reloadUserConfig(USER);
  assert.equal(registry.getError(), undefined, "改好之后错误清空");
});

test("API key：扩展 > 用户配置 > 内置环境变量名；解析失败的错误点名变量", () => {
  const registry = make({}, { DEEPSEEK_API_KEY: "builtin-key", CUSTOM: "ext-key" });
  assert.equal(registry.resolveApiKey("deepseek"), "builtin-key");
  registry.registerProvider("deepseek", { apiKey: "$CUSTOM" });
  assert.equal(registry.resolveApiKey("deepseek"), "ext-key");
  registry.registerProvider("deepseek", { apiKey: "$NOPE" });
  assert.throws(() => registry.resolveApiKey("deepseek"), /环境变量未设置（NOPE）/);
});

test("加载期排队：绑定时逐个注册，坏的报错、好的生效；绑定前 unregister 会从队列里删掉", () => {
  const api = createProviderApi();
  api.registerProvider("good", { api: "openai-completions", baseUrl: "https://g", models: [{ id: "g" }] });
  api.registerProvider("bad", { streamSimple: noop });
  api.registerProvider("dropped", { api: "openai-completions", baseUrl: "https://d", models: [{ id: "d" }] });
  api.unregisterProvider("dropped");
  const registry = make();
  const errors = api.bind(registry);
  assert.deepEqual(errors.map((e) => e.providerId), ["bad"]);
  assert.deepEqual(ids(registry, "good"), ["g"]);
  assert.deepEqual(ids(registry, "dropped"), []);
  assert.throws(() => api.registerProvider("bad", { streamSimple: noop }), /必须给 "api"/, "绑定之后直接抛给调用者");
});

test("内置适配器经注册表派发，拿到完整的一轮", async () => {
  const server = fakeTransport(() => ({ chunks: sseChunks([{ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }]) }));
  const registry = createRegistry({ builtins: BUILTINS, userConfig: {}, apis: { "openai-completions": createOpenAILikeApi(server.transport) }, env: {}, exec: () => undefined });
  const events = await collect(registry.stream(registry.getModels("deepseek")[0]!, { messages: [{ role: "user", content: "hi" }] }, {}));
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(server.received()[0]!.url, "https://api.deepseek.com/chat/completions");
});
