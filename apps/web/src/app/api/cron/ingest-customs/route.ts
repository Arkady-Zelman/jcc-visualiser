import { verifyCronSecret } from "../_shared/auth";

export async function GET(req: Request): Promise<Response> {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;
  return Response.json({
    status: "acknowledged",
    job: "ingest_customs",
    executed_by: "github-actions",
    note: "See .github/workflows/ingest.yml for the actual schedule and runner.",
  });
}
