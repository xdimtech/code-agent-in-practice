# 5. 工具面、权限与 Code Mode

## 5.1 工具清单

`packages/coding-agent/src/core/tools/`，16 个文件 4,293 行。其中**只有 8 个是工具**，其余是辅助模块：

| 文件 | 行数 | 性质 |
| --- | ---: | --- |
| `bash.ts` | 544 | 工具（同时是 powershell 的实现基座） |
| `edit-diff.ts` | 556 | 辅助：匹配 + diff 生成 |
| `edit.ts` | 461 | 工具 |
| `grep.ts` | 390 | 工具 |
| `find.ts` | 380 | 工具 |
| `read.ts` | 358 | 工具 |
| `truncate.ts` | 276 | 辅助：统一截断 |
| `write.ts` | 274 | 工具 |
| `ls.ts` | 230 | 工具 |
| `index.ts` | 224 | 注册/工厂 |
| `output-accumulator.ts` | 222 | 辅助（bash 流式输出） |
| `path-utils.ts` | 118 | 辅助 |
| `render-utils.ts` | 85 | 辅助（TUI） |
| `powershell.ts` | 67 | 工具（薄封装） |
| `file-mutation-queue.ts` | 61 | 辅助：同文件写串行化 |
| `tool-definition-wrapper.ts` | 47 | 辅助 |

Schema 全部用 **typebox**（如 `edit.ts:34-54`、`read.ts:21-25`），`Static<typeof schema>` 出 TS 类型。没有 zod，没有手写 JSON Schema。另有 `constrainedSampling: getExperimentalToolSampling()`（`edit.ts:329`、`read.ts:222`）把同一个 schema 用于约束解码。

### 默认只开四个

工厂集中在 `index.ts:95-105`（`ToolName` 联合类型 + `allToolNames`）、`:182-193`（`createAllToolDefinitions`）。注册在 `agent-session.ts:2772` 的 `_buildRuntime()`。

但**默认激活集只有四个**（`agent-session.ts:2802`）：

```ts
["read", "bash", "edit", "write"]
```

grep / find / ls / powershell 默认不开，需要在设置里写 `defaultTools`（`settings-manager.ts:1273`，文档 `docs/settings.md:228`）或 SDK 显式传入（`core/sdk.ts:257`）。

**推断**：不给 grep/find/ls 是因为 bash 已经能调 rg/fd。证据在系统提示里——只有在没有 grep/find/ls 时才会追加"用 bash 做文件操作"的提示（`core/system-prompt.ts:104-113`）。也就是说这个取舍是有意识的，且 prompt 侧配套了。

---

## 5.2 edit：多点精确替换

### 基本策略

schema 是 `{path, edits: [{oldText, newText}]}`（`edit.ts:34-54`）。不是行号定位，不是 patch 应用。

关键约束写在 description 里（`edit.ts:38-39`）：

> Each `edits[].oldText` is matched against the **original** file, not after earlier edits are applied.

执行流水线（`edit.ts:336-385`）：

1. `withFileMutationQueue` 按 **realpath** 串行化同文件写（`file-mutation-queue.ts:16-26`）；
2. `ops.access()` 检查 R_OK|W_OK；
3. 读原文 → `splitBom()` 剥 BOM（`:364`，注释：模型不会在 oldText 里带不可见 BOM）；
4. `detectLineEnding()` + `normalizeToLF()` → **在 LF 空间做匹配**（`:365-366`）；
5. `applyEditsToNormalizedContent()` 核心（`edit-diff.ts:300-362`）；
6. 写回时 `bom + restoreLineEndings(...)`（`:370`）——**保留原文件的 CRLF/BOM**；
7. 返回 display diff + 标准 unified patch + `firstChangedLine`（`:374-383`）。

### 两层归一化

- **行尾**：`normalizeToLF` / `restoreLineEndings` / `detectLineEnding`（`edit-diff.ts:11-25`）。判定方式是"第一个 `\r\n` 是否早于第一个 `\n`"，不做全文统计。
- **模糊**：`normalizeForFuzzyMatch`（`:34-55`）——NFKC → **逐行 trimEnd** → 智能引号 `’‘„` → `'`、`“”` → `"` → 7 种 Unicode 破折号（U+2010..2015、U+2212）→ `-` → NBSP 与各类空格（U+00A0、U+2002-200A、U+202F、U+205F、U+3000）→ 普通空格。

**注意：不做前导缩进归一化，只 trimEnd。** 缩进必须精确匹配。pi 没有"缩进宽松匹配"。

匹配顺序（`fuzzyFindText`，`:207-245`）：先 `indexOf` 精确；失败才整篇归一化后再 `indexOf`。

