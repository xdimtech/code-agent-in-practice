# ch11-custom-provider

对应 [第 11 章 接入自家模型](../../book/02-getting-started/ch11-custom-provider.md)。

这是一个按 pi 的规则写的 provider 注册表，外加一个 OpenAI 兼容的流式适配器。注册表做这几件事：

- 四层合成：内置、用户配置、扩展、用户覆盖
- 注册时校验，重新注册时浅合并
- 合成失败时退回内置版本
- 加载期把注册排队，绑定时逐个落地，坏一个不影响别的
- 按 `api` 派发到 `streamSimple` 或内置适配器

适配器负责把各家流式方言收拢成同一套事件。另外还有一个契约检查器，用来查 `streamSimple` 有没有调用宿主的 `onPayload`/`onResponse` 钩子。整个例子零依赖，不连网络，所有「服务端」都是内存里的假 transport。

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| `$VAR`、`${VAR}`、`!command` 配置值，`$$`/`$!` 转义 | `resolve-config-value.ts:221-250`；每次请求都解析、命令不缓存是有意为之（`docs/models.md:172`） | `src/config-value.ts` |
| 层级合成：models.json 改 baseUrl、按 id upsert；扩展给 models 就整体替换 | `provider-composer.ts:168-235` | `src/compose.ts` |
| 校验只看这次传进来的配置，存储是浅合并 | `model-runtime.ts:742-778` | `src/registry.ts` 的 `registerProvider` |
| 合成出错：记进 `compositionErrors`，退回内置或删除 | `model-runtime.ts:245-267`、`:426-435` | `src/registry.ts` 的 `recompose` |
| 加载期排队，flush 时逐个 try/catch | `loader.ts:231-243`、`runner.ts:356-390` | `src/registry.ts` 的 `createProviderApi` |
| 只有 OAuth 的 provider 不造 API key 登录方式 | `provider-composer.ts:301-311` | `src/registry.ts` 的 `authMethods` |
| 按 URL 和 provider id 猜 compat，显式配置逐字段覆盖 | `openai-completions.ts:1572-1707` | `src/compat.ts` |
| 推理字段三选一；`choice.usage`；工具调用按 index/id 拼；缺 `finish_reason` | `openai-completions.ts:485-687` | `src/openai-like.ts` |
| `streamSimple` 应当调用 `onPayload`/`onResponse`（只有注释，没有强制） | `custom-provider-anthropic` 与 `custom-provider-gitlab-duo` 两个示例 | `src/contract.ts`、`src/demo-providers.ts` |

```bash
npm start   # 六段演示：配置值、四种粒度、三条出错路径、compat 猜测、流式拼装、钩子契约
npm test    # 42 个用例
```

需要 Node ≥ 22.6，因为要用 `--experimental-strip-types` 直接运行 TypeScript。没有依赖，所以不用 `npm i`。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 模型、事件、`StreamFn`、注册配置、用户配置 |
| `src/config-value.ts` | 配置值模板解析、命令执行、可选缓存；错误信息只点名、不带值 |
| `src/compose.ts` | 纯函数的四层合成与注册校验 |
| `src/registry.ts` | 注册表：注册/注销/重载、出错回退、认证方式、API key 解析、派发；加载期队列 |
| `src/compat.ts` | `detectCompat` 与 `getCompat` |
| `src/sse.ts` | SSE 分行、半截 JSON 补全 |
| `src/openai-like.ts` | OpenAI 兼容适配器：纯 reducer `step` + `finish`，外加发请求的壳 |
| `src/contract.ts` | 钩子契约检查（observe / enforce 两种模式） |
| `src/demo-providers.ts` | 内置 provider 表、假 transport，两种写法的 `streamSimple`：自己发请求、委托内置适配器 |
| `src/main.ts` | 演示入口 |
| `src/*.test.ts` | `node:test` 用例 |

接入自家模型的三条经验：

1. **能走内置适配器就别写 `streamSimple`。** 只改 `baseUrl`、加 `models`、配 `compat`，三种粒度都不碰流式代码，宿主的脱敏钩子和响应钩子自动生效。非写不可的话，就像 gitlab-duo 那样换好凭证之后委托给内置适配器。自己发请求的 `streamSimple` 会悄悄绕过所有 `before_provider_request` 扩展（演示第 6 段）。
2. **扩展里的 `models` 是替换，不是追加。** 用户在 models.json 里加的本地模型会跟着消失，`modelOverrides` 却还在上面压着。想追加，就先读当前列表，拼好了再整体交回去（演示第 2 段）。
3. **重新注册时，把 `api` 和 `baseUrl` 都再写一遍。** 校验只看这一次传进来的配置，存储却是浅合并的。少写一个字段，结果就是校验失败、旧配置原样保留，看起来像「没生效」（演示第 3 段）。
