import assert from "node:assert/strict";
import { test } from "node:test";
import { PackageJsonError, parsePackageJson } from "./package-json.ts";

test("合法的包：字段原样读出", () => {
  const { pkg, warnings } = parsePackageJson(JSON.stringify({
    name: "p", version: "1.0.0", keywords: ["pi-package"],
    peerDependencies: { typebox: "*" }, pi: { skills: ["./skills"] },
  }));
  assert.equal(pkg.name, "p");
  assert.deepEqual(pkg.keywords, ["pi-package"]);
  assert.deepEqual(pkg.peerDependencies, { typebox: "*" });
  assert.deepEqual(pkg.pi, { skills: ["./skills"] });
  assert.deepEqual(warnings, []);
});

test("没有 pi 字段是 undefined，空对象是 {}：前者走约定目录，后者什么也不加载", () => {
  assert.equal(parsePackageJson('{"name":"p"}').pkg.pi, undefined);
  assert.deepEqual(parsePackageJson('{"name":"p","pi":{}}').pkg.pi, {});
});

test("清单字段不是字符串数组：丢掉并警告，与 pi 的静默丢弃对应", () => {
  const { pkg, warnings } = parsePackageJson(JSON.stringify({ name: "p", pi: { extensions: "./ext", skills: [1] } }));
  assert.deepEqual(pkg.pi, {});
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /pi\.extensions/);
});

test("pi 字段不是对象：当作没有清单", () => {
  const { pkg, warnings } = parsePackageJson('{"name":"p","pi":["./ext"]}');
  assert.equal(pkg.pi, undefined);
  assert.equal(warnings.length, 1);
});

test("scripts 里的非字符串值被丢掉", () => {
  const { pkg, warnings } = parsePackageJson('{"name":"p","scripts":{"postinstall":"x","bad":3}}');
  assert.deepEqual(pkg.scripts, { postinstall: "x" });
  assert.equal(warnings.length, 1);
});

test("bundledDependencies: true 表示全部依赖；bundleDependencies 拼写也认", () => {
  assert.deepEqual(parsePackageJson('{"name":"p","dependencies":{"a":"1","b":"2"},"bundledDependencies":true}').pkg.bundledDependencies, ["a", "b"]);
  assert.deepEqual(parsePackageJson('{"name":"p","bundleDependencies":["a"]}').pkg.bundledDependencies, ["a"]);
});

test("BOM 开头也能读", () => {
  assert.equal(parsePackageJson('﻿{"name":"p"}').pkg.name, "p");
});

test("坏 JSON、非对象、缺 name：拒绝", () => {
  assert.throws(() => parsePackageJson("{"), PackageJsonError);
  assert.throws(() => parsePackageJson("[]"), PackageJsonError);
  assert.throws(() => parsePackageJson('{"name":"  "}'), PackageJsonError);
});