### 模糊命中后的回写：本文件最漂亮的一段

只要任一 edit 走了 fuzzy，整批替换就在归一化文本上做（`:318`）。**但最终用 `applyReplacementsPreservingUnchangedLines`（`:132-173`）把改动按行块覆盖回原文**：被替换范围扩展到它触及的整行，这些行取归一化版本，**其余行逐字节保留原文**。

这样 fuzzy 匹配不会把整个文件的行尾空白和智能引号都悄悄洗掉。`:127-130` 的注释明确说明"以实际替换区间驱动保留，重复行不会对错位置"。

**这是同类实现里少见的细致。** 常见的偷懒做法是 fuzzy 匹配成功后直接写归一化全文，结果 diff 里出现一大片与本次修改无关的空白变更。

### 冲突处理：唯一性强制，无 replaceAll

`applyEditsToNormalizedContent`（`:300-362`）逐条检查：

- `oldText` 为空 → 报错（`:311`）
- 找不到 → `getNotFoundError`（`:253`）
- **`countOccurrences > 1` 直接报错**（`:328-331`）——**没有 `replaceAll`，没有 `expected_replacements` 参数**。且计数用的是 fuzzy 归一后的文本（`:247-251`），所以"仅行尾空白不同的两处"也会被判为重复，比 exact 计数更保守。
- 全部匹配完后按 `matchIndex` 排序，检测**区间重叠**并报错（`:341-350`）
- 替换按倒序应用保证 offset 稳定（`:111-120`）
- 结果与原文相同 → `getNoChangeError`（`:357-358`）

**原子性**：任何一条 edit 失败 → 整个调用抛错，**文件一个字节都不写**（写入在 `edit.ts:371`，在全部校验之后）。

### 错误信息区分单条与多条

`edit-diff.ts:253-289`，两套措辞——单条说 "the text"，多条说 `edits[i]`，让模型知道是哪一条挂了：

```
Could not find edits[2] in x.ts. The oldText must match exactly including all whitespace and newlines.
Found 3 occurrences of edits[1] in x.ts. Each oldText must be unique. Please provide more context to make it unique.
edits[0] and edits[1] overlap in x.ts. Merge them into one edit or target disjoint regions.
```

**但反馈只有文字，不回传"附近相似片段"或候选 diff。** not-found 时模型只能靠重读文件自救。这是一个可改进点——很多实现会附上最近似匹配。

### 模型兼容 hack

`prepareEditArguments`（`edit.ts:116-147`）在参数进入 schema 校验前做修复，注释直接点名模型（`:123`）：

> Some models (Opus 4.6, GLM-5.1) send `edits` as a JSON string instead of an array

处理：`edits` 是字符串 → `JSON.parse`；是单个对象 → 包成数组；顶层出现旧版 `oldText/newText` → 追加成一条 edit（`:138-146`）。

### 执行前预览

`computeEditsDiff(path, edits, cwd)`（`edit-diff.ts:514-543`）复用同一套匹配逻辑但**不落盘**，在 `edit.ts:404` 的 `renderCall` 里异步计算——参数流式到齐（`context.argsComplete`）就先把 diff 或错误渲染出来，真正执行后 `renderResult` 再用结果 diff 覆盖（`:424-431`），diff 相同就不重绘。

---

## 5.3 read / grep / find

### read

- schema `{path, offset?(1-indexed), limit?}`（`read.ts:21-25`）；越界直接抛 `Offset N is beyond end of file (M lines total)`（`:290`）。
- 截断 2000 行 / 50KB 先到先算（见[第 4 章 §4.4](./04-context-engineering.md)），三种续读提示（`:302-317`）。
- **超长单行兜底**（`:300`）：首行本身超 50KB 时不返回内容，而是返回一条可执行的 bash 建议：
  ```
  [Line 1 is 3.2MB, exceeds 50.0KB limit. Use bash: sed -n '1p' path | head -c 51200]
  ```
- **返回给模型的文本不带行号**，是原始内容 + 方括号元信息。行号只在 TUI 渲染层出现。这与 edit 是纯 string-replace 而非行号定位是**自洽的**——给了行号反而会诱导模型用行号思考。（对比 Claude Code 的 `cat -n` 风格。）
- 图片：`detectSupportedImageMimeTypeFromFile`（`:60`）→ `processImage`（`:255`，默认开，2000×2000，依赖 `@silvia-odwyer/photon-node`）。模型不支持视觉时追加 `[Current model does not support images...]`（`:93-98`）。
- **没有二进制检测**：非图片一律 `buffer.toString("utf-8")`（`:277`）。读 `.so` 会产出替换字符乱码，只靠 50KB 截断兜底。**这是一个真实缺口。**
- 路径容错 `resolveReadPathAsync`（`:243`）：依次尝试 原路径 / `AM.`→窄空格 AM / NFD / `'`→`’` / NFD+`’` 五种变体——专治 macOS 截图文件名与 NFD 文件系统。

