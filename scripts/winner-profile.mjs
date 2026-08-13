#!/usr/bin/env node
/**
 * 1·2·3착 말은 실제로 어떻게 생겼나 — 3년치 착순별 프로파일.
 *
 * 지금까지의 분석은 전부 "이 요인이 **시장 배당 위에** 정보를 더하는가" 였다.
 * 그건 돈이 되는지를 묻는 질문이고, 답은 전부 "아니오" 였다.
 *
 * 이 스크립트는 다른 질문에 답한다 — **"이긴 말들의 공통점이 무엇인가."**
 * 돈이 되는지와 무관하게, 실제로 어떤 말이 이기는지의 그림이다.
 *
 * **경주 전에 알 수 있는 것과 없는 것을 반드시 구분해서 읽어야 한다.**
 * 마체중 증감·그 경주의 구간기록·각질은 경주가 끝나야(또는 당일에야) 아는 값이라
 * 예측에 쓸 수 없다. 표에 [사후] 로 표시한다. 이걸 섞으면 "1착마는 마지막 200m가
 * 빠르다" 같은 동어반복을 발견으로 착각하게 된다.
 *
 * 사용법: node scripts/winner-profile.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "kra");
const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();

function loadRaces() {
  const rows = [];
  for (const f of readdirSync(CACHE).filter((x) => x.startsWith("race-result-")).sort()) {
    for (const r of JSON.parse(readFileSync(join(CACHE, f), "utf8")).rows ?? []) {
      if (num(r.ord) > 0 && num(r.ord) <= 90) rows.push(r);
    }
  }
  const by = new Map();
  for (const r of rows) {
    const k = `${str(r.rcDate)}-${num(r.rcNo)}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  return [...by.values()].filter((race) => race.length >= 5);
}

/** `"481(+3)"` → { weight: 481, delta: 3 }. 미계측(`"0()"`)이면 null. */
function bodyWeight(raw) {
  const m = str(raw).match(/^(\d+)\(([+-]?\d+)\)$/);
  if (!m || Number(m[1]) <= 0) return null;
  return { weight: Number(m[1]), delta: Number(m[2]) };
}

function rankAsc(vals, i) {
  // 작을수록 1위. 값이 없으면 null.
  const v = vals[i];
  if (v == null) return null;
  return vals.filter((x) => x != null && x < v).length + 1;
}

function zScore(vals, i) {
  const ok = vals.filter((v) => v != null && Number.isFinite(v));
  if (ok.length < 4 || vals[i] == null) return null;
  const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
  const sd = Math.sqrt(ok.reduce((a, v) => a + (v - mean) ** 2, 0) / ok.length);
  return sd > 1e-9 ? (vals[i] - mean) / sd : null;
}

function build() {
  const races = loadRaces();
  const recs = [];

  for (const race of races) {
    const n = race.length;
    const odds = race.map((r) => (num(r.winOdds) > 0 ? num(r.winOdds) : null));
    const ratings = race.map((r) => (num(r.rating) > 0 ? num(r.rating) : null));
    const budams = race.map((r) => num(r.wgBudam));
    const ages = race.map((r) => num(r.age));
    const minBudam = Math.min(...budams.filter((v) => v > 0));
    const minAge = Math.min(...ages.filter((v) => v > 0));
    // 사후 지표 — 그 경주의 실측 구간기록
    const early = race.map((r) => (num(r.seS1fAccTime) > 0 ? num(r.seS1fAccTime) : null));
    const late = race.map((r) =>
      num(r.rcTime) > 0 && num(r.seG1fAccTime) > 0 ? num(r.rcTime) - num(r.seG1fAccTime) : null,
    );
    const s1Ord = race.map((r) => (num(r.sjS1fOrd) > 0 ? num(r.sjS1fOrd) : null));

    for (let i = 0; i < n; i += 1) {
      const r = race[i];
      const bw = bodyWeight(r.wgHr);
      recs.push({
        ord: num(r.ord),
        n,
        favRank: rankAsc(odds, i),
        odds: odds[i],
        ratingRank: rankAsc(ratings.map((v) => (v == null ? null : -v)), i), // 클수록 1위
        rating: ratings[i],
        budamDelta: budams[i] > 0 && Number.isFinite(minBudam) ? budams[i] - minBudam : null,
        ageDelta: ages[i] > 0 && Number.isFinite(minAge) ? ages[i] - minAge : null,
        gate: num(r.chulNo),
        gateFrac: n > 1 ? (num(r.chulNo) - 1) / (n - 1) : null,
        rest: num(r.ilsu) > 0 ? num(r.ilsu) : null,
        sex: str(r.sex),
        origin: str(r.name),
        rank: str(r.rank),
        bodyWeight: bw?.weight ?? null,
        bodyDelta: bw?.delta ?? null, // [사후] 당일 계측
        earlyZ: zScore(early, i), // [사후]
        lateZ: zScore(late, i), // [사후]
        s1Ord: s1Ord[i], // [사후] 초반 통과순위
      });
    }
  }
  return recs;
}

