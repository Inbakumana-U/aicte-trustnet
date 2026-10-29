"""Deterministic seed corpus for AICTE-TrustNet.

Every APAAR ID is derived from an 11-digit base plus a mathematically computed
Verhoeff check digit, so the demo data satisfies the same validation rules as
real uploads. Four academic cycles are seeded so the year selector has real
history, a live current intake and an upcoming (empty) admission cycle.
"""

from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.academics import ACTIVE_ACADEMIC_YEAR
from app.core.crypto import build_credential, canonical_json
from app.core.verhoeff import generate_verhoeff
from app.db.models import AuditLog, Institution, IntakeCycle, StudentEnrollment

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
ROSTER_DIR = PROJECT_ROOT / "test_rosters"

ACADEMIC_YEAR = ACTIVE_ACADEMIC_YEAR
COLLISION_APAAR = generate_verhoeff("23456789012")  # 234567890124

# cycles: academic_year -> (sanctioned_intake, enrolled_count, legacy_apaar_base)
INSTITUTIONS = [
    {
        "institution_id": "AICTE-TN-1042",
        "institution_name": "St. Joseph's Inst of Tech",
        "course_name": "B.Tech AI & DS",
        "cycles": {
            "2024-2025": (60, 52, "710000000"),
            "2025-2026": (60, 56, "720000000"),
            "2026-2027": (60, 58, "810000000"),
            "2027-2028": (60, 0, None),
        },
        "collision_year": None,
    },
    {
        "institution_id": "AICTE-MH-4011",
        "institution_name": "Pune Engineering College",
        "course_name": "B.Tech Comp Eng",
        "cycles": {
            "2024-2025": (120, 94, "730000000"),
            "2025-2026": (120, 97, "740000000"),
            "2026-2027": (120, 100, "820000000"),
            "2027-2028": (120, 0, None),
        },
        "collision_year": "2026-2027",
    },
]

FIRST_NAMES = [
    "Aarav", "Ananya", "Vihaan", "Diya", "Ishaan", "Meera", "Kabir", "Saanvi",
    "Arjun", "Aditi", "Rohan", "Kavya", "Vivaan", "Nithya", "Dev", "Riya",
    "Hari", "Lakshmi", "Siddharth", "Tara", "Neel", "Ira", "Advik", "Anika",
    "Pranav", "Shreya", "Karthik", "Pooja", "Rahul", "Sneha", "Varun", "Divya",
    "Aryan", "Nandini", "Vikram", "Asha", "Manav", "Bhavya", "Yash", "Trisha",
    "Surya", "Rithika", "Omkar", "Gauri", "Nikhil", "Veda", "Akhil", "Charu",
    "Rudra", "Jhanvi", "Tejas", "Naina",
]
LAST_NAMES = [
    "Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Menon", "Desai",
    "Rao", "Verma", "Kulkarni", "Joshi", "Pillai", "Chatterjee", "Bose",
    "Krishnan", "Mehta", "Bhat", "Shetty", "Agarwal", "Kumar", "Sundaram",
]


def _legacy_students(base: str, count: int, seed: str) -> list[dict]:
    rng = random.Random(seed)
    students = []
    for index in range(count):
        apaar = generate_verhoeff(f"{base}{index + 1:02d}")
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        dob = date(2006, 1, 1) + timedelta(days=rng.randint(0, 700))
        students.append({"apaar_id": apaar, "student_name": name, "dob": dob})
    return students


def valid_apaar(base11: str) -> str:
    return generate_verhoeff(base11)


ROSTER_VALID = [
    {"base": "91000000001", "student_name": "Aditya Krishnan", "dob": "2007-04-12"},
    {"base": "91000000002", "student_name": "Sanya Bhattacharya", "dob": "2007-08-23"},
]

ROSTER_OVERFLOW = [
    {"base": "92000000001", "student_name": "Reyansh Pillai", "dob": "2007-02-09"},
    {"base": "92000000002", "student_name": "Amrita Deshmukh", "dob": "2007-11-30"},
    {"base": "92000000003", "student_name": "Dhruv Malhotra", "dob": "2007-05-17"},
    {"base": "92000000004", "student_name": "Ishita Raghavan", "dob": "2007-09-04"},
    {"base": "92000000005", "student_name": "Kabir Senthil", "dob": "2007-01-26"},
]