### grep → ripgrep，find → fd

两者都 shell out，**不自己遍历**。缺失时会自动下载（`utils/tools-manager.ts`）。

grep（`grep.ts:177`）：
- `--json --line-number --color=never --hidden` + 可选 `--ignore-case` / `--fixed-strings` / `--glob`（`:222-225`）
- 流式解析 `match` 事件（`:275-292`），达到 limit（默认 100）立刻 `child.kill()`（`:288`），并标记 `killedDueToLimit` 以免把主动杀进程误判为失败（`:307`）
- **`context > 0` 时不用 rg 的 `-C`**，而是自己 readFile + 缓存（`:205-216`）再切片拼上下文（`:253-272`）。**推断**：这是为了让 `GrepOperations.readFile` 能被 SSH 等远端后端覆盖（`:69` 注释 "Default: local filesystem plus ripgrep"），代价是本地场景多一次文件读。

find（`find.ts:225`）：
- `--glob --color=never --hidden --max-results N`（默认 1000）
- **glob 语义补丁**（`:253-260`）：fd 默认只匹配 basename，所以 pattern 含 `/` 时加 `--full-path` 并自动补前缀 `**/`；Windows 上再把 `/` 换成 `[/\\]`（`:263-264`）
- **git 边界处理**（`:236-249`，引用 issue #5960）：向上逐级找 `.git`，**不在**仓库内才加 `--no-require-git`（否则 fd 会忽略 .gitignore）；**在**仓库内保留 fd 默认的 git-aware 行为，使父目录 .gitignore 在嵌套仓库边界处停止。

ignore 规则**完全委托给 rg/fd 自身**，工具代码里没有用 `ignore` npm 包。**grep 没有对应的 git 边界处理——这是 grep/find 之间一处不对称。**

`ls` 是唯一自己实现的（`ls.ts:45-49` 用 `fs.readdir/stat`），默认 500 条上限。

### powershell 只是 bash 的配置化复用

`bash.ts` 导出了泛化的 `createShellToolDefinition(cwd, config, options)`；`powershell.ts:39-47` 只提供一份 `ShellToolConfig`（name/label/shellName/prompt `PS>`/tempFilePrefix），`:49-57` 调用同一个工厂，类型全是 alias（`:23-27`）。

**唯一的行为差异**是每条命令前注入 UTF-8 前缀（`:16, :35`）：

```powershell
try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}
```

解决 Windows 控制台默认代码页乱码。

**但 Windows 上不会自动切换**——默认激活集恒为 `["read","bash","edit","write"]`，用户必须自己在设置里换成 powershell（`docs/settings.md:236-240`）。非 Windows 上真调用会抛 `The powershell tool is only available on Windows.`（`utils/shell.ts:127`），可执行文件优先 `pwsh.exe` 再 `powershell.exe`（`:130`）。

**这对 Windows 新用户不友好**，虽然切换成本只是一行设置。

---

## 5.4 权限：README 说的是真的

pi 的根 README 在 "Permissions & Containerization" 一节（`README.md:38-46`）写：

> Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

`SECURITY.md:6-9` 与 `packages/coding-agent/docs/containerization.md:3` 口径一致。`packages/coding-agent/README.md:503` 在 "Philosophy" 一节里把它列为六个"明确不做"之一（完整清单见[第 6 章 §6.1](./06-multi-agent.md)）：

> **No permission popups.** Run in a container, or build your own confirmation flow with extensions inline with your environment and security requirements.

注意这是**两个不同的 README**：根 `README.md`（114 行）讲安装与权限立场，`packages/coding-agent/README.md`（718 行）是产品手册。

### 最完整的一份声明在 `docs/security.md`

`packages/coding-agent/docs/security.md`（59 行）是四处声明里唯一讲了**理由**的。`:31-37` 的 "No Built-in Sandbox" 一节：

> Pi does not include a built-in sandbox. Built-in tools can read files, write files, edit files, and run shell commands with the permissions of the pi process. Extensions are TypeScript modules that run with the same permissions.
>
> This is intentional. […] **A partial in-process sandbox would be easy to misunderstand as a security boundary** while still depending on the host shell, filesystem, package managers, credentials, and extension code. Real isolation needs to come from the operating system or a virtualization/container boundary.

