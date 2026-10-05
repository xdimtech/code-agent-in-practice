# ch06-cost-ledger

对应 [第 6 章 成本与投入](../../book/01-choosing/ch06-cost-and-effort.md)。

这个例子算两本账：

- **token 的账**：照 pi 的公式算一份会话的花费（`pricing.ts`），照 pi 的规则扫出缓存浪费（`cache-waste.ts`），再把同一份会话按「不缓存 / 5 分钟 / 1 小时」三种策略重算一遍（`what-if.ts`）；另外参数化地模拟压缩（`compaction.ts`）和截断（`truncation.ts`）各省多少、什么时候反而多花
- **投入的账**：六个仓库统一口径的代码量和 git 历史（`effort.ts`），判断哪段历史能拿来估人力、哪段只是「公开之后」的投影；`measure.ts` 在任何一个真仓库上量同一套数字

| 本例 | pi 里对应的地方 | 差别 |
| --- | --- | --- |
| `calculateCost` | `packages/ai/src/models.ts:878-898` | pi 就地改写 `usage.cost`，这里返回新对象 |
| `detectMiss` / `scanWaste` | `packages/coding-agent/src/core/cache-stats.ts:56-132` | 同一套规则，写成不改状态的 reduce；多返回一个「噪声以内」的轮数 |
| `isNoticeWorthy` | `modes/interactive/interactive-mode.ts:3841-3856` | 只取门槛，不画界面 |
| `replay` | 无 | pi 只扫实际发生的浪费，不做「换一种策略会怎样」 |
| `simulateCompaction` | `core/compaction/compaction.ts:235-238`、`:588-593`、`:672-675` | 触发线、摘要上限、摘要请求不缓存照抄；token 是参数，不是估出来的 |
| `truncateHead` | `core/tools/truncate.ts:1-13` | 只做保留开头那种 |
| `measureRepo` | 无 | 本书量各家仓库用的口径 |

```bash
npm start                                         # 演示会话的账（等同 ledger）
npm start -- demo/session.jsonl                   # 给一份真会话：~/.pi/agent/sessions/… 下的 .jsonl
node --experimental-strip-types --no-warnings src/main.ts compaction --reserve 24576 --turns 200
node --experimental-strip-types --no-warnings src/main.ts truncation --lines 12000 --later 30
node --experimental-strip-types --no-warnings src/main.ts effort
node --experimental-strip-types --no-warnings src/main.ts measure ../../../code-agents/pi pi
npm test                                          # 57 个用例
```

需要 Node ≥ 22.6（`--experimental-strip-types`）。没有依赖，不联网；`measure` 只读，只调 `git`。

价格是示例价（`DEMO_PRICES`，美元 / 百万 token），只为了让数字有量级，不是报价：pi 的价格表在构建时从 models.dev 生成，不进仓库。缓存倍率取 Anthropic 文档的通用值（写 1.25 倍 / 1 小时写 2 倍 / 读 0.1 倍）。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | usage、价格、会话条目的类型，字段名照抄 pi |
| `src/pricing.ts` | 缓存倍率、示例价、分档、`calculateCost` |
| `src/session.ts` | 读会话 JSONL，坏行记原因跳过 |
| `src/cache-waste.ts` | 缓存浪费扫描与提示门槛 |
| `src/what-if.ts` | 换缓存策略重算；1 小时档的打平点 |
| `src/compaction.ts` | 压缩的模拟、对照「从不压缩」、回本轮数 |
| `src/truncation.ts` | 行数 / 字节两条上限的截断，以及少付的钱 |
| `src/effort.ts` | 六个仓库的事实与「历史能不能用」的判断 |
| `src/measure.ts` | 在真仓库上量代码量和历史 |
| `src/demo.ts` | 生成 18 轮的演示会话（含空闲、换模型、压缩） |
| `src/report.ts` / `src/main.ts` | 排版与命令行 |
| `test/*.test.ts` | `node:test` 用例；`measure` 的用例在临时目录里建一个 git 仓库 |

本例的简化：重算时压缩后整段重写（system 头部其实还能命中），偏保守；压缩模拟假设每轮都在 5 分钟内发出、每轮增长相同；截断按「4 字符一个 token」估，和 pi 的估法一样偏高；投入只看代码和 git，看不到没进仓库的设计、评测和运营。

三条经验：

1. **先扫浪费，再谈策略。** 演示会话里两次换模型、一次空闲就漏掉了总花费的 28.6%；把 TTL 换成 1 小时只救得回空闲那一次，换模型那两次哪种策略都救不回来。
2. **压缩是一笔要回本的投资。** 一次压缩的摘要请求加上之后整段重写，要再过十几轮才赚回来；会话不够长时，压缩比不压缩更贵。它首先是为了装得下，其次才是省钱。
3. **历史从哪里开始，决定它能说明什么。** 一个提交导入了九成以上代码的仓库，commit 数和日期只描述公开之后；能拿来估投入的，只有从小长起来的那几段历史，而且要扣掉返工。
