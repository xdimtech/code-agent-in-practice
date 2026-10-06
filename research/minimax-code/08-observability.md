# 8. 可观测性与运维

> 对照基准：[pi 第 8 章](../pi/08-observability.md)。pi 有两条轨：一个没接线的 telemetry SPI，和一份 JSONL 会话记录；日志几乎没有，错误上报刻意不做。minimax-code 是一个有账号的产品，它要回答的问题不一样：**能往外发什么、默认发不发、发之前怎么把它变成计数**。

| | pi | minimax-code |
| --- | --- | --- |
| 遥测 | SPI 有、没接线；另有一个默认开的安装统计 | 三个通道（usage / metrics / diagnostics），**全部默认关**，各自单独 opt-in |
| 全局关闭 | — | `MCODE_DISABLE_TELEMETRY=1`、`DO_NOT_TRACK=1`，优先级最高 |
| 发之前能看 | — | `mcode telemetry preview`，永不发送 |
| 本地日志 | 几乎没有 | 统一 logger 门面，按小时滚动，50 MiB / 512 MiB / 7 天 |
| 崩溃记录 | — | incident 文件 schema 2，本地保留 7 天 / 200 个 |
| 错误上报 | 刻意不做 | 有，诊断通道 opt-in 后才发，绑账号、加密 |
| 用户反馈 | `/share` 发 gist | 反馈附「诊断计数」，原文与文件名不出本机 |
| 自检命令 | 没有 | `/doctor` 只查配置文件 |

一句话：pi 是「几乎什么都不记，也什么都不发」；minimax 是「本地记很多，默认什么都不发，opt-in 后发的也是计数」。

## 8.1 三个通道，一个判定函数

【文档】`docs/telemetry.md:3`：三个通道默认全关，每一个都要单独 opt-in；打开 usage 不等于授权另外两个。登录、模型请求、更新检查、反馈是另外的流量，不归这三个开关管。配置在 `~/.minimax/config.yaml`（`:7`），形如：

```yaml
telemetry:
  enabled: false      # usage
  metrics: false
  diagnostics: false
```

【代码事实】默认值在 `config/src/config.ts:1773`：`telemetry: { enabled: false, metrics: false, diagnostics: false }`。判定只有一个函数，`config/src/telemetry-policy.ts` 的 `isTelemetryChannelEnabled()`，注释是：

> True only when the channel is explicitly opted in and no global opt-out is set. An unreadable config never authorizes an upload.

实现分两步：先看 `MCODE_DISABLE_TELEMETRY`（`:5` 定义）和 `DO_NOT_TRACK` 是否匹配 `1 / true / yes / on`（不分大小写），匹配就返回 false；再在 `try` 里读配置，**只有** `readConfigured() === true` 才返回 true，读配置抛异常也返回 false。

【推断】这三行有两个刻意的点：环境变量是**关**的方向优先（用户在 shell 里一设，任何配置都翻不过来）；配置读不出来按「没授权」处理，而不是按「上次的值」或「默认值」。一个损坏的 `config.yaml` 不会意外打开上传。

### 发之前能看

【文档】`docs/telemetry.md:22`：`mcode telemetry status` 列出三个通道各自的状态；`mcode telemetry preview` 构造一个样例请求打印出来，**永不发送**；通道关闭时 preview 给 `request: null`。

【代码事实】`tui/src/cli/telemetry-command.ts:19-60`：status 输出每个通道的策略、`optOutEnvironment`（被哪个环境变量挡住）；关闭时 preview 的结果是 `request: null` 加一句「Usage telemetry is disabled. No business telemetry request will be sent.」。`tui/src/analytics/business-telemetry.ts:132-136` 的 `blockedBy` 取值就是那两个环境变量名。

## 8.2 usage：每个事件一个新 ID

【文档】`docs/telemetry.md:26-67` 描述了请求的形状：urlencoded 的 `data`（base64 编码的 JSON）加一个 `ext`（`crc=<数字>`）。信封字段有 `identities.$identity_cookie_id`、`distinct_id`、`lib`、`type: track`、`event`、`time`；公共属性有 surface（tui）、os、region、build_env、app_version。事件只有十种：启动、登录点击、登出点击、登录结果、side session 生命周期、发送消息，以及 slash / at 两个菜单各自的展示与点击。每个事件的字段都是枚举（`:60-67`），例如 `slash_command_click` 的 `command_type` 只有 `skill`、`new_chat`、`summarize`、`plan_mode`、`goal_mode`、`other` 六个取值——用户敲了哪个自定义 skill 不在其中。

