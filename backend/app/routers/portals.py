from fastapi import APIRouter
from app.services.delivery_service import PORTAL_REGISTRY, PORTAL_DISPLAY_NAMES

router = APIRouter(prefix="/portals", tags=["portals"])


@router.get("")
async def list_portals():
    return [
        {"key": key, "name": PORTAL_DISPLAY_NAMES.get(key, key)}
        for key in PORTAL_REGISTRY.keys()
    ]
