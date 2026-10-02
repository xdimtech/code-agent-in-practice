import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceMerge, tighten } from "./merge.ts";
import { DEFAULT_POLICY, type Policy } from "./types.ts";

const CWD = "/work/repo";
const LOOSEN = { mode: "auto", protectedPaths: [], writeRoots: ["/"], gateUserCommands: false } as const;

test("后者覆盖：项目文件一行就能把默认保护全拿掉", () => {
  assert.deepEqual(replaceMerge(DEFAULT_POLICY, LOOSEN), { mode: "auto", writeRoots: ["/"], protectedPaths: [], gateUserCommands: false });
});

test("只许收紧：放松请求全部忽略，并逐条报出来", () => {
  const { policy, ignored } = tighten(DEFAULT_POLICY, LOOSEN, CWD);
  assert.deepEqual(policy, DEFAULT_POLICY);
  assert.equal(ignored.length, 3);
  assert.match(ignored.join("\n"), /mode 想从 ask 放到 auto/);
  assert.match(ignored.join("\n"), /gateUserCommands 想关掉/);
  assert.match(ignored.join("\n"), /writeRoots 想加 \//);
});

test("模式只能往严里走", () => {
  assert.equal(tighten(DEFAULT_POLICY, { mode: "read-only" }, CWD).policy.mode, "read-only");
  const auto: Policy = { ...DEFAULT_POLICY, mode: "auto" };
  assert.equal(tighten(auto, { mode: "ask" }, CWD).policy.mode, "ask");
  assert.equal(tighten(auto, { mode: "auto" }, CWD).ignored.length, 0);
});

test("可写目录只能缩小到原范围里面", () => {
  assert.deepEqual(tighten(DEFAULT_POLICY, { writeRoots: ["src", "docs"] }, CWD).policy.writeRoots, ["src", "docs"]);
  const mixed = tighten(DEFAULT_POLICY, { writeRoots: ["src", "../other", "~/x"] }, CWD);
  assert.deepEqual(mixed.policy.writeRoots, ["src"]);
  assert.equal(mixed.ignored.length, 2);
});

test("全部在范围外：保留原范围，不变成「哪也不许写」也不变成放宽", () => {
  const { policy, ignored } = tighten(DEFAULT_POLICY, { writeRoots: ["/etc"] }, CWD);
  assert.deepEqual(policy.writeRoots, ["."]);
  assert.equal(ignored.length, 1);
});

test("明写 [] 就是哪也不许写", () => {
  assert.deepEqual(tighten(DEFAULT_POLICY, { writeRoots: [] }, CWD).policy.writeRoots, []);
});

test("保护名单取并集；少写一项不等于删掉", () => {
  const { policy, ignored } = tighten(DEFAULT_POLICY, { protectedPaths: ["secrets/*", ".env"] }, CWD);
  assert.deepEqual(policy.protectedPaths, [...DEFAULT_POLICY.protectedPaths, "secrets/*"]);
  assert.deepEqual(ignored, []);
});

test("用户已经豁免了自己的命令，项目可以要求重新管起来", () => {
  const exempt: Policy = { ...DEFAULT_POLICY, gateUserCommands: false };
  assert.equal(tighten(exempt, { gateUserCommands: true }, CWD).policy.gateUserCommands, true);
  assert.equal(tighten(exempt, {}, CWD).policy.gateUserCommands, false);
});

test("不改输入对象", () => {
  const base = structuredClone(DEFAULT_POLICY);
  tighten(base, { protectedPaths: ["x"], writeRoots: ["src"] }, CWD);
  replaceMerge(base, LOOSEN);
  assert.deepEqual(base, DEFAULT_POLICY);
});
