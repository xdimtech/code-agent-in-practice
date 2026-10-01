# 7. 扩展性与生态

## 7.1 扩展是 TS 模块，不是声明式清单

`ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>`（`packages/coding-agent/src/core/extensions/types.ts:1582`）——一个默认导出的函数。

加载器只认 `.ts` / `.js`（`loader.ts:667`），目录形式找 `index.ts` / `index.js`（`:699`），默认导出不是函数直接判失败（`:512`）。

声明式的部分只有 `package.json` 的 `pi` 字段（`pi-manifest.ts:4-10`），四类资源：

```json
{ "pi": { "extensions": [...], "skills": [...], "prompts": [...], "themes": [...] } }
```

生命周期（`loader.ts:545-564`）：`loadExtensionModule` → `factory(api)` → `commit()` / `discard()`。工厂抛错时把它注册过的订阅全部回滚。

**这个选择的含义**：扩展能力上限 = Node 能力上限。没有 schema 约束、没有能力声明、没法在加载前静态审查一个扩展能做什么。对比 MCP 那种"声明工具 + JSON-RPC 通信"的模型，这是完全相反的取舍——换来的是能力无上限与零通信开销。

---

## 7.2 扩展点清单

全部来自 `types.ts:1252-1500`：

| 扩展点 | API | 位置 |
| --- | --- | --- |
| 事件订阅（36 个事件） | `on(...)` | `:1257-1301` |
| 注册 LLM 工具 | `registerTool` | `:1308` |
| 斜杠命令 | `registerCommand` | `:1317` |
| 键盘快捷键 | `registerShortcut` | `:1320` |
| CLI flag | `registerFlag` / `getFlag` | `:1329, 1345` |
| 消息/条目渲染器、Markdown 变换 | 三个 `register*Renderer` | `:1352-1358` |
| 主动发消息、追加条目 | `sendMessage` / `sendUserMessage` / `appendEntry` | `:1365-1381` |
| 切模型、切 thinking 级别 | `setModel` / `setThinkingLevel` | `:1416-1422` |
| **注册 LLM provider** | `registerProvider` / `unregisterProvider` | `:1480, 1496` |
| 跨扩展事件总线 | `events: EventBus` | `:1499` |
| UI（对话框 / overlay / widget / 自定义编辑器） | `ExtensionUIContext` | `:133` |

36 个事件里，有几个的权力远超"通知"：

- **`before_provider_request` / `before_provider_headers` / `after_provider_response`** —— 可改写发往 LLM 的**原始 payload 与 HTTP header**；
- **`tool_call` / `tool_result`** —— 可改写工具入参与结果，也可 `block`（这是[第 5 章 §5.5](./05-tools-permissions.md) 说的那条唯一的拦截路径）；
- **`input`** —— 可拦截用户输入；
- **`session_before_compact` / `context`** —— 可接管压缩。

**判定：这不是"插件系统"，是"把整条主循环的每个接缝都开放出来"。** 一个扩展能改写系统提示、改写请求体、改写工具结果、注册自己的 provider、替换全部内置工具——基本上没有它做不到的事。

---

## 7.3 隔离：同进程，零隔离

**代码事实**：用 `jiti` 在宿主进程内直接 `import`（`loader.ts:498-510`）。pi 自身的 `pi-ai` / `pi-tui` / `pi-agent-core` / `index.ts` 通过 virtualModules 或 alias 注入（`loader.ts:10-27, 503-507`），所以扩展可以 `import { createBashTool } from "@earendil-works/pi-coding-agent"`。

**全仓库没有 Worker、子进程、`node:vm` 的任何痕迹。** 扩展拥有完整 Node 权限：`fs`、`child_process.spawn`、网络。

### 容错 ≠ 隔离

每个 handler 单独 try/catch，异常包成 `ExtensionError` 交给 listener，循环继续（`runner.ts:858-879`；`emitMessageEnd` 同构 `:908-920`）。

**这解决的是"一个扩展崩了不能拖垮别的扩展"，不是"一个扩展不能干坏事"。** 恶意扩展没有任何边界。

### 唯一的门是 project trust

`project_trust` 事件（`types.ts:521-543`）与 `isProjectTrusted()` 门禁（`package-manager.ts:1741-1744`）。也就是说：**装扩展这个动作被 trust 门控了，装上之后做什么不受任何约束。**

真正的隔离被外包给示例扩展——`sandbox`（OS 级）与 `gondolin`（QEMU 微虚机），见 §7.6。

**推断**：这与 pi 在权限上的立场是同一套哲学——提供机制，策略归用户。区别在于权限那边 README 写清楚了（根 `README.md:38-46`），扩展隔离这边没有对应的明确声明。

---

## 7.4 package-manager.ts 那 2,699 行管什么

它**不是扩展运行时**，是**资源包分发层**。