【文档】不发送的列表写得比发送的长（`:69`）：账号 ID、设备 ID、工作区路径与名称、会话 ID、模型名、prompt、回复、文件名、命令文本、插件名、凭据。随机 ID 不落盘，请求不带鉴权头。文档也承认了一件它控制不了的事（`:71`）：接收方能看到来源 IP。

【代码事实】随机 ID 的实现在 `business-telemetry.ts:221-224`：

```ts
// A fresh ID satisfies the receiver's envelope without linking separate events.
const id = randomUUID();
```

`distinct_id` 和 `$identity_cookie_id` 都是这个值，每个事件新生成一次。属性按 `EVENT_PROPERTY_KEYS[event]` 白名单挑（`selectEventProperties`），白名单外的键不发。

【推断】接收方的信封格式要求有一个用户标识字段；minimax 填了，但每个事件换一个，于是两个事件之间在协议层面连不起来。这是「满足格式、不满足追踪」的写法。代价是：产品方从这份数据里只能数「发生了多少次」，数不了「多少人」「一个人用了多久」。

【文档】`:82`：待发事件只在内存里排队；「This repository does not define or verify server-side retention.」——服务端存多久，本仓库不定义也不验证。

## 8.3 metrics：托管且 opt-in

【文档】`docs/telemetry.md:86`：指标只含名字、时间戳、数值和低基数标签，不带凭据，在内存里聚合；关闭时不创建 reporter。

【代码事实】`local-runtime/src/runtime/host-metrics.ts:107-137`：

```ts
const cloudEnabled = managed && isTelemetryChannelEnabled('metrics');
```

两个条件都满足才用云端 reporter；否则用 noop reporter，并记一条日志说明原因：`telemetry_metrics_opt_in_required`（托管但没 opt-in）或 `unmanaged_runtime`（BYOK）。

【推断】这里多了一个 usage 没有的条件：**BYOK 用户即使 opt-in 也不发 metrics**。指标的接收方是 MiniMax 自己的服务，没有账号的运行时没有归属，干脆不发。noop 的原因写进本地日志，是给「我开了怎么没数据」留的线索。

## 8.4 diagnostics：绑账号、加密、只发计数

这是三个通道里唯一一个**和账号关联**的。

【文档】`docs/telemetry.md:90`：诊断上报通过 Bearer token 和一个 `user_id` 查询参数与账号关联，内容经过最小化并加密。通道关闭时，incident 只在本地保留（7 天 / 200 个文件），LLM 失败报告在进入缓冲之前就被丢弃。

### 两种东西走这个通道

| 来源 | 产生位置 | 内容 |
| --- | --- | --- |
| LLM 请求失败 | v1 `local-runtime/src/error-reporting/llm-integration.ts` | agent-core 每次物理请求失败（已滤掉用户取消）回调一次，打成 `llm_request_failure` 事件；`code_location` 是固定的「文件 + 函数名」，不带行号（「Omit line numbers so unrelated file edits do not change the value」） |
| 进程 incident | `tui/src/observability/incident-reporter.ts` | 未捕获异常、非致命错误，schema 2 |

### reporter 的四道闸

【代码事实】`local-runtime/src/error-reporting/reporter.ts`：

1. 诊断通道的开关查**两次**：`report()` 入口一次（`:65`），`encryptAndSend` 发送前再一次（`:107`）。用户在两者之间关掉开关，排队的那批也不发；
2. 没有 token 或 userId（登录不完整）时，整批丢弃，**不重新入队**；
3. 逐条加密，一条坏了跳过这一条；
4. 超过大小上限的事件直接丢，**不截断**。

【推断】第 4 条值得注意：截断是最常见的做法，但截断后的错误日志可能恰好在敏感字段中间断开，留下半个 token。丢弃更粗暴，也更不会出错。

【代码事实】这个 reporter 只被 v1 的 `local-runtime` 引用：`runtime/host-factory.ts:12`、`host.ts:22`、`host-types.ts:15`、`sessions/controller.ts:14`、`api/host-helpers.ts:37`、`api/host.ts:60`；隐私行为有专门的单测 `local-runtime/test/unit/error-reporting-privacy.test.ts`。v2 里没有它的引用。

