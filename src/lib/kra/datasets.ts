/**
 * 한국마사회 데이터셋 레지스트리.
 *
 * 모든 화면(진단, 범용 탐색, 경주마 전용)이 이 파일 하나를 근거로 동작한다.
 * 데이터셋을 추가하거나 엔드포인트가 바뀌면 여기와 .env.local 만 고치면 된다.
 */

/** 경마장 코드 → 이름. 데이터셋마다 2번·3번이 뒤바뀌므로 데이터셋별로 들고 있는다. */
export type MeetCodes = Record<string, string>;

/** 대다수 API 의 경마장 코드. */
export const MEET_STANDARD: MeetCodes = {
  "1": "서울",
  "2": "부산경남",
  "3": "제주",
};

/** AI학습용 경주계획 등 일부 데이터셋은 2번과 3번이 반대다. */
export const MEET_SWAPPED: MeetCodes = {
  "1": "서울",
  "2": "제주",
  "3": "부산경남",
};

export interface KraDataset {
  id: string;
  /** 화면에 표시할 한글명. */
  label: string;
  /** 한 줄 설명. */
  description: string;
  /** 이 데이터셋의 엔드포인트가 담긴 환경변수 이름. */
  envKey: string;
  /** base URL 환경변수 이름. AI 학습용만 별도 base 를 쓴다. */
  baseEnvKey: "KRA_API_BASE_URL" | "KRA_AI_BASE_URL";
  /** 공공데이터포털 상세 페이지. 진단 실패 시 안내 링크로 쓴다. */
  portalUrl: string;
  /** 마필 단위(race) / 경주 단위(ai). */
  group: "race" | "ai";
  meetCodes: MeetCodes;
  /** meet 외에 항상 붙여야 하는 파라미터. */
  extraParams?: Record<string, string>;
  /** 표에서 앞쪽에 오도록 우선 배치할 필드 순서. 응답에 없으면 무시된다. */
  preferredColumns?: string[];
}

export const DATASETS: KraDataset[] = [
  {
    id: "horse-detail",
    label: "경주마 상세정보",
    description: "마명·등급·산지·조교사·마주·부모마, 통산 및 최근 1년 성적, 레이팅",
    envKey: "KRA_EP_HORSE_DETAIL",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15058115/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    // 실제 응답으로 확인한 필드 순서 (2026-08 기준, 서울 1,785두).
    preferredColumns: [
      "hrName",
      "rank",
      "sex",
      "name",
      "birthday",
      "trName",
      "owName",
      "rcCntT",
      "ord1CntT",
      "ord2CntT",
      "ord3CntT",
      "rating",
      "chaksunT",
    ],
  },
  {
    id: "entry-list",
    label: "출전표 상세정보",
    description: "경주일자·경주번호별 출전마, 부담중량, 레이팅, 기수, 조교사",
    envKey: "KRA_EP_ENTRY_LIST",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15058677/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    preferredColumns: ["rcDate", "rcNo", "chulNo", "hrName", "wgBudam", "rating", "jkName", "trName"],
  },
  {
    id: "race-result",
    label: "경주기록 정보",
    description: "시행이 끝난 경주의 기록",
    envKey: "KRA_EP_RACE_RESULT",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15058305/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    preferredColumns: ["rcDate", "rcNo", "hrName", "ord", "rcTime2", "jkName", "winOdds"],
  },
  {
    id: "horse-record",
    label: "경주마 성적 정보",
    description: "데뷔일, 최근 출전일, 통산 전적, 최근 1년 통계",
    envKey: "KRA_EP_HORSE_RECORD",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15058779/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    preferredColumns: ["hrName", "rank", "rcCntT", "ord1CntT", "winRateT", "rcCntY", "ord1CntY"],
  },
  {
    id: "horse-rating",
    label: "경주마 레이팅 정보",
    description: "경주마 레이팅 1~4",
    envKey: "KRA_EP_HORSE_RATING",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15057323/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    preferredColumns: ["hrNo", "hrName", "rating"],
  },
  {
    id: "jockey-record",
    label: "기수 성적 정보",
    description: "현역 기수의 누적 경주성적",
    envKey: "KRA_EP_JOCKEY_RECORD",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15056591/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    preferredColumns: ["jkName", "rcCntT", "ord1CntT", "winRateT", "rcCntY", "ord1CntY", "winRateY"],
  },
  {
    id: "sectional-record",
    label: "마필 구간별 경주기록",
    description: "구간별 통과 기록 — 각질·페이스 분석의 핵심 데이터",
    envKey: "KRA_EP_SECTIONAL_RECORD",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15057859/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    preferredColumns: ["rcDate", "rcNo", "hrName", "rcDist", "g1fAccTime", "g3fAccTime"],
  },
  {
    id: "entry-cancel",
    label: "경주마 출전취소 정보",
    description: "출전취소 마필과 변경사유 — 출전표 보정에 사용",
    envKey: "KRA_EP_ENTRY_CANCEL",
    baseEnvKey: "KRA_API_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15056779/openapi.do",
    group: "race",
    meetCodes: MEET_STANDARD,
    preferredColumns: ["rcDate", "rcNo", "hrName", "chulNo", "chgRsn"],
  },
  {
    id: "ai-race-plan",
    label: "AI학습용 경주계획",
    description: "경주 단위 조건 — 거리·두수·등급·출전조건·상금·날씨·주로상태·발주시각",
    envKey: "KRA_EP_AI_RACE_PLAN",
    baseEnvKey: "KRA_AI_BASE_URL",
    portalUrl: "https://www.data.go.kr/data/15143802/openapi.do",
    group: "ai",
    // 이 데이터셋만 2=제주, 3=부산경남 이다.
    meetCodes: MEET_SWAPPED,
    preferredColumns: ["rcDate", "rcNo", "rcDist", "rcName", "weather", "track", "rcTime"],
  },
];

export function getDataset(id: string): KraDataset | undefined {
  return DATASETS.find((d) => d.id === id);
}

/** 이 프로젝트의 기본 대상 경마장. 모든 데이터셋에서 1 = 서울로 동일하다. */
export const DEFAULT_MEET = "1";
