# ch01-anatomy

对应 [第 1 章 Code Agent 是什么](../../book/01-choosing/ch01-what-is-code-agent.md)。

这一章要回答的问题只有一句：**把「Code Agent」这四个字拆开，里面还剩什么？** 例子分四块，一块对应一个拆解动作：

- 一个 221 行的裸循环，只做「说话 → 跑工具 → 再说话」。它不知道 read 是什么，不构建提示词，不管会话。pi 把同样的事写在 `packages/agent/src/agent-loop.ts`（794 行）里。
- 同一批工具套上一层 harness（248 行）：挑这次给哪些工具、拼系统提示词、把会话记成只追加的记录、再从记录里把上下文重建回来。
- 五种停下来时的样子，外加一条对照：**输出被截断不是出口**，是「这一批不算，重来」。
- 一条可反驳的分层规则：把 pi 的源码树按 provider / runtime / harness / product 称重，看哪一层换掉最贵。

零依赖，不联网，不需要 API key。

```bash
npm start                                   # 同 help
npm start -- bare                           # 裸循环跑一遍，打印事件顺序
npm start -- bare --path /tmp               # 换个目录跑同一个剧本
npm start -- harness --path .               # 套上 harness，看多了什么
npm start -- harness --path . --read-only   # 只读模式：写工具被摘掉
npm start -- exits                          # 五种停法，外加截断的对照
npm start -- layers --repo ../../pi/packages/agent/src
npm start -- classify --file ../../pi/packages/agent/src/types.ts
npm test                                    # 64 个用例
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。退出码：

- 0：正常。
- 2：用法或输入有问题（少写 `--repo`、子命令拼错等）。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 消息、内容块、上下文、工具、事件。字段名照 pi 的 `ai/src/types.ts` |
| `src/loop.ts` | 裸循环：`runLoop`、`collectToolCalls`、`toolResultMessage`；截断批、工具批的 `terminate` 判定 |
| `src/model.ts` | 脚本模型与必定报错的模型。替换的只是 `streamFunction` 这一个参数 |
| `src/tools.ts` | 三个真工具：`read_file` / `list_dir` / `write_file`，含 200 行截断与越界检查 |
| `src/harness.ts` | 接线层：`selectTools`、`buildPrompt`、`toolSnippets`、`SessionStore`、`resumeContext`、`runWithHarness` |
| `src/layers.ts` | 四层分类规则（每条带 `why` 和正则原文）、`tallyLayers`、`replacementCost` |
| `src/main.ts` | 五个子命令与 `UsageError` |
| `src/*.test.ts` | `node:test` 用例：循环 16、harness 20、分层 12、工具 16 |

两句可以带走的话：

1. **循环不造用户消息。** 用户这次说的话由外面给（`prompts`），循环只负责「凡是这次进上下文的，不管角色，都发一对 `message_start` / `message_end`」（`agent/src/types.ts:436`；工具结果那一对在 `agent-loop.ts:791-794`）。守住了这条，会话记录就只需要订阅一个事件——少了任何一种消息，重放出来的历史会缺一块，而且不报错。
2. **`terminate` 挂在结果上，不挂在工具上。** pi 的判定是「这一批非空，且每一条都要求停」（`agent-loop.ts:580-582`）。同一个工具、两次调用参数不同，结论可以不一样；一批里只要有一条不要求停，循环就继续跑。
