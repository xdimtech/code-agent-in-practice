# 8. 可观测性

pi 的可观测性必须分成**两条互不相干的轨**来讲，否则一定会误读：

| | 轨 A：span 级遥测 | 轨 B：会话记录 |
| --- | --- | --- |
| 载体 | `packages/telemetry` SPI | `~/.pi/agent/sessions/*.jsonl` |
| 状态 | **契约已定，一个埋点都没接** | **生产中，全量落盘** |
| 默认 | 不存在（无实现可启用） | 开启 |
| 出网 | 无 exporter | 无（除用户显式 `/share`） |

一句话：**pi 的"可观测性"当前等于"会话 JSONL 可以事后读"，而不是"有一套遥测在跑"。**

---

## 8.1 轨 A：`packages/telemetry` 是一个未接线的 SPI

### 规模与依赖

| 文件 | 行数 | 作用 |
| --- | ---: | --- |
| `src/index.ts` | 357 | 契约类型 + schema 类型推导 + `createTypedSpanStarter` |
| `src/memory.ts` | 219 | `InMemoryTelemetryContext` 参考实现 |
| `src/noop.ts` | 20 | `NOOP_TELEMETRY_CONTEXT` |
| `src/testing/*.ts` | 339 | 适配器一致性测试套件 |
| `README.md` | 464 | 文档（**比源码还长**） |

`package.json:43-46` 只有 devDependencies（`@types/node`、`vitest`）——**运行时零依赖**。

### 抽象只有 span

`src/index.ts:14-22`：

```ts
interface TelemetryContext { startSpan<T>(options, callback): Promise<T> }
interface TelemetrySpan extends TelemetryContext {
  addEvent(name, attributes?); setAttributes(attributes); setStatus(status)
}
```

没有 metric，没有 logger，没有 event bus。四个设计决策：

1. **回调式生命周期，没有公开的 `end()`**（`:15`）——span 在 callback 返回值/Promise settle 时关闭。忘记关 span 这个经典错误在类型层被消除了。
2. **显式传父上下文，不用 `AsyncLocalStorage`**（`README:391`；全仓无 `AsyncLocalStorage` 引用）。代价是每层都要手动传，收益是没有隐式全局状态、没有 ALS 的性能与兼容包袱。
3. **属性值限制为标量与标量数组**（`:1`）——结构化对象和自由文本塞不进去。**这是一道类型层的隐私护栏**，比运行时脱敏更早生效。
4. **schema 是可序列化数据 + 纯类型推导**，`createTypedSpanStarter` 的注释明说 "no runtime schema validation is performed"（`:347-353`）。约束全在 `ExactTelemetryAttributes`（`:140-141`，多余 key 推成 `never`）。

### 没有后端，没有 exporter

仓库里只有两个实现：`noop.ts:11-20`（全空）与 `memory.ts`（进程内数组，`RecordedTelemetrySpan` 在 `:16-25`）。

交叉验证：`package-lock.json` 里 `opentelemetry` 仅 2 次命中（`:5130,5146`），都是 **vitest 的 optional peerDependency**，与 pi 无关。根 + 全部 workspace 包的 package.json 中无任何 `@opentelemetry/*`。`README:13` 说"应用可以自己写 OpenTelemetry / Sentry 适配器"——**那是留给使用方的扩展点，仓库内不提供**。

### ⚠️ 核心事实：零个生产埋点

**核实方法**：grep `startAiSpan|startHarnessSpan` 全仓库，命中只有三类——

| 类别 | 位置 |
| --- | --- |
| 定义 | `packages/agent/src/harness/telemetry.ts:138`（ai）、`:602`（harness） |
| 再导出 | `packages/agent/src/index.ts:105-106` |
| 测试 | `packages/agent/test/harness/telemetry.test.ts`（10 处） |

**`packages/*/src` 下零个调用点。** 配套证据：

