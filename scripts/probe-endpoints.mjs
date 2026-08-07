#!/usr/bin/env node
/**
 * 한국마사회 API 엔드포인트 존재 여부 탐색기.
 *
 * 공공데이터포털 게이트웨이는 인증키 없이 호출했을 때 경로 존재 여부에 따라
 * 응답이 갈린다. 이 성질을 이용해 **인증키를 쓰지 않고** 오퍼레이션명을 찾는다.
 *
 *   401 (SERVICE_KEY_IS_NULL) → 경로가 존재한다. 키만 없을 뿐이다.
 *   400                       → 경로가 존재하지 않는다.
 *
 * 사용법:
 *   node scripts/probe-endpoints.mjs API8_2/raceHorseInfo_2 API26_2/entryList_2 ...
 *   node scripts/probe-endpoints.mjs --file candidates.txt
 */

const BASE = "https://apis.data.go.kr/B551015";

async function probe(path) {
  const url = `${BASE}/${path.replace(/^\/+/, "")}?pageNo=1&numOfRows=1&_type=json&meet=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return { path, code: res.status, exists: res.status === 401 };
  } catch {
    return { path, code: null, exists: false, error: true };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let candidates = args;

  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1) {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(args[fileIdx + 1], "utf8");
    candidates = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }

  if (candidates.length === 0) {
    console.error("탐색할 경로를 인자로 넘기거나 --file 로 목록을 지정하세요.");
    process.exit(1);
  }

  console.log(`${candidates.length}개 경로 탐색 중...\n`);

  const hits = [];
  for (const path of candidates) {
    const r = await probe(path);
    const mark = r.error ? "ERR " : r.exists ? "HIT " : "  . ";
    console.log(`${mark}${path}${r.code ? `  (${r.code})` : ""}`);
    if (r.exists) hits.push(path);
  }

  console.log(`\n존재하는 경로 ${hits.length}개:`);
  for (const h of hits) console.log(`  ${h}`);
}

main();
