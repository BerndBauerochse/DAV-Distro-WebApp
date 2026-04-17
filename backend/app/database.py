import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://dav:dav@localhost:5432/dav_distro"
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migration: add mail_draft column to existing deployments
        await conn.execute(text(
            "ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS mail_draft JSONB"
        ))


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
