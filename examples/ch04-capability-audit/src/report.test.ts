import { test } from "node:test";
import assert from "node:assert/strict";
import type { Evidence, Hit, Row, Status } from "./classify.ts";
import { citation, displayWidth, renderCompare, renderSingle, strongest, tally } from "./report.ts";

const hit = (file: string, line: number, text = ""): Hit => ({ file, line, text });

function row(id: string, status: Status, evidence: Partial<Evidence> = {}): Row {
  return {
    capability: { id, name: id.toUpperCase(), present: [] },
    status,
    evidence: { present: [], wired: undefined, declared: [], ...evidence },
  };
}

test("全角字符占两格", () => {
  assert.equal(displayWidth("决定不做"), 8);
  assert.equal(displayWidth("MCP 有"), 6);
});

test("引用优先挑定义处，没有定义处就用第一个命中", () => {
  assert.deepEqual(strongest([hit("a.ts", 1, "import x"), hit("b.ts", 7, "export function x")]), hit("b.ts", 7, "export function x"));
  assert.deepEqual(strongest([hit("a.ts", 1, "// x")]), hit("a.ts", 1, "// x"));
});

test("每种状态引用最能说明问题的那条证据", () => {
  const impl = [hit("mcp.ts", 3, "export class McpClient")];
  const decl = [hit("README.md", 499)];
  assert.equal(citation(row("a", "有", { present: impl })), "mcp.ts:3");
  assert.equal(citation(row("a", "未接线", { present: impl, wired: [] })), "mcp.ts:3（0 个调用点）");
  assert.equal(citation(row("a", "声明过时", { present: impl, declared: decl })), "mcp.ts:3 ↔ README.md:499");
  assert.equal(citation(row("a", "决定不做", { declared: decl })), "README.md:499");
  assert.equal(citation(row("a", "没做")), "—");
});

test("单仓库报告：表头、每项一行、按状态计数", () => {
  const out = renderSingle("pi", [row("tui", "有", { present: [hit("tui.ts", 1)] }), row("mcp", "决定不做", { declared: [hit("README.md", 9)] })]);
  const lines = out.split("\n");
  assert.equal(lines[0], "pi：2 项能力");
  assert.match(lines[2]!, /^状态\s+能力\s+证据$/);
  assert.match(lines[3]!, /^有\s+TUI\s+tui\.ts:1$/);
  assert.equal(lines.at(-1), tally([row("x", "有"), row("y", "决定不做")]));
  assert.equal(lines.at(-1), "有 1 · 未接线 0 · 声明过时 0 · 决定不做 1 · 没做 0");
});

test("对照报告只给状态变了的行列证据，并数出变化项", () => {
  const out = renderCompare(
    { title: "pi", rows: [row("mcp", "决定不做"), row("tui", "有")] },
    {
      title: "fork",
      rows: [row("mcp", "声明过时", { present: [hit("mcp.ts", 1)], declared: [hit("README.md", 2)] }), row("tui", "有")],
    },
  );
  assert.match(out, /MCP\s+决定不做\s+→ 声明过时\s+mcp\.ts:1 ↔ README\.md:2/);
  assert.match(out, /TUI\s+有\s+有\n/);
  assert.match(out, /1 项状态不同$/);
});
