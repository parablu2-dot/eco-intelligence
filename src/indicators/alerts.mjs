// alerts.mjs
// 지표 임계값 경보 판정. 임계값은 개인 설정이라 공개 repo에 두지 않는다 —
// 런타임에 GitHub Secret ECO_THRESHOLDS_JSON(JSON 문자열)에서만 읽는다.
// 구조 예시: config/indicator-thresholds.example.json.
// 판정 결과는 메일 발송 단계 내부에서만 쓰고 파일(data/*)에는 남기지 않는다 (T0, 2026-10-05).
// LLM 미경유, 순수 룰 기반.

import { recentValues } from "./history.mjs";

// env 미설정·파싱 실패 시 빈 룰 = 경보 없음 (fail-soft).
export function loadThresholds(raw = process.env.ECO_THRESHOLDS_JSON) {
  if (!raw) return {};
  try {
    return JSON.parse(raw).thresholds ?? {};
  } catch (err) {
    console.error(`[alerts] ECO_THRESHOLDS_JSON 파싱 실패, 경보 없이 진행: ${err.message}`);
    return {};
  }
}

// 순수 함수 — rule/current/history만으로 판정하므로 단위테스트가 fs 없이 가능하다.
// current: { value, week_change_pct } 형태의 오늘자 지표 레코드
// historyValues: 과거 값(오래된 순, 오늘 제외) 배열 — value_below_sustained 타입에서만 사용
export function evaluateRule(rule, current, historyValues = []) {
  switch (rule.type) {
    case "week_change_pct_below":
      return typeof current.week_change_pct === "number" && current.week_change_pct <= rule.value;

    case "value_at_or_above":
      return typeof current.value === "number" && current.value >= rule.value;

    case "value_below":
      return typeof current.value === "number" && current.value < rule.value;

    case "value_below_sustained": {
      const days = rule.days ?? 3;
      const series = [...historyValues, current.value];
      // 스냅샷이 아직 days일치만큼 쌓이지 않았으면 오탐 방지를 위해 false(미충족)로 처리
      if (series.length < days) return false;
      return series.slice(-days).every((v) => typeof v === "number" && v < rule.value);
    }

    default:
      console.error(`[alerts] 알 수 없는 threshold type: ${rule.type}`);
      return false;
  }
}

// indicators(스냅샷의 지표 레코드 배열)를 바꾸지 않고, 경보에 걸린 지표만 새 객체로 반환한다.
// 반환값은 메일 본문 렌더링에만 쓴다 — 파일로 저장하지 말 것.
// sustained 룰의 과거값은 data/indicators/ 스냅샷에서 읽으므로, 스냅샷 저장 *이후*에 호출하면
// 오늘자가 이력에 포함된다 — 그래서 이력에서 asOf(오늘 스냅샷 날짜) 이후 값은 제외한다.
export async function computeAlerts(indicators, { thresholds = loadThresholds(), asOf } = {}) {
  const alerts = [];
  for (const r of indicators) {
    const rule = r.indicator_id ? thresholds[r.indicator_id] : null;
    if (!rule) continue;
    // 계산 공식이 바뀐 지표(잔존율, D9)는 룰의 formula가 레코드와 같을 때만 판정한다.
    // formula 없는 기존 룰은 옛 공식 기준 경계값이라 새 공식 값에 쓰지 않는다 — 새 경계 승인 전 보류.
    if ((rule.formula ?? null) !== (r.formula ?? null)) {
      console.error(`[alerts] ${r.indicator_id}: 룰 formula(${rule.formula ?? "없음"}) ≠ 지표 formula(${r.formula ?? "없음"}) — 판정 보류`);
      continue;
    }

    const needDays = rule.type === "value_below_sustained" ? (rule.days ?? 3) - 1 : 0;
    let history = [];
    if (needDays > 0) {
      const recent = await recentValues(r.indicator_id, needDays + 1, { formula: r.formula });
      history = recent.filter((h) => !asOf || h.date < asOf).slice(-needDays).map((h) => h.value);
    }

    if (evaluateRule(rule, r, history)) {
      alerts.push({
        indicator_id: r.indicator_id,
        label: r.label,
        alert_label: rule.label ?? "경보",
        value: r.value,
        unit: r.unit,
        week_change_pct: r.week_change_pct,
        value_date: r.value_date ?? r.date,
      });
    }
  }
  return alerts;
}
