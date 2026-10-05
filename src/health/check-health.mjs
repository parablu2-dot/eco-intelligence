// check-health.mjs — T4 "조용한 실패" 감지
// 크롤러·지표 수집은 fail-soft라 소스가 죽어도 워크플로는 초록불로 끝난다. 이 점검은 그 흔적을 모아
// data/health/latest.json에 남기고, daily-summary 메일 상단 "수집 상태" 섹션의 근거가 된다.
//
// 판정 3단계: fail(빨강, 조치 필요) / warn(노랑, 지켜볼 것) / ok
//  ① 노트 공백: 축별 마지막 비어있지 않은 노트 이후 경과일(KST 달력일)
//     - 7일 이상 → warn, 축별 fail 기준 이상 → fail. 기준은 2026-07~10 실측 최대 공백으로 정함:
//       productivity_ai(NIST) 17일·us_investment 10일·fed_policy 9일은 소스가 원래 드문드문 게시해서 7일이면 오탐.
//  ② 크롤 소스 상태(data/health/crawl/{axis}.json, crawl-status.mjs가 기록)
//     - 마지막 실행이 36시간 넘게 지남 → fail(워크플로 미실행), 소스 연속 실패 3회 이상 → fail, 1~2회 → warn,
//       fetch는 됐는데 피드 항목 0개 → warn(피드 형식 변경 의심)
//  ③ 지표(data/indicators/latest.json)
//     - 스냅샷 생성 36시간 초과 → fail, 수집 실패·건너뜀(payload.failed) → warn,
//       일별(D) 지표 lag_days(영업일, PR #11) 초과 → warn. 기준: 기본 2영업일(FRED 정상 지연 1),
//       EIA 5(주간 공표라 평소 3), WEEKDAY 달력 5(중국·일본·대만 휴장일 미반영)
// market_signals는 지표 이상치가 있어야만 노트가 생기는 축이라 ① 대상에서 제외.

import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { todayCompactKst } from "../lib/dates.mjs";
import { CRAWL_STATUS_DIR } from "../lib/crawl-status.mjs";

export const NOTE_AXES = [
  "geopolitics",
  "polarization",
  "fed_policy",
  "productivity_ai",
  "us_investment",
  "rates_fx",
  "commodities_energy",
];

export const NOTE_GAP_WARN_DAYS = 7;
export const NOTE_GAP_FAIL_DAYS = { default: 7, productivity_ai: 21, us_investment: 14, fed_policy: 14 };
export const CRAWL_STALE_HOURS = 36;
export const SOURCE_FAIL_RUNS = 3;
export const SNAPSHOT_STALE_HOURS = 36;

export function lagLimit(ind) {
  if (ind.source === "EIA") return 5;
  if (ind.lag_calendar === "WEEKDAY") return 5;
  return 2;
}

function compactToUtc(c) {
  return Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8));
}

function hoursSince(iso, now) {
  return (now.getTime() - new Date(iso).getTime()) / 3600e3;
}

function indicatorName(ind) {
  return ind.indicator_id ?? ind.label;
}

