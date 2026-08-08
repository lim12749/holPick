/**
 * 한국마사회 공공데이터 API 클라이언트. **서버 전용.**
 *
 * 이 모듈은 Server Component / Server Action 에서만 import 한다.
 * 인증키가 브라우저 번들에 들어가면 안 되므로 클라이언트 컴포넌트에서 부르지 말 것.
 * (이 파일 어디에도 클라이언트 지시어를 넣어서는 안 된다.)
 *
 * 아래 "server-only" import 가 이 규칙을 빌드 타임에 강제한다. 주석만으로는
 * 실수를 막지 못하고, 클라이언트에서 부르면 키가 undefined 가 되어 원인 불명의
 * "인증키 미설정" 으로 나타난다.
 */
import "server-only";

import { readCache, TTL, writeCache } from "./cache";
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

/**
 * API 가 돌려주는 코드를 한글 안내로 옮긴다.
 *
 * 코드와 메시지를 **둘 다** 본다. 한쪽만 넘기면 분기를 놓친다 — 예를 들어
 * `resultCode: "INFO-200"` + `resultMsg: "해당하는 데이터가 없습니다"` 응답에서
 * 메시지만 검사하면 코드 분기에 닿지 못해 "데이터 없음"이 "API 오류"로 나온다.
 * 화면에 띄우는 폴백 문구는 사람이 읽을 수 있는 메시지를 우선한다.
 */
function mapErrorCode(code: string, message?: string | null): ErrorMapping {
  const candidates = [code, message ?? ""]
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s !== "");
  const has = (pred: (c: string) => boolean) => candidates.some(pred);
  const display = (message ?? "").trim() || code;

  if (has((c) => c.includes("SERVICE_KEY_IS_NOT_REGISTERED") || c === "30")) {
    return {
      status: "auth_error",
      message: "인증키가 등록되지 않았습니다.",
      hint:
        "Encoding/Decoding 키를 모두 시도해 보세요. 발급 직후라면 게이트웨이 반영에 1~2시간이 걸릴 수 있습니다.",
    };
  }
  if (has((c) => c.includes("SERVICE_KEY_IS_NULL"))) {
    return {
      status: "auth_error",
      message: "인증키가 전달되지 않았습니다.",
      hint: ".env.local 의 KRA_API_KEY 가 비어 있는지 확인하세요.",
    };
  }
  if (has((c) => c.includes("SERVICE_ACCESS_DENIED") || c === "20")) {
    return {
      status: "auth_error",
      message: "이 데이터셋에 대한 접근 권한이 없습니다.",
      hint: "공공데이터포털에서 해당 데이터셋을 활용신청했는지 확인하세요.",
    };
  }
  if (has((c) => c.includes("LIMITED_NUMBER_OF_SERVICE_REQUESTS") || c === "22")) {
    return {
      status: "quota",
      message: "일일 호출 한도를 초과했습니다.",
      hint: "내일 초기화됩니다. 운영단계 승인과 활용사례 등록으로 한도를 올릴 수 있습니다.",
    };
  }
  // INFO-200 은 일부 data.go.kr API 에서 "해당 데이터 없음"을 뜻한다.
  if (has((c) => c.includes("NODATA") || c === "03" || c === "INFO-200")) {
    return {
      status: "no_data",
      message: "조건에 맞는 데이터가 없습니다.",
      hint: "경마장·날짜 등 조회 조건을 바꿔 보세요.",
    };
  }
  if (has((c) => c.includes("HTTP_ERROR") || c.includes("ROUTING") || c === "04")) {
    return {
      status: "not_found",
      message: "요청 경로를 찾을 수 없습니다.",
      hint: "오퍼레이션명이 정확한지 확인하세요. 마이페이지 → 개발계정 → 상세기능의 요청주소와 대조하면 됩니다.",
    };
  }

  return { status: "api_error", message: `API 오류: ${display}`, hint: undefined };
}

/**
 * 성공을 뜻하는 코드인지 판별한다.
 *
 * 성공 판정이 여러 곳에 흩어지면 정상 응답을 오류로 뒤집는 사고가 난다.
 * 실제로 data.go.kr 은 데이터셋마다 `00`, `0`, `INFO-000`, `NORMAL SERVICE.` 등
 * 서로 다른 표기를 쓰므로 판정은 반드시 이 함수 하나만 거치게 한다.
 */
