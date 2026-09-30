# 4. 上下文工程

## 4.1 system prompt：稳定优先

真正的构造器是 `packages/coding-agent/src/core/system-prompt.ts:28` 的 `buildSystemPrompt()`。（`packages/agent/src/harness/system-prompt.ts` 只有 34 行，仅做 skills 的 XML 清单格式化，属于 v2 那一侧。）

拼装顺序（`:128-166`）：

```
角色声明
→ Available tools        只列出调用方提供了一行 snippet 的工具（:82-84）
→ Guidelines             按实际启用的工具动态生成（:105-126）
→ pi 自身文档路径         （:138-145）
→ appendSystemPrompt     用户/扩展追加（:147）
→ <project_context>      AGENTS.md 全文（:152-159）
→ <available_skills>     skills 清单（:162）
→ Current working directory:  （:166）
```

`customPrompt` 分支（`:46-72`）替换正文但保留后四段——也就是说用户换掉人格设定时，项目上下文、skills、cwd 不会丢。

### 运行时注入了什么，没注入什么

**注入的只有四样**：cwd、工具集与对应 guidelines、AGENTS.md 内容、skills 清单。

**没有注入**：时间戳、git 状态、目录树、OS/platform。全仓 grep `toISOString|platform` 在 prompt 构造路径上零命中。

这一点值得与主流实现对照——Claude Code 系会往 system prompt 里塞当前时间、git branch、recent commits。pi 一概不放。

**推断**：代码里没有显式的 `cache_control`，但**正因为不注入时间/git 状态，整个前缀在一次会话内天然稳定**。唯一的破坏点是工具集变更触发的 `_rebuildSystemPrompt`（`agent-session.ts:984, 2484`）。这是"用不注入换缓存命中"的取舍，只是 pi 没把它写成注释。

反向的证据在压缩那边：摘要请求**显式关闭缓存写入**——`cacheRetention: "none"` + 新 `sessionId`（`core/compaction/compaction.ts:588-593`），注释说明一次性摘要不应该产生无法复用的 cache write。也就是说作者是清楚缓存经济学的，只是在主路径上选择了"保持稳定"而非"显式标记"。

### AGENTS.md 的发现顺序

`resource-loader.ts:72`，候选名按优先级：

```
AGENTS.override.md > AGENTS.md > AGENTS.MD > CLAUDE.md > CLAUDE.MD
```

全局 agentDir 先入，再从 cwd 逐级向上到根，**祖先在前**（`:135-154`）。所以 monorepo 里父目录的规范先出现、子目录的后出现，后者在 prompt 里更靠近指令区。

兼容 `CLAUDE.md` 是生态现实——这是 pi 少数几处向 Claude Code 方言让步的地方。

---

## 4.2 压缩：绝对预留，不是比例

触发条件（`core/compaction/compaction.ts:235`）：

```ts
contextTokens > contextWindow - reserveTokens
```

默认 `reserveTokens: 16384`、`keepRecentTokens: 20000`（`:132-136`）。**是绝对值不是百分比**——在 200K 窗口上等于 92% 触发，在 32K 窗口上等于 50%。

token 计数策略（`:202-230`）：优先取最后一条有效 assistant 的 provider usage（真实值），其后的消息用 `chars/4` 估算，图片按 4800 字符计（`:244`）。这是"真实值 + 增量估算"的混合法，比全量估算准得多，且不需要本地 tokenizer。

### 四个入口

`agent-session.ts:2126` 的 `_checkCompaction` 有三类：overflow + 重试一次、overflow 不重试、阈值触发。外加提交 prompt 前的预压缩 `_compactBeforeNextAssistantResponse`（`:2203-2218`），即[第 3 章 §3.5](./03-agent-loop.md) 说的挂在 `prepareNextTurn` 上的那个。

### 切点：绝不切在 toolResult

`findCutPoint`（`:403`）从尾向前累加，直到累计 ≥ `keepRecentTokens`。允许的切点是 user / assistant / bashExecution 等，**绝不切在 toolResult 上**（`:345-350` 有注释）。

原因很实在：孤立的 tool result 没有对应的 tool call，provider 会直接拒绝这个请求。

如果切点落在一个 turn 的中间，会**额外为该 turn 的前缀生成第二份摘要**（`TURN_PREFIX_SUMMARIZATION_PROMPT`，`:835`），与历史摘要拼成一条。CHANGELOG `packages/agent/CHANGELOG.md:135` 记录了这两次摘要后来被改成**串行**，因为单并发的 provider 不接受重叠生成（issue #5536）。

### 摘要用当前模型，不用小模型

`:1951` 直接用 `this.model`。maxTokens 为 `0.8 × reserve`（历史摘要）/ `0.5 × reserve`（turn 前缀）。

**推断**：用同一个模型是保守选择——压缩质量直接决定后续所有轮次的上下文质量，省这一次的钱不划算。但这也意味着压缩一次的成本与一次正常推理相当，在长会话里是笔真实开销。

