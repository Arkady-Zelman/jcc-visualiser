/**
 * Browser-side Supabase client.
 *
 * v1 doesn't actually need this — all page reads happen server-side. Kept as a
 * stub so future client-side data fetching (e.g. a `useEffect`-driven panel)
 * has a canonical entry point.
 */

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/db";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