- `telemetryContext` 在 `packages/ai/src` 只出现两次——类型字段（`types.ts:127`）和一次对象透传（`api/simple-options.ts:36`）。**没有任何 provider 读取它**。
- `AgentHarness` 的 `context?: TelemetryContext`（`harness/agent-harness.ts:262`）是配置项声明，同文件内无使用点。
- `NOOP_TELEMETRY_CONTEXT` 在 src 中仅被 `packages/agent/src/index.ts:41` 再导出，**无构造点**。
- `packages/coding-agent/package.json:46-66` 的 20 个依赖里**没有 `@earendil-works/pi-telemetry`**——产品根本不依赖它。

**判定：v0.84.4 中没有任何一个 span 会在生产路径上被创建。** "默认开不开"这个问题不成立——它压根没跑起来。

> **写给下游读者的警告**：不要把这章读成"pi 用 OpenTelemetry 追踪 agent loop"。那是设计意图，不是当前实现。任何基于 pi 的产品若要遥测，都得自己接线。

### schema 声明了什么字段

虽然没接线，schema 本身设计得相当专业（`harness/telemetry.ts`，自动生成文档 `packages/agent/docs/telemetry-schema.md`）：

- **`pi.ai.request`**（`:41-114`）：operation / provider / model / api / streaming / deferred；结束时 response.model、response.id、stop_reason、http.status_code、六项 usage token 数、`pi.ai.usage.cost`、chunk_count、**time_to_first_chunk_ms**、error.type。
- **harness 侧**（`:228-568`）：session.id、lane.name、operation.id、turn.id、checkpoint.kind、**step.kind/attempt**、`pi.tool.name`、`pi.tool.call_id`、`pi.tool.is_error`、hook.name、event.type、session.mutation。

**逐项核实：没有 prompt 内容、没有 completion 内容、没有工具参数、没有工具结果、没有文件路径、没有命令字符串、没有 error message 自由文本。** 错误只到 `pi.error.type` / `pi.error.code`，且标注 `cardinality: "low"`。最接近敏感面的是 `pi.tool.name`（工具名，非参数）。

**推断**：`time_to_first_chunk_ms`、`step.attempt`、`compaction.reason` 这类字段的精度说明作者是按真实运维需求设计的，不是照抄 OTel 语义约定。接线大概率排在后续版本。`packages/telemetry/CHANGELOG.md` 显示它在 0.84.0（2026-08-06）一次性加入，之后三个版本无变更。

### ⚠️ `sensitive` 字段是装饰性的

`src/index.ts:30` 声明了 `sensitive?: boolean`。**核实：grep 全仓库，没有任何 schema 条目使用它，也没有任何代码读取它。**

所以不存在运行时脱敏/白名单。约束完全靠三样：TypeScript 精确类型匹配、人工 review、`README:389` 的文字规范。

**判定**：在当前"零埋点"状态下这没有实际风险，但**一旦有人接线，这个字段会给人虚假的安全感**——它看起来像一个会被执行的策略，实际什么都不做。这与[第 5 章 §5.4](./05-tools-permissions.md) 引用的 `docs/security.md:35` 那句"半吊子沙箱会被误认成边界"是同一类陷阱，只是这次出现在遥测侧。

---

## 8.2 真正默认开启的是另一个东西

轨 A 没跑，但仓库里还有一个叫 telemetry 的开关，**它默认开启且真的联网**。两者完全无关，极易混淆。

### `enableInstallTelemetry`

**默认 `true`**（`core/settings-manager.ts:1010`）：

```ts
getEnableInstallTelemetry(): boolean {
  return this.settings.enableInstallTelemetry ?? true;
}
```

开关优先级在 `core/telemetry.ts:8-13`——`PI_TELEMETRY` 环境变量存在时覆盖 settings。判真逻辑（`:3-6`）只认 `1`/`true`/`yes`（大小写不敏感），**其他任何值包括空串都算关闭**。

发送点 `modes/interactive/interactive-mode.ts:1290-1307`：

```
fetch("https://pi.dev/api/report-install?version=...")
```

5 秒超时、fire-and-forget、异常吞掉。触发条件只有两处：首次安装（`:1276`）与 changelog 检测到升级（`:1284`）。`PI_OFFLINE` 在 `:1291` 提前返回。

**实际发送的内容**：URL query 里的版本号 + `User-Agent`。UA 构造在 `utils/pi-user-agent.ts:1-4`：

