"""
Watches /storage/metadata/inbox/ for new metadata files.
Moves them to /storage/metadata/ (archive) and notifies connected clients via WebSocket.
"""
import asyncio
import logging
import shutil
from pathlib import Path

from app.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

_SUPPORTED = {".xml", ".xlsx", ".xls"}
_POLL_INTERVAL = 3  # seconds


async def _watch_loop(inbox: Path, archive: Path) -> None:
    inbox.mkdir(parents=True, exist_ok=True)
    seen: set[Path] = set(inbox.iterdir())

    while True:
        await asyncio.sleep(_POLL_INTERVAL)
        try:
            current: set[Path] = set(inbox.iterdir())
            new_files = current - seen
            for f in sorted(new_files):
                if not f.is_file() or f.suffix.lower() not in _SUPPORTED:
                    continue
                dest = archive / f.name
                try:
                    shutil.move(str(f), str(dest))
                    logger.info(f"Inbox: {f.name} → metadata/")
                    await ws_manager.broadcast({"type": "new_metadata_file", "filename": f.name})
                except Exception as e:
                    logger.warning(f"Inbox: could not move {f.name}: {e}")
            seen = set(inbox.iterdir())
        except Exception as e:
            logger.warning(f"Inbox watcher error: {e}")


def start_file_watcher(storage_root: Path) -> None:
    inbox = storage_root / "metadata" / "inbox"
    archive = storage_root / "metadata"
    archive.mkdir(parents=True, exist_ok=True)
    asyncio.create_task(_watch_loop(inbox, archive))
    logger.info(f"File watcher started — inbox: {inbox}")
