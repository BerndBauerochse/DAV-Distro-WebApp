"""
Bookwire portal module.
Reads ONIX XML, finds matching ZIPs in source_dir, uploads via SFTP.
"""
import base64
import glob
import logging
import os
import uuid
import zipfile

from lxml import etree

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("bookwire")
class BookwireModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Bookwire"
        self.export_dir = self._get(sec, "export_dir", "/data/export/bookwire")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.sftp_host = self._get(sec, "sftp_host", "ftp.bookwire.de")
        self.sftp_port = config.getint(sec, "sftp_port", fallback=22)
        self.sftp_username = self._get(sec, "sftp_username", "DerAudioVerlag")
        pw = self._get(sec, "sftp_password")
        if not pw:
            pw_b64 = self._get(sec, "sftp_password_base64")
            pw = base64.b64decode(pw_b64).decode() if pw_b64 else ""
        self.sftp_password = pw
        self.remote_dir = self._get(sec, "remote_dir", "/assets")
        self.remote_dir_xml = self._get(sec, "remote_dir_xml", "/xml")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        # --- Find XML ---
        if metadata_path and os.path.isfile(metadata_path):
            xml_path = metadata_path
        else:
            xml_files = glob.glob(os.path.join(self.export_dir, "*.xml"))
            xml_path = xml_files[0] if xml_files else None

        if not xml_path:
            raise RuntimeError(
                f"Keine XML-Metadatei gefunden. Bitte eine XML-Datei hochladen "
                f"oder in '{self.export_dir}' ablegen."
            )

        transfers.append(FileTransfer(
            ean=None,
            file_name=os.path.basename(xml_path),
            file_type="metadata",
            source_path=xml_path,
            destination=f"{self.remote_dir_xml}/{os.path.basename(xml_path)}",
            file_size_bytes=os.path.getsize(xml_path),
        ))

        # --- Extract EANs from ONIX XML ---
        eans = self._extract_eans(xml_path)
        logger.info(f"Bookwire: Found {len(eans)} EANs in XML")

        for ean in eans:
            zip_src = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(zip_src):
                logger.warning(f"Bookwire: ZIP not found for EAN {ean}: {zip_src}")
                continue

            # Copy/transform to export dir
            zip_dest = os.path.join(self.export_dir, f"{ean}.zip")
            self._prepare_zip(zip_src, zip_dest, ean)

            transfers.append(FileTransfer(
                ean=ean,
                file_name=os.path.basename(zip_dest),
                file_type="zip",
                source_path=zip_dest,
                destination=f"{self.remote_dir}/{ean}.zip",
                file_size_bytes=os.path.getsize(zip_dest),
            ))

        return transfers

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        with sftp_connection(self.sftp_host, self.sftp_port, self.sftp_username, self.sftp_password) as sftp:
            for t in transfers:
                remote_dir = os.path.dirname(t.destination)
                try:
                    sftp.stat(remote_dir)
                except FileNotFoundError:
                    sftp.mkdir(remote_dir)

                try:
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "uploading")

                    sftp_upload(
                        sftp, t.source_path, t.destination,
                        progress_cb=lambda cur, tot: progress_cb(
                            run_id, t.ean, t.file_name, t.file_type, cur, tot, "uploading"
                        ),
                    )
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, t.file_size_bytes, t.file_size_bytes, "success")
                    logger.info(f"Bookwire: Uploaded {t.file_name}")

                except Exception as e:
                    logger.error(f"Bookwire: Failed to upload {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    def _extract_eans(self, xml_path: str) -> list[str]:
        try:
            with open(xml_path, "rb") as f:
                tree = etree.parse(f)
            ns = {"ns": "http://ns.editeur.org/onix/3.0/reference"}
            nodes = tree.xpath(
                '//ns:Product/ns:ProductIdentifier[ns:ProductIDType="15"]/ns:IDValue',
                namespaces=ns,
            )
            return [n.text for n in nodes if n.text]
        except Exception as e:
            raise RuntimeError(f"XML-Parsefehler in '{xml_path}': {e}") from e

    def _prepare_zip(self, src: str, dest: str, ean: str) -> None:
        """Copy ZIP to export dir. Could be extended for transformations."""
        if src != dest:
            import shutil
            shutil.copy2(src, dest)
