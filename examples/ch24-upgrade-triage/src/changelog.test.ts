import assert from "node:assert/strict";
import { test } from "node:test";
import { between, breaksInPatchReleases, countBreaking, parseChangelog } from "./changelog.ts";

const SAMPLE = `# Changelog

## [Unreleased]

### Breaking Changes

- 还没发布的不算

## [1.3.1] - 2026-03-02

### Breaking Changes

- 补丁版里改了签名
  第二行接在上一条后面

### Fixed

- 修了一个 bug

## [1.3.0] - 2026-03-01

### Breaking

- 老写法的小节名

### Added

- 新功能

## [1.2.0] - 2026-02-01

### Fixed

- 没有破坏性变更

## [next] - 2026-01-01
`;

test("按版本段切，只收 Breaking 小节里的条目，续行并到上一条", () => {
  const { releases, skipped } = parseChangelog(SAMPLE);
  assert.deepEqual(releases.map((r) => r.version), ["1.3.1", "1.3.0", "1.2.0"]);
  assert.deepEqual(releases[0].breaking, ["补丁版里改了签名 第二行接在上一条后面"]);
  assert.deepEqual(releases[1].breaking, ["老写法的小节名"]);
  assert.deepEqual(releases[2].breaking, []);
  assert.equal(releases[0].date, "2026-03-02");
  assert.deepEqual(skipped, ["next"]);
});

test("Unreleased 段不算进任何版本", () => {
  const { releases } = parseChangelog(SAMPLE);
  assert.ok(releases.every((r) => !r.breaking.includes("还没发布的不算")));
});

test("两种小节标题写法都认，并且分别计数", () => {
  const { breakingHeadings } = parseChangelog(SAMPLE);
  assert.deepEqual([...breakingHeadings], [["Breaking Changes", 1], ["Breaking", 1]]);
});

test("区间是左开右闭、从旧到新", () => {
  const { releases } = parseChangelog(SAMPLE);
  assert.deepEqual(between(releases, "1.2.0", "1.3.1").map((r) => r.version), ["1.3.0", "1.3.1"]);
  assert.equal(countBreaking(between(releases, "1.2.0", "1.3.1")), 2);
  assert.deepEqual(between(releases, "1.3.1", "9.9.9"), []);
});

test("补丁版里的破坏性变更单独挑出来", () => {
  const breaks = breaksInPatchReleases(parseChangelog(SAMPLE).releases);
  assert.deepEqual(breaks.map((b) => [b.previous, b.release.version]), [["1.3.0", "1.3.1"]]);
});

test("空文件不出错", () => {
  const parsed = parseChangelog("");
  assert.deepEqual(parsed.releases, []);
  assert.deepEqual(breaksInPatchReleases(parsed.releases), []);
});
