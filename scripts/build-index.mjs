// build-index.mjs
// data/daily/*.json(distilled, raw 제외)+data/baseline/*.json을 모아 프론트가 한 번의 fetch로
// 읽을 수 있는 data/index.json을 생성한다. crawl/distill 단계 이후, git commit 이전에 실행.

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
];

const DAILY_DIR = path.resolve("data/daily");
const BASELINE_DIR = path.resolve("data/baseline");
const OUT_PATH = path.resolve("data/index.json");

// {axis}_{YYYYMMDD}.json만 매칭 — {axis}_raw_{YYYYMMDD}.json은 axis 부분이
// "fed_policy_raw" 등으로 잡혀 AXES 화이트리스트에 없으므로 자연스럽게 제외됨
const DAILY_NOTE_RE = /^(.+)_(\d{8})\.json$/;

async function listJsonFiles(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

async function collectNotes() {
  const notes = [];

  for (const file of await listJsonFiles(DAILY_DIR)) {
    const m = file.match(DAILY_NOTE_RE);
    if (!m || !AXES.includes(m[1])) continue;
    try {
      const items = JSON.parse(await fs.readFile(path.join(DAILY_DIR, file), "utf-8"));
      if (Array.isArray(items)) notes.push(...items);
    } catch (err) {
      console.error(`[build-index] skip ${file}: ${err.message}`);
    }
  }

  for (const file of await listJsonFiles(BASELINE_DIR)) {
    try {
      const items = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, file), "utf-8"));
      if (Array.isArray(items)) notes.push(...items);
    } catch (err) {
      console.error(`[build-index] skip baseline/${file}: ${err.message}`);
    }
  }

  return notes;
}

async function main() {
  const notes = await collectNotes();
  notes.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.id ?? "").localeCompare(a.id ?? ""));

  const counts = Object.fromEntries(AXES.map((a) => [a, 0]));
  for (const note of notes) {
    if (note.axis in counts) counts[note.axis]++;
  }

  const index = {
    generated_at: new Date().toISOString(),
    counts,
    notes,
  };

  await fs.writeFile(OUT_PATH, JSON.stringify(index, null, 2));
  console.log(`[build-index] ${notes.length} notes -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
