import os
import uuid
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db, AsyncSessionLocal
from app.models import DeliveryRun, DeliveryLog
from app.schemas import DeliveryRunOut, DeliveryRunDetail, DeliveryLogOut
from app.services.delivery_service import start_delivery_run

router = APIRouter(prefix="/runs", tags=["runs"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")


@router.get("", response_model=list[DeliveryRunOut])
async def list_runs(
    portal: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    q = select(DeliveryRun).order_by(desc(DeliveryRun.started_at)).limit(limit).offset(offset)
    if portal:
        q = q.where(DeliveryRun.portal == portal)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{run_id}", response_model=DeliveryRunDetail)
async def get_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
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
):
    q = select(DeliveryLog).where(DeliveryLog.run_id == run_id).order_by(DeliveryLog.id)
    if status:
        q = q.where(DeliveryLog.status == status)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("", status_code=202)
async def start_run(
    portal: str = Form(...),
    metadata_file: UploadFile | None = File(default=None),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    metadata_path = None
    metadata_filename = None

    if metadata_file:
        metadata_filename = metadata_file.filename
        dest = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}_{metadata_filename}")
        async with aiofiles.open(dest, "wb") as f:
            content = await metadata_file.read()
            await f.write(content)
        metadata_path = dest

    run_id = await start_delivery_run(
        AsyncSessionLocal, portal, metadata_filename, metadata_path
    )
    return {"run_id": str(run_id)}
