"""FastAPI entry point for AICTE-TrustNet."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import admissions, analytics, auth, mocks
from app.core.crypto import get_key_fingerprint
from app.db.seed import ROSTER_DIR, seed_database
from app.db.session import AsyncSessionLocal, dispose_engine, init_db, reset_schema

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROSTER_DIR.mkdir(parents=True, exist_ok=True)

ADMIN_TOKEN = os.environ.get("TRUSTNET_ADMIN_TOKEN", "trustnet-reset")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    async with AsyncSessionLocal() as session:
        summary = await seed_database(session)
    if summary.get("skipped"):
        print("[trustnet] ledger ready (seed data already present)")
    else:
        print(
            f"[trustnet] seeded {summary.get('institutions')} institutions / "
            f"{summary.get('enrollments')} active seats"
        )
    print(f"[trustnet] apex key fingerprint: {get_key_fingerprint()}")
    yield
    await dispose_engine()


app = FastAPI(
    title="AICTE-TrustNet",
    version="1.0.0",
    description=(
        "APAAR ID based concurrency guard and cryptographic academic ledger. "
        "SIH26263 prototype — quota enforcement, anti-hoarding seat lock and "
        "Ed25519 verifiable credentials."
    ),
    lifespan=lifespan,
)

LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
DEPLOYED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("TRUSTNET_CORS_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[*LOCAL_ORIGINS, *DEPLOYED_ORIGINS],
    allow_origin_regex=os.environ.get(
        "TRUSTNET_CORS_ORIGIN_REGEX", r"^http://(localhost|127\.0\.0\.1):\d+$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(admissions.router, prefix="/api/v1/admissions")
app.include_router(auth.router, prefix="/api/v1/auth")
app.include_router(analytics.router, prefix="/api/v1/analytics")
app.include_router(mocks.router)

app.mount("/samples", StaticFiles(directory=ROSTER_DIR), name="samples")


@app.get("/", tags=["meta"])
async def root() -> dict:
    return {
        "service": "AICTE-TrustNet",
        "mission": "APAAR-based concurrency guard & academic ledger",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/v1/health",
        "public_key": "/api/v1/auth/apex-public-key",
        "samples": "/samples/01_valid_roster.csv",
    }


@app.get("/api/v1/health", tags=["meta"])
async def health() -> dict:
    return {
        "status": "ok",
        "issuer": "AICTE-APEX",
        "key_fingerprint": get_key_fingerprint(),
    }


@app.post("/api/v1/admin/reset", tags=["admin"])
async def reset_demo_ledger(
    token: str | None = Query(default=None, description="Demo reset token"),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    """Restore the demo ledger to its seeded state (test harness usage)."""
    if (token or x_admin_token) != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid admin reset token")

    await reset_schema()
    async with AsyncSessionLocal() as session:
        summary = await seed_database(session, force=True)

    return {
        "status": "RESET",
        "institutions": summary.get("institutions"),
        "active_seats": summary.get("enrollments"),
        "collision_apaar": summary.get("collision_apaar"),
        "rosters": summary.get("rosters"),
    }
