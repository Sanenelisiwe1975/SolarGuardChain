"""Fictional demo data. Every name and number here is made up."""

from __future__ import annotations

from .db import now
from .service import SolarGuard

DAY = 86400.0


async def seed(sg: SolarGuard) -> None:
    sg.db.reset()
    t = now()
    installer = "Sunbelt Installers (demo)"

    # The live demo panel and its neighbour: monitored, clean
    await sg.register("SG-0042", "Thandi Mokoena", "+27 71 000 0042", installer, "Soweto",
                      "JA Solar 550W", ts=t - 40 * DAY)
    await sg.register("SG-0043", "Thandi Mokoena", "+27 71 000 0042", installer, "Soweto",
                      "JA Solar 550W", ts=t - 40 * DAY + 60)

    # A panel with a resale history: installer -> first owner -> second owner
    await sg.register("SG-0107", "Pieter van Wyk", "+27 82 000 0107", installer, "Midrand",
                      "Canadian Solar 455W", ts=t - 400 * DAY)
    await sg.transfer("SG-0107", "Sipho Khumalo", "+27 83 000 0107", actor="Owner", ts=t - 30 * DAY)

    # A panel already reported stolen, for the buyer-check demo
    await sg.register("SG-0666", "Lerato Dlamini", "+27 72 000 0666", installer, "Kempton Park",
                      "Longi 540W", ts=t - 200 * DAY)
    await sg.report_stolen("SG-0666", "CAS 214/11/2026 (fictional)", actor="SAPS (demo)", ts=t - 5 * DAY)