const GROUPS = [
  ["1착", (r) => r.ord === 1],
  ["2착", (r) => r.ord === 2],
  ["3착", (r) => r.ord === 3],
  ["4착 이하", (r) => r.ord >= 4],
];

const avg = (rows, key) => {
  const v = rows.map((r) => r[key]).filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};
const share = (rows, pred) => rows.filter(pred).length / rows.length;
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");

function main() {
  const recs = build();
  const groups = GROUPS.map(([label, fn]) => [label, recs.filter(fn)]);
  const total = recs.length;
  const base = recs.filter((r) => r.ord === 1).length / total; // 무작위 1착 확률

  console.log(`출주 ${total.toLocaleString("ko-KR")}행 · 경주 ${(total / avg(recs, "n")).toFixed(0)}개 · 평균 ${avg(recs, "n").toFixed(1)}두\n`);

  console.log("=== 착순별 평균 프로파일 ===");
  const cols = [
    ["인기순위", "favRank", ""],
    ["단승배당", "odds", ""],
    ["레이팅순위", "ratingRank", ""],
    ["레이팅", "rating", ""],
    ["부담중량(+kg)", "budamDelta", ""],
    ["나이(최연소+)", "ageDelta", ""],
    ["마번", "gate", ""],
    ["휴양일수", "rest", ""],
    ["마체중", "bodyWeight", ""],
    ["마체중 증감", "bodyDelta", "[사후]"],
    ["초반200m z", "earlyZ", "[사후]"],
    ["종반200m z", "lateZ", "[사후]"],
    ["초반 통과순위", "s1Ord", "[사후]"],
  ];
  console.log(`  ${"항목".padEnd(16)} ` + groups.map(([l]) => l.padStart(9)).join(" ") + "   비고");
  for (const [label, key, note] of cols) {
    const cells = groups.map(([, rows]) => f2(avg(rows, key)).padStart(9));
    console.log(`  ${label.padEnd(16)} ` + cells.join(" ") + `   ${note}`);
  }

  console.log("\n=== 1착마의 구성 (전체 출주마 대비) ===");
  const winners = groups[0][1];
  const rows = [
    ["1인기", (r) => r.favRank === 1],
    ["인기 1~3위", (r) => r.favRank != null && r.favRank <= 3],
    ["인기 4위 이하", (r) => r.favRank != null && r.favRank >= 4],
    ["단승배당 3.0 미만", (r) => r.odds != null && r.odds < 3],
    ["단승배당 10.0 이상", (r) => r.odds != null && r.odds >= 10],
    ["레이팅 1위", (r) => r.ratingRank === 1],
    ["레이팅 상위 3", (r) => r.ratingRank != null && r.ratingRank <= 3],
    ["최연소", (r) => r.ageDelta === 0],
    ["부담중량 최저", (r) => r.budamDelta === 0],
    ["안쪽 마번(1~4)", (r) => r.gate >= 1 && r.gate <= 4],
    ["바깥 마번(9번+)", (r) => r.gate >= 9],
    ["휴양 14일 이하", (r) => r.rest != null && r.rest <= 14],
    ["휴양 56일 이상", (r) => r.rest != null && r.rest >= 56],
    ["마체중 증가", (r) => r.bodyDelta != null && r.bodyDelta > 0],
    ["마체중 감소", (r) => r.bodyDelta != null && r.bodyDelta < 0],
  ];
  console.log(`  ${"조건".padEnd(18)} ${"1착마 중".padStart(9)} ${"전체 중".padStart(9)} ${"배수".padStart(6)}`);
  for (const [label, pred] of rows) {
    const w = share(winners, pred);
    const a = share(recs, pred);
    const lift = a > 0 ? w / a : NaN;
    console.log(`  ${label.padEnd(18)} ${pct(w).padStart(9)} ${pct(a).padStart(9)} ${f2(lift).padStart(6)}`);
  }

  console.log("\n=== 조건별 1착 확률 (그 조건인 말이 1착할 확률) ===");
  console.log(`  기준선(무작위) ${pct(base)}\n`);
  console.log(`  ${"조건".padEnd(22)} ${"해당 출주".padStart(9)} ${"1착률".padStart(8)} ${"배수".padStart(6)}`);
  const conds = [
    ["1인기", (r) => r.favRank === 1],
    ["2인기", (r) => r.favRank === 2],
    ["3인기", (r) => r.favRank === 3],
    ["인기 4~6위", (r) => r.favRank >= 4 && r.favRank <= 6],
    ["인기 7위 이하", (r) => r.favRank >= 7],
    ["레이팅 1위", (r) => r.ratingRank === 1],
    ["최연소", (r) => r.ageDelta === 0],
    ["부담중량 최저", (r) => r.budamDelta === 0],
    ["부담중량 +2.5kg 이상", (r) => r.budamDelta != null && r.budamDelta >= 2.5],
    ["마번 1~4", (r) => r.gate <= 4],
    ["마번 9 이상", (r) => r.gate >= 9],
    ["휴양 ≤14일", (r) => r.rest != null && r.rest <= 14],
    ["휴양 28~55일", (r) => r.rest != null && r.rest >= 28 && r.rest <= 55],
    ["휴양 56일+", (r) => r.rest != null && r.rest >= 56],
    ["마체중 증가 [사후]", (r) => r.bodyDelta != null && r.bodyDelta > 0],
    ["초반 통과 1~3위 [사후]", (r) => r.s1Ord != null && r.s1Ord <= 3],
    ["종반200m 상위 [사후]", (r) => r.lateZ != null && r.lateZ < -0.7],
  ];
  for (const [label, pred] of conds) {
    const sub = recs.filter(pred);
    if (sub.length < 200) continue;
    const w = share(sub, (r) => r.ord === 1);
    console.log(
      `  ${label.padEnd(22)} ${sub.length.toLocaleString("ko-KR").padStart(9)} ${pct(w).padStart(8)} ${f2(w / base).padStart(6)}`,
    );
  }

  console.log("\n=== 교집합 — 조건을 겹치면 1착률이 얼마나 오르나 ===");
  console.log(`  ${"조합".padEnd(34)} ${"해당 출주".padStart(9)} ${"1착률".padStart(8)} ${"배수".padStart(6)}`);
  const combos = [
    ["1인기", (r) => r.favRank === 1],
    ["1인기 + 레이팅1위", (r) => r.favRank === 1 && r.ratingRank === 1],
    ["1인기 + 부담최저", (r) => r.favRank === 1 && r.budamDelta === 0],
    ["1인기 + 마번1~4", (r) => r.favRank === 1 && r.gate <= 4],
    ["1인기 + 휴양≤14일", (r) => r.favRank === 1 && r.rest != null && r.rest <= 14],
    ["1인기 + 레이팅1위 + 마번1~4", (r) => r.favRank === 1 && r.ratingRank === 1 && r.gate <= 4],
    ["인기1~3 + 레이팅상위3", (r) => r.favRank <= 3 && r.ratingRank != null && r.ratingRank <= 3],
    ["레이팅1위 (인기 4위 이하)", (r) => r.ratingRank === 1 && r.favRank >= 4],
    ["1인기 + 초반통과1~3 [사후]", (r) => r.favRank === 1 && r.s1Ord != null && r.s1Ord <= 3],
  ];
  for (const [label, pred] of combos) {
    const sub = recs.filter(pred);
    if (sub.length < 100) {
      console.log(`  ${label.padEnd(34)} ${sub.length.toString().padStart(9)}  표본부족`);
      continue;
    }
    const w = share(sub, (r) => r.ord === 1);
    console.log(
      `  ${label.padEnd(34)} ${sub.length.toLocaleString("ko-KR").padStart(9)} ${pct(w).padStart(8)} ${f2(w / base).padStart(6)}`,
    );
  }

  console.log("\n=== 성별 · 산지 ===");
  for (const key of ["sex", "origin"]) {
    const vals = [...new Set(recs.map((r) => r[key]))].filter(Boolean);
    const line = [];
    for (const v of vals) {
      const sub = recs.filter((r) => r[key] === v);
      if (sub.length < 300) continue;
      line.push(`${v} ${pct(share(sub, (r) => r.ord === 1))}(n=${sub.length.toLocaleString("ko-KR")})`);
    }
    console.log(`  ${key === "sex" ? "성별" : "산지"} 1착률: ${line.join(" · ")}`);
  }
}

main();
