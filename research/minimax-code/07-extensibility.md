# 7. 扩展性与生态

> 对照基准：[pi 第 7 章](../pi/07-extensibility.md)。pi 的扩展是「同进程、零隔离的 TS 模块」，MCP 明确不支持。minimax-code 反过来：自己的扩展点是**进程外**的，用 stdin/stdout 和 JSON 说话，有超时预算、并发上限和环境白名单；进程内的那套 SPI 只给第一方用。

## 7.1 五条扩展路径

【代码事实】按「谁能往里加东西」数，这个仓库有五条路：

| 路径 | 谁在写 | 怎么加载 | 隔离 |
| --- | --- | --- | --- |
| agent-extension SPI | 第一方（仓库内） | 编译期 import，宿主组装时挂上 | 无，同进程 |
| Plugin Hook | 第三方 | 进程外 spawn，stdin/stdout JSON | 进程 + 环境白名单 + 超时 |
| Skill | 用户与第三方 | 扫目录，按需读取 | 无（只是文本） |
| Plugin 包 | 第三方 | sha256 树摘要 + 不可变快照 | 目录级 |
| MCP server | 第三方 | 独立进程，JSON-RPC | 进程，但**继承完整环境** |

【推断】五条路里，只有进程内那条没有隔离——而它恰好只对第一方开放；对外开放的四条都在进程边界外。这和 pi 的取舍正好相反：pi 把扩展做成同进程 TS 模块（能力最大、隔离最小），把 MCP 直接排除；minimax 把扩展做成外部进程（能力受限、隔离真实），把同进程的留给自己。

## 7.2 进程内：9 个 hook，11 个适配器，6 个没人用

【代码事实】`agent-runtime/src/types.ts:162-172` 定义宿主侧的 9 个 hook（第 3 章）：

```text
turn_start → before_llm_call → on_llm_call_prepared → after_llm_call
          → before_tool_call → after_tool_call → on_step_end → … → turn_end
on_history_changed
```

`packages/agent-extension`（11 个适配器）是这些 hook 的第一方实现，它的头注释自己说明了定位（`src/index.ts:1-6`）：

> Built-in adapters from domain-owned agent modules to `@mavis/agent-runtime`. This package owns only SPI glue. It does not construct module instances, choose a host profile, or provide a default extension list.

### 谁真的挂上了

【代码事实】把 11 个适配器的名字在本仓非测试文件里反查一遍，去掉它们自己所在的定义文件：

| 适配器 | 生产引用 | 谁挂的 |
| --- | ---: | --- |
| `sessionReportExtension` | 1 | `production-composition.ts:517` |
| `runawayGuardExtension` | 1 | `runaway-guard/extension.ts:16`（再由 `production-composition.ts:519` 调） |
| `toolOutputBudgetExtension` | 1 | `production-composition.ts:522` |
| `planModeExtension` | 1 | `service/plan/initialize.ts:124` |
| `sourceReferenceExtension` | 1 | `application/agent/source-reference-extension.ts:15` |
| `MiniAppControl` | 1 | miniapp 宿主 |
| `contextManagerExtension` | **0** | — |
| `permissionExtension` | **0** | — |
| `skillsExtension` | **0** | — |
| `systemReminderExtension` | **0** | — |
| `terminalResponseRecoveryExtension` | **0** | — |
| `runawayGuardShadowExtension` | **0** | — |

`native-production-dependencies.ts:102-105` 的注释承认了这一点，只是数字对不上：

```ts
/**
 * Explicitly configured normal-turn extensions. The seven built-in
 * `@mavis/agent-extension` adapters are not enabled by this factory.
 */
```

【推断】按引用数只有 6 个没有生产消费者，注释写 7。多出来的那一个大概是按「除三个默认之外还剩几个」算的（11 − 3 = 8，也对不上），或者中间某次改动后没有同步。结论不受影响：**同进程这套 SPI 是半启用的**。

### 三件事被压在同一个函数里

【代码事实】生产环境真正挂上的三个适配器，加上宿主自己的 runaway guard 包装，都在 `production-composition.ts:510-552` 的 `createHostNormalExtensions()` 里，之后和 `options.product.normalExtensions`、`options.normalExtensions` 合并。其中 `toolOutputBudgetExtension` 的参数是现读的：

```ts
toolOutputBudgetExtension({
  maxInlineBytes: TOOL_RESULT_COMPACTION_DEFAULTS.maxInlineKiB * 1_024,
  getMaxInlineBytes: () => getToolResultCompactionConfig().maxInlineBytes,
  fallbackPreviewBytes: 2 * 1_024,
  ...
})
```

