"""Outlook-365-Übergabe: legt einen Mail-Entwurf direkt im Versand-Postfach ab.

Der Frontend-Dialog schickt die Entwurfsdaten hierher; ein evtl. Anhang
(Metadatei des Runs) wird serverseitig über die run_id aufgelöst — derselbe
Pfad, den auch der EML-Download nutzt.
"""
import logging
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import DeliveryRun
from app.services import graph_mailer
from app.services.delivery_service import get_metadata_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mail", tags=["mail"])


class OutlookDraftRequest(BaseModel):
    to: str
    subject: str
    body: str
    is_html: bool = False
    cc: str | None = None
    bcc: str | None = None
    # Wenn gesetzt und der Run eine Metadatei hat, wird sie angehängt
    run_id: uuid.UUID | None = None
    with_attachment: bool = False


def _default_cc_for(user: str) -> str | None:
    """Der jeweils andere Nutzer kommt automatisch in CC:
    Bernd sendet → Doro in CC, Doro sendet → Bernd in CC.
    Adressen kommen aus USER_BERND_EMAIL / USER_DORO_EMAIL (Coolify)."""
    partner = {
        "bernd": os.getenv("USER_DORO_EMAIL", "").strip(),
        "doro": os.getenv("USER_BERND_EMAIL", "").strip(),
    }
    return partner.get(user.lower()) or None


@router.get("/outlook/status")
async def outlook_status(user: str = Depends(get_current_user)):
    """Sagt dem Frontend, ob die Outlook-Übergabe eingerichtet ist —
    und welches CC für den eingeloggten Nutzer vorbelegt wird."""
    configured = graph_mailer.is_configured()
    return {
        "configured": configured,
        "mailbox": graph_mailer.mailbox_address() if configured else None,
        "default_cc": _default_cc_for(user),
    }


async def _resolve_attachment(req: OutlookDraftRequest, db: AsyncSession) -> str | None:
    """Löst den Anhang (Metadatei des Runs) serverseitig auf."""
    if not (req.with_attachment and req.run_id):
        return None
    attachment_path: str | None = None
    run = await db.get(DeliveryRun, req.run_id)
    if run:
        path = get_metadata_path(str(req.run_id)) or run.metadata_path
        if path and os.path.isfile(path):
            attachment_path = path
    if not attachment_path:
        raise HTTPException(
            status_code=404,
            detail="Anhang (Metadatei) ist nicht mehr verfügbar.",
        )
    return attachment_path


def _require_configured() -> None:
    if not graph_mailer.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Outlook-Anbindung ist nicht konfiguriert (GRAPH_*-Variablen fehlen).",
        )


@router.post("/outlook/draft")
async def create_outlook_draft(
    req: OutlookDraftRequest,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(get_current_user),
):
    """Legt die Mail als Entwurf im Versand-Postfach ab (ohne zu senden)."""
    _require_configured()
    attachment_path = await _resolve_attachment(req, db)

    try:
        result = await run_in_threadpool(
            graph_mailer.create_outlook_draft,
            req.to, req.subject, req.body, req.is_html, req.bcc, attachment_path,
            req.cc,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    logger.info("Outlook-Entwurf von %s: %s", user, req.subject)
    return {"ok": True, "web_link": result.get("web_link")}


@router.post("/outlook/send")
async def send_outlook_mail(
    req: OutlookDraftRequest,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(get_current_user),
):
    """Versendet die Mail direkt; sie erscheint in den Gesendeten Elementen
    des Versand-Postfachs."""
    _require_configured()
    attachment_path = await _resolve_attachment(req, db)

    try:
        await run_in_threadpool(
            graph_mailer.send_outlook_mail,
            req.to, req.subject, req.body, req.is_html, req.bcc, attachment_path,
            req.cc,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    logger.info("Mail versendet von %s an %s: %s", user, req.to, req.subject)
    return {"ok": True}