**这是本次拆解里最值得引用的一段设计论证。** 它的论点不是"做沙箱太麻烦"，而是"半吊子沙箱比没有沙箱更危险，因为用户会把它当边界信"。同一页的 `:37` 还把 project trust 的定位钉死：

> Project trust is only an input-loading guard. […] It does not make untrusted code, untrusted prompts, or untrusted model output safe. Prompt injection from repository files, comments, documentation, context files, or build output is **expected local-agent risk and cannot be reliably prevented by pi**.

`:59` 进一步把"无内置沙箱、prompt injection、用户装的扩展/skill 的行为"**显式划到安全边界之外**，只接受"真正的权限边界绕过"或"pi 授予了本地用户原本没有的访问权"这两类报告。

**判定：pi 的威胁模型是清晰、自洽且写下来了的。** 它不是没想过权限问题，是想清楚后选择把边界放在 OS/容器层。这一点在下游厂商拆解时要特别注意——**若某家在 pi 上加了进程内权限门却没同时加 OS 级隔离，那正是这段文档警告的"看起来像边界的东西"。**

**核实结论：声明准确，代码中不存在任何工具执行前的内置权限门。**

grep `approval|permission|allowlist|denylist|confirm|trust|dangerous|yolo|autoAccept|requireApproval` 覆盖 `packages/*/src`，命中可分三类，**没有一类是工具执行前的权限门**：

### (a) 真正的权限门 —— 只存在于示例扩展

- `examples/extensions/permission-gate.ts:11-31` —— `rm -rf` / `sudo` / `chmod 777` 正则 + `ctx.ui.select` 确认
- `examples/extensions/protected-paths.ts:11-27` —— 阻断写 `.env` / `.git/` / `node_modules/`
- `examples/extensions/plan-mode/index.ts:171` —— bash 只读命令 allowlist
- 另有 `confirm-destructive.ts`、`timed-confirm.ts`、`sandbox/`、`gondolin/`

**这些不会被自动加载。** grep `examples/extensions` 在 `src/` 里只有一处命中，是系统提示词里的文档引用（`core/system-prompt.ts:143`），不是加载逻辑。`containerization.md:26-28` 明确要求用户手动 `cp -R` 到 `~/.pi/agent/extensions/`。

### (b) project trust —— 门控的是配置加载，不是工具执行

`core/project-trust.ts:24-25` 的提示文案明说信任范围是 "load `.pi` settings and resources, install missing project packages, and execute project extensions"。触发资源列表在 `trust-manager.ts:29-37`：`settings.json`、`extensions`、`skills`、`prompts`、`themes`、`SYSTEM.md`、`APPEND_SYSTEM.md`。

默认策略 `"ask"`（`settings-manager.ts:73, 968-971`）。

**关键：不信任一个项目，agent 照样能在里面 `rm -rf`。** project trust 与 bash/edit/write 的执行完全无关。

#### ⚠️ `--approve` / `--no-approve` 不是权限开关

`cli/args.ts` 的 flag 列表里有 `--approve`/`-a` 与 `--no-approve`/`-na`，字面上极易被当成"自动批准工具调用"。**核实：不是。**

`args.ts:219-222` 两个分支都只写一个字段：

```ts
result.projectTrustOverride = true;   // --approve
result.projectTrustOverride = false;  // --no-approve
```

help 文案（`:316`）是 "Trust project-local files for this run"，`docs/settings.md:16`、`docs/security.md:29`、`docs/usage.md:126,130,165,248` 口径一致。**它覆盖的是本节 (b) 的项目信任，不触及任何工具执行路径。**

顺带一个容易忽略的行为（`docs/security.md:29`）：**非交互模式（`-p`、`--mode json`、`--mode rpc`）根本不弹信任提示**，没有已保存决策时按 `defaultProjectTrust` 走——默认值 `"ask"` 在这里等同于"忽略项目资源"。所以 CI 里跑 pi 会静默跳过 `.pi/` 下的一切配置，除非显式加 `-a`。

> 这条对下游厂商拆解有直接意义：**如果某家把 `--approve` 改成了工具审批语义，那是一次语义劫持**，同名 flag 在 pi 与 fork 里含义完全不同。

> README 那一节没提 project trust，读者可能误以为 pi 零确认。准确说法是：**pi 有项目配置加载的信任门，但没有工具执行的权限门。**

### (c) `--tools` / `--exclude-tools` —— 是能力裁剪，不是权限

