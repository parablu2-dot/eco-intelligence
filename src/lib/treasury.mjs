// treasury.mjs
// TreasuryDirect 공개 API에서 미 국채 입찰 결과(최근)·예정을 가져온다. API 키 불필요 (T1, 2026-10-05).
// Bill(단기물)은 매주 수십 건이라 제외하고 Note/Bond(TIPS·FRN 포함)만 남긴다.

const BASE = "https://www.treasurydirect.gov/TA_WS/securities";

function num(v) {
  return v === "" || v === null || v === undefined ? null : Number(v);
}

function slim(x) {
  return {
    auction_date: x.auctionDate?.slice(0, 10) ?? null,
    issue_date: x.issueDate?.slice(0, 10) ?? null,
    security_type: x.securityType,
    security_term: x.securityTerm,
    tips: x.tips === "Yes",
    floating_rate: x.floatingRate === "Yes",
    high_yield: num(x.highYield),
    bid_to_cover: num(x.bidToCoverRatio),
    offering_amount: num(x.offeringAmount),
    cusip: x.cusip,
  };
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TreasuryDirect ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function fetchTreasuryAuctions({ recentDays = 14 } = {}) {
  const [recent, upcoming] = await Promise.all([
    getJson(`${BASE}/auctioned?format=json&days=${recentDays}`),
    getJson(`${BASE}/upcoming?format=json`),
  ]);
  const notBill = (x) => x.securityType !== "Bill";
  return {
    source_url: "https://www.treasurydirect.gov/auctions/",
    recent: recent.filter(notBill).map(slim).sort((a, b) => b.auction_date.localeCompare(a.auction_date)),
    upcoming: upcoming.filter(notBill).map(slim).sort((a, b) => a.auction_date.localeCompare(b.auction_date)),
  };
}
