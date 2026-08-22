// history.mjs
// data/indicators/{YYYYMMDD}.json 스냅샷들에서 특정 indicator_id의 과거 값을 조회하는 유틸.
// week_change_pct(전주 대비 변화율) 계산과 "N일 연속 임계값 하회" 같은 sustained 알림 판정에 쓰인다.
// crawl-indicators.mjs가 오늘자 스냅샷을 쓰기 *전에* 호출되므로 자기 자신을 참조하는 일은 없다.

import fs from "fs/promises";
import path from "path";

const INDICATORS_DIR = path.resolve("data/indicators");
const SNAPSHOT_RE = /^(\d{8})\.json$/;

// data/indicators/ 안의 날짜 스냅샷 파일명(YYYYMMDD)만 오름차순으로 나열 (latest.json 등은 제외)
export async function listSnapshotDates() {
  let entries;
  try {
    entries = await fs.readdir(INDICATORS_DIR);
  } catch {
    return [];
  }
  return entries
    .map((f) => f.match(SNAPSHOT_RE)?.[1])
    .filter(Boolean)
    .sort();
}

async function loadSnapshot(dateCompact) {
  try {
    const raw = await fs.readFile(path.join(INDICATORS_DIR, `${dateCompact}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findById(snapshot, indicatorId) {
  return snapshot?.indicators?.find((i) => i.indicator_id === indicatorId) ?? null;
}

// targetDateCompact(YYYYMMDD) 이하 중 가장 가까운 스냅샷에서 indicatorId 값을 찾는다.
// 주말/휴장 등으로 정확히 그 날짜의 스냅샷이 없을 수 있어 "그 이전 중 가장 최근"으로 근사하고,
// 그마저 없으면(수집 시작 초기) 그 이후 중 가장 이른 스냅샷으로 한 번 더 근사한다.
export async function findValueNearDate(indicatorId, targetDateCompact) {
  const dates = await listSnapshotDates(); // 오름차순
  let candidate = [...dates].reverse().find((d) => d <= targetDateCompact);
  if (!candidate) candidate = dates.find((d) => d >= targetDateCompact);
  if (!candidate) return null;

  const snapshot = await loadSnapshot(candidate);
  const rec = findById(snapshot, indicatorId);
  return rec ? { value: rec.value, date: candidate } : null;
}

// 오늘을 기준으로 daysAgo(달력일) 전 값 — week_change_pct 계산용.
export async function findValueDaysAgo(indicatorId, daysAgo) {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() - daysAgo);
  const targetCompact = target.toISOString().slice(0, 10).replace(/-/g, "");
  return findValueNearDate(indicatorId, targetCompact);
}

// 가장 최근 스냅샷 k개(오늘자 제외 — 오늘자는 아직 저장 전)에서 indicatorId의 값을 오래된 순으로 반환.
// "N일 연속 임계값 하회" 같은 sustained 조건 판정에 사용.
export async function recentValues(indicatorId, k) {
  if (k <= 0) return [];
  const dates = await listSnapshotDates();
  const recentDates = dates.slice(-k);
  const out = [];
  for (const d of recentDates) {
    const snapshot = await loadSnapshot(d);
    const rec = findById(snapshot, indicatorId);
    if (rec) out.push({ date: d, value: rec.value });
  }
  return out;
}