### incident：本地优先

【代码事实】`incident-reporter.ts:130-145`：

| 常量 | 值 |
| --- | ---: |
| `INCIDENT_SCHEMA_VERSION` | 2 |
| `MAX_INCIDENT_FILES` | 200 |
| `MAX_NON_FATAL_INCIDENTS_PER_RUN` | 100 |
| `MAX_BREADCRUMBS` | 20 |
| `RETENTION_MS` | 7 天 |
| 去重窗口 | 60 秒 / 2 秒 |
| `BATCH_SIZE` | 20 |

schema 版本号旁边的注释是：「Version 1 records contain arbitrary private text and must never be replayed」。`prune()`（`:515-545`）删掉所有非 schema 2 的文件和过期文件；超过 200 个时按「仅本地 → 已发送 → 待发送」的顺序删。标记文件以 `0o600` 写（`:500-505`）。`uploadEnabled()`（`:511-513`）查的是诊断通道。

【文档】`docs/tui-capabilities.md:51-61` 讲了 schema 2 的约束：只保留固定类别，排除自由文本的错误信息和堆栈；指纹只从最小化后的事实算；schema 1 的文件删除、永不上传。同一段的最后一句是：「Production ingestion of schema 2 has not been tested.」

【推断】删除顺序先删「仅本地」的、最后删「待发送」的——在上限压力下优先保住还没发出去的那部分。schema 1 → 2 的迁移方式是「删掉旧的」而不是「转换旧的」：旧记录里有自由文本，转换就意味着要解析它，删掉最干净。

### 未捕获异常

【代码事实】`tui/src/tui/launcher.ts:232-244` 的 `onUncaughtExceptionMonitor` 记一条致命 incident（`cli_process_error`），尽力而为；`:325` 用 `process.on('uncaughtExceptionMonitor', …)` 挂上，`:635` 摘掉。vitest 下用 `noopTuiIncidentReporter`。

【推断】用 `uncaughtExceptionMonitor` 而不是 `uncaughtException`，意味着它只观察、不接管——进程照样按 Node 的默认行为崩溃，incident reporter 不会把一个本该退出的进程留在半死状态。

## 8.5 本地证据：session report

【代码事实】`agent-modules/session-report/src/`：

- `contracts.ts:25`：「Local collection priority only. Uploaders must minimize these artifacts before transfer.」manifest 是 schemaVersion 1；
- `llm-call-report-store.ts:12-17`：每个会话目录下一份 `llm-call.json`，信封上限 4 MiB，指纹最多 256 个；
- 适配器 `agent-extension/src/session-report.ts:49-56` 是双层 catch，注释：「Neither evidence IO nor its diagnostics may interrupt a provider call.」

它是生产环境挂上的三个 extension 之一（第 7 章 7.2）。

【推断】session report 是「本地收、按需传」：平时只写盘，用户发反馈时才被 8.7 的投影读一遍，投影出来的只有计数。它和 pi 的 JSONL 会话记录的区别是用途——pi 的是会话本身，minimax 的是**关于会话的证据**，专门给排障用。

## 8.6 日志

### 一个门面

【代码事实】`shared/src/local-runtime-logging/logger.ts` 的头注释规定：业务代码必须用这个门面，不准直接 `console.*`。门面有六个方法：`info`、`warn`、`error`，加上带上下文的 `ctxInfo`、`ctxWarn`、`ctxError`。诊断事件走另一条路，不混进日志。写盘是 opt-in 的，要调 `configureLocalRuntimeLogging({ dir })`。

【代码事实】TUI 启动时总会调它：`tui/src/runtime/logging.ts:41-43` 把目录定为 `<dataDir>/v2/observability/logs`，`:62-68` 建一个吞掉一切的 `Writable` 作为 stdout 目标、再把 `dir` 传进去。所以在 TUI 下，**终端上不打日志，日志全部进磁盘**。

启动期间还有一道（`:96-110`）：`installConsoleIsolation()` 把 `console` 的六个方法全部转到运行时 logger，打上 `source: 'mcode-runtime-console'`。【推断】依赖里总有人直接 `console.log`；TUI 正在画全屏界面，一行漏出来的输出就会把画面撕开。转进日志既保住了界面，也保住了那行输出。

### 滚动与保留

【代码事实】`shared/src/logging/disk-transport.ts:121-123`：

