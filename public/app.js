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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function axisDot(axisId) {
  return `<span class="dot" style="background:var(--series-${axisId})"></span>`;
}

function formatIndicatorValue(v, unit) {
  if (typeof v !== "number") return "-";
  if (unit === "KRW") return v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  if (unit === "%") return v.toFixed(2);
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// 일간 지표가 빠진 영업일 2일 넘게 묵었으면 기준일 옆에 표시. 주말·한미 휴장일은 lag_days에서 이미 빠져 있고,
// FRED 금리는 익영업일 공표라 1일이 정상. 월/분기/연 지표는 표시 안 함.
// lag_calendar가 없는 스냅샷(추가지시② 이전)은 lag_days가 달력일이라 예전 기준(3일 초과)을 쓴다.
function lagNote(ind) {
  if ((ind.frequency ?? "D") !== "D" || typeof ind.lag_days !== "number") return "";
  if (!ind.lag_calendar) return ind.lag_days > 3 ? ` <span class="i-lag">(${ind.lag_days}일 전)</span>` : "";
  return ind.lag_days > 2 ? ` <span class="i-lag">(${ind.lag_days}영업일 지연)</span>` : "";
}

// 파생지표: 재료 최신일이 계산 기준일과 다를 때만 기준일·재료 날짜를 보여준다(같으면 value_date로 충분).
function basisNote(ind) {
  if (!ind.basis_date) return "";
  const inputs = Object.entries(ind.input_dates ?? {});
  const mismatched = inputs.some(([, d]) => d !== ind.basis_date);
  if (inputs.length && !mismatched) return "";
  const detail = mismatched ? ` (재료 최신일 ${inputs.map(([k, d]) => `${k} ${d}`).join(", ")})` : "";
  return ` · 계산 기준일 ${escapeHtml(ind.basis_date)}${escapeHtml(detail)}`;
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
  document.getElementById("imMeta").innerHTML =
    `${escapeHtml(ind.value_date ?? ind.date ?? "")}${lagNote(ind)}${basisNote(ind)} · ${escapeHtml(ind.source ?? "")}` +
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

// ---- 대시보드 (UX 1차 개편, 2026-10-13) ----
// 데이터 계약(data/*.json)은 그대로 두고 렌더만 한다. 원칙(Drive 지식창고/1_세션/커뮤/UX):
// 개요 먼저 → 누르면 상세, 한 화면 항목 10개 이하, 색만으로 구분하지 않기(라벨·길이·숫자 병기),
// 약어는 작게 + 풀네임(abbr). 시각 톤은 Linear식 절제(작은 단색 아이콘, 촘촘한 행).
// 리뷰(cheon_view 상태·견해) UI는 Verifier 시스템 연계 때 다시 붙인다.

// 지표를 한 화면 10개 이하가 되도록 6묶음으로 나눈다. 키는 indicatorKey 규칙.
const GROUPS = [
  {
    id: "us_rates", label: "미국 금리",
    keys: ["fed_policy:연방기금 실효금리", "fed_target_upper", "us2y", "us10y", "us30y",
      "us10y_tips_real", "us30y_tips_real", "us10y_breakeven", "t10y2y", "us_10y2y"],
  },
  {
    id: "kr_rates", label: "한국 금리",
    keys: ["kr_base_rate", "kr3y", "kr10y", "kr_corp_aa3y", "kr_10y3y", "kr_credit_aa3y",
      "kr_us_10y_spread", "kr_us_policy_spread"],
  },
  {
    id: "fx_credit", label: "환율·신용",
    keys: ["usdkrw", "jpykrw", "rates_fx:원/달러 환율", "usdjpy", "eurusd", "us_ig_oas", "us_hy_oas"],
  },
  {
    id: "equity", label: "지수·빅테크",
    keys: ["kospi", "retention_rate", "us_investment:S&P 500 지수", "market_signals:Alphabet",
      "market_signals:Microsoft", "market_signals:Amazon", "market_signals:Meta"],
  },
  {
    id: "semis", label: "반도체 종목",
    keys: ["market_signals:SK하이닉스", "market_signals:삼성전자", "market_signals:Micron",
      "market_signals:Kioxia", "market_signals:CXMT", "market_signals:Broadcom",
      "market_signals:Marvell", "market_signals:MediaTek", "market_signals:Qualcomm"],
  },
  {
    id: "macro", label: "거시·원자재",
    keys: ["geopolitics:미국 경제정책 불확실성지수(EPU)", "polarization:미국 지니계수(소득불평등)",
      "productivity_ai:비농업부문 노동생산성지수", "commodities_energy:WTI 원유 현물가",
      "commodities_energy:헨리허브 천연가스 현물가"],
  },
];

// 오늘 화면 핵심 지표 8개 (2026-10-13 천 결정: 기본 6 + 잔존율·엔/원)
const PINNED = ["usdkrw", "jpykrw", "kospi", "retention_rate", "us_investment:S&P 500 지수",
  "us10y", "kr10y", "commodities_energy:WTI 원유 현물가"];

const ABBR = {
  EPU: "Economic Policy Uncertainty (경제정책 불확실성)",
  OAS: "Option-Adjusted Spread (옵션조정 스프레드)",
  TIPS: "Treasury Inflation-Protected Securities (물가연동국채)",
  breakeven: "기대인플레이션 (명목금리 − 실질금리)",
  "2s10s": "미 2년물과 10년물 금리차",
  "AA-": "회사채 신용등급 AA-",
};

// 16px 단색 선 아이콘(currentColor) — 라벨 옆 보조, 의미는 항상 텍스트가 전달한다
const ICON = {
  today: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  indicators: '<path d="M2 14h12M4 11V7M8 11V3M12 11V8"/>',
  notes: '<rect x="2.5" y="2" width="11" height="12" rx="1.5"/><path d="M5 5.5h6M5 8h6M5 10.5h4"/>',
  weekly: '<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/>',
};
const icon = (name) =>
  `<svg class="ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${ICON[name]}</svg>`;

const PAGE_SIZE = 20;

const state = {
  tab: "today",
  indicators: [],
  byKey: new Map(),
  notes: [],
  generatedAt: null,
  health: null,
  summary: { daily: [], weekly: [] },
  group: "us_rates",
  noteAxis: "",
  notePeriod: "7",
  noteSearch: "",
  noteLimit: PAGE_SIZE,
};

// escape 후 약어에 abbr를 씌운다(title은 hover, 용어집은 주간 탭 하단에 상시).
function abbrify(text) {
  let html = escapeHtml(text);
  for (const [k, full] of Object.entries(ABBR)) {
    const ek = escapeHtml(k);
    html = html.split(ek).join(`<abbr title="${escapeHtml(full)}">${ek}</abbr>`);
  }
  return html;
}

function axisTag(axisId) {
  return `<span class="axis-tag">${axisDot(axisId)}${escapeHtml(AXIS_LABEL[axisId] ?? axisId)}</span>`;
}

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ---- 상태줄: 갱신 시각 + health (기호·문구·색 병기) ----
function renderStatus() {
  const el = document.getElementById("statusLine");
  const parts = [];
  if (state.generatedAt) parts.push(`갱신 ${new Date(state.generatedAt).toLocaleString("ko-KR")}`);
  const h = state.health;
  if (h) {
    const map = {
      ok: ["●", "수집 정상"],
      warn: ["▲", `경고 ${h.warn_count ?? 0}건`],
      fail: ["■", `실패 ${h.fail_count ?? 0}건`],
    };
    const [sym, text] = map[h.status] ?? ["?", `상태 ${h.status}`];
    parts.push(`<span class="health" data-status="${escapeHtml(h.status)}"><span aria-hidden="true">${sym}</span> ${escapeHtml(text)}</span>`);
  }
  el.innerHTML = parts.join(" · ");
}

// ---- 지표 타일 (클릭 → 상세 모달) ----
function tile(ind) {
  return `<button type="button" class="tile" data-key="${escapeHtml(indicatorKey(ind))}" aria-haspopup="dialog">
    <span class="t-label">${axisDot(ind.axis)}${abbrify(ind.label)}</span>
    <span class="t-value">${formatIndicatorValue(ind.value, ind.unit)}<small>${escapeHtml(ind.unit ?? "")}</small></span>
    <span class="t-date">${escapeHtml(ind.value_date ?? ind.date ?? "")}${lagNote(ind)}</span>
  </button>`;
}

function bindTiles(root) {
  root.querySelectorAll(".tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ind = state.byKey.get(btn.dataset.key);
      if (ind) openIndicatorModal(ind);
    });
  });
}