```
pi/<version> (<platform>; node/<ver>|bun/<ver>; <arch>)
```

**无机器 ID、无用户名、无路径、无会话内容。** 这是一个相当克制的安装计数。

### 同一开关还控制第三方归因 header

`core/provider-attribution.ts:40` —— 开启时给特定 provider 加标识：

| Provider | Header | 位置 |
| --- | --- | --- |
| OpenRouter | `HTTP-Referer: https://pi.dev`、`X-OpenRouter-Title: pi`、`X-OpenRouter-Categories: cli-agent` | `:44-50` |
| NVIDIA NIM | `X-BILLING-INVOKE-ORIGIN: Pi` | `:53` |
| Cloudflare | `User-Agent: pi-coding-agent` | `:60` |

**这一点文档没讲清楚**：用户以为关掉 `enableInstallTelemetry` 只是不报安装数，实际也关掉了向 OpenRouter 声明"我是 pi"。反过来说，不知道这件事的用户在用 OpenRouter 时会被识别为 pi 流量。**归因与遥测共用一个开关是一处设计耦合**，两者的隐私含义不同。

### 文档口径核实

`packages/coding-agent/README.md:310-317` 明确区分了 update check 与 install telemetry，说明 opt-out 方式，并明说**关掉 telemetry 不会关掉版本检查**。`docs/settings.md:60-62,84` 与 `docs/environment-variables.md:84-86` 一致。

**这三处文档与代码一致，没有夸大也没有隐瞒。**

### ⚠️ 一处真实的文档-实现落差：`/privacy` 不存在

`core/settings-manager.ts:117-118` 有 `enableAnalytics`（默认 `false`）与 `trackingId`（`randomUUID()`，`:1032`）。首次启动向导 `modes/interactive/components/first-time-setup.ts:74` 的文案写：

> Opting in stores a tracking identifier in settings.json and enables anonymous usage analytics. … **You can observe what is shared using `/privacy`** and make changes anytime in settings.json.

**核实结果**：

- `getEnableAnalytics()` / `getTrackingId()`（`settings-manager.ts:1019,1023`）在 `src/` 中**零调用点**，只有定义与 `test/first-time-setup.test.ts` 的断言。
- **`/privacy` 命令不存在**。`core/slash-commands.ts:19-43` 的 23 个内置命令里没有它。整个 `coding-agent/src` 里 "privacy" 这个词**只出现在上面那句文案自己里面**。

也就是说：这个对话框向用户承诺了一个查看入口，而那个入口不存在；同时它要收集的 analytics 也没有任何消费者——**勾选"同意"之后实际什么都不会发生**。

**但必须如实说明影响面极小**，因为该向导有**三重门禁**（`cli/startup-ui.ts:122-134`）：

1. `isOfficialDistribution(...)` —— 非官方分发直接 false
2. `areExperimentalFeaturesEnabled()` —— 未设 `PI_EXPERIMENTAL=1` 直接 false
3. settings.json 已存在则不跑

`docs/settings.md:61` 自己也承认"目前仅在实验性首次设置中询问"。

**判定：这是"设计已写、实现未跟上"的半成品，不是隐瞒。** 但文案里那句 `/privacy` 是实打实的失效承诺，属于应当修掉的缺陷。**给下游厂商的探针：如果某家启用了这套 analytics 却没实现 `/privacy`，问题就从半成品升级为真实的透明度缺陷。**

---

## 8.3 日志与调试：几乎没有

### 没有结构化日志

`packages/*/src` 下**没有 `logger.ts` / `log.ts`**，也没有 `createLogger` / `LogLevel` / `log.debug` 任何符号。输出全是裸 `console.*`：

| 包 | `console.*` 处数 |
| --- | ---: |
| `coding-agent` | 129 |
| `ai` | 12（几乎都在 `src/cli.ts:33-117`） |
| `agent` | 1（`proxy.ts:366`） |
| `tui` / `server` / `client` / `protocol` / `telemetry` / `evals` | 0 |

**没有分级。** TUI 模式下 stdout 被劫持重定向到 stderr（`core/output-guard.ts:44-70`，`:55-62` 用 `rawStderrWrite` 替换 `process.stdout.write`）——因为任何漏出的 stdout 写入都会撕碎差分渲染的屏幕状态。

