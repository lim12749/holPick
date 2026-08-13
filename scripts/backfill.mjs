#!/usr/bin/env node
/**
 * 경주기록·확정배당을 디스크 캐시에 채워 넣는다. 1회성 네트워크 작업.
 *
 * 왜 필요한가: 화면은 `loadRecentResults()` 로 **최근 6개월**만 받고, 배당은
 * 지난 픽 화면이 열릴 때 그 구간만 딸려 받는다. 그래서 캐시에 배당이 있는 날이
 * 6~8월에 몰려 있었다 — 학습 구간에 정산 가능한 경주가 0건이라 ROI 탐색 자체가
 * 성립하지 않는다. 탐색을 하려면 과거로 넓게, 그리고 **모든 경주일**에 배당이
 * 있어야 한다.
 *
 * 화면 코드를 건드리지 않는 이유: `recentMonths(n, from)` 과 `cachedCall` 이 이미
 * 임의의 월·날짜를 받게 되어 있다. 여기서는 같은 함수를 다른 인자로 부를 뿐이고,
 * 캐시 파일 형식도 화면이 읽는 것과 완전히 같다.
 *
 * 사용법:
 *   node --env-file=.env.local scripts/backfill.mjs
 *   node --env-file=.env.local scripts/backfill.mjs --months 12
 *   node --env-file=.env.local scripts/backfill.mjs --results-only
 *   node --env-file=.env.local scripts/backfill.mjs --dividends-only
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadLib } from "./compile-lib.mjs";

const CACHE = join(process.cwd(), ".cache", "kra");

/**
 * 배당 백필은 화면보다 넉넉하게 기다린다.
 *
 * `DIVIDEND_TIMEOUT_MS = 15_000` 은 화면이 20콜을 **동시에** 던지는 상황에 맞춘
 * 값이다. 여기서는 하나씩 순차로 받으므로 느린 날짜를 기다려 주는 편이 이득이다 —
 * 실측상 20260606·20260706 은 30초를 넘겼다.
 */
const DIVIDEND_TIMEOUT_MS = 60_000;

/** 실패한 날짜 재시도 횟수. 제공 측이 간헐적으로 느려서 두 번째에 붙는 경우가 많다. */
const RETRIES = 2;

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 캐시에 있는 경주기록에서 경주일을 모은다. */
function cachedRaceDates() {
  if (!existsSync(CACHE)) return [];
  const dates = new Set();
  for (const f of readdirSync(CACHE).filter((f) => f.startsWith("race-result-"))) {
    const env = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
    for (const r of env.rows ?? []) {
      if (num(r.ord) > 0) dates.add(String(r.rcDate));
    }
  }
  return [...dates].sort();
}

function hasDividend(date) {
  return existsSync(join(CACHE, `dividend-${date}-meet1.json`));
}

async function backfillResults(lib, months) {
  const { cachedCall } = lib.client;
  const { monthTtl } = lib.cache;
  const { currentYearMonthKst, shiftMonth } = lib.month;

  // history.ts 의 recentMonths 와 같은 계산이다. 그쪽은 cachedCall 을 끌어오므로
  // 월 목록 하나 때문에 의존을 늘리지 않고 shiftMonth 로 직접 만든다.
  const current = currentYearMonthKst();
  const list = Array.from({ length: months }, (_, i) => shiftMonth(current, -i)).reverse();

  console.log(`\n=== 경주기록 ${months}개월 (${list[0]} ~ ${list[list.length - 1]}) ===`);
  let ok = 0;
  let empty = 0;
  for (const month of list) {
    const result = await cachedCall(
      "race-result",
      { numOfRows: 2000, extra: { rc_month: month }, timeoutMs: 60_000 },
      `race-result-${month}-meet1`,
      monthTtl(month, current),
    );
    const finished = result.rows.filter((r) => num(r.ord) > 0).length;
    const src = result.fromCache ? "캐시" : result.status;
    console.log(
      `  ${month}  ${String(finished).padStart(5)}행  ${src}` +
        (result.status !== "ok" && !result.fromCache ? `  ← ${result.message}` : ""),
    );
    if (finished > 0) ok += 1;
    else empty += 1;
  }
  if (empty > 0) {
    console.log(
      `\n  ⚠ ${empty}개월이 0행이다. 제공 측이 그 시점까지 거슬러 주지 않는 것일 수 있다.`,
    );
    console.log(`    확보된 구간만으로 진행하되, "1년치 검증"은 성립하지 않는다.`);
  }
  return { ok, empty };
}

async function backfillDividends(lib) {
  const { cachedCall } = lib.client;
  const { TTL } = lib.cache;

  const dates = cachedRaceDates();
  const missing = dates.filter((d) => !hasDividend(d));

  console.log(`\n=== 확정배당 ===`);
  console.log(`  경주일 ${dates.length}일 · 이미 보유 ${dates.length - missing.length}일 · 받을 것 ${missing.length}일`);
  if (missing.length === 0) return { got: 0, failed: [] };

  let got = 0;
  const failed = [];
  for (let i = 0; i < missing.length; i += 1) {
    const date = missing[i];
    let done = false;
    for (let attempt = 0; attempt <= RETRIES && !done; attempt += 1) {
      const t0 = Date.now();
      const result = await cachedCall(
        "betting-sales",
        { numOfRows: 200, extra: { rc_date: date }, timeoutMs: DIVIDEND_TIMEOUT_MS },
        `dividend-${date}-meet1`,
        TTL.pastMonth,
      );
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (result.status === "ok" && result.rows.length > 0) {
        console.log(
          `  [${String(i + 1).padStart(3)}/${missing.length}] ${date}  ${String(result.rows.length).padStart(3)}행  ${secs}초`,
        );
        got += 1;
        done = true;
      } else if (attempt === RETRIES) {
        console.log(
          `  [${String(i + 1).padStart(3)}/${missing.length}] ${date}  실패 (${result.status}) ${secs}초  ← ${result.message}`,
        );
        failed.push(date);
      } else {
        await sleep(1500);
      }
    }
    // 제공 측 부하를 줄인다. 일일 한도도 아끼는 편이 낫다.
    await sleep(300);
  }
  return { got, failed };
}

