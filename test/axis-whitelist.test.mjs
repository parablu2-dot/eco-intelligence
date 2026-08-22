// axis-whitelist.test.mjs
// 2026-08-01 market_signals(8번째 축) 추가 시 build-index.mjs의 로컬 AXES 배열 갱신을 깜빡해
// index.json/대시보드에서 축 전체가 누락된 적 있음(자관_ECO애널리스트_ClaudeCode스펙 §5).
// 재발 방지: (1) 공유 화이트리스트(src/lib/notes.mjs)에 모든 축이 등록돼 있는지,
// (2) build-index.mjs/score-notes.mjs가 로컬 배열을 재도입하지 않고 그 공유 배열을 계속
// import해서 쓰는지를 정적으로 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { AXES } from "../src/lib/notes.mjs";

const REQUIRED_AXES = [
  "geopolitics",
  "polarization",
  "fed_policy",
  "productivity_ai",
  "us_investment",
  "rates_fx",
  "commodities_energy",
  "market_signals",
];

test("notes.mjs의 공유 AXES에 8축이 모두 등록되어 있다", () => {
  for (const axis of REQUIRED_AXES) {
    assert.ok(AXES.includes(axis), `AXES 누락: ${axis}`);
  }
});

async function assertImportsSharedAxes(filePath) {
  const src = await fs.readFile(new URL(filePath, import.meta.url), "utf-8");
  assert.match(src, /from\s+["'][^"']*notes\.mjs["']/, `${filePath}: notes.mjs에서 AXES를 import해야 함`);
  assert.doesNotMatch(
    src,
    /const\s+AXES\s*=\s*\[/,
    `${filePath}: AXES를 로컬에 재선언하지 말 것 — notes.mjs의 공유 배열을 사용`
  );
}

test("build-index.mjs가 로컬 재선언 없이 공유 AXES를 import한다", async () => {
  await assertImportsSharedAxes("../scripts/build-index.mjs");
});

test("score-notes.mjs가 로컬 재선언 없이 공유 AXES를 import한다", async () => {
  await assertImportsSharedAxes("../src/triage/score-notes.mjs");
});
