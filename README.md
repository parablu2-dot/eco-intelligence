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
8. `market_signals` — 주가(반도체/AI 서비스)·환율·채권 (2026-08 추가, 아래 별도 섹션 참고)

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

## Summary 페이지 (Daily/Weekly 종합 + 메일 발송)
- `summary.html`(repo root) + `public/summary.js` — Daily(오늘 3꼭지)/Weekly(지난 7일 5꼭지) 탭 전환, 최근 8건 히스토리 클릭 조회
- `src/summary/daily-summary.mjs`: 그날 `data/daily/{axis}_{YYYYMMDD}.json` 전체를 모아 Claude API로 3꼭지 종합 → `data/summary/daily_{YYYYMMDD}.json`(+`daily_latest.json`) 저장 → 메일 발송
- `src/summary/weekly-summary.mjs`: 지난 7일(오늘 포함)치를 모아 5꼭지 종합 → `data/summary/weekly_{YYYYMMDD}.json`(+`weekly_latest.json`) 저장 → 메일 발송
- `scripts/build-summary-index.mjs`: `data/summary/{daily,weekly}_*.json`을 모아 `data/summary/index.json`으로 병합 (프론트 fetch 1회용)
- 노트가 하루도 없으면(fail-soft) 요약 생성/메일 발송 자체를 건너뜀
- 메일 발송은 `src/lib/send-mail.mjs`(Resend API)로 처리 — `RESEND_API_KEY` 미등록 시 요약 파일 저장까지는 정상 진행하고 발송만 스킵
- 워크플로: `.github/workflows/daily-summary.yml`(매일 07:40 KST, 7축 crawl/distill 이후), `.github/workflows/weekly-summary.yml`(매주 월요일 07:50 KST)

## 축별 핵심 지표 (실수치, LLM 미경유)
- `src/indicators/crawl-indicators.mjs`: FRED(연준 경제데이터)/EIA(에너지정보청) 공개 API에서 축별 핵심 수치 1~2개를 가져와 `data/indicators/{YYYYMMDD}.json`(+`latest.json`)에 저장. 뉴스 distillation과 별개 파이프라인 — LLM 호출 없이 순수 수치만 다룸.
- 대시보드(`index.html`) 상단에 지표 스트립으로 표시(`public/app.js`의 `renderIndicatorRow`), 각 타일 클릭 시 원 소스 페이지로 이동
- 지표 목록: `src/indicators/crawl-indicators.mjs` 상단 `INDICATORS` 배열 참고 (fed_policy=연방기금 실효금리, rates_fx=원달러 환율+채권 데이터층, commodities_energy=WTI+헨리허브 천연가스, us_investment=S&P500, productivity_ai=노동생산성지수, polarization=지니계수, geopolitics=EPU지수)
- **`SIPOVGINIUSA`(지니계수)는 series id 확인 신뢰도가 낮음** — 첫 실행 로그에서 에러가 나면 FRED에서 정확한 id로 교체 필요
- 워크플로: `.github/workflows/daily-indicators.yml`(매일 07:25 KST)

### 채권 데이터층·날짜 정합 (2026-10-05 T1/T2)
- **레코드 메타**: `value_date`(값의 기준일) · `fetched_at`(수집 시각) · `lag_days`(value_date~수집일 KST 달력일) · `frequency`(D/W/M/Q/A). `date`는 하위호환용으로 `value_date`와 같다. 두 값이 섞이는 계산(스프레드·잔존율)은 같은 날짜 값끼리만 하고, 최신값 날짜가 어긋나면 최근 공통 날짜로 계산해 `basis_date`를 남긴다 (`src/indicators/derive.mjs`)
- **채권(`group: "bond"`)**: 신규는 `axis: "rates_fx"` — 미 2년(`us2y`)·10년 TIPS(`us10y_tips_real`)·IG/HY OAS(`us_ig_oas`/`us_hy_oas`)·미 목표금리 상단(`fed_target_upper`) [FRED], 한국 기준금리(`kr_base_rate`)·국고 3/10년(`kr3y`/`kr10y`)·회사채 AA- 3년(`kr_corp_aa3y`) [ECOS]. 기존 market_signals의 `us10y`/`us30y`/`t10y2y`/`us30y_tips_real`/`us10y_breakeven`은 id·axis 유지 + group 태그. FRED 월간 한국 10년물(`IRLTLT01KRM156N`)과 rates_fx의 DGS10 중복은 제거
- **파생 스프레드**: 한미 10년차·한미 기준금리차·국고 10−3·회사채 AA−국고3·미 10−2 (`SPREADS` 배열). 재료가 없으면 스킵
- **미 국채 입찰**: TreasuryDirect 공개 API(키 불필요) — 최근 14일 결과·예정 입찰(Note/Bond만)을 스냅샷의 `treasury_auctions`에 저장
- **환율**: Yahoo Finance(`KRW=X`/`JPY=X`/`EURUSD=X`) 우선, 실패 시 FRED `DEX*` fallback (`src/lib/fx.mjs`). FRED H.10은 실측 ~10일 지연. 레코드의 `source`/`series_id`는 실제로 값을 가져온 소스. Yahoo 일봉 날짜는 거래소 현지 달력일(timestamp + gmtoffset)

