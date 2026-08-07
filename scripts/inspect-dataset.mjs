#!/usr/bin/env node
/**
 * 설정된 데이터셋을 실제로 호출해 응답 구조를 보여준다.
 *
 * 레지스트리(src/lib/kra/datasets.ts)의 preferredColumns 와 한글 라벨 사전을
 * 실제 응답 필드명에 맞추려면 먼저 무엇이 내려오는지 봐야 한다.
 *
 * 사용법:
 *   node --env-file=.env.local scripts/inspect-dataset.mjs KRA_EP_HORSE_DETAIL
 *   node --env-file=.env.local scripts/inspect-dataset.mjs KRA_EP_HORSE_DETAIL --rows 3
 */

const ALREADY_ENCODED = /%[0-9A-Fa-f]{2}/;

function encodeServiceKey(key) {
  return ALREADY_ENCODED.test(key) ? key : encodeURIComponent(key);
}

async function main() {
  const [envKey, ...rest] = process.argv.slice(2);
  if (!envKey) {
    console.error("사용법: node --env-file=.env.local scripts/inspect-dataset.mjs <ENV_KEY>");
    process.exit(1);
  }

  const rowsIdx = rest.indexOf("--rows");
  const numOfRows = rowsIdx !== -1 ? Number(rest[rowsIdx + 1]) : 1;

  const key = process.env.KRA_API_KEY?.trim();
  const base = (
    envKey === "KRA_EP_AI_RACE_PLAN" ? process.env.KRA_AI_BASE_URL : process.env.KRA_API_BASE_URL
  )?.trim();
  const path = process.env[envKey]?.trim();

  if (!key) return console.error("KRA_API_KEY 가 비어 있습니다.");
  if (!path) return console.error(`${envKey} 가 비어 있습니다 (엔드포인트 미설정).`);

  const params = new URLSearchParams({
    pageNo: "1",
    numOfRows: String(numOfRows),
    _type: "json",
    meet: "1",
  });
  const url = `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}?serviceKey=${encodeServiceKey(key)}&${params}`;

  console.log(`요청: ${url.replace(/serviceKey=[^&]*/, "serviceKey=***")}\n`);

  const started = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  console.log(`HTTP ${res.status} · ${Date.now() - started}ms\n`);

  if (!text.trimStart().startsWith("{")) {
    console.log("JSON 이 아닌 응답:\n");
    console.log(text.slice(0, 1200));
    return;
  }

  const json = JSON.parse(text);
  const body = json?.response?.body;
  const header = json?.response?.header;

  console.log(`resultCode: ${header?.resultCode}  resultMsg: ${header?.resultMsg}`);
  console.log(`totalCount: ${body?.totalCount}\n`);

  const raw = body?.items?.item ?? body?.items;
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

  if (rows.length === 0) {
    console.log("행이 없습니다. 전체 응답:\n");
    console.log(JSON.stringify(json, null, 2).slice(0, 2000));
    return;
  }

  console.log(`필드 ${Object.keys(rows[0]).length}개:\n`);
  for (const [k, v] of Object.entries(rows[0])) {
    console.log(`  ${k.padEnd(20)} = ${JSON.stringify(v)}`);
  }
}

main();
