"""Signed demo sessions for the AICTE-TrustNet prototype.

Tokens are compact HMAC-SHA256 envelopes rather than JWTs so the prototype has
no extra crypto dependency. Passwords are stored as salted SHA-256 digests and
compared in constant time; the demo accounts never leave this module.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

SECRET = os.environ.get("TRUSTNET_AUTH_SECRET", "trustnet-demo-session-secret")
TOKEN_TTL_SECONDS = 12 * 60 * 60
_PASSWORD_SALT = "aicte-trustnet-demo-v1"

ROLE_REGISTRAR = "REGISTRAR"
ROLE_APEX = "APEX"

INSTITUTION_NAMES = {
    "AICTE-TN-1042": "St. Joseph's Inst of Tech",
    "AICTE-MH-4011": "Pune Engineering College",
}


def _digest(password: str) -> str:
    return hashlib.sha256(f"{_PASSWORD_SALT}:{password}".encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class DemoAccount:
    identifier: str
    password_hash: str
    role: str
    name: str
    title: str
    institution_id: str | None
    initials: str

    @property
    def institution_name(self) -> str | None:
        if self.institution_id is None:
            return None
        return INSTITUTION_NAMES.get(self.institution_id, self.institution_id)


DEMO_ACCOUNTS: dict[str, DemoAccount] = {
    "registrar@sjit.edu.in": DemoAccount(
        identifier="registrar@sjit.edu.in",
        password_hash=_digest("trustnet"),
        role=ROLE_REGISTRAR,
        name="Ananya Nair",
        title="College Registrar",
        institution_id="AICTE-TN-1042",
        initials="AN",
    ),
    "apex@aicte.gov.in": DemoAccount(
        identifier="apex@aicte.gov.in",
        password_hash=_digest("trustnet"),
        role=ROLE_APEX,
        name="Arjun Mehta",
        title="AICTE Apex Regulatory Officer",
        institution_id=None,
        initials="AM",
    ),
}


@dataclass(frozen=True)
class CurrentUser:
    identifier: str
    role: str
    name: str
    title: str
    institution_id: str | None
    institution_name: str | None
    initials: str

    @property
    def is_registrar(self) -> bool:
        return self.role == ROLE_REGISTRAR

    @property
    def is_apex(self) -> bool:
        return self.role == ROLE_APEX


def authenticate(role: str, identifier: str, password: str) -> DemoAccount:
    normalized = identifier.strip().lower()
    account = DEMO_ACCOUNTS.get(normalized)
    supplied = _digest(password)
    if account is None or not hmac.compare_digest(account.password_hash, supplied):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid identifier or password for this workspace.",
        )
    if role and account.role != role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="These credentials do not match the selected role.",
        )
    return account


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def create_token(account: DemoAccount) -> tuple[str, int]:
    expires_at = int(time.time()) + TOKEN_TTL_SECONDS
    payload = {"sub": account.identifier, "role": account.role, "exp": expires_at}
    body = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{signature}", expires_at


def decode_token(token: str) -> DemoAccount:
    try:
        body, supplied = token.split(".", 1)
    except ValueError as exc:
        raise _unauthorized("Malformed session token.") from exc
    expected = hmac.new(SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        raise _unauthorized("Session token signature is invalid.")

    padded = body + "=" * (-len(body) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, json.JSONDecodeError) as exc:
        raise _unauthorized("Session token is unreadable.") from exc

    if int(payload.get("exp", 0)) < int(time.time()):
        raise _unauthorized("Session expired. Sign in again.")
    account = DEMO_ACCOUNTS.get(str(payload.get("sub", "")))
    if account is None:
        raise _unauthorized("Unknown session subject.")
    return account


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


_bearer = HTTPBearer(auto_error=False)


def _to_user(account: DemoAccount) -> CurrentUser:
    return CurrentUser(
        identifier=account.identifier,
        role=account.role,
        name=account.name,
        title=account.title,
        institution_id=account.institution_id,
        institution_name=account.institution_name,
        initials=account.initials,
    )


def current_account(account: DemoAccount) -> CurrentUser:
    return _to_user(account)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Sign in to access this workspace.")
    return _to_user(decode_token(credentials.credentials))


def scope_institution(user: CurrentUser, requested: str | None) -> str | None:
    """Registrars are pinned to their own college; apex officers see the country."""
    if not user.is_registrar:
        return requested
    if requested and requested != user.institution_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This institution is outside your registrar workspace.",
        )
    return user.institution_id
