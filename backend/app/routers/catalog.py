import asyncio
import json
import logging
import urllib.request
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import AsyncSessionLocal, get_db

logger = logging.getLogger(__name__)

WEBHOOK_URL = "https://n8n.der-audio-verlag.de/webhook/49dd3f5e-dc77-496e-a099-0115828c1161"

router = APIRouter()


def _fetch_catalog_sync() -> list:
    with urllib.request.urlopen(WEBHOOK_URL, timeout=30) as resp:
        return json.loads(resp.read()).get("data", [])


async def fetch_and_store_catalog() -> int:
    items = await asyncio.to_thread(_fetch_catalog_sync)

    async with AsyncSessionLocal() as db:
        for item in items:
            ean = item.get("EAN_digital", "").strip()
            if not ean:
                continue
            await db.execute(
                text(
                    "INSERT INTO title_catalog (ean, titel, autor, synced_at) "
                    "VALUES (:ean, :titel, :autor, NOW()) "
                    "ON CONFLICT (ean) DO UPDATE "
                    "SET titel = EXCLUDED.titel, autor = EXCLUDED.autor, synced_at = NOW()"
                ),
                {
                    "ean": ean,
                    "titel": item.get("Titel") or "",
                    "autor": item.get("Autor") or "",
                },
            )
        await db.commit()

    logger.info("Titelkatalog synchronisiert: %d Einträge", len(items))
    return len(items)


@router.get("/catalog")
async def get_catalog(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    result = await db.execute(text("SELECT ean, titel, autor FROM title_catalog"))
    rows = result.fetchall()
    return {row.ean: {"titel": row.titel, "autor": row.autor} for row in rows}


@router.post("/catalog/sync")
async def sync_catalog(_: str = Depends(get_current_user)):
    count = await fetch_and_store_catalog()
    return {"synced": count}