| 项 | 默认 |
| --- | ---: |
| 单文件 | 50 MiB |
| 总量 | 512 MiB |
| 保留 | 7 天 |

文件名 `runtime-<YYYYMMDDHH>[.N].log`，按小时滚动。头注释给了两个理由：忙的时候一小时就超过 10 万行；一天可能超过 512 MB，所以要有总量上限。

【代码事实】另一层清理在 `local-runtime-v2/src/infra/storage-retention/index.ts:5-7`：`LOG_RETENTION_MS` 7 天、`DEFAULT_ENTRY_BUDGET = 2_000`。`pruneTransientStorage` 在运行时就绪**之后**跑（`background-runtime.ts:195-207`），不遍历业务临时目录和工作区。

【推断】「就绪之后再清」把清理从启动关键路径上拿掉了；2,000 的条目预算让一次清理的工作量有上界，不会因为积压了几万个文件而卡住。

## 8.7 反馈：发计数，不发原文

### 用户能看到发什么

【代码事实】`tui/src/runtime/feedback/service.ts:134-150` 在提交前给用户看两张清单：

| 包含 | 不包含 |
| --- | --- |
| 用户写的反馈描述（识别到的凭据已打码） | 存储的凭据与鉴权文件 |
| 有界的客户端、运行时、平台元数据，**可选**的会话 ID | 原始附件、prompt、对话文本、工具参数与结果、本地路径、文件内容、自由文本错误 |
| 所选会话子树的诊断计数（消息、快照、报告产物），原文与文件名省略 | 无关会话、工作区文件、配置文件 |
| 最近 2 天运行时 / CLI / 终端日志与事件的有界计数 | |
| 只保留已知的角色、状态、错误类型 / 码、HTTP 状态、解析与省略计数 | |

### 投影是怎么做的

【代码事实】`tui/src/runtime/feedback/diagnostic-summary.ts:1-3` 的头注释：

> Diagnostics are summaries, never reversible copies of user content. No arbitrary strings or object keys are emitted.

实现上：角色、级别、状态、名字、错误码都用枚举表，表外的值只计数不输出；来源种类有一张白名单；遍历预算 100,000 个节点、深度 32；产物统一标 `redactionPolicy: 'diagnostic-counts-v1'`。文件名换成不透明名字，没有「附原文」的选项（`docs/tui-capabilities.md:51-61`）。

上传的窗口（`diagnostic-upload.ts:15-18`）：最近 2 天，最多 64 个文件、16 MiB，单文件 2 MiB。

### 唯一的自由文本

【代码事实】`user-facing-failure.ts:48-67` 的 `redactTuiSensitiveText()` 按类别打码：PEM 私钥块、几类常见的 API key 前缀、GitHub / Slack 的 token 形状、JWT、Bearer 与 Authorization 头、`api_key` / `token` / `password` / `secret` 形式的赋值。

【文档】`docs/tui-capabilities.md:51-61` 明说：反馈会打码识别到的凭据，**但仍然发送任意的个人文本**。

【推断】整个反馈包里，只有用户自己写的那段描述是原文。打码按形状识别，认不出来的就原样发。这是一个诚实的边界——文档没有声称它是安全的。

## 8.8 `/doctor`：只查配置

【代码事实】`tui/src/application/command-descriptors.ts:23-26`：`doctor` 的描述是「Check the local config file」。实现是 `tui/src/tui/features/inspection/product-inspection.ts:456-495` 的 `createTuiConfigInspection()`，徽标 `READ ONLY`，三段：

- 位置：配置来源、配置文件在不在、数据目录；
- 模型：默认模型、provider、endpoint（经 `sanitizeTuiUrl`）；
- 凭据：鉴权模式与来源、provider key 在不在、托管凭据在不在、自定义 provider 数量。

脚注「Credential values are hidden」——凭据只显示「有 / 没有」。出问题时 `configurationNextStep()`（`:442-454`）给一句下一步，每一句都以「restart MCode, then run /doctor again」结尾。

【推断】它不查网络、不查沙箱后端、不查 rm 垫片、不查 MCP 连接。对一个有云端分类器、PATH 垫片、可选沙箱的产品来说，「本地哪一样没就位」的问题，`/doctor` 回答不了；要靠日志。

## 8.9 版本与证据基线：写下来的和跑过的

