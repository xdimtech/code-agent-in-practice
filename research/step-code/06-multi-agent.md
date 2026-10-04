# 6. 多 Agent 编排

> 对照基准：[pi 第 6 章](../pi/06-multi-agent.md)。pi 的立场是「明确不做」：subagent 只是一个 1,038 行的示例扩展。Step-Code 把它做成了产品，并在上面再加了一层脚本化的 workflow。

## 6.1 subagent：从示例到内置工具

| | pi 的示例扩展 | Step-Code |
| --- | --- | --- |
| 位置 | `examples/extensions/subagent/index.ts`（1,038 行，一个文件） | `features/step-subagent.ts`（657 行）+ `step-subagent-agents.ts`（239 行）+ `features/subagent/` 6 个文件 1,820 行 |
| 是否默认可用 | 否，要自己装 | 是，内联扩展 |
| 子进程参数 | `--mode json -p --no-session`（`:300`） | `--mode rpc --session-id <id>`（`features/subagent/rpc-adapter.ts:183-202`） |
| 子进程寿命 | 一次调用一个进程 | **长驻**：`keepAlive` 时进程活过一轮，后续消息复用 |
| 后续对话 | 不能 | `agent_send` 工具（`step-subagent.ts:613-614`） |
| 并发 | 8 个任务 / 4 并发（`:33-34`） | 相同的两个数（`:72-73`） |
| 工作区隔离 | 无 | 可选 git worktree |
| 递归 | 无限制 | 子进程不再注册 subagent 工具 |

### 架构分水岭：还是子进程

pi 第 6 章把「spawn 子进程还是进程内复用 agentLoop」称为架构分水岭。Step-Code 选的还是子进程——文件头写得很明白（`features/step-subagent.ts:1-8`）：

```
// packages/coding-agent/src/features/step-subagent.ts
/**
 * Step's native subagent extension.
 *
 * This is intentionally a thin adapter around the public Pi ExtensionAPI. A
 * child is another Step/Pi process in JSON mode, while the parent keeps the
 * normal AgentSession loop and native TUI renderer. No second session
 * authority is created here.
 */
```


「No second session authority」是关键词：父进程里只有一个会话权威，子 agent 是另一个完整的 `step` 进程，自己管自己的会话文件。

（这段头注释说的「JSON mode」已经过时：默认 runner 在 `:393-398` 的注释和 `rpc-adapter.ts:183-202` 的实际参数都是 `--mode rpc`。）

### 为什么从 json 换成 rpc

`step-subagent.ts:393-398` 的注释：

```
// packages/coding-agent/src/features/step-subagent.ts
/**
 * Default child runner (S2a): one long-running `--mode rpc --session-id` child
 * per subagent session. Each call sends one `{type:"prompt"}` turn and resolves
 * when the child's run settles; with `keepAlive` the child survives the turn so
 * follow-up replies reuse its provider cache and transcript. A dead child is
 * respawned with the same session id and resumes the transcript from disk.
```


三个收益都写在里面：**复用 provider 缓存**（进程不死，前缀缓存不丢）、**复用会话记录**、**崩了能续**（同一个 session id 重新拉起，从磁盘恢复）。pi 的 `-p --no-session` 是一次性的，每次委派都从零开始付整段上下文的钱。

代价是父进程要当一个 RPC 客户端。`rpc-adapter.ts`（500 行）做的就是这件事：把子进程 stdout 分流成协议帧和会话事件（`:33-51`），处理命令确认、阻塞式的扩展 UI 对话框（自动取消）、扩展错误、以及「需要输入」的催促。

### 防递归与资源上限

【代码事实】

- `:76` `CHILD_MARKER = "STEPCODE_SUBAGENT_CHILD"`；`:515-518`：子进程继承这个环境变量，「still gets Step's provider and tool profile, but does not recursively expose another subagent tool」。**深度硬限制为 1。**
- `:72-75`：最多 8 个并行任务、默认 4 并发、单行 JSON 上限 2 MiB、最多 256 条消息。
- `rpc-adapter.ts:31`：stderr 只留最后 32,000 字符。
- 系统提示写到临时目录，文件权限 `0o600`。

