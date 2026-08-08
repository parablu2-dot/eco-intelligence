// cheon-view-defaults.mjs
// distillation 직후 cheon_view에 트리아지 파이프라인 필드(status/triage_score/axis_tag/
// draft_judgment/reviewed_at/reject_reason)의 기본값을 부여한다.
// id 부여와 동일한 이유로 모델이 아닌 코드에서 결정론적으로 채움 — 필드 존재 여부를
// 모델에 맡기지 않는다(자관_ECO애널리스트_ClaudeCode스펙_v1.0 §1).
// 이미 값이 있는 필드는 덮어쓰지 않는다 — 마이그레이션/재실행 시 기존 진행 상태 보존.

export function applyCheonViewDefaults(note) {
  const cv = note.cheon_view ?? {};
  note.cheon_view = {
    ...cv,
    status: cv.status ?? "pending",
    triage_score: cv.triage_score ?? null,
    axis_tag: cv.axis_tag ?? null,
    draft_judgment: cv.draft_judgment ?? null,
    reviewed_at: cv.reviewed_at ?? null,
    reject_reason: cv.reject_reason ?? null,
  };
  return note;
}
