"""
File Manager: list, upload, delete files in /storage/{zips,toc,pdf,covers}
Uploads use chunked transfer to work around proxy body-size/timeout limits.
"""
import os
import asyncio
import aiofiles
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from app.auth import get_current_user

READ_SIZE   = 1024 * 1024           # 1 MB read buffer
CHUNK_TEMP  = Path("/tmp/dav-chunks")
THUMB_CACHE = Path("/tmp/dav-thumbs")
THUMB_SIZE  = 200                    # max width/height in pixels

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
        raise HTTPException(status_code=400, detail=f"Unknown category '{category}'. Use: zips, toc, pdf, covers")
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


# ── Chunked Upload ─────────────────────────────────────────────────────────────
# The frontend splits large files into 5 MB chunks and POSTs each one here.
# When the last chunk arrives the parts are assembled into the final file.

@router.post("/{category}/chunks")
async def upload_chunk(
    category: str,
    chunk: UploadFile = File(...),
    filename: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    expected_size: int | None = Form(default=None),
    _user: str = Depends(get_current_user),
):
    folder = _category_path(category)
    CHUNK_TEMP.mkdir(parents=True, exist_ok=True)

    part_path = CHUNK_TEMP / f"{filename}.part{chunk_index}"
    async with aiofiles.open(part_path, "wb") as out:
        while data := await chunk.read(READ_SIZE):
            await out.write(data)

    if chunk_index < total_chunks - 1:
        return {"chunk": chunk_index, "done": False}

    # Last chunk received — verify all parts present, then assemble
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
                part.unlink()
    except Exception:
        # Clean up incomplete file
        if dest.exists():
            dest.unlink()
        raise

    stat = dest.stat()

    # Server-side size check
    if expected_size is not None and stat.st_size != expected_size:
        dest.unlink()
        raise HTTPException(
            status_code=422,
            detail=f"Größenprüfung fehlgeschlagen: erwartet {expected_size} Bytes, erhalten {stat.st_size} Bytes."
        )

    return FileEntry(name=dest.name, size=stat.st_size, modified=stat.st_mtime)


# ── Cover Thumbnail ───────────────────────────────────────────────────────────

def _make_thumb(src: Path, dest: Path) -> None:
    """Resize image to THUMB_SIZE × THUMB_SIZE (max), save as JPEG. Blocking — run in thread."""
    from PIL import Image
    with Image.open(src) as img:
        img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.convert("RGB").save(dest, "JPEG", quality=75, optimize=True)

@router.get("/covers/{filename}/thumb")
async def cover_thumbnail(filename: str, _user: str = Depends(get_current_user)):
    folder = _category_path("covers")
    src = folder / filename
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    thumb = THUMB_CACHE / filename
    # Regenerate if missing or source is newer
    if not thumb.exists() or src.stat().st_mtime > thumb.stat().st_mtime:
        await asyncio.to_thread(_make_thumb, src, thumb)

    data = thumb.read_bytes()
    return Response(content=data, media_type="image/jpeg", headers={
        "Cache-Control": "public, max-age=86400",
    })


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
