// send-mail.mjs
// Resend API(https://resend.com)로 메일 발송. RESEND_API_KEY 미등록 시
// 요약 파일 생성까지는 정상 진행하고 발송만 건너뛴다 (fail-soft).

export async function sendMail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[send-mail] RESEND_API_KEY not set — mail send skipped (summary file already saved)");
    return;
  }

  const from = process.env.MAIL_FROM || "Eco Intelligence <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${await res.text()}`);
  }

  console.log(`[send-mail] sent "${subject}" -> ${to}`);
}
