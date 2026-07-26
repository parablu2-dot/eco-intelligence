const AXIS_LABEL = {
  geopolitics: "지정학적 리스크",
  polarization: "양극화",
  fed_policy: "연준/통화정책",
  productivity_ai: "생산성(AI)",
  us_investment: "미국 투자",
  rates_fx: "금리/환율",
  commodities_energy: "원자재/에너지",
};

const state = {
  tab: "daily",
  daily: [],
  weekly: [],
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function axisChips(axes) {
  return (axes ?? [])
    .map((a) => `<span class="chip">${escapeHtml(AXIS_LABEL[a] ?? a)}</span>`)
    .join("");
}

function pointCard(point, i) {
  return `<article class="point-card">
    <div class="point-index">POINT ${i + 1}</div>
    <h3>${escapeHtml(point.title ?? "")}</h3>
    <p>${escapeHtml(point.body ?? "")}</p>
    <div class="chips">${axisChips(point.axes)}</div>
  </article>`;
}

function renderCurrent() {
  const list = state[state.tab];
  const metaEl = document.getElementById("summaryMeta");
  const wrapEl = document.getElementById("pointsWrap");
  const emptyEl = document.getElementById("emptyState");
  const historyEl = document.getElementById("historyWrap");

  if (!list || list.length === 0) {
    metaEl.textContent = "";
    wrapEl.innerHTML = "";
    emptyEl.style.display = "block";
    historyEl.innerHTML = "";
    return;
  }
  emptyEl.style.display = "none";

  const latest = list[0];
  metaEl.textContent =
    state.tab === "daily"
      ? `${latest.date} · 생성: ${new Date(latest.generated_at).toLocaleString("ko-KR")}`
      : `${latest.week_start} ~ ${latest.week_end} (${latest.note_count ?? "-"}건 기반) · 생성: ${new Date(latest.generated_at).toLocaleString("ko-KR")}`;

  wrapEl.innerHTML = latest.points.map(pointCard).join("");

  const history = list.slice(1, 9);
  historyEl.innerHTML = history.length
    ? `<h2>이전 ${state.tab === "daily" ? "Daily" : "Weekly"} 요약</h2>${history
        .map((s, idx) => {
          const label = state.tab === "daily" ? s.date : `${s.week_start} ~ ${s.week_end}`;
          return `<div class="history-item" data-idx="${idx + 1}">
            <div class="history-item-date">${escapeHtml(label)}</div>
            <div class="history-item-title">${escapeHtml(s.points?.[0]?.title ?? "")}</div>
          </div>`;
        })
        .join("")}`
    : "";

  historyEl.querySelectorAll(".history-item").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.idx);
      const chosen = list[idx];
      metaEl.textContent =
        state.tab === "daily"
          ? `${chosen.date} · 생성: ${new Date(chosen.generated_at).toLocaleString("ko-KR")}`
          : `${chosen.week_start} ~ ${chosen.week_end} (${chosen.note_count ?? "-"}건 기반) · 생성: ${new Date(chosen.generated_at).toLocaleString("ko-KR")}`;
      wrapEl.innerHTML = chosen.points.map(pointCard).join("");
      wrapEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function main() {
  try {
    const res = await fetch("/data/summary/index.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.daily = data.daily ?? [];
    state.weekly = data.weekly ?? [];
  } catch (err) {
    document.getElementById("summaryMeta").textContent = `데이터 로드 실패: ${err.message}`;
  }

  document.querySelectorAll(".summary-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll(".summary-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
      renderCurrent();
    });
  });

  renderCurrent();
}

main();