### 没有 `PI_DEBUG`，但有七个未文档化的调试变量

**`PI_DEBUG` 和 `PI_LOG` 都不存在**；`process.env.DEBUG` / `NODE_DEBUG` / `VERBOSE` 在 `packages/*/src` 零命中。

环境变量**没有单一真相源**，三处各自不全：`cli/args.ts:387-434`（`--help`，其中 `PI_*` 只有 `:430-434` 五六个）、`docs/environment-variables.md:79-95`、`README.md:671-696`。

调试类变量**全部未出现在上述任何文档里**：

| 变量 | 作用 | 位置 |
| --- | --- | --- |
| `PI_TIMING` | 启动耗时打点 → stderr | `core/timings.ts:6`（打印 `:34-50`） |
| `PI_STARTUP_BENCHMARK` | 初始化 TUI、打印 timings 后退出 | `main.ts:911` |
| `PI_TUI_DEBUG` | 每帧渲染 dump 到 `/tmp/tui/render-*.log` | `tui/src/tui-main-screen.ts:568` |
| `PI_DEBUG_REDRAW` | 全量重绘原因 → `<logDir>/pi-debug.log` | `tui/src/tui-main-screen.ts:320-327` |
| `PI_TUI_WRITE_LOG` | **把写往终端的每一个字节落盘** | `tui/src/terminal.ts:138-151`（追加 `:478-480`） |
| `PI_EXPERIMENTAL` | 实验特性开关 | `core/experimental.ts:4` |
| `PI_EVAL_ARTIFACT_DIR` | eval 产物 + `runs.jsonl` | `evals/src/vitest-evals/reporter.ts:15` |

**`PI_TUI_WRITE_LOG` 有隐私含义**：它记录终端字节流，**包含渲染出来的 prompt、模型回复、文件内容**。只写本地文件、无外发，但用户不会从任何文档知道它存在。

**这七个变量的分布说明了一件事：pi 的调试设施压倒性地偏向终端渲染问题**（写字节流、重绘原因、渲染 dump），而不是 agent/provider 行为。这与[第 1 章](./01-product-teardown.md) 里 tui 包 17,000 行的体量是一致的——TUI 是这个项目真正的技术难点所在。

### 没有 trace / 录制回放

`packages/ai/src` 内没有 `appendFileSync` / `createWriteStream` / `.jsonl` 写入（唯一 `writeFileSync` 是 `cli.ts:28` 的凭据持久化）。无 `PI_TRACE` / `PI_RECORD` / `PI_REPLAY` / `logRequest` / `rawBody` 等符号。

两个最接近的设施都不是录制回放：

- `api/openai-codex-responses.ts:856-908` 的 `OpenAICodexWebSocketDebugStats` —— 纯内存计数，不落盘；
- `api/pi-messages.ts:34-35,361-362` 的 `debug?: boolean` —— 给请求 URL 加 `?debug=1` 以取服务端路由 header，本地不写文件。

**复现 provider 行为的唯一可用材料是会话 JSONL（§8.4）。** 对一个要适配 40 个 provider 的项目来说，**这是本章最实际的短板**——provider 的流式协议差异是最容易出 bug 也最难复现的地方，而这里没有请求/响应级的录制能力。

### `/debug` 是隐藏的自用工具

- 文本命令 `modes/interactive/interactive-mode.ts:3093-3097`；快捷键 `Shift+Ctrl+D` 走同一处理器（`tui/src/tui.ts:856-859`，绑定于 `interactive-mode.ts:2903`）。
- 实现 `handleDebugCommand()`（`:6402-6433`）：`writeFileSync` **覆盖写** `~/.pi/agent/pi-debug.log`（路径 `config.ts:573-575`），内容 = 时间戳 + 终端尺寸 + 每行渲染文本及其可见宽度 + **`this.session.messages` 全量 JSONL**（`:6420`）。
- **不注册进补全**：`core/slash-commands.ts:19-43` 的 23 个内置命令里没有它。

