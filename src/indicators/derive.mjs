// derive.mjs
// 지표 레코드 메타(lag_days)와 파생지표(스프레드·잔존율) 계산 — 순수 함수라 fs/네트워크 없이 테스트한다.
// (T1/T2, 2026-10-05)
//
// 두 시계열을 섞는 계산은 반드시 같은 value_date의 값끼리만 한다. 한·미 휴장일, KOSPI(KST)와
// FX(London) 달력 차이로 최신값 날짜가 어긋나면 history에서 가장 최근 공통 날짜를 찾아 쓰고
// basis_date로 남긴다.

// value_date(YYYY-MM-DD)와 오늘(KST, YYYY-MM-DD) 사이 달력일 수
export function lagDays(valueDate, todayIso) {
  if (!valueDate || !todayIso) return null;
  return Math.round((Date.parse(todayIso) - Date.parse(valueDate.slice(0, 10))) / 86400000);
}

// 두 레코드에서 같은 날짜의 값 쌍. 최신값 날짜가 같으면 그대로, 아니면 history의 최근 공통 날짜.
export function latestCommon(a, b) {
  if (a.value_date === b.value_date) return { date: a.value_date, a: a.value, b: b.value };
  const bMap = new Map((b.history ?? []).map((h) => [h.date, h.value]));
  const common = (a.history ?? []).filter((h) => bMap.has(h.date)).at(-1);
  return common ? { date: common.date, a: common.value, b: bMap.get(common.date) } : null;
}

// a − b 스프레드(%p). 공통 날짜가 없으면 null(fail-soft).
export function computeSpread(spec, a, b) {
  if (!a || !b) return null;
  const pair = latestCommon(a, b);
  if (!pair) return null;
  const diffHistory = spreadHistory(a, b);
  return {
    axis: spec.axis,
    ...(spec.group ? { group: spec.group } : {}),
    label: spec.label,
    unit: "%p",
    source: "computed",
    series_id: spec.seriesId,
    source_url: null,
    value: round(pair.a - pair.b, 4),
    value_date: pair.date,
    ...(pair.date !== a.value_date || pair.date !== b.value_date ? { basis_date: pair.date } : {}),
    frequency: "D",
    indicator_id: spec.id,
    derived_from: [a.indicator_id ?? a.series_id, b.indicator_id ?? b.series_id],
    history: diffHistory,
  };
}

function spreadHistory(a, b) {
  const bMap = new Map((b.history ?? []).map((h) => [h.date, h.value]));
  return (a.history ?? [])
    .filter((h) => bMap.has(h.date))
    .map((h) => ({ date: h.date, value: round(h.value - bMap.get(h.date), 4) }));
}

// 같은 소스 history에서 value_date 기준 days일 전(그 이하 중 최근) 값. 없으면 null.
// 스냅샷끼리 비교하면 소스 교체(FRED→Yahoo)나 소스별 발표 지연이 섞여 가짜 변동이 생긴다(T2).
export function valueDaysBefore(rec, days) {
  if (!rec?.value_date || !rec.history?.length) return null;
  const t = new Date(Date.parse(rec.value_date) - days * 86400000).toISOString().slice(0, 10);
  return rec.history.filter((h) => h.date <= t).at(-1) ?? null;
}

// 잔존율 = (KOSPI ÷ USD/KRW) ÷ 달러기준 피크 × 100 — 같은 날짜 값끼리만.
// 2026-10-05 D9(천 승인)로 기존 KOSPI × USD/KRW 공식을 폐기했다. 곱하기는 원화 약세가 값을 끌어올려
// "주가 하락 + 원화 약세" 동반 국면을 상쇄해 버리므로, 달러 환산 KOSPI(외국인 시각)로 바꿨다.
// formula 필드로 공식을 기록한다 — 이력 차트 구분선과 경보 룰 매칭(alerts.mjs)이 이 값을 본다.
export const RETENTION_FORMULA = "kospi_div_usdkrw";

// peak: { date, value } — value는 피크일의 KOSPI ÷ USD/KRW
export function computeRetention(kospi, usdkrw, peak) {
  if (!kospi || !usdkrw) return null;
  const pair = latestCommon(kospi, usdkrw);
  if (!pair) return null;
  return {
    axis: "market_signals",
    label: "잔존율 (KOSPI÷USD/KRW, 달러기준 피크 대비)",
    unit: "%",
    source: "computed",
    series_id: "RETENTION_RATE",
    source_url: null,
    value: retention(pair.a, pair.b, peak),
    value_date: pair.date,
    ...(pair.date !== kospi.value_date || pair.date !== usdkrw.value_date ? { basis_date: pair.date } : {}),
    frequency: "D",
    indicator_id: "retention_rate",
    formula: RETENTION_FORMULA,
    peak_date: peak.date,
    history: retentionHistory(kospi, usdkrw, peak),
  };
}

function retention(kospi, usdkrw, peak) {
  return (kospi / usdkrw / peak.value) * 100;
}

function retentionHistory(kospi, usdkrw, peak) {
  const fx = new Map((usdkrw.history ?? []).map((h) => [h.date, h.value]));
  return (kospi.history ?? [])
    .filter((h) => fx.has(h.date))
    .map((h) => ({ date: h.date, value: retention(h.value, fx.get(h.date), peak) }));
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
