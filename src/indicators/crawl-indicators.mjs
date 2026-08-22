// crawl-indicators.mjs
// 7축 각각의 핵심 실수치 지표를 공개 API(FRED/EIA)에서 가져와 data/indicators/에 저장.
// LLM을 거치지 않는 순수 수치 데이터 — distillation 파이프라인과 별개로 동작.
// 소스 하나가 실패해도 나머지는 계속 수집 (fail-soft, 기존 crawler들과 동일 원칙).

import fs from "fs/promises";
import path from "path";
import { fetchFredLatest } from "../lib/fred.mjs";
import { fetchEiaLatest } from "../lib/eia.mjs";
import { fetchYahooLatest } from "../lib/yahoo.mjs";
import { findValueDaysAgo } from "./history.mjs";
import { applyAlerts } from "./alerts.mjs";

// SIPOVGINIUSA(지니계수)는 확인 신뢰도가 낮은 series id — 첫 실행 로그에서 에러가 나면
// https://fred.stlouisfed.org/tags/series?t=gini 에서 정확한 id로 교체할 것.
//
// `id` 필드(→ 결과의 indicator_id): config/indicator-thresholds.json의 룰 키 매칭, week_change_pct
// 계산(history.mjs), 잔존율 계산에 쓰이는 안정적 식별자. 기존 지표들은 필수 아님 — 알림/추이 추적
// 대상만 부여한다 (거시분석_인과사슬지도_20260822.md §2 스키마 확장).
const INDICATORS = [
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
  {
    axis: "rates_fx",
    label: "미국 10년물 국채금리",
    unit: "%",
    source: "FRED",
    seriesId: "DGS10",
    sourceUrl: "https://fred.stlouisfed.org/series/DGS10",
    fetcher: fetchFredLatest,
  },
  {
    axis: "rates_fx",
    label: "원/달러 환율",
    unit: "KRW",
    source: "FRED",
    seriesId: "DEXKOUS",
    sourceUrl: "https://fred.stlouisfed.org/series/DEXKOUS",
    fetcher: fetchFredLatest,
  },
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
  // 환율 (rates_fx 축과 별개로 market_signals 대시보드 섹션용 — DEXKOUS는 rates_fx와 중복 수집이나 라벨/섹션 분리 목적)
  { axis: "market_signals", label: "달러/유로 환율", unit: "USD", source: "FRED", seriesId: "DEXUSEU", sourceUrl: "https://fred.stlouisfed.org/series/DEXUSEU", fetcher: fetchFredLatest },
  // 인과사슬지도 5대 지표 ⑤(신규) — 엔캐리 청산 경보(주간 -3%↓) 대용 지표. 2026-08-22 5번째 주간 지표로 편입.
  { axis: "market_signals", label: "엔/달러 환율", unit: "JPY", source: "FRED", seriesId: "DEXJPUS", sourceUrl: "https://fred.stlouisfed.org/series/DEXJPUS", fetcher: fetchFredLatest, id: "usdjpy" },
  // 인과사슬지도 5대 지표 ② — 원/달러 환율(1,350원 하회 지속 3일 = "원화 강세 국면 전환 후보" 알림 대상)
  { axis: "market_signals", label: "원/달러 환율", unit: "KRW", source: "FRED", seriesId: "DEXKOUS", sourceUrl: "https://fred.stlouisfed.org/series/DEXKOUS", fetcher: fetchFredLatest, id: "usdkrw" },
  // 채권 — 미 10년물(기술주 할인율 판단용, 2차 참고 지표. 저장만 — 트리아지 가중치 미부여)
  { axis: "market_signals", label: "미국 10년물 국채금리", unit: "%", source: "FRED", seriesId: "DGS10", sourceUrl: "https://fred.stlouisfed.org/series/DGS10", fetcher: fetchFredLatest, id: "us10y" },
  // 인과사슬지도 5대 지표 ④(신규) — 미 30년물 국채금리(5.5% 상회 = "장기금리 경계" 알림 대상)
  { axis: "market_signals", label: "미국 30년물 국채금리", unit: "%", source: "FRED", seriesId: "DGS30", sourceUrl: "https://fred.stlouisfed.org/series/DGS30", fetcher: fetchFredLatest, id: "us30y" },
  // 2차 참고 지표(신규, 저장만 — 트리아지 가중치 미부여) — 자동 알림 트리거용
  { axis: "market_signals", label: "2s10s 스프레드", unit: "%p", source: "FRED", seriesId: "T10Y2Y", sourceUrl: "https://fred.stlouisfed.org/series/T10Y2Y", fetcher: fetchFredLatest, id: "t10y2y" },
  { axis: "market_signals", label: "30년 TIPS 실질금리", unit: "%", source: "FRED", seriesId: "DFII30", sourceUrl: "https://fred.stlouisfed.org/series/DFII30", fetcher: fetchFredLatest, id: "us30y_tips_real" },
  { axis: "market_signals", label: "10년 breakeven 인플레이션", unit: "%", source: "FRED", seriesId: "T10YIE", sourceUrl: "https://fred.stlouisfed.org/series/T10YIE", fetcher: fetchFredLatest, id: "us10y_breakeven" },
  // 주의: OECD 제공 월간 데이터라 갱신 지연이 있음(일간 데이터 아님) — 전일 대비 % 변동 탐지에는 안 맞고, 전주/전월 비교용으로만 유효
  { axis: "market_signals", label: "한국 10년물 국채금리", unit: "%", source: "FRED", seriesId: "IRLTLT01KRM156N", sourceUrl: "https://fred.stlouisfed.org/series/IRLTLT01KRM156N", fetcher: fetchFredLatest },
];

