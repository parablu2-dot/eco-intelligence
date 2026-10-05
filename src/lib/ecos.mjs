// ecos.mjs
// 한국은행 ECOS Open API(StatisticSearch)에서 일별 통계의 최근 값을 가져온다.
// API key 발급: https://ecos.bok.or.kr/api/ (GitHub Secret ECOS_API_KEY). 미설정이면 해당 지표만 스킵.
//
// seriesId 형식: "{통계표코드}/{주기}/{항목코드}" — 예: 국고채10년 "817Y002/D/010210000"
// 반환: { value, date, history } (fetcher 공통 형식, T1 2026-10-05)

const BASE = "https://ecos.bok.or.kr/api/StatisticSearch";

function ymd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function fetchEcosLatest(seriesId, { windowDays = 45 } = {}) {
  const apiKey = process.env.ECOS_API_KEY;
  if (!apiKey) throw new Error("ECOS_API_KEY not set");

  const [statCode, cycle, itemCode] = seriesId.split("/");
  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 86400000);
  const url = `${BASE}/${apiKey}/json/kr/1/${Math.max(100, windowDays)}/${statCode}/${cycle}/${ymd(start)}/${ymd(end)}/${itemCode}`;

  const res = await fetch(url);
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`ECOS ${seriesId} ${res.status}: ${bodyText.slice(0, 300)}`);

  const data = JSON.parse(bodyText);
  // 오류는 HTTP 200 + {"RESULT":{"CODE":"INFO-200"|"ERROR-xxx", MESSAGE}} 로 온다
  if (data.RESULT) throw new Error(`ECOS ${seriesId}: ${data.RESULT.CODE} ${data.RESULT.MESSAGE}`);

  const history = (data.StatisticSearch?.row ?? [])
    .filter((r) => r.DATA_VALUE !== null && r.DATA_VALUE !== "" && !Number.isNaN(Number(r.DATA_VALUE)))
    .map((r) => ({ date: `${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}-${r.TIME.slice(6, 8)}`, value: Number(r.DATA_VALUE) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = history.at(-1);
  if (!last) throw new Error(`ECOS ${seriesId}: no valid observation in recent ${windowDays} days`);

  return { value: last.value, date: last.date, history };
}
