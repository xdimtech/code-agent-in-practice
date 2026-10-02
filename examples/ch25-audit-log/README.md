# ch25-audit-log

对应 [第 25 章 合规与审计边界](../../book/04-shipping/ch25-compliance.md)。

pi 的会话文件够复盘，不够当证据：没有哈希，加载时跳过坏行、给末行补换行，迁移时整文件重写；记下的是模型提议的参数，不是真正执行的那份。这个例子做两件事：

- **检查一份 pi 会话能证明什么、不能证明什么**：坏行、末行无换行、断掉的 `parentId`、完整输出存在会话之外、分不清是被拦还是工具自己失败的报错、内联图片
- **写一条能自证的审计日志**：每条记录带上一条的哈希（sha256 或 HMAC-SHA256），校验逐行往下走，第一处断裂之后一律不可信；链尾的 `{seq, hash}` 抄到日志之外当锚点，删末尾、整条重算都能露馅
- **记下两份参数**：`tool.proposed` 是模型给的（也就是会话里那份），`tool.executed` 是校验、`prepareArguments`、别的扩展原地改过之后真正交给工具的，外加两者差在哪些路径
- **写不进去就不执行**：一个 pi 扩展，日志打不开、已有日志校验不过、密钥不合格、磁盘满了，模型的工具调用一律拦下；用户的 `!` 命令返回顶替结果（这条路上抛错会被吞掉、命令照常执行）

| 规则 | pi 的出处 | 本例 |
| --- | --- | --- |
| 坏行悄悄跳过 | `core/session-manager.ts:503-511` | `src/session-check.ts` 报 `malformed-line` |
| 读文件时给缺换行的末行补一个 | `core/session-manager.ts:555` | `src/session-check.ts` 报 `no-trailing-newline` |
| 空文件初始化、版本迁移、分支导出时整文件重写 | `core/session-manager.ts:910`、`:919`、`:1486`；`_rewriteFile` 在 `:980-990` | `src/session-check.ts` 报 `old-version`；审计日志只追加 |
| 会话里记的是 `toolCall.arguments` | `agent/src/agent-loop.ts:416`、`:443-448` | `tool.proposed` |
| 执行前还会 `prepareArguments`、校验转换、钩子原地改且不再校验 | `agent/src/agent-loop.ts:584-628`；`ai/src/utils/validation.ts:317-340`；`docs/extensions.md:786-792` | `tool.executed` 的 `input` 和 `drift`（`src/drift.ts`） |
| 被拦和工具失败都是 `details: {}` 的报错结果 | `agent/src/agent-loop.ts:634-644`、`:758-763` | `tool.settled` 的 `executed` |
| 截断时完整输出写到 `tmpdir()/pi-bash-<id>.log` | `core/bash-executor.ts:64-74` | `tool.executed` 的 `fullOutput` 记路径、大小、sha256 |
| `tool_call` 抛错 = 不执行；`user_bash` 抛错被吞掉 | `core/extensions/runner.ts:982-1003`、`:1005-1030` | `extension/audit-log.ts` |
| bash 子进程继承整个 `process.env` | `utils/shell.ts:138-150`；`core/tools/bash.ts:102`、`:177` | `extension/audit-log.ts` 的 `takeKey` |

（pi 的路径以 `packages/coding-agent/src/` 为根，`agent/src/` 指 `packages/agent/src/`，`ai/src/` 指 `packages/ai/src/`，`docs/` 指 `packages/coding-agent/docs/`。）

```bash
npm start                                         # 六段演示：会话能证明什么、改一行、删末尾、整条重算、两份参数、写不进去
npm start -- verify audit.jsonl                   # 完好退 0，有断裂退 1；HMAC 密钥从 AUDIT_LOG_HMAC_KEY 读
npm start -- anchor audit.jsonl > anchor.json     # 校验通过才打印链尾锚点；把它存到日志之外
npm start -- verify audit.jsonl --anchor anchor.json
npm start -- session ~/.pi/agent/sessions/<目录>/<文件>.jsonl
npm test                                          # 84 个用例
```

