// alerts.mjs
// config/indicator-thresholds.json의 규칙으로 각 지표의 alert_flag를 계산한다.
// 임계값은 가안(딥리서치 초안) — 토요일 세션에서 천이 값만 확정하며, 이 파일의 규칙 타입(type)
// 구현 자체는 그대로 유지된다. LLM 미경유, 순수 룰 기반 (기존 score-notes.mjs와 동일 원칙).

import fs from "fs/promises";
import path from "path";
import { recentValues } from "./history.mjs";

const DEFAULT_CONFIG_PATH = path.resolve("config/indicator-thresholds.json");

export async function loadThresholds(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return JSON.parse(raw).thresholds ?? {};
  } catch (err) {
    console.error(`[alerts] indicator-thresholds.json 로드 실패, 알림 없이 진행: ${err.message}`);
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

// results(오늘자 indicator 레코드 배열)에 alert_flag(+ 매칭 시 alert_label)를 부여한다.
export async function applyAlerts(results, { configPath } = {}) {
  const thresholds = await loadThresholds(configPath);

  for (const r of results) {
    const rule = r.indicator_id ? thresholds[r.indicator_id] : null;
    if (!rule) {
      r.alert_flag = false;
      continue;
    }

    const needDays = rule.type === "value_below_sustained" ? (rule.days ?? 3) - 1 : 0;
    const history = needDays > 0 ? (await recentValues(r.indicator_id, needDays)).map((h) => h.value) : [];

    r.alert_flag = evaluateRule(rule, r, history);
    if (r.alert_flag) r.alert_label = rule.label;
  }

  return results;
}
