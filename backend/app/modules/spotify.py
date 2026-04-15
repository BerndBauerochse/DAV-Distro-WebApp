"""Spotify (Findaway) portal module — SFTP upload."""
import glob
import logging
import os
import shutil

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("spotify")
class SpotifyModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Spotify"
        self.export_dir = self._get(sec, "export_dir", "/data/export/spotify")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.host = self._get(sec, "sftp_host", "sftp.findaway.com")
        self.port = config.getint(sec, "sftp_port", fallback=2222)
        self.username = self._get(sec, "sftp_username", "deraudioverlagdig")
        self.password = self._get(sec, "sftp_password")

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        if metadata_path and os.path.isfile(metadata_path):
            meta = metadata_path
        else:
            files = glob.glob(os.path.join(self.export_dir, "*.xml")) + \
                    glob.glob(os.path.join(self.export_dir, "*.xlsx"))
            meta = files[0] if files else None

        if not meta:
            logger.error("Spotify: No metadata file found.")
            return transfers

        transfers.append(FileTransfer(
            ean=None, file_name=os.path.basename(meta),
            file_type="metadata", source_path=meta,
            destination=f"/{os.path.basename(meta)}",
            file_size_bytes=os.path.getsize(meta),
        ))

        eans = self._extract_eans(meta)
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
                    logger.error(f"Spotify upload failed {t.file_name}: {e}")
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
                logger.error(f"Spotify Excel parse error: {e}")
                return []
        # XML fallback
        try:
            from lxml import etree
            with open(path, "rb") as f:
                tree = etree.parse(f)
            ns = {"ns": "http://ns.editeur.org/onix/3.0/reference"}
            nodes = tree.xpath('//ns:Product/ns:ProductIdentifier[ns:ProductIDType="15"]/ns:IDValue', namespaces=ns)
            return [n.text for n in nodes if n.text]
        except Exception as e:
            logger.error(f"Spotify XML parse error: {e}")
            return []
