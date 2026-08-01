// yahoo.mjs
// Yahoo Finance 비공식 chart API에서 최근 종가 1건을 가져온다. API 키 불필요.
// 비공식 엔드포인트라 안정성 보장 없음 — 실패해도 해당 종목만 스킵(fail-soft, 기존 fetcher들과 동일 원칙).

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export async function fetchYahooLatest(ticker) {
  const url = `${BASE}/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (eco-intelligence bot)" },
  });
  if (!res.ok) {
    throw new Error(`Yahoo Finance ${ticker} ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo Finance ${ticker}: no result in response`);

  const price = result.meta?.regularMarketPrice;
  const ts = result.meta?.regularMarketTime;
  if (typeof price !== "number" || !ts) {
    throw new Error(`Yahoo Finance ${ticker}: missing price/time in meta`);
  }

  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  return { value: price, date };
}
