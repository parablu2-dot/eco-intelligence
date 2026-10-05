// fred.mjs
// FRED(세인트루이스 연은 경제데이터) API에서 시계열의 최근 유효값을 가져온다.
// 무료 API key 발급: https://fred.stlouisfed.org/docs/api/api_key.html
//
// 반환: { value, date, history } — history는 최근 유효값 [{date, value}] 오름차순(파생지표·공통 날짜
// 매칭 계산용, 스냅샷에는 저장하지 않는다). fetcher 공통 형식(T1, 2026-10-05).

const BASE = "https://api.stlouisfed.org/fred/series/observations";

export async function fetchFredLatest(seriesId, { limit = 30 } = {}) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY not set");

  const url = `${BASE}?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED API ${seriesId} ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  // 결측치는 값이 "." 문자열로 온다 (주말/휴장일 등) — 유효값만 남긴다
  const history = (data.observations ?? [])
    .filter((o) => o.value !== ".")
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .reverse();
  const last = history.at(-1);
  if (!last) throw new Error(`FRED ${seriesId}: no valid observation in recent window`);

  return { value: last.value, date: last.date, history };
}
