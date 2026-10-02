import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, compaction, result, usage, user } from "./fixtures.ts";
import { addUsage, billedUsage, breakdown, calculateCost, sumEntries, usd, ZERO } from "./usage.ts";
import type { Entry, Usage } from "./types.ts";

test("addUsage 返回新对象，不改原值", () => {
  const t = addUsage(ZERO, usage(3, 2, 0.5));
  assert.deepEqual(t, { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.5 });
  assert.equal(ZERO.input, 0);
});

test("三种计费来源：助手消息、带 usage 的工具结果、压缩/分支摘要", () => {
  const withUsage: Entry = { ...result("r", "a", "t"), message: { ...(result("r", "a", "t").message as object), usage: usage(1, 1, 0.2) } as Entry["message"] };
  assert.equal(billedUsage(assistant("a", null, { responseModel: "real" }))!.key, "p/real");
  assert.equal(billedUsage(assistant("a", null))!.key, "p/m");
  assert.equal(billedUsage(withUsage)!.key, "Tools/summaries");
  assert.equal(billedUsage(compaction("k", "a", "a", 0.3))!.key, "Tools/summaries");
  assert.equal(billedUsage(result("r", "a", "t")), undefined);
  assert.equal(billedUsage(user("u", null)), undefined);
  assert.equal(billedUsage(compaction("k", "a", "a")), undefined);
});

test("sumEntries 和 breakdown：按花费从高到低", () => {
  const es = [assistant("a", null, { cost: 0.1 }), assistant("b", "a", { cost: 0.2, responseModel: "big" }), compaction("k", "b", "b", 0.05)];
  assert.ok(Math.abs(sumEntries(es).cost - 0.35) < 1e-12);
  assert.deepEqual(breakdown(es).map((x) => x.key), ["p/big", "p/m", "Tools/summaries"]);
});

const u = (input: number, output: number, extra: Partial<Usage> = {}): Usage => ({ ...usage(input, output, 0), ...extra });

test("calculateCost：按每百万 token 计价，不改传入的 usage", () => {
  const given = u(1_000_000, 100_000, { cacheRead: 200_000, cacheWrite: 40_000 });
  const c = calculateCost({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, given);
  assert.ok(Math.abs(c.input - 3) < 1e-9);
  assert.ok(Math.abs(c.output - 1.5) < 1e-9);
  assert.ok(Math.abs(c.cacheRead - 0.06) < 1e-9);
  assert.ok(Math.abs(c.cacheWrite - 0.15) < 1e-9);
  assert.ok(Math.abs(c.total - 4.71) < 1e-9);
  assert.equal(given.cost.total, 0);
});

test("阶梯价：取命中的最高阈值，整次请求换价", () => {
  const rates = {
    input: 1, output: 1, cacheRead: 1, cacheWrite: 1,
    tiers: [
      { inputTokensAbove: 100, input: 2, output: 2, cacheRead: 2, cacheWrite: 2 },
      { inputTokensAbove: 1000, input: 4, output: 4, cacheRead: 4, cacheWrite: 4 },
    ],
  };
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);
  near(calculateCost(rates, u(50, 0)).input, 50 / 1e6);
  near(calculateCost(rates, u(500, 0)).input, 1000 / 1e6);
  near(calculateCost(rates, u(5000, 0)).input, 20000 / 1e6);
});

test("1 小时缓存写按 2 倍输入价", () => {
  const c = calculateCost({ input: 3, output: 0, cacheRead: 0, cacheWrite: 3.75 }, u(0, 0, { cacheWrite: 1_000_000, cacheWrite1h: 400_000 }));
  assert.ok(Math.abs(c.cacheWrite - (3.75 * 0.6 + 6 * 0.4)) < 1e-9);
});

test("usd 保留四位", () => assert.equal(usd(0.12345), "$0.1235"));
