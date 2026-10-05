import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistory, indicatorKey } from "../scripts/build-indicator-history.mjs";

const ind = (o) => ({ axis: "market_signals", label: "x", unit: "", source: "FRED", series_id: "S", ...o });

test("indicatorKey: indicator_id 우선, 없으면 axis:label", () => {
  assert.equal(indicatorKey(ind({ indicator_id: "kospi" })), "kospi");
  assert.equal(indicatorKey(ind({ label: "WTI" })), "market_signals:WTI");
});

test("같은 관측일은 늦은 스냅샷 값, 날짜순 정렬, 비수치 제외", () => {
  const h = buildHistory([
    { indicators: [ind({ indicator_id: "a", value: 1, value_date: "2026-10-02" })] },
    { indicators: [ind({ indicator_id: "a", value: 2, value_date: "2026-10-02" }), ind({ indicator_id: "a", value: 0, date: "2026-10-01" })] },
    { indicators: [ind({ indicator_id: "a", value: null, value_date: "2026-10-03" })] },
  ]);
  assert.deepEqual(h.a.points, [["2026-10-01", 0], ["2026-10-02", 2]]);
  assert.equal(h.a.breaks, undefined);
});

test("소스 교체 지점은 breaks로 남긴다", () => {
  const h = buildHistory([
    { indicators: [ind({ indicator_id: "usdkrw", value: 1400, value_date: "2026-10-01" })] },
    { indicators: [ind({ indicator_id: "usdkrw", value: 1350, value_date: "2026-10-05", source: "Yahoo Finance", series_id: "KRW=X" })] },
  ]);
  assert.deepEqual(h.usdkrw.breaks, [{ date: "2026-10-05", source: "Yahoo Finance/KRW=X" }]);
  assert.equal(h.usdkrw.source, "Yahoo Finance");
});

test("id 도입 전 레코드는 별칭으로 이어붙이되 겹치는 관측일은 id 레코드 우선", () => {
  const legacy = (value, d) => ind({ label: "원/달러 환율", value, value_date: d });
  const h = buildHistory([
    { indicators: [legacy(1460, "2026-07-24")] },
    { indicators: [legacy(9999, "2026-08-14"), ind({ indicator_id: "usdkrw", label: "원/달러 환율", value: 1414, value_date: "2026-08-14" })] },
    { indicators: [legacy(8888, "2026-08-14")] },
  ]);
  assert.deepEqual(h.usdkrw.points, [["2026-07-24", 1460], ["2026-08-14", 1414]]);
  assert.equal(h["market_signals:원/달러 환율"], undefined);
});

test("시드 구간은 시드 값만, 그 이후는 스냅샷 — 시드 경계에서 소스 전환 표시", () => {
  const snaps = [
    { indicators: [ind({ indicator_id: "usdkrw", value: 1400, value_date: "2026-09-25" })] },
    { indicators: [ind({ indicator_id: "usdkrw", value: 1350, value_date: "2026-10-06" })] },
  ];
  const seed = { usdkrw: { source: "Yahoo Finance", series_id: "KRW=X", points: [["2026-09-01", 1390], ["2026-10-05", 1344]] } };
  const h = buildHistory(snaps, seed);
  assert.deepEqual(h.usdkrw.points, [["2026-09-01", 1390], ["2026-10-05", 1344], ["2026-10-06", 1350]]);
  assert.deepEqual(h.usdkrw.breaks, [{ date: "2026-10-06", source: "FRED/S" }]);
  assert.equal(h.usdkrw.seeded_until, "2026-10-05");
  assert.equal(buildHistory(snaps, { nometa: seed.usdkrw }).nometa, undefined);
});

test("계산 공식(formula)이 바뀐 날짜는 kind=formula 구분점", () => {
  const r = (value, value_date, formula) => ind({ indicator_id: "retention_rate", source: "computed", series_id: "RETENTION_RATE", value, value_date, ...(formula ? { formula } : {}) });
  const h = buildHistory([
    { indicators: [r(68, "2026-10-02")] },
    { indicators: [r(86.5, "2026-10-05", "kospi_div_usdkrw")] },
    { indicators: [r(86.7, "2026-10-06", "kospi_div_usdkrw")] },
  ]);
  assert.deepEqual(h.retention_rate.breaks, [{ date: "2026-10-05", source: "computed/RETENTION_RATE", kind: "formula", formula: "kospi_div_usdkrw" }]);
});
