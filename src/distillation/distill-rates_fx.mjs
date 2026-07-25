// distill-rates_fx.mjs
// crawl-rates_fx.mjs가 만든 raw JSON을 읽어, 신규 원문만 Claude API로
// EcoDistillationNote(schema: src/schema/distillation_note.schema.json)로 증류.
// cheon_view.note는 비워둔 채 생성 — 리뷰 단계에서 천이 직접 채움 (검증/추론 분리 원칙).

import fs from "fs/promises";
import path from "path";

const MODEL = "claude-sonnet-5";
const AXIS = "rates_fx";
const DAILY_DIR = path.resolve("data/daily");

const SYSTEM_PROMPT = `너는 거시경제 rates_fx(금리/환율) 축의 distillation 엔진이다.
입력된 연준 공식 통계 발표(H.15 금리, H.10 환율) 원문을 아래 JSON schema에 맞는 단일 객체로만 출력한다.
- facts: 수치·날짜가 포함된 검증 가능한 사실만. 해석/추측 금지.
- cheon_view.stance는 "관망"으로 고정, note는 빈 문자열("")로 둔다. (사람이 리뷰 단계에서 채움)
- keywords: 3~6개, 한국어.
- fed_policy 축과 연관된 판단이면 linked_axes에 "fed_policy"를 포함한다.
- 다른 설명, 마크다운, 코드펜스 없이 JSON 객체만 출력한다.`;

async function distillOne(item, schema) {
  const userPrompt = `axis: rates_fx
title: ${item.title}
published: ${item.published}
source: ${item.source_name} (tier: ${item.source_tier})
url: ${item.url}
raw_summary: ${item.summary_raw}

위 원문을 바탕으로 EcoDistillationNote JSON 객체 하나를 생성해줘.
id는 아무 문자열이나 채워도 됨(시스템이 이후 고유 id로 덮어씀), date는 published 기준(YYYY-MM-DD), source_url은 url 값을 그대로 사용.
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
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.content.find((b) => b.type === "text")?.text ?? "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function main() {
  const schemaPath = path.resolve("src/schema/distillation_note.schema.json");
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rawPath = path.join(DAILY_DIR, `${AXIS}_raw_${today}.json`);

  let rawItems;
  try {
    rawItems = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  } catch {
    console.log(`[distill-rates_fx] no raw file for today: ${rawPath}`);
    return;
  }

  const notes = [];
  let seq = 1;
  for (const item of rawItems) {
    try {
      const note = await distillOne(item, schema);
      // id는 모델이 아닌 코드에서 부여 — 각 원문이 독립 API 호출이라 모델끼리 서로의 id를 모름(충돌 방지)
      note.id = `${today}_${AXIS}_${String(seq).padStart(2, "0")}`;
      seq++;
      notes.push(note);
    } catch (err) {
      console.error(`[distill-rates_fx] failed on ${item.url}: ${err.message}`);
    }
  }

  if (notes.length === 0) {
    console.log("[distill-rates_fx] no notes produced");
    return;
  }

  const outPath = path.join(DAILY_DIR, `${AXIS}_${today}.json`);
  await fs.writeFile(outPath, JSON.stringify(notes, null, 2));
  console.log(`[distill-rates_fx] ${notes.length} notes -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
