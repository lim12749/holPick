import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { KraRow } from "./types";

/**
 * 디스크 기반 응답 캐시.
 *
 * Next 의 Data Cache 와 달리 **서버 재시작·재배포에도 살아남는다.** 3개월치 과거
 * 경주기록처럼 한 번 받으면 사실상 바뀌지 않는 데이터를 매번 다시 받지 않기 위해
 * 필요하다. 일일 호출 한도가 3,000이라 이 절약이 실질적이다.
 */

const CACHE_DIR = join(process.cwd(), ".cache", "kra");

export const TTL = {
  /** 확정된 과거 월. 사실상 불변이다. */
  pastMonth: 30 * 24 * 60 * 60 * 1000,
  /** 이번 달은 주말마다 경주가 늘어난다. */
  currentMonth: 6 * 60 * 60 * 1000,
  /** 다가올 경주는 출전취소가 반영돼야 한다. */
  upcoming: 10 * 60 * 1000,
  /** 연결 확인용. */
  probe: 5 * 60 * 1000,
} as const;

interface CacheEnvelope {
  fetchedAt: number;
  ttlMs: number;
  rows: KraRow[];
}

export interface CacheOutcome {
  rows: KraRow[] | null;
  /** 캐시에서 읽었는지. 화면에 표시해 절약 여부를 드러낸다. */
  hit: boolean;
  ageMs: number | null;
}

/** 파일명에 쓸 수 없는 문자를 제거한다. 키는 우리가 만들지만 방어적으로 처리한다. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, "_");
}

export async function readCache(key: string): Promise<CacheOutcome> {
  try {
    const raw = await readFile(join(CACHE_DIR, `${safeKey(key)}.json`), "utf8");
    const env = JSON.parse(raw) as CacheEnvelope;
    const ageMs = Date.now() - env.fetchedAt;
    if (ageMs > env.ttlMs) return { rows: null, hit: false, ageMs };
    return { rows: env.rows, hit: true, ageMs };
  } catch {
    // 파일이 없거나 깨졌으면 캐시 미스로 취급한다. 캐시는 실패해도 무해해야 한다.
    return { rows: null, hit: false, ageMs: null };
  }
}

export async function writeCache(key: string, rows: KraRow[], ttlMs: number): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const env: CacheEnvelope = { fetchedAt: Date.now(), ttlMs, rows };
    await writeFile(join(CACHE_DIR, `${safeKey(key)}.json`), JSON.stringify(env), "utf8");
  } catch {
    // 쓰기 실패는 조용히 넘긴다. 캐시를 못 써도 앱은 동작해야 한다.
  }
}

/** 이번 달이면 짧은 TTL, 지난 달이면 긴 TTL. */
export function monthTtl(yearMonth: string, currentYearMonth: string): number {
  return yearMonth >= currentYearMonth ? TTL.currentMonth : TTL.pastMonth;
}