另有崩溃日志 `pi-crash.log`（`tui/src/tui-main-screen.ts:517-529`），**仅在"渲染行宽超过终端宽度"这一 TUI 不变量被破坏时**写，dump 全部渲染行后 `throw`。

**推断**：`/debug` 不进补全说明它是作者自用的 bug-report 收集器——一条命令同时抓到渲染状态和会话内容，正好是 issue 里需要的两样东西。

---

## 8.4 轨 B：会话记录是 pi 真正的可观测性

### 存储位置与格式

CLI 实际使用的实现是 `core/session-manager.ts`，**JSONL，一会话一文件**：

- 根目录 `~/.pi/agent/`（`config.ts:529`），sessions 目录（`:567-570`）
- **按 cwd 分桶**的目录名，`/ \ :` → `-`（`getDefaultSessionDirPath()` `:476-482`）
- 文件名 `<ISO时间戳>_<sessionId>.jsonl`（`:954`）
- 首行 `SessionHeader`，其后每行一个 `SessionEntry`；`CURRENT_SESSION_VERSION = 3`（`:30`）
- 写入 `_persist()`（`:1016-1043`）用 `appendFileSync(..., JSON.stringify(entry) + "\n")`（`:1022,1041`）；整文件重写 `_rewriteFile()`（`:980-991`）
- 文档 `docs/session-format.md:1-27` 与代码一致

**一个容易忽略的行为**（`:1019-1027`）：**在出现第一条 assistant 消息之前不落盘**——没有模型回复的会话不产生文件。避免了误启动留一堆空文件。

### entry 结构与内容

`SessionEntryBase`（`:46-51`）含 `type` / `id` / **`parentId`** / `timestamp`（ISO 串）——**树形结构**，对应[第 3 章 §3.7](./03-agent-loop.md) 的会话树。联合类型在 `:144-153`，主体是 `SessionMessageEntry`（`:53-56`）承载 `AgentMessage`。

每条 assistant 消息带（`packages/ai/src/types.ts`）：`provider`(:430)、`model`(:431)、`responseModel`(:432)、`responseId`(:434)、`usage`(:436)、`stopReason`(:437)、`errorMessage`(:439)。

另有 `CompactionEntry`（`session-manager.ts:69-80`，带 `tokensBefore` 与 `usage`）与 `BashExecutionMessage`（`core/messages.ts:28-39`，含 `command`/`output`/`exitCode`/`truncated`/`fullOutputPath`）。

**信息密度相当高**：`responseModel` 与 `model` 分开存意味着可以事后发现 provider 静默换了模型；`responseId` 让你能拿着 ID 去找 provider 对账。

### cost 计算：构建期固化价格表

- **价格表是构建期生成、硬编码进包的**：`packages/ai/src/models.generated.ts:1-2` 由 `scripts/generate-models.ts` 生成，该脚本在 `:1430-1432` 拉取 `https://models.dev/api.json`。**运行时对 models.dev 零引用。**
- 价格 schema `types.ts:803-818`（$/百万 token，支持分档）。用户可用 `~/.pi/agent/models.json` 覆盖（`core/model-config.ts:144-186`）。
- 计算 `calculateCost(model, usage)`（`packages/ai/src/models.ts:878-898`）处理分档（`:881-887`）与 **Anthropic 1 小时缓存写入 2× 规则**（`:890-895`）；被各 provider adapter 调用（`anthropic-messages.ts:610`、`openai-completions.ts:1537`）。
- 聚合 `core/usage-totals.ts:11-28,37-71`、`AgentSession.getSessionStats()`（`agent-session.ts:3323-3372`）、缓存浪费统计 `core/cache-stats.ts`。

**"构建期固化 + 运行时零依赖"是正确的取舍**——价格查询不应该成为启动时的网络依赖，而 `models.json` 覆盖给了不等版本发布的逃生舱。配合 `cache-stats.ts` 专门统计缓存浪费，说明作者真的在盯成本（呼应[第 4 章 §4.1](./04-context-engineering.md) 的缓存经济学讨论）。

### 展示：没有 `/cost`，数据在状态栏