`agent-session.ts:216-219` 的注释即为 "only these tool names are **exposed**"，CLI 对应 `cli/args.ts:297,299`。这是工具注册表过滤，在 `beforeToolCall` 之前很久就生效。把 bash 排除掉确实能阻止模型跑命令，但这是"不给工具"而非"拦截调用"。

### 没有 `--yolo` 这类开关

grep `--yolo` / `--dangerously-skip-permissions` / `autoAccept` / `requireApproval` 零命中——**因为根本不需要，默认就是全放行**。

（`dangerouslyAllowBrowser` 的命中全部是 OpenAI/Anthropic SDK 的浏览器标志，与权限无关。）

---

## 5.5 `beforeToolCall` 的实际用途

L1 的 `beforeToolCall` 提供了完整的阻断能力（类型 `packages/agent/src/types.ts:56-70` 的 `BeforeToolCallResult { block?, reason?, terminate? }`；调用点 `agent-loop.ts:617-644`，在参数准备与校验**之后**、执行之前；返回 `block: true` 时合成一个 error tool result 而不执行）。

**全仓唯一给 `agent.beforeToolCall` 赋值的产品代码是 `agent-session.ts:488`**，实现如下（`:488-506`）：

1. 取当前 `this._extensionRunner`
2. **`if (!runner.hasHandlers("tool_call")) return undefined;`**（`:490-492`）——没有扩展注册 handler 就直接放行，零检查
3. 否则 `runner.emitToolCall(...)`，把扩展返回的 `{block, reason}` 原样回传
4. catch 分支把非 Error 异常包成 `"Extension failed, blocking execution: ..."` 抛出

**判定：这是纯粹的扩展事件分发，不是权限检查。** 方法自身的注释用的词是 interception（拦截点），不是 permission（`:479-486`）。

**所以 pi 提供的是权限*机制*（hook + block 语义），不提供任何权限*策略*。** 策略必须由用户自己装扩展。

### `!` 用户命令绕过这条路径

`modes/interactive/interactive-mode.ts:6459-6468` 的 `handleBashCommand` 发的是 `user_bash` 事件，**不经过 `beforeToolCall`**（RPC 模式同理，`modes/rpc/rpc-mode.ts:565`）。

装了 `permission-gate.ts` 只能拦模型发起的 bash，**拦不住用户自己敲的 `!`**。`containerization.md:12` 的表格里 Gondolin 一行专门写了 "Built-in tools **and `!` commands**"，隐含承认两者是分开的路径，但没有明确警示。

---

## 5.6 bash 的安全边界

### 执行方式：shell，不是 execve

`bash.ts:101-107`：

```ts
const child = spawn(
  shellConfig.shell,
  commandFromStdin ? shellConfig.args : [...shellConfig.args, command],
  { cwd, detached: process.platform !== "win32", env: env ?? getShellEnv(), ... }
);
```

shell 参数来自 `utils/shell.ts:21`（`["-c"]`，legacy WSL bash 走 `-s` + stdin）与 `:119`（fallback `sh -c`）。**模型给的字符串被完整交给 shell 解释。**

**命令解析/拦截：完全没有。** `bash.ts` 全文无正则匹配、无 token 解析、无黑白名单。唯一的命令变换是 `commandPrefix` 拼接（`:354`）和可选的 `spawnHook`（`:164-189`，给扩展重写 command/cwd/env 用，默认 undefined）。

PowerShell 同理，`utils/shell.ts:122` 的 `POWERSHELL_ARGS` 带 `-ExecutionPolicy Bypass`。

### 超时：默认没有

schema 描述明写 "optional, **no default timeout**"（`bash.ts:44`）。上限 `MAX_TIMEOUT_MS = 2_147_483_647`（`:26`），约 24.8 天。

**模型不传 timeout，命令就可以永远挂着。**

### 进程清理

- `detached: true`（非 Windows），子进程自成进程组
- pid 注册进全局集合 `trackDetachedChildPid`（`:109`），进程退出时 `killTrackedDetachedChildren` 统一清理（`shell.ts:209-214`）
- `killProcessTree`（`shell.ts:216-245`）：Unix 下 `process.kill(-pid, "SIGKILL")` 杀整个进程组，失败退化为只杀直接子进程；Windows 用 `System32\taskkill.exe /F /T /PID`（注释说明刻意用绝对路径，不依赖 PATH）
- **已知杀不干净的场景（代码注释自陈）**：`utils/child-process.ts:37-47` 的注释指向 issue `earendil-works/pi#5303`——短命子进程退出后，分离的孙进程仍持有 stdout/stderr 管道。实现用"管道静默 100ms 才收尾"的空闲计时器（`EXIT_STDIO_GRACE_MS = 100`，`:16`；`armIdleTimer` `:83-86`）
- **推断**：一个自己 `setsid` 脱离进程组的守护进程，`kill(-pid)` 杀不到；`killProcessTree` 没有递归枚举子孙 pid 的逻辑。这是典型的逃逸路径，但仓库里没有明确记录它的测试或注释。

