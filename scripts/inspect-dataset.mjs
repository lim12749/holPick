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

/**
 * 인증키를 가린다. src/lib/kra/client.ts 의 maskKey 와 같은 동작이어야 한다.
 * (.mjs 에서 TS 를 import 할 수 없어 불가피하게 복제한다 — 한쪽을 고치면 다른 쪽도 고칠 것.)
 *
 * 이 스크립트의 출력은 이슈나 채팅에 붙여넣어지기 쉬우므로,
 * URL 뿐 아니라 응답 본문까지 반드시 이 함수를 거쳐 출력한다.
 */
function maskKey(text) {
  let masked = String(text).replace(/serviceKey=[^&\s"'<]*/gi, "serviceKey=***");
  const key = process.env.KRA_API_KEY?.trim();
  if (key && key.length > 8) {
    masked = masked.split(key).join("***");
    try {
      const alt = key.includes("%") ? decodeURIComponent(key) : encodeURIComponent(key);
      if (alt !== key) masked = masked.split(alt).join("***");
    } catch {
      // 디코딩할 수 없는 키라면 원본 치환만으로 충분하다.
    }
  }
  return masked;
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

  if (!key) {
    console.error("KRA_API_KEY 가 비어 있습니다.");
    process.exit(1);
  }
  if (!base) {
    console.error(
      `base URL 이 비어 있습니다. .env.local 의 ${envKey === "KRA_EP_AI_RACE_PLAN" ? "KRA_AI_BASE_URL" : "KRA_API_BASE_URL"} 을 확인하세요.`,
    );
    process.exit(1);
  }
  if (!path) {
    console.error(`${envKey} 가 비어 있습니다 (엔드포인트 미설정).`);
    process.exit(1);
  }

  const params = new URLSearchParams({
    pageNo: "1",
    numOfRows: String(numOfRows),
    _type: "json",
    meet: "1",
  });
  const url = `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}?serviceKey=${encodeServiceKey(key)}&${params}`;

  console.log(`요청: ${maskKey(url)}\n`);

  const started = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  console.log(`HTTP ${res.status} · ${Date.now() - started}ms\n`);

  const head = text.trimStart();
  if (!head.startsWith("{") && !head.startsWith("[")) {
    console.log("JSON 이 아닌 응답:\n");
    console.log(maskKey(text).slice(0, 1200));
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
    console.log(maskKey(JSON.stringify(json, null, 2)).slice(0, 2000));
    return;
  }

  console.log(`필드 ${Object.keys(rows[0]).length}개:\n`);
  for (const [k, v] of Object.entries(rows[0])) {
    console.log(`  ${k.padEnd(20)} = ${JSON.stringify(v)}`);
  }
}

main().catch((err) => {
  // 오류 메시지에 요청 URL 이 섞여 나올 수 있으므로 마스킹 후 출력한다.
  console.error(maskKey(err instanceof Error ? (err.stack ?? err.message) : String(err)));
  process.exit(1);
});
