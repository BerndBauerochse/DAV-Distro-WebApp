"""Zebra (media-ems) portal module.

Workflow:
1. Excel (header row 6, col AlbumEAN_UPC) → EANs
2. ZIPs entpacken → Ordner in export_dir; ZIP danach löschen
3. Entpackte Dateien + Excel per SFTP hochladen:
   - Dateien → remote_dir (rekursiv, Verzeichnisse werden erstellt)
   - Excel → remote_metadata_dir
4. Mail-Entwurf für Benachrichtigung an Zebra
"""
import base64
import glob
import logging
import os
import shutil
from datetime import datetime
from zipfile import ZipFile

import pandas as pd

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload, sftp_makedirs
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("zebra")
class ZebraModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Zebra"
        self.export_dir = self._get(sec, "export_dir", "/data/export/zebra")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "sftp_host", "ftp.media-ems.com")
        self.port = config.getint(sec, "sftp_port", fallback=2201)
        self.username = self._get(sec, "sftp_username", "DAV")
        pw_b64 = self._get(sec, "sftp_password_base64")
        self.password = base64.b64decode(pw_b64).decode() if pw_b64 else self._get(sec, "sftp_password")
        self.remote_dir = self._get(sec, "remote_dir", "/")
        self.remote_metadata_dir = self._get(sec, "remote_metadata_dir", "/Metadaten")
        self._extracted_count = 0

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        # Find Excel (metadata_path takes precedence)
        if metadata_path and os.path.isfile(metadata_path):
            excel_path = metadata_path
        else:
            xlsx_files = glob.glob(os.path.join(self.export_dir, "*.xlsx"))
            excel_path = xlsx_files[0] if xlsx_files else None

        if not excel_path:
            raise RuntimeError("Keine Excel-Datei gefunden. Bitte eine .xlsx Datei hochladen.")

        # Read Excel — header is in row 6 (0-indexed: 5)
        try:
            df = pd.read_excel(excel_path, header=5)
        except Exception as e:
            raise RuntimeError(f"Excel konnte nicht gelesen werden: {e}")

        if "AlbumEAN_UPC" not in df.columns:
            raise RuntimeError(
                f"Spalte 'AlbumEAN_UPC' nicht gefunden. Gefundene Spalten: {df.columns.tolist()}"
            )

        raw_eans = df["AlbumEAN_UPC"].dropna().unique()
        eans = []
        for e in raw_eans:
            try:
                eans.append(str(int(float(e))))
            except (ValueError, TypeError):
                eans.append(str(e).strip())

        logger.info(f"Zebra: {len(eans)} EANs in Excel gefunden")
        self._extracted_count = 0

        # Copy ZIPs, extract, delete ZIP
        for ean in eans:
            zip_src = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(zip_src):
                logger.warning(f"Zebra: ZIP nicht gefunden für EAN {ean}: {zip_src}")
                continue
            try:
                with ZipFile(zip_src, "r") as zf:
                    zf.extractall(self.export_dir)
                self._extracted_count += 1
                logger.info(f"Zebra: Entpackt {ean}.zip → {self.export_dir}")
            except Exception as e:
                logger.error(f"Zebra: Fehler beim Entpacken von {ean}.zip: {e}")

        # Excel als metadata-Transfer
        transfers.append(FileTransfer(
            ean=None,
            file_name=os.path.basename(excel_path),
            file_type="metadata",
            source_path=excel_path,
            destination=f"{self.remote_metadata_dir}/{os.path.basename(excel_path)}",
            file_size_bytes=os.path.getsize(excel_path),
        ))

        # Alle entpackten Dateien (nicht .xlsx) als Transfers erfassen
        remote_base = self.remote_dir.rstrip("/")
        for root, _dirs, files in os.walk(self.export_dir):
            for fname in sorted(files):
                if fname.lower().endswith(".xlsx"):
                    continue
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, self.export_dir).replace("\\", "/")
                destination = f"{remote_base}/{rel_path}"
                transfers.append(FileTransfer(
                    ean=None,
                    file_name=fname,
                    file_type="audio",
                    source_path=full_path,
                    destination=destination,
                    file_size_bytes=os.path.getsize(full_path),
                ))

        return transfers

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        with sftp_connection(self.host, self.port, self.username, self.password) as sftp:
            for t in transfers:
                remote_dir = os.path.dirname(t.destination).replace("\\", "/")
                sftp_makedirs(sftp, remote_dir)
                try:
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "uploading")
                    sftp_upload(
                        sftp, t.source_path, t.destination,
                        progress_cb=lambda cur, tot: progress_cb(
                            run_id, t.ean, t.file_name, t.file_type, cur, tot, "uploading"
                        ),
                    )
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, t.file_size_bytes, t.file_size_bytes, "success")
                except Exception as e:
                    logger.error(f"Zebra upload failed {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    def check_missing(self, metadata_path: str | None) -> list[str]:
        if not metadata_path or not os.path.isfile(metadata_path):
            return []
        try:
            df = pd.read_excel(metadata_path, header=5)
            if "AlbumEAN_UPC" not in df.columns:
                return []
            eans = []
            for e in df["AlbumEAN_UPC"].dropna().unique():
                try:
                    eans.append(str(int(float(e))))
                except (ValueError, TypeError):
                    eans.append(str(e).strip())
            return [e for e in eans if not os.path.isfile(os.path.join(self.source_dir, f"{e}.zip"))]
        except Exception:
            return []

    def get_mail_draft(self) -> dict | None:
        heute = datetime.now().strftime("%Y-%m-%d")
        count = self._extracted_count
        if count == 1:
            body = (
                "Hallo Andreas,\n\n"
                "Ich habe dir noch einen neuen Titel auf den Server geladen.\n\n"
                "Liebe Grüße\nBernd"
            )
        elif count > 1:
            body = (
                "Hallo Andreas,\n\n"
                "Ich habe dir noch ein paar neue Titel auf den Server geladen.\n\n"
                "Liebe Grüße\nBernd"
            )
        else:
            body = (
                "Hallo Andreas,\n\n"
                "Es wurden keine neuen Titel auf den Server geladen.\n\n"
                "Liebe Grüße\nBernd"
            )
        return {
            "to": "content-operations-audiobook@zebralution.com; mara.hartung@zebralution.com",
            "subject": f"DAV {heute}",
            "body": body,
        }
