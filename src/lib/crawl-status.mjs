// crawl-status.mjs
// 크롤러는 소스 fetch가 실패해도 fail-soft로 console.error만 남기고 워크플로는 초록불로 끝난다(T4 "조용한 실패").
// 그래서 실행마다 소스별 결과를 data/health/crawl/{axis}.json에 남겨 health 점검이 읽게 한다.
// 연속 실패 횟수는 직전 파일을 이어받아 계산 — 하루 일시 장애와 며칠째 죽은 소스를 구분하기 위함.

import fs from "fs/promises";
import path from "path";

export const CRAWL_STATUS_DIR = path.resolve("data/health/crawl");

async function readPrev(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

// results: [{ name, ok, items?, fresh?, error? }] — items = 피드 항목 수, fresh = 신규 채택 수
export async function recordCrawlStatus(axis, results, { now = new Date() } = {}) {
  const file = path.join(CRAWL_STATUS_DIR, `${axis}.json`);
  const prev = await readPrev(file);
  const prevByName = Object.fromEntries((prev?.sources ?? []).map((s) => [s.name, s]));
  const runAt = now.toISOString();

  const sources = results.map((r) => {
    const p = prevByName[r.name];
    return {
      name: r.name,
      ok: r.ok,
      items: r.ok ? r.items ?? 0 : null,
      fresh: r.ok ? r.fresh ?? 0 : 0,
      error: r.ok ? null : String(r.error ?? "unknown"),
      consecutive_failures: r.ok ? 0 : (p?.consecutive_failures ?? 0) + 1,
      last_ok_at: r.ok ? runAt : p?.last_ok_at ?? null,
      last_fresh_at: r.ok && (r.fresh ?? 0) > 0 ? runAt : p?.last_fresh_at ?? null,
    };
  });

  await fs.mkdir(CRAWL_STATUS_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ axis, last_run_at: runAt, sources }, null, 2) + "\n");
  return sources;
}