三种源（`package-manager.ts:138-152`）：npm / git / 本地路径。它解析 `package.json` 的 `pi` 清单，产出四类资源路径（`ResolvedPaths`，`:80`），带作用域（user / project / temporary）与**五级优先级排序**（`:188-192`，"first wins"）。

其余职责：

- semver 解析（`maxSatisfying` / `satisfies` / `validRange`）
- git ref 锁定与 `--prune --no-tags` 增量 fetch（`:1593-1625`）
- 离线模式 `PI_OFFLINE`（`:52`）
- 并发更新检查（`:48-50`）
- gitignore 处理、临时目录管理

### 与 npm 的关系

直接 shell out 调 `npm`，可替换为 bun/pnpm（`getNpmCommand` `:1747`）。

安装参数在 `getNpmInstallArgs`（`:1785-1806`）：npm 走 `--legacy-peer-deps`，注释（`:1787-1790`）说明原因——`@earendil-works/pi-*` 由宿主通过 loader alias 提供，不能让包管理器再装一份。**这是一段很诚实的取舍说明**，承认了 alias 注入的代价。

### ⚠️ 本次拆解发现的最主要不一致

**`getNpmInstallArgs` 没有 `--ignore-scripts`。**

全仓的 `--ignore-scripts` 只出现在两处：pi 自身的托管安装（`package-manager-cli.ts:92`）和构建脚本。**用户安装的扩展包不在覆盖范围内。**

对比 pi 对自己依赖的要求（见[第 2 章 §2.4](./02-architecture-and-guardrails.md)）：精确版本 + `npm ci --ignore-scripts` + lifecycle script 显式 allowlist + 每日 audit + pre-commit 拒绝 lockfile 变更。

**自己严，对用户包松。** `pi install some-extension` 的 postinstall 可以任意执行代码，而唯一的前置门是一次 project trust 确认。安全边界只剩 project trust 和 `--omit=dev`（`:1777`）。

考虑到 pi 对自身供应链的威胁建模是正确且清晰的（自己是 RCE 工具，供应链失守 = 用户机器 RCE），这条缺口更像是没顾上，而不是有意的取舍。

---

## 7.5 Provider 也是扩展点

`registerProvider(name, config)` 有四种粒度（`types.ts:1428-1481`）：

| 粒度 | 做法 |
| --- | --- |
| 换端点 | 只给 `baseUrl`，覆盖现有模型的端点 |
| 换模型目录 | 给 `models` 整体替换；另有 `refreshModels` 动态拉取（`:1533`） |
| 换认证 | 给 `oauth`，含 `login` / `refreshToken` / `getApiKey` 三方法（`:1535-1550`），接入 `/login` |
| 换协议 | 给 `streamSimple`（`:1522`），完全自定义 wire protocol |

`streamSimple` 有一条契约要求：**必须调用 `onPayload` / `onResponse`**，否则 `before_provider_request` / `after_provider_response` 这些钩子就断了。这是一个"自定义实现必须维护的不变量"，写在类型注释里。

加载期的 `registerProvider` 调用会排队，绑定后 flush（`runner.ts:357-372`），之后**立即生效，无需 `/reload`**。

示例：`custom-provider-anthropic/index.ts` 演示自定义 API 标识 + PKCE OAuth + streamSimple 全套；`custom-provider-gitlab-duo` 是企业内网场景。

**这一点值得单独说**：很多 agent 框架的 provider 层是写死的枚举，加一家厂商要改核心代码。pi 把它做成了运行时可注册的扩展点，且四种粒度可按需选择——只换 baseUrl 的场景不需要实现整个流式协议。

---

## 7.6 MCP：明确不支持

**代码事实：全仓库无 MCP 实现。**

`packages/coding-agent/README.md:499`：

> **No MCP.** Build CLI tools with READMEs, or build an extension that adds MCP support.

并链接博文作为理由。`packages/coding-agent/README.md:395` 把 "MCP server integration" 列为扩展**可以做的事**，不是已有能力。全仓仅有的提及是注释里把 "MCP bridges" 当作外部图片来源（`tool-result-images.ts:15`）。

**推断**：若要接 MCP，客户端侧实现应落在扩展的 `registerTool` + `session_start` 里——`registerTool` 能注册任意工具，`session_start` 能做连接初始化，机制是够的。

**这是 pi 与几乎所有同类产品的一处明确分野。** 它的替代方案是"CLI 工具 + README"——让模型用 bash 调命令行工具，用 README 当工具文档。考虑到默认工具集里有 bash 而没有 grep/find/ls（[第 5 章 §5.1](./05-tools-permissions.md)），这个立场是一贯的。

---

## 7.7 sandbox 与 gondolin：真正的隔离在这里

两个示例扩展，代表两种隔离强度：

### sandbox（OS 级）

`examples/extensions/sandbox/`，依赖 `@anthropic-ai/sandbox-runtime@0.0.26`（macOS `sandbox-exec` / Linux `bubblewrap`）。限制 bash 的文件系统与网络访问。配置 `~/.pi/agent/extensions/sandbox.json` 与 `.pi/sandbox.json` 合并、项目优先。