退出码：0 通过，1 有错误，2 用法或输入错误（文件不存在、锚点格式不对、密钥不到 32 字节）。

挂到 pi 上：

```bash
AUDIT_LOG_HMAC_KEY="$(openssl rand -hex 32)" pi -e ./extension/audit-log.ts --audit-log ~/audit/pi.jsonl
```

扩展只在 `fake-pi.ts` 模拟的事件顺序上测过，没有对真实的 pi 进程跑过。需要 Node ≥ 22.6，因为要用 `--experimental-strip-types` 直接运行 TypeScript。没有依赖，所以不用 `npm i`。

一条记录长这样（规范 JSON，键按字典序，一行一条）：

```json
{"alg":"hmac-sha256","at":"2026-10-03T09:00:01.000Z","body":{"args":{"command":"ls"},"toolCallId":"c1","toolName":"bash"},"hash":"…64 位…","kind":"tool.proposed","prev":"…上一条的 hash…","seq":2,"v":1}
```

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | 记录、链尾、锚点、发现项 |
| `src/canonical.ts` | 规范 JSON：同一份内容只有一种写法，哈希才算得稳 |
| `src/chain.ts` | `seal`：接在链尾后面封一条记录；sha256 / HMAC 两种 |
| `src/verify.ts` | `verifyLog`：逐行校验，停在第一处断裂，比对锚点 |
| `src/anchor.ts` | 锚点的生成和解析 |
| `src/drift.ts` | 两份参数差在哪些路径 |
| `src/records.ts` | 从 pi 事件拼出 `tool.proposed` / `tool.executed` / `tool.settled` / `user.bash` |
| `src/writer.ts` | 写入器：打开时先校验，写失败一次就降级、之后一律不写 |
| `src/session-check.ts` | 检查 pi 会话文件 |
| `src/key.ts` | 从环境变量取 HMAC 密钥；太短报错，不悄悄退回 sha256 |
| `src/load.ts` | 读写磁盘：只认普通文件、限制大小，别人可写的日志不接着写，新文件 0600 |
| `src/forge.ts` | 篡改者会做的事：改一行、删末尾、整条重算 |
| `src/fake-pi.ts` | 假的 pi：按 `agent-loop.ts` 的顺序触发事件 |
| `src/fixtures.ts` | 手写的 pi 会话、演示用的密钥 |
| `extension/audit-log.ts` | pi 扩展 |
| `src/report.ts`、`src/demo.ts`、`src/main.ts` | 输出、演示与命令行入口 |
| `*.test.ts` | `node:test` 用例 |

本例的简化：HMAC 用的是对称密钥，写日志的机器上有密钥，就能重算整条链——要防这台机器本身，得把锚点定期送到别处，或者改用非对称签名、交给只追加的外部存储；工具输出只记摘要不记原文，原文仍在会话里，会话本身的保存和脱敏不归本例管；用户 `!` 命令 pi 没有结束事件，只记了「要跑什么」，没有记结果；并发写同一个日志文件没有加锁。

写这条日志的三条经验：

1. **校验停在第一处断裂。** 断点之后的记录即使彼此链得上，也可能是整段重写的；把它们算成「大部分完好」，就是在替篡改者说话（演示第 2 段）。
2. **链只证明内部一致，锚点才证明没被换掉。** 删掉末尾、或者改完把后面的 sha256 全部重算，剩下的仍是一条完好的链；要么有对方拿不到的密钥，要么有存在别处的锚点（演示第 3、4 段）。
3. **审计写不进去的时候，要决定的是「还执行吗」。** 开着失败的审计在磁盘满、权限被改的那一刻正好失明；关着失败要分别确认每条执行路径的失败语义（演示第 6 段；第 15 章）。
