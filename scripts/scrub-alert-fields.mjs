// scrub-alert-fields.mjs
// 1회성 정리(T0, 2026-10-05): 공개 산출물(data/indicators, data/summary)에서 임계값 판정 흔적
// (alert_flag/alert_label, summary의 alerts)을 제거한다. 경보는 이제 메일 발송 단계 내부에서만 계산하고
// 파일로 남기지 않는다. 재실행해도 안전(멱등).

import fs from "fs/promises";
import path from "path";

const ALERT_KEYS = new Set(["alert_flag", "alert_label", "alerts"]);

function scrub(node) {
  if (Array.isArray(node)) node.forEach(scrub);
  else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (ALERT_KEYS.has(k)) delete node[k];
      else scrub(node[k]);
    }
  }
}

let changed = 0;
for (const dir of ["data/indicators", "data/summary"]) {
  for (const f of await fs.readdir(path.resolve(dir))) {
    if (!f.endsWith(".json")) continue;
    const p = path.resolve(dir, f);
    const before = await fs.readFile(p, "utf-8");
    const data = JSON.parse(before);
    scrub(data);
    const after = JSON.stringify(data, null, 2);
    if (after !== before) {
      await fs.writeFile(p, after);
      changed++;
    }
  }
}
console.log(`[scrub-alert-fields] ${changed} file(s) updated`);
