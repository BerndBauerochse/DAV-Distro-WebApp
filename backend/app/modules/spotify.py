"""Spotify (Findaway) portal module — SFTP upload."""
import glob
import logging
import os
import shutil

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_makedirs, sftp_upload
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

    def _resolve_metadata(self, metadata_path: str | None) -> str | None:
        """Liefert die zu verwendende Metadatei: die hochgeladene, sonst die
        erste passende Datei im Export-Ordner."""
        if metadata_path and os.path.isfile(metadata_path):
            return metadata_path
        files = glob.glob(os.path.join(self.export_dir, "*.xml")) + \
                glob.glob(os.path.join(self.export_dir, "*.xlsx"))
        return files[0] if files else None

    def _metadata_transfer(self, meta: str) -> FileTransfer:
        """Metadatei-Transfer ins Wurzelverzeichnis, mit Findaway-Umbenennung."""
        local_name = os.path.basename(meta)
        remote_name = local_name.replace("Spotify_Novis_DAV_onix3-", "dav-onix3_")
        return FileTransfer(
            ean=None, file_name=local_name,
            file_type="metadata", source_path=meta,
            destination=f"/{remote_name}",
            file_size_bytes=os.path.getsize(meta),
        )

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        meta = self._resolve_metadata(metadata_path)
        if not meta:
            logger.error("Spotify: No metadata file found.")
            return transfers

        transfers.append(self._metadata_transfer(meta))

        eans = self._extract_eans(meta)
        for ean in eans:
            src = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(src):
                continue
            dest = os.path.join(self.export_dir, f"{ean}.zip")
            if src != dest:
                shutil.copy2(src, dest)
            cover_swapped = self._swap_cover_in_zip(dest, ean)
            transfers.append(FileTransfer(
                ean=ean, file_name=f"{ean}.zip", file_type="zip",
                source_path=dest, destination=f"/{ean}.zip",
                file_size_bytes=os.path.getsize(dest),
                injected_files=[(f"{ean}.jpg", "cover")] if cover_swapped else [],
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

    def check_missing(self, metadata_path: str | None) -> list[str]:
        if not metadata_path or not os.path.isfile(metadata_path):
            return []
        try:
            eans = self._extract_eans(metadata_path)
        except Exception:
            return []
        return [e for e in eans if not os.path.isfile(os.path.join(self.source_dir, f"{e}.zip"))]

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


@register_portal("spotify_moa")
class SpotifyMoAModule(SpotifyModule):
    """
    Spotify MoA (Meldung ohne Audio/Assets).
    Pro Titel ein eigener Ordner /{EAN}/ auf dem Findaway-SFTP, der sowohl
    die Metadatei (Kopie, gleiche Umbenennung wie Standard-Kanal) als auch
    das Cover ({ean}.jpg) enthält. Keine ZIPs, keine Audiodaten, keine Mail.
    """

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Spotify_MoA"
        # Eigener Abschnitt ist optional — ohne ihn gelten die Standard-Spotify-Werte.
        self.export_dir = self._get(sec, "export_dir", self.export_dir)
        self.host = self._get(sec, "sftp_host", self.host)
        self.port = config.getint(sec, "sftp_port", fallback=self.port)
        self.username = self._get(sec, "sftp_username", self.username)
        self.password = self._get(sec, "sftp_password", self.password)
        self.covers_dir = self._get(
            sec, "covers_dir",
            os.path.join(os.getenv("STORAGE_DIR", "/storage"), "covers"),
        )

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        meta = self._resolve_metadata(metadata_path)
        if not meta:
            logger.error("Spotify MoA: Keine Metadatei gefunden.")
            return transfers

        # Gleiche Umbenennung wie beim Standard-Kanal (Spotify_Novis_DAV_onix3- -> dav-onix3_)
        meta_filename = os.path.basename(meta).replace("Spotify_Novis_DAV_onix3-", "dav-onix3_")

        for ean in self._extract_eans(meta):
            transfers.append(FileTransfer(
                ean=ean, file_name=meta_filename, file_type="metadata",
                source_path=meta,
                destination=f"/{ean}/{meta_filename}",
                file_size_bytes=os.path.getsize(meta),
            ))

            jpg_path = os.path.join(self.covers_dir, f"{ean}.jpg")
            if not os.path.isfile(jpg_path):
                logger.warning(f"Spotify MoA: Cover nicht gefunden für {ean}: {jpg_path}")
                continue
            transfers.append(FileTransfer(
                ean=ean, file_name=f"{ean}.jpg", file_type="cover",
                source_path=jpg_path,
                destination=f"/{ean}/{ean}.jpg",
                file_size_bytes=os.path.getsize(jpg_path),
            ))

        return transfers

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        with sftp_connection(self.host, self.port, self.username, self.password) as sftp:
            remote_dirs = {os.path.dirname(t.destination) for t in transfers}
            for d in sorted(remote_dirs):
                sftp_makedirs(sftp, d)
            for t in transfers:
                try:
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "uploading")
                    sftp_upload(sftp, t.source_path, t.destination,
                        progress_cb=lambda cur, tot: progress_cb(
                            run_id, t.ean, t.file_name, t.file_type, cur, tot, "uploading"
                        ))
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, t.file_size_bytes, t.file_size_bytes, "success")
                except Exception as e:
                    logger.error(f"Spotify MoA: Upload fehlgeschlagen {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    def check_missing(self, metadata_path: str | None) -> list[str]:
        if not metadata_path or not os.path.isfile(metadata_path):
            return []
        try:
            eans = self._extract_eans(metadata_path)
        except Exception:
            return []
        return [e for e in eans if not os.path.isfile(os.path.join(self.covers_dir, f"{e}.jpg"))]
