/**
 * Server-side Supabase client.
 *
 * v1 has no auth flow, but Supabase's new publishable (anon) key doesn't grant
 * any read access to user tables without explicit RLS policies. Adding RLS just
 * to enable public reads for a single-operator dashboard is overkill — instead
 * we use the **service-role** key, which only ever runs server-side (never in
 * the browser bundle, never exposed via Network) and reads freely.
 *
 * If/when v1.5 introduces auth and per-user views, switch to the anon key
 * pattern with RLS policies.
 *
 * Cached per request via `react.cache()` so multiple `createClient()` calls
 * inside one render share the same instance.
 */

import { cache } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/db";

export const createClient = cache(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local",
    );
  }
  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
});

/**
 * Paginate a Supabase `select(...)` past the 1000-row PostgREST cap.
 *
 * Usage:
 *   const rows = await fetchAll<CompositionRow>(() =>
 *     supabase.from("composition_monthly").select("...").order("month"),
 *   );
 *
 * Type-erased on the query builder so callers can pass any PostgrestFilterBuilder
 * without fighting Supabase's generic plumbing. The caller specifies the Row type.
 */
export async function fetchAll<Row>(
  buildQuery: () => { range: (from: number, to: number) => unknown },
  chunk = 1000,
): Promise<Row[]> {
  const out: Row[] = [];
  let start = 0;
  while (true) {
    const resp = (await (buildQuery().range(start, start + chunk - 1) as Promise<{
      data: Row[] | null;
      error: { message: string } | null;
    }>)) ?? { data: null, error: null };
    if (resp.error) throw new Error(resp.error.message);
    const rows = resp.data ?? [];
    out.push(...rows);
    if (rows.length < chunk) break;
    start += chunk;
  }
  return out;
}
