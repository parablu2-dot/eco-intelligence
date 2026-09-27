import { test } from "node:test";
import assert from "node:assert/strict";
import { nowKst, compactDate, todayCompactKst } from "../src/lib/dates.mjs";

function withNow(iso, fn) {
  const real = Date.now;
  Date.now = () => new Date(iso).getTime();
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

test("UTC 자정 전후로 흩어진 아침 배치가 같은 KST 날짜를 받는다", () => {
  // 2026-09-27 KST 아침 배치: 실제 실행은 9/26 23:24 UTC ~ 9/27 00:56 UTC
  assert.equal(withNow("2026-09-26T23:24:30Z", todayCompactKst), "20260927");
  assert.equal(withNow("2026-09-27T00:56:16Z", todayCompactKst), "20260927");
});

test("KST 자정 경계", () => {
  assert.equal(withNow("2026-09-27T14:59:59Z", todayCompactKst), "20260927");
  assert.equal(withNow("2026-09-27T15:00:00Z", todayCompactKst), "20260928");
});

test("nowKst 달력 산술은 KST 기준", () => {
  const d = withNow("2026-09-30T20:00:00Z", nowKst); // KST 10/1 05:00
  d.setUTCDate(d.getUTCDate() - 1);
  assert.equal(compactDate(d), "20260930");
});
