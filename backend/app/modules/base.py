"""
Base class for all portal delivery modules.
Each module must implement get_files() and ship().
Progress is reported via the progress_callback.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable
import configparser


@dataclass
class FileTransfer:
    ean: str | None
    file_name: str
    file_type: str          # metadata | zip | transformed_zip | image
    source_path: str
    destination: str
    file_size_bytes: int = 0


ProgressCallback = Callable[[str, str, str, str, int, int, str, str | None], None]
# args: run_id, ean, file_name, file_type, current_bytes, total_bytes, status, error


class BasePortalModule(ABC):
    """
    Base class for portal delivery modules.

    Subclasses implement:
      - get_files(run_id, metadata_path) -> list[FileTransfer]
          Assembles the files to be transferred.
      - ship(run_id, transfers, progress_cb) -> None
          Performs the actual FTP/SFTP upload.
    """

    def __init__(self, config: configparser.ConfigParser, portal_name: str):
        self.config = config
        self.portal_name = portal_name

    @abstractmethod
    def get_files(self, run_id: str, metadata_path: str | None) -> list[FileTransfer]:
        """Collect and prepare files for upload. Returns list of FileTransfer."""
        ...

    @abstractmethod
    def ship(
        self,
        run_id: str,
        transfers: list[FileTransfer],
        progress_cb: ProgressCallback,
    ) -> None:
        """Upload files to the portal. Call progress_cb for each file."""
        ...

    def _get(self, section: str, key: str, fallback: str = "") -> str:
        return self.config.get(section, key, fallback=fallback)
