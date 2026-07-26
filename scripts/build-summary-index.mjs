// build-summary-index.mjs
// data/summary/daily_*.json + weekly_*.json(각 latest 제외)을 모아 프론트가 한 번의 fetch로
// 읽을 수 있는 data/summary/index.json을 생성한다. summary 스크립트 실행 이후, git commit 이전에 실행.

import fs from "fs/promises";
import path from "path";

const SUMMARY_DIR = path.resolve("data/summary");
const OUT_PATH = path.join(SUMMARY_DIR, "index.json");

const DAILY_RE = /^daily_(\d{8})\.json$/;
const WEEKLY_RE = /^weekly_(\d{8})\.json$/;

async function listJsonFiles(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

async function collect(re) {
  const items = [];
  for (const file of await listJsonFiles(SUMMARY_DIR)) {
    if (!re.test(file)) continue;
    try {
      items.push(JSON.parse(await fs.readFile(path.join(SUMMARY_DIR, file), "utf-8")));
    } catch (err) {
      console.error(`[build-summary-index] skip ${file}: ${err.message}`);
    }
  }
  return items;
}

async function main() {
  const daily = await collect(DAILY_RE);
  const weekly = await collect(WEEKLY_RE);

  daily.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  weekly.sort((a, b) => (b.week_end ?? "").localeCompare(a.week_end ?? ""));

  const index = {
    generated_at: new Date().toISOString(),
    daily,
    weekly,
  };

  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(index, null, 2));
  console.log(`[build-summary-index] ${daily.length} daily, ${weekly.length} weekly -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