### 环境变量：完整继承，凭据全可见

`shell.ts:138-150` 的 `getShellEnv()` 返回 `{ ...process.env, PATH: binDir + 原PATH }`——**全量透传**，并在 PATH 前面插了 pi 的 bin 目录。

**`ANTHROPIC_API_KEY`、`AWS_*`、`GITHUB_TOKEN` 等凭据对模型执行的命令全部可见**，`env | grep KEY` 即可读到。

唯一被删的是四个 pi 自己的变量（`bash.ts:172-177`：`PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`），而且删掉后在 `exposeSessionEnvironment`（默认 `true`，`:333`）时立刻重新填回（`:178-187`）。**这是"防止陈旧值泄漏"的卫生处理，不是安全隔离。**

---

## 5.7 写操作没有任何路径边界

**代码事实**：`edit.ts` / `write.ts` 都没有路径限制。

- `write.ts:208` `resolveToCwd(path, cwd)` → `:221` `mkdir(dir, {recursive:true})` → `:225` 直接写。中间**没有任何"是否在 cwd 内"的判断**。
- `edit.ts:334` 同样 `resolveToCwd`，随后只检查文件**是否存在**（`:348-356`），不检查位置。
- `core/tools/path-utils.ts` 全文 118 行，只有 `expandPath` / `resolveToCwd` / `resolveReadPath`——`~` 展开、绝对路径处理、以及一堆 macOS 文件名变体回退。**没有 path traversal 校验，没有 cwd 边界检查，没有 `.git` 保护。**

因此 `write` 一个 `~/.ssh/authorized_keys` 或 `../../../etc/...` 在代码层面无阻碍，受限的只有 OS 文件权限。

`.git` 在 `tools/` 下仅出现于 `find.ts:179`（glob ignore）与 `:243`（定位 repo root），与写保护无关。唯一的 `.git` / `.env` 写保护在示例扩展 `protected-paths.ts:11`，需手动安装。

### 交互式确认也没有内置

`modes/interactive/` 里不存在"工具执行前弹确认框"的内置路径。

存在的是一套**给扩展用的**通用对话框 API（`interactive-mode.ts:2443-2459` 的 `createExtensionUIContext()` 暴露 `select`/`confirm`/`input`/`notify`；`:2557-2564` 的 `showExtensionConfirm()`）。它的**内置调用者只有两处**，都与工具权限无关：

1. `:2566-2572` `promptForMissingSessionCwd` —— session cwd 丢失时的恢复确认
2. `:2428-2441` `createProjectTrustContext` —— project trust 提示

---

## 5.8 v2 工具层：一次认真的依赖倒置

`packages/agent` 的包名就是 **`@earendil-works/pi-agent-core`**（`package.json:2`），而 `coding-agent` 依赖它。所以 v2 不是"另一个 app"，是**下层 core 包里新建的 harness 自带工具**。

`packages/agent/src/harness/tools/`，10 文件 1,203 行，**只有 4 个工具：read / write / edit / bash**。没有 grep / find / ls / powershell。

经 `packages/agent/src/index.ts:108` 全量导出，但仓库内唯一消费者是 `packages/agent/test/harness/tools.test.ts`——**coding-agent 尚未切过去**。

### v2 = v1 去掉 Node 依赖和 TUI 耦合

| 文件 | v1 | v2 | 差异 |
| --- | ---: | ---: | --- |
| `edit-diff.ts` | 556 | 500 | 主体逐字相同；v2 删掉 `node:fs` 导入、删掉 TUI 预览用的 `computeEditsDiff` 等、`splitBom` 内联成本地 `stripBom` |
| `edit.ts` | 461 | 140 | 删掉的 300 行全是 TUI 渲染。核心算法、schema 文案、`prepareEditArguments` 的模型兼容 hack **完全一致** |
| `read.ts` | 358 | 144 | 截断/续读文案逐字相同；图片处理从内置 `processImage`（photon 依赖）改为**可注入的 `ReadImageProcessor`**（v2 `:32-43`），不注入时返回 `[Image omitted: configure an imageProcessor...]`（`:82`） |

直接证据：v2 的 `image.ts` **手写 base64**（`:12-25`）不依赖 `Buffer`，`read.ts` 用 `TextDecoder`/`TextEncoder`（`:97,120`），`image.ts:33-45` 的 PNG 检测还专门排除 `acTL`（动图）。

