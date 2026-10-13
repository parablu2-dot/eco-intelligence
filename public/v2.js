// UX 1차 개편 시안. 데이터 계약(data/*.json)은 그대로 두고 렌더만 바꾼다.
// app.js를 먼저 불러 AXES·escapeHtml·지표 모달(openIndicatorModal) 등을 그대로 쓴다.
// 원칙(Drive 지식창고/1_세션/커뮤/UX): 개요 먼저 → 누르면 상세, 한 화면 항목 10개 미만,
// 아이콘은 크게 + 항상 텍스트 라벨, 색만으로 구분하지 않기, 약어는 작게 + 풀네임(abbr).

const AXIS_ICON = {
  geopolitics: "🌐",
  polarization: "⚖️",
  fed_policy: "🏦",
  productivity_ai: "🤖",
  us_investment: "💵",
  rates_fx: "💱",
  commodities_energy: "🛢️",
  market_signals: "📈",
};

// 지표 45개를 한 화면 10개 미만이 되도록 6묶음으로 나눈다. 키는 app.js indicatorKey 규칙.
const GROUPS = [
  {
    id: "us_rates", icon: "🗽", label: "미국 금리",
    keys: ["fed_policy:연방기금 실효금리", "fed_target_upper", "us2y", "us10y", "us30y",
      "us10y_tips_real", "us30y_tips_real", "us10y_breakeven", "t10y2y", "us_10y2y"],
  },
  {
    id: "kr_rates", icon: "🏯", label: "한국 금리",
    keys: ["kr_base_rate", "kr3y", "kr10y", "kr_corp_aa3y", "kr_10y3y", "kr_credit_aa3y",
      "kr_us_10y_spread", "kr_us_policy_spread"],
  },
  {
    id: "fx_credit", icon: "💱", label: "환율·신용",
    keys: ["usdkrw", "rates_fx:원/달러 환율", "usdjpy", "eurusd", "us_ig_oas", "us_hy_oas"],
  },
  {
    id: "equity", icon: "📈", label: "지수·빅테크",
    keys: ["kospi", "us_investment:S&P 500 지수", "retention_rate", "market_signals:Alphabet",
      "market_signals:Microsoft", "market_signals:Amazon", "market_signals:Meta"],
  },
  {
    id: "semis", icon: "🔲", label: "반도체 종목",
    keys: ["market_signals:SK하이닉스", "market_signals:삼성전자", "market_signals:Micron",
      "market_signals:Kioxia", "market_signals:CXMT", "market_signals:Broadcom",
      "market_signals:Marvell", "market_signals:MediaTek", "market_signals:Qualcomm"],
  },
  {
    id: "macro", icon: "🌍", label: "거시·원자재",
    keys: ["geopolitics:미국 경제정책 불확실성지수(EPU)", "polarization:미국 지니계수(소득불평등)",
      "productivity_ai:비농업부문 노동생산성지수", "commodities_energy:WTI 원유 현물가",
      "commodities_energy:헨리허브 천연가스 현물가"],
  },
];

// 오늘 화면에 고정하는 핵심 6개
const PINNED = ["usdkrw", "kospi", "us_investment:S&P 500 지수", "us10y", "kr10y", "commodities_energy:WTI 원유 현물가"];

const ABBR = {
  EPU: "Economic Policy Uncertainty (경제정책 불확실성)",
  OAS: "Option-Adjusted Spread (옵션조정 스프레드)",
  TIPS: "Treasury Inflation-Protected Securities (물가연동국채)",
  breakeven: "기대인플레이션 (명목금리 − 실질금리)",
  "2s10s": "미 2년물과 10년물 금리차",
  "AA-": "회사채 신용등급 AA-",
};

const PAGE_SIZE = 20;

