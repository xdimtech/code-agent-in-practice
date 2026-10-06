# 8. 可观测性与运维

> 对照基准：[pi 第 8 章](../pi/08-observability.md)。pi 几乎什么都不记，也什么都不发。kimi-code 是一个有账号的产品，它的选择和 minimax-code 正好相反：遥测**默认开**、用一个开关或一个环境变量关；本地留得很全（完整会话记录、两级滚动日志、会话可视化、服务端检查器）；反馈可以把整个代码库打包上传，由用户逐次选择。

| | pi | kimi-code |
| --- | --- | --- |
| 遥测 | SPI 有、没接线 | **默认开**；`telemetry = false` 或 `KIMI_DISABLE_TELEMETRY=1` 关 |
| 标识 | — | 本机 `device_id`（随机 UUID）；**登录后每次上报带账号的 Bearer token** |
| 事件目录 | — | 引擎侧 80 个有类型的事件定义，每个字段都要写说明 |
| 上报前脱敏 | — | 引擎管线有（邮箱、URL、token、路径）；CLI 旧管线没有，只丢弃非原始类型 |
| 本地日志 | 几乎没有 | 全局 + 会话两级，滚动；`KIMI_LOG_LEVEL` |
| 会话记录 | JSONL | `wire.jsonl`，完整；`kimi export` 打包；`kimi vis` 可视化 |
| 用户反馈 | `/share` 发 gist | `/feedback` 三档：纯文字 / 加日志 / 加日志和代码库（≤ 500 MiB） |
| 自检 | 没有 | `kimi doctor` 只校验 `config.toml` 与 `tui.toml` |

一句话：kimi 把「本地能看见什么」做得很满，把「默认往外发什么」交给了一个默认开的开关。

## 8.1 遥测：默认开

【文档】`docs/en/configuration/config-files.md:105`：`telemetry`，默认 `true`，「Whether anonymous telemetry is enabled; disabled only when explicitly set to `false`」。`docs/en/configuration/env-vars.md:29`：`KIMI_DISABLE_TELEMETRY=1` 关闭。

【代码事实】两处读取方都同时看配置与环境变量：

- 服务端：`packages/kap-server/src/services/telemetry.ts:37-38`，`config.get('telemetry') !== false` 且环境变量没设才挂上 appender；
- 无头：`apps/kimi-code/src/cli/v2/run-v2-print.ts:255-266`，同一个 `telemetryEnabled` 决定两条管线是否初始化。

环境变量接受的值是 `1` / `true` / `t` / `yes` / `y`（`packages/telemetry/src/bootstrap.ts:6-8`；`kap-server/src/services/telemetry.ts:15-16`），比文档多一个 `t`。

### 「匿名」与 Bearer token

【代码事实】`packages/telemetry/src/transport.ts:178-195` 的 `sendHttp`：

```ts
  private async sendHttp(payload: TelemetryPayload, signal?: AbortSignal): Promise<void> {
    const token = this.getAccessToken === null ? null : await this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token !== null && token.length > 0) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await this.post(payload, headers, signal);
    if (response.status === 401 && headers['Authorization'] !== undefined) {
      delete headers['Authorization'];
      const retry = await this.post(payload, headers, signal);
      handleStatus(retry.status);
      return;
    }
    handleStatus(response.status);
  }
```

`getAccessToken` 由 CLI 注入，取的是 Kimi 账号的缓存 token（`apps/kimi-code/src/cli/telemetry.ts:63-64`）；引擎侧的传输（`packages/agent-core-v2/src/app/telemetry/cloudTransport.ts:204,208`）是同样的写法。

【推断】文档说的「anonymous」对未登录用户成立：事件只带一个本机随机的 `device_id`。对登录用户，每一批事件都带着能识别账号的凭据——服务端可以把这台机器上的全部事件和账号关联起来。401 时去掉 token 重发，说明设计上「带不带 token 都要收到」，token 是附加的身份，不是上报的前提。这不是隐藏的行为（代码清楚），但「anonymous」这个词需要读者自己打折扣。

### 每条事件都带什么

【代码事实】`packages/telemetry/src/sink.ts:103-121` 的 `buildContext`：

