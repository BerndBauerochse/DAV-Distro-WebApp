"""
File Manager: list, upload, delete files in /storage/{zips,toc,pdf,covers}
Chunks are sent as raw binary (Content-Type: application/octet-stream) with
metadata in query params — eliminates python-multipart parsing overhead.
"""
import os
import asyncio
import aiofiles
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from app.auth import get_current_user

READ_SIZE   = 4 * 1024 * 1024      # 4 MB stream buffer
CHUNK_TEMP  = Path("/tmp/dav-chunks")
THUMB_CACHE = Path("/tmp/dav-thumbs")
THUMB_SIZE  = 200

STORAGE_ROOT = Path(os.getenv("STORAGE_DIR", "/storage"))

CATEGORIES = {
    "zips":     STORAGE_ROOT / "zips",
    "toc":      STORAGE_ROOT / "toc",
    "pdf":      STORAGE_ROOT / "pdf",
    "covers":   STORAGE_ROOT / "covers",
    "metadata": STORAGE_ROOT / "metadata",
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
        raise HTTPException(status_code=400, detail=f"Unknown category '{category}'. Use: zips, toc, pdf, covers, metadata")
    _ensure_dirs()
    return CATEGORIES[category]


def _safe_filename(filename: str) -> str:
    name = Path(filename).name
    if not name or name in {".", ".."} or name != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


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


# ── Chunked Upload (raw binary) ────────────────────────────────────────────────
# Frontend sends Content-Type: application/octet-stream with chunk bytes as body.
# Metadata (filename, index, total) travel as query params — no multipart parsing.

@router.post("/{category}/chunks")
async def upload_chunk(
    category: str,
    request: Request,
    filename: str      = Query(...),
    chunk_index: int   = Query(...),
    total_chunks: int  = Query(...),
    expected_size: int | None = Query(default=None),
    _user: str = Depends(get_current_user),
):
    folder = _category_path(category)
    filename = _safe_filename(filename)
    CHUNK_TEMP.mkdir(parents=True, exist_ok=True)

    # Stream raw body directly to disk — no buffering, no multipart overhead
    part_path = CHUNK_TEMP / f"{filename}.part{chunk_index}"
    async with aiofiles.open(part_path, "wb") as out:
        async for data in request.stream():
            await out.write(data)

    if chunk_index < total_chunks - 1:
        return {"chunk": chunk_index, "done": False}

    # Last chunk — verify all parts present, then assemble
    for i in range(total_chunks):
        if not (CHUNK_TEMP / f"{filename}.part{i}").exists():
            raise HTTPException(status_code=409, detail=f"Teil {i} fehlt — Upload bitte neu starten.")

    dest = folder / filename
    try:
        async with aiofiles.open(dest, "wb") as out:
            for i in range(total_chunks):
                part = CHUNK_TEMP / f"{filename}.part{i}"
                async with aiofiles.open(part, "rb") as inp:
                    while data := await inp.read(READ_SIZE):
                        await out.write(data)
                await asyncio.to_thread(part.unlink)
    except Exception:
        if dest.exists():
            dest.unlink()
        raise

    stat = await asyncio.to_thread(dest.stat)

    if expected_size is not None and stat.st_size != expected_size:
        await asyncio.to_thread(dest.unlink)
        raise HTTPException(
            status_code=422,
            detail=f"Größenprüfung fehlgeschlagen: erwartet {expected_size} Bytes, erhalten {stat.st_size} Bytes."
        )

    return FileEntry(name=dest.name, size=stat.st_size, modified=stat.st_mtime)


# ── Cover Thumbnail ───────────────────────────────────────────────────────────

def _make_thumb(src: Path, dest: Path) -> None:
    from PIL import Image
    with Image.open(src) as img:
        img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.convert("RGB").save(dest, "JPEG", quality=75, optimize=True)

@router.get("/covers/{filename}/thumb")
async def cover_thumbnail(filename: str, _user: str = Depends(get_current_user)):
    folder = _category_path("covers")
    filename = _safe_filename(filename)
    src = folder / filename
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    thumb = THUMB_CACHE / filename
    if not thumb.exists() or src.stat().st_mtime > thumb.stat().st_mtime:
        await asyncio.to_thread(_make_thumb, src, thumb)

    data = await asyncio.to_thread(thumb.read_bytes)
    return Response(content=data, media_type="image/jpeg", headers={
        "Cache-Control": "public, max-age=86400",
    })


# ── Download ──────────────────────────────────────────────────────────────────

@router.get("/{category}/{filename}/download")
async def download_file(category: str, filename: str, _user: str = Depends(get_current_user)):
    folder = _category_path(category)
    filename = _safe_filename(filename)
    dest = folder / filename
    if not dest.exists() or not dest.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=dest, filename=filename)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{category}/{filename}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(category: str, filename: str, _user: str = Depends(get_current_user)):
    folder = _category_path(category)
    filename = _safe_filename(filename)
    dest = folder / filename
    if not dest.exists() or not dest.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    dest.unlink()
