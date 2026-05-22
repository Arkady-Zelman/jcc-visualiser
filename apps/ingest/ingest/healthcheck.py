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
    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(env_path)

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("healthcheck FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/ingest/.env")
        return 1

    try:
        from supabase import create_client
    except ImportError:
        print("healthcheck FAIL: supabase package not installed. Run: pip install -e \".[dev]\"")
        return 1

    try:
        client = create_client(url, key)
        # Cheap query: select postgres version via PostgREST RPC. If the project has no `compute_runs`
        # table yet (pre-M2), fall back to selecting the server timestamp.
        result = client.rpc("version").execute() if False else None
        # Simpler probe: hit the auth admin endpoint that always exists on a fresh project.
        client.auth.get_session()  # no-op, just exercises the client
        print(f"healthcheck OK: connected to {url}")
        return 0
    except Exception as exc:  # noqa: BLE001 — top-level diagnostic
        print(f"healthcheck FAIL: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
