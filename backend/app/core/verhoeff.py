"""Verhoeff Mod-10 checksum engine.

The Verhoeff algorithm is a dihedral D5 check-digit scheme: it catches all
single-digit errors and all adjacent transpositions, which is why it is used
for APAAR ID integrity.
"""

from __future__ import annotations

D_TABLE = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)

P_TABLE = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)

INV_TABLE = (0, 4, 3, 2, 1, 5, 6, 7, 8, 9)


def _validate_digits(num_str: str) -> None:
    if not isinstance(num_str, str) or not num_str:
        raise ValueError("Verhoeff input must be a non-empty string")
    if not num_str.isascii() or not num_str.isdigit():
        raise ValueError("Verhoeff input must contain only ASCII digits 0-9")


def validate_verhoeff(num_str: str) -> bool:
    """Return True when ``num_str`` carries a valid Verhoeff check digit."""
    _validate_digits(num_str)
    checksum = 0
    for position, char in enumerate(reversed(num_str)):
        checksum = D_TABLE[checksum][P_TABLE[position % 8][int(char)]]
    return checksum == 0


def generate_verhoeff(num_str: str) -> str:
    """Append the correct Verhoeff check digit to an 11-digit base string."""
    _validate_digits(num_str)
    checksum = 0
    for position, char in enumerate(reversed(num_str)):
        checksum = D_TABLE[checksum][P_TABLE[(position + 1) % 8][int(char)]]
    return f"{num_str}{INV_TABLE[checksum]}"


def get_check_digit(num_str: str) -> str:
    _validate_digits(num_str)
    return generate_verhoeff(num_str)[-1]
