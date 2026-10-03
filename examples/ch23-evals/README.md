# ch23-evals

对应 [第 23 章 evals：怎么知道它做对了](../../book/04-shipping/ch23-evals.md)。

pi 的 `packages/evals` 是一套**打真模型**的对比评测：同一批输入分别跑基线和候选，成对比较通过率，低分只是观察、不让测试变红。这个例子把它的骨架搬下来，换成一个小团队每天都能跑的版本——模型换成脚本，工具照样真跑：

- **假模型、真工具**：脚本一条条吐 `tool_call`，工具在 `mkdtemp` 出来的临时目录里真建目录、真写文件，跑完就删
- **只差一处的基线 / 候选**：两套 harness 只有「写文件」这一个工具不同——候选会建父目录、会拒绝写出工作目录
- **对照用例**：三个用例里有一个两边都该过，差值才能归到那一处改动上
- **多项判分**：一个用例拆成几项检查，0.5 分说明「模型这半没错、工具那半坏了」
- **成对对比**：按 (eval 集, 输入, 重复) 分组，每组每边恰好一条才配对；跑崩了的单列，不进均值；没测到的用量写「不可用」，不写 0
- **产物**：`runs.jsonl` 一行一次运行，目录 0700、文件 0600，落盘前按字段名 + 同值替换两步遮敏

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 每次运行一个新的临时根目录，跑完删掉 | `pi-harness.ts:122-130`、`:228-232` | `harness.ts` 的 `runInWorkspace` |
| 删之前先把会话快照下来 | `pi-harness.ts:212-222` | `inspect` 在 `finally` 之前 |
| 基线和候选只差一处 | `extensions.eval.ts:41-51`、`:100-103` | `tools.ts` |
| 分组键 = 输入 + 第几次重复 | `harness-table.ts:100-112` | `run.ts` 的 `observationOf` |
| 每边恰好一条才配对 | `summary.ts:196-210` | `score.ts` 的 `compare` |
| 分数 ≥ 1 算通过；lift = 候选通过率 − 基线通过率 | `summary.ts:247-282` | 同上 |
| 跑崩 / 没分数 / 缺观测 / 重复观测单列 | `summary.ts:164-194` | 报告里的「没进对比的观测」 |
| 缺失的用量不参与，算不出就是 null | `summary.ts:212-245` | `metricOf`，报告写「不可用」 |
| `judgeThreshold: null`：低分不让测试失败 | `extensions.eval.ts:108`、README `:136-138` | `run` 永远按分数汇报；`compare --gate` 才会红 |
| 产物目录 0700、文件 0600 | `artifacts.ts:106-108`、`reporter.ts:43-48` | `recorder.ts` |

（pi 的路径以 `packages/evals/` 为根，`summary.ts`、`harness-table.ts`、`artifacts.ts`、`reporter.ts` 都在 `src/vitest-evals/` 下。）

```bash
npm start                                   # 跑 12 次（3 用例 × 2 重复 × 2 方案），写 .eval/runs.jsonl，打汇总和对比
npm start -- --usage                        # 同上，把按脚本推算的 token / 耗时 / 费用写进去（不是测出来的）
npm start -- --case escape-workspace        # 只跑一个用例
npm run compare                             # 读回 .eval/ 里最后一批，成对对比；候选变差时退出码 1
node --experimental-strip-types --no-warnings src/run.ts show <runId 前缀>   # 看一条轨迹
npm test                                    # 116 个用例
```

需要 Node ≥ 22.6（`--experimental-strip-types`）。没有依赖，不联网，不需要 API key。

| 文件 | 内容 |
| --- | --- |
| `src/harness.ts` | 脚本化的假模型 + 真工具；每次运行一个临时目录 |
| `src/tools.ts` | 两套工具：基线写文件 / 候选写文件，其余共用 |
| `src/cases.ts` | 三个用例、多项判分、按方案跑 |
| `src/assertions.ts` | 断言：工具顺序、参数、没有报错；只返回失败列表，不抛 |
| `src/workspace.ts` | 跑完拍现场：列文件、读文件 |
| `src/trace.ts` | 轨迹归一化：去掉每次都变的 id、路径、时间 |
| `src/score.ts` | 成对对比与报告 |
| `src/recorder.ts` | 产物落盘：遮敏、权限 |
| `src/run.ts` | 命令行：`run` / `compare` / `show` |
| `src/types.ts`、`src/root.ts` | 共用类型；找仓库根 |
| `test/*.test.ts` | `node:test` 用例 |

本例的简化：模型是脚本，读不懂系统提示，所以「换提示词」这类差异表达不出来，只能比工具和准备步骤；重复两次只能看出脚本是否稳定，谈不上统计显著；`--usage` 的三个数是按脚本长度推算的，只为看报告格式。

三条经验：

1. **两个方案只差一处，还要有一个两边都该过的用例。** 不然「候选 +66.7 个百分点」可能来自任何地方。
2. **跑崩了不是 0 分，没测到不是 0。** 前一个单列、不进均值，后一个写「不可用」。把它们记成 0，「候选把测试跑挂了」会看起来像「候选变差了」。
3. **追加写的产物要按批比。** 同一个目录跑两次，每组都会有两条基线、两条候选，一对也配不上；`compare` 只比最后一批，一对都配不上时 `--gate` 也要红。
