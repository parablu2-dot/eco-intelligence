// core-snapshot.mjs
// data/indicators/latest.json에서 인과사슬지도 5대 핵심 지표(잔존율·USD/KRW·KOSPI·미30년물·USD/JPY)만
// 뽑아 daily/weekly summary(JSON) 출력에 얹기 위한 스냅샷을 만든다.
// (거시분석_인과사슬지도_20260822.md §1, §4-5)

import fs from "fs/promises";
import path from "path";

const LATEST_PATH = path.resolve("data/indicators/latest.json");

export const CORE_INDICATOR_IDS = ["retention_rate", "usdkrw", "kospi", "us30y", "usdjpy"];

async function loadLatestIndicators() {
  try {
    const raw = await fs.readFile(LATEST_PATH, "utf-8");
    const data = JSON.parse(raw);
    return data.indicators ?? [];
  } catch {
    return []; // 지표 데이터가 아직 없어도 summary 파이프라인은 계속 진행 (fail-soft)
  }
}

// 5대 핵심 지표를 CORE_INDICATOR_IDS 순서로 반환. 아직 수집 전이거나 실패한 지표는 빠질 수 있다.
export async function loadCoreIndicators() {
  const indicators = await loadLatestIndicators();
  const byId = new Map(indicators.map((i) => [i.indicator_id, i]));
  return CORE_INDICATOR_IDS.map((id) => byId.get(id)).filter(Boolean);
}

// alert_flag=true인 지표 전체(핵심 5종 + 2차 참고 지표 포함) — daily-triage "이번 주 알림" 섹션과 동일 소스.
export async function loadActiveAlerts() {
  const indicators = await loadLatestIndicators();
  return indicators.filter((i) => i.alert_flag);
}
