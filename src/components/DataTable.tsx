import { fieldLabel, isNumericField } from "@/lib/kra/field-labels";
import type { KraRow } from "@/lib/kra/types";

/**
 * 응답에서 실제로 내려온 필드를 기준으로 컬럼을 만든다.
 *
 * KRA 각 데이터셋의 정확한 필드명을 사전에 확정할 수 없으므로, 레지스트리의
 * preferredColumns 는 "있으면 앞으로 보내라"는 힌트로만 쓴다. 목록에 없는 필드도
 * 그대로 뒤에 붙어 렌더링되므로 데이터가 조용히 가려지는 일이 없다.
 */
function deriveColumns(rows: KraRow[], preferred: string[] = []): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  const front = preferred.filter((k) => seen.has(k));
  const rest = [...seen].filter((k) => !front.includes(k)).sort();
  return [...front, ...rest];
}

function renderCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  const s = String(value).trim();
  return s === "" ? "—" : s;
}

export function DataTable({
  rows,
  preferredColumns,
  caption,
}: {
  rows: KraRow[];
  preferredColumns?: string[];
  caption?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface-muted px-4 py-8 text-center text-sm text-muted">
        표시할 행이 없습니다.
      </p>
    );
  }

  const columns = deriveColumns(rows, preferredColumns);

  return (
    /* 넓은 표는 페이지 전체가 아니라 이 컨테이너 안에서만 가로 스크롤된다. */
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="bg-surface-muted">
            {columns.map((key) => (
              <th
                key={key}
                scope="col"
                className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface-muted px-3 py-2.5 text-left font-medium"
                title={key}
              >
                {fieldLabel(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-muted">
              {columns.map((key) => {
                const value = row[key];
                return (
                  <td
                    key={key}
                    className={`whitespace-nowrap px-3 py-2 ${
                      isNumericField(key, value) ? "text-right" : "text-left"
                    }`}
                  >
                    {renderCell(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
