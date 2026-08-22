// daily-summary.mjs
// 그날 distill된 7축 노트를 모아 Claude API로 핵심 3꼭지로 종합하고,
// data/summary/daily_{YYYYMMDD}.json(+ daily_latest.json)에 저장한 뒤 메일로 발송.
// 축별 crawl/distill 워크플로가 모두 끝난 뒤(07:40 KST) 실행되도록 예약됨.

import fs from "fs/promises";
import path from "path";
import { todayCompact, loadNotesForDates, countByAxis } from "../lib/notes.mjs";
import { sendMail } from "../lib/send-mail.mjs";
import { renderSummaryMailHtml } from "../lib/mail-template.mjs";
import { loadCoreIndicators, loadActiveAlerts } from "../indicators/core-snapshot.mjs";

const MODEL = "claude-sonnet-5";
const SUMMARY_DIR = path.resolve("data/summary");
const MAIL_TO = process.env.SUMMARY_MAIL_TO || "parablu2@gmail.com";

const SYSTEM_PROMPT = `너는 거시경제 7축(지정학·양극화·연준통화정책·생산성AI·미국투자·금리환율·원자재에너지) 대시보드의
일일 요약 엔진이다. 입력된 그날의 축별 distillation 노트들을 종합해 정확히 3개의 핵심 꼭지로 요약한다.
- 개별 축을 그냥 나열하지 말고, 축을 가로지르는 흐름이나 연결(예: 연준 발언이 금리/환율에 미치는 영향)을 우선 포착한다.
- 오늘 특별히 주목할 만한 신호가 3개 미만이면 억지로 채우지 말고 있는 만큼만 담아도 된다.
- 각 꼭지는 title(1줄 헤드라인)과 body(2~3문장, 근거가 된 사실 포함), axes(관련 축 id 배열)로 구성.
- 다른 설명, 마크다운, 코드펜스 없이 JSON 객체만 출력한다: {"points":[{"title":"","body":"","axes":["axis_id"]}]}`;

async function synthesize(notes, date) {
  const userPrompt = `date: ${date}

${notes.map((n) => `[${n.axis}] ${n.headline}\nfacts: ${(n.facts ?? []).join(" / ")}`).join("\n\n")}

위 노트들을 바탕으로 오늘의 핵심 3꼭지를 JSON으로 생성해줘.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3072,
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

async function main() {
  const dateCompact = todayCompact();
  const date = `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}`;

  const notes = await loadNotesForDates([dateCompact]);
  if (notes.length === 0) {
    console.log("[daily-summary] no notes today, skip");
    return;
  }

  const points = await synthesize(notes, date);
  const summary = {
    type: "daily",
    date,
    generated_at: new Date().toISOString(),
    axis_counts: countByAxis(notes),
    // 인과사슬지도 5대 핵심 지표(잔존율·USD/KRW·KOSPI·미30년물·USD/JPY) 스냅샷 + 알림.
    // 지표 데이터 없어도(수집 실패 등) fail-soft로 빈 배열만 나오고 요약 자체는 계속 진행.
    key_indicators: await loadCoreIndicators(),
    alerts: await loadActiveAlerts(),
    points,
  };

  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(path.join(SUMMARY_DIR, `daily_${dateCompact}.json`), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(SUMMARY_DIR, "daily_latest.json"), JSON.stringify(summary, null, 2));
  console.log(`[daily-summary] ${points.length} points -> daily_${dateCompact}.json`);

  const html = renderSummaryMailHtml({
    title: `Eco Intelligence Daily Summary — ${date}`,
    subtitle: "거시경제 7축 오늘의 핵심 요약",
    points,
    axisCounts: summary.axis_counts,
  });

  try {
    await sendMail({ to: MAIL_TO, subject: `[Eco Intelligence] ${date} Daily Summary`, html });
  } catch (err) {
    // 메일 발송 실패해도 요약 파일은 이미 저장됨 — 워크플로 자체를 실패시키지 않음
    console.error(`[daily-summary] mail send failed: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
