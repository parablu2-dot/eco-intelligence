// llm-errors.mjs
// LLM 호출 실패를 워크플로 결과(빨간불)로 드러내기 위한 공유 헬퍼.
// 2026-09-22~26 크레딧 소진 때 distill이 fail-soft로 "no notes produced"만 찍고
// 워크플로는 성공(초록)으로 끝나 4일간 아무도 몰랐음 — 그 재발 방지.
// 스크립트는 기존대로 fail-soft(다음 스텝·커밋 계속)이고, 여기 기록된 게 있으면
// 워크플로 마지막 "Fail on LLM errors" 스텝이 exit 1 한다.

import fs from "fs";

const LOG_PATH = ".llm-errors.log";

export function recordLlmError(tag, message) {
  fs.appendFileSync(LOG_PATH, `[${tag}] ${message}\n`);
}
