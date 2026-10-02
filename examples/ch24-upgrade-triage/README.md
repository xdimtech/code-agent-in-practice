# ch24-upgrade-triage

对应 [第 24 章 版本与升级策略](../../book/04-shipping/ch24-upstream-strategy.md)。

把上游源码拷进自己仓库改的下游，升级前要回答四个问题。这个例子每个问题给一个小工具：

- **上游在这段版本里声明了哪些破坏性变更**：读 CHANGELOG，按版本区间列出来；顺带找出只动了补丁号、却带着破坏性变更的版本
- **基线钉在哪**：检查 vendor 标记——上游地址、40 位 commit、导入日期、台账路径；标记里引用的文件不存在就报
- **我们改了什么**：读补丁台账，检查格式有没有走样（标题层级、字段名、顺序），统计多少条开了上游 PR
- **哪些文件要人看**：基线、我们、上游新版三份目录做三方分诊，十二种处境里只有三种要人看；再和台账对账，给每条补丁一个去向（重做 / 原样带走 / 可以撤掉）

判断全在纯函数里；只有 `src/manifest.ts` 读磁盘，不跟随符号链接，限制文件数和大小。不执行任何命令，不联网，不调 git。

| 规则 | 出处 | 本例 |
| --- | --- | --- |
| pi 的版本约定：`patch` = 修复 + 新增，`minor` = 破坏性变更，没有 major | pi `AGENTS.md:129` | `src/changelog.ts` 的 `breaksInPatchReleases` |
| 破坏性变更写在 `### Breaking Changes` 小节 | pi `AGENTS.md:114`；`packages/coding-agent/CHANGELOG.md` | `src/changelog.ts` 的 `parseChangelog` |
| vendor 标记：上游地址、ref、commit、导入日期、台账、策略文件 | minimax-code `third_party/pi-mono/.minimax-vendor.json:1-15` | `src/vendor.ts` |
| 补丁台账：原因、涉及的包、通用还是自家专用、验证 | minimax-code `third_party/pi-mono/MINIMAX_CHANGES.md:322-326` | `src/ledger.ts` |
| 逐文件基线：每个文件记上游摘要和改写后的摘要 | minimax-code `packages/tui/src/tui/engine/BASELINE.json` | `src/manifest.ts` + `src/triage.ts` |
| 目录改过名的 fork：先把路径挪回上游坐标再比 | Step-Code `packages/providers/`（pi 的 `packages/ai/`）、`packages/agent-core/`（pi 的 `packages/agent/`） | `src/triage.ts` 的 `relocatePrefix`、`detectMoves` |

```bash
npm start                                                    # 六段演示：CHANGELOG、vendor 标记、台账体检、分诊、挪回去再分诊、对账
npm start -- changelog CHANGELOG.md --from 0.79.1 --to 0.84.4
npm start -- ledger LOCAL_CHANGES.md
npm start -- vendor third_party/x/.vendor.json
npm start -- triage --base ./base --ours ./ours --next ./next --ext .ts \
    --map packages/ai=packages/providers --follow-moves --ledger LOCAL_CHANGES.md
npm test                                                     # 45 个用例
```

退出码：0 没有要处理的，1 有（区间里有破坏性变更 / 格式有错 / 有文件要人看），2 用法或输入错误。

需要 Node ≥ 22.6，因为要用 `--experimental-strip-types` 直接运行 TypeScript。没有依赖，所以不用 `npm i`。

三份目录怎么来：`triage` 只比目录，不碰 git。上游的两份用 `git archive <commit> <路径> | tar -x -C <目录>` 导出，「我们」那份就是仓库里 vendor 进来的目录。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 全部词汇：清单、十二种文件处境、台账条目、发现 |
| `src/semver.ts` | 三段版本号的解析和比较；别的写法一律报错 |
| `src/changelog.ts` | 读 CHANGELOG：版本段、破坏性变更条目、区间、补丁号里的破坏性变更 |
| `src/vendor.ts` | vendor 标记检查；文件存不存在由调用方注入 |
| `src/ledger.ts` | 读补丁台账：条目、字段、提到的文件路径、格式问题 |
| `src/triage.ts` | 三方分诊；原样挪走的文件识别；目录改名 |
| `src/reconcile.ts` | 台账对分诊结果：每条补丁的去向，没被点名的改动 |
| `src/manifest.ts` | 目录 → 「相对路径 → sha256」；读文本文件 |
| `src/fixtures.ts` | 演示数据：虚构的上游和下游 |
| `src/report.ts`、`src/demo.ts`、`src/main.ts` | 输出、演示与命令行入口 |
| `src/*.test.ts` | `node:test` 用例 |

本例的简化：只比摘要，不做内容合并，「要人合」的文件还是得用 `git merge-file` 或手工处理；挪走之后又改过的文件认不出来；台账到文件的关联靠条目里出现的路径，条目只写函数名或类型名时关联不上；CHANGELOG 只认 `## [x.y.z]` 标题和 `### Breaking…` 小节。

维护一份长期 diff 的三条经验：

1. **基线要钉到 commit，并且让机器读得到。** tag 会被移动，「大概是 0.84 那会儿」半年后没人说得清。没有基线，三方分诊退化成两方 diff，分不出哪些差异是自己改的、哪些是上游后来改的。
2. **台账要写到文件。** 只写「改了哪个包」的台账，升级时回答不了「这个冲突文件是哪条补丁造成的」。格式也要有机器检查，不然三个月就走样（演示第 3、6 段）。
3. **挪目录是有价的。** 重排目录之后，按路径比的工具会把挪走的文件全算成「删了」，上游在这些文件上的改动不会出现在冲突列表里，而是悄悄丢掉（演示第 4、5 段）。
