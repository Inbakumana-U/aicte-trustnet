"""Demo sessions, apex public-key distribution and credential verification."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from app.core.crypto import (
    canonical_json,
    get_key_fingerprint,
    get_public_key_hex,
    public_key_info,
)
from app.core.security import (
    CurrentUser,
    authenticate,
    create_token,
    current_account,
    get_current_user,
)
from app.schemas.student import (
    ApexKeyResponse,
    AuthUserOut,
    LoginRequest,
    LoginResponse,
    VerifyCredentialRequest,
    VerifyCredentialResponse,
)

router = APIRouter(tags=["auth"])


def _user_out(user: CurrentUser) -> AuthUserOut:
    return AuthUserOut(
        identifier=user.identifier,
        role=user.role,
        name=user.name,
        title=user.title,
        institution_id=user.institution_id,
        institution_name=user.institution_name,
        initials=user.initials,
    )


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest) -> LoginResponse:
    account = authenticate(request.role, request.identifier, request.password)
    token, expires_at = create_token(account)
    return LoginResponse(
        token=token,
        expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
        user=_user_out(current_account(account)),
    )


@router.get("/me", response_model=AuthUserOut)
async def me(user: CurrentUser = Depends(get_current_user)) -> AuthUserOut:
    return _user_out(user)


@router.get("/apex-public-key", response_model=ApexKeyResponse)
async def apex_public_key() -> ApexKeyResponse:
    info = public_key_info()
    return ApexKeyResponse(
        issuer=info["issuer"],
        algorithm=info["algorithm"],
        public_key=info["public_key"],
        key_fingerprint=info["key_fingerprint"],
        usage=info["usage"],
        endpoints={
            "verify": "/api/v1/auth/verify-credential",
            "issuer": "AICTE-APEX",
        },
    )


def _split_credential(
    request: VerifyCredentialRequest,
) -> tuple[dict[str, Any], str, str]:
    credential = request.credential
    if not isinstance(credential, dict):
        raise HTTPException(status_code=422, detail="credential must be a JSON object")

    signature = request.signature
    payload: dict[str, Any]
    envelope_issuer = credential.get("issuer", "AICTE-APEX")

    if "payload" in credential and isinstance(credential["payload"], dict):
        payload = credential["payload"]
        signature = signature or credential.get("signature") or credential.get("sig")
    else:
        payload = credential
        signature = signature or credential.get("signature") or credential.get("sig")

    if not signature:
        raise HTTPException(
            status_code=422,
            detail="No signature supplied. Provide a full credential envelope.",
        )

    return payload, str(signature), str(envelope_issuer)


@router.post("/verify-credential", response_model=VerifyCredentialResponse)
async def verify_credential_endpoint(
    request: VerifyCredentialRequest,
) -> VerifyCredentialResponse:
    payload, signature, issuer = _split_credential(request)
    public_key = request.public_key or get_public_key_hex()

    try:
        VerifyKey(bytes.fromhex(public_key)).verify(
            canonical_json(payload).encode("utf-8"), bytes.fromhex(signature)
        )
        valid = True
        reason = "Ed25519 signature valid — credential issued by the AICTE apex authority."
    except (BadSignatureError, ValueError, TypeError):
        valid = False
        reason = "Tamper / Fraud Detected — cryptographic signature mismatch."

    return VerifyCredentialResponse(
        valid=valid,
        reason=reason,
        payload=payload,
        issuer=issuer,
        key_fingerprint=get_key_fingerprint(),
    )
