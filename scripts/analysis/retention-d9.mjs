// retention-d9.mjs
// 잔존율 공식 변경(D9, 2026-10-05) 근거 재현 스크립트 — 결과는 docs/retention-formula-d9.md.
// 구 공식 O = KOSPI × USD/KRW, 신 공식 N = KOSPI ÷ USD/KRW. API 키 불필요(Yahoo 일봉 + FRED 공개 CSV).
//   node scripts/analysis/retention-d9.mjs
// ① 피크 재탐색 ② Zone 경계 분위수 매칭 ③ 위기 구간 백테스트 ④ 9/11·9/18 스냅샷 불일치 재계산
//
// 장기 구간 비율은 "그날까지의 최고점(running peak) 대비 %"로 잰다 — 고정 피크 대비 잔존율을
// 과거 전 구간에 일반화한 것. Zone 경계(구): Z1 <60, Z2 60~75, Z3 ≥75 (financial_risk_framework_dashboard.md).

import { localDate } from "../../src/lib/yahoo.mjs";

const OLD_PEAK = 14009063; // 구 공식 고정 피크(2026-06-22, 9114.55 × 1537.0)

async function yahooDaily(ticker, from) {
  const p1 = Math.floor(Date.parse(from) / 1000), p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${p1}&period2=${p2}`;
  const r = (await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (eco-intelligence bot)" } })).json()).chart.result[0];
  const off = r.meta.gmtoffset ?? 0, c = r.indicators.quote[0].close, m = new Map();
  r.timestamp.forEach((t, i) => typeof c[i] === "number" && m.set(localDate(t, off), c[i]));
  return m;
}

async function fredCsv(id) {
  const txt = await (await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`)).text();
  return new Map(txt.trim().split("\n").slice(1).map((l) => l.split(",")).filter(([, v]) => v && v !== ".").map(([d, v]) => [d, +v]));
}

const join = (K, F) =>
  [...K].filter(([d]) => F.has(d)).map(([d, k]) => ({ d, k, f: F.get(d), o: k * F.get(d), n: k / F.get(d) })).sort((a, b) => a.d.localeCompare(b.d));

function runningRatio(S, key) {
  let m = -Infinity;
  return S.map((r) => ((m = Math.max(m, r[key])), { d: r.d, v: (r[key] / m) * 100 }));
}

function quantile(a, q) {
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}

// 구 공식의 Zone별 체류 비율을 신 공식에서 그대로 재현하는 경계값
function calibrate(S, from) {
  const ro = runningRatio(S, "o").filter((r) => r.d >= from).map((r) => r.v);
  const rn = runningRatio(S, "n").filter((r) => r.d >= from).map((r) => r.v);
  const z1 = ro.filter((v) => v < 60).length / ro.length, z2 = ro.filter((v) => v >= 60 && v < 75).length / ro.length;
  return { from, n: ro.length, z1, z2, b1: quantile(rn, z1), b2: quantile(rn, z1 + z2) };
}

function firstBelow(R, from, to, th) {
  return R.find((r) => r.d >= from && r.d <= to && r.v < th)?.d ?? "—";
}

const f = (x, d = 1) => x.toFixed(d);

const K = await yahooDaily("^KS11", "1997-01-01");
const FY = await yahooDaily("KRW=X", "2003-12-01");
const FD = await fredCsv("DEXKOUS");
const SY = join(K, FY), SD = join(K, FD);

console.log("## ① 피크 재탐색");
for (const [name, S] of [["Yahoo KRW=X", SY], ["FRED DEXKOUS", SD]]) {
  const mo = S.reduce((a, b) => (b.o > a.o ? b : a)), mn = S.reduce((a, b) => (b.n > a.n ? b : a));
  console.log(`${name} ${S[0].d}~${S.at(-1).d} (n=${S.length}) 구 최고 ${mo.d} ${f(mo.o, 0)} | 신 최고 ${mn.d} K ${f(mn.k, 2)} ÷ F ${f(mn.f, 2)} = ${f(mn.n, 4)}`);
  console.log(`  신 상위5: ${[...S].sort((a, b) => b.n - a.n).slice(0, 5).map((r) => `${r.d} ${f(r.n, 4)}`).join(", ")}`);
}