**推断**：v2 是把 v1 工具按"零 Node 内置模块、零 TUI、零平台假设"重写，为可移植 runtime（浏览器 / 远端 / 沙箱）铺路。grep/find/ls/powershell 没搬过去，正是因为它们强依赖 spawn 子进程 + 下载 rg/fd 二进制，与这个目标冲突。

### 签名差异：`ExecutionEnv` → `toolContext`

CHANGELOG 的说法核实属实（`packages/agent/CHANGELOG.md:69`）：

> Replaced `AgentHarness`'s `ExecutionEnv` dependency and context-free `AgentTool` inputs with application-defined `toolContext` values and context-aware `AgentHarnessTool` definitions.

类型（`packages/agent/src/harness/types.ts:81-99`）：

```ts
export type AgentHarnessTool<TContext extends object | undefined, ...> =
  Omit<AgentTool<...>, "execute"> & {
    execute(toolCallId, params, signal, onUpdate, context: TContext): Promise<...>;
  };
```

**第 5 个参数从可选的 `ctx?: ExtensionContext` 变成必选、类型参数化的 `context: TContext`**——工具在类型上声明自己需要什么上下文。

对比 v1：`ToolDefinition.execute(..., ctx?: ExtensionContext)`（`tool-definition-wrapper.ts:17-18`），ctx 可选、类型固定、由 wrapper 用 `ctxFactory()` 兜底注入。

具体变化：

- 内置工具声明 `TContext extends ExecutionToolContext`，而 `ExecutionToolContext = { env: ExecutionEnv }`（`tools/tool-context.ts:4-6`）——**只是一个约束下界**，应用可以扩展成 `{env, myThing}` 而不破坏内置工具（`createEditTool<TContext extends ExecutionToolContext>`，`edit.ts:90`）。
- 工具体不再 import `fs`：改用 `env.fileInfo()` / `readTextFile()` / `readBinaryFile()` / `writeFile()` / `absolutePath()` / `canonicalPath()`（v2 `edit.ts:107-125`、`read.ts:54-55`、`write.ts:27-30`）。
- `ExecutionEnv = FileSystem & Shell`（`types.ts:315`），错误是 **Result 风格**（`{ok,value}|{ok,error:FileError}`）而非 throw，配 `getOrThrow()` 与带稳定 code 的 `FileError`（`types.ts:127-155`）。
- `withFileMutationQueue` 从模块级全局 Map + `fs.realpath`（v1 `:4,18`）改成 **`WeakMap<ExecutionEnv, State>`**（v2 `:9`）+ `env.canonicalPath`（`:22`）——**每个 env 一套队列**，多环境并存不互相串锁。
- bash 的 `prepare` 钩子拿到 context 且可 async（`bash.ts:29-33`），可改写 command/cwd/env/inheritEnv。

**关键设计约束写在设计文档里**（`packages/agent/docs/harness.md:2677`）：

> For each live tool batch, the harness resolves `toolContext` **exactly once**, caches bound `AgentHarnessTool<TContext>` adapters in `DriveState.toolBatches`, and passes that same context as the fifth execute argument for every call. Safe replay after restart creates one new batch snapshot; **context is environmental and never persisted**.

以及（`harness.md:2227, 1958`）：`toolContext` 与 `systemPrompt`/`toProviderMessages` 同属"确定性/幂等计算回调"，**抛错会 fault 整个 harness**，副作用必须放 hook 里。

### 这次重构解决的是什么

**推断**，基于上述事实：

1. **依赖倒置**。v1 每个工具各自定义一套 ops 接口（`EditOperations` / `ReadOperations` / `GrepOperations`…，重复且不一致）；**v2 把 N 套 ops 收敛成 1 个 `ExecutionEnv`**。同一份 edit 逻辑可跑在本地 Node、SSH 远端、容器、浏览器 OPFS 上。
2. **可扩展而非固定**。泛型 `TContext extends ExecutionToolContext` 让应用把自己的东西（会话、审批器、遥测）塞进同一个 context 传给自定义工具，内置工具照常工作。v1 的 `ExtensionContext` 是写死的类型，扩展要加东西只能改 core。
3. **持久化/重放友好**。context 每 batch 解析一次、不持久化，把"环境"与"可持久化状态"干净切开，让 harness 能在崩溃后重放工具调用（`harness.md:2611` 的 `replay?: "never"|"safe"`）。v1 的 ctxFactory 是隐式全局，做不到。
4. **代价**：出现两套并行实现，约 800 行有效重复，其中 `edit-diff.ts` 500 行几乎逐字重复，且**已经在分叉**（`splitBom` vs `stripBom`）。