`core/slash-commands.ts:19-43` **没有 `/cost` 命令**。数据在状态栏（`modes/interactive/components/footer.ts`）：`:130-133` ↑/↓/R/W token、`:142-144` `$x.xxx`（订阅制显示 `(sub)`）、`:150-153` 上下文占比。详细报告走 `/session`（`interactive-mode.ts:6172-6231`）。

### 两套未启用的并行实现

| 实现 | 位置 | 被谁用 |
| --- | --- | --- |
| **sqlite-node** | `packages/session-backends/sqlite-node/` | **没有人** |
| **v4 JSONL** | `packages/agent/src/harness/session/jsonl/` | **没有人** |

- sqlite-node：包名 `@earendil-works/pi-session-backend-sqlite-node`，基于 `node:sqlite`，提供 SessionRepository、migrations、物化表、可选 **FTS5 搜索**（`README.md:1-23`）。它不在任何其他包的 dependencies 里；`coding-agent/package.json:46-66` 只列 agent-core/ai/client/protocol/tui。全仓库 src 零 import。根 `package.json:16-17` 构建它只为发布。
- v4 JSONL：`storage.ts:267-271` 追加、`:32-45` **原子发布**、header 类型 `types.ts:47-58`。同样未被 coding-agent 使用。

**这是本次拆解发现的第三处 v1/v2 并存**（前两处是 compaction 与 truncate，见[第 4 章 §4.3](./04-context-engineering.md)）。模式完全一致：v2 在 `packages/agent/harness/` 下写好、导出、测过，产品不用。

### 可审计性：能复盘，不能防篡改

| 维度 | 结论 | 证据 |
| --- | --- | --- |
| 工具调用**参数** | **完整逐字记录** | `_persist()` 是无 replacer、无长度上限的 `JSON.stringify`（`:1022,1034,1041`）；persist 路径无 strip/sanitize/redact（仅 `:1138` 对会话名做换行清理）；导出同理（`core/session-export.ts:29-37`） |
| 工具**结果** | **记录的是已截断版本** | 截断发生在工具执行时、构造 `ToolResultMessage` 之前；限额 `core/tools/truncate.ts:11-13` |
| bash 完整输出 | **不在会话记录里** | 写临时文件，会话只留路径（`core/bash-executor.ts:113-127`，文案 `core/messages.ts:94-95`）；**该临时文件不在 session 目录内** |
| append-only | **不是** | 编辑与分支删除触发整文件重写（`_rewriteFile()` 调用点 `:910,919,1486`） |
| 完整性校验 | **无** | 两套实现中都没有哈希、签名或校验和 |
| 图片 | base64 内联 | `packages/ai/src/types.ts:367-371` |

好消息是**截断是可检测的**（`truncated` / `fullOutputPath` / `details.truncation`），读记录的人不会把截断当成全部。

**判定：会话文件足以做"我当时让模型干了什么、它调了什么工具、花了多少钱"的事后复盘，但不满足防篡改审计。** 可原地重写 + 无完整性校验 + 大输出不完整，三条叠加意味着它不能作为合规证据。对一个本地开发工具这是合理取舍，但**如果下游厂商要把 pi 用在受监管场景，这是必须先补的一环**。

---

## 8.5 错误上报：刻意不做

### 运行时无 Sentry

全仓库 `sentry`（不分大小写）命中 5 处，**全部是 CI 配置或文档散文**：

| 位置 | 内容 |
| --- | --- |
| `.github/workflows/issue-gate.yml:20` | `TRUSTED_BOT_AUTHORS` 白名单含 `'sentry[bot]'` |
| `.github/workflows/pr-gate.yml:21` | 同上 |
| `packages/evals/README.md:38` | 指向 `getsentry/vitest-evals`（测试库） |
| `packages/telemetry/README.md:13,62` | 散文："可以写 OpenTelemetry、Sentry 等适配器" |

`packages/*/src` 中**零个 `@sentry/*` import**。根 + 全部 workspace 包的 package.json 中无 `@sentry/*`、`bugsnag`、`rollbar`、`@datadog/*`、`posthog`、`mixpanel`、`amplitude`。

### 未捕获异常：本地打印 + 非零退出

