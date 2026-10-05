// build-indicator-history.mjs
// data/indicators/{YYYYMMDD}.json 스냅샷 전체를 지표별 시계열로 묶어 data/indicators/history.json을 만든다(T3, 지표 상세 모달 차트용).
// 새로 수집하지 않는다 — 이미 쌓인 스냅샷만 재구성한다. 스냅샷 원본은 그대로 두고 이 파일은 매번 통째로 재생성.
//
// 키: indicator_id가 있으면 그것, 없으면 "axis:label" (indicatorKey — public/app.js도 같은 규칙).
//   series_id로 묶지 않는 이유: 같은 지표가 소스 교체로 series_id가 바뀐다(원/달러 DEXKOUS→KRW=X).
//   대신 소스가 바뀐 지점을 breaks로 남겨 차트에서 표시한다(소스 간 값은 직접 비교하면 가짜 변동이 생김).
// 점: value_date(구 스냅샷은 date) 기준 중복 제거 — 같은 관측일은 더 늦은 스냅샷 값을 쓴다(수정치 반영).

import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

const INDICATORS_DIR = path.resolve("data/indicators");
const OUT_PATH = path.join(INDICATORS_DIR, "history.json");
const SEED_PATH = path.join(INDICATORS_DIR, "history-seed.json");
const SNAPSHOT_RE = /^(\d{8})\.json$/;

// indicator_id 도입(2026-08-22) 전 id 없이 쌓인 같은 지표를 현재 id로 잇는다. 관측일이 겹치면 id 레코드가 우선.
// 한국 10년물(IRLTLT01KRM156N, OECD 월평균)은 ECOS 일별 kr10y와 정의가 달라 잇지 않는다.
const LEGACY_ALIASES = {
  "market_signals:원/달러 환율": "usdkrw",
  "market_signals:엔/달러 환율": "usdjpy",
  "market_signals:달러/유로 환율": "eurusd",
  "market_signals:미국 10년물 국채금리": "us10y",
};

export function indicatorKey(ind) {
  return ind.indicator_id ?? `${ind.axis}:${ind.label}`;
}

// snapshots: [{ indicators: [...] }] 오래된 순, seedSeries: history-seed.json의 series (없으면 null)
export function buildHistory(snapshots, seedSeries = null) {
  const byKey = new Map();
  for (const snap of snapshots) {
    for (const ind of snap?.indicators ?? []) {
      if (typeof ind.value !== "number" || !Number.isFinite(ind.value)) continue;
      const obsDate = ind.value_date ?? ind.date;
      if (!obsDate) continue;
      const rawKey = indicatorKey(ind);
      const aliased = rawKey in LEGACY_ALIASES;
      const key = aliased ? LEGACY_ALIASES[rawKey] : rawKey;
      let s = byKey.get(key);
      if (!s) {
        s = { points: new Map(), sourceByDate: new Map(), formulaByDate: new Map() };
        byKey.set(key, s);
      } else if (aliased) {
        if (!s.points.has(obsDate)) {
          s.points.set(obsDate, ind.value);
          s.sourceByDate.set(obsDate, `${ind.source ?? ""}/${ind.series_id ?? ""}`);
        }
        continue;
      }
      // 메타는 가장 최근 스냅샷 기준으로 덮어쓴다
      Object.assign(s, {
        label: ind.label,
        axis: ind.axis,
        unit: ind.unit ?? "",
        frequency: ind.frequency ?? "D",
        source: ind.source ?? "",
        source_url: ind.source_url ?? "",
      });
      s.points.set(obsDate, ind.value);
      s.sourceByDate.set(obsDate, `${ind.source ?? ""}/${ind.series_id ?? ""}`);
      // 계산 공식이 바뀐 파생지표(잔존율 D9 등)는 formula가 바뀐 날짜도 구분점으로 남긴다
      if (ind.formula) s.formulaByDate.set(obsDate, ind.formula);
    }
  }

  // 1년 시드(backfill-indicator-history.mjs): 시드의 마지막 관측일까지는 시드 값만 쓴다 — 한 소스로 이어진 구간이라
  // 스냅샷(소스 교체 전 FRED 등)과 섞으면 소스 간 가짜 변동이 생긴다. 그 이후는 스냅샷. 스냅샷에 없는 키는 메타가 없어 버린다.
  for (const [key, seed] of Object.entries(seedSeries ?? {})) {
    const s = byKey.get(key);
    const seedLast = seed.points?.at(-1)?.[0];
    if (!s || !seedLast) continue;
    for (const d of [...s.points.keys()]) {
      if (d <= seedLast) {
        s.points.delete(d);
        s.sourceByDate.delete(d);
      }
    }
    s.seededUntil = seedLast;
    for (const [d, v] of seed.points) {
      s.points.set(d, v);
      s.sourceByDate.set(d, `${seed.source ?? ""}/${seed.series_id ?? ""}`);
    }
  }

  const series = {};
  for (const [key, s] of byKey) {
    const dates = [...s.points.keys()].sort();
    const breaks = [];
    let prevSrc = null;
    let prevFormula = null;
    for (const d of dates) {
      const src = s.sourceByDate.get(d);
      const formula = s.formulaByDate.get(d) ?? null;
      if (prevSrc !== null && formula !== prevFormula) breaks.push({ date: d, source: src, kind: "formula", formula });
      else if (prevSrc !== null && src !== prevSrc) breaks.push({ date: d, source: src });
      prevSrc = src;
      prevFormula = formula;
    }
    series[key] = {
      label: s.label,
      axis: s.axis,
      unit: s.unit,
      frequency: s.frequency,
      source: s.source,
      source_url: s.source_url,
      points: dates.map((d) => [d, s.points.get(d)]),
      ...(s.seededUntil ? { seeded_until: s.seededUntil } : {}),
      ...(breaks.length ? { breaks } : {}),
    };
  }
  return series;
}

async function main() {
  const files = (await fs.readdir(INDICATORS_DIR)).filter((f) => SNAPSHOT_RE.test(f)).sort();
  const snapshots = [];
  for (const f of files) {
    try {
      snapshots.push(JSON.parse(await fs.readFile(path.join(INDICATORS_DIR, f), "utf-8")));
    } catch (err) {
      console.warn(`skip ${f}: ${err.message}`);
    }
  }
  let seed = null;
  try {
    seed = JSON.parse(await fs.readFile(SEED_PATH, "utf-8")).series;
  } catch {
    // 시드 없음 — 스냅샷만으로 만든다
  }
  const series = buildHistory(snapshots, seed);
  const out = {
    generated_at: new Date().toISOString(),
    snapshot_range: files.length ? [files[0].slice(0, 8), files.at(-1).slice(0, 8)] : [],
    series,
  };
  await fs.writeFile(OUT_PATH, JSON.stringify(out) + "\n");
  console.log(`history.json: ${Object.keys(series).length} series from ${files.length} snapshots`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
