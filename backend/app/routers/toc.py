"""TOC-Update: ausgewählte TOC-Dateien in die jeweiligen /{ISBN}_corr/-Ordner
auf dem Audible-SFTP laden, in der Historie protokollieren und eine
Update-Mail (analog Metadaten-Update) erzeugen."""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import get_current_user
from app.routers.covers import _titles_for, record_exchange_run
from app.services.delivery_service import PORTAL_REGISTRY, load_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/toc", tags=["toc"])

TOC_DIR = os.path.join(os.getenv("STORAGE_DIR", "/storage"), "toc")


class TocUpdateRequest(BaseModel):
    filenames: list[str]


@router.post("/update")
async def toc_update(req: TocUpdateRequest, user: str = Depends(get_current_user)):
    if not req.filenames:
        raise HTTPException(status_code=400, detail="Keine TOC-Dateien ausgewählt.")

    # Dateinamen validieren (kein Path-Traversal) und Pfade sammeln
    paths: list[str] = []
    for fn in req.filenames:
        safe = os.path.basename(fn)
        if safe != fn or not safe:
            raise HTTPException(status_code=400, detail=f"Ungültiger Dateiname: {fn}")
        p = os.path.join(TOC_DIR, safe)
        if not os.path.isfile(p):
            raise HTTPException(status_code=404, detail=f"TOC-Datei nicht gefunden: {safe}")
        paths.append(p)

    config = load_config()
    module = PORTAL_REGISTRY["audible"](config, "audible")

    res = await run_in_threadpool(module.upload_toc_files_to_corr, paths)

    ok = [(fname, ean) for fname, ean, status, _ in res if status == "success" and ean]
    titles = await _titles_for([ean for _, ean in ok])
    mail = module.build_toc_update_mail(ok, titles) if ok else None

    await record_exchange_run("audible", user, res, mail, file_type="toc")

    return {"results": [
        {"filename": fname, "ean": ean, "status": status, "error": error}
        for fname, ean, status, error in res
    ]}
