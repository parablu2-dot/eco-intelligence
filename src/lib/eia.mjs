// eia.mjs
// EIA(미 에너지정보청) API v2에서 시계열의 가장 최근 유효값 1건을 가져온다.
// 무료 API key 발급: https://www.eia.gov/opendata/register.php
//
// v1 시절 series id(예: PET.RWTC.D)를 그대로 쓸 수 있는 호환 라우트 /v2/seriesid/{id}를 사용.
// EIA API 게이트웨이는 api_key가 없으면 라우트 검증 이전에 무조건 403(API_KEY_MISSING)을
// 반환해 로컬에서 라우트 자체를 사전 검증할 수 없었음 — 실제 키 등록 후 첫 실행 로그로
// 라우트/시리즈 id가 맞는지 확인 필요 (틀렸다면 아래 에러 메시지에 원문 응답이 그대로 찍힘).

const BASE = "https://api.eia.gov/v2/seriesid";

export async function fetchEiaLatest(seriesId) {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) throw new Error("EIA_API_KEY not set");

  const url = `${BASE}/${encodeURIComponent(seriesId)}?api_key=${apiKey}&sort[0][column]=period&sort[0][direction]=desc&length=5`;
  const res = await fetch(url);
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`EIA API ${seriesId} ${res.status}: ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  const rows = data.response?.data ?? [];
  const row = rows.find((r) => r.value !== null && r.value !== undefined);
  if (!row) throw new Error(`EIA ${seriesId}: no valid observation — raw response: ${bodyText}`);

  return { value: Number(row.value), date: row.period };
}
