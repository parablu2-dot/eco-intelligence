// send-mail.mjs
// 메일 발송. SMTP_USER/SMTP_PASS(Gmail 앱 비밀번호)가 있으면 Gmail SMTP로 보낸다 — soc-intelligence와
// 같은 방식이라 도메인 인증 없이 임의 주소(daum 등)로 발송 가능. 없으면 Resend API로 폴백
// (onboarding@resend.dev 테스트 발신은 Resend 계정 소유 주소로만 전달됨).
// 둘 다 없으면 요약 파일 생성까지는 정상 진행하고 발송만 건너뛴다 (fail-soft).

import nodemailer from "nodemailer";

async function sendViaSmtp({ user, pass, recipients, subject, html }) {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // STARTTLS
    auth: { user, pass },
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || `Eco Intelligence <${user}>`,
    to: recipients,
    subject,
    html,
  });
}

async function sendViaResend({ apiKey, recipients, subject, html }) {
  const from = process.env.MAIL_FROM || "Eco Intelligence <onboarding@resend.dev>";
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
}

export async function sendMail({ to, subject, html }) {
  if (!to) {
    // 수신 주소는 repo Secret SUMMARY_MAIL_TO 필수(코드 기본값 없음) — Actions 로그에 에러 표시
    console.log("::error::SUMMARY_MAIL_TO secret not set — mail send skipped");
    throw new Error("SUMMARY_MAIL_TO not set");
  }
  // to: 콤마로 구분된 여러 주소 문자열 지원 (예: "a@x.com, b@y.com")
  const recipients = String(to)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { SMTP_USER, SMTP_PASS, RESEND_API_KEY } = process.env;
  let via;
  if (SMTP_USER && SMTP_PASS) {
    await sendViaSmtp({ user: SMTP_USER, pass: SMTP_PASS, recipients, subject, html });
    via = "smtp";
  } else if (RESEND_API_KEY) {
    await sendViaResend({ apiKey: RESEND_API_KEY, recipients, subject, html });
    via = "resend";
  } else {
    console.log("[send-mail] SMTP_USER/SMTP_PASS·RESEND_API_KEY 모두 미설정 — mail send skipped (summary file already saved)");
    return;
  }

  // 수신 주소는 로그에 남기지 않는다 — 공개 repo의 Actions 로그는 누구나 열람 가능
  console.log(`[send-mail] sent "${subject}" via ${via} -> ${recipients.length} recipient(s)`);
}
