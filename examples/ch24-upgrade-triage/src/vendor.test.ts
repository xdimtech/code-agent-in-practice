import assert from "node:assert/strict";
import { test } from "node:test";
import { ageInDays, checkVendorMarker } from "./vendor.ts";

const SHA = "28df940f0d07b65284849a483be7b06e2ca046ee";
const marker = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: "pi-mono",
    upstream: { type: "git", url: "https://github.com/earendil-works/pi-mono.git", ref: "refs/tags/v0.79.1", commit: SHA },
    importedAt: "2026-06-16",
    localChangeLog: "CHANGES.md",
    policy: "../AGENTS.md",
    ...over,
  });
const all = () => true;

test("齐全的标记：没有问题，字段读得出来", () => {
  const { marker: m, findings } = checkVendorMarker(marker(), all);
  assert.deepEqual(findings, []);
  assert.equal(m?.commit, SHA);
  assert.equal(m?.ref, "refs/tags/v0.79.1");
  assert.deepEqual([...(m?.references ?? [])], [["localChangeLog", "CHANGES.md"], ["policy", "../AGENTS.md"]]);
});

test("引用的文件不存在：逐个报", () => {
  const { findings } = checkVendorMarker(marker(), (p) => p === "CHANGES.md");
  assert.deepEqual(findings.map((f) => f.rule), ["dangling-reference"]);
  assert.match(findings[0].message, /policy 指向 \.\.\/AGENTS\.md/);
});

test("只有 tag 没有 commit：报没钉住", () => {
  const { findings } = checkVendorMarker(marker({ upstream: { url: "https://x.invalid/r.git", ref: "v1.0.0" } }), all);
  assert.deepEqual(findings.map((f) => f.rule), ["commit-not-pinned"]);
});

test("缺台账、坏日期、非 https 一起报", () => {
  const json = marker({ localChangeLog: undefined, importedAt: "6/16", upstream: { url: "git@x:r.git", commit: SHA } });
  assert.deepEqual(checkVendorMarker(json, all).findings.map((f) => f.rule), ["bad-url", "bad-date", "no-ledger"]);
});

test("不是 JSON、不是对象", () => {
  assert.deepEqual(checkVendorMarker("{", all).findings.map((f) => f.rule), ["bad-json"]);
  assert.deepEqual(checkVendorMarker("[1]", all).findings.map((f) => f.rule), ["bad-json"]);
  assert.equal(checkVendorMarker("[1]", all).marker, undefined);
});

test("导入天数", () => {
  assert.equal(ageInDays("2026-06-16", new Date("2026-09-21T12:00:00Z")), 97);
  assert.equal(ageInDays("昨天", new Date()), undefined);
});
