"""Cover-Austausch: ausgewählte Cover an die Cover_Austausch-Ordner
ausgewählter Portale (SFTP/FTPS/FTP) hochladen, in der Historie protokollieren
und für Audible/Zebra einen Mail-Entwurf erzeugen."""
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text

from app.auth import get_current_user
from app.database import AsyncSessionLocal
from app.models import DeliveryRun, DeliveryLog
from app.services.delivery_service import (
    PORTAL_REGISTRY, PORTAL_DISPLAY_NAMES, load_config,
)
from app.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/covers", tags=["covers"])

COVERS_DIR = os.path.join(os.getenv("STORAGE_DIR", "/storage"), "covers")

# Liefer-Varianten, die KEINE eigenen Cover-Austausch-Ziele sind
_VARIANT_SUFFIXES = ("_moa", "_fulfill", "_corr")


class ExchangeRequest(BaseModel):
    portals: list[str]
    filenames: list[str]


def _ean_of(filename: str) -> str:
    return os.path.splitext(os.path.basename(filename))[0]


def _capable_modules() -> dict:
    """Instanziiert die Portal-Module und liefert die, die Cover-Austausch können."""
    config = load_config()
    out: dict = {}
    for key, cls in PORTAL_REGISTRY.items():
        if key.endswith(_VARIANT_SUFFIXES):
            continue
        try:
            module = cls(config, key)
            if module.supports_cover_exchange():
                out[key] = module
        except Exception as e:
            logger.warning("Cover-Austausch: Modul %s nicht ladbar: %s", key, e)
    return out


async def _titles_for(eans: list[str]) -> dict[str, str]:
    if not eans:
        return {}
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            text("SELECT ean, titel FROM title_catalog WHERE ean = ANY(:eans)"),
            {"eans": eans},
        )
        return {row.ean: row.titel for row in res}


def _audible_mail(module, ean: str, title: str, user: str | None) -> dict:
    return {
        "to": "eu-delivery@audible.de; kurzke@audible.de",
        "subject": f"[change request] IMAGE UPDATE - {title or ean} - {ean}",
        "body": (
            f"{ean} | {title or ean}\n\n"
            f"Please replace the image for this audiobook with the new image on: "
            f"{module.cover_exchange_mail_path.rstrip('/')}/{ean}.jpg"
        ),
        "is_html": False,
    }


def _zebra_mail(module, filenames: list[str], user: str | None) -> dict:
    name = user.capitalize() if user else "Bernd"
    cover_dir = (module.cover_exchange_dir or "/").rstrip("/") or "/"
    sftp_url = f"sftp://{module.username}@{module.host}:{module.port}{cover_dir}"
    namen = "\n".join(filenames)
    body = (
        "Lieber Andreas,\n"
        "Hier eine Liste von Covern von denen ich dich bitten möchte sie auszutauschen.\n"
        "Ich habe sie alle bei euch auf dem Server in diesen Ordner abgelegt:\n"
        f"{sftp_url}\n\n"
        f"Name\n{namen}\n\n"
        "Ich danke dir.\n"
        f"Liebe Grüße\n{name}"
    )
    return {
        "to": "content-operations-audiobook@zebralution.com",
        "subject": "Cover Austausch",
        "body": body,
        "is_html": False,
    }


async def record_exchange_run(portal_key: str, user: str | None,
                              entries: list[tuple[str, str | None, str, str | None]],
                              mail_draft: dict | None,
                              file_type: str = "cover") -> None:
    """Legt einen abgeschlossenen Run + Datei-Logs an und broadcastet ihn.
    entries: list[(dateiname, ean, status, fehler)]."""
    run_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    completed = sum(1 for _, _, s, _ in entries if s == "success")
    failed = len(entries) - completed

    async with AsyncSessionLocal() as db:
        db.add(DeliveryRun(
            id=run_id, portal=portal_key, metadata_filename=None,
            initiated_by=user, status="completed",
            total_files=len(entries), completed_files=completed,
            failed_files=failed, skipped_files=0,
            started_at=now, finished_at=now, mail_draft=mail_draft,
        ))
        for fname, ean, status, error in entries:
            db.add(DeliveryLog(
                run_id=run_id, portal=portal_key, ean=ean,
                file_type=file_type, file_name=fname,
                destination=None, status=status, error_log=error, finished_at=now,
            ))
        await db.commit()

    msg = {
        "type": "run_update", "run_id": str(run_id), "portal": portal_key,
        "status": "completed", "total_files": len(entries),
        "completed_files": completed, "failed_files": failed, "skipped_files": 0,
        "initiated_by": user,
    }
    if mail_draft:
        msg["mail_draft"] = mail_draft
    await ws_manager.broadcast(msg)


@router.get("/exchange/portals")
async def list_exchange_portals(_user: str = Depends(get_current_user)):
    return [
        {"key": k, "name": PORTAL_DISPLAY_NAMES.get(k, k)}
        for k in _capable_modules()
    ]


@router.post("/exchange")
async def exchange_covers(req: ExchangeRequest, user: str = Depends(get_current_user)):
    if not req.portals:
        raise HTTPException(status_code=400, detail="Keine Kanäle ausgewählt.")
    if not req.filenames:
        raise HTTPException(status_code=400, detail="Keine Cover ausgewählt.")

    # Dateinamen validieren (kein Path-Traversal) und Pfade sammeln
    paths: list[str] = []
    for fn in req.filenames:
        safe = os.path.basename(fn)
        if safe != fn or not safe:
            raise HTTPException(status_code=400, detail=f"Ungültiger Dateiname: {fn}")
        p = os.path.join(COVERS_DIR, safe)
        if not os.path.isfile(p):
            raise HTTPException(status_code=404, detail=f"Cover nicht gefunden: {safe}")
        paths.append(p)

    capable = _capable_modules()
    eans = [_ean_of(f) for f in req.filenames]
    titles = await _titles_for(eans)
    results: list[dict] = []

    for key in req.portals:
        module = capable.get(key)
        if not module:
            results.append({"portal": key, "filename": None, "status": "failed",
                            "error": "Kanal unterstützt keinen Cover-Austausch"})
            continue
        try:
            res = await run_in_threadpool(module.exchange_covers, paths)
        except Exception as e:
            logger.exception("Cover-Austausch für %s fehlgeschlagen", key)
            results.append({"portal": key, "filename": None, "status": "failed", "error": str(e)})
            continue

        for fname, status, error in res:
            results.append({"portal": key, "filename": fname, "status": status, "error": error})

        ok_files = [fname for fname, status, _ in res if status == "success"]

        # Historie + Mail
        entries = [(fname, _ean_of(fname), status, error) for fname, status, error in res]
        if key == "audible":
            # Pro erfolgreichem Cover ein eigener Run + eigene Mail
            for fname, ean, status, error in entries:
                mail = _audible_mail(module, ean, titles.get(ean, ""), user) if status == "success" else None
                await record_exchange_run(key, user, [(fname, ean, status, error)], mail)
        elif key == "zebra":
            mail = _zebra_mail(module, ok_files, user) if ok_files else None
            await record_exchange_run(key, user, entries, mail)
        else:
            await record_exchange_run(key, user, entries, None)

    return {"results": results}
