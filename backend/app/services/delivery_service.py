"""
Delivery service: orchestrates a delivery run for a given portal.
Runs in a background thread, emits WebSocket events, writes to DB.
"""
import uuid
import logging
import configparser
import os
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
    )

    return run_id


def _run_delivery_sync(db_session_factory, loop, run_id, portal_key, metadata_path):
    """Blocking delivery execution — runs in thread pool."""
    config = load_config()
    module_cls = PORTAL_REGISTRY.get(portal_key)
    error_message: str | None = None

    if module_cls is None:
        error_message = f"Kein Modul für Portal '{portal_key}' registriert."
        logger.error(error_message)
        asyncio.run_coroutine_threadsafe(
            _record_system_error(db_session_factory, run_id, portal_key, error_message), loop
        ).result()
        asyncio.run_coroutine_threadsafe(
            _finalize_run(db_session_factory, run_id, portal_key, "failed",
                          error_message=error_message), loop
        ).result()
        return

    module = module_cls(config, portal_key)
    log_records: list[dict] = []
    completed = failed = skipped = 0
    total = 0

    try:
        transfers = module.get_files(str(run_id), metadata_path)
        total = len(transfers)

        if total == 0:
            raise RuntimeError(
                "Keine Dateien gefunden. Bitte XML-Datei und Quellverzeichnis prüfen."
            )

        # Update total_files
        asyncio.run_coroutine_threadsafe(
            _update_run_counts(db_session_factory, run_id, total, 0, 0, 0), loop
        ).result()

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
            }),
            loop,
        )

        # Build log records with pending status
        for t in transfers:
            log_records.append({
                "run_id": run_id,
                "portal": portal_key,
                "ean": t.ean,
                "file_type": t.file_type,
                "file_name": t.file_name,
                "source_path": t.source_path,
                "destination": t.destination,
                "file_size_bytes": t.file_size_bytes,
                "status": "pending",
            })

        # Insert pending logs
        asyncio.run_coroutine_threadsafe(
            _insert_logs(db_session_factory, log_records), loop
        ).result()
        log_records.clear()

        def progress_cb(run_id, ean, file_name, file_type, current, total_bytes, status, error=None):
            nonlocal completed, failed, skipped
            if status == "success":
                completed += 1
            elif status == "failed":
                failed += 1
            elif status == "skipped":
                skipped += 1

            log_records.append({
                "run_id": uuid.UUID(run_id),
                "portal": portal_key,
                "ean": ean,
                "file_type": file_type,
                "file_name": file_name,
                "status": status,
                "error_log": error,
                "finished_at": datetime.now(timezone.utc) if status in ("success", "failed", "skipped") else None,
            })

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

            if status in ("success", "failed", "skipped"):
                asyncio.run_coroutine_threadsafe(
                    _update_run_counts(
                        db_session_factory, run_id,
                        total, completed, failed, skipped
                    ),
                    loop,
                )

        module.ship(str(run_id), transfers, progress_cb)

        # Flush remaining log records
        if log_records:
            asyncio.run_coroutine_threadsafe(
                _insert_logs(db_session_factory, log_records), loop
            ).result()

        final_status = "failed" if failed == total and total > 0 else "completed"

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

    asyncio.run_coroutine_threadsafe(
        _finalize_run(db_session_factory, run_id, portal_key, final_status,
                      total, completed, failed, skipped, error_message),
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
    total=0, completed=0, failed=0, skipped=0, error_message=None,
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
    }
    if error_message:
        msg["error"] = error_message

    await ws_manager.broadcast(msg)
