import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, BigInteger, Integer, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.database import Base


class DeliveryRun(Base):
    __tablename__ = "delivery_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    portal: Mapped[str] = mapped_column(String, nullable=False, index=True)
    metadata_filename: Mapped[str | None] = mapped_column(String)
    initiated_by: Mapped[str | None] = mapped_column(String)
    takedown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="running")
    # running | completed | failed | cancelled
    total_files: Mapped[int] = mapped_column(Integer, default=0)
    completed_files: Mapped[int] = mapped_column(Integer, default=0)
    failed_files: Mapped[int] = mapped_column(Integer, default=0)
    skipped_files: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mail_draft:  Mapped[dict | None]     = mapped_column(JSONB, nullable=True)

    logs: Mapped[list["DeliveryLog"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class DeliveryLog(Base):
    __tablename__ = "delivery_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("delivery_runs.id"), nullable=False, index=True
    )
    portal: Mapped[str] = mapped_column(String, nullable=False, index=True)
    ean: Mapped[str | None] = mapped_column(String, index=True)
    file_type: Mapped[str] = mapped_column(String, nullable=False)
    # metadata | zip | transformed_zip | image
    file_name: Mapped[str | None] = mapped_column(String)
    source_path: Mapped[str | None] = mapped_column(Text)
    destination: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, nullable=False)
    # pending | uploading | success | failed | skipped
    error_log: Mapped[str | None] = mapped_column(Text)
    ftp_response: Mapped[str | None] = mapped_column(Text)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    run: Mapped["DeliveryRun"] = relationship(back_populates="logs")


class UserSettings(Base):
    __tablename__ = "user_settings"

    username: Mapped[str] = mapped_column(String, primary_key=True)
    # base64 data-URL of the user's avatar image, stored as text
    avatar_data: Mapped[str | None] = mapped_column(Text)
