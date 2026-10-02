import assert from "node:assert/strict";
import { test } from "node:test";
import { gaps, type GateProfile, PI_EXAMPLES, SURFACES, THIS_EXAMPLE } from "./coverage.ts";

const profile = (name: string): GateProfile => {
  const found = PI_EXAMPLES.find((p) => p.name === name);
  assert.ok(found, name);
  return found;
};
const serious = (p: GateProfile) => gaps(p).filter((g) => g.severity === "高").map((g) => g.message);

test("permission-gate 只管模型的 bash", () => {
  assert.deepEqual(serious(profile("permission-gate")), ["不管 model:write", "不管 model:edit", "不管 user:bash"]);
});

test("protected-paths 只管 write / edit：bash 里的重定向它看不见", () => {
  assert.ok(serious(profile("protected-paths")).includes("不管 model:bash"));
});

test("sandbox：项目配置不经信任检查、两条路都开着失败", () => {
  const messages = serious(profile("sandbox"));
  assert.ok(messages.includes("项目配置不经信任检查、能放松限制"));
  assert.ok(messages.includes("出错时 model:bash 落回本机执行"));
  assert.ok(messages.includes("出错时 user:bash 落回本机执行"));
});

test("gondolin 覆盖最全，只剩用户 ! 在 VM 起不来时落回本机", () => {
  assert.deepEqual(serious(profile("gondolin")), ["出错时 user:bash 落回本机执行"]);
});

test("本例：没有高等级缺口", () => {
  assert.deepEqual(serious(THIS_EXAMPLE), []);
  assert.deepEqual([...THIS_EXAMPLE.covers].sort(), [...SURFACES].sort());
});

test("缺口按严重程度排序；读不拦对确认类是低、对隔离类是中", () => {
  const confirm: GateProfile = { name: "x", source: "", kind: "confirm", covers: [], projectConfig: "none", onFailure: {} };
  const levels = gaps(confirm).map((g) => g.severity);
  assert.deepEqual(levels, [...levels].sort((a, b) => "高中低".indexOf(a) - "高中低".indexOf(b)));
  assert.equal(gaps(confirm).find((g) => g.message === "不管 model:read")?.severity, "低");
  assert.equal(gaps({ ...confirm, kind: "isolate" }).find((g) => g.message === "不管 model:read")?.severity, "中");
});
