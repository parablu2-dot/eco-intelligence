# eco-intelligence

『부의 갈림길』 독서토론에서 파생된 거시경제 동향 추적 시스템.
SoC Intelligence Dashboard와 동일 스택(GitHub Actions + Cloudflare, runtime-token-zero) 재사용.
배포는 Cloudflare **Workers**(정적 자산 배포, `wrangler.jsonc`)로 진행 — Pages가 아님, 아래 배포 섹션 참고.

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
4. **프론트 = 정적 대시보드** — `index.html`(repo root) + `public/style.css`+`public/app.js`, `data/index.json`을 fetch해서 렌더링. Cloudflare Workers 정적 자산 배포는 `wrangler.jsonc`의 `assets.directory: "."`(repo root)로 설정 — `public/`과 `data/`가 형제 폴더라 루트 전체를 자산 디렉터리로 잡아야 `/data/index.json`도 같이 서빙됨

## 프론트
- `index.html`(repo root, 사이트 진입점) + `public/style.css` + `public/app.js`, 순수 정적 파일(빌드 불필요)
- `index.html`이 repo root에 있는 이유: Cloudflare Workers 정적 자산은 `/index.html`을 `/`로 자동 리다이렉트하는 내장 동작이 있어서, `public/index.html`을 `/`로 연결하려던 `_redirects` 트릭이 "무한루프 가능성"으로 배포 자체가 거부됨(`Invalid _redirects configuration`) — 그냥 root에 index.html을 두는 쪽이 더 단순하고 안전
- KPI row(7축 카드, 클릭 시 axis 필터) + 검색·stance 필터 + 노트 카드 리스트
- 카드: headline·facts·keywords·stance·`cheon_view.note`(비어있으면 "리뷰 대기" 표시)·원문 링크
- 로컬 확인: **repo root에서** 정적 서버 실행 후 접속 (예: `python3 -m http.server 8000` → `http://localhost:8000/`)
- 다크모드는 `prefers-color-scheme` 자동 대응 (별도 토글 없음)

## 축별 1차 소스 (allowlist)
| axis | 1차 소스 | crawler | distillation |
|---|---|---|---|
| geopolitics | U.S. Department of State 보도자료 | `src/crawlers/crawl-geopolitics.mjs` | `src/distillation/distill-geopolitics.mjs` |
| polarization | CBO(미 의회예산국) 발간물 | `src/crawlers/crawl-polarization.mjs` | `src/distillation/distill-polarization.mjs` |
| fed_policy | 연준 공식 발표(Press Releases/Monetary Policy) | `src/crawlers/crawl-fed.mjs` | `src/distillation/distill-fed.mjs` |
| productivity_ai | NIST 뉴스 | `src/crawlers/crawl-productivity_ai.mjs` | `src/distillation/distill-productivity_ai.mjs` |
| us_investment | SEC 보도자료 | `src/crawlers/crawl-us_investment.mjs` | `src/distillation/distill-us_investment.mjs` |
| rates_fx | 연준 H.10(환율, DDP 공지문 필터링) | `src/crawlers/crawl-rates_fx.mjs` | `src/distillation/distill-rates_fx.mjs` |
| commodities_energy | EIA Today in Energy | `src/crawlers/crawl-commodities_energy.mjs` | `src/distillation/distill-commodities_energy.mjs` |

각 축은 `.github/workflows/daily-{axis}.yml`로 매일 cron 실행(6:00~7:20 KST, 10분 간격 스태거).
**7축 전체 workflow_dispatch 실전 검증 완료** (2026-07-25) — `data/index.json` 기준 총 209 notes.
rates_fx는 최초 H.15(Selected Interest Rates) 포함 버전이 실제로는 DDP 툴 변경이력 위주라 제거,
H.10만 남기고 boilerplate 필터링 적용(170건→54건). `src/crawlers/crawl-rates_fx.mjs` 상단 주석 참고.

## 켜뮤 연결
- `vault_pointer` 필드로 켜뮤 vault 원본 경로만 참조 (텍스트 복붙 금지, 입력 고정 원칙 유지)
- 노트가 안정되면(`cheon_view.note` 채워짐) 켜뮤 Permanent 노트로 승격

## Cloudflare 배포 (Workers 정적 자산 — Pages 아님)
Cloudflare 대시보드에서 "Connect to Git"으로 이 repo를 연결하면 Pages가 아니라 **Workers** 정적 자산 배포로 자동 구성됨(`cloudflare-workers-and-pages[bot]`이 `wrangler.jsonc`를 자동 생성). 실제 배포 주소는 `*.pages.dev`가 아니라 `<project-name>.<account>.workers.dev` 형태.

핵심 설정 (`wrangler.jsonc`):
- `assets.directory: "."` — repo root 전체를 자산으로 취급(`public/`+`data/` 둘 다 서빙되도록)
- `.assetsignore`(repo root, `.gitignore`와 동일 문법)에 `node_modules`/`.git`/`.wrangler` 제외 — **필수**. 안 넣으면 `npm clean-install`이 만든 node_modules까지 자산 스캔에 포함되어 wrangler 자체 의존성(122MiB 바이너리)이 Workers 자산 파일당 25MiB 제한을 넘어 배포 실패함
- root의 `index.html`이 진입점 (`public/index.html`이 아님 — 위 "프론트" 섹션 참고)

배포 후 확인:
1. `https://<실제주소>.workers.dev/` 접속 → 대시보드 렌더링 확인
2. `https://<실제주소>.workers.dev/data/index.json` 직접 접속 → JSON 나오는지 확인
3. 이후 GitHub Actions가 `data/`에 매일 커밋 → main push 시 Cloudflare가 자동 재배포 (Deployments 탭에서 커밋 해시로 확인 가능)

## 다음 단계
- [x] GitHub repo 생성 + push (`github.com/parablu2-dot/eco-intelligence`)
- [x] `ANTHROPIC_API_KEY` GitHub Secret 등록 + 7축 전체 `workflow_dispatch` 실전 검증
- [x] `public/` 정적 대시보드 프론트 구현
- [ ] Cloudflare Pages 프로젝트 생성 + 배포 (위 단계, 계정 로그인 필요해 사용자 직접 진행)
