#!/usr/bin/env node
/**
 * 동결된 후보 전략의 **전향 검정 기록장**.
 *
 * 왜 필요한가: `국6등급 · 저확신 복승` 은 1,152개 설정을 훑어 찾은 것이라, 개별
 * 강건성 검사(부트CI [1.02, 2.11] · 최고배당 5건 제외해도 1.21 · 12개월 중 9개월 흑자)를
 * 전부 통과하고도 **선택 절차를 포함한 순열 귀무에서 p=0.13** 이었다. 96개를 훑어
 * 최고를 고르면 노이즈만으로도 검증 ROI 3.5 가 20번에 1번 나온다.
 *
 * 그 애매함을 푸는 방법은 하나뿐이다 — **발견에 쓰지 않은 데이터로 확인하는 것.**
 * 이 스크립트는 `watchlist.config.json` 의 동결 설정을 그대로 적용해 앞으로의 경주만
 * 기록하고 정산한다. 임계값도 승식도 다시 고르지 않는다. 다시 고르는 순간 선택 효과가
 * 되살아나 검정이 무의미해진다.
 *
 * `forwardTestFrom` 이전 경주는 발견 구간이므로 절대 집계하지 않는다.
 *
 * 사용법:
 *   node scripts/watchlist.mjs pick 20260815     # 그날 해당 경주와 픽
 *   node scripts/watchlist.mjs settle            # 배당이 들어온 픽 정산
 *   node scripts/watchlist.mjs report            # 전향 검정 누적 성적
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadLib } from "./compile-lib.mjs";

const ROOT = process.cwd();
const CACHE = join(ROOT, ".cache", "kra");
const CONFIG = join(ROOT, "watchlist.config.json");
/**
 * 기록장은 **저장소 루트에 둔다.** `.cache/` 는 gitignore 대상이라 캐시를 한 번 비우면
 * 전향 검정 기록이 통째로 날아간다. 이 파일은 몇 달에 걸쳐 쌓이는 유일한 증거이고,
 * 커밋 이력에 남아야 나중에 "언제 무엇을 걸었다고 기록했는지" 를 되짚을 수 있다.
 */
const LEDGER = join(ROOT, "watchlist-ledger.json");

const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();
const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
const S = cfg.strategy;

function loadLedger() {
  return existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { picks: [] };
}
function saveLedger(l) {
  writeFileSync(LEDGER, JSON.stringify(l, null, 1));
}

function loadRows() {
  const rows = [];
  for (const f of readdirSync(CACHE).filter((x) => x.startsWith("race-result-")).sort()) {
    rows.push(...(JSON.parse(readFileSync(join(CACHE, f), "utf8")).rows ?? []));
  }
  return rows;
}

function normalize(a, n) {
  const o = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const v = a[i];
    if (v == null || !(v > 0)) return null;
    o[i] = v;
    s += v;
  }
  if (s <= 0) return null;
  for (let i = 0; i < n; i += 1) o[i] /= s;
  return o;
}

/** 최상위 복승 조합과 그 확률. */
function bestPair(p, n) {
  let best = null;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = Math.min(Math.max(p[i], 1e-9), 0.999);
      const b = Math.min(Math.max(p[j], 1e-9), 0.999);
      const q = (a * b) / (1 - a) + (b * a) / (1 - b);
      if (!best || q > best.q) best = { i, j, q };
    }
  }
  return best;
}

