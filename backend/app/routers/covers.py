"""Cover-Austausch: ausgewählte Cover an die Cover_Austausch-Ordner
ausgewählter Portale (SFTP) hochladen."""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import get_current_user
from app.services.delivery_service import (
    PORTAL_REGISTRY, PORTAL_DISPLAY_NAMES, load_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/covers", tags=["covers"])

COVERS_DIR = os.path.join(os.getenv("STORAGE_DIR", "/storage"), "covers")

# Liefer-Varianten, die KEINE eigenen Cover-Austausch-Ziele sind
_VARIANT_SUFFIXES = ("_moa", "_fulfill", "_corr")


class ExchangeRequest(BaseModel):
    portals: list[str]
    filenames: list[str]


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


@router.get("/exchange/portals")
async def list_exchange_portals(_user: str = Depends(get_current_user)):
    return [
        {"key": k, "name": PORTAL_DISPLAY_NAMES.get(k, k)}
        for k in _capable_modules()
    ]


@router.post("/exchange")
async def exchange_covers(req: ExchangeRequest, _user: str = Depends(get_current_user)):
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
    results: list[dict] = []

    for key in req.portals:
        module = capable.get(key)
        if not module:
            results.append({
                "portal": key, "filename": None, "status": "failed",
                "error": "Kanal unterstützt keinen Cover-Austausch",
            })
            continue
        try:
            res = await run_in_threadpool(module.exchange_covers, paths)
            for fname, status, error in res:
                results.append({"portal": key, "filename": fname, "status": status, "error": error})
        except Exception as e:
            logger.exception("Cover-Austausch für %s fehlgeschlagen", key)
            results.append({"portal": key, "filename": None, "status": "failed", "error": str(e)})

    return {"results": results}