### 防止模型"接着对话"

对话先被 `serializeConversation` 拍平成纯文本，包进 `<conversation>`（`core/compaction/utils.ts:91`，工具结果截断到 2000 字符 `:74`），system prompt 明写 "Do NOT continue the conversation"。

这是必要的防御：如果直接把 message 数组喂过去要求总结，模型很容易误以为轮到它接话。

迭代压缩（压缩后又满了）走 `UPDATE_SUMMARIZATION_PROMPT` + `<previous-summary>`，而不是从头重压。

摘要尾部会附上 `<read-files>` / `<modified-files>` 两段（`utils.ts:62`），并**跨压缩累积**（`:50-61`）。这是对"压缩会丢掉文件路径"这个具体失败模式的针对性补丁——摘要可以丢细节，但不能丢"我改过哪些文件"。

### branch_summary：为会话树服务

`packages/agent/src/harness/compaction/branch-summarization.ts` 解决的是[第 3 章 §3.7](./03-agent-loop.md) 提到的那个问题：会话是树，切分支时被放弃分支上模型看过的东西会静默消失。

做法：从旧 leaf 回溯到与目标的公共祖先（`:82-111`），把这段总结成一条，前缀固定为 "The user explored a different conversation branch"（`:173`），maxTokens 固定 2048。

**这是"会话树"这个设计必然要付的税。** 线性会话不需要它。

---

## 4.3 两份 compaction 的关系

`packages/agent/src/harness/compaction/compaction.ts`（848 行）与 `packages/coding-agent/src/core/compaction/compaction.ts`（1,012 行）——**不是分层，不是互相调用，是重写中的两份同源副本。实际生效的是后者。**

证据：
- `agent-session.ts:65-66` 从 `./compaction/index.ts` 导入，自动与手动压缩全部走 coding-agent 那份。
- `packages/agent` 那份目前只被 `packages/agent/test/harness/compaction.test.ts` 驱动；其宿主 `AgentHarness.compact()` 在 `agent-harness.ts:374` 直接 `return this.unavailable("compact")`（详见[第 3 章 §3.9](./03-agent-loop.md)）。

算法逐行同源（`estimateTokens`、`findCutPoint`、`combineUsage`、prompt 常量几乎逐字一致）。差异全部是 v2 的设计演进：

| | v1（coding-agent，生效中） | v2（agent/harness，未接入） |
| --- | --- | --- |
| 边界表示 | 存指针 `firstKeptEntryId`（`:771-785`） | 保留尾部消息直接写进压缩条目 `retainedTail`（`:637-669`） |
| 错误风格 | 抛异常 | 返回 `Result<_, CompactionError>` |
| 依赖注入 | 手传 apiKey/headers/env/streamFn，13 个位置参数（`:858-870`） | 走 `Models` 抽象 |

**`retainedTail` 是关键差异**：v2 的压缩条目是**自洽的**——恢复时不需要回读被压掉的历史。这与 v2 的持久记录日志（[第 3 章 §3.9](./03-agent-loop.md)）完全一致：一条记录必须能独立解释自己，恢复才能做到"拒绝而非修复"。

### 一处疑似回归

**推断**：v1 有两道护栏，v2 目前没有。

1. `stopReason === "length"` 视为失败（v1 `:545-553`，注释说"部分文本不能成为 session checkpoint"）——摘要被 max_tokens 截断，就不是合法的检查点；
2. 摘要里出现 toolCall 直接报错（v1 `:719, :1004`）——模型在总结时不该发起工具调用。

v2 只判 aborted/error（`:578-588`），两道都没有。

第 1 条与[第 3 章 §3.4](./03-agent-loop.md) 的截断处理是**同一类问题的两个实例**：pi 在工具调用那边已经确立了"截断即整体失效"的原则，v1 的压缩也遵守了，v2 重写时丢了。标为推断是因为 v2 尚未接入产品，有可能是还没写到。

---

## 4.4 截断：双限 + 分级降级

`truncate.ts:11-12`：**2000 行 / 50KB，先到者胜**，原则是不返回半行。

- 读文件用 `truncateHead`（`:132`）——文件开头更有信息量；
- bash 输出用 `truncateTail`（`:222`）——错误在尾部。

唯一允许半行的边界情况：tail 模式下末行本身就超限，从行尾按 **UTF-8 边界**回切（`:261-266, :301`），并把落单的代理对替换成 U+FFFD（`:89-110`）。

**这段代理对处理是踩过坑才会写的**：按字节截断一个 emoji 会产生非法 UTF-16，下游 JSON 序列化或 provider 会报错。

### 降级而非丢弃

超限时不是简单丢掉，而是给模型一条**自救路径**：