// lastNoteDates: { axis: "YYYYMMDD" | null }, crawlStatus: { axis: {last_run_at, sources} | null },
// indicators: latest.json payload | null
export function evaluateHealth({ today, now, lastNoteDates, crawlStatus, indicators }) {
  const checks = [];
  const add = (level, area, target, message) => checks.push({ level, area, target, message });

  for (const axis of NOTE_AXES) {
    const last = lastNoteDates[axis];
    const failDays = NOTE_GAP_FAIL_DAYS[axis] ?? NOTE_GAP_FAIL_DAYS.default;
    if (!last) {
      add("fail", "notes", axis, "노트 기록 없음");
      continue;
    }
    const gap = Math.round((compactToUtc(today) - compactToUtc(last)) / 864e5);
    if (gap >= failDays) add("fail", "notes", axis, `${gap}일째 새 노트 0건 (마지막 ${last}, 기준 ${failDays}일)`);
    else if (gap >= NOTE_GAP_WARN_DAYS) add("warn", "notes", axis, `${gap}일째 새 노트 0건 (마지막 ${last}, fail 기준 ${failDays}일)`);
  }

  for (const axis of NOTE_AXES) {
    const st = crawlStatus[axis];
    // 상태 파일은 T4 배포 이후 첫 크롤부터 생긴다 — 없다고 실패로 보지 않음
    if (!st) continue;
    const age = hoursSince(st.last_run_at, now);
    if (age > CRAWL_STALE_HOURS) add("fail", "crawl", axis, `크롤 ${Math.floor(age)}시간째 미실행 (마지막 ${st.last_run_at})`);
    for (const s of st.sources ?? []) {
      if (!s.ok) {
        const level = s.consecutive_failures >= SOURCE_FAIL_RUNS ? "fail" : "warn";
        add(level, "crawl", axis, `${s.name} 연속 ${s.consecutive_failures}회 실패: ${s.error}`);
      } else if (s.items === 0) {
        add("warn", "crawl", axis, `${s.name} 피드 항목 0개 (형식 변경 의심)`);
      }
    }
  }

  if (!indicators) {
    add("fail", "indicators", "snapshot", "지표 스냅샷 없음");
  } else {
    const age = hoursSince(indicators.generated_at, now);
    if (age > SNAPSHOT_STALE_HOURS) add("fail", "indicators", "snapshot", `지표 스냅샷 ${Math.floor(age)}시간 경과 (${indicators.generated_at})`);
    for (const f of indicators.failed ?? []) {
      add("warn", "indicators", f.id, `${f.label} 수집 ${f.status === "skipped" ? "건너뜀" : "실패"} (${f.source})`);
    }
    for (const ind of indicators.indicators ?? []) {
      if ((ind.frequency ?? "D") !== "D" || typeof ind.lag_days !== "number") continue;
      const limit = lagLimit(ind);
      if (ind.lag_days > limit) {
        add("warn", "indicators", indicatorName(ind), `${ind.label} ${ind.lag_days}영업일 지연 (기준일 ${ind.value_date}, 허용 ${limit})`);
      }
    }
  }

  const count = (lv) => checks.filter((c) => c.level === lv).length;
  const status = count("fail") ? "fail" : count("warn") ? "warn" : "ok";
  return { status, fail_count: count("fail"), warn_count: count("warn"), checks };
}

const DAILY_DIR = path.resolve("data/daily");
const HEALTH_PATH = path.resolve("data/health/latest.json");
const INDICATORS_PATH = path.resolve("data/indicators/latest.json");

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return null;
  }
}

// 축별 마지막 "비어있지 않은" 노트 파일 날짜 (raw 파일 제외)
async function loadLastNoteDates() {
  const files = (await fs.readdir(DAILY_DIR)).filter((f) => !f.includes("_raw_")).sort().reverse();
  const out = Object.fromEntries(NOTE_AXES.map((a) => [a, null]));
  for (const f of files) {
    const m = f.match(/^(.+)_(\d{8})\.json$/);
    if (!m || !(m[1] in out) || out[m[1]]) continue;
    const items = await readJson(path.join(DAILY_DIR, f));
    if (Array.isArray(items) && items.length > 0) out[m[1]] = m[2];
  }
  return out;
}

export async function runHealthCheck({ now = new Date(), write = true } = {}) {
  const crawlStatus = {};
  for (const axis of NOTE_AXES) crawlStatus[axis] = await readJson(path.join(CRAWL_STATUS_DIR, `${axis}.json`));
  const report = {
    generated_at: now.toISOString(),
    ...evaluateHealth({
      today: todayCompactKst(),
      now,
      lastNoteDates: await loadLastNoteDates(),
      crawlStatus,
      indicators: await readJson(INDICATORS_PATH),
    }),
  };
  if (write) {
    await fs.mkdir(path.dirname(HEALTH_PATH), { recursive: true });
    await fs.writeFile(HEALTH_PATH, JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHealthCheck()
    .then((r) => {
      console.log(`[health] ${r.status} — fail ${r.fail_count}, warn ${r.warn_count}`);
      // Actions 로그에 주석으로 노출 (공개 repo지만 health 내용엔 개인 설정이 없음)
      for (const c of r.checks) console.log(`::${c.level === "fail" ? "error" : "warning"}::[${c.area}/${c.target}] ${c.message}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