| 字段 | 来源 |
| --- | --- |
| `app_name`、`version`、`build_sha` | 构建信息 |
| `runtime`、`node_version`、`platform`、`arch`、`os_version` | Node 与 `os.release()` |
| `ci` | `CI` 环境变量是否存在 |
| `locale` | `LANG` |
| `terminal` | `TERM_PROGRAM` |
| `ui_mode`、`model` | 当前入口与模型 |

*表 8-1 每条事件的上下文*

外加 `device_id`、`session_id`、事件名、时间戳和事件自己的属性（`client.ts:297-306`）。

【代码事实】`packages/telemetry/src/systemMetrics.ts`：每 300 秒（`:5`）发一条 `system_metrics`，内容是进程的 RSS、堆、CPU 时间、1 分钟负载、空闲 / 总内存、CPU 核数（`:85-98`）。崩溃时只发错误类名、阶段和来源，不发堆栈（`crash.ts:30-36`）。

### 设备 ID 与设备头

【代码事实】`packages/oauth/src/identity.ts:53-75`：第一次运行时生成一个随机 UUID，写进 `~/.kimi-code/device_id`（权限 `0600`）；遥测里的用户标识是它加上前缀 `kfc_device_id_`（`transport.ts:23`）。

同一个文件的 `createKimiDeviceHeaders`（`:77-92`）还会给请求加上主机名、设备型号、系统版本和设备 ID。【代码事实】这些头只发给 Kimi 自家的 provider：`llm-adapter/model/catalog-service.ts:491-501` 的 `resolveOutboundHeaders` 只对 `hostHeaders === 'full'` 的 provider 转发全部主机头，而声明了 `full` 的只有三个 `kimi` 定义（`llm-adapter/provider/provider-definition.ts:231,242,252`）；第三方 provider 只拿到 `User-Agent`。

【推断】这是一个细致的边界：用户配置 Anthropic 或 OpenAI 时，kimi 不会把本机主机名带给它们。

### 离线与重试

【代码事实】`transport.ts`：失败的批次写进 `~/.kimi-code/telemetry/failed_<随机>.jsonl`（`:119-125`，文件 `0600`、目录 `0700`，`:221-226`），下次启动重发，超过 7 天的丢弃（`:24,145`）；重试间隔 1 s / 4 s / 16 s（`:25`）。

【文档】`docs/en/configuration/data-locations.md` 的目录图（`:26-57`）里**没有** `device_id` 和 `telemetry/` 这两项。

## 8.2 两条管线

【代码事实】遥测有两套实现并存：

| | 「v1」管线 | 引擎管线 |
| --- | --- | --- |
| 位置 | `packages/telemetry/`（1,272 行） | `packages/agent-core-v2/src/app/telemetry/`（2,443 行） |
| 用的地方 | CLI / TUI 自己的事件、崩溃 | 引擎事件；kap-server 与 `kimi -p` 都挂它 |
| 事件定义 | 字符串 | 有类型的目录（下文） |
| 字符串脱敏 | **无**；只丢弃非原始类型的属性（`client.ts:66,124,323`） | `cleanTelemetryProperties`（`cloudAppender.ts:110`） |
| 离线落盘、7 天、1/4/16 s | `transport.ts:24-25` | `cloudTransport.ts:53-54` |

*表 8-2 两条遥测管线*

【代码事实】`run-v2-print.ts:245-252` 的注释说明了为什么还留着 v1：「The v1 pipeline is initialized here too: the process-wide crash handlers report through its default client」。

【推断】这是第 3 章「两份重试工具」的同一种债：v2 引擎换代后，旧的基础设施因为一两个调用方（这里是崩溃处理）没有迁走。两边的常量现在一致，将来改一边不改另一边的风险是真的；脱敏只在一边有，是现在就存在的差异。

### 事件目录：每个字段都要写说明

【代码事实】`app/telemetry/events.ts`（1,351 行）里有 80 个事件定义。定义函数的类型（`:33-43`）要求 `properties` 里**每一个**属性都有一段说明文字：

```ts
export function defineAgentTelemetryEvent<P>(
  meta: TelemetryEventMeta & { readonly properties: { [K in keyof P]-?: string } },
): TelemetryEventDefinition<P, 'agent'> {
  return { context: 'agent', meta };
}
```