---

## 5.9 Code Mode：没有

grep `codeMode|code_mode|runCode|executeCode` 全仓库**零命中**（唯一两条是 `test/model-resolver.test.ts:531,556` 的变量名 `commandcodeModel`，无关）。

**pi 不提供"让模型写代码来调用工具"的模式。**

模型的编排能力来自三处：

1. **edit 的批量语义**——一次调用多个 `edits[]`，prompt 明确要求合并（`edit.ts:60`："use one edit call with multiple entries in `edits[]` instead of multiple edit calls"）；
2. **bash / powershell**——事实上的通用逃生舱。默认工具集含 bash 而不含 grep/find/ls，说明设计上就鼓励用 shell 组合；read 的超长行兜底甚至直接给出 `sed` 命令；
3. **harness 的 sequential/parallel tool batch**——编排在 runtime 层（`harness.md:2799`），不是模型写代码。

> 注意：`packages/agent/src/search/` 是**会话记录搜索**（操作 `SessionStorage`/`Entry`），与文件搜索无关，别混淆。

对比：codex 有四个 `code-mode*` crate，deepseek-harness 有 `ptc-runtime`。**这是 pi 与几家厂商实现的一处明确分野。**

---

## 5.10 本章结论

**工具层是"薄工具 + 厚辅助"，质量相当高。**

值得学的：

- edit 的 **fuzzy 匹配但按行块保留原字节** —— 避免无关的空白/引号变更污染 diff；
- edit 的**唯一性强制 + 重叠检测 + 全或无原子写** —— 没有 `replaceAll` 是有意的保守；
- **read 不返回行号**，与 edit 的 string-replace 定位方式自洽；
- **grep/find 外包给 rg/fd** 并自动下载，加上 fd 的 glob 语义补丁与 git 边界处理；
- v2 的 `ExecutionEnv` 依赖倒置——N 套 ops 收敛成 1 个接口。

短板：

- read **没有二进制检测**；
- edit 失败时**不给候选片段**，模型只能重读文件；
- powershell **不自动按平台启用**；
- grep 缺少 find 那样的 git 边界处理。

**权限方面，README 的声明准确且不含糊：pi 提供机制，不提供策略。** 这是一个自觉的定位而非疏忽——`beforeToolCall` 的阻断语义是完整的，示例扩展里有四五个可用的权限门实现，沙箱方案（sandbox / gondolin）也都写好了。`docs/security.md:35` 更进一步给出了论证：**半吊子的进程内沙箱会被误认成安全边界，反而更危险**，所以真隔离只能来自 OS/虚拟化层。

这个定位有三条边界，文档覆盖程度不一：

1. **project trust 门控的是配置加载，不是工具执行**——不信任的项目照样能被 `rm -rf`。**这一条 `docs/security.md:7,37` 写得很清楚**（"only an input-loading guard"），但根 `README.md:38-46` 那一节没提，只读 README 的人会漏掉。
2. **`!` 用户命令绕过 `beforeToolCall`**，权限门扩展拦不住。**任何文档都没写**，只能从 `containerization.md:12` 表格里 Gondolin 行的 "and `!` commands" 反推。
3. **凭据对模型执行的命令全部可见**（`getShellEnv` 全量透传 `process.env`）。`docs/security.md:41-51` 的容器化建议里提到"传最少的 API key / 用短期凭据"，算是间接覆盖，但没有点破"`env` 一条命令就能读到全部 key"这个直接后果。

第 3 条在"用 pi 跑不受信任的仓库"这个场景下是最实际的风险——不需要绕过任何拦截，`env` 一条命令就够了。第 2 条则是唯一一条**文档与实现存在真实落差**的：装了 `permission-gate.ts` 的用户会合理地以为自己被保护了。

给下游拆解的探针：

- 有没有加真正的 permission gate，加在 `beforeToolCall` 还是别处
- **`--approve` 的语义有没有被劫持**（pi 里是项目信任；改成工具审批就是同名不同义，最容易误读）
- **有没有加"进程内沙箱"** —— 若加了但没有配套 OS 级隔离，正是 `docs/security.md:35` 警告的那种伪边界
- `!` 命令有没有被纳入同一条权限路径
- `getShellEnv` 有没有做凭据剥离
- write/edit 有没有加 cwd 边界或 `.git`/`.env` 保护
- bash 有没有默认超时
- 有没有 code mode（pi 没有，有就是本家设计）
- 工具层是 v1 形态还是已经切到 `AgentHarnessTool`