// 묶음에 들어가지 않은 새 지표는 '기타'로 모아 빠뜨리지 않는다.
function groupedIndicators() {
  const mapped = new Set(GROUPS.flatMap((g) => g.keys));
  const out = GROUPS.map((g) => ({ ...g, items: g.keys.map((k) => state.byKey.get(k)).filter(Boolean) }));
  const rest = state.indicators.filter((ind) => !mapped.has(indicatorKey(ind)));
  if (rest.length) out.push({ id: "etc", label: "기타", items: rest });
  return out;
}

// ---- 오늘 ----
function pointRow(p, i) {
  const axes = (p.axes ?? []).map(axisTag).join("");
  return `<details class="row point">
    <summary><span class="p-no">${i + 1}</span><span class="p-title">${escapeHtml(p.title ?? "")}</span></summary>
    <div class="row-body"><p>${escapeHtml(p.body ?? "")}</p><div class="tags">${axes}</div></div>
  </details>`;
}

function renderToday(view) {
  const daily = state.summary.daily[0];
  const pinned = PINNED.map((k) => state.byKey.get(k)).filter(Boolean);

  const since = daysAgoStr(7);
  const week = state.notes.filter((n) => (n.date ?? "") >= since);
  const counts = AXES.map((a) => ({ ...a, n: week.filter((x) => x.axis === a.id).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));

  view.innerHTML = `
    <section class="sec">
      <h2>오늘의 요약 <small>${escapeHtml(daily?.date ?? "")}</small></h2>
      <div class="rows">${daily ? daily.points.map(pointRow).join("") : `<p class="empty">아직 생성된 오늘 요약이 없습니다. 매일 아침 크론이 만든 뒤 표시됩니다.</p>`}</div>
    </section>
    <section class="sec">
      <h2>핵심 지표 <small>누르면 추이</small></h2>
      <div class="tiles tiles-pinned">${pinned.map(tile).join("")}</div>
      <button type="button" class="more" data-go="indicators">지표 ${state.indicators.length}개 전체 보기 →</button>
    </section>
    <section class="sec">
      <h2>8축 이번 주 노트 <small>최근 7일 ${week.length}건 · 누르면 목록</small></h2>
      <ul class="bars">
        ${counts
          .map(
            (c) => `<li><button type="button" data-axis="${c.id}">
              <span class="b-label">${axisDot(c.id)}${escapeHtml(c.label)}</span>
              <span class="b-track"><span class="b-fill" style="width:${(c.n / max) * 100}%"></span></span>
              <span class="b-n">${c.n}</span>
            </button></li>`
          )
          .join("")}
      </ul>
    </section>`;

  bindTiles(view);
  view.querySelector("[data-go=indicators]").addEventListener("click", () => go("indicators"));
  view.querySelectorAll(".bars button").forEach((b) =>
    b.addEventListener("click", () => {
      state.noteAxis = b.dataset.axis;
      state.notePeriod = "7";
      state.noteLimit = PAGE_SIZE;
      go("notes");
    })
  );
}

// ---- 지표 ----
function renderIndicators(view) {
  const groups = groupedIndicators();
  const cur = groups.find((g) => g.id === state.group) ?? groups[0];
  view.innerHTML = `
    <div class="seg" role="group" aria-label="지표 묶음">
      ${groups
        .map((g) => `<button type="button" data-group="${g.id}" aria-pressed="${g.id === cur.id}">${escapeHtml(g.label)} <small>${g.items.length}</small></button>`)
        .join("")}
    </div>
    <div class="tiles">${cur.items.map(tile).join("")}</div>
    <p class="hint">타일을 누르면 기간별 추이와 표가 열립니다. 일간 지표가 2영업일 넘게 묵으면 날짜 옆에 지연이 표시됩니다.</p>`;
  bindTiles(view);
  view.querySelectorAll("[data-group]").forEach((b) =>
    b.addEventListener("click", () => {
      state.group = b.dataset.group;
      renderIndicators(view);
    })
  );
}

// ---- 노트 ----
function filteredNotes() {
  const q = state.noteSearch.trim().toLowerCase();
  const since = state.notePeriod ? daysAgoStr(Number(state.notePeriod)) : "";
  return state.notes.filter((n) => {
    if (since && (n.date ?? "") < since) return false;
    if (state.noteAxis && n.axis !== state.noteAxis) return false;
    if (q) {
      const hay = [n.headline, ...(n.keywords ?? []), ...(n.facts ?? [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function noteRow(n) {
  const facts = (n.facts ?? []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const kw = (n.keywords ?? []).map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join("");
  const draft = n.cheon_view?.draft_judgment?.trim();
  return `<details class="row note">
    <summary>
      <span class="n-head">${escapeHtml(n.headline ?? "(제목 없음)")}</span>
      <span class="n-meta">${axisTag(n.axis)}<time>${escapeHtml(n.date ?? "")}</time></span>
    </summary>
    <div class="row-body">
      <ul class="facts">${facts}</ul>
      ${draft ? `<div class="draft-judgment"><span class="draft-label">1차 판단 초안(미검증)</span>${escapeHtml(draft)}</div>` : ""}
      <div class="chips">${kw}</div>
      ${n.source_url ? `<a class="source-link" href="${escapeHtml(n.source_url)}" target="_blank" rel="noopener">원문 보기 →</a>` : ""}
    </div>
  </details>`;
}

function renderNotes(view) {
  const opt = (v, label, cur) => `<option value="${v}"${v === cur ? " selected" : ""}>${escapeHtml(label)}</option>`;
  view.innerHTML = `
    <div class="filters">
      <select id="fAxis" aria-label="축">${opt("", "전체 축", state.noteAxis)}${AXES.map((a) => opt(a.id, a.label, state.noteAxis)).join("")}</select>
      <select id="fPeriod" aria-label="기간">${opt("7", "최근 7일", state.notePeriod)}${opt("30", "최근 30일", state.notePeriod)}${opt("", "전체 기간", state.notePeriod)}</select>
      <input type="search" id="fSearch" placeholder="헤드라인·키워드 검색" value="${escapeHtml(state.noteSearch)}" />
    </div>
    <p class="count-line" id="noteCount"></p>
    <div class="rows" id="noteList"></div>`;

  const draw = () => {
    const list = filteredNotes();
    view.querySelector("#noteCount").textContent = `${list.length}건 중 ${Math.min(list.length, state.noteLimit)}건 표시 · 제목을 누르면 상세`;
    const shown = list.slice(0, state.noteLimit);
    view.querySelector("#noteList").innerHTML = list.length
      ? shown.map(noteRow).join("") +
        (list.length > shown.length ? `<button type="button" class="more" id="moreNotes">${PAGE_SIZE}건 더 보기</button>` : "")
      : `<p class="empty">조건에 맞는 노트가 없습니다. 기간을 '전체 기간'으로 넓히거나 검색어를 지워 보세요.</p>`;
    view.querySelector("#moreNotes")?.addEventListener("click", () => {
      state.noteLimit += PAGE_SIZE;
      draw();
    });
  };
  const on = (id, ev, fn) =>
    view.querySelector(id).addEventListener(ev, (e) => {
      fn(e.target.value);
      state.noteLimit = PAGE_SIZE;
      draw();
    });
  on("#fAxis", "change", (v) => (state.noteAxis = v));
  on("#fPeriod", "change", (v) => (state.notePeriod = v));
  on("#fSearch", "input", (v) => (state.noteSearch = v));
  draw();
}

// ---- 주간 ----
function renderWeekly(view) {
  const [latest, ...prev] = state.summary.weekly;
  const range = (w) => `${w.week_start} ~ ${w.week_end}`;
  view.innerHTML = latest
    ? `<section class="sec">
        <h2>이번 주 <small>${escapeHtml(range(latest))} · 노트 ${latest.note_count ?? "-"}건 기반</small></h2>
        <div class="rows">${latest.points.map(pointRow).join("")}</div>
      </section>
      <section class="sec">
        <h2>지난 주간 요약</h2>
        <div class="rows">${prev
          .slice(0, 8)
          .map(
            (w) => `<details class="row prev"><summary><time>${escapeHtml(range(w))}</time><span class="p-title">${escapeHtml(w.points?.[0]?.title ?? "")}</span></summary>
              <div class="rows nested">${w.points.map(pointRow).join("")}</div></details>`
          )
          .join("")}</div>
      </section>
      <section class="sec">
        <h2>용어집</h2>
        <dl class="gloss">${Object.entries(ABBR).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
      </section>`
    : `<p class="empty">아직 생성된 주간 요약이 없습니다. 토요일 크론 이후 표시됩니다.</p>`;
}

// ---- 탭 전환 (#hash로 기억) ----
const RENDER = { today: renderToday, indicators: renderIndicators, notes: renderNotes, weekly: renderWeekly };

function go(tab) {
  state.tab = RENDER[tab] ? tab : "today";
  if (location.hash !== `#${state.tab}`) history.replaceState(null, "", `#${state.tab}`);
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  RENDER[state.tab](document.getElementById("view"));
  window.scrollTo({ top: 0 });
}

async function main() {
  const [index, ind, health, summary] = await Promise.all([
    loadJson("/data/index.json"),
    loadJson("/data/indicators/latest.json"),
    loadJson("/data/health/latest.json"),
    loadJson("/data/summary/index.json"),
  ]);
  state.notes = (index?.notes ?? []).slice().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  state.generatedAt = index?.generated_at ?? null;
  state.indicators = ind?.indicators ?? [];
  state.byKey = new Map(state.indicators.map((i) => [indicatorKey(i), i]));
  state.health = health;
  state.summary = { daily: summary?.daily ?? [], weekly: summary?.weekly ?? [] };

  if (!index) document.getElementById("statusLine").textContent = "노트 데이터 로드 실패";
  else renderStatus();

  document.querySelectorAll(".tabs button").forEach((b) => {
    b.insertAdjacentHTML("afterbegin", icon(b.dataset.tab));
    b.addEventListener("click", () => go(b.dataset.tab));
  });
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));
  initIndicatorModal();
  go(location.hash.slice(1) || "today");
}

main();
