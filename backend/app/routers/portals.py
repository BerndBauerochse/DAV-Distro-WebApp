from fastapi import APIRouter, Depends
from app.services.delivery_service import PORTAL_REGISTRY, PORTAL_DISPLAY_NAMES
from app.auth import get_current_user

router = APIRouter(prefix="/portals", tags=["portals"])


@router.get("")
async def list_portals(_user: str = Depends(get_current_user)):
    return [
        {"key": key, "name": PORTAL_DISPLAY_NAMES.get(key, key)}
        for key in PORTAL_REGISTRY.keys()
    ]
