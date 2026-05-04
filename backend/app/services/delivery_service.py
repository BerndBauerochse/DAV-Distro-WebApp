"""
Delivery service: orchestrates a delivery run for a given portal.
Runs in a background thread, emits WebSocket events, writes to DB.
"""
import uuid
import logging
import configparser
import os
import threading
import time
from datetime import datetime, timezone
from typing import Callable

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
import asyncio

from app.models import DeliveryRun, DeliveryLog
from app.websocket_manager import ws_manager
from app.modules.base import FileTransfer

logger = logging.getLogger(__name__)

# Registry: portal_key -> module class
PORTAL_REGISTRY: dict[str, type] = {}

# In-memory cache: run_id (str) → local metadata file path
# Used by the download endpoint so the user can save the attachment.
_run_metadata_paths: dict[str, str] = {}

# Cancel signals: run_id (str) → threading.Event set when cancel requested
_cancel_events: dict[str, threading.Event] = {}


def get_metadata_path(run_id: str) -> str | None:
    return _run_metadata_paths.get(run_id)


def request_cancel(run_id: str) -> None:
    """Signal a running delivery to stop after the current file."""
    event = _cancel_events.get(str(run_id))
    if event:
        event.set()


def clear_metadata_path(run_id: str) -> None:
    _run_metadata_paths.pop(str(run_id), None)

PORTAL_DISPLAY_NAMES = {
    "audible": "Audible",
    "audible_moa": "Audible MoA",
    "audible_fulfill": "Audible Fulfill",
    "bookwire": "Bookwire",
    "bookwire_moa": "Bookwire MoA",
    "bookbeat": "Bookbeat",
    "spotify": "Spotify",
    "google": "Google",
    "zebra": "Zebra",
    "rtl": "RTL+",
    "divibib": "Divibib",
}


def register_portal(key: str):
    """Decorator to register a portal module class."""
    def decorator(cls):
        PORTAL_REGISTRY[key] = cls
        return cls
    return decorator


def load_config() -> configparser.ConfigParser:
    config = configparser.ConfigParser()
    config_path = os.getenv("CONFIG_PATH", "/app/config/portals.ini")
    config.read(config_path)
    return config


async def start_delivery_run(
    db_session_factory,
    portal_key: str,
    metadata_filename: str | None,
    metadata_path: str | None,
    initiated_by: str | None = None,
    takedown: bool = False,
) -> uuid.UUID:
    """
    Creates a DeliveryRun record and starts the delivery in a background thread.
    Returns the run_id immediately.
    """
    run_id = uuid.uuid4()

    async with db_session_factory() as db:
        run = DeliveryRun(
            id=run_id,
            portal=portal_key,
            metadata_filename=metadata_filename,
            initiated_by=initiated_by,
            takedown=takedown,
            status="running",
        )
        db.add(run)
        await db.commit()

    # Emit run_update: running
    await ws_manager.broadcast({
        "type": "run_update",
        "run_id": str(run_id),
        "portal": portal_key,
        "status": "running",
        "total_files": 0,
        "completed_files": 0,
        "failed_files": 0,
        "skipped_files": 0,
        "initiated_by": initiated_by,
    })

    # Run in background thread so async loop stays free
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        None,
        _run_delivery_sync,
        db_session_factory,
        loop,
        run_id,
        portal_key,
        metadata_path,
        initiated_by,
        takedown,
    )

    return run_id


