/**
 * 한국마사회 API 응답 필드명 → 한글 라벨.
 *
 * KRA 응답은 `hrNo`, `wgBudam`, `ord` 처럼 축약형이라 그대로 표에 띄우면 읽을 수 없다.
 * 표 컴포넌트는 응답에서 실제로 내려온 필드를 기준으로 컬럼을 만들고,
 * 여기 등록된 필드만 한글로 치환한다. 등록되지 않은 필드는 원본 이름 그대로 나온다.
 * 따라서 이 사전이 불완전해도 데이터가 가려지지 않는다.
 */
export const FIELD_LABELS: Record<string, string> = {
  // 공통 / 경마장
  meet: "경마장",
  rcDate: "경주일자",
  rcNo: "경주번호",
  rcDay: "요일",
  rcTime: "발주시각",
  rcDist: "거리",
  rcName: "경주명",
  track: "주로상태",
  weather: "날씨",
  dusu: "두수",
  stTime: "발주시각",
  ageCond: "연령조건",
  sexCond: "성별조건",
  prizeCond: "상금조건",
  ilsu: "출전간격(일)",
  prd: "산지",
  chaksun1: "1착 상금",
  chaksun2: "2착 상금",
  chaksun3: "3착 상금",
  chaksun4: "4착 상금",
  chaksun5: "5착 상금",
  chaksun_6m: "최근6개월 상금",
  hrNameEn: "마명(영문)",
  jkNameEn: "기수명(영문)",
  trNameEn: "조교사명(영문)",
  owNameEn: "마주명(영문)",

  // 마필
  hrNo: "마번",
  hrName: "마명",
  hrLastAmt: "최근거래가",
  chulNo: "출전번호",
  age: "연령",
  sex: "성별",
  birthday: "생년월일",
  name: "산지",
  rank: "등급",
  rating: "레이팅",
  budam: "부담구분",
  wgBudam: "부담중량",
  wgHr: "마체중",
  faHrName: "부마명",
  faHrNo: "부마번호",
  moHrName: "모마명",
  moHrNo: "모마번호",

  // 사람
  jkNo: "기수번호",
  jkName: "기수명",
  trNo: "조교사번호",
  trName: "조교사명",
  owNo: "마주번호",
  owName: "마주명",

  // 성적 — 통산
  rcCntT: "통산 출주",
  ord1CntT: "통산 1착",
  ord2CntT: "통산 2착",
  ord3CntT: "통산 3착",
  winRateT: "통산 승률",
  qnlRateT: "통산 복승률",
  plcRateT: "통산 연승률",
  chaksunT: "통산 상금",

  // 성적 — 최근 1년
  rcCntY: "최근1년 출주",
  ord1CntY: "최근1년 1착",
  ord2CntY: "최근1년 2착",
  ord3CntY: "최근1년 3착",
  winRateY: "최근1년 승률",
  qnlRateY: "최근1년 복승률",
  plcRateY: "최근1년 연승률",
  chaksunY: "최근1년 상금",

  // 경주 결과
  ord: "착순",
  rcTime2: "주파기록",
  diffUnit: "착차",
  winOdds: "단승 배당",
  plcOdds: "연승 배당",
  chaksun: "착순상금",
  buG1fAccTime: "1F 통과",
  buG3fAccTime: "3F 통과",
  g1fAccTime: "1F 누적",
  g3fAccTime: "3F 누적",

  // 출전취소
  chgRsn: "변경사유",
  cancelRsn: "취소사유",

  // 페이징 / 메타
  totalCount: "전체 건수",
  pageNo: "페이지",
  numOfRows: "페이지당 건수",
};

/** 필드명을 한글 라벨로 바꾼다. 사전에 없으면 원본 이름을 그대로 돌려준다. */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** 숫자로 다뤄야 자연스러운 필드 — 표에서 우측 정렬한다. */
const NUMERIC_HINT = /(Cnt|Rate|Amt|Odds|chaksun|rating|wg|No$|dist|age|ord)/i;

export function isNumericField(key: string, value: unknown): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return NUMERIC_HINT.test(key);
  }
  return false;
}
