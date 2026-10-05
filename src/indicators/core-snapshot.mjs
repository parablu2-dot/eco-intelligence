// core-snapshot.mjs
// data/indicators/{latest|YYYYMMDD}.json에서 인과사슬지도 5대 핵심 지표(잔존율·USD/KRW·KOSPI·미30년물·USD/JPY)만
// 뽑아 daily/weekly summary(JSON) 출력에 얹기 위한 스냅샷을 만든다.
// (거시분석_인과사슬지도_20260822.md §1, §4-5)

import fs from "fs/promises";
import path from "path";

const INDICATORS_DIR = path.resolve("data/indicators");

export const CORE_INDICATOR_IDS = ["retention_rate", "usdkrw", "kospi", "us30y", "usdjpy"];

// dateCompact(YYYYMMDD)가 주어지면 그날 스냅샷(요약 백필용), 없으면 latest.json.
export async function loadIndicators(dateCompact) {
  try {
    const raw = await fs.readFile(path.join(INDICATORS_DIR, `${dateCompact ?? "latest"}.json`), "utf-8");
    const data = JSON.parse(raw);
    return data.indicators ?? [];
  } catch {
    return []; // 지표 데이터가 아직 없어도 summary 파이프라인은 계속 진행 (fail-soft)
  }
}

// 5대 핵심 지표를 CORE_INDICATOR_IDS 순서로 반환. 아직 수집 전이거나 실패한 지표는 빠질 수 있다.
export async function loadCoreIndicators(dateCompact) {
  const indicators = await loadIndicators(dateCompact);
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  return CORE_INDICATOR_IDS.map((id) => byId.get(id)).filter(Boolean);
}
