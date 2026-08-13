#!/usr/bin/env node
/**
 * 어떤 조건의 경주를 잘 맞히는가 — 구간별 적중률 분해.
 *
 * 전체 평균만 보면 "복승 1순위 19%" 같은 한 숫자로 끝난다. 그런데 경주는 다
 * 다르다. 8두 경주와 12두 경주, 1000m 와 2000m, 1인기 배당이 1.5 인 경주와
 * 6.0 인 경주는 난이도가 전혀 다르다. 잘 맞히는 구간이 따로 있다면 거기만
 * 골라 거는 것이 곧 전략이다.
 *
 * **다중검정 주의.** 구간을 수십 개 쪼개면 그중 몇 개는 순전히 우연으로
 * 평균보다 높게 나온다. 그래서 구간마다 표본 수와 표준오차를 같이 찍고,
 * 맨 아래에 "검정 횟수" 와 본페로니 임계 z 를 적는다. **z 가 그 임계를 넘지
 * 못하면 그 구간은 발견이 아니다.**
 *
 * 선행: node scripts/roi-search.mjs build
 * 사용법: node scripts/segments.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "kra");
const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();

/** 구간을 이보다 적은 표본으로 판단하지 않는다. */
const MIN_RACES = 40;

function loadMeta() {
  const meta = new Map();
  const ord = new Map();
  for (const f of readdirSync(CACHE).filter((f) => f.startsWith("race-result-"))) {
    const env = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
    for (const r of env.rows ?? []) {
      const k = `${str(r.rcDate)}-${num(r.rcNo)}`;
      if (!meta.has(k)) {
        meta.set(k, {
          rank: str(r.rank),
          track: str(r.track),
          weather: str(r.weather),
          rcDay: str(r.rcDay),
          budam: str(r.budam),
          rcNo: num(r.rcNo),
          rcDist: num(r.rcDist),
        });
      }
      const o = num(r.ord);
      if (o >= 1 && o <= 3) {
        if (!ord.has(k)) ord.set(k, []);
        ord.get(k).push({ ord: o, chulNo: num(r.chulNo) });
      }
    }
  }
  return { meta, ord };
}

function norm(a, n) {
  const o = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const v = a[i];
    if (v == null || !(v > 0)) return null;
    o[i] = v;
    s += v;
  }
  return s > 0 ? o.map((v) => v / s) : null;
}