def build_rosters() -> dict[str, list[dict]]:
    return {
        "01_valid_roster.csv": [
            {
                "apaar_id": valid_apaar(item["base"]),
                "student_name": item["student_name"],
                "dob": item["dob"],
            }
            for item in ROSTER_VALID
        ],
        "02_quota_overflow.csv": [
            {
                "apaar_id": valid_apaar(item["base"]),
                "student_name": item["student_name"],
                "dob": item["dob"],
            }
            for item in ROSTER_OVERFLOW
        ],
        "03_concurrency_collision.csv": [
            {
                "apaar_id": COLLISION_APAAR,
                "student_name": "Rohit Deshpande",
                "dob": "2006-12-05",
            }
        ],
    }


def write_rosters() -> list[Path]:
    ROSTER_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for filename, rows in build_rosters().items():
        path = ROSTER_DIR / filename
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["apaar_id", "student_name", "dob"])
            writer.writeheader()
            writer.writerows(rows)
        written.append(path)
    return written


def _credential_json(apaar_id: str, institution_id: str, academic_year: str) -> str:
    envelope = build_credential(
        {
            "apaar": apaar_id,
            "inst": institution_id,
            "yr": academic_year,
            "status": "VERIFIED_ACTIVE",
        }
    )
    return canonical_json(envelope)


async def seed_database(session: AsyncSession, *, force: bool = False) -> dict:
    """Populate reference data. Idempotent unless ``force`` is set.

    A ledger created before per-year intake cycles existed is rebuilt once so
    the year selector has complete telemetry.
    """
    existing = await session.scalar(select(func.count()).select_from(Institution))
    cycles = await session.scalar(select(func.count()).select_from(IntakeCycle))
    if existing and cycles and not force:
        written = write_rosters()
        return {
            "skipped": True,
            "institutions": existing,
            "rosters": [str(path) for path in written],
            "collision_apaar": COLLISION_APAAR,
        }

    if existing and not cycles:
        force = True

    if force:
        await session.execute(delete(AuditLog))
        await session.execute(delete(StudentEnrollment))
        await session.execute(delete(IntakeCycle))
        await session.execute(delete(Institution))
        await session.flush()

    total_enrollments = 0

    for spec in INSTITUTIONS:
        active = spec["cycles"][ACTIVE_ACADEMIC_YEAR]
        institution = Institution(
            institution_id=spec["institution_id"],
            institution_name=spec["institution_name"],
            course_name=spec["course_name"],
            academic_year=ACTIVE_ACADEMIC_YEAR,
            sanctioned_intake=active[0],
            current_enrolled=active[1],
        )
        session.add(institution)
        await session.flush()

        for year, (sanctioned, enrolled, base) in spec["cycles"].items():
            session.add(
                IntakeCycle(
                    institution_id=spec["institution_id"],
                    academic_year=year,
                    sanctioned_intake=sanctioned,
                    current_enrolled=enrolled,
                )
            )
            if not base or enrolled <= 0:
                continue

            collision = spec["collision_year"] == year
            legacy_count = enrolled - (1 if collision else 0)
            for student in _legacy_students(
                base, legacy_count, f"{spec['institution_id']}:{year}"
            ):
                session.add(
                    StudentEnrollment(
                        apaar_id=student["apaar_id"],
                        student_name=student["student_name"],
                        dob=student["dob"],
                        institution_id=spec["institution_id"],
                        academic_year=year,
                        status="ACTIVE",
                        signed_payload=_credential_json(
                            student["apaar_id"], spec["institution_id"], year
                        ),
                    )
                )
                total_enrollments += 1

            if collision:
                # The collision target: already holds an ACTIVE Pune seat.
                session.add(
                    StudentEnrollment(
                        apaar_id=COLLISION_APAAR,
                        student_name="Rohit Deshpande",
                        dob=date(2006, 12, 5),
                        institution_id="AICTE-MH-4011",
                        academic_year=year,
                        status="ACTIVE",
                        signed_payload=_credential_json(
                            COLLISION_APAAR, "AICTE-MH-4011", year
                        ),
                    )
                )
                total_enrollments += 1

    session.add(
        AuditLog(
            event_type="SYSTEM_SEED",
            severity="INFO",
            institution_id="AICTE-APEX",
            academic_year=ACTIVE_ACADEMIC_YEAR,
            detail=(
                "Seeded 2 approved institutions across 4 academic cycles and the "
                f"collision target {COLLISION_APAAR} (Pune Engineering College)."
            ),
        )
    )

    await session.commit()
    written = write_rosters()
    return {
        "skipped": False,
        "institutions": len(INSTITUTIONS),
        "enrollments": total_enrollments,
        "rosters": [str(path) for path in written],
        "collision_apaar": COLLISION_APAAR,
        "roster_preview": build_rosters(),
    }