console.log("\n## ② Zone 경계 분위수 매칭");
const cals = [["FRED 1997~", calibrate(SD, "1997-01-03")], ["FRED 2003-12~", calibrate(SD, "2003-12-01")], ["Yahoo 2003-12~", calibrate(SY, "2003-12-01")]];
for (const [name, c] of cals)
  console.log(`${name} n=${c.n} 구 체류 Z1 ${f(c.z1 * 100)}% Z2 ${f(c.z2 * 100)}% Z3 ${f((1 - c.z1 - c.z2) * 100)}% → 신 경계 Z1 <${f(c.b1)} Z2 <${f(c.b2)}`);

const peakN = SY.find((r) => r.d === "2026-06-22").n;
const post = SY.filter((r) => r.d >= "2026-06-22");
const zone = (v, b1, b2) => (v < b1 ? 1 : v < b2 ? 2 : 3);
const tally = (vals, b1, b2) => [1, 2, 3].map((z) => vals.filter((v) => zone(v, b1, b2) === z).length).join("/");
console.log(`6/22 이후 ${post.length}거래일 Zone1/2/3 일수 — 구(60/75): ${tally(post.map((r) => (r.o / OLD_PEAK) * 100), 60, 75)}`);
for (const [name, c] of [...cals, ["경계 유지 60/75", { b1: 60, b2: 75 }]])
  console.log(`  신(${name}): ${tally(post.map((r) => (r.n / peakN) * 100), c.b1, c.b2)}`);

console.log("\n## ③ 백테스트 (FRED DEXKOUS, running peak 대비)");
const cal = cals[0][1];
const ro = runningRatio(SD, "o"), rn = runningRatio(SD, "n");
for (const [name, from, to] of [
  ["1997 외환위기", "1997-06-01", "1998-12-31"],
  ["2008 금융위기", "2007-10-01", "2009-03-31"],
  ["2020 코로나", "2020-01-01", "2020-04-30"],
  ["2022 긴축", "2021-06-01", "2022-12-31"],
]) {
  const seg = SD.filter((r) => r.d >= from && r.d <= to), low = seg.reduce((a, c) => (c.k < a.k ? c : a));
  const min = (R) => f(Math.min(...R.filter((r) => r.d >= from && r.d <= to).map((r) => r.v)));
  console.log(`${name} KOSPI ${f(seg[0].k, 0)}→${f(low.k, 0)}(${low.d}) 원/달러 ${f(seg[0].f, 0)}→${f(low.f, 0)} | 최저 구 ${min(ro)} 신 ${min(rn)}`);
  console.log(`  구 <75 ${firstBelow(ro, from, to, 75)} <60 ${firstBelow(ro, from, to, 60)} | 신(매칭) <${f(cal.b2)} ${firstBelow(rn, from, to, cal.b2)} <${f(cal.b1)} ${firstBelow(rn, from, to, cal.b1)} | 신(60/75) <75 ${firstBelow(rn, from, to, 75)} <60 ${firstBelow(rn, from, to, 60)}`);
}

console.log("\n## ④ 같은 날짜 값으로 재계산 (Yahoo)");
for (const d of ["2026-09-04", "2026-09-10", "2026-09-11", "2026-09-18", "2026-09-22", SY.at(-1).d]) {
  const r = SY.find((x) => x.d === d);
  if (r) console.log(`${d} K ${f(r.k, 2)} F ${f(r.f, 2)} 구 ${f((r.o / OLD_PEAK) * 100, 2)}% 신 ${f((r.n / peakN) * 100, 2)}%`);
}
