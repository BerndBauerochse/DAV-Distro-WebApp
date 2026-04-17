"""
Google portal module.
- Extracts each ZIP, renames MP3s to {ean}_{track}_of_{total}.mp3, repacks
- ZIPs → Google SFTP (partnerupload.google.com)
- XML  → intermediate SFTP server
"""
import base64
import glob
import logging
import os
import shutil
import tempfile
import zipfile

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)


@register_portal("google")
class GoogleModule(BasePortalModule):

    def __init__(self, config, portal_name):
        super().__init__(config, portal_name)
        sec = "Portal_Google"
        self.source_dir = os.path.join(os.getenv("STORAGE_DIR", "/storage"), "zips")
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
        self.xml_remote_dir = self._get(sec, "xml_remote_dir", "/onix/L0KYSE7-full")
        # Temp dir for processed ZIPs — set during get_files(), cleaned up after ship()
        self._workdir: str | None = None

    # ── get_files ─────────────────────────────────────────────────────────────

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        transfers: list[FileTransfer] = []

        # --- XML metadata ---
        if metadata_path and os.path.isfile(metadata_path):
            xml_path = metadata_path
        else:
            xml_files = glob.glob(os.path.join(self.source_dir, "*.xml"))
            xml_path = xml_files[0] if xml_files else None

        if not xml_path:
            logger.error("Google: Keine XML-Metadatei gefunden.")
            return transfers

        transfers.append(FileTransfer(
            ean=None,
            file_name=os.path.basename(xml_path),
            file_type="metadata",
            source_path=xml_path,
            destination=f"{self.xml_remote_dir}/{os.path.basename(xml_path)}",
            file_size_bytes=os.path.getsize(xml_path),
        ))

        eans = self._extract_eans(xml_path)
        if not eans:
            logger.warning("Google: Keine EANs in der XML gefunden.")
            return transfers

        # Work directory for processed ZIPs (survives until ship() finishes)
        self._workdir = tempfile.mkdtemp(prefix="google_")

        for ean in eans:
            src_zip = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(src_zip):
                logger.warning(f"Google: ZIP nicht gefunden: {src_zip}")
                continue

            processed_zip = self._prepare_zip(ean, src_zip)
            if processed_zip is None:
                continue

            transfers.append(FileTransfer(
                ean=ean,
                file_name=f"{ean}.zip",
                file_type="zip",
                source_path=processed_zip,
                destination=f"/{ean}.zip",
                file_size_bytes=os.path.getsize(processed_zip),
            ))

        return transfers

    def _prepare_zip(self, ean: str, src_zip: str) -> str | None:
        """
        1. Extract ZIP to a temp subfolder
        2. Rename every MP3: {ean}_{track[:3]}_of_{total}.mp3
           (track = first 3 chars of original filename, e.g. "001")
        3. Repack with files at ZIP root (no subfolder)
        Returns path to the new ZIP or None on error.
        """
        extract_dir = os.path.join(self._workdir, ean)
        os.makedirs(extract_dir, exist_ok=True)

        try:
            # Extract — ZIP typically contains a single subfolder named after the EAN
            with zipfile.ZipFile(src_zip, "r") as zf:
                zf.extractall(extract_dir)

            # Find the actual folder with the MP3 files (may be nested one level)
            mp3_root = _find_mp3_root(extract_dir)

            # Rename MP3s
            mp3_files = sorted(glob.glob(os.path.join(mp3_root, "*.mp3")))
            total = len(mp3_files)
            for mp3 in mp3_files:
                track = os.path.basename(mp3)[:3]
                new_name = f"{ean}_{track}_of_{total}.mp3"
                os.rename(mp3, os.path.join(mp3_root, new_name))

            # Repack: files flat at ZIP root
            out_zip = os.path.join(self._workdir, f"{ean}.zip")
            with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, _, files in os.walk(mp3_root):
                    for fname in files:
                        fpath = os.path.join(root, fname)
                        arcname = os.path.relpath(fpath, mp3_root)
                        zf.write(fpath, arcname)

            # Clean up extracted folder
            shutil.rmtree(extract_dir, ignore_errors=True)
            logger.info(f"Google: ZIP vorbereitet für {ean} ({total} MP3s)")
            return out_zip

        except Exception as e:
            logger.error(f"Google: Fehler beim Vorbereiten von {ean}: {e}")
            shutil.rmtree(extract_dir, ignore_errors=True)
            return None

    # ── ship ──────────────────────────────────────────────────────────────────

    def ship(self, run_id: str, transfers: list[FileTransfer], progress_cb: ProgressCallback) -> None:
        metadata = [t for t in transfers if t.file_type == "metadata"]
        zips = [t for t in transfers if t.file_type == "zip"]

        try:
            # Upload XML to intermediate server
            if metadata and self.xml_host:
                with sftp_connection(self.xml_host, self.xml_port, self.xml_user, self.xml_password) as sftp:
                    for t in metadata:
                        self._upload_one(sftp, t, run_id, progress_cb)

            # Upload processed ZIPs to Google
            if zips:
                with sftp_connection(self.zip_host, self.zip_port, self.zip_user, self.zip_password) as sftp:
                    for t in zips:
                        self._upload_one(sftp, t, run_id, progress_cb)
        finally:
            # Always clean up temp work directory
            if self._workdir and os.path.isdir(self._workdir):
                shutil.rmtree(self._workdir, ignore_errors=True)
                self._workdir = None

    def _upload_one(self, sftp, t: FileTransfer, run_id: str, progress_cb: ProgressCallback):
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
            logger.error(f"Google upload failed {t.file_name}: {e}")
            progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    # ── check_missing ─────────────────────────────────────────────────────────

    def check_missing(self, metadata_path: str | None) -> list[str]:
        if not metadata_path or not os.path.isfile(metadata_path):
            return []
        try:
            eans = self._extract_eans(metadata_path)
        except Exception:
            return []
        return [e for e in eans if not os.path.isfile(os.path.join(self.source_dir, f"{e}.zip"))]

    # ── helpers ───────────────────────────────────────────────────────────────

    def _extract_eans(self, xml_path: str) -> list[str]:
        try:
            from lxml import etree
            with open(xml_path, "rb") as f:
                tree = etree.parse(f)
            ns = {"ns": "http://ns.editeur.org/onix/3.0/reference"}
            nodes = tree.xpath(
                '//ns:Product/ns:ProductIdentifier[ns:ProductIDType="15"]/ns:IDValue',
                namespaces=ns,
            )
            return [n.text for n in nodes if n.text]
        except Exception as e:
            logger.error(f"Google XML parse error: {e}")
            return []


def _find_mp3_root(base_dir: str) -> str:
    """
    Return the directory that directly contains the MP3 files.
    The ZIP may extract to a single subfolder (e.g. base_dir/9783742441171/)
    or directly into base_dir. Walk one level to find MP3s.
    """
    # Check if there are MP3s directly in base_dir
    if glob.glob(os.path.join(base_dir, "*.mp3")):
        return base_dir
    # Otherwise look one level down
    for entry in os.listdir(base_dir):
        sub = os.path.join(base_dir, entry)
        if os.path.isdir(sub) and glob.glob(os.path.join(sub, "*.mp3")):
            return sub
    # Fallback: base_dir (even if no MP3s found, let the caller deal with it)
    return base_dir
