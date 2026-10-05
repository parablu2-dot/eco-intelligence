// yahoo.mjs
// Yahoo Finance 비공식 chart API에서 최근 종가를 가져온다. API 키 불필요.
// 비공식 엔드포인트라 안정성 보장 없음 — 실패해도 해당 종목만 스킵(fail-soft, 기존 fetcher들과 동일 원칙).
//
// 날짜 = timestamp + meta.gmtoffset (거래소 현지 달력일). UTC로 자르면 FX(London, 일봉 시작 23:00 UTC)가
// 하루 앞당겨지고 KST 거래소는 전날로 밀린다 (T2, 2026-10-05 실측).

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export function localDate(ts, gmtoffset = 0) {
  return new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10);
}

export async function fetchYahooLatest(ticker, { range = "1mo" } = {}) {
  const url = `${BASE}/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
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

  const offset = result.meta?.gmtoffset ?? 0;
  const date = localDate(ts, offset);

  // 일봉 history(오름차순, 같은 날짜는 마지막 값). 마지막 날은 장중일 수 있어 meta 현재가로 맞춘다.
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map();
  (result.timestamp ?? []).forEach((t, i) => {
    if (typeof closes[i] === "number") byDate.set(localDate(t, offset), closes[i]);
  });
  byDate.set(date, price);
  const history = [...byDate].map(([d, v]) => ({ date: d, value: v })).sort((a, b) => a.date.localeCompare(b.date));

  return { value: price, date, history };
}