function topPair(p, n) {
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

/** 주로는 `양호 (7%)` 형태다. 함수율은 잘게 쪼개면 표본이 흩어져 앞말만 쓴다. */
const trackBand = (t) => (t.split(" ")[0] || "미상");
const distBand = (d) => (d <= 1200 ? "≤1200m" : d <= 1400 ? "1300~1400m" : d <= 1700 ? "1500~1700m" : "1800m+");
const fieldBand = (n) => (n <= 8 ? "≤8두" : n <= 10 ? "9~10두" : n === 11 ? "11두" : "12두+");
const rcNoBand = (r) => (r <= 3 ? "1~3R" : r <= 7 ? "4~7R" : "8R+");
const favBand = (o) => (o <= 0 ? "미상" : o <= 2 ? "1인기 ≤2.0" : o <= 3.5 ? "1인기 2.0~3.5" : o <= 6 ? "1인기 3.5~6.0" : "1인기 6.0+");
const probBand = (q) => (q < 0.08 ? "확신 <8%" : q < 0.12 ? "확신 8~12%" : q < 0.18 ? "확신 12~18%" : q < 0.25 ? "확신 18~25%" : "확신 25%+");

function main() {
  const recs = JSON.parse(readFileSync(join(CACHE, "roi-records.json"), "utf8"));
  const { meta, ord } = loadMeta();

  const rows = [];
  for (const r of recs.races) {
    const k = `${r.date}-${r.rcNo}`;
    const m = meta.get(k);
    const fin = ord.get(k);
    if (!m || !fin) continue;
    const p = norm(r.modelWin, r.n);
    if (!p) continue;
    const tp = topPair(p, r.n);
    if (!tp) continue;

    const top2 = new Set(fin.filter((x) => x.ord <= 2).map((x) => x.chulNo));
    if (top2.size < 2) continue;
    const winner = fin.find((x) => x.ord === 1)?.chulNo;

    // 모델 1순위 말
    let bi = 0;
    for (let i = 1; i < r.n; i += 1) if (p[i] > p[bi]) bi = i;
    const bestHorse = r.chulNo[bi];

    // 1인기 배당 = 시장 최고 확률의 역수 근사
    let fo = 0;
    if (r.marketWin) {
      const mx = Math.max(...r.marketWin.filter((v) => v != null && v > 0), 0);
      if (mx > 0) fo = 0.8 / mx; // 오버라운드 보정 후 근사 배당
    }

    rows.push({
      pairHit: top2.has(r.chulNo[tp.i]) && top2.has(r.chulNo[tp.j]),
      winHit: bestHorse === winner,
      plcHit: top2.has(bestHorse),
      seg: {
        "출주두수": fieldBand(r.n),
        "거리": distBand(m.rcDist),
        "등급": m.rank || "미상",
        "주로": trackBand(m.track),
        "날씨": m.weather || "미상",
        "요일": m.rcDay || "미상",
        "경주번호": rcNoBand(m.rcNo),
        "부담방식": m.budam || "미상",
        "시장 확신도": favBand(fo),
        "모델 확신도": probBand(tp.q),
      },
    });
  }

  const overall = {
    n: rows.length,
    pair: rows.filter((r) => r.pairHit).length / rows.length,
    win: rows.filter((r) => r.winHit).length / rows.length,
    plc: rows.filter((r) => r.plcHit).length / rows.length,
  };

  console.log(`전체 ${overall.n}경주`);
  console.log(
    `기준선 — 복승 1순위 조합 ${(overall.pair * 100).toFixed(1)}% · 1순위 말 1착 ${(overall.win * 100).toFixed(1)}% · 2착이내 ${(overall.plc * 100).toFixed(1)}%\n`,
  );

  let tests = 0;
  const found = [];
  const dims = Object.keys(rows[0].seg);

  for (const dim of dims) {
    const groups = new Map();
    for (const r of rows) {
      const g = r.seg[dim];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const usable = [...groups.entries()].filter(([, v]) => v.length >= MIN_RACES);
    if (usable.length < 2) continue;

    console.log(`── ${dim} ${"─".repeat(Math.max(0, 46 - dim.length * 2))}`);
    console.log(`   ${"구간".padEnd(16)} ${"경주".padStart(6)} ${"복승1순위".padStart(9)} ${"1착".padStart(7)} ${"2착이내".padStart(8)} ${"z(복승)".padStart(8)}`);

    const sorted = usable.sort((a, b) => {
      const pa = a[1].filter((r) => r.pairHit).length / a[1].length;
      const pb = b[1].filter((r) => r.pairHit).length / b[1].length;
      return pb - pa;
    });

    for (const [g, v] of sorted) {
      tests += 1;
      const n = v.length;
      const pair = v.filter((r) => r.pairHit).length / n;
      const win = v.filter((r) => r.winHit).length / n;
      const plc = v.filter((r) => r.plcHit).length / n;
      // 이 구간 대 나머지 전체의 차이. 이항 표준오차.
      const rest = rows.filter((r) => r.seg[dim] !== g);
      const pr = rest.filter((r) => r.pairHit).length / rest.length;
      const se = Math.sqrt((pair * (1 - pair)) / n + (pr * (1 - pr)) / rest.length);
      const z = se > 0 ? (pair - pr) / se : 0;
      found.push({ dim, g, n, pair, win, plc, z });
      console.log(
        `   ${g.padEnd(16)} ${String(n).padStart(6)} ${(pair * 100).toFixed(1).padStart(8)}% ${(win * 100).toFixed(1).padStart(6)}% ${(plc * 100).toFixed(1).padStart(7)}% ${z.toFixed(2).padStart(8)}`,
      );
    }
    console.log("");
  }

  // 본페로니: 검정 수만큼 임계를 올린다.
  const zCrit = Math.abs(inverseNormal(0.05 / (2 * tests)));
  console.log(`${"=".repeat(64)}`);
  console.log(`검정한 구간 수 ${tests}개 → 본페로니 임계 |z| > ${zCrit.toFixed(2)} (α=0.05)`);
  const winners = found.filter((f) => f.z > zCrit);
  const naive = found.filter((f) => f.z > 1.96 && f.z <= zCrit);
  if (winners.length > 0) {
    console.log(`\n✅ 보정 후에도 유의하게 잘 맞히는 구간 ${winners.length}개:`);
    for (const w of winners.sort((a, b) => b.z - a.z))
      console.log(`   ${w.dim} = ${w.g}  ${w.n}경주  복승 ${(w.pair * 100).toFixed(1)}%  z=${w.z.toFixed(2)}`);
  } else {
    console.log(`\n❌ 보정 후 유의한 구간 없음.`);
  }
  if (naive.length > 0) {
    console.log(`\n⚠ 보정 없이 p<0.05 이지만 보정 후 탈락한 구간 ${naive.length}개 — 우연으로 설명된다:`);
    for (const w of naive.sort((a, b) => b.z - a.z).slice(0, 6))
      console.log(`   ${w.dim} = ${w.g}  ${w.n}경주  복승 ${(w.pair * 100).toFixed(1)}%  z=${w.z.toFixed(2)}`);
  }
}

/** 표준정규 분위수 (Acklam 근사). 본페로니 임계 z 를 구하는 데만 쓴다. */
function inverseNormal(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

main();
