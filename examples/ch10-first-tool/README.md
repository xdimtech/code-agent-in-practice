# ch10-first-tool

对应 [第 10 章 写第一个工具](../../book/02-getting-started/ch10-first-tool.md)。

在 pi 里写一个工具，`execute` 只是其中一段。一次工具调用要依次经过：

1. 改写旧参数（`prepareArguments`）。
2. 校验并转换参数。
3. 扩展拦截。
4. 执行。
5. 结果改写。
6. 变成一条工具结果消息。

输出要按两条上限截断。工具注册了也不一定激活；激活了也不一定写进系统提示词。这个例子把这些规则照 pi 的代码各写一遍，再用它们跑一个完整的工具 `find_text`：

- 按行找文本。
- 不经过 shell。
- 路径不出工作目录，不跟随符号链接。
- 输出超过上限就截断，全文另存。

零依赖。

```bash
npm start                                         # 五段演示
npm start -- search TODO src -i                   # 用 find_text 在当前目录里搜，走完整的宿主流程
npm start -- search 'createFind\w+\(' src --regex  # 正则
npm start -- tools --tools read,deploy --ext deploy   # 这些旗标下哪些工具激活、哪些写进系统提示词
npm start -- tools --ext deploy --ext lint='Lint the project'
npm start -- truncate tail src/main.ts --lines 20
npm test                                          # 73 个用例
```

在 pi 里加载（扩展只对假 pi 测过，没有对真实的 pi 跑过）：

```bash
pi -e ./extension/find-text.ts
```

需要 Node ≥ 22.6（用 `--experimental-strip-types` 直接运行 TypeScript）。退出码：

- 0：正常。`search` 没找到也是 0。
- 1：`search` 的工具结果是错误。
- 2：用法或输入有问题。
- 70：内部错误。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 工具定义、工具结果、工具结果消息；JSON Schema 子集 |
| `src/validate.ts` | 参数校验：复制 → 去掉可选字段的 `null` → 按 schema 转换类型 → 检查；错误信息照 pi 的格式 |
| `src/truncate.ts` | 截断：2000 行 / 50KB 两条上限，`truncateHead` / `truncateTail` / 单行截断 / 截断提示 |
| `src/host.ts` | 宿主：一批调用的准备、拦截、执行、改写，并行与串行两条路径，四种事件 |
| `src/activation.ts` | 工具注册表与激活：`--tools` / `--no-tools` / `--no-builtin-tools` / `--exclude-tools`，同名覆盖，启动后再注册 |
| `src/find-text.ts` | 示例工具 `find_text`：文件系统可替换，抛错表示失败 |
| `src/memfs.ts` | 测试用的内存文件系统，可以模拟符号链接和磁盘写满 |
| `extension/find-text.ts` | pi 扩展：真实磁盘（`lstat`，全文存到 `0600` 的临时文件） |
| `src/demo.ts` / `src/main.ts` | 演示、命令行入口 |
| `src/*.test.ts` / `extension/*.test.ts` | `node:test` 用例；扩展用假 pi 测 |

写工具的三条经验：

1. **失败要抛出来。** pi 只认抛错：`execute` 抛错，结果才标 `isError: true`。返回一段 `Error: …` 文字、或者在 `details` 里写 `ok: false`，模型看到的都是一次成功的调用。
2. **截断是工具自己的事。** pi 的宿主不替工具截断输出。在 description 里写明上限，截断时说清看到了多少、全文存在哪；全文存不下来也照样返回截断后的结果。
3. **不写 `promptSnippet`，工具就不进系统提示词的 `Available tools`。** 工具照样激活，模型照样能调用。`promptGuidelines` 里要写出工具名，因为它们是平铺在 `Guidelines` 里的，看不出是哪个工具的。
