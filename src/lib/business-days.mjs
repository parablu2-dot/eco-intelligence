// business-days.mjs
// 지표별 영업일 달력과 영업일 기준 lag 계산 (추가지시②, 2026-10-05).
//
// 휴일표는 평일 휴장일만 담는다(주말은 계산에서 따로 뺀다). 생성: python `holidays` 0.105
// (financial_holidays XKRX/XNYS, US federal), 검증: history-seed.json(2025-10~2026-10)의 평일 결측일과 대조 —
//   - FRED 미국채(DGS*) 결측 = US_GOV 그대로(Columbus·Veterans Day 휴장, Good Friday 2026-04-03은 값 있음)
//   - ECOS 국고채 결측 = KRX에서 12/31(증시 연말휴장, 채권시장은 개장)만 뺀 것. 2026-07-17 제헌절 휴장,
//     2026-09-28은 대체휴일 아님(9/26 토요일은 대체 대상 아님)
//   - Yahoo 환율 결측 = 12/25·1/1뿐
// 2027년은 연초 KRX·NYSE 공지로 재확인할 것. 표에 없는 연도는 평일만 영업일로 보고 경고한다.

const KRX = [
  "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-03-03", "2025-05-01", "2025-05-05", "2025-05-06", "2025-06-03", "2025-06-06", "2025-08-15", "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25", "2025-12-31",
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-07-17", "2026-08-17", "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-03", "2027-05-05", "2027-05-13", "2027-07-19", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-11", "2027-12-27", "2027-12-31",
];

const US_GOV = [
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-10-13", "2025-11-11", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24", "2027-12-31",
];

const NYSE = [
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
];

export const HOLIDAY_YEARS = [2025, 2026, 2027];

// 달력 이름 → 평일 휴장일 집합
//   KRX     한국 증시(KOSPI·국내 종목)
//   KR_BOND 한국 채권·ECOS(KRX에서 12/31 제외)
//   US_GOV  미 연방 휴일 — FRED 금리(H.15)·EIA·TreasuryDirect
//   NYSE    미 증시(미국 종목·S&P500)
//   FX      글로벌 외환(Yahoo) — 12/25·1/1만 휴장
//   WEEKDAY 휴일표 없음(일본·중국·대만 종목 등 한미 외 시장) — 평일 전부 영업일
const CALENDARS = {
  KRX: new Set(KRX),
  KR_BOND: new Set(KRX.filter((d) => !d.endsWith("-12-31"))),
  US_GOV: new Set(US_GOV),
  NYSE: new Set(NYSE),
  FX: new Set(HOLIDAY_YEARS.flatMap((y) => [`${y}-01-01`, `${y}-12-25`])),
  WEEKDAY: new Set(),
};

// 지표 레코드(source·series_id)로 달력을 고른다. 파생지표는 재료 달력을 합쳐 쓴다(calendarsFor 참고).
export function calendarFor(rec) {
  const sid = String(rec.series_id ?? "");
  if (rec.source === "ECOS") return "KR_BOND";
  if (rec.source === "FRED") return sid === "SP500" ? "NYSE" : "US_GOV";
  if (rec.source === "EIA" || rec.source === "TreasuryDirect") return "US_GOV";
  if (sid.endsWith("=X")) return "FX";
  if (/^\^KS|\.K[SQ]$/.test(sid)) return "KRX";
  if (/\.[A-Z]{1,2}$/.test(sid)) return "WEEKDAY";
  if (rec.source === "Yahoo Finance") return "NYSE";
  return "WEEKDAY";
}

// names: 달력 이름 배열 — 하나라도 휴장이면 휴일(파생지표는 재료가 모두 있는 날만 값이 생기므로).
export function isBusinessDay(iso, names) {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !names.some((n) => CALENDARS[n]?.has(iso));
}

// value_date 다음 날부터 오늘(KST) 전날까지의 영업일 수 = 그 사이 빠진 거래일 수.
// 예) 화요일 아침 수집에 월요일 값 → 0, 2026-10-06(화) 아침 KOSPI 10/02(금) 값 → 0(10/05 대체공휴일).
export function businessLagDays(valueDate, todayIso, names) {
  if (!valueDate || !todayIso) return null;
  const end = Date.parse(todayIso);
  let n = 0;
  for (let t = Date.parse(valueDate.slice(0, 10)) + 86400000; t < end; t += 86400000) {
    if (isBusinessDay(new Date(t).toISOString().slice(0, 10), names)) n++;
  }
  return n;
}

export function holidayTableCovers(iso) {
  return HOLIDAY_YEARS.includes(Number(iso.slice(0, 4)));
}
