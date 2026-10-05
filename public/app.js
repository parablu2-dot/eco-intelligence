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

// 일간 지표가 3일 넘게 묵었으면 기준일 옆에 표시(주말·연휴 1~3일은 정상 범위). 월/분기/연 지표는 표시 안 함.
function lagNote(ind) {
  const stale = (ind.frequency ?? "D") === "D" && typeof ind.lag_days === "number" && ind.lag_days > 3;
  return stale ? ` <span class="i-lag">(${ind.lag_days}일 전)</span>` : "";
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
      (ind, idx) => `<button type="button" class="indicator-tile" data-idx="${idx}" aria-haspopup="dialog">
      <div class="i-label">${axisDot(ind.axis)}${escapeHtml(ind.label)}</div>
      <div class="i-value">${formatIndicatorValue(ind.value, ind.unit)}<span class="i-unit">${escapeHtml(ind.unit ?? "")}</span></div>
      <div class="i-date">${escapeHtml(ind.value_date ?? ind.date ?? "")}${lagNote(ind)} · ${escapeHtml(ind.source ?? "")}</div>
    </button>`
    )
    .join("");
  el.querySelectorAll("button.indicator-tile").forEach((btn) => {
    btn.addEventListener("click", () => openIndicatorModal(state.indicators[Number(btn.dataset.idx)]));
  });
}

// ---- 지표 상세 모달 (T3) ----
// 이력은 data/indicators/history.json(scripts/build-indicator-history.mjs), 설명은 config/indicator-descriptions.json.
// 키 규칙은 빌드 스크립트의 indicatorKey와 같다.
function indicatorKey(ind) {
  return ind.indicator_id ?? `${ind.axis}:${ind.label}`;
}

const RANGES = [
  { id: "1M", label: "1개월", days: 31 },
  { id: "3M", label: "3개월", days: 92 },
  { id: "6M", label: "6개월", days: 183 },
  { id: "1Y", label: "1년", days: 366 },
  { id: "ALL", label: "전체", days: null },
];

const modal = { ind: null, series: null, range: "3M", historyP: null, descP: null };

function loadJson(url) {
  return fetch(url, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

async function openIndicatorModal(ind) {
  if (!ind) return;
  modal.ind = ind;
  modal.historyP ??= loadJson("/data/indicators/history.json");
  modal.descP ??= loadJson("/config/indicator-descriptions.json");
  const dlg = document.getElementById("indicatorModal");
  renderModalHead(ind);
  document.getElementById("imChart").innerHTML = `<p class="im-empty">이력 불러오는 중…</p>`;
  if (!dlg.open) dlg.showModal();
  const [history, desc] = await Promise.all([modal.historyP, modal.descP]);
  if (modal.ind !== ind) return; // 로딩 중 다른 지표를 열었음
  const d = desc?.descriptions?.[indicatorKey(ind)];
  document.getElementById("imDesc").innerHTML = d
    ? `<p>${escapeHtml(d.what)}</p><p class="im-why">${escapeHtml(d.why)}</p>`
    : "";
  modal.series = history?.series?.[indicatorKey(ind)] ?? null;
  renderModalChart();
}

function renderModalHead(ind) {
  document.getElementById("imTitle").innerHTML = `${axisDot(ind.axis)}${escapeHtml(ind.label)}`;
  document.getElementById("imValue").innerHTML =
    `${formatIndicatorValue(ind.value, ind.unit)}<span class="i-unit">${escapeHtml(ind.unit ?? "")}</span>`;
  const basis = ind.basis_date ? ` · 계산 기준일 ${escapeHtml(ind.basis_date)}` : "";
  document.getElementById("imMeta").innerHTML =
    `${escapeHtml(ind.value_date ?? ind.date ?? "")}${lagNote(ind)}${basis} · ${escapeHtml(ind.source ?? "")}` +
    (ind.source_url ? ` · <a href="${escapeHtml(ind.source_url)}" target="_blank" rel="noopener">원출처 →</a>` : "");
  document.getElementById("imDesc").innerHTML = "";
  const ranges = document.getElementById("imRanges");
  ranges.innerHTML = RANGES.map(
    (r) => `<button type="button" data-range="${r.id}" aria-pressed="${r.id === modal.range}">${r.label}</button>`
  ).join("");
  ranges.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      modal.range = b.dataset.range;
      ranges.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderModalChart();
    })
  );
}

function pointsInRange(points, rangeId) {
  const r = RANGES.find((x) => x.id === rangeId);
  if (!r?.days || points.length === 0) return points;
  const from = new Date(points.at(-1)[0]);
  from.setDate(from.getDate() - r.days);
  const fromStr = from.toISOString().slice(0, 10);
  return points.filter(([d]) => d >= fromStr);
}

