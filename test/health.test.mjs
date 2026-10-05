import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { evaluateHealth, NOTE_AXES } from "../src/health/check-health.mjs";
import { renderSummaryMailHtml } from "../src/lib/mail-template.mjs";

const NOW = new Date("2026-10-05T23:00:00Z"); // 10/06 08:00 KST
const TODAY = "20261006";
const allRecent = Object.fromEntries(NOTE_AXES.map((a) => [a, "20261005"]));
const freshIndicators = { generated_at: "2026-10-05T22:30:00Z", indicators: [], failed: [] };

function run(over = {}) {
  return evaluateHealth({
    today: TODAY,
    now: NOW,
    lastNoteDates: allRecent,
    crawlStatus: {},
    indicators: freshIndicators,
    ...over,
  });
}

test("모두 정상이면 ok", () => {
  const r = run();
  assert.equal(r.status, "ok");
  assert.equal(r.checks.length, 0);
});

test("노트 공백: 기본 7일 fail, 드문 축은 warn 후 축별 기준에서 fail", () => {
  const r = run({ lastNoteDates: { ...allRecent, geopolitics: "20260812", productivity_ai: "20260928" } });
  const byTarget = Object.fromEntries(r.checks.map((c) => [c.target, c.level]));
  assert.equal(byTarget.geopolitics, "fail");
  assert.equal(byTarget.productivity_ai, "warn"); // 8일 — fail 기준 21일
  assert.equal(r.status, "fail");

  const r2 = run({ lastNoteDates: { ...allRecent, productivity_ai: "20260915" } }); // 21일
  assert.equal(r2.checks[0].level, "fail");
});

test("이벤트성 축(rates_fx)은 노트 공백 판정 제외, 크롤 소스 이상은 그대로 잡음", () => {
  assert.equal(run({ lastNoteDates: { ...allRecent, rates_fx: "20260812" } }).status, "ok");
  assert.equal(run({ lastNoteDates: { ...allRecent, rates_fx: null } }).status, "ok");
  const r = run({
    crawlStatus: {
      rates_fx: { last_run_at: "2026-10-05T21:00:00Z", sources: [{ name: "H.10", ok: true, items: 0, fresh: 0, consecutive_failures: 0 }] },
    },
  });
  assert.deepEqual(r.checks.map((c) => `${c.target}:${c.level}`), ["rates_fx:warn"]);
});

test("크롤 상태: 미실행·연속 실패·빈 피드", () => {
  const r = run({
    crawlStatus: {
      fed_policy: { last_run_at: "2026-10-04T00:00:00Z", sources: [] }, // 47시간 전
      geopolitics: {
        last_run_at: "2026-10-05T21:00:00Z",
        sources: [
          { name: "A", ok: false, error: "HTTP 403", consecutive_failures: 3 },
          { name: "B", ok: false, error: "timeout", consecutive_failures: 1 },
          { name: "C", ok: true, items: 0, fresh: 0, consecutive_failures: 0 },
          { name: "D", ok: true, items: 20, fresh: 0, consecutive_failures: 0 },
        ],
      },
    },
  });
  const levels = r.checks.map((c) => `${c.target}:${c.level}`);
  assert.deepEqual(levels, ["geopolitics:fail", "geopolitics:warn", "geopolitics:warn", "fed_policy:fail"]);
});

test("지표: 스냅샷 노후·수집 실패·영업일 지연 기준(기본 2, EIA·WEEKDAY 5, 비일간 제외)", () => {
  const r = run({
    indicators: {
      generated_at: "2026-10-04T00:00:00Z",
      failed: [{ id: "kr3y", label: "국고3", source: "ECOS", status: "failed" }],
      indicators: [
        { indicator_id: "us10y", label: "미10", frequency: "D", lag_days: 3, lag_calendar: "US_GOV", value_date: "2026-09-30" },
        { indicator_id: "us2y", label: "미2", frequency: "D", lag_days: 2, lag_calendar: "US_GOV" },
        { label: "WTI", source: "EIA", frequency: "D", lag_days: 5, lag_calendar: "US_GOV" },
        { label: "CXMT", frequency: "D", lag_days: 5, lag_calendar: "WEEKDAY" },
        { label: "지니", frequency: "A", lag_days: 700, lag_calendar: "US_GOV" },
      ],
    },
  });
  assert.deepEqual(
    r.checks.map((c) => `${c.target}:${c.level}`),
    ["snapshot:fail", "kr3y:warn", "us10y:warn"]
  );
});

test("메일: 상태 이상 시 수집 상태 섹션, ok면 없음", () => {
  const bad = run({ lastNoteDates: { ...allRecent, commodities_energy: "20260812" } });
  const html = renderSummaryMailHtml({ title: "t", subtitle: "s", points: [], health: bad });
  assert.match(html, /수집 상태 — 실패 1/);
  assert.match(html, /원자재\/에너지/);
  assert.doesNotMatch(renderSummaryMailHtml({ title: "t", subtitle: "s", points: [], health: run() }), /수집 상태/);
});

test("crawl-status: 연속 실패 누적·성공 시 리셋, last_ok_at 유지", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-crawl-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    // CRAWL_STATUS_DIR은 import 시점 cwd 기준이라 chdir 후 새로 import
    const { recordCrawlStatus } = await import(`../src/lib/crawl-status.mjs?t=${Date.now()}`);
    const t = (h) => ({ now: new Date(Date.UTC(2026, 9, 5, h)) });
    await recordCrawlStatus("x", [{ name: "S", ok: true, items: 5, fresh: 2 }], t(0));
    await recordCrawlStatus("x", [{ name: "S", ok: false, error: "HTTP 500" }], t(1));
    let s = await recordCrawlStatus("x", [{ name: "S", ok: false, error: "HTTP 500" }], t(2));
    assert.equal(s[0].consecutive_failures, 2);
    assert.equal(s[0].last_ok_at, "2026-10-05T00:00:00.000Z");
    assert.equal(s[0].last_fresh_at, "2026-10-05T00:00:00.000Z");
    s = await recordCrawlStatus("x", [{ name: "S", ok: true, items: 5, fresh: 0 }], t(3));
    assert.equal(s[0].consecutive_failures, 0);
    assert.equal(s[0].last_fresh_at, "2026-10-05T00:00:00.000Z");
  } finally {
    process.chdir(cwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
