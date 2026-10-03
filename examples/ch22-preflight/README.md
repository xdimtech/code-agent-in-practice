# ch22-preflight

对应 [第 22 章 上线前必补清单](../../book/04-shipping/ch22-preflight.md)。

把 pi 交给不熟悉它的人用之前，有四件事 pi 开箱不做、必须自己补，外加一件强烈建议。这个例子把它们写成一个 pi 扩展，每一件都能单独跑、单独测：

- **刹车**：同一个调用（同一工具 + 同一组参数 + 工作区没变）到第四次就拦下，并带 `terminate`；一次运行到 40 轮就 `ctx.abort()`
- **确认**：模型的工具调用和用户的 `!` 两条路都接第 15 章的确认；在 `user_bash` 上，确认和凭据过滤必须是同一个处理器
- **凭据**：子进程环境按白名单给，两条路各有各的接法——bash 工具用 `spawnHook`，`!` 返回包过的 `operations`
- **安装脚本**：零代码，一个环境变量或一行设置；`install-lab` 在临时目录里真跑 npm 验证
- **崩溃收尾**（建议）：没人接的 Promise 拒绝重新抛出，回到 pi 自己的终端恢复路径；Bun 单文件二进制下这一步是必要的

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 宿主刹车 `shouldStopAfterTurn` 在产品包里没人设 | `agent/src/agent-loop.ts:252` | `src/loop-guard.ts` |
| 被拦的调用带 `terminate`，整批都带才停 | `agent/src/agent-loop.ts:633-643`、`:580-582`、`:235` | `onToolCall` |
| `tool_call` 第一个 block 就返回；`user_bash` 第一个非空结果胜出、抛错被吞 | `core/extensions/runner.ts:982-1003`、`:1005-1032` | `extension/wiring.ts` |
| 子进程环境 = 全量 `process.env`，PATH 前加 pi 的 bin 目录 | `utils/shell.ts:138-150`（未导出） | `filterEnv`、`withBinDir` |
| bash 工具：删五个 `PI_*` 再补回，然后交给 `spawnHook` | `core/tools/bash.ts:170-196` | `envSpawnHook` |
| `!`：执行器不传 env | `core/bash-executor.ts:107-110`、`core/tools/bash.ts:102` | `wrapOperations` |
| 内置 bash 带着用户的 `shellPath` / `shellCommandPrefix` | `core/agent-session.ts:2774` | `src/settings.ts` + `deps.shell` |
| `pi install` 的 npm 参数里没有 `--ignore-scripts` | `core/package-manager.ts:1785-1806` | `src/install-scripts.ts`、`src/install-lab.ts` |
| 交互模式只挂 `uncaughtException` | `modes/interactive/interactive-mode.ts:4058-4064` | `src/crash.ts`、`scripts/probe.ts` |

（pi 的路径以 `packages/coding-agent/src/` 为根，`agent/src/` 指 `packages/agent/src/`。）

```bash
npm start -- checklist                                         # pi 开箱 vs 装了本例扩展，五项各是什么状态
npm start -- checklist --settings fixtures/settings-ignore-scripts.json
npm start -- env                                               # 示例环境过白名单（只打印名字）
npm start -- env --real                                        # 当前进程的环境（拿掉的名字也不打印）
npm start -- loop                                              # 刹车怎么数：三个场景
npm start -- install-lab                                       # 临时目录里真跑 npm install，离线
npm start -- probe                                             # 没人接的拒绝落在哪
npm test                                                       # 67 个用例
```

需要 Node ≥ 22.6（`--experimental-strip-types`）。没有依赖，所以不用 `npm i`。`install-lab` 需要本机有 npm，`--offline`，不联网、不碰全局目录。

装进 pi：

```bash
pi -e ./extension/preflight.ts        # 然后在 pi 里输入 /preflight
```

`extension/preflight.ts` 是唯一 import pi 的文件，并且从 `../ch15-policy-layer/` 引入确认用的两个适配器——两个目录要放在一起。

| 文件 | 内容 |
| --- | --- |
| `src/loop-guard.ts` | 刹车：调用指纹、工作区换代、轮数上限；状态不可变 |
| `src/env-filter.ts` | 凭据：白名单 + 黑名单兜底，`spawnHook` 与 `operations` 两种接法 |
| `src/install-scripts.ts` | 按 `npmCommand` 与环境判断 `pi install` 跑不跑安装脚本 |
| `src/install-lab.ts` | 真跑 npm：pi 默认 / 环境变量 / `npmCommand` 三种写法 |
| `src/settings.ts` | 读 settings.json 里的 `npmCommand`、`shellPath`、`shellCommandPrefix`，坏文件直接报错 |
| `src/crash.ts`、`scripts/probe.ts` | 拒绝兜底，以及在当前运行时下验证它的探针 |
| `src/checklist.ts` | 五项的事实 → 状态 → 清单 |
| `extension/wiring.ts` | 把以上接到 pi 上；依赖全部注入 |
| `extension/preflight.ts` | pi 扩展入口 |
| `src/main.ts` | 命令行入口 |
| `*.test.ts` | `node:test` 用例 |

本例的简化：刹车只认 `edit` / `write` 为「改了工作区」，用 bash 改文件不换代；白名单是一份通用默认值，`JAVA_HOME`、`GOPATH` 这类要用 `withExtraAllow` 自己加，并且区分大小写（Windows 上的 `Path` 也要自己加）；只读全局 settings.json，不读项目里的；确认只是提醒，不是边界——要边界得有操作系统级隔离（第 17 章）。

三条经验：

1. **同一个钩子上两件事要合成一个处理器。** `user_bash` 第一个非空结果胜出，确认和凭据过滤分开写，排在前面的那个会让另一个永远不被调用。
2. **覆盖内置工具，就接手了它的全部参数。** 用 pi 自己的 `createBashToolDefinition` 造，提示词片段和渲染都跟着来；但工厂不知道用户的设置，pi 传给内置 bash 的 `shellPath`、`commandPrefix` 得自己带上，漏一个，用户的设置就悄悄失效。
3. **开着失败的钩子必须自己接住错误。** `user_bash` 处理器抛错，pi 记一条错误、照常用全量环境执行命令；本例把自己的错误也变成一次拒绝。
