// draft-judgment.mjs
// 태깅 + 1차 판단 초안: cheon_view.status === "triaged"인 노트(트리아지 상위 N건)를 찾아
// Claude API로 axis_tag(top_down/bottom_up/time_series) 부여 + draft_judgment(1차 판단 초안)를
// 생성한다. 사람이 아직 검증하지 않은 초안이므로 status: "triaged" -> "drafted"로만 전이하고
// cheon_view.note/stance(사람 리뷰 필드)는 건드리지 않는다.
//
// 이번 주는 자동 cron 실행 보류(수동 검증) — package.json에 스크립트만 등록하고
// 워크플로에는 연결하지 않음. 다음 단계에서 패턴 확인 후 자동화 여부 재결정.
// (자관_ECO애널리스트_ClaudeCode스펙_v1.0 §3, §5)

import fs from "fs/promises";
import path from "path";

const MODEL = "claude-sonnet-5";
const DAILY_DIR = path.resolve("data/daily");
// build-index.mjs/score-notes.mjs와 동일 규칙: {axis}_{YYYYMMDD}.json만(raw 제외)
const DAILY_NOTE_RE = /^(.+)_(\d{8})\.json$/;
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

const SYSTEM_PROMPT = `너는 거시경제 노트에 "판단축(axis_tag)"을 부여하고 1차 판단 초안(draft_judgment)을 쓰는 엔진이다.
3개 판단축 정의:
- top_down: 정책/트렌드가 위에서 아래로(정부·중앙은행·규제기관 → 시장) 방향성을 만드는 사건
- bottom_up: 개별 사건이 인과적으로(A→B) 파급되어 상위 흐름에 영향을 주는 사건
- time_series: 리드타임/일정/주기가 핵심인, 시간축으로 추적해야 의미가 드러나는 사건

규칙:
- 입력된 노트(headline+facts+keywords)를 보고 위 3축 중 가장 근거가 뚜렷한 축 하나만 axis_tag로 고른다.
- 3축 모두 근거가 부족하면(사실만 나열되고 방향성/인과/시계열 중 어느 것도 명확하지 않으면) axis_tag는 null로 두고,
  draft_judgment 맨 앞에 "[미검증]"을 붙여 유보 상태임을 명시한다.
- draft_judgment는 2~4문장 한국어. 사람(천)이 검증하기 전 초안이라는 점을 감안해 단정적 어투 대신
  "~로 보인다", "~일 가능성이 있다" 같은 유보적 어투를 쓴다. 추측은 facts에 근거해서만 한다.
- 다른 설명, 마크다운, 코드펜스 없이 아래 schema의 JSON 객체만 출력한다.
schema: { "axis_tag": "top_down" | "bottom_up" | "time_series" | null, "draft_judgment": "string" }`;

async function judgeOne(note) {
  const userPrompt = `axis(topic): ${note.axis}
headline: ${note.headline}
facts:
${(note.facts ?? []).map((f) => `- ${f}`).join("\n")}
keywords: ${(note.keywords ?? []).join(", ")}
triage_score: ${note.cheon_view?.triage_score ?? "?"}

위 노트에 axis_tag와 draft_judgment를 부여해줘.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
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

async function listJsonFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[draft-judgment] ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  let processed = 0;
  let failed = 0;

  for (const file of await listJsonFiles(DAILY_DIR)) {
    const m = file.match(DAILY_NOTE_RE);
    if (!m || !AXES.includes(m[1])) continue;

    const filePath = path.join(DAILY_DIR, file);
    let items;
    try {
      items = JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch (err) {
      console.error(`[draft-judgment] skip ${file}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(items)) continue;

    let changed = false;
    for (const note of items) {
      if (note.cheon_view?.status !== "triaged") continue;
      try {
        const { axis_tag, draft_judgment } = await judgeOne(note);
        note.cheon_view.axis_tag = axis_tag ?? null;
        note.cheon_view.draft_judgment = draft_judgment ?? null;
        note.cheon_view.status = "drafted";
        changed = true;
        processed++;
        console.log(`  - ${note.id} -> axis_tag=${axis_tag ?? "null"}`);
      } catch (err) {
        failed++;
        console.error(`[draft-judgment] failed on ${note.id}: ${err.message}`);
      }
    }

    if (changed) {
      await fs.writeFile(filePath, JSON.stringify(items, null, 2));
    }
  }

  console.log(`[draft-judgment] ${processed} note(s) drafted, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
