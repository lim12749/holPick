/**
 * `YYYYMM` 문자열 유틸.
 *
 * 한국 경마 기준이므로 "이번 달"은 KST 로 판단한다. 서버 타임존에 따라
 * 월말·월초에 한 달이 어긋나면 편성이 통째로 비어 보인다.
 */
const KST_YEAR_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
});

export function currentYearMonthKst(): string {
  // en-CA 는 YYYY-MM 형태로 준다.
  return KST_YEAR_MONTH.format(new Date()).replace("-", "");
}

/** `202608` 을 delta 개월만큼 옮긴다. 연도 넘김을 Date 에 맡겨 직접 계산하지 않는다. */
export function shiftMonth(yearMonth: string, delta: number): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(4, 6));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return yearMonth;

  // UTC 기준으로 만들어 로컬 타임존 영향을 받지 않게 한다.
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