const v2 = {
  tab: "today",
  indicators: [],
  byKey: new Map(),
  notes: [],
  generatedAt: null,
  health: null,
  summary: { daily: [], weekly: [] },
  group: "us_rates",
  noteAxis: "",
  noteStatus: "",
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
  return `<span class="axis-tag">${axisDot(axisId)}<span aria-hidden="true">${AXIS_ICON[axisId] ?? ""}</span> ${escapeHtml(AXIS_LABEL[axisId] ?? axisId)}</span>`;
}

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ---- 상태줄: 갱신 시각 + health. 상태는 아이콘·문구·색을 함께 쓴다 ----
function renderStatus() {
  const el = document.getElementById("statusLine");
  const parts = [];
  if (v2.generatedAt) parts.push(`마지막 갱신 ${new Date(v2.generatedAt).toLocaleString("ko-KR")}`);
  const h = v2.health;
  if (h) {
    const map = {
      ok: ["✅", "수집 정상"],
      warn: ["⚠️", `경고 ${h.warn_count ?? 0}건`],
      fail: ["⛔", `실패 ${h.fail_count ?? 0}건`],
    };
    const [ico, text] = map[h.status] ?? ["❔", `상태 ${h.status}`];
    parts.push(`<span class="health" data-status="${escapeHtml(h.status)}"><span aria-hidden="true">${ico}</span> ${escapeHtml(text)}</span>`);
  }
  el.innerHTML = parts.join(" · ");
}

// ---- 지표 타일 (클릭 → 기존 상세 모달) ----
function tile(ind) {
  return `<button type="button" class="v2-tile" data-key="${escapeHtml(indicatorKey(ind))}" aria-haspopup="dialog">
    <span class="t-label">${axisDot(ind.axis)}${abbrify(ind.label)}</span>
    <span class="t-value">${formatIndicatorValue(ind.value, ind.unit)}<small>${escapeHtml(ind.unit ?? "")}</small></span>
    <span class="t-date">${escapeHtml(ind.value_date ?? ind.date ?? "")}${lagNote(ind)}</span>
  </button>`;
}

function bindTiles(root) {
  root.querySelectorAll(".v2-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ind = v2.byKey.get(btn.dataset.key);
      if (ind) openIndicatorModal(ind);
    });
  });
}

function groupOf(key) {
  return GROUPS.find((g) => g.keys.includes(key));
}

// 묶음에 들어가지 않은 새 지표는 '기타'로 모아 빠뜨리지 않는다.
function groupedIndicators() {
  const out = GROUPS.map((g) => ({ ...g, items: g.keys.map((k) => v2.byKey.get(k)).filter(Boolean) }));
  const rest = v2.indicators.filter((ind) => !groupOf(indicatorKey(ind)));
  if (rest.length) out.push({ id: "etc", icon: "➕", label: "기타", items: rest });
  return out;
}

// ---- 오늘 ----
function pointCard(p, i) {
  const axes = (p.axes ?? []).map(axisTag).join("");
  return `<details class="v2-point">
    <summary><span class="p-no">${i + 1}</span><span class="p-title">${escapeHtml(p.title ?? "")}</span></summary>
    <p>${escapeHtml(p.body ?? "")}</p>
    <div class="p-axes">${axes}</div>
  </details>`;
}

