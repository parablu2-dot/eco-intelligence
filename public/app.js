const AXES = [
  { id: "geopolitics", label: "지정학적 리스크" },
  { id: "polarization", label: "양극화" },
  { id: "fed_policy", label: "연준/통화정책" },
  { id: "productivity_ai", label: "생산성(AI)" },
  { id: "us_investment", label: "미국 투자" },
  { id: "rates_fx", label: "금리/환율" },
  { id: "commodities_energy", label: "원자재/에너지" },
  { id: "market_signals", label: "주가/환율/채권" },
];
const AXIS_LABEL = Object.fromEntries(AXES.map((a) => [a.id, a.label]));

const state = {
  notes: [],
  counts: {},
  axisFilter: null,
  search: "",
  stance: "",
  indicators: [],
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function axisDot(axisId) {
  return `<span class="dot" style="background:var(--series-${axisId})"></span>`;
}

const STATUS_LABEL = {
  pending: "대기",
  triaged: "선별",
  drafted: "초안",
  approved: "승인",
  rejected: "반려",
};

function statusBadge(status) {
  const s = status ?? "pending";
  return `<span class="status-badge" data-status="${escapeHtml(s)}">${escapeHtml(STATUS_LABEL[s] ?? s)}</span>`;
}

// "이번 주"(최근 7일, 오늘 포함) 노트 중 트리아지 파이프라인 리뷰율(%) = (approved+rejected) / triaged 이상 단계 도달 건수
// 분모는 "triaged"로 승격된 적 있는 노트 전체(triaged/drafted/approved/rejected) — pending인 채로 남은 노트는 제외
function computeReviewRate(notes) {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const sinceStr = since.toISOString().slice(0, 10);

  const inWindow = notes.filter((n) => (n.date ?? "") >= sinceStr);
  const triagedOrLater = inWindow.filter((n) =>
    ["triaged", "drafted", "approved", "rejected"].includes(n.cheon_view?.status)
  );
  const reviewed = inWindow.filter((n) => ["approved", "rejected"].includes(n.cheon_view?.status));

  if (triagedOrLater.length === 0) return null;
  return Math.round((reviewed.length / triagedOrLater.length) * 100);
}

function formatIndicatorValue(v, unit) {
  if (typeof v !== "number") return "-";
  if (unit === "KRW") return v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  if (unit === "%") return v.toFixed(2);
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// 인과사슬지도 임계값(config/indicator-thresholds.json) 알림 — alert_flag=true 항목만 상단에 노출.
// 임계값은 가안(딥리서치 초안) — 토요일 세션에서 천이 확정 전까지 참고용.
function renderAlertsRow() {
  const el = document.getElementById("alertsRow");
  if (!el) return;
  const alerts = state.indicators.filter((ind) => ind.alert_flag);
  if (alerts.length === 0) {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  el.innerHTML =
    `<div class="alerts-title">이번 주 알림</div>` +
    alerts
      .map(
        (a) => `<div class="alert-tile">
      <span class="alert-label">${escapeHtml(a.alert_label ?? "알림")}</span>
      <span class="alert-detail">${escapeHtml(a.label)} ${formatIndicatorValue(a.value, a.unit)}${escapeHtml(a.unit ?? "")}</span>
    </div>`
      )
      .join("");
}

function renderIndicatorRow() {
  const el = document.getElementById("indicatorRow");
  if (!el) return;
  if (state.indicators.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = state.indicators
    .map(
      (ind) => `<a class="indicator-tile" href="${escapeHtml(ind.source_url ?? "#")}" target="_blank" rel="noopener">
      <div class="i-label">${axisDot(ind.axis)}${escapeHtml(ind.label)}</div>
      <div class="i-value">${formatIndicatorValue(ind.value, ind.unit)}<span class="i-unit">${escapeHtml(ind.unit ?? "")}</span></div>
      <div class="i-date">${escapeHtml(ind.date ?? "")} · ${escapeHtml(ind.source ?? "")}</div>
    </a>`
    )
    .join("");
}

function renderKpiRow() {
  const el = document.getElementById("kpiRow");
  const tiles = AXES.map((a) => {
    const count = state.counts[a.id] ?? 0;
    const active = state.axisFilter === a.id ? "active" : "";
    return `<button class="kpi-tile ${active}" data-axis="${a.id}">
      <div class="label">${axisDot(a.id)}${escapeHtml(a.label)}</div>
      <div class="value">${count}</div>
    </button>`;
  }).join("");

  const reviewRate = computeReviewRate(state.notes);
  const reviewTile = `<div class="kpi-tile kpi-tile-static">
    <div class="label">이번 주 리뷰율</div>
    <div class="value">${reviewRate === null ? "–" : `${reviewRate}%`}</div>
  </div>`;

  el.innerHTML = tiles + reviewTile;
  el.querySelectorAll("button.kpi-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const axis = btn.dataset.axis;
      state.axisFilter = state.axisFilter === axis ? null : axis;
      render();
    });
  });
}

function noteCard(note) {
  const factsHtml = (note.facts ?? []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const keywordsHtml = (note.keywords ?? []).map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join("");
  const linkedHtml = (note.linked_axes ?? [])
    .map((a) => `<span class="chip">↔ ${escapeHtml(AXIS_LABEL[a] ?? a)}</span>`)
    .join("");
  const note_ = note.cheon_view?.note?.trim();
  const reviewHtml = note_
    ? `<div class="review-note">${escapeHtml(note_)}</div>`
    : `<div class="review-note empty">리뷰 대기 — 아직 견해가 채워지지 않음</div>`;

  const axisTagHtml = note.cheon_view?.axis_tag
    ? `<span class="chip">축: ${escapeHtml(note.cheon_view.axis_tag)}</span>`
    : "";
  const draftJudgment = note.cheon_view?.draft_judgment?.trim();
  const draftHtml = draftJudgment
    ? `<div class="draft-judgment"><span class="draft-label">1차 판단 초안(미검증)</span>${escapeHtml(draftJudgment)}</div>`
    : "";
  const rejectReason = note.cheon_view?.reject_reason?.trim();
  const rejectHtml = rejectReason ? `<div class="reject-reason">반려 사유: ${escapeHtml(rejectReason)}</div>` : "";

  return `<article class="card">
    <div class="meta">
      <span class="axis-badge">${axisDot(note.axis)}${escapeHtml(AXIS_LABEL[note.axis] ?? note.axis)}</span>
      ${statusBadge(note.cheon_view?.status)}
      <span>${escapeHtml(note.date ?? "")}</span>
    </div>
    <h3>${escapeHtml(note.headline ?? "(제목 없음)")}</h3>
    <ul class="facts">${factsHtml}</ul>
    <div class="chips">${keywordsHtml}${linkedHtml}${axisTagHtml}</div>
    <span class="stance-chip">stance: ${escapeHtml(note.cheon_view?.stance ?? "-")}</span>
    ${draftHtml}
    ${reviewHtml}
    ${rejectHtml}
    ${note.source_url ? `<a class="source-link" href="${escapeHtml(note.source_url)}" target="_blank" rel="noopener">원문 보기 →</a>` : ""}
  </article>`;
}

function filteredNotes() {
  const q = state.search.trim().toLowerCase();
  return state.notes.filter((n) => {
    if (state.axisFilter && n.axis !== state.axisFilter) return false;
    if (state.stance && n.cheon_view?.stance !== state.stance) return false;
    if (q) {
      const hay = [n.headline, ...(n.keywords ?? []), ...(n.facts ?? [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render() {
  renderAlertsRow();
  renderIndicatorRow();
  renderKpiRow();
  const notes = filteredNotes();
  document.getElementById("countLine").textContent = `${notes.length}건 표시 중 (전체 ${state.notes.length}건)`;
  const cardsEl = document.getElementById("cards");
  const emptyEl = document.getElementById("emptyState");
  if (notes.length === 0) {
    cardsEl.innerHTML = "";
    emptyEl.style.display = "block";
  } else {
    emptyEl.style.display = "none";
    cardsEl.innerHTML = notes.map(noteCard).join("");
  }
}

async function main() {
  try {
    const res = await fetch("/data/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.notes = data.notes ?? [];
    state.counts = data.counts ?? {};
    document.getElementById("updated").textContent = data.generated_at
      ? `마지막 갱신: ${new Date(data.generated_at).toLocaleString("ko-KR")}`
      : "";
  } catch (err) {
    document.getElementById("updated").textContent = `데이터 로드 실패: ${err.message}`;
  }

  try {
    const indRes = await fetch("/data/indicators/latest.json", { cache: "no-store" });
    if (indRes.ok) {
      const indData = await indRes.json();
      state.indicators = indData.indicators ?? [];
    }
  } catch {
    // 지표 데이터는 선택적 — 없어도 대시보드 나머지 기능에 영향 없음
  }

  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.search = e.target.value;
    render();
  });
  document.getElementById("stanceSelect").addEventListener("change", (e) => {
    state.stance = e.target.value;
    render();
  });

  render();
}

main();
