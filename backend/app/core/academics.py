"""Academic cycle catalogue shared by the seed corpus and API filters."""

from __future__ import annotations

ACTIVE_ACADEMIC_YEAR = "2026-2027"

ACADEMIC_YEARS = ("2024-2025", "2025-2026", "2026-2027", "2027-2028")

YEAR_LABELS = {
    "2024-2025": "Archived cycle",
    "2025-2026": "Previous cycle",
    "2026-2027": "Current cycle",
    "2027-2028": "Upcoming cycle",
}


def resolve_year(value: str | None) -> str:
    """Default to the current cycle and tolerate unknown future strings."""
    cleaned = (value or "").strip()
    return cleaned or ACTIVE_ACADEMIC_YEAR