// 잔존율(retention rate) 계산 기준값 — 2026-06-22 KOSPI×USD/KRW 피크치.
// 인과사슬지도 5대 지표 ①(거시분석_인과사슬지도_20260822.md §1). 과거 고정 피크라 재산정 불필요.
const RETENTION_PEAK = 14009063;

const OUT_DIR = path.resolve("data/indicators");

async function fetchAll() {
  const results = [];

  for (const ind of INDICATORS) {
    try {
      const { value, date } = await ind.fetcher(ind.seriesId);
      results.push({
        axis: ind.axis,
        label: ind.label,
        unit: ind.unit,
        source: ind.source,
        series_id: ind.seriesId,
        source_url: ind.sourceUrl,
        value,
        date,
        ...(ind.id ? { indicator_id: ind.id } : {}),
      });
    } catch (err) {
      console.error(`[crawl-indicators] failed: ${ind.source} ${ind.seriesId} — ${err.message}`);
    }
  }

  return results;
}

// KOSPI × USD/KRW ÷ 6/22 피크 — 기존 계산식 유지(거시분석_인과사슬지도_20260822.md §1).
// kospi/usdkrw 둘 중 하나라도 이번 실행에서 수집 실패하면 계산을 건너뛴다(fail-soft).
function computeRetentionRate(results) {
  const kospi = results.find((r) => r.indicator_id === "kospi");
  const usdkrw = results.find((r) => r.indicator_id === "usdkrw");
  if (!kospi || !usdkrw) {
    console.error("[crawl-indicators] retention_rate skipped: kospi/usdkrw 중 하나 이상 수집 실패");
    return null;
  }

  const value = ((kospi.value * usdkrw.value) / RETENTION_PEAK) * 100;
  return {
    axis: "market_signals",
    label: "잔존율 (KOSPI×USD/KRW ÷ 6/22 피크)",
    unit: "%",
    source: "computed",
    series_id: "RETENTION_RATE",
    source_url: null,
    value,
    date: kospi.date <= usdkrw.date ? kospi.date : usdkrw.date, // 더 오래된(보수적) 기준일 사용
    indicator_id: "retention_rate",
  };
}

// 전주(7일 전) 대비 변화율(%) — indicator_id가 있는 지표만 계산(과거 스냅샷과 매칭 가능해야 함).
async function attachWeekChange(results) {
  for (const r of results) {
    if (!r.indicator_id) continue;
    const prev = await findValueDaysAgo(r.indicator_id, 7);
    if (prev && typeof prev.value === "number" && prev.value !== 0) {
      r.week_change_pct = ((r.value - prev.value) / Math.abs(prev.value)) * 100;
    }
  }
}

async function main() {
  const results = await fetchAll();

  const retentionRate = computeRetentionRate(results);
  if (retentionRate) results.push(retentionRate);

  await attachWeekChange(results);
  await applyAlerts(results);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const payload = { generated_at: new Date().toISOString(), indicators: results };

  await fs.writeFile(path.join(OUT_DIR, `${today}.json`), JSON.stringify(payload, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(payload, null, 2));

  const alertCount = results.filter((r) => r.alert_flag).length;
  console.log(
    `[crawl-indicators] ${results.length}/${INDICATORS.length + 1} indicators fetched (incl. computed retention_rate), ${alertCount} alert(s)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
