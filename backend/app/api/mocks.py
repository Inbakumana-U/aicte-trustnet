"""Mock DigiLocker identity and Academic Bank of Credits integrations.

These endpoints emulate the external systems AICTE-TrustNet must talk to in
production; they are deterministic so the demo is repeatable.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.core.verhoeff import validate_verhoeff
from app.schemas.student import (
    ABCSyncRequest,
    ABCSyncResponse,
    DigiLockerIdentity,
)

router = APIRouter(tags=["mock-integrations"])

_FIRST = ["Aarav", "Ananya", "Vihaan", "Diya", "Ishaan", "Meera", "Kabir", "Saanvi"]
_LAST = ["Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Menon", "Desai"]
_STATES = ["Tamil Nadu", "Maharashtra", "Karnataka", "Kerala", "Telangana", "Gujarat"]
_CATEGORIES = ["GEN", "OBC-NCL", "SC", "ST", "EWS"]
_GENDERS = ["Female", "Male", "Non-binary"]


def _seed(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest(), 16)


@router.get("/mock/digilocker/identity/{apaar_id}", response_model=DigiLockerIdentity)
async def digilocker_identity(apaar_id: str) -> DigiLockerIdentity:
    apaar_id = apaar_id.strip()
    if len(apaar_id) != 12 or not apaar_id.isdigit() or not validate_verhoeff(apaar_id):
        raise HTTPException(
            status_code=422,
            detail="Invalid APAAR ID checksum (Mod-10 Verhoeff failure)",
        )

    seed = _seed(apaar_id)
    first = _FIRST[seed % len(_FIRST)]
    last = _LAST[(seed >> 8) % len(_LAST)]
    dob = date(2006, 1, 1) + timedelta(days=(seed >> 16) % 1200)

    return DigiLockerIdentity(
        apaar_id=apaar_id,
        full_name=f"{first} {last}",
        dob=dob,
        gender=_GENDERS[(seed >> 24) % len(_GENDERS)],
        category=_CATEGORIES[(seed >> 32) % len(_CATEGORIES)],
        state=_STATES[(seed >> 40) % len(_STATES)],
        guardian_name=f"{_FIRST[(seed >> 48) % len(_FIRST)]} {last}",
        aadhaar_masked=f"XXXX XXXX {(seed % 10000):04d}",
    )


@router.post("/mock/abc/sync-credits", response_model=ABCSyncResponse)
async def sync_credits(payload: ABCSyncRequest) -> ABCSyncResponse:
    total = round(sum(record.credits for record in payload.credits), 2)
    if total <= 0:
        raise HTTPException(status_code=422, detail="Credit payload totals must be positive")

    txn = "0x" + secrets.token_hex(32)

    return ABCSyncResponse(
        status="SYNCED_TO_ABC",
        ledger_txn=txn,
        apaar_id=payload.apaar_id,
        credits_ingested=len(payload.credits),
        total_credits=total,
        anchored_at=datetime.now(timezone.utc),
    )
