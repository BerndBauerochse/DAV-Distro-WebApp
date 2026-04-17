"""
Audible portal module (standard + MoA + Fulfill).
Uploads ZIPs via SFTP to Amazon's DAR FTP.

Besonderheiten:
- Excel-Spalte: "ISBN of digital audiobook product that Audible will sell"
- ZIP-Name erhält Datum-Suffix: {ean}_{YYYYMMDD}.zip
- TOC-Dateien (*{ean}*.xlsx) aus toc_folder werden in ZIP unter {ean}/ eingefügt
- Mail-Entwurf mit HTML-Tabelle (Titel, ISBN, Laufzeit, Veröffentlichungsdatum)
"""
import base64
import glob
import logging
import os
import shutil
import zipfile
from datetime import datetime

import pandas as pd

from app.modules.base import BasePortalModule, FileTransfer, ProgressCallback
from app.modules.ftp_helper import sftp_connection, sftp_upload
from app.services.delivery_service import register_portal

logger = logging.getLogger(__name__)

_AUDIBLE_ISBN_COL = "ISBN of digital audiobook product that Audible will sell"

_REQUIRED_COLS = [
    "Length in minutes",
    "Book Description",
    "BISAC Category",
    "Content CopyrightYear (yyyy)",
    "Content CopyrightHolder",
    "Audiobook Copyright Year (yyyy)",
]


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
        self.toc_folder = os.path.join(os.getenv("STORAGE_DIR", "/storage"), "toc")
        self.host = self._get(sec, "host", "dar-eu.amazon-digital-ftp.com")
        self.port = config.getint(sec, "port", fallback=22)
        self.username = self._get(sec, "username", "deftp_dave")
        self.password = _decode_password(config, sec)
        self.remote_path = self._get(sec, "remote_path", "/")
        self._mail_draft_data: dict | None = None

    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        os.makedirs(self.export_dir, exist_ok=True)
        transfers: list[FileTransfer] = []

        # Find Excel
        if metadata_path and os.path.isfile(metadata_path):
            meta_file = metadata_path
        else:
            xlsx_files = glob.glob(os.path.join(self.export_dir, "*.xlsx"))
            meta_file = xlsx_files[0] if xlsx_files else None

        if not meta_file:
            logger.error("Audible: Keine Excel-Datei gefunden.")
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
        logger.info(f"Audible: {len(eans)} EANs in Excel gefunden")

        date_suffix = datetime.now().strftime("_%Y%m%d")

        for ean in eans:
            zip_src = os.path.join(self.source_dir, f"{ean}.zip")
            if not os.path.isfile(zip_src):
                logger.warning(f"Audible: ZIP nicht gefunden für EAN {ean}")
                continue

            # ZIP mit Datum-Suffix in export_dir kopieren
            zip_dest = os.path.join(self.export_dir, f"{ean}{date_suffix}.zip")
            shutil.copy2(zip_src, zip_dest)

            # TOC-Dateien in ZIP einfügen
            self._inject_toc(zip_dest, ean)

            transfers.append(FileTransfer(
                ean=ean,
                file_name=os.path.basename(zip_dest),
                file_type="zip",
                source_path=zip_dest,
                destination=f"{self.remote_path}{os.path.basename(zip_dest)}",
                file_size_bytes=os.path.getsize(zip_dest),
            ))

        # Mail-Entwurf vorbereiten
        self._mail_draft_data = self._build_mail_data(meta_file, eans)

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
                    logger.error(f"Audible: Upload fehlgeschlagen für {t.file_name}: {e}")
                    progress_cb(run_id, t.ean, t.file_name, t.file_type, 0, t.file_size_bytes, "failed", str(e))

    def check_missing(self, metadata_path: str | None) -> list[str]:
        if not metadata_path or not os.path.isfile(metadata_path):
            return []
        try:
            eans = self._extract_eans_from_excel(metadata_path)
        except Exception:
            return []
        return [e for e in eans if not os.path.isfile(os.path.join(self.source_dir, f"{e}.zip"))]

    def get_mail_draft(self) -> dict | None:
        return self._mail_draft_data

    # ------------------------------------------------------------------ helpers

    def _extract_eans_from_excel(self, path: str) -> list[str]:
        """Liest EANs aus der spezifischen Audible-Spalte."""
        try:
            df = pd.read_excel(path, dtype=str)
            if _AUDIBLE_ISBN_COL in df.columns:
                return df[_AUDIBLE_ISBN_COL].dropna().tolist()
            # Fallback auf generische Spaltennamen
            for col in ["EAN", "ISBN", "ASIN", "ProductID", "ID"]:
                if col in df.columns:
                    return df[col].dropna().tolist()
            return df.iloc[:, 0].dropna().tolist()
        except Exception as e:
            logger.error(f"Audible: Excel-Lesefehler: {e}")
            return []

    def _inject_toc(self, zip_path: str, ean: str) -> None:
        """Sucht TOC-Dateien (*{ean}*.xlsx) und fügt sie unter {ean}/ in die ZIP ein."""
        toc_files = glob.glob(os.path.join(self.toc_folder, f"*{ean}*.xlsx"))
        if not toc_files:
            logger.info(f"Audible: Keine TOC-Datei für {ean} gefunden — ZIP unverändert")
            return
        try:
            with zipfile.ZipFile(zip_path, "a") as zf:
                for toc_file in toc_files:
                    arcname = f"{ean}/{os.path.basename(toc_file)}"
                    zf.write(toc_file, arcname=arcname)
                    logger.info(f"Audible: TOC eingefügt: {os.path.basename(toc_file)} → {arcname}")
        except Exception as e:
            logger.error(f"Audible: Fehler beim TOC-Einfügen in {zip_path}: {e}")

    def _build_mail_data(self, excel_path: str, eans: list[str]) -> dict | None:
        """Baut den Mail-Entwurf mit HTML-Tabelle und Metadaten-Prüfung."""
        try:
            df_full = pd.read_excel(excel_path)

            # Vollständigkeitsprüfung
            warnings = []
            for _, row in df_full.iterrows():
                missing = [c for c in _REQUIRED_COLS if c in df_full.columns and pd.isnull(row.get(c))]
                if missing:
                    title = row.get("Title", row.get("title", "Unbekannt"))
                    warnings.append(f'Metadaten von "{title}" unvollständig.')
            unique_warnings = "<br>".join(set(warnings))

            # Tabellenspalten für die Mail
            col_map = {
                "Title": ["Title", "title"],
                "ISBN/EAN": [_AUDIBLE_ISBN_COL, "EAN", "ISBN"],
                "Laufzeit (Min.)": ["Length in minutes", "Running time (in minutes)"],
                "Veröffentlichung": ["Release date", "Audiobook pub date (mm/dd/yyyy)"],
            }
            table_data = {}
            for display, candidates in col_map.items():
                for c in candidates:
                    if c in df_full.columns:
                        table_data[display] = df_full[c].tolist()
                        break
                else:
                    table_data[display] = [""] * len(df_full)

            df_mail = pd.DataFrame(table_data)
            html_table = df_mail.to_html(index=False, border=1)

            count = len(eans)
            if count == 1:
                intro = "Here's a new title for you."
            else:
                intro = f"Here are {count} new titles for you."

            body = (
                f"Categories: Delivery<br><br>"
                f"Dear Audible team,<br><br>"
                f"{intro}<br><br>"
                f"{unique_warnings}<br><br>"
                f"{html_table}<br><br>"
                f"Please send me a confirmation that you are processing the data "
                f"and, if errors occur, an error message immediately.<br><br>"
                f"Thank you.<br>Bernd"
            )

            return {
                "to": "eu-delivery@audible.de; kurzke@audible.de",
                "subject": "Der Audio Verlag - Neuer Upload auf FTP",
                "body": body,
                "is_html": True,
            }
        except Exception as e:
            logger.error(f"Audible: Mail-Entwurf konnte nicht erstellt werden: {e}")
            return None


@register_portal("audible_moa")
class AudibleMoAModule(BasePortalModule):
    """Audible MoA (Meldung ohne Audio) — nur Metadatei hochladen."""

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
    """Audible Preorder Fulfill — wie Standard, aber eigener Config-Abschnitt."""

    def __init__(self, config, portal_name):
        BasePortalModule.__init__(self, config, portal_name)
        sec = "Portal_Audible_Fullfill"
        self.export_dir = self._get(sec, "export_dir", "/data/export/audible")
        self.source_dir = self._get(sec, "source_dir", "/data/source")
        self.toc_folder = os.path.join(os.getenv("STORAGE_DIR", "/storage"), "toc")
        self.host = self._get(sec, "host", "dar-eu.amazon-digital-ftp.com")
        self.port = config.getint(sec, "port", fallback=22)
        self.username = self._get(sec, "username", "deftp_dave")
        self.password = _decode_password(config, sec)
        self.remote_path = self._get(sec, "remote_path", "/")
        self._mail_draft_data: dict | None = None
