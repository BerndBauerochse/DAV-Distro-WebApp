"""Storytel portal module (Files.com SFTP).

Besonderheit gegenüber den anderen Kanälen:
1. Die Metadaten kommen NICHT als einzelne XML, sondern als ZIP mit vielen
   `{EAN}.xml`-Dateien. Diese ZIP wird entpackt; jede XML gehört zu einer EAN.
2. Pro Titel wird ein eigener Ordner gebaut, der AUSSCHLIESSLICH enthält:
   Cover (.jpg/.jpeg/.png), MP3-Dateien und die passende `{EAN}.xml`.
   PDFs, TXT, XLSX und sonstige Begleitdateien werden bewusst ausgeschlossen.
3. Hochgeladen werden die fertigen Titelordner (Datei für Datei je Ordner).
"""
import base64
import glob
import logging
import os
import shutil
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from zipfile import ZipFile

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload, sftp_makedirs
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)

PARALLEL_UPLOADS = 4
UPLOAD_RETRIES = 3
RETRY_DELAY_SECONDS = 2

# Nur diese Dateitypen dürfen in einen Storytel-Titelordner / Upload
ALLOWED_EXT = {".xml", ".mp3", ".jpg", ".jpeg", ".png"}


def _ean_from_name(filename: str) -> str:
    stem = os.path.splitext(os.path.basename(filename))[0]
    return stem.strip()


