/**
 * Verify a Vercel Cron invocation has the right Bearer token.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on every scheduled
 * invocation. Production routes return 401 if the secret is missing or mismatched.
 *
 * In v1 these cron routes are acknowledge-only — the actual Python ingest runs on
 * GitHub Actions (`.github/workflows/ingest.yml`), not on Vercel. The route still
 * exists so we have a place to surface ingest health to the frontend later, and so
 * the `vercel.json` cron schedule is wired to a real handler.
 */

export function verifyCronSecret(req: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
