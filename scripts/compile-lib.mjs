/**
 * `src/lib/kra/**` 의 TypeScript 를 컴파일해 Node 스크립트에서 그대로 import 한다.
 *
 * 왜 이렇게까지 하는가: 스크립트에서 로직을 복제하면 분석에 쓴 코드와 화면이
 * 실제로 쓰는 코드가 조용히 갈라진다. 그러면 스크립트가 내놓는 숫자가 거짓이 된다.
 * predict.ts 의 featureLogits 든 dividend-parse.ts 의 동착 처리든, **그대로 불러
 * 쓰는 게** 유일하게 안전한 방법이다.
 *
 * 세 가지 손질이 필요하다:
 *  1. tsc 는 확장자 없는 relative import 를 내보내므로 Node ESM 이 읽도록 `.js` 를 붙인다.
 *  2. `import "server-only"` 를 지운다. 그 패키지는 `react-server` 조건 밖에서
 *     무조건 throw 하므로, 지우지 않으면 client.ts·cache.ts 를 Node 에서 못 쓴다.
 *     번들러가 걸어 주는 안전장치라 Node 단독 실행에서는 지켜 줄 대상이 없다.
 *  3. `{"type":"module"}` 을 심어 ESM 으로 읽히게 한다.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * @param {string[]} entries `src/lib/kra` 기준 모듈명 배열 (예: ["predict", "stats"])
 * @param {{ prefix?: string }} [opts]
 * @returns {Promise<Record<string, any>>} 모듈명 → 로드된 모듈
 */
export async function loadLib(entries, opts = {}) {
  const out = mkdtempSync(join(tmpdir(), opts.prefix ?? "holpick-lib-"));

  execFileSync(
    "npx",
    [
      "tsc",
      ...entries.map((e) => `src/lib/kra/${e}.ts`),
      "--outDir",
      out,
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
    ],
    { stdio: "inherit" },
  );

  for (const f of readdirSync(out).filter((f) => f.endsWith(".js"))) {
    const p = join(out, f);
    const src = readFileSync(p, "utf8")
      .replace(/^\s*import\s+["']server-only["'];?\s*$/gm, "")
      .replace(/(from\s+")(\.\/[^"]+)(")/g, "$1$2.js$3");
    writeFileSync(p, src);
  }
  writeFileSync(join(out, "package.json"), '{"type":"module"}');

  /** @type {Record<string, any>} */
  const mods = {};
  for (const e of entries) {
    mods[basename(e)] = await import(join(out, `${e}.js`));
  }
  return mods;
}

/**
 * 컴파일 대상 소스의 수정 시각. 레코드 파일에 박아 두고 재사용 전에 대조한다.
 *
 * 스테일 레코드로 낡은 코드의 결과를 새 결과인 양 보고하는 것을 막는 장치다.
 * @param {string[]} entries
 * @returns {Record<string, number>}
 */
export function sourceMtimes(entries) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const e of entries) {
    const p = `src/lib/kra/${e}.ts`;
    out[p] = Math.floor(statSync(p).mtimeMs);
  }
  return out;
}
