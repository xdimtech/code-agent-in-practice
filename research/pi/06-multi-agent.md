# 6. 多 Agent 编排

## 6.1 pi 的立场：明确不做

`packages/coding-agent/README.md:495-511` 的 "Philosophy" 一节列了**六个明确不做**：

| 声明 | 行号 | 替代方案（原文给出的） |
| --- | ---: | --- |
| **No MCP.** | 499 | CLI 工具 + README，或写扩展 |
| **No sub-agents.** | 501 | tmux 起多个 pi 实例、写扩展、或装一个包 |
| **No permission popups.** | 503 | 跑容器，或用扩展写自己的确认流 |
| **No plan mode.** | 505 | 把 plan 写文件，或用扩展 |
| **No built-in to-dos.** | 507 | "**They confuse models.**" 用 TODO.md |
| **No background bash.** | 509 | 用 tmux，"Full observability, direct interaction." |

`packages/coding-agent/docs/usage.md:309` 用散文重述了同一份清单：

> It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash.

**代码核实：`packages/coding-agent/src/core/tools/` 下只有 bash / edit / find / grep / ls / powershell / read / write 八个内置工具，grep `subagent` 在 `src/` 零命中。** 声明属实。

> ⚠️ 引用修正：这六条在 **`packages/coding-agent/README.md`**，不是仓库根 `README.md`（根 README 只有 114 行，讲的是安装与权限立场）。第 5 章引用的权限声明 `README.md:38-46` 才是根 README。两个 README 分工不同，不要混。

**"No built-in to-dos. They confuse models." 是这六条里唯一给出技术理由而非替代方案的一条。** 其余五条的措辞都是"有很多种做法，你自己选"，这条是"这个东西本身有害"。

---

## 6.2 subagent：一个示例扩展

多 Agent 能力以**示例扩展**形式提供，不随产品启用：

`packages/coding-agent/examples/extensions/subagent/`

| 文件 | 行数 | 内容 |
| --- | ---: | --- |
| `index.ts` | 1,038 | 工具实现 + TUI 渲染 |
| `agents.ts` | 157 | agent 发现与配置解析 |
| `README.md` | 177 | 用法 |
| `agents/` | 4 个 md | scout / planner / worker / reviewer |
| `prompts/` | 3 个 md | implement / implement-and-review / scout-and-plan |

按[第 7 章 §7.3](./07-extensibility.md) 的规则，它必须手动 `cp -R` 到 `~/.pi/agent/extensions/` 才会生效。

---

## 6.3 实现方式：spawn 独立进程，不复用 agentLoop

这是 pi 与主流实现最不一样的一点。文件头注释就说明了（`index.ts:3-5`）：

> Spawns a separate `pi` process for each subagent invocation, giving it an **isolated context window**.

spawn 参数组装（`index.ts:300-338`）：

```ts
const args = ["--mode", "json", "-p", "--no-session"];   // :300
if (model) args.push("--model", model);                  // :301-303
if (agent.tools?.length) args.push("--tools", ...);      // :307
// systemPrompt 写临时文件，再：
args.push("--append-system-prompt", tmpPromptPath);      // :334-338
args.push(`Task: ${task}`);
```

然后 `spawn(invocation.command, invocation.args, { cwd, shell: false, stdio: ["ignore","pipe","pipe"] })`（`:346`）。

四个细节：

1. **`--mode json -p --no-session`** —— 一次性、结构化输出、不落会话文件。父进程逐行 `JSON.parse` 子进程 stdout（`:352-360`）。
2. **模型继承**：agent 声明了 `model` 就用自己的，否则继承派发方（`:301-303`）；只有**继承**时才一并继承 thinking level（`inheritsDispatchConfig`，`:301, 304-306`）——声明了自己模型的 agent 不继承 thinking，这个取舍是对的，thinking level 是模型相关的。
3. **工具白名单**通过 `--tools` 传递（`:307`），即[第 5 章 §5.4](./05-tools-permissions.md) 说的"能力裁剪"。
4. **`getPiInvocation`**（`:249-261`）处理"怎么再启动一个自己"：优先 `process.execPath + process.argv[1]`；但检测 `/$bunfs/root/` 前缀排除 bun 单文件二进制的虚拟脚本路径，此时若 execPath 不是通用 runtime（node/bun）就直接用 execPath。**这是单文件二进制分发形态逼出来的兼容代码。**

