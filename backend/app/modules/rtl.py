"""RTL+ portal module — SFTP upload."""
import base64
import glob
import logging
import os
import shutil

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("rtl")
class RTLModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_RTL+"
        self.export_dir = self._get(sec, "export_dir", "/data/export/rtl")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "sftp_host", "ftp-audiobooks.now-plus-prod.aws-cbc.cloud")
        self.port = config.getint(sec, "sftp_port", fallback=22)
        self.username = self._get(sec, "sftp_username", "dav")
        pw_b64 = self._get(sec, "sftp_password_base64")
        self.password = base64.b64decode(pw_b64).decode() if pw_b64 else self._get(sec, "sftp_password")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        if metadata_path and os.path.isfile(metadata_path):
            meta = metadata_path
        else:
            candidates = (
                glob.glob(os.path.join(self.export_dir, "*.xml")) +
                glob.glob(os.path.join(self.export_dir, "*.xlsx"))
            )
            meta = candidates[0] if candidates else None

        if meta:
            transfers.append(FileTransfer(
                ean=None, file_name=os.path.basename(meta),
                file_type="metadata", source_path=meta,
                destination=f"/{os.path.basename(meta)}",
                file_size_bytes=os.path.getsize(meta),
            ))
            eans = self._extract_eans(meta)
        else:
            eans = []

        for ean in eans:
            src = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(src):
                continue
            dest = os.path.join(self.export_dir, f"{ean}.zip")
            if src != dest:
                shutil.copy2(src, dest)
            transfers.append(FileTransfer(
                ean=ean, file_name=f"{ean}.zip", file_type="zip",
                source_path=dest, destination=f"/{ean}.zip",
                file_size_bytes=os.path.getsize(dest),
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
                    logger.error(f"RTL+ upload failed {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    def _extract_eans(self, path: str) -> list[str]:
        if path.endswith(".xlsx"):
            try:
                import pandas as pd
                df = pd.read_excel(path, dtype=str)
                for col in ["EAN", "ISBN", "ID"]:
                    if col in df.columns:
                        return df[col].dropna().tolist()
                return df.iloc[:, 0].dropna().tolist()
            except Exception as e:
                logger.error(f"RTL+ Excel parse error: {e}")
                return []
        try:
            from lxml import etree
            with open(path, "rb") as f:
                tree = etree.parse(f)
            ns = {"ns": "http://ns.editeur.org/onix/3.0/reference"}
            nodes = tree.xpath('//ns:Product/ns:ProductIdentifier[ns:ProductIDType="15"]/ns:IDValue', namespaces=ns)
            return [n.text for n in nodes if n.text]
        except Exception as e:
            logger.error(f"RTL+ XML parse error: {e}")
            return []
