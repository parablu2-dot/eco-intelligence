// crawl-indicators.mjs
// 7축 각각의 핵심 실수치 지표를 공개 API(FRED/EIA)에서 가져와 data/indicators/에 저장.
// LLM을 거치지 않는 순수 수치 데이터 — distillation 파이프라인과 별개로 동작.
// 소스 하나가 실패해도 나머지는 계속 수집 (fail-soft, 기존 crawler들과 동일 원칙).

import fs from "fs/promises";
import path from "path";
import { fetchFredLatest } from "../lib/fred.mjs";
import { fetchEiaLatest } from "../lib/eia.mjs";

// SIPOVGINIUSA(지니계수)는 확인 신뢰도가 낮은 series id — 첫 실행 로그에서 에러가 나면
// https://fred.stlouisfed.org/tags/series?t=gini 에서 정확한 id로 교체할 것.
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
];

const OUT_DIR = path.resolve("data/indicators");

async function main() {
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
      });
    } catch (err) {
      console.error(`[crawl-indicators] failed: ${ind.source} ${ind.seriesId} — ${err.message}`);
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const payload = { generated_at: new Date().toISOString(), indicators: results };

  await fs.writeFile(path.join(OUT_DIR, `${today}.json`), JSON.stringify(payload, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "latest.json"), JSON.stringify(payload, null, 2));

  console.log(`[crawl-indicators] ${results.length}/${INDICATORS.length} indicators fetched`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
