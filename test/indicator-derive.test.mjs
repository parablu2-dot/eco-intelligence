import { test } from "node:test";
import assert from "node:assert/strict";
import { lagDays, latestCommon, computeSpread, computeRetention } from "../src/indicators/derive.mjs";
import { localDate } from "../src/lib/yahoo.mjs";

const rec = (id, value_date, history) => ({ indicator_id: id, value_date, value: history.at(-1).value, history });

test("lagDays: value_date와 오늘(KST) 사이 달력일", () => {
  assert.equal(lagDays("2026-09-25", "2026-10-05"), 10);
  assert.equal(lagDays("2026-10-05", "2026-10-05"), 0);
  assert.equal(lagDays(null, "2026-10-05"), null);
});

test("Yahoo 일봉 날짜는 거래소 gmtoffset 기준 — FX London 23:00 UTC 봉은 다음 날", () => {
  const ts = Date.UTC(2026, 9, 1, 23, 0) / 1000; // 2026-10-01T23:00Z
  assert.equal(localDate(ts, 0), "2026-10-01");
  assert.equal(localDate(ts, 3600), "2026-10-02");
  assert.equal(localDate(Date.UTC(2026, 9, 1, 20, 0) / 1000, 32400), "2026-10-02"); // KST
});

test("latestCommon: 최신값 날짜가 같으면 그대로", () => {
  const a = rec("a", "2026-10-02", [{ date: "2026-10-02", value: 3 }]);
  const b = rec("b", "2026-10-02", [{ date: "2026-10-02", value: 1 }]);
  assert.deepEqual(latestCommon(a, b), { date: "2026-10-02", a: 3, b: 1 });
});

test("latestCommon: 한쪽 휴장이면 history의 최근 공통 날짜", () => {
  const kospi = rec("kospi", "2026-10-02", [
    { date: "2026-10-01", value: 3000 },
    { date: "2026-10-02", value: 3100 },
  ]);
  const fx = rec("usdkrw", "2026-10-05", [
    { date: "2026-10-01", value: 1350 },
    { date: "2026-10-02", value: 1360 },
    { date: "2026-10-05", value: 1343 },
  ]);
  assert.deepEqual(latestCommon(kospi, fx), { date: "2026-10-02", a: 3100, b: 1360 });
});

test("computeSpread: a−b, 날짜 어긋나면 basis_date, 공통 날짜 없으면 null", () => {
  const spec = { id: "kr_us_10y_spread", label: "x", axis: "rates_fx", group: "bond", seriesId: "X" };
  const kr = rec("kr10y", "2026-10-02", [{ date: "2026-10-01", value: 4.4 }, { date: "2026-10-02", value: 4.45 }]);
  const us = rec("us10y", "2026-10-03", [{ date: "2026-10-02", value: 4.1 }, { date: "2026-10-03", value: 4.2 }]);
  const s = computeSpread(spec, kr, us);
  assert.equal(s.value, 0.35);
  assert.equal(s.value_date, "2026-10-02");
  assert.equal(s.basis_date, "2026-10-02");
  assert.equal(s.indicator_id, "kr_us_10y_spread");

  const far = rec("us10y", "2026-09-01", [{ date: "2026-09-01", value: 4 }]);
  assert.equal(computeSpread(spec, kr, far), null);
  assert.equal(computeSpread(spec, kr, undefined), null);
});

test("computeRetention: 같은 날짜 값끼리, 날짜 같으면 basis_date 없음", () => {
  const kospi = rec("kospi", "2026-10-02", [{ date: "2026-10-02", value: 100 }]);
  const fx = rec("usdkrw", "2026-10-02", [{ date: "2026-10-02", value: 10 }]);
  const r = computeRetention(kospi, fx, 2000);
  assert.equal(r.value, 50);
  assert.equal(r.value_date, "2026-10-02");
  assert.equal(r.basis_date, undefined);
});