### 四个内置 agent

`features/step-subagent-agents.ts:56-93`：

| 名字 | 工具 | 用途 |
| --- | --- | --- |
| `general` | 全部 | 实现与修改 |
| `explore` | `read_file` `find_files` `search_files` `list_directory` | 只读侦察，不能改文件、不能跑命令 |
| `review` | 上面四个 + `run_command` | 只读评审，可以跑命令 |
| `planner` | 同 `review` | 出实现计划 |

**用工具白名单定义角色**，而不是靠提示词约束——`explore` 根本拿不到写工具。用户与项目级的 agent 定义沿用 pi 的 markdown + frontmatter 格式，只是目录从 `.pi` 换成 `.stepcode`（`:1-7`）。

### worktree 隔离

`features/subagent/helpers.ts:73-98` 的 `allocateStepWorktree`：在临时目录里 `git worktree add -b step-agent/<label>-<uuid8>`，清理时 `worktree remove --force`。并行的写任务各自在一棵工作树里改，互不踩脚。pi 的示例没有这个。

## 6.2 workflow：模型写脚本，沙箱里跑

pi 没有 workflow 引擎——它的做法是把编排下沉到 prompt 模板。Step-Code 加了一个：`features/workflow/`，16 个文件 3,505 行（`runtime.ts` 847 行，`vm.ts` 536 行）。

模型写一段 JavaScript，脚本里能调的宿主原语只有六个（`vm.ts:52-59`）：`agent` / `phase` / `log` / `iterate` / `workflow`（嵌套）/ `budget`。

### 沙箱的选型故事

`vm.ts` 的文件头是全仓信息密度最高的一段注释：

```
// packages/coding-agent/src/features/workflow/vm.ts
/**
 * The workflow sandbox: QuickJS compiled to WebAssembly.
 *
 * A workflow script is authored by the model, so it runs isolated — no host
 * object references, no `process`/`require`/`fetch`, no wall clock and no
 * randomness (the last two keep journal replay deterministic), under a memory
 * cap and a timeout.
 *
 * QuickJS-on-WebAssembly is engine-agnostic, which is the point. The previous
 * sandbox, `isolated-vm`, is a native addon that links V8's C++ API directly, so
 * it could only load on a V8 host: the released executable is built with
 * `bun build --compile` and runs on JavaScriptCore, where that addon can never
 * load however it is installed. Workflows — and with them the ultraloop opt-in,
 * which shares the workflow registration gate — were therefore silently absent
 * from every released build while working fine in a source run on Node. One
 * engine for both runtimes removes that class of divergence, and costs nothing
 * that matters here: workflow scripts are orchestration code that spends its
 * time awaiting agents, not computing.
```


事情是这样的：

1. 原来用 `isolated-vm`，一个直接链接 V8 C++ API 的原生模块。
2. 发布的二进制是 `bun build --compile` 出来的，跑在 JavaScriptCore 上——**这个模块永远加载不了**。
3. 于是 workflow 在**每一个**发布版里都「silently absent」，而在源码里用 Node 跑一切正常。
4. 修法是换成 QuickJS 编译到 WebAssembly：与引擎无关，两种运行时用同一个沙箱（提交 `8297eb5`，#187；配套的恢复是 `f113768`，#178）。

后半段（`:20-37`）记了两个「learned the hard way」的约束：必须用 `singlefile` 变体（默认变体要从磁盘读 `.wasm`，编译后的可执行文件里那个路径不存在）；句柄、上下文、运行时必须按顺序释放，否则 QuickJS 会 abort 整个 WASM 实例并且「poisons every later run in the session」。

沙箱里没有的东西和原因：

| 没有 | 为什么 |
| --- | --- |
| `process` / `require` / `fetch`、宿主对象引用 | 脚本是模型写的，不可信 |
| 墙上时钟、随机数 | **让 journal 重放是确定的** |
| 超过 64 MB 内存、超过 120 秒、超过 128 KiB 的脚本 | `:48-50` |

跨边界的一切都是 JSON 文本——「encoding explicitly keeps the copy semantics visible rather than implicit」。

