# eco-intelligence

『부의 갈림길』 독서토론에서 파생된 거시경제 동향 추적 시스템.
SoC Intelligence Dashboard와 동일 스택(GitHub Actions + Cloudflare Pages, runtime-token-zero) 재사용.

## 7축 Taxonomy
1. `geopolitics` — 지정학적 리스크
2. `polarization` — 양극화 (K자형/신흥국 이중격차)
3. `fed_policy` — 연준/통화정책
4. `productivity_ai` — 생산성 혁명 (AI)
5. `us_investment` — 미국 투자 (재정지배·달러패권)
6. `rates_fx` — 금리/환율
7. `commodities_energy` — 원자재/에너지

## 아키텍처 (3층, SoC/기존 뉴스대시보드 패턴 재사용)
1. **수집·증류** — GitHub Actions cron이 축별 crawler(RSS/공식 발표)를 돌려 원문 수집 → allowlist(1차 소스: 연준·정부·Reuters/Bloomberg/FT 등)만 통과 → Claude API(JSON schema 강제)로 `EcoDistillationNote` 생성
2. **저장 = git 커밋** — `data/daily/{axis}_{YYYYMMDD}.json`, URL 키로 dedupe(이미 증류한 원문은 재호출 안 함)
3. **프론트 = 정적 대시보드** — Cloudflare Pages, `data/baseline`(수동 큐레이션 기준선) + `data/daily`(일일 diff) 병합

## 파일럿 축: fed_policy (연준/통화정책)
- `src/crawlers/crawl-fed.mjs` — 연준 공식 발표 RSS 수집
- `src/distillation/distill-fed.mjs` — 신규 원문만 Claude API로 증류 (schema: `src/schema/distillation_note.schema.json`)
- `.github/workflows/daily-fed.yml` — 매일 cron 실행

## 켜뮤 연결
- `vault_pointer` 필드로 켜뮤 vault 원본 경로만 참조 (텍스트 복붙 금지, 입력 고정 원칙 유지)
- 노트가 안정되면(`cheon_view.note` 채워짐) 켜뮤 Permanent 노트로 승격

## 다음 단계
- [ ] `crawl-fed.mjs` / `distill-fed.mjs` 로컬 dry-run 검증
- [ ] `ANTHROPIC_API_KEY` GitHub Secret 등록
- [ ] Cloudflare Pages 프로젝트 생성 + 배포
- [ ] 나머지 6축 crawler 복제 (fed_policy 패턴 그대로)
