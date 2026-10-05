// indicator-alerts.test.mjs
// 지표 경보 판정 로직(src/indicators/alerts.mjs) 단위테스트.
// 테스트의 임계값은 임의의 숫자다 — 실제 값은 Secret(ECO_THRESHOLDS_JSON)에만 있고 repo에 두지 않는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRule, loadThresholds, computeAlerts } from "../src/indicators/alerts.mjs";

test("week_change_pct_below: 주간 하락폭이 임계값보다 크면(더 음수면) true", () => {
  const rule = { type: "week_change_pct_below", value: -4 };
  assert.equal(evaluateRule(rule, { week_change_pct: -4.5 }), true);
  assert.equal(evaluateRule(rule, { week_change_pct: -4 }), true, "정확히 임계값도 충족(<=)");
  assert.equal(evaluateRule(rule, { week_change_pct: -3.9 }), false);
  assert.equal(evaluateRule(rule, { week_change_pct: undefined }), false, "값이 없으면 false(오탐 방지)");
});

test("value_at_or_above: 값이 임계값 이상이면 true", () => {
  const rule = { type: "value_at_or_above", value: 7 };
  assert.equal(evaluateRule(rule, { value: 7 }), true);
  assert.equal(evaluateRule(rule, { value: 7.01 }), true);
  assert.equal(evaluateRule(rule, { value: 6.99 }), false);
});

test("value_below: 값이 임계값 미만이면 true", () => {
  const rule = { type: "value_below", value: 0 };
  assert.equal(evaluateRule(rule, { value: -0.01 }), true);
  assert.equal(evaluateRule(rule, { value: 0 }), false);
  assert.equal(evaluateRule(rule, { value: 0.1 }), false);
});

test("value_below_sustained: N일 연속 임계값 미만이어야 true", () => {
  const rule = { type: "value_below_sustained", value: 1000, days: 3 };
  assert.equal(evaluateRule(rule, { value: 990 }, [995, 980]), true);
  assert.equal(evaluateRule(rule, { value: 990 }, [1005, 980]), false, "연속성 깨짐");
  assert.equal(evaluateRule(rule, { value: 990 }, [980]), false, "이력 부족 — 오탐 방지로 false");
  assert.equal(evaluateRule(rule, { value: 990 }, []), false);
});

test("알 수 없는 rule.type은 false(안전한 기본값)", () => {
  assert.equal(evaluateRule({ type: "unknown_type", value: 1 }, { value: 999 }), false);
});

test("loadThresholds: Secret 문자열을 파싱하고, 없거나 깨졌으면 빈 룰", () => {
  const raw = JSON.stringify({ thresholds: { x: { type: "value_below", value: 1, label: "L" } } });
  assert.deepEqual(Object.keys(loadThresholds(raw)), ["x"]);
  assert.deepEqual(loadThresholds(""), {});
  assert.deepEqual(loadThresholds(undefined), {});
  assert.deepEqual(loadThresholds("{not json"), {});
});

test("computeAlerts: 걸린 지표만 새 객체로 반환하고 입력 레코드는 바꾸지 않는다", async () => {
  const thresholds = { a: { type: "value_at_or_above", value: 7, label: "A경보" } };
  const indicators = [
    { indicator_id: "a", label: "A", value: 8, unit: "%", date: "2026-10-01" },
    { indicator_id: "b", label: "B", value: 100 },
    { label: "no id", value: 1 },
  ];
  const before = JSON.stringify(indicators);
  const alerts = await computeAlerts(indicators, { thresholds });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].indicator_id, "a");
  assert.equal(alerts[0].alert_label, "A경보");
  assert.equal(alerts[0].value_date, "2026-10-01");
  assert.equal(JSON.stringify(indicators), before, "입력에 alert_flag 등이 붙으면 안 됨(파일 저장 방지)");
});

test("computeAlerts(D9): 룰 formula가 지표 formula와 다르면 판정 보류", async () => {
  const rec = { indicator_id: "retention_rate", value: 50, formula: "kospi_div_usdkrw" };
  const legacy = { retention_rate: { type: "value_below", value: 60 } };
  assert.deepEqual(await computeAlerts([rec], { thresholds: legacy }), [], "formula 없는 옛 룰은 새 공식 값에 쓰지 않는다");
  const approved = { retention_rate: { type: "value_below", value: 60, formula: "kospi_div_usdkrw" } };
  assert.equal((await computeAlerts([rec], { thresholds: approved })).length, 1);
  const plain = { indicator_id: "us10y", value: 5 };
  assert.equal((await computeAlerts([plain], { thresholds: { us10y: { type: "value_at_or_above", value: 4 } } })).length, 1, "formula 없는 지표는 기존대로");
});
