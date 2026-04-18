import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel


# --- WebSocket Events ---

class ProgressEvent(BaseModel):
    type: Literal["progress"] = "progress"
    run_id: str
    portal: str
    ean: str | None = None
    file_name: str
    file_type: str
    current_bytes: int = 0
    total_bytes: int = 0
    status: Literal["uploading", "success", "failed", "skipped"]
    error: str | None = None


class RunUpdateEvent(BaseModel):
    type: Literal["run_update"] = "run_update"
    run_id: str
    portal: str
    status: Literal["running", "completed", "failed", "cancelled"]
    total_files: int = 0
    completed_files: int = 0
    failed_files: int = 0
    skipped_files: int = 0


# --- API Schemas ---

class DeliveryLogOut(BaseModel):
    id: int
    run_id: uuid.UUID
    portal: str
    ean: str | None
    file_type: str
    file_name: str | None
    destination: str | None
    status: str
    error_log: str | None
    file_size_bytes: int | None
    created_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class DeliveryRunOut(BaseModel):
    id: uuid.UUID
    portal: str
    metadata_filename: str | None
    initiated_by: str | None
    status: str
    total_files: int
    completed_files: int
    failed_files: int
    skipped_files: int
    started_at: datetime
    finished_at: datetime | None
    mail_draft: dict | None = None

    model_config = {"from_attributes": True}


class DeliveryRunDetail(DeliveryRunOut):
    logs: list[DeliveryLogOut] = []


class StartRunRequest(BaseModel):
    portal: str
    metadata_filename: str | None = None
