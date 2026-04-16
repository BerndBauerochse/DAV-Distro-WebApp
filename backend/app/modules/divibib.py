"""Divibib (Onleihe) portal module — FTP upload."""
import base64
import glob
import logging
import os
import shutil

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import ftp_connection, ftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("divibib")
class DivibibModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Divibib"
        self.export_dir = self._get(sec, "export_dir", "/data/export/divibib")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "ftp_host", "supplier-delivery.onleihe.de")
        self.port = config.getint(sec, "ftp_port", fallback=21)
        self.username = self._get(sec, "ftp_username", "dav")
        pw_b64 = self._get(sec, "ftp_password_base64")
        self.password = base64.b64decode(pw_b64).decode() if pw_b64 else self._get(sec, "ftp_password")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        if metadata_path and os.path.isfile(metadata_path):
            xml_path = metadata_path
        else:
            xml_files = glob.glob(os.path.join(self.export_dir, "*.xml"))
            xml_path = xml_files[0] if xml_files else None

        if xml_path:
            transfers.append(FileTransfer(
                ean=None, file_name=os.path.basename(xml_path),
                file_type="metadata", source_path=xml_path,
                destination=os.path.basename(xml_path),
                file_size_bytes=os.path.getsize(xml_path),
            ))
            eans = self._extract_eans(xml_path)
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
                source_path=dest, destination=f"{ean}.zip",
                file_size_bytes=os.path.getsize(dest),
            ))

        return transfers

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        with ftp_connection(self.host, self.port, self.username, self.password) as ftp:
            for t in transfers:
                try:
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "uploading")
                    ftp_upload(ftp, t.source_path, t.destination,
                        progress_cb=lambda cur, tot: progress_cb(
                            run_id, t.ean, t.file_name, t.file_type, cur, tot, "uploading"
                        ))
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, t.file_size_bytes, t.file_size_bytes, "success")
                except Exception as e:
                    logger.error(f"Divibib upload failed {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    def check_missing(self, metadata_path: str | None) -> list[str]:
        if not metadata_path or not os.path.isfile(metadata_path):
            return []
        try:
            eans = self._extract_eans(metadata_path)
        except Exception:
            return []
        return [e for e in eans if not os.path.isfile(os.path.join(self.source_dir, f"{e}.zip"))]

    def _extract_eans(self, xml_path: str) -> list[str]:
        try:
            from lxml import etree
            with open(xml_path, "rb") as f:
                tree = etree.parse(f)
            ns = {"ns": "http://ns.editeur.org/onix/3.0/reference"}
            nodes = tree.xpath('//ns:Product/ns:ProductIdentifier[ns:ProductIDType="15"]/ns:IDValue', namespaces=ns)
            return [n.text for n in nodes if n.text]
        except Exception as e:
            logger.error(f"Divibib XML parse error: {e}")
            return []
