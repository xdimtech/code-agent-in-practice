import assert from "node:assert/strict";
import { test } from "node:test";
import { changedPart, compareVersions, parseVersion, VersionError } from "./semver.ts";

test("认 x.y.z 和 v 前缀", () => {
  assert.deepEqual(parseVersion("0.84.4"), [0, 84, 4]);
  assert.deepEqual(parseVersion("v0.79.1"), [0, 79, 1]);
});

test("预发布、两段、空串都报错，不猜", () => {
  for (const bad of ["0.85.0-rc.1", "0.85", "", "latest"]) assert.throws(() => parseVersion(bad), VersionError);
});

test("按数字比，不按字符串比", () => {
  assert.ok(compareVersions("0.9.0", "0.10.0") < 0);
  assert.ok(compareVersions("0.84.10", "0.84.4") > 0);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
});

test("最高变了哪一段", () => {
  assert.equal(changedPart("0.84.3", "0.84.4"), "patch");
  assert.equal(changedPart("0.84.4", "0.85.0"), "minor");
  assert.equal(changedPart("0.99.9", "1.0.0"), "major");
});
