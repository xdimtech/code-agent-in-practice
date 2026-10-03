# ch09-api-lookup

对应 [第 9 章 扩展 API 反查](../../book/02-getting-started/ch09-api-lookup.md)。

pi 的扩展面有 36 个事件、11 组注册类 API。文档按 API 排，写扩展时的问题却是反过来的：「我想做 X，该订阅哪个事件、调哪个方法？」这个例子把反查落成能跑的代码。它分四块：

- 按任务查的反查表，每条带「别用什么」和「坑」。
- 36 个事件的卡片：能改什么、多个处理函数怎么合并、在哪一行发。
- 照 pi `runner.ts` 写的 12 种合并方式模拟器：几个扩展订阅同一个事件、有的抛错时，宿主最后拿到什么。
- 一个记录事件顺序的 pi 扩展，加上检查录下来的顺序的检查器。

零依赖。

```bash
npm start                         # 五段演示
npm start -- find 脱敏             # 我想做 X：按关键词找
npm start -- event tool_call      # 一个事件的卡片
npm start -- events               # 36 个事件一览
npm start -- apis                 # 注册类 API 的 11 组
npm start -- order /tmp/t.jsonl   # 检查录下的事件顺序
npm test                          # 63 个用例
```

录一份真实的 trace（扩展没有对真实的 pi 跑过，只对假 pi 测过）：

```bash
pi -e ./extension/trace.ts --trace /tmp/pi-trace.jsonl
npm start -- order /tmp/pi-trace.jsonl
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。退出码：

- 0：正常。
- 1：顺序检查出错误。
- 2：用法或输入有问题。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 36 个事件名、阶段、12 种合并方式（每种注明 `runner.ts` 行号） |
| `src/catalog.ts` | 36 张事件卡片、11 组注册类 API |
| `src/tasks.ts` | 按任务反查：用什么、别用什么、坑、pi 自带示例 |
| `src/merge.ts` | 12 种合并方式的模拟器（纯函数，不改传入的值） |
| `src/order.ts` | 顺序检查：工具调用配对、运行 / 轮 / 消息的嵌套、请求在 `context` 之后 |
| `src/record.ts` | 把一个事件压成一行 trace：只留标量字段，不录内容；流式增量去重 |
| `extension/trace.ts` | pi 扩展：`--trace <file>` 时把事件追加到文件 |
| `src/fixtures.ts` | 四份 trace：照代码顺序、照文档图、写错的、自动重试 |
| `src/demo.ts` / `src/report.ts` / `src/main.ts` | 演示、输出格式、命令行入口 |
| `src/*.test.ts` / `extension/*.test.ts` | `node:test` 用例；扩展用假 pi 测 |

写扩展的三条经验：

1. **先查合并方式，再写处理函数。** 同样是「返回一个对象」，`before_provider_request` 串联、`before_provider_headers` 忽略返回值只认就地修改、`session_before_compact` 第一个 cancel 就短路。同样是抛错，`tool_call` 等于拦下工具调用，`before_provider_request` 只是丢掉这一份改写、请求照发。
2. **旗标在事件里读。** 工厂函数执行时命令行的值还没写进去，`getFlag` 只拿得到默认值。
3. **文档里的生命周期图和代码不完全一致。** 用户消息的 `message_start` / `message_end` 在 `turn_start` 之后发，不是之前；拿不准的时候录一份 trace 看。
