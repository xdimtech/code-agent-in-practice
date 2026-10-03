# ch05-route-filter

对应 [第 5 章 该不该用 Pi：横向对照](../../book/01-choosing/ch05-should-you-use-pi.md)。

做 code agent 有四条常见的路：直接调模型 API 自己写循环、用 Claude Agent SDK、fork codex、基于 pi。这个例子不给它们打分，只做两件事：

- **事实表**（`routes.ts`）：四条路线 × 八个维度，每一格都带出处——pi / codex 指到基准 commit 的具体行，Claude Agent SDK 只引公开文档的原话，量出来的数写明命令
- **硬约束过滤**（`questions.ts` + `filter.ts`）：八个「不能让步」的问题，每条规则对一条路线要么**排除**、要么**加一项义务**。输出顺序固定，没有分数，也不排名次

然后用 `verify` 把表里的每一条出处真的核对一遍：文件在不在、行号越没越界、那几行里有没有引用的原文；加 `--online` 时把公开文档的 Markdown 拉下来逐字比对。

| 问题 | 会排除 | 会加义务 |
| --- | --- | --- |
| `--models` claude / openai / mixed | Agent SDK（非 Claude 模型） | fork codex（非 OpenAI）、直连 API（多家） |
| `--host` node / python / other | — | pi（非 Node 走 RPC）、Agent SDK（other 走 CLI） |
| `--session-process` yes / no | Agent SDK、fork codex（no）；pi（no 且非 Node） | — |
| `--approval` yes / no | 直连 API、pi（yes） | — |
| `--sandbox` yes / no | 直连 API、pi（yes） | Agent SDK（只管 shell、默认关） |
| `--loop` yes / no | Agent SDK（yes） | fork codex、pi |
| `--upstream` yes / no | fork codex、Agent SDK（yes） | pi |
| `--license` yes / no | Agent SDK（yes） | fork codex（Apache-2.0）、pi（MIT） |

```bash
npm start -- facts                                  # 对照表（Markdown）+ 每一格的出处
npm start -- questions                              # 八个问题和选项
npm start -- filter --models mixed --loop yes       # 按回答过滤；加 --brief 不打印出处，--json 机器可读
npm run verify                                      # 只核对本书仓库里的出处，pi / codex 记为跳过
npm run verify -- --sources ../../../code-agents    # 放着 pi/ 和 codex/ 的目录（或设 CODE_AGENTS_DIR）
npm run verify -- --sources … --online              # 再加上公开文档的逐字比对（要联网）
npm test                                            # 51 个用例
```

需要 Node ≥ 22.6（`--experimental-strip-types`）。没有依赖；除了 `verify --online` 都不联网。核对 pi 和 codex 时，两个仓库要停在 [BASELINE.md](../../research/BASELINE.md) 锁定的 commit 上，否则行号会对不上——这正是 `verify` 要抓的。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 路线、事实、出处、问题、规则、判定的类型 |
| `src/evidence.ts` | 出处的构造函数（带校验）、公开文档地址、格式化 |
| `src/routes.ts` | 四条路线的事实表 |
| `src/questions.ts` | 八个问题和全部规则 |
| `src/filter.ts` | 校验回答、对规则，纯函数 |
| `src/verify.ts` | 核对出处：代码行、文档原话 |
| `src/main.ts` | 命令行：`facts` / `questions` / `filter` / `verify` |
| `test/*.test.ts` | `node:test` 用例 |

本例的简化：规则只有「排除」和「义务」两种效果，表达不了「代价大但能做」的程度差别——那部分写在义务的理由里，留给人读；`measured` 和 `inference` 两种出处机器核对不了，`verify` 只把它们列成「需人工复核」；四条路线之外（比如托管型的 agent 服务、别的开源 harness）不在表里，要加就加一条 `Route` 和对应的规则。

三条经验：

1. **只问不能让步的条件。** 「团队更熟哪门语言」是偏好，可以让步；「宿主是 Python 而且不能每会话起一个进程」是约束，不能。把偏好写成规则，过滤器就会替你让步。
2. **排除要带出处，义务也要带。** 「pi 没有审批」是一句判断；「`packages/coding-agent/README.md:503` 写着 No permission popups」是一个事实。前者会随着说话的人变，后者可以复查。
3. **没核对过就不能算通过。** `verify` 缺了源码目录时把 pi / codex 的出处记为「跳过」，而不是悄悄当作通过；文档没联网时也一样。
