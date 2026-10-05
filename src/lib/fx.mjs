// fx.mjs
// 환율 fetcher — Yahoo Finance 우선, 실패 시 FRED fallback (T2, 2026-10-05).
// FRED DEX* 시리즈는 H.10 주간 발표라 실측 ~10일 지연(2026-10-05에 최신 09-25) — 일간 비교에는 Yahoo 당일값이
// 필요하다. 반환에 실제로 쓴 소스(source/series_id/source_url)를 함께 돌려줘 레코드에 그대로 기록한다.

import { fetchYahooLatest } from "./yahoo.mjs";
import { fetchFredLatest } from "./fred.mjs";

// pair → [Yahoo 티커, FRED 시리즈] (호가 방향 동일: KRW=X·DEXKOUS = 원/달러, EURUSD=X·DEXUSEU = 달러/유로)
export const FX_PAIRS = {
  usdkrw: { yahoo: "KRW=X", fred: "DEXKOUS" },
  usdjpy: { yahoo: "JPY=X", fred: "DEXJPUS" },
  eurusd: { yahoo: "EURUSD=X", fred: "DEXUSEU" },
};

export async function fetchFxLatest(pair) {
  const spec = FX_PAIRS[pair];
  if (!spec) throw new Error(`fx: unknown pair ${pair}`);
  try {
    const r = await fetchYahooLatest(spec.yahoo);
    return {
      ...r,
      source: "Yahoo Finance",
      series_id: spec.yahoo,
      source_url: `https://finance.yahoo.com/quote/${encodeURIComponent(spec.yahoo)}`,
    };
  } catch (err) {
    console.error(`[fx] ${pair}: Yahoo 실패 → FRED ${spec.fred} fallback — ${err.message}`);
    const r = await fetchFredLatest(spec.fred);
    return { ...r, source: "FRED", series_id: spec.fred, source_url: `https://fred.stlouisfed.org/series/${spec.fred}` };
  }
}