@register_portal("storytel")
class StorytelModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Storytel"
        self.export_dir = self._get(sec, "export_dir", "/data/export/storytel")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "sftp_host", "")
        self.port = config.getint(sec, "sftp_port", fallback=22)
        self.username = self._get(sec, "sftp_username", "")
        pw_b64 = self._get(sec, "sftp_password_base64")
        self.password = base64.b64decode(pw_b64).decode() if pw_b64 else self._get(sec, "sftp_password")
        self.remote_dir = self._get(sec, "remote_dir", "/")

    # ------------------------------------------------------------------ helpers

    def _extract_xml_map(self, metadata_zip: str) -> dict[str, str]:
        """Entpackt die Metadaten-ZIP und liefert {EAN: pfad_zur_xml}."""
        tmp = tempfile.mkdtemp(prefix="storytel_xml_")
        with ZipFile(metadata_zip, "r") as zf:
            zf.extractall(tmp)
        xml_map: dict[str, str] = {}
        for root, _dirs, files in os.walk(tmp):
            for fname in files:
                if fname.lower().endswith(".xml"):
                    xml_map[_ean_from_name(fname)] = os.path.join(root, fname)
        return xml_map

    def _build_title_folder(self, ean: str, zip_src: str, xml_src: str) -> str:
        """Baut export_dir/{EAN}/ mit ausschließlich Cover, MP3 und der XML.
        Gibt den Ordnerpfad zurück."""
        target = os.path.join(self.export_dir, ean)
        if os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)
        os.makedirs(target, exist_ok=True)

        # Quell-ZIP in temporären Ordner entpacken, erlaubte Dateien flach kopieren
        with tempfile.TemporaryDirectory(prefix=f"storytel_src_{ean}_") as tmp:
            with ZipFile(zip_src, "r") as zf:
                zf.extractall(tmp)
            for root, _dirs, files in os.walk(tmp):
                for fname in files:
                    ext = os.path.splitext(fname)[1].lower()
                    if ext not in ALLOWED_EXT or ext == ".xml":
                        # XML aus dem Quellmaterial ignorieren — die echte XML
                        # kommt aus der Metadaten-ZIP. PDF/TXT/XLSX ausgeschlossen.
                        continue
                    src = os.path.join(root, fname)
                    dst = os.path.join(target, fname)
                    shutil.copy2(src, dst)

        # Passende XML in den Titelordner legen
        shutil.copy2(xml_src, os.path.join(target, f"{ean}.xml"))
        return target

    @staticmethod
    def _enforce_allowlist(folder: str) -> None:
        """Entfernt alles, was nicht .xml/.mp3/.jpg/.jpeg/.png ist."""
        for root, _dirs, files in os.walk(folder):
            for fname in files:
                if os.path.splitext(fname)[1].lower() not in ALLOWED_EXT:
                    try:
                        os.remove(os.path.join(root, fname))
                        logger.info("Storytel: unerlaubte Datei entfernt: %s", fname)
                    except OSError as e:
                        logger.warning("Storytel: konnte %s nicht entfernen: %s", fname, e)

    # ------------------------------------------------------------------ main

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)

        # Alte Titelordner aus vorherigen Läufen entfernen
        for entry in os.listdir(self.export_dir):
            p = os.path.join(self.export_dir, entry)
            try:
                shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
            except OSError as e:
                logger.warning("Storytel: Konnte %s nicht bereinigen: %s", p, e)

        if not metadata_path or not os.path.isfile(metadata_path):
            raise RuntimeError("Keine Metadaten-ZIP angegeben.")
        if not metadata_path.lower().endswith(".zip"):
            raise RuntimeError("Storytel erwartet eine ZIP-Datei mit {EAN}.xml-Dateien.")

        xml_map = self._extract_xml_map(metadata_path)
        if not xml_map:
            raise RuntimeError("In der ZIP wurden keine XML-Dateien gefunden.")
        logger.info("Storytel: %d XML/EANs in Metadaten-ZIP gefunden", len(xml_map))

        transfers: list[FileTransfer] = []
        remote_base = self.remote_dir.rstrip("/")
        missing_eans: list[str] = []

        for ean, xml_src in xml_map.items():
            zip_src = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(zip_src):
                logger.warning("Storytel: Quell-ZIP fehlt für EAN %s: %s", ean, zip_src)
                missing_eans.append(ean)
                continue
            try:
                folder = self._build_title_folder(ean, zip_src, xml_src)
                self._enforce_allowlist(folder)
            except Exception as e:
                logger.error("Storytel: Fehler beim Aufbereiten von %s: %s", ean, e)
                continue

            for fname in sorted(os.listdir(folder)):
                full_path = os.path.join(folder, fname)
                if not os.path.isfile(full_path):
                    continue
                ext = os.path.splitext(fname)[1].lower()
                file_type = "cover" if ext in (".jpg", ".jpeg", ".png") else (
                    "metadata" if ext == ".xml" else "audio"
                )
                transfers.append(FileTransfer(
                    ean=ean,
                    file_name=fname,
                    file_type=file_type,
                    source_path=full_path,
                    destination=f"{remote_base}/{ean}/{fname}",
                    file_size_bytes=os.path.getsize(full_path),
                ))

        if not transfers and missing_eans:
            raise RuntimeError(
                f"Keine Master-ZIP gefunden in '{self.source_dir}'. "
                f"Erwartet: {', '.join(f'{e}.zip' for e in missing_eans)}"
            )

        return transfers

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        _lock = threading.Lock()

        def safe_cb(*args, **kwargs):
            with _lock:
                progress_cb(*args, **kwargs)

        def upload_with_retries(t: FileTransfer) -> None:
            last_error: Exception | None = None
            for attempt in range(1, UPLOAD_RETRIES + 1):
                try:
                    with sftp_connection(self.host, self.port, self.username, self.password) as sftp:
                        safe_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "uploading")
                        sftp_upload(
                            sftp, t.source_path, t.destination,
                            progress_cb=lambda cur, tot, _t=t: safe_cb(
                                run_id, _t.ean, _t.file_name, _t.file_type, cur, tot, "uploading"
                            ),
                        )
                        safe_cb(run_id, t.ean, t.file_name, t.file_type,
                                t.file_size_bytes, t.file_size_bytes, "success")
                    return
                except Exception as e:
                    last_error = e
                    if attempt < UPLOAD_RETRIES:
                        logger.warning("Storytel upload retry %s/%s für %s: %s",
                                       attempt, UPLOAD_RETRIES, t.file_name, e)
                        time.sleep(RETRY_DELAY_SECONDS)
                    else:
                        logger.error("Storytel upload endgültig fehlgeschlagen für %s: %s",
                                     t.file_name, e)
            safe_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(last_error))

        # Remote-Ordner einmalig anlegen
        remote_dirs = {os.path.dirname(t.destination).replace("\\", "/") for t in transfers}
        with sftp_connection(self.host, self.port, self.username, self.password) as sftp:
            for d in sorted(remote_dirs):
                sftp_makedirs(sftp, d)

        # Dateien parallel hochladen
        with ThreadPoolExecutor(max_workers=PARALLEL_UPLOADS) as pool:
            futures = {pool.submit(upload_with_retries, t): t for t in transfers}
            for fut in as_completed(futures):
                exc = fut.exception()
                if exc:
                    t = futures[fut]
                    logger.error("Storytel worker exception %s: %s", t.file_name, exc)

    def check_missing(self, metadata_path: str | None) -> list[str]:
        if not metadata_path or not os.path.isfile(metadata_path) or not metadata_path.lower().endswith(".zip"):
            return []
        try:
            with ZipFile(metadata_path, "r") as zf:
                eans = [_ean_from_name(n) for n in zf.namelist() if n.lower().endswith(".xml")]
            return [e for e in eans if not os.path.isfile(os.path.join(self.source_dir, f"{e}.zip"))]
        except Exception:
            return []
