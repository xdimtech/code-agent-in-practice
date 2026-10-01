import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, classify, type Hit } from "./classify.ts";
import type { Capability, Probe } from "./manifest.ts";

const hit = (file: string, line = 1, text = ""): Hit => ({ file, line, text });
const none: Hit[] = [];

test("五种状态由三组证据决定", () => {
  assert.equal(classify({ present: [hit("a.ts")], wired: undefined, declared: none }), "有");
  assert.equal(classify({ present: [hit("a.ts")], wired: [hit("b.ts")], declared: none }), "有");
  assert.equal(classify({ present: [hit("a.ts")], wired: none, declared: none }), "未接线");
  assert.equal(classify({ present: none, wired: undefined, declared: [hit("README.md")] }), "决定不做");
  assert.equal(classify({ present: none, wired: undefined, declared: none }), "没做");
});

test("实现了、文档却还说不做：声明过时优先于未接线", () => {
  assert.equal(classify({ present: [hit("mcp.ts")], wired: none, declared: [hit("README.md")] }), "声明过时");
});

test("没有实现时，wired 探针不影响结论", () => {
  assert.equal(classify({ present: none, wired: none, declared: none }), "没做");
});

test("present 探针按顺序试，第一个有命中的提供证据，后面的不再执行", () => {
  const specific: Probe = { pattern: "specific", paths: ["**"] };
  const broad: Probe = { pattern: "broad", paths: ["**"] };
  const called: string[] = [];
  const grep = (p: Probe): Hit[] => {
    called.push(p.pattern);
    return p.pattern === "specific" ? [hit("tool.ts", 9)] : [hit("comment.ts")];
  };
  const cap: Capability = { id: "x", name: "X", present: [specific, broad] };
  const [row] = audit([cap], grep);
  assert.deepEqual(row!.evidence.present, [hit("tool.ts", 9)]);
  assert.deepEqual(called, ["specific"]);
});

test("清单没写 wired 就不检查接线；写了就检查", () => {
  const grep = (p: Probe): Hit[] => (p.pattern === "def" ? [hit("def.ts")] : []);
  const def: Probe = { pattern: "def", paths: ["**"] };
  const call: Probe = { pattern: "call", paths: ["**"] };
  const rows = audit(
    [
      { id: "a", name: "A", present: [def] },
      { id: "b", name: "B", present: [def], wired: [call] },
    ],
    grep,
  );
  assert.deepEqual(
    rows.map((r) => r.status),
    ["有", "未接线"],
  );
});

test("接线探针命中定义处本身不算调用点", () => {
  const def = hit("telemetry.ts", 138, "export function startSpan(");
  const grep = (): Hit[] => [def];
  const cap: Capability = {
    id: "span",
    name: "Span",
    present: [{ pattern: "def", paths: ["**"] }],
    wired: [{ pattern: "call", paths: ["**"] }],
  };
  assert.equal(audit([cap], grep)[0]!.status, "未接线");

  const withCall = (p: Probe): Hit[] => (p.pattern === "call" ? [def, hit("loop.ts", 5)] : [def]);
  const [row] = audit([cap], withCall);
  assert.equal(row!.status, "有");
  assert.deepEqual(row!.evidence.wired, [hit("loop.ts", 5)]);
});
