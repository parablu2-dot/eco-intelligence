// weekly-summary.mjs
// 지난 7일(오늘 포함)간 distill된 7축 노트 전체를 모아 Claude API로 핵심 5꼭지로 종합하고,
// data/summary/weekly_{YYYYMMDD}.json(+ weekly_latest.json)에 저장한 뒤 메일로 발송.
// 매주 월요일 07:50 KST 실행되도록 예약됨 (직전 7일 = 지난주 전체).

import fs from "fs/promises";
import path from "path";
import { todayCompact, lastNDatesCompact, loadNotesForDates, countByAxis } from "../lib/notes.mjs";
import { sendMail } from "../lib/send-mail.mjs";
import { renderSummaryMailHtml } from "../lib/mail-template.mjs";

const MODEL = "claude-sonnet-5";
const SUMMARY_DIR = path.resolve("data/summary");
const MAIL_TO = process.env.SUMMARY_MAIL_TO || "parablu2@gmail.com";

const SYSTEM_PROMPT = `너는 거시경제 7축(지정학·양극화·연준통화정책·생산성AI·미국투자·금리환율·원자재에너지) 대시보드의
주간 요약 엔진이다. 입력된 지난 7일치 축별 distillation 노트 전체를 종합해 정확히 5개의 핵심 꼭지로 요약한다.
- 하루짜리 뉴스가 아니라 일주일 흐름에서 반복되거나 방향성이 뚜렷한 신호를 우선 포착한다.
- 여러 축에 걸쳐 서로 연결되는 흐름(예: 연준 긴축 기조 유지 + 금리 상승 + 원자재 약세)을 우선순위로 삼는다.
- 각 꼭지는 title(1줄 헤드라인)과 body(2~4문장, 근거가 된 사실 포함), axes(관련 축 id 배열)로 구성.
- 다른 설명, 마크다운, 코드펜스 없이 JSON 객체만 출력한다: {"points":[{"title":"","body":"","axes":["axis_id"]}]}`;

async function synthesize(notes, weekStart, weekEnd) {
  const userPrompt = `week: ${weekStart} ~ ${weekEnd}

${notes.map((n) => `[${n.axis}] (${n.date}) ${n.headline}\nfacts: ${(n.facts ?? []).join(" / ")}`).join("\n\n")}

위 노트들을 바탕으로 이번 주의 핵심 5꼭지를 JSON으로 생성해줘.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6144,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = data.content.find((b) => b.type === "text")?.text ?? "";
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean).points;
  } catch (err) {
    // "Unterminated string in JSON"은 대부분 max_tokens 도달로 응답이 중간에
    // 잘렸다는 뜻 — stop_reason과 원문을 그대로 로그에 남겨 다음 실행에서 바로 판단 가능하게 함
    throw new Error(
      `JSON parse 실패 (stop_reason: ${data.stop_reason}): ${err.message}\n--- raw text (${clean.length} chars) ---\n${clean}`
    );
  }
}

function toIsoDate(compact) {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

async function main() {
  const datesCompact = lastNDatesCompact(7); // [오늘, ..., 6일전] 내림차순
  const weekEndCompact = todayCompact();
  const weekStart = toIsoDate(datesCompact[datesCompact.length - 1]);
  const weekEnd = toIsoDate(datesCompact[0]);

  const notes = await loadNotesForDates(datesCompact);
  if (notes.length === 0) {
    console.log("[weekly-summary] no notes in the past 7 days, skip");
    return;
  }

  const points = await synthesize(notes, weekStart, weekEnd);
  const summary = {
    type: "weekly",
    week_start: weekStart,
    week_end: weekEnd,
    generated_at: new Date().toISOString(),
    axis_counts: countByAxis(notes),
    note_count: notes.length,
    points,
  };

  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(path.join(SUMMARY_DIR, `weekly_${weekEndCompact}.json`), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(SUMMARY_DIR, "weekly_latest.json"), JSON.stringify(summary, null, 2));
  console.log(`[weekly-summary] ${points.length} points -> weekly_${weekEndCompact}.json`);

  const html = renderSummaryMailHtml({
    title: `Eco Intelligence Weekly Summary — ${weekStart} ~ ${weekEnd}`,
    subtitle: `거시경제 7축 이번 주 핵심 요약 (총 ${notes.length}건 기반)`,
    points,
    axisCounts: summary.axis_counts,
  });

  try {
    await sendMail({ to: MAIL_TO, subject: `[Eco Intelligence] Weekly Summary ${weekStart} ~ ${weekEnd}`, html });
  } catch (err) {
    console.error(`[weekly-summary] mail send failed: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