/** 한 경주가 게이트를 통과하는지 + 통과하면 픽. 모델 실행이 필요하다. */
async function picksForDates(dates) {
  const lib = await loadLib(
    ["predict", "pick", "stats", "style", "sectional", "quinella", "horse"],
    { prefix: "holpick-watch-" },
  );
  const { predictRace } = lib.predict;
  const { candidateFromRow } = lib.pick;
  const { buildStatsBundle, groupRows } = lib.stats;
  const { buildStyleHistory } = lib.style;
  const { buildSectionalHistory } = lib.sectional;

  const all = loadRows();
  const finished = all.filter((r) => num(r.ord) > 0 && num(r.ord) <= 90);
  const styleHistory = buildStyleHistory(finished);
  const sectionalHistory = buildSectionalHistory(finished);
  const traits = { style: styleHistory.finalStyle, sectional: sectionalHistory.final };

  const out = [];
  for (const date of dates) {
    // 통계는 **그 날 이전** 완주 기록으로만 만든다.
    const prior = finished.filter((r) => str(r.rcDate) < date);
    if (prior.length === 0) continue;
    const stats = buildStatsBundle(prior, styleHistory, sectionalHistory);
    const dayRows = all.filter((r) => str(r.rcDate) === date);

    for (const [, race] of groupRows(dayRows)) {
      const runners = [...race].sort((a, b) => num(a.chulNo) - num(b.chulNo));
      if (runners.length < 5) continue;
      if (str(runners[0].rank) !== S.gates.rank) continue;

      const cands = runners.map((r) => candidateFromRow(r, traits));
      const preds = predictRace(cands, stats, num(runners[0].rcDist));
      const winBy = new Map(preds.map((x) => [x.chulNo, x.win]));
      const chulNo = runners.map((r) => num(r.chulNo));
      const p = normalize(chulNo.map((c) => winBy.get(c) ?? 0), runners.length);
      if (!p) continue;

      const b = bestPair(p, runners.length);
      if (!(b.q < S.gates.leadPairProbBelow)) continue; // 게이트: 저확신만

      const a = chulNo[b.i];
      const bb = chulNo[b.j];
      const nameOf = (c) => preds.find((x) => x.chulNo === c)?.hrName ?? "?";
      out.push({
        date,
        rcNo: num(runners[0].rcNo),
        rank: str(runners[0].rank),
        dist: num(runners[0].rcDist),
        runners: runners.length,
        pair: pairKey(a, bb),
        names: [nameOf(Math.min(a, bb)), nameOf(Math.max(a, bb))],
        leadProb: b.q,
        stake: S.stake,
      });
    }
  }
  return out;
}

/** 캐시된 배당에서 이 조합의 확정배당을 찾는다. 없으면 null (미정산). */
function payoutFor(lib, date, rcNo, pair) {
  const p = join(CACHE, `dividend-${date}-meet1.json`);
  if (!existsSync(p)) return null;
  const rows = JSON.parse(readFileSync(p, "utf8")).rows ?? [];
  const map = lib["dividend-parse"].toDividendsOf(rows, "복식");
  if (map.size === 0) return null;
  const hit = map.get(`${rcNo}:${pair}`);
  // 그 경주 배당이 아예 없으면 미정산, 있는데 우리 조합이 없으면 미적중(0).
  const any = [...map.values()].some((d) => d.rcNo === rcNo);
  if (!any) return null;
  return hit ? hit.odds : 0;
}

