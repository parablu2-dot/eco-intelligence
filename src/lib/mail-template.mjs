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

// 지표 경보(임계값 판정) 섹션 — 메일 본문 전용. 판정 결과는 파일로 저장하지 않는다(T0).
function renderAlertsHtml(alerts) {
  if (!alerts?.length) return "";
  const rows = alerts
    .map((a) => {
      const change = typeof a.week_change_pct === "number" ? ` (주간 ${a.week_change_pct.toFixed(1)}%)` : "";
      return `<li style="margin-bottom:4px;"><b>${escapeHtml(a.alert_label)}</b> — ${escapeHtml(a.label)}: ${escapeHtml(a.value)}${escapeHtml(a.unit ?? "")}${escapeHtml(change)} (${escapeHtml(a.value_date ?? "")})</li>`;
    })
    .join("");
  return `<div style="margin-bottom:20px;padding:12px 16px;border:1px solid #d9a441;background:#fdf6e7;border-radius:8px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">지표 경보</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#333;">${rows}</ul>
    </div>`;
}

// 수집 상태(T4) 섹션 — fail/warn이 있을 때만. 근거는 data/health/latest.json(check-health.mjs).
export function renderHealthHtml(health) {
  if (!health || health.status === "ok") return "";
  const isFail = health.status === "fail";
  const rows = health.checks
    .map((c) => {
      const badge = c.level === "fail" ? "실패" : "경고";
      const color = c.level === "fail" ? "#b42318" : "#8a5a00";
      return `<li style="margin-bottom:4px;"><b style="color:${color};">${badge}</b> ${escapeHtml(AXIS_LABEL[c.target] ?? c.target)} — ${escapeHtml(c.message)}</li>`;
    })
    .join("");
  return `<div style="margin-bottom:20px;padding:12px 16px;border:1px solid ${isFail ? "#e5a39b" : "#d9a441"};background:${isFail ? "#fdf0ee" : "#fdf6e7"};border-radius:8px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">수집 상태 — 실패 ${health.fail_count} · 경고 ${health.warn_count}</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#333;">${rows}</ul>
    </div>`;
}

export function renderSummaryMailHtml({ title, subtitle, points, axisCounts, alerts, health }) {
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
    ${renderHealthHtml(health)}
    ${renderAlertsHtml(alerts)}
    ${pointsHtml}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e1e0d9;">${countsHtml}</div>
    <p style="font-size:11px;color:#898781;margin-top:24px;">Eco Intelligence Dashboard 자동 발송 메일</p>
  </div>
</body>
</html>`;
}