【推断】`maxInlineBytes` 是构造时定死的默认值，`getMaxInlineBytes()` 是每次调用现读配置——一个值给两条路，说明写的时候就知道远端配置可能在启动后到达（第 4 章的工具输出外置讲的是同一个数）。

### 没被引用的那几个并不都是死代码

| 适配器 | 它包的模块 | 模块本身在用吗 |
| --- | --- | --- |
| `contextManagerExtension` → `ContextManager` 类 | 第 4 章：`computeCompactionTriggerAt` 的调用方之一 | 类在，但走的是 `provider-budget.ts` 那条线 |
| `permissionExtension` → `PermissionEngine` | 权限 facade 在用 | 引擎在用，只是不经过这个适配器接线 |
| `skillsExtension` → `SkillRegistry` | 技能的注册与渲染在用 | 同上 |
| `systemReminderExtension` → `SystemReminderService` | v2 只 import 了它的 `summarizeTodoStatuses` 和类型 | 责任链本体的宿主实现是 v1 的 `local-data-collector.ts` |
| `terminalResponseRecoveryExtension` | 找不到消费者 | — |
| `runawayGuardShadowExtension` | 找不到消费者（只有 `fingerprint.ts:118` 的一句错误文案提到它） | — |

【推断】这是公开投影留下的形态：产品代码走的是 v1 遗留的接线方式（facade、registry 直接 new），适配器是给 v2 准备的新接线；v2 只搬了一部分。它们不是死代码，是「已经接好、还没插上」的线头。

## 7.3 进程外之一：Plugin Hook

【代码事实】`agent-modules/plugin-hooks`（5,194 行，最大的是 `runner.ts` 2,348、`coordinator.ts` 1,289）。契约在 `contracts.ts:2-14`：

```ts
export const PLUGIN_HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse',
  'PermissionRequest', 'PostToolUse', 'SubagentStart', 'SubagentStop',
  'Stop', 'PreCompact', 'PostCompact',
] as const;
```

11 个事件，三种来源格式：`'MINIMAX' | 'CLAUDE' | 'CODEX'`（`:18`）。【推断】一份 11 事件的表同时兼容自己的格式和 Claude Code、Codex 的插件格式——「兼容」在这里是一个类型，不是一个开关。

### 上限是一层套一层的

【代码事实】`runner.ts:30-38` 的常量：

| 常量 | 值 | 管什么 |
| --- | --- | --- |
| `MAX_OUTPUT_BYTES` | 64 KiB | 一个 hook 进程能吐多少 |
| `MAX_INPUT_BYTES` | 1 MiB | 能喂给它多少 |
| `MAX_REASON_CHARS` | 4,096 | 拒绝理由的截断 |
| `MAX_INJECTED_TEXT_CHARS` | 64 KiB | 能往上下文里注入多少 |
| `MAX_OUTPUT_VALUE_DEPTH` / `_NODES` | 64 / 10,000 | JSON 结构防爆 |
| `ORDINARY_EVENT_BUDGET_MS` | 15,000 | 一个事件的所有 handler 共享 |
| `SESSION_END_BUDGET_MS` | 3,000 | `SessionEnd` 单独收紧 |
| `PROCESS_DRAIN_BUDGET_MS` | 500 | 收尾排水 |
| `MAX_CONCURRENT_COMMANDS` | 8（`:2222`） | 一次最多几个进程 |

事件预算和 handler 自己的超时取小（`runner.ts:109-120`）：

```ts
const remainingEventBudgetMs = eventStartedAt + eventBudgetMs - handlerStartedAt;
const outcome = remainingEventBudgetMs <= 0
  ? { diagnostic: runDiagnostic(handler, 'HOOK_TIMEOUT' as const), processKilled: false }
  : await this.runCommand(handler, input, Math.min(handler.timeoutMs, remainingEventBudgetMs), signal);
```

【推断】这是「预算」而不是「超时」：八个 handler 各要 10 秒，第九个开始时预算已经用完，直接记 `HOOK_TIMEOUT`，不是先跑十秒再发现。一个插件想在 `SessionStart` 里拖住启动，最多拖 15 秒。

### 环境是白名单

