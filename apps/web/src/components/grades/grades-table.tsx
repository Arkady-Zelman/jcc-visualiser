"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface GradesTableRow {
  id: string;
  display_name: string;
  origin_country: string;
  region: string;
  type: string;
  api_gravity: number | null;
  sulphur_pct: number | null;
  primary_benchmark: string | null;
  first_seen_in_jcc: string | null;
  last_seen_in_jcc: string | null;
  latest_share_pct: number | null;
  latest_volume_kl: number | null;
  is_synthetic: boolean;
}

type SortKey =
  | "display_name"
  | "origin_country"
  | "region"
  | "type"
  | "api_gravity"
  | "sulphur_pct"
  | "first_seen_in_jcc"
  | "last_seen_in_jcc"
  | "latest_share_pct";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "display_name", label: "Grade" },
  { key: "origin_country", label: "Origin" },
  { key: "region", label: "Region" },
  { key: "type", label: "Type" },
  { key: "api_gravity", label: "API", align: "right" },
  { key: "sulphur_pct", label: "S %", align: "right" },
  { key: "first_seen_in_jcc", label: "First seen" },
  { key: "last_seen_in_jcc", label: "Last seen" },
  { key: "latest_share_pct", label: "Latest %", align: "right" },
];

function cmp<T>(a: T, b: T): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function GradesTable({ rows }: { rows: GradesTableRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("latest_share_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => cmp(a[sortKey], b[sortKey]));
    if (sortDir === "desc") out.reverse();
    return out;
  }, [rows, sortKey, sortDir]);

  const flip = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "latest_share_pct" ? "desc" : "asc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead
                key={c.key}
                className={cn("cursor-pointer select-none", c.align === "right" && "text-right")}
                onClick={() => flip(c.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {sortKey === c.key ? (
                    sortDir === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )
                  ) : (
                    <ArrowUpDown className="size-3 opacity-30" />
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow
              key={r.id}
              className={cn(
                "cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60",
                r.is_synthetic && "text-zinc-500 dark:text-zinc-400",
              )}
            >
              <TableCell>
                <Link href={`/grades/${encodeURIComponent(r.id)}`} className="block">
                  <span className="font-medium text-zinc-950 dark:text-zinc-50">
                    {r.display_name}
                  </span>
                  {r.is_synthetic && (
                    <Badge
                      variant="outline"
                      className="ml-2 align-middle text-[10px] uppercase tracking-wide"
                    >
                      bucket
                    </Badge>
                  )}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs">{r.origin_country}</TableCell>
              <TableCell className="text-xs">{r.region.replace("_", " ")}</TableCell>
              <TableCell className="text-xs">{r.type.replace("_", " ")}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.api_gravity != null ? r.api_gravity.toFixed(1) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.sulphur_pct != null ? r.sulphur_pct.toFixed(2) : "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.first_seen_in_jcc?.slice(0, 7) ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.last_seen_in_jcc?.slice(0, 7) ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.latest_share_pct != null
                  ? `${r.latest_share_pct.toFixed(2)}%`
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
