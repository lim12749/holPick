#!/usr/bin/env node
/**
 * 공공데이터포털 참고문서(.docx)에서 각 데이터셋의 요청주소를 자동으로 꺼낸다.
 *
 * 오퍼레이션명은 포털 화면에 노출되지 않고 참고문서 안에만 있다. 다행히 그 문서는
 * 로그인 없이 받을 수 있고 .docx 는 XML 이 든 zip 이라, 받아서 본문에서
 * `apis.data.go.kr/...` 패턴을 뽑아내면 된다.
 *
 * 사용법:
 *   node scripts/fetch-endpoints.mjs            # 레지스트리의 전 데이터셋
 *   node scripts/fetch-endpoints.mjs 15058677   # 특정 데이터셋 ID 만
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

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

async function findFileId(pk) {
  const res = await fetch(`https://www.data.go.kr/data/${pk}/openapi.do`, {
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  // 참고문서 다운로드는 fn_fileDownload('FILE_xxx','1') 형태로 걸려 있다.
  const m = html.match(/fn_fileDownload\('([^']+)','(\d+)'\)/);
  return m ? { atchFileId: m[1], fileSn: m[2] } : null;
}

async function extractEndpoints({ atchFileId, fileSn }) {
  const res = await fetch(
    `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${atchFileId}&fileSn=${fileSn}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  const buf = Buffer.from(await res.arrayBuffer());
  // .docx 가 아니면(예: hwp) 여기서 포기한다.
  if (buf.subarray(0, 2).toString() !== "PK") return { unsupported: true, paths: [] };

  const dir = await mkdtemp(join(tmpdir(), "kra-doc-"));
  try {
    const file = join(dir, "doc.docx");
    await writeFile(file, buf);
    await run("unzip", ["-o", "-q", file, "-d", dir]);
    const xml = await readFile(join(dir, "word", "document.xml"), "utf8");
    const text = xml
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    const found = new Set();
    for (const m of text.matchAll(/apis\.data\.go\.kr\/B551015\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/g)) {
      found.add(`${m[1]}/${m[2]}`);
    }
    return { unsupported: false, paths: [...found] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      const fileRef = await findFileId(d.pk);
      if (!fileRef) {
        console.log("참고문서 링크를 찾지 못함");
        continue;
      }
      const { unsupported, paths } = await extractEndpoints(fileRef);
      if (unsupported) {
        console.log("docx 가 아닌 문서 형식 — 수동 확인 필요");
        continue;
      }
      if (paths.length === 0) {
        console.log("문서에서 요청주소를 찾지 못함");
        continue;
      }
      // 가장 짧은 것이 군더더기 없는 경로일 가능성이 높다(문서에 설명이 붙어 나오는 경우가 있음).
      const best = paths.sort((a, b) => a.length - b.length)[0];
      console.log(best + (paths.length > 1 ? `   (후보 ${paths.length}개)` : ""));
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
