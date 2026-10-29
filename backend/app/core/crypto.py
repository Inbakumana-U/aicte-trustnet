"""Apex Ed25519 credential signing and QR generation.

The apex authority holds a single Ed25519 private key on disk; every credential
issued by the acceptance pipeline is signed with it, and the matching public
key is distributed through ``GET /api/v1/auth/apex-public-key`` so that any
offline verifier can validate credentials without trusting the database.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import os
import threading
from pathlib import Path
from typing import Any

import qrcode
from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

BACKEND_DIR = Path(__file__).resolve().parents[2]
KEY_PATH = Path(os.environ.get("TRUSTNET_KEY_PATH", BACKEND_DIR / "apex_private.key"))

_ISSUER = "AICTE-APEX"
_ALGORITHM = "Ed25519"

_lock = threading.Lock()
_signing_key: SigningKey | None = None


def canonical_json(payload: Any) -> str:
    """Deterministic JSON used as the exact byte string that gets signed.

    Mirrors ``JSON.stringify`` with sorted keys on the client so browser-side
    verification produces the same message bytes.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _load_or_create_signing_key() -> SigningKey:
    global _signing_key
    with _lock:
        if _signing_key is not None:
            return _signing_key

        if KEY_PATH.exists():
            raw = bytes.fromhex(KEY_PATH.read_text(encoding="utf-8").strip())
            if len(raw) != 32:
                raise RuntimeError(f"Corrupt Ed25519 key at {KEY_PATH}")
            _signing_key = SigningKey(raw)
        else:
            _signing_key = SigningKey.generate()
            KEY_PATH.write_text(_signing_key.encode().hex(), encoding="utf-8")
            try:
                os.chmod(KEY_PATH, 0o600)
            except OSError:
                pass
        return _signing_key


def get_public_key_hex() -> str:
    return bytes(_load_or_create_signing_key().verify_key).hex()


def get_key_fingerprint() -> str:
    digest = hashlib.sha256(bytes.fromhex(get_public_key_hex())).hexdigest()
    return ":".join(digest[i : i + 4] for i in range(0, 16, 4)).upper()


def sign_credential(payload: dict) -> str:
    """Sign the canonical JSON of ``payload`` and return a hex signature."""
    message = canonical_json(payload).encode("utf-8")
    signature = _load_or_create_signing_key().sign(message).signature
    return signature.hex()


def verify_credential(payload_json: str, signature_hex: str, public_key_hex: str) -> bool:
    """Verify a hex signature over a JSON payload. Never raises for bad data."""
    try:
        payload = json.loads(payload_json) if isinstance(payload_json, str) else payload_json
        message = canonical_json(payload).encode("utf-8")
        verifier = VerifyKey(bytes.fromhex(public_key_hex))
        verifier.verify(message, bytes.fromhex(signature_hex))
        return True
    except (BadSignatureError, ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        return False


def build_credential(payload: dict) -> dict:
    """Wrap a payload with its detached signature into a self-contained envelope."""
    return {
        "payload": payload,
        "signature": sign_credential(payload),
        "algorithm": _ALGORITHM,
        "issuer": _ISSUER,
    }


def generate_verifiable_qr(signed_payload: dict) -> str:
    """Encode the signed envelope as a standalone base64 PNG data URL."""
    raw_data = json.dumps(signed_payload, separators=(",", ":"))
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(raw_data)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#0F172A", back_color="#FFFFFF").convert("RGB")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def public_key_info() -> dict:
    public_key = get_public_key_hex()
    return {
        "issuer": _ISSUER,
        "algorithm": _ALGORITHM,
        "public_key": public_key,
        "key_fingerprint": get_key_fingerprint(),
        "usage": "Verify AICTE-TrustNet academic ledger credentials offline",
    }
