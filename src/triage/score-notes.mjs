// score-notes.mjs
// 트리아지 스코어링(룰 기반, LLM 호출 없음 — 비용/속도 우선, 정확도 낮으면 추후 재검토).
//
// 평소(cron) 모드: 그날 8축 data/daily/{axis}_{YYYYMMDD}.json에서 cheon_view.status === "pending"인
// 노트를 대상으로 3개 판단축(top_down/bottom_up/time_series) 통과 여부를 키워드/구조 매칭으로
// 판정하고, config/triage-weights.json의 가중치 합으로 triage_score(0~9)를 매긴다.
// 스코어 상위 N건(기본 5)만 status: "pending" -> "triaged"로 승격(=다음 단계인
// draft-judgment.mjs 입력이 됨). 나머지는 triage_score만 기록하고 pending에 남는다.
// (자관_ECO애널리스트_ClaudeCode스펙_v1.0 §2)
//
// --backfill 모드: 날짜 필터를 무시하고 data/daily 전체(모든 날짜)에서 pending 노트를 대상으로
// 채점한다. 파이프라인 도입 이전에 쌓인 노트를 1회성으로 정리할 때만 사용 — daily-triage.yml의
// 상시 cron 동작(오늘 날짜만)은 그대로이며, 백필은 별도로 수동 실행하는 1회성 작업이다.
// 백필 시 상위 N건 기본값은 cron 기본값(5)보다 넉넉한 BACKFILL_DEFAULT_TOP(25) — 313건 전체를
// 한 번에 draft-judgment(Claude API 호출)로 넘기면 비용이 크므로 안전하게 나눠 처리하기 위함.
// --top=N으로 두 모드 모두 오버라이드 가능.

import fs from "fs/promises";
import path from "path";

const AXES = [
  "geopolitics",
  "polarization",
  "fed_policy",
  "productivity_ai",
  "us_investment",
  "rates_fx",
  "commodities_energy",
  "market_signals",
];

const DAILY_DIR = path.resolve("data/daily");
const CONFIG_PATH = path.resolve("config/triage-weights.json");
const DAILY_NOTE_RE = /^(.+)_(\d{8})\.json$/; // build-index.mjs와 동일 규칙: raw 파일 제외
const BACKFILL_DEFAULT_TOP = 25;

// top_down — 트렌드/정책방향성 키워드 (일반적인 "발표"류는 제외, 방향성이 드러나는 단어만)
const TOP_DOWN_RE =
  /(정책\s*기조|정책\s*방향|기조\s*전환|패러다임|구조적\s*전환|로드맵|전략적|긴축|완화적|매파적|비둘기파적|금리\s*(인상|인하)|관세\s*(부과|인상|인하)|규제\s*(강화|완화)|제재\s*(강화|해제)|공급망\s*재편|디커플링|트렌드|policy\s*shift|framework|roadmap)/i;

// bottom_up — 인과관계 서술(A→B) 구조: 화살표 또는 인과 접속 표현
const BOTTOM_UP_RE =
  /(→|->|로\s*인해|때문에|영향으로|촉발|초래|여파로|이어졌|이어지며|그\s*결과|이에\s*따라|따른\s|결과적으로|due\s*to|as\s*a\s*result|leading\s*to)/i;

// time_series — 리드타임/일정/주기 관련 수치: 기간 단위 숫자 표현 + 일정/주기 어휘
const TIME_SERIES_RE =
  /(\d+\s*(개월|주일?|일|년|분기)\s*(후|내|만에|간|동안)?|리드타임|lead\s*time|일정|예정|주기적|분기별|월별|연례|차년도|스케줄|schedule|timeline)/i;

async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, "utf-8");
  const cfg = JSON.parse(raw);
  return {
    weights: cfg.weights ?? { top_down: 5, bottom_up: 1, time_series: 3 },
    topN: cfg.top_n ?? 5,
  };
}

function noteText(note) {
  return [note.headline ?? "", ...(note.facts ?? [])].join(" ");
}

