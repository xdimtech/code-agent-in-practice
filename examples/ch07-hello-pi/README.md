# ch07-hello-pi

对应 [第 7 章 30 分钟跑通 pi](../../book/02-getting-started/ch07-hello-pi.md)。

这一章回答一个问题：把 pi 装上、跑起来，中间到底发生了什么。例子把这件事拆成四步，每一步都能单独跑、单独看：

| 子命令 | 回答什么 |
| --- | --- |
| `doctor` | 这台机器能不能跑：Node 版本、agent 目录、文件权限、凭据有没有配 |
| `script` | 不装 pi 也能看见：脚本模型每一轮收到什么、决定做什么 |
| `explain` | 跑完之后：这次运行到底发生了哪些事，按轮次排开 |
| `session` | 跑完之后：磁盘上留下了什么 |

零依赖——不需要 pnpm install，也不需要 API key。

```bash
npm start -- doctor                    # 环境体检
npm start -- script                    # 两轮的计划，不联网
npm start -- script --file other.txt --tool bash
npm start -- explain --counts          # 读仓库里的 fixture，不需要装 pi
npm start -- run                       # 真的跑一次 pi（需要已安装，不需要 key）
npm start -- session --agent-dir /tmp/x --cwd .
npm test                               # 84 个用例
```

## 怎么在没有 API key 的情况下跑通

用一个自己写的 provider 顶掉真的 provider。`extension/scripted-provider.ts` 通过 `pi.registerProvider` 注册一个 `streamSimple`（`core/extensions/types.ts:1507` 的第二种形态），pi 拿到它就不走内置的 HTTP 客户端：

```bash
pi -e ./extension/scripted-provider.ts \
   --provider scripted --model hello \
   --mode json --demo-file other.txt "读一下"
```

这个"模型"不推理。它的规则只有一条（`src/script.ts:85-97`）：**上下文里还没有工具结果，就调工具；有了，就用文字收尾**。真实模型在这里做的是同一件事的复杂版本，差别只在"怎么决定"。

跑起来是这样：

```
第一轮  assistant → toolCall read({"path":"other.txt"})   stopReason=toolUse
第二轮  assistant → text                                  stopReason=stop
```

## 这四步各自证明了什么

**doctor。** 环境问题是这一章最常见的坑，而且症状离原因很远——跑不起来的时候，人第一反应是怀疑模型。体检项都来自 pi 的代码：Node 下限是 pi 根 `package.json:62-63` 的 `engines.node`（`packages/coding-agent/package.json:103-104` 是同一个值）；agent 目录默认 `<home>/.pi/agent`（`config.ts:524-530`），可被 `PI_CODING_AGENT_DIR` 覆盖（`config.ts:504`）；凭据变量名来自 `ai/src/env-api-keys.ts:79-116` 的 envMap。

它**只打名字和结论，绝不打值**。`auth.json` 里是凭据，环境变量里可能有 API key——一个"体检"命令把凭据打到终端（还可能被贴进 issue）是常见事故。`src/doctor.test.ts` 和 `src/constants.test.ts` 里有两条断言专门盯着这件事。

**script。** 把"模型收到什么"变成看得见的文字。`describeContext` 会打印 system prompt 有多长、有哪些工具、每一条消息是什么角色——第二轮的报告长这样：

```
脚本模型收到第 3 条消息，回复如下：

system prompt：41713 个字符
可用工具：read, bash, edit, write

消息：
  0. user："读一下"
  1. assistant：""
  2. toolResult（read）：1 行，第一行是 "hello from hello.txt"
```

要留意的是 41713——这是 pi 在**什么都不装**的情况下发给模型的系统提示词长度。这个数字在后面几章还会出现。

**explain。** `--mode json` 是 NDJSON，一行一个事件（`modes/print-mode.ts:109-110`）。一跑二十几行，直接看原始 JSON 看不出哪些行属于同一轮。这个子命令把树压成时间线，默认读 `fixtures/run-json.txt`（真跑一次存下来的，23 行），所以不装 pi 也能看。

**session。** 目录名的规则在 `core/session-manager.ts:476-481`：每个工作目录一个子目录，名字是把 cwd 开头的斜杠去掉、再把斜杠和冒号换成横杠。macOS 上 `/tmp` 是 `/private/tmp` 的符号链接，pi 用的是解析之后的路径——不解析的话会看着像"会话丢了"。

