// fred.mjs
// FRED(세인트루이스 연은 경제데이터) API에서 시계열의 가장 최근 유효값 1건을 가져온다.
// 무료 API key 발급: https://fred.stlouisfed.org/docs/api/api_key.html

const BASE = "https://api.stlouisfed.org/fred/series/observations";

export async function fetchFredLatest(seriesId) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY not set");

  const url = `${BASE}?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED API ${seriesId} ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  // 결측치는 값이 "." 문자열로 온다 (주말/휴장일 등) — 유효한 최신값을 앞에서부터 탐색
  const obs = (data.observations ?? []).find((o) => o.value !== ".");
  if (!obs) throw new Error(`FRED ${seriesId}: no valid observation in recent window`);

  return { value: Number(obs.value), date: obs.date };
}