例如 `context_projection_repaired`（`:878-893`）把投影修复的 9 种动作——挪回、合成、丢弃孤儿结果、去重等——各写了一句说明。`track2` 的事件名类型是这份目录的键（`:1341`；`telemetry.ts:32`），写错名字编译不过。

【代码事实】引擎里 `.track2(` 有 93 处，未类型化的 `.track(` 还有 12 处；引擎、CLI、服务端三处合计 111 个不同的事件名。

【推断】「每个字段都要写说明」把「我们收什么」变成了一份可以审读的清单——审计一个新字段，看 diff 里的那一句话就够了。它没有做到的是让用户在本地看到这份清单：没有类似「预览将要发送的内容」的命令。

### 引擎管线的脱敏

【代码事实】`app/telemetry/privacy.ts:4-12` 用正则替换邮箱、URL、JWT、GitHub token、Slack token、`sk-` / `pk-` / `ak-` 开头的 key；`:17-28` 把 POSIX 与 Windows 路径替换成 `<REDACTED: user-file-path>`，`node_modules/` 之后的部分保留（方便看是哪个依赖出的错）。

【推断】这是「发之前尽量洗掉」，不是「只发计数」。它对已知格式的秘密有效；对任意格式的秘密（自定义 token、数据库密码）无效——但这要求属性里本来就有自由文本，而目录里的属性大多是枚举和计数。

## 8.3 本地日志

【文档】`data-locations.md:90-95`：全局日志 `~/.kimi-code/logs/kimi-code.log` 记启动、登录、导出等跨会话事件；会话日志在会话目录的 `logs/` 下，只有出现诊断事件时才有。`env-vars.md:194-198`：

| 变量 | 默认 |
| --- | --- |
| `KIMI_LOG_LEVEL` | `info`（可选 `off` / `error` / `warn` / `info` / `debug`） |
| `KIMI_LOG_GLOBAL_MAX_BYTES` / `KIMI_LOG_GLOBAL_FILES` | 6 MB × 5 |
| `KIMI_LOG_SESSION_MAX_BYTES` / `KIMI_LOG_SESSION_FILES` | 5 MB × 3 |

*表 8-3 日志滚动*

【文档】会话数据（`data-locations.md:71-84`）：`agents/main/wire.jsonl` 是主 agent 的完整通信记录，子 agent 各有一份；后台任务的输出在 `tasks/<id>/output.log`；计划文件、cron、目标队列都在会话目录里。

【推断】「完整通信记录」意味着模型读过的每一个文件、跑过的每一条命令的输出都在本地明文保存。第 5 章说过 `Bash cat .env` 在 yolo 下不问——它的输出也就进了 `wire.jsonl`。这对排错是好事，对「会话目录里有什么」要心里有数。

## 8.4 本地工具：导出、可视化、检查器

| 工具 | 是什么 | 位置 |
| --- | --- | --- |
| `kimi export` | 把会话目录打成 zip，默认带全局日志，`--no-include-global-log` 去掉 | `apps/kimi-code/src/cli/sub/export.ts:110-127`；`data-locations.md:95` |
| `kimi vis` | 在浏览器里打开会话可视化与回放 | `cli/sub/vis.ts:106`；`apps/vis/`，11,431 行 |
| `kimi-inspect` | kap-server debug RPC 的 Web 检查器：工作区、会话、agent、DI 注册表 | `apps/kimi-inspect/README.md:3-5` |

*表 8-4 本地可观测工具*

【代码事实】debug 端点只在回环地址上、且显式传 `--debug-endpoints` 时挂载（`packages/kap-server/src/start.ts:164`），并继承服务端的 bearer 鉴权（`kimi-inspect/README.md:11-12`）。

【推断】这是本书几家里本地可观测性最完整的：会话能导出、能回放、运行中的引擎能看到 DI 层。它们都是为开发者自己排错设计的，不出本机。

## 8.5 反馈：三档，最多 500 MiB 代码

【代码事实】`/feedback` 先提交文字，再让用户选附件（`apps/kimi-code/src/tui/commands/prompts.ts:77-90`）：

