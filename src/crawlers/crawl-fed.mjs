// crawl-fed.mjs
// fed_policy 축 파일럿 크롤러: 연준 공식 RSS만 수집 (allowlist = 1차 소스 한정)
// 원칙: SoC 대시보드 크롤러와 동일하게 "권위 소스 allowlist 통과분만" 채택

import Parser from "rss-parser";
import fs from "fs/promises";
import path from "path";

const AXIS = "fed_policy";

// 1차 소스만 (연준 공식). 추후 Reuters/Bloomberg 등 2차 소스 추가 시
// source_tier: "primary" | "secondary" 로 구분해서 신뢰도 축약 유지.
const SOURCES = [
  {
    name: "Federal Reserve - Press Releases",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    tier: "primary",
  },
  {
    name: "Federal Reserve - Monetary Policy",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
    tier: "primary",
  },
];

const OUT_DIR = path.resolve("data/daily");
const SEEN_PATH = path.resolve("data", "seen_urls.json");

async function loadSeen() {
  try {
    const raw = await fs.readFile(SEEN_PATH, "utf-8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveSeen(seenSet) {
  await fs.mkdir(path.dirname(SEEN_PATH), { recursive: true });
  await fs.writeFile(SEEN_PATH, JSON.stringify([...seenSet], null, 2));
}

async function main() {
  const parser = new Parser();
  const seen = await loadSeen();
  const fresh = [];

  for (const source of SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items) {
        const url = item.link;
        if (!url || seen.has(url)) continue;
        fresh.push({
          axis: AXIS,
          source_name: source.name,
          source_tier: source.tier,
          title: item.title?.trim() ?? "",
          summary_raw: (item.contentSnippet || item.content || "").trim(),
          published: item.pubDate ?? null,
          url,
        });
        seen.add(url);
      }
    } catch (err) {
      // 소스 하나가 실패해도 파이프라인 전체를 죽이지 않음 (fail-soft)
      console.error(`[crawl-fed] source failed: ${source.name} — ${err.message}`);
    }
  }

  if (fresh.length === 0) {
    console.log("[crawl-fed] no new items");
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const outPath = path.join(OUT_DIR, `${AXIS}_raw_${today}.json`);
  await fs.writeFile(outPath, JSON.stringify(fresh, null, 2));
  await saveSeen(seen);

  console.log(`[crawl-fed] ${fresh.length} new items -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
