// 演示用的假数据：一个虚构的上游 acme-agent，和一个把它整份拷进来改的下游。
// 形状照着真实项目的常见写法来，内容是编的。

import type { Manifest } from "./types.ts";

export const CHANGELOG = `# Changelog

## [Unreleased]

## [0.9.1] - 2026-09-02

### Fixed

- Fixed tool output truncation off-by-one.

## [0.9.0] - 2026-08-30

### Breaking Changes

- \`onChunk\` now receives deltas only; accumulate them yourself.
- \`Registry.refresh()\` is now async.

## [0.8.3] - 2026-08-12

### Breaking Changes

- Renamed \`ThinkLevel\` to \`ThinkingLevel\`.
  The old name is not re-exported.

### Fixed

- Fixed session resume on Windows.

## [0.8.2] - 2026-08-01

### Added

- Added \`beforeToolCall\` hook.

## [0.8.1] - 2026-07-20

### Fixed

- Fixed empty thinking replay.

## [0.8.0] - 2026-07-01

### Breaking Changes

- Removed \`sendSessionId\` option.
`;

export const LEDGER = `# 本地补丁

改上游代码之前先在这里记一条，新的在上。

### 2026-08-20 — 工具钩子能中止整轮

- Reason: 宿主的审批钩子要能一票否决，不只是跳过一个工具。
- Affected package: \`packages/agent\`
- Files: src/loop.ts, src/types.ts
- Change type: generic upstreamable seam.
- Upstream PR: not opened.
- Validation: agent 包单测。

### 2026-07-25 — 回放带签名的空 thinking

- Reason: 空 thinking 带签名时被丢掉，下一轮请求被拒。
- Affected package: \`packages/ai\`
- Files: src/replay.ts
- Type: generic fix.
- Upstream PR: not opened.
- Validation: provider 单测。

## 2026-08-25: 导出内部的重试函数

- Reason: 宿主要复用同一套退避。
- Affected package: \`packages/ai\`
- Files: src/index.ts
- Upstream PR: not opened.

### 2026-07-10 — 自家网关的请求头

- Reason: 网关要求带租户头。
- Affected package: \`packages/ai\`
- Files: src/headers.ts
- Change type: downstream-specific glue.
- Upstream PR: not opened; downstream only.
- Validation: 手测。
`;

export const VENDOR_MARKER = JSON.stringify(
  {
    name: "acme-agent",
    upstream: { type: "git", url: "https://example.invalid/acme/agent.git", ref: "refs/tags/v0.8.0", commit: "0123456789abcdef0123456789abcdef01234567" },
    importedAt: "2026-07-03",
    strategy: "source-vendor",
    localChangeLog: "LOCAL_CHANGES.md",
    policy: "../AGENTS.md",
  },
  null,
  2,
);

/** 标记文件旁边实际存在的文件 */
export const VENDOR_SIBLINGS: ReadonlySet<string> = new Set(["LOCAL_CHANGES.md"]);

const manifest = (o: Record<string, string>): Manifest => new Map(Object.entries(o));

/** v0.8.0，下游拷进来的那一版 */
export const BASE = manifest({
  "packages/agent/src/loop.ts": "loop@0.8.0",
  "packages/agent/src/types.ts": "types@0.8.0",
  "packages/agent/src/queue.ts": "queue@0.8.0",
  "packages/ai/src/replay.ts": "replay@0.8.0",
  "packages/ai/src/index.ts": "index@0.8.0",
  "packages/ai/src/headers.ts": "headers@0.8.0",
  "packages/ai/src/stream.ts": "stream@0.8.0",
  "packages/ai/src/legacy.ts": "legacy@0.8.0",
  "packages/ui/src/diff.ts": "diff@0.8.0",
  "packages/ui/src/keys.ts": "keys@0.8.0",
});

/** 下游现在的样子：改了六个文件（其中一个台账没记），把 diff.ts 原样挪了个地方 */
export const OURS = manifest({
  "packages/agent/src/loop.ts": "loop@0.8.0+abort",
  "packages/agent/src/types.ts": "types@0.8.0+abort",
  "packages/agent/src/queue.ts": "queue@0.8.0",
  "packages/ai/src/replay.ts": "replay@fixed",
  "packages/ai/src/index.ts": "index@0.8.0+retry",
  "packages/ai/src/headers.ts": "headers@0.8.0+tenant",
  "packages/ai/src/stream.ts": "stream@0.8.0",
  "packages/ai/src/legacy.ts": "legacy@0.8.0",
  "packages/ui/src/render/diff.ts": "diff@0.8.0",
  "packages/ui/src/keys.ts": "keys@0.8.0+local",
});

/** v0.9.1：上游改了 loop、stream、diff，修了 replay（和下游修得一样），删了 legacy，加了 hooks */
export const NEXT = manifest({
  "packages/agent/src/loop.ts": "loop@0.9.1",
  "packages/agent/src/types.ts": "types@0.8.0",
  "packages/agent/src/queue.ts": "queue@0.8.0",
  "packages/agent/src/hooks.ts": "hooks@0.9.1",
  "packages/ai/src/replay.ts": "replay@fixed",
  "packages/ai/src/index.ts": "index@0.8.0",
  "packages/ai/src/headers.ts": "headers@0.8.0",
  "packages/ai/src/stream.ts": "stream@0.9.1",
  "packages/ui/src/diff.ts": "diff@0.9.1",
  "packages/ui/src/keys.ts": "keys@0.8.0",
});
