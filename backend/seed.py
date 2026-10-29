"""Seed the AICTE-TrustNet demo ledger and regenerate test rosters.

Usage: python seed.py
"""

from __future__ import annotations

import asyncio
import json

from app.db.seed import seed_database
from app.db.session import AsyncSessionLocal, dispose_engine, reset_schema


async def main() -> None:
    await reset_schema()
    async with AsyncSessionLocal() as session:
        summary = await seed_database(session, force=True)
    print(json.dumps(summary, indent=2, default=str))
    await dispose_engine()
    print("\nLedger reset. Test rosters written to /test_rosters.")


if __name__ == "__main__":
    asyncio.run(main())