const f4 = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
const won = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString("ko-KR")}원`;

async function cmdPick() {
  const dates = process.argv.slice(3).filter((a) => /^\d{8}$/.test(a));
  if (dates.length === 0) {
    console.error("사용법: node scripts/watchlist.mjs pick YYYYMMDD [YYYYMMDD…]");
    process.exit(1);
  }
  const picks = await picksForDates(dates);
  const ledger = loadLedger();

  console.log(`전략: ${S.name} — ${S.betType} 경주당 ${S.picksPerRace}조합 · ${S.stake.toLocaleString("ko-KR")}원`);
  console.log(`게이트: 등급 ${S.gates.rank} AND 1순위 조합 확률 < ${S.gates.leadPairProbBelow}\n`);

  if (picks.length === 0) {
    console.log("해당 경주 없음.");
    return;
  }
  for (const p of picks) {
    const stale = p.date < cfg.forwardTestFrom;
    console.log(
      `  ${p.date} ${String(p.rcNo).padStart(2)}R  ${p.pair.padEnd(6)} ${p.names.join(" · ")}  ` +
        `(확률 ${(p.leadProb * 100).toFixed(1)}% · ${p.runners}두 · ${p.dist}m)` +
        (stale ? "  ← 발견 구간, 집계 제외" : ""),
    );
    const key = `${p.date}-${p.rcNo}`;
    if (!ledger.picks.some((x) => `${x.date}-${x.rcNo}` === key)) ledger.picks.push({ ...p, payout: null });
  }
  saveLedger(ledger);
  console.log(`\n총 ${picks.length}경주 · 비용 ${(picks.length * S.stake).toLocaleString("ko-KR")}원`);
  console.log(`기록장에 저장 → ${LEDGER}`);
}

async function cmdSettle() {
  const lib = await loadLib(["dividend-parse", "quinella", "horse"], { prefix: "holpick-watch-" });
  const ledger = loadLedger();
  let done = 0;
  for (const p of ledger.picks) {
    if (p.payout != null) continue;
    const odds = payoutFor(lib, p.date, p.rcNo, p.pair);
    if (odds == null) continue;
    p.payout = odds;
    done += 1;
    console.log(`  ${p.date} ${p.rcNo}R  ${p.pair}  → ${odds > 0 ? `적중 ${odds}배` : "미적중"}`);
  }
  saveLedger(ledger);
  console.log(`\n새로 정산 ${done}건 · 미정산 ${ledger.picks.filter((x) => x.payout == null).length}건`);
}

function cmdReport() {
  const ledger = loadLedger();
  const fwd = ledger.picks.filter((p) => p.date >= cfg.forwardTestFrom && p.payout != null);
  const pre = ledger.picks.filter((p) => p.date < cfg.forwardTestFrom);

  console.log(`전략: ${S.name}`);
  console.log(`동결 ${cfg.frozenAt} · 전향 검정 시작 ${cfg.forwardTestFrom}\n`);
  console.log(`발견 구간 참고: 학습 ROI ${cfg.discovery.trainRoi} → 검증 ROI ${cfg.discovery.testRoi}`);
  console.log(`  순열 귀무 p=${cfg.discovery.permutationP} (95%분위 ${cfg.discovery.permutationNullQ95}) → ${cfg.discovery.verdict}\n`);

  if (pre.length > 0) console.log(`(발견 구간 픽 ${pre.length}건은 집계에서 제외)`);
  if (fwd.length === 0) {
    console.log(`전향 검정 정산 0건. 아직 판단할 것이 없다.`);
    console.log(`\n판정에 필요한 표본: 복승 sd ≈ 2.8 기준`);
    console.log(`  1.20 을 환급률 0.674 와 구분(80% 검정력): 약 90베팅`);
    console.log(`  이 전략은 월 약 10경주 → **약 9개월**`);
    return;
  }

  const stake = fwd.length * S.stake;
  const ret = fwd.reduce((a, p) => a + p.payout * S.stake, 0);
  const hits = fwd.filter((p) => p.payout > 0).length;
  const roi = ret / stake;
  const sorted = [...fwd].sort((a, b) => b.payout - a.payout);
  const exBest =
    fwd.length > 1
      ? (ret - sorted[0].payout * S.stake) / ((fwd.length - 1) * S.stake)
      : NaN;

  console.log(`=== 전향 검정 누적 ===`);
  console.log(`  베팅 ${fwd.length}건 · 적중 ${hits}건 (${((hits / fwd.length) * 100).toFixed(1)}%)`);
  console.log(`  비용 ${stake.toLocaleString("ko-KR")}원 · 회수 ${Math.round(ret).toLocaleString("ko-KR")}원`);
  console.log(`  ROI ${f4(roi)} · 손익 ${won(ret - stake)}`);
  console.log(`  최고배당 1건 제외 ROI ${f4(exBest)}`);

  const by = new Map();
  for (const p of fwd) {
    const m = p.date.slice(0, 6);
    const e = by.get(m) ?? { n: 0, ret: 0 };
    e.n += 1;
    e.ret += p.payout;
    by.set(m, e);
  }
  console.log(`\n  월별:`);
  for (const [m, v] of [...by].sort()) {
    console.log(`    ${m}  ${String(v.n).padStart(3)}건  ROI ${f4(v.ret / v.n)}`);
  }

  const need = 90;
  console.log(
    `\n  진행도 ${fwd.length}/${need}베팅 (${Math.min(100, Math.round((fwd.length / need) * 100))}%) — ` +
      (fwd.length >= need ? "판정 가능" : "아직 판정하지 말 것"),
  );
}

const CMDS = { pick: cmdPick, settle: cmdSettle, report: cmdReport };
const cmd = process.argv[2];
if (!CMDS[cmd]) {
  console.error(`사용법: node scripts/watchlist.mjs <${Object.keys(CMDS).join("|")}>`);
  process.exit(1);
}
await CMDS[cmd]();
