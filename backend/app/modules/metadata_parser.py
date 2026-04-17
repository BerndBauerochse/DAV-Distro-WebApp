"""
Metadata parser — erkennt Portal aus Dateiname, extrahiert Buchtitel/Autor/Kürzel
und prüft ZIP-Verfügbarkeit auf dem Server.

Unterstützte Formate:
  ONIX 3 XML  — Bookwire, Bookbeat, Google, RTL, Spotify, Divibib
  Audible     — Excel (.xlsx)
  Zebra       — Excel (.xlsx, header-Zeile 6 / Index 5)
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Datenstrukturen
# ---------------------------------------------------------------------------

@dataclass
class BookInfo:
    ean: str
    title: str
    author: str
    abridged: bool | None   # True=Gekürzt, False=Ungekürzt, None=unbekannt
    zip_available: bool


@dataclass
class BatchPreview:
    filename: str
    detected_portal: str
    portal_variants: list[dict]   # [{"key": "bookwire", "label": "Standard"}, ...]
    books: list[BookInfo]


# ---------------------------------------------------------------------------
# Portal-Erkennung aus Dateiname
# ---------------------------------------------------------------------------

_PREFIX_MAP = {
    "audible":   "audible",
    "bookbeat":  "bookbeat",
    "bookwire":  "bookwire",
    "zebra":     "zebra",
    "google":    "google",
    "rtl":       "rtl",
    "spotify":   "spotify",
    "divibib":   "divibib",
}

_PORTAL_VARIANTS: dict[str, list[dict]] = {
    "audible": [
        {"key": "audible",         "label": "Standard"},
        {"key": "audible_moa",     "label": "MoA (ohne Audio)"},
        {"key": "audible_fulfill", "label": "Preorder Fulfill"},
    ],
    "bookwire": [
        {"key": "bookwire",     "label": "Standard"},
        {"key": "bookwire_moa", "label": "MoA (Cover)"},
    ],
}

_FORM_DETAIL_MAP = {
    "A101": True,   # Abridged  → Gekürzt
    "A103": False,  # Unabridged → Ungekürzt
}


def detect_portal(filename: str) -> str:
    """Erkennt das Portal anhand des Dateinamens (Präfix, case-insensitive)."""
    lower = filename.lower()
    for prefix, portal in _PREFIX_MAP.items():
        if lower.startswith(prefix):
            return portal
    return "unknown"


def get_portal_variants(portal: str) -> list[dict]:
    return _PORTAL_VARIANTS.get(portal, [{"key": portal, "label": "Standard"}])


# ---------------------------------------------------------------------------
# Haupt-Parser
# ---------------------------------------------------------------------------

def parse_metadata(file_path: str, filename: str, source_dir: str) -> BatchPreview:
    portal = detect_portal(filename)
    lower = filename.lower()

    if lower.endswith(".xml"):
        books = _parse_onix_xml(file_path, source_dir)
    elif lower.endswith(".xlsx") or lower.endswith(".xls"):
        if portal == "zebra":
            books = _parse_zebra_excel(file_path, source_dir)
        else:
            books = _parse_audible_excel(file_path, source_dir)
    else:
        books = []

    return BatchPreview(
        filename=filename,
        detected_portal=portal,
        portal_variants=get_portal_variants(portal),
        books=books,
    )


# ---------------------------------------------------------------------------
# ONIX 3 XML
# ---------------------------------------------------------------------------

def _parse_onix_xml(file_path: str, source_dir: str) -> list[BookInfo]:
    import xml.etree.ElementTree as ET
    ns = {"ns": "http://ns.editeur.org/onix/3.0/reference"}
    books: list[BookInfo] = []

    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
        products = root.findall(".//ns:Product", ns)

        for p in products:
            # EAN
            ean_el = p.find(
                './/ns:ProductIdentifier[ns:ProductIDType="15"]/ns:IDValue', ns
            )
            if ean_el is None or not ean_el.text:
                continue
            ean = ean_el.text.strip()

            # Titel
            title_el = p.find(
                ".//ns:TitleDetail/ns:TitleElement/ns:TitleText", ns
            )
            title = title_el.text.strip() if title_el is not None and title_el.text else ""

            # Autor (ContributorRole A01)
            author = _onix_author(p, ns)

            # Gekürzt / Ungekürzt
            fd_el = p.find(".//ns:ProductFormDetail", ns)
            abridged = _FORM_DETAIL_MAP.get(fd_el.text.strip(), None) if fd_el is not None and fd_el.text else None

            zip_available = os.path.isfile(os.path.join(source_dir, f"{ean}.zip"))

            books.append(BookInfo(
                ean=ean, title=title, author=author,
                abridged=abridged, zip_available=zip_available,
            ))

    except Exception as e:
        logger.error(f"ONIX XML parse error: {e}")

    return books


def _onix_author(product, ns: dict) -> str:
    """Extracts first A01 contributor name."""
    contrib = product.find('.//ns:Contributor[ns:ContributorRole="A01"]', ns)
    if contrib is None:
        return ""
    first = contrib.find("ns:NamesBeforeKey", ns)
    last  = contrib.find("ns:KeyNames", ns)
    if first is not None and last is not None:
        return f"{first.text} {last.text}".strip()
    full = contrib.find("ns:PersonName", ns)
    if full is not None and full.text:
        return full.text.strip()
    return ""


# ---------------------------------------------------------------------------
# Audible Excel
# ---------------------------------------------------------------------------

_AUDIBLE_ISBN_COL  = "ISBN of digital audiobook product that Audible will sell"
_AUDIBLE_TITLE_COL = "Title"
_AUDIBLE_FNAME_COL = "Author First Name"
_AUDIBLE_LNAME_COL = "Author Last Name"
_AUDIBLE_ABRIDGED_COL = "Abridged /  Unabridged"   # note double-space


def _parse_audible_excel(file_path: str, source_dir: str) -> list[BookInfo]:
    import pandas as pd
    books: list[BookInfo] = []
    try:
        df = pd.read_excel(file_path, dtype=str)
        for _, row in df.iterrows():
            ean = str(row.get(_AUDIBLE_ISBN_COL, "")).strip()
            if not ean or ean == "nan":
                continue
            title  = str(row.get(_AUDIBLE_TITLE_COL, "")).strip()
            fname  = str(row.get(_AUDIBLE_FNAME_COL, "")).strip()
            lname  = str(row.get(_AUDIBLE_LNAME_COL, "")).strip()
            author = f"{fname} {lname}".strip()
            raw_ab = str(row.get(_AUDIBLE_ABRIDGED_COL, "")).strip().lower()
            if "abridged" in raw_ab and "unabridged" not in raw_ab:
                abridged: bool | None = True
            elif "unabridged" in raw_ab:
                abridged = False
            else:
                abridged = None
            zip_available = os.path.isfile(os.path.join(source_dir, f"{ean}.zip"))
            books.append(BookInfo(
                ean=ean, title=title, author=author,
                abridged=abridged, zip_available=zip_available,
            ))
    except Exception as e:
        logger.error(f"Audible Excel parse error: {e}")
    return books


# ---------------------------------------------------------------------------
# Zebra Excel
# ---------------------------------------------------------------------------

def _parse_zebra_excel(file_path: str, source_dir: str) -> list[BookInfo]:
    import pandas as pd
    books: list[BookInfo] = []
    try:
        df = pd.read_excel(file_path, header=5, dtype=str)
        for _, row in df.iterrows():
            raw_ean = str(row.get("AlbumEAN_UPC", "")).strip()
            if not raw_ean or raw_ean == "nan":
                continue
            try:
                ean = str(int(float(raw_ean)))
            except (ValueError, TypeError):
                ean = raw_ean
            title  = str(row.get("AlbumTitle_SeriesTitle", "")).strip()
            author = str(row.get("InfoAuthors", "")).strip()
            raw_ab = str(row.get("InfoMediaVariant", "")).strip().lower()
            if "gekürzt" in raw_ab or "gek\u00fcrzt" in raw_ab:
                abridged: bool | None = True
            elif "ungekürzt" in raw_ab or "ungek\u00fcrzt" in raw_ab:
                abridged = False
            else:
                abridged = None
            zip_available = os.path.isfile(os.path.join(source_dir, f"{ean}.zip"))
            books.append(BookInfo(
                ean=ean, title=title, author=author,
                abridged=abridged, zip_available=zip_available,
            ))
    except Exception as e:
        logger.error(f"Zebra Excel parse error: {e}")
    return books