## 三条踩过的坑

**1. 命令行旗标不能在扩展加载的时候读。**

pi 的顺序是：解析命令行 → 把未识别的选项交给 resource loader（`main.ts:736`）→ **加载扩展**（工厂函数在这里执行）→ 加载完之后才把命令行值写进 `runtime.flagValues`（`core/agent-session-services.ts:183`，函数体 `:99-118`）。

所以在工厂函数里 `getFlag` 抄一份快照，拿到的永远是 `registerFlag` 时登记的默认值，命令行给的值会被**无声地**忽略——没有报错，默认值就是赢了。正确做法是延迟到第一次真的要用的时候再读（`src/settings.ts` 的 `lazySettings`），那时值已经到位。

**2. 每一轮都要一份新的草稿。**

`streamSimple` 会被调用多次，一次一个回合。`content` 数组必须每轮重置，否则第二轮的内容块接在第一轮后面，`modes/json-event.ts:23` 按 `contentIndex` 取块时会取到别人的。

而且事件里带的 `partial` 必须和填 `content` 的是**同一个对象**：`modes/json-event.ts:23-30` 在 `toolcall_start` 时会读 `partial.content[contentIndex]`，读不到工具调用就直接抛错。`src/stream.ts` 的 `eventsForTurn` 收一个由调用方造的草稿，就是为了保证这一点。

**3. 扩展里的异常要变成 error 事件，不能抛回宿主。**

推流是在 `queueMicrotask` 里做的，`try/catch/finally` 里出错要推一条 `error` 再 `end()`。少了 `end()` 宿主会一直等这条流；让异常逃出去则会把宿主一起带走。连"读旗标"这一步也放在 `try` 里面——它同样可能抛错。

## 和真实 provider 的差别

`streamSimple` 的契约（`core/extensions/types.ts:1516-1521`）要求实现**发请求前**调 `options.onPayload`、**收到响应后**调 `options.onResponse`。这个扩展两个都不调，因为它根本没有"请求"这一步——这是它与真实 provider 最明显的差别。

另外 `registerProvider` 要求给一个 `apiKey`（`types.ts:1512`），这里填的是占位符 `scripted-no-key-needed`，永远不会被发出去。**它不是一个真能用的凭据方案**，只是接口强制要求的字段。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 消息、内容块、上下文——字段名照 `ai/src/types.ts` |
| `src/constants.ts` | 常量：Node 下限、agent 目录里的四个文件、十个 provider 凭据变量名 |
| `src/script.ts` | 脚本模型的规则：这一轮调工具还是收尾；上下文的文字化 |
| `src/stream.ts` | 一轮的事件序列，以及为什么草稿必须由调用方给 |
| `src/settings.ts` | 旗标 → 环境变量 → 默认值的解析，以及为什么必须**延迟**读 |
| `src/explain.ts` | NDJSON → 按轮分组的时间线 |
| `src/doctor.ts` | 环境体检：只打名字，不打值 |
| `src/session-file.ts` | 会话目录名的规则、会话文件的读取 |
| `src/run.ts` | 临时目录 + 隔离 agent 目录 + 离线，跑一次真 pi |
| `src/main.ts` | 命令行入口 |
| `extension/wiring.ts` | 注册什么 provider、每轮推什么（不 import pi，测试用假流） |
| `extension/scripted-provider.ts` | 唯一的入口，唯一 import pi 的地方 |
| `fixtures/run-json.txt` | 真跑一次留下的事件流，23 行（会话 id、时间戳已换成固定值） |
| `src/*.test.ts` / `extension/*.test.ts` | `node:test` 用例 |

退出码：0 正常，1 检查发现有必须先解决的问题（`doctor` 的 fail），2 用法或输入有问题，70 内部错误。

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。

`npm start -- run` 会真的调用 `pi`（走 PATH，可以用 `--pi 路径` 指定）。它用 `PI_CODING_AGENT_DIR` 把 agent 目录指到临时目录、跑完删掉，**不会碰你自己的 `~/.pi`**。用 `PI_OFFLINE=1` 关掉版本检查，全程不联网。

这一章的实验跑在 pi 0.85.1 上，而本书基线是 0.84.4——目录名规则、事件表、扩展接口这几处两边一致，但版本号本身对不上，`doctor` 也会把这一点打出来。
