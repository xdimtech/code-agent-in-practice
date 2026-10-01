# ch29-tool-batch

对应 [第 29 章 工具执行的四个坑](../../book/05-internals/ch29-tool-execution.md)。

按 pi `executeToolCalls`（`packages/agent/src/agent-loop.ts:409-560`）与 v2 `truncateStringToBytesFromEnd`（`packages/agent/src/harness/utils/truncate.ts:301-336`）的语义写的最小实现，零依赖。

```bash
npm i && npm start   # 三个调用一起跑：看事件顺序与结果顺序的区别
npm test             # 10 个用例
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。

| 文件 | 内容 |
| --- | --- |
| `src/batch.ts` | 批次执行：串行准备、并发执行、按调用顺序落盘、全票终止、错误即结果 |
| `src/truncate.ts` | 按 UTF-8 字节预算保留尾部，不切代理对，落单代理项替换为 U+FFFD |
| `src/main.ts` | 演示 |
| `src/*.test.ts` | `node:test` 用例 |

与 pi 的一处有意差别：中止后未执行的调用在**写入时**就补上一条错误结果（`minimax-code` 与 `deepseek-harness` 的做法），而 pi 是在**回放给 provider 时**由 `transformMessages` 补 `"No result provided"`。两种做法的取舍见正文 29.3 节。
