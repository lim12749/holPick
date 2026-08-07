import { buildStats, num, str, type Record0Stats } from "./horse";
import type { KraRow } from "./types";

/**
 * 출전표(API26_2/entrySheet_2) 응답 파서.
 *
 * 응답 1행 = "어떤 경주에 출전하는 말 한 마리". 경주 단위 정보(거리·등급·상금·발주시각)와
 * 마필 단위 정보(마명·부담중량·기수)가 같은 행에 섞여 내려오므로 둘을 분리한다.
 * 그래야 경주 헤더를 한 번만 그리고 출전마를 표로 나열할 수 있다.
 */

/** 출전마 한 마리. */
export interface Entry {
  chulNo: number;
  hrNo: string;
  hrName: string;
  sex: string;
  age: number;
  origin: string;
  rank: string;
  rating: number;
  /** 부담중량(kg). */
  wgBudam: number;
  budam: string;
  jkName: string;
  trName: string;
  owName: string;
  /** 직전 출전으로부터 경과일. 휴양 기간 판단에 쓴다. */
  restDays: number;
  career: Record0Stats;
  lastYear: Record0Stats;
}

/** 경주 한 건의 조건. */
export interface RaceCard {
  rcDate: string;
  rcDay: string;
  rcNo: number;
  rcName: string;
  rcDist: number;
  /** 편성 두수. 실제 출전마 수와 다를 수 있어(출전취소) 둘 다 보여준다. */
  dusu: number;
  rank: string;
  ageCond: string;
  sexCond: string;
  prizeCond: string;
  stTime: string;
  meet: string;
  /** 1~5착 상금. */
  prizes: number[];
}

export function parseEntry(row: KraRow): Entry {
  return {
    chulNo: num(row.chulNo),
    hrNo: str(row.hrNo),
    hrName: str(row.hrName),
    sex: str(row.sex),
    age: num(row.age),
    origin: str(row.prd),
    rank: str(row.rank),
    rating: num(row.rating),
    wgBudam: num(row.wgBudam),
    budam: str(row.budam),
    jkName: str(row.jkName),
    trName: str(row.trName),
    owName: str(row.owName),
    restDays: num(row.ilsu),
    career: buildStats(num(row.rcCntT), num(row.ord1CntT), num(row.ord2CntT), num(row.ord3CntT)),
    lastYear: buildStats(num(row.rcCntY), num(row.ord1CntY), num(row.ord2CntY), num(row.ord3CntY)),
  };
}

export function toRaceCard(row: KraRow): RaceCard {
  return {
    rcDate: str(row.rcDate),
    rcDay: str(row.rcDay),
    rcNo: num(row.rcNo),
    rcName: str(row.rcName),
    rcDist: num(row.rcDist),
    dusu: num(row.dusu),
    rank: str(row.rank),
    ageCond: str(row.ageCond),
    sexCond: str(row.sexCond),
    prizeCond: str(row.prizeCond),
    stTime: str(row.stTime),
    meet: str(row.meet),
    prizes: [row.chaksun1, row.chaksun2, row.chaksun3, row.chaksun4, row.chaksun5].map(num),
  };
}

export interface RaceGroup {
  card: RaceCard;
  entries: Entry[];
}

/** 같은 경주(경주일자 + 경주번호)끼리 묶고, 경주번호·출전번호 순으로 정렬한다. */
export function groupByRace(rows: KraRow[]): RaceGroup[] {
  const buckets = new Map<string, KraRow[]>();
  for (const row of rows) {
    const key = `${str(row.rcDate)}-${num(row.rcNo)}`;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.values()]
    .map((group) => ({
      card: toRaceCard(group[0]),
      entries: group.map(parseEntry).sort((a, b) => a.chulNo - b.chulNo),
    }))
    .sort((a, b) => a.card.rcNo - b.card.rcNo);
}

export interface DateGroup {
  rcDate: string;
  rcDay: string;
  raceCount: number;
  entryCount: number;
}

/** 경주일자별 요약. 월 단위 조회 결과를 날짜 카드로 보여줄 때 쓴다. */
export function groupByDate(rows: KraRow[]): DateGroup[] {
  const byDate = new Map<string, { day: string; races: Set<number>; entries: number }>();
  for (const row of rows) {
    const date = str(row.rcDate);
    if (!date) continue;
    const cur = byDate.get(date) ?? { day: str(row.rcDay), races: new Set<number>(), entries: 0 };
    cur.races.add(num(row.rcNo));
    cur.entries += 1;
    byDate.set(date, cur);
  }

  return [...byDate.entries()]
    .map(([rcDate, v]) => ({
      rcDate,
      rcDay: v.day,
      raceCount: v.races.size,
      entryCount: v.entries,
    }))
    .sort((a, b) => a.rcDate.localeCompare(b.rcDate));
}

/** `20260809` → `2026-08-09`. 형식이 다르면 원본을 돌려준다. */
export function formatRaceDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

/** `출발 :10:35` 처럼 접두어가 붙어 오므로 시각만 남긴다. */
export function formatStartTime(raw: string): string {
  const m = raw.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : raw;
}

/** 부담중량 편차를 보기 쉽게 — 경주 내 최저 대비 몇 kg 더 지는지. */
export function budamDelta(entries: Entry[], entry: Entry): number {
  const min = Math.min(...entries.map((e) => e.wgBudam));
  return Number((entry.wgBudam - min).toFixed(1));
}
