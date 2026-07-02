"""Apply a SQL migration file directly to Supabase Postgres via psycopg.

Usage:
    python -m ingest.apply_migration supabase/migrations/001_init.sql

Connection: tries the Supabase shared pooler first (works on the free tier and from
IPv4-only networks); falls back to the direct DB host. Reads SUPABASE_URL and
SUPABASE_PASSWORD from .env.

If both connection attempts fail, paste the SQL file's contents into the Supabase
dashboard SQL editor manually.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import psycopg

from ingest.common import load_env

POOLER_REGIONS = (
    "eu-west-2",
    "eu-west-1",
    "us-east-1",
    "us-west-1",
    "ap-northeast-1",
    "ap-southeast-1",
)


def project_ref(supabase_url: str) -> str:
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", supabase_url)
    if not m:
        raise RuntimeError(f"Cannot extract project ref from SUPABASE_URL={supabase_url!r}")
    return m.group(1)


def candidate_dsns(ref: str, password: str) -> list[tuple[str, str]]:
    """Return [(label, dsn)] in order of preference: pooler regions then direct host."""
    out: list[tuple[str, str]] = []
    for region in POOLER_REGIONS:
        # Supabase has migrated projects from aws-0-* to aws-1-* pooler hosts; sweep both.
        for cluster in ("aws-1", "aws-0"):
            out.append(
                (
                    f"pooler/{cluster}/{region}",
                    f"postgresql://postgres.{ref}:{password}@{cluster}-{region}.pooler.supabase.com:6543/postgres",
                )
            )
    out.append(("direct", f"postgresql://postgres:{password}@db.{ref}.supabase.co:5432/postgres"))
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m ingest.apply_migration <path-to-sql-file>", file=sys.stderr)
        return 2

    sql_path = Path(sys.argv[1])
    if not sql_path.exists():
        print(f"file not found: {sql_path}", file=sys.stderr)
        return 1

    load_env()
    url = os.getenv("SUPABASE_URL")
    password = os.getenv("SUPABASE_PASSWORD")
    if not url or not password:
        print(
            "FAIL: SUPABASE_URL and SUPABASE_PASSWORD must be set in .env. "
            "SUPABASE_PASSWORD is the database password from Supabase dashboard "
            "→ Settings → Database → Database password.",
            file=sys.stderr,
        )
        return 1

    ref = project_ref(url)
    sql = sql_path.read_text(encoding="utf-8")

    last_error: Exception | None = None
    for label, dsn in candidate_dsns(ref, password):
        try:
            print(f"trying {label} ...", end=" ", flush=True)
            with psycopg.connect(dsn, connect_timeout=8) as conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
                conn.commit()
            print(f"OK\napplied {sql_path} via {label}")
            return 0
        except (psycopg.OperationalError, psycopg.errors.ConnectionFailure) as exc:
            print(f"connect failed: {type(exc).__name__}")
            last_error = exc
        except Exception as exc:  # noqa: BLE001
            # Non-connection failure (e.g. SQL error) — abort, don't retry on a different pool.
            print(f"FAIL\nSQL error: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1

    print(
        f"FAIL: could not connect to any pooler region or direct host. Last error: {last_error}",
        file=sys.stderr,
    )
    print(
        "\nFallback: open Supabase dashboard → SQL Editor → paste the contents of "
        f"{sql_path} → Run.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
