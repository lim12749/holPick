#!/usr/bin/env node
/**
 * 순수 예측력 — "어느 말이 이기는가" 를 얼마나 맞히는가.
 *
 * ROI 와 분리해서 재는 이유: 둘은 다른 질문이고 답도 다르다.
 * 실측(970경주) 결과 모델은 1착을 37.7% 맞힌다 — 무작위 9.6% 의 3.9배다.
 * **예측력은 분명히 있다.**
 *
 * 그런데도 돈이 안 되는 이유가 같은 표에 나온다. 배당 1인기가 37.9% 로 거의
 * 같다. 시장도 알고 있고, 아니까 배당을 낮게 매긴다. 어떤 말이 37.7% 로 이기고
 * 시장이 그걸 알면 배당은 대략 (1/0.377)x0.7 = 1.86 이 되고, 회수는
 * 0.377 x 1.86 = 0.70 이다. **10번에 4번 가까이 맞히면서 30% 를 잃는다.**
 *
 * 그래서 우위는 "맞히는 것" 이 아니라 "시장보다 더 맞히는 것" 에서만 나온다.
 * 그 여부는 scripts/feature-edge.mjs 가 판정한다.
 *
 * 선행: node scripts/roi-search.mjs build
 * 사용법: node scripts/accuracy.mjs
 */
import { readFileSync } from "node:fs";
const recs = JSON.parse(readFileSync(".cache/kra/roi-records.json", "utf8"));
const races = recs.races.filter(r => r.actual);

function argmax(a) { let bi = -1, bv = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v != null && v > bv) { bv = v; bi = i; } } return bi; }
function top2idx(a) { const idx = a.map((v, i) => [v ?? -1, i]).sort((x, y) => y[0] - x[0]); return [idx[0][1], idx[1][1]]; }

const S = { model:{win:0,plc:0,two:0}, market:{win:0,plc:0,two:0}, rand:{win:0,plc:0,two:0} };
let n = 0, nMkt = 0;

for (const r of races) {
  const winner = r.actual[0], second = r.actual[1];
  const wi = r.chulNo.indexOf(winner), si = r.chulNo.indexOf(second);
  if (wi < 0 || si < 0) continue;
  n++;
  // 무작위 기대치
  S.rand.win += 1 / r.n;
  S.rand.plc += 2 / r.n;
  S.rand.two += 2 * (2 - 1) / (r.n * (r.n - 1)) * 2; // 상위2두 중 적중 기대 개수 = 2*2/n

  const m = argmax(r.modelWin);
  if (m === wi) S.model.win++;
  if (m === wi || m === si) S.model.plc++;
  const mt = top2idx(r.modelWin);
  S.model.two += (mt.includes(wi) ? 1 : 0) + (mt.includes(si) ? 1 : 0);

  const hasMkt = r.marketWin && r.marketWin.some(v => v != null && v > 0);
  if (hasMkt) {
    nMkt++;
    const k = argmax(r.marketWin);
    if (k === wi) S.market.win++;
    if (k === wi || k === si) S.market.plc++;
    const kt = top2idx(r.marketWin);
    S.market.two += (kt.includes(wi) ? 1 : 0) + (kt.includes(si) ? 1 : 0);
  }
}

const pc = v => (v * 100).toFixed(1) + "%";
console.log(`경주 ${n}개 (시장 배당 있는 경주 ${nMkt}개)\n`);
console.log(`                        1착 적중   2착이내 적중   상위2두 중 적중`);
console.log(`  무작위                 ${pc(S.rand.win/n).padStart(6)}      ${pc(S.rand.plc/n).padStart(6)}         ${(S.rand.two/n).toFixed(2)} / 2`);
console.log(`  모델 1순위             ${pc(S.model.win/n).padStart(6)}      ${pc(S.model.plc/n).padStart(6)}         ${(S.model.two/n).toFixed(2)} / 2`);
console.log(`  배당 1인기             ${pc(S.market.win/nMkt).padStart(6)}      ${pc(S.market.plc/nMkt).padStart(6)}         ${(S.market.two/nMkt).toFixed(2)} / 2`);
console.log(`\n무작위 대비 배수:`);
console.log(`  모델 1착 ${(S.model.win/n)/(S.rand.win/n) < 99 ? ((S.model.win/n)/(S.rand.win/n)).toFixed(2) : "-"}배 · 2착이내 ${((S.model.plc/n)/(S.rand.plc/n)).toFixed(2)}배`);
