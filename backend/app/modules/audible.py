"""
Audible portal module (standard + MoA + Fulfill).
Uploads ZIPs via SFTP to Amazon's DAR FTP.
"""
import base64
import glob
import logging
import os
import shutil

import pandas as pd

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


def _decode_password(config, section: str) -> str:
    pw = config.get(section, "sftp_password", fallback="") or config.get(section, "password", fallback="")
    if not pw:
        enc = config.get(section, "encrypted_password", fallback="")
        if enc:
            pw = base64.b64decode(enc).decode()
    return pw


@register_portal("audible")
class AudibleModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Audible"
        self.export_dir = self._get(sec, "export_dir", "/data/export/audible")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "host", "dar-eu.amazon-digital-ftp.com")
        self.port = config.getint(sec, "port", fallback=22)
        self.username = self._get(sec, "username", "deftp_dave")
        self.password = _decode_password(config, sec)
        self.remote_path = self._get(sec, "remote_path", "/")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        # Audible uses Excel (.xlsx) as metadata
        if metadata_path and os.path.isfile(metadata_path):
            meta_file = metadata_path
        else:
            xlsx_files = glob.glob(os.path.join(self.export_dir, "*.xlsx"))
            meta_file = xlsx_files[0] if xlsx_files else None

        if not meta_file:
            logger.error("Audible: No metadata Excel file found.")
            return transfers

        transfers.append(FileTransfer(
            ean=None,
            file_name=os.path.basename(meta_file),
            file_type="metadata",
            source_path=meta_file,
            destination=f"{self.remote_path}{os.path.basename(meta_file)}",
            file_size_bytes=os.path.getsize(meta_file),
        ))

        eans = self._extract_eans_from_excel(meta_file)
        logger.info(f"Audible: Found {len(eans)} EANs in Excel")

        for ean in eans:
            zip_src = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(zip_src):
                logger.warning(f"Audible: ZIP not found for EAN {ean}")
                continue
            zip_dest = os.path.join(self.export_dir, f"{ean}.zip")
            if zip_src != zip_dest:
                shutil.copy2(zip_src, zip_dest)

            transfers.append(FileTransfer(
                ean=ean,
                file_name=f"{ean}.zip",
                file_type="zip",
                source_path=zip_dest,
                destination=f"{self.remote_path}{ean}.zip",
                file_size_bytes=os.path.getsize(zip_dest),
            ))

        return transfers

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        with sftp_connection(self.host, self.port, self.username, self.password) as sftp:
            for t in transfers:
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
                    logger.error(f"Audible: Upload failed for {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    def _extract_eans_from_excel(self, path: str) -> list[str]:
        try:
            df = pd.read_excel(path, dtype=str)
            for col in ["EAN", "ISBN", "ASIN", "ProductID", "ID"]:
                if col in df.columns:
                    return df[col].dropna().tolist()
            # Fallback: first column
            return df.iloc[:, 0].dropna().tolist()
        except Exception as e:
            logger.error(f"Audible: Excel parse error: {e}")
            return []


@register_portal("audible_moa")
class AudibleMoAModule(BasePortalModule):
    """Audible MoA (Meldung ohne Audio) — metadata-only upload."""

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Audible_MoA"
        self.export_dir = self._get(sec, "export_dir", "/data/export/audible")
        self.host = self._get(sec, "host", "dar-eu.amazon-digital-ftp.com")
        self.port = config.getint(sec, "port", fallback=22)
        self.username = self._get(sec, "username", "deftp_dave")
        self.password = _decode_password(config, sec)
        self.remote_path = self._get(sec, "remote_path", "/metadata/")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        transfers: list[FileTransfer] = []
        if metadata_path and os.path.isfile(metadata_path):
            transfers.append(FileTransfer(
                ean=None,
                file_name=os.path.basename(metadata_path),
                file_type="metadata",
                source_path=metadata_path,
                destination=f"{self.remote_path}{os.path.basename(metadata_path)}",
                file_size_bytes=os.path.getsize(metadata_path),
            ))
        return transfers

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        with sftp_connection(self.host, self.port, self.username, self.password) as sftp:
            for t in transfers:
                try:
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "uploading")
                    sftp_upload(sftp, t.source_path, t.destination,
                        progress_cb=lambda cur, tot: progress_cb(
                            run_id, t.ean, t.file_name, t.file_type, cur, tot, "uploading"
                        ))
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, t.file_size_bytes, t.file_size_bytes, "success")
                except Exception as e:
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))


@register_portal("audible_fulfill")
class AudibleFulfillModule(AudibleModule):
    """Audible Preorder Fulfill — same as standard but different config section."""

    def __init__(self, config, portal_name):
        BasePortalModule.__init__(self, config, portal_name)
        sec = "Portal_Audible_Fullfill"
        self.export_dir = self._get(sec, "export_dir", "/data/export/audible")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "host", "dar-eu.amazon-digital-ftp.com")
        self.port = config.getint(sec, "port", fallback=22)
        self.username = self._get(sec, "username", "deftp_dave")
        self.password = _decode_password(config, sec)
        self.remote_path = self._get(sec, "remote_path", "/")