function isSuccessCode(code: string | null | undefined): boolean {
  if (code == null) return false;
  const c = code.trim().toUpperCase();
  if (c === "") return false;
  // ABNORMAL_* 을 성공으로 삼키지 않도록 NORMAL 앞을 앵커링한다.
  if (/(^|[^A-Z])NORMAL/.test(c)) return true;
  // 00, 0, INFO-0, INFO-00, INFO-000 … 숫자 부분이 전부 0이면 성공이다.
  return /^(INFO-)?0+$/.test(c);
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

/** 객체가 아닌 값(빈 문자열 등)은 행이 아니다. 유령 행이 표에 뜨는 것을 막는다. */
function isRow(v: unknown): v is KraRow {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * items.item 은 행이 1개면 객체, 여러 개면 배열로 내려온다. 항상 배열로 맞춘다.
 * 데이터가 없을 때 `items: ""` 또는 `items: { item: "" }` 로 오는 경우가 있어
 * 두 형태 모두 빈 배열로 처리한다.
 */
function normalizeRows(items: unknown): KraRow[] {
  if (items == null) return [];
  if (Array.isArray(items)) return items.filter(isRow);
  if (isRow(items)) {
    const item = items.item;
    if (item == null) return [];
    return Array.isArray(item) ? item.filter(isRow) : isRow(item) ? [item] : [];
  }
  return [];
}

/**
 * 환경변수를 읽는다. 값이 빈 문자열이면 미설정으로 본다.
 *
 * `process.env.X ?? 기본값` 은 `X=` 를 잡지 못하고, `Number("")` 는 0 이 된다.
 * 이 프로젝트는 미설정을 빈 값으로 표기하는 관례라(.env.example 의 `KRA_EP_*=`)
 * 그대로 두면 KRA_TIMEOUT_MS= 하나로 전 데이터셋이 즉시 타임아웃된다.
 */
function envStr(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** base URL 이 설정되지 않아도 동작하도록 하는 기본값. */
export const DEFAULT_BASE_URL = "https://apis.data.go.kr/B551015";

export type PathSource = "env" | "default";

/**
 * 호출에 쓸 경로를 정한다.
 *
 * 포털은 요청주소를 `https://apis.data.go.kr/B551015/API8_2/raceHorseInfo_2` 처럼
 * 전체 URL로 보여주므로 그대로 붙여넣는 게 자연스럽다. base 접두어가 붙어 있으면
 * 떼어내고, 오퍼레이션명 없이 API 번호까지만 있으면(슬래시 없음) 검증된
 * defaultPath 로 되돌린다. 절반만 입력된 값으로 조용히 404 를 맞는 것보다 낫다.
 */
export function resolvePath(dataset: KraDataset): { path: string; source: PathSource } {
  const raw = process.env[dataset.envKey]?.trim() ?? "";
  const key = process.env.KRA_API_KEY?.trim();

  // 인증키가 들어간 경우는 오설정 가드가 따로 잡으므로 여기서는 기본값으로 두지 않는다.
  if (raw && key && raw === key) return { path: raw, source: "env" };

  const stripped = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^apis\.data\.go\.kr\/B551015\/?/i, "")
    .replace(/^\/+|\/+$/g, "");

  // 슬래시가 있어야 `API번호/오퍼레이션명` 형태다.
  if (stripped.includes("/")) return { path: stripped, source: "env" };
  return { path: dataset.defaultPath, source: "default" };
}

export interface CallOptions {
  meet?: string;
  pageNo?: number;
  numOfRows?: number;
  /** 데이터셋별 추가 조회 조건 (hr_name, rc_date 등). */
  extra?: Record<string, string>;
  /**
   * 응답을 이 초 동안 재사용한다. 생략하면 캐시하지 않는다.
   *
   * 일일 호출 한도(KRA_DAILY_QUOTA)가 있으므로 매 방문마다 전 데이터셋을
   * 조회하는 화면은 반드시 이 값을 준다. 진단 화면처럼 현재 상태를 그대로
   * 봐야 하는 곳만 생략한다.
   */
  revalidateSeconds?: number;
  /**
   * 이 호출에만 적용할 타임아웃(ms). 생략하면 KRA_TIMEOUT_MS.
   *
   * 월 단위 조회처럼 응답이 오래 걸리는 요청이 있다. 실측상 같은 요청이
   * 1.7초에서 29초까지 널뛰므로, 대량 조회는 개별로 넉넉히 잡아야 한다.
   */
  timeoutMs?: number;
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

/**
 * 데이터셋 하나를 호출한다.
 *
 * 어떤 경로를 어디서 가져왔는지(env 오버라이드인지 검증된 기본값인지)를 결과에
 * 실어 준다. 진단 화면에서 설정 상태를 확인할 때 필요하다.
 */
export async function callDataset(dataset: KraDataset, opts: CallOptions = {}): Promise<KraResult> {
  const { path, source } = resolvePath(dataset);
  const result = await callDatasetInner(dataset, opts);
  return { ...result, path, pathSource: source };
}

async function callDatasetInner(dataset: KraDataset, opts: CallOptions = {}): Promise<KraResult> {
  const key = process.env.KRA_API_KEY?.trim();
  const base = process.env[dataset.baseEnvKey]?.trim() || DEFAULT_BASE_URL;
  // 출처(source)는 호출부 래퍼가 결과에 실어 주므로 여기서는 경로만 쓴다.
  const { path } = resolvePath(dataset);

  if (!key) {
    return emptyResult(
      "auth_error",
      "인증키가 설정되지 않았습니다.",
      ".env.local 에 KRA_API_KEY 를 채워주세요.",
    );
  }

  // 흔한 오설정: 엔드포인트 자리에 인증키를 넣는 경우.
  // 그대로 두면 존재하지 않는 주소가 만들어져 HTTP 400 "경로 없음"으로만 보이고
  // 진짜 원인이 드러나지 않는다. 여기서 명시적으로 잡아 준다.
  if (path === key) {
    return emptyResult(
      "unset",
      "엔드포인트 자리에 인증키가 들어가 있습니다.",
      `${dataset.envKey} 에는 인증키가 아니라 주소의 뒷부분(예: ${dataset.defaultPath})을 넣어야 합니다. 인증키는 KRA_API_KEY 한 줄에만 있으면 되고, 모든 데이터셋이 그 값을 함께 씁니다. 이 줄을 아예 비워두면 검증된 기본값이 쓰입니다.`,
    );
  }

  const params: Record<string, string> = {
    pageNo: String(opts.pageNo ?? 1),
    numOfRows: String(opts.numOfRows ?? envInt("KRA_NUM_OF_ROWS", 100)),
    _type: envStr("KRA_RESPONSE_TYPE", "json"),
    meet: opts.meet ?? envStr("KRA_DEFAULT_MEET", "1"),
    ...dataset.extraParams,
    ...opts.extra,
  };

  const url =
    `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}` +
    `?serviceKey=${encodeServiceKey(key)}&${new URLSearchParams(params).toString()}`;
  const maskedUrl = maskKey(url);

  const timeoutMs = opts.timeoutMs ?? envInt("KRA_TIMEOUT_MS", 10000);
  const startedAt = Date.now();

  let httpCode: number | null = null;
  let text: string;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // 기본은 캐시 없음(진단·탐색은 현재 상태를 봐야 한다).
      // revalidateSeconds 를 준 화면만 한도 절약을 위해 응답을 재사용한다.
      ...(opts.revalidateSeconds != null
        ? { next: { revalidate: opts.revalidateSeconds } }
        : { cache: "no-store" as const }),
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
    // 성공 코드(00 / INFO-000 / NORMAL SERVICE.)를 오류로 뒤집지 않도록 반드시
    // isSuccessCode 로만 판정한다. XML 자체는 파싱하지 않으므로 아래 안내로 떨어진다.
    if (code && !isSuccessCode(code)) {
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
  const resultMsg = header?.resultMsg != null ? String(header.resultMsg) : null;
  // 코드와 메시지 어느 쪽이든 성공을 뜻하면 성공이다. 둘 다 성공이 아닐 때만 오류로 본다.
  if (resultCode && !isSuccessCode(resultCode) && !isSuccessCode(resultMsg)) {
    // 코드와 메시지를 모두 넘긴다. 분기는 둘 다 검사하고, 화면 문구는 메시지를
    // 우선하되 메시지가 비어 있으면 코드로 폴백한다.
    const mapped = mapErrorCode(resultCode, resultMsg);
    return { ...emptyResult(mapped.status, mapped.message, mapped.hint), code: resultCode, httpCode, elapsedMs, maskedUrl };
  }

  const rows = normalizeRows(body?.items);
  const totalCount = toNumber(body?.totalCount);
  const pageNo = toNumber(body?.pageNo);

  // 행이 없어도 전체 건수가 있고 2페이지 이상이면 "결과 없음"이 아니라
  // "마지막 페이지를 넘겼음"이다. 이를 구분하지 않으면 표와 페이지 이동이 함께
  // 사라져 돌아갈 링크조차 없는 막다른 길이 된다.
  //
  // 1페이지는 제외한다. API 가 검색 필터를 무시하고 totalCount 만 전체 건수로
  // 돌려주면, 무결과 검색이 빈 페이지로 오인되어 "검색 결과 없음" 안내가 사라진다.
  const requestedPage = opts.pageNo ?? 1;
  const isEmptyPage =
    rows.length === 0 && totalCount != null && totalCount > 0 && requestedPage > 1;

  const status: KraStatus =
    rows.length === 0 ? (isEmptyPage ? "empty_page" : "no_data") : "ok";

  return {
    status,
    message:
      status === "empty_page"
        ? "이 페이지에는 행이 없습니다. 이전 페이지로 돌아가세요."
        : status === "no_data"
          ? "조건에 맞는 데이터가 없습니다."
          : "정상",
    httpCode,
    elapsedMs,
    totalCount,
    pageNo,
    numOfRows: toNumber(body?.numOfRows),
    rows,
    maskedUrl,
  };
}

/**
 * 디스크 캐시를 경유해 호출한다.
 *
 * 같은 질의를 반복해도 TTL 안에서는 API 를 부르지 않는다. 캐시를 못 읽거나
 * 못 쓰면 그냥 API 를 부르므로, 캐시 실패가 기능 실패로 번지지 않는다.
 */
export async function cachedCall(
  datasetId: string,
  opts: CallOptions,
  cacheKey: string,
  ttlMs: number,
  options: { fresh?: boolean } = {},
): Promise<KraResult> {
  if (!options.fresh) {
    const cached = await readCache(cacheKey);
    if (cached.rows) {
      return {
        status: cached.rows.length === 0 ? "no_data" : "ok",
        message: "캐시에서 읽음",
        httpCode: null,
        elapsedMs: 0,
        totalCount: cached.rows.length,
        pageNo: null,
        numOfRows: null,
        rows: cached.rows,
        maskedUrl: "",
        fromCache: true,
        cacheAgeMs: cached.ageMs,
      };
    }
  }

  const result = await callKra(datasetId, opts);
  // 정상 응답만 캐시한다. 오류를 캐시하면 TTL 동안 복구가 막힌다.
  if (result.status === "ok") await writeCache(cacheKey, result.rows, ttlMs);
  return { ...result, fromCache: false, cacheAgeMs: null };
}

/**
 * 진단용 — 데이터셋 하나를 1건만 조회해서 연결 상태를 본다.
 *
 * 9개 데이터셋을 한 화면에서 모두 확인하므로 방문 1회당 호출 9회가 나간다.
 * 일일 한도를 태우지 않도록, 실시간이 필요 없는 화면은 revalidateSeconds 를 준다.
 */
export async function probeDataset(
  dataset: KraDataset,
  revalidateSeconds?: number,
): Promise<KraResult> {
  return callDataset(dataset, { numOfRows: 1, revalidateSeconds });
}

/**
 * 디스크 캐시를 경유한 진단 프로브.
 *
 * 홈과 진단 화면이 각각 9개 데이터셋을 확인하므로 방문마다 9콜이 나가던 것을
 * TTL 안에서는 0콜로 줄인다. 응답이 없는 데이터셋(제공측 이슈)도 있어서
 * 타임아웃을 짧게 두고, 그 결과는 캐시하지 않아 복구를 막지 않는다.
 */
export async function cachedProbe(dataset: KraDataset, fresh = false): Promise<KraResult> {
  return cachedCall(
    dataset.id,
    { numOfRows: 1, timeoutMs: 8_000 },
    `probe-${dataset.id}`,
    TTL.probe,
    { fresh },
  );
}