def _run_delivery_sync(db_session_factory, loop, run_id, portal_key, metadata_path, initiated_by=None, takedown=False):
    """Blocking delivery execution — runs in thread pool."""
    # Cache metadata path so the download endpoint can serve it
    if metadata_path:
        _run_metadata_paths[str(run_id)] = metadata_path

    # Register cancel event for this run
    cancel_event = threading.Event()
    _cancel_events[str(run_id)] = cancel_event

    config = load_config()
    module_cls = PORTAL_REGISTRY.get(portal_key)
    error_message: str | None = None

    if module_cls is None:
        error_message = f"Kein Modul für Portal '{portal_key}' registriert."
        logger.error(error_message)
        _cancel_events.pop(str(run_id), None)
        asyncio.run_coroutine_threadsafe(
            _record_system_error(db_session_factory, run_id, portal_key, error_message), loop
        ).result()
        asyncio.run_coroutine_threadsafe(
            _finalize_run(db_session_factory, run_id, portal_key, "failed",
                          error_message=error_message, initiated_by=initiated_by), loop
        ).result()
        return

    module = module_cls(config, portal_key)
    log_records: list[dict] = []
    completed = failed = skipped = 0
    total = 0

    try:
        transfers = module.get_files(str(run_id), metadata_path)
        if takedown:
            transfers = [t for t in transfers if t.file_type == "metadata"]
        total = len(transfers)

        if total == 0:
            raise RuntimeError(
                "Keine Dateien gefunden. Bitte XML-Datei und Quellverzeichnis prüfen."
            )

        # Log injected files (TOCs, PDFs) immediately so they appear in history
        # even if the upload later fails.
        now = datetime.now(timezone.utc)
        injection_logs = [
            {
                "run_id": run_id,
                "portal": portal_key,
                "ean": t.ean,
                "file_type": inj_type,
                "file_name": inj_name,
                "status": "success",
                "finished_at": now,
            }
            for t in transfers
            for (inj_name, inj_type) in t.injected_files
        ]
        if injection_logs:
            asyncio.run_coroutine_threadsafe(
                _insert_logs(db_session_factory, injection_logs), loop
            ).result()

        # Update total_files
        asyncio.run_coroutine_threadsafe(
            _update_run_counts(db_session_factory, run_id, total, 0, 0, 0), loop
        ).result()

        # Blocking — frontend must know total_files BEFORE any progress events arrive
        asyncio.run_coroutine_threadsafe(
            ws_manager.broadcast({
                "type": "run_update",
                "run_id": str(run_id),
                "portal": portal_key,
                "status": "running",
                "total_files": total,
                "completed_files": 0,
                "failed_files": 0,
                "skipped_files": 0,
                "initiated_by": initiated_by,
            }),
            loop,
        ).result()

        # Track which files have been started by progress_cb (to detect unprocessed ones)
        processed_file_names: set[str] = set()
        # Throttle: file_name -> monotonic timestamp of last "uploading" broadcast
        _last_ws_time: dict[str, float] = {}

        def progress_cb(run_id, ean, file_name, file_type, current, total_bytes, status, error=None):
            nonlocal completed, failed, skipped
            # Cancel check — raises InterruptedError to abort ship()
            if cancel_event.is_set():
                raise InterruptedError("Auslieferung wurde abgebrochen")

            if status in ("success", "failed", "skipped"):
                processed_file_names.add(file_name)
            if status == "success":
                completed += 1
            elif status == "failed":
                failed += 1
            elif status == "skipped":
                skipped += 1

            # Only record terminal statuses — "uploading" ticks are transient,
            # never displayed in History, and would bloat log_records to tens of
            # thousands of rows per file (one per SFTP chunk), causing a massive
            # DB flush that blocks the event loop and delays the final WS message.
            if status in ("success", "failed", "skipped"):
                log_records.append({
                    "run_id": uuid.UUID(run_id),
                    "portal": portal_key,
                    "ean": ean,
                    "file_type": file_type,
                    "file_name": file_name,
                    "status": status,
                    "error_log": error,
                    "finished_at": datetime.now(timezone.utc),
                })

            # Throttle "uploading" WS broadcasts to max 1 per second per file.
            # Terminal statuses (success/failed/skipped) are always sent.
            if status == "uploading":
                now_t = time.monotonic()
                if now_t - _last_ws_time.get(file_name, 0) < 1.0:
                    return  # skip this broadcast, counters already updated above
                _last_ws_time[file_name] = now_t

            asyncio.run_coroutine_threadsafe(
                ws_manager.broadcast({
                    "type": "progress",
                    "run_id": run_id,
                    "portal": portal_key,
                    "ean": ean,
                    "file_name": file_name,
                    "file_type": file_type,
                    "current_bytes": current,
                    "total_bytes": total_bytes,
                    "status": status,
                    "error": error,
                }),
                loop,
            )

        module.ship(str(run_id), transfers, progress_cb)

        # Flush remaining log records
        if log_records:
            asyncio.run_coroutine_threadsafe(
                _insert_logs(db_session_factory, log_records), loop
            ).result()
            log_records.clear()

        # Insert skipped entries for files that were never processed
        now = datetime.now(timezone.utc)
        for t in transfers:
            if t.file_name not in processed_file_names:
                skipped += 1
                log_records.append({
                    "run_id": run_id, "portal": portal_key, "ean": t.ean,
                    "file_type": t.file_type, "file_name": t.file_name,
                    "status": "skipped", "finished_at": now,
                })
        if log_records:
            asyncio.run_coroutine_threadsafe(
                _insert_logs(db_session_factory, log_records), loop
            ).result()
            log_records.clear()

        # If cancel was signalled but absorbed by parallel workers, honour it here
        if cancel_event.is_set():
            final_status = "cancelled"
        else:
            final_status = "failed" if failed == total and total > 0 else "completed"

    except InterruptedError as e:
        error_message = str(e)
        logger.info(f"Delivery run {run_id} cancelled by user")
        final_status = "cancelled"
        # Flush any partial log records
        if log_records:
            asyncio.run_coroutine_threadsafe(
                _insert_logs(db_session_factory, log_records), loop
            ).result()
            log_records.clear()
        # Insert skipped entries for files that were never processed
        now = datetime.now(timezone.utc)
        for t in transfers:
            if t.file_name not in processed_file_names:
                skipped += 1
                log_records.append({
                    "run_id": run_id, "portal": portal_key, "ean": t.ean,
                    "file_type": t.file_type, "file_name": t.file_name,
                    "status": "skipped", "finished_at": now,
                })
        if log_records:
            asyncio.run_coroutine_threadsafe(
                _insert_logs(db_session_factory, log_records), loop
            ).result()
            log_records.clear()

    except Exception as e:
        error_message = str(e)
        logger.exception(f"Delivery run {run_id} crashed: {e}")
        final_status = "failed"

        # Flush any accumulated log records first
        if log_records:
            asyncio.run_coroutine_threadsafe(
                _insert_logs(db_session_factory, log_records), loop
            ).result()
            log_records.clear()

        # Store error as a system log entry so it's visible in the History
        asyncio.run_coroutine_threadsafe(
            _record_system_error(db_session_factory, run_id, portal_key, error_message), loop
        ).result()

    finally:
        _cancel_events.pop(str(run_id), None)
        if final_status != "completed":
            clear_metadata_path(run_id)

    # Collect mail draft if module supports it (only on success)
    mail_draft = None
    if final_status == "completed":
        try:
            mail_draft = module.get_mail_draft(user=initiated_by)
        except Exception:
            pass

    # Inject attachment info if the module requested it and metadata is available
    if mail_draft and mail_draft.pop("has_attachment", False) and metadata_path:
        mail_draft["attachment"] = {
            "filename": os.path.basename(metadata_path),
            "download_url": f"/api/runs/{run_id}/metadata/download",
        }

    asyncio.run_coroutine_threadsafe(
        _finalize_run(db_session_factory, run_id, portal_key, final_status,
                      total, completed, failed, skipped, error_message, mail_draft,
                      initiated_by=initiated_by),
        loop,
    ).result()



