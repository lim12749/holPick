/** 한국마사회 공공데이터 API 호출 결과의 상태 분류. */
export type KraStatus =
  /** 정상 응답. */
  | "ok"
  /** .env.local 에 엔드포인트가 아직 설정되지 않음. 오류가 아니라 미구성 상태. */
  | "unset"
  /** 인증키 문제 (미등록/누락/거부). */
  | "auth_error"
  /** 경로가 존재하지 않음. 오퍼레이션명이 틀린 경우. */
  | "not_found"
  /** 일일 호출 한도 초과. */
  | "quota"
  /** 조건에 맞는 데이터가 없음. */
  | "no_data"
  /**
   * 전체 건수는 있는데 이 페이지에만 행이 없음 (마지막 페이지 초과).
   * no_data 와 구분해야 표와 페이지 이동을 유지할 수 있다.
   */
  | "empty_page"
  /** 네트워크 오류 또는 타임아웃. */
  | "network"
  /** 응답을 해석하지 못함. */
  | "parse_error"
  /** 그 외 API 가 반환한 오류. */
  | "api_error";

export type KraRow = Record<string, unknown>;

export interface KraResult {
  status: KraStatus;
  /** 사용자에게 그대로 보여줄 한글 메시지. */
  message: string;
  /** 원인별 해결 방법 안내. 실패 상태에서만 채워진다. */
  hint?: string;
  /** API 가 돌려준 원본 코드 (resultCode 또는 returnAuthMsg). */
  code?: string;
  httpCode: number | null;
  elapsedMs: number;
  totalCount: number | null;
  pageNo: number | null;
  numOfRows: number | null;
  rows: KraRow[];
  /** 인증키가 가려진 요청 URL. 화면에 노출해도 안전하다. */
  maskedUrl: string;
  /** 실제로 호출한 경로와 그 출처. 진단 화면에서 env 오버라이드 여부를 보여준다. */
  path?: string;
  pathSource?: "env" | "default";
}

export type ColumnAlign = "left" | "right";

export interface ColumnHint {
  /** 응답 필드명. */
  key: string;
  align?: ColumnAlign;
}