- **`unhandledRejection`：无生产处理器**（唯一命中是 `packages/agent/test/agent.test.ts:347` 的断言）。
- `uncaughtException`：仅交互模式注册（`interactive-mode.ts:4062-4064`，`process.prependListener`，清理时移除）。处理体 `uncaughtCrash()`（`:4000-4017`）：注销信号处理器 → 杀掉被跟踪的 detached 子进程 → `ui.stop()` 恢复终端 → `console.error` + 打印错误（`:4014-4015`）→ `exit(1)`。**只打 stderr，不写文件，不发网络。**
- 终端已死的特殊路径：`:4054-4059` → `emergencyTerminalExit()`（`:3981-3988`），退出码 129。
- 信号处理：交互模式 `:4029-4052`；print 模式 `modes/print-mode.ts:50-66`；rpc 模式 `modes/rpc/rpc-mode.ts:365-380`。
- 入口 `cli.ts:22` 是裸 `main(process.argv.slice(2));`，**无 top-level catch**。

**`uncaughtCrash` 的顺序是对的**：先杀子进程再恢复终端再打印。漏掉任何一步用户都会得到一个坏掉的终端或一堆孤儿进程。

**但缺 `unhandledRejection` 处理器是一处真实遗漏**：异步链路里逃逸的 rejection 会走 Node 默认行为（打印堆栈、非零退出），**TUI 来不及走 `ui.stop()` 恢复终端状态**——用户会看到一个 alternate screen 没退、光标没恢复的终端。考虑到 `uncaughtException` 那条路径被仔细处理过，这更像遗漏而非设计。

### 非 LLM 出网端点全清单

| URL | 位置 | 触发 |
| --- | --- | --- |
| `pi.dev/api/report-install?version=` | `interactive-mode.ts:1299` | 首装/升级；`enableInstallTelemetry` + `PI_OFFLINE` 双重门禁 |
| `pi.dev/api/latest-version` | `utils/version-check.ts:5`（fetch `:56`） | 启动版本检查；受 `PI_OFFLINE`(`:53`) / `PI_SKIP_VERSION_CHECK`(`:98`)，**不受 telemetry 开关控制** |
| `pi.dev/api/models/providers/<id>` | `core/remote-catalog-provider.ts:6,81-83` | 远程模型目录 overlay |
| `pi.dev/api/installer/releases` | `package-manager-cli.ts:50`（fetch `:82`） | `pi update self`，用户主动 |
| `api.github.com/repos/<repo>/releases/latest` | `utils/tools-manager.ts:109` | 自动安装 rg/fd 等辅助二进制 |
| `radius.pi.dev/v1/artifacts`（POST） | `modes/interactive/session-share.ts:110-123` | **仅 `/share` 命令** |
| GitHub secret gist（`gh` CLI 子进程） | `session-share.ts:76,139-146` | `/share` 回退路径 |

`packages/ai/src` 中所有 `fetch(` 都是 LLM provider 的 OAuth/配置端点，无上报端点。

**逐字结论：没有任何代码路径会自动把异常对象、堆栈、崩溃日志或会话内容发往任何端点。** 自动出网仅限版本号 ping、版本检查、模型目录拉取。

### ⚠️ `/share` 上传的内容比名字暗示的多

`exportSessionForShare()`（`session-share.ts:24-42`）在导出的 JSONL 里**额外附加一条 `pi.share` 自定义条目**，内含：

```ts
data: {
  systemPrompt: session.state.systemPrompt,        // 全文
  tools: session.state.tools.map(t => ({
    name: t.name, description: t.description, parameters: t.parameters,
  })),
}
```

上传时 query 带 `visibility=organization`（`:113`）。

**也就是说 `/share` 分享的不只是对话，还包括 system prompt 全文和全部工具的 schema。** 对调试与复现是对的设计（缺了这两样，别人拿到转录也复现不出来），但**用户从命令名 `/share` 不会预期到 system prompt 被一并上传**——而 system prompt 里含 `<project_context>`（AGENTS.md 全文，见[第 4 章 §4.1](./04-context-engineering.md)），那可能包含内部规范。

必须同时说明：这是**用户显式触发**的命令，需要 radius provider + token，不是后台行为。所以是"知情不足"问题，不是"偷传"问题。

