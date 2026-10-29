"""Async SQLAlchemy 2.0 engine and session management."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db.models import Base

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = BACKEND_DIR / "trustnet.db"

DATABASE_URL = os.environ.get(
    "TRUSTNET_DATABASE_URL", f"sqlite+aiosqlite:///{DEFAULT_DB_PATH.as_posix()}"
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    poolclass=NullPool if DATABASE_URL.startswith("sqlite") else None,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


@event.listens_for(engine.sync_engine, "connect")
def _sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    """Foreign keys + WAL keep the prototype honest under concurrent uploads."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()
    except Exception:  # pragma: no cover - pragma support varies by driver build
        pass


async def get_db() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        # Lightweight SQLite migration for ledgers created before academic-year
        # tagging existed. create_all cannot add columns to an existing table.
        result = await connection.exec_driver_sql("PRAGMA table_info(audit_logs)")
        columns = {row[1] for row in result.fetchall()}
        if columns and "academic_year" not in columns:
            await connection.exec_driver_sql(
                "ALTER TABLE audit_logs ADD COLUMN academic_year VARCHAR(10)"
            )
            await connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_audit_logs_academic_year "
                "ON audit_logs (academic_year)"
            )


async def reset_schema() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)


async def dispose_engine() -> None:
    await engine.dispose()
