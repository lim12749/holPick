# holPick

서울 경마 경주의 출전마 정보를 분석해 **경주 결과 예측에 도움이 되는 정보를 제공하는 웹 서비스**입니다.

한국마사회가 공공데이터포털을 통해 공개하는 경주마·기수·조교사·경주기록·배당률 데이터를 수집·정규화하고, 이를 조합한 지표와 시각화를 통해 "이 경주에서 어떤 말이 유리한가"를 판단할 근거를 제시하는 것을 목표로 합니다.

> **현재 상태:** 초기 스캐폴딩 단계입니다. 아래 기능 목록은 구현 완료가 아닌 **구현 예정** 범위입니다.

---

## 목표 기능

| 영역 | 내용 |
|---|---|
| 출전표 | 경주일자·경주번호별 출전마 목록, 부담중량·마번·기수·조교사 |
| 경주마 프로필 | 통산/최근 1년 성적, 착순 분포, 레이팅, 산지·성별·연령 |
| 기수 · 조교사 | 승률·복승률·연대율, 특정 마필과의 조합 성적 |
| 주로 적합도 | 거리별·주로상태(건조/다습)별 성적 분해 |
| 배당률 | 승식별 배당률 추이, 인기순위와 실제 착순의 괴리 |
| 예측 지표 | 위 요소를 가중 합산한 자체 스코어 및 근거 제시 |

---

## 데이터 출처 — 공공데이터포털 (한국마사회)

