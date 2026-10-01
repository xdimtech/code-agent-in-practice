import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestError, parseManifest } from "./manifest.ts";
import { PI_MANIFEST } from "./pi-manifest.ts";

const probe = { pattern: "x", paths: ["**/src/**"] };

function rejects(raw: unknown, message: RegExp): void {
  assert.throws(() => parseManifest(raw), (e) => e instanceof ManifestError && message.test(e.message));
}

test("内置的 pi 清单能通过自己的校验，24 项，id 不重复", () => {
  const caps = parseManifest(JSON.parse(JSON.stringify(PI_MANIFEST)));
  assert.equal(caps.length, 24);
});

test("最小的合法清单", () => {
  const [cap] = parseManifest([{ id: "mcp", name: "MCP", present: [probe] }]);
  assert.deepEqual(cap, { id: "mcp", name: "MCP", present: [{ ...probe, ignoreCase: false }], wired: undefined, declared: undefined });
});

test("顶层不是非空数组", () => {
  rejects({}, /顶层需要非空数组/);
  rejects([], /顶层需要非空数组/);
});

test("错误消息带着出错的位置", () => {
  rejects([{ id: "Bad ID", name: "x", present: [probe] }], /清单\[0\]\.id/);
  rejects([{ id: "a", name: "", present: [probe] }], /清单\[0\]（a）\.name/);
  rejects([{ id: "a", name: "A", present: [] }], /（a）\.present.*非空数组/);
  rejects([{ id: "a", name: "A", present: [{ pattern: "x", paths: [] }] }], /present\[0\]\.paths/);
  rejects([{ id: "a", name: "A", present: [{ pattern: "x", paths: ["ok", 3] }] }], /paths\[1\]/);
  rejects([{ id: "a", name: "A", present: [{ ...probe, ignoreCase: "yes" }] }], /ignoreCase.*布尔/);
  rejects([{ id: "a", name: "A", present: [probe], declared: [] }], /（a）\.declared/);
});

test("id 重复", () => {
  const cap = { id: "a", name: "A", present: [probe] };
  rejects([cap, cap], /id「a」重复/);
});
