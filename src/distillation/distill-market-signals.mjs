// distill-market-signals.mjs
// market_signals 축 전용: crawl-indicators.mjs가 만든 수치(data/indicators/*.json)를
// 전일/전주 값과 비교해 10%+ 변동을 탐지하고, Claude API(web_search 툴)로 원인 초안을 붙여
// EcoDistillationNote로 저장한다.
// cheon_view.note는 비워둔 채 생성 — 리뷰 단계에서 천이 직접 채움 (검증/추론 분리 원칙, 기존 축과 동일).
// 다른 distill-*.mjs와 달리 원문 크롤링이 아니라 수치 anomaly가 트리거라는 점만 다르다.

import fs from "fs/promises";
import path from "path";
import { applyCheonViewDefaults } from "../lib/cheon-view-defaults.mjs";

const MODEL = "claude-sonnet-5";
const AXIS = "market_signals";
const INDICATORS_DIR = path.resolve("data/indicators");
const DAILY_DIR = path.resolve("data/daily");
const THRESHOLD_PCT = 10;

function compactDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function loadIndicators(dateCompact) {
  try {
    const raw = await fs.readFile(path.join(INDICATORS_DIR, `${dateCompact}.json`), "utf-8");
    return JSON.parse(raw).indicators ?? [];
  } catch {
    return null; // 파일 없음 — 정상 (fail-soft)
  }
}

function pctChange(curr, prev) {
  if (prev === null || prev === undefined || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

async function findAnomalies(today, todayCompact) {
  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setUTCDate(today.getUTCDate() - 7);

  const current = await loadIndicators(todayCompact);
  if (!current) {
    console.log("[distill-market-signals] no indicators for today");
    return [];
  }

  const prevDay = await loadIndicators(compactDate(yesterday));
  const prevWeek = await loadIndicators(compactDate(weekAgo));

  const anomalies = [];
  for (const ind of current.filter((i) => i.axis === AXIS)) {
    const dayMatch = prevDay?.find((p) => p.series_id === ind.series_id && p.axis === AXIS);
    const weekMatch = prevWeek?.find((p) => p.series_id === ind.series_id && p.axis === AXIS);
    const dayPct = dayMatch ? pctChange(ind.value, dayMatch.value) : null;
    const weekPct = weekMatch ? pctChange(ind.value, weekMatch.value) : null;

    const trigger =
      (dayPct !== null && Math.abs(dayPct) >= THRESHOLD_PCT && "day") ||
      (weekPct !== null && Math.abs(weekPct) >= THRESHOLD_PCT && "week");

    if (trigger) {
      anomalies.push({ ...ind, dayPct, weekPct, trigger });
    }
  }
  return anomalies;
}

const SYSTEM_PROMPT = `너는 market_signals(주가/환율/채권) 축의 급변 원인 distillation 엔진이다.
입력된 종목/지표의 10%+ 단기 변동 사실을 받아, 웹 검색으로 최근 뉴스를 확인한 뒤
아래 JSON schema에 맞는 단일 객체로만 출력한다.
- facts: 검증 가능한 사실(수치·날짜·출처 포함)만. 추측 금지.
- headline: 어떤 지표가 며칠새 몇 % 움직였는지 1줄 요약.
- cheon_view.stance는 "관망"으로 고정, note는 빈 문자열("")로 둔다.
- keywords: 3~6개, 한국어.
- 이 변동이 Fundamental(실적/정책 발표)에 의한 것인지, 아니면 무관해 보이는 외부 충격(뉴스/지정학/투기)인지
  반드시 facts 항목 중 하나에 명시한다.
- 다른 설명, 마크다운, 코드펜스 없이 JSON 객체만 출력한다.`;

async function distillAnomaly(anomaly, schema, todayCompact) {
  const changeDesc =
    anomaly.trigger === "day"
      ? `전일 대비 ${anomaly.dayPct.toFixed(1)}%`
      : `전주 대비 ${anomaly.weekPct.toFixed(1)}%`;

  const dateStr = `${todayCompact.slice(0, 4)}-${todayCompact.slice(4, 6)}-${todayCompact.slice(6, 8)}`;

  const userPrompt = `axis: market_signals
label: ${anomaly.label}
source: ${anomaly.source} (series_id: ${anomaly.series_id})
current value: ${anomaly.value} (${anomaly.date})
변동: ${changeDesc}
source_url: ${anomaly.source_url}

이 급변의 원인을 웹 검색으로 확인하고 EcoDistillationNote JSON 객체 하나를 생성해줘.
id는 아무 문자열이나 채워도 됨(시스템이 이후 고유 id로 덮어씀), date는 ${dateStr}, source_url은 위 값을 그대로 사용.
schema:
${JSON.stringify(schema)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function main() {
  const schemaPath = path.resolve("src/schema/distillation_note.schema.json");
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));

  const today = new Date();
  const todayCompact = compactDate(today);

  const anomalies = await findAnomalies(today, todayCompact);
  if (anomalies.length === 0) {
    console.log(`[distill-market-signals] no anomalies (>=${THRESHOLD_PCT}%) today`);
    return;
  }

  const notes = [];
  let seq = 1;
  for (const a of anomalies) {
    try {
      const note = await distillAnomaly(a, schema, todayCompact);
      // id는 모델이 아닌 코드에서 부여 — 각 anomaly가 독립 API 호출이라 서로의 id를 모름(충돌 방지)
      note.id = `${todayCompact}_${AXIS}_${String(seq).padStart(2, "0")}`;
      applyCheonViewDefaults(note);
      seq++;
      notes.push(note);
    } catch (err) {
      console.error(`[distill-market-signals] failed on ${a.label}: ${err.message}`);
    }
  }

  if (notes.length === 0) {
    console.log("[distill-market-signals] no notes produced");
    return;
  }

  const outPath = path.join(DAILY_DIR, `${AXIS}_${todayCompact}.json`);
  await fs.writeFile(outPath, JSON.stringify(notes, null, 2));
  console.log(`[distill-market-signals] ${notes.length} notes -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
