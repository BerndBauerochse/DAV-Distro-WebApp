import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import runs, portals
from app.websocket_manager import ws_manager

# Import all modules so they register themselves
import app.modules.audible      # noqa: F401
import app.modules.bookwire     # noqa: F401
import app.modules.bookbeat     # noqa: F401
import app.modules.spotify      # noqa: F401
import app.modules.google       # noqa: F401
import app.modules.zebra        # noqa: F401
import app.modules.rtl          # noqa: F401
import app.modules.divibib      # noqa: F401

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database initialized")
    yield


app = FastAPI(title="DAV Distro WebApp", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs.router, prefix="/api")
app.include_router(portals.router, prefix="/api")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive ping/pong
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"status": "ok"}
