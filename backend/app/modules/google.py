"""Google portal module — dual SFTP: ZIPs to Google, XML to intermediate server."""
import base64
import glob
import logging
import os
import shutil

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("google")
class GoogleModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Google"
        self.export_dir = self._get(sec, "export_dir", "/data/export/google")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        # ZIP SFTP
        self.zip_host = self._get(sec, "zip_sftp_host", "partnerupload.google.com")
        self.zip_port = config.getint(sec, "zip_sftp_port", fallback=19321)
        self.zip_user = self._get(sec, "zip_sftp_username")
        pw_b64 = self._get(sec, "zip_sftp_password_base64")
        self.zip_password = base64.b64decode(pw_b64).decode() if pw_b64 else self._get(sec, "zip_sftp_password")
        # XML SFTP
        self.xml_host = self._get(sec, "xml_sftp_host")
        self.xml_port = config.getint(sec, "xml_sftp_port", fallback=22)
        self.xml_user = self._get(sec, "xml_sftp_username")
        self.xml_password = self._get(sec, "xml_sftp_password")
        self.xml_remote_dir = self._get(sec, "xml_remote_dir", "/onix")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        if metadata_path and os.path.isfile(metadata_path):
            xml_path = metadata_path
        else:
            xml_files = glob.glob(os.path.join(self.export_dir, "*.xml"))
            xml_path = xml_files[0] if xml_files else None

        if not xml_path:
            logger.error("Google: No XML found.")
            return transfers

        # XML goes to XML SFTP server
        transfers.append(FileTransfer(
            ean=None, file_name=os.path.basename(xml_path),
            file_type="metadata", source_path=xml_path,
            destination=f"{self.xml_remote_dir}/{os.path.basename(xml_path)}",
            file_size_bytes=os.path.getsize(xml_path),
        ))

        eans = self._extract_eans(xml_path)
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
        # Split: metadata → XML server, ZIPs → Google SFTP
        metadata = [t for t in transfers if t.file_type == "metadata"]
        zips = [t for t in transfers if t.file_type != "metadata"]

        # Upload XML metadata
        if metadata and self.xml_host:
            with sftp_connection(self.xml_host, self.xml_port, self.xml_user, self.xml_password) as sftp:
                for t in metadata:
                    self._upload_one(sftp, t, run_id, progress_cb)

        # Upload ZIPs
        if zips:
            with sftp_connection(self.zip_host, self.zip_port, self.zip_user, self.zip_password) as sftp:
                for t in zips:
                    self._upload_one(sftp, t, run_id, progress_cb)

    def _upload_one(self, sftp, t: FileTransfer, run_id: str, progress_cb: ProgressCallback):
        try:
            progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "uploading")
            sftp_upload(sftp, t.source_path, t.destination,
                progress_cb=lambda cur, tot: progress_cb(
                    run_id, t.ean, t.file_name, t.file_type, cur, tot, "uploading"
                ))
            progress_cb(run_id, t.ean, t.file_name, t.file_type, t.file_size_bytes, t.file_size_bytes, "success")
        except Exception as e:
            logger.error(f"Google upload failed {t.file_name}: {e}")
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
            logger.error(f"Google XML parse error: {e}")
            return []
