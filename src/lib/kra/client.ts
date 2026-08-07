/**
 * 한국마사회 공공데이터 API 클라이언트. **서버 전용.**
 *
 * 이 모듈은 Server Component / Server Action 에서만 import 한다.
 * 인증키가 브라우저 번들에 들어가면 안 되므로 클라이언트 컴포넌트에서 부르지 말 것.
 * (이 파일 어디에도 클라이언트 지시어를 넣어서는 안 된다.)
 */

import { getDataset, type KraDataset } from "./datasets";
import type { KraResult, KraRow, KraStatus } from "./types";

/**
 * 이미 퍼센트 인코딩된 키인지 판별한다.
 *
 * 공공데이터포털은 인증키를 Encoding/Decoding 두 벌로 준다.
 * Encoding 키(`%2B`, `%2F`, `%3D` 포함)를 URLSearchParams 에 넣으면 `%` 가 다시
 * `%25` 로 인코딩되어 SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 난다.
 * 어느 쪽을 넣어도 동작하도록 여기서 자동 판별한다.
 */
const ALREADY_ENCODED = /%[0-9A-Fa-f]{2}/;

function encodeServiceKey(key: string): string {
  return ALREADY_ENCODED.test(key) ? key : encodeURIComponent(key);
}

/**
 * 화면·로그에 노출해도 안전하도록 인증키를 가린다.
 *
 * URL 뿐 아니라 API 응답 본문에도 적용한다. 오류 본문이 요청 내용을 되비추는
 * 경우가 있어, 화면에 그대로 띄우기 전에 반드시 이 함수를 통과시킨다.
 */
