// migrate-cheon-view.mjs
// 일회성 마이그레이션: data/daily/*.json(axis 노트 파일, raw 제외)+data/baseline/*.json에
// 이미 저장된 노트의 cheon_view에 트리아지 파이프라인 필드(status/triage_score/axis_tag/
// draft_judgment/reviewed_at/reject_reason)를 채운다.
// 값이 이미 있는 필드는 건드리지 않음 — applyCheonViewDefaults와 동일 규칙(status는 "pending"으로만 채움).
// (자관_ECO애널리스트_ClaudeCode스펙_v1.0 §1 "기존 노트는 마이그레이션 시 status: pending으로 일괄 설정")

import fs from "fs/promises";
import path from "path";
import { applyCheonViewDefaults } from "../src/lib/cheon-view-defaults.mjs";

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
const BASELINE_DIR = path.resolve("data/baseline");
// build-index.mjs와 동일한 규칙: {axis}_{YYYYMMDD}.json만 매칭(raw 파일 제외)
const DAILY_NOTE_RE = /^(.+)_(\d{8})\.json$/;

async function listJsonFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

async function migrateFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  let items;
  try {
    items = JSON.parse(raw);
  } catch (err) {
    console.error(`[migrate-cheon-view] skip ${filePath}: ${err.message}`);
    return { changed: 0, total: 0 };
  }
  if (!Array.isArray(items)) return { changed: 0, total: 0 };

  let changed = 0;
  for (const note of items) {
    const before = JSON.stringify(note.cheon_view ?? {});
    applyCheonViewDefaults(note);
    if (JSON.stringify(note.cheon_view) !== before) changed++;
  }
  if (changed > 0) {
    await fs.writeFile(filePath, JSON.stringify(items, null, 2));
  }
  return { changed, total: items.length };
}

async function main() {
  let totalNotes = 0;
  let totalChanged = 0;
  let filesTouched = 0;

  for (const file of await listJsonFiles(DAILY_DIR)) {
    const m = file.match(DAILY_NOTE_RE);
    if (!m || !AXES.includes(m[1])) continue; // raw 파일 등은 자연히 제외
    const { changed, total } = await migrateFile(path.join(DAILY_DIR, file));
    totalNotes += total;
    totalChanged += changed;
    if (changed > 0) filesTouched++;
  }

  for (const file of await listJsonFiles(BASELINE_DIR)) {
    const { changed, total } = await migrateFile(path.join(BASELINE_DIR, file));
    totalNotes += total;
    totalChanged += changed;
    if (changed > 0) filesTouched++;
  }

  console.log(
    `[migrate-cheon-view] ${totalChanged}/${totalNotes} notes updated across ${filesTouched} file(s)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