### 没有自检命令

**没有 `pi doctor` / `health` / `diagnose`。** CLI 子命令全集（`cli/args.ts:267-275`）：`install`、`remove`、`uninstall`、`update`、`list`、`config`、`auth`。

最接近的是 **`pi auth check`**（`cli/auth-check.ts`，分发于 `main.ts:174-204`）：探测凭据可用性，退出码 0=ready / 1=not_ready / 2=invalid，支持 `--json`（`:196-198`）。**这个设计对 CI 很友好**——三态退出码比布尔值有用。

代码里的 "diagnostics" 指**启动配置告警**而非自检：`core/settings-diagnostics.ts` → `reportDiagnostics()`（`main.ts:97-102`，stderr 着色），error 级别在 `:608-609` 直接 `exit(1)`。

`--version` / `-v`（`args.ts:93`，处理 `main.ts:614-616`）只 `console.log(VERSION)` 后 exit(0)——**不打印平台、Node 版本、配置路径，不发网络**。对比之下发往 pi.dev 的 UA 里确实含 platform/arch/runtime（`utils/pi-user-agent.ts:2-3`），但 `--version` 自己不展示这些。**这对 issue 报告是不方便的**——`pi doctor` 的缺失让用户没法一条命令交出环境信息，这大概也是 `/debug` 存在的原因。

---

## 8.6 本章结论

**pi 的可观测性是"轨 B 在跑、轨 A 是空壳"。** 必须分开评价，否则会同时高估和低估它。

轨 A（span 遥测）值得肯定的是**契约设计质量**：

- 回调式生命周期，类型层消除"忘记关 span"；
- 显式传父上下文，不引入 `AsyncLocalStorage` 的隐式全局；
- 属性值限制为标量，把隐私护栏放在类型层；
- schema 字段精度（`time_to_first_chunk_ms` / `step.attempt` / `compaction.reason`）说明按真实运维需求设计；
- exporter 完全外置，npm 消费者自带后端，不给 CLI 用户增加出网面。

但它**一个埋点都没接**，且 `sensitive` 字段是装饰性的。**准确表述：这是一个先定契约与词汇表、暂不接线的设计稿。**

轨 B（会话记录）是实际可用的：JSONL 树形结构、每条消息带 provider/model/responseId/usage/cost、构建期固化价格表、缓存浪费统计。**能复盘，不能防篡改。**

真实短板四条：

1. **没有 provider 请求/响应级的录制回放** —— 对一个适配 40 个 provider 的项目，这是最痛的缺失，流式协议差异最难复现；
2. **没有结构化日志、没有 `PI_DEBUG`**，129 处裸 `console.*` 无分级；七个调试变量全未文档化；
3. **缺 `unhandledRejection` 处理器** —— 逃逸的 rejection 会留下坏掉的终端状态；
4. **没有 `pi doctor`** —— 用户无法一条命令交出环境信息。

三处值得下游注意的透明度问题（均已核实，且都不构成"偷传"）：

- **归因 header 与安装遥测共用一个开关**（`provider-attribution.ts:40`），两者隐私含义不同；
- **`/privacy` 命令被文案承诺但不存在**（`first-time-setup.ts:74`），且 analytics 无消费者——半成品，且有三重门禁，实际影响面极小；
- **`/share` 一并上传 system prompt 全文与工具 schema**（`session-share.ts:24-42`），而 system prompt 含 AGENTS.md 全文。

给下游拆解的探针：

- **`packages/telemetry` 有没有被真正接线** —— 这是最容易区分"照抄 pi"与"自己做过工程"的一处
- 有没有换成 OpenTelemetry / 自建后端，exporter 放在哪一层
- **`sensitive` 字段有没有从装饰性变成运行时脱敏**
- `enableInstallTelemetry` 的默认值有没有改，有没有新增上报端点（**这是厂商最可能动手的地方**）
- 归因 header 有没有从遥测开关里拆出来
- 会话记录有没有加完整性校验或改成严格 append-only
- 有没有补上 provider 级的录制回放
- sqlite-node 后端有没有被真正启用（pi 自己没用）
- 有没有加 `pi doctor` / `unhandledRejection` 处理器
