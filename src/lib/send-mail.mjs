// send-mail.mjs
// Resend API(https://resend.com)로 메일 발송. RESEND_API_KEY 미등록 시
// 요약 파일 생성까지는 정상 진행하고 발송만 건너뛴다 (fail-soft).

export async function sendMail({ to, subject, html }) {
  if (!to) {
    // 수신 주소는 repo Variable SUMMARY_MAIL_TO 필수(코드 기본값 없음) — Actions 로그에 에러 표시
    console.log("::error::SUMMARY_MAIL_TO variable not set — mail send skipped");
    throw new Error("SUMMARY_MAIL_TO not set");
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[send-mail] RESEND_API_KEY not set — mail send skipped (summary file already saved)");
    return;
  }

  const from = process.env.MAIL_FROM || "Eco Intelligence <onboarding@resend.dev>";
  // to: 콤마로 구분된 여러 주소 문자열 지원 (예: "a@x.com, b@y.com")
  const recipients = String(to)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: recipients, subject, html }),
  });

  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${await res.text()}`);
  }

  // 수신 주소는 로그에 남기지 않는다 — 공개 repo의 Actions 로그는 누구나 열람 가능
  console.log(`[send-mail] sent "${subject}" -> ${recipients.length} recipient(s)`);
}
