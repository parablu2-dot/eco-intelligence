import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarFor, isBusinessDay, businessLagDays, holidayTableCovers } from "../src/lib/business-days.mjs";

test("calendarFor: 소스·티커로 달력 선택", () => {
  assert.equal(calendarFor({ source: "ECOS", series_id: "817Y002/D/010200000" }), "KR_BOND");
  assert.equal(calendarFor({ source: "FRED", series_id: "DGS10" }), "US_GOV");
  assert.equal(calendarFor({ source: "FRED", series_id: "SP500" }), "NYSE");
  assert.equal(calendarFor({ source: "FRED", series_id: "DEXKOUS" }), "US_GOV");
  assert.equal(calendarFor({ source: "EIA", series_id: "PET.RWTC.D" }), "US_GOV");
  assert.equal(calendarFor({ source: "Yahoo Finance", series_id: "KRW=X" }), "FX");
  assert.equal(calendarFor({ source: "Yahoo Finance", series_id: "^KS11" }), "KRX");
  assert.equal(calendarFor({ source: "Yahoo Finance", series_id: "005930.KS" }), "KRX");
  assert.equal(calendarFor({ source: "Yahoo Finance", series_id: "MU" }), "NYSE");
  assert.equal(calendarFor({ source: "Yahoo Finance", series_id: "285A.T" }), "WEEKDAY");
  assert.equal(calendarFor({ source: "Yahoo Finance", series_id: "688825.SS" }), "WEEKDAY");
});

test("isBusinessDay: 한미 휴장일·주말", () => {
  assert.equal(isBusinessDay("2026-10-05", ["KRX"]), false); // 개천절 대체공휴일
  assert.equal(isBusinessDay("2026-10-05", ["US_GOV"]), true);
  assert.equal(isBusinessDay("2026-10-12", ["US_GOV"]), false); // Columbus Day — 채권 휴장
  assert.equal(isBusinessDay("2026-10-12", ["NYSE"]), true); // 증시는 개장
  assert.equal(isBusinessDay("2026-04-03", ["NYSE"]), false); // Good Friday
  assert.equal(isBusinessDay("2026-04-03", ["US_GOV"]), true);
  assert.equal(isBusinessDay("2026-12-31", ["KRX"]), false);
  assert.equal(isBusinessDay("2026-12-31", ["KR_BOND"]), true);
  assert.equal(isBusinessDay("2026-09-28", ["KRX"]), true); // 9/26 토 추석은 대체 대상 아님
  assert.equal(isBusinessDay("2026-10-03", ["WEEKDAY"]), false); // 토
  assert.equal(isBusinessDay("2026-10-05", ["KR_BOND", "US_GOV"]), false); // 합친 달력은 한쪽만 쉬어도 휴일
});

test("businessLagDays: value_date와 수집일 사이 빠진 영업일 수", () => {
  assert.equal(businessLagDays("2026-10-02", "2026-10-06", ["KRX"]), 0); // 금 값, 월 대체공휴일 → 화 아침 정상
  assert.equal(businessLagDays("2026-10-02", "2026-10-06", ["NYSE"]), 1); // 미 증시는 월요일 값이 빠짐
  assert.equal(businessLagDays("2026-10-05", "2026-10-06", ["FX"]), 0);
  assert.equal(businessLagDays("2026-10-01", "2026-10-05", ["US_GOV"]), 1); // FRED 익영업일 공표 — 정상 1
  assert.equal(businessLagDays("2026-09-23", "2026-09-28", ["KRX"]), 0); // 추석 연휴(9/24~25)+주말
  assert.equal(businessLagDays("2026-10-06", "2026-10-06", ["KRX"]), 0);
  assert.equal(businessLagDays(null, "2026-10-06", ["KRX"]), null);
});

test("holidayTableCovers: 휴일표 연도 범위", () => {
  assert.equal(holidayTableCovers("2026-10-05"), true);
  assert.equal(holidayTableCovers("2028-01-03"), false);
});
