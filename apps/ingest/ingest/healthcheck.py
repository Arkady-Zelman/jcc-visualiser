"""Verify Supabase connectivity and print server-side metadata.

Run: `python -m ingest.healthcheck` from `apps/ingest/` with the venv active.

Exits 0 on success, 1 on failure. Prints a single line either way.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv


def main() -> int:
    # Search order: apps/ingest/.env (job-specific), then project-root .env (shared).
    ingest_env = Path(__file__).resolve().parent.parent / ".env"
    root_env = Path(__file__).resolve().parents[3] / ".env"
    for candidate in (ingest_env, root_env):
        if candidate.exists():
            load_dotenv(candidate, override=False)

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print(
            "healthcheck FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in "
            "apps/ingest/.env or the project-root .env"
        )
        return 1

    try:
        from supabase import create_client
    except ImportError:
        print("healthcheck FAIL: supabase package not installed. Run: pip install -e \".[dev]\"")
        return 1

    # Sanity-check URL shape — Supabase API URLs are https://<ref>.supabase.co, not the dashboard URL.
    if "/dashboard/" in url or not url.endswith(".supabase.co"):
        print(
            f"healthcheck FAIL: SUPABASE_URL looks wrong ({url!r}). "
            "Use the Project API URL from Settings → API, e.g. https://<project-ref>.supabase.co — "
            "not the dashboard browser URL."
        )
        return 1

    import httpx

    try:
        # Hit PostgREST root via the REST endpoint. Returns the OpenAPI swagger for the schema,
        # which means the URL is valid, the service-role key is accepted, and Postgres is reachable.
        resp = httpx.get(
            f"{url.rstrip('/')}/rest/v1/",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=10.0,
        )
        resp.raise_for_status()
        print(f"healthcheck OK: connected to {url} (PostgREST returned {resp.status_code})")
        return 0
    except httpx.HTTPStatusError as exc:
        print(
            f"healthcheck FAIL: {exc.response.status_code} from {exc.request.url} — "
            f"{exc.response.text[:200]}"
        )
        return 1
    except Exception as exc:  # noqa: BLE001 — top-level diagnostic
        print(f"healthcheck FAIL: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
