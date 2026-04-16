"""
Shared SFTP/FTP upload helpers with progress callback support.
"""
import ftplib
import logging
import os
from contextlib import contextmanager
from typing import Callable

import paramiko

logger = logging.getLogger(__name__)

ProgressCb = Callable[[int, int], None]  # (current_bytes, total_bytes)


@contextmanager
def sftp_connection(host: str, port: int, username: str, password: str):
    transport = paramiko.Transport((host, port))
    sftp = None
    try:
        transport.connect(username=username, password=password)
        sftp = paramiko.SFTPClient.from_transport(transport)
        yield sftp
    finally:
        if sftp:
            sftp.close()
        transport.close()


def sftp_upload(
    sftp: paramiko.SFTPClient,
    local_path: str,
    remote_path: str,
    progress_cb: ProgressCb | None = None,
) -> str:
    """Upload a file via SFTP. Returns the FTP server response string."""
    file_size = os.path.getsize(local_path)
    transferred = [0]

    def _callback(sent, total):
        transferred[0] = sent
        if progress_cb:
            progress_cb(sent, total)

    sftp.put(local_path, remote_path, callback=_callback)
    return f"Upload OK: {os.path.basename(local_path)} ({file_size} bytes)"


@contextmanager
def ftp_connection(host: str, port: int, username: str, password: str):
    ftp = ftplib.FTP()
    ftp.connect(host, port)
    ftp.login(username, password)
    try:
        yield ftp
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


@contextmanager
def ftps_connection(host: str, port: int, username: str, password: str):
    """FTP with explicit TLS (FTPES) — same as FileZilla Protocol 4."""
    ftp = ftplib.FTP_TLS()
    ftp.connect(host, port)
    ftp.login(username, password)
    ftp.prot_p()  # encrypt the data channel
    try:
        yield ftp
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


def ftp_upload(
    ftp: ftplib.FTP,
    local_path: str,
    remote_filename: str,
    progress_cb: ProgressCb | None = None,
) -> str:
    """Upload a file via FTP with progress tracking."""
    file_size = os.path.getsize(local_path)
    transferred = [0]
    chunk_size = 65536

    def _callback(chunk: bytes):
        transferred[0] += len(chunk)
        if progress_cb:
            progress_cb(transferred[0], file_size)

    with open(local_path, "rb") as f:
        ftp.storbinary(f"STOR {remote_filename}", f, blocksize=chunk_size, callback=_callback)

    return f"226 Transfer complete: {remote_filename}"
