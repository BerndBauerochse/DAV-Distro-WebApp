import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, status
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import runs, portals, files as files_router
from app.routers import auth as auth_router
from app.routers import users as users_router
from app.routers import catalog as catalog_router
from app.routers import covers as covers_router
from app.routers.catalog import fetch_and_store_catalog
from app.websocket_manager import ws_manager
from app.services.file_watcher import start_file_watcher
from app.auth import JWT_SECRET, ALGORITHM
from jose import JWTError, jwt

# Import all modules so they register themselves
import app.modules.audible      # noqa: F401
import app.modules.bookwire     # noqa: F401
import app.modules.bookbeat     # noqa: F401
import app.modules.spotify      # noqa: F401
import app.modules.google       # noqa: F401
import app.modules.zebra        # noqa: F401
import app.modules.rtl          # noqa: F401
import app.modules.divibib      # noqa: F401
import app.modules.storytel     # noqa: F401

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _catalog_sync_loop():
    """Syncs the title catalog from n8n once per day, starting immediately."""
    while True:
        try:
            count = await fetch_and_store_catalog()
            logger.info("Titelkatalog-Sync OK: %d Einträge", count)
        except Exception as e:
            logger.error("Titelkatalog-Sync fehlgeschlagen: %s", e)
        await asyncio.sleep(24 * 3600)


_background_tasks: set = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database initialized")
    storage_root = Path(os.getenv("STORAGE_DIR", "/storage"))
    start_file_watcher(storage_root)
    # Referenz halten, damit GC den Task nicht vorzeitig verwirft
    task = asyncio.create_task(_catalog_sync_loop())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    yield


app = FastAPI(title="DAV Distro WebApp", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
app.include_router(portals.router, prefix="/api")
app.include_router(files_router.router, prefix="/api")
app.include_router(users_router.router, prefix="/api")
app.include_router(catalog_router.router, prefix="/api")
app.include_router(covers_router.router, prefix="/api")


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str | None = Query(default=None),
):
    # Validate JWT before accepting the connection
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise ValueError("no sub")
    except (JWTError, ValueError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive ping/pong
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"status": "ok"}
