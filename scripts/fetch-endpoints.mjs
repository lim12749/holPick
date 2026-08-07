#!/usr/bin/env node
/**
 * 공공데이터포털 페이지에 박혀 있는 Swagger 명세에서 요청주소를 자동으로 꺼낸다.
 *
 * 오퍼레이션명은 화면에 표시되지 않지만, 각 데이터셋 페이지의 HTML 안에는
 * Swagger 스펙이 통째로 들어 있다. 거기 `host` 와 `paths` 를 합치면 정확한
 * 요청주소가 나온다. 로그인도, 문서 다운로드도 필요 없다.
 *
 *   "host": "apis.data.go.kr/B551015/API15_2"
 *   "paths": { "/raceHorseResult_2": ... }
 *   → API15_2/raceHorseResult_2
 *
 * 사용법:
 *   node scripts/fetch-endpoints.mjs            # 레지스트리의 전 데이터셋
 *   node scripts/fetch-endpoints.mjs 15058677   # 특정 데이터셋 ID 만
 */

/** 레지스트리(src/lib/kra/datasets.ts)와 같은 목록. 환경변수 이름까지 함께 출력한다. */
const DATASETS = [
  { pk: "15058115", envKey: "KRA_EP_HORSE_DETAIL", label: "경주마 상세정보" },
  { pk: "15058677", envKey: "KRA_EP_ENTRY_LIST", label: "출전표 상세정보" },
  { pk: "15058305", envKey: "KRA_EP_RACE_RESULT", label: "경주기록 정보" },
  { pk: "15058779", envKey: "KRA_EP_HORSE_RECORD", label: "경주마 성적 정보" },
  { pk: "15057323", envKey: "KRA_EP_HORSE_RATING", label: "경주마 레이팅 정보" },
  { pk: "15056591", envKey: "KRA_EP_JOCKEY_RECORD", label: "기수 성적 정보" },
  { pk: "15057859", envKey: "KRA_EP_SECTIONAL_RECORD", label: "마필 구간별 경주기록" },
  { pk: "15056779", envKey: "KRA_EP_ENTRY_CANCEL", label: "경주마 출전취소 정보" },
  { pk: "15143802", envKey: "KRA_EP_AI_RACE_PLAN", label: "AI학습용 경주계획" },
];

const BASE_PREFIX = "apis.data.go.kr/B551015/";

/**
 * 페이지 HTML 에서 Swagger 의 host 와 paths 를 뽑아 경로를 조립한다.
 *
 * HTML 안에 JSON 이 escape 된 채로 들어 있어 정규식으로 읽는다. 전체 JSON 을
 * 파싱하려 들면 escape 형태가 페이지마다 달라 오히려 깨진다.
 */
function extractFromSwagger(html) {
  const hostMatch = html.match(/"host"\s*:\s*"apis\.data\.go\.kr\/B551015\/([A-Za-z0-9_]+)"/);
  if (!hostMatch) return { apiNo: null, operations: [] };
  const apiNo = hostMatch[1];

  // host 뒤에 이어지는 paths 블록에서 "/오퍼레이션명" 을 모은다.
  const after = html.slice(hostMatch.index);
  const pathsMatch = after.match(/"paths"\s*:\s*\{/);
  const operations = new Set();
  if (pathsMatch) {
    // paths 블록 앞부분만 훑어도 오퍼레이션 키가 모두 잡힌다.
    const window = after.slice(pathsMatch.index, pathsMatch.index + 200_000);
    for (const m of window.matchAll(/"\/([A-Za-z0-9_]+)"\s*:\s*\{\s*"get"/g)) {
      operations.add(m[1]);
    }
  }
  // 보조 수단: swaggerOprtinVOs 의 operationId.
  for (const m of html.matchAll(/"operationId"\s*:\s*"([A-Za-z0-9_]+)"/g)) {
    operations.add(m[1]);
  }
  return { apiNo, operations: [...operations] };
}

async function main() {
  const only = process.argv[2];
  const targets = only ? DATASETS.filter((d) => d.pk === only) : DATASETS;
  if (targets.length === 0) {
    console.error(`알 수 없는 데이터셋 ID: ${only}`);
    process.exit(1);
  }

  const lines = [];
  for (const d of targets) {
    process.stdout.write(`${d.label.padEnd(22)} `);
    try {
      const res = await fetch(`https://www.data.go.kr/data/${d.pk}/openapi.do`, {
        signal: AbortSignal.timeout(30_000),
      });
      const html = await res.text();
      const { apiNo, operations } = extractFromSwagger(html);

      if (!apiNo) {
        console.log("Swagger 명세를 찾지 못함 — 마이페이지에서 수동 확인 필요");
        continue;
      }
      if (operations.length === 0) {
        console.log(`${apiNo}/???   (오퍼레이션명을 찾지 못함)`);
        continue;
      }
      const best = `${apiNo}/${operations[0]}`;
      console.log(best + (operations.length > 1 ? `   (후보 ${operations.length}개: ${operations.join(", ")})` : ""));
      lines.push(`${d.envKey}=${best}`);
    } catch (err) {
      console.log(`실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (lines.length > 0) {
    console.log(`\n${"=".repeat(60)}\n.env.local 에 넣을 값:\n`);
    for (const l of lines) console.log(l);
    console.log(
      `\n※ ${BASE_PREFIX} 앞부분은 KRA_API_BASE_URL 이 담당하므로 뒷부분만 넣습니다.`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