function renderToday(view) {
  const daily = v2.summary.daily[0];
  const pinned = PINNED.map((k) => v2.byKey.get(k)).filter(Boolean);

  const since = daysAgoStr(7);
  const week = v2.notes.filter((n) => (n.date ?? "") >= since);
  const counts = AXES.map((a) => ({ ...a, n: week.filter((x) => x.axis === a.id).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));

  view.innerHTML = `
    <section class="v2-sec">
      <h2>오늘의 요약 <small>${escapeHtml(daily?.date ?? "")}</small></h2>
      ${daily ? daily.points.map(pointCard).join("") : `<p class="v2-empty">아직 생성된 오늘 요약이 없습니다. 매일 아침 크론이 만든 뒤 표시됩니다.</p>`}
    </section>
    <section class="v2-sec">
      <h2>핵심 지표 <small>누르면 추이</small></h2>
      <div class="v2-tiles v2-tiles-pinned">${pinned.map(tile).join("")}</div>
      <button type="button" class="v2-more" data-go="indicators">지표 ${v2.indicators.length}개 전체 보기 →</button>
    </section>
    <section class="v2-sec">
      <h2>8축 이번 주 노트 <small>최근 7일 ${week.length}건 · 누르면 목록</small></h2>
      <ul class="v2-bars">
        ${counts
          .map(
            (c) => `<li><button type="button" data-axis="${c.id}">
              <span class="b-ico" aria-hidden="true">${AXIS_ICON[c.id]}</span>
              <span class="b-label">${escapeHtml(c.label)}</span>
              <span class="b-track"><span class="b-fill" style="width:${(c.n / max) * 100}%;background:var(--series-${c.id})"></span></span>
              <span class="b-n">${c.n}</span>
            </button></li>`
          )
          .join("")}
      </ul>
    </section>`;

  bindTiles(view);
  view.querySelector("[data-go=indicators]").addEventListener("click", () => go("indicators"));
  view.querySelectorAll(".v2-bars button").forEach((b) =>
    b.addEventListener("click", () => {
      v2.noteAxis = b.dataset.axis;
      v2.notePeriod = "7";
      v2.noteLimit = PAGE_SIZE;
      go("notes");
    })
  );
}

// ---- 지표 ----
function renderIndicators(view) {
  const groups = groupedIndicators();
  const cur = groups.find((g) => g.id === v2.group) ?? groups[0];
  view.innerHTML = `
    <div class="v2-seg" role="group" aria-label="지표 묶음">
      ${groups
        .map(
          (g) => `<button type="button" data-group="${g.id}" aria-pressed="${g.id === cur.id}">
            <span class="seg-ico" aria-hidden="true">${g.icon}</span>${escapeHtml(g.label)} <small>${g.items.length}</small></button>`
        )
        .join("")}
    </div>
    <div class="v2-tiles">${cur.items.map(tile).join("")}</div>
    <p class="v2-hint">타일을 누르면 기간별 추이와 표가 열립니다. 일간 지표가 2영업일 넘게 묵으면 날짜 옆에 지연이 표시됩니다.</p>`;
  bindTiles(view);
  view.querySelectorAll("[data-group]").forEach((b) =>
    b.addEventListener("click", () => {
      v2.group = b.dataset.group;
      renderIndicators(view);
    })
  );
}

// ---- 노트 ----
function filteredNotes() {
  const q = v2.noteSearch.trim().toLowerCase();
  const since = v2.notePeriod ? daysAgoStr(Number(v2.notePeriod)) : "";
  return v2.notes.filter((n) => {
    if (since && (n.date ?? "") < since) return false;
    if (v2.noteAxis && n.axis !== v2.noteAxis) return false;
    if (v2.noteStatus && (n.cheon_view?.status ?? "pending") !== v2.noteStatus) return false;
    if (q) {
      const hay = [n.headline, ...(n.keywords ?? []), ...(n.facts ?? [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function noteRow(n) {
  const cv = n.cheon_view ?? {};
  const facts = (n.facts ?? []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const kw = (n.keywords ?? []).map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join("");
  const draft = cv.draft_judgment?.trim();
  const review = cv.note?.trim();
  return `<details class="v2-note">
    <summary>
      <span class="n-meta">${axisTag(n.axis)} ${statusBadge(cv.status)} <time>${escapeHtml(n.date ?? "")}</time></span>
      <span class="n-head">${escapeHtml(n.headline ?? "(제목 없음)")}</span>
    </summary>
    <div class="n-body">
      <ul class="facts">${facts}</ul>
      ${draft ? `<div class="draft-judgment"><span class="draft-label">1차 판단 초안(미검증)</span>${escapeHtml(draft)}</div>` : ""}
      ${review ? `<div class="review-note">${escapeHtml(review)}</div>` : `<div class="review-note empty">천 견해 미기입</div>`}
      <div class="chips">${kw}</div>
      ${n.source_url ? `<a class="source-link" href="${escapeHtml(n.source_url)}" target="_blank" rel="noopener">원문 보기 →</a>` : ""}
    </div>
  </details>`;
}

function renderNotes(view) {
  const opt = (v, label, cur) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
  view.innerHTML = `
    <div class="v2-filters">
      <select id="fAxis" aria-label="축">${opt("", "전체 축", v2.noteAxis)}${AXES.map((a) => opt(a.id, `${AXIS_ICON[a.id]} ${a.label}`, v2.noteAxis)).join("")}</select>
      <select id="fPeriod" aria-label="기간">${opt("7", "최근 7일", v2.notePeriod)}${opt("30", "최근 30일", v2.notePeriod)}${opt("", "전체 기간", v2.notePeriod)}</select>
      <select id="fStatus" aria-label="상태">${opt("", "전체 상태", v2.noteStatus)}${Object.entries(STATUS_LABEL).map(([k, l]) => opt(k, l, v2.noteStatus)).join("")}</select>
      <input type="search" id="fSearch" placeholder="헤드라인·키워드 검색" value="${escapeHtml(v2.noteSearch)}" />
    </div>
    <p class="count-line" id="noteCount"></p>
    <div id="noteList"></div>`;

  const draw = () => {
    const list = filteredNotes();
    view.querySelector("#noteCount").textContent = `${list.length}건 중 ${Math.min(list.length, v2.noteLimit)}건 표시 · 제목을 누르면 상세`;
    const shown = list.slice(0, v2.noteLimit);
    view.querySelector("#noteList").innerHTML = list.length
      ? shown.map(noteRow).join("") +
        (list.length > shown.length ? `<button type="button" class="v2-more" id="moreNotes">${PAGE_SIZE}건 더 보기</button>` : "")
      : `<p class="v2-empty">조건에 맞는 노트가 없습니다. 기간을 '전체 기간'으로 넓히거나 검색어를 지워 보세요.</p>`;
    view.querySelector("#moreNotes")?.addEventListener("click", () => {
      v2.noteLimit += PAGE_SIZE;
      draw();
    });
  };
  const on = (id, ev, fn) => view.querySelector(id).addEventListener(ev, (e) => { fn(e.target.value); v2.noteLimit = PAGE_SIZE; draw(); });
  on("#fAxis", "change", (v) => (v2.noteAxis = v));
  on("#fPeriod", "change", (v) => (v2.notePeriod = v));
  on("#fStatus", "change", (v) => (v2.noteStatus = v));
  on("#fSearch", "input", (v) => (v2.noteSearch = v));
  draw();
}

// ---- 주간 ----
function renderWeekly(view) {
  const [latest, ...prev] = v2.summary.weekly;
  const range = (w) => `${w.week_start} ~ ${w.week_end}`;
  view.innerHTML = latest
    ? `<section class="v2-sec">
        <h2>이번 주 <small>${escapeHtml(range(latest))} · 노트 ${latest.note_count ?? "-"}건 기반</small></h2>
        ${latest.points.map(pointCard).join("")}
      </section>
      <section class="v2-sec">
        <h2>지난 주간 요약</h2>
        ${prev
          .slice(0, 8)
          .map(
            (w) => `<details class="v2-prev"><summary><time>${escapeHtml(range(w))}</time> ${escapeHtml(w.points?.[0]?.title ?? "")}</summary>
              ${w.points.map(pointCard).join("")}</details>`
          )
          .join("")}
      </section>
      <section class="v2-sec">
        <h2>용어집</h2>
        <dl class="v2-gloss">${Object.entries(ABBR).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
      </section>`
    : `<p class="v2-empty">아직 생성된 주간 요약이 없습니다. 토요일 크론 이후 표시됩니다.</p>`;
}

// ---- 탭 전환 (#hash로 기억) ----
const RENDER = { today: renderToday, indicators: renderIndicators, notes: renderNotes, weekly: renderWeekly };

function go(tab) {
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  v2.tab = RENDER[tab] ? tab : "today";
  document.querySelectorAll(".v2-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === v2.tab)));
  RENDER[v2.tab](document.getElementById("view"));
  window.scrollTo({ top: 0 });
}

async function v2Main() {
  const safe = (p) => loadJson(p).catch(() => null);
  const [index, ind, health, summary] = await Promise.all([
    safe("/data/index.json"),
    safe("/data/indicators/latest.json"),
    safe("/data/health/latest.json"),
    safe("/data/summary/index.json"),
  ]);
  v2.notes = (index?.notes ?? []).slice().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  v2.generatedAt = index?.generated_at ?? null;
  v2.indicators = ind?.indicators ?? [];
  state.indicators = v2.indicators; // app.js 모달이 참조
  v2.byKey = new Map(v2.indicators.map((i) => [indicatorKey(i), i]));
  v2.health = health;
  v2.summary = { daily: summary?.daily ?? [], weekly: summary?.weekly ?? [] };

  if (!index) document.getElementById("statusLine").textContent = "노트 데이터 로드 실패";
  else renderStatus();

  document.querySelectorAll(".v2-tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
  initIndicatorModal();
  window.addEventListener("hashchange", () => go(location.hash.slice(1) || "today"));
  go(location.hash.slice(1) || "today");
}

v2Main();