| 选项 | 说明原文 |
| --- | --- |
| No attachment | Text feedback only |
| Logs only | Upload wire events and diagnostic logs from this session |
| Logs + codebase | Include your codebase for deeper diagnosis. Sensitive files are automatically excluded — e.g. .env, config files, secret keys. We use attachments only for diagnosis and never share them. |

*表 8-5 反馈附件的三档。第三档以警告色显示（`:89`）*

【代码事实】`feedback/feedback-attachments.ts`：

- 「日志」就是 `exportSession` 的结果，`includeGlobalLog: true`（`:67-70`）——也就是整个会话目录（含 `wire.jsonl`）加全局日志；导出过程不做任何脱敏（`agent-core-v2/src/app/sessionExport/` 里没有 redact 逻辑）。
- 「代码库」用 `git ls-files -co --exclude-standard` 列文件（`feedback/codebase/scanner.ts:88`）——已跟踪加未跟踪、尊重 `.gitignore`；不在 git 里时自己遍历目录并跳过 `node_modules`、`dist` 等（`filter.ts:8-31`）。
- 上限：5 万个文件、单文件 50 MiB、总计 500 MiB（`filter.ts:1-6`）。
- 每个附件失败都不影响文字反馈，临时文件在 `finally` 里删除（`:96-120`）。

### 「敏感文件自动排除」排除了什么

【代码事实】`filter.ts:33-91` 的 `isSensitivePath` 只看路径：目录 `.ssh`、`.gnupg`、`.aws`、`.kube`、`.docker`；文件名 `.env`、私钥、`credentials.json`、`service-account.json`、`.netrc`、`.npmrc`、`.pypirc`、`.envrc` 等；后缀 `.pem`、`.key`、`.p12`、`.pfx`、`.jks`、`.keystore`；`.env.*`（`.example` / `.sample` / `.template` 除外）。

【推断】三点：

1. 这份名单和第 5 章权限层的 `isSensitiveFile`（`tool/path-access.ts:51-83`）**不是同一份**：反馈这份更宽（有 `.npmrc`、`.netrc`、`.pem`）。两份名单各自维护，又是一处「改一处忘一处」。
2. 它不看内容。说明里写的「config files」并没有对应的规则：`config.yaml`、`settings.py`、`application.properties` 里的密码都会进 zip。
3. 「日志」档听上去比「代码库」档轻，但 `wire.jsonl` 里有模型读过的所有文件内容——包括在会话里 `cat` 过的 `.env`。路径名单挡得住 `repo.zip` 里的 `.env`，挡不住会话记录里的。

这些都是用户逐次主动选择的；本书的意见是第三档的说明比实际的过滤更乐观。

## 8.6 `kimi doctor`：只查配置

【代码事实】`apps/kimi-code/src/cli/sub/doctor.ts:79-95`：`kimi doctor`、`kimi doctor config`、`kimi doctor tui`，分别校验 `config.toml` 与 `tui.toml`。校验逻辑（`cli/v2/validate-config.ts:12-23`）用引擎自己的配置段注册表，注释原文：

