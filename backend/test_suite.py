"""End-to-end verification for AICTE-TrustNet.

Run against a live backend:  python test_suite.py
The suite resets the demo ledger, exercises the full guard matrix and exits
non-zero on the first sign of regression.
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import httpx
from nacl.signing import VerifyKey

from app.core.crypto import sign_credential, verify_credential
from app.core.verhoeff import generate_verhoeff, validate_verhoeff
from app.db.seed import COLLISION_APAAR

BACKEND_DIR = Path(__file__).resolve().parent
ROSTERS = BACKEND_DIR.parent / "test_rosters"
BASE_URL = os.environ.get("TRUSTNET_BASE_URL", "http://127.0.0.1:8000")
ADMIN_TOKEN = os.environ.get("TRUSTNET_ADMIN_TOKEN", "trustnet-reset")
TN = "AICTE-TN-1042"
MH = "AICTE-MH-4011"

PASSED: list[str] = []
FAILED: list[tuple[str, str]] = []


def check(name: str, condition: bool, message: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append((name, message or "assertion failed"))
        print(f"  FAIL  {name} :: {message or 'assertion failed'}")


def png_bytes(data_url: object) -> bytes | None:
    if not isinstance(data_url, str) or not data_url.startswith("data:image/png;base64,"):
        return None
    try:
        return base64.b64decode(data_url.split(",", 1)[1], validate=True)
    except (ValueError, TypeError):
        return None


def section(title: str) -> None:
    print(f"\n[{title}]")


def wait_for_server(client: httpx.Client, attempts: int = 40) -> bool:
    for _ in range(attempts):
        try:
            response = client.get(f"{BASE_URL}/api/v1/health", timeout=2.0)
            if response.status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(0.25)
    return False


def login(client: httpx.Client, role: str, identifier: str) -> httpx.Response:
    return client.post(
        f"{BASE_URL}/api/v1/auth/login",
        json={"role": role, "identifier": identifier, "password": "trustnet"},
        timeout=15.0,
    )


def upload(client: httpx.Client, roster: str) -> httpx.Response:
    path = ROSTERS / roster
    return client.post(
        f"{BASE_URL}/api/v1/admissions/batch-upload",
        data={"institution_id": TN, "academic_year": "2026-2027"},
        files={"file": (path.name, path.read_bytes(), "text/csv")},
        timeout=60.0,
    )


def reset(client: httpx.Client) -> dict:
    response = client.post(
        f"{BASE_URL}/api/v1/admin/reset",
        params={"token": ADMIN_TOKEN},
        timeout=120.0,
    )
    response.raise_for_status()
    return response.json()


def canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def main() -> int:
    print("AICTE-TrustNet verification suite")
    print(f"Target: {BASE_URL}")

    client = httpx.Client(follow_redirects=True)
    if not wait_for_server(client):
        print("\nBackend unreachable. Start it first:  cd backend && python run_backend.py")
        return 2

    # ------------------------------------------------------------------ engines
    section("Verhoeff Mod-10 engine")
    check("valid APAAR accepted", validate_verhoeff("234567890124"))
    generated = generate_verhoeff("91000000001")
    check("generated APAAR is 12 digits", len(generated) == 12 and generated.isdigit())
    check("generated APAAR validates", validate_verhoeff(generated))
    check("corrupted check digit rejected", not validate_verhoeff("234567890125"))
    check("adjacent transposition rejected", not validate_verhoeff("234567891024"))
    check("non-numeric input rejected", _raises(ValueError, validate_verhoeff, "23456789O124"))

    section("Ed25519 credential engine")
    sample = {"apaar": "234567890124", "inst": TN, "yr": "2026-2027", "status": "VERIFIED_ACTIVE"}
    signature = sign_credential(sample)
    from app.core.crypto import get_public_key_hex

    public_key = get_public_key_hex()
    check("signature verifies", verify_credential(canonical(sample), signature, public_key))
    tampered = {**sample, "inst": MH}
    check(
        "tampered payload rejected",
        not verify_credential(canonical(tampered), signature, public_key),
    )
    check(
        "forged signature rejected",
        not verify_credential(canonical(sample), "00" * 64, public_key),
    )

    section("Apex public key endpoint")
    key_response = client.get(f"{BASE_URL}/api/v1/auth/apex-public-key")
    check("GET /apex-public-key returns 200", key_response.status_code == 200)
    key_payload = key_response.json()
    check(
        "public key is 64 hex chars",
        isinstance(key_payload.get("public_key"), str)
        and len(key_payload["public_key"]) == 64,
    )
    check("algorithm is Ed25519", key_payload.get("algorithm") == "Ed25519")

    # ------------------------------------------------------------- auth & scope
    section("Authentication & institution isolation")
    unauth = client.get(f"{BASE_URL}/api/v1/admissions/institutions")
    check("unauthenticated ledger access rejected", unauth.status_code == 401)
    bad_login = login(client, "REGISTRAR", "nobody@example.com")
    check("invalid credentials rejected", bad_login.status_code == 401)

    registrar_login = login(client, "REGISTRAR", "registrar@sjit.edu.in")
    check("registrar login succeeds", registrar_login.status_code == 200, registrar_login.text[:200])
    registrar_user = registrar_login.json().get("user", {}) if registrar_login.status_code == 200 else {}
    check(
        "registrar session is pinned to a college",
        registrar_user.get("role") == "REGISTRAR"
        and registrar_user.get("institution_id") == TN,
    )
    registrar_headers = {"Authorization": f"Bearer {registrar_login.json()['token']}"}
    scoped = client.get(
        f"{BASE_URL}/api/v1/admissions/institutions",
        params={"academic_year": "2026-2027"},
        headers=registrar_headers,
    ).json()
    check(
        "registrar sees only their own institution",
        len(scoped) == 1 and scoped[0]["institution_id"] == TN,
        json.dumps(scoped)[:200],
    )
    forbidden = client.get(
        f"{BASE_URL}/api/v1/admissions/institutions/{MH}", headers=registrar_headers
    )
    check("registrar cannot read another college", forbidden.status_code == 403)
    scoped_overview = client.get(
        f"{BASE_URL}/api/v1/analytics/overview",
        params={"academic_year": "2026-2027"},
        headers=registrar_headers,
    ).json()
    check(
        "registrar analytics are institution-scoped",
        scoped_overview["total_institutions"] == 1
        and scoped_overview["total_seats_filled"] == 58,
    )

    apex_login = login(client, "APEX", "apex@aicte.gov.in")
    check("apex login succeeds", apex_login.status_code == 200, apex_login.text[:200])
    apex_user = apex_login.json().get("user", {}) if apex_login.status_code == 200 else {}
    check("apex officer has country-wide role", apex_user.get("role") == "APEX")
    client.headers.update({"Authorization": f"Bearer {apex_login.json()['token']}"})
    nationwide = client.get(
        f"{BASE_URL}/api/v1/admissions/institutions",
        params={"academic_year": "2026-2027"},
    ).json()
    check("apex sees every approved college", len(nationwide) == 2)

    # ----------------------------------------------------------------- scenario 1
    section("Scenario 1 - clean roster fills sanctioned intake")
    reset(client)
    success = upload(client, "01_valid_roster.csv")
    check("HTTP 200 on valid roster", success.status_code == 200, success.text[:300])
    payload = success.json() if success.status_code == 200 else {}
    students = payload.get("students", [])
    check("2 students enrolled", payload.get("enrolled_count") == 2)
    check("college now at 60/60", payload.get("seats_filled") == 60)
    check("zero seats remaining", payload.get("seats_remaining") == 0)
    check(
        "every student has a signed QR data URL",
        bool(students)
        and all(
            isinstance(student.get("qr_code_url"), str)
            and student["qr_code_url"].startswith("data:image/png;base64,")
            for student in students
        ),
    )
    check(
        "every QR data URL decodes to a real PNG",
        bool(students)
        and all(
            (raw := png_bytes(student.get("qr_code_url"))) is not None
            and raw.startswith(b"\x89PNG\r\n\x1a\n")
            for student in students
        ),
    )
    check(
        "every student carries a payload summary",
        bool(students)
        and all(
            (student.get("payload_summary") or {}).get("apaar") == student.get("apaar_id")
            for student in students
        ),
    )
    check(
        "every student carries a credential envelope",
        bool(students) and all(student.get("credential") for student in students),
    )

    if students:
        envelope = students[0]["credential"]
        verify_response = client.post(
            f"{BASE_URL}/api/v1/auth/verify-credential", json={"credential": envelope}
        )
        check("backend verifies issued credential", verify_response.status_code == 200 and verify_response.json()["valid"])

        offline_ok = True
        try:
            VerifyKey(bytes.fromhex(key_payload["public_key"])).verify(
                canonical(envelope["payload"]).encode("utf-8"),
                bytes.fromhex(envelope["signature"]),
            )
        except Exception:
            offline_ok = False
        check("offline Ed25519 verification succeeds", offline_ok)

        corrupted = json.loads(json.dumps(envelope))
        corrupted["payload"]["apaar"] = "999999999999"
        corrupt_response = client.post(
            f"{BASE_URL}/api/v1/auth/verify-credential", json={"credential": corrupted}
        )
        check(
            "tampered QR credential is rejected",
            corrupt_response.status_code == 200 and corrupt_response.json()["valid"] is False,
        )

    admission_logs = client.get(
        f"{BASE_URL}/api/v1/analytics/audit-logs",
        params={"event_type": "ENROLLMENT_SUCCESS"},
    ).json()
    check(
        "admission audit records the final 60/60 ledger",
        bool(admission_logs) and "60/60" in admission_logs[0]["detail"],
        admission_logs[0]["detail"] if admission_logs else "no admission audit entry",
    )

    # ------------------------------------------------------- lookup & year feed
    section("Credential lookup and academic-year filters")
    if students:
        issued = students[0]
        lookup = client.get(
            f"{BASE_URL}/api/v1/admissions/credential",
            params={
                "apaar_id": issued["apaar_id"],
                "student_name": issued["student_name"],
                "institution_id": TN,
                "academic_year": "2026-2027",
            },
        )
        check("credential lookup returns 200", lookup.status_code == 200, lookup.text[:200])
        record = lookup.json() if lookup.status_code == 200 else {}
        check(
            "credential lookup resolves the student",
            record.get("student_name") == issued["student_name"]
            and record.get("institution_name") == "St. Joseph's Inst of Tech",
        )
        check(
            "credential lookup carries a scannable PNG",
            png_bytes(record.get("qr_code_url")) is not None,
        )
        check(
            "credential lookup carries the signed envelope",
            bool((record.get("credential") or {}).get("signature")),
        )
        wrong_year = client.get(
            f"{BASE_URL}/api/v1/admissions/credential",
            params={"apaar_id": issued["apaar_id"], "academic_year": "2025-2026"},
        )
        check("lookup rejects a mismatched year", wrong_year.status_code == 404)

    past_intake = client.get(
        f"{BASE_URL}/api/v1/analytics/intake", params={"academic_year": "2025-2026"}
    ).json()
    past_tn = next((row for row in past_intake if row["institution_id"] == TN), None)
    check(
        "previous cycle returns its own intake",
        past_tn is not None and past_tn["academic_year"] == "2025-2026" and past_tn["current_enrolled"] == 56,
    )
    future_intake = client.get(
        f"{BASE_URL}/api/v1/analytics/intake", params={"academic_year": "2027-2028"}
    ).json()
    future_tn = next((row for row in future_intake if row["institution_id"] == TN), None)
    check(
        "upcoming cycle is approved but empty",
        future_tn is not None
        and future_tn["sanctioned_intake"] == 60
        and future_tn["current_enrolled"] == 0,
    )
    search_response = client.get(
        f"{BASE_URL}/api/v1/admissions/search",
        params={"q": "910000000015", "academic_year": "2026-2027"},
    ).json()
    check(
        "command search finds an APAAR",
        any(
            student["apaar_id"] == "910000000015"
            for student in search_response.get("students", [])
        ),
    )

    # -------------------------------------------------------------- scenario 2
    section("Scenario 2 - quota guard blocks overflow")
    oversubscribed = upload(client, "02_quota_overflow.csv")
    check("HTTP 422 on overflow roster", oversubscribed.status_code == 422, oversubscribed.text[:300])
    quota_detail = oversubscribed.json().get("detail", "") if oversubscribed.content else ""
    check(
        "quota message names intake limit",
        isinstance(quota_detail, str) and "Sanctioned Intake Exceeded" in quota_detail,
    )
    check(
        "quota message reports 5 incoming students",
        isinstance(quota_detail, str) and "5 students" in quota_detail,
    )
    check(
        "quota message reports remaining seats",
        isinstance(quota_detail, str) and "seats remain" in quota_detail,
    )
    tn_after = client.get(f"{BASE_URL}/api/v1/admissions/institutions/{TN}").json()
    check("ledger unchanged after quota block", tn_after["current_enrolled"] == 60)

    # -------------------------------------------------------------- scenario 3
    section("Scenario 3 - concurrency guard blocks double enrollment")
    collision = upload(client, "03_concurrency_collision.csv")
    check("HTTP 409 on collision roster", collision.status_code == 409, collision.text[:300])
    conflict_body = collision.json() if collision.content else {}
    check(
        "conflict header matches contract",
        conflict_body.get("detail") == "Concurrency Conflict: Active seat collision detected",
    )
    conflicts = conflict_body.get("conflicts", [])
    check("conflict list is populated", len(conflicts) >= 1)
    check(
        "conflict names the offending APAAR",
        any(item.get("apaar_id") == COLLISION_APAAR for item in conflicts),
    )
    check(
        "conflict names Pune Engineering College",
        any("Pune Engineering College" in str(item.get("conflicting_institution")) for item in conflicts),
    )
    check(
        "conflict states the reason",
        any(
            item.get("reason") == "Active seat already registered for this academic year"
            for item in conflicts
        ),
    )

    section("Oversight telemetry")
    overview = client.get(f"{BASE_URL}/api/v1/analytics/overview").json()
    check("two approved institutions", overview["total_institutions"] == 2)
    check("registered APAAR ledger has 160 seats", overview["total_registered_apaars"] == 160)
    check(
        "prevented concurrency violations recorded",
        overview["prevented_concurrency_violations"] >= 1,
    )
    check("prevented quota violations recorded", overview["prevented_quota_violations"] >= 1)
    check(
        "seat filled equals seeded + admitted",
        overview["total_seats_filled"] == 160,
    )

    audit = client.get(
        f"{BASE_URL}/api/v1/analytics/audit-logs",
        params={"event_type": "CONCURRENCY_CONFLICT"},
    ).json()
    check("conflict audit stream persisted", len(audit) >= 1)
    check(
        "audit entry references both institutions",
        any(entry.get("conflicting_institution_id") == MH for entry in audit),
    )

    intake = client.get(f"{BASE_URL}/api/v1/analytics/intake").json()
    check("intake telemetry reports both courses", len(intake) == 2)
    tn_row = next((row for row in intake if row["institution_id"] == TN), None)
    check("TN intake row is full", tn_row is not None and tn_row["current_enrolled"] == 60)

    section("Mock integrations")
    identity = client.get(f"{BASE_URL}/mock/digilocker/identity/{COLLISION_APAAR}")
    check("DigiLocker mock returns 200", identity.status_code == 200)
    check(
        "DigiLocker mock returns demographics",
        identity.status_code == 200
        and bool(identity.json().get("full_name"))
        and bool(identity.json().get("aadhaar_masked")),
    )
    bad_identity = client.get(f"{BASE_URL}/mock/digilocker/identity/234567890125")
    check("DigiLocker mock rejects bad APAAR", bad_identity.status_code == 422)

    abc = client.post(
        f"{BASE_URL}/mock/abc/sync-credits",
        json={
            "apaar_id": COLLISION_APAAR,
            "student_name": "Rohit Deshpande",
            "institution_id": MH,
            "program": "B.Tech Comp Eng",
            "credits": [
                {"course_code": "CS401", "course_name": "Distributed Systems", "credits": 4, "grade": "A+"},
                {"course_code": "CS402", "course_name": "Cryptography", "credits": 3, "grade": "O"},
            ],
        },
    )
    check("ABC sync returns 200", abc.status_code == 200, abc.text[:300])
    abc_body = abc.json() if abc.status_code == 200 else {}
    check("ABC sync status is SYNCED_TO_ABC", abc_body.get("status") == "SYNCED_TO_ABC")
    check(
        "ABC ledger transaction issued",
        str(abc_body.get("ledger_txn", "")).startswith("0x")
        and len(str(abc_body.get("ledger_txn"))) == 66,
    )

    # ---------------------------------------------------------- fresh quota math
    section("Quota arithmetic on a fresh ledger")
    reset(client)
    fresh_overflow = upload(client, "02_quota_overflow.csv")
    fresh_detail = fresh_overflow.json().get("detail", "") if fresh_overflow.content else ""
    check(
        "fresh overflow reports exactly 2 remaining seats",
        fresh_overflow.status_code == 422 and "only 2 seats remain" in fresh_detail,
    )

    section("Database invariants")
    db_path = BACKEND_DIR / "trustnet.db"
    if db_path.exists():
        with sqlite3.connect(db_path) as connection:
            schema = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type='table'"
            ).fetchall()
            joined = "\n".join(row[0] or "" for row in schema)
            check("unique active-seat lock present", "uq_active_seat_per_year" in joined)
            check("intake check constraint present", "check_sanctioned_intake_limit" in joined)
            check("per-year intake check present", "check_cycle_intake_limit" in joined)
            cycles = connection.execute(
                "SELECT COUNT(*) FROM intake_cycles"
            ).fetchone()[0]
            check("four academic cycles seeded", cycles == 8, f"found {cycles} cycles")
            orphan = connection.execute(
                "SELECT COUNT(*) FROM student_enrollments "
                "WHERE institution_id NOT IN (SELECT institution_id FROM institutions)"
            ).fetchone()[0]
            check("no orphan enrollments", orphan == 0)
    else:
        check("database file present", False, f"missing {db_path}")

    # Leave the system in a pristine demo state.
    reset(client)

    print("\n" + "=" * 62)
    print(f"RESULT: {len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        for name, message in FAILED:
            print(f"  FAILED: {name} -> {message}")
        print("=" * 62)
        return 1
    print("All core logic verified. Zero errors.")
    print("=" * 62)
    return 0


def _raises(exc_type, fn, *args) -> bool:
    try:
        fn(*args)
    except exc_type:
        return True
    return False


if __name__ == "__main__":
    sys.exit(main())
