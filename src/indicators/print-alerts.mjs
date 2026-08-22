// print-alerts.mjs
// data/indicators/latest.json에서 alert_flag=true 항목만 골라 "이번 주 알림" 마크다운 섹션을
// stdout에 출력한다. daily-triage.yml이 이 출력을 $GITHUB_STEP_SUMMARY에 append해
// 워크플로 실행 결과(Summary 탭) 상단에 노출한다.
// 임계값은 config/indicator-thresholds.json 가안 — 토요일 세션에서 천이 확정 전까지 참고용.

import { loadActiveAlerts } from "./core-snapshot.mjs";

async function main() {
  const alerts = await loadActiveAlerts();

  console.log("## 이번 주 알림\n");
  if (alerts.length === 0) {
    console.log("현재 임계값을 넘은 지표 없음. (임계값은 가안 — 토요일 세션 확정 전)\n");
    return;
  }

  for (const a of alerts) {
    const change = typeof a.week_change_pct === "number" ? ` (주간 ${a.week_change_pct.toFixed(1)}%)` : "";
    console.log(`- **${a.alert_label ?? "알림"}** — ${a.label}: ${a.value}${a.unit ?? ""}${change} (${a.date})`);
  }
  console.log("\n_임계값은 딥리서치 초안(가안) — 토요일 세션에서 천이 확정 예정._\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
