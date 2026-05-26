"""Shared helpers for ingest jobs.

The five required behaviours from BUILD_SPEC.md §7.2 are implemented here:

  1. Idempotent UPSERT — `upsert(client, table, rows, conflict_cols)`.
  2. Pydantic validation — `validate(model, rows)` returns (valid, invalid).
  3. Polite retry — use `tenacity.retry` decorators in each job's HTTP wrapper.
  4. Audit — `audit_run(kind)` context manager writes a `compute_runs` row.
  5. Locking — `with_lock(name)` is a no-op stub in v1 (single-operator, single-host).
     Tracked as a v2 follow-up; PostgreSQL advisory locks via psycopg are the path.

Env loading order: apps/ingest/.env → project-root .env (first wins per python-dotenv default).
"""

from __future__ import annotations

import contextlib
import os
import time
import uuid
from collections.abc import Callable, Generator, Iterable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypeVar

from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError
from supabase import Client, create_client

T = TypeVar("T", bound=BaseModel)


def load_env() -> None:
    """Load env from apps/ingest/.env then project-root .env (first-set wins)."""
    ingest_env = Path(__file__).resolve().parent.parent / ".env"
    root_env = Path(__file__).resolve().parents[3] / ".env"
    for candidate in (ingest_env, root_env):
        if candidate.exists():
            load_dotenv(candidate, override=False)


def supabase_client() -> Client:
    """Construct a Supabase client using service-role credentials.

    Raises:
        RuntimeError: if env vars are missing.
    """
    load_env()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/ingest/.env "
            "or the project-root .env"
        )
    if "/dashboard/" in url or not url.endswith(".supabase.co"):
        raise RuntimeError(
            f"SUPABASE_URL looks wrong ({url!r}). Use the Project API URL from "
            "Settings → API, e.g. https://<project-ref>.supabase.co"
        )
    return create_client(url, key)


def validate(model: type[T], rows: Iterable[dict[str, Any]]) -> tuple[list[T], list[dict[str, Any]]]:
    """Validate raw rows against a Pydantic model. Return (valid, invalid).

    Invalid entries are returned as `{"row": <original>, "error": <message>}`
    so the caller can log them without aborting the batch.
    """
    valid: list[T] = []
    invalid: list[dict[str, Any]] = []
    for raw in rows:
        try:
            valid.append(model.model_validate(raw))
        except ValidationError as exc:
            invalid.append({"row": raw, "error": str(exc)})
    return valid, invalid


def upsert(
    client: Client,
    table: str,
    rows: Sequence[BaseModel | dict[str, Any]],
    conflict_cols: Sequence[str],
    chunk_size: int = 500,
) -> int:
    """Idempotent batched UPSERT via PostgREST `on_conflict`.

    Args:
        client:        Supabase client.
        table:         Target table name.
        rows:          Either Pydantic models (dumped to dict) or raw dicts.
        conflict_cols: Columns that form the conflict target (primary key).
        chunk_size:    Batch size; PostgREST has a default request-size cap.

    Returns:
        Number of rows written (sum across chunks).
    """
    if not rows:
        return 0
    payload: list[dict[str, Any]] = [
        row.model_dump(mode="json") if isinstance(row, BaseModel) else row for row in rows
    ]
    total = 0
    for start in range(0, len(payload), chunk_size):
        chunk = payload[start : start + chunk_size]
        client.table(table).upsert(chunk, on_conflict=",".join(conflict_cols)).execute()
        total += len(chunk)
    return total


@contextlib.contextmanager
def audit_run(
    client: Client,
    kind: str,
    output_extra: dict[str, Any] | None = None,
) -> Generator[dict[str, Any], None, None]:
    """Bracket a job with a `compute_runs` start + finish row.

    Yields a mutable `state` dict the job can populate before exit:
      - `state["row_count"]` — int, total rows written/processed.
      - `state["output"]`    — dict, free-form structured output (merged with `output_extra`).

    On exception, the row is marked `status='error'` and the exception re-raised
    (the body is left to the caller — we don't swallow).
    """
    run_id = str(uuid.uuid4())
    started = datetime.now(UTC)

    # Begin run
    client.table("compute_runs").insert(
        {
            "id": run_id,
            "kind": kind,
            "status": "running",
            "started_at": started.isoformat(),
        }
    ).execute()

    state: dict[str, Any] = {"row_count": 0, "output": {}}
    try:
        yield state
    except Exception as exc:
        finished = datetime.now(UTC)
        merged_output = {**(output_extra or {}), **state.get("output", {})}
        client.table("compute_runs").update(
            {
                "status": "error",
                "finished_at": finished.isoformat(),
                "duration_seconds": round((finished - started).total_seconds(), 2),
                "row_count": state.get("row_count", 0) or None,
                "error_message": f"{type(exc).__name__}: {exc}"[:2000],
                "output_jsonb": merged_output or None,
            }
        ).eq("id", run_id).execute()
        raise
    else:
        finished = datetime.now(UTC)
        merged_output = {**(output_extra or {}), **state.get("output", {})}
        client.table("compute_runs").update(
            {
                "status": "success",
                "finished_at": finished.isoformat(),
                "duration_seconds": round((finished - started).total_seconds(), 2),
                "row_count": state.get("row_count", 0) or None,
                "output_jsonb": merged_output or None,
            }
        ).eq("id", run_id).execute()


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def stopwatch() -> tuple[float, "Callable[[], float]"]:
    """Return (start_time, elapsed_seconds_fn). For ad-hoc timing inside jobs."""
    start = time.monotonic()

    def elapsed() -> float:
        return round(time.monotonic() - start, 3)

    return start, elapsed
