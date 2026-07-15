"""
Base class for all portal delivery modules.
Each module must implement get_files() and ship().
Progress is reported via the progress_callback.
"""
import logging
import os
import zipfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable
import configparser

logger = logging.getLogger(__name__)


@dataclass
class FileTransfer:
    ean: str | None
    file_name: str
    file_type: str          # metadata | zip | transformed_zip | image
    source_path: str
    destination: str
    file_size_bytes: int = 0
    # Files injected into the ZIP before upload: list of (filename, type)
    # type is "toc" for TOC XLSX files, "pdf" for booklet PDFs
    injected_files: list[tuple[str, str]] = field(default_factory=list)


ProgressCallback = Callable[[str, str, str, str, int, int, str, str | None], None]
# args: run_id, ean, file_name, file_type, current_bytes, total_bytes, status, error


class BasePortalModule(ABC):
    """
    Base class for portal delivery modules.

    Subclasses implement:
      - get_files(run_id, metadata_path) -> list[FileTransfer]
          Assembles the files to be transferred.
      - ship(run_id, transfers, progress_cb) -> None
          Performs the actual FTP/SFTP upload.
    """

    # Remote-Ordner für den Cover-Austausch (z.B. /Cover_Austausch).
    # Subklassen setzen dies aus der Config, wenn der Kanal das unterstützt.
    cover_exchange_dir: str = ""

    # Bei Update-Läufen (ehem. Takedown): welches Metadatenfeld geändert wurde.
    # Wird von delivery_service gesetzt; aktuell nur von Audible ausgewertet.
    update_field: str | None = None

    def __init__(self, config: configparser.ConfigParser, portal_name: str):
        self.config = config
        self.portal_name = portal_name

    @abstractmethod
    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        """Collect and prepare files for upload. Returns list of FileTransfer."""
        ...

    @abstractmethod
    def ship(
        self,
        run_id: str,
        transfers: list[FileTransfer],
        progress_cb: ProgressCallback,
    ) -> None:
        """Upload files to the portal. Call progress_cb for each file."""
        ...

    def check_missing(self, metadata_path: str | None) -> list[str]:
        """Return list of EANs whose ZIP files are missing in source_dir.
        Override in modules that ship ZIP files."""
        return []

    def get_mail_draft(self, user: str | None = None) -> dict | None:
        """Return mail draft data after a completed run, or None if no mail needed.
        Override in modules that generate notification emails.
        Returns dict with keys: to, subject, body"""
        return None

    def _inject_pdf_into_zip(self, zip_path: str, ean: str, pdf_dir: str) -> bool:
        """Hängt eine PDF als {ean}_booklet.pdf an das ZIP an, falls vorhanden.
        Gibt True zurück wenn eine PDF eingefügt wurde, sonst False."""
        pdf_src = os.path.join(pdf_dir, f"{ean}.pdf")
        if not os.path.isfile(pdf_src):
            return False
        with zipfile.ZipFile(zip_path, "a", zipfile.ZIP_DEFLATED) as zf:
            zf.write(pdf_src, arcname=f"{ean}_booklet.pdf")
        logger.info("PDF für %s in ZIP eingefügt: %s_booklet.pdf", ean, ean)
        return True

    def _app_cover_path(self, ean: str, covers_dir: str | None = None) -> str | None:
        """Pfad zum in der App hinterlegten Cover {ean}.jpg, oder None wenn keins
        existiert. covers_dir defaultet auf STORAGE_DIR/covers."""
        covers_dir = covers_dir or os.path.join(os.getenv("STORAGE_DIR", "/storage"), "covers")
        p = os.path.join(covers_dir, f"{ean}.jpg")
        return p if os.path.isfile(p) else None

    def _swap_cover_in_zip(self, zip_path: str, ean: str, covers_dir: str | None = None) -> bool:
        """Ersetzt das Cover {ean}.jpg in der ZIP durch das in der App hinterlegte
        Cover — aber nur, wenn dieses existiert UND sich vom Cover in der ZIP
        unterscheidet. Gibt True zurück, wenn tatsächlich getauscht wurde.

        Sicherheit: arbeitet ausschließlich auf zip_path (der Arbeitskopie im
        Export-Ordner). Der Aufrufer muss sicherstellen, dass dies nicht die
        Original-ZIP im schreibgeschützten Quellordner ist. Das ZIP wird neu
        gepackt (Cover ersetzt, alle anderen Einträge unverändert) und erst am
        Ende atomar an die Stelle der Arbeitskopie geschoben."""
        app_cover = self._app_cover_path(ean, covers_dir)
        if not app_cover:
            return False
        try:
            with open(app_cover, "rb") as f:
                new_bytes = f.read()
        except OSError as e:
            logger.warning("Cover-Austausch: App-Cover nicht lesbar für %s: %s", ean, e)
            return False

        target = f"{ean}.jpg"

        # 1. Cover in der ZIP finden und prüfen, ob ein Austausch überhaupt nötig ist.
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                cover_entry = next(
                    (i for i in zf.infolist()
                     if os.path.basename(i.filename).lower() == target.lower()),
                    None,
                )
                if cover_entry is None:
                    logger.debug("Cover-Austausch: kein %s in ZIP %s — übersprungen",
                                 target, os.path.basename(zip_path))
                    return False
                if zf.read(cover_entry) == new_bytes:
                    return False  # identisch → nichts zu tun
                cover_name = cover_entry.filename  # exakter Pfad in der ZIP (ggf. Unterordner)
        except (zipfile.BadZipFile, OSError) as e:
            logger.error("Cover-Austausch: ZIP nicht lesbar %s: %s", zip_path, e)
            return False

        # 2. ZIP neu schreiben: Cover-Eintrag ersetzen, Rest 1:1 übernehmen.
        tmp_path = zip_path + ".covertmp"
        try:
            with zipfile.ZipFile(zip_path, "r") as zin, \
                 zipfile.ZipFile(tmp_path, "w") as zout:
                for info in zin.infolist():
                    if info.filename == cover_name:
                        zout.writestr(info, new_bytes)  # gleicher Name/Pfad, neue Bytes
                    else:
                        zout.writestr(info, zin.read(info))  # Kompression je Eintrag bleibt erhalten
            os.replace(tmp_path, zip_path)  # atomar ersetzen
        except Exception as e:
            logger.error("Cover-Austausch: Neu-Packen fehlgeschlagen für %s: %s", ean, e)
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            return False

        logger.info("Cover-Austausch: %s in ZIP ersetzt (%s)", cover_name, os.path.basename(zip_path))
        return True

    def supports_cover_exchange(self) -> bool:
        """True, wenn der Kanal Cover empfangen kann (Standard-SFTP-Zugang).
        Sonderfälle (Bookwire/FTPS, Divibib/FTP, Google) überschreiben dies."""
        return bool(getattr(self, "host", "") and getattr(self, "username", ""))

    def _cover_remote_dir(self) -> str:
        """Zielordner für Cover: spezieller Cover-Austausch-Ordner, sonst der
        normale Zielordner des Kanals, sonst Wurzel."""
        d = (self.cover_exchange_dir
             or getattr(self, "remote_dir", "")
             or getattr(self, "remote_path", "")
             or "/")
        return d.rstrip("/") or "/"

    def exchange_covers(self, cover_paths: list[str]) -> list[tuple[str, str, str | None]]:
        """Lädt die Cover per Standard-SFTP in den Zielordner.
        Gibt je Datei (dateiname, status, fehler) zurück."""
        from app.modules.ftp_helper import sftp_connection, sftp_upload, sftp_makedirs

        remote_dir = self._cover_remote_dir()
        results: list[tuple[str, str, str | None]] = []
        with sftp_connection(self.host, self.port, self.username, self.password) as sftp:
            if remote_dir != "/":
                sftp_makedirs(sftp, remote_dir)
            base = "" if remote_dir == "/" else remote_dir
            for path in cover_paths:
                fname = os.path.basename(path)
                try:
                    sftp_upload(sftp, path, f"{base}/{fname}")
                    results.append((fname, "success", None))
                    logger.info("Cover-Austausch: %s → %s %s", fname, self.portal_name, remote_dir)
                except Exception as e:
                    results.append((fname, "failed", str(e)))
                    logger.error("Cover-Austausch fehlgeschlagen %s → %s: %s", fname, self.portal_name, e)
        return results

    def _get(self, section: str, key: str, fallback: str = "") -> str:
        return self.config.get(section, key, fallback=fallback)
