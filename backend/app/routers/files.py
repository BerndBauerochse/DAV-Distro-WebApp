"""
File Manager: list, upload, delete files in /storage/{zips,toc,pdf}
"""
import os
import aiofiles
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.auth import get_current_user

CHUNK_SIZE = 1024 * 1024  # 1 MB

STORAGE_ROOT = Path(os.getenv("STORAGE_DIR", "/storage"))

CATEGORIES = {
    "zips":   STORAGE_ROOT / "zips",
    "toc":    STORAGE_ROOT / "toc",
    "pdf":    STORAGE_ROOT / "pdf",
    "covers": STORAGE_ROOT / "covers",
}

router = APIRouter(prefix="/files", tags=["files"])


def _ensure_dirs():
    for path in CATEGORIES.values():
        path.mkdir(parents=True, exist_ok=True)


class FileEntry(BaseModel):
    name: str
    size: int
    modified: float


def _category_path(category: str) -> Path:
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category '{category}'. Use: zips, toc, pdf")
    _ensure_dirs()
    return CATEGORIES[category]


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/{category}", response_model=list[FileEntry])
async def list_files(category: str, _user: str = Depends(get_current_user)):
    folder = _category_path(category)
    entries = []
    for f in sorted(folder.iterdir()):
        if f.is_file():
            stat = f.stat()
            entries.append(FileEntry(name=f.name, size=stat.st_size, modified=stat.st_mtime))
    return entries


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/{category}", status_code=status.HTTP_201_CREATED)
async def upload_file(
    category: str,
    file: UploadFile = File(...),
    _user: str = Depends(get_current_user),
):
    folder = _category_path(category)
    dest = folder / file.filename
    async with aiofiles.open(dest, "wb") as out:
        while chunk := await file.read(CHUNK_SIZE):
            await out.write(chunk)
    stat = dest.stat()
    return FileEntry(name=dest.name, size=stat.st_size, modified=stat.st_mtime)


# ── Download ──────────────────────────────────────────────────────────────────

@router.get("/{category}/{filename}/download")
async def download_file(
    category: str,
    filename: str,
    _user: str = Depends(get_current_user),
):
    folder = _category_path(category)
    dest = folder / filename
    if not dest.exists() or not dest.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=dest, filename=filename)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{category}/{filename}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    category: str,
    filename: str,
    _user: str = Depends(get_current_user),
):
    folder = _category_path(category)
    dest = folder / filename
    if not dest.exists() or not dest.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    dest.unlink()