**네, 경마 말 정보는 공공데이터로 공개되어 있습니다.** 한국마사회가 [공공데이터포털](https://www.data.go.kr)에 REST 오픈API(JSON/XML, 무료)로 제공하며, 서울·부산경남·제주 경마장을 모두 포함합니다.

### 이 프로젝트에서 사용할 주요 데이터셋

| 데이터셋 | 핵심 항목 |
|---|---|
| [경주마 상세정보](https://www.data.go.kr/data/15058115/openapi.do) | 마명, 마번, 출생지, 성별, 생년월일, 등급, 조교사, 마주, 부/모마, 통산 출주·1~3착 횟수, 최근 1년 성적, 통산 착순상금, 레이팅, 최근 거래가 |
| [출전표 상세정보](https://www.data.go.kr/data/15058677/openapi.do) | 경주일자, 경주요일, 경주번호, 마번, 마명, 산지, 성별, 연령, 부담중량, 레이팅, 기수명, 조교사명, 마주명, 상금 |
| [경주기록 정보](https://www.data.go.kr/data/15058305/openapi.do) | 시행된 경주의 기록 정보 |
| [경주마 성적 정보](https://www.data.go.kr/data/15058779/openapi.do) | 데뷔일, 최근 출전일, 통산 전적, 최근 1년 통계 |
| [경주마 레이팅 정보](https://www.data.go.kr/data/15057323/openapi.do) | 마번, 마명, 레이팅 1~4 |
| [기수 성적 정보](https://www.data.go.kr/data/15056591/openapi.do) | 현역 기수 누적 경주성적 |
| [마필 구간별 경주기록](https://www.data.go.kr/data/15057859/openapi.do) | 구간별 통과 기록 (페이스 분석용) |
| [승식별 최고배당률 정보](https://www.data.go.kr/data/15059267/openapi.do) | 승식별 최고배당률 |
| [경주별 상세성적표](https://www.data.go.kr/data/15089492/openapi.do) | 경주 단위 상세 성적 |
| [경주마 출전취소 정보](https://www.data.go.kr/data/15056779/openapi.do) | 출전취소 마필 (출전표 보정용) |
| [AI학습용 경주계획](https://www.data.go.kr/data/15143802/openapi.do) | AI 기반 분석용으로 제공되는 경주계획 데이터 |

전체 목록은 [공공데이터포털 한국마사회 제공 데이터](https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=&keyword=&org=%ED%95%9C%EA%B5%AD%EB%A7%88%EC%82%AC%ED%9A%8C&orgFilter=%ED%95%9C%EA%B5%AD%EB%A7%88%EC%82%AC%ED%9A%8C&orgFullName=%ED%95%9C%EA%B5%AD%EB%A7%88%EC%82%AC%ED%9A%8C&conditionType=search)에서 확인할 수 있습니다.

### API 호출 규격

- **Base URL:** `https://apis.data.go.kr/B551015/{오퍼레이션명}`
  - 예) 경주마 상세정보 → `https://apis.data.go.kr/B551015/API8_2/raceHorseInfo_2` ✅ 검증됨
  - 오퍼레이션명은 데이터셋마다 다르고 명명 규칙이 없습니다. **마이페이지 → 데이터활용 → Open API → 개발계정 → 해당 API → 상세기능**의 요청주소에서 확인하세요.
  - 인증키 없이 경로 존재 여부만 확인하려면 `scripts/probe-endpoints.mjs` 를 쓰면 됩니다.
- **공통 파라미터**
  - `serviceKey` — 발급받은 인증키 (필수)
  - `meet` — 경마장 구분: `1` 서울 / `2` 부산경남 / `3` 제주 *(이 프로젝트는 서울=`1` 중심)*
  - `_type` — `json` 또는 `xml`
  - `pageNo`, `numOfRows` — 페이징
  - 출전표 계열은 경주월·경주일 파라미터를 추가로 받으며, 생략 시 최근 1개월 데이터를 반환합니다.
- **활용신청:** 개발단계는 자동승인, 운영단계는 심의승인. 활용사례 등록 시 트래픽 상향 가능.

### 인증키 설정

1. [공공데이터포털](https://www.data.go.kr)에서 회원가입 후 위 데이터셋들의 **활용신청**을 진행합니다.
2. 마이페이지에서 발급된 **일반 인증키(Encoding/Decoding)** 를 확인합니다.
3. 프로젝트 루트에 `.env.local` 파일을 만들고 아래처럼 넣습니다.

```bash
# .env.local  (git에 커밋되지 않습니다)
KRA_API_KEY=발급받은_Decoding_인증키
KRA_API_BASE_URL=https://apis.data.go.kr/B551015
```

> 인증키는 **서버 사이드에서만** 사용하세요. `NEXT_PUBLIC_` 접두사를 붙이면 브라우저 번들에 노출됩니다. API 호출은 Route Handler(`src/app/api/**`)나 Server Component에서 처리하는 것을 전제로 합니다.

---

## 기술 스택

- **Next.js 16.3.0** (App Router, Turbopack)
- **React 19.2.8**
- **TypeScript 5**
- **Tailwind CSS v4**
- **ESLint 9**

---

## 시작하기

**요구사항:** Node.js 20.9 이상

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) 을 브라우저에서 엽니다.

### 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint 검사 |

### 화면

| 경로 | 내용 |
|---|---|
| `/` | 9개 데이터셋 연결 상태 요약 |
| `/diagnostics` | API 진단 — 상태·응답시간·전체건수·응답필드·마스킹된 요청 URL, 실패 시 원인별 해결 안내 |
| `/datasets/[id]` | 범용 데이터 탐색 — 엔드포인트가 설정된 모든 데이터셋을 자동 지원 |
| `/horses` | 경주마 목록 · 마명 검색 · 통산 성적 · 레이팅 |
| `/horses/[hrNo]` | 경주마 상세 — 프로필, 혈통, 통산 vs 최근 1년 성적 비교 |

### 진단 스크립트

```bash
# 엔드포인트 존재 여부 탐색 (인증키 불필요)
#   401 SERVICE_KEY_IS_NULL → 경로 존재 / 400 → 경로 없음
node scripts/probe-endpoints.mjs API8_2/raceHorseInfo_2 API26_2/entryList_2

# 설정된 데이터셋의 실제 응답 필드 확인
node --env-file=.env.local scripts/inspect-dataset.mjs KRA_EP_HORSE_DETAIL
```

---

## 프로젝트 구조

```
holPick/
├── src/
│   └── app/            # App Router — 페이지, 레이아웃, Route Handler
│       ├── layout.tsx
│       ├── page.tsx
│       └── globals.css
├── public/             # 정적 자산
├── next.config.ts      # Turbopack root 고정 설정 포함
├── eslint.config.mjs
└── tsconfig.json
```

`@/*` 임포트 별칭이 `src/*` 를 가리킵니다.

---

## 로드맵

- [ ] 공공데이터 API 클라이언트 및 응답 타입 정의
- [ ] 출전표 조회 화면 (경주일자 · 경주번호별)
- [ ] 경주마 상세 프로필 페이지
- [ ] 기수 · 조교사 성적 조회
- [ ] 과거 경주기록 적재 및 캐싱 계층
- [ ] 거리별 · 주로상태별 성적 분해 분석
- [ ] 예측 스코어 산출 로직 및 근거 표시
- [ ] 배당률 대비 기대값 비교 뷰

---

## 고지사항

- 이 서비스가 제공하는 분석과 예측은 **공개 데이터에 기반한 참고 정보**이며, 경주 결과를 보장하지 않습니다.
- 본 프로젝트는 마권 판매·중개나 이에 준하는 어떠한 행위와도 무관합니다. 승마투표는 한국마사회를 통해서만 가능합니다.
- 한국마사회가 자체 홈페이지를 통해 제공하는 배당률·경주화면·음성·컴퓨터프로그램 저작물 등은 [한국마사회법](https://www.law.go.kr/법령/한국마사회법)상 사전동의 없이 복제·개작·전송할 수 없습니다. 이 프로젝트는 **공공데이터포털을 통해 공식 배포되는 오픈API 데이터만** 사용합니다.
- 과도한 베팅은 중독으로 이어질 수 있습니다. 도박 문제 상담: 한국도박문제예방치유원 ☎ 1336

---

## 라이선스

미정
