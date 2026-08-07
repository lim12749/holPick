import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { callKra } from "@/lib/kra/client";
import {
  formatBirthday,
  formatPrize,
  formatRate,
  parseHorse,
  type Record0Stats,
} from "@/lib/kra/horse";

export const dynamic = "force-dynamic";

function StatBlock({ title, stats }: { title: string; stats: Record0Stats }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">출주</dt>
          <dd className="mt-0.5 text-lg font-semibold">{stats.starts}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">1착 / 2착 / 3착</dt>
          <dd className="mt-0.5 text-lg font-semibold">
            {stats.first} / {stats.second} / {stats.third}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">승률</dt>
          <dd className="mt-0.5 text-lg font-semibold">{formatRate(stats.winRate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">복승률 / 연승률</dt>
          <dd className="mt-0.5 text-lg font-semibold">
            {formatRate(stats.quinellaRate)} / {formatRate(stats.showRate)}
          </dd>
        </div>
      </dl>
      {stats.starts === 0 && (
        <p className="mt-3 text-xs text-muted">
          출주 기록이 없어 승률을 계산할 수 없습니다. 데뷔 전 마필입니다.
        </p>
      )}
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

export default async function HorseDetailPage({ params }: { params: Promise<{ hrNo: string }> }) {
  const { hrNo } = await params;

  const result = await callKra("horse-detail", {
    numOfRows: 10,
    extra: { hr_no: hrNo },
  });

  if (result.status !== "ok") {
    return (
      <>
        <PageHeader title="경주마 상세" />
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="font-medium">{result.message}</p>
          {result.hint && <p className="mt-2 text-sm text-muted">{result.hint}</p>}
          <Link href="/horses" className="mt-4 inline-block text-sm text-accent hover:underline">
            ← 경주마 목록
          </Link>
        </div>
      </>
    );
  }

  // hr_no 필터가 적용되지 않는 경우를 대비해 응답 안에서 한 번 더 골라낸다.
  const row = result.rows.find((r) => String(r.hrNo ?? "").trim() === hrNo) ?? result.rows[0];
  if (!row) notFound();

  const horse = parseHorse(row);

  return (
    <>
      <PageHeader
        title={horse.hrName}
        description={`${horse.meet} · ${horse.rank} · 마번 ${horse.hrNo}`}
        actions={
          <Link href="/horses" className="text-sm text-accent hover:underline">
            ← 목록
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium">프로필</h2>
          <dl>
            <ProfileRow label="성별" value={horse.sex} />
            <ProfileRow label="산지" value={horse.origin} />
            <ProfileRow
              label="생년월일"
              value={
                horse.birthday
                  ? `${formatBirthday(horse.birthday)}${horse.age != null ? ` (${horse.age}세)` : ""}`
                  : ""
              }
            />
            <ProfileRow label="조교사" value={horse.trName} />
            <ProfileRow label="마주" value={horse.owName} />
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium">혈통 · 시세</h2>
          <dl>
            <ProfileRow label="부마" value={horse.faHrName} />
            <ProfileRow label="모마" value={horse.moHrName} />
            <ProfileRow label="최근 거래가" value={horse.lastPrice} />
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-medium">지표</h2>
          <dl>
            <ProfileRow
              label="레이팅"
              value={horse.rating > 0 ? String(horse.rating) : ""}
            />
            <ProfileRow label="통산 상금" value={formatPrize(horse.prizeTotal)} />
          </dl>
          {horse.rating === 0 && (
            <p className="mt-3 text-xs text-muted">
              레이팅 0은 아직 산정되지 않았다는 뜻입니다. 예측 지표로 쓸 때 결측으로 처리해야 합니다.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatBlock title="통산 성적" stats={horse.career} />
        <StatBlock title="최근 1년 성적" stats={horse.lastYear} />
      </div>
    </>
  );
}
