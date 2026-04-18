from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import UserSettings
from app.auth import get_current_user

router = APIRouter(prefix="/users", tags=["users"])


class AvatarBody(BaseModel):
    avatar_data: str  # base64 data-URL


@router.get("/me/avatar")
async def get_avatar(
    current_user: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = await db.get(UserSettings, current_user)
    if not settings or not settings.avatar_data:
        raise HTTPException(status_code=404, detail="No avatar set")
    return {"avatar_data": settings.avatar_data}


@router.put("/me/avatar", status_code=204)
async def set_avatar(
    body: AvatarBody,
    current_user: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = await db.get(UserSettings, current_user)
    if settings:
        settings.avatar_data = body.avatar_data
    else:
        settings = UserSettings(username=current_user, avatar_data=body.avatar_data)
        db.add(settings)
    await db.commit()


@router.delete("/me/avatar", status_code=204)
async def delete_avatar(
    current_user: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = await db.get(UserSettings, current_user)
    if settings:
        settings.avatar_data = None
        await db.commit()