### 注册与使用是两道门

`registration-gate.ts`（36 行）：

```
// packages/coding-agent/src/features/workflow/registration-gate.ts
 * Shared registration gate for the workflow tool and any extension layered on
 * top of it (e.g. ultraloop-opt-in). Consumers should call this instead of
 * duplicating the predicate so the two gates cannot drift. Kept in its own leaf
 * module so callers do not pull the full workflow runtime chain just to check
 * the gate.
 *
 * Registration is on by default and now depends only on explicit opt-outs. The
 * sandbox is QuickJS compiled to WebAssembly (see `vm.ts`); it ships with the
 * package and runs on every supported runtime, so no environment can take
 * workflows away any more. The V8-native `isolated-vm` used to — silently, on
 * every released executable, whose JavaScriptCore engine can never load it.
 *
 * A registered tool is only an environment capability; USAGE consent stays gated
 * per turn/session by the ultraloop opt-in. An embedder's `enabled: false` or
 * STEP_DISABLE_WORKFLOW=1 turns registration off; STEP_ENABLE_WORKFLOW is not
 * read.
 */
export function resolveWorkflowRegistration(options: { enabled?: boolean } = {}): WorkflowRegistrationDecision {
	if (envFlag(process.env.STEP_DISABLE_WORKFLOW)) return { enabled: false, reason: "disabled-by-env" };
	if (options.enabled === false) return { enabled: false, reason: "not-enabled" };
	return { enabled: true };
}
```


- **注册**默认开，只认显式关闭（`STEP_DISABLE_WORKFLOW=1` 或嵌入方传 `enabled: false`）。注释专门写了「`STEP_ENABLE_WORKFLOW` is not read」——不留一个看起来有用其实没用的开关。
- **使用**要用户同意：消息里出现 `ultraloop` 关键词（单轮），或 `/ultraloop on`（整个会话）。`ultraloop-opt-in.ts:1-23` 的注释自述这是对照 Claude Code 的同名入口做的，两种拼写都认。
- 这是**软门**：没同意就调用不会被拦，只会被记一笔——「Soft gate only — off-consent workflow calls are journaled via appendEntry, never blocked」。

【推断】选软门是因为「按名字调已保存的 workflow」和「skill 驱动的调用」都是合法入口，硬拦会误伤；代价是同意机制只能事后审计，不能事前阻止。

### 预算与落盘

- `budget.ts:4-6`：默认并发上限 16（且不超过 CPU 数 − 2），硬上限 32，单次运行最多 1,000 个 agent。
- `journal.ts:6-9,21-23`：每次运行在 `.stepcode/workflows/` 下写 `journal.jsonl` / `progress.json` / `telemetry.jsonl` / `evidence.jsonl` 四个文件。配合「无时钟、无随机」，同一份 journal 可以重放。

## 6.3 goal 与 cron：单 agent 的长任务

不是多 agent，但属于同一类「让它自己跑下去」的能力：

- `/goal`（`features/step-schedule.ts`）：文件第一行写着「Codex-style, session-scoped goals for Step」，状态集合对照 Codex 的 `ThreadGoalStatus`（`:20`）。续跑提示（`:286-305`）规定了完成与阻塞的判据（见[第 3 章](./03-agent-loop.md)）。
- `/cron`（`features/step-cron.ts`）：定时触发。

数据结构借 Codex 的，入口借 Claude Code 的，内核是 pi 的——Step-Code 在产品形态上是一个明确的**集成者**。

## 6.4 本章结论

1. subagent 从示例变成内置，但架构选择没变：仍是子进程。改进在**寿命**（长驻 rpc）、**隔离**（worktree）、**边界**（深度 1、工具白名单）。
2. workflow 是 pi 没有的一层。沙箱选型的那段注释是一个完整的事故复盘：**分发形态决定了你能用哪个沙箱**，而这个问题在源码里跑是发现不了的。
3. 「注册」和「使用同意」分成两道门，且使用是软门——可审计，不可阻止。
4. 结构化数据传递仍然有限：子 agent 之间传的是文本；workflow 脚本里是 JSON。