// y축 눈금: 1·2·2.5·5 ×10^n 간격으로 4~6개
function niceTicks(min, max) {
  if (min === max) {
    const pad = Math.abs(min) * 0.01 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = lo; v < max + step; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function renderModalChart() {
  const box = document.getElementById("imChart");
  const all = modal.series?.points ?? [];
  const pts = pointsInRange(all, modal.range);
  const unit = modal.ind.unit ?? "";
  const fmt = (v) => formatIndicatorValue(v, unit);

  document.getElementById("imNote").textContent = all.length
    ? `이력: ${all[0][0]}부터 ${all.length}개 관측일` +
      (modal.series.seeded_until
        ? ` (${modal.series.seeded_until}까지는 원출처 1년 일괄 조회분, 이후는 매일 수집분)`
        : " (대시보드 수집분)")
    : "";
  document.getElementById("imTable").innerHTML = all.length
    ? `<table><thead><tr><th>기준일</th><th>값 (${escapeHtml(unit)})</th></tr></thead><tbody>${[...all]
        .reverse()
        .map(([d, v]) => `<tr><td>${escapeHtml(d)}</td><td>${fmt(v)}</td></tr>`)
        .join("")}</tbody></table>`
    : "";

  if (pts.length < 2) {
    box.innerHTML = `<p class="im-empty">${
      all.length < 2
        ? `이력이 쌓이는 중입니다 (${all.length}개 관측일).`
        : "이 기간에는 관측값이 1개 이하입니다. 더 긴 기간을 선택하세요."
    }</p>`;
    return;
  }

  // viewBox 폭 = 실제 표시 폭 — 고정 폭을 축소하면 모바일에서 축 글자가 같이 작아진다
  const W = Math.max(280, Math.round(box.clientWidth || 640)), H = 240, L = 56, R = 12, T = 14, B = 26;
  const t0 = Date.parse(pts[0][0]);
  const t1 = Date.parse(pts.at(-1)[0]);
  const vals = pts.map((p) => p[1]);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const yMin = ticks[0], yMax = ticks.at(-1);
  const x = (d) => L + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const color = `var(--series-${modal.ind.axis})`;
  const first = pts[0], last = pts.at(-1);

  const grid = ticks
    .map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="im-grid"/>
      <text x="${L - 6}" y="${y(v)}" class="im-ytick">${fmt(v)}</text>`)
    .join("");
  const xLabels = `<text x="${L}" y="${H - 6}" class="im-xtick" text-anchor="start">${escapeHtml(first[0])}</text>
    <text x="${W - R}" y="${H - 6}" class="im-xtick" text-anchor="end">${escapeHtml(last[0])}</text>`;
  const breaks = (modal.series.breaks ?? [])
    .filter((b) => b.date > first[0] && b.date <= last[0])
    .map((b) => `<line x1="${x(b.date)}" x2="${x(b.date)}" y1="${T}" y2="${H - B}" class="im-break"/>
      <text x="${x(b.date) - 4}" y="${T + 8}" class="im-break-label" text-anchor="end">${b.kind === "formula" ? "공식 변경" : "소스 전환"}</text>`)
    .join("");
  const path = pts.map(([d, v], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join("");

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" tabindex="0"
      aria-label="${escapeHtml(modal.ind.label)} 추이 ${escapeHtml(first[0])}~${escapeHtml(last[0])}. 좌우 화살표로 값 탐색">
    ${grid}${xLabels}${breaks}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last[0])}" cy="${y(last[1])}" r="4" fill="${color}" class="im-dot"/>
    <g class="im-cross" style="display:none">
      <line y1="${T}" y2="${H - B}" class="im-crossline"/>
      <circle r="4" fill="${color}" class="im-dot"/>
    </g>
  </svg><div class="im-tip" style="display:none"></div>`;

  const svg = box.querySelector("svg");
  const cross = svg.querySelector(".im-cross");
  const tip = box.querySelector(".im-tip");
  let cur = pts.length - 1;
  const show = (i) => {
    cur = Math.max(0, Math.min(pts.length - 1, i));
    const [d, v] = pts[cur];
    const cx = x(d), cy = y(v);
    cross.style.display = "";
    cross.querySelector("line").setAttribute("x1", cx);
    cross.querySelector("line").setAttribute("x2", cx);
    cross.querySelector("circle").setAttribute("cx", cx);
    cross.querySelector("circle").setAttribute("cy", cy);
    const strong = document.createElement("strong");
    strong.textContent = `${fmt(v)} ${unit}`;
    const sub = document.createElement("span");
    sub.textContent = d;
    tip.replaceChildren(strong, sub);
    tip.style.display = "";
    const rect = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max((cx / W) * rect.width, 56), rect.width - 56)}px`;
    tip.style.top = `${(cy / H) * rect.height}px`;
  };
  const hide = () => {
    cross.style.display = "none";
    tip.style.display = "none";
  };
  svg.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i][0]) - sx) < Math.abs(x(pts[best][0]) - sx)) best = i;
    show(best);
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("focus", () => show(cur));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(cur - 1);
    else if (e.key === "ArrowRight") show(cur + 1);
    else return;
    e.preventDefault();
  });
}

function initIndicatorModal() {
  const dlg = document.getElementById("indicatorModal");
  if (!dlg) return;
  document.getElementById("imClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close(); // 배경(::backdrop) 클릭
  });
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

  initIndicatorModal();
  render();
}

main();