【代码事实】`safeHookEnvironment()`（`runner.ts:1771-1797`）只传 17 个变量：`PATH`、`HOME`、`LANG`、`TERM`、`SHELL`、`USER`、`TMPDIR`、`TEMP`、`TMP`、`PATHEXT`、`SystemRoot`、`ComSpec`、`USERPROFILE`、`HOMEDRIVE`、`HOMEPATH`、`APPDATA`、`LOCALAPPDATA`。之后拼上各格式的 `*_PLUGIN_ROOT`、`PLUGIN_DATA`、`*_PROJECT_DIR`（`:236-250`）。数据目录用 `mkdir(..., { mode: 0o700 })` 建。

【推断】这是这个仓库里少见的「显式白名单」写法（别处都是黑名单式净化，第 5 章 5.6）。后果很直接：**hook 看不到 API key，`bash` 工具看得到**。同一个 agent run 里两条路径对凭据的暴露程度不同，是有意为之还是沿用上游格式规范，源码里没说。

### 失败即放行

【代码事实】`runner.ts:124`：

```ts
this.logger?.warn({ ...outcome.diagnostic }, 'Plugin hook command failed open');
```

`defaultDecision()`（`:1442-1448`）：`PermissionRequest` 返回 `{ decision: 'allow', permissionDecision: 'abstain' }`，`PreToolUse` 返回 `{ decision: 'allow', toolPermissionDecision: 'abstain' }`。【推断】hook 崩了、超时了、输出没法解析——一律当「没意见」，工具照跑。插件是用户自己装的，宿主不愿意因为一个坏插件让整个会话不可用。代价是：一个该拦而崩掉的 hook，拦不住任何东西。

### 退出码的三种语义

【代码事实】`runner.ts:300-312`：

```ts
// Codex only interprets structured stdout from a successful command.
// Compatible intentionally parses JSON on every exit code; exit 2 then adds
// the event-specific blocking effect which JSON cannot override.
const parsesStdout =
  !(handler.sourceFormat === 'CODEX' && input.event === 'SessionEnd') &&
  (handler.sourceFormat !== 'CODEX' || result.code === 0);
const exitDecision =
  result.code === 2 && handler.sourceFormat !== 'MINIMAX'
    ? explicitExitTwoDecision(input.event, captured.stderr, handler.sourceFormat)
    : undefined;
```

| 格式 | 什么时候看 stdout | 退出码 2 |
| --- | --- | --- |
| CODEX | 只有 `code === 0`（`SessionEnd` 连这个都不看） | 不特殊 |
| CLAUDE | 任何退出码 | 追加一个阻塞效果，JSON 覆盖不了 |
| MINIMAX | 任何退出码 | 不特殊 |

进程组在读完之前就被清掉（`terminateRemainingProcessGroup`）。

### hook 能放行到什么程度

【代码事实】插件 hook 的 `allow` 不是无条件生效的。这条链有四段：

1. `plugin-hook-tool-lifecycle.ts:524-535` 的 `recordPluginApprovalRequest()` 把 `allow` / `ask` 存进 `pluginApprovalRequests`；
2. 这个 map 在 `local-turn-execution-preparation.ts:104` 变成权限门的 `preToolPermission`；
3. `local-turn-permission-gate.ts:563-571` 的 `preToolHookAllowsWithoutApproval()` 要求 hook 说 allow **并且**这次判定带 `hookAutoApprovalEligible`；
4. 这个标记在 `facade.ts:765` 由 `isOrdinaryFallbackAsk()`（`:1289-1302`）计算，只有三种情况为真：工作区边界（`workingDirectory`）、`safetyCheck` 且类别是 `noMatchingPermissionRule`、以及所有子命令都是「普通 ask」且没有 deny。

【推断】也就是说：hook 的 allow 只能免掉**规则没命中时的兜底询问**，免不掉安全询问，更免不掉 deny。一个插件不能把 `rm -rf /` 说成允许。源码里那句注释（`facade.ts` 附近）说得比代码更明确：「An explicit ask rule, a product safety boundary, or any compound command containing either remains owned by the user-facing permission flow.」

### 内置工具有一道例外

【代码事实】`local-turn-permission-gate.ts:577-587`：

```ts
function shouldSkipPermissionCheck(options, input): boolean {
  return (
    options.enforceBuiltinTools !== true &&
    isBuiltinTool(input.toolContext.toolCall) &&
    input.preToolPermission?.behavior !== 'ask'
  );
}
```

`isBuiltinTool()`（`:884-888`）认 `source === 'builtin'` 或 `'builtin-matrix'`。`enforceBuiltinTools` 在 `native-production-dependencies.ts:222-232` 由产品策略算出来：

```ts
enforceBuiltinTools:
  options.executor.cliProductPolicy === true && options.executor.tuiProductPolicy !== true,
```