### 为什么这比进程内 loop 更合理（推断）

代价很明确：每次 spawn 有完整的 Node 启动 + 配置加载开销。

换来的是三件事：

- **真隔离的 context window** —— 不是"共享 history 里开一段"，是物理隔离；
- **真隔离的失败域** —— 子 agent 崩溃/卡死不影响父进程；
- **CLI 可组合性** —— 同一套 `--mode json -p` 接口，subagent 扩展用得到，用户在 shell 里也用得到，CI 里也用得到。

**这与 README 让你"用 tmux 起多个 pi"是同一个思路的两种表现。** pi 把"多 agent"理解为进程编排问题，而不是 agent 框架内部的调度问题。

---

## 6.4 三种编排模式

schema 在 `index.ts:442-468`，description 在 `:477`：

| 模式 | 参数 | 语义 |
| --- | --- | --- |
| single | `{agent, task, cwd?}` | 单发 |
| parallel | `{tasks: [{agent, task, cwd?}]}` | 并发 |
| chain | `{chain: [{agent, task, cwd?}]}` | 串行，task 里可写 `{previous}` |

chain 的数据传递非常朴素（`:554-596`）：

```ts
const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);  // :556
...
previousOutput = getFinalOutput(result.messages);                            // :596
```

**就是字符串模板替换 + 取上一步的最终文本输出。** 没有结构化的 artifact 传递，没有 schema 约束，没有类型。

### 三个硬上限

`index.ts:33-36`：

```ts
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;
```

parallel 模式超过 8 个任务直接拒绝（`:605`）；实际并发 4；单任务输出截断 50KB（与[第 4 章 §4.4](./04-context-engineering.md) 的 bash 截断同一量级）。

**`MAX_CONCURRENCY = 4` 是一个务实的数字** —— 4 个子进程各自跑 LLM 请求，再多就撞 provider 的并发限制了。

---

## 6.5 agent 定义：markdown + YAML frontmatter

`agents.ts:62-90` 扫目录下所有 `.md`（接受符号链接，`:77-78`），`parseFrontmatter` 解析，`name` 与 `description` 缺一不可（`:90`）。

`AgentConfig`（`:11-19`）：`name` / `description` / `tools?` / `model?` / `systemPrompt`（= md 正文）/ `source` / `filePath`。

实例 `agents/scout.md:1-6`：

```yaml
---
name: scout
description: Fast codebase recon that returns compressed context for handoff to other agents
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---
```

**注意 `model: claude-haiku-4-5`** —— scout 这种"快速侦察"角色显式降级到小模型。这正是[第 4 章 §4.7](./04-context-engineering.md) 里 pi 主路径**没有**做的事（压缩摘要用当前模型）。也就是说按模型分工的想法在示例里有，在核心里没用上。

### `parseToolList` 的容错注释值得一读

`agents.ts:41-60` 的注释：

> Both spellings are valid YAML and both are in use: `tools: read, bash` (string) / `tools: [read, bash]` (array) — so accept either. Anything else (a number, a map, a nested list) yields **no tools rather than throwing**: this runs inside agent discovery, where **a single bad file must not take down every other agent in the same directory**.

`loadAgentsFromDir` 里 `readdirSync` 和 `readFileSync` 都是 try/catch → `continue`（`:69-86`）。**"一个坏文件不能拖垮同目录其它 agent"这个原则被一致地贯彻了**，这是运营过配置目录的人才会写的代码。

---

## 6.6 project-local agent 有确认门

