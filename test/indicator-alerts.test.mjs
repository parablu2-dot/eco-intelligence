// indicator-alerts.test.mjs
// config/indicator-thresholds.json 기반 alert_flag 판정 로직(src/indicators/alerts.mjs) 단위테스트.
// evaluateRule은 fs 의존 없는 순수 함수라 mock 없이 바로 테스트 가능.
// (거시분석_인과사슬지도_20260822.md §5 "alert_flag 로직 단위테스트 통과")

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRule, loadThresholds } from "../src/indicators/alerts.mjs";

test("week_change_pct_below: 주간 하락폭이 임계값보다 크면(더 음수면) true", () => {
  const rule = { type: "week_change_pct_below", value: -3 };
  assert.equal(evaluateRule(rule, { week_change_pct: -3.5 }), true, "-3.5%는 -3% 임계를 충족");
  assert.equal(evaluateRule(rule, { week_change_pct: -3 }), true, "정확히 -3%도 충족(<=)");
  assert.equal(evaluateRule(rule, { week_change_pct: -2.9 }), false, "-2.9%는 미충족");
  assert.equal(evaluateRule(rule, { week_change_pct: undefined }), false, "값이 없으면 false(오탐 방지)");
});

test("value_at_or_above: 값이 임계값 이상이면 true", () => {
  const rule = { type: "value_at_or_above", value: 5.5 };
  assert.equal(evaluateRule(rule, { value: 5.5 }), true);
  assert.equal(evaluateRule(rule, { value: 5.51 }), true);
  assert.equal(evaluateRule(rule, { value: 5.49 }), false);
});

test("value_below: 값이 임계값 미만이면 true", () => {
  const rule = { type: "value_below", value: 0 };
  assert.equal(evaluateRule(rule, { value: -0.01 }), true);
  assert.equal(evaluateRule(rule, { value: 0 }), false, "0은 마이너스 전환이 아니므로 미충족");
  assert.equal(evaluateRule(rule, { value: 0.1 }), false);
});

test("value_below_sustained: N일 연속 임계값 미만이어야 true", () => {
  const rule = { type: "value_below_sustained", value: 1350, days: 3 };
  // 과거 2일 + 오늘 = 3일 모두 하회
  assert.equal(evaluateRule(rule, { value: 1340 }, [1345, 1330]), true);
  // 과거 하루가 임계값을 넘음 — 연속성 깨짐
  assert.equal(evaluateRule(rule, { value: 1340 }, [1355, 1330]), false);
  // 스냅샷이 아직 3일치 안 쌓임 — 오탐 방지로 false
  assert.equal(evaluateRule(rule, { value: 1340 }, [1330]), false);
  assert.equal(evaluateRule(rule, { value: 1340 }, []), false);
});

test("알 수 없는 rule.type은 false(안전한 기본값)", () => {
  assert.equal(evaluateRule({ type: "unknown_type", value: 1 }, { value: 999 }), false);
});

test("indicator-thresholds.json이 4개 룰(usdjpy/us30y/t10y2y/usdkrw)을 정의하고 있다", async () => {
  const thresholds = await loadThresholds();
  for (const id of ["usdjpy", "us30y", "t10y2y", "usdkrw"]) {
    assert.ok(thresholds[id], `${id} 룰이 config/indicator-thresholds.json에 없음`);
    assert.ok(thresholds[id].label, `${id} 룰에 label이 없음`);
  }
});
