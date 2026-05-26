"""Shared helpers for ingest jobs.

The five required behaviours from BUILD_SPEC.md §7.2 are implemented here:

  1. Idempotent UPSERT       — `upsert(client, table, rows, conflict_cols)`.
  2. Pydantic validation     — `validate(model, rows)` returns (valid, invalid).
  3. Polite retry            — `retry_get(url, **kw)` (tenacity-wrapped httpx).
  4. Audit                   — `audit_run(kind)` context manager writes a `compute_runs` row.
  5. Advisory locking        — `advisory_lock(name)` via psycopg + pg_try_advisory_lock.

Plus `init_sentry()` for unhandled-error reporting (filters out per-row Pydantic
ValidationErrors which we log to `compute_runs.output_jsonb` instead).

Env loading order: apps/ingest/.env → project-root .env (first wins per python-dotenv default).
"""

from __future__ import annotations

import contextlib
import logging
import os
import re
import time
import uuid
from collections.abc import Callable, Generator, Iterable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError
from supabase import Client, create_client
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

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


def stopwatch() -> tuple[float, Callable[[], float]]:
    """Return (start_time, elapsed_seconds_fn). For ad-hoc timing inside jobs."""
    start = time.monotonic()

    def elapsed() -> float:
        return round(time.monotonic() - start, 3)

    return start, elapsed


# =========================================================
# Polite-retry HTTP
# =========================================================

# 5xx and 429 are transient. Anything else we let fail fast.
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


class _RetryableHttpError(Exception):
    """Raised when an HTTP response is in `_RETRYABLE_STATUSES`. Internal to retry_get."""


@retry(
    retry=retry_if_exception_type((httpx.TransportError, _RetryableHttpError)),
    wait=wait_exponential_jitter(initial=1, max=30, jitter=1),
    stop=stop_after_attempt(5),
    reraise=True,
)
def retry_get(url: str, **kwargs: Any) -> httpx.Response:
    """Polite GET: 5 attempts, exponential backoff + jitter, retries 429/5xx + transport errors.

    `kwargs` are forwarded to `httpx.get`. Default timeout is 30s if not supplied.
    Non-retryable HTTP errors (4xx other than 429) raise on the *first* call via
    `raise_for_status()`. Use this for any external HTTP fetch.
    """
    kwargs.setdefault("timeout", 30.0)
    resp = httpx.get(url, **kwargs)
    if resp.status_code in _RETRYABLE_STATUSES:
        raise _RetryableHttpError(f"{resp.status_code} from {url}")
    resp.raise_for_status()
    return resp


# =========================================================
# Sentry init — uncaught-error reporting
# =========================================================


def init_sentry() -> bool:
    """Initialise Sentry once at process startup. Idempotent.

    Returns True if Sentry was actually initialised (DSN present + SDK installed),
    False otherwise. Safe to call from every job's main() without checking.

    Filters per-row `pydantic.ValidationError` out of Sentry — those land in
    `compute_runs.output_jsonb` already. Sentry only sees uncaught errors:
    network timeouts, rate-limit overruns, schema drifts in source feeds, etc.
    """
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        return False

    def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
        exc = hint.get("exc_info", (None, None, None))[1]
        if isinstance(exc, ValidationError):
            return None
        return event

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("VERCEL_ENV") or os.getenv("ENV") or "development",
        release=os.getenv("RELEASE") or "jcc-ingest@0.0.0",
        traces_sample_rate=0.5,
        integrations=[LoggingIntegration(level=logging.INFO, event_level=logging.ERROR)],
        before_send=_before_send,
    )
    return True


# =========================================================
# Postgres advisory lock — prevents overlapping runs
# =========================================================

_POOLER_REGIONS = (
    "eu-west-2",
    "eu-west-1",
    "eu-central-1",
    "us-east-1",
    "us-west-1",
    "ap-northeast-1",
    "ap-southeast-1",
)


def _project_ref(supabase_url: str) -> str:
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", supabase_url)
    if not m:
        raise RuntimeError(f"Cannot extract project ref from SUPABASE_URL={supabase_url!r}")
    return m.group(1)


def _pg_connect():
    """Open a psycopg connection to the Supabase pooler, sweeping known regions.

    Returns the live `psycopg.Connection` on success; raises on total failure.
    """
    import psycopg  # local import — psycopg is in dev deps, not core deps

    load_env()
    url = os.getenv("SUPABASE_URL")
    password = os.getenv("SUPABASE_PASSWORD")
    if not url or not password:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_PASSWORD must be set in .env for advisory_lock"
        )
    ref = _project_ref(url)

    last_exc: Exception | None = None
    for region in _POOLER_REGIONS:
        dsn = (
            f"postgresql://postgres.{ref}:{password}"
            f"@aws-0-{region}.pooler.supabase.com:6543/postgres"
        )
        try:
            return psycopg.connect(dsn, connect_timeout=8)
        except (psycopg.OperationalError, psycopg.errors.ConnectionFailure) as exc:
            last_exc = exc

    raise RuntimeError(
        f"Could not connect to any Supabase pooler region. Last error: {last_exc}"
    )


@contextlib.contextmanager
def advisory_lock(name: str, *, required: bool = False) -> Generator[bool, None, None]:
    """Acquire a Postgres advisory lock for the duration of the block.

    Yields True if the lock was acquired, False if it was already held by another run.
    On False the caller should log + exit cleanly (this is normal during long backfills).

    The lock name is hashed to a bigint via `hashtext()` so a single name can refer
    to a logical job (e.g. "ingest_paj") without collision-avoidance bookkeeping.

    `required=True` raises if the lock cannot be acquired (use this when overlapping
    runs would actually corrupt state — none of our v1 jobs need that, but the option
    is there).

    If psycopg isn't installed or SUPABASE_PASSWORD isn't set, falls back to a no-op
    that yields True. We log a warning so the operator can spot it.
    """
    try:
        conn = _pg_connect()
    except Exception as exc:  # noqa: BLE001
        logging.warning("advisory_lock(%s): falling back to no-op — %s", name, exc)
        yield True
        return

    acquired = False
    try:
        with conn.cursor() as cur:
            cur.execute("select pg_try_advisory_lock(hashtext(%s))", (name,))
            row = cur.fetchone()
            acquired = bool(row and row[0])
        conn.commit()

        if not acquired and required:
            raise RuntimeError(f"advisory_lock({name!r}) — already held; aborting (required=True)")

        yield acquired
    finally:
        if acquired:
            try:
                with conn.cursor() as cur:
                    cur.execute("select pg_advisory_unlock(hashtext(%s))", (name,))
                conn.commit()
            except Exception as exc:  # noqa: BLE001
                logging.warning("advisory_lock(%s) unlock failed: %s", name, exc)
        conn.close()