/** 배당 커버리지와 환급률을 다시 재서 백필 결과를 검증한다. */
function report(lib) {
  const { toDividendsOf, poolPayback } = lib["dividend-parse"];

  const rows = [];
  for (const f of readdirSync(CACHE).filter((f) => f.startsWith("race-result-")).sort()) {
    const env = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
    rows.push(...(env.rows ?? []).filter((r) => num(r.ord) > 0 && num(r.ord) <= 90));
  }

  const byRace = new Map();
  for (const r of rows) {
    const k = `${r.rcDate}-${num(r.rcNo)}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k).push(r);
  }

  const dates = [...new Set(rows.map((r) => String(r.rcDate)))].sort();
  const divByDate = new Map();
  for (const d of dates) {
    const p = join(CACHE, `dividend-${d}-meet1.json`);
    if (!existsSync(p)) continue;
    const env = JSON.parse(readFileSync(p, "utf8"));
    divByDate.set(d, toDividendsOf(env.rows ?? [], "복식"));
  }

  let settleable = 0;
  const payback = [];
  const payouts = [];
  for (const race of byRace.values()) {
    const date = String(race[0].rcDate);
    const rcNo = num(race[0].rcNo);
    const day = divByDate.get(date);
    if (!day) continue;
    const hits = [...day.values()].filter((d) => d.rcNo === rcNo);
    if (hits.length === 0) continue;
    settleable += 1;
    // 분모는 **실제 출주두수**의 조합 수. 출전표 기준으로 세면 환급률이 낮게 나온다.
    const n = race.length;
    payback.push({ combos: (n * (n - 1)) / 2, payouts: hits.map((h) => h.odds) });
    payouts.push(...hits.map((h) => h.odds));
  }

  payouts.sort((a, b) => a - b);
  const pb = poolPayback(payback);

  console.log(`\n=== 백필 후 상태 ===`);
  console.log(`  경주일        ${dates.length}일  (${dates[0]} ~ ${dates[dates.length - 1]})`);
  console.log(`  완주 경주     ${byRace.size}경주 · ${rows.length}행`);
  console.log(`  배당 보유일   ${divByDate.size}일`);
  console.log(
    `  정산 가능     ${settleable}경주  (${((settleable / byRace.size) * 100).toFixed(1)}%)`,
  );
  if (pb != null) {
    console.log(`  복승 환급률   ${pb.toFixed(4)}  → 공제율 ${((1 - pb) * 100).toFixed(1)}%`);
    // 밴드가 넓은 이유: 이 추정량은 드물게 나오는 거대 배당(최대 847)이 좌우해서
    // 974경주로도 95% 신뢰구간이 [0.61, 0.79] 다. 좁게 잡으면 표본 노이즈에 매번 걸린다.
    // 여기서 잡으려는 건 노이즈가 아니라 **분모 정의 오류**다 — 출전표 기준으로 세거나
    // 동착 배당을 하나만 세면 계통적으로 밴드 밖으로 나간다.
    if (pb < 0.55 || pb > 0.85) {
      console.log(`  ⚠ 환급률이 밴드(0.55~0.85) 밖이다. 분모 정의나 동착 처리를 확인할 것.`);
    }
  }
  if (payouts.length > 0) {
    const q = (f) => payouts[Math.min(payouts.length - 1, Math.floor(payouts.length * f))];
    console.log(
      `  배당 분포     최소 ${payouts[0]} · 중앙 ${q(0.5)} · 평균 ${(payouts.reduce((a, b) => a + b, 0) / payouts.length).toFixed(1)} · 최대 ${payouts[payouts.length - 1]}`,
    );
  }

  const GATE = 400;
  console.log(``);
  if (settleable >= GATE) {
    console.log(`  ✅ 정산 가능 ${settleable}경주 ≥ ${GATE} — ROI 탐색을 진행할 수 있다.`);
  } else {
    console.log(`  ❌ 정산 가능 ${settleable}경주 < ${GATE} — 표본이 부족해 탐색 결과를 믿을 수 없다.`);
  }
  return settleable;
}

async function main() {
  if (!process.env.KRA_API_KEY) {
    console.error("KRA_API_KEY 가 없다. `node --env-file=.env.local scripts/backfill.mjs` 로 실행할 것.");
    process.exit(1);
  }

  const lib = await loadLib(
    ["client", "cache", "month", "dividend-parse", "quinella", "horse"],
    { prefix: "holpick-backfill-" },
  );

  const months = arg("months", 12);
  if (!flag("dividends-only")) await backfillResults(lib, months);
  if (!flag("results-only")) {
    const { got, failed } = await backfillDividends(lib);
    if (failed.length > 0) {
      console.log(`\n  ⚠ ${failed.length}일 실패: ${failed.join(", ")}`);
      console.log(`    다시 실행하면 실패한 날짜만 재시도한다 (실패는 캐시하지 않는다).`);
    }
    console.log(`  새로 받은 배당 ${got}일`);
  }

  report(lib);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
