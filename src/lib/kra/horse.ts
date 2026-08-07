import type { KraRow } from "./types";

/**
 * 경주마 상세정보(API8_2/raceHorseInfo_2) 응답을 화면용 구조로 정리한다.
 *
 * API 는 착순 횟수만 주고 승률·복승률·연승률은 주지 않으므로 여기서 계산한다.
 * 출주 0회인 신마가 실제로 존재하므로(데뷔 전) 0 나누기를 반드시 막아야 한다.
 */
export interface Horse {
  hrNo: string;
  hrName: string;
  meet: string;
  rank: string;
  sex: string;
  origin: string;
  birthday: string | null;
  age: number | null;
  trName: string;
  trNo: string;
  owName: string;
  faHrName: string;
  moHrName: string;
  rating: number;
  lastPrice: string;
  career: Record0Stats;
  lastYear: Record0Stats;
  prizeTotal: number;
}

export interface Record0Stats {
  starts: number;
  first: number;
  second: number;
  third: number;
  /** 승률 — 출주 0회면 null. */
  winRate: number | null;
  /** 복승률 (1~2착). */
  quinellaRate: number | null;
  /** 연승률 (1~3착). */
  showRate: number | null;
}

/** 응답 값을 숫자로. 콤마가 섞여 오는 필드가 있어 제거한 뒤 변환한다. */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  const s = String(v ?? "").trim();
  return s;
}

/**
 * 비율을 계산한다. 출주 0회(데뷔 전)면 null.
 *
 * 응답이 불일치해 착순 합이 출주 수를 넘으면 "120.0%" 같은 값이 그대로 화면에
 * 나가므로 1로 자른다. 지표를 조용히 왜곡시키는 것보다 상한이 낫다.
 */
function rate(part: number, total: number): number | null {
  if (total <= 0) return null;
  // 착순 합이 출주 수를 넘거나 음수로 오는 불일치 응답이 "120.0%" / "-10.0%" 로
  // 그대로 나가지 않도록 0~1 로 가둔다.
  return Math.min(Math.max(part / total, 0), 1);
}

/**
 * 착순 횟수로 전적 통계를 만든다.
 * 출전표 파서(`entry.ts`)도 같은 계산을 쓰므로 여기서만 정의한다.
 */
export function buildStats(
  starts: number,
  first: number,
  second: number,
  third: number,
): Record0Stats {
  return {
    starts,
    first,
    second,
    third,
    winRate: rate(first, starts),
    quinellaRate: rate(first + second, starts),
    showRate: rate(first + second + third, starts),
  };
}

/** `20240324` → `2024-03-24`. 형식이 다르면 원본을 그대로 돌려준다. */
export function formatBirthday(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

/**
 * 경마에서 연령은 출생연도 기준으로 센다.
 *
 * 기준 연도를 인자로 받는다. 서버 타임존에 따라 연말·연초에 값이 1 어긋나는 것을
 * 막고, 테스트에서 고정할 수 있게 하기 위함이다.
 */
function ageFromBirthday(raw: string, currentYear: number): number | null {
  const year = Number(raw.slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return null;
  const age = currentYear - year;
  return age >= 0 ? age : null;
}

/**
 * 한국 경마 기준이므로 연도는 KST(UTC+9)로 판단한다.
 * 포매터 생성은 비싸므로 모듈 스코프에서 한 번만 만든다 (행마다 만들면 안 된다).
 */
const KST_YEAR_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
});

function currentYearKst(): number {
  return Number(KST_YEAR_FORMAT.format(new Date()));
}

export function parseHorse(row: KraRow): Horse {
  const birthday = str(row.birthday);
  return {
    hrNo: str(row.hrNo),
    hrName: str(row.hrName),
    meet: str(row.meet),
    rank: str(row.rank),
    sex: str(row.sex),
    origin: str(row.name),
    birthday: birthday || null,
    age: birthday ? ageFromBirthday(birthday, currentYearKst()) : null,
    trName: str(row.trName),
    trNo: str(row.trNo),
    owName: str(row.owName),
    faHrName: str(row.faHrName),
    moHrName: str(row.moHrName),
    rating: num(row.rating),
    lastPrice: str(row.hrLastAmt),
    prizeTotal: num(row.chaksunT),
    career: buildStats(num(row.rcCntT), num(row.ord1CntT), num(row.ord2CntT), num(row.ord3CntT)),
    lastYear: buildStats(num(row.rcCntY), num(row.ord1CntY), num(row.ord2CntY), num(row.ord3CntY)),
  };
}

export function formatRate(r: number | null): string {
  return r == null ? "—" : `${(r * 100).toFixed(1)}%`;
}

export function formatPrize(won: number): string {
  if (won === 0) return "—";
  if (won >= 100_000_000) return `${(won / 100_000_000).toFixed(1)}억원`;
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString("ko-KR")}만원`;
  return `${won.toLocaleString("ko-KR")}원`;
}