而 `tuiProductPolicy` 只有 `runtimeOwnerKind === 'tui'` 时为真（`services.ts:1002`），`cliProductPolicy` 只有命令行 owner 才为真（`services.ts:998`）。

【推断】所以：**命令行面（`mcode exec`）走这道门；TUI 面不走**。源码注释给的理由是「Desktop's built-in tool policy owns these tools elsewhere」——也就是说 TUI 侧另有产品层的审批路径，这个 gate 不是它的归属。这条我没有追到 TUI 的产品审批实现（`tui/src` 里搜不到 `permissionGate` / `cliProductPolicy` 的任何引用），所以只说事实：**这道 gate 在 TUI 下不覆盖内置工具**，至于 TUI 用什么替代它，本章不做结论。这值得下一轮专门看一眼。

## 7.4 进程外之二：MCP

【代码事实】`agent-modules/mcp`。工具名的投影规则（`runtime/tool-name.ts:1-36`）写得很克制：

```ts
/** Keep the existing runtime limit; changing provider limits is not part of this hotfix. */
export const MCP_RUNTIME_TOOL_NAME_MAX_LENGTH = 80;
/** Preserve the previous Server budget, leaving at least 25 characters for a Tool. */
export const MCP_RUNTIME_SERVER_SEGMENT_MAX_LENGTH = 48;

/** Public projection only. Routing must retain the original server/tool identity. */
```

名字归一成 `[a-zA-Z0-9_-]`，带控制字符（`\p{Cc}`）、格式字符（`\p{Cf}`）、代理对（`\p{Cs}`）的直接抛错；运行时名是 `mcp__<server>__<tool>`；超长了缩短的只是投影，注册表保留原始身份。

### stdio 继承完整环境

【代码事实】`runtime/transport/stdio.ts:17-20` 的头注释：

```text
 *   * `env` constructed as `{ ...process.env, ...config.env, ...injected.env }`
 *     — injected env wins so host-provided identity or policy data can
 *     override any stale value baked into config or leaking from the parent
 *     process env.
```

`:60-67` 的实现就是这三层展开，第一层是 `getProcessEnv()`（`:69-74`）——把 `process.env` 整个拷进去。

【推断】这是和 Plugin Hook 白名单的正相反的一处：**用户配一个 MCP server，那个进程能拿到 agent 进程的完整环境，包括用户 shell 里所有的 API key**。注释里那句「leaking from the parent process env」说明作者知道父进程环境会漏，处理方式是让宿主注入的值覆盖它，而不是把环境收窄。第 5 章 5.6 讲 bash 环境净化时提到的同一个问题，在这里的形态更直接——bash 至少还有 Layer A/B，MCP 完全没有。

另外两条：`cwd` 固定成 `homedir()`（`:9-12`，理由是不继承 launchd / Electron / systemd 的 CWD，避免 MCP 子进程对着 `/` 建目录）；连接池空闲 15 分钟回收（`runtime/connection-pool.ts:47`）。

### 延迟暴露默认关

【代码事实】见第 5 章 5.1：`resolveLocalMcpDisclosureOptions()`（`local-turn-tool-catalog.ts:480-527`）默认 `enabled: true`，但模型白名单默认空数组（`:530-537`），实际不生效。

## 7.5 进程外之三：Plugin 包

【代码事实】`local-runtime-v2/src/service/plugin-system/plugin/`。

**限制表**（`package/package-contract.ts:9-17`）：

| 项 | 上限 |
| --- | ---: |
| 归档字节 | 64 MiB |
| 归档条目 | 2,048 |
| 文件数 | 1,024 |
| 单文件 | 16 MiB |
| 总字节 | 64 MiB |
| 路径 | 512 字节 |
| 单段 | 128 字节 |
| 段数 | 16 |

**摘要与不可变快照**：

- 内容摘要格式 `sha256-tree-v1:<64 hex>`（`:21` 的 `CONTENT_DIGEST_PATTERN`），摘要计算时按包类型选路径策略（`minimax-portable` / `agent-plugin`）；
- 从 GitHub 导入（`import/github-archive.ts`）：`git clone --no-checkout --filter=blob:none --no-tags` → `fetch --depth 1 origin <sha>` → `checkout --detach <sha>` → 删 `.git` → 算目录摘要（`:41-73`）。下载超时 60 秒、归档上限 128 MiB、条目上限 100,000、git 超时 120 秒（`:16-23`）；
- 缓存命中要重算摘要（`package/archive-cache.ts:44,193-203`），对不上判 `CACHE_CORRUPT`；
- 本地 hook 包在挂载前复制到 staging 并重算摘要（`runtime/package-storage.ts:375-389`），扫描期间变了就抛 `LOCAL_PLUGIN_CHANGED_DURING_SCAN`：「local Plugin changed while its immutable Hook snapshot was materialized」。这个错误**不吞**（`:346-349`），直接往上抛；别的错误才降级成「没有 hooks + 一条诊断」。