function maskKey(text: string): string {
  let masked = text.replace(/serviceKey=[^&\s"'<]*/gi, "serviceKey=***");
  // 쿼리 파라미터 형태가 아니더라도 키 값 자체가 섞여 있으면 지운다.
  const key = process.env.KRA_API_KEY?.trim();
  if (key && key.length > 8) {
    masked = masked.split(key).join("***");
    // Encoding/Decoding 어느 쪽으로 들어와도 잡히도록 반대 형태도 함께 지운다.
    try {
      const alt = key.includes("%") ? decodeURIComponent(key) : encodeURIComponent(key);
      if (alt !== key) masked = masked.split(alt).join("***");
    } catch {
      // 디코딩할 수 없는 키라면 원본 치환만으로 충분하다.
    }
  }
  return masked;
}

interface ErrorMapping {
  status: KraStatus;
  message: string;
  hint?: string;
}

/** API 가 돌려주는 코드를 한글 안내로 옮긴다. */
function mapErrorCode(code: string): ErrorMapping {
  const c = code.toUpperCase();

  if (c.includes("SERVICE_KEY_IS_NOT_REGISTERED") || c === "30") {
    return {
      status: "auth_error",
      message: "인증키가 등록되지 않았습니다.",
      hint:
        "Encoding/Decoding 키를 모두 시도해 보세요. 발급 직후라면 게이트웨이 반영에 1~2시간이 걸릴 수 있습니다.",
    };
  }
  if (c.includes("SERVICE_KEY_IS_NULL")) {
    return {
      status: "auth_error",
      message: "인증키가 전달되지 않았습니다.",
      hint: ".env.local 의 KRA_API_KEY 가 비어 있는지 확인하세요.",
    };
  }
  if (c.includes("SERVICE_ACCESS_DENIED") || c === "20") {
    return {
      status: "auth_error",
      message: "이 데이터셋에 대한 접근 권한이 없습니다.",
      hint: "공공데이터포털에서 해당 데이터셋을 활용신청했는지 확인하세요.",
    };
  }
  if (c.includes("LIMITED_NUMBER_OF_SERVICE_REQUESTS") || c === "22") {
    return {
      status: "quota",
      message: "일일 호출 한도를 초과했습니다.",
      hint: "내일 초기화됩니다. 운영단계 승인과 활용사례 등록으로 한도를 올릴 수 있습니다.",
    };
  }
  if (c.includes("NODATA") || c === "03") {
    return {
      status: "no_data",
      message: "조건에 맞는 데이터가 없습니다.",
      hint: "경마장·날짜 등 조회 조건을 바꿔 보세요.",
    };
  }
  if (c.includes("HTTP_ERROR") || c.includes("ROUTING") || c === "04") {
    return {
      status: "not_found",
      message: "요청 경로를 찾을 수 없습니다.",
      hint: "오퍼레이션명이 정확한지 확인하세요. 마이페이지 → 개발계정 → 상세기능의 요청주소와 대조하면 됩니다.",
    };
  }

  return { status: "api_error", message: `API 오류: ${code}`, hint: undefined };
}

/** XML 오류 응답에서 코드를 뽑아낸다. 게이트웨이 오류는 XML 로만 내려온다. */
function extractXmlCode(text: string): string | null {
  const patterns = [
    /<returnAuthMsg>([^<]+)<\/returnAuthMsg>/,
    /<errMsg>([^<]+)<\/errMsg>/,
    /<resultMsg>([^<]+)<\/resultMsg>/,
    /<returnReasonCode>([^<]+)<\/returnReasonCode>/,
    /<resultCode>([^<]+)<\/resultCode>/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** items.item 은 행이 1개면 객체, 여러 개면 배열로 내려온다. 항상 배열로 맞춘다. */
function normalizeRows(items: unknown): KraRow[] {
  if (items == null) return [];
  if (Array.isArray(items)) return items as KraRow[];
  if (typeof items === "object") {
    const item = (items as Record<string, unknown>).item;
    if (item == null) return [];
    return Array.isArray(item) ? (item as KraRow[]) : [item as KraRow];
  }
  return [];
}

export interface CallOptions {
  meet?: string;
  pageNo?: number;
  numOfRows?: number;
  /** 데이터셋별 추가 조회 조건 (hr_name, rc_date 등). */
  extra?: Record<string, string>;
}

function emptyResult(status: KraStatus, message: string, hint?: string): KraResult {
  return {
    status,
    message,
    hint,
    httpCode: null,
    elapsedMs: 0,
    totalCount: null,
    pageNo: null,
    numOfRows: null,
    rows: [],
    maskedUrl: "",
  };
}

export async function callKra(datasetId: string, opts: CallOptions = {}): Promise<KraResult> {
  const dataset = getDataset(datasetId);
  if (!dataset) {
    return emptyResult("api_error", `알 수 없는 데이터셋: ${datasetId}`);
  }
  return callDataset(dataset, opts);
}

export async function callDataset(dataset: KraDataset, opts: CallOptions = {}): Promise<KraResult> {
  const key = process.env.KRA_API_KEY?.trim();
  const base = process.env[dataset.baseEnvKey]?.trim();
  const path = process.env[dataset.envKey]?.trim();

  if (!key) {
    return emptyResult(
      "auth_error",
      "인증키가 설정되지 않았습니다.",
      ".env.local 에 KRA_API_KEY 를 채워주세요.",
    );
  }
  if (!base) {
    return emptyResult("unset", "base URL 이 설정되지 않았습니다.", `.env.local 의 ${dataset.baseEnvKey} 를 확인하세요.`);
  }
  if (!path) {
    return emptyResult(
      "unset",
      "엔드포인트가 아직 설정되지 않았습니다.",
      `공공데이터포털 마이페이지 → 데이터활용 → Open API → 개발계정 → "${dataset.label}" → 상세기능 의 요청주소에서 base URL 뒤 경로를 복사해 .env.local 의 ${dataset.envKey} 에 넣어주세요.`,
    );
  }

  const params: Record<string, string> = {
    pageNo: String(opts.pageNo ?? 1),
    numOfRows: String(opts.numOfRows ?? Number(process.env.KRA_NUM_OF_ROWS ?? 100)),
    _type: process.env.KRA_RESPONSE_TYPE ?? "json",
    meet: opts.meet ?? process.env.KRA_DEFAULT_MEET ?? "1",
    ...dataset.extraParams,
    ...opts.extra,
  };

  const url =
    `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}` +
    `?serviceKey=${encodeServiceKey(key)}&${new URLSearchParams(params).toString()}`;
  const maskedUrl = maskKey(url);

  const timeoutMs = Number(process.env.KRA_TIMEOUT_MS ?? 10000);
  const startedAt = Date.now();

  let httpCode: number | null = null;
  let text: string;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // 진단·탐색 화면은 항상 현재 상태를 봐야 하므로 캐시하지 않는다.
      cache: "no-store",
    });
    httpCode = res.status;
    text = await res.text();
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      ...emptyResult(
        "network",
        isTimeout ? `응답이 ${timeoutMs}ms 안에 오지 않았습니다.` : "네트워크 오류가 발생했습니다.",
        isTimeout ? "KRA_TIMEOUT_MS 를 늘리거나 잠시 후 다시 시도하세요." : undefined,
      ),
      httpCode,
      elapsedMs,
      maskedUrl,
    };
  }

  const elapsedMs = Date.now() - startedAt;

  // 게이트웨이 오류는 HTTP 400/401 에 XML 본문으로 내려온다.
  if (httpCode !== 200) {
    const code = extractXmlCode(text);
    const mapped = code
      ? mapErrorCode(code)
      : httpCode === 400
        ? {
            status: "not_found" as KraStatus,
            message: "요청 경로를 찾을 수 없습니다.",
            hint: "오퍼레이션명이 틀렸을 가능성이 높습니다. 마이페이지 → 개발계정 → 상세기능의 요청주소와 대조하세요.",
          }
        : { status: "api_error" as KraStatus, message: `HTTP ${httpCode}` };
    return { ...emptyResult(mapped.status, mapped.message, mapped.hint), code: code ?? undefined, httpCode, elapsedMs, maskedUrl };
  }

  // HTTP 200 이어도 본문이 XML 오류일 수 있다.
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    const code = extractXmlCode(text);
    if (code && !/NORMAL/i.test(code)) {
      const mapped = mapErrorCode(code);
      return { ...emptyResult(mapped.status, mapped.message, mapped.hint), code, httpCode, elapsedMs, maskedUrl };
    }
    return {
      ...emptyResult(
        "parse_error",
        "XML 응답을 받았습니다.",
        "_type=json 파라미터가 전달되는지 확인하세요. 일부 데이터셋은 XML 만 제공합니다.",
      ),
      code: code ?? undefined,
      httpCode,
      elapsedMs,
      maskedUrl,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      // 응답 본문을 화면에 보여주므로 반드시 마스킹을 거친다.
      ...emptyResult("parse_error", "응답을 JSON 으로 해석하지 못했습니다.", maskKey(text).slice(0, 200)),
      httpCode,
      elapsedMs,
      maskedUrl,
    };
  }

  const response = (json as Record<string, unknown>)?.response as Record<string, unknown> | undefined;
  const header = response?.header as Record<string, unknown> | undefined;
  const body = response?.body as Record<string, unknown> | undefined;

  const resultCode = header?.resultCode != null ? String(header.resultCode) : null;
  if (resultCode && resultCode !== "00" && resultCode !== "0") {
    const mapped = mapErrorCode(String(header?.resultMsg ?? resultCode));
    return { ...emptyResult(mapped.status, mapped.message, mapped.hint), code: resultCode, httpCode, elapsedMs, maskedUrl };
  }

  const rows = normalizeRows(body?.items);
  const totalCount = toNumber(body?.totalCount);

  return {
    status: rows.length === 0 ? "no_data" : "ok",
    message: rows.length === 0 ? "조건에 맞는 데이터가 없습니다." : "정상",
    httpCode,
    elapsedMs,
    totalCount,
    pageNo: toNumber(body?.pageNo),
    numOfRows: toNumber(body?.numOfRows),
    rows,
    maskedUrl,
  };
}

/** 진단용 — 데이터셋 하나를 1건만 조회해서 연결 상태를 본다. */
export async function probeDataset(dataset: KraDataset): Promise<KraResult> {
  return callDataset(dataset, { numOfRows: 1 });
}
