// mail-template.mjs
// daily/weekly summary 메일 HTML 렌더링 공유 헬퍼. 이메일 클라이언트 호환을 위해 인라인 스타일만 사용.

const AXIS_LABEL = {
  geopolitics: "지정학적 리스크",
  polarization: "양극화",
  fed_policy: "연준/통화정책",
  productivity_ai: "생산성(AI)",
  us_investment: "미국 투자",
  rates_fx: "금리/환율",
  commodities_energy: "원자재/에너지",
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function renderSummaryMailHtml({ title, subtitle, points, axisCounts }) {
  const pointsHtml = points
    .map(
      (p, i) => `
      <div style="margin-bottom:18px;padding:14px 16px;border-left:3px solid #0b0b0b;background:#f9f9f7;border-radius:0 8px 8px 0;">
        <div style="font-size:12px;color:#898781;margin-bottom:4px;">POINT ${i + 1}</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:6px;">${escapeHtml(p.title)}</div>
        <div style="font-size:14px;color:#333;line-height:1.6;">${escapeHtml(p.body)}</div>
        ${
          p.axes?.length
            ? `<div style="margin-top:8px;">${p.axes
                .map(
                  (a) =>
                    `<span style="display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid #c3c2b7;color:#52514e;margin-right:4px;">${escapeHtml(
                      AXIS_LABEL[a] ?? a
                    )}</span>`
                )
                .join("")}</div>`
            : ""
        }
      </div>`
    )
    .join("");

  const countsHtml = axisCounts
    ? Object.entries(axisCounts)
        .map(([axis, count]) => `<span style="display:inline-block;font-size:12px;color:#52514e;margin-right:12px;">${escapeHtml(AXIS_LABEL[axis] ?? axis)} ${count}</span>`)
        .join("")
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f9f9f7;font-family:-apple-system,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <h1 style="font-size:20px;margin:0 0 4px;color:#0b0b0b;">${escapeHtml(title)}</h1>
    <p style="font-size:13px;color:#898781;margin:0 0 20px;">${escapeHtml(subtitle)}</p>
    ${pointsHtml}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e1e0d9;">${countsHtml}</div>
    <p style="font-size:11px;color:#898781;margin-top:24px;">Eco Intelligence Dashboard 자동 발송 메일</p>
  </div>
</body>
</html>`;
}
