// backfill-indicator-history.mjs
// 채권·환율 지표(+채권 파생 스프레드)의 과거 1년치를 원출처에서 한 번에 받아 data/indicators/history-seed.json에 쓴다.
// 대시보드 수집이 늦게 시작된 지표(T1 신규 채권은 2026-10-05부터 1점)도 상세 모달 차트를 1년으로 볼 수 있게 하기 위함.
//
// - 일별 스냅샷(data/indicators/{YYYYMMDD}.json)은 건드리지 않는다 → 전주 대비·경보 계산은 기존과 동일.
// - build-indicator-history.mjs가 이 시드를 병합한다(시드 구간은 시드 우선, 이후는 스냅샷).
// - 지표 하나가 실패하면 기존 시드의 해당 시리즈를 그대로 둔다(fail-soft). 전부 실패하면 exit 1.
// 필요한 Secret: FRED_API_KEY, ECOS_API_KEY (Yahoo는 키 불필요).

import fs from "fs/promises";
import path from "path";
import { INDICATORS, SPREADS } from "../src/indicators/crawl-indicators.mjs";
import { fetchFxLatest } from "../src/lib/fx.mjs";
import { indicatorKey } from "./build-indicator-history.mjs";
import { nowKst } from "../src/lib/dates.mjs";

const SEED_PATH = path.resolve("data/indicators/history-seed.json");
const DAYS = 366;
// fetcher별 기간 옵션 — 각 fetcher는 자기 키만 읽는다(FRED limit은 관측 개수라 주말 포함 일별 시리즈도 1년을 덮게 400)
const RANGE_OPTS = { range: "1y", limit: 400, windowDays: DAYS + 14 };

const isTarget = (spec) => spec.group === "bond" || spec.fetcher === fetchFxLatest;
const round = (v, d) => Number(v.toFixed(d));

async function main() {
  const from = nowKst();
  from.setUTCDate(from.getUTCDate() - DAYS);
  const fromIso = from.toISOString().slice(0, 10);

  let prev = {};
  try {
    prev = JSON.parse(await fs.readFile(SEED_PATH, "utf-8")).series ?? {};
  } catch {
    // 첫 실행
  }

  const series = { ...prev };
  const histById = new Map();
  let ok = 0, failed = 0;

  for (const spec of INDICATORS.filter(isTarget)) {
    const key = indicatorKey({ indicator_id: spec.id, axis: spec.axis, label: spec.label });
    try {
      const r = await spec.fetcher(spec.seriesId, RANGE_OPTS);
      const points = r.history.filter((h) => h.date >= fromIso).map((h) => [h.date, h.value]);
      series[key] = {
        source: r.source ?? spec.source,
        series_id: r.series_id ?? spec.seriesId,
        points,
      };
      if (spec.id) histById.set(spec.id, r.history);
      console.log(`[backfill] ${key}: ${points.length}점 (${points[0]?.[0]} ~ ${points.at(-1)?.[0]})`);
      ok++;
    } catch (err) {
      console.error(`[backfill] failed: ${key} — ${err.message}`);
      failed++;
    }
  }

  // 파생 스프레드: 두 재료의 공통 관측일만 (derive.mjs와 같은 원칙)
  for (const spec of SPREADS) {
    const a = histById.get(spec.a), b = histById.get(spec.b);
    if (!a || !b) {
      console.error(`[backfill] spread skipped: ${spec.id} (재료 ${spec.a}/${spec.b} 없음)`);
      continue;
    }
    const bMap = new Map(b.map((h) => [h.date, h.value]));
    const points = a
      .filter((h) => h.date >= fromIso && bMap.has(h.date))
      .map((h) => [h.date, round(h.value - bMap.get(h.date), 4)]);
    series[spec.id] = { source: "computed", series_id: spec.seriesId, points };
    console.log(`[backfill] ${spec.id}: ${points.length}점`);
  }

  if (ok === 0) {
    console.error(`[backfill] 전부 실패(${failed}건) — 시드를 쓰지 않음`);
    process.exit(1);
  }
  await fs.writeFile(
    SEED_PATH,
    JSON.stringify({ generated_at: new Date().toISOString(), from: fromIso, series }) + "\n"
  );
  console.log(`[backfill] 완료: 성공 ${ok}, 실패 ${failed}, 시리즈 ${Object.keys(series).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
