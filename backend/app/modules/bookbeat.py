"""Bookbeat portal module — SFTP upload."""
import base64
import glob
import logging
import os
import shutil

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.modules.bookwire import BookwireModule  # reuse _extract_eans
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("bookbeat")
class BookbeatModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Bookbeat"
        self.export_dir = self._get(sec, "export_dir", "/data/export/bookbeat")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "sftp_host", "sftp-upload.bookbeat.com")
        self.port = config.getint(sec, "sftp_port", fallback=22)
        self.username = self._get(sec, "sftp_username", "prodbbsftp.deraudioverlag")
        pw_b64 = self._get(sec, "sftp_password_base64")
        self.password = base64.b64decode(pw_b64).decode() if pw_b64 else self._get(sec, "sftp_password")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        if metadata_path and os.path.isfile(metadata_path):
            xml_path = metadata_path
        else:
            xml_files = glob.glob(os.path.join(self.export_dir, "*.xml"))
            xml_path = xml_files[0] if xml_files else None

        if not xml_path:
            logger.error("Bookbeat: No XML found.")
            return transfers

        transfers.append(FileTransfer(
            ean=None, file_name=os.path.basename(xml_path),
            file_type="metadata", source_path=xml_path,
            destination=f"/{os.path.basename(xml_path)}",
            file_size_bytes=os.path.getsize(xml_path),
        ))

        from lxml import etree
        try:
            with open(xml_path, "rb") as f:
                tree = etree.parse(f)
            ns = {"ns": "http://ns.editeur.org/onix/3.0/reference"}
            nodes = tree.xpath('//ns:Product/ns:ProductIdentifier[ns:ProductIDType="15"]/ns:IDValue', namespaces=ns)
            eans = [n.text for n in nodes if n.text]
        except Exception as e:
            logger.error(f"Bookbeat XML parse error: {e}")
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
                    logger.error(f"Bookbeat upload failed {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))
