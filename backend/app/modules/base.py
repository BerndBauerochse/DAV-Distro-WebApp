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

    def _get(self, section: str, key: str, fallback: str = "") -> str:
        return self.config.get(section, key, fallback=fallback)
