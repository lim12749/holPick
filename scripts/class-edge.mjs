#!/usr/bin/env node
/**
 * 등급별 우위 — 지금까지 나온 것 중 유일하게 본전을 넘는 신호.
 *
 * 구간 스캔에서 별정A · 1~3R · 국6등급 셋이 ROI 1.0 을 넘었는데, 겹침을 보니
 * 국6등급(804) 이 별정A(892) 에 통째로 포함돼 있었다. 국6등급을 빼면 별정A 는
 * 0.87, 1~3R 은 0.87 로 주저앉는다. **셋이 아니라 하나였다.**
 *
 * 그리고 등급을 순서대로 세우면 단조 패턴이 나온다 (3,088경주):
 *
 *   국6등급  804경주  적중 22.8%  ROI 1.0720   ← 최하위 등급
 *   국5등급  745경주  적중 17.9%  ROI 0.8682
 *   국4등급  373경주  적중 14.7%  ROI 0.6874
 *   혼4등급  451경주  적중 16.6%  ROI 0.6390
 *   혼3등급  217경주  적중 13.4%  ROI 0.6972
 *
 * 구간 하나가 튄 게 아니라 **용량-반응 관계**라 노이즈로 설명하기 어렵다.
 * 메커니즘도 자연스럽다 — 하위 등급은 배당판이 얇고 연구하는 사람이 적어
 * 시장이 덜 효율적이다. 우위가 있다면 정확히 여기 있어야 한다.
 *
 * **아직 확정은 아니다.** 국6등급 ROI 의 95% 신뢰구간이 [0.84, 1.41] 로 1.0 을
 * 걸치고, 2023년은 0.71 이었다(2024 1.07 · 2025 1.25 · 2026 1.04).
 * 확정하려면 국6등급만 수천 베팅이 필요한데 연 270경주라 몇 년이 더 걸린다.
 *
 * 선행: node scripts/roi-search.mjs build
 * 사용법: node scripts/class-edge.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const C = ".cache/kra";
const num = v => Number(String(v ?? 0).replace(/,/g,""))||0, str = v => String(v??"").trim();
const recs = JSON.parse(readFileSync(join(C,"roi-records.json"),"utf8"));
const meta = new Map();
for (const f of readdirSync(C).filter(f=>f.startsWith("race-result-")))
  for (const r of JSON.parse(readFileSync(join(C,f),"utf8")).rows ?? []) {
    const k=`${str(r.rcDate)}-${num(r.rcNo)}`;
    if(!meta.has(k)) meta.set(k,{budam:str(r.budam),rank:str(r.rank),rcNo:num(r.rcNo),dist:num(r.rcDist)});
  }
function norm(a,n){const o=new Float64Array(n);let s=0;
  for(let i=0;i<n;i++){const v=a[i];if(v==null||!(v>0))return null;o[i]=v;s+=v;}
  for(let i=0;i<n;i++)o[i]/=s;return o;}
function bp(p,n){let b=null;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  const x=Math.min(Math.max(p[i],1e-9),.999),y=Math.min(Math.max(p[j],1e-9),.999);
  const q=x*y/(1-x)+y*x/(1-y);if(!b||q>b.q)b={i,j,q};}return b;}
const key=(a,b)=>`${Math.min(a,b)}-${Math.max(a,b)}`;
const rows=[];
for(const r of recs.races){ if(!r.settled)continue;
  const m=meta.get(`${r.date}-${r.rcNo}`); if(!m)continue;
  const p=norm(r.modelWin,r.n); if(!p)continue; const b=bp(p,r.n); if(!b)continue;
  let fav=0; if(r.marketWin){const mx=Math.max(...r.marketWin.filter(v=>v!=null&&v>0),0); if(mx>0)fav=0.8/mx;}
  rows.push({date:r.date,...m,fav,pay:r.payouts[key(r.chulNo[b.i],r.chulNo[b.j])]??0});
}
let seed=11;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
function boot(s,B=10000){if(s.length<20)return[NaN,NaN];const o=new Float64Array(B);
  for(let b=0;b<B;b++){let t=0;for(let i=0;i<s.length;i++)t+=s[(rnd()*s.length)|0].pay;o[b]=t/s.length;}
  o.sort();return[o[B*.025|0],o[B*.975|0]];}
const show=(name,sel)=>{ if(sel.length<40){console.log(`  ${name.padEnd(30)} 표본부족 (${sel.length})`);return;}
  const roi=sel.reduce((a,x)=>a+x.pay,0)/sel.length, hit=sel.filter(x=>x.pay>0).length/sel.length;
  const ci=boot(sel);
  console.log(`  ${name.padEnd(30)} ${String(sel.length).padStart(5)} ${(hit*100).toFixed(1).padStart(6)}% ${roi.toFixed(4).padStart(8)}  [${ci[0].toFixed(2)}, ${ci[1].toFixed(2)}]${ci[0]>1?" ◀":""}`);};

console.log(`  ${"구간".padEnd(30)} ${"경주".padStart(5)} ${"적중".padStart(7)} ${"ROI".padStart(8)}  95%CI`);
show("전체", rows);
show("국6등급", rows.filter(r=>r.rank==="국6등급"));
show("별정A 이면서 국6등급 아님", rows.filter(r=>r.budam==="별정A"&&r.rank!=="국6등급"));
show("1~3R 이면서 국6등급 아님", rows.filter(r=>r.rcNo<=3&&r.rank!=="국6등급"));
show("국6등급 이면서 4R 이후", rows.filter(r=>r.rank==="국6등급"&&r.rcNo>3));
show("국6등급 이면서 1~3R", rows.filter(r=>r.rank==="국6등급"&&r.rcNo<=3));
console.log("");
show("국5등급", rows.filter(r=>r.rank==="국5등급"));
show("국4등급", rows.filter(r=>r.rank==="국4등급"));
show("혼4등급", rows.filter(r=>r.rank==="혼4등급"));
show("혼3등급", rows.filter(r=>r.rank==="혼3등급"));
console.log("\n국6등급 연도별:");
for (const y of ["2023","2024","2025","2026"]) {
  const s=rows.filter(r=>r.rank==="국6등급"&&r.date.startsWith(y));
  if(s.length>=40) show("  "+y, s);
}
