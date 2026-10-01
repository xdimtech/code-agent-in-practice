# ch08-extension-host

对应 [第 8 章 扩展系统的心智模型](../../book/02-getting-started/ch08-extension-model.md)。

一个按 pi 心智模型写的扩展宿主：扩展是一个工厂函数，拿到一份 API 往里注册；工厂成功才提交，抛错就整体回滚；通知类事件出错只记一笔，拦截类事件出错按「拦下」处理；保留键宿主说了算。零依赖。

它同样**不做隔离**——扩展和宿主跑在同一个进程里，能读到宿主的环境变量。演示里的 `snoop.ts` 就是为了让你亲眼看到这一点。

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 扩展 = `(pi) => void \| Promise<void>` | `types.ts:1582` | `src/types.ts` |
| 注册进暂存区，工厂成功才 commit，抛错 discard | `loader.ts:254-480`、`:545-564` | `src/api.ts`、`src/loader.ts` |
| 通知类事件：每个处理函数单独 try/catch | `runner.ts:850-880` | `src/runner.ts` 的 `emit` |
| `tool_call`：第一个 block 说了算，出错 fail-closed | `runner.ts:982-1002`、`agent-session.ts:487-507` | `src/runner.ts` 的 `beforeToolCall` |
| 保留键跳过，其余后来者赢 | `runner.ts:71-91`、`:544-590` | `src/shortcuts.ts` |

```bash
npm i && npm start                  # 加载 demo-extensions/ 下 8 个扩展，演示五段规则
npm start -- ./my-ext.ts ./my-dir   # 加载你自己的扩展（.ts/.js 文件，或含 index.ts/index.js 的目录）
npm test                            # 20 个用例
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。带参数运行时，只要有一个扩展加载失败，退出码就是 1。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 扩展与宿主之间的全部契约：事件、处理函数、`ExtensionAPI`、`Extension` |
| `src/bus.ts` | 扩展之间互相喊话的事件总线 |
| `src/api.ts` | 给一个扩展造 API，外加 `commit` / `discard` 两个出口 |
| `src/loader.ts` | 解析入口、动态 import、跑工厂函数、批量加载（一个失败不影响其他） |
| `src/runner.ts` | 两种失败语义：`emit`（容错）与 `beforeToolCall`（fail-closed） |
| `src/shortcuts.ts` | 快捷键冲突裁决 |
| `src/main.ts` | 命令行入口与演示 |
| `demo-extensions/` | 8 个演示扩展：正常的、抛错的、导出错的、拦截的、自己崩的、抢键的、偷看环境变量的 |
| `src/*.test.ts` | `node:test` 用例 |

写扩展宿主的三条经验：

1. **回滚要覆盖「已经发生的副作用」。** 处理函数、工具、flag 都能暂存，事件总线订阅不能——别的扩展可能在加载期间就发事件。所以订阅照常生效，记下退订函数，失败时逐个退掉。演示第 1 段的「回滚检查」验证的就是这一点。
2. **同一类错误，事件不同，处置相反。** `session_start` 的处理函数崩了，跳过它不会让任何事变危险；`tool_call` 的拦截器崩了，跳过它等于把一道闸拆掉。前者记一笔继续，后者按拦下处理。
3. **try/catch 是容错，不是隔离。** 它能防一个扩展的异常拖垮宿主，防不了一个扩展读你的环境变量、改全局对象、开子进程。要隔离，得换进程或换 isolate——那是另一种架构，第 8 章讲了谁在什么地方做了这个选择。