值得注意的是它的实现注释（`index.ts:7-9`）：坦承这是**整体替换内置 bash 工具**的示范，并指出另一条路是用 `tool_call` 事件改写入参而不替换工具。

**这是一段罕见的"我这么做但你可以那么做"的设计说明。** 两条路的取舍是：替换工具能控制 spawn 的全部细节，改写入参则能与其他 `tool_call` 扩展共存。

### gondolin（虚机级）

`examples/extensions/gondolin/`，依赖 `@earendil-works/gondolin@0.12.0` + QEMU（需 Node ≥ 23.6）。把**全部七个内置工具**重定向进 QEMU 微虚机，cwd 挂载到 `/workspace` 写穿到宿主，其余 guest 改动隔离（`index.ts:3-6`）。

关键证据：它 `import` 了 `createBashTool` / `createEditTool` 等工厂（`index.ts:26-33`）。

**这说明内置工具被刻意做成了可注入 operations 的形式。** [第 5 章 §5.3](./05-tools-permissions.md) 提到 grep 宁可自己 readFile 也不用 rg 的 `-C`，理由是让 `GrepOperations.readFile` 可被远端后端覆盖——gondolin 就是那个假想后端的真实案例。**这条设计线是贯通的，不是事后补的。**

注意 `containerization.md:12` 的表格里 gondolin 一行写的是 "Built-in tools **and `!` commands**"——它比 sandbox 多覆盖了用户手敲的 `!` 命令（对比[第 5 章 §5.5](./05-tools-permissions.md) 的绕过问题）。

---

## 7.8 值得称道与可疑之处

### 称道

1. **`loader.ts:25-27` 的注释解释了为什么 loader 不从 `index.ts` 再导出**——避免循环依赖，从而让扩展能 `import` 宿主包。这是"扩展与宿主共享类型"的关键 hack，且写明了原因。
2. **`runner.ts:70-88` 保留关键键位**（interrupt / exit / clear 等）不允许扩展覆盖——避免一个扩展把用户锁死在界面里。这是把"扩展有全部权力"这个前提下的一个具体风险单独处理掉了。
3. **`with-deps` 示例**专门验证 jiti 能解析扩展自己的 `node_modules`——扩展有自己的依赖树这件事被测过。
4. **内置工具的工厂化**（见 §7.7）——gondolin 能重定向七个工具，是因为它们本来就是可注入的。

### 可疑

1. **扩展包安装不禁 lifecycle script**（§7.4）——与仓库自身 `AGENTS.md` 的依赖安全规则直接矛盾。
2. **扩展同进程全权限**。`before_provider_headers` 能读写组装好的请求头，但 API key 是单独的 `apiKey` 字段，不在这份 header 里（`packages/ai/src/models.ts:655-657`：`apiKey` 与 `mergeHeaders(auth.headers, options.headers)` 分开传）——这道钩子本身不是泄漏 key 的通道。真正的通道更直接：扩展与宿主同进程，能读 `process.env` 和 `~/.pi/agent/auth.json`（`0o600` 只防其他 OS 用户，`auth-storage.ts:25`）。这与[第 5 章 §5.6](./05-tools-permissions.md) 的 `getShellEnv` 全量透传是同一类暴露，只是路径不同：一条是模型执行的命令能读 env，一条是扩展代码能读 env 和凭据文件。
3. **`custom-provider-anthropic/index.ts:51` 把 OAuth CLIENT_ID 做 base64 混淆**——CLIENT_ID 本身不是 secret，base64 也不是加密。属于无意义的遮掩，反而会让读者误以为它是敏感值。

---

## 7.9 本章结论

**pi 的扩展系统是"最大权力 + 最小约束"。** 36 个事件覆盖主循环每个接缝，provider 四粒度可换，七个内置工具可整体重定向，同进程零开销——能力上限非常高。

代价是三条：

1. **没有隔离**，恶意扩展等于 RCE；
2. **没有能力声明**，装之前无法知道一个扩展要做什么；
3. **扩展包安装不禁 postinstall**，这是唯一一处与 pi 自己的供应链纪律明显打架的地方。

生态立场上有两个明确的"不做"：

- **No MCP** —— 替代方案是 CLI 工具 + README，与"默认给 bash 不给 grep"一贯；
- **No sub-agents 内置** —— 见[第 6 章](./06-multi-agent.md)。

两者都写在 README 里，不是遗漏。

给下游拆解的探针：

- 扩展加载有没有加隔离（Worker / 子进程 / vm）
- `getNpmInstallArgs` 有没有补上 `--ignore-scripts`
- 有没有加能力声明 / 权限清单
- 有没有接 MCP（pi 明确没有，接了就是本家决策）
- `registerProvider` 的四种粒度有没有被裁剪（很多 fork 只需要一家 provider）
- 内置工具的工厂化注入有没有被保留（这是 sandbox/gondolin 能存在的前提）