【文档】`docs/open-source-status.md:7-16` 有一张「版本与证据基线」表，把几个容易混的东西分开写：TUI 能力版本、根 workspace 版本、npm 上观察到的已发布版本、内部共享源码基线（`release/extraction.json`）、内嵌工具的版本、历史上做过线上验收的版本（TUI 0.3.11，2026-09-11）。表下面那句是整个仓库对「证据」最克制的一句：「Matching version strings do not prove that this source tree reproduces the published npm tarball.」

`docs/tui-capabilities.md:5`、`docs/verification.md:23` 也是同一个口径：能力表的证据列是 0.3.11 的恢复记录，「does not claim fresh TUI 0.4.12 live-service acceptance」，没跑的写 NOT RUN。

【代码事实】这张表本身已经过期。表里说根 `package.json` 和 `packages/tui/package.json` 都是 0.4.12（`:9-10`）；实际两者都是 `"version": "0.5.0"`。改动来自提交 `13fd900`（「release MiniMax Code 0.5.0」），它只改了这两个 `package.json` 各一行，没有动任何文档；`README.md:242`、`docs/releasing.md:73`、`release/extraction.json:37` 仍写 0.4.12。

【推断】这是 8.4 那句「schema 2 的生产接收未测」的同类：文档对「验证过什么」非常诚实，但「当前是什么版本」这种机械事实没有闸门守着。第 2 章的 `check:source` 钉住了根许可的 sha256，却没有一条规则对比 manifest 版本和文档里的版本。

## 8.10 缺口

| 缺口 | 证据 | 后果 |
| --- | --- | --- |
| 诊断通道绑账号 | `docs/telemetry.md:90` | opt-in 之后，错误报告能对到具体账号；和 usage 的「每事件新 ID」是两种立场 |
| 反馈描述是原文 | `docs/tui-capabilities.md:51-61`；`user-facing-failure.ts:48-67` | 打码只认形状，认不出的凭据和个人信息原样发出 |
| 服务端保留期不定义 | `docs/telemetry.md:82` | 本仓库能保证的只到「发出去之前」 |
| schema 2 的生产接收未测 | `docs/tui-capabilities.md:51-61` | incident 上传链路的最后一段没有验证 |
| TUI 默认写盘日志 | `tui/src/runtime/logging.ts:62-68` | 门面写盘是 opt-in，但 TUI 总是开；最多 512 MiB、7 天，本机可读 |
| 错误上报只在 v1 | reporter 的引用全部在 `local-runtime/` | 两套运行时并存的又一处（第 2 章） |
| 版本表与 manifest 不一致 | `docs/open-source-status.md:9-10` vs `package.json:3`；提交 `13fd900` | 读文档的人以为是 0.4.12，构建出来是 0.5.0 |
| `/doctor` 只查配置 | `product-inspection.ts:456-495` | 垫片、沙箱、MCP、网络的就位情况没有自检入口 |
| auto 模式的分类器流量不在遥测开关里 | 第 5 章 5.3；`docs/telemetry.md:3` | 三个开关全关，分类器照样把命令和近几轮对话发出去 |

## 8.11 本章结论

- 三个上传通道全部默认关，各自 opt-in；全局关闭的环境变量优先；配置读不出来按「没授权」处理；`preview` 能在发之前看到请求长什么样。
- usage 每个事件一个新随机 ID，协议上连不起来；不发送的列表比发送的长；服务端保留期本仓库不定义。
- metrics 要「托管 + opt-in」两个条件，BYOK 不发；noop 的原因写进本地日志。
- diagnostics 是唯一绑账号的通道：开关查两次、登录不全整批丢、超限丢不截断；incident 本地优先、schema 1 直接删、致命异常用 `uncaughtExceptionMonitor` 只观察不接管。
- 日志一个门面，TUI 下全部进盘、终端静默、启动期 `console` 被隔离；按小时滚动、50 MiB / 512 MiB / 7 天。
- 反馈只发计数（`diagnostic-counts-v1`），唯一的原文是用户自己写的描述，打码按形状识别。
- 版本与证据基线表把「写的版本」「发布的版本」「验收过的版本」分开写，并声明版本号相同不证明可复现；但表本身没跟上 0.5.0。
- `/doctor` 只查配置文件。和遥测开关无关的那条流量——auto 模式的云端分类器——是这一章之外最大的数据出口。