function scoreNote(note, weights) {
  const text = noteText(note);
  const passed = {
    top_down: TOP_DOWN_RE.test(text),
    bottom_up: BOTTOM_UP_RE.test(text),
    time_series: TIME_SERIES_RE.test(text),
  };
  const score =
    (passed.top_down ? weights.top_down : 0) +
    (passed.bottom_up ? weights.bottom_up : 0) +
    (passed.time_series ? weights.time_series : 0);
  return { score, passed };
}

function compactDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const backfill = argv.includes("--backfill");
  const dateArg = argv.find((a) => a.startsWith("--date="));
  const topArg = argv.find((a) => a.startsWith("--top="));
  return {
    backfill,
    date: dateArg ? dateArg.slice("--date=".length) : compactDate(new Date()),
    topOverride: topArg ? Number(topArg.slice("--top=".length)) : null,
  };
}

async function listJsonFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

// { filePath -> items } 캐시에 pending 노트를 모은다. targetDate가 있으면 그 날짜(axis별 1파일)만,
// 없으면(백필) data/daily 전체를 스캔한다.
async function collectPendingCandidates({ targetDate, fileCache, candidates }) {
  if (targetDate) {
    for (const axis of AXES) {
      const filePath = path.join(DAILY_DIR, `${axis}_${targetDate}.json`);
      let items;
      try {
        items = JSON.parse(await fs.readFile(filePath, "utf-8"));
      } catch {
        continue; // 그날 해당 축 노트 없음 — 정상(fail-soft)
      }
      if (!Array.isArray(items)) continue;
      fileCache.set(filePath, items);
      for (const note of items) {
        if ((note.cheon_view?.status ?? "pending") !== "pending") continue;
        candidates.push(note);
      }
    }
    return;
  }

  // 백필: 파일명만으로 axis/날짜를 걸러 data/daily 전체를 스캔(raw 파일은 DAILY_NOTE_RE가 자연히 제외)
  for (const file of await listJsonFiles(DAILY_DIR)) {
    const m = file.match(DAILY_NOTE_RE);
    if (!m || !AXES.includes(m[1])) continue;
    const filePath = path.join(DAILY_DIR, file);
    let items;
    try {
      items = JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch (err) {
      console.error(`[score-notes] skip ${file}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(items)) continue;
    fileCache.set(filePath, items);
    for (const note of items) {
      if ((note.cheon_view?.status ?? "pending") !== "pending") continue;
      candidates.push(note);
    }
  }
}

async function main() {
  const { weights, topN: configTopN } = await loadConfig();
  const { backfill, date, topOverride } = parseArgs();

  const fileCache = new Map(); // filePath -> items(array, 원본 참조)
  const candidates = [];
  await collectPendingCandidates({
    targetDate: backfill ? null : date,
    fileCache,
    candidates,
  });

  const label = backfill ? "backfill(전체 날짜)" : `date=${date}`;
  if (candidates.length === 0) {
    console.log(`[score-notes] no pending notes (${label})`);
    return;
  }

  // 전수 채점 — 각 노트에 triage_score를 기록(§2 "각 노트에 triage_score 기록")
  for (const note of candidates) {
    const { score } = scoreNote(note, weights);
    note.cheon_view.triage_score = score;
  }

  const topN = topOverride ?? (backfill ? BACKFILL_DEFAULT_TOP : configTopN);

  // 상위 N건만 승격(§2 "스코어 상위 N건만 다음 단계로 승격")
  const promoted = [...candidates]
    .sort((a, b) => b.cheon_view.triage_score - a.cheon_view.triage_score)
    .slice(0, topN);
  for (const note of promoted) {
    note.cheon_view.status = "triaged";
  }

  for (const [filePath, items] of fileCache) {
    await fs.writeFile(filePath, JSON.stringify(items, null, 2));
  }

  console.log(
    `[score-notes] ${candidates.length} scored, ${promoted.length} promoted to "triaged" (${label}, topN=${topN})`
  );
  for (const note of promoted) {
    console.log(`  - [${note.cheon_view.triage_score}] ${note.axis} ${note.id}: ${note.headline}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
