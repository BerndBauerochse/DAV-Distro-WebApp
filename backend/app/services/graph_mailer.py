"""Microsoft-Graph-Anbindung: legt fertige Mails als Entwurf direkt in das
Outlook-365-Versand-Postfach des Verlags.

Konfiguration ausschließlich über Umgebungsvariablen (kommen aus Coolify):
    GRAPH_TENANT_ID       Mandanten-ID (Tenant)
    GRAPH_CLIENT_ID       Anwendungs-ID der App-Registrierung
    GRAPH_CLIENT_SECRET   Geheimer Clientschlüssel
    GRAPH_SENDER_MAILBOX  Adresse des freigegebenen Versand-Postfachs

Ohne diese vier Werte ist die Funktion schlicht deaktiviert (is_configured()
= False); die App läuft dann unverändert mit dem EML-Download weiter.

Bewusst nur Entwürfe (Mail.ReadWrite), kein Direktversand: Der Nutzer sieht
jede Mail in Outlook und schickt sie selbst ab.
"""
import base64
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
TOKEN_TIMEOUT = 20
GRAPH_TIMEOUT = 60
# Inline-Anhänge sind bei Graph bis ~3 MB erlaubt; unsere Metadateien (XLSX/XML)
# liegen weit darunter. Größere lehnen wir mit klarer Meldung ab statt zu raten.
MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024

_token_lock = threading.Lock()
_token_cache: dict = {"access_token": None, "expires_at": 0.0}


def _cfg() -> dict[str, str]:
    return {
        "tenant": os.getenv("GRAPH_TENANT_ID", "").strip(),
        "client_id": os.getenv("GRAPH_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("GRAPH_CLIENT_SECRET", "").strip(),
        "mailbox": os.getenv("GRAPH_SENDER_MAILBOX", "").strip(),
    }


def is_configured() -> bool:
    return all(_cfg().values())


def mailbox_address() -> str:
    return _cfg()["mailbox"]


def _get_token() -> str:
    """Client-Credentials-Token holen; gecacht bis kurz vor Ablauf."""
    with _token_lock:
        if _token_cache["access_token"] and time.time() < _token_cache["expires_at"]:
            return _token_cache["access_token"]

        cfg = _cfg()
        url = f"https://login.microsoftonline.com/{cfg['tenant']}/oauth2/v2.0/token"
        data = urllib.parse.urlencode({
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }).encode()
        req = urllib.request.Request(url, data=data, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=TOKEN_TIMEOUT) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:500]
            logger.error("Graph-Token fehlgeschlagen (HTTP %s): %s", e.code, body)
            raise RuntimeError(
                "Anmeldung bei Microsoft 365 fehlgeschlagen — bitte Tenant-ID, "
                "Client-ID und Client Secret prüfen."
            ) from e

        _token_cache["access_token"] = payload["access_token"]
        # 5 Minuten Sicherheitspuffer vor dem tatsächlichen Ablauf
        _token_cache["expires_at"] = time.time() + int(payload.get("expires_in", 3600)) - 300
        return _token_cache["access_token"]


def _split_addresses(raw: str | None) -> list[dict]:
    """'a@x.de; b@y.de' → Graph-Empfängerliste. Trennt an ; und ,."""
    if not raw:
        return []
    parts = [p.strip() for chunk in raw.split(";") for p in chunk.split(",")]
    return [{"emailAddress": {"address": p}} for p in parts if p]


def _build_message(
    to: str,
    subject: str,
    body: str,
    is_html: bool,
    bcc: str | None,
    attachment_path: str | None,
) -> dict:
    message: dict = {
        "subject": subject,
        "body": {
            "contentType": "html" if is_html else "text",
            "content": body,
        },
        "toRecipients": _split_addresses(to),
    }
    bcc_recipients = _split_addresses(bcc)
    if bcc_recipients:
        message["bccRecipients"] = bcc_recipients

    if attachment_path:
        size = os.path.getsize(attachment_path)
        if size > MAX_ATTACHMENT_BYTES:
            raise RuntimeError(
                f"Anhang ist zu groß für die Outlook-Übergabe "
                f"({size // (1024*1024)} MB, Limit 3 MB)."
            )
        with open(attachment_path, "rb") as f:
            content_b64 = base64.b64encode(f.read()).decode()
        message["attachments"] = [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": os.path.basename(attachment_path),
            "contentBytes": content_b64,
        }]
    return message


def _graph_post(path: str, payload: dict, action_label: str) -> dict:
    """POST an Graph mit einheitlicher Fehlerübersetzung. Gibt die JSON-Antwort
    zurück (leeres dict bei Antworten ohne Body, z. B. 202 bei sendMail)."""
    cfg = _cfg()
    req = urllib.request.Request(
        f"{GRAPH_BASE}{path}",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {_get_token()}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=GRAPH_TIMEOUT) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")[:500]
        logger.error("%s fehlgeschlagen (HTTP %s): %s", action_label, e.code, body_text)
        if e.code == 403:
            raise RuntimeError(
                "Microsoft 365 hat den Zugriff verweigert — vermutlich fehlt die "
                "Freigabe für das Versand-Postfach (Application Access Policy) "
                "oder die Administratorzustimmung."
            ) from e
        if e.code == 404:
            raise RuntimeError(
                f"Postfach '{cfg['mailbox']}' wurde nicht gefunden — bitte "
                "GRAPH_SENDER_MAILBOX prüfen."
            ) from e
        raise RuntimeError(f"{action_label} fehlgeschlagen (HTTP {e.code}).") from e


def create_outlook_draft(
    to: str,
    subject: str,
    body: str,
    is_html: bool = False,
    bcc: str | None = None,
    attachment_path: str | None = None,
) -> dict:
    """Legt einen Entwurf im Versand-Postfach an. Gibt {web_link} zurück.

    Blockierend (urllib) — vom Router aus per run_in_threadpool aufrufen.
    """
    if not is_configured():
        raise RuntimeError("Outlook-Anbindung ist nicht konfiguriert.")

    cfg = _cfg()
    message = _build_message(to, subject, body, is_html, bcc, attachment_path)
    created = _graph_post(
        f"/users/{urllib.parse.quote(cfg['mailbox'])}/messages",
        message,
        "Outlook-Entwurf",
    )
    logger.info("Outlook-Entwurf angelegt in %s: %s", cfg["mailbox"], subject)
    return {"web_link": created.get("webLink"), "message_id": created.get("id")}


def send_outlook_mail(
    to: str,
    subject: str,
    body: str,
    is_html: bool = False,
    bcc: str | None = None,
    attachment_path: str | None = None,
) -> None:
    """Versendet die Mail direkt über das Versand-Postfach. Die gesendete Mail
    landet in dessen 'Gesendeten Elementen' (saveToSentItems).

    Blockierend (urllib) — vom Router aus per run_in_threadpool aufrufen.
    """
    if not is_configured():
        raise RuntimeError("Outlook-Anbindung ist nicht konfiguriert.")

    cfg = _cfg()
    message = _build_message(to, subject, body, is_html, bcc, attachment_path)
    _graph_post(
        f"/users/{urllib.parse.quote(cfg['mailbox'])}/sendMail",
        {"message": message, "saveToSentItems": True},
        "Outlook-Versand",
    )
    logger.info("Mail versendet über %s: %s → %s", cfg["mailbox"], subject, to)