### 필요한 API key 발급 (GitHub Secrets 등록)
| Secret | 발급처 | 비고 |
|---|---|---|
| `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html | 가입 즉시 무료 발급 |
| `EIA_API_KEY` | https://www.eia.gov/opendata/register.php | 가입 즉시 무료 발급 |
| `ECOS_API_KEY` | https://ecos.bok.or.kr/api/ | 한국은행 ECOS 인증키(무료). 미등록 시 한국 채권 지표 4종과 관련 스프레드만 스킵 |
| `RESEND_API_KEY` | https://resend.com | 무료 티어(월 3000건). 도메인 미인증 시 `onboarding@resend.dev` 발신 주소로 **계정 본인 이메일에만** 발송 가능(테스트 모드) |

Repo **Variables**(secrets 아님, Settings → Secrets and variables → Actions → Variables 탭)에 `SUMMARY_MAIL_TO`(수신 주소) **필수** — 코드 기본값 없음, 미등록 시 메일만 건너뛰고 Actions에 에러 표시. 여러 명에게 보내려면 콤마로 구분: `a@example.com, b@example.com`. 수신 주소는 Actions 로그에도 찍지 않는다(공개 repo).

지표 경보 임계값은 Secret `ECO_THRESHOLDS_JSON`(JSON 문자열, 구조는 `config/indicator-thresholds.example.json`)에서만 읽는다 — repo에 값을 두지 않는다.

**주의**: Resend 도메인 미인증(테스트 모드) 상태에서는 **Resend 가입 계정 본인 이메일로만** 발송이 허용됨 — 수신처를 추가해도 본인 이메일이 아닌 주소는 Resend가 거부하거나 도착하지 않을 수 있음. 여러 명에게 실제로 보내려면 Resend 대시보드 → Domains에서 도메인을 인증해야 함.

EIA API는 api_key 없이는 라우트 유효성 자체를 검증할 수 없는 구조라(모든 경로가 동일하게 `API_KEY_MISSING` 403을 반환), `src/indicators/crawl-indicators.mjs`의 EIA 지표 2개는 **키 등록 후 첫 실행 로그로 series id가 맞는지 확인 필요**. 틀렸다면 에러 메시지에 원문 응답이 그대로 찍히므로 그걸 보고 라우트/series id를 교체하면 됨.

## market_signals 축 (주가/환율/채권 + Fundamental 괴리 추적)
- 다른 7축과 달리 뉴스 크롤링이 아니라 `crawl-indicators.mjs`의 순수 수치가 트리거
- **수집**: `src/indicators/crawl-indicators.mjs`의 `INDICATORS` 배열에 통합 — 주가는 `src/lib/yahoo.mjs`(Yahoo Finance 비공식 chart API, 키 불필요), 환율·채권은 기존 `fred.mjs` 재사용
  - 메모리: SK하이닉스/삼성전자/Micron/Kioxia/CXMT(688825.SS)
  - SoC: Broadcom/Marvell/MediaTek/Qualcomm
  - AI 서비스: Alphabet/Microsoft/Amazon/Meta (Anthropic/OpenAI는 비상장이라 watchlist만, 자동 수집 대상 아님)
  - 환율: USD/EUR·USD/JPY·USD/KRW, 채권: 미국·한국 10년물
- **Fundamental 괴리 탐지**: `src/distillation/distill-market-signals.mjs`가 매일 `data/indicators/` 값을 전일·전주와 비교, **10%↑ 변동**을 자동 flag → Claude API(`web_search` 툴)로 원인 초안 작성 → `EcoDistillationNote`(axis: `market_signals`)로 저장. `cheon_view`는 2026-10-05부로 동결(신규 노트에 기록하지 않음)
- 워크플로: `.github/workflows/daily-market-signals.yml`(매일 07:35 KST, `daily-indicators` 완료 후)

## 인과사슬지도 5대 지표 + 자동 알림 (2026-08-22 추가)
딥리서치로 확정한 매크로 인과사슬지도(Causal-Chain Map)의 주간 관찰 지표 5종을 `market_signals` 축에 편입.
**이 단계는 수집·저장·화면 노출까지만** — 자동매매/자동판단 로직은 없음(운영원칙: 행동은 사람이 리뷰 세션에서 직접 결정).

- **5대 핵심 지표**: 잔존율(`retention_rate`, KOSPI×USD/KRW÷6/22 피크 — 계산값, API 없음) · USD/KRW(`usdkrw`, Yahoo `KRW=X` / fallback FRED `DEXKOUS`) · 코스피(`kospi`, Yahoo Finance `^KS11`, 신규) · 미 30년물(`us30y`, FRED `DGS30`, 신규) · USD/JPY(`usdjpy`, Yahoo `JPY=X` / fallback FRED `DEXJPUS`, 엔캐리 청산 대용 지표)
- **2차 참고 지표**(저장만, 트리아지 가중치 미부여): 미 10년물(`us10y`), 2s10s 스프레드(`t10y2y`), 30년 TIPS 실질금리(`us30y_tips_real`), 10년 breakeven(`us10y_breakeven`)
- `src/indicators/crawl-indicators.mjs`가 매 실행마다 계산: 잔존율 산출(`computeRetentionRate`) → 전주 대비 `week_change_pct`(`src/indicators/history.mjs`, 과거 `data/indicators/{YYYYMMDD}.json` 스냅샷 기반)
- **경보(임계값 판정)는 공개 산출물에 남기지 않는다** (2026-10-05 T0) — 임계값은 Secret `ECO_THRESHOLDS_JSON`에만 있고, daily/weekly-summary가 메일 본문을 만들 때만 `computeAlerts`(`src/indicators/alerts.mjs`)로 판정한다. `data/*`·대시보드·Actions Step Summary에는 경보가 나타나지 않는다.
- `data/summary/daily_latest.json`/`weekly_latest.json`에도 `key_indicators`(5대 지표 스냅샷) 필드가 추가됨(`src/indicators/core-snapshot.mjs`)
- 기존 313건대 pending 노트 로직·`triage-weights.json`은 미변경 — 신규 지표는 별도 키(`indicator_id`)로 격리
- 회귀 방지: `scripts/build-index.mjs`/`src/triage/score-notes.mjs`가 각자 갖고 있던 로컬 `AXES` 배열을 `src/lib/notes.mjs`의 공유 배열 import로 통합(2026-08-01 축 누락 버그 재발 방지) — `test/axis-whitelist.test.mjs`가 정적으로 감시
- 단위테스트: `npm test`(Node 내장 테스트 러너, 별도 의존성 없음) — `test/axis-whitelist.test.mjs`, `test/indicator-alerts.test.mjs`

## 켜뮤 연결
- `vault_pointer` 필드로 켜뮤 vault 원본 경로만 참조 (텍스트 복붙 금지, 입력 고정 원칙 유지)
- 판단층(`cheon_view`)은 2026-10-05부로 이 repo에서 동결 — 과거 노트에만 남아 있음, 제거 여부는 추후 결정

## Cloudflare 배포 (Workers 정적 자산 — Pages 아님)
Cloudflare 대시보드에서 "Connect to Git"으로 이 repo를 연결하면 Pages가 아니라 **Workers** 정적 자산 배포로 자동 구성됨(`cloudflare-workers-and-pages[bot]`이 `wrangler.jsonc`를 자동 생성). 실제 배포 주소는 `*.pages.dev`가 아니라 `<project-name>.<account>.workers.dev` 형태.

핵심 설정 (`wrangler.jsonc`):
- `assets.directory: "."` — repo root 전체를 자산으로 취급(`public/`+`data/` 둘 다 서빙되도록)
- `.assetsignore`(repo root, `.gitignore`와 동일 문법)에 `node_modules`/`.git`/`.wrangler` 제외 — **필수**. 2026-10-05부터 `config`/`src`/`scripts`/`.github` 등 사이트에 불필요한 경로도 제외(설정 파일이 사이트 URL로 노출되던 문제). 안 넣으면 `npm clean-install`이 만든 node_modules까지 자산 스캔에 포함되어 wrangler 자체 의존성(122MiB 바이너리)이 Workers 자산 파일당 25MiB 제한을 넘어 배포 실패함
- root의 `index.html`이 진입점 (`public/index.html`이 아님 — 위 "프론트" 섹션 참고)

배포 후 확인:
1. `https://<실제주소>.workers.dev/` 접속 → 대시보드 렌더링 확인
2. `https://<실제주소>.workers.dev/data/index.json` 직접 접속 → JSON 나오는지 확인
3. 이후 GitHub Actions가 `data/`에 매일 커밋 → main push 시 Cloudflare가 자동 재배포 (Deployments 탭에서 커밋 해시로 확인 가능)

## 다음 단계
- [x] GitHub repo 생성 + push (`github.com/parablu2-dot/eco-intelligence`)
- [x] `ANTHROPIC_API_KEY` GitHub Secret 등록 + 7축 전체 `workflow_dispatch` 실전 검증
- [x] `public/` 정적 대시보드 프론트 구현
- [x] Cloudflare Workers 배포 완료 (`https://eco-intelligence.parablue.workers.dev`)
- [x] Summary 페이지(Daily/Weekly) + 메일 발송 + 축별 실수치 지표 구현
- [ ] `FRED_API_KEY`/`EIA_API_KEY`/`RESEND_API_KEY` GitHub Secret 등록 + 3개 신규 워크플로 `workflow_dispatch` 실전 검증 (사용자가 키 발급 후 직접 진행)
- [x] 인과사슬지도 5대 지표(잔존율·USD/KRW·KOSPI·미30년물·USD/JPY) + 자동 알림 파이프라인 구현 (2026-08-22)
