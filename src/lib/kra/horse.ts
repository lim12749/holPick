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

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  const s = String(v ?? "").trim();
  return s;
}

function rate(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

function buildStats(starts: number, first: number, second: number, third: number): Record0Stats {
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

/** 경마에서 연령은 출생연도 기준으로 센다. */
function ageFromBirthday(raw: string): number | null {
  const year = Number(raw.slice(0, 4));
  if (!Number.isFinite(year) || year < 1900) return null;
  return new Date().getFullYear() - year;
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
    age: birthday ? ageFromBirthday(birthday) : null,
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
