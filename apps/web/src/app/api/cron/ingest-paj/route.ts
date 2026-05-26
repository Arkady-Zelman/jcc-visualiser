import { verifyCronSecret } from "../_shared/auth";

/**
 * Acknowledge-only cron route. The actual PAJ ingest runs on GitHub Actions
 * (`.github/workflows/ingest.yml`). This route exists to satisfy `vercel.json`
 * cron wiring and to give us a future hook for surfacing ingest health.
 */
export async function GET(req: Request): Promise<Response> {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;
  return Response.json({
    status: "acknowledged",
    job: "ingest_paj",
    executed_by: "github-actions",
    note: "See .github/workflows/ingest.yml for the actual schedule and runner.",
  });
}
