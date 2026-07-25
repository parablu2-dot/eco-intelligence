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

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function main() {
  const parser = new Parser();
  const seen = await loadSeen();
  const fresh = [];

  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      // 일부 공공기관 피드가 &nbsp; 등 HTML entity를 이스케이프 없이 내보내 strict XML 파싱이 깨짐 → 사전 정제
      const clean = raw.replace(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g, "&amp;");
      const feed = await parser.parseString(clean);
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

  await fs.mkdir(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const outPath = path.join(OUT_DIR, `${AXIS}_raw_${today}.json`);

  if (fresh.length === 0) {
    console.log("[crawl-fed] no new items");
    // 같은 날 앞선 실행이 남긴 raw 파일이 있으면 지운다 — 안 지우면 distill이
    // "오늘자 raw 파일 존재"만 보고 이미 시도했던 원문을 다시 처리하게 됨
    await fs.unlink(outPath).catch(() => {});
    return;
  }

  await fs.writeFile(outPath, JSON.stringify(fresh, null, 2));
  await saveSeen(seen);

  console.log(`[crawl-fed] ${fresh.length} new items -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
