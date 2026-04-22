"""
Watches /storage/metadata/ for new metadata files dropped in externally.
Notifies connected clients via WebSocket when a new file appears.
"""
import asyncio
import logging
from pathlib import Path

from app.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

_SUPPORTED = {".xml", ".xlsx", ".xls"}
_POLL_INTERVAL = 3  # seconds


async def _watch_loop(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    seen: set[Path] = set(folder.iterdir())

    while True:
        await asyncio.sleep(_POLL_INTERVAL)
        try:
            current: set[Path] = set(folder.iterdir())
            new_files = current - seen
            for f in sorted(new_files):
                if not f.is_file() or f.suffix.lower() not in _SUPPORTED:
                    continue
                logger.info(f"Neue Metadatei erkannt: {f.name}")
                await ws_manager.broadcast({"type": "new_metadata_file", "filename": f.name})
            seen = current
        except Exception as e:
            logger.warning(f"File watcher error: {e}")


def start_file_watcher(storage_root: Path) -> None:
    folder = storage_root / "metadata"
    folder.mkdir(parents=True, exist_ok=True)
    asyncio.create_task(_watch_loop(folder))
    logger.info(f"File watcher gestartet — überwacht: {folder}")