> a registered section that fails schema validation is an error (the engine would silently ignore that section at runtime; surfacing it is doctor's job)

【推断】这句话把第 7 章的一个缺口说透了：hook 配置多一个字段，运行时整段被静默忽略（`externalHooksRunnerService.ts:114-124`），**`kimi doctor` 能查出来**——但要用户自己想到去跑。运行时不报、doctor 报，是一种明确的分工；代价是用户只有在怀疑出问题时才会去看。`doctor` 不检查网络、登录状态、MCP 能否启动、`rg` 是否可用。

## 8.7 本地服务端的暴露面

kimi 的所有入口都是本地服务端 `kap-server` 的客户端（第 1 章），所以「谁能连上这个服务端」也属于运维面。

【代码事实】`packages/kap-server/src/start.ts`：

| 规则 | 位置 |
| --- | --- |
| 默认绑 `127.0.0.1` | `:137` |
| 非回环地址没有 TLS 就拒绝启动，除非 `--insecure-no-tls` | `:155-161` |
| 终端（PTY）只在回环地址上开放；debug 端点同样 | `:163-164` |
| 非回环时启用鉴权失败限流 | `:178-179` |
| 非回环且没设 `KIMI_CODE_PASSWORD`：告警「bearer token 是唯一凭据」 | `:237-246` |
| 每个 WebSocket 升级都检查 `Host` 与 `Origin` | `:496-514` |
| `--dangerous-bypass-auth`：所有 REST 与 WebSocket 路由不鉴权，打一条 `DANGEROUS` 日志 | `:288-300` |
| Remote Control 要求回环地址，且不能与 `--dangerous-bypass-auth` 同用 | `:456-459`；`cli/sub/web/run.ts:195-196` |

*表 8-6 kap-server 的暴露规则*

【推断】默认值是稳妥的：只听回环、校验 `Host` / `Origin`（挡 DNS rebinding）、终端不出本机。危险的组合需要显式叠加两个以 `insecure` / `dangerous` 命名的开关（`--host 0.0.0.0 --insecure-no-tls --dangerous-bypass-auth`），这时局域网里任何人都能驱动一个继承了用户完整环境、没有沙箱的 agent（第 5 章 5.6）。代码不阻止这个组合，只在启动横幅和日志里大声说（`run.ts:279-287`）。

## 8.8 自动更新

【文档】`data-locations.md:64`：`tui.toml` 的 `[upgrade].auto_install` 默认打开；`:97`：`updates/rollout.log` 记录每次更新检查命中了哪一档分阶段发布。【代码事实】分阶段发布的分桶用的是同一个 `device_id`，读不到时用一次性的随机 UUID（`apps/kimi-code/src/cli/update/rollout.ts:194`）。

【推断】和第 7 章「插件默认跟最新」放在一起看：kimi 的默认是「保持最新」，主程序和插件都是。

## 8.9 缺口

| 缺口 | 证据 | 后果 |
| --- | --- | --- |
| 遥测默认开 | `config-files.md:105` | 不读文档的用户不知道在上报 |
| 文档说「anonymous」，登录后每批事件带账号 token | `transport.ts:178-195`；`cloudTransport.ts:204,208`；`cli/telemetry.ts:63-64` | 事件可与账号关联 |
| 两条遥测管线并存，脱敏只在引擎一侧 | `run-v2-print.ts:245-266`；`privacy.ts`；`packages/telemetry/src/client.ts:323` | CLI 侧字符串属性不经清洗；常量两份 |
| 没有「预览将发送内容」的命令 | 全仓无对应入口 | 用户只能读代码知道发了什么 |
| `device_id` 与 `telemetry/` 不在数据目录文档里 | `data-locations.md:26-57` | 清理数据时漏掉标识与待重发事件 |
| 反馈「日志」档上传完整会话记录与全局日志，不脱敏 | `feedback-attachments.ts:67-70`；`sessionExport/` | 会话里读过的秘密随日志上传 |
| 反馈代码库只按路径排除，名单与权限层不同 | `filter.ts:33-91` vs `path-access.ts:51-83` | 配置文件里的密码进 zip；两份名单各自漂移 |
| `doctor` 只查配置；运行时静默忽略坏的配置段 | `doctor.ts:79-95`；`validate-config.ts:12-15` | hook 配置写错要用户自己跑 doctor 才知道 |
| kap-server 允许「非回环 + 无 TLS + 无鉴权」的组合 | `start.ts:155-161,288-300` | 显式开关下整个 agent 暴露在局域网 |

## 8.10 本章结论

- 遥测默认开，一个配置项或一个环境变量关；登录用户的事件带账号 token，「匿名」只对未登录成立。
- 引擎侧有一份 80 个事件的有类型目录，每个字段都要写说明，上报前按正则脱敏；CLI 旧管线还在（为了崩溃处理），没有脱敏。
- 主机名等设备头只发给 Kimi 自家的 provider，第三方只拿到 `User-Agent`。
- 本地可观测性很完整：两级滚动日志、完整会话记录、导出、回放、运行时检查器。
- `/feedback` 三档由用户逐次选择；「代码库」档最多 500 MiB，按路径名单排除敏感文件，不看内容；「日志」档就是整个会话记录。
- `kimi doctor` 只校验配置，但它是运行时静默忽略坏配置段的唯一补救。
- 本地服务端默认只听回环、校验 Host 与 Origin；危险组合要叠加两个显式开关。