- bash：完整输出写进临时文件（`shell-output.ts:80-91`），模型只看尾部，结果里给出 `fullOutputPath`（`bash.ts:436-440`）；
- read：提示 `offset=` 续读（`read.ts:310`），或者直接给出可执行命令 `sed -n 'Np' | head -c`（`read.ts:300`）；
- grep：另有单行 500 字符限制（`truncate.ts:342`）。

**"截断时告诉模型怎么拿到剩下的"这个模式值得直接抄。** 它把一个硬限制变成了一次分页。

> `truncate.ts` 同样是双份（`coding-agent/src/core/tools/truncate.ts` 与 agent 版 diff 153 行，agent 版多了无 `Buffer` 运行时的 utf8 长度回退 `:51-80`）——又一处 v1/v2 并存。

---

## 4.5 Skills：两段式注入

`skills.ts` 递归扫描：遇到 `SKILL.md` 即返回，不再深入（`:138-150`）；根层 `.md` 也可以是 skill 但必须有 description（`:271`）；遵守 `.gitignore/.ignore/.fdignore` 并对子目录规则加路径前缀（`:178-242`）；name 必须等于父目录名、小写连字符、≤64 字符（`:301-311`）。

**注入分两段**：

1. system prompt 里只放 name / description / location 清单（`harness/system-prompt.ts:7-24`）——常驻成本极低；
2. 显式调用时才用 `formatSkillInvocation` 把全文包进 `<skill>`，并声明相对路径基准目录（`skills.ts:38-41`）。

正文按需 read。这是 progressive disclosure 的标准做法。

### pi 没有 memory 子系统

需要纠正一个容易误读的文件名：`packages/agent/src/harness/session/memory.ts` **不是记忆机制**，是 `InMemorySessionStorage` / `InMemorySessionRepo`，即会话存储的内存后端。

pi 的长期上下文 = **AGENTS.md + compaction summary**，没有第三样东西。没有向量库，没有自动提取的事实库，没有跨会话记忆。

**推断**：这与 pi 的整体取向一致——AGENTS.md 是用户可读可改的纯文本，摘要是会话内的。两者都不引入不可见的状态。

---

## 4.6 六个踩坑细节

这几处注释是判断"作者真的运营过这个东西"的证据：

1. **切换模型后跳过 overflow 检查**（`agent-session.ts:2136-2143`）——旧模型（小窗口）报的 overflow 不该触发新模型（大窗口）的压缩。
2. **压缩后的陈旧 usage**（`:2144-2151`、`:2207-2218`）——压缩后保留下来的旧消息带着压缩前的 usage 数字，会让"刚压完立刻又压"。用 timestamp 与压缩条目对比来抑制。
3. **全零 usage 的兜底**（`:2200-2206` 注释）——529 等持久 API 错误或 all-zero usage 的响应会让上下文统计永远归零，于是改用纯估算兜底。
4. **worktree 的符号链接**（`resource-loader.ts:98-117`）——git worktree 的 `gitdir:` 写的是 realpath，而 cwd 可能是符号链接（macOS `/tmp → /private/tmp`），必须 canonicalize。注释还列出了 bare 布局（`proj/.bare`）与 submodule 两个反例。
5. **二进制污染防护**（`shell-output.ts:30-41,117`）——删 `\r`、过滤控制字符与 U+FFF9–FFFB。落盘用 `writeChain` promise 串行链（`:67-78`）避免并发 append 乱序。
6. **split-turn 压缩串行化**（`packages/agent/CHANGELOG.md:135`，issue #5536）——见 §4.2。

第 1、2、3 条是同一类问题：**token 统计是从 provider 拿的，而 provider 的数字会过期、会缺失、会因为换模型而失去意义**。三处补丁都在处理"统计不可信"这一个根因。

---

## 4.7 本章结论

**pi 的上下文工程是保守且完整的。**

值得学的四点：

1. **system prompt 不注入时间/git 状态** —— 用"少放东西"换前缀稳定，比事后打 `cache_control` 更彻底；
2. **绝对预留而非比例触发** —— `contextWindow - 16384`，不受窗口大小影响的安全边际；
3. **摘要末尾累积 `<read-files>` / `<modified-files>`** —— 针对"压缩丢文件路径"这个具体失败模式；
4. **截断时给出续读路径** —— 硬限制变分页，模型能自救。

需要警惕的：

- 摘要用当前模型，长会话的压缩成本不低，且没有降级到小模型的开关；
- v1/v2 两份 compaction + 两份 truncate 并存，且 **v2 丢了 v1 的两道摘要护栏**；
- 没有任何形式的跨会话记忆，换一个会话就完全从零开始（这是取舍不是缺陷，但要知道）。

给下游拆解的探针：

- 压缩触发是绝对预留还是比例 → 判断有没有改
- `findCutPoint` 有没有保留"绝不切 toolResult"
- 摘要模型是不是被换成了小模型 → 这是最容易改也最值得改的一处
- 有没有 `<read-files>` / `<modified-files>` 累积
- 有没有加 memory 子系统 → 这是 pi 明确没有的，加了就是本家设计