【推断】「插件根目录不可变」在这里是靠摘要重算兑现的，不是靠文件权限。钩子契约里那句 `Host-owned writable state directory; the Plugin package root is immutable.`（`contracts.ts:37`）是同一个约定的另一半：要写就写 `pluginDataDir`（0o700），别写包目录。

### 两个不在 CLI 里露出的入口

【文档】`docs/tui-capabilities.md:13`：「`/plugins` and `mcode plugin` manage official installations and discovered local packages; **arbitrary marketplace registration and GitHub URL import are not exposed in the CLI/TUI**」。

【推断】导入器和摘要校验都实现了，产品入口没开。这和 7.2 那六个接线头、第 5 章 5.1 的 MCP 延迟暴露是同一个形态：**能力先落地，产品面按自己的节奏开**。

## 7.6 用户侧：Skills

【代码事实】`agent-modules/skills/src/types.ts:1`：

```ts
export type SkillSourceKind = 'project' | 'workspace' | 'agent' | 'global' | 'user' | 'builtin';
```

六个来源，注册表按优先级合并（`registry.ts` 附近有各来源的优先级表，`builtin: 4`）。目录渲染预算 20,000 字符（`:81`），外部来源的描述截到 120 字符（`:82`），超预算就停、后面的全丢，并记 `metrics.dropped`。

文件用 `O_NOFOLLOW` 打开（`:86-87`），目录变更监听有 200ms 去抖 / 1000ms 上限（`:83-84`）。

【推断】`O_NOFOLLOW` 这一笔是这一章唯一一处对「skill 是一个文件」这件事的防御——不允许通过软链把读取引到别处。对一个只是文本的扩展点来说，这是够的。

## 7.7 缺口

| 缺口 | 证据 | 后果 |
| --- | --- | --- |
| MCP stdio 继承完整进程环境 | `transport/stdio.ts:17-20,60-67` | 用户装的 MCP server 能读到 agent 进程里所有凭据 |
| Plugin Hook 失败即放行 | `runner.ts:124,1442-1448` | 该拦而崩掉的 hook 拦不住任何东西 |
| 同进程 SPI 六个适配器无消费者 | `native-production-dependencies.ts:102-105`（注释说 7 个） | 两套接线并存，读代码的人分不清哪套在跑 |
| 注释数字与引用数不一致 | 同上 vs 实际引用 | 详见上 |
| TUI 面不走内置工具权限门 | `local-turn-permission-gate.ts:577-587`；`native-production-dependencies.ts:229` | 命令行面被 gate 覆盖，TUI 面不覆盖；TUI 侧的替代路径本章未追到 |
| 插件市场与 GitHub 导入不开放 | `docs/tui-capabilities.md:13` | 导入器的代码路径没有产品入口 |
| hook 环境白名单 vs bash 黑名单 vs MCP 无处理 | `runner.ts:1771-1797`；`bash-subprocess-env.ts:166-188`；`stdio.ts:60-67` | 三条子进程路径对凭据的暴露程度三个样 |

## 7.8 本章结论

- 五条扩展路径，只有进程内那条没有隔离，而它只对第一方开放；对外开放的四条都在进程边界外。
- 进程内：9 个 hook、11 个适配器，生产只挂了 5 个（sessionReport、runawayGuard、toolOutputBudget、planMode、sourceReference），其余 6 个没有消费者。适配器包的定位是「只有 SPI 胶水，不选 host profile、不给默认列表」——默认列表确实没人给。
- Plugin Hook：11 事件、3 种格式、预算式超时（15s / 3s）、并发 8、环境白名单 17 个变量、失败即放行、退出码语义按格式分三种。hook 的 `allow` 只能免掉「规则没命中的兜底询问」，免不掉安全询问和 deny。
- MCP：工具名投影有 80 / 48 的长度上限且保留原始身份；stdio 子进程继承完整父环境，和 hook 的白名单正相反。
- Plugin 包：sha256 树摘要 + 不可变快照（扫描期间变了就抛错、不吞）；市场注册和 GitHub 导入不在 CLI/TUI 里露出。
- Skills：六个来源、20K 渲染预算、`O_NOFOLLOW` 打开。
