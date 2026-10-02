import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatterns, matchesAnyExactPattern, matchesAnyPattern, splitPatterns } from "./patterns.ts";

const ALL = ["extensions/a.ts", "extensions/b.ts", "extensions/legacy.ts", "skills/review/SKILL.md"];

test("没有普通模式时从全集开始", () => {
  assert.deepEqual([...applyPatterns(ALL, ["!extensions/legacy.ts"])], ["extensions/a.ts", "extensions/b.ts", "skills/review/SKILL.md"]);
});

test("有普通模式时只留匹配的", () => {
  assert.deepEqual([...applyPatterns(ALL, ["extensions/*.ts"])], ["extensions/a.ts", "extensions/b.ts", "extensions/legacy.ts"]);
});

test("+ 能救回被 ! 排除的", () => {
  assert.deepEqual([...applyPatterns(ALL, ["extensions/*.ts", "!extensions/*.ts", "+extensions/b.ts"])], ["extensions/b.ts"]);
});

test("- 最后执行，永远赢，连 + 救回的也删", () => {
  assert.deepEqual([...applyPatterns(ALL, ["!extensions/*.ts", "+extensions/b.ts", "-extensions/b.ts"])], ["skills/review/SKILL.md"]);
});

test("+ 和 - 只认精确路径，不认 glob", () => {
  assert.deepEqual([...applyPatterns(ALL, ["!extensions/*.ts", "+extensions/*.ts"])], ["skills/review/SKILL.md"]);
  assert.equal(matchesAnyExactPattern("extensions/a.ts", ["./extensions/a.ts"]), true);
});

test("普通模式可以只写文件名", () => {
  assert.equal(matchesAnyPattern("extensions/legacy.ts", ["legacy.ts"]), true);
});

test("SKILL.md 可以用所在目录名匹配，精确模式也可以写目录", () => {
  assert.equal(matchesAnyPattern("skills/review/SKILL.md", ["review"]), true);
  assert.equal(matchesAnyExactPattern("skills/review/SKILL.md", ["skills/review"]), true);
  assert.equal(matchesAnyPattern("extensions/review/index.ts", ["review"]), false);
});

test("splitPatterns 按前缀分四类", () => {
  assert.deepEqual(splitPatterns(["a", "!b", "+c", "-d"]), { includes: ["a"], excludes: ["b"], forceIncludes: ["c"], forceExcludes: ["d"] });
});
