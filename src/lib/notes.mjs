// notes.mjs
// data/daily/{axis}_{YYYYMMDD}.json(distilled 결과, raw 제외)를 축/날짜 기준으로 읽어오는 공유 헬퍼.
// daily-summary/weekly-summary가 공통으로 사용.

import fs from "fs/promises";
import path from "path";

export const AXES = [
  "geopolitics",
  "polarization",
  "fed_policy",
  "productivity_ai",
  "us_investment",
  "rates_fx",
  "commodities_energy",
];

const DAILY_DIR = path.resolve("data/daily");

export function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

// 오늘부터 과거로 n일치 YYYYMMDD 배열 (내림차순, 오늘 포함)
export function lastNDatesCompact(n) {
  const dates = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return dates;
}

export async function loadNotesForDates(datesCompact) {
  const notes = [];
  for (const dateCompact of datesCompact) {
    for (const axis of AXES) {
      const p = path.join(DAILY_DIR, `${axis}_${dateCompact}.json`);
      try {
        const items = JSON.parse(await fs.readFile(p, "utf-8"));
        if (Array.isArray(items)) notes.push(...items);
      } catch {
        // 해당 축/날짜에 노트 없음 — 정상 (fail-soft)
      }
    }
  }
  return notes;
}

export function countByAxis(notes) {
  const counts = Object.fromEntries(AXES.map((a) => [a, 0]));
  for (const n of notes) {
    if (n.axis in counts) counts[n.axis]++;
  }
  return counts;
}
