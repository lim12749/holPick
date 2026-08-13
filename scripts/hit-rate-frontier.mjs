#!/usr/bin/env node
/**
 * 승률과 수익은 같은 방향으로 움직이지 않는다 — 그걸 숫자로 보여 준다.
 *
 * "복승식 승률을 높이고 싶다" 는 목표는 그 자체로는 언제나 달성 가능하다.
 * 경주당 조합을 더 사면 된다. 20조합을 사면 경주 적중률이 87% 까지 오른다.
 * 문제는 **적중률이 오르는 속도보다 비용이 빨리 오른다**는 것이다.
 *
 * 이 스크립트는 K(경주당 조합 수)를 늘려 가며 적중률·ROI·월 수지를 함께 찍는다.
 * 셋을 따로 보면 "적중률 87%" 가 성공처럼 읽히지만, 같은 줄에 놓으면
 * 그게 월 441만원 손실이라는 게 보인다.
 *
 * 월 수지는 서울 월 약 80경주 · 조합당 1만원 플랫 기준이다.
 *
 * 선행: node scripts/roi-search.mjs build
 * 사용법: node scripts/hit-rate-frontier.mjs
 */
import { readFileSync } from "node:fs";
const recs = JSON.parse(readFileSync(".cache/kra/roi-records.json", "utf8"));
const races = recs.races.filter(r => r.settled);

function norm(a, n) { const o = new Float64Array(n); let s = 0;
  for (let i = 0; i < n; i++) { const v = a[i]; if (v == null || !(v > 0)) return null; o[i] = v; s += v; }
  if (s <= 0) return null; for (let i = 0; i < n; i++) o[i] /= s; return o; }
function pairs(p, n) { const out = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
  const a = Math.min(Math.max(p[i],1e-9),.999), b = Math.min(Math.max(p[j],1e-9),.999);
  out.push({ i, j, q: a*b/(1-a) + b*a/(1-b) }); } return out; }

const key = (a,b) => `${Math.min(a,b)}-${Math.max(a,b)}`;

for (const src of ["modelWin", "marketWin"]) {
  console.log(`\n=== ${src === "modelWin" ? "모델 확률순" : "배당 인기순"} ===`);
  console.log(`  K   경주당비용   베팅수    적중경주   경주적중률     ROI    월수지(1만원)`);
  for (const K of [1,2,3,5,8,12,20]) {
    let bets=0, ret=0, hitRaces=0, nRaces=0;
    for (const r of races) {
      const p = norm(r[src], r.n); if (!p) continue;
      const ps = pairs(p, r.n).sort((x,y)=>y.q-x.q).slice(0, K);
      if (!ps.length) continue;
      nRaces++; let won=false;
      for (const c of ps) { bets++; const pay = r.payouts[key(r.chulNo[c.i], r.chulNo[c.j])] ?? 0;
        ret += pay; if (pay > 0) won = true; }
      if (won) hitRaces++;
    }
    const roi = ret/bets;
    // 월 약 80경주 기준 수지: 비용 80*K*1만, 회수 = 비용*ROI
    const cost = 80*K, profit = cost*(roi-1);
    console.log(`  ${String(K).padStart(2)}   ${String(K).padStart(2)}만원      ${String(bets).padStart(5)}    ${String(hitRaces).padStart(5)}      ${(hitRaces/nRaces*100).toFixed(1).padStart(5)}%   ${roi.toFixed(4)}   ${(profit>=0?"+":"")}${Math.round(profit)}만원`);
  }
}
