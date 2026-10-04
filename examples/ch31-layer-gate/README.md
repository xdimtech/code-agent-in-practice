# ch31-layer-gate

对应 [第 31 章 阶跃星辰：Step-Code](../../book/06-vendors/ch31-step.md)。

Step-Code 相对 pi 补得最扎实的一块不是功能，是**架构闸门**：18 个 `check-*.mjs`，15 个带 `--self-test`，而且自测本身进了 CI。这个例子把其中的分层闸门按同样的思路重写一遍，并在四处做了不同的选择：

| | Step-Code 的 `check-layer-direction.mjs` | 本例 |
| --- | --- | --- |
| 规则怎么写 | 四条写死在脚本里的规则 | 配置文件：每层列出 `mayImport`，**没列的边就是违规** |
| 认不出归属的内部目标 | 规则没覆盖到就放行 | 违规（`unassigned-target`） |
| 配置本身 | — | 校验：引用的层必须存在、依赖图不能成环 |
| 「0 违规」 | 只打印通过 | 同时报扫了多少文件、多少条 import；一个文件都没扫到是配置错误 |
| 自测 | 有，进 CI | 有；并且测试里把判定函数换成坏的，确认自测**真的会失败** |
| 抽取 import | TypeScript AST | 涂掉注释和模板字符串后用正则（零依赖的代价） |

```bash
npm run self-test                                              # 自测：16 条判定用例 + 4 条抽取用例
npm start -- --config config/pi.json ../../../code-agents/pi   # 扫一个真仓库（只读）
npm start -- --config config/pi.json --json <root>             # 机器可读
npm test                                                       # 43 个用例
```

需要 Node ≥ 22.6（`--experimental-strip-types`）。没有依赖，不联网，只读被扫描的仓库。

退出码：`0` 通过；`1` 有违规（或自测失败）；`2` 用法、配置或扫描范围有问题。后两种分开，是因为「代码违规了」和「配置写错了」要找的人不一样。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 层、配置、违规的类型 |
| `src/config.ts` | 校验配置：形状、层名引用、依赖图无环 |
| `src/imports.ts` | 从源码文本里抽 import 说明符和行号 |
| `src/classify.ts` | 判定一条（导入方，说明符）允许还是违规，纯函数 |
| `src/scan.ts` | 走目录、读文件，唯一碰文件系统的地方 |
| `src/self-test.ts` | 合成用例；判定函数和抽取函数可以从外面换 |
| `src/main.ts` | 命令行与退出码 |
| `config/pi.json` | pi 基准 commit 的 10 层配置 |
| `test/*.test.ts` | `node:test` 用例 |

本例的简化：抽取用的是「涂掉注释和模板字符串 + 正则」，不是 AST，所以正则字面量里出现引号、模板字符串的 `${}` 里再写 `import()` 这类写法会漏或误报；不解析 `tsconfig` 的 `paths` 和 `package.json` 的 `#` 别名（Step-Code 的闸门正是靠 `#` 前缀判定的）；不认 `import x = require()`；层只按目录前缀和包名归属，不看 `package.json` 里实际声明了哪些依赖。

三条经验：

1. **闸门的第一个发现，多半是你自己的配置。** 第一次扫 pi 时报了 2 处违规，都在 `packages/evals/src/pi-harness.ts`：`evals` 导入了 `ai` 和 `coding-agent`。查下来不是 pi 的问题——`evals` 是个不发布的包，这两个依赖写在 `devDependencies` 里，是我只看 `dependencies` 画的图漏了边。白名单闸门报错时，先问规则对不对，再问代码对不对。
2. **自测也要被测。** `--self-test` 通过只说明「用例和判定函数一致」。把判定函数换成全放行、全拒绝、认不出就放行三种坏版本，自测必须分别失败；换不出失败，说明用例没覆盖到那条规则。
3. **没扫到不等于没违规。** 目录改了名、`ignore` 写宽了，闸门会一直绿。所以报告里带上文件数和 import 数，配置里列了却不存在的目录直接算配置错误（退出码 2）。
