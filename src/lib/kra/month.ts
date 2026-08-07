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

const KST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 오늘 날짜를 `YYYYMMDD` 로. 경마 기준이 KST 이므로 서버 타임존을 따르지 않는다. */
export function todayKst(): string {
  return KST_DATE.format(new Date()).replace(/-/g, "");
}

/** `YYYYMMDD` 두 개의 날짜 차이(일). 뒤 - 앞. */
export function dayDiff(from: string, to: string): number {
  const parse = (s: string) =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * 오늘 기준 상대 표기. 출전표는 임박한 경주만 공개되므로 대개 오늘~모레 사이다.
 * 날짜만 나열하면 어느 게 내일인지 매번 세어봐야 해서 라벨을 붙인다.
 */
export function relativeDayLabel(date: string, today: string): string | null {
  const d = dayDiff(today, date);
  if (d === 0) return "오늘";
  if (d === 1) return "내일";
  if (d === 2) return "모레";
  if (d > 2) return `D-${d}`;
  return null; // 지난 날짜는 라벨을 붙이지 않는다.
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