`index.ts:520-546`：当 scope 含 project、`confirmProjectAgents`（默认 `true`，`:466`）、有 UI、且**项目未被信任**时，弹确认框：

```
Run project-local agents?
Agents: <names>
Source: <dir>

Project agents are repo-controlled. Only continue for trusted repositories.
```

拒绝则返回 `"Canceled: project-local agents not approved."`。

**这值得单独指出：这是整个 pi 生态里极少数"对模型的某个动作做安全确认"的地方，而它在一个示例扩展里。** 它用的正是[第 5 章 §5.7](./05-tools-permissions.md) 说的那套 `ctx.ui.confirm` 扩展 UI API——内置调用者只有两处，这是第三方调用者的实例。

威胁模型也是对的：project-local agent 的 system prompt 来自仓库里的 md 文件，等于让不受信任的仓库决定一个子 agent 的人格与工具集。

**但对照[第 5 章](./05-tools-permissions.md)的结论会看出错位**：一个示例扩展会为"跑仓库里定义的 agent"弹窗确认，而产品本体对"模型直接 `rm -rf`"不弹任何窗。这不矛盾——它恰好印证了 pi 的分工：**策略归扩展，核心只给机制。**

---

## 6.7 prompt 模板：把编排下沉到 slash command

`prompts/` 下三个文件是 slash command 模板。`prompts/scout-and-plan.md` 全文：

```
---
description: Scout gathers context, planner creates implementation plan (no implementation)
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "scout" agent to find all code relevant to: $@
2. Then, use the "planner" agent to create an implementation plan for "$@" using the context from the previous step (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}. Do NOT implement - just return the plan.
```

**编排逻辑写在自然语言里，由主 agent 解释执行。** 不是代码里的 DAG，不是配置文件里的 workflow 定义——是一段告诉模型"请这样调用 subagent 工具"的提示词。

**这是 pi 整体哲学的最纯粹体现**，也是它最脆弱的一环：模型可以不照做。没有任何机制保证 `scout` 真的在 `planner` 之前跑，或者 `{previous}` 真的被用上。可靠性完全押在模型的指令遵循能力上。

对比：有 workflow 引擎的实现能保证拓扑顺序，代价是表达力受限于引擎。pi 选了另一端。

---

## 6.8 本章结论

**pi 没有多 Agent 编排，这是声明过的产品决策，不是缺失。**

它提供的是一条实现路径，并用示例扩展把这条路径走通了一遍：

- **进程级隔离**（spawn `--mode json -p --no-session`）而非进程内调度 —— context / 失败域 / CLI 可组合性三者同时拿到；
- **agent = markdown + frontmatter**，可声明 model 与 tools 白名单；
- **三模式 + `{previous}` 字符串拼接**，编排语义极简；
- **编排流程写在 prompt 模板里**，由模型解释执行。

值得学的两点：

1. **`getPiInvocation` 对单文件二进制的兼容处理** —— "怎么再启动一个自己"在 bun 打包后不是 trivial 问题；
2. **agent 发现的容错原则** —— 一个坏配置文件不影响同目录其它文件，且注释写明了原因。

需要警惕的：

- **编排靠 prompt，没有执行保证**；
- **chain 只传纯文本**，上一步的结构化信息（改了哪些文件、usage）不进下一步；
- **每次 spawn 的启动开销**在 chain 模式下会累加；
- **`MAX_CONCURRENCY = 4`** 写死在扩展里，不可配置。

给下游拆解的探针（这是几家厂商差异最大的一章）：

- 有没有把 subagent 变成**内置工具**（pi 是示例扩展，内置化就是本家决策）
- 是 **spawn 子进程**还是**进程内复用 agentLoop** —— 这是架构分水岭
- agent 定义格式有没有沿用 markdown + frontmatter
- 有没有引入真正的 workflow/DAG 引擎替代 prompt 编排
- chain 的数据传递有没有从纯文本升级为结构化
- 有没有把 README 那六个"No X"里的任何一个实现成内置（to-do / plan mode / permission popup 是最可能被补的三个）
