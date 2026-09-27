// dates.mjs
// 파일명·노트 날짜(YYYYMMDD)의 공통 기준 = KST(UTC+9).
// 일일 cron은 06:00~07:50 KST로 예약돼 있지만 GitHub Actions 지연으로 실제 실행은 UTC 자정 전후
// (23:00~02:00 UTC)에 흩어진다. UTC 날짜를 쓰면 같은 아침 배치의 노트가 두 날짜로 쪼개져
// daily-summary/triage(당일 파일만 읽음)가 자정 전에 끝난 축을 통째로 놓친다(2026-09-19~27 요약 공백).
// KST로는 배치 전체가 같은 날(06:00~11:00 KST)이므로 날짜가 갈라지지 않는다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 벽시계를 KST로 옮긴 Date. toISOString().slice(0, 10)·setUTCDate 산술이 KST 달력일 기준으로 동작한다.
// 날짜 계산 전용 — generated_at 같은 실제 타임스탬프에는 new Date()를 그대로 쓸 것.
export function nowKst() {
  return new Date(Date.now() + KST_OFFSET_MS);
}

export function compactDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function todayCompactKst() {
  return compactDate(nowKst());
}
