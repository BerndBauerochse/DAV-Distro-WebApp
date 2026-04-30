import io
import os
import uuid
from pathlib import Path
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete as sql_delete

from app.database import get_db, AsyncSessionLocal
from app.models import DeliveryRun, DeliveryLog
from app.schemas import DeliveryRunOut, DeliveryRunDetail, DeliveryLogOut
from app.services.delivery_service import (
    start_delivery_run,
    load_config,
    PORTAL_REGISTRY,
    get_metadata_path,
    request_cancel,
    clear_metadata_path,
)
from app.modules.metadata_parser import parse_metadata
from app.auth import get_current_user

router = APIRouter(prefix="/runs", tags=["runs"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")


def _safe_filename(filename: str) -> str:
    name = Path(filename).name
    if not name or name in {".", ".."} or name != filename:
        raise HTTPException(status_code=400, detail="Ungültiger Dateiname")
    return name


@router.get("", response_model=list[DeliveryRunOut])
async def list_runs(
    portal: str | None = None,
    limit: int = 50,
    offset: int = 0,
    initiated_by: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    q = select(DeliveryRun).order_by(desc(DeliveryRun.started_at)).limit(limit).offset(offset)
    if portal:
        q = q.where(DeliveryRun.portal == portal)
    if initiated_by:
        q = q.where(DeliveryRun.initiated_by == initiated_by)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/export")
async def export_runs(
    format: str = "csv",
    portal: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Export run history as CSV or XLSX."""
    import pandas as pd

    q = select(DeliveryRun).order_by(desc(DeliveryRun.started_at))
    if portal:
        q = q.where(DeliveryRun.portal == portal)
    result = await db.execute(q)
    runs = result.scalars().all()

    rows = []
    for r in runs:
        duration = ""
        if r.finished_at and r.started_at:
            delta = (r.finished_at.replace(tzinfo=None) - r.started_at.replace(tzinfo=None)).total_seconds()
            duration = f"{int(delta // 60)}m {int(delta % 60)}s"
        rows.append({
            "Run-ID": str(r.id),
            "Portal": r.portal,
            "Metadatei": r.metadata_filename or "",
            "Status": r.status,
            "Gesamt": r.total_files,
            "Erfolgreich": r.completed_files,
            "Fehler": r.failed_files,
            "Übersprungen": r.skipped_files,
            "Benutzer": r.initiated_by or "",
            "Gestartet": r.started_at.strftime("%Y-%m-%d %H:%M:%S") if r.started_at else "",
            "Beendet": r.finished_at.strftime("%Y-%m-%d %H:%M:%S") if r.finished_at else "",
            "Dauer": duration,
        })

    df = pd.DataFrame(rows)
    buf = io.BytesIO()

    if format == "xlsx":
        df.to_excel(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=auslieferungen.xlsx"},
        )
    else:
        csv_bytes = df.to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig")
        return StreamingResponse(
            iter([csv_bytes]),
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": "attachment; filename=auslieferungen.csv"},
        )


@router.get("/{run_id}", response_model=DeliveryRunDetail)
async def get_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: str = Depends(get_current_user)):
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    logs_result = await db.execute(
        select(DeliveryLog).where(DeliveryLog.run_id == run_id).order_by(DeliveryLog.id)
    )
    run.logs = logs_result.scalars().all()
    return run


@router.get("/{run_id}/logs", response_model=list[DeliveryLogOut])
async def get_run_logs(
    run_id: uuid.UUID,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    q = select(DeliveryLog).where(DeliveryLog.run_id == run_id).order_by(DeliveryLog.id)
    if status:
        q = q.where(DeliveryLog.status == status)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/preview")
async def preview_metadata(
    metadata_file: UploadFile | None = File(default=None),
    metadata_server_file: str | None = Form(default=None),
    _user: str = Depends(get_current_user),
):
    """Parst eine Metadatei, erkennt das Portal und gibt Buchtitel + ZIP-Verfügbarkeit zurück."""
    import tempfile
    from pathlib import Path as _Path

    storage_root = os.getenv("STORAGE_DIR", "/storage")
    source_dir = os.path.join(storage_root, "zips")

    temp_path = None
    filename = ""
    cleanup = False

    if metadata_server_file:
        server_path = os.path.join(storage_root, "metadata", os.path.basename(metadata_server_file))
        if not os.path.isfile(server_path):
            raise HTTPException(status_code=404, detail="Server-Metadatei nicht gefunden")
        temp_path = server_path
        filename = os.path.basename(metadata_server_file)
    elif metadata_file and metadata_file.filename:
        safe_name = _safe_filename(metadata_file.filename)
        suffix = _Path(safe_name).suffix or ".xml"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir="/tmp") as f:
            f.write(await metadata_file.read())
            temp_path = f.name
        filename = safe_name
        cleanup = True
    else:
        raise HTTPException(status_code=422, detail="Keine Metadatei angegeben")

    try:
        result = parse_metadata(temp_path, filename, source_dir)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        if cleanup and temp_path:
            try:
                os.unlink(temp_path)
            except Exception:
                pass

    return {
        "filename": result.filename,
        "detected_portal": result.detected_portal,
        "portal_variants": result.portal_variants,
        "books": [
            {
                "ean": b.ean,
                "title": b.title,
                "author": b.author,
                "abridged": b.abridged,
                "zip_available": b.zip_available,
            }
            for b in result.books
        ],
    }


@router.post("/check")
async def check_run(
    portal: str = Form(...),
    metadata_file: UploadFile | None = File(default=None),
    metadata_server_file: str | None = Form(default=None),
    _user: str = Depends(get_current_user),
):
    """Pre-flight check: returns EANs whose ZIP files are missing in source_dir."""
    import tempfile
    from pathlib import Path as _Path

    module_cls = PORTAL_REGISTRY.get(portal)
    if not module_cls:
        return {"missing": []}

    config = load_config()
    module = module_cls(config, portal)
    storage_root = os.getenv("STORAGE_DIR", "/storage")

    temp_path = None
    cleanup = False

    if metadata_server_file:
        server_path = os.path.join(storage_root, "metadata", os.path.basename(metadata_server_file))
        if os.path.isfile(server_path):
            temp_path = server_path
    elif metadata_file and metadata_file.filename:
        safe_name = _safe_filename(metadata_file.filename)
        suffix = _Path(safe_name).suffix or ".xml"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir="/tmp") as f:
            f.write(await metadata_file.read())
            temp_path = f.name
        cleanup = True

    try:
        missing = module.check_missing(temp_path)
    except Exception:
        missing = []
    finally:
        if cleanup and temp_path:
            try:
                os.unlink(temp_path)
            except Exception:
                pass

    return {"missing": missing}


@router.post("", status_code=202)
async def start_run(
    portal: str = Form(...),
    metadata_file: UploadFile | None = File(default=None),
    metadata_server_file: str | None = Form(default=None),
    takedown: bool = Form(default=False),
    current_user: str = Depends(get_current_user),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    storage_root = os.getenv("STORAGE_DIR", "/storage")
    metadata_path = None
    metadata_filename = None

    if metadata_server_file:
        server_path = os.path.join(storage_root, "metadata", os.path.basename(metadata_server_file))
        if not os.path.isfile(server_path):
            raise HTTPException(status_code=404, detail="Server-Metadatei nicht gefunden")
        metadata_filename = os.path.basename(metadata_server_file)
        metadata_path = server_path
    elif metadata_file and metadata_file.filename:
        metadata_filename = _safe_filename(metadata_file.filename)
        upload_subdir = os.path.join(UPLOAD_DIR, str(uuid.uuid4()))
        os.makedirs(upload_subdir, exist_ok=True)
        dest = os.path.join(upload_subdir, metadata_filename)
        async with aiofiles.open(dest, "wb") as f:
            content = await metadata_file.read()
            await f.write(content)
        metadata_path = dest

    run_id = await start_delivery_run(
        AsyncSessionLocal, portal, metadata_filename, metadata_path, current_user, takedown
    )
    return {"run_id": str(run_id)}


@router.get("/{run_id}/metadata/download")
async def download_run_metadata(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Serve the uploaded metadata file for a run (used as mail attachment)."""
    run = await db.get(DeliveryRun, run_id)
    if not run:
        clear_metadata_path(str(run_id))
        raise HTTPException(status_code=404, detail="Run not found")
    path = get_metadata_path(str(run_id))
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Metadatei nicht (mehr) verfügbar")
    return FileResponse(path=path, filename=os.path.basename(path))



@router.post("/{run_id}/cancel", status_code=202)
async def cancel_run(
    run_id: uuid.UUID,
    _user: str = Depends(get_current_user),
):
    """Signal a running delivery to stop after the current file."""
    request_cancel(str(run_id))
    return {"ok": True}


@router.delete("/{run_id}", status_code=204)
async def delete_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Delete a run and all its log entries."""
    run = await db.get(DeliveryRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    await db.execute(sql_delete(DeliveryLog).where(DeliveryLog.run_id == run_id))
    await db.delete(run)
    await db.commit()
    clear_metadata_path(str(run_id))
