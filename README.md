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
3. **인덱싱** — `scripts/build-index.mjs`가 distill 직후(commit 이전)에 `data/daily/*.json`(raw 제외)+`data/baseline/*.json`을 모아 `data/index.json` 하나로 병합(축별 count 포함) — 프론트가 fetch 1번으로 전체 데이터를 읽도록
4. **프론트 = 정적 대시보드** — `public/`(순수 HTML/CSS/JS, 빌드 스텝 없음), `data/index.json`을 fetch해서 렌더링. Cloudflare Pages 배포 시 **빌드 출력 디렉터리를 repo root(`.`)로 설정**해야 함 — `public/`과 `data/`가 형제 폴더라 루트 기준 `/data/index.json` 절대경로로 fetch하기 때문 (SoC 대시보드와 동일한 이유로 동일 설정)

## 프론트 (`public/`)
- `index.html` + `style.css` + `app.js`, 순수 정적 파일(빌드 불필요)
- KPI row(7축 카드, 클릭 시 axis 필터) + 검색·stance 필터 + 노트 카드 리스트
- 카드: headline·facts·keywords·stance·`cheon_view.note`(비어있으면 "리뷰 대기" 표시)·원문 링크
- 로컬 확인: **repo root에서** 정적 서버 실행 후 `/public/index.html` 접속 (예: `python3 -m http.server 8000` → `http://localhost:8000/public/index.html`). `site/`가 아니라 root에서 띄워야 `/data/index.json`이 같이 서빙됨
- 다크모드는 `prefers-color-scheme` 자동 대응 (별도 토글 없음)

## 축별 1차 소스 (allowlist)
| axis | 1차 소스 | crawler | distillation |
|---|---|---|---|
| geopolitics | U.S. Department of State 보도자료 | `src/crawlers/crawl-geopolitics.mjs` | `src/distillation/distill-geopolitics.mjs` |
| polarization | CBO(미 의회예산국) 발간물 | `src/crawlers/crawl-polarization.mjs` | `src/distillation/distill-polarization.mjs` |
| fed_policy | 연준 공식 발표(Press Releases/Monetary Policy) | `src/crawlers/crawl-fed.mjs` | `src/distillation/distill-fed.mjs` |
| productivity_ai | NIST 뉴스 | `src/crawlers/crawl-productivity_ai.mjs` | `src/distillation/distill-productivity_ai.mjs` |
| us_investment | SEC 보도자료 | `src/crawlers/crawl-us_investment.mjs` | `src/distillation/distill-us_investment.mjs` |
| rates_fx | 연준 H.15(금리)+H.10(환율) | `src/crawlers/crawl-rates_fx.mjs` | `src/distillation/distill-rates_fx.mjs` |
| commodities_energy | EIA Today in Energy | `src/crawlers/crawl-commodities_energy.mjs` | `src/distillation/distill-commodities_energy.mjs` |

각 축은 `.github/workflows/daily-{axis}.yml`로 매일 cron 실행(6:00~7:20 KST, 10분 간격 스태거).
7축 모두 실네트워크 crawler dry-run 검증 완료. distillation(Claude API 호출)은 `ANTHROPIC_API_KEY` 미보유로 로컬 미검증.

## 켜뮤 연결
- `vault_pointer` 필드로 켜뮤 vault 원본 경로만 참조 (텍스트 복붙 금지, 입력 고정 원칙 유지)
- 노트가 안정되면(`cheon_view.note` 채워짐) 켜뮤 Permanent 노트로 승격

## 다음 단계
- [x] GitHub repo 생성 + push (`github.com/parablu2-dot/eco-intelligence`)
- [x] `ANTHROPIC_API_KEY` GitHub Secret 등록 + `workflow_dispatch`로 distillation 실전 검증 (fed_policy 축 확인 완료)
- [x] `public/` 정적 대시보드 프론트 구현
- [ ] 나머지 6축도 workflow_dispatch로 재실행해 distillation 결과 확인 (API key 등록 전 실행분이라 raw만 있고 증류 결과 없음)
- [ ] Cloudflare Pages 프로젝트 생성 + 배포 (빌드 출력 디렉터리 = repo root)
