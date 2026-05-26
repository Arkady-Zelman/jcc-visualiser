import { GradesTable, type GradesTableRow } from "@/components/grades/grades-table";
import { createClient, fetchAll } from "@/lib/supabase/server";
import type { CompositionRow, GradeRow } from "@/lib/composition";

export const revalidate = 86400;

export default async function GradesPage() {
  const supabase = createClient();

  // Latest month's composition gives us "current share %" per grade.
  const { data: latestMonthResp } = await supabase
    .from("composition_monthly")
    .select("month")
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestMonth = latestMonthResp?.month ?? null;

  const [grades, latestComposition] = await Promise.all([
    fetchAll<GradeRow>(() =>
      supabase
        .from("grades")
        .select("*")
        .order("display_name"),
    ),
    latestMonth
      ? fetchAll<Pick<CompositionRow, "grade_id" | "share_pct" | "volume_kl">>(() =>
          supabase
            .from("composition_monthly")
            .select("grade_id, share_pct, volume_kl")
            .eq("month", latestMonth),
        )
      : Promise.resolve([]),
  ]);

  const shareByGrade = new Map(
    latestComposition.map((r) => [r.grade_id, { share_pct: r.share_pct, volume_kl: r.volume_kl }]),
  );

  const rows: GradesTableRow[] = grades.map((g) => ({
    id: g.id,
    display_name: g.display_name,
    origin_country: g.origin_country,
    region: g.region,
    type: g.type,
    api_gravity: g.api_gravity,
    sulphur_pct: g.sulphur_pct,
    primary_benchmark: g.primary_benchmark,
    first_seen_in_jcc: g.first_seen_in_jcc,
    last_seen_in_jcc: g.last_seen_in_jcc,
    latest_share_pct: shareByGrade.get(g.id)?.share_pct ?? null,
    latest_volume_kl: shareByGrade.get(g.id)?.volume_kl ?? null,
    is_synthetic: g.id.startsWith("unmapped_"),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 space-y-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Grades
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          All grades in the JCC basket
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          {rows.length} grades — {rows.filter((r) => !r.is_synthetic).length} curated
          named grades and {rows.filter((r) => r.is_synthetic).length} synthetic
          <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">unmapped_*</code>
          buckets for origin countries without a curated HS-code mapping.
          {latestMonth && (
            <>
              {" "}Latest share % shown for{" "}
              <span className="font-mono">{latestMonth.slice(0, 7)}</span>.
            </>
          )}
        </p>
      </header>
      <GradesTable rows={rows} />
    </div>
  );
}