async def _record_system_error(db_session_factory, run_id, portal_key, error_message: str):
    """Creates a special log entry to surface run-level errors in the History view."""
    await _insert_logs(db_session_factory, [{
        "run_id": run_id,
        "portal": portal_key,
        "ean": None,
        "file_type": "system",
        "file_name": "Systemfehler",
        "source_path": None,
        "destination": None,
        "file_size_bytes": None,
        "status": "failed",
        "error_log": error_message,
        "finished_at": datetime.now(timezone.utc),
    }])


async def _insert_logs(db_session_factory, records: list[dict]):
    if not records:
        return
    async with db_session_factory() as db:
        for r in records:
            log = DeliveryLog(**r)
            db.add(log)
        await db.commit()


async def _update_run_counts(db_session_factory, run_id, total, completed, failed, skipped):
    async with db_session_factory() as db:
        await db.execute(
            update(DeliveryRun)
            .where(DeliveryRun.id == run_id)
            .values(
                total_files=total,
                completed_files=completed,
                failed_files=failed,
                skipped_files=skipped,
            )
        )
        await db.commit()


async def _finalize_run(
    db_session_factory, run_id, portal_key, status,
    total=0, completed=0, failed=0, skipped=0, error_message=None, mail_draft=None,
    initiated_by=None,
):
    async with db_session_factory() as db:
        await db.execute(
            update(DeliveryRun)
            .where(DeliveryRun.id == run_id)
            .values(
                status=status,
                finished_at=datetime.now(timezone.utc),
                total_files=total,
                completed_files=completed,
                failed_files=failed,
                skipped_files=skipped,
                mail_draft=mail_draft,
            )
        )
        await db.commit()

    msg = {
        "type": "run_update",
        "run_id": str(run_id),
        "portal": portal_key,
        "status": status,
        "total_files": total,
        "completed_files": completed,
        "failed_files": failed,
        "skipped_files": skipped,
        "initiated_by": initiated_by,
    }
    if error_message:
        msg["error"] = error_message
    if mail_draft:
        msg["mail_draft"] = mail_draft

    await ws_manager.broadcast(msg)
