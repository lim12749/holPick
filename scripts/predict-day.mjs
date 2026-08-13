#!/usr/bin/env node
/**
 * 다가올 경주일의 복승 조합 예측.
 *
 * 화면(`/races/[date]`)과 같은 경로를 쓴다 — predictRace → quinellaPicks.
 * 스크립트로 따로 두는 이유는 주말 편성을 한 번에 뽑아 놓고 보기 위해서다.
 *
 * **시장 항 주의.** predict.ts 는 확정 단승배당을 가중치 0.44 로 쓴다(가장 무거운
 * 요인이다). 그런데 배당은 경주 당일에야 실려 오므로, 며칠 전에 돌리면 배당이
 * 전부 0 이고 모델이 자동으로 NO_MARKET_MODEL 로 내려간다. 그 상태의 예측은
 * 배당이 붙은 예측보다 확실히 약하다. 스크립트가 매번 어느 쪽을 썼는지 찍는다.
 *
 * 사용법:
 *   node --env-file=.env.local scripts/predict-day.mjs 20260815 20260816
 *   node --env-file=.env.local scripts/predict-day.mjs --fresh 20260815
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadLib } from "./compile-lib.mjs";

const CACHE = join(process.cwd(), ".cache", "kra");
const num = (v) => Number(String(v ?? 0).replace(/,/g, "")) || 0;
const str = (v) => String(v ?? "").trim();

const dates = process.argv.slice(2).filter((a) => /^\d{8}$/.test(a));
const fresh = process.argv.includes("--fresh");
if (dates.length === 0) {
  console.error("사용법: node --env-file=.env.local scripts/predict-day.mjs YYYYMMDD [YYYYMMDD…]");
  process.exit(1);
}

function loadCachedRows() {
  const rows = [];
  for (const f of readdirSync(CACHE).filter((f) => f.startsWith("race-result-")).sort()) {
    const env = JSON.parse(readFileSync(join(CACHE, f), "utf8"));
    rows.push(...(env.rows ?? []));
  }
  return rows;
}

async function main() {
  const lib = await loadLib(
    ["predict", "pick", "stats", "style", "sectional", "quinella", "client", "cache", "month", "horse"],
    { prefix: "holpick-predict-" },
  );
  const { predictRace, marketProbabilities } = lib.predict;
  const { candidateFromRow, EMPTY_TRAITS } = lib.pick;
  const { buildStatsBundle, groupRows } = lib.stats;
  const { buildStyleHistory } = lib.style;
  const { buildSectionalHistory } = lib.sectional;
  const { quinellaPicks } = lib.quinella;

  // 대상 월을 새로 받아 배당이 실렸는지 확인한다. 이번 달 TTL 은 6시간이다.
  if (fresh) {
    const months = [...new Set(dates.map((d) => d.slice(0, 6)))];
    for (const m of months) {
      const r = await lib.client.cachedCall(
        "race-result",
        { numOfRows: 2000, extra: { rc_month: m }, timeoutMs: 60_000 },
        `race-result-${m}-meet1`,
        lib.cache.monthTtl(m, lib.month.currentYearMonthKst()),
        { fresh: true },
      );
      console.log(`${m} 갱신: ${r.rows.length}행 (${r.status})`);
    }
  }

  const all = loadCachedRows();
  // 통계·이력은 **완주한** 경주에서만 만든다. 미시행 행(ord=0)은 결과가 없다.
  const finished = all.filter((r) => num(r.ord) > 0 && num(r.ord) <= 90);
  const stats = buildStatsBundle(
    finished,
    buildStyleHistory(finished),
    buildSectionalHistory(finished),
  );
  const styleHistory = buildStyleHistory(finished);
  const sectionalHistory = buildSectionalHistory(finished);
  // 다가올 경주는 "지금까지의 전부"가 최신 스냅샷이다.
  const traits = { style: styleHistory.finalStyle, sectional: sectionalHistory.final };

  console.log(`\n학습 표본: ${finished.length}행 · ${new Set(finished.map((r) => str(r.rcDate) + r.rcNo)).size}경주\n`);

  for (const date of dates) {
    const dayRows = all.filter((r) => str(r.rcDate) === date);
    if (dayRows.length === 0) {
      console.log(`${date}: 편성 없음\n`);
      continue;
    }

    const weekday = ["일", "월", "화", "수", "목", "금", "토"][
      new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`).getUTCDay()
    ];
    console.log(`${"=".repeat(72)}`);
    console.log(`${date} (${weekday}) 서울`);
    console.log(`${"=".repeat(72)}`);

    for (const [, race] of groupRows(dayRows)) {
      // 마번 순 정렬은 누수 차단. 응답 순서가 착순일 수 있다.
      const runners = [...race].sort((a, b) => num(a.chulNo) - num(b.chulNo));
      if (runners.length < 4) continue;

      const cands = runners.map((r) => candidateFromRow(r, traits));
      const rcDist = num(runners[0].rcDist);
      const market = marketProbabilities(cands.map((c) => c.winOdds));
      const preds = predictRace(cands, stats, rcDist);
      const picks = quinellaPicks(preds, 3);

      const rcNo = num(runners[0].rcNo);
      const rcName = str(runners[0].rcName) || `${rcDist}m`;
      console.log(
        `\n${rcNo}R  ${rcName}  ${rcDist}m  ${runners.length}두   [${market.usable ? `배당 반영 (오버라운드 ${market.overround.toFixed(3)})` : "배당 없음 → 요인만"}]`,
      );

      const top = preds.slice(0, 4);
      console.log(
        `  상위: ` +
          top
            .map((p) => `${p.chulNo}.${p.hrName}(${(p.top2 * 100).toFixed(0)}%)`)
            .join("  "),
      );
      for (let i = 0; i < picks.length; i += 1) {
        // QuinellaPick.a/b 는 마번이 아니라 Prediction 객체다.
        const { a, b, prob, fairOdds } = picks[i];
        const lo = Math.min(a.chulNo, b.chulNo);
        const hi = Math.max(a.chulNo, b.chulNo);
        const names = a.chulNo === lo ? [a.hrName, b.hrName] : [b.hrName, a.hrName];
        console.log(
          `  ${i + 1}순위 조합  ${lo}-${hi}  ${names[0]} · ${names[1]}` +
            `   확률 ${(prob * 100).toFixed(1)}%  본전배당 ${fairOdds.toFixed(1)}`,
        );
      }
    }
    console.log("");
  }

  console.log(`${"=".repeat(72)}`);
  console.log(`검증 구간 실측 (roi-search.mjs, 733경주):`);
  console.log(`  이 모델의 1순위 조합 플랫 베팅 ROI  0.8497  CI [0.70, 1.00]`);
  console.log(`  인기 2두 조합 플랫 베팅 ROI        0.9299  CI [0.77, 1.09]`);
  console.log(`  복승 풀 환급률(공제 후)             약 0.70`);
  console.log(`  → 어느 쪽도 본전(1.00)을 넘지 못했다. 위 조합은 "이 경주에서 상대적으로`);
  console.log(`     유리한 두 마리"이지, 기대수익이 양수라는 뜻이 아니다.`);
  console.log(`${"=".repeat(72)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
