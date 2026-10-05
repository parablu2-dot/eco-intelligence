// crawl-indicators.mjs
// 7축 각각의 핵심 실수치 지표를 공개 API(FRED/EIA/Yahoo/ECOS/TreasuryDirect)에서 가져와 data/indicators/에 저장.
// LLM을 거치지 않는 순수 수치 데이터 — distillation 파이프라인과 별개로 동작.
// 소스 하나가 실패해도 나머지는 계속 수집 (fail-soft, 기존 crawler들과 동일 원칙).

import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { fetchFredLatest } from "../lib/fred.mjs";
import { fetchEiaLatest } from "../lib/eia.mjs";
import { fetchYahooLatest } from "../lib/yahoo.mjs";
import { fetchEcosLatest } from "../lib/ecos.mjs";
import { fetchFxLatest } from "../lib/fx.mjs";
import { fetchTreasuryAuctions } from "../lib/treasury.mjs";
import { findValueDaysAgo } from "./history.mjs";
import { computeSpread, computeRetention, lagDays, valueDaysBefore } from "./derive.mjs";
import { nowKst, todayCompactKst } from "../lib/dates.mjs";
import { calendarFor, businessLagDays, holidayTableCovers } from "../lib/business-days.mjs";

// SIPOVGINIUSA(지니계수)는 확인 신뢰도가 낮은 series id — 첫 실행 로그에서 에러가 나면
// https://fred.stlouisfed.org/tags/series?t=gini 에서 정확한 id로 교체할 것.
//
// `id` 필드(→ 결과의 indicator_id): 경보 룰(ECO_THRESHOLDS_JSON secret) 키 매칭, week_change_pct
// 계산(history.mjs), 잔존율 계산에 쓰이는 안정적 식별자. 기존 지표들은 필수 아님 — 알림/추이 추적
// 대상만 부여한다 (거시분석_인과사슬지도_20260822.md §2 스키마 확장).
//
// `frequency`(D/W/M/Q/A): 발표 주기 — 미지정이면 D. lag_days(value_date~수집일 사이 빠진 영업일) 해석 기준.
// `group: "bond"`: 채권 데이터층(T1, 2026-10-05). 신규 채권 지표는 axis "rates_fx"라 market_signals의
// 10% 이상치 LLM 탐지 대상에서 자연 제외된다. 기존 market_signals 채권 지표는 id·axis 유지 + 태그만.
export const INDICATORS = [
  {
    axis: "geopolitics",
    label: "미국 경제정책 불확실성지수(EPU)",
    unit: "index",
    source: "FRED",
    seriesId: "USEPUINDXD",
    sourceUrl: "https://fred.stlouisfed.org/series/USEPUINDXD",
    fetcher: fetchFredLatest,
  },
  {
    axis: "polarization",
    label: "미국 지니계수(소득불평등)",
    unit: "index",
    source: "FRED",
    seriesId: "SIPOVGINIUSA",
    sourceUrl: "https://fred.stlouisfed.org/series/SIPOVGINIUSA",
    fetcher: fetchFredLatest,
    frequency: "A",
  },
  {
    axis: "fed_policy",
    label: "연방기금 실효금리",
    unit: "%",
    source: "FRED",
    seriesId: "DFF",
    sourceUrl: "https://fred.stlouisfed.org/series/DFF",
    fetcher: fetchFredLatest,
  },
  {
    axis: "productivity_ai",
    label: "비농업부문 노동생산성지수",
    unit: "index",
    source: "FRED",
    seriesId: "OPHNFB",
    sourceUrl: "https://fred.stlouisfed.org/series/OPHNFB",
    fetcher: fetchFredLatest,
    frequency: "Q",
  },
  {
    axis: "us_investment",
    label: "S&P 500 지수",
    unit: "index",
    source: "FRED",
    seriesId: "SP500",
    sourceUrl: "https://fred.stlouisfed.org/series/SP500",
    fetcher: fetchFredLatest,
  },
  // rates_fx의 미 10년물(DGS10)은 market_signals us10y와 중복이라 제거(T1). 환율은 Yahoo 우선 + FRED fallback(T2).
  { axis: "rates_fx", label: "원/달러 환율", unit: "KRW", seriesId: "usdkrw", fetcher: fetchFxLatest },
  // 채권 데이터층(T1, 2026-10-05) — ECOS는 ECOS_API_KEY 미설정 시 스킵(해당 파생지표도 함께 스킵)
  { axis: "rates_fx", group: "bond", label: "미국 2년물 국채금리", unit: "%", source: "FRED", seriesId: "DGS2", sourceUrl: "https://fred.stlouisfed.org/series/DGS2", fetcher: fetchFredLatest, id: "us2y" },
  { axis: "rates_fx", group: "bond", label: "미국 10년 TIPS 실질금리", unit: "%", source: "FRED", seriesId: "DFII10", sourceUrl: "https://fred.stlouisfed.org/series/DFII10", fetcher: fetchFredLatest, id: "us10y_tips_real" },
  { axis: "rates_fx", group: "bond", label: "미 투자등급 회사채 스프레드(OAS)", unit: "%p", source: "FRED", seriesId: "BAMLC0A0CM", sourceUrl: "https://fred.stlouisfed.org/series/BAMLC0A0CM", fetcher: fetchFredLatest, id: "us_ig_oas" },
  { axis: "rates_fx", group: "bond", label: "미 하이일드 회사채 스프레드(OAS)", unit: "%p", source: "FRED", seriesId: "BAMLH0A0HYM2", sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", fetcher: fetchFredLatest, id: "us_hy_oas" },
  { axis: "rates_fx", group: "bond", label: "미 연방기금 목표금리 상단", unit: "%", source: "FRED", seriesId: "DFEDTARU", sourceUrl: "https://fred.stlouisfed.org/series/DFEDTARU", fetcher: fetchFredLatest, id: "fed_target_upper" },
  { axis: "rates_fx", group: "bond", label: "한국 기준금리", unit: "%", source: "ECOS", seriesId: "722Y001/D/0101000", sourceUrl: "https://ecos.bok.or.kr/", fetcher: fetchEcosLatest, id: "kr_base_rate" },
  { axis: "rates_fx", group: "bond", label: "국고채 3년물", unit: "%", source: "ECOS", seriesId: "817Y002/D/010200000", sourceUrl: "https://ecos.bok.or.kr/", fetcher: fetchEcosLatest, id: "kr3y" },
  { axis: "rates_fx", group: "bond", label: "국고채 10년물", unit: "%", source: "ECOS", seriesId: "817Y002/D/010210000", sourceUrl: "https://ecos.bok.or.kr/", fetcher: fetchEcosLatest, id: "kr10y" },
  { axis: "rates_fx", group: "bond", label: "회사채 AA- 3년물", unit: "%", source: "ECOS", seriesId: "817Y002/D/010300000", sourceUrl: "https://ecos.bok.or.kr/", fetcher: fetchEcosLatest, id: "kr_corp_aa3y" },
  {
    axis: "commodities_energy",
    label: "WTI 원유 현물가",
    unit: "$/bbl",
    source: "EIA",
    seriesId: "PET.RWTC.D",
    sourceUrl: "https://www.eia.gov/dnav/pet/hist/RWTCD.htm",
    fetcher: fetchEiaLatest,
  },
  {
    axis: "commodities_energy",
    label: "헨리허브 천연가스 현물가",
    unit: "$/MMBtu",
    source: "EIA",
    seriesId: "NG.RNGWHHD.D",
    sourceUrl: "https://www.eia.gov/dnav/ng/hist/rngwhhdD.htm",
    fetcher: fetchEiaLatest,
  },
  // market_signals — 주가(반도체/AI 서비스) + 환율 + 채권. 2026-08 8번째 축으로 추가.
  // 메모리
  { axis: "market_signals", label: "SK하이닉스", unit: "KRW", source: "Yahoo Finance", seriesId: "000660.KS", sourceUrl: "https://finance.yahoo.com/quote/000660.KS", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "삼성전자", unit: "KRW", source: "Yahoo Finance", seriesId: "005930.KS", sourceUrl: "https://finance.yahoo.com/quote/005930.KS", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "Micron", unit: "USD", source: "Yahoo Finance", seriesId: "MU", sourceUrl: "https://finance.yahoo.com/quote/MU", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "Kioxia", unit: "JPY", source: "Yahoo Finance", seriesId: "285A.T", sourceUrl: "https://finance.yahoo.com/quote/285A.T", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "CXMT", unit: "CNY", source: "Yahoo Finance", seriesId: "688825.SS", sourceUrl: "https://finance.yahoo.com/quote/688825.SS", fetcher: fetchYahooLatest },
  // SoC
  { axis: "market_signals", label: "Broadcom", unit: "USD", source: "Yahoo Finance", seriesId: "AVGO", sourceUrl: "https://finance.yahoo.com/quote/AVGO", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "Marvell", unit: "USD", source: "Yahoo Finance", seriesId: "MRVL", sourceUrl: "https://finance.yahoo.com/quote/MRVL", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "MediaTek", unit: "TWD", source: "Yahoo Finance", seriesId: "2454.TW", sourceUrl: "https://finance.yahoo.com/quote/2454.TW", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "Qualcomm", unit: "USD", source: "Yahoo Finance", seriesId: "QCOM", sourceUrl: "https://finance.yahoo.com/quote/QCOM", fetcher: fetchYahooLatest },
  // AI 서비스
  { axis: "market_signals", label: "Alphabet", unit: "USD", source: "Yahoo Finance", seriesId: "GOOGL", sourceUrl: "https://finance.yahoo.com/quote/GOOGL", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "Microsoft", unit: "USD", source: "Yahoo Finance", seriesId: "MSFT", sourceUrl: "https://finance.yahoo.com/quote/MSFT", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "Amazon", unit: "USD", source: "Yahoo Finance", seriesId: "AMZN", sourceUrl: "https://finance.yahoo.com/quote/AMZN", fetcher: fetchYahooLatest },
  { axis: "market_signals", label: "Meta", unit: "USD", source: "Yahoo Finance", seriesId: "META", sourceUrl: "https://finance.yahoo.com/quote/META", fetcher: fetchYahooLatest },
  // 코스피(신규) — 잔존율 계산용. 인과사슬지도 5대 지표 ①③ (거시분석_인과사슬지도_20260822.md §1)
  { axis: "market_signals", label: "코스피", unit: "index", source: "Yahoo Finance", seriesId: "^KS11", sourceUrl: "https://finance.yahoo.com/quote/%5EKS11", fetcher: fetchYahooLatest, id: "kospi" },
  // 환율 3종은 Yahoo 우선 + FRED fallback(T2) — FRED DEX*는 ~10일 지연. seriesId 자리는 fx.mjs의 pair 키이고,
  // 레코드의 source/series_id는 실제로 값을 가져온 소스로 기록된다.
  { axis: "market_signals", label: "달러/유로 환율", unit: "USD", seriesId: "eurusd", fetcher: fetchFxLatest, id: "eurusd" },
  // 인과사슬지도 5대 지표 ⑤(신규) — 엔캐리 청산 대용 지표. 2026-08-22 5번째 주간 지표로 편입.
  { axis: "market_signals", label: "엔/달러 환율", unit: "JPY", seriesId: "usdjpy", fetcher: fetchFxLatest, id: "usdjpy" },
  // 인과사슬지도 5대 지표 ② — 원/달러 환율
  { axis: "market_signals", label: "원/달러 환율", unit: "KRW", seriesId: "usdkrw", fetcher: fetchFxLatest, id: "usdkrw" },
  // 채권 — 미 10년물(기술주 할인율 판단용, 2차 참고 지표. 저장만 — 트리아지 가중치 미부여)
  { axis: "market_signals", group: "bond", label: "미국 10년물 국채금리", unit: "%", source: "FRED", seriesId: "DGS10", sourceUrl: "https://fred.stlouisfed.org/series/DGS10", fetcher: fetchFredLatest, id: "us10y" },
  // 인과사슬지도 5대 지표 ④(신규) — 미 30년물 국채금리
  { axis: "market_signals", group: "bond", label: "미국 30년물 국채금리", unit: "%", source: "FRED", seriesId: "DGS30", sourceUrl: "https://fred.stlouisfed.org/series/DGS30", fetcher: fetchFredLatest, id: "us30y" },
  // 2차 참고 지표(신규, 저장만 — 트리아지 가중치 미부여)
  { axis: "market_signals", group: "bond", label: "2s10s 스프레드", unit: "%p", source: "FRED", seriesId: "T10Y2Y", sourceUrl: "https://fred.stlouisfed.org/series/T10Y2Y", fetcher: fetchFredLatest, id: "t10y2y" },
  { axis: "market_signals", group: "bond", label: "30년 TIPS 실질금리", unit: "%", source: "FRED", seriesId: "DFII30", sourceUrl: "https://fred.stlouisfed.org/series/DFII30", fetcher: fetchFredLatest, id: "us30y_tips_real" },
  { axis: "market_signals", group: "bond", label: "10년 breakeven 인플레이션", unit: "%", source: "FRED", seriesId: "T10YIE", sourceUrl: "https://fred.stlouisfed.org/series/T10YIE", fetcher: fetchFredLatest, id: "us10y_breakeven" },
  // 한국 10년물(FRED IRLTLT01KRM156N, OECD 월간)은 ECOS 일별 국고채 10년(kr10y)으로 대체·제거(T1).
];

// 파생 스프레드(a − b, %p) — 같은 value_date끼리만 계산(derive.mjs). 재료 중 하나라도 없으면 스킵.
// us_10y2y는 FRED T10Y2Y(t10y2y)와 사실상 중복이나 t10y2y는 Secret 경보 룰 키라 둘 다 유지.
export const SPREADS = [
  { id: "kr_us_10y_spread", label: "한미 10년물 금리차 (국고10−미10)", a: "kr10y", b: "us10y" },
  { id: "kr_us_policy_spread", label: "한미 기준금리차 (한국−미 상단)", a: "kr_base_rate", b: "fed_target_upper" },
  { id: "kr_10y3y", label: "국고채 장단기 금리차 (10−3)", a: "kr10y", b: "kr3y" },
  { id: "kr_credit_aa3y", label: "회사채 신용스프레드 (AA-3년−국고3년)", a: "kr_corp_aa3y", b: "kr3y" },
  { id: "us_10y2y", label: "미 장단기 금리차 (10−2)", a: "us10y", b: "us2y" },
].map((s) => ({ ...s, axis: "rates_fx", group: "bond", seriesId: s.id.toUpperCase() }));

// 잔존율(retention rate) 기준 피크 — KOSPI ÷ USD/KRW(달러기준) 시계열 최고점(D9, 2026-10-05 재탐색).
// Yahoo ^KS11·KRW=X 일봉 2003-12~2026-10 전 구간 최고점이 2026-06-22(구 공식 피크와 같은 날)였다.
// 값은 운영 수집 소스(Yahoo KRW=X 종가)로 계산 — 근거: docs/retention-formula-d9.md
const RETENTION_PEAK = { date: "2026-06-22", kospi: 9114.55, usdkrw: 1531.33, value: 9114.55 / 1531.33 };

const OUT_DIR = path.resolve("data/indicators");

// 레코드: value_date(값의 기준일)·fetched_at·lag_days·frequency 추가(T2). `date`는 하위호환용으로 value_date와 동일.
// lag_days는 영업일 기준(추가지시②) — lag_calendar(달력 이름)·lag_calendar_days(달력일)를 함께 남긴다.
// history는 파생 계산용으로만 들고 있다가 저장 직전 제거한다.
// 수집 실패/건너뜀 목록 — payload.failed로 남겨 health 점검이 "조용히 빠진 지표"를 잡는다(T4).
// 오류 메시지는 저장하지 않는다: ECOS 등은 요청 URL에 API 키가 들어가고 data/*는 공개 사이트로 서빙됨.
const failures = [];

async function fetchAll(fetchedAt) {
  const results = [];

  for (const ind of INDICATORS) {
    try {
      const r = await ind.fetcher(ind.seriesId);
      results.push({
        axis: ind.axis,
        ...(ind.group ? { group: ind.group } : {}),
        label: ind.label,
        unit: ind.unit,
        source: r.source ?? ind.source,
        series_id: r.series_id ?? ind.seriesId,
        source_url: r.source_url ?? ind.sourceUrl,
        value: r.value,
        value_date: r.date,
        fetched_at: fetchedAt,
        frequency: ind.frequency ?? "D",
        ...(ind.id ? { indicator_id: ind.id } : {}),
        history: r.history ?? [],
      });
    } catch (err) {
      const tag = /_API_KEY not set/.test(err.message) ? "skipped" : "failed";
      console.error(`[crawl-indicators] ${tag}: ${ind.source ?? "fx"} ${ind.seriesId} — ${err.message}`);
      failures.push({ id: ind.id ?? `${ind.axis}:${ind.label}`, label: ind.label, source: ind.source ?? "fx", status: tag });
    }
  }

  return results;
}

function computeSpreads(results, fetchedAt) {
  const byId = new Map(results.filter((r) => r.indicator_id).map((r) => [r.indicator_id, r]));
  const out = [];
  for (const spec of SPREADS) {
    const rec = computeSpread(spec, byId.get(spec.a), byId.get(spec.b));
    if (rec) out.push({ ...rec, fetched_at: fetchedAt });
    else {
      console.error(`[crawl-indicators] spread skipped: ${spec.id} (재료 ${spec.a}/${spec.b} 누락 또는 공통 날짜 없음)`);
      failures.push({ id: spec.id, label: spec.label ?? spec.id, source: "derived", status: "skipped" });
    }
  }
  return out;
}

// (KOSPI ÷ USD/KRW) ÷ 달러기준 6/22 피크 — D9(2026-10-05)로 기존 × 공식에서 변경.
// 두 값의 value_date가 다르면(한국 휴장일 등) history의 최근 공통 날짜 값으로 계산하고 basis_date를 남긴다(T2).
// kospi/usdkrw 둘 중 하나라도 수집 실패하거나 공통 날짜가 없으면 건너뛴다(fail-soft).
function computeRetentionRate(results, fetchedAt) {
  const kospi = results.find((r) => r.indicator_id === "kospi");
  const usdkrw = results.find((r) => r.indicator_id === "usdkrw");
  const rec = computeRetention(kospi, usdkrw, RETENTION_PEAK);
  if (!rec) {
    console.error("[crawl-indicators] retention_rate skipped: kospi/usdkrw 수집 실패 또는 공통 날짜 없음");
    failures.push({ id: "retention_rate", label: "잔존율", source: "derived", status: "skipped" });
    return null;
  }
  return { ...rec, fetched_at: fetchedAt };
}

// 전주(7일 전) 대비 변화율(%) — indicator_id가 있는 지표만 계산.
// 같은 소스 history의 value_date−7일 값을 우선 쓰고(T2), history가 짧으면 과거 스냅샷으로 fallback.
async function attachWeekChange(results) {
  for (const r of results) {
    if (!r.indicator_id) continue;
    const prev = valueDaysBefore(r, 7) ?? (await findValueDaysAgo(r.indicator_id, 7));
    if (prev && typeof prev.value === "number" && prev.value !== 0) {
      r.week_change_pct = ((r.value - prev.value) / Math.abs(prev.value)) * 100;
      r.week_change_basis_date = prev.date; // 비교한 과거 값의 날짜(추가지시③)
    }
  }
}

// 레코드별 영업일 달력. 파생지표는 재료 달력을 모두 합친다(어느 한쪽이라도 휴장이면 그날 값이 안 생김).
function lagCalendars(results) {
  const byId = new Map(results.filter((r) => r.indicator_id).map((r) => [r.indicator_id, r]));
  const out = new Map();
  for (const r of results) {
    const parts = r.derived_from ? r.derived_from.map((id) => byId.get(id)).filter(Boolean) : [r];
    out.set(r, [...new Set(parts.map(calendarFor))].sort());
  }
  return out;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const todayIso = nowKst().toISOString().slice(0, 10);
  const results = await fetchAll(fetchedAt);

  results.push(...computeSpreads(results, fetchedAt));
  const retentionRate = computeRetentionRate(results, fetchedAt);
  if (retentionRate) results.push(retentionRate);

  await attachWeekChange(results);

  if (!holidayTableCovers(todayIso)) {
    console.error(`[crawl-indicators] warning: ${todayIso.slice(0, 4)}년 휴일표 없음 — src/lib/business-days.mjs 갱신 필요(평일만 영업일로 계산)`);
  }
  const calendars = lagCalendars(results);
  for (const r of results) {
    const cal = calendars.get(r);
    r.date = r.value_date; // 하위호환
    r.lag_days = businessLagDays(r.value_date, todayIso, cal);
    r.lag_calendar = cal.join("+");
    r.lag_calendar_days = lagDays(r.value_date, todayIso);
    delete r.history;
  }

  let treasuryAuctions = null;
  try {
    treasuryAuctions = await fetchTreasuryAuctions();
  } catch (err) {
    console.error(`[crawl-indicators] failed: TreasuryDirect auctions — ${err.message}`);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const today = todayCompactKst();
  const payload = {
    generated_at: fetchedAt,
    expected_count: INDICATORS.length + SPREADS.length + 1,
    indicators: results,
    failed: failures,
    ...(treasuryAuctions ? { treasury_auctions: treasuryAuctions } : {}),
  };

  await fs.writeFile(path.join(OUT_DIR, `${today}.json`), JSON.stringify(payload, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(payload, null, 2));

  console.log(
    `[crawl-indicators] ${results.length}/${INDICATORS.length + SPREADS.length + 1} indicators (incl. ${SPREADS.length} spreads + retention_rate)`
  );
}

// backfill-indicator-history.mjs가 INDICATORS/SPREADS를 import하므로 직접 실행될 때만 수집한다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
